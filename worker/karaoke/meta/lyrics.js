// Lyrics lookup (port of services/lyrics_search.go + lyrics_lrclib.go).
//
// Three sources, in order of preference: letras.mus.br (best for Brazilian
// music, behind bot protection: skipped for 30 minutes after a 403), LRCLIB and
// lyrics.ovh. FindCandidates asks all of them concurrently and returns up to
// five distinct first-line candidates for the DJ to pick from.
//
// LyricCandidate objects use the Go JSON field names:
//   { source, first_line, excerpt, matched_artist, matched_title, score,
//     sources, previous? }
// plus a NON-enumerable `text` property (Go's `Text`, json:"-"): a cleaned
// lyric sample used only for language detection. JSON.stringify and object
// spread drop it, so it never reaches the API or the stored payload; use
// cloneCandidate() to copy a candidate with it.
//
// Network functions take opts { fetch, sleep, signal, budget } (see lookup.js)
// plus optional overrides: letrasSolrURL, letrasBaseURL, lyricsOvhURL,
// lrclibURL, sourceTimeout (ms, default 8000), letrasDelay (ms, default 400),
// letrasBlockFor (ms, default 30 min).

import {
  splitArtists, primaryArtist, foldAccents, matchWords, nameKey, fields,
} from './normalize.js';
import {
  pairSimilarity, normalizeForMatch, httpGetWithRetry, netOpts, abortError, anySignal,
  transientError, pause, byteLen,
} from './lookup.js';

export { normalizeForMatch };

export const LETRAS_SOLR_URL = 'https://solr.sscdn.co/letras/app2/';
export const LETRAS_BASE_URL = 'https://www.letras.mus.br';
export const LYRICS_OVH_URL = 'https://api.lyrics.ovh/v1';
export const LRCLIB_URL = 'https://lrclib.net/api';
export const LRCLIB_USER_AGENT = 'karaoke-app (self-hosted)';

const SOURCE_TIMEOUT = 8000;
const LETRAS_DELAY = 400;
const LETRAS_BLOCK_FOR = 30 * 60 * 1000;

export const MIN_SOURCE_MATCH = 0.5; // single-result lookups
export const MIN_CANDIDATE = 0.35; // findCandidates floor
export const HITS_PER_SOURCE = 3;
export const MAX_CANDIDATES = 5;
const LETRAS_UNVERIFIED_SCORE = 0.6;
const LYRIC_SAMPLE_MAX = 1200;

// ------------------------------------------------------------------- errors

function codedError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
export const ERR_LETRAS_BLOCKED = 'letras_blocked';
export const ERR_LETRAS_NOT_FOUND = 'letras_not_found';
export const ERR_LYRIC_SOURCES_UNAVAILABLE = 'lyric_sources_unavailable';
const letrasBlockedErr = () => codedError(ERR_LETRAS_BLOCKED, 'letras.mus.br blocked by bot protection');
const letrasNotFoundErr = () => codedError(ERR_LETRAS_NOT_FOUND, 'letras.mus.br page not found');
export const isLetrasBlockedError = (e) => !!e && e.code === ERR_LETRAS_BLOCKED;
export const isLyricSourcesUnavailable = (e) => !!e && e.code === ERR_LYRIC_SOURCES_UNAVAILABLE;

/** isTransientErr: a network/server problem worth retrying later. */
export function isTransientErr(err) {
  if (!err || err.code === ERR_LETRAS_BLOCKED || err.code === ERR_LETRAS_NOT_FOUND) return false;
  if (err.transient || err.name === 'TimeoutError') return true;
  const msg = String(err.message || '');
  return msg.startsWith('status 5') || msg.startsWith('status 429') ||
    msg.includes('returned status 5') || msg.includes('returned status 429');
}

// ------------------------------------------------------- letras block state

// Module-level: an isolate lives for a while and serves many requests, which
// is enough to stop hammering letras.mus.br after a 403.
let letrasBlockedUntil = 0;

export function letrasBlocked() {
  return Date.now() < letrasBlockedUntil;
}
function markLetrasBlocked(blockFor) {
  if (Date.now() < letrasBlockedUntil) return;
  letrasBlockedUntil = Date.now() + blockFor;
}
/** Clears the letras.mus.br 403 skip (tests). */
export function resetLetrasBlock() {
  letrasBlockedUntil = 0;
}

// ------------------------------------------------------------------ helpers

function str(v) {
  return typeof v === 'string' ? v : '';
}

