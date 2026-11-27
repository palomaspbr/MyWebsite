/* MyDriveStore Durable Object: Paloma's private file storage for /mydrive (one instance, named "drive").
   Docs: tools/mydrive/README.md (repo, not published) and .notes/APPS.md.

   Everything lives in this object's SQLite database (free plan: SQLite-backed class, 5 GB per account
   shared with the other Durable Objects of the site, so MyDrive keeps itself under LIMIT_BYTES):
     files     one row per file (name, size, type, done = upload finished)
     chunks    the bytes, in 1 MiB rows (SQLite rows are limited to 2 MB); files are never recompressed,
               so a download is byte-for-byte the file that was uploaded
     sessions  login sessions (only the SHA-256 of the cookie token is stored)
     fails     failed login attempts, for the brute-force limits

   Login: user "Paloma" (any case) + the password in the Worker secret MYDRIVE_PASSWORD (set in the
   Cloudflare dashboard). Sessions remember a tag of the password, so changing the secret logs every
   device out.

   Routes (the Worker strips the /mydrive/api prefix and only forwards here):
     POST   /login        {user, password}          -> sets the md_session cookie
     POST   /logout
     GET    /me                                     -> {ok, user} or 401
     GET    /files                                  -> {files, used, limit}
     POST   /files        {name, size, type}        -> {id, part}
     PUT    /files/:id/parts/:p   raw bytes (PART bytes, the last part may be shorter)
     POST   /files/:id/done                         -> checks every byte arrived
     GET    /files/:id/download   (Range supported) -> the original bytes, as an attachment
     DELETE /files/:id
     POST   /delete-all   {confirm: true}            */

import { DurableObject } from 'cloudflare:workers';

export const CHUNK = 1024 * 1024;            // bytes per SQLite row
export const PART = 8 * CHUNK;               // bytes per upload request
export const LIMIT_BYTES = 3 * 1024 ** 3;    // total MyDrive storage (3 GiB of the 5 GB free)
const SESSION_DAYS = 30;
const FAILS_PER_IP = 5;                      // per 15 minutes
const FAILS_GLOBAL = 30;                     // per hour, all IPs together
const STALE_UPLOAD_MS = 6 * 3600 * 1000;     // unfinished uploads are removed after 6 hours
const COOKIE = 'md_session';
const USER = 'Paloma';

const enc = new TextEncoder();

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}
const fail = (status, code, extra = {}) => json({ error: code, ...extra }, status);

