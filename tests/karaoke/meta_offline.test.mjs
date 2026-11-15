// Ported from the Go tests in services/: normalize_test.go, title_parser_test.go,
// language_detect_test.go, language_chain_test.go, lyrics_language_test.go,
// metadata_extract_test.go and catalog_metadata_test.go (the database-backed
// cases use a songs array instead of SQLite; file-system tests are skipped).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  titleCaseRaw, nameKey, titleKey, normalizeArtistSeparators, isKaraokeSource, addFeaturedArtists,
} from '../../worker/karaoke/meta/normalize.js';
import { TitleParser } from '../../worker/karaoke/meta/title_parser.js';
import {
  detectLanguage, detectByScript, detectLyricsLanguage, rankLanguages, chooseLanguage,
  lyricsLanguage, titleLanguage, artistLanguageFrom,
} from '../../worker/karaoke/meta/language.js';
import { extractMusicMetadata } from '../../worker/karaoke/meta/extract.js';
import { findDuplicateSongs, suggestCatalogArtist, artistLanguage } from '../../worker/karaoke/meta/catalog_meta.js';

let nextId = 1;
function song(artist, title, language) {
  const id = `song-${nextId++}`;
  return { id, title, artist, language, youtube_id: id };
}

// ---------------------------------------------------------------- normalize

test('titleCaseRaw', () => {
  const tests = [
    ['FAT FAMILY', 'Fat Family'],
    ['JEITO SEXY', 'Jeito Sexy'],
    ['YMCA', 'YMCA'],
    ['S&M', 'S&M'],
    ['Rihanna', 'Rihanna'],
    ['GUNS N ROSES', 'Guns N Roses'],
  ];
  for (const [input, want] of tests) assert.equal(titleCaseRaw(input), want, input);
});

test('nameKey', () => {
  const same = [
    ['Udr 666', 'Udr666'],
    ['Bruno & Marrone', 'Bruno e Marrone'],
    ['Glória Groove', 'Gloria Groove'],
    ['Charlie Brown Jr', 'Charlie Brown Jr.'],
    ['Milionário & José Rico', 'Milionário e Jose Rico'],
  ];
  for (const [a, b] of same) assert.equal(nameKey(a), nameKey(b), `${a} vs ${b}`);
  assert.notEqual(nameKey('Liniker'), nameKey('Liniker e os Caramelows'), 'distinct acts must not share a key');
  assert.equal(titleKey('Tudo (Ao Vivo)'), titleKey('Tudo'), 'titleKey should ignore bracketed suffixes');
});

test('normalizeArtistSeparators', () => {
  const tests = [
    ['Sorriso Maroto;ferrugem', 'Sorriso Maroto; ferrugem'],
    ['Hugo e Guilherme; Marília Mendonça; Dilsinho;juliano', 'Hugo e Guilherme; Marília Mendonça; Dilsinho; juliano'],
    [' Adele ', 'Adele'],
    ['A ;; B', 'A; B'],
  ];
  for (const [input, want] of tests) assert.equal(normalizeArtistSeparators(input), want, input);
});

test('isKaraokeSource', () => {
  for (const name of ['Sing King', 'Sing King Karaoke', 'KaraFun', 'Ameritz Karaoke Português', 'Clubinho do Karaokê', 'Edkara', 'Cali-karaoke', 'Geek Music', 'King of Karaoke']) {
    assert.equal(isKaraokeSource(name), true, name);
  }
  for (const name of ['Adele', 'Liniker', 'King Crimson', 'Pabllo Vittar', 'Kid Abelha']) {
    assert.equal(isKaraokeSource(name), false, name);
  }
});

test('addFeaturedArtists', () => {
  const tests = [
    ['Rihanna', ['Drake'], 'Rihanna; Drake'],
    ['Rihanna; Drake', ['Drake'], 'Rihanna; Drake'],
    ['Bruno & Marrone', ['Marrone'], 'Bruno & Marrone'],
  ];
  for (const [artist, feat, want] of tests) assert.equal(addFeaturedArtists(artist, feat), want, artist);
});

// ------------------------------------------------------------- title parser