/** Go's url.QueryEscape. */
function queryEscape(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, '+');
}
/** Go's url.PathEscape. */
function pathEscape(s) {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%(24|26|2B|2C|3A|3B|3D|40)/g, (m) => decodeURIComponent(m));
}
/** Go's url.Values.Encode (keys sorted). */
function encodeValues(obj) {
  return Object.keys(obj).sort().map((k) => queryEscape(k) + '=' + queryEscape(obj[k])).join('&');
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„', laquo: '«', raquo: '»',
  bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', deg: '°', iexcl: '¡', iquest: '¿',
  euro: '€', pound: '£', cent: '¢', yen: '¥', sect: '§', para: '¶', times: '×', divide: '÷',
  ordf: 'ª', ordm: 'º', sup1: '¹', sup2: '²', sup3: '³', frac12: '½', frac14: '¼', frac34: '¾',
  acute: '´', uml: '¨', cedil: '¸', macr: '¯', shy: '­', zwj: '‍', zwnj: '‌',
  oelig: 'œ', OElig: 'Œ', scaron: 'š', Scaron: 'Š', yuml: 'ÿ', Yuml: 'Ÿ', szlig: 'ß',
  aelig: 'æ', AElig: 'Æ', oslash: 'ø', Oslash: 'Ø', aring: 'å', Aring: 'Å', eth: 'ð', ETH: 'Ð',
  thorn: 'þ', THORN: 'Þ', ntilde: 'ñ', Ntilde: 'Ñ', ccedil: 'ç', Ccedil: 'Ç',
};
// Accented vowels: &aacute; &Agrave; &ecirc; &otilde; &uuml; ...
const ACCENT_MARKS = { acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈' };
for (const base of 'aeiouyAEIOUY') {
  for (const [name, mark] of Object.entries(ACCENT_MARKS)) {
    const ch = (base + mark).normalize('NFC');
    if (ch.length === 1) NAMED_ENTITIES[base + name] = ch;
  }
}
for (const base of 'nNoOaA') {
  const ch = (base + '̃').normalize('NFC');
  if (ch.length === 1) NAMED_ENTITIES[base + 'tilde'] = ch;
}

/** html.UnescapeString (numeric entities and the common named ones). */
export function unescapeHTML(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});?/g, (m, ent) => {
    if (ent[0] === '#') {
      let cp = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!(cp > 0) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) cp = 0xfffd;
      return String.fromCodePoint(cp);
    }
    const v = NAMED_ENTITIES[ent];
    return v === undefined ? m : v;
  });
}

// --------------------------------------------------------------- matching

/** Artist spellings to query: "A; B" -> ["A & B", "A"]; single artists pass through. */
export function artistForms(artist) {
  const parts = splitArtists(artist);
  if (parts.length <= 1) return parts;
  return [parts.join(' & '), parts[0]];
}

/** How likely a source's artist/title is the requested song (accents folded). */
export function matchScore(forms, title, gotArtist, gotTitle) {
  const t = pairSimilarity(foldAccents(title), foldAccents(gotTitle));
  let a = 0;
  for (const f of forms) {
    const s = pairSimilarity(foldAccents(f), foldAccents(gotArtist));
    if (s > a) a = s;
  }
  return 0.6 * t + 0.4 * a;
}

function sourceOpts(opts) {
  const o = netOpts(opts);
  return {
    ...o,
    letrasSolrURL: o.letrasSolrURL || LETRAS_SOLR_URL,
    letrasBaseURL: o.letrasBaseURL || LETRAS_BASE_URL,
    lyricsOvhURL: o.lyricsOvhURL || LYRICS_OVH_URL,
    lrclibURL: o.lrclibURL || LRCLIB_URL,
    sourceTimeout: o.sourceTimeout ?? SOURCE_TIMEOUT,
    letrasDelay: o.letrasDelay ?? LETRAS_DELAY,
    letrasBlockFor: o.letrasBlockFor ?? LETRAS_BLOCK_FOR,
  };
}

const aborted = (o) => !!(o.signal && o.signal.aborted);

// ------------------------------------------------------------- lyrics.ovh

async function ovhFetch(artist, title, o) {
  const url = `${o.lyricsOvhURL}/${pathEscape(artist)}/${pathEscape(title)}`;
  const { body, status } = await httpGetWithRetry(url, null, 2, o);
  if (status !== 200) throw new Error(`lyrics.ovh returned status ${status}`);
  const result = JSON.parse(body);
  if (str(result && result.error) !== '') throw new Error(`API error: ${result.error}`);
  const lyrics = str(result && result.lyrics);
  if (lyrics.trim() === '') throw new Error('no lyrics in response');
  return lyrics;
}

