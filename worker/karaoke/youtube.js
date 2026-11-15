/* YouTube search + video info for the karaoke Worker (replaces the yt-dlp wrapper of the Go app).

   Search: the YouTube Data API v3 when the secret YOUTUBE_API_KEY is set (search.list costs 100 of
   the free 10,000 daily quota units, so ~100 searches/day), otherwise the public results page,
   read with indexOf + small regexes (a full JSON.parse of the ~1 MB page would blow the free
   plan's 10 ms CPU budget).

   Online the videos are played as embeds, and some channels forbid embedding (Sing King, for
   example). oEmbed answers 401 for those, so every search result is checked with oEmbed and
   blocked videos are left out. Whole search results are cached with the Cache API.
   Subrequest budget of a fresh search (free plan limit 50): 1 cache read + up to 2 searches + up to 20 oEmbed
   + 1 cache write; with the API: cache read + search.list + videos.list + cache write. */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const PAGE_HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'en-US,en;q=0.9',
  'Cookie': 'CONSENT=YES+1; SOCS=CAI'
};
const SEARCH_TTL = 6 * 3600;

export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const isValidVideoId = (id) => VIDEO_ID_RE.test(id || '');

/*#region Small helpers*/

export function formatViewCount(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.trunc(n));
}

export function formatDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function parseClock(text) {
  if (!text) return 0;
  return text.split(':').reduce((acc, p) => acc * 60 + (parseInt(p, 10) || 0), 0);
}

// ISO 8601 duration (PT1H2M3S) -> seconds
function parseIsoDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  return ((+m[1] || 0) * 86400) + ((+m[2] || 0) * 3600) + ((+m[3] || 0) * 60) + (+m[4] || 0);
}

function jsonUnescape(s) {
  try { return JSON.parse('"' + s + '"'); } catch (e) { return s; }
}

const thumbUrl = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

function result(id, title, channel, durationSec, views) {
  return {
    video_id: id,
    title,
    channel,
    duration: durationSec ? formatDuration(durationSec) : '',
    duration_sec: durationSec || 0,
    thumbnail_url: thumbUrl(id),
    view_count: views === null || views === undefined ? '' : formatViewCount(views),
    url: 'https://www.youtube.com/watch?v=' + id
  };
}

async function cached(key, ttl, compute) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const req = new Request('https://karaoke-cache.invalid/' + key);
  if (cache) {
    const hit = await cache.match(req);
    if (hit) return hit.json();
  }
  const value = await compute();
  if (cache && value !== undefined) {
    await cache.put(req, new Response(JSON.stringify(value), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + ttl }
    }));
  }
  return value;
}

/*#endregion*/

/*#region Embeddability*/

