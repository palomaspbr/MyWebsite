/* Loaf Tower leaderboard API (/loaf_tower/api/*), backed by the D1 database "cat_game" (binding CAT_DB).

   Profiles are per device: the game creates a random device id (a UUID) once and keeps it in the
   browser's localStorage. No IP addresses or other personal data are stored. Every player's best
   scores are saved; only players who choose a name are shown on the public leaderboard.

   Routes (JSON, same origin):
     POST /loaf_tower/api/sync   {device, scores: {tower, merge, yarn, tiles, mahjong}, dex: [types], merge: {box, at}}
                                 -> {profile}   (dex = Catdex, kept as a union; merge = the Purr Merge box in
                                 progress, the newest `at` wins; box null = cleared)
     POST /loaf_tower/api/signup {device, name, password}  create the account: name + password together (the only
                                 way onto the public board) -> {profile}
     POST /loaf_tower/api/name   {device, name}   rename; only for profiles that already have a password -> {profile}
     GET  /loaf_tower/api/board?game=tower&device=<id>                                    -> {game, top, me}
     POST /loaf_tower/api/login     {device, name, password}  -> {device, profile}  (this device joins that profile;
                                    its own scores are merged in and the empty device profile is removed)
     POST /loaf_tower/api/password  {device, password, current}  set / change the profile's password -> {device, profile}
                                    (the profile gets a new id, so other devices that logged in before are signed out)
   Passwords: PBKDF2-SHA256 (10k iterations, fits the free plan's CPU limit); 5 wrong tries lock a profile for 10 min.
   Tables are created on first use (free plan, no migrations needed).

   Moderation from the D1 console:
     UPDATE players SET name = NULL, name_key = NULL, public = 0 WHERE name_key = 'bad name';
     DELETE FROM scores WHERE device = (SELECT device FROM players WHERE name_key = 'cheater'); */

export const LOAF_PREFIX = '/loaf_tower/api';

// best value per game; generous ceilings that only reject obviously impossible numbers
const GAMES = { tower: 30000, merge: 5000000, yarn: 10000, tiles: 10000, mahjong: 10000 };
const DEVICE_RE = /^[A-Za-z0-9-]{16,64}$/;
const MAX_NAME = 16;
const TOP = 20;
// invisible / control / format / private-use / unassigned characters, plus blank-looking letters
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/gu;
const BLANKS = new RegExp('[' + [0x2800, 0x3164, 0xffa0, 0x115f, 0x1160, 0x17b4, 0x17b5].map((c) => String.fromCharCode(c)).join('') + ']', 'g');
const HAS_TEXT = /[\p{L}\p{N}]/u;
const PBKDF2_ITERATIONS = 10000;
const MAX_FAILS = 5, LOCK_SECONDS = 600;
// The existing "Paloma" profile starts with a default password (only its salted hash lives here;
// change it from the leaderboard once logged in).
const DEFAULT_PASSWORDS = { paloma: 'pbkdf2$10000$WnJrVXbZRA1T7M7TlLTIQg==$CSd5Mc35FPFIKlF9Tf7gkoceQv9mg3m/xl2kRN0qL/A=' };

