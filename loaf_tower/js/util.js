/* Loaf Tower - shared helpers. Everything hangs off window.LT. */
(function () {
  'use strict';
  const LT = (window.LT = window.LT || {});

  // Logical design size (portrait). The canvas is scaled to fit the screen.
  LT.W = 720;
  LT.H = 1280;

  // Seeded RNG (mulberry32) so games and reels are reproducible.
  LT.rng = function (seed) {
    let a = (seed >>> 0) || 1;
    const f = function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.int = (n) => Math.floor(f() * n);
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.range = (lo, hi) => lo + (hi - lo) * f();
    return f;
  };

  // Stateless hash noise in [-1, 1]; used for the hand-drawn line wobble.
  LT.hash = function (a, b, c) {
    let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
    h = Math.imul(h ^ (b | 0) ^ (h >>> 15), 0xc2b2ae35);
    h = Math.imul(h ^ (c | 0) ^ (h >>> 13), 0x27d4eb2f);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967295) * 2 - 1;
  };

  LT.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  LT.lerp = (a, b, t) => a + (b - a) * t;
  LT.ease = {
    outBack(t) {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  };

  LT.FONT_TITLE = "'Caveat Brush', 'Comic Sans MS', cursive";
  LT.FONT_TEXT = "'Patrick Hand', 'Comic Sans MS', cursive";

  // UI strings. Cat names are shared between languages on purpose.
  LT.I18N = {
    en: {
      tagline: 'stack the cats. don’t let them fall.',
      play: 'Play', again: 'Again', menu: 'Menu', catdex: 'Catdex', share: 'Share',
      clip: '🎬 Save the collapse', clipMaking: 'Making your clip…',
      clipReady: 'Your clip is ready!', download: 'Download', shareClip: 'Share clip', close: 'Close',
      clipUnsupported: 'This browser can’t record clips. Try Chrome.',
      best: 'best', cats: 'cats', cat: 'cat', next: 'next', cm: 'cm',
      over: 'Tower down!', newRecord: 'NEW RECORD!',
      towerOf: (n) => `Tower of ${n} ${n === 1 ? 'cat' : 'cats'}`,
      destroyedBy: (name) => `Destroyed by: ${name} 💀`,
      fell: (name) => `${name} fell!`,
      collapse: 'COLLAPSE!', newCat: 'NEW CAT!', locked: '???',
      tapToDrop: 'tap to drop',
      shareText: (n, cm) => `I stacked ${n} cats (${cm} cm) in Loaf Tower 🐱 Can you beat it?`,
      copied: 'Link copied!',
      modeTower: 'Loaf Tower', modeYarn: 'Yarn Lines', modeMerge: 'Purr Merge',
      hintYarn: 'drag from each cat to its yarn ball', hintMerge: 'aim, release • same cats merge',
      level: 'Level', pairs: 'pairs', hint: 'hint', restart: 'restart', nextLevel: 'Next level',
      solved: 'Purrfect!', fillAll: 'fill every square!', solvedLine: (n) => `Level ${n} solved`,
      movesLine: (m, h) => `${m} moves` + (h ? ` · ${h} ${h === 1 ? 'hint' : 'hints'}` : ' · no hints!'),
      boxFull: 'Box full!', scoreLine: (s) => `Score ${s}`, biggest: (n) => `Biggest cat: ${n}`,
      tooFull: 'too full!', combo: 'combo', cosmic: 'COSMIC!',
      yarnShare: (n) => `I solved level ${n} of Yarn Lines 🧶🐱 Can you?`,
      mergeShare: (s, n) => `I scored ${s} in Purr Merge and made a ${n} 🐱 Beat that!`,
      lvlShort: (n) => `level ${n}`, subTower: 'how high can you stack?', subMerge: 'make the biggest cat',
      bubbles: { squish: ['oof', 'mrrp', 'hmph', 'heavy…', 'get off', 'mlem'], worry: ['!!', 'uh oh', '?!'] },
    },
    pt: {
      tagline: 'empilhe os gatos. não deixe cair.',
      play: 'Jogar', again: 'De novo', menu: 'Menu', catdex: 'Gatodéx', share: 'Compartilhar',
      clip: '🎬 Salvar o desabamento', clipMaking: 'Fazendo seu vídeo…',
      clipReady: 'Seu vídeo está pronto!', download: 'Baixar', shareClip: 'Compartilhar vídeo', close: 'Fechar',
      clipUnsupported: 'Este navegador não grava vídeos. Tente o Chrome.',
      best: 'recorde', cats: 'gatos', cat: 'gato', next: 'próximo', cm: 'cm',
      over: 'Desabou!', newRecord: 'NOVO RECORDE!',
      towerOf: (n) => `Torre de ${n} ${n === 1 ? 'gato' : 'gatos'}`,
      destroyedBy: (name) => `Culpa do(a): ${name} 💀`,
      fell: (name) => `${name} caiu!`,
      collapse: 'DESABOU!', newCat: 'GATO NOVO!', locked: '???',
      tapToDrop: 'toque para soltar',
      shareText: (n, cm) => `Empilhei ${n} gatos (${cm} cm) no Loaf Tower 🐱 Duvido você bater!`,
      copied: 'Link copiado!',
      modeTower: 'Torre de Gatos', modeYarn: 'Linhas de Lã', modeMerge: 'Junta Gato',
      hintYarn: 'arraste de cada gato até seu novelo', hintMerge: 'mire e solte • gatos iguais se juntam',
      level: 'Nível', pairs: 'pares', hint: 'dica', restart: 'recomeçar', nextLevel: 'Próximo nível',
      solved: 'Perfeito!', fillAll: 'preencha todos os quadrados!', solvedLine: (n) => `Nível ${n} resolvido`,
      movesLine: (m, h) => `${m} jogadas` + (h ? ` · ${h} ${h === 1 ? 'dica' : 'dicas'}` : ' · sem dicas!'),
      boxFull: 'Caixa cheia!', scoreLine: (s) => `Pontos ${s}`, biggest: (n) => `Maior gato: ${n}`,
      tooFull: 'cheio demais!', combo: 'combo', cosmic: 'CÓSMICO!',
      yarnShare: (n) => `Resolvi o nível ${n} do Linhas de Lã 🧶🐱 Duvido você!`,
      mergeShare: (s, n) => `Fiz ${s} pontos no Junta Gato e criei um ${n} 🐱`,
      lvlShort: (n) => `nível ${n}`, subTower: 'até onde você empilha?', subMerge: 'crie o maior gato',
      bubbles: { squish: ['ai', 'mrrp', 'hmpf', 'pesado…', 'sai', 'mlem'], worry: ['!!', 'eita', '?!'] },
    },
  };
})();
