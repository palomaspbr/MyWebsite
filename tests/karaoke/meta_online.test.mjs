// Ported from the Go tests in services/: metadata_lookup_test.go,
// lyrics_search_test.go, lyrics_lrclib_test.go and the review-suggestion cases
// of review_test.go (the background worker and database-only cases are
// skipped; the catalog is a songs array). The network is never touched: a fake
// fetch maps the production URLs to handlers and fixtures.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  refine, candidates, pairSimilarity, diceTrigram, scoreResult, accepted, catalogNames,
  httpGetWithRetry, normalizeForMatch,
} from '../../worker/karaoke/meta/lookup.js';
import {
  findCandidates, findCandidatesStrict, searchLyrics, searchLyricsFrom, cleanArtistTitle,
  firstSungLine, firstSungExcerpt, cleanLyricLines, extractLyricsFromLetrasMusBr, extractFirstVerse,
  cleanHTMLLyrics, letrasSlug, letrasFind, lrclibFind, letrasPageNames, letrasBlocked, resetLetrasBlock,
  isLetrasBlockedError, isLyricSourcesUnavailable, setText, LRCLIB_USER_AGENT, MIN_CANDIDATE, HITS_PER_SOURCE,
} from '../../worker/karaoke/meta/lyrics.js';
import {
  buildSuggestions, offlineSuggestions, suggestionsView, isStale, reviewDue, toRecord, mergeFirstLines,
  previousFirstLines, NameSourceITunes, NameSourceMusicBrainz, NameSourceCatalog, NameSourceYouTube,
} from '../../worker/karaoke/meta/suggestions.js';
import { isKaraokeRelease } from '../../worker/karaoke/meta/normalize.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'lyrics');
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8');
const noSleep = async () => {};

// ------------------------------------------------------------- fake world

const PREFIXES = {
  itunes: 'https://itunes.apple.com/search',
  mb: 'https://musicbrainz.org/ws/2/recording',
  letras: 'https://www.letras.mus.br/',
  solr: 'https://solr.sscdn.co/letras/app2/',
  lrclib: 'https://lrclib.net/api/',
  ovh: 'https://api.lyrics.ovh/v1/',
};

const notFound = () => ({ status: 404, body: '404 page not found' });
const serve = (body, status = 200) => () => ({ status, body });
// hang waits until the request is aborted (the client gives up).
const hang = (req) => new Promise((_, reject) => {
  const s = req.init.signal;
  if (!s) return;
  if (s.aborted) reject(s.reason);
  s.addEventListener('abort', () => reject(s.reason), { once: true });
});

/** A fake internet: handlers per service, request counts, request log. */
function fakeWorld() {
  const w = {
    handlers: Object.fromEntries(Object.keys(PREFIXES).map((k) => [k, notFound])),
    hits: {},
    requests: [],
    count(name) { return this.hits[name] || 0; },
  };
  w.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const name = Object.keys(PREFIXES).find((k) => String(url).startsWith(PREFIXES[k]));
    if (!name) throw new TypeError(`fetch failed: ${url}`);
    w.hits[name] = (w.hits[name] || 0) + 1;
    const req = { url: u, path: u.pathname, query: u.searchParams, headers: new Headers(init.headers || {}), init };
    w.requests.push(req);
    const r = await w.handlers[name](req);
    return new Response(r.body ?? '', { status: r.status ?? 200 });
  };
  w.opts = (extra = {}) => ({ fetch: w.fetch, sleep: noSleep, letrasDelay: 0, ...extra });
  return w;
}

beforeEach(() => resetLetrasBlock());

// ================================================================ lookup

function lookupWorld(itunesBody, mbBody) {
  const w = fakeWorld();
  w.handlers.itunes = serve(itunesBody);
  w.handlers.mb = serve(mbBody);
  return w;
}

test('refine: iTunes corrects a typo in the seed', async () => {
  const w = lookupWorld('{"resultCount":1,"results":[{"trackName":"Bohemian Rhapsody","artistName":"Queen"}]}', '{"recordings":[]}');
  const m = await refine('queen', 'bohemian rapsody', 'Queen - Bohemian Rapsody (Karaoke)', w.opts());
  assert.ok(m, 'expected a confident match');
  assert.equal(m.source, 'itunes');
  assert.equal(m.artist, 'Queen');
  assert.equal(m.title, 'Bohemian Rhapsody');
  const q = w.requests[0].query;
  assert.equal(q.get('term'), 'queen bohemian rapsody');
  assert.equal(q.get('entity'), 'song');
  assert.equal(q.get('limit'), '8');
});

test('refine: corrects a swapped seed', async () => {
  const w = lookupWorld('{"resultCount":1,"results":[{"trackName":"Bohemian Rhapsody","artistName":"Queen"}]}', '{"recordings":[]}');
  const m = await refine('Bohemian Rhapsody', 'Queen', '', w.opts());
  assert.ok(m);
  assert.equal(m.artist, 'Queen');
  assert.equal(m.title, 'Bohemian Rhapsody');
});

test('refine: rejects low confidence', async () => {
  const w = lookupWorld('{"resultCount":1,"results":[{"trackName":"Baby Shark","artistName":"Pinkfong"}]}',
    '{"recordings":[{"title":"Baby Shark","artist-credit":[{"name":"Pinkfong"}]}]}');
  assert.equal(await refine('Queen', 'Bohemian Rhapsody', '', w.opts()), null);
});

test('refine: falls back to MusicBrainz with its User-Agent', async () => {
  const w = lookupWorld('{"resultCount":0,"results":[]}',
    '{"recordings":[{"title":"Tempo Perdido","artist-credit":[{"name":"Legião Urbana"}]}]}');
  const m = await refine('Legiao Urbana', 'Tempo Perdido', '', w.opts());
  assert.ok(m);
  assert.equal(m.source, 'musicbrainz');
  assert.equal(m.artist, 'Legião Urbana');
  assert.equal(m.title, 'Tempo Perdido');
  const mbReq = w.requests.find((r) => r.url.host === 'musicbrainz.org');
  assert.equal(mbReq.headers.get('User-Agent'), 'karaoke-app/1.0 ( https://github.com/LuanGBR/karaoke )');
  assert.equal(mbReq.query.get('query'), 'recording:"Tempo Perdido" AND artist:"Legiao Urbana"');
  assert.equal(mbReq.query.get('fmt'), 'json');
});