// One-shot admin merges requested by the owner: [from name_key, into name_key]. The "from" profile's
// best scores, Catdex and (newer) Purr Merge box go into the "into" profile, then "from" is deleted.
const PROFILE_MERGES = [['cods', 'codinho']];
// One-shot passwords set at the owner's request (salted hash only; applied once, after the merges).
// One-shot exact score fixes (can lower scores). Sets reset_at, so devices replace their local records
// with these values instead of pushing old (higher) ones back. 2026-11-16: undo an accidental login of
// Codinho on Paloma's device, which copied each profile's records into the other.
const SCORE_FIXES = {
  marker: 'score_fix_20261116_v1',
  profiles: {
    paloma: { tower: 506, yarn: 27, merge: 9277, tiles: 20, mahjong: 20 },
    codinho: { tower: 778, merge: 8553 },
  },
};
const SET_PASSWORDS = { vass: 'pbkdf2$10000$fuR0pxWQu3F3iSJz4/Iz8Q==$FaEKKNUdrkuAoXMpsx288CDBTKBOJSoXc+9GkqY04xs=', codinho: 'pbkdf2$10000$3QULdLqSThnnDa9HiM9D0A==$/dp1sULYwW9V+rpBuq8c/i7yjz9TUdarLX7A5UOQk+Y=' };
async function mergeProfiles(db, from, into) {
  const marker = `merge_${from}_into_${into}_v1`;
  if (await db.prepare('SELECT value FROM meta WHERE key = ?').bind(marker).first()) return;
  const src = await db.prepare('SELECT device, dex, merge_save, merge_at FROM players WHERE name_key = ?').bind(from).first();
  const dst = await db.prepare('SELECT device, dex, merge_at FROM players WHERE name_key = ?').bind(into).first();
  const stmts = [];
  if (src && dst && src.device !== dst.device) {
    const rows = (await db.prepare('SELECT game, score FROM scores WHERE device = ?').bind(src.device).all()).results || [];
    for (const r of rows) stmts.push(db.prepare(`INSERT INTO scores (device, game, score) VALUES (?, ?, ?)
      ON CONFLICT (device, game) DO UPDATE SET score = excluded.score, updated_at = datetime('now')
      WHERE excluded.score > scores.score`).bind(dst.device, r.game, r.score));
    const parse = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } };
    const dex = [...new Set([...parse(dst.dex), ...parse(src.dex)])];
    stmts.push(db.prepare('UPDATE players SET dex = ? WHERE device = ?').bind(JSON.stringify(dex), dst.device));
    if ((src.merge_at || 0) > (dst.merge_at || 0)) {
      stmts.push(db.prepare('UPDATE players SET merge_save = ?, merge_at = ? WHERE device = ?').bind(src.merge_save, src.merge_at, dst.device));
    }
    stmts.push(db.prepare('DELETE FROM scores WHERE device = ?').bind(src.device));
    stmts.push(db.prepare('DELETE FROM players WHERE device = ?').bind(src.device));
  }
  stmts.push(db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, datetime('now'))").bind(marker));
  await db.batch(stmts);
}

