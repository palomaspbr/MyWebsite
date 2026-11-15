// Port of services/title_parser.go: heuristic parsing of YouTube video titles
// into artist and song, optionally helped by the channel name and by catalog
// hints ({artists: [], songs: []}).

import {
  fields, trimSpace, trimChars, trimLeftChars, trimRightChars, goLower,
  utf8Len, byteIndex, sliceBytes, quoteMeta, goRe, memoString,
  titleCaseRaw, isKaraokeSource, nameKey, matchWords, splitArtists,
} from './normalize.js';

// titleTrigrams returns the set of character trigrams (with space padding) of s.
export function titleTrigrams(s) {
  const runes = Array.from(' ' + s + ' ');
  const grams = new Set();
  for (let i = 0; i <= runes.length - 3; i++) {
    grams.add(runes[i] + runes[i + 1] + runes[i + 2]);
  }
  return grams;
}

// bestNgramMatch returns the highest trigram overlap score between candidate
// and any string in corpus (both lowercased).
// The corpus (catalog hints) is indexed once per array: trigram -> item
// indexes. max(matches)/n equals max(matches/n), so scores are unchanged.
// Indexes are rebuilt if the array length changes; don't mutate hint arrays.
const corpusIndexCache = new WeakMap();
// Trigram sets of corpus items, memoized by string (shared, read-only).
const cachedItemGrams = memoString((item) => titleTrigrams(goLower(item)));

function corpusIndex(corpus) {
  let c = corpusIndexCache.get(corpus);
  if (c && c.len === corpus.length) return c;
  const index = new Map();
  for (let i = 0; i < corpus.length; i++) {
    for (const g of cachedItemGrams(corpus[i])) {
      const list = index.get(g);
      if (list) list.push(i);
      else index.set(g, [i]);
    }
  }
  c = { len: corpus.length, index, counts: new Uint32Array(corpus.length) };
  corpusIndexCache.set(corpus, c);
  return c;
}

export function bestNgramMatch(candidate, corpus) {
  const qGrams = titleTrigrams(goLower(candidate));
  if (qGrams.size === 0 || !corpus || corpus.length === 0) return 0;
  if (!Array.isArray(corpus)) corpus = Array.from(corpus);
  const { index, counts } = corpusIndex(corpus);
  counts.fill(0);
  let bestMatches = 0;
  for (const g of qGrams) {
    const list = index.get(g);
    if (!list) continue;
    for (const i of list) {
      const m = ++counts[i];
      if (m > bestMatches) bestMatches = m;
    }
  }
  return bestMatches / qGrams.size;
}

