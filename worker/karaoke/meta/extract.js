// Port of services/metadata_extract.go and lyrics_description.go: heuristic
// song metadata (artist, title, language, first lyric line) from YouTube
// video info. The DJ reviews the result before a song is saved.

import { trimSpace, goLower, utf8Len, byteIndex, sliceBytes, addFeaturedArtists } from './normalize.js';
import { TitleParser } from './title_parser.js';
import { detectLanguage } from './language.js';
import { catalogHints, findDuplicateSongs } from './catalog_meta.js';

// extractMusicMetadata parses artist/title with the TitleParser (catalog
// names as hints), detects the language and scrapes the first lyric line
// from the description. `songs` is the live catalog (song objects with JSON
// field names); omit it to run without catalog hints or duplicate checks.
// Returns an object shaped like models.MusicMetadata's JSON.
export function extractMusicMetadata({ videoTitle = '', channel = '', description = '', songs, defaultLanguage = '' } = {}) {
  const parser = new TitleParser();
  const hints = songs ? catalogHints(songs) : { artists: [], songs: [] };
  const parsed = parser.parseWithHints(videoTitle, channel, hints);

  const language = detectLanguage(videoTitle, description, defaultLanguage);
  const lyricsStart = extractLyricsFromDescription(description);

  // Featured artists are credited in the artist field ("Rihanna; Drake");
  // cleanTitle has already removed them from the song title.
  let artist = cleanString(parsed.artist);
  const featuring = parser.extractFeaturing(videoTitle);
  if (featuring.length > 0 && artist !== '') artist = addFeaturedArtists(artist, featuring);

  const metadata = {
    title: cleanString(parsed.song),
    artist,
    language,
    lyrics_start: lyricsStart,
    original_title: videoTitle,
    confidence: parsed.confidence,
    is_duplicate: false,
  };

  if (songs) {
    const duplicates = findDuplicateSongs(songs, metadata.title, metadata.artist);
    if (duplicates.length > 0) {
      metadata.is_duplicate = true;
      metadata.duplicate_of = duplicates[0];
    }
  }
  return metadata;
}

export function cleanString(s) {
  s = trimSpace(s || '');
  while (s.includes('  ')) s = s.replaceAll('  ', ' ');
  return s;
}

const lyricsMarkers = [
  'letra:', 'lyrics:', '[letra]', '[lyrics]',
  'letra da música:', 'song lyrics:',
  '🎵', '🎤', '♪', '♫',
];

// extractLyricsFromDescription tries to find the first lyric line in a video
// description. Lengths and offsets are Go byte counts, as in the original.
export function extractLyricsFromDescription(description) {
  if (!description) return '';
  const lines = description.split('\n');
  let foundLyricsSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = goLower(trimSpace(line));
    for (const marker of lyricsMarkers) {
      if (!lineLower.includes(marker)) continue;
      foundLyricsSection = true;

      // Content after the marker on the same line. (Go applies the offset
      // found in the trimmed, lowercased line to the raw line; kept as is.)
      const idx = byteIndex(lineLower, marker);
      if (idx >= 0) {
        const afterMarker = trimSpace(sliceBytes(line, idx + utf8Len(marker)));
        if (utf8Len(afterMarker) > 10 && !isTimestamp(afterMarker) && !isURL(afterMarker)) {
          return truncateLyrics(afterMarker);
        }
      }

      // Otherwise, the next non-empty line.
      for (let j = i + 1; j < lines.length && j < i + 5; j++) {
        const nextLine = trimSpace(lines[j]);
        if (utf8Len(nextLine) > 10 && !isTimestamp(nextLine) && !isURL(nextLine) && !isCredits(nextLine)) {
          return truncateLyrics(nextLine);
        }
      }
    }
  }

  // A lyrics section without a clear first line: take a verse-like line.
  if (foundLyricsSection) {
    for (let line of lines) {
      line = trimSpace(line);
      const n = utf8Len(line);
      if (n > 15 && n < 100 && !isTimestamp(line) && !isURL(line) && !isCredits(line) &&
        !goLower(line).startsWith('http')) {
        return truncateLyrics(line);
      }
    }
  }
  return '';
}

const timestampRe = /^\d{1,2}:\d{2}(:\d{2})?/;

// isTimestamp checks if a string looks like a timestamp ("0:00", "00:00:00").
export function isTimestamp(s) {
  return timestampRe.test(s);
}

// isURL checks if a string is a URL.
export function isURL(s) {
  const l = goLower(s);
  return l.startsWith('http') || l.startsWith('www.');
}

const creditPatterns = [
  'compositor:', 'written by', 'produced by', 'arranged by',
  'copyright', '©', '℗', 'all rights reserved',
  'subscribe', 'inscreva', 'like & share',
];

// isCredits checks if a line looks like credits.
export function isCredits(s) {
  const lower = goLower(s);
  return creditPatterns.some((p) => lower.includes(p));
}

// truncateLyrics truncates lyrics to max 80 bytes, preferring a word boundary.
export function truncateLyrics(s) {
  s = trimSpace(s);
  if (utf8Len(s) > 80) {
    const head = sliceBytes(s, 0, 80);
    const sp = head.lastIndexOf(' ');
    const idx = sp < 0 ? -1 : utf8Len(head.slice(0, sp));
    if (idx > 50) return sliceBytes(s, 0, idx) + '...';
    return sliceBytes(s, 0, 77) + '...';
  }
  return s;
}
