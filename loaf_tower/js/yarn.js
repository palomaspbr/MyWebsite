/* Yarn Lines: connect every cat to its matching ball of yarn. Lines can't cross and must fill the board.
   Levels are generated from the level number: a random Hamiltonian path (backbite moves) is cut into
   segments, so every level is solvable and the segments double as the hint solution. */
(function () {
  'use strict';
  const LT = window.LT;
  const D = LT.Doodle;
  const H = LT.hash;

  const COLORS = [
    { c: '#ff6b6b', d: '#c92a2a' }, { c: '#4dabf7', d: '#1864ab' }, { c: '#ffd43b', d: '#e67700' },
    { c: '#69db7c', d: '#2b8a3e' }, { c: '#b197fc', d: '#6741d9' }, { c: '#ffa94d', d: '#d9480f' },
    { c: '#f783ac', d: '#c2255c' }, { c: '#63e6be', d: '#087f5b' }, { c: '#c08a64', d: '#6e4126' },
    { c: '#b8e05a', d: '#5c940d' }, { c: '#adb5bd', d: '#495057' },
  ]; // one colour per pair: levels never use more pairs than there are colours
  // Yarn-exclusive cats, unlocked when a level is solved.
  const REWARDS = { 1: 'y1', 3: 'y2', 5: 'y3', 8: 'y4', 12: 'y5', 16: 'y6', 20: 'y7', 25: 'y8', 30: 'y9', 35: 'y10', 40: 'y11', 50: 'y12' };
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

  function levelSpec(n) {
    if (n <= 2) return { size: 5, pairs: 4 };
    if (n <= 5) return { size: 5, pairs: 5 };
    if (n <= 9) return { size: 6, pairs: 5 + (n % 2) };
    if (n <= 14) return { size: 7, pairs: 6 + (n % 2) };
    if (n <= 20) return { size: 8, pairs: 7 + (n % 2) };
    // 9x9 from here on; fewer pairs = longer, windier yarn = harder
    if (n <= 30) return { size: 9, pairs: 10 + (n % 2) };
    return { size: 9, pairs: 9 + (n % 2) };
  }

  function generate(level) {
    const spec = levelSpec(level);
    const size = spec.size, pairs = Math.min(spec.pairs, COLORS.length);
    const N = size * size;
    const rng = LT.rng(level * 9973 + 17);
    const xy = (i) => [i % size, Math.floor(i / size)];
    const adj = (a, b) => { const [ax, ay] = xy(a), [bx, by] = xy(b); return Math.abs(ax - bx) + Math.abs(ay - by) === 1; };
    const nbs = (i) => {
      const [x, y] = xy(i), out = [];
      if (x > 0) out.push(i - 1);
      if (x < size - 1) out.push(i + 1);
      if (y > 0) out.push(i - size);
      if (y < size - 1) out.push(i + size);
      return out;
    };
    // Quality score (0 = good): a 2x2 block filled by one colour almost always allows an alternative
    // route (classic rule for these puzzles), and too many dead-straight pairs make a level trivial.
    const manhattan = (a, b) => { const [ax, ay] = xy(a), [bx, by] = xy(b); return Math.abs(ax - bx) + Math.abs(ay - by); };
    const score = (segs) => {
      const owner = new Int16Array(N);
      segs.forEach((s, k) => s.forEach((c) => (owner[c] = k)));
      let bad = 0;
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
        const i = y * size + x, o = owner[i];
        if (owner[i + 1] === o && owner[i + size] === o && owner[i + size + 1] === o) bad += 3;
      }
      const trivial = segs.filter((s) => manhattan(s[0], s[s.length - 1]) === s.length - 1).length;
      return bad + Math.max(0, trivial - Math.floor(pairs / 3));
    };
    // Cut positions: k = "a segment ends at path index k". Each 2x2 block is an interval of path
    // indices; a cut inside it splits the block between two colours. Greedy interval stabbing
    // (sorted by right end) breaks as many blocks as the available cuts allow.
    const smartCuts = (path) => {
      const pos = new Int16Array(N);
      path.forEach((c, k) => (pos[c] = k));
      const ivs = [];
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
        const i = y * size + x;
        const ks = [pos[i], pos[i + 1], pos[i + size], pos[i + size + 1]];
        ivs.push([Math.min(...ks), Math.max(...ks), rng()]);
      }
      ivs.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
      const cuts = [];
      const fits = (c) => c >= 2 && c <= N - 4 && cuts.every((o) => Math.abs(o - c) >= 3);
      for (const [lo, hi] of ivs) {
        if (cuts.length >= pairs - 1) break;
        if (cuts.some((c) => lo <= c && c < hi)) continue;
        for (let c = hi - 1; c >= lo; c--) if (fits(c)) { cuts.push(c); break; }
      }
      let guard = 0;
      while (cuts.length < pairs - 1 && guard++ < 500) { const c = 2 + Math.floor(rng() * (N - 5)); if (fits(c)) cuts.push(c); }
      return cuts.length === pairs - 1 ? cuts.sort((a, b) => a - b) : null;
    };
    const randomCuts = () => {
      const lens = new Array(pairs).fill(3);
      for (let r = N - 3 * pairs; r > 0; r--) lens[Math.floor(rng() * pairs)]++;
      const cuts = [];
      let acc = -1;
      for (let k = 0; k < pairs - 1; k++) { acc += lens[k]; cuts.push(acc); }
      return cuts;
    };
    // Fixed attempt counts (not a time budget) so every device builds the exact same level.
    const ATTEMPTS = size <= 6 ? 60 : size >= 9 ? 30 : 14, TRIES = 16;
    let bestSegs = null, bestScore = Infinity;
    for (let attempt = 0; attempt < ATTEMPTS && bestScore > 0; attempt++) {
      // serpentine Hamiltonian path, then scramble with backbite moves
      let path = [];
      for (let y = 0; y < size; y++) for (let k = 0; k < size; k++) path.push(y * size + (y % 2 ? size - 1 - k : k));
      const iters = N * 30;
      for (let it = 0; it < iters; it++) {
        const atEnd = rng() < 0.5;
        const end = atEnd ? path[N - 1] : path[0];
        const cand = nbs(end);
        const nb = cand[Math.floor(rng() * cand.length)];
        const idx = path.indexOf(nb);
        if (atEnd) {
          if (idx === N - 2) continue;
          path = path.slice(0, idx + 1).concat(path.slice(idx + 1).reverse());
        } else {
          if (idx === 1) continue;
          path = path.slice(0, idx).reverse().concat(path.slice(idx));
        }
      }
      // cut into `pairs` segments of length >= 3 whose ends aren't touching
      for (let tries = 0; tries < TRIES; tries++) {
        const cuts = tries % 4 === 3 ? randomCuts() : smartCuts(path);
        if (!cuts) continue;
        const segs = [];
        let p = 0, ok = true;
        for (const c of cuts.concat([N - 1])) {
          const seg = path.slice(p, c + 1);
          p = c + 1;
          if (seg.length < 3 || adj(seg[0], seg[seg.length - 1])) { ok = false; break; }
          segs.push(seg);
        }
        if (!ok) continue;
        const s = score(segs);
        if (s < bestScore) { bestScore = s; bestSegs = segs; }
        if (s === 0) break;
      }
    }
    if (!bestSegs) throw new Error('level generation failed');
    // shuffle colours
    const order = bestSegs.map((_, i) => i).sort(() => rng() - 0.5);
    return { size, quality: bestScore, pairs: order.map((i) => ({ a: bestSegs[i][0], b: bestSegs[i][bestSegs[i].length - 1], sol: bestSegs[i] })) };
  }

  class YarnGame {
    constructor(o) {
      o = o || {};
      this.opts = o;
      this.lang = o.lang || 'en';
      this.dex = o.dex || new Set();
      this.onSfx = o.onSfx || null;
      this.onEvent = o.onEvent || null;
      this.level = o.level || 1;
      this.lv = generate(this.level);
      this.size = this.lv.size;
      this.N = this.size * this.size;
      this.ends = new Map();
      this.lv.pairs.forEach((p, i) => { this.ends.set(p.a, { pair: i, end: 'a' }); this.ends.set(p.b, { pair: i, end: 'b' }); });
      this.paths = this.lv.pairs.map(() => []);
      this.owner = new Int8Array(this.N).fill(-1);
      this.state = 'play';
      this.t = 0;
      this.frame = 0;
      this.moves = 0;
      this.hints = 0;
      this.banners = [];
      this.particles = [];
      this.doneAt = new Array(this.lv.pairs.length).fill(-9);
      this.wonAt = 0;
      this.nagT = -9;
      this.drag = null;
      this.flashEmptyT = -9;
      // use nearly the full width so 9x9 cells stay finger-sized on phones
      this.cell = Math.floor(Math.min(672 / this.size, 100));
      this.boardW = this.cell * this.size;
      this.bx = 360 - this.boardW / 2;
      this.by = 640 - this.boardW / 2;
      const by2 = this.by + this.boardW;
      this.buttons = [
        { id: 'undo', x: 146, y: by2 + 86, w: 196, h: 80 },
        { id: 'restart', x: 360, y: by2 + 86, w: 196, h: 80 },
        { id: 'hint', x: 574, y: by2 + 86, w: 196, h: 80 },
      ];
      this.undoStack = []; // line layouts before each move, newest last
    }

    get L() { return LT.I18N[this.lang] || LT.I18N.en; }
    sfx(n, o) { if (this.onSfx) this.onSfx(n, o || {}); }
    emit(n, d) { if (this.onEvent) this.onEvent(n, d); }

    cellAt(x, y) {
      const cx = Math.floor((x - this.bx) / this.cell), cy = Math.floor((y - this.by) / this.cell);
      if (cx < 0 || cy < 0 || cx >= this.size || cy >= this.size) return -1;
      return cy * this.size + cx;
    }
    center(i) { return [this.bx + (i % this.size + 0.5) * this.cell, this.by + (Math.floor(i / this.size) + 0.5) * this.cell]; }
    isComplete(p) {
      const path = this.paths[p];
      if (path.length < 2) return false;
      const e = this.ends.get(path[path.length - 1]);
      return !!e && e.pair === p && path[path.length - 1] !== path[0];
    }
    rebuildOwner() {
      this.owner.fill(-1);
      this.paths.forEach((path, p) => path.forEach((c) => (this.owner[c] = p)));
    }
    // Cells covered by yarn (endpoints only count once a line goes through them).
    filled() { let n = 0; for (let i = 0; i < this.N; i++) if (this.owner[i] >= 0) n++; return n; }
    get drawing() { return this.drag ? this.drag.p : null; }

    /* ---------- input ----------
       A drag keeps a snapshot (`base`) of every other line from when it started. Lines the drag
       runs over are cut, and grow back if the drag retracts - like the classic puzzle. */
    pointer(type, x, y) {
      if (this.state !== 'play') return;
      y -= this.offY || 0;
      if (type === 'down') {
        for (const b of this.buttons) {
          if (Math.abs(x - b.x) < b.w / 2 + 6 && Math.abs(y - b.y) < b.h / 2 + 10) { this.button(b.id); return; }
        }
        const c = this.cellAt(x, y);
        if (c < 0) return;
        const e = this.ends.get(c);
        const base = this.paths.map((p) => p.slice());
        if (e) {
          this.drag = { p: e.pair, base, pending: null, moved: true, last: [x, y] };
          this.paths[e.pair] = [c];
          this.recut();
          this.sfx('pop', { pitch: 0.9 });
        } else if (this.owner[c] >= 0) {
          // grabbing the middle of a line: only cut it once the finger actually moves
          this.drag = { p: this.owner[c], base, pending: c, moved: false, last: [x, y] };
        }
      } else if (type === 'move') {
        const d = this.drag;
        if (!d) return;
        // walk every cell the pointer crossed since the last event (handles fast swipes)
        const [x0, y0] = d.last;
        const dist = Math.hypot(x - x0, y - y0);
        const steps = Math.max(1, Math.ceil(dist / (this.cell / 5)));
        for (let s = 1; s <= steps; s++) {
          const c = this.cellAt(x0 + ((x - x0) * s) / steps, y0 + ((y - y0) * s) / steps);
          if (c < 0) continue;
          if (d.pending != null) {
            if (c === d.pending) continue;
            const path = this.paths[d.p];
            path.length = path.indexOf(d.pending) + 1;
            d.pending = null;
            d.moved = true;
            this.recut();
          }
          if (!this.stepTo(c)) break;
        }
        d.last = [x, y];
      } else if (type === 'up') {
        const d = this.drag;
        if (!d) return;
        this.drag = null;
        if (d.moved) {
          if (this.paths.some((p, i) => p.join() !== d.base[i].join())) this.pushUndo(d.base);
          this.moves++;
          this.checkWin();
        }
      }
    }

    // Move the line's head one step towards cell `c` (orthogonal moves only; diagonal corner
    // crossings go through whichever in-between cell is enterable).
    stepTo(c) {
      const path = this.paths[this.drag.p];
      const last = path[path.length - 1];
      if (c === last) return true;
      const S = this.size;
      const lx = last % S, ly = Math.floor(last / S), cx = c % S, cy = Math.floor(c / S);
      const dx = cx - lx, dy = cy - ly;
      if (Math.abs(dx) + Math.abs(dy) === 1) return this.extend(c);
      if (Math.abs(dx) === 1 && Math.abs(dy) === 1) {
        const opts = [last + dx, last + dy * S].sort((a, b) => this.enterCost(a) - this.enterCost(b));
        for (const mid of opts) if (this.enterCost(mid) < 9 && this.extend(mid)) return this.extend(c);
        return false;
      }
      // still far (shouldn't happen with sampling): step along the longer axis, try the other on failure
      const a = Math.abs(dx) >= Math.abs(dy) ? last + Math.sign(dx) : last + Math.sign(dy) * S;
      const b = Math.abs(dx) >= Math.abs(dy) ? (dy ? last + Math.sign(dy) * S : -1) : (dx ? last + Math.sign(dx) : -1);
      return this.extend(a) || (b >= 0 && this.extend(b));
    }

    // 0 = own line / empty, 1 = another colour's line (would cut it), 9 = blocked.
    enterCost(n) {
      const p = this.drag.p;
      if (this.paths[p].indexOf(n) >= 0) return 0;
      const e = this.ends.get(n);
      if (e && e.pair !== p) return 9;
      const o = this.owner[n];
      return o >= 0 && o !== p ? 1 : 0;
    }

    extend(next) {
      const p = this.drag.p;
      const path = this.paths[p];
      const idx = path.indexOf(next);
      if (idx >= 0) {
        if (idx === path.length - 1) return true;
        path.length = idx + 1;
        this.recut();
        this.sfx('pop', { pitch: 0.75 });
        return true;
      }
      if (this.isComplete(p)) return false;
      const e = this.ends.get(next);
      if (e && e.pair !== p) return false;
      const cut = this.owner[next] >= 0 && this.owner[next] !== p;
      path.push(next);
      this.recut();
      if (cut) this.sfx('scratch');
      const k = Math.min(SCALE.length - 1, path.length - 2);
      this.sfx('pop', { pitch: Math.pow(2, SCALE[k] / 12) * 0.9 });
      if (e && e.pair === p) this.pairDone(p);
      return true;
    }

    // Other lines = their snapshot, cut at the first cell the dragged line now covers.
    recut() {
      const d = this.drag;
      if (d) {
        const mine = new Set(this.paths[d.p]);
        d.base.forEach((bp, q) => {
          if (q === d.p) return;
          const i = bp.findIndex((c) => mine.has(c));
          this.paths[q] = i < 0 ? bp.slice() : bp.slice(0, i);
        });
      }
      this.rebuildOwner();
    }

    pairDone(p) {
      this.doneAt[p] = this.t;
      this.sfx('meow', { pitch: 0.85 + (p % 5) * 0.12, vol: 0.8 });
      const [x, y] = this.center(this.lv.pairs[p].b);
      this.burst(x, y, 12, COLORS[p % COLORS.length].c);
    }

    pushUndo(paths) {
      this.undoStack.push(paths.map((p) => p.slice()));
      if (this.undoStack.length > 200) this.undoStack.shift();
    }
    canUndo() { return this.undoStack.length > 0; }
    undo() {
      if (this.state !== 'play' || !this.undoStack.length) return false;
      if (this.drag) this.pointer('up', 0, 0);
      this.paths = this.undoStack.pop();
      this.rebuildOwner();
      this.undoT = this.t;
      this.sfx('pop', { pitch: 0.6 });
      return true;
    }

    button(id) {
      if (this.drag) this.pointer('up', 0, 0);
      this.pressT = { id, t: this.t };
      if (id === 'undo') {
        if (!this.undo()) this.sfx('tap', { pitch: 0.7 });
        return;
      }
      this.sfx('tap');
      if (id === 'restart') {
        if (this.paths.every((p) => !p.length)) return;
        this.pushUndo(this.paths);
        this.paths = this.lv.pairs.map(() => []);
        this.rebuildOwner();
      } else if (id === 'hint') {
        const p = this.lv.pairs.findIndex((pr, i) => !this.isComplete(i) || this.paths[i].join() !== pr.sol.join());
        if (p < 0) return;
        this.pushUndo(this.paths);
        const sol = this.lv.pairs[p].sol;
        for (const c of sol) {
          const o = this.owner[c];
          if (o >= 0 && o !== p) { const op = this.paths[o]; op.length = Math.max(0, op.indexOf(c)); }
        }
        this.paths[p] = sol.slice();
        this.rebuildOwner();
        this.hints++;
        this.moves++;
        this.pairDone(p);
        this.checkWin();
      }
    }

    checkWin() {
      const all = this.lv.pairs.every((_, i) => this.isComplete(i));
      if (!all) return;
      if (this.filled() < this.N) {
        this.flashEmptyT = this.t; // the empty squares pulse so you can see what's missing
        if (this.t - this.nagT > 2) {
          this.nagT = this.t;
          this.banners.push({ kind: 'word', text: this.L.fillAll, color: '#e8590c', t0: this.t, dur: 1.6 });
        }
        return;
      }
      this.state = 'won';
      this.wonAt = this.t;
      this.sfx('record');
      for (let i = 0; i < 40; i++) this.burst(360 + (Math.random() - 0.5) * 500, this.by + Math.random() * this.boardW, 1, COLORS[i % COLORS.length].c);
      this.banners.push({ kind: 'word', text: this.L.solved, color: '#2b8a3e', t0: this.t, dur: 2.2 });
      // rewards
      const unlocked = [];
      for (const [lvl, type] of Object.entries(REWARDS)) {
        if (this.level >= +lvl && !this.dex.has(type)) {
          this.dex.add(type);
          unlocked.push(type);
          this.emit('dex', type);
        }
      }
      // at most two cards are shown here (the rarest); the rest are listed on the win panel
      unlocked.slice(-2).reverse().forEach((type, i) => this.banners.push({ kind: 'unlock', type, pal: 'orange', isNew: true, t0: this.t + 0.5 + i * 1.9, dur: 2.0 }));
      this.unlocked = unlocked;
      this.overDelay = 1.4 + Math.min(2, unlocked.length) * 1.9;
    }

    burst(x, y, n, color) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, life: 0, max: 0.6 + Math.random() * 0.6, color, rot: Math.random() * 6, size: 3 + Math.random() * 4 });
      }
    }

    step() {
      const dt = 1 / 60;
      this.t += dt;
      this.frame++;
      for (const p of this.particles) { p.life += dt; p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.rot += 0.2; }
      this.particles = this.particles.filter((p) => p.life < p.max);
      this.banners = this.banners.filter((b) => this.t - b.t0 < b.dur);
      if (this.state === 'won' && !this.sentWin && this.t - this.wonAt > this.overDelay) {
        this.sentWin = true;
        this.emit('won', { level: this.level, moves: this.moves, hints: this.hints, unlocked: this.unlocked || [] });
      }
    }

    /* ---------- drawing ---------- */
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
      const done = this.lv.pairs.filter((_, i) => this.isComplete(i)).length;
      const pct = Math.round((this.filled() / this.N) * 100);
      D.text(ctx, `${done}/${this.lv.pairs.length} ${L.pairs} · ${pct}%`, 96, 128, { size: 32, font: LT.FONT_TEXT, align: 'left', seed: 12, boil, color: '#5c5248' });
      D.text(ctx, L.modeYarn, 690, 80, { size: 40, align: 'right', seed: 13, boil, color: '#c2255c' });
      // centre the board vertically on tall screens (the HUD stays at the top)
      this.offY = Math.max(0, (viewH - LT.H) * 0.45);
      ctx.save();
      ctx.translate(0, this.offY);

      // board card
      const pad = 14;
      const card = D.roundRect(this.boardW + pad * 2, this.boardW + pad * 2, 18, 4).map((p) => [p[0] + 360, p[1] + this.by + this.boardW / 2]);
      D.shape(ctx, card, { fill: '#fffdf5', seed: 600, boil, lw: 3.4 });
      // tinted cells (+ pulsing empty cells right after "fill every square!")
      const flash = this.t - this.flashEmptyT < 1.6 ? Math.abs(Math.sin((this.t - this.flashEmptyT) * 8)) : 0;
      for (let i = 0; i < this.N; i++) {
        const o = this.owner[i];
        if (o < 0) {
          if (flash > 0 && !this.ends.has(i)) {
            const [cx, cy] = this.center(i);
            ctx.fillStyle = `rgba(232,89,12,${0.28 * flash})`;
            ctx.fillRect(cx - this.cell / 2 + 2, cy - this.cell / 2 + 2, this.cell - 4, this.cell - 4);
          }
          continue;
        }
        const [cx, cy] = this.center(i);
        ctx.fillStyle = COLORS[o % COLORS.length].c;
        ctx.globalAlpha = this.isComplete(o) ? 0.22 : 0.12;
        ctx.fillRect(cx - this.cell / 2 + 1, cy - this.cell / 2 + 1, this.cell - 2, this.cell - 2);
        ctx.globalAlpha = 1;
      }
      // grid
      ctx.save();
      ctx.strokeStyle = 'rgba(43,37,32,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 1; k < this.size; k++) {
        const x = this.bx + k * this.cell, y = this.by + k * this.cell;
        ctx.moveTo(x + H(k, 1, boil), this.by + 4); ctx.lineTo(x - H(k, 2, boil), this.by + this.boardW - 4);
        ctx.moveTo(this.bx + 4, y + H(k, 3, boil)); ctx.lineTo(this.bx + this.boardW - 4, y - H(k, 4, boil));
      }
      ctx.stroke();
      ctx.restore();

      // yarn paths
      this.paths.forEach((path, p) => {
        if (path.length < 2) return;
        const col = COLORS[p % COLORS.length];
        const pts = path.map((c) => this.center(c));
        const w = this.cell * 0.3;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const wp = D.wobble(pts, 700 + p, boil, 1.2);
        const stroke = (lw, color, dash) => {
          ctx.beginPath();
          ctx.moveTo(wp[0][0], wp[0][1]);
          for (let i = 1; i < wp.length; i++) ctx.lineTo(wp[i][0], wp[i][1]);
          ctx.setLineDash(dash || []);
          ctx.lineWidth = lw;
          ctx.strokeStyle = color;
          ctx.stroke();
        };
        stroke(w + 6, D.INK);
        stroke(w, col.c);
        stroke(w * 0.34, col.d, [w * 0.35, w * 0.5]); // yarn twist
        ctx.restore();
      });

      // endpoints
      this.lv.pairs.forEach((pr, p) => {
        const col = COLORS[p % COLORS.length];
        const complete = this.isComplete(p);
        const bounce = this.t - this.doneAt[p] < 0.4 ? Math.sin(((this.t - this.doneAt[p]) / 0.4) * Math.PI) * 0.18 : 0;
        const winJig = this.state === 'won' ? Math.sin(T * 10 + p) * 0.06 : 0;
        const [ax, ay] = this.center(pr.a), [bx, by] = this.center(pr.b);
        drawCatHead(ctx, ax, ay, this.cell * 0.4 * (1 + bounce + winJig), col, complete ? 'happy' : this.drawing === p ? 'open' : 'sleep', 800 + p, boil, T);
        drawYarnBall(ctx, bx, by, this.cell * 0.34 * (1 + bounce + winJig), col, 900 + p, boil);
      });

      // buttons
      for (const b of this.buttons) {
        const off = b.id === 'undo' && !this.canUndo();
        const pressed = this.pressT && this.pressT.id === b.id && this.t - this.pressT.t < 0.12;
        ctx.save();
        if (off) ctx.globalAlpha = 0.45;
        ctx.translate(pressed ? 2 : 0, pressed ? 3 : 0);
        const pts = D.roundRect(b.w, b.h, 16, 3).map((q) => [q[0] + b.x, q[1] + b.y]);
        D.shape(ctx, pts, { fill: b.id === 'hint' ? '#ffd43b' : '#fffdf5', seed: 950 + b.x, boil, lw: 3 });
        // hand-drawn icon + label, centred together (label shrinks to fit longer translations)
        const label = L[b.id];
        const iw = 40, gap = 6;
        ctx.font = `34px ${LT.FONT_TITLE}`;
        const size = Math.min(34, (34 * (b.w - 26 - iw - gap)) / ctx.measureText(label).width);
        ctx.font = `${size}px ${LT.FONT_TITLE}`;
        const tw = ctx.measureText(label).width;
        const x0 = b.x - (iw + gap + tw) / 2;
        LT.Icons.draw(ctx, b.id === 'hint' ? 'bulb' : b.id, x0 + iw / 2, b.y + 1, iw, { boil });
        D.text(ctx, label, x0 + iw + gap, b.y + 2, { size, seed: 960 + b.x, boil, align: 'left' });
        ctx.restore();
      }

      // particles
      for (const pt of this.particles) {
        ctx.save();
        ctx.globalAlpha = 1 - pt.life / pt.max;
        ctx.translate(pt.x, pt.y);
        ctx.rotate(pt.rot);
        ctx.fillStyle = pt.color;
        ctx.fillRect(-pt.size, -1.6, pt.size * 2, 3.2);
        ctx.restore();
      }
      LT.Render.drawBanners(ctx, { banners: this.banners.map((b) => Object.assign({}, b, { k: (this.t - b.t0) / b.dur })).filter((b) => b.k >= 0), lang: this.lang }, T, boil, {});
      ctx.restore();
      ctx.restore();
    }
  }

  function drawCatHead(ctx, x, y, r, col, face, seed, boil, T) {
    ctx.save();
    ctx.translate(x, y);
    for (const s of [-1, 1]) {
      const ear = D.subdiv([[s * r * 0.95, -r * 0.1], [s * r * 0.75, -r * 1.12], [s * r * 0.2, -r * 0.78]], 3, true);
      D.shape(ctx, ear, { fill: col.c, seed: seed + s, boil, lw: 2.6, amp: 0.7 });
    }
    D.shape(ctx, D.ellipse(r, r * 0.9, 16), { fill: col.c, seed, boil, lw: 3, amp: 0.8 });
    ctx.strokeStyle = D.INK;
    ctx.fillStyle = D.INK;
    ctx.lineWidth = Math.max(2, r * 0.08);
    ctx.lineCap = 'round';
    const ex = r * 0.38, ey = -r * 0.08;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      if (face === 'happy') ctx.arc(s * ex, ey + r * 0.08, r * 0.15, 1.15 * Math.PI, 1.85 * Math.PI);
      else if (face === 'sleep') ctx.arc(s * ex, ey - r * 0.06, r * 0.15, 0.2 * Math.PI, 0.8 * Math.PI);
      else { ctx.arc(s * ex, ey, r * 0.12, 0, Math.PI * 2); ctx.fill(); continue; }
      ctx.stroke();
    }
    ctx.fillStyle = '#ee8c9e';
    ctx.beginPath();
    ctx.moveTo(-r * 0.09, r * 0.12); ctx.lineTo(r * 0.09, r * 0.12); ctx.lineTo(0, r * 0.22);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-r * 0.09, r * 0.24, r * 0.09, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.moveTo(r * 0.18, r * 0.24);
    ctx.arc(r * 0.09, r * 0.24, r * 0.09, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.lineWidth = Math.max(1.6, r * 0.06);
    ctx.stroke();
    ctx.restore();
  }

  function drawYarnBall(ctx, x, y, r, col, seed, boil) {
    ctx.save();
    ctx.translate(x, y);
    D.shape(ctx, D.ellipse(r, r, 16), { fill: col.c, seed, boil, lw: 3, amp: 0.8 }, () => {
      ctx.strokeStyle = col.d;
      ctx.lineWidth = Math.max(2, r * 0.12);
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.95, r * 0.38, -0.8 + k * 0.5, Math.PI * 0.1, Math.PI * 0.9);
        ctx.stroke();
      }
    });
    D.line(ctx, [[r * 0.6, r * 0.6], [r * 1.0, r * 0.9], [r * 1.25, r * 0.7]], { seed: seed + 3, boil, lw: 2.6, ink: col.d, passes: 1 });
    ctx.restore();
  }

  YarnGame.generate = generate;
  YarnGame.levelSpec = levelSpec;
  YarnGame.REWARDS = REWARDS;
  YarnGame.COLORS = COLORS;
  LT.YarnGame = YarnGame;
})();
