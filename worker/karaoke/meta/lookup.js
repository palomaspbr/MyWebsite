// Online metadata lookup (port of services/metadata_lookup.go + httpclient.go).
//
// Resolves canonical artist/title from online music catalogs: the iTunes
// Search API first (fast, no key), then MusicBrainz (canonical, rate-limited,
// needs a descriptive User-Agent). A heuristic guess is only a search seed;
// the catalog's canonical result wins when it confidently matches the seed.
//
// Match objects ("MetadataMatch"): the Go struct has no JSON tags, so the JS
// objects use camelCase field names:
//   { artist, title, source: 'itunes' | 'musicbrainz', confidence }
//
// Every network function takes opts:
//   { fetch = globalThis.fetch, sleep = ms => Promise, signal, budget }
// `budget` ({ left: n }) is an optional shared subrequest counter (Cloudflare
// Workers allow 50 subrequests per request); when it runs out, requests fail
// fast with a transient error instead of being sent.

import {
  isKaraokeSource, isKaraokeRelease, matchWords, nameKey, containsPhrase,
  normalizeArtistSeparators, addFeaturedArtists, toTitleCase, utf8Len,
} from './normalize.js';
import { TitleParser, titleTrigrams } from './title_parser.js';

export const ITUNES_URL = 'https://itunes.apple.com/search';
export const MUSICBRAINZ_URL = 'https://musicbrainz.org/ws/2/recording';
export const MB_USER_AGENT = 'karaoke-app/1.0 ( https://github.com/LuanGBR/karaoke )';

// Acceptance gate when both artist and title seeds are present.
export const MIN_CONFIDENCE = 0.55;
// Stricter gate when only one seed field is known.
export const MIN_CONFIDENCE_PARTIAL = 0.62;
// Raw-title matches are accepted on whole-phrase containment.
const RAW_TITLE_CONFIDENCE = 0.8;
// Lowest score a catalog result needs to be offered as a review option.
export const MIN_NAME_CANDIDATE = 0.45;

const ARTIST_SEPARATOR = '; ';
const FETCH_TIMEOUT_MS = 8000;

// ------------------------------------------------------------------ helpers

/** Byte length of s in UTF-8 (Go's len(string)). */
export const byteLen = utf8Len;

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Normalised options with defaults. */
export function netOpts(opts = {}) {
  return {
    ...opts,
    fetch: opts.fetch || globalThis.fetch.bind(globalThis),
    sleep: opts.sleep || defaultSleep,
    signal: opts.signal,
    budget: opts.budget,
  };
}

/** An Error marked as a transient (retry-later) network/server problem. */
export function transientError(message, cause) {
  const e = new Error(message);
  e.transient = true;
  if (cause) e.cause = cause;
  return e;
}

/** The error to throw when the caller's signal ended (Go's ctx.Err()). */
export function abortError(signal) {
  const r = signal && signal.reason;
  if (r instanceof Error) return r;
  const e = new Error('context canceled');
  e.name = 'AbortError';
  return e;
}

/** A signal that ends when any of the given signals ends. */
export function anySignal(signals) {
  const list = signals.filter(Boolean);
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(list);
  const ctrl = new AbortController();
  for (const s of list) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(transientError('timeout')), ms);
  return ctrl.signal;
}

/** Sleeps ms (via opts.sleep) unless the signal ends first; throws then. */
export async function pause(ms, o) {
  if (o.signal && o.signal.aborted) throw abortError(o.signal);
  if (ms > 0) await o.sleep(ms);
  if (o.signal && o.signal.aborted) throw abortError(o.signal);
}

/**
 * httpGetWithRetry performs a GET with small linear backoff (300 ms, 600 ms,
 * ...), retrying only on transient failures: network errors, timeouts, HTTP
 * 429 and 5xx. Other statuses are returned at once. Resolves to
 * { body, status }; throws when every attempt failed to produce a response
 * (the error has `transient: true` for network/server problems) or when
 * opts.signal ended. Each attempt is bounded by an 8 s timeout and counts
 * against opts.budget.
 */