/** ovhFind queries lyrics.ovh with each artist spelling until one answers. */
export async function ovhFind(artist, title, max, minScore, opts = {}) {
  const o = sourceOpts(opts);
  let lastErr = null;
  for (const form of artistForms(artist)) {
    try {
      const text = await ovhFetch(form, title, o);
      // lyrics.ovh does not echo names; it matched our exact query.
      return [{ source: 'lyrics_ovh', artist: form, title, lyrics: text, score: 0.75 }];
    } catch (err) {
      if (aborted(o)) throw abortError(o.signal);
      lastErr = err;
    }
  }
  throw lastErr || new Error('no artist given');
}

// ---------------------------------------------------------- letras.mus.br

/** letras.mus.br URL segment: accents folded, apostrophes dropped, "&" read as "e". */
export function letrasSlug(s) {
  s = foldAccents(s);
  s = s.replace(/['’`´]/g, '').replace(/&/g, ' e ');
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function letrasHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  };
}

async function letrasSearch(query, o) {
  const url = `${o.letrasSolrURL}?q=${queryEscape(query)}&rows=10`;
  const { body, status } = await httpGetWithRetry(url, letrasHeaders(), 2, o);
  if (status !== 200) throw new Error(`letras.mus.br search API returned status ${status}`);
  let res;
  try {
    res = JSON.parse(body);
  } catch (e) {
    throw new Error(`failed to parse letras.mus.br search response: ${e.message}`);
  }
  const docs = res && res.response && Array.isArray(res.response.docs) ? res.response.docs : [];
  if (docs.length === 0) throw new Error('no results found on letras.mus.br');
  return docs.map((d) => ({ art: str(d && d.art), dns: str(d && d.dns), txt: str(d && d.txt), url: str(d && d.url) }));
}

async function fetchLetrasPage(pageURL, o) {
  const { body, status } = await httpGetWithRetry(pageURL, letrasHeaders(), 2, o);
  if (status === 403 || (status !== 200 && body.includes('Access Denied'))) {
    markLetrasBlocked(o.letrasBlockFor);
    throw letrasBlockedErr();
  }
  if (status === 404) throw letrasNotFoundErr();
  if (status !== 200) throw new Error(`letras.mus.br returned status ${status}`);
  const lyrics = extractLyricsFromLetrasMusBr(body);
  if (lyrics === '') throw new Error('no lyrics found on letras.mus.br');
  const [artist, title] = letrasPageNames(body);
  return { lyrics, artist, title };
}

/**
 * letrasFind tries the direct slug URL for each artist spelling, then falls
 * back to the site's search. Requests are sequential with a small pause.
 */
export async function letrasFind(artist, title, max, minScore, opts = {}) {
  const o = sourceOpts(opts);
  if (letrasBlocked()) throw letrasBlockedErr();
  const forms = artistForms(artist);
  if (forms.length === 0) throw new Error('no artist given');

  const hits = [];
  const tried = new Set();
  let requests = 0;
  const fetchPage = async (pageURL) => {
    if (requests > 0) await pause(o.letrasDelay, o);
    requests++;
    return fetchLetrasPage(pageURL, o);
  };

  // 1. Direct slug.
  const slugTitle = letrasSlug(title);
  for (const form of forms) {
    const slugArtist = letrasSlug(form);
    if (slugArtist === '' || slugTitle === '') continue;
    const pageURL = `${o.letrasBaseURL}/${slugArtist}/${slugTitle}/`;
    if (tried.has(pageURL)) continue;
    tried.add(pageURL);
    let page;
    try {
      page = await fetchPage(pageURL);
    } catch (err) {
      if (aborted(o)) throw abortError(o.signal);
      if (isLetrasBlockedError(err)) throw err;
      continue;
    }
    // A slug can collide with a different song: score the page's own names.
    if (page.artist === '' || page.title === '') {
      return [{ source: 'letras', artist: form, title, lyrics: page.lyrics, score: LETRAS_UNVERIFIED_SCORE }];
    }
    const sc = matchScore(forms, title, page.artist, page.title);
    if (sc >= minScore) {
      return [{ source: 'letras', artist: page.artist, title: page.title, lyrics: page.lyrics, score: sc }];
    }
  }

  // 2. Site search.
  const docs = await letrasSearch(primaryArtist(artist) + ' ' + title, o);
  const cands = [];
  for (const d of docs) {
    const sc = matchScore(forms, title, d.art, d.txt);
    if (sc >= minScore) cands.push({ doc: d, score: sc });
  }
  cands.sort((a, b) => b.score - a.score);
  if (cands.length === 0) throw new Error('no matching song found on letras.mus.br');
  for (const c of cands) {
    if (hits.length >= max) break;
    const pageURL = `${o.letrasBaseURL}/${c.doc.dns}/${c.doc.url}/`;
    if (tried.has(pageURL)) continue;
    tried.add(pageURL);
    let page;
    try {
      page = await fetchPage(pageURL);
    } catch (err) {
      if (isLetrasBlockedError(err) || aborted(o)) {
        if (hits.length > 0) break;
        if (aborted(o)) throw abortError(o.signal);
        throw err;
      }
      continue;
    }
    hits.push({ source: 'letras', artist: c.doc.art, title: c.doc.txt, lyrics: page.lyrics, score: c.score });
  }
  if (hits.length === 0) throw new Error('no lyrics found on letras.mus.br');
  return hits;
}

const LETRAS_SITE_SUFFIX = /\s*[-–|]\s*letras(\.mus\.br)?\s*$/i;
const HTML_TAG_RE = /<[^>]*>/g;

/** First match of `<tag ...>(...)</tag>` (case-insensitive), bounded with indexOf. */
function firstElementText(page, lower, tag) {
  let from = 0;
  for (;;) {
    const i = lower.indexOf('<' + tag, from);
    if (i < 0) return null;
    const re = new RegExp(`<${tag}[^>]*>`, 'iy');
    re.lastIndex = i;
    const m = re.exec(page);
    if (m) {
      const start = i + m[0].length;
      const end = lower.indexOf(`</${tag}>`, start);
      if (end < 0) return null;
      return page.slice(start, end);
    }
    from = i + 1;
  }
}

/** Lowercases ASCII only, keeping string indexes aligned with the original. */
function asciiLower(s) {
  return s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

/**
 * letrasPageNames reads the song title and artist a lyric page shows. The page
 * title is "<Song> - <Artist> - LETRAS.MUS.BR"; the <h1> holds the song title
 * and wins when present. Returns [artist, title] ("" when unreadable).
 */
export function letrasPageNames(page) {
  let artist = '';
  let title = '';
  const lower = asciiLower(page);
  const t0 = firstElementText(page, lower, 'title');
  if (t0 !== null) {
    let t = unescapeHTML(t0.replace(HTML_TAG_RE, '')).trim();
    t = t.replace(LETRAS_SITE_SUFFIX, '');
    const i = t.lastIndexOf(' - ');
    if (i > 0) {
      title = t.slice(0, i).trim();
      artist = t.slice(i + 3).trim();
    }
  }
  const h0 = firstElementText(page, lower, 'h1');
  if (h0 !== null) {
    const h = unescapeHTML(h0.replace(HTML_TAG_RE, '')).trim();
    if (h !== '') title = h;
  }
  if (artist === '') title = '';
  return [artist, title];
}

const BOILERPLATE_KEYWORDS = [
  'letras.mus.br', 'cookie', 'publicidade', 'anuncie', 'política de privacidade',
  'todos os direitos', 'copyright', 'newsletter', 'cifra club', 'compositor',
];

function looksLikeBoilerplate(text) {
  const lower = text.toLowerCase();
  return BOILERPLATE_KEYWORDS.some((kw) => lower.includes(kw));
}

/** cleanHTMLLyrics removes HTML tags and tidies lyric text. */
export function cleanHTMLLyrics(s) {
  s = s.replace(/<br\s*\/?>|<\/p>/gi, '\n');
  s = s.replace(HTML_TAG_RE, '');
  s = unescapeHTML(s);
  s = s.replaceAll(' ', ' ');
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n[\t\n\f\r ]*\n/g, '\n');
  return s.trim();
}

/**
 * Content of the first `<div ... class="...cls...">` up to the first `</div>`
 * (the Go regex), located with indexOf so big pages cost little CPU.
 */
function divContentByClass(page, cls) {
  const tagRe = new RegExp(`<div[^>]*class="[^"]*${cls}[^"]*"[^>]*>`, 'y');
  let from = 0;
  for (;;) {
    const i = page.indexOf(cls, from);
    if (i < 0) return null;
    const start = page.lastIndexOf('<div', i);
    if (start >= 0) {
      tagRe.lastIndex = start;
      const m = tagRe.exec(page);
      if (m && start + m[0].length > i) {
        const cStart = start + m[0].length;
        const end = page.indexOf('</div>', cStart);
        if (end < 0) return null;
        return page.slice(cStart, end);
      }
    }
    from = i + 1;
  }
}

/** extractLyricsFromLetrasMusBr parses lyrics from letras.mus.br HTML. */
export function extractLyricsFromLetrasMusBr(page) {
  page = String(page);
  // Preferred: the lyrics container (current and older class names).
  for (const cls of ['lyric-original', 'cnt-letra']) {
    const inner = divContentByClass(page, cls);
    if (inner !== null) {
      const lyrics = cleanHTMLLyrics(inner);
      if (lyrics !== '' && !looksLikeBoilerplate(lyrics)) return lyrics;
    }
  }
  // Fallback: scan up to 50 <p> tags, skipping site chrome.
  const lines = [];
  const tagRe = /<p[^>]*>/y;
  let from = 0;
  for (let n = 0; n < 50; n++) {
    const i = page.indexOf('<p', from);
    if (i < 0) break;
    tagRe.lastIndex = i;
    const m = tagRe.exec(page);
    if (!m) break; // no '>' left
    const cStart = i + m[0].length;
    const end = page.indexOf('</p>', cStart);
    if (end < 0) break;
    from = end + 4;
    const text = cleanHTMLLyrics(page.slice(cStart, end));
    if (looksLikeBoilerplate(text)) continue;
    if (byteLen(text) > 5) {
      lines.push(text);
      if (lines.length >= 10) break;
    }
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------- LRCLIB

const LRC_TIMESTAMP_RE = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g;

function trackLyrics(t) {
  if (typeof t.plainLyrics === 'string' && t.plainLyrics.trim() !== '') return t.plainLyrics;
  if (typeof t.syncedLyrics === 'string' && t.syncedLyrics.trim() !== '') return t.syncedLyrics.replace(LRC_TIMESTAMP_RE, '');
  return '';
}

/** Resolves to the parsed body, or null on 404. */
async function lrclibGet(endpoint, query, wantArray, o) {
  const url = o.lrclibURL + endpoint + '?' + encodeValues(query);
  const { body, status } = await httpGetWithRetry(url, { 'User-Agent': LRCLIB_USER_AGENT }, 2, o);
  if (status === 404) return null;
  if (status !== 200) throw new Error(`lrclib returned status ${status}`);
  let v;
  try {
    v = JSON.parse(body);
  } catch (e) {
    throw new Error(`lrclib: bad response: ${e.message}`);
  }
  if (v === null) return wantArray ? [] : {};
  if (Array.isArray(v) !== wantArray || typeof v !== 'object') throw new Error('lrclib: bad response: unexpected JSON type');
  return v;
}

/**
 * lrclibFind looks the song up exactly (/get) for each artist spelling, then
 * widens to /search, returning up to max non-instrumental hits >= minScore.
 */
export async function lrclibFind(artist, title, max, minScore, opts = {}) {
  const o = sourceOpts(opts);
  const forms = artistForms(artist);
  if (forms.length === 0) throw new Error('no artist given');
  const tracks = [];
  let firstErr = null;
  const get = async (endpoint, q, wantArray) => {
    try {
      return await lrclibGet(endpoint, q, wantArray, o);
    } catch (err) {
      if (aborted(o)) throw abortError(o.signal);
      if (!firstErr) firstErr = err;
      return null;
    }
  };

  for (const form of forms) {
    const t = await get('/get', { artist_name: form, track_name: title }, false);
    if (aborted(o)) throw abortError(o.signal);
    if (t) {
      tracks.push(t);
      break;
    }
  }
  if (tracks.length < max) {
    for (const form of forms) {
      const found = (await get('/search', { track_name: title, artist_name: form }, true)) || [];
      if (aborted(o)) throw abortError(o.signal);
      tracks.push(...found);
      if (found.length > 0) break;
    }
  }

  let hits = [];
  const seen = new Set();
  for (const t of tracks) {
    if (!t || typeof t !== 'object') continue;
    const id = typeof t.id === 'number' ? t.id : 0;
    if (t.instrumental === true || (id !== 0 && seen.has(id))) continue;
    seen.add(id);
    const text = trackLyrics(t);
    if (text === '') continue;
    const score = matchScore(forms, title, str(t.artistName), str(t.trackName));
    if (score < minScore) continue;
    hits.push({ source: 'lrclib', artist: str(t.artistName), title: str(t.trackName), lyrics: text, score });
  }
  hits.sort((a, b) => b.score - a.score);
  if (hits.length > max) hits = hits.slice(0, max);
  if (hits.length === 0) throw firstErr || new Error('no lyrics found on lrclib');
  return hits;
}

// --------------------------------------------------------- first-line rules

const BRACKET_TAG_RE = /^\[[^\]]*\]:?$/;
const PAREN_TAG_RE = /^\(\s*(intro(du[cç][aã]o)?|verses?|verso|estrofe|chorus|refr[aã]o|coro|bridge|ponte|pre-?\s?chorus|pr[eé]-?\s?refr[aã]o|outro|hook|instrumental|solo|interl[uú]dio|refrain|couplet|x\s?\d+|\d+\s?x|bis|repete)(\s*\d+)?\s*\)$/i;
const WORD_TAG_RE = /^(intro|verses?|chorus|refr[aã]o|bridge|ponte|pre-?\s?chorus|outro|hook|instrumental|estrofe|coro)(\s*\d+)?\s*:$/i;
const CREDIT_RE = /^\s*(composi[cç][aã]o\s*:|compositor(es)?\s*:|autor(es)?\s*:|letra\s+de\b|letra\s+e\s+m[uú]sica|letra\s*:|m[uú]sica\s*:|lyrics?\s*(by|:|provided|courtesy|licen[cs]ed)|written\s+by|composed\s+by|songwriters?\s*:|composers?\s*:|escrit[ao]\s+por|tradu[cç][aã]o|translations?\b|translated\s+by|traduzido|contributed\s+by|enviad[ao]\s+por|letra\s+enviada|paroles\s+de|source\s*:|fonte\s*:|produced\s+by|produ[cç][aã]o\s*:|©|copyright|\(c\)|\d+\s+contribut)/i;
const BANNER_RE = /^\s*\d+\s+(translations?|traduç(ão|ões))\b|\bcontribut(or|ors|ion|ions)\b|\bcontribuidor|\bread more\b|\bsee .* lyrics\b/i;
const INTERJECTION_RE = /^(o{2,}h*|o+h+|a+h+|u+h+|m{2,}|h+m+|l+a+|n+a+|d+a+|b+a+|d+o+|w+h?o+a?h*|w+o+|y+e+a*h*|e+h+|h+e+y+|a+y+|o+h+o+|ei|ey|yo|woah|whoa)$/;
const TRAIL_NOISE_RE = /[\t\n\f\r ,;:.…\-–—/]+$/;
const LEAD_NOISE_RE = /^[\t\n\f\r \-–—•*]+/;
const TITLE_SUFF_RE = /\s+(lyrics?|letras?|paroles)\s*$/i;

const isSectionTag = (line) => BRACKET_TAG_RE.test(line) || PAREN_TAG_RE.test(line) || WORD_TAG_RE.test(line);
const isCreditLine = (line) => CREDIT_RE.test(line) || BANNER_RE.test(line);

function isInterjection(line) {
  const words = fields(matchWords(line));
  if (words.length === 0) return false;
  return words.every((w) => INTERJECTION_RE.test(w));
}

function tidyLine(line) {
  line = fields(line).join(' ');
  line = line.replace(LEAD_NOISE_RE, '');
  line = line.replace(TRAIL_NOISE_RE, '');
  return line.trim();
}

/**
 * cleanLyricLines returns the tidy, non-blank lyric lines of text without
 * section tags, credits/banners, or lines that merely repeat title/artist.
 */
export function cleanLyricLines(text, title = '', artist = '') {
  const skipKeys = new Set();
  for (const s of [artist, artist + ' ' + title, title + ' ' + artist]) {
    const k = nameKey(s);
    if (k !== '') skipKeys.add(k);
  }
  const out = [];
  for (const raw of String(text).replaceAll('\r', '').split('\n')) {
    let line = raw.trim();
    if (line === '' || isSectionTag(line) || isCreditLine(line)) continue;
    const key = nameKey(line);
    if (key === '' || skipKeys.has(key)) continue;
    const stripped = line.replace(TITLE_SUFF_RE, '');
    if (stripped !== line) {
      const sk = nameKey(stripped);
      if (sk === nameKey(title) || skipKeys.has(sk)) continue;
    }
    line = tidyLine(line);
    if (line !== '') out.push(line);
  }
  return out;
}

function firstSungIndex(lines) {
  outer: for (let i = 0; i < lines.length; i++) {
    if (!isInterjection(lines[i])) return i;
    for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
      if (!isInterjection(lines[j])) continue outer;
    }
    return i; // nothing real close by: the interjection is the first line
  }
  return -1;
}

/** firstSungLine returns the cleaned first sung line of text ("" when none). */
export function firstSungLine(text, title = '', artist = '') {
  const lines = cleanLyricLines(text, title, artist);
  const i = firstSungIndex(lines);
  return i >= 0 ? lines[i] : '';
}

/** firstSungExcerpt returns [first, excerpt]: the first line plus following lines, up to n. */
export function firstSungExcerpt(text, title = '', artist = '', n = 4) {
  const lines = cleanLyricLines(text, title, artist);
  const i = firstSungIndex(lines);
  if (i < 0) return ['', ''];
  return [lines[i], lines.slice(i, Math.min(i + n, lines.length)).join('\n')];
}

/** truncateFirstLine shortens long lines at a word boundary (about 80 chars). */
export function truncateFirstLine(s) {
  s = String(s).trim();
  const r = Array.from(s);
  if (r.length > 80) {
    const cut = r.slice(0, 80).join('');
    const idx = cut.lastIndexOf(' ');
    if (idx >= 0 && byteLen(cut.slice(0, idx)) > 50) return cut.slice(0, idx) + '...';
    return r.slice(0, 77).join('') + '...';
  }
  return s;
}

/** extractFirstVerse extracts the first meaningful line from full lyrics. */
export function extractFirstVerse(fullLyrics) {
  return truncateFirstLine(firstSungLine(fullLyrics, '', ''));
}

function lyricSample(text, title, artist) {
  let out = '';
  let size = 0;
  for (const l of cleanLyricLines(text, title, artist)) {
    const n = byteLen(l);
    if (size + n + 1 > LYRIC_SAMPLE_MAX) break;
    out += l + '\n';
    size += n + 1;
  }
  return out.trim();
}

// ---------------------------------------------------------------- sources

const SOURCES = [
  { name: 'letras', find: letrasFind },
  { name: 'lrclib', find: lrclibFind },
  { name: 'lyrics_ovh', find: ovhFind },
];

/** cleanArtistTitle drops featuring credits and bracketed info. Returns [artist, title]. */
export function cleanArtistTitle(artist, title) {
  const feat = /\s*(feat\.?|ft\.?|featuring)\s+.*$/i;
  artist = String(artist).replace(feat, '');
  title = String(title).replace(feat, '');
  title = title.replace(/\s*\([^)]*\)\s*/g, ' ');
  title = title.replace(/\s*\[[^\]]*\]\s*/g, ' ');
  return [artist.trim(), title.trim()];
}

