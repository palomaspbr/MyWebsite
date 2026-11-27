import { handleLoaf, LOAF_PREFIX } from './loaf.js';
import { handleKaraoke, KARAOKE_PREFIX } from './karaoke/index.js';
import { handleLatex, LATEX_PREFIX } from './latex/index.js';
import { handleMyDrive, MYDRIVE_PREFIX } from './mydrive/index.js';

// Karaoke rooms and shared LaTeX projects are Durable Objects; the classes must be exported from the main module.
export { KaraokeRoom } from './karaoke/room.js';
export { LatexRoom } from './latex/room.js';
export { MyDriveStore } from './mydrive/store.js';

/* The site's Worker (wrangler.jsonc). Static files are served straight from the assets;
   this script only runs for /loaf_tower/api/* (the Loaf Tower leaderboard, worker/loaf.js),
   /karaoke/api/* (the karaoke app, worker/karaoke/),
   /latex/api/* (shared LaTeX Notebook projects, worker/latex/) and
   /jiujitsu/api/* (assets.run_worker_first), which is the
   Chacrinha Jiu-Jitsu API backed by a D1 database.

   Free-plan only. Needs:
     JJ_DB              D1 database binding (wrangler.jsonc)
     JJ_ADMIN_PASSWORD  secret set in the dashboard: the password of the admin profile (Paloma)

   Auth: every player has a password (chosen at signup; profiles from before passwords set it on
   their first login). POST /login returns a session token, sent back as "Authorization: Bearer <token>".
   Paloma logs in with JJ_ADMIN_PASSWORD and is the admin.

   Routes (all under /jiujitsu/api):
     GET    /state                    players, rolls (with status), and "me" when logged in
     POST   /login                    {id, password} -> {token, player, admin, claimed}
     POST   /logout
     POST   /players                  {name, belt, password, bio?} -> {token, player}
     PATCH  /players/:id              self or admin: {belt, bio}; self: {password, currentPassword};
                                      admin: {name}, {password} (reset someone else's password)
     DELETE /players/:id              admin, also deletes that player's rolls, photo and sessions
     GET    /players/:id/photo?v=N    public image, cached by browsers
     PUT    /players/:id/photo        self or admin, raw JPEG/PNG/WebP body (<= 300 KB)
     DELETE /players/:id/photo        self or admin
     POST   /rolls                    logged in, must be one of the two players (admin: any pair)
                                      -> "pending" until the other player accepts (admin's rolls: confirmed)
     POST   /rolls/:id/accept         the other player, or admin
     POST   /rolls/:id/reject         the other player, the player who logged it (cancel), or admin; deletes it
     PATCH  /rolls/:id                admin
     DELETE /rolls/:id                admin */

const ADMIN_NAME = 'Paloma';
const BELTS = ['white', 'blue', 'purple', 'brown', 'black'];
const MAX_NAME = 24;
const MAX_METHOD = 40;
const MAX_NOTE = 140;
const MAX_BIO = 280;
const MIN_PW = 4;
const MAX_PW = 72;
const PBKDF2_ITERATIONS = 10000; // ~3 ms of CPU: fits the free plan's 10 ms limit
const SESSION_MS = 180 * 24 * 3600 * 1000;
const MAX_FAILS = 10;
const LOCK_MS = 10 * 60 * 1000;
const MAX_PHOTO = 300 * 1024;

