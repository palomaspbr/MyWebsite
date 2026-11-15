/* Karaoke catalog in D1 (binding KARAOKE_DB), shared by every room.
   Port of the Go database/ + catalog service parts that still make sense online:
   songs (soft delete / trash), song codes, search (trigram index), stats, languages,
   review queue and stored review suggestions. Videos are YouTube embeds, so there are
   no files, sizes or optimization flags (file_size is always 0, needs_optimization false). */

import { ApiError, nowIso, uuid, capitalizeFirst } from './http.js';
import { toTitleCase, normalizeArtistSeparators } from './meta/normalize.js';
import { findDuplicateSongs } from './meta/catalog_meta.js';

const SCHEMA_VERSION = '1';

const DEFAULT_LANGUAGES = [
  ['PT-BR', 'Português (BR)', 'PT-BR', 1],
  ['PT', 'Português (PT)', 'PT', 2],
  ['EN', 'English', 'EN', 3],
  ['ES', 'Español', 'ES', 4],
  ['FR', 'Français', 'FR', 5],
  ['IT', 'Italiano', 'IT', 6],
  ['DE', 'Deutsch', 'DE', 7],
  ['JA', '日本語', 'JA', 8],
  ['KO', '한국어', 'KO', 9],
  ['OTHER', 'Other', 'OTHER', 99]
];

export const VIDEO_KINDS = ['', 'karaoke', 'lyric_video', 'instrumental', 'music_video'];

// Every column except the long YouTube description (fetched only by getSong(..., {full:true})).
const LIST_COLUMNS = `id, code, title, artist, youtube_id, youtube_url, youtube_title, duration, thumbnail_url,
  metadata_verified, language, lyrics_start, no_first_line, added_at, play_count, last_played_at, deleted_at,
  video_kind, video_kind_source, added_by, added_room`;
const FULL_COLUMNS = LIST_COLUMNS + ', youtube_description';

let schemaReady = false;

export async function ensureSchema(db) {
  if (schemaReady) return;
  try {
    const row = await db.prepare(`SELECT value FROM settings WHERE key = 'schema_version'`).first();
    if (row && row.value === SCHEMA_VERSION) { schemaReady = true; return; }
  } catch (e) { /* tables not created yet */ }

  const stmts = [
    db.prepare(`CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      code INTEGER UNIQUE,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      youtube_id TEXT UNIQUE,
      youtube_url TEXT DEFAULT '',
      youtube_title TEXT DEFAULT '',
      youtube_description TEXT DEFAULT '',
      duration INTEGER DEFAULT 0,
      thumbnail_url TEXT DEFAULT '',
      metadata_verified INTEGER DEFAULT 0,
      language TEXT DEFAULT 'PT-BR',
      lyrics_start TEXT DEFAULT '',
      no_first_line INTEGER DEFAULT 0,
      added_at TEXT NOT NULL,
      play_count INTEGER DEFAULT 0,
      last_played_at TEXT,
      deleted_at TEXT,
      video_kind TEXT DEFAULT '',
      video_kind_source TEXT DEFAULT '',
      added_by TEXT DEFAULT '',
      added_room TEXT DEFAULT ''
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_songs_deleted ON songs(deleted_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_songs_room ON songs(added_room, added_by)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS languages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      acronym TEXT NOT NULL UNIQUE,
      position INTEGER DEFAULT 0
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS review_suggestions (
      song_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      song_artist TEXT NOT NULL DEFAULT '',
      song_title TEXT NOT NULL DEFAULT '',
      query_artist TEXT NOT NULL DEFAULT '',
      query_title TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_fails (
      ip TEXT PRIMARY KEY,
      fails INTEGER NOT NULL DEFAULT 0,
      last_fail INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0
    )`),
    ...DEFAULT_LANGUAGES.map(l => db.prepare(
      `INSERT OR IGNORE INTO languages (id, name, acronym, position) VALUES (?, ?, ?, ?)`).bind(...l)),
    db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('catalog_version', '1')`),
    db.prepare(`INSERT INTO settings (key, value) VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(SCHEMA_VERSION)
  ];
  await db.batch(stmts);
  schemaReady = true;
}

