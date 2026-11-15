/* Karaoke API router (everything under /karaoke/api/*). See C:\karaoke\ARCHITECTURE.md.

   POST /karaoke/api/rooms                  create a party -> {code, host_key}
   /karaoke/api/r/:code/...                 the original app's /api/... routes:
     - catalog, YouTube, languages, review -> handled here (stateless, D1)
     - queue, users, config, room, ws, shutdown, admin/verify -> the room's Durable Object

   Needs (wrangler.jsonc): KARAOKE_DB (D1), KARAOKE_ROOM (Durable Object namespace).
   Optional secrets: KARAOKE_ADMIN_PASSWORD (catalog admin), YOUTUBE_API_KEY (search via the Data API). */

import { ApiError, json, ok, okMessage, message, fail, errorResponse, readBody, str, clientIp, safeEqual, sha256Hex, randomToken, uuid, nowIso } from './http.js';
import * as catalog from './catalog.js';
import * as yt from './youtube.js';
import { extractMusicMetadata } from './meta/extract.js';
import { TitleParser } from './meta/title_parser.js';
import { isKaraokeSource, normalizeArtistSeparators } from './meta/normalize.js';
import { suggestCatalogArtist, artistLanguage, catalogHints } from './meta/catalog_meta.js';
import { refine } from './meta/lookup.js';
import { buildSuggestions, suggestionsView, isStale } from './meta/suggestions.js';

export const KARAOKE_PREFIX = '/karaoke/api/';

const ROOM_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_ROUTES = new Set(['room', 'queue', 'users', 'config', 'ws', 'shutdown']);
// Errored lookups are retried on the next view after this long (the Go worker backed off similarly).
const SUGGESTION_RETRY_MS = 10 * 60 * 1000;

/*#region Helpers*/

function roomStub(env, code) {
  return env.KARAOKE_ROOM.get(env.KARAOKE_ROOM.idFromName(code));
}

async function roomExists(env, code) {
  const res = await roomStub(env, code).fetch('https://room/__exists');
  return res.ok;
}

async function requireRoom(env, code) {
  if (!(await roomExists(env, code))) throw new ApiError(404, 'Room not found', { code: 'room_not_found' });
}

// Default language for a new song: the guest's browser language (the Go app used the server's).
function defaultLanguage(request) {
  const al = (request.headers.get('Accept-Language') || '').split(',')[0].trim().toLowerCase();
  if (al === 'pt-br' || al === 'pt') return al === 'pt' ? 'PT' : 'PT-BR';
  const base = al.split('-')[0];
  return ['en', 'es', 'fr', 'it', 'de', 'ja', 'ko'].includes(base) ? base.toUpperCase() : 'EN';
}

async function requireCatalogAdmin(env, request) {
  const secret = env.KARAOKE_ADMIN_PASSWORD;
  if (!secret) throw new ApiError(403, 'Catalog editing is not configured on this site', { code: 'catalog_admin_disabled' });
  const db = env.KARAOKE_DB;
  const ip = clientIp(request);
  const left = await catalog.lockedFor(db, ip);
  if (left > 0) {
    throw new ApiError(429, 'Too many wrong passwords. Try again in a minute.', { code: 'catalog_key_locked', retry_after: Math.ceil(left / 1000) + 1 });
  }
  const sent = request.headers.get('X-Catalog-Key') || '';
  if (!sent) throw new ApiError(401, 'Catalog password required', { code: 'catalog_key_required' });
  if (!safeEqual(sent, secret)) {
    const locked = await catalog.recordFail(db, ip);
    if (locked) throw new ApiError(429, 'Too many wrong passwords. Try again in a minute.', { code: 'catalog_key_locked', retry_after: 61 });
    throw new ApiError(401, 'Wrong catalog password', { code: 'catalog_key_invalid' });
  }
}

function job(status, fields) {
  const now = nowIso();
  return Object.assign({ id: uuid(), type: 'download', status, progress: status === 'completed' ? 100 : 5, message: status, created_at: now, updated_at: now }, fields);
}

/*#endregion*/

/*#region Add to catalog ("download")*/