async function firstLineFrom(src, artist, title, o) {
  const hits = await src.find(artist, title, 1, MIN_SOURCE_MATCH, o);
  for (const h of hits) {
    const line = firstSungLine(h.lyrics, h.title, h.artist);
    if (line !== '') return truncateFirstLine(line);
  }
  throw new Error(`no lyrics found on ${src.name}`);
}

/**
 * searchLyrics returns the first verse of a song, trying the sources in order
 * of preference. Throws when no source has it.
 */
export async function searchLyrics(artist, title, opts = {}) {
  if (!artist || !title) throw new Error('artist and title are required');
  const o = sourceOpts(opts);
  const [cleanArtist, cleanTitle] = cleanArtistTitle(artist, title);
  for (const src of SOURCES) {
    try {
      const line = await firstLineFrom(src, cleanArtist, cleanTitle, o);
      if (line !== '') return line;
    } catch (err) {
      if (aborted(o)) throw abortError(o.signal);
    }
  }
  throw new Error('no lyrics found from any source');
}

/** searchLyricsFrom runs one named source ('letras' | 'lrclib' | 'lyrics_ovh') like searchLyrics. */
export async function searchLyricsFrom(name, artist, title, opts = {}) {
  const src = SOURCES.find((s) => s.name === name);
  if (!src) throw new Error(`unknown source ${name}`);
  return firstLineFrom(src, artist, title, sourceOpts(opts));
}