/*#region Song shape*/

// D1 row -> the Go models.Song JSON shape.
export function rowToSong(r) {
  if (!r) return null;
  const s = {
    id: r.id,
    code: r.code || 0,
    title: r.title || '',
    artist: r.artist || '',
    youtube_id: r.youtube_id || '',
    youtube_url: r.youtube_url || '',
    youtube_title: r.youtube_title || '',
    duration: r.duration || 0,
    thumbnail_url: r.thumbnail_url || '',
    file_size: 0,
    needs_optimization: false,
    metadata_verified: !!r.metadata_verified,
    language: r.language || '',
    lyrics_start: r.lyrics_start || '',
    no_first_line: !!r.no_first_line,
    added_at: r.added_at,
    play_count: r.play_count || 0
  };
  if (r.youtube_description) s.youtube_description = r.youtube_description;
  if (r.last_played_at) s.last_played_at = r.last_played_at;
  if (r.deleted_at) s.deleted_at = r.deleted_at;
  if (r.video_kind) s.video_kind = r.video_kind;
  if (r.video_kind_source) s.video_kind_source = r.video_kind_source;
  return s;
}

/*#endregion*/

/*#region Cached catalog list*/

// The live catalog (slim songs, sorted by artist then title) is cached per isolate and
// re-read only when settings.catalog_version changes, so searches cost one D1 row read.
let cache = { version: null, songs: [], index: null };