test('pairSimilarity', () => {
  assert.equal(pairSimilarity('Bohemian Rhapsody', 'Bohemian Rhapsody'), 1.0);
  assert.ok(pairSimilarity('Despacito', 'Despacito (Remix)') >= 0.85);
  assert.ok(pairSimilarity('Bohemian Rhapsody', 'Baby Shark') <= 0.4);
  assert.equal(pairSimilarity('', 'x'), 0);
  assert.equal(diceTrigram('abc', 'abc'), 1);
  assert.equal(diceTrigram('', 'abc'), 0);
});

test('scoreResult and accepted', () => {
  assert.ok(scoreResult('Bohemian Rhapsody', 'Queen', 'Queen', 'Bohemian Rhapsody') > 0.99); // swapped
  assert.equal(scoreResult('', 'Hello', 'Adele', 'Hello'), 1);
  assert.equal(accepted(0.56, 'a', 't'), true);
  assert.equal(accepted(0.56, '', 't'), false);
  assert.equal(accepted(0.62, '', 't'), true);
});

test('refine: skips karaoke releases', async () => {
  const w = lookupWorld(`{"resultCount":2,"results":[
    {"trackName":"Like Mariah (Originally Performed by Fifth Harmony) [Karaoke No Guide Melody Version]","artistName":"Edkara"},
    {"trackName":"Like Mariah (feat. Tyga)","artistName":"Fifth Harmony"}]}`, '{"recordings":[]}');
  const m = await refine('Fifth Harmony', 'Like Mariah', '', w.opts());
  assert.ok(m);
  assert.equal(m.artist, 'Fifth Harmony');
});

test('refine: MusicBrainz joins credits with "; "', async () => {
  const w = lookupWorld('{"resultCount":0,"results":[]}', `{"recordings":[{"title":"Make Me Proud","artist-credit":[
    {"name":"Drake","joinphrase":" feat. "},{"name":"Nicki Minaj","joinphrase":""}]}]}`);
  const m = await refine('Drake', 'Make Me Proud', '', w.opts());
  assert.ok(m);
  assert.equal(m.artist, 'Drake; Nicki Minaj');
});

test('refine: falls back to the raw YouTube title', async () => {
  const w = lookupWorld(`{"resultCount":1,"results":[{"trackName":"Just Dance (feat. Colby O'Donis)","artistName":"Lady Gaga"}]}`, '{"recordings":[]}');
  const m = await refine('Sing King', 'Lady Gaga', "Lady Gaga ft. Colby O'Donis - Just Dance (Karaoke Version)", w.opts());
  assert.ok(m, 'expected raw-title match');
  assert.equal(m.artist, 'Lady Gaga');
  assert.equal(m.title, "Just Dance (feat. Colby O'Donis)");
});

test('refine: raw-title match requires both names', async () => {
  const w = lookupWorld('{"resultCount":1,"results":[{"trackName":"Tudo","artistName":"Someone Else"}]}', '{"recordings":[]}');
  assert.equal(await refine('', '', 'Liniker - Tudo (Karaokê)', w.opts()), null);
});

test('candidates: ranked, filtered and normalised', async () => {
  const w = lookupWorld(`{"resultCount":5,"results":[
    {"trackName":"Umbrella (feat. JAY-Z)","artistName":"Rihanna"},
    {"trackName":"Umbrella (Originally Performed by Rihanna)","artistName":"Karaoke Hits Band"},
    {"trackName":"Umbrella","artistName":"Mr. Tribute Singers"},
    {"trackName":"Umbrella - Single Version","artistName":"Rihanna"},
    {"trackName":"Totally Different","artistName":"Somebody Else"}]}`, `{"recordings":[
    {"title":"Umbrella","artist-credit":[{"name":"Rihanna","joinphrase":" feat. "},{"name":"JAY-Z"}]},
    {"title":"Umbrella (In the Style of Rihanna)","artist-credit":[{"name":"Sing Along Stars"}]}]}`);
  const got = await candidates('Rihanna', 'Umbrella', 'Rihanna - Umbrella ft. Jay-Z (Karaoke Version)', 3, w.opts());
  assert.ok(got.length > 0);
  got.forEach((m, i) => {
    assert.ok(!isKaraokeRelease(m.artist, m.title) && m.artist !== 'Somebody Else', `rejected result offered: ${JSON.stringify(m)}`);
    if (i > 0) assert.ok(m.confidence <= got[i - 1].confidence, 'not ordered by confidence');
  });
  const found = new Set(got.map((m) => `${m.source}|${m.artist}|${m.title}`));
  assert.ok(found.has('itunes|Rihanna; JAY-Z|Umbrella'), JSON.stringify(got));
  assert.ok(found.has('musicbrainz|Rihanna; JAY-Z|Umbrella'), JSON.stringify(got));

  const m = await refine('Rihanna', 'Umbrella', '', w.opts());
  assert.ok(m);
  assert.equal(m.artist, 'Rihanna');
  assert.equal(m.title, 'Umbrella (feat. JAY-Z)');
});

test('candidates: per-source cap', async () => {
  const w = lookupWorld(`{"resultCount":4,"results":[
    {"trackName":"Hello","artistName":"Adele"},{"trackName":"Hello","artistName":"Adele"},
    {"trackName":"Hello","artistName":"Adele"},{"trackName":"Hello","artistName":"Adele"}]}`, '{"recordings":[]}');
  const got = await candidates('Adele', 'Hello', '', 2, w.opts());
  assert.equal(got.length, 2);
});