let schemaReady = false;

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      belt TEXT NOT NULL DEFAULT 'white',
      stripes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS rolls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_a INTEGER NOT NULL,
      player_b INTEGER NOT NULL,
      winner INTEGER,
      method TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      rolled_on TEXT NOT NULL,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      player_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      created_ms INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS photos (
      player_id INTEGER PRIMARY KEY,
      mime TEXT NOT NULL,
      data TEXT NOT NULL
    )`),
    db.prepare(`INSERT OR IGNORE INTO players (name, belt, stripes) VALUES (?, 'white', 0)`).bind(ADMIN_NAME),
  ]);
  // Columns added after the first release.
  const wanted = {
    players: {
      bio: "TEXT NOT NULL DEFAULT ''",
      photo_v: 'INTEGER NOT NULL DEFAULT 0',
      pw_hash: 'TEXT',
      fails: 'INTEGER NOT NULL DEFAULT 0',
      lock_until: 'INTEGER NOT NULL DEFAULT 0',
    },
    rolls: { status: "TEXT NOT NULL DEFAULT 'confirmed'", belt_a: 'TEXT', belt_b: 'TEXT' },
  };
  for (const table of Object.keys(wanted)) {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all();
    const have = new Set(info.results.map((c) => c.name));
    for (const [col, type] of Object.entries(wanted[table])) {
      if (have.has(col)) continue;
      try {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
      } catch (e) {
        if (!/duplicate column/i.test(String(e && e.message))) throw e;
      }
    }
  }
  schemaReady = true;
}

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function readBody(request) {
  try {
    const b = await request.json();
    if (b && typeof b === 'object' && !Array.isArray(b)) return b;
  } catch (_) { /* fall through */ }
  throw new HttpError(400, 'Request body must be a JSON object.');
}

// Invisible and direction-override characters (so nobody can sign up as "Paloma" plus a zero-width space).
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;

function cleanText(v, max, field, required, multiline) {
  if (v == null) v = '';
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be text.`);
  let s = v.normalize('NFC').replace(INVISIBLE, '');
  if (multiline) {
    s = s.replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, ' ')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } else {
    s = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (required && !s) throw new HttpError(400, `${field} is required.`);
  if (s.length > max) throw new HttpError(400, `${field} must be at most ${max} characters.`);
  return s;
}

function cleanBelt(v) {
  if (!BELTS.includes(v)) throw new HttpError(400, `Belt must be one of: ${BELTS.join(', ')}.`);
  return v;
}

function cleanStripes(v) {
  if (v === undefined) return 0;
  const n = typeof v === 'number' || (typeof v === 'string' && /^\d$/.test(v)) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 4) throw new HttpError(400, 'Stripes must be a whole number from 0 to 4.');
  return n;
}

function cleanId(v, field) {
  const n = typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${field} must be a valid id.`);
  return n;
}

function cleanDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, 'Date must look like YYYY-MM-DD.');
  const d = new Date(v + 'T00:00:00Z');
  if (isNaN(d) || d.toISOString().slice(0, 10) !== v) throw new HttpError(400, 'That date does not exist.');
  if (d.getUTCFullYear() < 2000) throw new HttpError(400, 'Date is too far in the past.');
  // Allow "today" in any time zone (UTC+14 is the furthest ahead), but not the future.
  if (d.getTime() > Date.now() + 14 * 3600 * 1000) throw new HttpError(400, 'Date cannot be in the future.');
  return v;
}

function cleanPassword(v, field = 'Password') {
  if (typeof v !== 'string') throw new HttpError(400, `${field} is required.`);
  if (v.length < MIN_PW) throw new HttpError(400, `${field} must have at least ${MIN_PW} characters.`);
  if (v.length > MAX_PW) throw new HttpError(400, `${field} must have at most ${MAX_PW} characters.`);
  return v;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const isAdminName = (name) => String(name).toLowerCase() === ADMIN_NAME.toLowerCase();

// ---------- crypto ----------
const enc = new TextEncoder();
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function sha256hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('');
}
async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}
async function verifyPassword(password, stored) {
  const [kind, iter, salt, hash] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !hash) return false;
  const got = await pbkdf2(password, unb64(salt), Number(iter));
  return safeEqual(b64(got), hash);
}

// Counts a wrong password atomically (parallel guesses can't skip the lockout).
async function recordFailure(db, id) {
  await db.prepare(`UPDATE players SET
      lock_until = CASE WHEN fails + 1 >= ? THEN ? ELSE lock_until END,
      fails = CASE WHEN fails + 1 >= ? THEN 0 ELSE fails + 1 END
    WHERE id = ?`).bind(MAX_FAILS, Date.now() + LOCK_MS, MAX_FAILS, id).run();
}
function checkLock(p) {
  const now = Date.now();
  if (p.lock_until > now) {
    const mins = Math.ceil((p.lock_until - now) / 60000);
    throw new HttpError(429, `Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
}