// Port of CatalogService.AddFromYouTube up to the confirm_metadata step.
async function prepareAdd(env, request, videoId) {
  const db = env.KARAOKE_DB;
  const existing = await catalog.getSongByYouTubeId(db, videoId);
  if (existing) {
    // Online version: an existing song is simply handed back (the Go app refused re-downloads;
    // here nothing is downloaded, so "add & queue" just queues it). A trashed one is restored.
    if (existing.deleted_at) await catalog.restore(db, existing.id);
    return job('completed', { message: 'complete', result: await catalog.getSong(db, existing.id) });
  }

  let info;
  try {
    info = await yt.videoInfo(env, videoId);
  } catch (e) {
    return job('failed', { message: 'failed', error: 'failed to get video info: ' + e.message });
  }
  if (!info.embeddable) {
    return job('failed', { message: 'failed', error: "This video's owner doesn't allow playing it on other websites. Please pick another version." });
  }

  const songs = await catalog.liveSongs(db);
  let title = '', artist = '', language = '', lyrics = '';
  try {
    const md = extractMusicMetadata({ videoTitle: info.title, channel: info.channel, description: info.description, songs, defaultLanguage: defaultLanguage(request) });
    artist = md.artist || '';
    title = md.title || '';
    if (isKaraokeSource(artist) || !artist) {
      const parsed = new TitleParser().parseWithHints(info.title, info.channel, catalogHints(songs));
      artist = parsed.artist || '';
      title = parsed.song || '';
    }
    try {
      const match = await refine(artist, title, info.title, { budget: { left: 30 } }); // free plan: 50 subrequests per request
      if (match) { artist = match.artist; title = match.title; }
    } catch (e) { /* online lookup is best effort */ }
    artist = suggestCatalogArtist(songs, normalizeArtistSeparators(artist));
    language = String(md.language || '').toUpperCase();
    const artistLang = artistLanguage(songs, artist);
    if (artistLang && artistLang !== language) language = artistLang;
    lyrics = md.lyrics_start || '';
  } catch (e) {
    console.error('metadata extraction failed', e);
  }
  if (!language) language = defaultLanguage(request);

  return job('confirm_metadata', {
    message: 'confirm_metadata',
    data: {
      video_id: videoId,
      video_title: info.title,
      video_channel: info.channel,
      extracted_title: title,
      extracted_artist: artist,
      extracted_language: language,
      extracted_lyrics: lyrics
    }
  });
}

// Port of CatalogService.ContinueWithUserMetadata (minus the download).
async function submitMetadata(env, request, code, body) {
  const db = env.KARAOKE_DB;
  const videoId = str(body.video_id);
  if (!yt.isValidVideoId(videoId)) throw new ApiError(400, 'Video ID is required');
  if (!str(body.title).trim() || !str(body.artist).trim()) throw new ApiError(400, 'Invalid metadata: title and artist are required');

  const existing = await catalog.getSongByYouTubeId(db, videoId);
  if (existing) {
    if (existing.deleted_at) await catalog.restore(db, existing.id);
    return job('completed', { message: 'complete', result: await catalog.getSong(db, existing.id) });
  }
  let info;
  try { info = await yt.videoInfo(env, videoId); } catch (e) {
    return job('failed', { message: 'failed', error: 'failed to get video info: ' + e.message });
  }
  if (!info.embeddable) {
    return job('failed', { message: 'failed', error: "This video's owner doesn't allow playing it on other websites. Please pick another version." });
  }
  const song = await catalog.addSong(db, {
    title: body.title,
    artist: body.artist,
    language: str(body.language) || defaultLanguage(request),
    lyrics_start: str(body.lyrics_start),
    youtube_id: videoId,
    youtube_title: info.title,
    youtube_description: info.description,
    duration: info.duration,
    thumbnail_url: info.thumbnail,
    added_by: str(body.user_name),
    added_room: code
  });
  return job('completed', { message: 'complete', result: song });
}

/*#endregion*/

/*#region Review suggestions*/