test('candidates: reports unreachable sources, retries with backoff', async () => {
  const w = fakeWorld();
  w.handlers.itunes = serve('', 503);
  w.handlers.mb = serve('', 503);
  const sleeps = [];
  await assert.rejects(candidates('Adele', 'Hello', '', 3, w.opts({ sleep: async (ms) => { sleeps.push(ms); } })), /status 503/);
  assert.equal(w.count('itunes'), 3); // 3 attempts
  assert.equal(w.count('mb'), 2); // 2 attempts
  assert.deepEqual(sleeps, [300, 600, 300]);

  const w2 = lookupWorld('{"resultCount":0,"results":[]}', '{"recordings":[]}');
  assert.deepEqual(await candidates('Adele', 'Hello', '', 3, w2.opts()), []);
});

test('catalogNames', () => {
  const tests = [
    ['Rihanna feat. Drake', "What's My Name?", 'Rihanna; Drake', "What's My Name?"],
    ['Calvin Harris', 'This Is What You Came For (feat. Rihanna)', 'Calvin Harris; Rihanna', 'This Is What You Came for'],
    ['Zezé Di Camargo & Luciano', 'É o Amor', 'Zezé Di Camargo & Luciano', 'É o Amor'],
    ['Major Lazer', 'Lean On (feat. MØ & DJ Snake)', 'Major Lazer; MØ; DJ Snake', 'Lean on'],
    ['queen', 'bohemian rhapsody', 'Queen', 'Bohemian Rhapsody'],
  ];
  for (const [artist, title, wantA, wantT] of tests) {
    assert.deepEqual(catalogNames(artist, title), [wantA, wantT], `catalogNames(${artist}, ${title})`);
  }
});

test('httpGetWithRetry: 4xx returned at once, budget respected, timeout signal passed', async () => {
  const w = fakeWorld();
  w.handlers.ovh = serve('nope', 404);
  const r = await httpGetWithRetry('https://api.lyrics.ovh/v1/a/b', null, 3, w.opts());
  assert.equal(r.status, 404);
  assert.equal(w.count('ovh'), 1);
  assert.ok(w.requests[0].init.signal, 'each fetch gets a timeout signal');

  w.handlers.ovh = serve('', 500);
  const budget = { left: 2 };
  await assert.rejects(httpGetWithRetry('https://api.lyrics.ovh/v1/a/b', null, 5, w.opts({ budget })), (e) => e.transient === true);
  assert.equal(w.count('ovh'), 3);
  assert.equal(budget.left, 0);
});

// ================================================================ lyrics

test('normalizeForMatch', () => {
  const tests = [
    ['José, María!', 'josé maría'],
    ["Don't Stop Me Now", 'don t stop me now'],
    ['  Multiple   Spaces  ', 'multiple spaces'],
    ['AC/DC: Thunderstruck', 'ac/dc thunderstruck'],
  ];
  for (const [i, want] of tests) assert.equal(normalizeForMatch(i), want);
});

test('cleanArtistTitle', () => {
  assert.deepEqual(cleanArtistTitle('Liniker', 'Tudo (Official Video)'), ['Liniker', 'Tudo']);
  assert.deepEqual(cleanArtistTitle('David Guetta feat. Sia', 'Titanium'), ['David Guetta', 'Titanium']);
  assert.deepEqual(cleanArtistTitle('Coldplay', 'Yellow [Live]'), ['Coldplay', 'Yellow']);
});

test('extractFirstVerse', () => {
  assert.equal(extractFirstVerse('[Intro]\n\n[Verse 1]\nIs this the real life?\nIs this just fantasy?'), 'Is this the real life?');
  assert.equal(extractFirstVerse('Oh\nHere comes the sun'), 'Here comes the sun');
  const long = 'word '.repeat(30).trim();
  const t = extractFirstVerse(long);
  assert.ok(t.endsWith('...') && t.length <= 83, t);
});

test('cleanHTMLLyrics', () => {
  const got = cleanHTMLLyrics('Is this the real life?<br>Is this just fantasy?<br/>Caught in a landslide &amp; no escape');
  assert.equal(got, 'Is this the real life?\nIs this just fantasy?\nCaught in a landslide & no escape');
  assert.equal(cleanHTMLLyrics('S&atilde;o&nbsp;Jo&#227;o &#x263A;'), 'São João ☺');
});

test('extractLyricsFromLetrasMusBr', () => {
  const html = `<html><body>
    <div class="cnt-letra p402_premium"><p>Is this the real life?<br>Is this just fantasy?</p></div>
  </body></html>`;
  assert.ok(extractLyricsFromLetrasMusBr(html).startsWith('Is this the real life?'));
  const boiler = '<p>Aceitar cookies - política de privacidade</p><p>letras.mus.br todos os direitos</p>';
  assert.equal(extractLyricsFromLetrasMusBr(boiler), '');
  // Fallback <p> scan keeps real lines.
  assert.equal(extractLyricsFromLetrasMusBr('<p>short</p><p>A real lyric line</p><p class="x">Another one here</p>'),
    'A real lyric line\nAnother one here');
});

test('searchLyrics from lyrics.ovh', async () => {
  const w = fakeWorld();
  w.handlers.ovh = serve('{"lyrics":"Here comes the sun\\nLittle darling"}');
  assert.equal(await searchLyricsFrom('lyrics_ovh', 'The Beatles', 'Here Comes the Sun', w.opts()), 'Here comes the sun');
  assert.equal(w.requests[0].url.href, 'https://api.lyrics.ovh/v1/The%20Beatles/Here%20Comes%20the%20Sun');
});

test('searchLyrics from letras.mus.br end to end', async () => {
  const w = fakeWorld();
  w.handlers.letras = serve('<div class="cnt-letra"><p>Is this the real life?<br>Is this just fantasy?</p></div>');
  w.handlers.solr = serve('{"response":{"numFound":1,"docs":[{"art":"Queen","dns":"queen","txt":"Bohemian Rhapsody","url":"bohemian-rhapsody"}]}}');
  assert.equal(await searchLyricsFrom('letras', 'Queen', 'Bohemian Rhapsody', w.opts()), 'Is this the real life?');
});

test('searchLyrics from letras.mus.br rejects a wrong match', async () => {
  const w = fakeWorld();
  w.handlers.solr = serve('{"response":{"numFound":1,"docs":[{"art":"Pinkfong","dns":"pinkfong","txt":"Baby Shark","url":"baby-shark"}]}}');
  await assert.rejects(searchLyricsFrom('letras', 'Queen', 'Bohemian Rhapsody', w.opts({ letrasBaseURL: 'http://unused.invalid' })));
});