async function catalogVersion(db) {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'catalog_version'`).first();
  return row ? String(row.value) : '0';
}

async function bumpVersion(db) {
  cache.version = null;
  await db.prepare(`UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'catalog_version'`).run();
}

export async function liveSongs(db) {
  const version = await catalogVersion(db);
  if (cache.version === version) return cache.songs;
  const { results } = await db.prepare(
    `SELECT ${LIST_COLUMNS} FROM songs WHERE deleted_at IS NULL ORDER BY artist, title`).all();
  cache = { version, songs: results.map(rowToSong), index: null };
  return cache.songs;
}

/*#endregion*/

/*#region Search (port of database/search_index.go)*/

function removeAccents(s) {
  return String(s).normalize('NFD').replace(/\p{Mn}/gu, '');
}

function trigrams(s) {
  const runes = Array.from(' ' + s + ' ');
  const set = new Set();
  for (let i = 0; i + 3 <= runes.length; i++) set.add(runes.slice(i, i + 3).join(''));
  return set;
}

function scoreGrams(query, qGrams, text, tGrams) {
  if (text.includes(query)) return 2.0;
  if (qGrams.size === 0) return 0;
  let matches = 0;
  for (const g of qGrams) if (tGrams.has(g)) matches++;
  return matches / qGrams.size;
}

function searchIndex(songs) {
  if (cache.index && cache.songs === songs) return cache.index;
  const index = songs.map(song => {
    const title = removeAccents(song.title).toLowerCase();
    const artist = removeAccents(song.artist).toLowerCase();
    const combined = title + ' ' + artist;
    return { song, title, artist, combined, tg: trigrams(title), ag: trigrams(artist), cg: trigrams(combined) };
  });
  if (cache.songs === songs) cache.index = index;
  return index;
}

export async function searchSongs(db, query) {
  const songs = await liveSongs(db);
  const q = removeAccents(query).toLowerCase();
  const qg = trigrams(q);
  const hits = [];
  for (const e of searchIndex(songs)) {
    const score = Math.max(
      scoreGrams(q, qg, e.combined, e.cg),
      scoreGrams(q, qg, e.title, e.tg),
      scoreGrams(q, qg, e.artist, e.ag));
    if (score > 0.6) hits.push({ song: e.song, score });
  }
  hits.sort((a, b) => b.score - a.score); // Array.prototype.sort is stable, like sort.SliceStable
  return hits.map(h => h.song);
}

/*#endregion*/

/*#region Reads*/

export async function getSong(db, id, { full = false } = {}) {
  const row = await db.prepare(`SELECT ${full ? FULL_COLUMNS : LIST_COLUMNS} FROM songs WHERE id = ?`).bind(id).first();
  return rowToSong(row);
}

export async function getSongByYouTubeId(db, ytId) {
  return rowToSong(await db.prepare(`SELECT ${LIST_COLUMNS} FROM songs WHERE youtube_id = ?`).bind(ytId).first());
}

export async function getSongByCode(db, code) {
  return rowToSong(await db.prepare(
    `SELECT ${LIST_COLUMNS} FROM songs WHERE code = ? AND deleted_at IS NULL`).bind(code).first());
}

export async function getArtists(db) {
  const counts = new Map();
  for (const s of await liveSongs(db)) counts.set(s.artist, (counts.get(s.artist) || 0) + 1);
  return [...counts.entries()].map(([artist, song_count]) => ({ artist, song_count }));
}

export async function getSongsByArtist(db, artist) {
  return (await liveSongs(db)).filter(s => s.artist === artist);
}

export async function getStats(db) {
  const songs = await liveSongs(db);
  const counts = new Map();
  let duration = 0;
  for (const s of songs) {
    counts.set(s.artist, (counts.get(s.artist) || 0) + 1);
    duration += s.duration || 0;
  }
  const top = [...counts.entries()].map(([artist, song_count]) => ({ artist, song_count }))
    .sort((a, b) => b.song_count - a.song_count).slice(0, 10);
  const recent = [...songs].sort((a, b) => (a.added_at < b.added_at ? 1 : a.added_at > b.added_at ? -1 : 0)).slice(0, 10);
  return {
    total_songs: songs.length,
    total_artists: counts.size,
    total_duration: duration,
    total_size: 0,
    top_artists: top,
    recently_added: recent
  };
}

export async function getUnverified(db) {
  return (await liveSongs(db)).filter(s => !s.metadata_verified)
    .sort((a, b) => (a.added_at < b.added_at ? 1 : -1));
}

export async function getMyDownloads(db, room, user) {
  const { results } = await db.prepare(
    `SELECT ${LIST_COLUMNS} FROM songs WHERE added_room = ? AND added_by = ? AND deleted_at IS NULL ORDER BY added_at DESC`)
    .bind(room, user).all();
  return results.map(rowToSong);
}

export async function getTrash(db) {
  const { results } = await db.prepare(
    `SELECT ${LIST_COLUMNS} FROM songs WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all();
  return results.map(rowToSong);
}

export async function findDuplicates(db, title, artist) {
  return findDuplicateSongs(await liveSongs(db), title || '', artist || '');
}

/*#endregion*/

/*#region Writes*/

// Random code not in use, sized to the largest existing code (port of database.nextCode).
async function nextCode(db) {
  const { results } = await db.prepare(`SELECT code FROM songs WHERE code IS NOT NULL`).all();
  const existing = new Set(results.map(r => r.code));
  let maxCode = 0;
  for (const c of existing) if (c > maxCode) maxCode = c;
  let digits = Math.max(4, String(maxCode || '').length);
  for (;;) {
    const min = digits > 4 ? 10 ** (digits - 1) + 1 : 1001;
    const max = 10 ** digits - 1;
    for (let i = 0; i < 100; i++) {
      const c = min + Math.floor(Math.random() * (max - min + 1));
      if (!existing.has(c)) return c;
    }
    for (let c = min; c <= max; c++) if (!existing.has(c)) return c;
    digits++;
  }
}