async function computeSuggestions(env, song, artist, title, previousRecord) {
  const db = env.KARAOKE_DB;
  const songs = await catalog.liveSongs(db);
  const previous = previousRecord && previousRecord.payload ? previousRecord.payload.first_lines || [] : [];
  const languages = await catalog.getLanguages(db);
  let built;
  try {
    built = await buildSuggestions({ song, artist, title, previous, songs, languages, defaultLanguage: 'EN' });
  } catch (e) {
    built = { payload: (previousRecord && previousRecord.payload) || {}, status: 'error', error: String(e && e.message || e), queryArtist: artist, queryTitle: title };
  }
  const rec = {
    songId: song.id,
    status: built.status,
    payload: built.payload || {},
    songArtist: song.artist,
    songTitle: song.title,
    queryArtist: built.queryArtist || artist,
    queryTitle: built.queryTitle || title,
    lastError: built.error || '',
    attempts: built.status === 'error' ? ((previousRecord && previousRecord.attempts) || 0) + 1 : 0,
    fetchedAt: nowIso()
  };
  await catalog.saveReviewRecord(db, rec);
  return rec;
}

async function suggestionsFor(env, id, { refresh = false, artist = '', title = '' } = {}) {
  const db = env.KARAOKE_DB;
  const song = await catalog.getSong(db, id, { full: true });
  if (!song) throw new ApiError(404, 'song not found');
  let record = await catalog.getReviewRecord(db, id);
  const due = !record || isStale(record, song) ||
    (record.status === 'error' && Date.now() - Date.parse(record.fetchedAt || 0) > SUGGESTION_RETRY_MS);
  if (refresh || due) {
    record = await computeSuggestions(env, song, artist || song.artist, title || song.title, record);
  }
  const view = suggestionsView({
    song, record, songs: await catalog.liveSongs(db), addedBy: song.added_by || '',
    languages: await catalog.getLanguages(db), defaultLanguage: 'EN'
  });
  if (!view) throw new ApiError(404, 'song not found'); // trashed meanwhile
  return view;
}

/*#endregion*/

/*#region Stateless routes*/

