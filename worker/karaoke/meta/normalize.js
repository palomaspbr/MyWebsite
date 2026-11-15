// Port of services/normalize.go: shared text normalisation for artist/title
// metadata: casing, multi-artist separators, accent-insensitive comparison
// keys, and detection of karaoke channels/labels that must never be stored as
// the artist. Also hosts small Go-compatibility helpers used by the other
// meta modules (Go strings/unicode semantics in JS).

// ---------------------------------------------------------------------------
// Go compatibility helpers
// ---------------------------------------------------------------------------

// Go unicode.IsSpace (used by strings.Fields / strings.TrimSpace).
const GO_SPACE_CHARS = '\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';
const GO_SPACE_RUN = new RegExp(`[${GO_SPACE_CHARS}]+`, 'u');
const GO_TRIM_SPACE = new RegExp(`^[${GO_SPACE_CHARS}]+|[${GO_SPACE_CHARS}]+$`, 'gu');

/** strings.Fields */
export function fields(s) {
  return s.split(GO_SPACE_RUN).filter((w) => w !== '');
}

/** strings.TrimSpace */
export function trimSpace(s) {
  return s.replace(GO_TRIM_SPACE, '');
}

/** strings.TrimLeft (cutset of runes) */
export function trimLeftChars(s, cutset) {
  const set = new Set(Array.from(cutset));
  const runes = Array.from(s);
  let i = 0;
  while (i < runes.length && set.has(runes[i])) i++;
  return runes.slice(i).join('');
}

/** strings.TrimRight (cutset of runes) */
export function trimRightChars(s, cutset) {
  const set = new Set(Array.from(cutset));
  const runes = Array.from(s);
  let j = runes.length;
  while (j > 0 && set.has(runes[j - 1])) j--;
  return runes.slice(0, j).join('');
}

/** strings.Trim (cutset of runes) */
export function trimChars(s, cutset) {
  return trimRightChars(trimLeftChars(s, cutset), cutset);
}

const ASCII_ONLY = /^[\x00-\x7f]*$/;

/** strings.ToLower: per-rune simple mapping (no context rules, no expansions). */
export function goLower(s) {
  if (ASCII_ONLY.test(s)) return s.toLowerCase();
  let out = '';
  for (const c of s) {
    if (c === 'İ') { out += 'i'; continue; } // İ -> i, as Go
    const l = c.toLowerCase();
    out += Array.from(l).length === 1 ? l : c;
  }
  return out;
}

/** unicode.ToUpper for one rune (no expansions such as ß -> SS). */
export function goUpperRune(c) {
  const u = c.toUpperCase();
  return Array.from(u).length === 1 ? u : c;
}