// Creates a song from a confirmed add ("download") and returns it.
export async function addSong(db, fields) {
  const song = {
    id: uuid(),
    code: await nextCode(db),
    title: toTitleCase(fields.title),
    artist: toTitleCase(normalizeArtistSeparators(fields.artist)),
    youtube_id: fields.youtube_id,
    youtube_url: 'https://www.youtube.com/watch?v=' + fields.youtube_id,
    youtube_title: fields.youtube_title || '',
    youtube_description: fields.youtube_description || '',
    duration: Math.round(fields.duration || 0),
    thumbnail_url: fields.thumbnail_url || '',
    language: fields.language || 'EN',
    lyrics_start: capitalizeFirst(fields.lyrics_start || ''),
    added_at: nowIso(),
    added_by: fields.added_by || '',
    added_room: fields.added_room || ''
  };
  await db.prepare(`INSERT INTO songs (id, code, title, artist, youtube_id, youtube_url, youtube_title,
      youtube_description, duration, thumbnail_url, metadata_verified, language, lyrics_start, no_first_line,
      added_at, play_count, video_kind, video_kind_source, added_by, added_room)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, 0, '', '', ?, ?)`)
    .bind(song.id, song.code, song.title, song.artist, song.youtube_id, song.youtube_url, song.youtube_title,
      song.youtube_description, song.duration, song.thumbnail_url, song.language, song.lyrics_start,
      song.added_at, song.added_by, song.added_room)
    .run();
  await bumpVersion(db);
  return getSong(db, song.id);
}

// Port of songMetadataUpdate.applyTo: nil = keep, set = overwrite. Returns an error message or ''.
export function applyMetadataUpdate(song, u) {
  if (u.video_kind !== undefined && u.video_kind !== null && !VIDEO_KINDS.includes(u.video_kind)) {
    return 'video_kind is invalid (use karaoke, lyric_video, instrumental, music_video or empty)';
  }
  for (const f of ['title', 'artist', 'language']) {
    if (u[f] !== undefined && u[f] !== null && String(u[f]).trim() === '') return f + ' cannot be empty';
  }
  for (const f of ['title', 'artist', 'language']) {
    if (typeof u[f] === 'string') song[f] = u[f];
  }
  if (typeof u.lyrics_start === 'string') {
    song.lyrics_start = u.lyrics_start;
    if (u.lyrics_start.trim() !== '') song.no_first_line = false;
  }
  if (typeof u.no_first_line === 'boolean') {
    song.no_first_line = u.no_first_line;
    if (u.no_first_line) song.lyrics_start = '';
  }
  if (typeof u.video_kind === 'string') {
    song.video_kind = u.video_kind;
    song.video_kind_source = u.video_kind === '' ? '' : 'dj';
  }
  return '';
}

// Port of CatalogService.UpdateSong: formats text, saves, and drops stale review suggestions.
export async function saveSong(db, song, before) {
  song.title = toTitleCase(song.title);
  song.artist = toTitleCase(normalizeArtistSeparators(song.artist));
  song.lyrics_start = capitalizeFirst(song.lyrics_start);
  if (song.lyrics_start.trim() !== '') song.no_first_line = false;
  const stmts = [db.prepare(`UPDATE songs SET title = ?, artist = ?, language = ?, lyrics_start = ?, no_first_line = ?,
      metadata_verified = ?, video_kind = ?, video_kind_source = ? WHERE id = ?`)
    .bind(song.title, song.artist, song.language, song.lyrics_start, song.no_first_line ? 1 : 0,
      song.metadata_verified ? 1 : 0, song.video_kind || '', song.video_kind_source || '', song.id)];
  if (before && (before.artist !== song.artist || before.title !== song.title)) {
    stmts.push(db.prepare(`DELETE FROM review_suggestions WHERE song_id = ?`).bind(song.id));
  }
  await db.batch(stmts);
  await bumpVersion(db);
  return getSong(db, song.id);
}