// ------------------------------------------------------------- candidates

/** Copies a candidate, keeping its non-enumerable `text`. */
export function cloneCandidate(c, extra = {}) {
  const out = { ...c, ...extra };
  if (Array.isArray(out.sources)) out.sources = [...out.sources];
  setText(out, extra.text !== undefined ? extra.text : c.text || '');
  return out;
}

export function setText(c, text) {
  Object.defineProperty(c, 'text', { value: text || '', enumerable: false, writable: true, configurable: true });
  return c;
}

/**
 * findAgreeingKey finds an existing first line that is the same sentence broken
 * differently (one's words start with the other's, at least three words).
 * byKey is a Map key -> index. Returns the index or -1.
 */
export function findAgreeingKey(byKey, key) {
  for (const [k, idx] of byKey) {
    let short = k;
    let long = key;
    if (short.length > long.length) [short, long] = [long, short];
    if (short.split(' ').length - 1 >= 2 && long.startsWith(short + ' ')) return idx;
  }
  return -1;
}

async function runSource(src, artist, title, o) {
  const ctrl = new AbortController();
  const signal = anySignal([o.signal, ctrl.signal]);
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      const err = transientError('context deadline exceeded');
      ctrl.abort(err);
      resolve({ hits: null, err });
    }, o.sourceTimeout);
  });
  const run = src.find(artist, title, HITS_PER_SOURCE, MIN_CANDIDATE, { ...o, signal })
    .then((hits) => ({ hits, err: null }), (err) => ({ hits: null, err }));
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function findCandidatesImpl(artist, title, opts) {
  if (String(artist || '').trim() === '' || String(title || '').trim() === '') throw new Error('artist and title are required');
  const o = sourceOpts(opts);
  if (aborted(o)) throw abortError(o.signal);
  const [cleanArtist, cleanTitle] = cleanArtistTitle(artist, title);
  if (cleanArtist === '' || cleanTitle === '') throw new Error('artist and title are required');

  let onAbort;
  const abortP = new Promise((_, reject) => {
    if (o.signal) {
      onAbort = () => reject(abortError(o.signal));
      o.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  abortP.catch(() => {});
  let results;
  try {
    results = await Promise.race([Promise.all(SOURCES.map((src) => runSource(src, cleanArtist, cleanTitle, o))), abortP]);
  } finally {
    if (o.signal && onAbort) o.signal.removeEventListener('abort', onAbort);
  }
  if (aborted(o)) throw abortError(o.signal);

  const cands = [];
  const byKey = new Map();
  let unavailable = 0;
  for (const r of results) {
    if (r.err) {
      if (isTransientErr(r.err)) unavailable++;
      continue;
    }
    for (const h of r.hits || []) {
      const [first, excerpt] = firstSungExcerpt(h.lyrics, cleanTitle, cleanArtist, 4);
      if (first === '') continue;
      const c = setText({
        source: h.source,
        first_line: truncateFirstLine(first),
        excerpt,
        matched_artist: h.artist,
        matched_title: h.title,
        score: h.score,
        sources: [h.source],
      }, lyricSample(h.lyrics, cleanTitle, cleanArtist));
      const key = matchWords(first);
      let idx = byKey.has(key) ? byKey.get(key) : findAgreeingKey(byKey, key);
      if (idx >= 0) {
        const ex = cands[idx];
        if (!ex.sources.includes(h.source)) ex.sources.push(h.source);
        if (c.score > ex.score) { // keep the best-scored representative
          c.sources = ex.sources;
          cands[idx] = c;
        }
        continue;
      }
      byKey.set(key, cands.length);
      cands.push(c);
    }
  }
  cands.sort((a, b) => (b.sources.length - a.sources.length) || (b.score - a.score));
  return { cands: cands.slice(0, MAX_CANDIDATES), unavailable };
}

/**
 * findCandidates asks every source concurrently (each bounded by
 * sourceTimeout) and resolves to up to five distinct first-line candidates,
 * ranked by agreement then score. Failing sources are skipped; [] means
 * nothing found. Throws only for missing input or when opts.signal ends.
 */
export async function findCandidates(artist, title, opts = {}) {
  return (await findCandidatesImpl(artist, title, opts)).cands;
}

/**
 * findCandidatesStrict is findCandidates that throws an error with code
 * 'lyric_sources_unavailable' when it found nothing and at least one source
 * failed transiently (offline, timeout, rate limit, server error).
 */
export async function findCandidatesStrict(artist, title, opts = {}) {
  const { cands, unavailable } = await findCandidatesImpl(artist, title, opts);
  if (cands.length === 0 && unavailable > 0) {
    throw codedError(ERR_LYRIC_SOURCES_UNAVAILABLE, 'lyric sources unavailable');
  }
  return cands;
}
