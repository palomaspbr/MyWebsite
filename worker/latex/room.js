/* LatexRoom Durable Object: one per shared LaTeX Notebook project (/latex). Docs: C:\latex\docs\COLLAB.md.

   The project is a Yjs document, but this object never parses it: it keeps
     - a snapshot (one Yjs update with the whole document, in 1 MB chunks), and
     - the updates received since that snapshot (one row each, numbered by seq),
   relays every update and cursor ("awareness") message to the other sockets, and asks a client to
   send a fresh snapshot when the log grows ("compaction"). Binary files (images...) are stored
   separately, addressed by their SHA-256, in 1 MB chunks.

   Access: three random keys made at creation, only their SHA-256 hashes are stored here.
     edit  read + write        view  read only        owner  can delete the room ("stop sharing")

   WebSocket protocol (binary frames, first byte = type):
     0 HELLO     c->s  JSON {key, clientId}      s->c JSON {role, seq, limits}
     1 INIT      s->c  part of the initial stream: [u32 length][update] ... (snapshot, then updates)
     2 INIT_END  s->c  JSON {seq}
     3 UPDATE    both  a Yjs update
     4 AWARENESS both  a y-protocols awareness update (not stored)
     6 COMPACT   s->c  JSON {seq}: please POST /compact?seq= with your full state
     7 BIG       s->c  JSON {seq}: an update too big for a frame; GET /update/:seq
     8 LEFT      s->c  u32: the awareness clientId of a socket that closed
     9 ERROR     s->c  JSON {code}
   Text "ping" is answered "pong" without waking the object. Free plan: SQLite-backed class only. */

import { DurableObject } from 'cloudflare:workers';

export const LIMITS = {
  docBytes: 25 * 1024 * 1024,     // snapshot + update log
  blobBytes: 60 * 1024 * 1024,    // all binary files
  fileBytes: 10 * 1024 * 1024,    // one binary file
  frameBytes: 900 * 1024,         // bigger updates go over HTTP
};
const CHUNK = 1024 * 1024;
const INIT_PART = 512 * 1024;
const COMPACT_ROWS = 400;
const COMPACT_BYTES = 2 * 1024 * 1024;
const KEEP_MS = 400 * 24 * 3600 * 1000; // deleted ~13 months after the last edit

const T = { HELLO: 0, INIT: 1, INIT_END: 2, UPDATE: 3, AWARENESS: 4, COMPACT: 6, BIG: 7, LEFT: 8, ERROR: 9 };
const enc = new TextEncoder();
const dec = new TextDecoder();

function frame(type, payload) {
  const body = payload instanceof Uint8Array ? payload : enc.encode(JSON.stringify(payload));
  const out = new Uint8Array(body.length + 1);
  out[0] = type;
  out.set(body, 1);
  return out;
}
const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

export async function sha256Hex(data) {
  const buf = typeof data === 'string' ? enc.encode(data) : data;
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}
const fail = (status, code) => json({ error: code }, status);

