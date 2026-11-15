// Port of services/catalog_metadata.go as pure functions over the live
// catalog: `songs` is an array of song objects with the Go JSON field names
// (id, title, artist, language, ...), trashed songs already left out.
// The database ordering Go relies on (SQLite BINARY collation) is reproduced
// with compareBinary so ties resolve the same way.
//
// Performance (Workers free plan, 10 ms CPU): the Worker passes the same
// cached array until the catalog changes, so per-array indexes are memoized
// in WeakMaps (rebuilt if the array length changes) and the keys of
// artist/title strings are memoized by string.
// A songs array must therefore be treated as immutable once passed in:
// replace the array (not just its songs' fields), when the catalog changes.

import { splitArtists, nameKey, titleKey, trimSpace, artistSeparator, compareBinary, primaryArtist, goUpper, memoString } from './normalize.js';

// ---------------------------------------------------------------- caches

// Keys of catalog strings, memoized by string (bounded): artists and titles
// repeat across songs and across catalog versions.
const cachedTitleKey = memoString(titleKey);
const cachedNameKey = memoString(nameKey);
const cachedLead = memoString((artist) => nameKey(primaryArtist(artist)));

// Non-empty nameKeys of the credited artists (shared, read-only Sets).
const cachedArtistKeys = memoString((artist) => {
  const keys = new Set();
  for (const name of splitArtists(artist)) {
    const k = nameKey(name);
    if (k !== '') keys.add(k);
  }
  return keys;
});

const arrayCache = new WeakMap();

// indexOf returns the memo record of a songs array (facets built lazily).
function indexOf(songs) {
  let idx = arrayCache.get(songs);
  if (!idx || idx.len !== songs.length) {
    idx = { len: songs.length };
    arrayCache.set(songs, idx);
  }
  return idx;
}

const EMPTY_SONGS = [];

// ------------------------------------------------------------- functions

// sameArtist reports whether two credits share a credited artist, compared
// with nameKey ("Bruno & Marrone" matches "Bruno e Marrone").
export function sameArtist(a, b) {
  const keys = cachedArtistKeys(a || '');
  for (const name of splitArtists(b || '')) {
    if (keys.has(nameKey(name))) return true;
  }
  return false;
}

// GetAllSongs order: ORDER BY artist, title.
function bySongOrder(x, y) {
  return compareBinary(x.artist || '', y.artist || '') || compareBinary(x.title || '', y.title || '');
}

// findDuplicateSongs returns catalog songs with the same title (ignoring
// accents, case, punctuation and bracketed suffixes like "(Ao Vivo)") that
// share a credited artist with the given one, in catalog (artist, title) order.
export function findDuplicateSongs(songs, title, artist) {
  const key = titleKey(title || '');
  if (key === '' || trimSpace(artist || '') === '') return [];
  songs = songs || EMPTY_SONGS;
  const idx = indexOf(songs);
  if (!idx.byTitle) {
    const byTitle = new Map();
    for (const s of songs) {
      const k = cachedTitleKey(s.title || '');
      const list = byTitle.get(k);
      if (list) list.push(s);
      else byTitle.set(k, [s]);
    }
    idx.byTitle = byTitle;
  }
  const want = cachedArtistKeys(artist);
  const dups = [];
  for (const s of idx.byTitle.get(key) || EMPTY_SONGS) {
    for (const k of cachedArtistKeys(s.artist || '')) {
      if (want.has(k)) { dups.push(s); break; }
    }
  }
  // Sorting only the matches (stable) gives the same order as filtering the
  // fully sorted catalog.
  return dups.sort(bySongOrder);
}

// suggestCatalogArtist replaces each credited artist with the spelling already
// used in the catalog when they differ only by accents, case, spacing,
// punctuation or "&"/"e" ("Glória Groove" -> "Gloria Groove"). When several
// spellings exist, the one on the most songs wins.
export function suggestCatalogArtist(songs, artist) {
  const names = splitArtists(artist || '');
  if (names.length === 0) return artist;
  songs = songs || EMPTY_SONGS;
  const idx = indexOf(songs);
  if (!idx.spelling) {
    // GetArtists: song count per exact artist string, ORDER BY artist.
    const counts = new Map();
    for (const s of songs) {
      const a = s.artist || '';
      counts.set(a, (counts.get(a) || 0) + 1);
    }
    const best = new Map();
    for (const a of [...counts.keys()].sort(compareBinary)) {
      const songCount = counts.get(a);
      for (const name of splitArtists(a)) {
        const k = cachedNameKey(name);
        const cur = best.get(k);
        if (!cur || songCount > cur.songs) best.set(k, { name, songs: songCount });
      }
    }
    idx.spelling = best;
  }
  return names.map((name) => idx.spelling.get(nameKey(name))?.name ?? name).join(artistSeparator);
}

// artistLanguage returns the language most of the lead artist's existing
// songs use, or "" when the artist is new or their songs disagree.
// exceptSongId: the song under review must not vote for its own language.
// (Same result as artistLanguageFrom over the songs' {songId, artist, language}.)
export function artistLanguage(songs, artist, exceptSongId = '') {
  const lead = nameKey(primaryArtist(artist || ''));
  if (lead === '') return '';
  songs = songs || EMPTY_SONGS;
  const idx = indexOf(songs);
  if (!idx.byLead) {
    // Songs with a language, grouped by lead-artist key, in catalog order.
    const byLead = new Map();
    for (const s of songs) {
      if (!s.language) continue;
      const k = cachedLead(s.artist || '');
      const entry = { id: s.id, lang: goUpper(s.language) };
      const list = byLead.get(k);
      if (list) list.push(entry);
      else byLead.set(k, [entry]);
    }
    idx.byLead = byLead;
  }
  const counts = new Map();
  let total = 0;
  for (const p of idx.byLead.get(lead) || EMPTY_SONGS) {
    if (exceptSongId && p.id === exceptSongId) continue;
    counts.set(p.lang, (counts.get(p.lang) || 0) + 1);
    total++;
  }
  if (total < minArtistSongsForLanguage) return '';
  for (const [lang, n] of counts) {
    if (n / total >= minArtistLanguageShare) return lang;
  }
  return '';
}

const minArtistSongsForLanguage = 2;
const minArtistLanguageShare = 0.75;

// catalogHints returns known artists (distinct, ordered by artist) and titles
// for the title parser (GetCatalogNames). The result is memoized per songs
// array and shared between callers: do not mutate it. Reusing the same object
// also lets the title parser reuse its precomputed hint indexes.
export function catalogHints(songs) {
  songs = songs || EMPTY_SONGS;
  const idx = indexOf(songs);
  if (idx.hints) return idx.hints;
  // Group by artist (titles kept in catalog order, distinct per artist), then
  // sort only the distinct artists: same order as a stable sort of all songs.
  const byArtist = new Map();
  for (const s of songs) {
    const artist = s.artist || '';
    let t = byArtist.get(artist);
    if (!t) byArtist.set(artist, (t = new Set()));
    t.add(s.title || ''); // SELECT DISTINCT artist, title
  }
  const artists = [...byArtist.keys()].sort(compareBinary);
  const titles = [];
  for (const a of artists) for (const t of byArtist.get(a)) titles.push(t);
  idx.hints = { artists, songs: titles };
  return idx.hints;
}