// fuzzyMatch checks if two strings are roughly the same artist name.
export function fuzzyMatch(a, b) {
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

function removeIndex(s, i) {
  return [...s.slice(0, i), ...s.slice(i + 1)];
}

function parsed(artist, song, confidence, method) {
  return { artist, song, confidence, method };
}

const EMPTY = Object.freeze(parsed('', '', 0, ''));

// noisePatterns are removed from titles before parsing (case-insensitive).
const noisePatterns = [
  // Karaoke markers
  '(karaoke version)', '(karaokê version)', '(karaoke)', '(karaokê)', 'karaoque',
  '(instrumental)', '(backing track)', '(playback)', '(pista)',
  '[karaoke version]', '[karaokê version]', '[karaoke]', '[karaokê]',
  '[instrumental]',
  'karaoke version', 'instrumental version', 'versión karaoke',
  'karaokê version', 'versão karaokê', 'versión karaoke',
  'karaoke playback', 'karaoke playback instrumental',

  // Video type indicators
  '(official video)', '(official music video)', '(official audio)',
  '(official lyric video)', '(official visualizer)',
  '[official video]', '[official music video]', '[official audio]',
  '(music video)', '(lyric video)', '(visualizer)',
  '(lyrics)', '(letra)', '(con letra)', '(with lyrics)', 'com letra',
  '[lyrics]', '[letra]', '[with lyrics]',
  '(video oficial)', '(videoclip)', '(videoclipe)',
  '(audio)', '[audio]',
  '(hd)', '(hq)', '(4k)', '(1080p)', '(720p)', '(1080p 60fps)', '(short)',
  '[hd]', '[hq]', '[4k]',
  '(remastered)', '(remaster)', '(live)', '(ao vivo)',
  '(cover)', '[cover]',
  '(romaji)', '[romaji]', 'romaji romaji', 'romaji',

  // Quality/misc
  'no guide melody', 'original key',
  'vevo',

  // Channel/source noise
  'karafun', 'from zoom karaoke',
  'com backing vocal',
  'playback instrumental', 'playback com letra rolante',
  'com letra rolante',
];

// separators between artist and song, ordered by priority
const separators = [' - ', ' – ', ' — ', ' | ', ' // ', ' • ', ' ♪ ', ' ► '];

// karaokeWordRe matches any karaoke word variant at the start of a lowercased title.
const karaokeWordRe = goRe(String.raw`^(?:karaoke|karaok[êé])[♬♪\s]*`);

const EMOJI = String.raw`\x{1F000}-\x{1FFFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE00}-\x{FEFF}\x{266A}-\x{266F}`;
const emojiRe = goRe(`[${EMOJI}]`, 'g');
const leadingEmojiRe = goRe(String.raw`^[${EMOJI}]+\s*`, 'g');
const cjkBracketRe = goRe(String.raw`\s*【[^】]*】\s*`, 'g');
// Removes karaoke/karaokê/karaoké words anywhere (Go's \b is ASCII-only).
const karaokeStripRe = goRe(String.raw`(?i)karaok[eêé]|videok[eê]`, 'g');
const equalsRunRe = goRe(String.raw`\s*[-–—]*=+[-–—=]*\s*`, 'g');
const looseDashAfterRe = goRe(String.raw`([\p{L}\p{N}\)\]'!?.])[-–—]\s+`, 'g');
const looseDashBeforeRe = goRe(String.raw`\s+[-–—]([\p{L}\p{N}\(\['"])`, 'g');
const videokeCodeRe = goRe(String.raw`^\d{4,6}$`);
const hashtagRe = goRe(String.raw`(?i)#\w+`, 'g');
const trailingNoiseRe = goRe(String.raw`(?i),?\s+(?:instrumental|lyric[s]?|romanized|romaji|letra[s]?|with\s+guide|guide\s+melody|backing\s+vocal)\b.*$`, 'g');
const shortParenRe = goRe(String.raw`\s*\([^)]{0,30}\)\s*`, 'g');
const shortBracketRe = goRe(String.raw`\s*\[[^\]]{0,30}\]\s*`, 'g');
const versionRe = goRe(String.raw`(?i)\b(?:versão|versión|version)\b`, 'g');
const whitespaceRe = goRe(String.raw`\s+`, 'g');
const noisePatternRes = noisePatterns.map((p) => goRe('(?i)' + quoteMeta(p), 'g'));
const featStartRe = goRe(String.raw`(?i)\s*([\(\[])?\b(?:feat\.?|ft\.|featuring|part\.)\s+`);

// styleOfRe matches karaoke-label phrasing that names the original artist:
// "(Originally Performed by X)", "in the Style of "X"", "(No Estilo de X)".
const styleOfRe = goRe(String.raw`(?i)\s*[\(\[]?\s*\b(?:in the style of|originally performed by|as made famous by|made famous by|no estilo de|ao estilo de)\s+["“']?([^"”\)\]|]+?)["”']?\s*(?:[\)\]]|\s[-–—|]\s|$)`);
// singAlongRe removes the "Sing Along with Lyrics" tail some labels append.
const singAlongRe = goRe(String.raw`(?i)\bsing ?along\b.*$`, 'g');

const featuringPatterns = [
  String.raw`(?i)\bfeat\.?\s+([^(\[\)\]]+?)(?:\s*[\(\[\)\]]|\s[-–—|]\s|$)`,
  String.raw`(?i)\bft\.\s+([^(\[\)\]]+?)(?:\s*[\(\[\)\]]|\s[-–—|]\s|$)`,
  String.raw`(?i)\bfeaturing\s+([^(\[\)\]]+?)(?:\s*[\(\[\)\]]|\s[-–—|]\s|$)`,
  String.raw`(?i)\bpart\.\s+([^(\[\)\]]+?)(?:\s*[\(\[\)\]]|\s[-–—|]\s|$)`,
].map((p) => goRe(p, 'g'));
const featSplitRe = goRe(String.raw`(?i)\s*(?:,|&|\sand\s)\s*`, 'g');

// stripFeaturing removes each "feat. Names" run. A run ends at its closing
// bracket when it was opened by one, otherwise at the next artist/song
// separator or bracket, so "A ft. B - Song" keeps "Song".
function stripFeaturing(s) {
  for (;;) {
    const m = featStartRe.exec(s);
    if (!m) return s;
    const rest = s.slice(m.index + m[0].length);
    let end = rest.length;
    const i = rest.search(/[()[\]]/);
    if (i >= 0) {
      end = i;
      if (m[1] !== undefined && (rest[i] === ')' || rest[i] === ']')) {
        end = i + 1; // consume the bracket that opened the run
      }
    }
    for (const sep of separators) {
      const j = rest.indexOf(sep);
      if (j >= 0 && j < end) end = j;
    }
    s = s.slice(0, m.index) + ' ' + rest.slice(end);
  }
}

// minKnownArtistKey keeps very short catalog names ("Sim") from matching
// ordinary words at the start of a title (Go byte length).
const minKnownArtistKey = 4;

// findCatalogArtist returns the catalog spelling of part when it names a
// known artist (or one credited artist of a multi-artist entry).
function findCatalogArtist(part, artists) {
  const key = nameKey(part);
  if (utf8Len(key) < minKnownArtistKey) return '';
  return artistIndex(artists).byKey.get(key) ?? '';
}

// artistIndex precomputes, once per artists array, every credited name in
// order with its keys (names with a key shorter than minKnownArtistKey are
// left out, as both users skip them) and the first name for each key.
const artistIndexCache = new WeakMap();
const NO_ARTISTS = [];
// Per credited name: its nameKey, matchWords and byte lengths (by string).
const cachedNameInfo = memoString((name) => {
  const key = nameKey(name);
  const target = matchWords(name);
  return { key, keyLen: utf8Len(key), target, targetLen: utf8Len(target) };
});

function artistIndex(artists) {
  artists = artists || NO_ARTISTS;
  let c = artistIndexCache.get(artists);
  if (c && c.len === artists.length) return c;
  const names = [];
  const byKey = new Map();
  for (const a of artists) {
    for (const name of splitArtists(a)) {
      const { key, keyLen, target, targetLen } = cachedNameInfo(name);
      if (keyLen < minKnownArtistKey) continue;
      if (!byKey.has(key)) byKey.set(key, name);
      names.push({ name, target, targetLen });
    }
  }
  c = { len: artists.length, names, byKey };
  artistIndexCache.set(artists, c);
  return c;
}

// minHintScore / minHintMargin gate the catalog n-gram signal so that a few
// shared trigrams ("Best Part" vs "Beyoncé") don't flip artist and song.
const minHintScore = 0.5;
const minHintMargin = 0.2;

const noiseWords = new Set([
  'karaoke', 'karaokê', 'karaoké', 'instrumental', 'official', 'video',
  'audio', 'hd', 'hq', '4k', 'lyrics', 'letra', 'lyric',
  'cover', 'version', 'versión', 'versão',
  'ao vivo', 'live', 'en vivo',
  'playback', 'backing track', 'pista',
  'karafun', 'zoom karaoke',
  'romaji', 'romaji romaji',
]);
const noisePrefixes = ['from zoom', 'com letra', 'com backing'];

const channelSuffixes = [
  ' - topic', ' topic', ' vevo', ' official', ' karaoke',
  ' music', ' records', ' entertainment',
];

// TitleParser extracts artist and song from YouTube titles without AI.
export class TitleParser {
  // parse extracts artist and song from a video title.
  parse(title) {
    return this.parseWithChannel(title, '');
  }

  // parseWithChannel extracts artist and song, using channel name as a hint.
  parseWithChannel(title, channel) {
    return this.parseWithHints(title, channel, { artists: [], songs: [] });
  }

  // parseWithHints extracts artist and song, using channel name and catalog
  // hints (n-gram similarity against known names before positional heuristics).
  parseWithHints(title, channel = '', hints = {}) {
    title = title || '';
    channel = channel || '';
    hints = { artists: hints?.artists || [], songs: hints?.songs || [] };

    // A karaoke channel is never the artist: drop it as a hint, but remember
    // its name so a title part that just repeats it is discarded too.
    let sourceName = '';
    if (isKaraokeSource(channel)) {
      sourceName = trimSpace(this.cleanChannel(channel).replace(karaokeStripRe, ''));
      channel = '';
    }

    // "Song (Originally Performed by Artist)", "Song in the Style of "Artist""…
    const styled = this.parseByStyleOf(title);
    if (styled.confidence > 0) return styled;

    // Any karaoke-prefixed title ("Karaokê - Song - Artist", "Karaokê Song -
    // Artist") uses "Song - Artist" ordering: swap after parsing.
    const swapArtistSong = karaokeWordRe.test(goLower(title));

    const cleaned = this.cleanTitle(title);
    if (cleaned === '') return parsed('', title, 0.1, 'empty');

    let r = this.parseBySeparator(cleaned, channel, sourceName, hints, swapArtistSong);
    if (r.confidence > 0) return r;

    r = this.parseByIndicator(cleaned);
    if (r.confidence > 0) return r;

    // "Tim Maia Me Dê Motivo": no separator, but the title starts or ends
    // with an artist already in the catalog.
    r = this.parseByKnownArtist(cleaned, hints.artists);
    if (r.confidence > 0) return r;

    if (channel !== '') {
      const ch = this.cleanChannel(channel);
      if (ch !== '') return parsed(this.toTitleCase(ch), this.toTitleCase(cleaned), 0.6, 'channel');
    }

    return parsed('', this.toTitleCase(cleaned), 0.3, 'fallback');
  }

  // cleanTitle removes noise, emojis and karaoke markers, preserving casing.
  cleanTitle(title) {
    let result = title;
    result = result.replace(leadingEmojiRe, '');
    result = result.replace(cjkBracketRe, ' ');
    for (const re of noisePatternRes) result = result.replace(re, '');
    result = result.replace(karaokeStripRe, '');
    result = result.replace(equalsRunRe, ' - ');
    result = result.replace(looseDashAfterRe, '$1 - ');
    result = result.replace(looseDashBeforeRe, ' - $1');
    result = result.replace(hashtagRe, '');
    result = result.replace(trailingNoiseRe, '');
    result = trimRightChars(result, '*');
    result = stripFeaturing(result);
    result = result.replace(shortParenRe, ' ');
    result = result.replace(shortBracketRe, ' ');
    result = result.replace(emojiRe, '');
    result = result.replace(versionRe, '');
    result = result.replace(whitespaceRe, ' ');
    result = trimSpace(result);
    result = trimLeftChars(result, '-–—|/►♪♬•* ');
    result = trimRightChars(result, '-–—|/►♪♬•* ');
    return trimSpace(result);
  }

  // parseBySeparator splits on the best separator, handling several
  // separators ("Artist - Song - Karaoke"). Parts repeating sourceName (a
  // karaoke channel's name) are discarded.
  parseBySeparator(title, channel, sourceName, hints, karaokePrefixed) {
    for (const sep of separators) {
      const parts = title.split(sep);
      if (parts.length < 2) continue;

      let nonEmpty = [];
      for (let p of parts) {
        p = trimChars(p, '-–—|=* ');
        if (p === '' || this.isNoise(p) || (sourceName !== '' && nameKey(p) === nameKey(sourceName))) continue;
        nonEmpty.push(p);
      }
      // Videoke channels prepend a numeric song code: "04083 - Artist - Song".
      if (nonEmpty.length >= 3 && videokeCodeRe.test(nonEmpty[0])) nonEmpty = nonEmpty.slice(1);

      if (nonEmpty.length < 2) continue;

      if (nonEmpty.length === 2) {
        const [artist, song] = this.pickArtistSong(nonEmpty[0], nonEmpty[1], channel, hints, karaokePrefixed);
        return parsed(this.toTitleCase(artist), this.toTitleCase(song), 0.9, 'separator');
      }

      // 3+ parts: a part that is a known catalog artist wins.
      for (let i = 0; i < nonEmpty.length; i++) {
        const canonical = findCatalogArtist(nonEmpty[i], hints.artists);
        if (canonical !== '') {
          return parsed(canonical, this.toTitleCase(removeIndex(nonEmpty, i).join(' ')), 0.85, 'separator-catalog');
        }
      }

      // Then the channel hint, then position heuristics.
      if (channel !== '') {
        const ch = goLower(this.cleanChannel(channel));
        for (let i = 0; i < nonEmpty.length; i++) {
          const part = goLower(nonEmpty[i]);
          if (part === ch || part.includes(ch) || ch.includes(part)) {
            return parsed(this.toTitleCase(nonEmpty[i]), this.toTitleCase(removeIndex(nonEmpty, i).join(' ')), 0.85, 'separator-channel');
          }
        }
      }

      // Karaoke-prefixed titles: the last part is the artist.
      if (karaokePrefixed) {
        const last = nonEmpty.length - 1;
        return parsed(this.toTitleCase(nonEmpty[last]), this.toTitleCase(nonEmpty.slice(0, last).join(' ')), 0.8, 'separator-multi-karaoke');
      }

      // Default: first part is artist, rest is song.
      return parsed(this.toTitleCase(nonEmpty[0]), this.toTitleCase(nonEmpty.slice(1).join(' ')), 0.8, 'separator-multi');
    }
    return { ...EMPTY };
  }

  // parseByIndicator looks for "by Artist" style patterns.
  parseByIndicator(title) {
    const lower = goLower(title);
    for (const ind of ['by ', 'performed by ', 'sung by ']) {
      // Go byte offsets of the lowercased title applied to the original.
      const idx = byteIndex(lower, ind);
      if (idx <= 0) continue;
      const song = trimSpace(sliceBytes(title, 0, idx));
      let artist = trimSpace(sliceBytes(title, idx + ind.length));
      for (const sep of [' - ', ' | ', ' (']) {
        const i = artist.indexOf(sep);
        if (i > 0) artist = artist.slice(0, i);
      }
      if (artist !== '' && song !== '') {
        return parsed(this.toTitleCase(artist), this.toTitleCase(song), 0.8, 'by-pattern');
      }
    }
    return { ...EMPTY };
  }

  // parseByStyleOf extracts the artist from "in the style of"-type phrasing,
  // taking the rest of the title as the song.
  parseByStyleOf(title) {
    title = title.replace(singAlongRe, '');
    const m = styleOfRe.exec(title);
    if (!m) return { ...EMPTY };
    const artist = trimSpace(m[1]);
    const rest = title.slice(0, m.index) + ' ' + title.slice(m.index + m[0].length);
    let song = this.cleanTitle(rest);
    // Drop a trailing "- Artist" repeated after the song.
    for (const sep of separators) {
      const i = song.indexOf(sep);
      if (i > 0 && nameKey(song.slice(i + sep.length)) === nameKey(artist)) song = song.slice(0, i);
    }
    if (artist === '' || song === '') return { ...EMPTY };
    return parsed(this.toTitleCase(artist), this.toTitleCase(song), 0.85, 'style-of');
  }

  // parseByKnownArtist splits a separator-less title whose leading or trailing
  // words are a known catalog artist, preferring the longest such artist.
  parseByKnownArtist(title, artists) {
    const flds = fields(title);
    let bestArtist = '';
    let bestSong = '';
    let bestLen = 0;
    // Words of each leading/trailing run of fields, computed once per title.
    const lead = [];
    const trail = [];
    const leadWords = (n) => lead[n] ?? (lead[n] = matchWords(flds.slice(0, n).join(' ')));
    const trailWords = (n) => trail[n] ?? (trail[n] = matchWords(flds.slice(n).join(' ')));
    for (const { name, target, targetLen } of artistIndex(artists).names) {
      if (targetLen <= bestLen) continue;
      // Leading: accumulate fields until their words equal the artist's.
      for (let n = 1; n < flds.length; n++) {
        const w = leadWords(n);
        if (w === target) {
          bestArtist = name; bestSong = flds.slice(n).join(' '); bestLen = targetLen;
          break;
        }
        if (!target.startsWith(w)) break;
      }
      if (targetLen <= bestLen) continue;
      // Trailing.
      for (let n = flds.length - 1; n > 0; n--) {
        const w = trailWords(n);
        if (w === target) {
          bestArtist = name; bestSong = flds.slice(0, n).join(' '); bestLen = targetLen;
          break;
        }
        if (!target.endsWith(w)) break;
      }
    }
    if (bestArtist === '' || trimSpace(bestSong) === '') return { ...EMPTY };
    return parsed(bestArtist, this.toTitleCase(bestSong), 0.75, 'catalog-artist');
  }

  // pickArtistSong decides which of two parts is the artist: channel hint,
  // catalog n-gram similarity, karaoke-prefix tiebreaker, then "Artist - Song".
  pickArtistSong(left, right, channel, hints, karaokePrefixed) {
    if (channel !== '') {
      const ch = goLower(this.cleanChannel(channel));
      if (fuzzyMatch(goLower(left), ch)) return [left, right];
      if (fuzzyMatch(goLower(right), ch)) return [right, left];
    }

    if (hints.artists.length > 0) {
      const leftArtist = bestNgramMatch(left, hints.artists);
      const rightArtist = bestNgramMatch(right, hints.artists);
      const leftSong = bestNgramMatch(left, hints.songs);
      const rightSong = bestNgramMatch(right, hints.songs);
      if (leftArtist >= minHintScore && leftArtist - rightArtist >= minHintMargin && leftArtist > leftSong) {
        return [left, right];
      }
      if (rightArtist >= minHintScore && rightArtist - leftArtist >= minHintMargin && rightArtist > rightSong) {
        return [right, left];
      }
    }

    if (karaokePrefixed) return [right, left];

    const leftLower = goLower(left);
    if (leftLower.startsWith('karaoke') || leftLower.startsWith('karaokê')) return [right, left];

    return [left, right];
  }

  // isNoise checks if a string is just noise/filler after separator splitting.
  isNoise(s) {
    const lower = goLower(trimSpace(s));
    if (noiseWords.has(lower)) return true;
    return noisePrefixes.some((p) => lower.startsWith(p));
  }

  // cleanChannel strips common YouTube channel suffixes.
  cleanChannel(channel) {
    let lower = goLower(channel);
    let result = channel;
    for (const s of channelSuffixes) {
      if (lower.endsWith(s)) {
        result = result.slice(0, result.length - s.length);
        lower = goLower(result);
      }
    }
    return trimSpace(result);
  }

  // toTitleCase cases a field scraped from a YouTube title (see titleCaseRaw).
  toTitleCase(s) {
    return titleCaseRaw(s);
  }

  // extractFeaturing extracts featured artists from a title. A name ends at
  // the next bracket, an artist/song separator ("ft. X - Song") or the end.
  extractFeaturing(title) {
    const featuring = [];
    for (const re of featuringPatterns) {
      for (const match of title.matchAll(re)) {
        const feat = trimSpace(match[1]);
        for (let part of feat.split(featSplitRe)) {
          part = trimSpace(part);
          if (part !== '') featuring.push(this.toTitleCase(part));
        }
      }
    }
    return featuring;
  }
}
