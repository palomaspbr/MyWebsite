// Review suggestions (port of services/review_suggestions.go and the parts of
// services/review.go behind GET /catalog/songs/:id/suggestions).
//
// For one song: the options the DJ picks from instead of typing - artist/title
// candidates, first-line candidates, ranked languages, possible duplicates.
// The Go background prefetch worker is replaced by on-demand lookups: the
// Worker calls buildSuggestions() when the review screen needs it, stores
// toRecord(...) in D1 (table review_suggestions) and serves suggestionsView().
//
// `songs` everywhere is the live catalog array (Go JSON field names); trashed
// songs (deleted_at set) are ignored.

import {
  toTitleCase, titleCaseRaw, normalizeArtistSeparators, splitArtists, primaryArtist,
  foldAccents, matchWords, nameKey, isKaraokeSource, addFeaturedArtists,
} from './normalize.js';
import { TitleParser } from './title_parser.js';
import { rankLanguages, lyricsLanguage } from './language.js';
import { cleanString } from './extract.js';
import {
  suggestCatalogArtist, findDuplicateSongs, artistLanguage, catalogHints,
} from './catalog_meta.js';
import { candidates, pairSimilarity, anySignal } from './lookup.js';
import { findCandidatesStrict, findAgreeingKey, cloneCandidate, isLyricSourcesUnavailable } from './lyrics.js';

// Name sources (the "source" of a name suggestion).
export const NameSourceCurrent = 'current';
export const NameSourceTyped = 'typed';
export const NameSourceYouTube = 'youtube_title';
export const NameSourceITunes = 'itunes';
export const NameSourceMusicBrainz = 'musicbrainz';
export const NameSourceCatalog = 'catalog';

// Stored statuses, plus the view-only "pending".
export const SuggestionsReady = 'ready';
export const SuggestionsNoneFound = 'none_found';
export const SuggestionsError = 'error';
export const SuggestionsPending = 'pending';

const MAX_NAME_SUGGESTIONS = 5;
const MAX_FIRST_LINE_SUGGESTIONS = 5;
export const NAMES_PER_PROVIDER = 3;
const MATERIAL_NAME_DIFFERENCE = 0.85;

/** Subrequests one buildSuggestions call may spend (Workers free plan: 50). */
export const SUGGESTIONS_SUBREQUEST_BUDGET = 40;
const REVIEW_LOOKUP_TIMEOUT = 60 * 1000;

const HOUR = 3600 * 1000;
const REVIEW_FRESH_READY = 30 * 24 * HOUR;
const REVIEW_FRESH_NONE_FOUND = 3 * 24 * HOUR;
const REVIEW_ERROR_BACKOFF = 10 * 60 * 1000;
const REVIEW_ERROR_BACKOFF_MAX = 12 * HOUR;

const liveSongs = (songs) => (songs || []).filter((s) => s && !s.deleted_at);

/**
 * The live catalog for one call, memoising the per-catalog work (spellings,
 * artist counts, parser hints, artist languages) so a lookup scans the
 * catalog as few times as possible (Workers CPU budget).
 */
class CatalogView {
  constructor(songs) {
    this.songs = liveSongs(songs);
    this._spell = new Map();
    this._lang = new Map();
    this._counts = null;
    this._hints = null;
  }

  spelled(artist) {
    if (!this._spell.has(artist)) this._spell.set(artist, suggestCatalogArtist(this.songs, artist));
    return this._spell.get(artist);
  }

  /** GetArtists: song count per exact artist string. */
  counts() {
    if (!this._counts) {
      this._counts = new Map();
      for (const s of this.songs) this._counts.set(s.artist || '', (this._counts.get(s.artist || '') || 0) + 1);
    }
    return this._counts;
  }

  hints() {
    if (!this._hints) this._hints = catalogHints(this.songs);
    return this._hints;
  }

  artistLanguage(artist, exceptId) {
    const key = artist + '\u0000' + exceptId;
    if (!this._lang.has(key)) this._lang.set(key, artistLanguage(this.songs, artist, exceptId));
    return this._lang.get(key);
  }
}

