// Port of services/language_detect.go, language_chain.go and
// lyrics_language.go: offline language detection for songs.
//
// The language chain decides a song's language from the strongest evidence
// available, in this order:
//  1. the lead artist's other songs in the catalog (artistLanguageFrom);
//  2. the language of the song's lyrics, when a lyric source found them;
//  3. the script of the YouTube title (Japanese / Korean);
//  4. word, accent and keyword scoring of the YouTube title (titleLanguage);
//  5. the configured default language.
// Lyrics cannot tell Brazilian from European Portuguese, so Portuguese is
// PT-BR unless the artist rule says PT.

import { goRe, goLower, goUpper, trimSpace, trimChars, nameKey, primaryArtist } from './normalize.js';

// minArtistSongsForLanguage is how many existing songs an artist needs
// before their language is trusted over the detector.
export const minArtistSongsForLanguage = 2;
// minArtistLanguageShare is the share of those songs that must agree.
export const minArtistLanguageShare = 0.75;

// Reasons reported with each guess.
export const LangReasonArtist = 'artist';
export const LangReasonLyrics = 'lyrics';
export const LangReasonScript = 'script';
export const LangReasonTitle = 'title';
export const LangReasonDefault = 'default';

export function clamp01(f) {
  if (f < 0) return 0;
  if (f > 1) return 1;
  return f;
}

// ---------------------------------------------------------------------------
// language_detect.go
// ---------------------------------------------------------------------------

// karaokeLangRe matches "karaoke" in any accented spelling (no \b: RE2's word
// boundary is ASCII-only, so it never matched after the ê of "karaokê").
const karaokeLangRe = goRe('(?i)karaok[eêéÊÉ]s?', 'g');
const cjkBracketLangRe = goRe('【[^】]*】', 'g');
const leadingNotesRe = goRe(String.raw`^[♬♪\s]+`, 'g');

// sanitizeTitleForLang strips karaoke markers and CJK brackets from a title
// before language detection so they don't produce false signals.
export function sanitizeTitleForLang(title) {
  let t = title.replace(cjkBracketLangRe, '');
  t = t.replace(karaokeLangRe, '');
  t = t.replace(leadingNotesRe, '');
  return trimSpace(t);
}

// detectLanguage guesses a song's language from its YouTube title and
// description (the offline steps of the chain, then the default language).
export function detectLanguage(title, description, defaultLanguage = '') {
  return chooseLanguage({ title, description, default: defaultLanguage });
}

function isKana(cp) {
  return (cp >= 0x3040 && cp <= 0x309f) || (cp >= 0x30a0 && cp <= 0x30ff);
}
function isHangulRange(cp) {
  return (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff);
}
function containsAny(s, chars) {
  for (const c of chars) if (s.includes(c)) return true;
  return false;
}

// detectObvious checks for unmistakable character patterns and keywords that
// conclusively identify a language. title/description should already be
// sanitized by the caller.
export function detectObvious(title, description) {
  const combined = title + ' ' + description;

  // Genuine Hiragana/Katakana/Hangul in the title (bare Kanji is ambiguous).
  for (const c of title) {
    const cp = c.codePointAt(0);
    if (isKana(cp)) return 'JA';
    if (isHangulRange(cp)) return 'KO';
  }

  // "Romaji"/"Romanized" are used specifically for Japanese transliteration.
  const lower = goLower(combined);
  if (lower.includes('romaji') || lower.includes('romanized')) return 'JA';

  // ã/õ are exclusive to Portuguese; ç also appears in French.
  if (containsAny(combined, 'ãõÃÕ')) return 'PT-BR';
  if (containsAny(combined, 'çÇ')) {
    const frenchMarkers = ['français', 'française', 'chanson', 'garçon'];
    if (!frenchMarkers.some((m) => lower.includes(m))) return 'pt-BR';
  }

  if (containsAny(combined, 'ñÑ')) return 'ES';
  return '';
}

const wordRe = /[\p{L}\p{N}]+/gu;