// A session stays valid only while the player's password is unchanged (the tag is derived from it).
async function sessionTag(player, env) {
  const secret = isAdminName(player.name) ? 'admin:' + (env.JJ_ADMIN_PASSWORD || '') : 'pw:' + (player.pw_hash || '');
  return (await sha256hex(secret)).slice(0, 24);
}
async function createSession(db, player, env) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await db.prepare('INSERT INTO sessions (token_hash, player_id, tag, created_ms) VALUES (?, ?, ?, ?)')
    .bind(await sha256hex(token), player.id, await sessionTag(player, env), Date.now()).run();
  return token;
}
function bearer(request) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(request.headers.get('authorization') || '');
  return m ? m[1] : null;
}
async function getAuth(request, db, env) {
  const token = bearer(request);
  if (!token) return null;
  const tokenHash = await sha256hex(token);
  const row = await db.prepare(`SELECT s.tag, s.created_ms, p.id, p.name, p.pw_hash
      FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = ?`).bind(tokenHash).first();
  if (!row || Date.now() - row.created_ms > SESSION_MS) return null;
  if (row.tag !== await sessionTag(row, env)) return null;
  const admin = isAdminName(row.name) && !!env.JJ_ADMIN_PASSWORD;
  return { id: row.id, name: row.name, admin, tokenHash };
}
function requireLogin(auth) {
  if (!auth) throw new HttpError(401, 'Please log in first.', 'login_required');
  return auth;
}
function requireAdmin(auth) {
  requireLogin(auth);
  if (!auth.admin) throw new HttpError(403, 'Only the admin can do that.');
}
function requireSelfOrAdmin(auth, playerId) {
  requireLogin(auth);
  if (!auth.admin && auth.id !== playerId) throw new HttpError(403, 'You can only change your own profile.');
}

// ---------- data ----------
const PLAYER_COLS = `id, name, belt, stripes, bio, photo_v, (pw_hash IS NOT NULL) AS has_pw, created_at`;
const ROLL_COLS = `id, player_a AS a, player_b AS b, winner, method, note, rolled_on AS date, created_by AS by, status, belt_a, belt_b, created_at`;

function publicPlayer(p, env) {
  if (!p) return p;
  const out = { ...p, has_pw: isAdminName(p.name) ? !!env.JJ_ADMIN_PASSWORD : !!p.has_pw };
  return out;
}
async function getPlayer(db, id) {
  return db.prepare(`SELECT ${PLAYER_COLS}, pw_hash, fails, lock_until FROM players WHERE id = ?`).bind(id).first();
}
async function getRoll(db, id) {
  return db.prepare('SELECT * FROM rolls WHERE id = ?').bind(id).first();
}
async function playerOut(db, id, env) {
  return publicPlayer(await db.prepare(`SELECT ${PLAYER_COLS} FROM players WHERE id = ?`).bind(id).first(), env);
}