/** strings.ToUpper */
export function goUpper(s) {
  if (ASCII_ONLY.test(s)) return s.toUpperCase();
  let out = '';
  for (const c of s) out += goUpperRune(c);
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** len(s) in Go: UTF-8 byte length. */
export function utf8Len(s) {
  let n = 0;
  for (const c of s) {
    const cp = c.codePointAt(0);
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/** strings.Index in bytes (-1 when absent). */
export function byteIndex(haystack, needle) {
  const i = haystack.indexOf(needle);
  return i < 0 ? -1 : utf8Len(haystack.slice(0, i));
}

/** s[start:end] with Go byte offsets (end defaults to len(s)). */
export function sliceBytes(s, start, end) {
  const b = encoder.encode(s);
  const e = end === undefined ? b.length : Math.min(end, b.length);
  return decoder.decode(b.subarray(Math.min(start, b.length), e));
}

/** Code-point (= UTF-8 byte, SQLite BINARY) string comparison. */
// UTF-16 order equals code-point order except between surrogates and
// U+E000..U+FFFF; remapping the differing unit fixes that without decoding.
function cpOrderUnit(u) {
  return u >= 0xe000 ? u - 0x800 : u >= 0xd800 ? u + 0x2000 : u;
}

export function compareBinary(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) return cpOrderUnit(x) < cpOrderUnit(y) ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/**
 * memoString wraps a pure string -> value function with a bounded cache
 * (cleared when it reaches `max` entries). Used for catalog keys, which repeat
 * across songs and across catalog versions.
 */
export function memoString(fn, max = 20000) {
  let cache = new Map();
  return (s) => {
    let v = cache.get(s);
    if (v === undefined) {
      v = fn(s);
      if (cache.size >= max) cache = new Map();
      cache.set(s, v);
    }
    return v;
  };
}

/** regexp.QuoteMeta */
export function quoteMeta(s) {
  return s.replace(/[\\.+*?()|[\]{}^$]/g, '\\$&');
}

/**
 * goRe compiles a Go (RE2) pattern as a JS RegExp with the same semantics for
 * the constructs used here: a leading (?i) becomes the i flag, \s/\S are
 * ASCII-only ([\t\n\f\r ]), "." excludes only \n, \x{H} becomes \u{H}. The u
 * flag is always on (Unicode property escapes, code-point matching).
 */
export function goRe(src, flags = '') {
  let f = flags.includes('u') ? flags : flags + 'u';
  if (src.startsWith('(?i)')) {
    src = src.slice(4);
    if (!f.includes('i')) f += 'i';
  }
  let out = '';
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      const n = src[i + 1];
      if (n === 's') out += inClass ? '\\t\\n\\f\\r ' : '[\\t\\n\\f\\r ]';
      else if (n === 'S' && !inClass) out += '[^\\t\\n\\f\\r ]';
      else if (n === 'x' && src[i + 2] === '{') {
        const close = src.indexOf('}', i);
        out += '\\u{' + src.slice(i + 3, close) + '}';
        i = close;
        continue;
      } else out += c + n;
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      out += c;
      continue;
    }
    if (c === '[') {
      inClass = true;
      out += c;
      // A leading ']' (or '^]') is a literal in RE2.
      if (src[i + 1] === '^') { out += '^'; i++; }
      if (src[i + 1] === ']') { out += '\\]'; i++; }
      continue;
    }
    out += c === '.' ? '[^\\n]' : c;
  }
  return new RegExp(out, f);
}

const LETTER = /\p{L}/u;
const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;

export function isLetter(c) { return LETTER.test(c); }
export function isUpperRune(c) { return UPPER.test(c); }
export function isLowerRune(c) { return LOWER.test(c); }

// ---------------------------------------------------------------------------
// normalize.go
// ---------------------------------------------------------------------------

// artistSeparator joins multiple credited artists ("Drake; Nicki Minaj").
export const artistSeparator = '; ';

// smallWords stay lowercase inside a phrase (never at the start of a segment).
const smallWords = new Set([
  'a', 'an', 'the',
  'and', 'but', 'or', 'nor',
  'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', "'n'",
  'de', 'da', 'do', 'dos', 'das', // Portuguese
  'e', 'o', 'os', 'as',
  'el', 'la', 'los', 'las', 'y', // Spanish
]);

// toTitleCase capitalises lowercase words without destroying intentional
// casing (S&M, LiSA, ONE OK ROCK are kept). Small words are lowercased
// mid-phrase but capitalised at the start of a segment (after "; ", "/",
// " - ", ":" or an opening bracket). Hyphenated words: vira-vira -> Vira-Vira.
export function toTitleCase(s) {
  const words = fields(s);
  let segmentStart = true;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const start = segmentStart || word.startsWith('(') || word.startsWith('[');
    const lower = goLower(word);
    if (!start && smallWords.has(lower) && (word === lower || isCapitalised(word))) {
      words[i] = lower;
    } else if (hasUpper(word)) {
      // Keep intentional casing.
    } else {
      words[i] = capitalizeParts(word);
    }
    segmentStart = word === '-' || word === '–' || word === '—' || word === '|' ||
      word.endsWith(';') || word.endsWith('/') || word.endsWith(':');
  }
  return words.join(' ');
}

// titleCaseRaw is toTitleCase for text scraped from YouTube titles, where a
// whole field in capitals is shouting ("FAT FAMILY"). Such fields are
// lowercased first; a single short token (YMCA, S&M, K.O.) is kept.
export function titleCaseRaw(s) {
  if (isShouting(s) && !(fields(s).length === 1 && letterCount(s) <= 5)) {
    s = goLower(s);
  }
  return toTitleCase(s);
}

// capitalizeWord uppercases the first letter of a lowercase word, skipping a
// non-letter prefix ("(version)" -> "(Version)").
export function capitalizeWord(word) {
  if (hasUpper(word)) return word;
  const runes = Array.from(word);
  for (let i = 0; i < runes.length; i++) {
    if (isLetter(runes[i])) {
      runes[i] = goUpperRune(runes[i]);
      break;
    }
  }
  return runes.join('');
}

// capitalizeParts capitalises each hyphen-separated part of a lowercase word.
export function capitalizeParts(word) {
  return word.split('-').map(capitalizeWord).join('-');
}

export function hasUpper(s) {
  for (const c of s) if (isUpperRune(c)) return true;
  return false;
}

// isCapitalised reports whether word is "Xxxx": first letter upper, rest lower.
export function isCapitalised(word) {
  let seenLetter = false;
  for (const c of word) {
    if (!isLetter(c)) continue;
    if (!seenLetter) {
      if (!isUpperRune(c)) return false;
      seenLetter = true;
    } else if (isUpperRune(c)) {
      return false;
    }
  }
  return seenLetter;
}

// isShouting reports whether s has letters and none of them are lowercase.
export function isShouting(s) {
  let letters = false;
  for (const c of s) {
    if (isLowerRune(c)) return false;
    if (isLetter(c)) letters = true;
  }
  return letters;
}