export async function httpGetWithRetry(url, headers, attempts, opts = {}) {
  const o = netOpts(opts);
  if (!(attempts >= 1)) attempts = 1;
  let lastErr = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await pause(attempt * 300, o);
    if (o.signal && o.signal.aborted) throw abortError(o.signal);
    if (o.budget) {
      if (o.budget.left <= 0) {
        lastErr = lastErr || transientError('subrequest budget exhausted');
        break;
      }
      o.budget.left--;
    }
    let resp;
    let body;
    try {
      resp = await o.fetch(url, {
        method: 'GET',
        headers: headers || {},
        signal: anySignal([o.signal, timeoutSignal(FETCH_TIMEOUT_MS)]),
      });
      body = await resp.text();
    } catch (err) {
      if (o.signal && o.signal.aborted) throw abortError(o.signal);
      lastErr = transientError(err && err.message ? err.message : String(err), err);
      continue;
    }
    if (resp.status === 429 || resp.status >= 500) {
      lastErr = transientError(`status ${resp.status}`);
      continue;
    }
    return { body, status: resp.status };
  }
  throw lastErr || new Error(`request failed after ${attempts} attempts`);
}

// --------------------------------------------------------------- similarity

const PUNCT_RE = /[,!?.'"\-:;()[\]{}]+/g;
const WS_RE = /[\t\n\f\r ]+/g;

/** normalizeForMatch removes punctuation and extra spaces for matching. */
export function normalizeForMatch(s) {
  s = String(s).replace(PUNCT_RE, ' ');
  s = s.replace(WS_RE, ' ');
  return s.toLowerCase().trim();
}

function gramSet(grams) {
  if (grams instanceof Set) return grams;
  if (grams instanceof Map) return new Set([...grams.keys()].filter((k) => grams.get(k)));
  if (Array.isArray(grams)) return new Set(grams);
  return new Set(Object.keys(grams || {}).filter((k) => grams[k]));
}

/** Dice coefficient over the trigram sets of a and b (symmetric). */
export function diceTrigram(a, b) {
  const ga = gramSet(titleTrigrams(a));
  const gb = gramSet(titleTrigrams(b));
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return (2 * inter) / (ga.size + gb.size);
}

/**
 * pairSimilarity returns a 0..1 similarity: exact match after normalisation,
 * substring containment (0.9), then trigram Dice.
 */
export function pairSimilarity(a, b) {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (na === '' || nb === '') return 0;
  if (na === nb) return 1.0;
  if (byteLen(na) >= 4 && byteLen(nb) >= 4 && (na.includes(nb) || nb.includes(na))) return 0.9;
  return diceTrigram(na, nb);
}

/**
 * scoreResult rates how well a catalog result matches the seed. With both seed
 * fields it also tries the swapped orientation.
 */
export function scoreResult(candArtist, candTitle, resArtist, resTitle) {
  if (candArtist !== '' && candTitle !== '') {
    const straight = 0.6 * pairSimilarity(candTitle, resTitle) + 0.4 * pairSimilarity(candArtist, resArtist);
    const swapped = 0.6 * pairSimilarity(candArtist, resTitle) + 0.4 * pairSimilarity(candTitle, resArtist);
    return Math.max(straight, swapped);
  }
  const seed = candTitle === '' ? candArtist : candTitle;
  return pairSimilarity(seed, resTitle);
}

/** accepted applies the confidence gate (stricter with a single seed field). */
export function accepted(score, candArtist, candTitle) {
  if (!candArtist || !candTitle) return score >= MIN_CONFIDENCE_PARTIAL;
  return score >= MIN_CONFIDENCE;
}

// ----------------------------------------------------------------- sources

function buildQuery(candArtist, candTitle, rawTitle) {
  const q = `${candArtist} ${candTitle}`.trim();
  if (q !== '') return q;
  return new TitleParser().cleanTitle(rawTitle || '').trim();
}

function sortMatches(ms) {
  // Array.prototype.sort is stable.
  ms.sort((a, b) => b.confidence - a.confidence);
  return ms;
}

function bestAccepted(ms, candArtist, candTitle) {
  if (!ms || ms.length === 0 || ms[0].confidence <= 0 || !accepted(ms[0].confidence, candArtist, candTitle)) return null;
  return { ...ms[0] };
}

function log(...args) {
  if (typeof console !== 'undefined' && globalThis.KARAOKE_META_DEBUG) console.log(...args);
}

async function searchITunes(query, o) {
  const params = new URLSearchParams();
  params.set('entity', 'song');
  params.set('limit', '8');
  params.set('term', query);
  const url = (o.itunesURL || ITUNES_URL) + '?' + params.toString();
  let res;
  try {
    res = await httpGetWithRetry(url, null, 3, o);
  } catch (err) {
    log('[MetadataLookup] iTunes request failed:', err.message);
    return { resp: null, err };
  }
  if (res.status !== 200) return { resp: null, err: new Error(`iTunes returned status ${res.status}`) };
  try {
    return { resp: JSON.parse(res.body), err: null };
  } catch (e) {
    return { resp: null, err: new Error(`iTunes: bad response: ${e.message}`) };
  }
}

function str(v) {
  return typeof v === 'string' ? v : '';
}

function scoreITunes(resp, candArtist, candTitle) {
  if (!resp) return [];
  const out = [];
  for (const r of Array.isArray(resp.results) ? resp.results : []) {
    const track = str(r && r.trackName);
    const artist = str(r && r.artistName);
    if (track === '' || artist === '' || isKaraokeRelease(artist, track)) continue;
    out.push({ artist, title: track, source: 'itunes', confidence: scoreResult(candArtist, candTitle, artist, track) });
  }
  return sortMatches(out);
}

const CREDIT_SPLIT_RE = /\s*(?:;|,|&|\bfeat\.?|\bft\.|\bwith\b)\s*/i;
const BRACKETED_RE = /\s*[([][^)\]]*[)\]]/g;