// Validates a full roll (used for create and for admin edits after merging changes).
async function validateRoll(db, r) {
  const a = cleanId(r.a, 'Player A');
  const b = cleanId(r.b, 'Player B');
  if (a === b) throw new HttpError(400, 'You cannot roll against yourself.');
  let winner = r.winner;
  if (winner === '' || winner === undefined || winner === 'draw') winner = null;
  if (winner !== null) {
    winner = cleanId(winner, 'Winner');
    if (winner !== a && winner !== b) throw new HttpError(400, 'Winner must be one of the two players (or null for a draw).');
  }
  const found = await db.prepare('SELECT id, belt FROM players WHERE id IN (?, ?)').bind(a, b).all();
  if (found.results.length !== 2) throw new HttpError(404, 'Player not found.');
  const beltOf = (id) => found.results.find((p) => p.id === id).belt;
  return {
    a, b, winner,
    belt_a: beltOf(a), belt_b: beltOf(b), // points use the belts on the day of the roll
    method: cleanText(r.method, MAX_METHOD, 'Method', false),
    note: cleanText(r.note, MAX_NOTE, 'Note', false),
    date: cleanDate(r.date),
  };
}

function sniffImage(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

// ---------- routes ----------
async function handle(request, env, parts) {
  const db = env.JJ_DB;
  if (!db) throw new HttpError(503, 'Database is not connected yet (missing JJ_DB binding).');
  await ensureSchema(db);
  const method = request.method;
  const [res, idPart, sub, extra] = parts;
  if (extra !== undefined) throw new HttpError(404, 'Not found.');

  // Public photo (no auth, no D1 session lookup).
  if (res === 'players' && idPart && sub === 'photo' && method === 'GET') {
    const id = cleanId(idPart, 'Player id');
    const row = await db.prepare('SELECT mime, data FROM photos WHERE player_id = ?').bind(id).first();
    if (!row) throw new HttpError(404, 'No photo.');
    return new Response(unb64(row.data), {
      headers: {
        'content-type': row.mime,
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  const auth = await getAuth(request, db, env);

  if (res === 'state' && !idPart && method === 'GET') {
    const [players, rolls] = await db.batch([
      db.prepare(`SELECT ${PLAYER_COLS} FROM players ORDER BY id`),
      db.prepare(`SELECT ${ROLL_COLS} FROM rolls ORDER BY rolled_on DESC, id DESC`),
    ]);
    return json({
      players: players.results.map((p) => publicPlayer(p, env)),
      rolls: rolls.results,
      admin: ADMIN_NAME,
      adminConfigured: !!env.JJ_ADMIN_PASSWORD,
      me: auth ? { id: auth.id, admin: auth.admin } : null,
    });
  }

  if (res === 'login' && !idPart && method === 'POST') {
    const body = await readBody(request);
    const id = cleanId(body.id, 'Player id');
    const password = typeof body.password === 'string' ? body.password : '';
    const p = await getPlayer(db, id);
    if (!p) throw new HttpError(404, 'Player not found.');
    checkLock(p);
    let ok = false;
    let claimed = false;
    if (isAdminName(p.name)) {
      if (!env.JJ_ADMIN_PASSWORD) throw new HttpError(503, 'Admin password is not configured on the server.');
      ok = safeEqual(password, env.JJ_ADMIN_PASSWORD);
    } else if (!p.pw_hash) {
      // Profiles from before passwords existed: the first login sets the password.
      cleanPassword(password);
      p.pw_hash = await hashPassword(password);
      await db.prepare('UPDATE players SET pw_hash = ? WHERE id = ? AND pw_hash IS NULL').bind(p.pw_hash, id).run();
      const fresh = await getPlayer(db, id);
      ok = !!fresh.pw_hash && await verifyPassword(password, fresh.pw_hash);
      p.pw_hash = fresh.pw_hash;
      claimed = ok;
    } else {
      ok = await verifyPassword(password, p.pw_hash);
    }
    if (!ok) {
      await recordFailure(db, id);
      throw new HttpError(401, 'Wrong password.');
    }
    await db.batch([
      db.prepare('UPDATE players SET fails = 0 WHERE id = ? AND fails != 0').bind(id),
      db.prepare('DELETE FROM sessions WHERE player_id = ? AND created_ms < ?').bind(id, Date.now() - SESSION_MS),
    ]);
    const token = await createSession(db, p, env);
    return json({ token, player: await playerOut(db, id, env), admin: isAdminName(p.name), claimed });
  }

  if (res === 'logout' && !idPart && method === 'POST') {
    if (auth) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(auth.tokenHash).run();
    return json({ ok: true });
  }

  if (res === 'players') {
    if (!idPart && method === 'POST') {
      const body = await readBody(request);
      const name = cleanText(body.name, MAX_NAME, 'Name', true);
      const belt = body.belt === undefined ? 'white' : cleanBelt(body.belt);
      const stripes = cleanStripes(body.stripes);
      const bio = cleanText(body.bio, MAX_BIO, 'Bio', false, true);
      const password = cleanPassword(body.password);
      const dup = await db.prepare('SELECT id FROM players WHERE name = ?').bind(name).first();
      if (dup) throw new HttpError(409, `"${name}" is already on the board. Pick that name from the list and log in.`);
      const pwHash = await hashPassword(password);
      const row = await db.prepare('INSERT INTO players (name, belt, stripes, bio, pw_hash) VALUES (?, ?, ?, ?, ?) RETURNING id, name, pw_hash')
        .bind(name, belt, stripes, bio, pwHash).first();
      const token = await createSession(db, row, env);
      return json({ token, player: await playerOut(db, row.id, env) }, 201);
    }
    if (idPart) {
      const id = cleanId(idPart, 'Player id');
      const player = await getPlayer(db, id);
      if (!player) throw new HttpError(404, 'Player not found.');
      const isPaloma = isAdminName(player.name);

      if (sub === 'photo') {
        requireSelfOrAdmin(auth, id);
        if (method === 'PUT') {
          const len = Number(request.headers.get('content-length') || 0);
          if (len > MAX_PHOTO) throw new HttpError(413, 'Photo is too big (max 300 KB).');
          const bytes = new Uint8Array(await request.arrayBuffer());
          if (!bytes.length) throw new HttpError(400, 'Photo is empty.');
          if (bytes.length > MAX_PHOTO) throw new HttpError(413, 'Photo is too big (max 300 KB).');
          const mime = sniffImage(bytes);
          if (!mime) throw new HttpError(415, 'Photo must be a JPEG, PNG or WebP image.');
          await db.batch([
            db.prepare('INSERT OR REPLACE INTO photos (player_id, mime, data) VALUES (?, ?, ?)').bind(id, mime, b64(bytes)),
            db.prepare('UPDATE players SET photo_v = ABS(photo_v) + 1 WHERE id = ?').bind(id),
          ]);
          return json({ player: await playerOut(db, id, env) });
        }
        if (method === 'DELETE') {
          await db.batch([
            db.prepare('DELETE FROM photos WHERE player_id = ?').bind(id),
            // Keep the number (negative = no photo) so a later upload never reuses a cached URL.
            db.prepare('UPDATE players SET photo_v = -ABS(photo_v) WHERE id = ?').bind(id),
          ]);
          return json({ player: await playerOut(db, id, env) });
        }
        throw new HttpError(404, 'Not found.');
      }
      if (sub !== undefined) throw new HttpError(404, 'Not found.');

      if (method === 'PATCH') {
        requireSelfOrAdmin(auth, id);
        const body = await readBody(request);
        const next = { name: player.name, belt: player.belt, stripes: player.stripes, bio: player.bio, pw_hash: player.pw_hash };
        let newToken = null;
        if (body.name !== undefined) {
          requireAdmin(auth);
          const name = cleanText(body.name, MAX_NAME, 'Name', true);
          if (isPaloma && name !== ADMIN_NAME) throw new HttpError(400, 'The admin profile cannot be renamed.');
          const dup = await db.prepare('SELECT id FROM players WHERE name = ? AND id != ?').bind(name, id).first();
          if (dup) throw new HttpError(409, `"${name}" is already taken.`);
          next.name = name;
        }
        if (body.belt !== undefined) next.belt = cleanBelt(body.belt);
        if (body.stripes !== undefined) next.stripes = cleanStripes(body.stripes);
        if (body.bio !== undefined) next.bio = cleanText(body.bio, MAX_BIO, 'Bio', false, true);
        if (body.password !== undefined) {
          if (isPaloma) throw new HttpError(400, "The admin password is changed in Cloudflare (JJ_ADMIN_PASSWORD), not here.");
          const password = cleanPassword(body.password, 'New password');
          if (auth.id === id) {
            // Changing your own password needs the current one.
            const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
            checkLock(player);
            if (!player.pw_hash || !(await verifyPassword(current, player.pw_hash))) {
              await recordFailure(db, id);
              throw new HttpError(401, 'Your current password is wrong.');
            }
          } else {
            requireAdmin(auth);
          }
          next.pw_hash = await hashPassword(password);
        }
        await db.prepare('UPDATE players SET name = ?, belt = ?, stripes = ?, bio = ?, pw_hash = ?, fails = 0, lock_until = 0 WHERE id = ?')
          .bind(next.name, next.belt, next.stripes, next.bio, next.pw_hash, id).run();
        if (next.pw_hash !== player.pw_hash) {
          // Old sessions die with the old password; keep the one making the change logged in.
          await db.prepare('DELETE FROM sessions WHERE player_id = ?').bind(id).run();
          if (auth.id === id) newToken = await createSession(db, { id, name: next.name, pw_hash: next.pw_hash }, env);
        }
        return json({ player: await playerOut(db, id, env), token: newToken });
      }
      if (method === 'DELETE') {
        requireAdmin(auth);
        if (isPaloma) throw new HttpError(400, 'The admin profile cannot be deleted.');
        await db.batch([
          db.prepare('DELETE FROM rolls WHERE player_a = ? OR player_b = ?').bind(id, id),
          db.prepare('UPDATE rolls SET created_by = NULL WHERE created_by = ?').bind(id),
          db.prepare('DELETE FROM photos WHERE player_id = ?').bind(id),
          db.prepare('DELETE FROM sessions WHERE player_id = ?').bind(id),
          db.prepare('DELETE FROM players WHERE id = ?').bind(id),
        ]);
        return json({ ok: true });
      }
    }
  }

  if (res === 'rolls') {
    if (!idPart && method === 'POST') {
      requireLogin(auth);
      const body = await readBody(request);
      const r = await validateRoll(db, body);
      if (!auth.admin && auth.id !== r.a && auth.id !== r.b) throw new HttpError(403, 'You can only log rolls you were in.');
      const status = auth.admin ? 'confirmed' : 'pending';
      const row = await db.prepare(`INSERT INTO rolls (player_a, player_b, winner, method, note, rolled_on, created_by, status, belt_a, belt_b)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${ROLL_COLS}`)
        .bind(r.a, r.b, r.winner, r.method, r.note, r.date, auth.id, status, r.belt_a, r.belt_b).first();
      return json({ roll: row }, 201);
    }
    if (idPart && (sub === 'accept' || sub === 'reject') && method === 'POST') {
      requireLogin(auth);
      const id = cleanId(idPart, 'Roll id');
      const roll = await getRoll(db, id);
      if (!roll) throw new HttpError(404, 'Roll not found.');
      const inRoll = auth.id === roll.player_a || auth.id === roll.player_b;
      const isLogger = roll.created_by === auth.id;
      if (sub === 'accept') {
        if (roll.status !== 'pending') throw new HttpError(409, 'This roll is already confirmed.');
        if (!auth.admin && !(inRoll && !isLogger)) throw new HttpError(403, 'Only the other player (or the admin) can accept this roll.');
        const row = await db.prepare(`UPDATE rolls SET status = 'confirmed' WHERE id = ? AND status = 'pending' RETURNING ${ROLL_COLS}`).bind(id).first();
        if (!row) throw new HttpError(409, 'This roll was already answered.');
        return json({ roll: row });
      }
      if (roll.status !== 'pending' && !auth.admin) throw new HttpError(409, 'This roll is already confirmed. Ask the admin to fix it.');
      if (!auth.admin && !inRoll) throw new HttpError(403, 'Only the two players (or the admin) can reject this roll.');
      const del = auth.admin
        ? await db.prepare('DELETE FROM rolls WHERE id = ?').bind(id).run()
        : await db.prepare("DELETE FROM rolls WHERE id = ? AND status = 'pending'").bind(id).run();
      if (!del.meta || !del.meta.changes) throw new HttpError(409, 'This roll was already answered.');
      return json({ ok: true });
    }
    if (idPart && sub === undefined && (method === 'PATCH' || method === 'DELETE')) {
      const id = cleanId(idPart, 'Roll id');
      requireAdmin(auth);
      const roll = await getRoll(db, id);
      if (!roll) throw new HttpError(404, 'Roll not found.');
      if (method === 'PATCH') {
        const body = await readBody(request);
        const merged = {
          a: body.a !== undefined ? body.a : roll.player_a,
          b: body.b !== undefined ? body.b : roll.player_b,
          winner: body.winner !== undefined ? body.winner : roll.winner,
          method: body.method !== undefined ? body.method : roll.method,
          note: body.note !== undefined ? body.note : roll.note,
          date: body.date !== undefined ? body.date : roll.rolled_on,
        };
        const r = await validateRoll(db, merged);
        // Keep the belts recorded with the roll, unless the admin swapped in a different player.
        const keep = (pid, fresh) => (pid === roll.player_a && roll.belt_a ? roll.belt_a : pid === roll.player_b && roll.belt_b ? roll.belt_b : fresh);
        const row = await db.prepare(`UPDATE rolls SET player_a = ?, player_b = ?, winner = ?, method = ?, note = ?, rolled_on = ?, belt_a = ?, belt_b = ?
            WHERE id = ? RETURNING ${ROLL_COLS}`)
          .bind(r.a, r.b, r.winner, r.method, r.note, r.date, keep(r.a, r.belt_a), keep(r.b, r.belt_b), id).first();
        return json({ roll: row });
      }
      await db.prepare('DELETE FROM rolls WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  throw new HttpError(404, 'Not found.');
}

const API_PREFIX = '/jiujitsu/api';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Loaf Tower leaderboard (worker/loaf.js)
    if (url.pathname.startsWith(LOAF_PREFIX + '/')) return handleLoaf(request, env);
    // Karaoke (worker/karaoke/): rooms, queue, catalog, YouTube search
    if (url.pathname.startsWith(KARAOKE_PREFIX)) return handleKaraoke(request, env);
    // LaTeX Notebook (worker/latex/): shared projects (real-time collaboration)
    if (url.pathname.startsWith(LATEX_PREFIX)) return handleLatex(request, env);
    // MyDrive (worker/mydrive/): Paloma's private file storage, behind a login
    if (url.pathname.startsWith(MYDRIVE_PREFIX)) return handleMyDrive(request, env);
    if (url.pathname !== API_PREFIX && !url.pathname.startsWith(API_PREFIX + '/')) {
      // Not the API: hand back to the static assets (normally never reached, see wrangler.jsonc).
      return env.ASSETS.fetch(request);
    }
    try {
      let parts;
      try { parts = url.pathname.slice(API_PREFIX.length).split('/').filter(Boolean).map(decodeURIComponent); }
      catch (_) { throw new HttpError(404, 'Not found.'); }
      return await handle(request, env, parts);
    } catch (err) {
      if (err instanceof HttpError) return json(err.code ? { error: err.message, code: err.code } : { error: err.message }, err.status);
      console.error(err);
      const msg = String(err && err.message || err);
      if (/UNIQUE/i.test(msg)) return json({ error: 'That name is already taken.' }, 409);
      return json({ error: 'Something went wrong on the server.' }, 500);
    }
  },
};