// ------------------------------------------------------------- name list

function nameSuggestionKey(artist, title) {
  return nameKey(artist || '') + '|' + nameKey(title || '');
}

/** Collects name suggestions, merging accent/case/punctuation-equal ones. */
class NameList {
  constructor() {
    this.items = [];
  }

  /** Merges n into an equal entry or appends it; returns its index (-1 if empty). */
  add(n) {
    n = { ...n, artist: String(n.artist || '').trim(), title: String(n.title || '').trim() };
    if (n.artist === '' || n.title === '') return -1;
    n.sources = n.sources && n.sources.length ? [...n.sources] : [n.source];
    n.confidence = n.confidence || 0;
    const key = nameSuggestionKey(n.artist, n.title);
    for (let i = 0; i < this.items.length; i++) {
      const ex = this.items[i];
      if (nameSuggestionKey(ex.artist, ex.title) !== key) continue;
      for (const s of n.sources) if (!ex.sources.includes(s)) ex.sources.push(s);
      if (n.confidence > ex.confidence) ex.confidence = n.confidence;
      ex.current = !!(ex.current || n.current);
      return i;
    }
    this.items.push(n);
    return this.items.length - 1;
  }

  /** The saved values first, then by confidence; at most five. */
  result() {
    const out = this.items.map((n) => ({ ...n, sources: [...n.sources] }));
    out.sort((a, b) => {
      if (!!a.current !== !!b.current) return a.current ? -1 : 1;
      return b.confidence - a.confidence;
    });
    return out.slice(0, MAX_NAME_SUGGESTIONS);
  }
}

// --------------------------------------------------------- catalog spelling

/**
 * catalogSpelling returns [artist spelled as in the catalog, whether the lead
 * artist has other songs there] (the song under review does not count).
 */
function catalogSpelling(artist, self, cat) {
  const spelled = cat.spelled(artist);
  const lead = nameKey(primaryArtist(spelled || ''));
  if (lead === '') return [spelled, false];
  for (const [a, count] of cat.counts()) {
    let n = count;
    if (self && !self.deleted_at && a === self.artist) n--;
    if (n <= 0) continue;
    for (const name of splitArtists(a)) {
      if (nameKey(name) === lead) return [spelled, true];
    }
  }
  return [spelled, false];
}

function withCatalogSpelling(n, self, cat) {
  const [spelled, known] = catalogSpelling(n.artist, self, cat);
  if (!known) return n;
  n = { ...n };
  if (spelled !== n.artist) {
    n.note = 'artist spelled as in your catalog';
    n.artist = spelled;
  }
  const sources = n.sources && n.sources.length ? n.sources : [n.source];
  n.sources = [...sources, NameSourceCatalog];
  return n;
}

/** youtubeNames parses the YouTube title (the heuristic parser, as at download). */
function youtubeNames(song, cat) {
  const yt = song.youtube_title || '';
  if (yt.trim() === '') return null;
  const parser = new TitleParser();
  const p = parser.parseWithHints(yt, '', cat.hints());
  let artist = cleanString(p.artist || '');
  if (artist === '' || isKaraokeSource(artist)) return null;
  const feats = parser.extractFeaturing(yt);
  if (feats && feats.length > 0) artist = addFeaturedArtists(artist, feats);
  const title = cleanString(p.song || '');
  if (title === '') return null;
  return {
    artist: titleCaseRaw(normalizeArtistSeparators(artist)),
    title: titleCaseRaw(title),
    source: NameSourceYouTube,
    confidence: 0.8 * (p.confidence || 0),
  };
}

function offlineNames(song, typedArtist, typedTitle, cat) {
  const l = new NameList();
  l.add(withCatalogSpelling({ artist: song.artist, title: song.title, source: NameSourceCurrent, confidence: 0, current: true }, song, cat));
  if (typedArtist && typedTitle) {
    l.add(withCatalogSpelling({
      artist: toTitleCase(normalizeArtistSeparators(typedArtist)), title: toTitleCase(typedTitle),
      source: NameSourceTyped, confidence: 0.5,
    }, song, cat));
  }
  const yt = youtubeNames(song, cat);
  if (yt) l.add(withCatalogSpelling(yt, song, cat));
  return l;
}