export async function softDelete(db, id) {
  const song = await getSong(db, id);
  if (!song) throw new ApiError(404, 'song not found');
  await db.prepare(`UPDATE songs SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).bind(nowIso(), id).run();
  await bumpVersion(db);
}

export async function restore(db, id) {
  const song = await getSong(db, id);
  if (!song) throw new ApiError(404, 'song not found');
  if (!song.deleted_at) throw new ApiError(400, 'song is not in the trash');
  await db.prepare(`UPDATE songs SET deleted_at = NULL WHERE id = ?`).bind(id).run();
  await bumpVersion(db);
}

export async function purge(db, id) {
  const song = await getSong(db, id);
  if (!song) throw new ApiError(404, 'song not found');
  if (!song.deleted_at) throw new ApiError(400, 'song is not in the trash; delete it first');
  await db.batch([
    db.prepare(`DELETE FROM review_suggestions WHERE song_id = ?`).bind(id),
    db.prepare(`DELETE FROM songs WHERE id = ?`).bind(id)
  ]);
  await bumpVersion(db);
}

// Called by the rooms when a song finishes. Play counts don't bump the catalog version
// (the cached list may show a slightly old count; stats are good enough with that).
export async function incrementPlayCount(db, songId) {
  await db.prepare(`UPDATE songs SET play_count = play_count + 1, last_played_at = ? WHERE id = ?`)
    .bind(nowIso(), songId).run();
}

/*#endregion*/

/*#region Languages*/

export async function getLanguages(db) {
  const { results } = await db.prepare(`SELECT id, name, acronym, position FROM languages ORDER BY position, name`).all();
  return results;
}

export async function getLanguage(db, id) {
  return db.prepare(`SELECT id, name, acronym, position FROM languages WHERE id = ?`).bind(id).first();
}

export async function addLanguage(db, lang) {
  const exists = await db.prepare(`SELECT 1 FROM languages WHERE id = ? OR acronym = ?`).bind(lang.id, lang.acronym).first();
  if (exists) throw new ApiError(409, 'language already exists');
  const row = await db.prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM languages`).first();
  lang.position = (row ? row.p : 0) + 1;
  await db.prepare(`INSERT INTO languages (id, name, acronym, position) VALUES (?, ?, ?, ?)`)
    .bind(lang.id, lang.name, lang.acronym, lang.position).run();
  return lang;
}

export async function updateLanguage(db, lang) {
  await db.prepare(`UPDATE languages SET name = ?, acronym = ?, position = ? WHERE id = ?`)
    .bind(lang.name, lang.acronym, lang.position, lang.id).run();
  return lang;
}