test('TitleParser golden corpus', async (t) => {
  const tp = new TitleParser();
  const tests = [
    // Standard "Artist - Song" (EN)
    ['Queen - Bohemian Rhapsody', '', 'Queen', 'Bohemian Rhapsody'],
    ['The Beatles - Let It Be', '', 'The Beatles', 'Let It Be'],
    ['Adele - Someone Like You (Karaoke Version)', '', 'Adele', 'Someone Like You'],
    ['Liniker - Tudo (Official Video)', '', 'Liniker', 'Tudo'],
    ['ABBA - Gimme! Gimme! Gimme! (A Man After Midnight)', '', 'ABBA', 'Gimme! Gimme! Gimme!'],
    ['Luis Fonsi & Daddy Yankee - Despacito', '', 'Luis Fonsi & Daddy Yankee', 'Despacito'],
    ['Bruno Mars - Just the Way You Are (Official Music Video)', '', 'Bruno Mars', 'Just the Way You Are'],
    ['Whitney Houston - I Will Always Love You [Karaoke]', '', 'Whitney Houston', 'I Will Always Love You'],
    // Unicode dash separators
    ['Coldplay – Yellow', '', 'Coldplay', 'Yellow'],
    ['U2 — One', '', 'U2', 'One'],
    // Portuguese / Spanish (stop words stay lowercase)
    ['Alceu Valença - Anunciação (Karaoke Version)', '', 'Alceu Valença', 'Anunciação'],
    ['Legião Urbana - Tempo Perdido', '', 'Legião Urbana', 'Tempo Perdido'],
    ['Bruno e Marrone - Boate Azul', '', 'Bruno e Marrone', 'Boate Azul'],
    ['Luis Miguel - La Incondicional', '', 'Luis Miguel', 'La Incondicional'],
    ['Shakira - Antología (Karaoke)', '', 'Shakira', 'Antología'],
    // "Song - Artist" with channel hint
    ['Anunciação - Alceu Valença', 'Alceu Valença', 'Alceu Valença', 'Anunciação'],
    ['🎤 Imagine - John Lennon', 'John Lennon', 'John Lennon', 'Imagine'],
    ['🎤 Pagode Russo - Luiz Gonzaga', 'Luiz Gonzaga', 'Luiz Gonzaga', 'Pagode Russo'],
    // Karaoke-prefixed: implies "Song - Artist" ordering
    ['Karaokê - Anunciação - Alceu Valença', '', 'Alceu Valença', 'Anunciação'],
    ['Karaokê Evidências - Chitãozinho e Xororó', '', 'Chitãozinho e Xororó', 'Evidências'],
    ['Karaoke Wonderwall - Oasis', 'Sing King', 'Oasis', 'Wonderwall'],
    // "by Artist" pattern
    ['Anunciação by Alceu Valença', '', 'Alceu Valença', 'Anunciação'],
    ['Hallelujah by Leonard Cohen', '', 'Leonard Cohen', 'Hallelujah'],
    // Channel-only (no separator in title)
    ['Anunciação', 'Alceu Valença - Topic', 'Alceu Valença', 'Anunciação'],
    ['Hotel California', 'Eagles - Topic', 'Eagles', 'Hotel California'],
    // Multiple separators / trailing noise dropped
    ['Alceu Valença - Anunciação - Karaoke', 'Alceu Valença', 'Alceu Valença', 'Anunciação'],
    ['Sia | Chandelier | Karaoke', '', 'Sia', 'Chandelier'],
    ['Rionegro e Solimões - Frio da Madrugada - Ao Vivo', '', 'Rionegro e Solimões', 'Frio da Madrugada'],
    ['Maná - Rayando el Sol - En Vivo', '', 'Maná', 'Rayando el Sol'],
    // Featuring removed
    ['Liniker - Tudo feat. Someone (Official Video)', '', 'Liniker', 'Tudo'],
    ['David Guetta - Titanium feat. Sia', '', 'David Guetta', 'Titanium'],
    // Parenthetical chunk stripped
    ['Gusttavo Lima - Balada (Tchê Tcherere Tchê Tchê)', '', 'Gusttavo Lima', 'Balada'],
    // Channel matches neither part -> convention
    ['De Nada - Moana', 'DisneyBR', 'De Nada', 'Moana'],
  ];
  for (const [title, channel, artist, songTitle] of tests) {
    await t.test(`${title}/${channel}`, () => {
      const r = tp.parseWithChannel(title, channel);
      assert.equal(r.artist, artist, `artist (method=${r.method})`);
      assert.equal(r.song, songTitle, `song (method=${r.method})`);
    });
  }
});