// ---------------------------------------------------------------- languages

function knownLanguageSet(languages) {
  const known = new Set();
  for (const l of languages || []) {
    const id = typeof l === 'string' ? l : l && l.id;
    if (id) known.add(String(id).toUpperCase());
  }
  return known;
}

/** rankSongLanguages runs the language chain, limited to the catalog's languages. */
function rankSongLanguages(song, lyricsText, cat, cfg) {
  const ranked = rankLanguages({
    artistLanguage: cat.artistLanguage(song.artist || '', song.id),
    lyricsText,
    title: song.youtube_title || '',
    description: song.youtube_description || '',
    default: cfg.defaultLanguage || '',
  });
  const known = knownLanguageSet(cfg.languages);
  return ranked
    .filter((g) => known.size === 0 || known.has(g.id))
    .map((g) => ({ id: g.id, confidence: g.confidence, reason: g.reason }));
}

// ------------------------------------------------------------- first lines

/**
 * mergeFirstLines merges candidate lists from several lookups: the same first
 * line (or one that starts with the other) is one option with the union of
 * sources. Carried-over ("previous") lines rank behind fresh ones. Max five.
 */
export function mergeFirstLines(...groups) {
  const out = [];
  const byKey = new Map();
  for (const g of groups) {
    for (const c of g || []) {
      if (!c) continue;
      const key = matchWords(c.first_line || '');
      if (key === '') continue;
      let idx = byKey.has(key) ? byKey.get(key) : findAgreeingKey(byKey, key);
      if (idx < 0) {
        byKey.set(key, out.length);
        out.push(cloneCandidate(c, { sources: [...(c.sources || [])] }));
        continue;
      }
      let ex = out[idx];
      const sources = [...(ex.sources || [])];
      for (const s of c.sources || []) if (!sources.includes(s)) sources.push(s);
      const previous = !!ex.previous && !!c.previous;
      if ((c.score || 0) > (ex.score || 0) && !c.previous) {
        out[idx] = cloneCandidate(c);
        ex = out[idx];
      }
      ex.sources = sources;
      ex.previous = previous;
    }
  }
  out.sort((a, b) => {
    if (!!a.previous !== !!b.previous) return a.previous ? 1 : -1;
    if (a.sources.length !== b.sources.length) return b.sources.length - a.sources.length;
    return (b.score || 0) - (a.score || 0);
  });
  return out.slice(0, MAX_FIRST_LINE_SUGGESTIONS);
}

// ---------------------------------------------------------- JSON shapes

/** NameSuggestion JSON (note/current omitted when empty, as Go's omitempty). */
function nameJSON(n) {
  const o = {
    artist: n.artist, title: n.title, source: n.source,
    sources: n.sources ? [...n.sources] : [], confidence: n.confidence || 0,
  };
  if (n.note) o.note = n.note;
  if (n.current) o.current = true;
  return o;
}

/** LyricCandidate JSON (never the lyric sample). */
export function candidateJSON(c) {
  const o = {
    source: c.source || '', first_line: c.first_line || '', excerpt: c.excerpt || '',
    matched_artist: c.matched_artist || '', matched_title: c.matched_title || '',
    score: c.score || 0, sources: c.sources ? [...c.sources] : [],
  };
  if (c.previous) o.previous = true;
  return o;
}

function languageJSON(g) {
  return { id: g.id, confidence: g.confidence, reason: g.reason };
}

/** ReviewSuggestions JSON. */
function payloadJSON({ names, firstLines, languages, lyricsLanguage: lyricsLang, lookedUp }) {
  const o = {
    names: (names || []).map(nameJSON),
    first_lines: (firstLines || []).map(candidateJSON),
    languages: (languages || []).map(languageJSON),
  };
  if (lyricsLang) o.lyrics_language = lyricsLang;
  if (lookedUp && lookedUp.length) o.looked_up = [...lookedUp];
  return o;
}