async function handleStateless(request, env, code, seg, url) {
  const db = env.KARAOKE_DB;
  const method = request.method;
  const [a, b, c, d] = seg;

  // YouTube
  if (a === 'youtube') {
    if (b === 'search' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return fail(400, "Query parameter 'q' is required");
      if (q.length > 200) return fail(400, 'Query too long');
      try {
        const { results, source } = await yt.search(env, q);
        // Online extra: mark results that are already in the catalog.
        const songs = await catalog.liveSongs(db);
        const byYt = new Map(songs.map(s => [s.youtube_id, s.id]));
        for (const r of results) if (byYt.has(r.video_id)) r.in_catalog = byYt.get(r.video_id);
        // X-Karaoke-Search tells which source answered: api (YOUTUBE_API_KEY), page (results page) or none.
        return json(200, { success: true, data: results }, { 'X-Karaoke-Search': source });
      } catch (e) {
        return fail(500, e.message || 'YouTube search failed');
      }
    }
    if (b === 'video' && c && method === 'GET') {
      try {
        const info = await yt.videoInfo(env, c);
        const songs = await catalog.liveSongs(db);
        let metadata = null;
        try { metadata = extractMusicMetadata({ videoTitle: info.title, channel: info.channel, description: info.description, songs, defaultLanguage: defaultLanguage(request) }); } catch (e) { /* best effort */ }
        return ok({ video: Object.assign(yt.toSearchResult(info), { embeddable: info.embeddable }), metadata });
      } catch (e) {
        return fail(500, e.message);
      }
    }
    if (b === 'download' && method === 'POST') {
      const body = await readBody(request);
      if (!body || !yt.isValidVideoId(str(body.video_id))) return fail(400, 'Video ID is required');
      await requireRoom(env, code);
      const j = await prepareAdd(env, request, body.video_id);
      return okMessage({ job_id: j.id, job: j }, j.status === 'failed' ? j.error : 'Lookup finished');
    }
    if (b === 'submit-metadata' && method === 'POST') {
      const body = await readBody(request);
      if (!body) return fail(400, 'Invalid metadata');
      await requireRoom(env, code);
      const j = await submitMetadata(env, request, code, body);
      return okMessage({ job_id: j.id, job: j }, 'Song added to the catalog');
    }
  }

  if (a === 'jobs') return fail(404, 'Job not found');

  // Catalog
  if (a === 'catalog') {
    if (!b && method === 'GET') return ok(await catalog.liveSongs(db));
    if (b === 'search' && method === 'GET') {
      const q = url.searchParams.get('q') || '';
      return ok(q ? await catalog.searchSongs(db, q) : await catalog.liveSongs(db));
    }
    if (b === 'my-downloads' && method === 'GET') {
      const user = url.searchParams.get('user') || '';
      if (!user) return fail(400, 'user is required');
      return ok(await catalog.getMyDownloads(db, code, user));
    }
    if (b === 'stats' && method === 'GET') return ok(await catalog.getStats(db));
    if (b === 'duplicates' && method === 'GET') {
      return ok(await catalog.findDuplicates(db, url.searchParams.get('title'), url.searchParams.get('artist')));
    }
    if (b === 'artists' && method === 'GET') {
      return ok(c ? await catalog.getSongsByArtist(db, c) : await catalog.getArtists(db));
    }
    if (b === 'unverified' && method === 'GET') return ok(await catalog.getUnverified(db));
    if (b === 'trash' && method === 'GET') {
      await requireCatalogAdmin(env, request);
      return ok(await catalog.getTrash(db));
    }
    if (b === 'review' && method === 'GET') {
      await requireCatalogAdmin(env, request);
      const { items, counts } = await catalog.getReviewQueue(db);
      return ok({ items, counts, working_on: '', prefetch_enabled: false });
    }
    if (b === 'code' && c && method === 'GET') {
      const n = parseInt(c, 10);
      if (!/^\d+$/.test(c) || n < 1001) return fail(400, 'Invalid code');
      const song = await catalog.getSongByCode(db, n);
      return song ? ok(song) : fail(404, 'Song not found');
    }
    if (b === 'songs' && c) {
      if (!d && method === 'GET') {
        const song = await catalog.getSong(db, c);
        return song ? ok(song) : fail(404, 'Song not found');
      }
      if (!d && method === 'PUT') {
        await requireCatalogAdmin(env, request);
        return updateSong(db, request, c, false);
      }
      if (d === 'verify' && method === 'POST') {
        await requireCatalogAdmin(env, request);
        return updateSong(db, request, c, true);
      }
      if (!d && method === 'DELETE') {
        await requireCatalogAdmin(env, request);
        await catalog.softDelete(db, c);
        return message('Song moved to trash');
      }
      if (d === 'restore' && method === 'POST') {
        await requireCatalogAdmin(env, request);
        await catalog.restore(db, c);
        return message('Song restored');
      }
      if (d === 'purge' && method === 'DELETE') {
        await requireCatalogAdmin(env, request);
        await catalog.purge(db, c);
        return message('Song permanently deleted');
      }
      if (d === 'suggestions' && method === 'GET') {
        await requireCatalogAdmin(env, request);
        return ok(await suggestionsFor(env, c));
      }
      if (d === 'suggestions' && seg[4] === 'refresh' && method === 'POST') {
        await requireCatalogAdmin(env, request);
        const body = (await readBody(request)) || {};
        const artist = str(body.artist).trim(), title = str(body.title).trim();
        if (!artist !== !title) return fail(400, 'Give both artist and title, or neither');
        return ok(await suggestionsFor(env, c, { refresh: true, artist, title }));
      }
      if ((d === 'thumbnail' || d === 'stream') && method === 'GET') {
        // Online version: thumbnails are YouTube's and videos are embeds.
        const song = await catalog.getSong(db, c);
        if (!song) return fail(404, 'Song not found');
        if (d === 'thumbnail') return Response.redirect(song.thumbnail_url || `https://i.ytimg.com/vi/${song.youtube_id}/hqdefault.jpg`, 302);
        return Response.redirect(song.youtube_url, 302);
      }
    }
  }

  // Languages
  if (a === 'languages') {
    if (!b && method === 'GET') return ok(await catalog.getLanguages(db));
    if (!b && method === 'POST') {
      await requireCatalogAdmin(env, request);
      const body = await readBody(request);
      const lang = { id: str(body && body.id).trim(), name: str(body && body.name).trim(), acronym: str(body && body.acronym).trim() };
      if (!lang.id || !lang.name || !lang.acronym) return fail(400, 'ID, name and acronym are required');
      return okMessage(await catalog.addLanguage(db, lang), 'Language added successfully');
    }
    if (b && method === 'PUT') {
      await requireCatalogAdmin(env, request);
      const body = await readBody(request);
      if (!body) return fail(400, 'Invalid request body');
      const lang = await catalog.getLanguage(db, b);
      if (!lang) return fail(404, 'Language not found');
      if (str(body.name)) lang.name = body.name;
      if (str(body.acronym)) lang.acronym = body.acronym;
      if (Number.isInteger(body.position) && body.position > 0) lang.position = body.position;
      return okMessage(await catalog.updateLanguage(db, lang), 'Language updated successfully');
    }
    if (b && method === 'DELETE') {
      await requireCatalogAdmin(env, request);
      await catalog.deleteLanguage(db, b);
      return message('Language deleted successfully');
    }
  }

  if (a === 'admin' && b === 'catalog-verify' && method === 'POST') {
    await requireCatalogAdmin(env, request);
    return message('OK');
  }

  if (a === 'health') return message('Karaoke server is running');

  return fail(404, 'not found');
}