test('extractFeaturing', () => {
  const tp = new TitleParser();
  const tests = [
    ['David Guetta - Titanium feat. Sia', ['Sia']],
    ['Calvin Harris - This Is What You Came For ft. Rihanna', ['Rihanna']],
    ['Henrique - Festa (feat. Bruno & Marrone)', ['Bruno', 'Marrone']],
    ['Queen - Bohemian Rhapsody', []],
  ];
  for (const [title, want] of tests) assert.deepEqual(tp.extractFeaturing(title), want, title);
});

test('TitleParser catalog regressions', async (t) => {
  const tp = new TitleParser();
  const hints = { artists: ['Tim Maia', 'Maroon 5', 'Fat Family', 'Anitta', 'Péricles', 'Beyoncé', 'Kid Abelha'], songs: [] };
  const tests = [
    // Karaoke channel must not become the artist.
    ['Daniel Caesar ft. H.E.R. - Best Part (Karaoke Version)', 'Sing King', 'Daniel Caesar', 'Best Part'],
    ['🎤 MAGIC! - No Way No (Karaoke Version) - King Of Karaoke', 'King Of Karaoke', 'MAGIC!', 'No Way No'],
    ['Savage Funk - Anitta - Karaoke Hugo Edit', 'Hugo Edit', 'Anitta', 'Savage Funk'],
    // No separator: split on a known catalog artist.
    ['Tim Maia Me Dê Motivo Karaokê', 'Clubinho do Karaokê', 'Tim Maia', 'Me Dê Motivo'],
    ['Kid Abelha Como eu Quero Karaokê', 'Clubinho do Karaokê', 'Kid Abelha', 'Como Eu Quero'],
    ['Beyoncé   Listen Karaoke Version', 'Kalaikoscope', 'Beyoncé', 'Listen'],
    ['🔰 Até Que Durou (Melhor Karaokê) Péricles', 'Karaokê Brasil', 'Péricles', 'Até Que Durou'],
    // Separator glued to a word, videoke code and "-==" decoration.
    ['In Your Pocket- Maroon 5 Karaoke', 'Carly Dumas', 'Maroon 5', 'In Your Pocket'],
    ['04083 - FAT FAMILY - JEITO SEXY -==Karaoke–Videoke – Playback', 'Raf Electronics', 'Fat Family', 'Jeito Sexy'],
    // "In the style of" phrasing names the real artist.
    ['Fall Down Karaoke in the Style of "Will I Am And Miley Cyrus" Sing Along with Lyrics', 'Karaoke Sing Along', 'Will I Am and Miley Cyrus', 'Fall Down'],
    ['Like Mariah (Originally Performed by Fifth Harmony ) [Karaoke No Guide Melody Version]', 'Edkara', 'Fifth Harmony', 'Like Mariah'],
    ['Amante Profissional (No Estilo de Herva Doce) [Karaoke Version]', 'Ameritz Karaoke Português', 'Herva Doce', 'Amante Profissional'],
    // Casing survives: acronyms, hyphenated words.
    ['Rihanna - S&M (Karaoke)', '', 'Rihanna', 'S&M'],
    ['Village People - YMCA', '', 'Village People', 'YMCA'],
    ['Mamonas Assassinas - vira-vira', '', 'Mamonas Assassinas', 'Vira-Vira'],
  ];
  for (const [title, channel, artist, songTitle] of tests) {
    await t.test(title, () => {
      const r = tp.parseWithHints(title, channel, hints);
      assert.deepEqual([r.artist, r.song], [artist, songTitle], `method=${r.method}`);
    });
  }
});

test('extractFeaturing stops at separator', () => {
  const tp = new TitleParser();
  const tests = [
    ['Rihanna ft. Will.I.Am - Photographs (Karaoke)', ['Will.I.Am']],
    ["Lady Gaga ft. Colby O'Donis - Just Dance (Karaoke Version)", ["Colby O'Donis"]],
    ['Tema - Hot e Oreia part. Marina Sena [Letra]', ['Marina Sena']],
  ];
  for (const [title, want] of tests) assert.deepEqual(tp.extractFeaturing(title), want, title);
});

// ----------------------------------------------------------------- language