// true / false / null (unknown: network trouble). Not cached per video on purpose: Cache API calls count
// as subrequests (free plan: 50 per request), and the whole search result is cached anyway.
export async function isEmbeddable(id) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`,
      { signal: AbortSignal.timeout(5000) });
    if (res.status === 200) return true;
    if ([400, 401, 403, 404].includes(res.status)) return false;
    return null;
  } catch (e) {
    return null;
  }
}

/*#endregion*/

/*#region Search*/

function parseResultsPage(html, max) {
  const out = [];
  const marker = '"videoRenderer":{"videoId":"';
  const seen = new Set();
  let pos = html.indexOf(marker);
  while (pos !== -1 && out.length < max) {
    const idStart = pos + marker.length;
    const id = html.slice(idStart, idStart + 11);
    const next = html.indexOf(marker, idStart);
    const chunk = html.slice(idStart, next === -1 ? idStart + 20000 : Math.min(next, idStart + 20000));
    pos = next;
    if (!isValidVideoId(id) || seen.has(id)) continue;
    seen.add(id);
    const title = /"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/.exec(chunk);
    if (!title) continue;
    const owner = /"(?:ownerText|longBylineText)":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/.exec(chunk);
    const length = /"lengthText":\{(?:"accessibility":\{"accessibilityData":\{"label":"(?:[^"\\]|\\.)*"\}\},)?"simpleText":"([\d:]+)"/.exec(chunk);
    const views = /"viewCountText":\{"simpleText":"([\d.,\s ]+)/.exec(chunk);
    if (!length) continue; // live streams / upcoming
    out.push(result(id, jsonUnescape(title[1]), owner ? jsonUnescape(owner[1]) : '',
      parseClock(length[1]), views ? parseInt(views[1].replace(/\D/g, ''), 10) : null));
  }
  return out;
}

async function searchPage(query, max) {
  const url = 'https://www.youtube.com/results?sp=EgIQAQ%253D%253D&search_query=' + encodeURIComponent(query);
  const res = await fetch(url, { headers: PAGE_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('YouTube search failed (' + res.status + ')');
  return parseResultsPage(await res.text(), max);
}

async function searchApi(key, query, max) {
  const q = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: String(max), q: query, key });
  const res = await fetch('https://www.googleapis.com/youtube/v3/search?' + q, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    // Surface Google's reason (quotaExceeded, keyInvalid, API_KEY_HTTP_REFERRER_BLOCKED...) in the Worker logs.
    let reason = '';
    try { const e = (await res.json()).error || {}; reason = ((e.errors || [])[0] || {}).reason || (e.details || []).map(d => d.reason).filter(Boolean)[0] || e.message || ''; } catch (e) { /* not json */ }
    throw new Error('YouTube API search failed (' + res.status + (reason ? ' ' + reason : '') + ')');
  }
  const data = await res.json();
  const ids = (data.items || []).map(i => i.id && i.id.videoId).filter(isValidVideoId);
  if (!ids.length) return [];
  const v = new URLSearchParams({ part: 'snippet,contentDetails,statistics', id: ids.join(','), key });
  const vres = await fetch('https://www.googleapis.com/youtube/v3/videos?' + v, { signal: AbortSignal.timeout(10000) });
  const vdata = vres.ok ? await vres.json() : { items: [] };
  const byId = new Map((vdata.items || []).map(i => [i.id, i]));
  return ids.map(id => {
    const it = byId.get(id);
    const snip = (it && it.snippet) || ((data.items || []).find(i => i.id.videoId === id) || {}).snippet || {};
    return Object.assign(result(id, snip.title || '', snip.channelTitle || '',
      it ? parseIsoDuration(it.contentDetails && it.contentDetails.duration) : 0,
      it && it.statistics ? it.statistics.viewCount : null), { embeddable: true });
  });
}

// Search like the Go handler: the query gets " karaoke" appended; 20 results; blocked embeds removed.
// Returns {source: 'api' | 'page' | 'none', results}. Empty results are never cached (YouTube now and then serves
// a results page in another layout; one bad page must not break that search for 6 hours).
export async function search(env, query, max = 20) {
  const q = query + ' karaoke';
  const key = 'search2/' + encodeURIComponent(q.toLowerCase().trim());
  const value = await cached(key, SEARCH_TTL, async () => {
    let results = null;
    let source = 'page';
    if (env.YOUTUBE_API_KEY) {
      try {
        results = await searchApi(env.YOUTUBE_API_KEY, q, max);
        source = 'api';
      } catch (e) {
        console.warn('YouTube Data API search failed, falling back to the results page:', e.message);
      }
    }
    if (!results || !results.length) {
      results = await searchPage(q, max);
      if (!results.length) results = await searchPage(q, max); // one retry for an odd page layout
      source = 'page';
    }
    const checks = await Promise.all(results.map(r => (r.embeddable ? true : isEmbeddable(r.video_id))));
    const out = results.filter((r, i) => checks[i] !== false).map(r => { delete r.embeddable; return r; });
    return out.length ? { source, results: out } : undefined; // undefined = don't cache
  });
  return value || { source: 'none', results: [] };
}

/*#endregion*/

/*#region Video info*/

async function infoApi(key, id) {
  const q = new URLSearchParams({ part: 'snippet,contentDetails,status', id, key });
  const res = await fetch('https://www.googleapis.com/youtube/v3/videos?' + q, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const it = ((await res.json()).items || [])[0];
  if (!it) return { notFound: true };
  return {
    id,
    title: it.snippet.title || '',
    channel: it.snippet.channelTitle || '',
    description: it.snippet.description || '',
    duration: parseIsoDuration(it.contentDetails.duration),
    embeddable: it.status ? it.status.embeddable !== false : true
  };
}

function field(html, re) {
  const m = re.exec(html);
  return m ? m[1] : '';
}

async function infoPage(id) {
  const res = await fetch('https://www.youtube.com/watch?v=' + id, { headers: PAGE_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const html = await res.text();
  const start = html.indexOf('"videoDetails":{');
  if (start === -1) return null;
  const vd = html.slice(start, start + 20000);
  const playable = html.indexOf('"playableInEmbed":false') === -1;
  return {
    id,
    title: jsonUnescape(field(vd, /"title":"((?:[^"\\]|\\.)*)"/)),
    channel: jsonUnescape(field(vd, /"author":"((?:[^"\\]|\\.)*)"/)),
    description: jsonUnescape(field(vd, /"shortDescription":"((?:[^"\\]|\\.)*)"/)),
    duration: parseInt(field(vd, /"lengthSeconds":"(\d+)"/), 10) || 0,
    embeddable: playable
  };
}

async function infoOembed(id) {
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`,
    { signal: AbortSignal.timeout(6000) });
  if (res.status === 404 || res.status === 400) return { notFound: true };
  if (res.status === 401 || res.status === 403) return { id, title: '', channel: '', description: '', duration: 0, embeddable: false };
  if (!res.ok) return null;
  const d = await res.json();
  return { id, title: d.title || '', channel: d.author_name || '', description: '', duration: 0, embeddable: true };
}

// {id, title, channel, description, duration, thumbnail, embeddable}; throws when the video does not exist.
export async function videoInfo(env, id) {
  if (!isValidVideoId(id)) throw new Error('Invalid video ID');
  let info = null;
  if (env.YOUTUBE_API_KEY) info = await infoApi(env.YOUTUBE_API_KEY, id).catch(() => null);
  if (!info) info = await infoPage(id).catch(() => null);
  if (!info || !info.title) {
    const o = await infoOembed(id).catch(() => null);
    if (o && !o.notFound) info = Object.assign({}, o, info && info.title ? info : {}, { embeddable: o.embeddable && (!info || info.embeddable) });
    else if (o && o.notFound) info = { notFound: true };
  }
  if (!info || info.notFound) throw new Error('Video not found');
  info.thumbnail = thumbUrl(id);
  return info;
}

export function toSearchResult(info) {
  return result(info.id, info.title, info.channel, info.duration, null);
}

/*#endregion*/
