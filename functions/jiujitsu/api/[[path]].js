/* Chacrinha Jiu-Jitsu API: a Cloudflare Pages Function backed by a D1 database.

   Free-plan only. Needs two things set on the Pages project (see jiujitsu/README.md):
     JJ_DB              D1 database binding
     JJ_ADMIN_PASSWORD  secret, the password of the admin profile (Paloma)

   Routes (all under /jiujitsu/api):
     GET    /state              players + rolls
     POST   /players            {name, belt, stripes}
     PATCH  /players/:id        {belt, stripes} anyone; {name} admin only
     DELETE /players/:id        admin, also deletes that player's rolls
     POST   /rolls              {a, b, winner, method, note, date, by}
     PATCH  /rolls/:id          admin
     DELETE /rolls/:id          admin
     POST   /admin/login        {password}
   Admin requests send the password in the X-Admin-Password header. */

const ADMIN_NAME = 'Paloma';
const BELTS = ['white', 'blue', 'purple', 'brown', 'black'];
const MAX_NAME = 24;
const MAX_METHOD = 40;
const MAX_NOTE = 140;

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
    db.prepare(`INSERT OR IGNORE INTO players (name, belt, stripes) VALUES (?, 'white', 0)`).bind(ADMIN_NAME),
  ]);
  schemaReady = true;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
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