test('detectLanguage', async (t) => {
  const tests = [
    // Portuguese: title words
    ['Anunciação', '', 'PT-BR'],
    ['Cheia de Manias', '', 'PT-BR'],
    ['Você Sempre Será', '', 'PT-BR'],
    ['Deixa Estar', '', 'PT-BR'],
    ['Não Falamos do Bruno', '', 'PT-BR'],
    ['Olhos Coloridos', '', 'PT-BR'],
    ['Até Que Durou', '', 'PT-BR'],
    // Portuguese: accent characters
    ['Lapada Dela', 'Canção de amor e saudade brasileira', 'PT-BR'],
    // Portuguese: description keywords
    ['Lapada Dela', 'pagode e samba brasileiro', 'PT-BR'],
    // Spanish
    ['Despacito', '', 'EN'],
    ['Nuestra Canción', '', 'ES'],
    ['Corazón Espinado', '', 'ES'],
    ['Quiero Bailar', 'reggaeton hits', 'ES'],
    ['Nuestra Canción', 'Tú me enseñaste una solución para el dolor', 'ES'],
    // English
    ['I Will Always Love You', '', 'EN'],
    ['Breaking Free', '', 'EN'],
    ["You'll Be in My Heart", '', 'EN'],
    ['Love Me Tonight', '', 'EN'],
    ['Never Gonna Give You Up', '', 'EN'],
    // Japanese
    ['残酷な天使のテーゼ', '', 'JA'],
    ['Haruka Kanata', 'anime opening アニメ', 'JA'],
    ['Unravel', 'Tk From 凛として時雨 Romaji lyrics', 'JA'],
    ['Gurenge', 'Romanized version Lisa', 'JA'],
    // Korean
    ['사랑해', '', 'KO'],
    ['Gangnam Style', 'k-pop hit', 'KO'],
    // French
    ['La Vie en Rose', 'chanson française', 'FR'],
    ["Je T'aime", '', 'FR'],
    // German
    ['99 Luftballons', 'deutscher pop', 'DE'],
    ['Ich Will', '', 'DE'],
    // Italian
    ['Volare', 'canzone italiana', 'IT'],
    ['Nel Blu Dipinto di Blu', 'amore mio', 'IT'],
  ];
  for (const [title, description, expected] of tests) {
    await t.test(`${title} | ${description}`, () => {
      assert.equal(detectLanguage(title, description, 'EN'), expected);
    });
  }
});

test('detectByScript', () => {
  const tests = [
    ['残酷な天使のテーゼ', 'JA'],
    ['ひらがなテスト', 'JA'],
    ['사랑해', 'KO'],
    ['Hello World', ''],
    ['Anunciação', ''],
  ];
  for (const [text, expected] of tests) assert.equal(detectByScript(text), expected, text);
});

const ptLyrics = 'Quando eu digo que deixei de te amar\nÉ porque eu te amo\nQuando eu digo que não quero mais você\nÉ porque eu te quero';
const esLyrics = 'Yo no sé si es amor lo que siento\nPero cuando te veo me pierdo en tu mirada\nY no quiero que te vayas de mi vida';

test('language chain steps', async (t) => {
  const tests = [
    ['artist rule', { artistLanguage: 'PT-BR', title: 'Hello (Karaoke)', default: 'EN' }, 'PT-BR', 'artist'],
    ['lyrics', { lyricsText: esLyrics, title: 'Some Song', default: 'EN' }, 'ES', 'lyrics'],
    ['script', { title: '残酷な天使のテーゼ', default: 'EN' }, 'JA', 'script'],
    ['title words', { title: 'Você Sempre Será - Karaokê', default: 'EN' }, 'PT-BR', 'title'],
    ['default', { title: 'Xyzzy', default: 'es' }, 'ES', 'default'],
    ['default without config', { title: 'Xyzzy' }, 'EN', 'default'],
  ];
  for (const [name, ev, want, reason] of tests) {
    await t.test(name, () => {
      const got = rankLanguages(ev);
      assert.equal(got[0].id, want, JSON.stringify(got));
      assert.equal(got[0].reason, reason, JSON.stringify(got));
      assert.equal(chooseLanguage(ev), want, 'chooseLanguage disagrees with rankLanguages');
    });
  }
});

