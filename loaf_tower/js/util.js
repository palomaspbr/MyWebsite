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
      clip: 'Save the collapse', clipMaking: 'Making your clip…',
      audio: 'Audio', music: 'Music', sfx: 'Sound effects', on: 'on', off: 'off',
      clipReady: 'Your clip is ready!', download: 'Download', shareClip: 'Share clip', close: 'Close',
      clipUnsupported: 'This browser can’t record clips. Try Chrome.',
      best: 'best', cats: 'cats', cat: 'cat', next: 'next', cm: 'cm',
      over: 'Tower down!', newRecord: 'NEW RECORD!',
      towerOf: (n) => `Tower of ${n} ${n === 1 ? 'cat' : 'cats'}`,
      destroyedBy: (name) => `Destroyed by: ${name}`,
      fell: (name) => `${name} fell!`,
      collapse: 'COLLAPSE!', newCat: 'NEW CAT!', locked: '???',
      newCats: (n) => `${n} NEW CATS! See the Catdex`, newCatsWord: 'NEW CATS!',
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
      undo: 'undo', levels: 'Levels', levelsSub: (n, t) => `${n} of ${t} solved`, levelLocked: (n) => `Solve level ${n} first`,
      boardSize: (s, a, b) => `${s}×${s} · levels ${a}–${b}`, rewardCat: 'unlocks a cat',
      lvlShort: (n) => `level ${n}`, subTower: 'how high can you stack?', subMerge: 'make the biggest cat',
      tapAgain: 'tap again to restart',
      modeMahjong: 'Meow Mahjong', modeMahjongShort: 'Mahjong', modeEasy: 'Easy',
      hintMahjong: 'tap two matching free tiles', noMoves: 'No more moves!',
      easyDesc: 'tap tiles into the tray • 3 of a kind clear', mjDesc: 'classic rules: match pairs of free tiles',
      howTo: 'How to play', letsPlay: "Let's play!",
      tutTower1: 'Tap to drop the swinging cat.', tutTower2: 'Stack them as high as you can.', tutTower3: '3 fish = 3 lives. Each collapse costs one.',
      tutYarn1: 'Drag from each cat to the yarn ball of its color.', tutYarn2: "Lines can't cross each other.", tutYarn3: 'Fill every square to solve the level.',
      tutMerge1: 'Aim and let go to drop a cat into the box.', tutMerge2: 'Two of the same cat merge into a bigger one.', tutMerge3: "Don't let the cats pile over the red line.",
      tutTiles1: 'Tap a tile with nothing on top of it.', tutTiles2: 'It goes to the tray: 3 of a kind vanish.', tutTiles3: 'Clear the board. 7 tiles in the tray and you lose!',
      tutMj1: 'Tap two identical tiles to remove them.', tutMj2: 'A tile is free when nothing is on top and its left or right side is open.', tutMj3: 'Stuck? Use hint or shuffle. Clear the board to win!',
      leaderboard: 'Leaderboard', saveName: 'Save', hideMe: 'Hide me', namePlaceholder: 'your name', loading: 'loading…',
      boardTab: { tower: 'Tower', yarn: 'Yarn', merge: 'Merge', tiles: 'Match', mahjong: 'Mahjong' },
      boardPublic: (n) => `You're on the leaderboard as ${n}.`,
      boardPrivate: 'Pick a name to join the public leaderboard. Without a name your scores stay private.',
      boardOffline: "Can't reach the leaderboard right now.", boardEmpty: 'No names here yet. Be the first!',
      boardMe: (s, rank) => (rank ? `Your best: ${s} · #${rank}` : `Your best: ${s} (private)`), boardNoScore: 'No score here yet.',
      levelsSolved: (n) => `${n} ${n === 1 ? 'level' : 'levels'}`,
      nameTaken: 'That name is taken. Try another one.', nameSaved: 'Name saved!', nameHidden: "You're private now.",
      nameShort: 'Use 2 to 16 letters or numbers.', nameLong: 'That name is too long (16 max).',
      supernova: 'SUPERNOVA!',
      modeTiles: 'Meow Match', hintTiles: 'tap tiles • 3 of a kind clear', shuffle: 'shuffle', auto: 'auto-finish',
      layersGroup: (n, a, b) => `${n} layers · levels ${a}–${b}`,
      trayFull: 'Tray full!', tryAgain: 'Try again', tilesLeft: (n) => `${n} ${n === 1 ? 'tile' : 'tiles'} left`,
      clearedLine: (n) => `Level ${n} cleared`, tilesLine: (u, s) => (u + s ? `${u} undo · ${s} shuffle` : 'no undo, no shuffle!'),
      tileStuck: (n) => `Level ${n} of Meow Match is beating me. Can you clear it?`,
      tileShare: (n) => `I cleared level ${n} of Meow Match 🐱 Can you?`,
      bubbles: { squish: ['oof', 'mrrp', 'hmph', 'heavy…', 'get off', 'mlem'], worry: ['!!', 'uh oh', '?!'] },
    },
    pt: {
      tagline: 'empilhe os gatos. não deixe cair.',
      play: 'Jogar', again: 'De novo', menu: 'Menu', catdex: 'Gatodéx', share: 'Compartilhar',
      clip: 'Salvar o desabamento', clipMaking: 'Fazendo seu vídeo…',
      audio: 'Áudio', music: 'Música', sfx: 'Efeitos', on: 'sim', off: 'não',
      clipReady: 'Seu vídeo está pronto!', download: 'Baixar', shareClip: 'Compartilhar vídeo', close: 'Fechar',
      clipUnsupported: 'Este navegador não grava vídeos. Tente o Chrome.',
      best: 'recorde', cats: 'gatos', cat: 'gato', next: 'próximo', cm: 'cm',
      over: 'Desabou!', newRecord: 'NOVO RECORDE!',
      towerOf: (n) => `Torre de ${n} ${n === 1 ? 'gato' : 'gatos'}`,
      destroyedBy: (name) => `Culpa do(a): ${name}`,
      fell: (name) => `${name} caiu!`,
      collapse: 'DESABOU!', newCat: 'GATO NOVO!', locked: '???',
      newCats: (n) => `${n} GATOS NOVOS! Veja a Gatodéx`, newCatsWord: 'GATOS NOVOS!',
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
      undo: 'desfazer', levels: 'Níveis', levelsSub: (n, t) => `${n} de ${t} resolvidos`, levelLocked: (n) => `Resolva o nível ${n} primeiro`,
      boardSize: (s, a, b) => `${s}×${s} · níveis ${a}–${b}`, rewardCat: 'libera um gato',
      lvlShort: (n) => `nível ${n}`, subTower: 'até onde você empilha?', subMerge: 'crie o maior gato',
      tapAgain: 'toque de novo para recomeçar',
      modeMahjong: 'Miau Mahjong', modeMahjongShort: 'Mahjong', modeEasy: 'Fácil',
      hintMahjong: 'toque em duas peças livres iguais', noMoves: 'Sem jogadas!',
      easyDesc: 'toque nas peças • 3 iguais somem', mjDesc: 'regras clássicas: junte pares de peças livres',
      howTo: 'Como jogar', letsPlay: 'Bora jogar!',
      tutTower1: 'Toque para soltar o gato.', tutTower2: 'Empilhe o mais alto que puder.', tutTower3: '3 peixes = 3 vidas. Cada desabamento custa uma.',
      tutYarn1: 'Arraste de cada gato até o novelo da mesma cor.', tutYarn2: 'As linhas não podem se cruzar.', tutYarn3: 'Preencha todos os quadrados.',
      tutMerge1: 'Mire e solte para jogar um gato na caixa.', tutMerge2: 'Dois gatos iguais viram um maior.', tutMerge3: 'Não deixe os gatos passarem da linha vermelha.',
      tutTiles1: 'Toque numa peça sem nada em cima.', tutTiles2: 'Ela vai para a bandeja: 3 iguais somem.', tutTiles3: 'Limpe o tabuleiro. 7 peças na bandeja e você perde!',
      tutMj1: 'Toque em duas peças iguais para tirá-las.', tutMj2: 'Uma peça está livre se não tem nada em cima e o lado esquerdo ou direito está aberto.', tutMj3: 'Travou? Use dica ou embaralhar. Limpe o tabuleiro!',
      leaderboard: 'Placar', saveName: 'Salvar', hideMe: 'Me esconder', namePlaceholder: 'seu nome', loading: 'carregando…',
      boardTab: { tower: 'Torre', yarn: 'Lã', merge: 'Junta', tiles: 'Combina', mahjong: 'Mahjong' },
      boardPublic: (n) => `Você está no placar como ${n}.`,
      boardPrivate: 'Escolha um nome para entrar no placar público. Sem nome, seus pontos ficam privados.',
      boardOffline: 'Não deu para abrir o placar agora.', boardEmpty: 'Ninguém aqui ainda. Seja o primeiro!',
      boardMe: (s, rank) => (rank ? `Seu recorde: ${s} · #${rank}` : `Seu recorde: ${s} (privado)`), boardNoScore: 'Sem pontos aqui ainda.',
      levelsSolved: (n) => `${n} ${n === 1 ? 'nível' : 'níveis'}`,
      nameTaken: 'Esse nome já existe. Tente outro.', nameSaved: 'Nome salvo!', nameHidden: 'Agora você está privado.',
      nameShort: 'Use de 2 a 16 letras ou números.', nameLong: 'Nome longo demais (máx. 16).',
      supernova: 'SUPERNOVA!',
      modeTiles: 'Combina Miau', hintTiles: 'toque nas peças • 3 iguais somem', shuffle: 'embaralhar', auto: 'completar',
      layersGroup: (n, a, b) => `${n} camadas · níveis ${a}–${b}`,
      trayFull: 'Bandeja cheia!', tryAgain: 'Tentar de novo', tilesLeft: (n) => `${n} ${n === 1 ? 'peça restante' : 'peças restantes'}`,
      clearedLine: (n) => `Nível ${n} concluído`, tilesLine: (u, s) => (u + s ? `${u} desfazer · ${s} embaralhar` : 'sem desfazer nem embaralhar!'),
      tileStuck: (n) => `O nível ${n} do Combina Miau está me vencendo. Você consegue?`,
      tileShare: (n) => `Completei o nível ${n} do Combina Miau 🐱 Duvido você!`,
      bubbles: { squish: ['ai', 'mrrp', 'hmpf', 'pesado…', 'sai', 'mlem'], worry: ['!!', 'eita', '?!'] },
    },
  };
})();