// heuristicLanguage scores languages by common words, keywords and accent
// patterns in title and description; "" when nothing scores.
export function heuristicLanguage(title, description) {
  // "Karaokê"/"karaoké" are not evidence of anything.
  const combined = goLower((title + ' ' + description).replace(karaokeLangRe, ' '));
  const words = combined.match(wordRe) || [];

  const scores = new Map();
  const bump = (lang, n) => scores.set(lang, (scores.get(lang) || 0) + n);
  for (const word of words) {
    const lang = commonWordLang.get(word);
    if (lang !== undefined) bump(lang, 1);
  }
  // Keyword/genre indicators (3 points each).
  for (const [lang, keywords] of langKeywords) {
    for (const kw of keywords) if (combined.includes(kw)) bump(lang, 3);
  }
  // Accent patterns (2 points).
  for (const [lang, re] of langCharPatterns) {
    if (re.test(combined)) bump(lang, 2);
  }

  // Highest score; ties broken by name.
  const langs = [...scores.keys()].sort();
  let bestLang = '';
  let bestScore = 0;
  for (const lang of langs) {
    if (scores.get(lang) > bestScore) {
      bestLang = lang;
      bestScore = scores.get(lang);
    }
  }
  return bestLang;
}

// detectByScript checks for non-Latin scripts that conclusively identify a language.
export function detectByScript(text) {
  for (const c of text) {
    const cp = c.codePointAt(0);
    if (isKana(cp)) return 'JA';
    if (isHangulRange(cp)) return 'KO';
  }
  return '';
}

// langCharPatterns match accent patterns characteristic of specific languages.
const langCharPatterns = new Map([
  ['PT-BR', /[ãõçÃÕÇ]/u],
  // ê and ô are left out: Portuguese uses them as much (você, três, avô).
  ['FR', /[ëîïùûüœæËÎÏÙÛÜŒÆ]/u],
  ['DE', /[ßäöÄÖ]/u],
]);

// langKeywords are genre/context keywords that strongly indicate a language.
const langKeywords = new Map([
  ['PT-BR', [
    'português', 'brasil', 'brasileir', 'letra:', 'letra da música',
    'sertanejo', 'mpb', 'axé', 'forró', 'pagode', 'bossa nova',
    'samba', 'funk carioca', 'baião', 'maracatu', 'frevo',
  ]],
  ['PT', ['portugal', 'fado', 'português europeu']],
  ['ES', [
    'español', 'spanish', 'reggaeton', 'reggaetón',
    'bachata', 'salsa', 'cumbia', 'merengue', 'ranchera',
    'corrido', 'vallenato', 'bolero', 'mariachi',
  ]],
  ['JA', ['日本語', 'japanese', 'jpop', 'j-pop', 'アニメ', 'anime', 'enka', '演歌', 'vocaloid']],
  ['KO', ['한국어', 'korean', 'kpop', 'k-pop', 'trot', '트로트']],
  ['FR', ['français', 'french', 'chanson', 'chanson française']],
  ['IT', ['italiano', 'italian', 'canzone', 'musica italiana', 'sanremo']],
  ['DE', ['deutsch', 'german', 'schlager', 'volksmusik']],
  ['EN', ['english', 'country music', 'r&b', 'hip hop', 'hip-hop', 'rock and roll', 'blues']],
]);

// commonWordLang maps frequent, language-distinctive words to their language.
const commonWordLang = new Map();
for (const [lang, list] of Object.entries({
  'PT-BR': 'você não pra meu minha seu sua tudo mais quando sempre coração amor saudade beijo demais então olhos noite mundo vou quero deixa aqui ainda nunca essa esse como até muito estou ficar manias cheia coloridos durou dela canção música estar',
  ES: 'corazón canción noche quiero donde siempre porque ahora puede mujer hombre tiempo ella pero todo esta tiene desde también después otra otro',
  FR: 'je nous vous avec dans pour une qui sur sont être avoir amour coeur toujours jamais aime rien tout mon vie',
  IT: 'amore che sono della questo questa anche perché cuore tutto bello bella voglio ancora notte nel blu mio mia sei cosa così',
  DE: 'ich und ist nicht ein eine haben werden schon wenn liebe herz nacht welt immer wieder mein dein über nur auch mir dir',
  EN: 'the you love heart night baby dream world never always forever tonight without believe together missing feeling dancing',
})) {
  for (const w of list.split(' ')) commonWordLang.set(w, lang);
}

// ---------------------------------------------------------------------------
// lyrics_language.go
// ---------------------------------------------------------------------------

const HIRAGANA = /\p{Script=Hiragana}/u;
const KATAKANA = /\p{Script=Katakana}/u;
const HANGUL = /\p{Script=Hangul}/u;
const HAN = /\p{Script=Han}/u;
const LETTER = /\p{L}/u;