test('language chain precedence', () => {
  const ev = { artistLanguage: 'EN', lyricsText: ptLyrics, title: 'Canción Bonita - Karaoke', default: 'FR' };
  const got = rankLanguages(ev);
  assert.deepEqual(got.map((g) => g.id), ['EN', 'PT-BR', 'ES', 'FR']);
  // Agreeing evidence raises confidence but keeps one entry per language.
  const agree = rankLanguages({ lyricsText: ptLyrics, title: 'Saudade do meu amor', default: 'PT-BR' });
  assert.equal(agree[0].id, 'PT-BR');
  assert.equal(agree.length, 1);
  assert.ok(agree[0].confidence > 0.6 + 0.3 * 0.5, JSON.stringify(agree));
});

test('language chain Portuguese', () => {
  assert.equal(chooseLanguage({ lyricsText: ptLyrics }), 'PT-BR');
  const got = rankLanguages({ artistLanguage: 'PT', lyricsText: ptLyrics });
  assert.equal(got[0].id, 'PT');
  assert.equal(got.length, 2);
  assert.equal(got[1].id, 'EN');
  assert.equal(lyricsLanguage(ptLyrics, 'PT').lang, 'PT');
});

test('titleLanguage ignores the karaoke word', () => {
  for (const title of ['Karaokê - Jota Quest - Do Seu Lado', 'Raimundos - Me Lambe (KARAOKÊ)']) {
    assert.notEqual(titleLanguage(title, ''), 'FR', title);
  }
});

test('artistLanguageFrom', () => {
  const pairs = [
    { songId: '1', artist: 'Anitta', language: 'PT-BR' },
    { songId: '2', artist: 'Anitta; Maluma', language: 'PT-BR' },
    { songId: '3', artist: 'Anitta', language: 'PT-BR' },
    { songId: '4', artist: 'Anitta', language: 'ES' },
  ];
  assert.equal(artistLanguageFrom(pairs, 'Anitta'), 'PT-BR', '3 of 4 PT-BR');
  assert.equal(artistLanguageFrom(pairs.slice(2), 'Anitta'), '', '1 of 2');
});

test('detectLyricsLanguage', () => {
  const tests = [
    ['EN', 'Is this the real life? Is this just fantasy?\nCaught in a landslide, no escape from reality'],
    ['EN', "Yesterday, all my troubles seemed so far away\nNow it looks as though they're here to stay"],
    ['EN', 'You are my sunshine, my only sunshine\nYou make me happy when skies are gray'],
    ['EN', "I don't know what I'm doing but I can't stop now\nIt's all that I got and I'll never let go"],
    ['PT-BR', 'Quando eu digo que deixei de te amar\nÉ porque eu te amo\nQuando eu digo que não quero mais você\nÉ porque eu te quero'],
    ['PT-BR', 'Olha que coisa mais linda, mais cheia de graça\nÉ ela a menina que vem e que passa'],
    ['PT-BR', 'Atirei o pau no gato mas o gato não morreu\nDona Chica admirou-se do berro que o gato deu'],
    ['PT-BR', 'Ai, se eu te pego, ai, ai, se eu te pego\nDelícia, delícia, assim você me mata'],
    ['ES', 'Ay, ay, ay, ay, canta y no llores\nPorque cantando se alegran, cielito lindo, los corazones'],
    ['ES', 'Sí, sabes que ya llevo un rato mirándote\nTengo que bailar contigo hoy'],
    ['ES', 'Dicen que por las noches no más se le iba en puro llorar\nDicen que no comía, no más se le iba en cantar'],
    ['ES', 'Yo no soy marinero, soy capitán\nTú eres mi vida y mi corazón, y yo te quiero'],
    ['FR', 'Frère Jacques, frère Jacques, dormez-vous? Dormez-vous?\nSonnez les matines, sonnez les matines'],
    ['FR', 'Des yeux qui font baisser les miens\nUn rire qui se perd sur sa bouche'],
    ['FR', "Non, rien de rien, non, je ne regrette rien\nNi le bien qu'on m'a fait, ni le mal"],
    ['FR', "Sur le pont d'Avignon, on y danse, on y danse\nSur le pont d'Avignon, on y danse tous en rond"],
    ['IT', 'Penso che un sogno così non ritorni mai più\nMi dipingevo le mani e la faccia di blu'],
    ['IT', "Cerco l'estate tutto l'anno\nE all'improvviso eccola qua, ma non è più come prima"],
    ['IT', "Una mattina mi sono alzato\nO bella ciao, e ho trovato l'invasor"],
    ['IT', 'Lasciatemi cantare con la chitarra in mano\nLasciatemi cantare, sono un italiano'],
    ['DE', 'O Tannenbaum, o Tannenbaum, wie treu sind deine Blätter\nDu grünst nicht nur zur Sommerzeit'],
    ['DE', 'Hast du etwas Zeit für mich\nDann singe ich ein Lied für dich von neunundneunzig Luftballons'],
    ['DE', 'Stille Nacht, heilige Nacht, alles schläft, einsam wacht\nNur das traute, hochheilige Paar'],
    ['DE', 'Der Mond ist aufgegangen, die goldnen Sternlein prangen\nAm Himmel hell und klar'],
    ['JA', 'さくらさくら 弥生の空は\n見渡す限り 霞か雲か'],
    ['JA', '上を向いて歩こう\n涙がこぼれないように'],
    ['JA', 'ありがとう 君に会えて\n本当によかった'],
    ['JA', 'ラブストーリーは突然に\n動き出した'],
    ['KO', '나는 너를 사랑해\n영원히 너만을 사랑해'],
    ['KO', '아리랑 아리랑 아라리요\n아리랑 고개로 나를 넘겨주소'],
    ['KO', '오빤 강남스타일\n강남스타일 낮에는 따사로운 인간적인 여자'],
  ];
  for (const [want, text] of tests) {
    const { lang, confidence } = detectLyricsLanguage(text);
    assert.equal(lang, want, `conf ${confidence} for ${JSON.stringify(text)}`);
    assert.ok(confidence > 0 && confidence <= 1, `confidence ${confidence} out of range for ${JSON.stringify(text)}`);
  }
});