export function letterCount(s) {
  let n = 0;
  for (const c of s) if (isLetter(c)) n++;
  return n;
}

// splitArtists splits a multi-artist credit on ";" into trimmed, non-empty names.
export function splitArtists(s) {
  const out = [];
  for (let p of s.split(';')) {
    p = fields(p).join(' ');
    if (p !== '') out.push(p);
  }
  return out;
}

// normalizeArtistSeparators rewrites "A;b ;  C" as "A; b; C".
export function normalizeArtistSeparators(s) {
  return splitArtists(s).join(artistSeparator);
}

// primaryArtist returns the first credited artist.
export function primaryArtist(s) {
  const parts = splitArtists(s);
  return parts.length > 0 ? parts[0] : '';
}

// foldAccents lowercases s and strips diacritics (Glória -> gloria).
export function foldAccents(s) {
  return goLower(s).normalize('NFD').replace(/\p{Mn}/gu, '');
}

const nonAlnumRe = /[^\p{L}\p{N}]+/gu;

// matchWords folds accents and reduces s to space-separated alphanumeric words.
export function matchWords(s) {
  return trimSpace(foldAccents(s).replace(nonAlnumRe, ' '));
}

// connectorWords are ignored when comparing names: "Bruno & Marrone" and
// "Bruno e Marrone" are the same act.
const connectorWords = new Set(['e', 'and', 'y', 'the']);

// nameKey is an accent-, case-, spacing- and punctuation-insensitive key for
// one name: "Udr 666" / "Udr666", "Charlie Brown Jr" / "Charlie Brown Jr.".
export function nameKey(s) {
  let b = '';
  for (const w of fields(matchWords(s))) {
    if (!connectorWords.has(w)) b += w;
  }
  return b;
}

// titleKey is nameKey for song titles, ignoring bracketed suffixes such as
// "(Ao Vivo)" or "[Karaoke Version]" so versions of one song collide.
const bracketedRe = goRe(String.raw`\s*[\(\[][^\)\]]*[\)\]]`, 'g');

export function titleKey(s) {
  const k = nameKey(s.replace(bracketedRe, ''));
  return k !== '' ? k : nameKey(s);
}

// containsPhrase reports whether needle appears in haystack as whole words,
// after folding both with matchWords.
export function containsPhrase(haystack, needle) {
  const n = matchWords(needle);
  if (n === '') return false;
  return (' ' + matchWords(haystack) + ' ').includes(' ' + n + ' ');
}

// knownKaraokeSources are YouTube channels and streaming labels that publish
// karaoke versions of other people's songs. Their name is never the artist.
export const knownKaraokeSources = [
  'sing king', 'karafun', 'ameritz', 'clubinho do karaoke', 'king of karaoke',
  'edkara', 'kalaikoscope', 'karaoke sing along', 'cali karaoke', 'geek music',
  'gabibis karaoke', 'zoom karaoke', 'raf electronics', 'musisi',
  'sing2piano', 'singsongmusic', 'karaoke hits', 'party tyme', 'stingray karaoke',
  'the karaoke channel', 'carly dumas', 'hugo edit',
];

// karaokeSourceRe catches generic karaoke channel/label names.
const karaokeSourceRe = goRe(String.raw`(?i)karaok[eêé]|videok[eê]|\bsing ?along\b|\bplayback\b|\btribute\b|\bbacking tracks?\b`);

// isKaraokeSource reports whether name is a karaoke channel or label rather
// than a performing artist.
export function isKaraokeSource(name) {
  if (trimSpace(name) === '') return false;
  if (karaokeSourceRe.test(name)) return true;
  const words = matchWords(name);
  for (const src of knownKaraokeSources) {
    if (words === src || words.startsWith(src + ' ')) return true;
  }
  return false;
}

// karaokeTitleRe flags catalog track titles that are karaoke/cover releases.
const karaokeTitleRe = goRe(String.raw`(?i)karaok[eêé]|in the style of|originally performed|made famous|no estilo de|ao estilo de|\binstrumental\b|\bsing ?along\b|backing track|\bplayback\b|\btribute\b`);

// isKaraokeRelease reports whether an online-catalog result is a karaoke or
// tribute release rather than the original.
export function isKaraokeRelease(artist, title) {
  return isKaraokeSource(artist) || karaokeTitleRe.test(title);
}

// addFeaturedArtists appends featured names to an artist credit, skipping any
// already credited (or contained in the credit, e.g. a duo's own name).
export function addFeaturedArtists(artist, featuring) {
  const parts = splitArtists(artist);
  for (const f of featuring || []) {
    if (f === '' || containsPhrase(artist, f)) continue;
    parts.push(f);
  }
  return parts.join(artistSeparator);
}