test('letrasSlug', () => {
  const tests = [
    ['Chitãozinho & Xororó', 'chitaozinho-e-xororo'],
    ['Zezé Di Camargo & Luciano', 'zeze-di-camargo-e-luciano'],
    ['É o Amor', 'e-o-amor'],
    ['Trem-Bala', 'trem-bala'],
    ["Don't Stop Me Now", 'dont-stop-me-now'],
    ["Guns N' Roses", 'guns-n-roses'],
    ['  Garota de Ipanema  ', 'garota-de-ipanema'],
    ['Anunciação', 'anunciacao'],
  ];
  for (const [i, want] of tests) assert.equal(letrasSlug(i), want);
});

test('letras: current and old markup', () => {
  const cur = extractLyricsFromLetrasMusBr(fixture('letras_page.html'));
  assert.ok(cur.startsWith('Quando eu digo que deixei de te amar\nÉ porque eu te amo'), cur);
  assert.ok(!cur.includes('Composição') && !cur.includes('direitos'), cur);
  assert.equal(extractLyricsFromLetrasMusBr(fixture('letras_page_old.html')),
    'Is this the real life?\nIs this just fantasy?\nCaught in a landslide & no escape');
});

test('letras: direct slug with browser-like headers', async () => {
  const w = fakeWorld();
  const paths = [];
  w.handlers.letras = (req) => {
    paths.push(req.path);
    if (req.path === '/chitaozinho-e-xororo/evidencias/') {
      assert.ok(req.headers.get('Accept-Language').includes('pt-BR'));
      assert.ok(req.headers.get('User-Agent').includes('Mozilla'));
      return { body: fixture('letras_page.html') };
    }
    return notFound();
  };
  assert.equal(await searchLyricsFrom('letras', 'Chitãozinho & Xororó', 'Evidências', w.opts()), 'Quando eu digo que deixei de te amar');
  assert.equal(paths.length, 1);
  assert.equal(w.count('solr'), 0);
});

test('letras: search fallback and multi-artist', async () => {
  const w = fakeWorld();
  w.handlers.solr = serve(fixture('letras_solr.json'));
  w.handlers.letras = (req) => (req.path === '/chitaozinho-e-xororo/768469/' ? { body: fixture('letras_page.html') } : notFound());
  const hits = await letrasFind('Chitãozinho; Xororó', 'Evidências', 3, 0.5, w.opts());
  assert.equal(hits.length, 1);
  assert.equal(hits[0].artist, 'Chitãozinho & Xororó');
  assert.equal(hits[0].title, 'Evidências');
  assert.ok(hits[0].score >= 0.9);
  const solrReq = w.requests.find((r) => r.url.host === 'solr.sscdn.co');
  assert.equal(solrReq.query.get('q'), 'Chitãozinho Evidências');
  assert.equal(solrReq.query.get('rows'), '10');
});

test('letras: blocked fails fast and quietly, and is remembered', async () => {
  const w = fakeWorld();
  w.handlers.letras = serve('<HTML><TITLE>Access Denied</TITLE>', 403);
  w.handlers.solr = serve(fixture('letras_solr.json'));
  for (let i = 0; i < 3; i++) {
    await assert.rejects(letrasFind('Chitãozinho & Xororó', 'Evidências', 1, 0.5, w.opts()), (e) => isLetrasBlockedError(e));
  }
  assert.equal(w.count('letras'), 1);
  assert.equal(w.count('solr'), 0);
});

test('letras: block expires', async () => {
  const w = fakeWorld();
  w.handlers.letras = serve('', 403);
  await assert.rejects(letrasFind('Queen', 'Bohemian Rhapsody', 1, 0.5, w.opts({ letrasBlockFor: 30 })));
  assert.equal(letrasBlocked(), true);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(letrasBlocked(), false);
});

test('searchLyrics falls through a blocked letras to LRCLIB', async () => {
  const w = fakeWorld();
  w.handlers.letras = serve('', 403);
  w.handlers.lrclib = serve(fixture('lrclib_get.json'));
  assert.equal(await searchLyrics('Queen', 'Bohemian Rhapsody', w.opts()), 'Is this the real life? Is this just fantasy?');
});

test('firstSungLine cleaning', () => {
  const tests = [
    ['section tags', '[Intro]\n\n[Verse 1]\nHere comes the sun,\nLittle darling', 'Here Comes the Sun', 'The Beatles', 'Here comes the sun'],
    ['portuguese tag', '(Refrão)\n\nQuando o sol bater na janela', 'X', 'Y', 'Quando o sol bater na janela'],
    ['credits', 'Composição: José Augusto\nLetra de Paulo Valle\nLyrics by Someone\nQuando eu digo que deixei de te amar', 'Evidências', 'Chitãozinho', 'Quando eu digo que deixei de te amar'],
    ['banner', '12 Contributors\nEvidências Lyrics\nQuando eu digo', 'Evidências', 'Chitãozinho', 'Quando eu digo'],
    ['translation banner', '2 Translations\nQuando eu digo', 'Evidências', 'Chitãozinho', 'Quando eu digo'],
    ['artist and title header', 'Chitãozinho & Xororó - Evidências\nQuando eu digo', 'Evidências', 'Chitãozinho & Xororó', 'Quando eu digo'],
    ['artist only header', 'Queen\nIs this the real life?', 'Bohemian Rhapsody', 'Queen', 'Is this the real life?'],
    ['interjection then real', 'Oh oh oh\nYeah\nIs this the real life', 'Z', 'Q', 'Is this the real life'],
    ['la la la then real', 'La la la\nWe are the champions', 'Z', 'Q', 'We are the champions'],
    ['interjection with no real line near', 'Oh oh oh\nYeah yeah\nOoh\nLater a real line', 'Z', 'Q', 'Oh oh oh'],
    ['trailing noise', 'Quando eu digo que deixei de te amar,\nfoo', 'Z', 'Q', 'Quando eu digo que deixei de te amar'],
    ['trailing dots dash', 'Eu tenho medo de te dar meu coração ...\nfoo', 'Z', 'Q', 'Eu tenho medo de te dar meu coração'],
    ['keeps question mark and accents', 'É o amor que mexe com minha cabeça?\nfoo', 'Z', 'Q', 'É o amor que mexe com minha cabeça?'],
    ['parenthesised lyric kept', '(Quero ouvir mais, vai!)\nfoo', 'Z', 'Q', '(Quero ouvir mais, vai!)'],
    ['blank only', '\n\n  \n', 'Z', 'Q', ''],
    ['crlf', '[Chorus]\r\nHere comes the sun\r\nx', 'Z', 'Q', 'Here comes the sun'],
  ];
  for (const [name, text, title, artist, want] of tests) {
    assert.equal(firstSungLine(text, title, artist), want, name);
  }
});