test('detectLyricsLanguage unsure', () => {
  for (const input of [
    '', '   ', 'Oh yeah', 'La la la la', 'Hello world', '123 456 789',
    'na na na na na na na na na na',
    'De la Sierra Morena, cielito lindo, vienen bajando',
    '我爱你 你爱我 蜜雪冰城甜蜜蜜',
  ]) {
    assert.equal(detectLyricsLanguage(input).lang, '', JSON.stringify(input));
  }
});

// ------------------------------------------------------------------ extract

test('extractMusicMetadata pinned', async (t) => {
  const songs = [song('Roberto Carlos', 'Detalhes', 'PT-BR'), song('Adele', 'Hello', 'EN')];
  const tests = [
    ['Roberto Carlos - Detalhes (Karaoke HD)', 'Karaoke Brasil', '',
      'Detalhes', 'Roberto Carlos', 'EN', '', 0.9, 'Roberto Carlos|Detalhes'],
    ['Adele - Hello (Karaoke Version)', 'Sing King', "Sing along to Adele's Hello",
      'Hello', 'Adele', 'EN', '', 0.9, 'Adele|Hello'],
    ['Rihanna - Umbrella ft. Jay-Z (Karaoke Version)', 'Sing King', '',
      'Umbrella', 'Rihanna; Jay-Z', 'EN', '', 0.9, ''],
    ['Despacito - Luis Fonsi feat. Daddy Yankee | Karaoke', 'KaraFun', '',
      'Luis Fonsi', 'Despacito; Daddy Yankee', 'EN', '', 0.9, ''],
    ['Evidências - Chitãozinho & Xororó (Karaokê)', 'Clubinho do Karaokê', 'Letra:\nQuando eu digo que deixei de te amar\nÉ porque eu te amo',
      'Chitãozinho & Xororó', 'Evidências', 'PT-BR', 'Quando eu digo que deixei de te amar', 0.9, ''],
    ['Set Fire To The Rain - Adele 【No Guide Melody】 Instrumental', 'Adele - Topic', '',
      'Set Fire to the Rain', 'Adele', 'EN', '', 0.9, ''],
    ['Bohemian Rhapsody', 'Queen Official', 'lyrics: Is this the real life? Is this just fantasy?',
      'Bohemian Rhapsody', 'Queen', 'EN', 'Is this the real life? Is this just fantasy?', 0.6, ''],
    ['Karaoke♬ On The Way - AiNA THE END 【Lyric Romanized】', '', '',
      'On the Way', 'AiNA THE END', 'EN', '', 0.9, ''],
    ['Hello', '', '',
      'Hello', '', 'EN', '', 0.3, ''],
  ];
  for (const [videoTitle, channel, description, title, artist, language, lyrics, confidence, duplicateOf] of tests) {
    await t.test(videoTitle, () => {
      const m = extractMusicMetadata({ videoTitle, channel, description, songs, defaultLanguage: 'EN' });
      const dup = m.duplicate_of ? `${m.duplicate_of.artist}|${m.duplicate_of.title}` : '';
      assert.deepEqual(
        { title: m.title, artist: m.artist, language: m.language, lyrics: m.lyrics_start, orig: m.original_title, confidence: m.confidence, isDup: m.is_duplicate, dup },
        { title, artist, language, lyrics, orig: videoTitle, confidence, isDup: duplicateOf !== '', dup: duplicateOf },
      );
    });
  }
});