async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', typeof text === 'string' ? enc.encode(text) : text);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomId(bytes) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Constant-time comparison of two strings (compares their SHA-256 digests). */
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b))),
  ]);
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(x, y);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function cookie(value, maxAge, secure) {
  return `${COOKIE}=${value}; Path=/mydrive; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function cleanName(name) {
  const s = String(name || '').replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 200);
  return s || 'arquivo';
}
function cleanType(type) {
  const s = String(type || '').trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(s) && s.length <= 100 ? s : 'application/octet-stream';
}

/** Content-Disposition with a UTF-8 name and a plain ASCII fallback. */
function disposition(name) {
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export class MyDriveStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, name TEXT, size INTEGER, type TEXT, created INTEGER, done INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chunks (file_id TEXT, n INTEGER, data BLOB, PRIMARY KEY (file_id, n))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, pw TEXT, expires INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS fails (ts INTEGER, ip TEXT)`);
  }

  used() { return this.sql.exec('SELECT COALESCE(SUM(size), 0) AS b FROM files').one().b; }

  async passwordTag() {
    const pw = this.env.MYDRIVE_PASSWORD;
    return pw ? (await sha256Hex('mydrive-session|' + pw)).slice(0, 32) : null;
  }

  async session(request) {
    const token = readCookie(request, COOKIE);
    if (!token || token.length > 100) return false;
    const tag = await this.passwordTag();
    if (!tag) return false;
    const rows = this.sql.exec('SELECT pw, expires FROM sessions WHERE hash = ?', await sha256Hex(token)).toArray();
    return rows.length > 0 && rows[0].pw === tag && rows[0].expires > Date.now();
  }

  async login(request, secure) {
    const pw = this.env.MYDRIVE_PASSWORD;
    if (!pw) return fail(503, 'not_configured');
    const ip = request.headers.get('X-Client-IP') || 'local';
    const now = Date.now();
    this.sql.exec('DELETE FROM fails WHERE ts < ?', now - 3600e3);
    const mine = this.sql.exec('SELECT COUNT(*) AS n, MIN(ts) AS first FROM fails WHERE ip = ? AND ts > ?', ip, now - 900e3).one();
    const all = this.sql.exec('SELECT COUNT(*) AS n, MIN(ts) AS first FROM fails').one();
    if (mine.n >= FAILS_PER_IP) return fail(429, 'too_many_attempts', { retryAfter: Math.ceil((mine.first + 900e3 - now) / 1000) });
    if (all.n >= FAILS_GLOBAL) return fail(429, 'too_many_attempts', { retryAfter: Math.ceil((all.first + 3600e3 - now) / 1000) });

    let body = {};
    try { body = await request.json(); } catch { /* empty body */ }
    const userOk = String(body.user || '').trim().toLowerCase() === USER.toLowerCase();
    const passOk = await sameSecret(String(body.password || ''), pw);
    if (!userOk || !passOk) {
      this.sql.exec('INSERT INTO fails (ts, ip) VALUES (?, ?)', now, ip);
      return fail(401, 'wrong_login', { left: Math.max(0, FAILS_PER_IP - mine.n - 1) });
    }
    this.sql.exec('DELETE FROM fails WHERE ip = ?', ip);
    this.sql.exec('DELETE FROM sessions WHERE expires < ?', now);
    const token = randomId(32);
    this.sql.exec('INSERT INTO sessions (hash, pw, expires) VALUES (?, ?, ?)', await sha256Hex(token), await this.passwordTag(), now + SESSION_DAYS * 86400e3);
    return json({ ok: true, user: USER }, 200, { 'Set-Cookie': cookie(token, SESSION_DAYS * 86400, secure) });
  }

  removeFile(id) {
    this.sql.exec('DELETE FROM chunks WHERE file_id = ?', id);
    this.sql.exec('DELETE FROM files WHERE id = ?', id);
  }

  cleanStale() {
    const old = this.sql.exec('SELECT id FROM files WHERE done = 0 AND created < ?', Date.now() - STALE_UPLOAD_MS).toArray();
    for (const r of old) this.removeFile(r.id);
  }

  download(request, file) {
    const size = file.size;
    let start = 0, end = size - 1, status = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') || '');
    if (range && size > 0 && (range[1] || range[2])) {
      if (range[1]) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1; }
      else { start = Math.max(0, size - Number(range[2])); }
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      }
      status = 206;
    }
    const length = size === 0 ? 0 : end - start + 1;
    const headers = {
      'Content-Type': file.type || 'application/octet-stream',
      'Content-Disposition': disposition(file.name),
      'Content-Length': String(length),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    if (length === 0) return new Response(null, { status, headers });

    const sql = this.sql;
    let n = Math.floor(start / CHUNK);
    const last = Math.floor(end / CHUNK);
    const stream = new ReadableStream({
      pull(controller) {
        if (n > last) { controller.close(); return; }
        const rows = sql.exec('SELECT data FROM chunks WHERE file_id = ? AND n = ?', file.id, n).toArray();
        if (!rows.length) { controller.error(new Error('missing chunk')); return; }
        let bytes = new Uint8Array(rows[0].data);
        const base = n * CHUNK;
        const from = n === Math.floor(start / CHUNK) ? start - base : 0;
        const to = n === last ? end - base + 1 : bytes.length;
        if (from > 0 || to < bytes.length) bytes = bytes.slice(from, to);
        n++;
        controller.enqueue(bytes);
      },
    });
    return new Response(stream.pipeThrough(new FixedLengthStream(length)), { status, headers });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;
    const secure = request.headers.get('X-Forwarded-Proto') !== 'http';
    try {
      if (path === '/login' && method === 'POST') return await this.login(request, secure);
      if (path === '/logout' && method === 'POST') {
        const token = readCookie(request, COOKIE);
        if (token) this.sql.exec('DELETE FROM sessions WHERE hash = ?', await sha256Hex(token));
        return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0, secure) });
      }

      if (!this.env.MYDRIVE_PASSWORD) return fail(503, 'not_configured');
      if (!(await this.session(request))) return fail(401, 'login_required');

      if (path === '/me') return json({ ok: true, user: USER });

      if (path === '/files' && method === 'GET') {
        this.cleanStale();
        const files = this.sql.exec('SELECT id, name, size, type, created FROM files WHERE done = 1 ORDER BY created DESC').toArray();
        return json({ files, used: this.used(), limit: LIMIT_BYTES });
      }

      if (path === '/files' && method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch { return fail(400, 'bad_request'); }
        const size = Number(body.size);
        if (!Number.isSafeInteger(size) || size < 0) return fail(400, 'bad_size');
        this.cleanStale();
        if (this.used() + size > LIMIT_BYTES) return fail(413, 'drive_full', { used: this.used(), limit: LIMIT_BYTES });
        const id = randomId(16);
        this.sql.exec('INSERT INTO files (id, name, size, type, created, done) VALUES (?, ?, ?, ?, ?, 0)',
          id, cleanName(body.name), size, cleanType(body.type), Date.now());
        return json({ id, part: PART }, 201);
      }

      if (path === '/delete-all' && method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch { /* checked below */ }
        if (body.confirm !== true) return fail(400, 'confirm_required');
        const n = this.sql.exec('SELECT COUNT(*) AS n FROM files').one().n;
        this.sql.exec('DELETE FROM chunks');
        this.sql.exec('DELETE FROM files');
        return json({ ok: true, deleted: n });
      }

      const m = /^\/files\/([A-Za-z0-9_-]{22})(\/.*)?$/.exec(path);
      if (m) {
        const id = m[1];
        const rest = m[2] || '';
        const rows = this.sql.exec('SELECT id, name, size, type, done FROM files WHERE id = ?', id).toArray();
        if (!rows.length) return fail(404, 'not_found');
        const file = rows[0];

        const p = /^\/parts\/(\d{1,6})$/.exec(rest);
        if (p && method === 'PUT') {
          if (file.done) return fail(409, 'already_done');
          const part = Number(p[1]);
          const expected = Math.min(PART, file.size - part * PART);
          if (expected <= 0 && !(file.size === 0 && part === 0)) return fail(400, 'bad_part');
          const bytes = new Uint8Array(await request.arrayBuffer());
          if (bytes.length !== Math.max(0, expected)) return fail(400, 'bad_length', { expected, got: bytes.length });
          const first = part * (PART / CHUNK);
          this.ctx.storage.transactionSync(() => {
            for (let i = 0, k = 0; i < bytes.length; i += CHUNK, k++) {
              const piece = bytes.subarray(i, i + CHUNK);
              this.sql.exec('INSERT OR REPLACE INTO chunks (file_id, n, data) VALUES (?, ?, ?)',
                id, first + k, piece.buffer.slice(piece.byteOffset, piece.byteOffset + piece.byteLength));
            }
          });
          return json({ ok: true });
        }

        if (rest === '/done' && method === 'POST') {
          const got = this.sql.exec('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS b FROM chunks WHERE file_id = ?', id).one();
          if (got.b !== file.size || got.n !== Math.ceil(file.size / CHUNK)) return fail(409, 'incomplete', { got: got.b, size: file.size });
          this.sql.exec('UPDATE files SET done = 1 WHERE id = ?', id);
          return json({ ok: true });
        }

        if (rest === '/download' && (method === 'GET' || method === 'HEAD')) {
          if (!file.done) return fail(404, 'not_found');
          const res = this.download(request, file);
          return method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
        }

        if (rest === '' && method === 'DELETE') {
          this.removeFile(id);
          return json({ ok: true });
        }
      }
      return fail(404, 'not_found');
    } catch (err) {
      console.error('mydrive', err);
      return fail(500, 'server_error');
    }
  }
}