test('firstSungExcerpt and cleanLyricLines', () => {
  assert.deepEqual(firstSungExcerpt('[Intro]\nA one\n\nB two\nC three\nD four\nE five', 'T', 'A', 4),
    ['A one', 'A one\nB two\nC three\nD four']);
  assert.deepEqual(cleanLyricLines('[Verse]\n- First line ,\nSecond', 'T', 'A'), ['First line', 'Second']);
});

// ---- findCandidates

const OVH_BOHEMIAN = '{"lyrics":"Is this the real life\\nIs this just fantasy\\nCaught in a landslide"}';

test('findCandidates: dedupe and ranking', async () => {
  const w = fakeWorld();
  w.handlers.letras = serve('', 403);
  w.handlers.lrclib = (req) => (req.path.endsWith('/get')
    ? { body: fixture('lrclib_get.json') }
    : { body: '[{"id":2,"trackName":"Bohemian Rhapsody (Live)","artistName":"Queen","instrumental":false,"plainLyrics":"[Intro]\\nMama, just killed a man\\nPut a gun against his head"}]' });
  w.handlers.ovh = serve(OVH_BOHEMIAN);
  const got = await findCandidates('Queen', 'Bohemian Rhapsody', w.opts());
  assert.equal(got.length, 2, JSON.stringify(got));
  assert.ok(['Is this the real life? Is this just fantasy?', 'Is this the real life'].includes(got[0].first_line), got[0].first_line);
  assert.equal(got[1].first_line, 'Mama, just killed a man');
  assert.ok(got[1].excerpt !== '');
  // The JSON shape (no lyric sample).
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(got[0]))).sort(),
    ['excerpt', 'first_line', 'matched_artist', 'matched_title', 'score', 'source', 'sources']);
  assert.ok(got[0].text.length > 0, 'internal lyric sample kept for language detection');
});

test('findCandidates: merges agreeing sources', async () => {
  const w = fakeWorld();
  w.handlers.letras = serve('<div class="lyric-original"><p>Is this the real life?<br>x</p></div>');
  w.handlers.lrclib = (req) => (req.path.endsWith('/get')
    ? { body: '{"id":1,"trackName":"Bohemian Rhapsody","artistName":"Queen","plainLyrics":"IS THIS THE REAL LIFE\\ny"}' }
    : notFound());
  w.handlers.ovh = serve('{"lyrics":"Is this the real life!\\nz"}');
  const got = await findCandidates('Queen', 'Bohemian Rhapsody', w.opts());
  assert.equal(got.length, 1, JSON.stringify(got));
  assert.equal(got[0].sources.length, 3);
  assert.equal(got[0].source, 'lrclib');
  assert.ok(got[0].score >= 0.9);
});

test('findCandidates: ranking prefers agreement', async () => {
  const w = fakeWorld();
  w.handlers.letras = serve('<title>Song - Artist - LETRAS.MUS.BR</title><div class="lyric-original"><p>Common line here<br>x</p></div>');
  w.handlers.lrclib = (req) => (req.path.endsWith('/get')
    ? { body: '{"id":1,"trackName":"Song","artistName":"Artist","plainLyrics":"Higher score alone\\ny"}' }
    : notFound());
  w.handlers.ovh = serve('{"lyrics":"common line here\\nz"}');
  const got = await findCandidates('Artist', 'Song', w.opts());
  assert.equal(got.length, 2, JSON.stringify(got));
  assert.equal(got[0].sources.length, 2);
  assert.equal(got[0].first_line, 'Common line here');
});

test('findCandidates: multi-artist queries both spellings', async () => {
  const w = fakeWorld();
  const artists = [];
  w.handlers.lrclib = (req) => {
    artists.push(req.query.get('artist_name'));
    assert.equal(req.headers.get('User-Agent'), LRCLIB_USER_AGENT);
    return notFound();
  };
  w.handlers.solr = serve('{"response":{"numFound":0,"docs":[]}}');
  assert.deepEqual(await findCandidates('Zezé Di Camargo; Luciano', 'É o Amor', w.opts()), []);
  assert.ok(artists.includes('Zezé Di Camargo & Luciano') && artists.includes('Zezé Di Camargo'), JSON.stringify(artists));
});

test('findCandidates: a slow source times out', async () => {
  const w = fakeWorld();
  w.handlers.letras = serve('', 403);
  w.handlers.lrclib = hang;
  w.handlers.ovh = serve(OVH_BOHEMIAN);
  const start = Date.now();
  const got = await findCandidates('Queen', 'Bohemian Rhapsody', w.opts({ sourceTimeout: 150 }));
  assert.equal(got.length, 1);
  assert.equal(got[0].source, 'lyrics_ovh');
  assert.ok(Date.now() - start < 2000);
});

test('findCandidates: all fail -> [] and strict reports unavailable sources', async () => {
  const w = fakeWorld();
  w.handlers.letras = serve('', 403);
  assert.deepEqual(await findCandidates('Nobody', 'Nothing', w.opts()), []);
  assert.deepEqual(await findCandidatesStrict('Nobody', 'Nothing', w.opts()), []); // 404s: not transient

  resetLetrasBlock();
  w.handlers.lrclib = serve('', 503);
  await assert.rejects(findCandidatesStrict('Nobody', 'Nothing', w.opts()), (e) => isLyricSourcesUnavailable(e));
  await assert.rejects(findCandidates('', 'x', w.opts()), /required/);
});