// detectLyricsLanguage classifies a block of lyrics into PT-BR, EN, ES, FR,
// IT, DE, JA or KO; {lang: '', confidence: 0} when too short or ambiguous.
// Japanese/Korean by script; Latin-script languages by function-word
// frequency plus accent hints. confidence is in 0..1.
export function detectLyricsLanguage(text) {
  text = text || '';
  let kana = 0, hangul = 0, han = 0, letters = 0;
  for (const c of text) {
    if (HIRAGANA.test(c) || KATAKANA.test(c)) { kana++; letters++; }
    else if (HANGUL.test(c)) { hangul++; letters++; }
    else if (HAN.test(c)) { han++; letters++; }
    else if (LETTER.test(c)) letters++;
  }
  const none = { lang: '', confidence: 0 };
  if (letters === 0) return none;
  const minCJK = 6;
  if (kana >= 3 && (kana + han) / letters >= 0.4 && kana + han >= minCJK) {
    return { lang: 'JA', confidence: clamp01((kana + han) / letters) };
  }
  if (hangul >= minCJK && hangul / letters >= 0.4) {
    return { lang: 'KO', confidence: clamp01(hangul / letters) };
  }
  if ((kana + hangul + han) / letters > 0.3) return none; // e.g. Chinese

  const words = lyricTokens(text);
  if (words.length < 6) return none;

  const scores = new Map();
  for (const [lang, set] of stopWordSets) {
    // A word several languages share is weak evidence: 1/(languages listing it).
    let hits = 0;
    for (const w of words) if (set.has(w)) hits += 1 / wordLangCount.get(w);
    scores.set(lang, hits);
  }
  for (const [r, n] of accentCounts(text)) {
    for (const [lang, w] of Object.entries(accentHints.get(r))) {
      scores.set(lang, (scores.get(lang) || 0) + w * n);
    }
  }

  const sc = (lang) => scores.get(lang) || 0;
  let best = '', second = '';
  for (const lang of lyricLangOrder) {
    if (best === '' || sc(lang) > sc(best)) {
      second = best;
      best = lang;
    } else if (second === '' || sc(lang) > sc(second)) {
      second = lang;
    }
  }
  const n = words.length;
  const s1 = sc(best) / n;
  const s2 = sc(second) / n;
  if (s1 < 0.08 || s1 - s2 < 0.04 || s1 < 1.3 * s2) return none;
  const coverage = clamp01(s1 / 0.25);
  const margin = (s1 - s2) / s1;
  return { lang: best, confidence: clamp01(0.5 * coverage + 0.5 * margin) };
}