function cleanText(v, max, field, required) {
  if (v == null) v = '';
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be text.`);
  // Control characters become spaces; invisible / direction-override characters are dropped
  // (so nobody can sign up as "Paloma" plus a zero-width space).
  const s = v.normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g, '')
    .replace(/\s+/g, ' ').trim();
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

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAdmin(request, env) {
  const secret = env.JJ_ADMIN_PASSWORD;
  if (!secret) return false;
  return safeEqual(request.headers.get('x-admin-password') || '', secret);
}

function requireAdmin(request, env) {
  if (!env.JJ_ADMIN_PASSWORD) throw new HttpError(503, 'Admin password is not configured on the server.');
  if (!isAdmin(request, env)) throw new HttpError(401, 'Admin password required.');
}

async function getPlayer(db, id) {
  return db.prepare('SELECT id, name, belt, stripes, created_at FROM players WHERE id = ?').bind(id).first();
}

async function getRoll(db, id) {
  return db.prepare('SELECT * FROM rolls WHERE id = ?').bind(id).first();
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
  const found = await db.prepare('SELECT COUNT(*) AS n FROM players WHERE id IN (?, ?)').bind(a, b).first();
  if (!found || found.n !== 2) throw new HttpError(404, 'Player not found.');
  return {
    a, b, winner,
    method: cleanText(r.method, MAX_METHOD, 'Method', false),
    note: cleanText(r.note, MAX_NOTE, 'Note', false),
    date: cleanDate(r.date),
  };
}

async function handle(request, env, parts) {
  const db = env.JJ_DB;
  if (!db) throw new HttpError(503, 'Database is not connected yet (missing JJ_DB binding).');
  await ensureSchema(db);
  const method = request.method;
  const [res, idPart, extra] = parts;
  if (extra !== undefined) throw new HttpError(404, 'Not found.');

  if (res === 'state' && !idPart && method === 'GET') {
    const [players, rolls] = await db.batch([
      db.prepare('SELECT id, name, belt, stripes, created_at FROM players ORDER BY id'),
      db.prepare(`SELECT id, player_a AS a, player_b AS b, winner, method, note, rolled_on AS date, created_by AS by, created_at
                  FROM rolls ORDER BY rolled_on DESC, id DESC`),
    ]);
    return json({ players: players.results, rolls: rolls.results, admin: ADMIN_NAME, adminConfigured: !!env.JJ_ADMIN_PASSWORD });
  }

  if (res === 'admin' && idPart === 'login' && method === 'POST') {
    const body = await readBody(request);
    if (!env.JJ_ADMIN_PASSWORD) throw new HttpError(503, 'Admin password is not configured on the server.');
    if (!safeEqual(typeof body.password === 'string' ? body.password : '', env.JJ_ADMIN_PASSWORD)) throw new HttpError(401, 'Wrong password.');
    const p = await db.prepare('SELECT id FROM players WHERE name = ?').bind(ADMIN_NAME).first();
    return json({ ok: true, playerId: p ? p.id : null });
  }

  if (res === 'players') {
    if (!idPart && method === 'POST') {
      const body = await readBody(request);
      const name = cleanText(body.name, MAX_NAME, 'Name', true);
      const belt = body.belt === undefined ? 'white' : cleanBelt(body.belt);
      const stripes = cleanStripes(body.stripes);
      const dup = await db.prepare('SELECT id FROM players WHERE name = ?').bind(name).first();
      if (dup) throw new HttpError(409, `"${name}" is already on the board. Pick that name from the list instead.`);
      const row = await db.prepare('INSERT INTO players (name, belt, stripes) VALUES (?, ?, ?) RETURNING id, name, belt, stripes, created_at')
        .bind(name, belt, stripes).first();
      return json({ player: row }, 201);
    }
    if (idPart) {
      const id = cleanId(idPart, 'Player id');
      const player = await getPlayer(db, id);
      if (!player) throw new HttpError(404, 'Player not found.');

      if (method === 'PATCH') {
        const body = await readBody(request);
        const next = { name: player.name, belt: player.belt, stripes: player.stripes };
        if (body.name !== undefined) {
          requireAdmin(request, env);
          const name = cleanText(body.name, MAX_NAME, 'Name', true);
          if (player.name.toLowerCase() === ADMIN_NAME.toLowerCase() && name !== ADMIN_NAME) {
            throw new HttpError(400, 'The admin profile cannot be renamed.');
          }
          const dup = await db.prepare('SELECT id FROM players WHERE name = ? AND id != ?').bind(name, id).first();
          if (dup) throw new HttpError(409, `"${name}" is already taken.`);
          next.name = name;
        }
        if (body.belt !== undefined) next.belt = cleanBelt(body.belt);
        if (body.stripes !== undefined) next.stripes = cleanStripes(body.stripes);
        // Changing the admin profile itself needs the admin password.
        if (player.name.toLowerCase() === ADMIN_NAME.toLowerCase()) requireAdmin(request, env);
        const row = await db.prepare('UPDATE players SET name = ?, belt = ?, stripes = ? WHERE id = ? RETURNING id, name, belt, stripes, created_at')
          .bind(next.name, next.belt, next.stripes, id).first();
        return json({ player: row });
      }
      if (method === 'DELETE') {
        requireAdmin(request, env);
        if (player.name.toLowerCase() === ADMIN_NAME.toLowerCase()) throw new HttpError(400, 'The admin profile cannot be deleted.');
        await db.batch([
          db.prepare('DELETE FROM rolls WHERE player_a = ? OR player_b = ?').bind(id, id),
          db.prepare('UPDATE rolls SET created_by = NULL WHERE created_by = ?').bind(id),
          db.prepare('DELETE FROM players WHERE id = ?').bind(id),
        ]);
        return json({ ok: true });
      }
    }
  }

  if (res === 'rolls') {
    if (!idPart && method === 'POST') {
      const body = await readBody(request);
      const r = await validateRoll(db, body);
      let by = null;
      if (body.by != null && body.by !== '') {
        by = cleanId(body.by, 'Logged by');
        const p = await getPlayer(db, by);
        if (!p) by = null;
        // Rolls logged in the admin's name need the admin password.
        else if (p.name.toLowerCase() === ADMIN_NAME.toLowerCase() && !isAdmin(request, env)) by = null;
      }
      const row = await db.prepare(`INSERT INTO rolls (player_a, player_b, winner, method, note, rolled_on, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          RETURNING id, player_a AS a, player_b AS b, winner, method, note, rolled_on AS date, created_by AS by, created_at`)
        .bind(r.a, r.b, r.winner, r.method, r.note, r.date, by).first();
      return json({ roll: row }, 201);
    }
    if (idPart && (method === 'PATCH' || method === 'DELETE')) {
      const id = cleanId(idPart, 'Roll id');
      requireAdmin(request, env);
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
        const row = await db.prepare(`UPDATE rolls SET player_a = ?, player_b = ?, winner = ?, method = ?, note = ?, rolled_on = ?
            WHERE id = ?
            RETURNING id, player_a AS a, player_b AS b, winner, method, note, rolled_on AS date, created_by AS by, created_at`)
          .bind(r.a, r.b, r.winner, r.method, r.note, r.date, id).first();
        return json({ roll: row });
      }
      if (method === 'DELETE') {
        await db.prepare('DELETE FROM rolls WHERE id = ?').bind(id).run();
        return json({ ok: true });
      }
    }
  }

  throw new HttpError(404, 'Not found.');
}

export async function onRequest(context) {
  const { request, env, params } = context;
  let parts = params.path;
  if (!Array.isArray(parts)) parts = parts ? [parts] : [];
  parts = parts.filter(Boolean);
  try {
    return await handle(request, env, parts);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    const msg = String(err && err.message || err);
    if (/UNIQUE/i.test(msg)) return json({ error: 'That name is already taken.' }, 409);
    return json({ error: 'Something went wrong on the server.' }, 500);
  }
}