test('findCandidates: caller cancellation', async () => {
  const w = fakeWorld();
  w.handlers.letras = hang;
  w.handlers.lrclib = hang;
  w.handlers.ovh = hang;
  const start = Date.now();
  await assert.rejects(findCandidates('Queen', 'Bohemian Rhapsody', w.opts({ signal: AbortSignal.timeout(100) })));
  assert.ok(Date.now() - start < 1000);
});

test('findCandidates: each source contributes at most three hits', async () => {
  const w = fakeWorld();
  w.handlers.letras = serve('', 403);
  const items = [];
  for (let i = 0; i < 8; i++) {
    items.push(`{"id":${i + 1},"trackName":"Song","artistName":"Artist","plainLyrics":"Distinct opening line number ${String.fromCharCode(97 + i)}\\nx"}`);
  }
  w.handlers.lrclib = (req) => (req.path.endsWith('/search') ? { body: '[' + items.join(',') + ']' } : notFound());
  const got = await findCandidates('Artist', 'Song', w.opts());
  assert.equal(got.length, HITS_PER_SOURCE);
});

test('letrasPageNames', () => {
  assert.deepEqual(letrasPageNames(fixture('letras_page.html')), ['Chitãozinho & Xororó', 'Evidências']);
  assert.deepEqual(letrasPageNames(fixture('letras_page_old.html')), ['', '']);
});

test('letras: a direct slug on another song is rejected', async () => {
  const w = fakeWorld();
  w.handlers.letras = serve(fixture('letras_page_other_song.html'));
  w.handlers.solr = serve('{"response":{"numFound":0,"docs":[]}}');
  await assert.rejects(letrasFind('Zezé Di Camargo; Luciano', 'É o Amor', 3, MIN_CANDIDATE, w.opts()));
  assert.equal(w.count('solr'), 1);
});

test('letras: a direct slug with matching names reports the page names', async () => {
  const w = fakeWorld();
  w.handlers.letras = serve(fixture('letras_page.html'));
  const hits = await letrasFind('Chitaozinho e Xororo', 'Evidencias', 3, MIN_CANDIDATE, w.opts());
  assert.equal(hits.length, 1);
  assert.equal(hits[0].artist, 'Chitãozinho & Xororó');
  assert.equal(hits[0].title, 'Evidências');
  assert.ok(hits[0].score >= 0.9);
});

// ---- LRCLIB

test('lrclib: /get plain lyrics', async () => {
  const w = fakeWorld();
  w.handlers.lrclib = (req) => {
    assert.equal(req.headers.get('User-Agent'), LRCLIB_USER_AGENT);
    if (!req.path.endsWith('/get') || req.query.get('artist_name') !== 'Queen' || req.query.get('track_name') !== 'Bohemian Rhapsody') return notFound();
    return { body: fixture('lrclib_get.json') };
  };
  const hits = await lrclibFind('Queen', 'Bohemian Rhapsody', 3, 0.5, w.opts());
  assert.ok(hits.length > 0);
  assert.equal(hits[0].source, 'lrclib');
  assert.equal(hits[0].score, 1);
  assert.ok(hits[0].lyrics.startsWith('Is this the real life?'));
  assert.ok(w.requests[0].url.search.startsWith('?artist_name=Queen&track_name=Bohemian+Rhapsody'));
});

test('lrclib: search fallback and dedupe', async () => {
  const w = fakeWorld();
  w.handlers.lrclib = (req) => (req.path.endsWith('/search') ? { body: fixture('lrclib_search.json') } : notFound());
  const hits = await lrclibFind('Chitãozinho & Xororó', 'Evidências', 3, 0.35, w.opts());
  assert.ok(hits.length > 0);
  assert.equal(hits[0].artist, 'Chitãozinho');
  assert.ok(hits[0].score >= 0.7);
});

test('lrclib: synced-only and instrumental', async () => {
  const w = fakeWorld();
  w.handlers.lrclib = (req) => (req.path.endsWith('/search') ? { body: `[
    {"id":1,"trackName":"Song","artistName":"Artist","instrumental":true,"plainLyrics":null,"syncedLyrics":null},
    {"id":2,"trackName":"Song","artistName":"Artist","instrumental":false,"plainLyrics":null,"syncedLyrics":"[00:12.34] Primeira linha\\n[00:15.00] Segunda linha"},
    {"id":3,"trackName":"Song","artistName":"Artist","instrumental":false,"plainLyrics":"","syncedLyrics":null}]` } : notFound());
  const hits = await lrclibFind('Artist', 'Song', 3, 0.5, w.opts());
  assert.equal(hits.length, 1);
  assert.equal(firstSungLine(hits[0].lyrics, 'Song', 'Artist'), 'Primeira linha');
});

test('lrclib: instrumental only is not found', async () => {
  const w = fakeWorld();
  w.handlers.lrclib = serve('{"id":1,"trackName":"Song","artistName":"Artist","instrumental":true,"plainLyrics":null,"syncedLyrics":null}');
  await assert.rejects(lrclibFind('Artist', 'Song', 3, 0.5, w.opts()));
});

test('lrclib: rejects the wrong song', async () => {
  const w = fakeWorld();
  w.handlers.lrclib = serve('{"id":1,"trackName":"Baby Shark","artistName":"Pinkfong","plainLyrics":"Baby shark doo doo"}');
  await assert.rejects(lrclibFind('Queen', 'Bohemian Rhapsody', 3, 0.5, w.opts()));
});

// ================================================================ review

let nextId = 1;
function mkSong(artist, title, yt, lang, lyrics, verified) {
  const id = `song-${nextId++}`;
  return {
    id, code: 1000 + nextId, title, artist, youtube_id: id, youtube_url: '', youtube_title: yt, duration: 0,
    thumbnail_url: '', file_size: 0, needs_optimization: false, metadata_verified: verified, language: lang,
    lyrics_start: lyrics, no_first_line: false, added_at: '2026-01-01T00:00:00Z', play_count: 0,
  };
}