async function updateSong(db, request, id, verify) {
  const body = await readBody(request);
  if (body === null) return fail(400, 'Invalid request body');
  const before = await catalog.getSong(db, id);
  if (!before) return fail(404, 'Song not found');
  const song = Object.assign({}, before);
  const msg = catalog.applyMetadataUpdate(song, body);
  if (msg) return fail(400, msg);
  if (verify) song.metadata_verified = true;
  return ok(await catalog.saveSong(db, song, before));
}

/*#endregion*/

/*#region Entry*/

async function createRoom(env) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const code = [...bytes].map(b => ROOM_LETTERS[b % ROOM_LETTERS.length]).join('');
    const hostKey = randomToken(24);
    const res = await roomStub(env, code).fetch('https://room/__init', {
      method: 'POST',
      body: JSON.stringify({ code, hostKeyHash: await sha256Hex(hostKey) })
    });
    if (res.ok) return ok({ code, host_key: hostKey });
  }
  return fail(503, 'Could not find a free party code, please try again');
}

export async function handleKaraoke(request, env) {
  try {
    if (!env.KARAOKE_DB || !env.KARAOKE_ROOM) return fail(503, 'Karaoke is not configured on this server (missing KARAOKE_DB / KARAOKE_ROOM)');
    const url = new URL(request.url);
    const rest = url.pathname.slice(KARAOKE_PREFIX.length);

    if (rest === 'rooms' && request.method === 'POST') return await createRoom(env);
    if (rest === 'health') return message('Karaoke server is running');

    const m = /^r\/([A-Za-z]{4})(?:\/(.*))?$/.exec(rest);
    if (!m) return fail(404, 'not found');
    const code = m[1].toUpperCase();
    if (![...code].every(ch => ROOM_LETTERS.includes(ch))) return fail(404, 'Room not found', { code: 'room_not_found' });
    const seg = (m[2] || '').split('/').filter(Boolean).map(s => decodeURIComponent(s));

    const isRoomRoute = ROOM_ROUTES.has(seg[0]) || (seg[0] === 'admin' && seg[1] === 'verify');
    if (isRoomRoute) {
      // Normalise the code's case in the path the Durable Object parses.
      const fwd = new URL(request.url);
      fwd.pathname = `/karaoke/api/r/${code}/${m[2] || ''}`;
      return await roomStub(env, code).fetch(new Request(fwd, request));
    }

    await catalog.ensureSchema(env.KARAOKE_DB);
    return await handleStateless(request, env, code, seg, url);
  } catch (e) {
    return errorResponse(e);
  }
}

/*#endregion*/