const tokenSplitRe = /[^\p{L}']+/u;

// lyricTokens lowercases text and splits it into words, keeping inner
// apostrophes (don't, l'amour). Elided French/Italian prefixes become "l'".
export function lyricTokens(text) {
  text = goLower(text).replaceAll('’', "'");
  const out = [];
  for (let f of text.split(tokenSplitRe)) {
    if (f === '') continue;
    f = trimChars(f, "'");
    if (f === '') continue;
    const i = f.indexOf("'");
    if (i > 0) {
      if (englishContraction.has(f)) {
        out.push(f);
        continue;
      }
      out.push(f.slice(0, i + 1));
      const rest = f.slice(i + 1);
      if (rest !== '') out.push(rest);
      continue;
    }
    out.push(f);
  }
  return out;
}

function accentCounts(text) {
  const m = new Map();
  for (const c of goLower(text)) {
    if (accentHints.has(c)) m.set(c, (m.get(c) || 0) + 1);
  }
  return m;
}

const lyricLangOrder = ['PT-BR', 'EN', 'ES', 'FR', 'IT', 'DE'];

// accentHints give a small bonus (in "word equivalents") to languages that
// favour a character.
const accentHints = new Map([
  ['ã', { 'PT-BR': 1.5 }], ['õ', { 'PT-BR': 1.5 }],
  ['ñ', { ES: 1.5 }], ['¿', { ES: 1.5 }], ['¡', { ES: 1.5 }],
  ['ß', { DE: 1.5 }], ['ä', { DE: 1 }], ['ö', { DE: 1 }], ['ü', { DE: 1 }],
  ['œ', { FR: 1.5 }], ['ë', { FR: 1 }], ['î', { FR: 1 }], ['ù', { FR: 0.5, IT: 0.5 }],
  ['ì', { IT: 1 }], ['ò', { IT: 1 }],
]);

const englishContraction = new Set(["don't", "i'm", "i'll", "i've", "i'd", "it's", "that's", "can't", "won't",
  "you're", "you'll", "you've", "we're", "they're", "he's", "she's", "isn't", "ain't", "let's",
  "what's", "there's", "didn't", "doesn't", "couldn't", "wouldn't", "gonna'", "'cause"]);

const stopWordSets = new Map([
  ['EN', new Set([
    'the', 'and', 'you', 'i', 'to', 'me', 'my', 'in', 'of', 'it', 'is', 'that', 'on', 'for',
    'with', 'your', 'be', 'are', 'was', 'but', 'not', 'all', 'we', 'this', 'so', 'just', 'can',
    'if', 'when', 'what', 'up', 'like', 'do', 'know', 'now', 'there', 'they', 'she', 'he',
    'her', 'his', 'am', 'have', 'will', 'never', 'only', 'got', 'love', 'oh', 'baby', 'over',
    'from', 'out', 'away', 'how', 'us', 'our', 'am', 'at', 'or', 'as', 'been', 'come',
    ...englishContraction,
  ])],
  ['PT-BR', new Set([
    'não', 'você', 'uma', 'com', 'meu', 'minha', 'é', 'pra', 'para', 'que', 'de', 'do', 'da',
    'em', 'um', 'os', 'as', 'eu', 'te', 'me', 'se', 'mais', 'mas', 'por', 'está', 'ser', 'tem',
    'estou', 'seu', 'sua', 'nos', 'dos', 'das', 'vou', 'quando', 'como', 'só', 'já', 'ao', 'aos',
    'nem', 'ela', 'ele', 'tudo', 'nada', 'amor', 'vida', 'muito', 'ainda', 'sempre', 'depois',
    'isso', 'esse', 'essa', 'aqui', 'lá', 'hoje', 'sem', 'sobre', 'nós', 'eles', 'pois', 'quero',
    'vocês', 'comigo', 'onde', 'assim', 'também',
  ])],
  ['ES', new Set([
    'no', 'tú', 'tu', 'una', 'con', 'mi', 'y', 'el', 'los', 'las', 'un', 'de', 'la', 'que',
    'en', 'te', 'me', 'se', 'es', 'por', 'para', 'pero', 'yo', 'lo', 'le', 'si', 'sin', 'como',
    'cuando', 'quiero', 'estoy', 'está', 'eres', 'soy', 'ya', 'muy', 'todo', 'nada', 'amor',
    'vida', 'hoy', 'aquí', 'siempre', 'ella', 'él', 'nos', 'del', 'al', 'ni', 'porque', 'esto',
    'voy', 'tengo', 'tiene', 'mis', 'tus', 'su', 'sus', 'dice', 'más', 'cómo', 'qué', 'donde',
  ])],
  ['FR', new Set([
    'le', 'la', 'les', 'des', 'un', 'une', 'et', 'est', 'je', 'tu', 'il', 'elle', 'nous',
    'vous', 'ils', 'de', 'du', 'pas', 'ne', 'que', 'qui', 'dans', 'pour', 'sur', 'avec', 'mon',
    'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'ce', 'cette', 'au', 'aux', 'en',
    'suis', 'plus', 'tout', 'mais', 'ou', 'où', 'comme', 'si', 'sans', 'même', 'être', 'ai',
    'fait', 'quand', 'ça', 'toi', 'moi', 'me', 'te', 'se', 'rien', 'bien', 'on', 'y', 'très',
    "l'", "d'", "j'", "qu'", "c'", "n'", "m'", "t'", "s'",
  ])],
  ['IT', new Set([
    'il', 'lo', 'la', 'le', 'gli', 'i', 'un', 'uno', 'una', 'e', 'è', 'di', 'da', 'in', 'con',
    'su', 'per', 'tra', 'fra', 'che', 'non', 'mi', 'ti', 'ci', 'si', 'vi', 'io', 'tu', 'lui',
    'lei', 'noi', 'voi', 'loro', 'mio', 'mia', 'miei', 'tuo', 'tua', 'suo', 'sua', 'questo',
    'questa', 'come', 'ma', 'se', 'più', 'anche', 'sono', 'sei', 'ho', 'hai', 'ha', 'siamo',
    'cuore', 'amore', 'vita', 'tutto', 'niente', 'sempre', 'solo', 'quando', 'dove', 'perché',
    'già', 'così', 'del', 'della', 'dei', 'delle', 'nel', 'nella', 'al', 'alla', 'ai', 'ancora',
    "all'", "dell'", "un'", "l'", "d'", "c'", "quest'", "nell'",
  ])],
  ['DE', new Set([
    'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'und', 'ich', 'du', 'er',
    'sie', 'es', 'wir', 'ihr', 'ist', 'bin', 'bist', 'sind', 'war', 'nicht', 'mit', 'von', 'zu',
    'auf', 'für', 'im', 'in', 'am', 'an', 'aus', 'bei', 'nach', 'über', 'mein', 'meine', 'dein',
    'deine', 'mir', 'mich', 'dich', 'dir', 'uns', 'dass', 'wenn', 'wie', 'was', 'wo', 'aber',
    'oder', 'auch', 'noch', 'nur', 'schon', 'immer', 'nie', 'liebe', 'herz', 'ja', 'nein',
    'mehr', 'wieder', 'alles', 'hast', 'hat', 'habe', 'sind', 'sein', 'etwas',
  ])],
]);

// wordLangCount[w] is how many stop-word lists contain w.
const wordLangCount = new Map();
for (const set of stopWordSets.values()) {
  for (const w of set) wordLangCount.set(w, (wordLangCount.get(w) || 0) + 1);
}

// ---------------------------------------------------------------------------
// language_chain.go
// ---------------------------------------------------------------------------

// lyricsLanguage runs lyric-text detection, mapping Portuguese to the
// artist's PT when the artist rule says so.
export function lyricsLanguage(text, artistLang = '') {
  let { lang, confidence } = detectLyricsLanguage(text);
  if (lang === 'PT-BR' && goUpper(artistLang || '') === 'PT') lang = 'PT';
  return { lang, confidence };
}

const reasonRank = {
  [LangReasonArtist]: 0, [LangReasonLyrics]: 1, [LangReasonScript]: 2,
  [LangReasonTitle]: 3, [LangReasonDefault]: 4,
};

// rankLanguages returns the chain's guesses ({id, confidence, reason}), best
// first, one per language. The first entry is the chain's answer; it is never
// empty (the default, or EN, closes the chain).
// Evidence: {artistLanguage, lyricsText, title, description, default}.
export function rankLanguages(ev = {}) {
  const guesses = [];
  const add = (id, conf, reason) => {
    id = goUpper(trimSpace(id || ''));
    if (id === '') return;
    for (const g of guesses) {
      if (g.id === id) {
        // Independent evidence agreeing makes the guess stronger.
        g.confidence = clamp01(g.confidence + (1 - g.confidence) * conf * 0.5);
        return;
      }
    }
    guesses.push({ id, confidence: conf, reason });
  };

  const artistLanguage = ev.artistLanguage || '';
  add(artistLanguage, 0.95, LangReasonArtist);
  if (ev.lyricsText) {
    const { lang, confidence } = lyricsLanguage(ev.lyricsText, artistLanguage);
    if (lang !== '') add(lang, 0.6 + 0.3 * confidence, LangReasonLyrics);
  }
  const title = ev.title || '';
  const description = ev.description || '';
  add(detectByScript(sanitizeTitleForLang(title)), 0.85, LangReasonScript);
  add(titleLanguage(title, description), 0.45, LangReasonTitle);
  const def = ev.default || ev.defaultLanguage || 'EN';
  add(def, 0.15, LangReasonDefault);

  // Precedence decides the order (Array.prototype.sort is stable).
  guesses.sort((a, b) => reasonRank[a.reason] - reasonRank[b.reason]);
  return guesses;
}

// chooseLanguage is rankLanguages' answer.
export function chooseLanguage(ev) {
  return rankLanguages(ev)[0].id;
}

// titleLanguage is the word/accent/keyword heuristic on the YouTube title and
// description ("" when nothing points anywhere). It never falls back to a default.
export function titleLanguage(title, description = '') {
  const clean = sanitizeTitleForLang(title);
  const lang = detectObvious(clean, description);
  if (lang !== '') return goUpper(lang);
  return heuristicLanguage(clean, description);
}

// artistLanguageFrom returns the language most of the lead artist's songs in
// pairs ([{songId, artist, language}]) use, or "" when the artist has fewer
// than minArtistSongsForLanguage songs or they disagree.
export function artistLanguageFrom(pairs, artist) {
  const lead = nameKey(primaryArtist(artist || ''));
  if (lead === '') return '';
  const counts = new Map();
  let total = 0;
  for (const p of pairs || []) {
    if (p.language && nameKey(primaryArtist(p.artist || '')) === lead) {
      const lang = goUpper(p.language);
      counts.set(lang, (counts.get(lang) || 0) + 1);
      total++;
    }
  }
  if (total < minArtistSongsForLanguage) return '';
  for (const [lang, n] of counts) {
    if (n / total >= minArtistLanguageShare) return lang;
  }
  return '';
}