/** Stub lookups (Go's stubSources): answers keyed by title, calls recorded. */
function stubSources() {
  const s = { nameCalls: [], lyricCalls: [], names: {}, lyrics: {}, namesErr: null, lyricsErr: null };
  s.sources = {
    names: async (artist, title) => {
      s.nameCalls.push(`${artist} - ${title}`);
      if (s.namesErr) throw s.namesErr;
      return s.names[title] || [];
    },
    lyrics: async (artist, title) => {
      s.lyricCalls.push(`${artist} - ${title}`);
      if (s.lyricsErr) throw s.lyricsErr;
      return s.lyrics[title] || [];
    },
  };
  return s;
}

const ENGLISH_LYRICS = "Is this the real life\nIs this just fantasy\nCaught in a landslide, no escape from reality\nOpen your eyes, look up to the skies and see\nI'm just a poor boy, I need no sympathy";

test('buildSuggestions: assembly, storage and view', async () => {
  const existing = mkSong('Queen', 'Bohemian Rhapsody', '', 'EN', 'Is this the real life?', true);
  const song = mkSong('Sing King', 'Queen - Bohemian Rhapsody (Karaoke Version)', 'Queen - Bohemian Rhapsody (Karaoke Version)', 'PT-BR', '', false);
  const songs = [existing, song];
  const stub = stubSources();
  stub.names['Queen - Bohemian Rhapsody (Karaoke Version)'] = [
    { artist: 'Queen', title: 'Bohemian Rhapsody', source: 'itunes', confidence: 0.9 },
    { artist: 'QUEEN', title: 'bohemian rhapsody', source: 'musicbrainz', confidence: 0.8 },
  ];
  stub.lyrics['Bohemian Rhapsody'] = [setText({
    source: 'lrclib', first_line: 'Is this the real life?', excerpt: 'Is this the real life?\nIs this just fantasy?',
    matched_artist: '', matched_title: '', score: 1, sources: ['lrclib', 'letras'],
  }, ENGLISH_LYRICS)];

  const res = await buildSuggestions({ song, artist: song.artist, title: song.title, previous: [], songs, sources: stub.sources, defaultLanguage: 'EN' });
  assert.equal(res.status, 'ready');
  assert.equal(res.error, '');
  assert.equal(res.queryArtist, 'Sing King');
  const sug = res.payload;
  assert.ok(sug.names[0].current && sug.names[0].artist === 'Sing King', JSON.stringify(sug.names[0]));
  const queens = sug.names.filter((n) => n.artist === 'Queen' && n.title === 'Bohemian Rhapsody');
  assert.equal(queens.length, 1, JSON.stringify(sug.names));
  for (const src of [NameSourceITunes, NameSourceMusicBrainz, NameSourceCatalog, NameSourceYouTube]) {
    assert.ok(queens[0].sources.includes(src), `Queen option lacks ${src}: ${queens[0].sources}`);
  }
  assert.deepEqual(stub.lyricCalls, ['Sing King - Queen - Bohemian Rhapsody (Karaoke Version)', 'Queen - Bohemian Rhapsody']);
  assert.deepEqual(sug.looked_up, stub.lyricCalls);
  assert.equal(sug.first_lines.length, 1);
  assert.equal(sug.first_lines[0].first_line, 'Is this the real life?');
  assert.ok(sug.languages.length > 0);
  assert.equal(sug.languages[0].id, 'EN');
  assert.equal(sug.languages[0].reason, 'lyrics');
  assert.equal(sug.lyrics_language, 'EN');

  // Stored and served: never the long lyric sample; the existing copy is a duplicate.
  const rec = toRecord({ song, result: res, now: new Date('2026-11-01T10:00:00Z') });
  assert.ok(!rec.payload.includes('Caught in a landslide'));
  assert.equal(rec.attempts, 0);
  assert.equal(rec.fetched_at, '2026-11-01T10:00:00.000Z');
  const view = suggestionsView({ song, record: { ...rec, payload: JSON.parse(rec.payload) }, songs, addedBy: 'Ana' });
  assert.equal(view.status, 'ready');
  assert.equal(view.fetched_at, '2026-11-01T10:00:00.000Z');
  assert.equal(view.added_by, 'Ana');
  assert.equal(view.duplicates.length, 1);
  assert.equal(view.duplicates[0].id, existing.id);
  assert.deepEqual(Object.keys(view), ['song_id', 'status', 'in_progress', 'fetched_at', 'attempts', 'query_artist', 'query_title',
    'added_by', 'names', 'first_lines', 'languages', 'lyrics_language', 'looked_up', 'duplicates']);
  // The record string form works too.
  assert.equal(suggestionsView({ song, record: rec, songs }).status, 'ready');
});

test('buildSuggestions: statuses', async () => {
  const song = mkSong('Nobody', 'Nothing At All', '', 'EN', '', false);
  const stub = stubSources();
  let res = await buildSuggestions({ song, artist: song.artist, title: song.title, songs: [song], sources: stub.sources });
  assert.equal(res.status, 'none_found');
  assert.equal(res.error, '');

  stub.namesErr = new Error('status 503');
  stub.lyricsErr = Object.assign(new Error('lyric sources unavailable'), { code: 'lyric_sources_unavailable' });
  res = await buildSuggestions({ song, songs: [song], sources: stub.sources });
  assert.equal(res.status, 'error');
  assert.equal(res.error, 'music catalogs: status 503; lyrics: lyric sources unavailable');
  assert.ok(res.payload.names.length > 0 && res.payload.names[0].current);

  const prev = toRecord({ song, result: res });
  assert.equal(prev.attempts, 1);
  assert.equal(toRecord({ song, result: res, previous: prev }).attempts, 2);
});