async function lookupITunesByRawTitle(rawTitle, o) {
  const cleaned = new TitleParser().cleanTitle(rawTitle || '');
  const query = matchWords(cleaned);
  if (query === '') return null;
  const { resp } = await searchITunes(query, o);
  if (!resp) return null;
  for (const r of Array.isArray(resp.results) ? resp.results : []) {
    const track = str(r && r.trackName);
    const artistName = str(r && r.artistName);
    if (track === '' || artistName === '' || isKaraokeRelease(artistName, track)) continue;
    const lead = artistName.split(CREDIT_SPLIT_RE)[0].trim();
    const title = track.replace(BRACKETED_RE, '').trim();
    if (nameKey(title).length < 3 || !containsPhrase(cleaned, lead) || !containsPhrase(cleaned, title)) continue;
    return { artist: artistName, title: track, source: 'itunes', confidence: RAW_TITLE_CONFIDENCE };
  }
  return null;
}

function escapeLucene(s) {
  return s.replace(/[\\"+\-!(){}[\]^~*?:&|]/g, (c) => '\\' + c);
}

function joinArtistCredit(credit) {
  return credit.map((c) => str(c && c.name)).filter((n) => n !== '').join(ARTIST_SEPARATOR);
}

async function scoreMusicBrainz(candArtist, candTitle, query, o) {
  const lucene = candArtist !== '' && candTitle !== ''
    ? `recording:"${escapeLucene(candTitle)}" AND artist:"${escapeLucene(candArtist)}"`
    : query;
  const params = new URLSearchParams();
  params.set('fmt', 'json');
  params.set('limit', '8');
  params.set('query', lucene);
  const url = (o.musicBrainzURL || MUSICBRAINZ_URL) + '?' + params.toString();
  let res;
  try {
    res = await httpGetWithRetry(url, { 'User-Agent': o.mbUserAgent || MB_USER_AGENT }, 2, o);
  } catch (err) {
    log('[MetadataLookup] MusicBrainz request failed:', err.message);
    return { ms: [], err };
  }
  if (res.status !== 200) return { ms: [], err: new Error(`MusicBrainz returned status ${res.status}`) };
  let resp;
  try {
    resp = JSON.parse(res.body);
  } catch (e) {
    return { ms: [], err: new Error(`MusicBrainz: bad response: ${e.message}`) };
  }
  const out = [];
  for (const rec of Array.isArray(resp && resp.recordings) ? resp.recordings : []) {
    const title = str(rec && rec.title);
    const credit = Array.isArray(rec && rec['artist-credit']) ? rec['artist-credit'] : [];
    if (title === '' || credit.length === 0) continue;
    const artist = joinArtistCredit(credit);
    if (isKaraokeRelease(artist, title)) continue;
    out.push({ artist, title, source: 'musicbrainz', confidence: scoreResult(candArtist, candTitle, artist, title) });
  }
  return { ms: sortMatches(out), err: null };
}

// ------------------------------------------------------------------ public

/**
 * refine looks up canonical artist/title for a seed guess. Resolves to the
 * match only when a catalog result confidently matches the seed, else null.
 */
export async function refine(candArtist, candTitle, rawTitle, opts = {}) {
  const o = netOpts(opts);
  candArtist = candArtist || '';
  candTitle = candTitle || '';
  if (isKaraokeSource(candArtist)) candArtist = '';

  const query = buildQuery(candArtist, candTitle, rawTitle);
  if (query !== '') {
    const { resp } = await searchITunes(query, o);
    let match = bestAccepted(scoreITunes(resp, candArtist, candTitle), candArtist, candTitle);
    if (match) return match;
    const { ms } = await scoreMusicBrainz(candArtist, candTitle, query, o);
    match = bestAccepted(ms, candArtist, candTitle);
    if (match) return match;
  }
  // The seed may be wrong: search with the cleaned YouTube title, accepting
  // only a result whose artist and title both appear in it.
  return lookupITunesByRawTitle(rawTitle, o);
}

/**
 * candidates returns the scored catalog matches for a seed, best first: up to
 * perSource results each from iTunes and MusicBrainz (plus an iTunes search by
 * the cleaned YouTube title when the seed finds nothing there), with names
 * normalised the way the catalog stores them. Throws only when nothing was
 * found and a source could not be reached.
 */
export async function candidates(candArtist, candTitle, rawTitle, perSource, opts = {}) {
  const o = netOpts(opts);
  candArtist = candArtist || '';
  candTitle = candTitle || '';
  if (isKaraokeSource(candArtist)) candArtist = '';
  const out = [];
  let firstErr = null;
  const keep = (ms, err) => {
    if (err && !firstErr) firstErr = err;
    let n = 0;
    for (const mm of ms || []) {
      if (n >= perSource || mm.confidence < MIN_NAME_CANDIDATE) break;
      const [artist, title] = catalogNames(mm.artist, mm.title);
      out.push({ ...mm, artist, title });
      n++;
    }
  };

  let itunesFound = false;
  const query = buildQuery(candArtist, candTitle, rawTitle);
  if (query !== '') {
    const { resp, err } = await searchITunes(query, o);
    const ms = scoreITunes(resp, candArtist, candTitle);
    itunesFound = ms.length > 0 && ms[0].confidence >= MIN_NAME_CANDIDATE;
    keep(ms, err);
    const mb = await scoreMusicBrainz(candArtist, candTitle, query, o);
    keep(mb.ms, mb.err);
  }
  if (!itunesFound && rawTitle && !(o.signal && o.signal.aborted)) {
    const mm = await lookupITunesByRawTitle(rawTitle, o);
    if (mm) keep([mm], null);
  }
  sortMatches(out);
  if (out.length === 0 && firstErr) throw firstErr;
  return out;
}

const FEAT_SPLIT_RE = /\s+(?:feat\.?|ft\.?|featuring)\s+/i;
const TITLE_FEAT_RE = /\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)\]]+)[)\]]/i;
const FEAT_LIST_RE = /\s*,\s*|\s+&\s+|\s+and\s+|\s+e\s+/;

/**
 * catalogNames normalises an online catalog's artist/title the way the catalog
 * stores them: featured artists move to the "; "-joined artist list and both
 * fields are title-cased. Returns [artist, title].
 */
export function catalogNames(artist, title) {
  const parts = String(artist).trim().split(FEAT_SPLIT_RE);
  let main = normalizeArtistSeparators(parts[0]);
  let feats = [];
  for (const p of parts.slice(1)) feats.push(...p.split(FEAT_LIST_RE));
  const m = TITLE_FEAT_RE.exec(title);
  if (m) {
    feats.push(...m[1].split(FEAT_LIST_RE));
    title = title.replace(new RegExp(TITLE_FEAT_RE.source, 'gi'), '');
  }
  feats = feats.map((f) => f.trim());
  if (feats.length > 0) main = addFeaturedArtists(main, feats);
  return [toTitleCase(main), toTitleCase(String(title).trim())];
}