export async function deleteLanguage(db, id) {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM songs WHERE language = ?`).bind(id).first();
  const n = row ? row.n : 0;
  if (n > 0) throw new ApiError(409, `Cannot delete language: ${n} song(s) are using it`);
  await db.prepare(`DELETE FROM languages WHERE id = ?`).bind(id).run();
}

/*#endregion*/

/*#region Review (port of database/review.go)*/

export async function getReviewRecord(db, songId) {
  const r = await db.prepare(`SELECT * FROM review_suggestions WHERE song_id = ?`).bind(songId).first();
  if (!r) return null;
  let payload = {};
  try { payload = JSON.parse(r.payload || '{}'); } catch (e) { payload = {}; }
  return {
    songId: r.song_id, status: r.status, payload, songArtist: r.song_artist, songTitle: r.song_title,
    queryArtist: r.query_artist, queryTitle: r.query_title, lastError: r.last_error,
    attempts: r.attempts, fetchedAt: r.fetched_at || null
  };
}

export async function saveReviewRecord(db, rec) {
  await db.prepare(`INSERT INTO review_suggestions (song_id, status, payload, song_artist, song_title, query_artist,
      query_title, last_error, attempts, fetched_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM songs WHERE id = ?)
      ON CONFLICT(song_id) DO UPDATE SET status = excluded.status, payload = excluded.payload,
        song_artist = excluded.song_artist, song_title = excluded.song_title, query_artist = excluded.query_artist,
        query_title = excluded.query_title, last_error = excluded.last_error, attempts = excluded.attempts,
        fetched_at = excluded.fetched_at`)
    .bind(rec.songId, rec.status, JSON.stringify(rec.payload || {}), rec.songArtist || '', rec.songTitle || '',
      rec.queryArtist || '', rec.queryTitle || '', rec.lastError || '', rec.attempts || 0, rec.fetchedAt || null,
      rec.songId)
    .run();
}

export async function getReviewQueue(db) {
  const { results } = await db.prepare(`
    SELECT s.id, s.code, s.title, s.artist, s.youtube_id, s.youtube_url, s.youtube_title, s.duration, s.thumbnail_url,
      s.metadata_verified, s.language, s.lyrics_start, s.no_first_line, s.added_at, s.play_count, s.last_played_at,
      s.deleted_at, s.video_kind, s.video_kind_source,
      COALESCE(r.status, '') AS r_status, r.fetched_at AS r_fetched, COALESCE(r.song_artist, '') AS r_artist,
      COALESCE(r.song_title, '') AS r_title
    FROM songs s LEFT JOIN review_suggestions r ON r.song_id = s.id
    WHERE s.deleted_at IS NULL AND (s.metadata_verified = 0 OR
      (COALESCE(s.lyrics_start, '') = '' AND COALESCE(s.no_first_line, 0) = 0))
    ORDER BY CASE WHEN r.status = 'ready' AND r.fetched_at IS NOT NULL THEN 0 ELSE 1 END, s.added_at DESC`).all();
  const items = results.map(r => {
    const item = rowToSong(r);
    item.reasons = [];
    if (!item.metadata_verified) item.reasons.push('unverified');
    if (item.lyrics_start.trim() === '' && !item.no_first_line) item.reasons.push('missing_first_line');
    item.suggestions_status = r.r_status;
    const stale = r.r_status !== '' && (r.r_artist !== item.artist || r.r_title !== item.title);
    item.suggestions_ready = r.r_status === 'ready' && !!r.r_fetched && !stale;
    if (r.r_fetched) item.suggestions_fetched_at = r.r_fetched;
    return item;
  });
  const counts = { total: items.length, unverified: 0, missing_first_line: 0, ready: 0 };
  for (const it of items) {
    if (it.reasons.includes('unverified')) counts.unverified++;
    if (it.reasons.includes('missing_first_line')) counts.missing_first_line++;
    if (it.suggestions_ready) counts.ready++;
  }
  return { items, counts };
}

/*#endregion*/

/*#region Catalog admin lockout (per IP, stored in D1 so every isolate sees it)*/

const MAX_FAILS = 5;
const LOCK_MS = 60 * 1000;

export async function lockedFor(db, ip) {
  const r = await db.prepare(`SELECT locked_until FROM auth_fails WHERE ip = ?`).bind(ip).first();
  const left = r ? r.locked_until - Date.now() : 0;
  return left > 0 ? left : 0;
}

export async function recordFail(db, ip) {
  const now = Date.now();
  const r = await db.prepare(`SELECT fails, last_fail FROM auth_fails WHERE ip = ?`).bind(ip).first();
  let fails = r && now - r.last_fail < LOCK_MS ? r.fails + 1 : 1;
  const locked = fails >= MAX_FAILS ? now + LOCK_MS : 0;
  if (locked) fails = 0;
  await db.prepare(`INSERT INTO auth_fails (ip, fails, last_fail, locked_until) VALUES (?, ?, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET fails = excluded.fails, last_fail = excluded.last_fail, locked_until = excluded.locked_until`)
    .bind(ip, fails, now, locked).run();
  // Keep the table small.
  await db.prepare(`DELETE FROM auth_fails WHERE last_fail < ? AND locked_until < ?`).bind(now - 3600e3, now).run();
  return locked > 0;
}

/*#endregion*/
