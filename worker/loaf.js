/* Loaf Tower leaderboard API (/loaf_tower/api/*), backed by the D1 database "cat_game" (binding CAT_DB).

   Profiles are per device: the game creates a random device id (a UUID) once and keeps it in the
   browser's localStorage. No IP addresses or other personal data are stored. Every player's best
   scores are saved; only players who choose a name are shown on the public leaderboard.

   Routes (JSON, same origin):
     POST /loaf_tower/api/sync   {device, scores: {tower, merge, yarn, tiles, mahjong}}  -> {profile}
     POST /loaf_tower/api/name   {device, name}   name null = hide from the board (name stays reserved) -> {profile}
     GET  /loaf_tower/api/board?game=tower&device=<id>                                    -> {game, top, me}
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
  ready = true;
}

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

async function profile(db, dev) {
  const p = await db.prepare('SELECT name, public FROM players WHERE device = ?').bind(dev).first();
  const rows = (await db.prepare('SELECT game, score FROM scores WHERE device = ?').bind(dev).all()).results || [];
  const scores = {};
  rows.forEach((r) => { scores[r.game] = r.score; });
  return { name: p ? p.name : null, public: !!(p && p.public), scores };
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
    return json({ profile: await profile(db, dev) });
  }

  if (path === '/name' && request.method === 'POST') {
    const b = await body(request);
    const dev = device(b.device);
    await db.prepare('INSERT OR IGNORE INTO players (device) VALUES (?)').bind(dev).run();
    if (b.name == null) {
      // hide from the public board; the name stays reserved for this device
      await db.prepare(`UPDATE players SET public = 0, updated_at = datetime('now') WHERE device = ?`).bind(dev).run();
    } else {
      const { name, key } = cleanName(b.name);
      try {
        await db.prepare(`UPDATE players SET name = ?, name_key = ?, public = 1, updated_at = datetime('now') WHERE device = ?`)
          .bind(name, key, dev).run();
      } catch (err) {
        if (/UNIQUE/i.test(String(err && err.message || err))) throw new ApiError(409, 'That name is already taken.', 'name_taken');
        throw err;
      }
    }
    return json({ profile: await profile(db, dev) });
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
