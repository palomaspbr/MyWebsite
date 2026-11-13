/* Cat types, palettes, names, physics bodies and the hand-drawn cat renderer. */
(function () {
  'use strict';
  const LT = window.LT;
  const D = LT.Doodle;
  const H = LT.hash;

  const PINK = '#f4a7b5';

  const PALS = {
    orange: { fill: '#f4a65c', stripe: '#d77a33', inner: PINK, kind: 'tabby' },
    gray: { fill: '#aeb0bf', stripe: '#7c7f93', inner: PINK, kind: 'tabby' },
    cream: { fill: '#f6dba5', stripe: '#e0b46d', inner: PINK, kind: 'tabby' },
    white: { fill: '#fffdf7', inner: PINK, kind: 'solid' },
    black: { fill: '#3e3946', inner: '#d98ea4', kind: 'solid', dark: true, eye: '#ffd54a' },
    calico: { fill: '#fffaf0', patches: ['#f2a05a', '#4a414c'], inner: PINK, kind: 'calico' },
    tuxedo: { fill: '#3e3946', bib: '#fffdf7', inner: '#d98ea4', kind: 'tux', dark: true, eye: '#ffd54a', paw: '#fffdf7' },
    siamese: { fill: '#f2e4cc', point: '#6e5243', inner: '#e9a9a9', kind: 'siamese', eye: '#6cc4f5' },
    // Special skins
    bread: { fill: '#f6cf7e', crust: '#9c5523', ear: '#9c5523', inner: '#f6cf7e', kind: 'bread' },
    rainbow: { fill: '#ffffff', ear: '#ff8fab', inner: '#fff1f5', kind: 'rainbow' },
    galaxy: { fill: '#2a235b', ear: '#3b2f78', inner: '#c58cf0', kind: 'galaxy', dark: true, eye: '#fff3a0' },
    pudim: { fill: '#f7c552', caramel: '#8d4a1c', ear: '#8d4a1c', inner: '#c8773c', kind: 'pudim' },
    cupcake: { fill: '#f6c27a', wrapper: '#8ccdf0', frosting: '#ffc4d8', ear: '#f6c27a', inner: PINK, kind: 'cupcake' },
    box: { fill: '#bf9466', inner: PINK, kind: 'box', cat: '#f4a65c' },
    // Yarn Lines exclusives
    knit: { fill: '#fdf3dc', stripe: '#6fa8dc', inner: PINK, kind: 'knit' },
    yarnball: { fill: '#ff8787', stripe: '#e03131', inner: '#ffd6d6', kind: 'wrap' },
    sock: { fill: '#fffaf0', band: '#e8590c', inner: PINK, kind: 'bands' },
    scarf: { fill: '#aeb0bf', stripe: '#7c7f93', scarf: '#e03131', scarf2: '#ffd43b', inner: PINK, kind: 'scarf' },
    sweater: { fill: '#f4a65c', sweater: '#2f9e44', inner: PINK, kind: 'sweater' },
    gold: { fill: '#f7c948', stripe: '#e0a800', ear: '#e0a800', inner: '#fff3bf', kind: 'gold' },
    beanie: { fill: '#ebe6dc', stripe: '#b5ab9b', hat: '#4dabf7', hat2: '#1c7ed6', pom: '#ff8fab', inner: PINK, kind: 'beanie' },
    tangle: { fill: '#f6dba5', threads: ['#e03131', '#4dabf7', '#2f9e44', '#be4bdb'], inner: PINK, kind: 'tangle' },
    granny: { fill: '#fffaf0', squares: ['#ff8787', '#ffd43b', '#69db7c', '#74c0fc', '#b197fc', '#ffa94d'], inner: PINK, kind: 'granny' },
    grandma: { fill: '#d9d5cf', stripe: '#a9a39a', shawl: '#9c36b5', shawl2: '#e599f7', inner: PINK, kind: 'grandma' },
    rainbowknit: { fill: '#ffffff', ear: '#ff8fab', inner: '#fff1f5', kind: 'rainbowknit' },
    cosmicyarn: { fill: '#1d3557', ear: '#2b4a7a', inner: '#c58cf0', kind: 'cosmicyarn', dark: true, eye: '#fff3a0' },
    // Purr Merge tiers
    mochi: { fill: '#ffe3ec', inner: '#ff8fab', kind: 'solid' },
    sun: { fill: '#ffd43b', ear: '#ffa94d', inner: '#ff922b', kind: 'sun' },
    // Meow Match exclusives
    ivory: { fill: '#fbf3dc', back: '#2f9e44', inner: PINK, kind: 'ivory' },
    domino: { fill: '#3e3946', inner: '#d98ea4', kind: 'domino', dark: true, eye: '#ffd54a' },
    lucky: { fill: '#fffdf7', collar: '#e03131', patches: ['#f2a05a', '#4a414c'], inner: PINK, kind: 'lucky' },
    bamboo: { fill: '#d8f5a2', stripe: '#5c940d', inner: PINK, kind: 'bamboo' },
    jade: { fill: '#63c69a', vein: 'rgba(235,255,240,0.55)', ear: '#3fa77c', inner: '#b2f2bb', kind: 'jade' },
    porcelain: { fill: '#fdfdff', blue: '#1c5bb5', inner: '#d0e2ff', kind: 'porcelain', eye: '#4dabf7' },
  };
  const COMMON_PALS = ['orange', 'gray', 'cream', 'white', 'black', 'calico', 'tuxedo', 'siamese'];

  // Shapes are in a box centred on 0,0 (w x h). `density` is relative to Matter's default.
  const TYPES = {
    loaf: { shape: 'rr', w: 118, h: 66, r: 28, density: 1.4, face: [0, -4], fs: 1, paws: true, tail: 1,
      label: { en: 'Classic Loaf', pt: 'Pãozinho' },
      desc: { en: 'A reliable brick of cat.', pt: 'Um tijolinho confiável de gato.' } },
    curl: { shape: 'rr', w: 90, h: 78, r: 38, density: 1.4, face: [-8, -6], fs: 0.95, tailFront: true,
      label: { en: 'Cinnamon Roll', pt: 'Rocambole' },
      desc: { en: 'Curled up. Rolls a little.', pt: 'Enroladinho. Rola um pouco.' } },
    long: { shape: 'rr', w: 176, h: 52, r: 24, density: 1.3, face: [54, -3], fs: 0.85, paws: true, tail: -1, earSpread: 19,
      label: { en: 'Long Cat', pt: 'Gato Comprido' },
      desc: { en: 'Is long.', pt: 'É comprido.' } },
    kitten: { shape: 'rr', w: 58, h: 48, r: 22, density: 0.9, face: [0, -2], fs: 0.62, bigEyes: true, tail: 1, ear: 28, earSpread: 30,
      label: { en: 'Kitten', pt: 'Filhote' },
      desc: { en: 'Tiny. Chaotic. Unbothered.', pt: 'Pequeno. Caótico. Tranquilo.' } },
    chonk: { shape: 'rr', w: 162, h: 100, r: 46, density: 2.4, face: [0, -10], fs: 1.3, paws: true, tail: 1, belly: true,
      label: { en: 'Absolute Unit', pt: 'Gordão' },
      desc: { en: 'Heavy. Proud of it.', pt: 'Pesado. E orgulhoso.' } },
    box: { shape: 'rr', w: 180, h: 64, r: 6, density: 1.2, pal: 'box', custom: 'box',
      label: { en: 'Box Cat', pt: 'Gato na Caixa' },
      desc: { en: 'If it fits, it sits. Flat on top.', pt: 'Se cabe, senta. Reto em cima.' } },
    zoomies: { shape: 'rr', w: 82, h: 72, r: 34, density: 1.3, face: [0, -4], fs: 0.9, paws: true, tail: 1,
      label: { en: 'Zoomies', pt: 'Gato Elétrico' },
      desc: { en: 'Lands… then goes feral for 2 seconds.', pt: 'Cai… e fica doido por 2 segundos.' } },
    perfect: { shape: 'rr', w: 140, h: 72, r: 10, density: 1.4, face: [0, 2], fs: 1, paws: true, pal: 'bread', earSpread: 26,
      label: { en: 'Perfect Loaf', pt: 'Pão Perfeito' },
      desc: { en: 'Rare. Flawless. Sharp corners.', pt: 'Raro. Impecável. Cantos retos.' } },
    cupcake: { shape: 'cupcake', w: 116, h: 92, density: 1.1, face: [0, -20], fs: 0.78, pal: 'cupcake', custom: 'cupcake',
      label: { en: 'Cupcake Cat', pt: 'Gato Cupcake' },
      desc: { en: 'Sweet on top. Pointy on the bottom.', pt: 'Doce em cima. Pontudo embaixo.' } },
    pudim: { shape: 'pudim', w: 136, h: 70, density: 1.7, face: [0, 8], fs: 0.95, pal: 'pudim', custom: 'pudim', bouncy: true,
      label: { en: 'Pudim Cat', pt: 'Gato Pudim' },
      desc: { en: 'Jiggly. Bouncy. Has caramel.', pt: 'Treme. Quica. Tem calda.' } },
    rainbow: { shape: 'rr', w: 128, h: 68, r: 30, density: 1.4, face: [0, -4], fs: 1, paws: true, pal: 'rainbow',
      label: { en: 'Rainbow Cat', pt: 'Gato Arco-íris' },
      desc: { en: 'Sticks to whatever it touches.', pt: 'Gruda em tudo que encosta.' } },
    galaxy: { shape: 'rr', w: 126, h: 68, r: 30, density: 1.4, face: [0, -4], fs: 1, paws: true, tail: 1, pal: 'galaxy',
      label: { en: 'Galaxy Cat', pt: 'Gato Galáxia' },
      desc: { en: 'Floats down and calms the whole tower.', pt: 'Desce flutuando e acalma a torre toda.' } },

    /* ---- Yarn Lines exclusives (unlocked by solving levels) ---- */
    y1: { shape: 'rr', w: 118, h: 66, r: 28, density: 1.4, face: [0, -4], fs: 1, paws: true, tail: 1, pal: 'knit',
      label: { en: 'Knit Cat', pt: 'Gato de Tricô' }, desc: { en: 'Hand-knitted. Slightly itchy.', pt: 'Feito à mão. Pinica um pouco.' } },
    y2: { shape: 'rr', w: 84, h: 84, r: 42, density: 1.4, face: [0, 0], fs: 0.9, pal: 'yarnball',
      label: { en: 'Yarn Ball Cat', pt: 'Gato Novelo' }, desc: { en: 'Became the thing it loved most.', pt: 'Virou o que mais amava.' } },
    y3: { shape: 'rr', w: 176, h: 52, r: 24, density: 1.3, face: [54, -3], fs: 0.85, paws: true, tail: -1, earSpread: 19, pal: 'sock',
      label: { en: 'Sock Cat', pt: 'Gato Meia' }, desc: { en: 'Lost its pair. Doesn’t care.', pt: 'Perdeu o par. Nem liga.' } },
    y4: { shape: 'rr', w: 118, h: 70, r: 28, density: 1.4, face: [0, -8], fs: 1, paws: true, tail: 1, pal: 'scarf',
      label: { en: 'Scarf Cat', pt: 'Gato de Cachecol' }, desc: { en: 'Always cold. Always cozy.', pt: 'Sempre com frio. Sempre quentinho.' } },
    y5: { shape: 'rr', w: 150, h: 92, r: 42, density: 2, face: [0, -12], fs: 1.2, paws: true, tail: 1, pal: 'sweater',
      label: { en: 'Sweater Cat', pt: 'Gato de Suéter' }, desc: { en: 'Grandma made it. It fits.', pt: 'A vó que fez. Serviu.' } },
    y6: { shape: 'rr', w: 128, h: 70, r: 30, density: 1.4, face: [0, -4], fs: 1, paws: true, tail: 1, pal: 'gold',
      label: { en: 'Golden Yarn Cat', pt: 'Gato Fio de Ouro' }, desc: { en: 'Woven from pure gold thread.', pt: 'Tecido com fio de ouro.' } },
    y7: { shape: 'rr', w: 118, h: 70, r: 30, density: 1.4, face: [0, -2], fs: 1, paws: true, tail: 1, pal: 'beanie',
      label: { en: 'Pompom Cat', pt: 'Gato Pompom' }, desc: { en: 'Knitted its own hat. Very proud.', pt: 'Tricotou o próprio gorro. Muito orgulhoso.' } },
    y8: { shape: 'rr', w: 130, h: 74, r: 34, density: 1.4, face: [0, -4], fs: 1, paws: true, tail: -1, pal: 'tangle',
      label: { en: 'Tangled Cat', pt: 'Gato Embolado' }, desc: { en: 'Played with the yarn. The yarn won.', pt: 'Brincou com a lã. A lã venceu.' } },
    y9: { shape: 'rr', w: 124, h: 80, r: 24, density: 1.4, face: [0, -6], fs: 1, paws: true, tail: 1, pal: 'granny',
      label: { en: 'Crochet Cat', pt: 'Gato de Crochê' }, desc: { en: 'Made of granny squares. Machine washable.', pt: 'Feito de quadradinhos de crochê. Pode lavar.' } },
    y10: { shape: 'rr', w: 140, h: 80, r: 36, density: 1.6, face: [0, -8], fs: 1.05, paws: true, tail: 1, pal: 'grandma',
      label: { en: 'Grandma Cat', pt: 'Vovó Gata' }, desc: { en: 'Knits you a sweater every winter.', pt: 'Tricota um suéter pra você todo inverno.' } },
    y11: { shape: 'rr', w: 160, h: 64, r: 30, density: 1.4, face: [44, -3], fs: 0.95, paws: true, tail: -1, pal: 'rainbowknit',
      label: { en: 'Rainbow Yarn Cat', pt: 'Gato Lã Arco-íris' }, desc: { en: 'Every color of yarn at once.', pt: 'Todas as cores de lã de uma vez.' } },
    y12: { shape: 'rr', w: 132, h: 72, r: 32, density: 1.4, face: [0, -4], fs: 1, paws: true, tail: 1, pal: 'cosmicyarn',
      label: { en: 'Cosmic Yarn Cat', pt: 'Gato Lã Cósmica' }, desc: { en: 'Knits constellations. A level 50 legend.', pt: 'Tricota constelações. Lenda do nível 50.' } },

    /* ---- Meow Match exclusives (unlocked by clearing levels) ---- */
    t1: { shape: 'rr', w: 104, h: 84, r: 14, density: 1.4, face: [0, -10], fs: 0.95, paws: true, pal: 'ivory',
      label: { en: 'Tile Cat', pt: 'Gato Peça' }, desc: { en: 'Still waiting for its other two.', pt: 'Ainda esperando os outros dois.' } },
    t2: { shape: 'rr', w: 150, h: 70, r: 16, density: 1.4, face: [0, -2], fs: 1, paws: true, tail: 1, pal: 'domino',
      label: { en: 'Domino Cat', pt: 'Gato Dominó' }, desc: { en: 'Knock one over and they all fall.', pt: 'Derruba um e caem todos.' } },
    t3: { shape: 'rr', w: 112, h: 84, r: 34, density: 1.4, face: [0, -8], fs: 1, paws: true, tail: 1, pal: 'lucky',
      label: { en: 'Lucky Cat', pt: 'Gato da Sorte' }, desc: { en: 'Waves at good luck. It waves back.', pt: 'Acena pra sorte. Ela acena de volta.' } },
    t4: { shape: 'rr', w: 124, h: 70, r: 30, density: 1.4, face: [0, -4], fs: 1, paws: true, tail: 1, pal: 'bamboo',
      label: { en: 'Bamboo Cat', pt: 'Gato Bambu' }, desc: { en: 'Grows 10 cm a day. Sleeps 20 hours.', pt: 'Cresce 10 cm por dia. Dorme 20 horas.' } },
    t5: { shape: 'rr', w: 128, h: 72, r: 30, density: 1.6, face: [0, -4], fs: 1, paws: true, tail: 1, pal: 'jade',
      label: { en: 'Jade Cat', pt: 'Gato de Jade' }, desc: { en: 'Carved from one precious stone.', pt: 'Esculpido numa pedra preciosa.' } },
    t6: { shape: 'rr', w: 136, h: 76, r: 34, density: 1.4, face: [0, -6], fs: 1, paws: true, tail: 1, pal: 'porcelain',
      label: { en: 'Porcelain Cat', pt: 'Gato de Porcelana' }, desc: { en: 'Priceless. Please do not drop.', pt: 'Não tem preço. Por favor, não derrube.' } },
  };

  /* ---- Purr Merge tiers: round cats that merge into the next tier ---- */
  const MERGE = [
    ['bean', 24, 'cream', 'Bean', 'Feijãozinho', 'Smallest cat. Biggest dreams.', 'Menor gato. Maiores sonhos.'],
    ['kit', 32, 'white', 'Kitty', 'Gatinho', 'Fits in a teacup.', 'Cabe numa xícara.'],
    ['mochi', 41, 'mochi', 'Mochi', 'Mochi', 'Soft. Squishy. Pink.', 'Macio. Fofo. Rosa.'],
    ['orange', 51, 'orange', 'Orange Ball', 'Bola Laranja', 'One brain cell, fully round.', 'Um neurônio, bem redondo.'],
    ['gray', 62, 'gray', 'Smoky', 'Fumaça', 'Grumbles politely.', 'Resmunga com educação.'],
    ['calico', 73, 'calico', 'Patches', 'Retalhos', 'Three colors, zero chill.', 'Três cores, zero calma.'],
    ['siamese', 85, 'siamese', 'Duchess', 'Duquesa', 'Expects to be served.', 'Espera ser servida.'],
    ['tuxedo', 98, 'tuxedo', 'Tux', 'Smoking', 'Dressed for the occasion.', 'Pronto para a festa.'],
    ['black', 112, 'black', 'Big Void', 'Vazio', 'Stares into your soul.', 'Encara sua alma.'],
    ['rainbow', 127, 'rainbow', 'Rainbow Orb', 'Orbe Arco-íris', 'Pure joy, compressed.', 'Alegria pura, compactada.'],
    ['galaxy', 144, 'galaxy', 'Cosmic Orb', 'Orbe Cósmico', 'Merge two to crown a king.', 'Junte dois para coroar um rei.'],
    ['sun', 164, 'sun', 'Sun King', 'Rei Sol', 'Merge two for a SUPERNOVA.', 'Junte dois: SUPERNOVA!'],
  ];
  MERGE.forEach(([key, r, pal, en, pt, den, dpt], i) => {
    TYPES['m' + (i + 1)] = {
      shape: 'rr', w: r * 2, h: r * 2, r, density: 1, face: [0, r * 0.08], fs: Math.max(0.55, r / 46), pal,
      // ear size/spread get multiplied by fs (= r/46) in drawStd, so constants here scale with the cat
      ear: 17.5, earSpread: 23, tier: i + 1, radius: r, ball: true,
      label: { en, pt }, desc: { en: den, pt: dpt },
    };
  });

  const DEX_SECTIONS = [
    { id: 'tower', label: { en: 'Loaf Tower', pt: 'Torre de Gatos' }, types: ['loaf', 'curl', 'long', 'kitten', 'chonk', 'box', 'zoomies', 'perfect', 'cupcake', 'pudim', 'rainbow', 'galaxy'] },
    { id: 'yarn', label: { en: 'Yarn Lines', pt: 'Linhas de Lã' }, types: ['y1', 'y2', 'y3', 'y4', 'y5', 'y6', 'y7', 'y8', 'y9', 'y10', 'y11', 'y12'] },
    { id: 'merge', label: { en: 'Purr Merge', pt: 'Junta Gato' }, types: MERGE.map((_, i) => 'm' + (i + 1)) },
    { id: 'tiles', label: { en: 'Meow Match', pt: 'Combina Miau' }, types: ['t1', 't2', 't3', 't4', 't5', 't6'] },
  ];
  const DEX_ORDER = DEX_SECTIONS.reduce((a, s) => a.concat(s.types), []);
  const SPECIAL = { box: 1, zoomies: 1, perfect: 1, cupcake: 1, pudim: 1, rainbow: 1, galaxy: 1 };

  const NAMES = [
    'Biscuit', 'Noodle', 'Mochi', 'Tofu', 'Pickles', 'Nugget', 'Waffles', 'Beans', 'Muffin', 'Sushi',
    'Pretzel', 'Meatball', 'Toast', 'Dumpling', 'Sir Fluff', 'Lord Whiskers', 'Mr. Paws', 'Captain Loaf',
    'Princess Chonk', 'Popcorn', 'Brownie', 'Cookie', 'Churro', 'Taco', 'Marshmallow', 'Cupcake', 'Nacho',
    'Tapioca', 'Fudge', 'Coconut', 'Pudding', 'Chico', 'Ziggy', 'Nina', 'Luna', 'Mia', 'Milo', 'Oliver',
    'Pumpkin', 'Gnocchi', 'Bagel', 'Socks', 'Peanut', 'Cheddar', 'Pancake', 'Tuna', 'Maple', 'Olive',
    'Fluffy', 'Tiki', 'Juju', 'Meatloaf', 'Kiwi', 'Croissant', 'Professor', 'Duchess', 'Lasagna', 'Bubbles',
  ];

  function rrTopY(w, h, r, x) {
    const ax = Math.abs(x), k = w / 2 - r;
    if (ax <= k) return -h / 2;
    const dx = Math.min(ax - k, r);
    return -h / 2 + r - Math.sqrt(Math.max(0, r * r - dx * dx));
  }

  // Outline points in box coordinates.
  function shapePoints(t) {
    if (t.shape === 'rr') return D.roundRect(t.w, t.h, t.r, 5);
    if (t.shape === 'pudim') {
      const wb = t.w, wt = t.w * 0.72, h = t.h;
      return D.roundPoly([[-wt / 2, -h / 2], [wt / 2, -h / 2], [wb / 2, h / 2], [-wb / 2, h / 2]], 15, 4);
    }
    if (t.shape === 'cupcake') {
      const wt = t.w, wb = t.w * 0.64, h = t.h, dh = 40, top = -h / 2 + dh;
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const a = Math.PI + (i / 12) * Math.PI;
        pts.push([Math.cos(a) * (wt / 2), top + Math.sin(a) * dh]);
      }
      pts.push([wb / 2, h / 2], [-wb / 2, h / 2]);
      return D.roundPoly(pts, 10, 3);
    }
    return D.roundRect(t.w, t.h, 20, 4);
  }

  const ptsCache = {};
  function getPts(type) {
    if (!ptsCache[type]) ptsCache[type] = shapePoints(TYPES[type]);
    return ptsCache[type];
  }

  // Create the Matter body. Returns {body, off} where off maps box coords -> body (centroid) coords.
  function createBody(M, type, x, y) {
    const t = TYPES[type];
    const pts = getPts(type);
    const verts = pts.map((p) => ({ x: p[0], y: p[1] }));
    const c = M.Vertices.centre(verts);
    const body = M.Bodies.fromVertices(x, y, [verts], {
      friction: 0.85,
      frictionStatic: 1.4,
      frictionAir: 0.012,
      restitution: t.bouncy ? 0.3 : 0,
      density: 0.001 * t.density,
      slop: 0.03,
      label: 'cat',
    });
    return { body, off: [-c.x, -c.y] };
  }

  // Offset from the box centre to the physics centroid (same as createBody's `off`).
  const offCache = {};
  function getOff(type) {
    if (!offCache[type]) {
      const c = window.Matter.Vertices.centre(getPts(type).map((p) => ({ x: p[0], y: p[1] })));
      offCache[type] = [-c.x, -c.y];
    }
    return offCache[type];
  }

  function catLabel(type, lang) { return TYPES[type].label[lang] || TYPES[type].label.en; }
  function catDesc(type, lang) { return TYPES[type].desc[lang] || TYPES[type].desc.en; }

  /* ---------------- drawing ---------------- */

  function featColor(P) { return P.dark ? '#f1ebe0' : D.INK; }

  function drawEars(ctx, fx, topFn, es, spread, outer, inner, seed, boil) {
    for (const s of [-1, 1]) {
      const ex = fx + s * spread;
      const by = topFn(ex) + es * 0.34;
      const tip = [ex + s * es * 0.2, by - es * 1.02];
      const pts = D.subdiv([[ex - es * 0.56, by], tip, [ex + es * 0.56, by]], 4, true);
      D.shape(ctx, pts, { fill: outer, seed: seed + s * 13, boil, amp: 0.9, lw: 3 });
      const ip = D.subdiv([[ex - es * 0.3, by - es * 0.1], [ex + s * es * 0.13, by - es * 0.74], [ex + es * 0.3, by - es * 0.1]], 3, true);
      D.fill(ctx, ip, { fill: inner, seed: seed + s * 29, boil, amp: 0.6, off: [0, 0] });
    }
  }

  function drawFace(ctx, fx, fy, u, face, P, seed, boil, big, T) {
    const ink = featColor(P);
    const ex = (big ? 17 : 15) * u;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.8 * Math.max(0.8, u);
    const j = (i) => H(seed, i, boil) * 0.6;

    // blush
    ctx.fillStyle = 'rgba(244,130,150,0.38)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(fx + s * 24 * u, fy + 8 * u, 6 * u, 3.6 * u, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const eye = (s) => {
      const x = fx + s * ex + j(s + 2), y = fy + j(s + 4);
      if (face === 'sleep') {
        ctx.beginPath();
        ctx.arc(x, y - 3 * u, 6 * u, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.stroke();
      } else if (face === 'happy') {
        ctx.beginPath();
        ctx.arc(x, y + 3 * u, 6 * u, 1.15 * Math.PI, 1.85 * Math.PI);
        ctx.stroke();
      } else if (face === 'squish') {
        ctx.beginPath();
        ctx.moveTo(x - s * 5 * u, y - 5 * u);
        ctx.lineTo(x + s * 4 * u, y);
        ctx.lineTo(x - s * 5 * u, y + 5 * u);
        ctx.stroke();
      } else if (face === 'dizzy') {
        ctx.beginPath();
        for (let a = 0; a < Math.PI * 4; a += 0.4) {
          const r = (a / (Math.PI * 4)) * 7 * u;
          const px = x + Math.cos(a + T * 9 * s) * r, py = y + Math.sin(a + T * 9 * s) * r;
          if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      } else if (face === 'startle' || face === 'worry') {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, 7.5 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.strokeStyle = D.INK;
        ctx.lineWidth = 2.2 * Math.max(0.8, u);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = D.INK;
        ctx.beginPath();
        ctx.arc(x + s * 0.5 * u, y + 0.8 * u, 3.2 * u, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // open
        const r = (big ? 6.4 : 5) * u;
        ctx.fillStyle = P.eye || D.INK;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (P.eye) {
          ctx.fillStyle = D.INK;
          ctx.beginPath();
          ctx.ellipse(x, y, r * 0.38, r * 0.85, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x - r * 0.35, y - r * 0.38, r * 0.32, 0, Math.PI * 2);
        ctx.fill();
        if (big) {
          ctx.beginPath();
          ctx.arc(x + r * 0.3, y + r * 0.35, r * 0.16, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    eye(-1);
    eye(1);

    if (face === 'worry') {
      ctx.beginPath();
      ctx.moveTo(fx - ex - 6 * u, fy - 13 * u);
      ctx.lineTo(fx - ex + 5 * u, fy - 10 * u);
      ctx.moveTo(fx + ex + 6 * u, fy - 13 * u);
      ctx.lineTo(fx + ex - 5 * u, fy - 10 * u);
      ctx.stroke();
      // sweat drop
      ctx.fillStyle = '#7cc6f2';
      const sx = fx + ex + 15 * u, sy = fy - 12 * u;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 7 * u);
      ctx.quadraticCurveTo(sx + 6 * u, sy + 2 * u, sx, sy + 4 * u);
      ctx.quadraticCurveTo(sx - 6 * u, sy + 2 * u, sx, sy - 7 * u);
      ctx.fill();
    }

    // nose
    ctx.fillStyle = '#ee8c9e';
    ctx.beginPath();
    ctx.moveTo(fx - 3.6 * u, fy + 5 * u);
    ctx.lineTo(fx + 3.6 * u, fy + 5 * u);
    ctx.lineTo(fx, fy + 9 * u);
    ctx.closePath();
    ctx.fill();

    // mouth
    ctx.lineWidth = 2.2 * Math.max(0.8, u);
    ctx.beginPath();
    if (face === 'startle' || face === 'worry') {
      ctx.ellipse(fx, fy + 14 * u, 3.4 * u, 4.4 * u, 0, 0, Math.PI * 2);
    } else if (face === 'squish') {
      ctx.moveTo(fx - 7 * u, fy + 13 * u);
      ctx.quadraticCurveTo(fx - 3.5 * u, fy + 10 * u, fx, fy + 13 * u);
      ctx.quadraticCurveTo(fx + 3.5 * u, fy + 16 * u, fx + 7 * u, fy + 13 * u);
    } else {
      ctx.arc(fx - 3.6 * u, fy + 9.5 * u, 3.6 * u, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.moveTo(fx + 7.2 * u, fy + 9.5 * u);
      ctx.arc(fx + 3.6 * u, fy + 9.5 * u, 3.6 * u, 0.1 * Math.PI, 0.9 * Math.PI);
    }
    ctx.stroke();

    // whiskers
    ctx.globalAlpha *= 0.75;
    ctx.lineWidth = 1.6 * Math.max(0.8, u);
    ctx.beginPath();
    for (const s of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const y0 = fy + (7 + k * 5) * u;
        ctx.moveTo(fx + s * 20 * u, y0);
        ctx.lineTo(fx + s * 34 * u, y0 - 3 * u + k * 5 * u + j(k + s * 3) * 2);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawPaws(ctx, fx, h, u, color, seed, boil, gap) {
    for (const s of [-1, 1]) {
      const pts = D.ellipse(10 * u, 6.5 * u, 12, fx + s * (gap || 15) * u, h / 2 - 4 * u);
      D.shape(ctx, pts, { fill: color, seed: seed + 60 + s, boil, amp: 0.7, lw: 2.6, passes: 1 });
    }
  }

  function patterns(ctx, t, P, fx, fy, u, seed, boil, T) {
    const w = t.w, h = t.h;
    const rnd = LT.rng(seed * 7 + 3);
    if (P.kind === 'tabby') {
      ctx.save();
      ctx.strokeStyle = P.stripe;
      ctx.lineWidth = 4.5 * Math.max(0.7, u);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = -1; k <= 1; k++) {
        const x = fx + k * 8 * u;
        ctx.moveTo(x, fy - 29 * u);
        ctx.quadraticCurveTo(x + k * 2, fy - 22 * u, x, fy - 15 * u);
      }
      for (const s of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
          const x = s * (w / 2 - 9 - k * 13);
          if (Math.abs(x - fx) < 40 * u) continue;
          ctx.moveTo(x, -h / 2 + 5);
          ctx.quadraticCurveTo(x - s * 6, -h / 2 + 16, x, -h / 2 + 27);
        }
      }
      ctx.stroke();
      ctx.restore();
    } else if (P.kind === 'calico') {
      for (let k = 0; k < 3; k++) {
        const pts = D.ellipse(rnd.range(14, 26), rnd.range(12, 20), 12, rnd.range(-w / 2, w / 2), rnd.range(-h / 2, h / 2));
        D.fill(ctx, pts, { fill: P.patches[k % 2], seed: seed + k * 11, boil, amp: 2.5, off: [0, 0] });
      }
    } else if (P.kind === 'tux') {
      D.fill(ctx, D.ellipse(24 * u, 26 * u, 14, fx, fy + h * 0.46), { fill: P.bib, seed: seed + 5, boil, off: [0, 0] });
      D.fill(ctx, D.ellipse(14 * u, 9 * u, 12, fx, fy + 10 * u), { fill: P.bib, seed: seed + 6, boil, off: [0, 0] });
    } else if (P.kind === 'siamese') {
      ctx.save();
      ctx.globalAlpha = 0.8;
      D.fill(ctx, D.ellipse(22 * u, 17 * u, 14, fx, fy + 6 * u), { fill: P.point, seed: seed + 5, boil, off: [0, 0], amp: 2 });
      ctx.restore();
    } else if (P.kind === 'bread') {
      ctx.save();
      ctx.fillStyle = P.crust;
      ctx.beginPath();
      ctx.moveTo(-w / 2 - 4, -h / 2 - 4);
      ctx.lineTo(w / 2 + 4, -h / 2 - 4);
      ctx.lineTo(w / 2 + 4, -h / 2 + 13);
      ctx.quadraticCurveTo(0, -h / 2 + 19, -w / 2 - 4, -h / 2 + 13);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,240,200,0.75)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let k = -1; k <= 1; k++) {
        ctx.moveTo(k * 36 - 10, -h / 2 + 3);
        ctx.lineTo(k * 36 + 10, -h / 2 + 10);
      }
      ctx.stroke();
      ctx.restore();
    } else if (P.kind === 'rainbow') {
      const cols = ['#ff7b7b', '#ffaa55', '#ffe066', '#7ee08a', '#6cb8ff', '#a98bff'];
      const bh = (h + 8) / cols.length;
      for (let k = 0; k < cols.length; k++) {
        ctx.fillStyle = cols[k];
        ctx.fillRect(-w / 2 - 6, -h / 2 - 4 + k * bh, w + 12, bh + 1);
      }
    } else if (P.kind === 'galaxy' || P.kind === 'cosmicyarn') {
      const neb = ['rgba(140,95,230,0.55)', 'rgba(70,150,230,0.45)', 'rgba(235,115,205,0.38)'];
      for (let k = 0; k < 3; k++) {
        const pts = D.ellipse(rnd.range(22, 38), rnd.range(14, 24), 14, rnd.range(-w / 3, w / 3), rnd.range(-h / 3, h / 3));
        D.fill(ctx, pts, { fill: neb[k], seed: seed + k * 9, boil, amp: 3, off: [0, 0] });
      }
      const stars = [];
      for (let k = 0; k < 11; k++) {
        const x = rnd.range(-w / 2 + 6, w / 2 - 6), y = rnd.range(-h / 2 + 5, h / 2 - 5);
        const tw = (H(seed, k, boil) + 1) * 0.5;
        if (Math.abs(x - fx) < 26 && Math.abs(y - fy) < 14) continue;
        stars.push([x, y]);
        D.sparkle(ctx, x, y, 2 + tw * 3.5, k % 4 === 0 ? '#ffe9a0' : '#ffffff');
      }
      if (P.kind === 'cosmicyarn' && stars.length > 2) {
        // golden yarn stitched between the stars, like a constellation
        stars.sort((a, b) => a[0] - b[0]);
        for (const side of [stars.filter((p) => p[0] < fx - 30 * u), stars.filter((p) => p[0] > fx + 30 * u)]) {
          if (side.length > 1) D.line(ctx, side, { seed: seed + 51 + side.length, boil, lw: 2.6, ink: '#ffd43b', passes: 1, amp: 1.2 });
        }
      }
    } else if (P.kind === 'beanie' || P.kind === 'grandma') {
      // soft tabby stripes on the back (the hat / glasses are drawn after the face)
      ctx.save();
      ctx.strokeStyle = P.stripe;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const s of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
          const x = s * (w / 2 - 10 - k * 13);
          if (Math.abs(x - fx) < 42 * u) continue;
          ctx.moveTo(x, -h / 2 + 8);
          ctx.quadraticCurveTo(x - s * 6, -h / 2 + 18, x, -h / 2 + 28);
        }
      }
      ctx.stroke();
      ctx.restore();
      if (P.kind === 'grandma') {
        // knitted shawl over the shoulders, tip pointing down, with a fringe
        const sy = fy + 18 * u;
        ctx.fillStyle = P.shawl;
        ctx.beginPath();
        ctx.moveTo(-w / 2 - 6, sy - 6);
        ctx.lineTo(w / 2 + 6, sy - 6);
        ctx.lineTo(w / 2 + 6, sy + 6);
        ctx.lineTo(fx, h / 2 + 4);
        ctx.lineTo(-w / 2 - 6, sy + 6);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = P.shawl2;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        for (let x = -w / 2 + 6; x < w / 2; x += 12) { ctx.moveTo(x - 3, sy - 2); ctx.lineTo(x, sy + 3); ctx.lineTo(x + 3, sy - 2); }
        ctx.stroke();
      }
    } else if (P.kind === 'tangle') {
      ctx.save();
      ctx.lineWidth = 3.4;
      ctx.lineCap = 'round';
      for (let k = 0; k < 6; k++) {
        ctx.strokeStyle = P.threads[k % P.threads.length];
        ctx.beginPath();
        ctx.moveTo(rnd.range(-w / 2, w / 2), rnd.range(-h / 2, h / 2));
        for (let s = 0; s < 2; s++) {
          ctx.bezierCurveTo(rnd.range(-w * 0.7, w * 0.7), rnd.range(-h, h), rnd.range(-w * 0.7, w * 0.7), rnd.range(-h, h), rnd.range(-w / 2, w / 2), rnd.range(-h / 2, h / 2));
        }
        ctx.stroke();
      }
      ctx.restore();
      D.fill(ctx, D.ellipse(34 * u, 21 * u, 16, fx, fy + 4 * u), { fill: P.fill, seed: seed + 8, boil, off: [0, 0], amp: 1.5 });
    } else if (P.kind === 'granny') {
      // granny squares: little framed squares with a contrasting centre
      const q = 26;
      let n = 0;
      for (let y = -h / 2 - 4; y < h / 2; y += q) {
        for (let x = -w / 2 - 4; x < w / 2; x += q, n++) {
          const c = P.squares;
          ctx.fillStyle = c[(n * 7 + 3) % c.length];
          ctx.fillRect(x + 1.5, y + 1.5, q - 3, q - 3);
          ctx.fillStyle = c[(n * 5 + 1) % c.length];
          ctx.fillRect(x + 7, y + 7, q - 14, q - 14);
          ctx.fillStyle = '#fffaf0';
          ctx.fillRect(x + 11, y + 11, q - 22, q - 22);
        }
      }
      // plain patch behind the face so it stays readable
      D.fill(ctx, D.ellipse(36 * u, 22 * u, 16, fx, fy + 4 * u), { fill: P.fill, seed: seed + 8, boil, off: [0, 0], amp: 1.5 });
    } else if (P.kind === 'rainbowknit') {
      const cols = ['#ff7b7b', '#ffaa55', '#ffe066', '#7ee08a', '#6cb8ff', '#a98bff'];
      const bw = 24;
      for (let k = 0, x = -w / 2 - h; x < w / 2 + h; x += bw, k++) {
        ctx.fillStyle = cols[k % cols.length];
        ctx.beginPath();
        ctx.moveTo(x, h / 2 + 6); ctx.lineTo(x + bw, h / 2 + 6); ctx.lineTo(x + bw + h + 12, -h / 2 - 6); ctx.lineTo(x + h + 12, -h / 2 - 6);
        ctx.closePath();
        ctx.fill();
      }
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let y = -h / 2 + 8, row = 0; y < h / 2; y += 11, row++) {
        for (let x = -w / 2 + (row % 2 ? 5 : 0); x < w / 2; x += 10) {
          if (Math.abs(x - fx) < 30 * u && Math.abs(y - fy) < 20 * u) continue;
          ctx.moveTo(x - 4, y - 3); ctx.lineTo(x, y + 2); ctx.lineTo(x + 4, y - 3);
        }
      }
      ctx.stroke();
      ctx.restore();
    } else if (P.kind === 'sun') {
      const g = ctx.createRadialGradient(fx, fy, 4, 0, 0, Math.max(w, h) * 0.62);
      g.addColorStop(0, '#fff3bf');
      g.addColorStop(0.55, 'rgba(255,212,59,0)');
      g.addColorStop(1, '#ff922b');
      ctx.fillStyle = g;
      ctx.fillRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12);
      ctx.save();
      ctx.strokeStyle = 'rgba(232,89,12,0.45)';
      ctx.lineWidth = Math.max(2.4, 3 * u * 0.6);
      ctx.lineCap = 'round';
      for (let k = 0; k < 5; k++) {
        const a = rnd.range(0, Math.PI * 2), rr = rnd.range(0.55, 0.8) * (w / 2);
        ctx.beginPath();
        ctx.arc(0, 0, rr, a, a + 0.7);
        ctx.stroke();
      }
      ctx.restore();
    } else if (P.kind === 'ivory') {
      // mahjong tile: ivory face, green back showing at the bottom, red corner dots
      ctx.fillStyle = P.back;
      ctx.fillRect(-w / 2 - 6, h / 2 - h * 0.24, w + 12, h);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(-w / 2 - 6, h / 2 - h * 0.24, w + 12, 4);
      ctx.fillStyle = '#e03131';
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * (w / 2 - 14), -h / 2 + 14, 4.5, 0, Math.PI * 2); ctx.fill(); }
    } else if (P.kind === 'domino') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,253,247,0.8)';
      ctx.lineWidth = 2.4;
      ctx.strokeRect(-w / 2 + 7, -h / 2 + 7, w - 14, h - 14);
      ctx.restore();
      ctx.fillStyle = '#fffdf7';
      const pip = (x, y) => { ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); };
      const L0 = -w / 2 + 26, R0 = w / 2 - 26;
      pip(L0 - 8, -h / 4); pip(L0, 0); pip(L0 + 8, h / 4);
      pip(R0 - 8, -h / 4); pip(R0 + 8, h / 4);
    } else if (P.kind === 'lucky') {
      for (let k = 0; k < 2; k++) {
        const pts = D.ellipse(rnd.range(12, 18), rnd.range(10, 14), 12, (k ? 1 : -1) * rnd.range(w * 0.25, w * 0.38), rnd.range(-h / 2 + 6, -h / 6));
        D.fill(ctx, pts, { fill: P.patches[k], seed: seed + k * 11, boil, amp: 2, off: [0, 0] });
      }
      ctx.fillStyle = P.collar;
      ctx.fillRect(-w / 2 - 6, fy + 18 * u, w + 12, 9);
    } else if (P.kind === 'bamboo') {
      ctx.save();
      ctx.strokeStyle = P.stripe;
      ctx.lineCap = 'round';
      for (let x = -w / 2 + 12; x < w / 2; x += 26) {
        if (Math.abs(x - fx) < 24 * u) continue;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x, -h / 2); ctx.lineTo(x, h / 2); ctx.stroke();
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (let y = -h / 2 + 14 + (x % 3) * 4; y < h / 2; y += 22) { ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); }
        ctx.stroke();
      }
      ctx.restore();
    } else if (P.kind === 'jade') {
      ctx.save();
      ctx.strokeStyle = P.vein;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.moveTo(rnd.range(-w / 2, w / 2), -h / 2);
        ctx.bezierCurveTo(rnd.range(-w / 2, w / 2), rnd.range(-h / 2, 0), rnd.range(-w / 2, w / 2), rnd.range(0, h / 2), rnd.range(-w / 2, w / 2), h / 2);
        ctx.stroke();
      }
      ctx.restore();
      const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.4)');
      g.addColorStop(0.45, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12);
    } else if (P.kind === 'porcelain') {
      // blue-and-white: little flowers and a wave band near the bottom
      ctx.save();
      ctx.strokeStyle = P.blue;
      ctx.fillStyle = P.blue;
      ctx.lineWidth = 2.4;
      const spots = [[-w / 2 + 20, -h / 2 + 18], [w / 2 - 20, -h / 2 + 18], [-w / 2 + 16, 8], [w / 2 - 16, 8]];
      for (const [sx, sy] of spots) {
        const x = sx + rnd.range(-4, 4), y = sy + rnd.range(-3, 3);
        if (Math.abs(x - fx) < 34 * u) continue;
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * Math.PI * 2;
          ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * 6, y + Math.sin(a) * 6, 4, 2.6, a, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
      }
      const by = h / 2 - 12;
      ctx.beginPath();
      ctx.moveTo(-w / 2 - 4, by);
      for (let x = -w / 2 - 4; x < w / 2 + 4; x += 12) ctx.quadraticCurveTo(x + 6, by - 8, x + 12, by);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-w / 2 - 4, by + 7); ctx.lineTo(w / 2 + 4, by + 7); ctx.stroke();
      ctx.restore();
    }
    if (P.kind === 'knit' || P.kind === 'sweater') {
      const sweater = P.kind === 'sweater';
      const y0 = sweater ? fy + 18 * u : -h / 2 + 8;
      if (sweater) {
        // green sweater over the lower body, with a white diamond band
        ctx.fillStyle = P.sweater;
        ctx.fillRect(-w / 2 - 6, y0 - 8, w + 12, h);
        ctx.fillStyle = '#fffdf5';
        for (let x = -w / 2 + 8; x < w / 2; x += 22) {
          ctx.beginPath(); ctx.moveTo(x, y0 + 2); ctx.lineTo(x + 6, y0 + 8); ctx.lineTo(x, y0 + 14); ctx.lineTo(x - 6, y0 + 8); ctx.closePath(); ctx.fill();
        }
      }
      // rows of little knit "V" stitches
      ctx.save();
      ctx.strokeStyle = sweater ? 'rgba(255,255,255,0.45)' : P.stripe;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let y = sweater ? y0 + 24 : y0, row = 0; y < h / 2; y += 11, row++) {
        for (let x = -w / 2 + (row % 2 ? 5 : 0); x < w / 2; x += 10) {
          if (!sweater && Math.abs(x - fx) < 30 * u && Math.abs(y - fy) < 20 * u) continue;
          ctx.moveTo(x - 4, y - 3); ctx.lineTo(x, y + 2); ctx.lineTo(x + 4, y - 3);
        }
      }
      ctx.stroke();
      ctx.restore();
    } else if (P.kind === 'wrap') {
      ctx.save();
      ctx.strokeStyle = P.stripe;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let k = 0; k < 5; k++) {
        const a = -0.9 + k * 0.45;
        ctx.beginPath();
        ctx.ellipse(0, 0, w * 0.48, h * 0.2, a, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      }
      ctx.restore();
      // loose thread
      D.line(ctx, [[w * 0.32, h * 0.32], [w * 0.5, h * 0.42], [w * 0.62, h * 0.36]], { seed: seed + 9, boil, lw: 2.6, ink: P.stripe, passes: 1 });
    } else if (P.kind === 'bands') {
      for (let k = 0, x = -w / 2; x < w / 2 + 10; x += 22, k++) {
        if (k % 2) { ctx.fillStyle = P.band; ctx.fillRect(x, -h / 2 - 4, 22, h + 8); }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.0)';
    } else if (P.kind === 'scarf') {
      const sy = fy + 20 * u;
      ctx.fillStyle = P.scarf;
      ctx.fillRect(-w / 2 - 6, sy - 6, w + 12, 13);
      ctx.fillStyle = P.scarf2;
      for (let x = -w / 2; x < w / 2; x += 16) ctx.fillRect(x, sy - 6, 6, 13);
    } else if (P.kind === 'gold') {
      const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.45)');
      g.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(180,120,0,0.25)');
      ctx.fillStyle = g;
      ctx.fillRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12);
      for (let k = 0; k < 5; k++) {
        const x = rnd.range(-w / 2 + 8, w / 2 - 8), y = rnd.range(-h / 2 + 6, h / 2 - 6);
        if (Math.abs(x - fx) < 26 && Math.abs(y - fy) < 14) continue;
        D.sparkle(ctx, x, y, 2 + (H(seed, k, boil) + 1) * 2, '#fffbe6');
      }
    }
    if (t.belly) {
      D.fill(ctx, D.ellipse(w * 0.3, h * 0.24, 16, fx, h / 2 - h * 0.12), { fill: 'rgba(255,255,255,0.28)', seed: seed + 77, boil, off: [0, 0] });
    }
  }

  function drawStd(ctx, c, t, P, T, boil) {
    const w = t.w, h = t.h, r = t.r, u = t.fs || 1;
    const fx = t.face ? t.face[0] : 0, fy = t.face ? t.face[1] : -4;
    const seed = c.seed;
    const topFn = (x) => rrTopY(w, h, r, x);
    const pts = getPts(c.type);

    if (c.zoom) {
      ctx.save();
      ctx.strokeStyle = 'rgba(43,37,32,0.55)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const y = -h / 3 + (k * h) / 3 + H(seed, k, boil) * 3;
        const s = H(seed + 1, k, boil) > 0 ? 1 : -1;
        ctx.moveTo(s * (w / 2 + 8), y);
        ctx.lineTo(s * (w / 2 + 30 + k * 6), y);
      }
      ctx.stroke();
      ctx.restore();
    }

    if (t.tail) {
      const sd = t.tail;
      const sw = Math.sin(T * 2.2 + seed) * 4;
      const bx = sd * (w / 2 - 12), by = h / 2 - 10;
      const tp = [[bx, by], [bx + sd * 20, by - 2], [bx + sd * 31, by - 20 + sw], [bx + sd * 25, by - 40 + sw * 1.6]];
      D.tube(ctx, tp, { fill: P.kind === 'siamese' ? P.point : P.fill, width: 10 * Math.max(0.7, u), seed: seed + 3, boil, lw: 3 });
    }

    const es = (t.ear || 22) * u;
    const spread = (t.earSpread || 24) * u;
    const earOuter = P.ear || (P.kind === 'siamese' ? P.point : P.fill);
    if (P.kind !== 'beanie') drawEars(ctx, fx, topFn, es, spread, earOuter, P.inner, seed, boil); // beanie cats tuck their ears in

    D.fill(ctx, pts, { fill: P.fill, seed, boil }, () => {
      patterns(ctx, t, P, fx, fy, u, seed, boil, T);
      D.shade(ctx, w, h, seed, boil, P.dark ? 0.22 : 0.12);
    });
    D.outline(ctx, pts, { seed, boil });

    if (t.tailFront) {
      const sw = Math.sin(T * 2 + seed) * 2;
      const tp = [[w / 2 - 6, -4], [w / 2 - 10, h / 2 - 12], [w / 2 - 40, h / 2 - 7 + sw], [-w / 2 + 30, h / 2 - 12]];
      D.tube(ctx, tp, { fill: P.kind === 'siamese' ? P.point : P.fill, width: 11, seed: seed + 4, boil, lw: 2.8 });
    }
    if (t.paws) drawPaws(ctx, fx, h, u, P.paw || (P.kind === 'siamese' ? P.point : P.fill), seed, boil);
    drawFace(ctx, fx, fy, u, c.face, P, seed, boil, t.bigEyes, T);

    if (P.kind === 'scarf') {
      // scarf end hanging over the side
      const sx = w / 2 - 22, sy = fy + 20 * u;
      const tailPts = D.subdiv([[sx - 6, sy], [sx + 8, sy], [sx + 12, sy + 30], [sx - 2, sy + 32]], 3, true);
      D.shape(ctx, tailPts, { fill: P.scarf, seed: seed + 41, boil, lw: 2.6 });
      ctx.fillStyle = P.scarf2;
      ctx.fillRect(sx - 1, sy + 10, 9, 5);
    }
    if (P.kind === 'beanie') {
      // knitted beanie over the head; ear tips poke out at the sides, pompom on top
      const hw = spread + es * 0.42, top = topFn(fx), by = top + 10 * u;
      const hat = [];
      for (let i = 0; i <= 14; i++) {
        const a = Math.PI + (i / 14) * Math.PI;
        hat.push([fx + Math.cos(a) * hw, by + Math.sin(a) * 30 * u]);
      }
      D.shape(ctx, D.subdiv(hat, 2, true), { fill: P.hat, seed: seed + 61, boil, lw: 2.8 }, () => {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = fx - hw + 8; x < fx + hw; x += 10) { ctx.moveTo(x, by - 4); ctx.lineTo(x, by - 26 * u); }
        ctx.stroke();
      });
      D.shape(ctx, D.roundRect(hw * 2 + 8, 12 * u, 6, 3).map((p) => [p[0] + fx, p[1] + by]), { fill: P.hat2, seed: seed + 62, boil, lw: 2.6 });
      D.shape(ctx, D.ellipse(10 * u, 10 * u, 14, fx, by - 32 * u), { fill: P.pom, seed: seed + 63, boil, lw: 2.6, amp: 1.4 });
    } else if (P.kind === 'tangle') {
      // loose threads looping outside the body
      D.line(ctx, [[-w / 2 + 10, h / 2 - 8], [-w / 2 - 14, h / 2 - 2], [-w / 2 - 10, h / 2 - 22], [-w / 2 - 22, h / 2 - 30]], { seed: seed + 71, boil, lw: 3, ink: P.threads[0], passes: 1 });
      D.line(ctx, [[w / 2 - 20, -h / 2 + 6], [w / 2 - 6, -h / 2 - 12], [w / 2 + 10, -h / 2 - 4], [w / 2 + 2, -h / 2 + 10]], { seed: seed + 72, boil, lw: 3, ink: P.threads[1], passes: 1 });
    } else if (P.kind === 'grandma') {
      // round reading glasses + knitting needles with a little pink swatch
      ctx.save();
      ctx.strokeStyle = D.INK;
      ctx.lineWidth = 2.4 * u;
      const gx = 15 * u, gr = 8.5 * u;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(fx + s * gx, fy, gr, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(fx - gx + gr, fy - 1); ctx.quadraticCurveTo(fx, fy - 5 * u, fx + gx - gr, fy - 1); ctx.stroke();
      ctx.restore();
      const nx = w / 2 - 26, ny = -h / 2 + 4;
      D.line(ctx, [[nx - 18, ny + 8], [nx + 16, ny - 34]], { seed: seed + 81, boil, lw: 3.4, ink: '#868e96', passes: 1 });
      D.line(ctx, [[nx + 18, ny + 8], [nx - 14, ny - 34]], { seed: seed + 82, boil, lw: 3.4, ink: '#868e96', passes: 1 });
      D.shape(ctx, D.ellipse(10, 10, 12, nx, ny + 2), { fill: '#ff8fab', seed: seed + 83, boil, lw: 2.4 }, () => {
        ctx.strokeStyle = '#d6336c';
        ctx.lineWidth = 1.8;
        for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(nx, ny + 2, 9, 3.6, -0.7 + k * 0.6, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke(); }
      });
    } else if (P.kind === 'lucky') {
      // golden bell on the collar
      const bx = fx, by = fy + 30 * u;
      D.shape(ctx, D.ellipse(7 * u, 7 * u, 12, bx, by), { fill: '#ffd43b', seed: seed + 91, boil, lw: 2.4 });
      ctx.fillStyle = D.INK;
      ctx.fillRect(bx - 0.8 * u, by + 1 * u, 1.6 * u, 4 * u);
    } else if (P.kind === 'sun') {
      // little crown between the ears
      const cw = 15 * u, ch = 11 * u, cy = topFn(fx) + 3 * u;
      const crown = D.subdiv([[fx - cw, cy], [fx - cw, cy - ch], [fx - cw * 0.5, cy - ch * 0.45], [fx, cy - ch * 1.25], [fx + cw * 0.5, cy - ch * 0.45], [fx + cw, cy - ch], [fx + cw, cy]], 2, true);
      D.shape(ctx, crown, { fill: '#fcc419', seed: seed + 95, boil, lw: Math.max(2.6, u * 0.9) });
      ctx.fillStyle = '#e03131';
      ctx.beginPath(); ctx.arc(fx, cy - ch * 0.45, 2.2 * u, 0, Math.PI * 2); ctx.fill();
    }
    if (P.kind === 'bread' || P.kind === 'rainbow' || P.kind === 'gold' || P.kind === 'sun' || P.kind === 'jade' || P.kind === 'cosmicyarn') {
      const tw = (H(seed, 3, boil) + 1) * 0.5;
      D.sparkle(ctx, w / 2 - 4, -h / 2 - 6, 5 + tw * 4, '#ffd43b');
    }
  }

  function drawPudim(ctx, c, t, P, T, boil) {
    const w = t.w, h = t.h, seed = c.seed, u = t.fs;
    const pts = getPts('pudim');
    const wt = w * 0.72;
    const topFn = (x) => -h / 2 + Math.max(0, Math.abs(x) - wt / 2 + 15) * 0.6;
    drawEars(ctx, t.face[0] + 0, topFn, 20, 26, P.ear, P.inner, seed, boil);
    D.fill(ctx, pts, { fill: P.fill, seed, boil }, () => {
      ctx.fillStyle = P.caramel;
      ctx.beginPath();
      ctx.moveTo(-w / 2 - 4, -h / 2 - 6);
      ctx.lineTo(w / 2 + 4, -h / 2 - 6);
      for (let x = w / 2 + 4; x >= -w / 2 - 4; x -= 5) {
        const drip = Math.max(0, Math.sin(x * 0.11 + seed)) * 11 + Math.max(0, Math.sin(x * 0.27 + seed * 2)) * 5;
        ctx.lineTo(x, -h / 2 + 13 + drip);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 22, h / 2 - 28);
      ctx.lineTo(-w / 2 + 16, h / 2 - 10);
      ctx.stroke();
      D.shade(ctx, w, h, seed, boil, 0.1);
    });
    D.outline(ctx, pts, { seed, boil });
    drawFace(ctx, t.face[0], t.face[1], u, c.face, P, seed, boil, false, T);
  }

  function drawCupcake(ctx, c, t, P, T, boil) {
    const w = t.w, h = t.h, seed = c.seed, u = t.fs, dh = 40;
    const rim = -h / 2 + dh;
    const pts = getPts('cupcake');
    const domeY = (x) => rim - dh * Math.sqrt(Math.max(0, 1 - Math.pow(x / (w / 2), 2)));
    drawEars(ctx, 0, domeY, 20, 30, P.ear, P.inner, seed, boil);
    D.fill(ctx, pts, { fill: P.fill, seed, boil }, () => {
      // wrapper
      ctx.fillStyle = P.wrapper;
      ctx.fillRect(-w / 2 - 6, rim - 2, w + 12, h);
      ctx.strokeStyle = 'rgba(43,37,32,0.35)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let k = -4; k <= 4; k++) {
        ctx.moveTo((k * w) / 10, rim + 2);
        ctx.lineTo((k * w * 0.64) / 10, h / 2);
      }
      ctx.stroke();
      // sprinkle-y frosting band at the rim
      ctx.fillStyle = P.frosting;
      ctx.beginPath();
      ctx.moveTo(-w / 2 - 4, rim + 4);
      for (let x = -w / 2 - 4; x <= w / 2 + 4; x += 10) ctx.quadraticCurveTo(x + 5, rim + 13, x + 10, rim + 4);
      ctx.lineTo(w / 2 + 4, rim - 6);
      ctx.lineTo(-w / 2 - 4, rim - 6);
      ctx.closePath();
      ctx.fill();
      D.shade(ctx, w, h, seed, boil, 0.1);
    });
    D.outline(ctx, pts, { seed, boil });
    // frosting swirl hat + cherry
    const hat = D.ellipse(22, 10, 14, 0, -h / 2 + 1);
    D.shape(ctx, hat, { fill: P.frosting, seed: seed + 8, boil, lw: 2.6 });
    const sp = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#9775fa'];
    ctx.save();
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let k = 0; k < 5; k++) {
      ctx.strokeStyle = sp[k];
      const x = -14 + k * 7, y = -h / 2 + (k % 2 ? 3 : -1);
      ctx.beginPath();
      ctx.moveTo(x - 2, y);
      ctx.lineTo(x + 2, y + 1.5);
      ctx.stroke();
    }
    ctx.restore();
    D.shape(ctx, D.ellipse(7, 7, 10, 2, -h / 2 - 13), { fill: '#e8364f', seed: seed + 9, boil, lw: 2.4 });
    D.line(ctx, [[2, -h / 2 - 19], [5, -h / 2 - 27], [10, -h / 2 - 30]], { seed: seed + 10, boil, lw: 2.2, passes: 1 });
    drawFace(ctx, t.face[0], t.face[1], u, c.face, P, seed, boil, false, T);
  }

  function drawBox(ctx, c, t, P, T, boil) {
    const w = t.w, h = t.h, seed = c.seed;
    const pts = getPts('box');
    // ear tips poking out between the flaps
    for (const s of [-1, 1]) {
      const tri = D.subdiv([[s * 12 - 9, -h / 2 + 4], [s * 17, -h / 2 - 15], [s * 12 + 9, -h / 2 + 4]], 3, true);
      D.shape(ctx, tri, { fill: P.cat, seed: seed + s * 5, boil, lw: 2.6 });
    }
    // flaps
    for (const s of [-1, 1]) {
      const fl = D.subdiv([[s * 34, -h / 2 + 2], [s * (w / 2 - 4), -h / 2 + 2], [s * (w / 2 + 14), -h / 2 - 16], [s * 46, -h / 2 - 13]], 3, true);
      D.shape(ctx, fl, { fill: '#b6844d', seed: seed + 20 + s, boil, lw: 2.8 });
    }
    D.fill(ctx, pts, { fill: P.fill, seed, boil }, () => {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(-14, -h / 2 - 4, 28, h + 8);
      D.shade(ctx, w, h, seed, boil, 0.12);
    });
    D.outline(ctx, pts, { seed, boil });
    // hand-hole with eyes peeking
    const slot = D.roundRect(64, 20, 9, 3).map((p) => [p[0], p[1] - 6]);
    D.shape(ctx, slot, { fill: '#3a2a1d', seed: seed + 30, boil, lw: 2.6 });
    ctx.save();
    if (c.face === 'sleep' || c.face === 'happy' || c.face === 'squish') {
      ctx.strokeStyle = '#ffd54a';
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (c.face === 'squish') {
        ctx.moveTo(-17, -10); ctx.lineTo(-10, -6); ctx.lineTo(-17, -2);
        ctx.moveTo(17, -10); ctx.lineTo(10, -6); ctx.lineTo(17, -2);
      } else {
        ctx.moveTo(-18, -6); ctx.lineTo(-8, -6);
        ctx.moveTo(8, -6); ctx.lineTo(18, -6);
      }
      ctx.stroke();
    } else {
      const r = c.face === 'startle' || c.face === 'worry' ? 6 : 4.5;
      for (const s of [-1, 1]) {
        ctx.fillStyle = '#ffd54a';
        ctx.beginPath();
        ctx.arc(s * 13, -6, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = D.INK;
        ctx.beginPath();
        ctx.ellipse(s * 13, -6, r * 0.35, r * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    D.text(ctx, 'FRAGILE', -w / 2 + 44, h / 2 - 15, { size: 17, font: LT.FONT_TEXT, color: '#c0392b', seed: seed + 3, boil, jitter: 0.08 });
    ctx.save();
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 30, h / 2 - 8);
    ctx.lineTo(w / 2 - 30, h / 2 - 26);
    ctx.moveTo(w / 2 - 36, h / 2 - 20);
    ctx.lineTo(w / 2 - 30, h / 2 - 26);
    ctx.lineTo(w / 2 - 24, h / 2 - 20);
    ctx.stroke();
    ctx.restore();
  }

  // c: {type, pal, seed, face, x, y, a, off, wob, wobT, zoom, scale, alpha}
  function drawCat(ctx, c, T, boil) {
    const t = TYPES[c.type];
    const P = PALS[t.pal || c.pal] || PALS.orange;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.a || 0);
    if (c.scale != null && c.scale !== 1) ctx.scale(c.scale, c.scale);
    if (c.wob && c.wob > 0.002) {
      const s = c.wob * Math.sin(c.wobT * 26);
      ctx.translate(0, (t.h / 2) * s * 0.9);
      ctx.scale(1 + s, 1 - s);
    }
    if (c.alpha != null && c.alpha < 1) ctx.globalAlpha *= c.alpha;
    if (c.off) ctx.translate(c.off[0], c.off[1]);
    if (t.custom === 'pudim') drawPudim(ctx, c, t, P, T, boil);
    else if (t.custom === 'cupcake') drawCupcake(ctx, c, t, P, T, boil);
    else if (t.custom === 'box') drawBox(ctx, c, t, P, T, boil);
    else drawStd(ctx, c, t, P, T, boil);
    ctx.restore();
  }

  // Silhouette for locked Catdex entries.
  function drawSilhouette(ctx, type, x, y, scale, boil) {
    const pts = getPts(type);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    D.shape(ctx, pts, { fill: '#d9d2c3', seed: 5, boil, ink: '#b3a993' });
    D.text(ctx, '?', 0, 0, { size: 40, color: '#9b917a', seed: 3, boil });
    ctx.restore();
  }

  LT.Cats = { TYPES, PALS, COMMON_PALS, DEX_ORDER, DEX_SECTIONS, MERGE_TIERS: MERGE.length, SPECIAL, NAMES, createBody, drawCat, drawSilhouette, getPts, getOff, catLabel, catDesc };
})();