// ---------------------------------------------------------- catalog metadata

test('findDuplicateSongs normalized', () => {
  const songs = [
    song('Bruno e Marrone', 'Boate Azul', 'PT-BR'),
    song('Liniker', 'Tudo', 'PT-BR'),
    song('Liniker e os Caramelows', 'Zero', 'PT-BR'),
  ];
  const tests = [
    ['Bruno & Marrone', 'Boate Azul (Ao Vivo)', 1],
    ['BRUNO E MARRONE', 'boate azul', 1],
    ['Liniker', 'Tudo', 1],
    ['Liniker; Majur', 'Tudo', 1],
    ['Liniker', 'Tudo Que Eu Quero', 0], // a LIKE '%tudo%' match, not a duplicate
    ['Someone Else', 'Tudo', 0],
  ];
  for (const [artist, title, want] of tests) {
    assert.equal(findDuplicateSongs(songs, title, artist).length, want, `${title} / ${artist}`);
  }
});

test('findDuplicateSongs excludes the trash (caller passes live songs only)', () => {
  const keep = song('Liniker', 'Tudo', 'PT-BR');
  assert.equal(findDuplicateSongs([keep], 'Tudo', 'Liniker').length, 1);
});

test('suggestCatalogArtist', () => {
  const songs = [
    song('Gloria Groove', 'A Queda', 'PT-BR'),
    song('Gloria Groove', 'Bonekinha', 'PT-BR'),
    song('Glória Groove', 'Radar', 'PT-BR'),
    song('Marília Mendonça; Henrique e Juliano', 'Flor e o Beija-Flor', 'PT-BR'),
  ];
  const tests = [
    ['Glória Groove', 'Gloria Groove'], // most-used spelling wins
    ['Marilia Mendonça', 'Marília Mendonça'],
    ['Ludmilla; Glória Groove', 'Ludmilla; Gloria Groove'], // per credited artist
    ['Henrique & Juliano', 'Henrique e Juliano'],
    ['New Artist', 'New Artist'],
  ];
  for (const [input, want] of tests) assert.equal(suggestCatalogArtist(songs, input), want, input);
});

test('artistLanguage', () => {
  const songs = [];
  for (const title of ['A Lua', 'Amor de Que', 'Corpo Sensual', 'Disk Me']) songs.push(song('Pabllo Vittar', title, 'PT-BR'));
  songs.push(song('Shakira', 'Estoy Aquí', 'ES'));
  songs.push(song('Shakira & Burna Boy', 'Dai Dai', 'EN'));
  songs.push(song('Avril Lavigne', "I'm with You", 'EN'));
  const tests = [
    ['Pabllo Vittar', 'PT-BR'],
    ['Pabllo Vittar; Psirico', 'PT-BR'], // lead artist decides
    ['Shakira', ''], // mixed languages: no opinion
    ['Avril Lavigne', ''], // a single song is not enough
    ['Unknown', ''],
  ];
  for (const [artist, want] of tests) assert.equal(artistLanguage(songs, artist), want, artist);
  // The song under review does not vote for its own language.
  const two = [song('Lead', 'One', 'ES'), song('Lead', 'Two', 'ES')];
  assert.equal(artistLanguage(two, 'Lead'), 'ES');
  assert.equal(artistLanguage(two, 'Lead', two[0].id), '');
});
