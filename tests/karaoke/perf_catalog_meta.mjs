// Perf check for the catalog-aware metadata helpers (not part of node --test).
// Builds a synthetic 3000-song catalog and prints first-call vs repeat-call
// timings. Run: node tests/karaoke/perf_catalog_meta.mjs
import { performance } from 'node:perf_hooks';
import {
  findDuplicateSongs, suggestCatalogArtist, artistLanguage, catalogHints,
} from '../../worker/karaoke/meta/catalog_meta.js';
import { TitleParser } from '../../worker/karaoke/meta/title_parser.js';

const N = Number(process.argv[2]) || 3000;

// Deterministic PRNG so runs are comparable.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const first = ['Ana', 'Bruno', 'Carla', 'Diego', 'Élton', 'Fábio', 'Glória', 'Henrique', 'Iza', 'João', 'Kátia', 'Luan', 'Marília', 'Nando', 'Otávio', 'Paula', 'Roberto', 'Sandra', 'Tiago', 'Vitória'];
const last = ['Silva', 'Souza', 'Mendonça', 'Groove', 'Carlos', 'Lima', 'Reis', 'Marrone', 'Santos', 'Oliveira', 'Costa', 'Ferreira', 'Rocha', 'Almeida', 'Nascimento', 'Araújo', 'Barbosa', 'Pereira', 'Gomes', 'Martins'];
const words = ['amor', 'coração', 'noite', 'saudade', 'love', 'heart', 'night', 'fire', 'rain', 'sol', 'mar', 'céu', 'baby', 'dream', 'vida', 'tempo', 'luz', 'flor', 'estrela', 'caminho', 'forever', 'tonight', 'dance', 'paixão'];
const langs = ['PT-BR', 'PT-BR', 'PT-BR', 'EN', 'EN', 'ES'];

const artists = [];
for (let i = 0; i < Math.ceil(N / 5); i++) {
  let a = `${pick(first)} ${pick(last)}`;
  if (rnd() < 0.15) a += ` e ${pick(first)}`;
  if (rnd() < 0.1) a += `; ${pick(first)} ${pick(last)}`;
  artists.push(a);
}
const songs = [];
for (let i = 0; i < N; i++) {
  const n = 1 + Math.floor(rnd() * 4);
  const title = Array.from({ length: n }, () => pick(words)).join(' ').replace(/^./, (c) => c.toUpperCase()) +
    (rnd() < 0.1 ? ' (Ao Vivo)' : '');
  songs.push({ id: `s${i}`, code: 1000 + i, title, artist: pick(artists), language: pick(langs), youtube_id: `yt${i}` });
}

function time(fn, reps = 20) {
  let t = performance.now();
  fn();
  const firstMs = performance.now() - t;
  t = performance.now();
  for (let i = 0; i < reps; i++) fn();
  return { firstMs, repeatMs: (performance.now() - t) / reps };
}

const sample = songs[1234 % N];
const parser = new TitleParser();
const rows = {
  findDuplicateSongs: time(() => findDuplicateSongs(songs, sample.title, sample.artist)),
  suggestCatalogArtist: time(() => suggestCatalogArtist(songs, 'Gloria Groove; Marilia Mendonca')),
  artistLanguage: time(() => artistLanguage(songs, sample.artist, sample.id)),
  catalogHints: time(() => catalogHints(songs)),
  parseWithHints: time(() => parser.parseWithHints(`${sample.title} - ${sample.artist} (Karaoke Version)`, 'Sing King', catalogHints(songs))),
  'parseWithHints (no separator)': time(() => parser.parseWithHints(`${sample.artist} ${sample.title} Karaokê`, 'Clubinho do Karaokê', catalogHints(songs))),
};

// After a catalog change the Worker passes a new array of new song objects;
// the code is warm by then, so time one more first call on fresh copies.
const callsOn = (list) => ({
  findDuplicateSongs: () => findDuplicateSongs(list, sample.title, sample.artist),
  suggestCatalogArtist: () => suggestCatalogArtist(list, 'Gloria Groove; Marilia Mendonca'),
  artistLanguage: () => artistLanguage(list, sample.artist, sample.id),
  catalogHints: () => catalogHints(list),
  parseWithHints: () => parser.parseWithHints(`${sample.title} - ${sample.artist} (Karaoke Version)`, 'Sing King', catalogHints(list)),
  'parseWithHints (no separator)': () => parser.parseWithHints(`${sample.artist} ${sample.title} Karaokê`, 'Clubinho do Karaokê', catalogHints(list)),
});
const rebuild = {};
for (const name of Object.keys(rows)) {
  const fn = callsOn(songs.map((x) => ({ ...x })))[name];
  const t = performance.now();
  fn();
  rebuild[name] = performance.now() - t;
}

console.log(`catalog: ${songs.length} songs, ${artists.length} artists`);
console.log('first = cold start; rebuild = first call on a new catalog array (warm code); repeat = same array again');
for (const [name, { firstMs, repeatMs }] of Object.entries(rows)) {
  console.log(`${name.padEnd(30)} first ${firstMs.toFixed(2).padStart(6)} ms   rebuild ${rebuild[name].toFixed(2).padStart(6)} ms   repeat ${repeatMs.toFixed(3).padStart(6)} ms`);
}