test('suggestionsView: pending serves offline suggestions', () => {
  const song = mkSong('Chitãozinho & Xororó', 'Evidências', 'Chitãozinho & Xororó - Evidências (Karaokê)', 'PT-BR', '', false);
  const view = suggestionsView({ song, record: null, songs: [song], defaultLanguage: 'EN' });
  assert.equal(view.status, 'pending');
  assert.equal(view.in_progress, false);
  assert.equal(view.fetched_at, null);
  assert.ok(view.names.length > 0 && view.names[0].current);
  assert.ok(view.languages.length > 0);
  assert.deepEqual(view.first_lines, []);
  assert.deepEqual(view.duplicates, []);
  assert.equal(suggestionsView({ song: null, record: null, songs: [] }), null);
  assert.equal(suggestionsView({ song: { ...song, deleted_at: '2026-01-01T00:00:00Z' }, record: null, songs: [] }), null);

  // A record for older names: pending, but its lines are carried over.
  const old = {
    song_id: song.id, status: 'ready', song_artist: song.artist, song_title: 'Old Title', query_artist: song.artist,
    query_title: 'Old Title', last_error: '', attempts: 0, fetched_at: '2026-01-01T00:00:00Z',
    payload: { names: [], first_lines: [{ source: 'lrclib', first_line: 'Quando eu digo', excerpt: '', matched_artist: '', matched_title: '', score: 0.9, sources: ['lrclib'] }], languages: [] },
  };
  assert.equal(isStale(old, song), true);
  const v2 = suggestionsView({ song, record: old, songs: [song] });
  assert.equal(v2.status, 'pending');
  assert.equal(v2.query_title, 'Old Title');
  assert.equal(v2.first_lines[0].first_line, 'Quando eu digo');
});

test('offlineSuggestions filters languages to the catalog table', () => {
  const song = mkSong('Queen', 'Bohemian Rhapsody', 'Queen - Bohemian Rhapsody', 'EN', '', false);
  const sug = offlineSuggestions(song, [song], { languages: [{ id: 'PT-BR' }], defaultLanguage: 'PT-BR' });
  assert.ok(sug.languages.every((g) => g.id === 'PT-BR'), JSON.stringify(sug.languages));
  assert.deepEqual(sug.first_lines, []);
});

test('reviewDue and isStale', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const song = { artist: 'A', title: 'T' };
  const at = (ms) => new Date(now - ms).toISOString();
  const H = 3600e3;
  const rec = (o) => ({ song_artist: 'A', song_title: 'T', ...o });
  const cases = [
    [null, true],
    [rec({ status: 'ready' }), true],
    [rec({ status: 'ready', fetched_at: at(H) }), false],
    [rec({ status: 'ready', fetched_at: at(H), song_title: 'Other' }), true],
    [rec({ status: 'ready', fetched_at: at(31 * 24 * H) }), true],
    [rec({ status: 'none_found', fetched_at: at(24 * H) }), false],
    [rec({ status: 'none_found', fetched_at: at(4 * 24 * H) }), true],
    [rec({ status: 'error', attempts: 1, fetched_at: at(11 * 60e3) }), true],
    [rec({ status: 'error', attempts: 3, fetched_at: at(11 * 60e3) }), false],
    [rec({ status: 'error', attempts: 50, fetched_at: at(13 * H) }), true],
  ];
  cases.forEach(([r, want], i) => assert.equal(reviewDue(r, song, now), want, `case ${i}`));
  assert.equal(isStale(null, song), false);
  assert.equal(isStale(rec({ status: 'ready' }), song), false);
});

test('mergeFirstLines keeps previous behind fresh', () => {
  const prev = [{ first_line: 'Old line', sources: ['earlier_lookup'], previous: true }];
  const fresh = [
    setText({ first_line: 'Fresh line', sources: ['lrclib'], score: 0.7 }, 'sample'),
    { first_line: 'fresh line', sources: ['letras'], score: 0.9 },
  ];
  const got = mergeFirstLines(fresh, prev);
  assert.equal(got.length, 2);
  assert.equal(got[0].first_line, 'fresh line');
  assert.equal(got[0].sources.length, 2);
  assert.equal(got[1].previous, true);
  const json = JSON.stringify(got[0]);
  assert.ok(!json.includes('"text"') && !json.includes('sample'), json);
  assert.deepEqual(previousFirstLines({ payload: JSON.stringify({ first_lines: [...prev, { first_line: 'x' }] }) }), prev);
});

test('buildSuggestions end to end with the real lookups stays within the subrequest budget', async () => {
  const song = mkSong('queen', 'bohemian rapsody', 'Queen - Bohemian Rapsody (Karaoke Version)', 'EN', '', false);
  // Everything fails with 503: the worst case for retries.
  const down = fakeWorld();
  for (const k of Object.keys(down.handlers)) down.handlers[k] = serve('', 503);
  const res = await buildSuggestions({ song, songs: [song], opts: down.opts() });
  assert.equal(res.status, 'error');
  assert.ok(down.requests.length <= 40, `sent ${down.requests.length} requests`);

  // Healthy services: names and first lines come back.
  resetLetrasBlock();
  const w = fakeWorld();
  w.handlers.itunes = serve('{"resultCount":1,"results":[{"trackName":"Bohemian Rhapsody","artistName":"Queen"}]}');
  w.handlers.mb = serve('{"recordings":[]}');
  w.handlers.letras = serve('', 403);
  w.handlers.lrclib = (req) => (req.path.endsWith('/get') && req.query.get('track_name') === 'Bohemian Rhapsody'
    ? { body: fixture('lrclib_get.json') } : notFound());
  w.handlers.ovh = (req) => (req.path === '/v1/Queen/Bohemian%20Rhapsody' ? { body: fixture('lyricsovh.json') } : notFound());
  const ok = await buildSuggestions({ song, songs: [song], opts: w.opts() });
  assert.equal(ok.status, 'ready', ok.error);
  assert.ok(ok.payload.names.some((n) => n.artist === 'Queen' && n.title === 'Bohemian Rhapsody' && n.sources.includes('itunes')), JSON.stringify(ok.payload.names));
  assert.deepEqual(ok.payload.looked_up, ['queen - bohemian rapsody', 'Queen - Bohemian Rhapsody']);
  assert.ok(ok.payload.first_lines.length > 0);
  assert.ok(ok.payload.first_lines[0].first_line.startsWith('Is this the real life'), JSON.stringify(ok.payload.first_lines));
  assert.equal(ok.payload.lyrics_language, 'EN');
  assert.ok(w.requests.length <= 40);
});