let ready = false;
async function ensureSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS players (
      device TEXT PRIMARY KEY,
      name TEXT,
      name_key TEXT UNIQUE,
      public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS scores (
      device TEXT NOT NULL,
      game TEXT NOT NULL,
      score INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (device, game)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scores_board ON scores (game, score DESC)`),
  ]);
  // columns added after launch (ALTER fails harmlessly when the column already exists)
  for (const col of ['pass_hash TEXT', 'fails INTEGER NOT NULL DEFAULT 0', 'fail_at INTEGER NOT NULL DEFAULT 0',
    'dex TEXT', 'merge_save TEXT', 'merge_at INTEGER NOT NULL DEFAULT 0', 'reset_at INTEGER NOT NULL DEFAULT 0']) {
    try { await db.prepare(`ALTER TABLE players ADD COLUMN ${col}`).run(); } catch (_) { /* already there */ }
  }
  // one-shot: the default password goes only to the profile that exists right now, never to a later
  // profile that registers the same name (a marker row records that this step already ran)
  await db.prepare('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)').run();
  const done = await db.prepare("SELECT value FROM meta WHERE key = 'default_passwords_v1'").first();
  if (!done) {
    const stmts = Object.entries(DEFAULT_PASSWORDS).map(([key, hash]) =>
      db.prepare('UPDATE players SET pass_hash = ? WHERE name_key = ? AND pass_hash IS NULL').bind(hash, key));
    stmts.push(db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('default_passwords_v1', datetime('now'))"));
    await db.batch(stmts);
  }
  for (const [from, into] of PROFILE_MERGES) await mergeProfiles(db, from, into);
  if (!(await db.prepare('SELECT value FROM meta WHERE key = ?').bind(SCORE_FIXES.marker).first())) {
    const now = Date.now(), stmts = [];
    for (const [key, scores] of Object.entries(SCORE_FIXES.profiles)) {
      const row = await db.prepare('SELECT device FROM players WHERE name_key = ?').bind(key).first();
      if (!row) continue;
      stmts.push(db.prepare('DELETE FROM scores WHERE device = ?').bind(row.device));
      for (const [game, score] of Object.entries(scores)) stmts.push(db.prepare('INSERT INTO scores (device, game, score) VALUES (?, ?, ?)').bind(row.device, game, score));
      stmts.push(db.prepare('UPDATE players SET reset_at = ? WHERE device = ?').bind(now, row.device));
    }
    stmts.push(db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, datetime('now'))").bind(SCORE_FIXES.marker));
    await db.batch(stmts);
  }
  for (const [key, hash] of Object.entries(SET_PASSWORDS)) {
    const marker = `set_password_${key}_v1`;
    if (await db.prepare('SELECT value FROM meta WHERE key = ?').bind(marker).first()) continue;
    await db.batch([
      db.prepare('UPDATE players SET pass_hash = ?, fails = 0 WHERE name_key = ?').bind(hash, key),
      db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, datetime('now'))").bind(marker),
    ]);
  }
  ready = true;
}

/* ---------- passwords ---------- */
const enc = new TextEncoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}
async function checkPassword(password, stored) {
  const [kind, iter, salt, hash] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !hash) return false;
  const got = await pbkdf2(password, unb64(salt), Number(iter));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}
function cleanPassword(v) {
  if (typeof v !== 'string' || v.length < 6) throw new ApiError(400, 'Password must be at least 6 characters.', 'pass_short');
  if (v.length > 64) throw new ApiError(400, 'Password is too long.', 'pass_long');
  return v;
}
// verify with lockout: too many wrong tries -> 429 for a while; success resets the counter
async function verifyOrFail(db, row, password) {
  const now = Math.floor(Date.now() / 1000);
  // the lock lasts LOCK_SECONDS from the attempt that triggered it (tries while locked don't extend it)
  const r = await db.prepare(`UPDATE players SET
      fails = CASE WHEN ?1 - fail_at < ?2 THEN fails + 1 ELSE 1 END,
      fail_at = CASE WHEN ?1 - fail_at < ?2 AND fails >= ?3 THEN fail_at ELSE ?1 END
      WHERE device = ?4 RETURNING fails`).bind(now, LOCK_SECONDS, MAX_FAILS, row.device).first();
  if (!r || r.fails > MAX_FAILS) throw new ApiError(429, 'Too many tries. Wait a few minutes.', 'locked');
  if (typeof password === 'string' && password.length <= 64 && await checkPassword(password, row.pass_hash)) {
    await db.prepare('UPDATE players SET fails = 0 WHERE device = ?').bind(row.device).run();
    return;
  }
  throw new ApiError(401, 'Wrong name or password.', 'wrong_login');
}
const newDeviceId = () => crypto.randomUUID();

class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function body(request) {
  let b;
  try { b = await request.json(); } catch (_) { throw new ApiError(400, 'Body must be JSON.', 'bad_json'); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'Body must be a JSON object.', 'bad_json');
  return b;
}

function device(v) {
  if (typeof v !== 'string' || !DEVICE_RE.test(v)) throw new ApiError(400, 'Bad device id.', 'bad_device');
  return v;
}

// Printable name of 2-16 characters with at least one letter or digit. Returns {name, key} where key
// (NFKC + lower case) is what must be unique, so "Biscuit", "BISCUIT" and fullwidth look-alikes clash.
function cleanName(v) {
  if (typeof v !== 'string') throw new ApiError(400, 'Name must be text.', 'bad_name');
  if (v.length > 200) throw new ApiError(400, 'Name is too long.', 'name_long');
  const s = v.normalize('NFC').replace(INVISIBLE, ' ').replace(BLANKS, '').replace(/\s+/g, ' ').trim();
  const n = [...s].length;
  if (n < 2 || !HAS_TEXT.test(s)) throw new ApiError(400, 'Name is too short.', 'name_short');
  if (n > MAX_NAME) throw new ApiError(400, `Name must be at most ${MAX_NAME} characters.`, 'name_long');
  return { name: s, key: s.normalize('NFKC').toLowerCase() };
}

// Catdex (union with what's stored) and the Purr Merge box (only if newer than the stored one).
const TYPE_RE = /^[a-z0-9]{1,16}$/;
const MAX_BOX = 40000; // bytes of JSON
async function saveCollection(db, dev, b) {
  const row = await db.prepare('SELECT dex, merge_at FROM players WHERE device = ?').bind(dev).first();
  if (!row) return;
  const sets = [], args = [];
  if (Array.isArray(b.dex)) {
    let have = [];
    try { have = JSON.parse(row.dex || '[]'); } catch (_) { have = []; }
    const all = new Set(have.filter((t) => typeof t === 'string' && TYPE_RE.test(t)));
    const before = all.size;
    for (const t of b.dex.slice(0, 300)) if (typeof t === 'string' && TYPE_RE.test(t)) all.add(t);
    if (all.size !== before && all.size <= 300) { sets.push('dex = ?'); args.push(JSON.stringify([...all])); }
  }
  const m = b.merge;
  if (m && typeof m === 'object' && Number.isFinite(m.at) && m.at > (row.merge_at || 0) && m.at < Date.now() + 86400000) {
    const box = m.box;
    const ok = box === null || (box && typeof box === 'object' && box.v === 1 && Array.isArray(box.cats) && box.cats.length <= 120);
    const text = box === null ? null : JSON.stringify(box);
    if (ok && (text === null || text.length <= MAX_BOX)) { sets.push('merge_save = ?', 'merge_at = ?'); args.push(text, Math.floor(m.at)); }
  }
  if (sets.length) await db.prepare(`UPDATE players SET ${sets.join(', ')} WHERE device = ?`).bind(...args, dev).run();
}

async function profile(db, dev) {
  const p = await db.prepare('SELECT name, public, pass_hash, dex, merge_save, merge_at, reset_at FROM players WHERE device = ?').bind(dev).first();
  const rows = (await db.prepare('SELECT game, score FROM scores WHERE device = ?').bind(dev).all()).results || [];
  const scores = {};
  rows.forEach((r) => { scores[r.game] = r.score; });
  const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (_) { return d; } };
  return {
    name: p ? p.name : null, public: !!(p && p.public), hasPassword: !!(p && p.pass_hash), scores,
    dex: parse(p && p.dex, []), merge: { box: parse(p && p.merge_save, null), at: (p && p.merge_at) || 0 },
    resetAt: (p && p.reset_at) || 0,
  };
}

async function handle(request, env, path) {
  const db = env.CAT_DB;
  if (!db) throw new ApiError(503, 'Leaderboard database is not configured.');
  await ensureSchema(db);
  const url = new URL(request.url);

  if (path === '/sync' && request.method === 'POST') {
    const b = await body(request);
    const dev = device(b.device);
    const stmts = [db.prepare('INSERT OR IGNORE INTO players (device) VALUES (?)').bind(dev)];
    // after an admin score fix, ignore what the device uploads until it has adopted the fixed values
    const rs = await db.prepare('SELECT reset_at FROM players WHERE device = ?').bind(dev).first();
    if (rs && rs.reset_at && !(Number(b.resetSeen) >= rs.reset_at)) return json({ profile: await profile(db, dev) });
    const scores = b.scores && typeof b.scores === 'object' && !Array.isArray(b.scores) ? b.scores : {};
    for (const [game, max] of Object.entries(GAMES)) {
      const v = scores[game];
      if (!Number.isInteger(v) || v <= 0 || v > max) continue;
      // keep the best score only
      stmts.push(db.prepare(`INSERT INTO scores (device, game, score) VALUES (?, ?, ?)
        ON CONFLICT (device, game) DO UPDATE SET score = excluded.score, updated_at = datetime('now')
        WHERE excluded.score > scores.score`).bind(dev, game, v));
    }
    await db.batch(stmts);
    await saveCollection(db, dev, b);
    return json({ profile: await profile(db, dev) });
  }

  if (path === '/name' && request.method === 'POST') {
    const b = await body(request);
    const dev = device(b.device);
    const row = await db.prepare('SELECT pass_hash FROM players WHERE device = ?').bind(dev).first();
    if (!row || !row.pass_hash) throw new ApiError(403, 'Sign up with a name and password first.', 'need_account');
    const { name, key } = cleanName(b.name);
    try {
      await db.prepare(`UPDATE players SET name = ?, name_key = ?, public = 1, updated_at = datetime('now') WHERE device = ?`)
        .bind(name, key, dev).run();
    } catch (err) {
      if (/UNIQUE/i.test(String(err && err.message || err))) throw new ApiError(409, 'That name is already taken.', 'name_taken');
      throw err;
    }
    return json({ profile: await profile(db, dev) });
  }

  if (path === '/signup' && request.method === 'POST') {
    const b = await body(request);
    const dev = device(b.device);
    const { name, key } = cleanName(b.name);
    const password = cleanPassword(b.password);
    await db.prepare('INSERT OR IGNORE INTO players (device) VALUES (?)').bind(dev).run();
    const self = await db.prepare('SELECT pass_hash FROM players WHERE device = ?').bind(dev).first();
    if (self && self.pass_hash) throw new ApiError(409, 'This device is already logged in. Log out first.', 'has_account');
    const owner = await db.prepare('SELECT device FROM players WHERE name_key = ?').bind(key).first();
    if (owner && owner.device !== dev) throw new ApiError(409, 'That name is already taken.', 'name_taken');
    const hash = await hashPassword(password);
    try {
      await db.prepare(`UPDATE players SET name = ?, name_key = ?, public = 1, pass_hash = ?, fails = 0, updated_at = datetime('now')
          WHERE device = ? AND pass_hash IS NULL`).bind(name, key, hash, dev).run();
    } catch (err) {
      if (/UNIQUE/i.test(String(err && err.message || err))) throw new ApiError(409, 'That name is already taken.', 'name_taken');
      throw err;
    }
    return json({ profile: await profile(db, dev) });
  }

  if (path === '/login' && request.method === 'POST') {
    const b = await body(request);
    const dev = device(b.device);
    if (typeof b.name !== 'string' || typeof b.password !== 'string') throw new ApiError(400, 'Name and password are required.', 'wrong_login');
    if (b.password.length > 64) throw new ApiError(401, 'Wrong name or password.', 'wrong_login'); // never hash huge inputs
    let key;
    try { key = cleanName(b.name).key; } catch (_) { throw new ApiError(401, 'Wrong name or password.', 'wrong_login'); }
    const row = await db.prepare('SELECT device, pass_hash, fails, fail_at FROM players WHERE name_key = ?').bind(key).first();
    if (!row) throw new ApiError(401, 'Wrong name or password.', 'wrong_login');
    if (!row.pass_hash) throw new ApiError(403, 'This profile has no password yet.', 'no_password');
    await verifyOrFail(db, row, b.password);
    const self = dev !== row.device ? await db.prepare('SELECT name, pass_hash FROM players WHERE device = ?').bind(dev).first() : null;
    if (self && !self.pass_hash) {
      // an anonymous (or old name-only) device profile: bring its scores along (best of both) and fold it in.
      // A device that was logged into ANOTHER account never copies that account's scores over.
      const mine = (await db.prepare('SELECT game, score FROM scores WHERE device = ?').bind(dev).all()).results || [];
      const stmts = mine.map((r) => db.prepare(`INSERT INTO scores (device, game, score) VALUES (?, ?, ?)
        ON CONFLICT (device, game) DO UPDATE SET score = excluded.score, updated_at = datetime('now')
        WHERE excluded.score > scores.score`).bind(row.device, r.game, r.score));
      stmts.push(db.prepare('DELETE FROM scores WHERE device = ?').bind(dev));
      stmts.push(db.prepare('DELETE FROM players WHERE device = ?').bind(dev));
      await db.batch(stmts);
    }
    return json({ device: row.device, profile: await profile(db, row.device) });
  }

  if (path === '/password' && request.method === 'POST') {
    const b = await body(request);
    const dev = device(b.device);
    const password = cleanPassword(b.password);
    const row = await db.prepare('SELECT device, name, pass_hash, fails, fail_at FROM players WHERE device = ?').bind(dev).first();
    if (!row || !row.name) throw new ApiError(400, 'Choose a name first.', 'need_name');
    if (row.pass_hash) {
      if (typeof b.current !== 'string') throw new ApiError(401, 'Wrong password.', 'wrong_password');
      try { await verifyOrFail(db, row, b.current); } catch (e) {
        if (e.code === 'wrong_login') throw new ApiError(401, 'Wrong password.', 'wrong_password');
        throw e;
      }
    }
    const fresh = newDeviceId();
    await db.batch([
      db.prepare(`UPDATE players SET pass_hash = ?, fails = 0, device = ?, updated_at = datetime('now') WHERE device = ?`).bind(await hashPassword(password), fresh, dev),
      db.prepare('UPDATE scores SET device = ? WHERE device = ?').bind(fresh, dev),
    ]);
    return json({ device: fresh, profile: await profile(db, fresh) });
  }

  if (path === '/board' && request.method === 'GET') {
    const game = url.searchParams.get('game');
    if (!Object.prototype.hasOwnProperty.call(GAMES, game)) throw new ApiError(400, 'Unknown game.', 'bad_game');
    const dev = url.searchParams.get('device');
    const top = (await db.prepare(`SELECT p.name AS name, s.score AS score, s.device AS device
        FROM scores s JOIN players p ON p.device = s.device
        WHERE s.game = ? AND p.public = 1 AND p.name IS NOT NULL
        ORDER BY s.score DESC, s.updated_at ASC, s.device ASC LIMIT ?`).bind(game, TOP).all()).results || [];
    let me = null;
    if (dev && DEVICE_RE.test(dev)) {
      const mine = await db.prepare(`SELECT s.score AS score, s.updated_at AS at, p.name AS name, p.public AS public
          FROM scores s LEFT JOIN players p ON p.device = s.device WHERE s.device = ? AND s.game = ?`).bind(dev, game).first();
      if (mine) {
        // same ordering as the list above, so a tie gets the same rank in both places
        const above = await db.prepare(`SELECT COUNT(*) AS n FROM scores s JOIN players p ON p.device = s.device
            WHERE s.game = ? AND p.public = 1 AND p.name IS NOT NULL AND s.device <> ?
              AND (s.score > ? OR (s.score = ? AND (s.updated_at < ? OR (s.updated_at = ? AND s.device < ?))))`)
          .bind(game, dev, mine.score, mine.score, mine.at, mine.at, dev).first();
        me = { score: mine.score, name: mine.name || null, public: !!mine.public, rank: (above ? above.n : 0) + 1 };
      }
    }
    return json({ game, top: top.map((r) => ({ name: r.name, score: r.score, me: r.device === dev })), me });
  }

  throw new ApiError(404, 'Not found.');
}

export async function handleLoaf(request, env) {
  const path = new URL(request.url).pathname.slice(LOAF_PREFIX.length) || '/';
  try {
    return await handle(request, env, path);
  } catch (err) {
    if (err instanceof ApiError) return json(err.code ? { error: err.message, code: err.code } : { error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong on the server.' }, 500);
  }
}