function lookupConfig(args) {
  const opts = args.opts || {};
  return {
    languages: args.languages ?? opts.languages,
    defaultLanguage: args.defaultLanguage ?? opts.defaultLanguage ?? '',
  };
}

// ------------------------------------------------------------------ public

/**
 * offlineSuggestions: suggestions built without network access (the saved
 * names, the YouTube-title parse, ranked languages), served while the real
 * lookup has not run. Returns the ReviewSuggestions JSON object.
 * extra: { languages (catalog language ids or {id} rows), defaultLanguage }.
 */
export function offlineSuggestions(song, songs, extra = {}) {
  return offlineSuggestionsFor(song, new CatalogView(songs), lookupConfig(extra));
}

function offlineSuggestionsFor(song, cat, cfg) {
  return payloadJSON({
    names: offlineNames(song, '', '', cat).result(),
    firstLines: [],
    languages: rankSongLanguages(song, '', cat, cfg),
  });
}

/** The first lines flagged `previous` in a stored record's payload. */
export function previousFirstLines(record) {
  const payload = parsePayload(record);
  return payload && Array.isArray(payload.first_lines) ? payload.first_lines.filter((c) => c && c.previous) : [];
}

function parsePayload(record) {
  if (!record || record.payload == null) return null;
  if (typeof record.payload === 'object') return record.payload;
  try {
    const v = JSON.parse(record.payload);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/**
 * buildSuggestions runs the lookups for song with the given names (the saved
 * ones, or the DJ's typed override; empty = saved) and resolves to
 *   { payload, status: 'ready'|'none_found'|'error', error, queryArtist, queryTitle }
 * payload is the Go ReviewSuggestions JSON. previous: first-line candidates
 * carried from an older lookup (see previousFirstLines).
 *
 * args: { song, artist, title, previous, songs, opts, languages, defaultLanguage, sources }
 *  - opts: { fetch, sleep, signal, budget, lookupTimeout, ... } for the lookups.
 *    A subrequest budget of 40 is applied unless opts.budget is given.
 *  - sources: optional { names(artist, title, rawTitle, opts) -> match[],
 *    lyrics(artist, title, opts) -> LyricCandidate[] } replacing the online
 *    lookups (Go's SetReviewLookups); null disables one.
 */
export async function buildSuggestions(args) {
  const { song } = args;
  let { artist, title } = args;
  if (!artist || !title) {
    artist = song.artist;
    title = song.title;
  }
  const cat = new CatalogView(args.songs);
  const cfg = lookupConfig(args);
  const baseOpts = args.opts || {};
  const lookupSignal = anySignal([
    baseOpts.signal,
    typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(baseOpts.lookupTimeout || REVIEW_LOOKUP_TIMEOUT) : null,
  ]);
  const opts = {
    ...baseOpts,
    signal: lookupSignal,
    budget: baseOpts.budget || { left: SUGGESTIONS_SUBREQUEST_BUDGET },
  };
  const ended = () => !!(lookupSignal && lookupSignal.aborted);
  const src = {
    names: (a, t, raw, o) => candidates(a, t, raw, NAMES_PER_PROVIDER, o),
    lyrics: (a, t, o) => findCandidatesStrict(a, t, o),
    ...(args.sources || {}),
  };

  let typedArtist = '';
  let typedTitle = '';
  if (artist !== song.artist || title !== song.title) {
    typedArtist = artist;
    typedTitle = title;
  }
  const names = offlineNames(song, typedArtist, typedTitle, cat);
  const nameProblems = [];
  const lyricProblems = [];
  const lookedUp = [];
  const groups = [];

  const lookup = async (a, t) => {
    if (!src.lyrics || ended()) return null;
    lookedUp.push(a + ' - ' + t);
    try {
      return (await src.lyrics(a, t, opts)) || [];
    } catch (err) {
      if (isLyricSourcesUnavailable(err) || !ended()) lyricProblems.push('lyrics: ' + (err && err.message ? err.message : String(err)));
      return null;
    }
  };

  // The names lookup and the first lyric lookup are independent: run them
  // together (Go runs them one after the other; results are the same).
  const namesP = (async () => {
    if (!src.names) return [];
    try {
      return (await src.names(artist, title, song.youtube_title || '', opts)) || [];
    } catch (err) {
      nameProblems.push('music catalogs: ' + (err && err.message ? err.message : String(err)));
      return [];
    }
  })();
  const firstLyricsP = lookup(artist, title);
  const [matches, firstCands] = await Promise.all([namesP, firstLyricsP]);
  groups.push(firstCands);

  const baseKey = nameSuggestionKey(artist, title);
  let baseConf = 0;
  let onlineNames = 0;
  for (const m of matches) {
    const idx = names.add(withCatalogSpelling({ artist: m.artist, title: m.title, source: m.source, confidence: m.confidence }, song, cat));
    if (idx < 0) continue;
    onlineNames++;
    if (nameSuggestionKey(m.artist, m.title) === baseKey && m.confidence > baseConf) baseConf = m.confidence;
  }
  // Reflect the catalogs' confidence on the entries that are the saved/typed names.
  for (const it of names.items) {
    if (nameSuggestionKey(it.artist, it.title) === baseKey && it.confidence < baseConf) it.confidence = baseConf;
  }
  const resultNames = names.result();

  // At most one more lyric lookup: a materially different, better-scored
  // names candidate that an online catalog vouches for.
  for (const n of resultNames) {
    if (n.current || !(n.sources.includes(NameSourceITunes) || n.sources.includes(NameSourceMusicBrainz))) continue;
    if (n.confidence <= baseConf || nameSuggestionKey(n.artist, n.title) === baseKey) continue;
    if (pairSimilarity(foldAccents(n.artist), foldAccents(artist)) >= MATERIAL_NAME_DIFFERENCE &&
      pairSimilarity(foldAccents(n.title), foldAccents(title)) >= MATERIAL_NAME_DIFFERENCE) continue;
    if (src.lyrics && !ended()) groups.push(await lookup(n.artist, n.title));
    break;
  }

  const fresh = mergeFirstLines(...groups);
  const firstLines = mergeFirstLines(fresh, args.previous || []);

  let lyricsText = '';
  for (const c of firstLines) {
    if (!c.previous && c.text) {
      lyricsText = c.text;
      break;
    }
  }
  const languages = rankSongLanguages(song, lyricsText, cat, cfg);
  let lyricsLang = '';
  if (lyricsText !== '') {
    const { lang } = lyricsLanguage(lyricsText, cat.artistLanguage(song.artist || '', song.id));
    if (lang) lyricsLang = lang;
  }

  const payload = payloadJSON({ names: resultNames, firstLines, languages, lyricsLanguage: lyricsLang, lookedUp });
  const problems = [...nameProblems, ...lyricProblems];
  const note = problems.join('; ');
  let status;
  let error = note;
  if (onlineNames > 0 || fresh.length > 0) status = SuggestionsReady;
  else if (problems.length > 0) status = SuggestionsError;
  else {
    status = SuggestionsNoneFound;
    error = '';
  }
  return { payload, status, error, queryArtist: artist, queryTitle: title };
}

/**
 * toRecord builds the review_suggestions row to store for a buildSuggestions
 * result (attempts counts consecutive errors, as Go does). payload is the
 * JSON string; fetched_at an ISO timestamp.
 */
export function toRecord({ song, result, previous = null, now = new Date() }) {
  let attempts = 0;
  if (result.status === SuggestionsError) {
    attempts = previous && previous.status === SuggestionsError ? (previous.attempts || 0) + 1 : 1;
  }
  return {
    song_id: song.id,
    status: result.status,
    payload: JSON.stringify(result.payload),
    song_artist: song.artist,
    song_title: song.title,
    query_artist: result.queryArtist,
    query_title: result.queryTitle,
    last_error: result.error || '',
    attempts,
    fetched_at: (now instanceof Date ? now : new Date(now)).toISOString(),
  };
}

/** isStale: the record was fetched for other names than the song has now. */
export function isStale(record, song) {
  return !!(record && record.status) && (record.song_artist !== song.artist || record.song_title !== song.title);
}

/**
 * reviewDue: whether a song's stored suggestions should be (re)fetched now
 * (Go's reviewDue: never fetched or stale -> yes; ready after 30 days;
 * none_found after 3 days; errors back off 10 min doubling up to 12 h).
 */
export function reviewDue(record, song, now = Date.now()) {
  if (!record || !record.status || !record.fetched_at || isStale(record, song)) return true;
  const at = new Date(record.fetched_at).getTime();
  if (Number.isNaN(at)) return true;
  const age = (now instanceof Date ? now.getTime() : now) - at;
  if (record.status === SuggestionsReady) return age >= REVIEW_FRESH_READY;
  if (record.status === SuggestionsNoneFound) return age >= REVIEW_FRESH_NONE_FOUND;
  let wait = REVIEW_ERROR_BACKOFF;
  for (let i = 1; i < (record.attempts || 0) && wait < REVIEW_ERROR_BACKOFF_MAX; i++) wait *= 2;
  if (wait > REVIEW_ERROR_BACKOFF_MAX) wait = REVIEW_ERROR_BACKOFF_MAX;
  return age >= wait;
}

function slimSong(s) {
  const o = { ...s };
  delete o.youtube_description;
  delete o.file_path;
  return o;
}

/** Other catalog songs that look like song (by its saved names and the best suggested names). */
function reviewDuplicates(song, names, cat) {
  const out = [];
  const seen = new Set([song.id]);
  const check = (title, artist) => {
    for (const d of findDuplicateSongs(cat.songs, title, artist)) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push(slimSong(d));
    }
  };
  check(song.title, song.artist);
  for (const n of names) {
    if (!n.current) {
      check(n.title, n.artist);
      break;
    }
  }
  return out;
}

/**
 * suggestionsView builds exactly what GET /catalog/songs/:id/suggestions
 * serves (Go's SuggestionsView). record: the stored row with payload parsed
 * (or a JSON string), or null. When no fresh record exists the status is
 * 'pending' and offline suggestions are served (the caller should then run
 * buildSuggestions). Returns null when the song is missing or trashed.
 * args: { song, record, songs, inProgress, addedBy, languages, defaultLanguage }
 */
export function suggestionsView(args) {
  const { song, record } = args;
  if (!song || song.deleted_at) return null;
  const cat = new CatalogView(args.songs);
  const cfg = lookupConfig(args);
  let status = SuggestionsPending;
  let fetchedAt = null;
  let lastError = '';
  let attempts = 0;
  let queryArtist = '';
  let queryTitle = '';
  let sug = null;
  if (record) {
    sug = parsePayload(record);
    lastError = record.last_error || '';
    attempts = record.attempts || 0;
    queryArtist = record.query_artist || '';
    queryTitle = record.query_title || '';
    const fresh = !!record.fetched_at && record.song_artist === song.artist && record.song_title === song.title;
    if (fresh) {
      status = record.status;
      fetchedAt = record.fetched_at;
    }
  }
  if (status === SuggestionsPending) {
    const offline = offlineSuggestionsFor(song, cat, cfg);
    if (sug) offline.first_lines = mergeFirstLines(sug.first_lines || []).map(candidateJSON); // carried-over lines
    sug = offline;
  }

  const view = {
    song_id: song.id,
    status,
    in_progress: !!args.inProgress,
    fetched_at: fetchedAt,
  };
  if (lastError) view.last_error = lastError;
  view.attempts = attempts;
  if (queryArtist) view.query_artist = queryArtist;
  if (queryTitle) view.query_title = queryTitle;
  if (args.addedBy) view.added_by = args.addedBy;
  view.names = Array.isArray(sug.names) ? sug.names : [];
  view.first_lines = Array.isArray(sug.first_lines) ? sug.first_lines : [];
  view.languages = Array.isArray(sug.languages) ? sug.languages : [];
  if (sug.lyrics_language) view.lyrics_language = sug.lyrics_language;
  if (Array.isArray(sug.looked_up) && sug.looked_up.length) view.looked_up = sug.looked_up;
  view.duplicates = reviewDuplicates(song, view.names, cat);
  return view;
}
