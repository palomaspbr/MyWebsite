/* Meow Match: a triple-tile puzzle. Cat tiles are stacked in layers; tap a free tile (nothing lying on
   top of it) to move it into the 7-slot tray. Three of a kind in the tray clear. Empty the board to win;
   a full tray loses. Levels are generated from the level number and are solvable by construction
   ("reverse play"): first a random order in which the tiles could be picked up is fixed, then the faces
   are dealt along that order in triples, so following it never overfills the tray. Shuffle re-deals the
   faces on the board the same way (taking the tray into account), so it never makes a level unsolvable. */
(function () {
  'use strict';
  const LT = window.LT;
  const D = LT.Doodle;

  const TRAY = 7;
  const TW = 84, TH = 96;          // tile size at scale 1 (a half-unit is TW/2 x TH/2)
  const BOARD = { top: 178, bottom: 900 };
  const TRAY_Y = 990, SLOT = 86, TRAY_SCALE = 0.95;
  const BTN_Y = 1112;
  const UNDOS = 3, SHUFFLES = 2;
  const FLY = 0.22, CLEAR = 0.3;
  const REWARDS = { 1: 't1', 3: 't2', 6: 't3', 10: 't4', 15: 't5', 20: 't6' };
  const SIDE = '#9bd17c', FACE = '#fffaf0';

  // cols/rows are the largest base allowed; the base actually used is the smallest that fits `target`
  // with all the layers, so later levels get taller stacks rather than just a wider floor.
  function levelSpec(n) {
    if (n <= 1) return { cols: 5, rows: 4, layers: 2, target: 18, types: 3, open: 1 };
    if (n === 2) return { cols: 5, rows: 5, layers: 2, target: 27, types: 4, open: 1 };
    if (n === 3) return { cols: 5, rows: 5, layers: 3, target: 36, types: 5, open: 1 };
    const k = n - 4;
    return {
      cols: 7, rows: Math.min(7, 5 + Math.floor(k / 3)), layers: Math.min(5, 3 + Math.floor(k / 4)),
      // keeps growing a little after 24: up to 105 tiles, 13 faces from 25, 14 from 35
      target: n < 25 ? Math.min(96, 42 + k * 5) : Math.min(105, 96 + (n - 24)),
      types: n >= 35 ? 14 : n >= 25 ? 13 : Math.min(12, 6 + Math.floor(k / 2)), open: n < 10 ? 2 : 3,
    };
  }

  /* ---------- level generation ---------- */
  function shuffleArr(a, rng) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const overlaps = (a, b) => Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;

  function layout(spec, cols, rows, rng) {
    const W = cols * 2, HH = rows * 2;
    const tiles = [];
    const cover = [];
    const key = (x, y) => y * 64 + x;
    const add = (x, y, z) => {
      tiles.push({ x, y, z });
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) cover[z].add(key(x + dx, y + dy));
    };
    const supported = (x, y, z) => {
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (!cover[z - 1].has(key(x + dx, y + dy))) return false;
      return true;
    };
    // base layer: mirror-symmetric with a few holes
    cover[0] = new Set();
    const mid = (cols - 1) / 2;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i <= mid; i++) {
        const corner = (i === 0) && (j === 0 || j === rows - 1);
        if (rng() > (corner ? 0.5 : 0.97)) continue; // solid floor, sometimes rounded corners
        add(i * 2, j * 2, 0);
        if (i !== mid) add((cols - 1 - i) * 2, j * 2, 0);
      }
    }
    // upper layers rest fully on the layer below, offset by half a tile in varying directions
    const OFFS = [[1, 1], [0, 0], [1, 0], [0, 1]];
    for (let z = 1; z < spec.layers; z++) {
      cover[z] = new Set();
      const [px, py] = OFFS[z === 1 ? 0 : Math.floor(rng() * OFFS.length)];
      const keep = 0.93 - z * 0.03;
      for (let y = py; y + 2 <= HH; y += 2) {
        for (let x = px; x + 2 <= W; x += 2) {
          const xm = W - 2 - x;
          if (xm < x) continue;
          if (!supported(x, y, z) || !supported(xm, y, z) || rng() > keep) continue;
          add(x, y, z);
          if (xm !== x) add(xm, y, z);
        }
      }
    }
    return tiles;
  }

  // Smallest base (by area) whose full stack reaches the target, then trimmed to the target size and
  // a multiple of 3. Every candidate gets its own seeded RNG (deterministic levels).
  function build(spec, seed) {
    const cands = [];
    for (let c = 3; c <= spec.cols; c++) for (let r = 3; r <= spec.rows; r++) cands.push([c, r]);
    cands.sort((a, b) => a[0] * a[1] - b[0] * b[1] || b[0] - a[0]);
    const tries = cands.map(([c, r]) => {
      const rng = LT.rng(seed + c * 131 + r * 17);
      const tiles = layout(spec, c, r, rng);
      return { rng, tiles, tall: Math.max(...tiles.map((t) => t.z)) >= spec.layers - 1, big: tiles.length >= spec.target };
    });
    // smallest that is tall and big enough; else smallest big enough; else the one with the most tiles
    const pick = tries.find((t) => t.tall && t.big) || tries.find((t) => t.big) || tries.reduce((a, b) => (b.tiles.length > a.tiles.length ? b : a));
    const { tiles, rng } = pick;
    // Trim uncovered tiles, lowest layer first (floor edges), so the stack keeps its height. To keep the
    // shape mirror-symmetric, an odd count left to remove takes a centre-column tile, an even count
    // takes a tile together with its mirror twin.
    const goal = Math.floor(Math.min(tiles.length, spec.target) / 3) * 3;
    const xmax = Math.max(...tiles.map((t) => t.x)), ymax = Math.max(...tiles.map((t) => t.y));
    const uncovered = (a) => !tiles.some((b) => b.z > a.z && overlaps(a, b));
    const twinOf = (t) => tiles.find((o) => o !== t && o.z === t.z && o.y === t.y && o.x === xmax - t.x);
    // outermost first (relative to the board size), so rows/corners go cleanly instead of leaving stragglers
    const edge = (t) => Math.max(Math.abs(t.x - xmax / 2) / (xmax + 2), Math.abs(t.y - ymax / 2) / (ymax + 2)) + rng() * 0.02;
    while (tiles.length > goal) {
      const left = tiles.length - goal;
      const open = tiles.filter(uncovered);
      const zmin = Math.min(...open.map((t) => t.z));
      const low = open.filter((t) => t.z === zmin);
      const centre = low.filter((t) => t.x * 2 === xmax);
      const paired = low.filter((t) => { const w = twinOf(t); return w && uncovered(w); });
      const cands = left % 2 ? (centre.length ? centre : low) : (paired.length ? paired : low);
      const t = cands.reduce((a, b) => (edge(b) > edge(a) ? b : a));
      const twin = twinOf(t);
      tiles.splice(tiles.indexOf(t), 1);
      if (left >= 2 && twin && uncovered(twin)) tiles.splice(tiles.indexOf(twin), 1);
    }
    return tiles;
  }

  // Random order in which the (not yet removed) tiles could be picked up, always taking a free one.
  function removalOrder(tiles, ids, rng) {
    const gone = new Set(tiles.filter((t) => t.gone).map((t) => t.id));
    const left = new Set(ids);
    const order = [];
    while (left.size) {
      const free = [];
      for (const id of left) if (tiles[id].above.every((a) => gone.has(a))) free.push(id);
      const id = free[Math.floor(rng() * free.length)];
      order.push(id);
      left.delete(id);
      gone.add(id);
    }
    return order;
  }

  // Deal faces along `order`: `pre` is a fixed list of faces for the first picks; the rest comes from
  // triple tokens, with at most `open` triples in progress at once (tray peak <= 2*open + 1 <= 7).
  function deal(order, pre, tokens, open, rng) {
    const out = {};
    let i = 0;
    for (; i < pre.length; i++) out[order[i]] = pre[i];
    const openList = [];
    for (; i < order.length; i++) {
      let tok;
      const canOpen = tokens.length > 0 && openList.length < open;
      if (!openList.length || (canOpen && rng() < 0.5)) { tok = { type: tokens.pop(), left: 3 }; openList.push(tok); }
      else tok = openList[Math.floor(rng() * openList.length)];
      out[order[i]] = tok.type;
      if (--tok.left === 0) openList.splice(openList.indexOf(tok), 1);
    }
    return out;
  }

  function generate(level) {
    const spec = levelSpec(level);
    const rng = LT.rng(level * 7919 + 101);
    const tiles = build(spec, level * 7919 + 101).map((t, id) => Object.assign(t, { id, gone: false }));
    tiles.forEach((a) => { a.above = tiles.filter((b) => b.z > a.z && overlaps(a, b)).map((b) => b.id); });
    const order = removalOrder(tiles, tiles.map((t) => t.id), rng);
    const triples = tiles.length / 3;
    const kinds = shuffleArr(FACE_NAMES.slice(), rng).slice(0, Math.min(spec.types, triples));
    const tokens = shuffleArr(Array.from({ length: triples }, (_, k) => kinds[k % kinds.length]), rng);
    const faces = deal(order, [], tokens, spec.open, rng);
    tiles.forEach((t) => { t.type = faces[t.id]; });
    return { spec, tiles, order, kinds };
  }

  /* ---------- tile faces (hand-drawn, in a 100x100 box) ---------- */
  function head(ctx, b, seed, o) {
    for (const s of [-1, 1]) {
      const ear = D.subdiv([[s * 32, -2], [s * 30, -42], [s * 6, -26]], 3, true);
      D.shape(ctx, ear, { fill: o.ear || o.fill, seed: seed + s, boil: b, lw: 4, amp: 0.8 });
      D.fill(ctx, D.subdiv([[s * 26, -10], [s * 26, -32], [s * 13, -24]], 2, true), { fill: '#f4a7b5', seed: seed + s * 3, boil: b, off: [0, 0], amp: 0.5 });
    }
    D.shape(ctx, D.ellipse(36, 31, 18, 0, 4), { fill: o.fill, seed, boil: b, lw: 4.5, amp: 0.9 }, () => {
      if (o.patches) {
        D.fill(ctx, D.ellipse(20, 17, 12, -22, -12), { fill: o.patches[0], seed: seed + 5, boil: b, off: [0, 0], amp: 1.5 });
        D.fill(ctx, D.ellipse(16, 14, 12, 26, -6), { fill: o.patches[1], seed: seed + 6, boil: b, off: [0, 0], amp: 1.5 });
      }
      if (o.mask) D.fill(ctx, D.ellipse(22, 17, 14, 0, 12), { fill: o.mask, seed: seed + 7, boil: b, off: [0, 0], amp: 1.2 });
      if (o.muzzle) D.fill(ctx, D.ellipse(18, 14, 14, 0, 18), { fill: o.muzzle, seed: seed + 8, boil: b, off: [0, 0], amp: 1 });
      if (o.stripes) {
        ctx.strokeStyle = o.stripes;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (const x of [-9, 0, 9]) { ctx.moveTo(x, -26); ctx.lineTo(x, -14); }
        ctx.stroke();
      }
    });
    const ink = o.dark ? '#f1ebe0' : D.INK;
    for (const s of [-1, 1]) {
      ctx.fillStyle = o.eye || D.INK;
      ctx.beginPath(); ctx.arc(s * 14, 2, 6, 0, Math.PI * 2); ctx.fill();
      if (o.eye) { ctx.fillStyle = D.INK; ctx.beginPath(); ctx.ellipse(s * 14, 2, 2.2, 5, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(s * 14 - 2, 0, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(244,130,150,0.45)';
      ctx.beginPath(); ctx.ellipse(s * 24, 14, 6, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#ee8c9e';
    ctx.beginPath(); ctx.moveTo(-4, 11); ctx.lineTo(4, 11); ctx.lineTo(0, 16); ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(-4, 17, 4, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.moveTo(8, 17);
    ctx.arc(4, 17, 4, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();
  }

  const FACES = {
    orange: (c, b) => head(c, b, 11, { fill: '#f4a65c', stripes: '#d77a33' }),
    gray: (c, b) => head(c, b, 12, { fill: '#9fa3b8', muzzle: '#fffdf7', ear: '#7c8096' }), // white muzzle, no stripes: not just a recoloured orange
    black: (c, b) => head(c, b, 13, { fill: '#3e3946', eye: '#ffd54a', dark: true }),
    white: (c, b) => head(c, b, 14, { fill: '#ffffff' }),
    calico: (c, b) => head(c, b, 15, { fill: '#fffaf0', patches: ['#f2a05a', '#4a414c'] }),
    siamese: (c, b) => head(c, b, 16, { fill: '#f2e4cc', ear: '#6e5243', mask: 'rgba(110,82,67,0.75)', eye: '#6cc4f5' }),
    fish(ctx, b) {
      D.shape(ctx, D.subdiv([[18, 0], [42, -20], [38, 0], [42, 20]], 2, true), { fill: '#339af0', seed: 21, boil: b, lw: 4 });
      D.shape(ctx, D.ellipse(32, 20, 18, -6, 0), { fill: '#74c0fc', seed: 22, boil: b, lw: 4.5 }, () => {
        ctx.strokeStyle = 'rgba(24,100,171,0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (const x of [-2, 8, 18]) { ctx.moveTo(x, -12); ctx.quadraticCurveTo(x - 6, 0, x, 12); }
        ctx.stroke();
      });
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-22, -4, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = D.INK; ctx.beginPath(); ctx.arc(-21, -4, 3, 0, Math.PI * 2); ctx.fill();
      D.line(ctx, [[-30, 8], [-24, 10], [-19, 8]], { seed: 23, boil: b, lw: 2.6, passes: 1 });
    },
    yarn(ctx, b) {
      D.shape(ctx, D.ellipse(34, 34, 18), { fill: '#b197fc', seed: 31, boil: b, lw: 4.5 }, () => {
        ctx.strokeStyle = '#6741d9';
        ctx.lineWidth = 4;
        for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(0, 0, 32, 13, -0.8 + k * 0.5, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke(); }
      });
      D.line(ctx, [[22, 26], [36, 38], [44, 30]], { seed: 33, boil: b, lw: 4, ink: '#6741d9', passes: 1 });
    },
    paw(ctx, b) {
      const c = '#f783ac';
      D.shape(ctx, D.ellipse(22, 18, 14, 0, 16), { fill: c, seed: 41, boil: b, lw: 4 });
      [[-26, -6], [-10, -24], [10, -24], [26, -6]].forEach(([x, y], k) => D.shape(ctx, D.ellipse(9, 11, 10, x, y), { fill: c, seed: 42 + k, boil: b, lw: 3.6 }));
    },
    mouse(ctx, b) {
      D.line(ctx, [[30, 14], [42, 8], [40, -8], [30, -16]], { seed: 51, boil: b, lw: 3.4, ink: '#e64980', passes: 1 });
      D.shape(ctx, D.ellipse(14, 14, 14, -16, -18), { fill: '#ced4da', seed: 52, boil: b, lw: 4 }, () => {
        D.fill(ctx, D.ellipse(8, 8, 12, -16, -18), { fill: '#f4a7b5', seed: 53, boil: b, off: [0, 0], amp: 0.5 });
      });
      D.shape(ctx, D.subdiv([[-38, 18], [-20, -8], [14, -10], [32, 14], [24, 26], [-30, 26]], 3, true), { fill: '#ced4da', seed: 54, boil: b, lw: 4.5 });
      ctx.fillStyle = D.INK; ctx.beginPath(); ctx.arc(-24, 10, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ee8c9e'; ctx.beginPath(); ctx.arc(-38, 18, 4, 0, Math.PI * 2); ctx.fill();
    },
    milk(ctx, b) {
      D.shape(ctx, D.subdiv([[-22, -14], [22, -14], [22, 40], [-22, 40]], 2, true), { fill: '#fffdf5', seed: 61, boil: b, lw: 4.5 }, () => {
        ctx.fillStyle = '#74c0fc';
        ctx.fillRect(-26, 4, 52, 18);
      });
      D.shape(ctx, D.subdiv([[-22, -14], [-14, -32], [14, -32], [22, -14]], 2, true), { fill: '#4dabf7', seed: 62, boil: b, lw: 4 });
      D.shape(ctx, D.subdiv([[-14, -32], [14, -32], [14, -40], [-14, -40]], 1, true), { fill: '#fffdf5', seed: 63, boil: b, lw: 3.4 });
      ctx.fillStyle = '#fffdf5';
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.quadraticCurveTo(7, 15, 0, 19); ctx.quadraticCurveTo(-7, 15, 0, 6); ctx.fill();
    },
    heart(ctx, b) {
      const pts = [];
      for (let i = 0; i < 24; i++) {
        const t = (i / 24) * Math.PI * 2;
        pts.push([2.4 * 16 * Math.pow(Math.sin(t), 3), -2.4 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) + 2]);
      }
      D.shape(ctx, pts, { fill: '#ff6b6b', seed: 71, boil: b, lw: 4.5 });
      D.line(ctx, [[-22, -14], [-16, -22], [-8, -24]], { seed: 72, boil: b, lw: 4, ink: '#fffdf5', passes: 1 });
    },
    bell(ctx, b) {
      D.shape(ctx, D.subdiv([[-32, 24], [-24, 14], [-22, -10], [-12, -26], [12, -26], [22, -10], [24, 14], [32, 24]], 2, true), { fill: '#ffd43b', seed: 81, boil: b, lw: 4.5 });
      D.shape(ctx, D.ellipse(7, 7, 10, 0, 30), { fill: '#e8590c', seed: 82, boil: b, lw: 3.6 });
      D.shape(ctx, D.subdiv([[-14, -26], [0, -38], [14, -26]], 2, true), { fill: '#e03131', seed: 83, boil: b, lw: 3.6 });
      D.line(ctx, [[-14, -14], [-17, 6]], { seed: 84, boil: b, lw: 4, ink: '#fffdf5', passes: 1 });
    },
    donut(ctx, b) {
      D.shape(ctx, D.ellipse(38, 32, 20), { fill: '#e8a25b', seed: 91, boil: b, lw: 4.5 });
      D.fill(ctx, D.ellipse(32, 26, 18, 0, -3), { fill: '#ff8fab', seed: 92, boil: b, off: [0, 0], amp: 2.2 });
      const sp = ['#ffd43b', '#4dabf7', '#69db7c', '#fffdf5', '#b197fc'];
      ctx.lineWidth = 3.4;
      ctx.lineCap = 'round';
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2, r = 20 + (k % 2) * 4;
        ctx.strokeStyle = sp[k % sp.length];
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r - 2, Math.sin(a) * r * 0.85 - 3); ctx.lineTo(Math.cos(a) * r + 2, Math.sin(a) * r * 0.85); ctx.stroke();
      }
      D.shape(ctx, D.ellipse(10, 8, 12, 0, -2), { fill: FACE, seed: 93, boil: b, lw: 3.6 });
    },
  };
  const FACE_NAMES = Object.keys(FACES);

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Cached tile images: one small canvas per face and boil frame (2 frames keep the lines alive).
  const RES = 2.2, PAD = 6;
  const tileCache = {};
  function tileImage(type, boil) {
    const k = type + '|' + boil;
    if (tileCache[k]) return tileCache[k];
    const cv = document.createElement('canvas');
    cv.width = Math.ceil((TW + PAD * 2 + 6) * RES);
    cv.height = Math.ceil((TH + PAD * 2 + 7) * RES);
    const g = cv.getContext('2d');
    g.scale(RES, RES);
    g.translate(PAD + TW / 2, PAD + TH / 2);
    const seed = FACE_NAMES.indexOf(type) * 17 + 300;
    D.shape(g, D.roundRect(TW, TH, 14, 3).map((p) => [p[0] + 5, p[1] + 6]), { fill: SIDE, seed: seed + 1, boil, lw: 3 });
    D.shape(g, D.roundRect(TW, TH, 14, 3), { fill: FACE, seed, boil, lw: 3.2 });
    g.save();
    g.scale(0.66, 0.66);
    FACES[type](g, boil);
    g.restore();
    tileCache[k] = cv;
    return cv;
  }

  class TileGame {
    constructor(o) {
      o = o || {};
      this.opts = o;
      this.lang = o.lang || 'en';
      this.dex = o.dex || new Set();
      this.onSfx = o.onSfx || null;
      this.onEvent = o.onEvent || null;
      this.level = o.level || 1;
      const lv = generate(this.level);
      this.spec = lv.spec;
      this.tiles = lv.tiles;
      this.solution = lv.order;
      this.rng = LT.rng(this.level * 31 + 7);
      this.tray = [];
      this.undoStack = [];
      this.undos = UNDOS;
      this.shuffles = SHUFFLES;
      this.usedUndo = 0;
      this.usedShuffle = 0;
      this.state = 'play';
      this.t = 0;
      this.frame = 0;
      this.moves = 0;
      this.banners = [];
      this.particles = [];
      this.offY = 0;
      // board geometry
      const xs = this.tiles.map((t) => t.x), ys = this.tiles.map((t) => t.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      const W = Math.max(...xs) + 2 - x0, HH = Math.max(...ys) + 2 - y0; // extents in half-units
      const zmax = Math.max(...this.tiles.map((t) => t.z));
      this.s = Math.min(1.3, 600 / ((W / 2) * TW), (BOARD.bottom - BOARD.top - 30) / ((HH / 2) * TH));
      const s = this.s;
      this.hx = (TW * s) / 2;
      this.hy = (TH * s) / 2;
      this.zx = 5 * s;
      this.zy = 7 * s;
      this.ox = 360 - (W * this.hx) / 2 + (zmax * this.zx) / 2 - x0 * this.hx;
      this.oy = (BOARD.top + BOARD.bottom) / 2 - (HH * this.hy) / 2 + (zmax * this.zy) / 2 - y0 * this.hy;
      this.drawOrder = this.tiles.slice().sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x).map((t) => t.id);
      this.buttons = [
        { id: 'undo', x: 236, y: BTN_Y, w: 230, h: 80 },
        { id: 'shuffle', x: 484, y: BTN_Y, w: 230, h: 80 },
      ];
    }

    get L() { return LT.I18N[this.lang] || LT.I18N.en; }
    sfx(n, o) { if (this.onSfx) this.onSfx(n, o || {}); }
    emit(n, d) { if (this.onEvent) this.onEvent(n, d); }

    rect(t) { return [this.ox + t.x * this.hx - t.z * this.zx, this.oy + t.y * this.hy - t.z * this.zy, TW * this.s, TH * this.s]; }
    isFree(id) { const t = this.tiles[id]; return !t.gone && t.above.every((a) => this.tiles[a].gone); }
    boardLeft() { return this.tiles.filter((t) => !t.gone).length; }
    trayCount() { return this.tray.filter((e) => e.clearAt == null).length; }
    slotX(i, n) { return n <= TRAY ? 360 + (i - (TRAY - 1) / 2) * SLOT : 360 + (i - (n - 1) / 2) * ((SLOT * (TRAY - 1)) / (n - 1)); }

    /* ---------- input ---------- */
    pointer(type, x, y) {
      if (type !== 'down' || this.state !== 'play') return;
      y -= this.offY;
      for (const b of this.buttons) {
        if (Math.abs(x - b.x) < b.w / 2 + 6 && Math.abs(y - b.y) < b.h / 2 + 10) { this.button(b.id); return; }
      }
      if (this.t < (this.flipUntil || 0)) return; // faces are still flipping after a shuffle
      for (let k = this.drawOrder.length - 1; k >= 0; k--) {
        const t = this.tiles[this.drawOrder[k]];
        if (t.gone) continue;
        const [rx, ry, rw, rh] = this.rect(t);
        // the green side slab (drawn +5,+6 under the face) counts as part of the tile
        if (x >= rx && x <= rx + rw + 5 * this.s && y >= ry && y <= ry + rh + 6 * this.s) {
          if (!this.pick(t.id)) { t.shakeT = this.t; this.sfx('thud', { pitch: 1.5, vol: 0.4 }); }
          return;
        }
      }
    }

    pick(id) {
      if (this.state !== 'play' || !this.isFree(id) || this.trayCount() >= TRAY) return false;
      const t = this.tiles[id];
      t.gone = true;
      let idx = this.tray.length;
      for (let i = this.tray.length - 1; i >= 0; i--) if (this.tray[i].type === t.type && this.tray[i].clearAt == null) { idx = i + 1; break; }
      const [rx, ry, rw, rh] = this.rect(t);
      const from = [rx + rw / 2, ry + rh / 2];
      this.tray.splice(idx, 0, { id, type: t.type, t0: this.t, from, pos: from.slice(), sc: this.s });
      this.undoStack.push(id);
      this.moves++;
      this.sfx('pop', { pitch: 1.1 + this.trayCount() * 0.05 });
      const same = this.tray.filter((e) => e.type === t.type && e.clearAt == null);
      if (same.length >= 3) {
        const hit = same.slice(0, 3);
        hit.forEach((e) => { e.clearAt = this.t + FLY; });
        this.undoStack = this.undoStack.filter((u) => !hit.some((e) => e.id === u));
        if (!this.boardLeft() && !this.trayCount()) this.win();
      } else if (this.trayCount() >= TRAY) {
        this.state = 'lost';
        this.lostAt = this.t + FLY;
      }
      return true;
    }

    button(id) {
      this.pressT = { id, t: this.t };
      if (id === 'undo') { if (!this.undo()) this.sfx('tap', { pitch: 0.7 }); }
      else if (id === 'shuffle') { if (!this.shuffle()) this.sfx('tap', { pitch: 0.7 }); }
    }

    undo() {
      if (this.state !== 'play' || this.undos <= 0) return false;
      while (this.undoStack.length) {
        const id = this.undoStack.pop();
        const i = this.tray.findIndex((e) => e.id === id && e.clearAt == null);
        if (i < 0) continue;
        this.tray.splice(i, 1);
        const t = this.tiles[id];
        t.gone = false;
        t.backT = this.t;
        this.undos--;
        this.usedUndo++;
        this.sfx('pop', { pitch: 0.6 });
        return true;
      }
      return false;
    }

    // Re-deal the faces of the tiles still on the board, keeping the same set of faces. Faces that
    // complete the tray's pairs/singles come first in a fresh pick-up order, then whole triples.
    shuffle() {
      if (this.state !== 'play' || this.shuffles <= 0) return false;
      const board = this.tiles.filter((t) => !t.gone);
      if (board.length < 2) return false;
      const count = {};
      board.forEach((t) => { count[t.type] = (count[t.type] || 0) + 1; });
      const inTray = {};
      this.tray.forEach((e) => { if (e.clearAt == null) inTray[e.type] = (inTray[e.type] || 0) + 1; });
      const pre = [];
      for (const [type, n] of Object.entries(inTray)) if (n === 2) { pre.push(type); count[type] = (count[type] || 0) - 1; }
      for (const [type, n] of Object.entries(inTray)) if (n === 1) { pre.push(type, type); count[type] = (count[type] || 0) - 2; }
      const tokens = [];
      let ok = true;
      for (const [type, n] of Object.entries(count)) {
        if (n < 0 || n % 3) ok = false;
        for (let k = 0; k < n / 3; k++) tokens.push(type);
      }
      const order = removalOrder(this.tiles, board.map((t) => t.id), this.rng);
      let faces;
      if (ok) faces = deal(order, pre, shuffleArr(tokens, this.rng), 1, this.rng);
      else { // shouldn't happen; plain permutation as a fallback
        const types = shuffleArr(board.map((t) => t.type), this.rng);
        faces = {};
        board.forEach((t, i) => { faces[t.id] = types[i]; });
      }
      board.forEach((t, i) => {
        t.oldType = t.type;
        t.type = faces[t.id];
        t.flipT = this.t + (i % 7) * 0.03;
      });
      this.solution = order;
      this.flipUntil = this.t + 6 * 0.03 + 0.3;
      this.shuffles--;
      this.usedShuffle++;
      this.sfx('whoosh');
      return true;
    }

    win() {
      this.state = 'won';
      this.wonAt = this.t + FLY + CLEAR;
      const unlocked = [];
      for (const [lvl, type] of Object.entries(REWARDS)) {
        if (this.level >= +lvl && !this.dex.has(type)) {
          this.dex.add(type);
          unlocked.push(type);
          this.emit('dex', type);
        }
      }
      this.unlocked = unlocked;
      unlocked.slice(-2).reverse().forEach((type, i) => this.banners.push({ kind: 'unlock', type, pal: 'orange', isNew: true, t0: this.wonAt + 0.5 + i * 1.9, dur: 2.0 }));
      this.overDelay = 1.4 + Math.min(2, unlocked.length) * 1.9;
    }

    burst(x, y, n, colors) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, life: 0, max: 0.6 + Math.random() * 0.5, color: colors[i % colors.length], rot: Math.random() * 6, size: 3 + Math.random() * 4 });
      }
    }

    step() {
      const dt = 1 / 60;
      this.t += dt;
      this.frame++;
      const laid = this.tray.filter((e) => e.clearAt == null || this.t < e.clearAt);
      const n = laid.length;
      this.tray.forEach((e) => {
        const i = laid.indexOf(e);
        const tx = i < 0 ? e.pos[0] : this.slotX(i, n), ty = i < 0 ? e.pos[1] : TRAY_Y;
        const k = LT.clamp((this.t - e.t0) / FLY, 0, 1);
        if (k < 1) {
          const q = LT.ease.outCubic(k);
          e.pos = [LT.lerp(e.from[0], tx, q), LT.lerp(e.from[1], ty, q) - Math.sin(Math.PI * k) * 50];
          e.sc = LT.lerp(this.s, TRAY_SCALE, q);
        } else {
          e.pos = [e.pos[0] + (tx - e.pos[0]) * 0.3, e.pos[1] + (ty - e.pos[1]) * 0.3];
          e.sc = TRAY_SCALE;
          if (!e.landed) { e.landed = true; if (e.clearAt == null) this.sfx('tap', { pitch: 1.3, vol: 0.5 }); }
        }
        if (e.clearAt != null && this.t >= e.clearAt && !e.popped) {
          e.popped = true;
          if (!e.quiet) {
            // one sound/burst per cleared triple
            this.tray.filter((o) => o.clearAt === e.clearAt).forEach((o) => { o.quiet = true; });
            this.sfx('ding', { note: 88 });
            this.sfx('mrrp', { pitch: 1.2, vol: 0.7 });
            this.burst(e.pos[0], e.pos[1], 16, ['#ffd43b', '#ff8fab', '#74c0fc', '#8ce99a']);
          }
        }
      });
      this.tray = this.tray.filter((e) => e.clearAt == null || this.t < e.clearAt + CLEAR);
      if (this.state === 'lost' && !this.lostSfx && this.t >= this.lostAt) { this.lostSfx = true; this.sfx('gameover'); }
      if (this.state === 'lost' && !this.sentOver && this.t - this.lostAt > 1.3) {
        this.sentOver = true;
        this.emit('over', { level: this.level, left: this.boardLeft() });
      }
      if (this.state === 'won' && !this.wonSfx && this.t >= this.wonAt) {
        this.wonSfx = true;
        this.sfx('record');
        for (let i = 0; i < 40; i++) this.burst(360 + (Math.random() - 0.5) * 520, BOARD.top + Math.random() * 600, 1, ['#ffd43b', '#ff8fab', '#74c0fc', '#8ce99a', '#b197fc']);
        this.banners.push({ kind: 'word', text: this.L.solved, color: '#2b8a3e', t0: this.t, dur: 2.2 });
      }
      if (this.state === 'won' && !this.sentWin && this.t - this.wonAt > this.overDelay) {
        this.sentWin = true;
        this.emit('won', { level: this.level, moves: this.moves, undos: this.usedUndo, shuffles: this.usedShuffle, unlocked: this.unlocked || [] });
      }
      for (const p of this.particles) { p.life += dt; p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.rot += 0.2; }
      this.particles = this.particles.filter((p) => p.life < p.max);
      this.banners = this.banners.filter((b) => this.t - b.t0 < b.dur);
    }

    /* ---------- drawing ---------- */
    drawTile(ctx, type, cx, cy, sc, boil, o) {
      const img = tileImage(type, boil % 2);
      const w = img.width / RES, h = img.height / RES;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(sc * (o && o.sx != null ? o.sx : 1), sc);
      ctx.drawImage(img, -PAD - TW / 2, -PAD - TH / 2, w, h);
      if (o && o.dim) {
        ctx.fillStyle = 'rgba(70,58,46,0.36)';
        rr(ctx, -TW / 2, -TH / 2, TW, TH, 13);
        ctx.fill();
      }
      ctx.restore();
    }

    draw(ctx, view) {
      const T = this.t, boil = Math.floor(T * 8) % 4;
      const viewH = view.viewH || LT.H;
      const L = this.L;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(view.scale, view.scale);
      LT.Render.drawPaper(ctx, 0, viewH);

      // HUD
      D.text(ctx, `${L.level} ${this.level}`, 92, 74, { size: 70, align: 'left', seed: 11, boil, stroke: '#fbf6ea', strokeWidth: 10 });
      D.text(ctx, L.tilesLeft(this.boardLeft()), 96, 128, { size: 32, font: LT.FONT_TEXT, align: 'left', seed: 12, boil, color: '#5c5248' });
      D.text(ctx, L.modeTiles, 690, 80, { size: 40, align: 'right', seed: 13, boil, color: '#2b8a3e' });
      this.offY = Math.max(0, (viewH - LT.H) * 0.45);
      ctx.save();
      ctx.translate(0, this.offY);

      // board tiles, bottom layer first
      for (const id of this.drawOrder) {
        const t = this.tiles[id];
        if (t.gone) continue;
        const [rx, ry, rw, rh] = this.rect(t);
        let cx = rx + rw / 2, cy = ry + rh / 2, sc = this.s, sx = 1, type = t.type;
        if (t.shakeT != null && T - t.shakeT < 0.3) cx += Math.sin((T - t.shakeT) * 60) * 5 * (1 - (T - t.shakeT) / 0.3);
        if (t.backT != null && T - t.backT < 0.25) sc *= LT.ease.outBack(LT.clamp((T - t.backT) / 0.25, 0, 1));
        if (t.flipT != null && T >= t.flipT - 0.001 && T - t.flipT < 0.3) {
          const k = (T - t.flipT) / 0.3;
          sx = Math.max(0.05, Math.abs(Math.cos(Math.PI * k)));
          if (k < 0.5) type = t.oldType;
        } else if (t.flipT != null && T < t.flipT) type = t.oldType;
        this.drawTile(ctx, type, cx, cy, sc, boil, { dim: !this.isFree(id), sx });
      }

      // tray
      const tw = SLOT * TRAY + 26, th = TH * TRAY_SCALE + 34;
      const tray = D.roundRect(tw, th, 22, 4).map((p) => [p[0] + 360, p[1] + TRAY_Y]);
      const full = this.trayCount() >= TRAY - 1 && this.state === 'play';
      D.shape(ctx, tray, { fill: '#c99a62', seed: 1201, boil, lw: 3.4 });
      for (let i = 0; i < TRAY; i++) {
        const x = this.slotX(i, TRAY);
        const slot = D.roundRect(TW * TRAY_SCALE - 4, TH * TRAY_SCALE - 4, 12, 2).map((p) => [p[0] + x, p[1] + TRAY_Y]);
        D.shape(ctx, slot, { fill: i === TRAY - 1 && full ? `rgba(255,135,135,${0.55 + 0.35 * Math.abs(Math.sin(T * 6))})` : '#e9d3b0', seed: 1210 + i, boil, lw: 2.2, ink: 'rgba(43,37,32,0.45)' });
      }
      // tray tiles: landed ones first, the flying ones on top
      const sorted = this.tray.slice().sort((a, b) => (a.landed ? 0 : 1) - (b.landed ? 0 : 1));
      for (const e of sorted) {
        let sc = e.sc;
        if (e.clearAt != null && T >= e.clearAt) {
          const k = LT.clamp((T - e.clearAt) / CLEAR, 0, 1);
          sc *= k < 0.35 ? 1 + k * 0.5 : Math.max(0, 1.17 * (1 - (k - 0.35) / 0.65));
        }
        if (sc > 0.01) this.drawTile(ctx, e.type, e.pos[0], e.pos[1], sc, boil);
      }

      // buttons with remaining-use badges
      for (const b of this.buttons) {
        const left = b.id === 'undo' ? this.undos : this.shuffles;
        const off = left <= 0 || this.state !== 'play';
        const pressed = this.pressT && this.pressT.id === b.id && T - this.pressT.t < 0.12;
        ctx.save();
        if (off) ctx.globalAlpha = 0.45;
        ctx.translate(pressed ? 2 : 0, pressed ? 3 : 0);
        D.shape(ctx, D.roundRect(b.w, b.h, 16, 3).map((q) => [q[0] + b.x, q[1] + b.y]), { fill: b.id === 'shuffle' ? '#d3f9d8' : '#fffdf5', seed: 1300 + b.x, boil, lw: 3 });
        const label = L[b.id];
        const iw = 42, gap = 6;
        const left0 = b.x - b.w / 2 + 12, right0 = b.x + b.w / 2 - 54; // badge sits right of right0
        ctx.font = `34px ${LT.FONT_TITLE}`;
        const size = Math.min(34, (34 * (right0 - left0 - iw - gap)) / ctx.measureText(label).width);
        ctx.font = `${size}px ${LT.FONT_TITLE}`;
        const x0 = (left0 + right0) / 2 - (iw + gap + ctx.measureText(label).width) / 2;
        LT.Icons.draw(ctx, b.id, x0 + iw / 2, b.y + 1, iw, { boil });
        D.text(ctx, label, x0 + iw + gap, b.y + 2, { size, seed: 1310 + b.x, boil, align: 'left' });
        const bx = b.x + b.w / 2 - 30;
        D.shape(ctx, D.ellipse(19, 19, 14, bx, b.y), { fill: left > 0 ? '#ffd43b' : '#e9e4da', seed: 1320 + b.x, boil, lw: 2.6 });
        D.text(ctx, `${left}`, bx, b.y + 2, { size: 28, seed: 1330 + b.x, boil });
        ctx.restore();
      }

      // particles + banners
      for (const pt of this.particles) {
        ctx.save();
        ctx.globalAlpha = 1 - pt.life / pt.max;
        ctx.translate(pt.x, pt.y);
        ctx.rotate(pt.rot);
        ctx.fillStyle = pt.color;
        ctx.fillRect(-pt.size, -1.6, pt.size * 2, 3.2);
        ctx.restore();
      }
      if (this.state === 'lost' && T >= this.lostAt) D.text(ctx, L.trayFull, 360, TRAY_Y - 110, { size: 64, color: '#e03131', stroke: '#fffdf5', strokeWidth: 12, seed: 5, boil });
      LT.Render.drawBanners(ctx, { banners: this.banners.map((b) => Object.assign({}, b, { k: (T - b.t0) / b.dur })).filter((b) => b.k >= 0), lang: this.lang }, T, boil, { unlockY: 640 });
      ctx.restore();
      ctx.restore();
    }
  }

  TileGame.generate = generate;
  TileGame.levelSpec = levelSpec;
  TileGame.REWARDS = REWARDS;
  TileGame.FACES = FACE_NAMES;
  TileGame.TRAY = TRAY;
  LT.TileGame = TileGame;
})();
