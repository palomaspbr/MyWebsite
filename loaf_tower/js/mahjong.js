/* Meow Match - Mahjong mode (classic solitaire rules). A tile is free when nothing lies on top of it
   AND its left or right side is open (no tile right next to it on the same layer). Tap two identical
   free tiles to remove them; clear the board to win. Levels are solvable by construction: random
   pairs of free tiles are removed until the board is empty, and each removed pair gets one face.
   Shuffle re-deals the faces left on the board the same way, so it never makes a level unwinnable.
   Uses the tile art, faces and layout builder from tiles.js (LT.TileKit). */
(function () {
  'use strict';
  const LT = window.LT;
  const D = LT.Doodle;
  const K = LT.TileKit;
  const { TW, TH, PAD, RES } = K;

  // Meow Mahjong has its own collectible cats (the tray mode keeps t1..t6)
  const REWARDS = { 1: 'j1', 3: 'j2', 6: 'j3', 10: 'j4', 15: 'j5', 20: 'j6' };
  const BOARD = { top: 178, bottom: 1010 };
  const BTN_Y = 1118;

  function levelSpec(n) {
    if (n <= 1) return { cols: 4, rows: 3, layers: 2, target: 16, types: 4 };
    if (n === 2) return { cols: 5, rows: 4, layers: 2, target: 24, types: 6 };
    if (n === 3) return { cols: 5, rows: 5, layers: 3, target: 32, types: 8 };
    const k = n - 4;
    return {
      cols: 7, rows: Math.min(7, 5 + Math.floor(k / 3)), layers: Math.min(5, 3 + Math.floor(k / 4)),
      target: Math.min(104, 40 + k * 6), types: Math.min(14, 8 + Math.floor(k / 2)),
    };
  }

  // tiles on one layer share a grid, so side neighbours sit exactly 2 half-units apart
  function linkSides(tiles) {
    tiles.forEach((a) => {
      a.above = tiles.filter((b) => b.z > a.z && K.overlaps(a, b)).map((b) => b.id);
      a.left = tiles.filter((b) => b.z === a.z && b.x === a.x - 2 && Math.abs(b.y - a.y) < 2).map((b) => b.id);
      a.right = tiles.filter((b) => b.z === a.z && b.x === a.x + 2 && Math.abs(b.y - a.y) < 2).map((b) => b.id);
    });
  }
  function freeIn(tiles, gone, id) {
    const t = tiles[id];
    if (gone.has(id) || !t.above.every((a) => gone.has(a))) return false;
    return t.left.every((a) => gone.has(a)) || t.right.every((a) => gone.has(a));
  }

  // A random order of free pairs that empties `ids` (on top of tiles already gone), or null.
  function removablePairs(tiles, ids, rng, attempts) {
    const base = new Set(tiles.filter((t) => t.gone).map((t) => t.id));
    for (let a = 0; a < (attempts || 60); a++) {
      const gone = new Set(base);
      const pairs = [];
      let left = ids.length;
      while (left > 0) {
        const free = ids.filter((id) => freeIn(tiles, gone, id));
        if (free.length < 2) break;
        const i = Math.floor(rng() * free.length);
        let j = Math.floor(rng() * (free.length - 1));
        if (j >= i) j++;
        pairs.push([free[i], free[j]]);
        gone.add(free[i]); gone.add(free[j]);
        left -= 2;
      }
      if (left === 0) return pairs;
    }
    return null;
  }

  function generate(level) {
    const spec = levelSpec(level);
    const rng = LT.rng(level * 104729 + 7);
    let tiles = null, pairs = null;
    for (let s = 0; s < 8 && !pairs; s++) { // another layout seed if one can't be emptied in pairs (rare)
      tiles = K.build(spec, level * 6151 + 29 + s * 977, 2).map((t, id) => Object.assign(t, { id, gone: false }));
      linkSides(tiles);
      pairs = removablePairs(tiles, tiles.map((t) => t.id), rng, 80);
    }
    const kinds = K.shuffleArr(K.FACE_NAMES.slice(), rng).slice(0, Math.min(spec.types, pairs.length));
    const faces = K.shuffleArr(pairs.map((_, i) => kinds[i % kinds.length]), rng);
    pairs.forEach(([a, b], i) => { tiles[a].type = faces[i]; tiles[b].type = faces[i]; });
    return { spec, tiles, pairs };
  }

  let drawT = 0; // game time of the frame being drawn (set in draw)
  function drawTile(ctx, type, cx, cy, sc, boil, o) {
    const img = K.tileImage(type, K.tileFrame(drawT, cx, cy)); // gentle, staggered shimmer
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sc * (o && o.sx != null ? o.sx : 1), sc);
    ctx.drawImage(img, -PAD - TW / 2, -PAD - TH / 2, img.width / RES, img.height / RES);
    if (o && o.dim) { ctx.fillStyle = 'rgba(70,58,46,0.36)'; K.rr(ctx, -TW / 2, -TH / 2, TW, TH, 13); ctx.fill(); }
    ctx.restore();
  }

  class MahjongGame {
    constructor(o) {
      o = o || {};
      this.lang = o.lang || 'en';
      this.dex = o.dex || new Set();
      this.onSfx = o.onSfx || null;
      this.onEvent = o.onEvent || null;
      this.level = o.level || 1;
      const lv = generate(this.level);
      this.spec = lv.spec;
      this.tiles = lv.tiles;
      this.solution = lv.pairs;
      this.rng = LT.rng(this.level * 57 + 3);
      this.state = 'play';
      this.t = 0;
      this.frame = 0;
      this.moves = 0;
      this.matches = 0;
      this.sel = null;
      this.history = [];
      this.undos = 5; this.hints = 3; this.shuffles = 2;
      this.used = { undo: 0, hint: 0, shuffle: 0 };
      this.fly = [];
      this.banners = [];
      this.particles = [];
      this.offY = 0;
      // board geometry (no tray in this mode, so the board gets more room)
      const xs = this.tiles.map((t) => t.x), ys = this.tiles.map((t) => t.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      const W = Math.max(...xs) + 2 - x0, HH = Math.max(...ys) + 2 - y0;
      const zmax = Math.max(...this.tiles.map((t) => t.z));
      this.s = Math.min(1.35, 620 / ((W / 2) * TW), (BOARD.bottom - BOARD.top - 30) / ((HH / 2) * TH));
      const s = this.s;
      this.hx = (TW * s) / 2; this.hy = (TH * s) / 2; this.zx = 5 * s; this.zy = 7 * s;
      this.ox = 360 - (W * this.hx) / 2 + (zmax * this.zx) / 2 - x0 * this.hx;
      this.oy = (BOARD.top + BOARD.bottom) / 2 - (HH * this.hy) / 2 + (zmax * this.zy) / 2 - y0 * this.hy;
      this.drawOrder = this.tiles.slice().sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x).map((t) => t.id);
      this.buttons = [
        { id: 'undo', x: 132, y: BTN_Y, w: 206, h: 80 },
        { id: 'hint', x: 360, y: BTN_Y, w: 206, h: 80 },
        { id: 'shuffle', x: 588, y: BTN_Y, w: 206, h: 80 },
      ];
      this.autoButton = { id: 'auto', x: 588, y: BTN_Y, w: 206, h: 80 };
      this.restartBtn = { x: 652, y: 150, r: 28 };
    }

    // Shuffle turns into "auto-finish" once every tile left on the board is free.
    activeButtons() { return this.canAuto ? [this.buttons[0], this.buttons[1], this.autoButton] : this.buttons; }

    // With every remaining tile free, any two identical tiles can go: pair them up face by face.
    planAuto() {
      const board = this.tiles.filter((t) => !t.gone);
      if (!board.length) return null;
      const gone = this.goneSet();
      if (board.some((t) => !freeIn(this.tiles, gone, t.id))) return null;
      const byType = {};
      board.forEach((t) => (byType[t.type] = byType[t.type] || []).push(t.id));
      const pairs = [];
      for (const ids of Object.values(byType)) {
        if (ids.length % 2) return null; // can't happen (faces come in pairs), but never start a plan that can't finish
        for (let i = 0; i < ids.length; i += 2) pairs.push([ids[i], ids[i + 1]]);
      }
      return pairs;
    }

    startAuto() {
      const plan = this.canAuto && this.planAuto();
      if (!plan) return false;
      this.auto = { queue: plan, nextT: this.t + 0.12 };
      this.canAuto = false;
      this.sel = null;
      this.hintPair = null;
      this.sfx('sparkle');
      return true;
    }

    get L() { return LT.I18N[this.lang] || LT.I18N.en; }
    sfx(n, o) { if (this.onSfx) this.onSfx(n, o || {}); }
    emit(n, d) { if (this.onEvent) this.onEvent(n, d); }
    rect(t) { return [this.ox + t.x * this.hx - t.z * this.zx, this.oy + t.y * this.hy - t.z * this.zy, TW * this.s, TH * this.s]; }
    goneSet() { return new Set(this.tiles.filter((t) => t.gone).map((t) => t.id)); }
    isFree(id) { return freeIn(this.tiles, this.goneSet(), id); }
    boardLeft() { return this.tiles.filter((t) => !t.gone).length; }
    left(id) { return id === 'undo' ? this.undos : id === 'hint' ? this.hints : this.shuffles; }
    // two free identical tiles, or null
    findPair() {
      const gone = this.goneSet(), seen = {};
      for (const t of this.tiles) {
        if (!freeIn(this.tiles, gone, t.id)) continue;
        if (seen[t.type] != null) return [seen[t.type], t.id];
        seen[t.type] = t.id;
      }
      return null;
    }

    /* ---------- input ---------- */
    pointer(type, x, y) {
      if (type !== 'down' || this.state !== 'play' || this.auto) return;
      if (LT.Render.HudRestart.hit(this.restartBtn, x, y)) { // the HUD is not shifted by offY
        if (LT.Render.HudRestart.tap(this, this.restartBtn)) this.emit('restart');
        return;
      }
      y -= this.offY;
      for (const b of this.activeButtons()) {
        if (Math.abs(x - b.x) < b.w / 2 + 6 && Math.abs(y - b.y) < b.h / 2 + 10) { this.button(b.id); return; }
      }
      if (this.t < (this.flipUntil || 0)) return; // faces are flipping after a shuffle
      for (let k = this.drawOrder.length - 1; k >= 0; k--) {
        const t = this.tiles[this.drawOrder[k]];
        if (t.gone) continue;
        const [rx, ry, rw, rh] = this.rect(t);
        if (x >= rx && x <= rx + rw + 5 * this.s && y >= ry && y <= ry + rh + 6 * this.s) { this.tap(t.id); return; }
      }
    }

    // select / deselect / match
    tap(id) {
      if (this.state !== 'play') return false;
      const t = this.tiles[id];
      if (t.gone) return false;
      if (!this.isFree(id)) { t.shakeT = this.t; this.sfx('thud', { pitch: 1.5, vol: 0.4 }); return false; }
      if (this.sel === id) { this.sel = null; this.sfx('pluck', { note: 62, vol: 0.4 }); return true; }
      if (this.sel != null && this.tiles[this.sel].type === t.type) { this.match(this.sel, id); return true; }
      this.sel = id;
      this.sfx('pluck', { note: 69, vol: 0.55 });
      return true;
    }

    match(a, b) {
      const A = this.tiles[a], B = this.tiles[b];
      A.gone = true; B.gone = true;
      this.sel = null;
      this.hintPair = null;
      this.history.push([a, b]);
      this.moves++;
      this.matches++;
      const ra = this.rect(A), rb = this.rect(B);
      const pa = [ra[0] + ra[2] / 2, ra[1] + ra[3] / 2], pb = [rb[0] + rb[2] / 2, rb[1] + rb[3] / 2];
      const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2 - 30];
      this.fly.push({ type: A.type, from: pa, to: mid, t0: this.t }, { type: B.type, from: pb, to: mid, t0: this.t });
      const PENTA = [72, 74, 76, 79, 81];
      const n = PENTA[(this.matches - 1) % PENTA.length];
      this.sfx('chime', { notes: [n, n + 7], vol: 0.85 });
      this.sfx('softpop', { pitch: 1.3, vol: 0.5 });
      this.burstAt = { x: mid[0], y: mid[1], t: this.t + 0.28 };
      if (!this.boardLeft()) this.win();
      else this.checkStuck();
    }

    // No free identical pair left: offer shuffle; with no shuffles left the level is lost.
    checkStuck() {
      if (this.findPair()) { this.stuck = false; return; }
      this.stuck = true;
      this.banners.push({ kind: 'word', text: this.L.noMoves, color: this.shuffles > 0 ? '#e8590c' : '#e03131', t0: this.t, dur: 2 });
      if (this.shuffles <= 0 && this.undos <= 0) { this.state = 'lost'; this.lostAt = this.t; }
    }

    button(id) {
      this.pressT = { id, t: this.t };
      const ok = id === 'undo' ? this.undo() : id === 'hint' ? this.hint() : id === 'auto' ? this.startAuto() : this.shuffle();
      if (!ok) this.sfx('tap', { pitch: 0.7 });
    }

    undo() {
      if (this.state !== 'play' || this.undos <= 0 || !this.history.length || this.auto) return false;
      const [a, b] = this.history.pop();
      for (const id of [a, b]) { this.tiles[id].gone = false; this.tiles[id].backT = this.t; }
      this.sel = null;
      this.stuck = false;
      this.undos--; this.used.undo++;
      this.sfx('pluck', { note: 60, vol: 0.5 });
      return true;
    }

    hint() {
      if (this.state !== 'play' || this.hints <= 0) return false;
      const p = this.findPair();
      if (!p) { this.checkStuck(); return false; }
      this.hintPair = { ids: p, t0: this.t };
      this.hints--; this.used.hint++;
      this.sfx('sparkle', { vol: 0.5 });
      return true;
    }

    shuffle() {
      if (this.state !== 'play' || this.shuffles <= 0) return false;
      const board = this.tiles.filter((t) => !t.gone);
      if (board.length < 2) return false;
      const pairs = removablePairs(this.tiles, board.map((t) => t.id), this.rng, 120);
      if (!pairs) {
        if (this.stuck && this.undos <= 0) { this.state = 'lost'; this.lostAt = this.t; }
        return false;
      }
      const count = {};
      board.forEach((t) => { count[t.type] = (count[t.type] || 0) + 1; });
      const facePairs = [];
      for (const [type, n] of Object.entries(count)) for (let k = 0; k < Math.floor(n / 2); k++) facePairs.push(type);
      K.shuffleArr(facePairs, this.rng);
      board.forEach((t, i) => { t.oldType = t.type; t.flipT = this.t + (i % 7) * 0.03; });
      pairs.forEach(([a, b], i) => { this.tiles[a].type = facePairs[i]; this.tiles[b].type = facePairs[i]; });
      this.solution = pairs;
      this.flipUntil = this.t + 6 * 0.03 + 0.3;
      this.sel = null; this.hintPair = null; this.stuck = false;
      this.shuffles--; this.used.shuffle++;
      this.sfx('whoosh');
      return true;
    }

    win() {
      this.state = 'won';
      this.wonAt = this.t + 0.4;
      const unlocked = [];
      for (const [lvl, type] of Object.entries(REWARDS)) {
        if (this.level >= +lvl && !this.dex.has(type)) { this.dex.add(type); unlocked.push(type); this.emit('dex', type); }
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
      if (this.burstAt && this.t >= this.burstAt.t) { this.burst(this.burstAt.x, this.burstAt.y, 16, ['#ffd43b', '#ff8fab', '#74c0fc', '#8ce99a']); this.burstAt = null; }
      this.fly = this.fly.filter((f) => this.t - f.t0 < 0.42);
      if (this.state === 'lost' && !this.lostSfx && this.t - this.lostAt > 0.3) { this.lostSfx = true; this.sfx('gameover'); }
      if (this.state === 'lost' && !this.sentOver && this.t - this.lostAt > 1.6) { this.sentOver = true; this.emit('over', { level: this.level, left: this.boardLeft() }); }
      if (this.state === 'won' && !this.wonSfx && this.t >= this.wonAt) {
        this.wonSfx = true;
        this.sfx('record');
        for (let i = 0; i < 40; i++) this.burst(360 + (Math.random() - 0.5) * 520, BOARD.top + Math.random() * 700, 1, ['#ffd43b', '#ff8fab', '#74c0fc', '#8ce99a', '#b197fc']);
        this.banners.push({ kind: 'word', text: this.L.solved, color: '#2b8a3e', t0: this.t, dur: 2.2 });
      }
      if (this.state === 'won' && !this.sentWin && this.t - this.wonAt > this.overDelay) {
        this.sentWin = true;
        this.emit('won', { level: this.level, moves: this.moves, undos: this.used.undo, shuffles: this.used.shuffle, hints: this.used.hint, unlocked: this.unlocked || [] });
      }
      // auto-finish: match the planned pairs one after another
      if (this.auto && this.state === 'play' && this.t >= this.auto.nextT) {
        const pair = this.auto.queue.shift();
        if (!pair || this.tiles[pair[0]].gone || this.tiles[pair[1]].gone) this.auto = null;
        else { this.match(pair[0], pair[1]); this.auto.nextT = this.t + 0.22; }
      }
      if (this.state !== 'play') this.auto = null;
      this.canAuto = !this.auto && this.state === 'play' && this.t >= (this.flipUntil || 0) && !!this.planAuto();
      for (const p of this.particles) { p.life += dt; p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.rot += 0.2; }
      this.particles = this.particles.filter((p) => p.life < p.max);
      this.banners = this.banners.filter((b) => this.t - b.t0 < b.dur);
    }

    /* ---------- drawing ---------- */
    draw(ctx, view) {
      const T = this.t, boil = Math.floor(T * 8) % 4;
      drawT = T;
      const viewH = view.viewH || LT.H;
      const L = this.L;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(view.scale, view.scale);
      LT.Render.drawPaper(ctx, 0, viewH);
      D.text(ctx, `${L.level} ${this.level}`, 92, 74, { size: 70, align: 'left', seed: 11, boil, stroke: LT.PAL.paper, strokeWidth: 10 });
      D.text(ctx, L.tilesLeft(this.boardLeft()), 96, 128, { size: 32, font: LT.FONT_TEXT, align: 'left', seed: 12, boil, color: '#5c5248' });
      D.text(ctx, L.modeMahjong, 690, 80, { size: 40, align: 'right', seed: 13, boil, color: '#2b8a3e' });
      if (this.state === 'play') LT.Render.HudRestart.draw(ctx, this, this.restartBtn, T, boil, L.tapAgain);
      this.offY = Math.max(0, (viewH - LT.H) * 0.45);
      ctx.save();
      ctx.translate(0, this.offY);
      const gone = this.goneSet();
      const hint = this.hintPair && T - this.hintPair.t0 < 2.4 ? this.hintPair.ids : null;
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
        const selected = this.sel === id;
        if (selected) cy -= 8 * this.s; // the selected tile lifts a little
        drawTile(ctx, type, cx, cy, sc, boil, { dim: !freeIn(this.tiles, gone, id), sx });
        if (selected || (hint && hint.includes(id))) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(sc, sc);
          ctx.strokeStyle = selected ? '#f59f00' : `rgba(64,192,87,${0.55 + 0.45 * Math.abs(Math.sin(T * 6))})`;
          ctx.lineWidth = 7;
          K.rr(ctx, -TW / 2 - 2, -TH / 2 - 2, TW + 4, TH + 4, 15);
          ctx.stroke();
          ctx.restore();
        }
      }
      // matched pairs fly together and pop
      for (const f of this.fly) {
        const k = LT.clamp((T - f.t0) / 0.42, 0, 1);
        const q = LT.ease.outCubic(Math.min(1, k / 0.65));
        const sc = this.s * (k < 0.65 ? 1 : Math.max(0, 1 - (k - 0.65) / 0.35));
        if (sc > 0.01) drawTile(ctx, f.type, LT.lerp(f.from[0], f.to[0], q), LT.lerp(f.from[1], f.to[1], q), sc, boil);
      }
      // buttons with remaining-use badges (shuffle pulses when there are no moves)
      for (const b of this.activeButtons()) {
        const isAuto = b.id === 'auto';
        const left = this.left(b.id);
        const off = (!isAuto && left <= 0) || this.state !== 'play' || !!this.auto;
        const pressed = this.pressT && this.pressT.id === b.id && T - this.pressT.t < 0.12;
        ctx.save();
        if (off) ctx.globalAlpha = 0.45;
        ctx.translate(pressed ? 2 : 0, pressed ? 3 : 0);
        if ((b.id === 'shuffle' && this.stuck && !off) || isAuto) { const k = 1 + Math.sin(T * (isAuto ? 5 : 6)) * (isAuto ? 0.03 : 0.04); ctx.translate(b.x, b.y); ctx.scale(k, k); ctx.translate(-b.x, -b.y); }
        D.shape(ctx, D.roundRect(b.w, b.h, 16, 3).map((q) => [q[0] + b.x, q[1] + b.y]), { fill: isAuto || b.id === 'hint' ? LT.PAL.btn : b.id === 'shuffle' ? LT.PAL.greenBtn : LT.PAL.card, seed: 1500 + b.x, boil, lw: 3 });
        const label = L[b.id];
        const iw = 38, gap = 5;
        const left0 = b.x - b.w / 2 + 10, right0 = b.x + b.w / 2 - (isAuto ? 10 : 48); // no badge on auto-finish
        ctx.font = `32px ${LT.FONT_TITLE}`;
        const size = Math.min(32, (32 * (right0 - left0 - iw - gap)) / ctx.measureText(label).width);
        ctx.font = `${size}px ${LT.FONT_TITLE}`;
        const x0 = (left0 + right0) / 2 - (iw + gap + ctx.measureText(label).width) / 2;
        const content = () => {
          LT.Icons.draw(ctx, b.id === 'hint' ? 'bulb' : isAuto ? 'wand' : b.id, x0 + iw / 2, b.y + 1, iw, { boil });
          D.text(ctx, label, x0 + iw + gap, b.y + 2, { size, seed: 1510 + b.x, boil, align: 'left' });
        };
        content(); // theme ink: dark on the yellow button, white on the purple one
        if (isAuto) { ctx.restore(); continue; }
        const bx = b.x + b.w / 2 - 27;
        D.shape(ctx, D.ellipse(17, 17, 14, bx, b.y), { fill: left > 0 ? LT.PAL.btn : LT.PAL.surface, seed: 1520 + b.x, boil, lw: 2.6 });
        D.text(ctx, `${left}`, bx, b.y + 2, { size: 26, seed: 1530 + b.x, boil });
        ctx.restore();
      }
      for (const pt of this.particles) {
        ctx.save();
        ctx.globalAlpha = 1 - pt.life / pt.max;
        ctx.translate(pt.x, pt.y);
        ctx.rotate(pt.rot);
        ctx.fillStyle = pt.color;
        ctx.fillRect(-pt.size, -1.6, pt.size * 2, 3.2);
        ctx.restore();
      }
      LT.Render.drawBanners(ctx, { banners: this.banners.map((b) => Object.assign({}, b, { k: (T - b.t0) / b.dur })).filter((b) => b.k >= 0), lang: this.lang }, T, boil, { unlockY: 640 });
      ctx.restore();
      ctx.restore();
    }
  }

  MahjongGame.generate = generate;
  MahjongGame.levelSpec = levelSpec;
  MahjongGame.REWARDS = REWARDS;
  LT.MahjongGame = MahjongGame;
})();
