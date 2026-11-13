/* Purr Merge: drop round cats into a box; two of the same cat merge into the next, bigger cat.
   12 tiers (m1..m12): two Cosmic Orbs make the Sun King; two Sun Kings vanish in a SUPERNOVA bonus. Box overflows -> game over. */
(function () {
  'use strict';
  const LT = window.LT;
  const M = window.Matter;
  const C = LT.Cats;
  const D = LT.Doodle;
  const H = LT.hash;

  const BOX = { l: 96, r: 624, floor: 1100, top: 360, danger: 410 };
  const DROP_Y = 270;
  const TIERS = C.MERGE_TIERS;
  const POINTS = [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78];
  const DROP_WEIGHTS = [34, 28, 20, 12, 6]; // tiers 1..5 can be dropped
  const COMBO_CAP = 5;
  const MERGE_TOLERANCE = 6; // px of "close enough" (matches the drawn outlines) between two equal cats

  class MergeGame {
    constructor(o) {
      o = o || {};
      this.opts = o;
      this.lang = o.lang || 'en';
      this.dex = o.dex || new Set();
      this.onSfx = o.onSfx || null;
      this.onEvent = o.onEvent || null;
      this.best = o.best || 0;
      this.seed = o.seed == null ? (Math.random() * 1e9) | 0 : o.seed;
      this.rng = LT.rng(this.seed);
      const e = (this.engine = M.Engine.create({ positionIterations: 8, velocityIterations: 6 }));
      e.gravity.y = 1.1;
      const wall = { isStatic: true, friction: 0.3, restitution: 0.1, label: 'wall' };
      M.Composite.add(e.world, [
        M.Bodies.rectangle(360, BOX.floor + 40, 800, 80, wall),
        M.Bodies.rectangle(BOX.l - 40, BOX.floor - 700, 80, 1600, wall),
        M.Bodies.rectangle(BOX.r + 40, BOX.floor - 700, 80, 1600, wall),
      ]);
      this.cats = [];
      this.byBody = new Map();
      this.particles = [];
      this.banners = [];
      this.t = 0;
      this.frame = 0;
      this.score = 0;
      this.maxTier = 0;
      this.state = 'play';
      this.dangerT = 0;
      this.combo = 0;
      this.comboT = -9;
      this.cooldown = 0.3;
      this.aimX = 360;
      this.queue = [];
      this.held = null;
      this.next = this.randTier();
      this.merges = 0;
      this.cosmics = 0;
    }

    get L() { return LT.I18N[this.lang] || LT.I18N.en; }
    sfx(n, o) { if (this.onSfx) this.onSfx(n, o || {}); }
    emit(n, d) { if (this.onEvent) this.onEvent(n, d); }
    radius(tier) { return C.TYPES['m' + tier].radius; }

    randTier() {
      if (this.queue.length) return this.queue.shift();
      const total = DROP_WEIGHTS.reduce((a, b) => a + b, 0);
      let r = this.rng() * total;
      for (let i = 0; i < DROP_WEIGHTS.length; i++) if ((r -= DROP_WEIGHTS[i]) <= 0) return i + 1;
      return 1;
    }

    unlock(tier) {
      const type = 'm' + tier;
      if (tier > this.maxTier) this.maxTier = tier;
      if (this.dex.has(type)) return;
      this.dex.add(type);
      this.emit('dex', type);
      if (tier >= 3) {
        this.banners.push({ kind: 'unlock', type, pal: 'orange', isNew: true, t0: this.t, dur: 2.0 });
        this.sfx('sparkle');
      }
    }

    clampX(x, tier) {
      const r = this.radius(tier);
      return LT.clamp(x, BOX.l + r + 2, BOX.r - r - 2);
    }

    /* ---------- input ---------- */
    pointer(type, x) {
      if (this.state !== 'play') return;
      x = LT.clamp(x, BOX.l, BOX.r);
      if (type === 'down') { this.aiming = true; this.aimX = x; }
      else if (type === 'move') { if (this.aiming || type === 'move') this.aimX = x; }
      else if (type === 'up') {
        if (this.aiming) { this.aimX = x; if (!this.drop()) this.pendingDrop = true; } // remember early taps
        this.aiming = false;
      }
    }

    canDrop() { return this.state === 'play' && this.held && this.cooldown <= 0; }

    drop() {
      if (!this.canDrop()) return false;
      const tier = this.held.tier;
      const x = this.clampX(this.aimX, tier);
      this.addCat(tier, x, DROP_Y, { vx: 0, vy: 0 });
      this.held = null;
      this.cooldown = 0.55;
      this.sfx('whoosh', { vol: 0.7 });
      this.emit('drop');
      return true;
    }

    addCat(tier, x, y, v, pop) {
      // merged cats start small in the physics too and grow over ~0.15 s, so they push neighbours
      // aside gently instead of shoving them into the floor or walls
      const grow = pop ? 0.6 : 1;
      const r = this.radius(tier) * grow;
      const body = M.Bodies.circle(x, y, r, { restitution: 0.12, friction: 0.25, frictionStatic: 0.6, frictionAir: 0.004, density: 0.001, label: 'cat' });
      if (v) M.Body.setVelocity(body, { x: v.vx, y: v.vy });
      M.Composite.add(this.engine.world, body);
      const cat = { tier, body, seed: 1 + ((this.rng() * 99999) | 0), born: this.t, pop: pop ? 0.55 : 1, phys: grow, face: 'startle', blinkUntil: 0, happyUntil: 0 };
      this.cats.push(cat);
      this.byBody.set(body, cat);
      this.unlock(tier);
      return cat;
    }

    removeCat(cat) {
      cat.dead = true;
      M.Composite.remove(this.engine.world, cat.body);
      this.byBody.delete(cat.body);
    }

    merge(a, b) {
      const tier = a.tier;
      const pa = a.body.position, pb = b.body.position;
      const x = (pa.x + pb.x) / 2, y = (pa.y + pb.y) / 2;
      const v = { vx: (a.body.velocity.x + b.body.velocity.x) / 2, vy: Math.min(0, (a.body.velocity.y + b.body.velocity.y) / 2) };
      this.removeCat(a);
      this.removeCat(b);
      this.merges++;
      this.combo = this.t - this.comboT < 0.9 ? this.combo + 1 : 1;
      this.comboT = this.t;
      if (tier >= TIERS) {
        this.cosmics++;
        this.score += 1000;
        this.burst(x, y, 50, 'star');
        this.banners.push({ kind: 'collapse', text: this.L.supernova, t0: this.t, dur: 1.8 });
        this.sfx('record');
        this.sfx('crash');
        return;
      }
      const nt = tier + 1;
      const c = this.addCat(nt, x, y, v, true);
      c.happyUntil = this.t + 0.9;
      this.score += POINTS[nt] * Math.min(COMBO_CAP, this.combo);
      this.burst(x, y, 10 + nt * 2, nt >= 9 ? 'star' : 'pop');
      this.sfx('pop', { pitch: 1.5 - nt * 0.06 });
      this.sfx(nt >= 4 ? 'meow' : 'mrrp', { pitch: Math.max(0.55, 1.7 - nt * 0.1), vol: 0.8 });
      if (this.combo >= 2) {
        this.banners.push({ kind: 'word', text: `${this.L.combo} x${Math.min(COMBO_CAP, this.combo)}!`, color: '#e8590c', t0: this.t, dur: 1.1 });
        this.sfx('ding', { note: 84 + Math.min(this.combo, 8) * 2 }); // capped: keeps the partials audible
      }
    }

    burst(x, y, n, kind) {
      const cols = kind === 'star' ? ['#ffe066', '#ffffff', '#b197fc'] : ['#ffd43b', '#ff8fab', '#74c0fc', '#8ce99a'];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 6;
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, life: 0, max: 0.5 + Math.random() * 0.5, kind, color: cols[i % cols.length], rot: Math.random() * 6, size: 3 + Math.random() * 4 });
      }
    }

    step() {
      const dt = 1 / 60;
      this.t += dt;
      this.frame++;
      if (this.state === 'play') {
        this.cooldown -= dt;
        if (!this.held && this.cooldown <= 0.25) {
          this.held = { tier: this.next, popT: this.t, seed: 1 + ((this.rng() * 99999) | 0) };
          this.next = this.randTier();
          this.unlock(this.held.tier);
        }
        if (this.pendingDrop && this.canDrop()) { this.pendingDrop = false; this.drop(); }
      }
      for (const c of this.cats) {
        if (c.phys < 1) {
          const ns = Math.min(1, c.phys + dt * 2.6);
          M.Body.scale(c.body, ns / c.phys, ns / c.phys);
          c.phys = ns;
        }
      }
      M.Engine.update(this.engine, 1000 * dt);
      // safety net: nothing may end up inside the box walls or floor
      for (const c of this.cats) {
        const b = c.body, r = this.radius(c.tier) * c.phys;
        const x = LT.clamp(b.position.x, BOX.l + r, BOX.r - r), y = Math.min(b.position.y, BOX.floor - r);
        if (x !== b.position.x || y !== b.position.y) {
          M.Body.setPosition(b, { x, y });
          M.Body.setVelocity(b, { x: b.velocity.x * 0.5, y: Math.min(0, b.velocity.y) });
        }
      }

      // Merges: equal cats that touch (distance check with a small tolerance, so two cats resting
      // side by side on the floor merge too - the physics engine doesn't report a contact for those).
      const done = new Set();
      const list = this.state === 'play' ? this.cats.slice() : []; // no merges/points after game over
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (a.dead || done.has(a)) continue;
        const ra = this.radius(a.tier);
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (b.dead || done.has(b) || b.tier !== a.tier) continue;
          const dx = a.body.position.x - b.body.position.x, dy = a.body.position.y - b.body.position.y;
          if (dx * dx + dy * dy <= Math.pow(ra * 2 + MERGE_TOLERANCE, 2)) {
            done.add(a); done.add(b);
            this.merge(a, b);
            break;
          }
        }
      }
      this.cats = this.cats.filter((c) => !c.dead);

      // overflow check
      let over = false;
      for (const c of this.cats) {
        const b = c.body, r = this.radius(c.tier);
        if (this.t - c.born > (c.tier >= 11 ? 2.6 : 1.2) && b.position.y - r < BOX.danger && b.speed < 1) { over = true; break; }
      }
      this.dangerT = over ? this.dangerT + dt : Math.max(0, this.dangerT - dt * 2);
      if (this.state === 'play' && this.dangerT > 2.6) {
        this.state = 'over';
        this.overAt = this.t;
        this.sfx('gameover');
        if (this.score > this.best) this.best = this.score;
      }
      if (this.state === 'over' && !this.sentOver && this.t - this.overAt > 1.4) {
        this.sentOver = true;
        this.emit('over', { score: this.score, best: this.best, maxTier: this.maxTier, merges: this.merges, cosmics: this.cosmics });
      }

      for (const c of this.cats) {
        if (c.pop < 1) c.pop = Math.min(1, c.pop + dt * 3);
        const b = c.body, t = this.t;
        let f = 'sleep';
        if (t - c.born < 0.8 && c.pop >= 1 && b.speed > 2) f = 'startle';
        else if (c.happyUntil > t) f = 'happy';
        else if (b.position.y - this.radius(c.tier) < BOX.danger + 60) f = 'worry';
        else if (b.speed > 3) f = 'open';
        else if (c.blinkUntil > t) f = 'open';
        else if (Math.random() < 0.002) c.blinkUntil = t + 1;
        c.face = f;
      }
      for (const p of this.particles) { p.life += dt; p.x += p.vx; p.y += p.vy; p.vy += 0.22; p.rot += 0.2; }
      this.particles = this.particles.filter((p) => p.life < p.max);
      this.banners = this.banners.filter((b) => this.t - b.t0 < b.dur);
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
      this.drawHUD(ctx, L, T, boil);
      ctx.save();
      ctx.translate(0, Math.max(0, (viewH - LT.H) * 0.45));

      // box interior
      ctx.fillStyle = 'rgba(201,154,98,0.16)';
      ctx.fillRect(BOX.l, BOX.top, BOX.r - BOX.l, BOX.floor - BOX.top);
      // danger line
      const warn = this.dangerT > 0.05;
      ctx.save();
      ctx.setLineDash([14, 12]);
      ctx.strokeStyle = warn ? `rgba(224,49,49,${0.5 + 0.5 * Math.abs(Math.sin(T * 10))})` : 'rgba(224,49,49,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(BOX.l + 6, BOX.danger);
      ctx.lineTo(BOX.r - 6, BOX.danger);
      ctx.stroke();
      ctx.restore();

      // held cat + aim guide
      if (this.held && this.state === 'play') {
        const tier = this.held.tier, r = this.radius(tier);
        const x = this.clampX(this.aimX, tier);
        const s = LT.ease.outBack(LT.clamp((this.t - this.held.popT) / 0.25, 0, 1));
        ctx.save();
        ctx.setLineDash([6, 14]);
        ctx.strokeStyle = 'rgba(43,37,32,0.22)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, DROP_Y + r + 8);
        ctx.lineTo(x, BOX.floor - 6);
        ctx.stroke();
        ctx.restore();
        D.line(ctx, [[x, -10], [x, DROP_Y - r - 16]], { seed: 401, boil, lw: 2.6, passes: 1 });
        const peg = D.roundRect(16, 30, 5, 2).map((p) => [p[0] + x, p[1] + DROP_Y - r * s - 12]);
        D.shape(ctx, peg, { fill: '#f08c00', seed: 402, boil, lw: 2.6 });
        C.drawCat(ctx, { type: 'm' + tier, seed: this.held.seed, face: 'open', x, y: DROP_Y, a: 0, scale: s }, T, boil);
      }

      // cats
      for (const c of this.cats) {
        const b = c.body;
        C.drawCat(ctx, { type: 'm' + c.tier, seed: c.seed, face: c.face, x: b.position.x, y: b.position.y, a: b.angle, scale: LT.ease.outBack(c.pop) }, T, boil);
      }

      // danger line again on top of the cats + warning
      if (warn) {
        ctx.save();
        ctx.setLineDash([14, 12]);
        ctx.strokeStyle = `rgba(224,49,49,${0.5 + 0.5 * Math.abs(Math.sin(T * 10))})`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(BOX.l + 6, BOX.danger); ctx.lineTo(BOX.r - 6, BOX.danger); ctx.stroke();
        ctx.restore();
        D.text(ctx, L.tooFull, 360, BOX.top - 26, { size: 40, color: '#e03131', stroke: '#fffdf5', strokeWidth: 10, seed: 5, boil });
      }

      // cardboard box walls (drawn over the cats' edges)
      const wallL = D.roundRect(30, BOX.floor - BOX.top + 40, 8, 2).map((p) => [p[0] + BOX.l - 15, p[1] + (BOX.top + BOX.floor) / 2 + 10]);
      const wallR = wallL.map((p) => [p[0] + (BOX.r - BOX.l) + 30, p[1]]);
      const floor = D.roundRect(BOX.r - BOX.l + 60, 34, 8, 2).map((p) => [p[0] + 360, p[1] + BOX.floor + 17]);
      for (const [pts, s] of [[wallL, 1], [wallR, 2], [floor, 3]]) D.shape(ctx, pts, { fill: '#c99a62', seed: 1000 + s, boil, lw: 3.2 });
      D.text(ctx, 'FRAGILE', 348, BOX.floor + 18, { size: 24, font: LT.FONT_TEXT, color: '#c0392b', seed: 7, boil });
      D.line(ctx, [[400, BOX.floor + 28], [400, BOX.floor + 8]], { seed: 8, boil, lw: 2.6, ink: '#c0392b', passes: 1 });
      D.line(ctx, [[393, BOX.floor + 15], [400, BOX.floor + 7], [407, BOX.floor + 15]], { seed: 9, boil, lw: 2.6, ink: '#c0392b', passes: 1 });

      // evolution strip
      // evolution strip (kept between the two corner buttons)
      const y0 = BOX.floor + 60;
      for (let i = 1; i <= TIERS; i++) {
        const x = 162 + (i - 1) * ((558 - 162) / (TIERS - 1));
        const type = 'm' + i, sc = 16 / this.radius(i);
        if (this.dex.has(type)) C.drawCat(ctx, { type, seed: 5, face: i <= this.maxTier ? 'happy' : 'sleep', x, y: y0, a: 0, scale: sc }, T, boil);
        else C.drawSilhouette(ctx, type, x, y0, sc, boil);
      }

      for (const p of this.particles) {
        ctx.save();
        ctx.globalAlpha = 1 - p.life / p.max;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.kind === 'star') D.sparkle(ctx, 0, 0, p.size + 2, p.color);
        else { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(0, 0, p.size * 0.7, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      // unlock cards sit low in the box so they never cover the cat you're aiming
      LT.Render.drawBanners(ctx, { banners: this.banners.map((b) => Object.assign({}, b, { k: (this.t - b.t0) / b.dur })), lang: this.lang }, T, boil, { unlockY: 1000, unlockScale: 0.85 });
      ctx.restore();
      ctx.restore();
    }

    drawHUD(ctx, L, T, boil) {
      D.text(ctx, `${this.score}`, 92, 74, { size: 74, align: 'left', seed: 11, boil, stroke: '#fbf6ea', strokeWidth: 10 });
      D.text(ctx, `${L.best} ${Math.max(this.best, this.score)}`, 96, 128, { size: 30, font: LT.FONT_TEXT, align: 'left', seed: 12, boil, color: '#5c5248' });
      D.text(ctx, L.next, 574, 74, { size: 26, font: LT.FONT_TEXT, seed: 13, boil, color: '#5c5248', align: 'right' });
      C.drawCat(ctx, { type: 'm' + this.next, seed: 3, face: 'sleep', x: 630, y: 82, a: 0, scale: Math.min(1, 30 / this.radius(this.next)) }, T, boil);
    }
  }

  MergeGame.BOX = BOX;
  MergeGame.DROP_Y = DROP_Y;
  LT.MergeGame = MergeGame;
})();