export class LatexRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS snap (idx INTEGER PRIMARY KEY, data BLOB)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS upd (seq INTEGER PRIMARY KEY, data BLOB)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS blob (hash TEXT, idx INTEGER, data BLOB, PRIMARY KEY (hash, idx))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS blobinfo (hash TEXT PRIMARY KEY, size INTEGER, type TEXT, n INTEGER)`);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /*#region Storage helpers*/
  get(k) { const r = this.sql.exec('SELECT v FROM meta WHERE k = ?', k).toArray(); return r.length ? r[0].v : null; }
  set(k, v) { this.sql.exec('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, String(v)); }
  num(k) { return Number(this.get(k) || 0); }
  exists() {
    if (this.deleted) return false;
    try { return !!this.get('edit'); } catch { return false; } // tables are gone after deleteAll()
  }
  seq() {
    const r = this.sql.exec('SELECT MAX(seq) AS s FROM upd').one();
    return Math.max(r.s || 0, this.num('snapSeq'));
  }
  logStats() { return this.sql.exec('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS b FROM upd').one(); }
  snapBytes() { return this.sql.exec('SELECT COALESCE(SUM(LENGTH(data)), 0) AS b FROM snap').one().b; }
  docBytes() { return this.snapBytes() + this.logStats().b; }
  blobBytes() { return this.sql.exec('SELECT COALESCE(SUM(size), 0) AS b FROM blobinfo').one().b; }

  writeSnapshot(bytes, seq) {
    this.sql.exec('DELETE FROM snap');
    for (let i = 0, idx = 0; i < bytes.length; i += CHUNK, idx++) {
      this.sql.exec('INSERT INTO snap (idx, data) VALUES (?, ?)', idx, ab(bytes.subarray(i, i + CHUNK)));
    }
    this.sql.exec('DELETE FROM upd WHERE seq <= ?', seq);
    this.set('snapSeq', seq);
  }
  readSnapshot() {
    const rows = this.sql.exec('SELECT data FROM snap ORDER BY idx').toArray();
    if (!rows.length) return null;
    const parts = rows.map((r) => new Uint8Array(r.data));
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  async touch() {
    const now = Date.now();
    // Write the activity time (and move the alarm) at most once an hour.
    if (now - this.num('active') > 3600e3) {
      this.set('active', now);
      await this.ctx.storage.setAlarm(now + KEEP_MS);
    }
  }

  async alarm() {
    if (!this.exists() || Date.now() - this.num('active') >= KEEP_MS) await this.destroy('expired');
    else await this.ctx.storage.setAlarm(this.num('active') + KEEP_MS);
  }

  async destroy(reason) {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(frame(T.ERROR, { code: reason })); ws.close(4404, reason); } catch { /* closed */ }
    }
    this.deleted = true;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** Role for a key: 'owner' | 'edit' | 'view' | null. */
  async roleOf(key) {
    if (!key || typeof key !== 'string' || key.length > 100 || !this.exists()) return null;
    const h = await sha256Hex(key);
    if (h === this.get('owner')) return 'owner';
    if (h === this.get('edit')) return 'edit';
    if (h === this.get('view')) return 'view';
    return null;
  }
  /*#endregion*/

  /*#region HTTP*/
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname; // /__init, /ws, /info, /update[/seq], /compact, /blobs/check, /blobs/<hash>, /
    try {
      if (path === '/__init') return await this.init(request);
      if (!this.exists()) return fail(404, 'room_not_found');
      if (path === '/ws') return this.acceptSocket(request);

      const key = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const role = await this.roleOf(key);
      if (!role) return fail(403, 'bad_key');
      const canEdit = role === 'edit' || role === 'owner';

      if (path === '/info' && request.method === 'GET') {
        return json({ role, seq: this.seq(), docBytes: this.docBytes(), blobBytes: this.blobBytes(), limits: LIMITS, created: this.num('created') });
      }
      if (path === '/' && request.method === 'DELETE') {
        if (role !== 'owner') return fail(403, 'owner_only');
        await this.destroy('room_deleted');
        return json({ ok: true });
      }
      if (path === '/update' && request.method === 'POST') {
        if (!canEdit) return fail(403, 'read_only');
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (!bytes.length || bytes.length > 1.9 * 1024 * 1024) return fail(413, 'too_big');
        return json({ seq: await this.addUpdate(bytes, null) });
      }
      const m = /^\/update\/(\d+)$/.exec(path);
      if (m && request.method === 'GET') {
        const r = this.sql.exec('SELECT data FROM upd WHERE seq = ?', Number(m[1])).toArray();
        if (!r.length) return fail(404, 'gone');
        return new Response(r[0].data, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
      }
      if (path === '/compact' && request.method === 'POST') {
        if (!canEdit) return fail(403, 'read_only');
        const seq = Number(url.searchParams.get('seq'));
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (!Number.isInteger(seq) || seq < this.num('snapSeq') || seq > this.seq()) return fail(409, 'bad_seq');
        if (!bytes.length || bytes.length > LIMITS.docBytes) return fail(413, 'too_big');
        this.ctx.storage.transactionSync(() => this.writeSnapshot(bytes, seq));
        return json({ ok: true });
      }
      if (path === '/blobs/check' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const hashes = Array.isArray(body.hashes) ? body.hashes.filter((x) => /^[0-9a-f]{64}$/.test(x)).slice(0, 500) : [];
        const have = new Set(hashes.length ? this.sql.exec(`SELECT hash FROM blobinfo WHERE hash IN (${hashes.map(() => '?').join(',')})`, ...hashes).toArray().map((r) => r.hash) : []);
        return json({ missing: hashes.filter((x) => !have.has(x)) });
      }
      const b = /^\/blobs\/([0-9a-f]{64})$/.exec(path);
      if (b) {
        const hash = b[1];
        if (request.method === 'GET') {
          const info = this.sql.exec('SELECT size, type FROM blobinfo WHERE hash = ?', hash).toArray();
          if (!info.length) return fail(404, 'no_blob');
          const rows = this.sql.exec('SELECT data FROM blob WHERE hash = ? ORDER BY idx', hash).toArray();
          return new Response(new Blob(rows.map((r) => r.data)), {
            headers: { 'Content-Type': info[0].type || 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable' },
          });
        }
        if (request.method === 'PUT') {
          if (!canEdit) return fail(403, 'read_only');
          if (this.sql.exec('SELECT 1 FROM blobinfo WHERE hash = ?', hash).toArray().length) return json({ ok: true, existed: true });
          const bytes = new Uint8Array(await request.arrayBuffer());
          if (bytes.length > LIMITS.fileBytes) return fail(413, 'file_too_big');
          if (this.blobBytes() + bytes.length > LIMITS.blobBytes) return fail(413, 'room_full');
          if ((await sha256Hex(bytes)) !== hash) return fail(400, 'bad_hash');
          const type = (request.headers.get('Content-Type') || 'application/octet-stream').slice(0, 80);
          this.ctx.storage.transactionSync(() => {
            let n = 0;
            for (let i = 0; i < bytes.length || n === 0; i += CHUNK, n++) {
              this.sql.exec('INSERT OR REPLACE INTO blob (hash, idx, data) VALUES (?, ?, ?)', hash, n, ab(bytes.subarray(i, i + CHUNK)));
            }
            this.sql.exec('INSERT OR REPLACE INTO blobinfo (hash, size, type, n) VALUES (?, ?, ?, ?)', hash, bytes.length, type, n);
          });
          await this.touch();
          return json({ ok: true });
        }
      }
      return fail(404, 'not_found');
    } catch (err) {
      console.error('latex room', err);
      return fail(500, 'server_error');
    }
  }

  /** First request: store the key hashes and the initial snapshot. */
  async init(request) {
    if (this.exists()) return fail(409, 'exists');
    const keys = JSON.parse(request.headers.get('X-Room-Keys') || '{}');
    if (![keys.edit, keys.view, keys.owner].every((x) => /^[0-9a-f]{64}$/.test(x || ''))) return fail(400, 'bad_keys');
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length || bytes.length > LIMITS.docBytes) return fail(413, 'too_big');
    this.ctx.storage.transactionSync(() => {
      this.set('edit', keys.edit);
      this.set('view', keys.view);
      this.set('owner', keys.owner);
      this.set('created', Date.now());
      this.writeSnapshot(bytes, 0);
    });
    await this.touch();
    return json({ ok: true });
  }
  /*#endregion*/

  /*#region Updates*/
  async addUpdate(bytes, from) {
    if (this.docBytes() + bytes.length > LIMITS.docBytes) {
      if (from) from.send(frame(T.ERROR, { code: 'room_full' }));
      return -1;
    }
    const seq = this.seq() + 1;
    this.sql.exec('INSERT INTO upd (seq, data) VALUES (?, ?)', seq, ab(bytes));
    const msg = bytes.length > LIMITS.frameBytes ? frame(T.BIG, { seq }) : frame(T.UPDATE, bytes);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === from) continue;
      const att = ws.deserializeAttachment();
      if (att && att.ready) { try { ws.send(msg); } catch { /* closing */ } }
    }
    await this.touch();
    const st = this.logStats();
    const now = Date.now();
    // Ask at most every 30 s (in memory: after hibernation it may ask once more, which is harmless).
    if ((st.n > COMPACT_ROWS || st.b > COMPACT_BYTES) && !(now - (this.compactAskedAt || 0) < 30000)) {
      this.compactAskedAt = now;
      // Ask an editor that is fully synced (the sender if possible) for a fresh snapshot.
      const target = from || this.ctx.getWebSockets().find((ws) => { const a = ws.deserializeAttachment(); return a && a.ready && a.role !== 'view'; });
      if (target) { try { target.send(frame(T.COMPACT, { seq })); } catch { /* closing */ } }
    }
    return seq;
  }
  /*#endregion*/

  /*#region WebSockets (hibernation API)*/
  acceptSocket(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return fail(426, 'expected_websocket');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ ready: false, role: null, clientId: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw === 'string') return; // only "ping", answered automatically
    const data = new Uint8Array(raw);
    if (!data.length) return;
    const type = data[0];
    const body = data.subarray(1);
    const att = ws.deserializeAttachment() || {};

    if (type === T.HELLO) {
      let hello = {};
      try { hello = JSON.parse(dec.decode(body)); } catch { /* ignore */ }
      const role = await this.roleOf(hello.key);
      if (!role) { ws.send(frame(T.ERROR, { code: this.exists() ? 'bad_key' : 'room_not_found' })); ws.close(4403, 'bad_key'); return; }
      const clientId = Number.isInteger(hello.clientId) ? hello.clientId : null;
      const seq = this.seq();
      ws.send(frame(T.HELLO, { role: role === 'owner' ? 'edit' : role, seq, limits: LIMITS }));
      // Initial state: snapshot then every later update, as one length-prefixed stream in parts.
      const pieces = [];
      const snap = this.readSnapshot();
      if (snap) pieces.push(snap);
      for (const r of this.sql.exec('SELECT data FROM upd ORDER BY seq').toArray()) pieces.push(new Uint8Array(r.data));
      let buf = new Uint8Array(0);
      const flush = (force) => {
        while (buf.length >= INIT_PART || (force && buf.length)) {
          const part = buf.subarray(0, INIT_PART);
          ws.send(frame(T.INIT, part));
          buf = buf.subarray(part.length);
        }
      };
      for (const p of pieces) {
        const head = new Uint8Array(4);
        new DataView(head.buffer).setUint32(0, p.length);
        const next = new Uint8Array(buf.length + 4 + p.length);
        next.set(buf, 0); next.set(head, buf.length); next.set(p, buf.length + 4);
        buf = next;
        flush(false);
      }
      flush(true);
      ws.send(frame(T.INIT_END, { seq }));
      ws.serializeAttachment({ ready: true, role: role === 'owner' ? 'edit' : role, clientId });
      return;
    }

    if (!att.ready) return;
    if (type === T.UPDATE) {
      if (att.role !== 'edit') { ws.send(frame(T.ERROR, { code: 'read_only' })); return; }
      await this.addUpdate(body.slice(), ws);
    } else if (type === T.AWARENESS) {
      if (body.length > 64 * 1024) return;
      const msg = frame(T.AWARENESS, body);
      for (const other of this.ctx.getWebSockets()) {
        if (other === ws) continue;
        const a = other.deserializeAttachment();
        if (a && a.ready) { try { other.send(msg); } catch { /* closing */ } }
      }
    }
  }

  async webSocketClose(ws, code) {
    this.left(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch { /* closed */ }
  }

  async webSocketError(ws) {
    this.left(ws);
    try { ws.close(1011, 'error'); } catch { /* closed */ }
  }

  left(ws) {
    const att = ws.deserializeAttachment();
    if (!att || !Number.isInteger(att.clientId)) return;
    const body = new Uint8Array(4);
    new DataView(body.buffer).setUint32(0, att.clientId >>> 0);
    const msg = frame(T.LEFT, body);
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      try { other.send(msg); } catch { /* closing */ }
    }
  }
  /*#endregion*/
}
