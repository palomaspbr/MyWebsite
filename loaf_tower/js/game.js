/* Loaf Tower game simulation: physics, rules, special cats, and snapshots for rendering/replay. */
(function () {
  'use strict';
  const LT = window.LT;
  const M = window.Matter;
  const C = LT.Cats;

  const CX = 360;
  const GROUND_Y = 1050;
  const PLAT_W = 330, PLAT_H = 46;
  const FALL_Y = GROUND_Y + 330;
  const CM_PER_PX = 0.3;
  const DROP_SCREEN_Y = 228;
  const MAX_FALL_V = 9; // terminal velocity (px/step) so cats don't bounce off
  const DROP_GAP = 430; // max distance between the held cat and the tower top
  const LAZY_SPIN = 0.84, LAZY_SLIDE = 0.86;
  const FREEZE_DEPTH = 260;
  const LIFE_GRACE = 2.5; // one collapse = one lost fish, not three
  // Side-to-side peg speed (radians/s): base + extra per cm of tower height, capped.
  const DROP_SPEED = 1.4, DROP_SPEED_PER_CM = 0.0065, DROP_SPEED_MAX_EXTRA = 1.9;
  const STEP = 1 / 60;

  // First guaranteed appearance (cat number) of each special in a run.
  const MILESTONES = { 5: 'box', 8: 'zoomies', 10: 'cupcake', 13: 'pudim', 16: 'rainbow', 20: 'galaxy' };

  class Game {
    constructor(opts) {
      this.opts = opts || {};
      this.lang = this.opts.lang || 'en';
      this.onSfx = this.opts.onSfx || null;
      this.onEvent = this.opts.onEvent || null;
      this.dex = this.opts.dex || new Set();
      this.reset(this.opts.seed);
    }

    get L() { return LT.I18N[this.lang] || LT.I18N.en; }

    reset(seed) {
      this.seed = seed == null ? (Math.random() * 1e9) | 0 : seed;
      this.rng = LT.rng(this.seed);
      this.vrng = LT.rng(this.seed ^ 0x5bd1e995);
      if (this.engine) {
        M.Events.off(this.engine);
        M.World.clear(this.engine.world, false);
        M.Engine.clear(this.engine);
      }
      const e = (this.engine = M.Engine.create({ enableSleeping: true, positionIterations: 10, velocityIterations: 8, constraintIterations: 4 }));
      e.gravity.y = 1;
      this.platform = M.Bodies.rectangle(CX, GROUND_Y + PLAT_H / 2, PLAT_W, PLAT_H, {
        isStatic: true, friction: 1, frictionStatic: 2, chamfer: { radius: 14 }, label: 'platform',
      });
      M.Composite.add(e.world, this.platform);
      this.cats = [];
      this.byBody = new Map();
      this.particles = [];
      this.toasts = [];
      this.bubbles = [];
      this.banners = [];
      this.pendingWelds = [];
      this.t = 0;
      this.frame = 0;
      this.lives = this.opts.lives || 3;
      this.dropped = 0;
      this.placed = 0;
      this.height = 0;
      this.bestRun = 0;
      this.best = this.opts.best || 0;
      this.recordShown = false;
      this.state = this.opts.demo ? 'demo' : 'play';
      this.overAt = 0;
      this.culprit = null;
      this.falls = [];
      this.firstFallT = null;
      this.collapseShownAt = -99;
      this.camY = 0;
      this.lastLifeLossT = -99;
      this.maxPlaced = 0;
      this.topSmooth = null;
      this.shake = 0;
      this.dropPhase = this.opts.demo ? 0.4 : 0;
      this.dropX = CX;
      this.manualX = null;
      this.held = null;
      this.heldTimer = 0.25;
      this.lastDrop = null;
      this.lastDropT = -9;
      this.calmUntil = 0;
      this.seenThisRun = new Set();
      this.queue = [];
      this.nameIdx = this.vrng.int(C.NAMES.length);
      this.lastBubbleT = -9;
      this.sfxSince = [];
      this.nextSpec = this.makeSpec(0);
      this.overEventSent = false;
      M.Events.on(e, 'collisionStart', (ev) => this.onCollide(ev));
      M.Events.on(e, 'beforeUpdate', () => this.beforePhysics());
    }

    sfx(name, o) {
      if (this.state === 'demo') return;
      this.sfxSince.push({ name, o: o || {}, t: this.t });
      if (this.sfxSince.length > 400) this.sfxSince.shift();
      if (this.onSfx) this.onSfx(name, o || {});
    }

    emit(name, data) { if (this.onEvent) this.onEvent(name, data); }

    /* ---------- spawning ---------- */
    pickType(n) {
      if (MILESTONES[n] && !this.seenThisRun.has(MILESTONES[n])) return MILESTONES[n];
      if (n < 2) return 'loaf';
      const w = [['loaf', 30], ['curl', 14]];
      if (n >= 3) w.push(['long', 12], ['perfect', 3]);
      if (n >= 4) w.push(['kitten', 9]);
      if (n >= 5) w.push(['chonk', 7]);
      if (n > 5) w.push(['box', 5]);
      if (n > 8) w.push(['zoomies', 4]);
      if (n > 10) w.push(['cupcake', 3]);
      if (n > 13) w.push(['pudim', 3]);
      if (n > 16) w.push(['rainbow', 2.5]);
      if (n > 20) w.push(['galaxy', 2.5]);
      const last = this.nextSpec && this.nextSpec.type;
      const pool = w.filter(([k]) => !(C.SPECIAL[k] && k === last));
      const total = pool.reduce((a, [, v]) => a + v, 0);
      let r = this.rng() * total;
      for (const [k, v] of pool) { if ((r -= v) <= 0) return k; }
      return 'loaf';
    }

    nextName() {
      const n = C.NAMES[this.nameIdx % C.NAMES.length];
      this.nameIdx += 7;
      return n;
    }

    makeSpec(n) {
      if (this.queue.length) {
        const q = this.queue.shift();
        return {
          type: q.type || 'loaf',
          pal: q.pal || C.COMMON_PALS[this.vrng.int(C.COMMON_PALS.length)],
          name: q.name || this.nextName(),
          seed: q.seed || 1 + this.vrng.int(100000),
        };
      }
      const type = this.pickType(n);
      return {
        type,
        pal: C.COMMON_PALS[this.rng.int(C.COMMON_PALS.length)],
        name: this.nextName(),
        seed: 1 + this.vrng.int(100000),
      };
    }

    // Director API (reels): force the next cats.
    forceQueue(list) {
      this.queue = list.slice();
      if (!this.held) this.nextSpec = this.makeSpec(this.dropped);
      else this.nextSpec = this.makeSpec(this.dropped + 1);
    }

    spawnHeld() {
      const spec = this.nextSpec;
      this.nextSpec = this.makeSpec(this.dropped + 1);
      spec.popT = this.t;
      this.held = spec;
      const first = !this.seenThisRun.has(spec.type);
      this.seenThisRun.add(spec.type);
      const isNew = !this.dex.has(spec.type);
      if (this.state !== 'demo') {
        if (isNew) {
          this.dex.add(spec.type);
          this.emit('dex', spec.type);
        }
        if (isNew || (first && C.SPECIAL[spec.type])) {
          this.banners.push({ kind: 'unlock', type: spec.type, pal: spec.pal, isNew, t0: this.t, dur: 2.8 });
          this.sfx('sparkle');
        }
      }
      this.sfx('pop', { pitch: 1 + this.vrng() * 0.3 });
    }

    canDrop() {
      if (!this.held) return false;
      if (this.state !== 'play' && this.state !== 'demo') return false;
      if (this.t - this.held.popT < 0.18) return false;
      const ld = this.lastDrop;
      return !ld || ld.landed || ld.gone || this.t - this.lastDropT > 1.1;
    }

    // The peg follows a smoothed tower top, so it glides instead of jumping when cats land or wobble.
    dropY() {
      const top = this.topSmooth == null ? GROUND_Y : this.topSmooth;
      return Math.max(this.camY + DROP_SCREEN_Y, top - DROP_GAP);
    }

    heldAngle() { return Math.sin(this.t * 2.4) * 0.035; }

    drop() {
      if (!this.canDrop()) return false;
      const s = this.held;
      const { body, off } = C.createBody(M, s.type, this.dropX, this.dropY());
      M.Body.setAngle(body, this.heldAngle());
      const cat = {
        id: body.id, type: s.type, pal: s.pal, name: s.name, seed: s.seed, body, off,
        landed: false, landedT: 0, gone: false, wob: 0, wobT: 0, zoomUntil: 0, face: 'startle',
        blinkUntil: 0, load: 0, trail: [], bornT: this.t, welds: 0, prevFace: 'startle',
      };
      M.Composite.add(this.engine.world, body);
      this.cats.push(cat);
      this.byBody.set(body, cat);
      this.held = null;
      this.heldTimer = 0.38;
      this.lastDrop = cat;
      this.lastDropT = this.t;
      this.dropped++;
      this.sfx('whoosh');
      this.emit('drop', cat);
      return true;
    }

    /* ---------- physics hooks ---------- */
    beforePhysics() {
      const g = this.engine.gravity;
      for (const c of this.cats) {
        if (c.gone) continue;
        const b = c.body;
        if (!c.landed) {
          const vmax = c.type === 'galaxy' ? 3.2 : MAX_FALL_V;
          if (c.type === 'galaxy') b.force.y -= b.mass * g.y * g.scale * 0.78;
          if (b.velocity.y > vmax) M.Body.setVelocity(b, { x: b.velocity.x, y: vmax });
        }
        if (c.zoomUntil > this.t && this.frame % 9 === 0) {
          M.Sleeping.set(b, false);
          const dir = (b.position.x > CX ? -1 : 1) * (this.rng() < 0.75 ? 1 : -1);
          M.Body.applyForce(b, b.position, { x: dir * b.mass * 0.0035, y: -b.mass * 0.004 });
          M.Body.setAngularVelocity(b, b.angularVelocity + dir * 0.015);
        }
      }
      // "Lazy cats": landed cats resist sliding and spinning, so towers teeter slowly instead of
      // slipping apart. Badly balanced towers still topple - just dramatically.
      for (const c of this.cats) {
        if (c.gone || !c.landed || c.zoomUntil > this.t || this.t - c.landedT < 0.2) continue;
        const b = c.body;
        if (b.isSleeping) continue;
        M.Body.setAngularVelocity(b, b.angularVelocity * LAZY_SPIN);
        if (b.speed < 2) M.Body.setVelocity(b, { x: b.velocity.x * LAZY_SLIDE, y: b.velocity.y });
      }
      if (this.calmUntil > this.t) {
        for (const c of this.cats) {
          if (c.gone) continue;
          const b = c.body;
          if (b.isSleeping) continue;
          M.Body.setVelocity(b, { x: b.velocity.x * 0.86, y: b.velocity.y * 0.86 });
          M.Body.setAngularVelocity(b, b.angularVelocity * 0.8);
        }
      }
    }

    onCollide(ev) {
      for (const p of ev.pairs) {
        const a = p.bodyA.parent, b = p.bodyB.parent;
        const ca = this.byBody.get(a), cb = this.byBody.get(b);
        const rel = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
        for (const [c, other, oc] of [[ca, b, cb], [cb, a, ca]]) {
          if (!c || c.gone) continue;
          const solid = other === this.platform || (oc && oc.landed);
          if (!c.landed && solid) this.land(c, rel);
          if (c.type === 'pudim' && rel > 0.8) {
            c.wob = Math.max(c.wob, Math.min(0.16, rel * 0.035));
            c.wobT = 0;
            if (c.landed && rel > 2.5 && this.t - c.landedT > 0.3) this.sfx('boing', { vol: 0.5 });
          }
          if (c.type === 'rainbow' && c.welds < 3 && (other === this.platform || oc)) {
            this.pendingWelds.push([c, other]);
          }
        }
      }
    }

    land(c, speed) {
      c.landed = true;
      c.landedT = this.t;
      this.placed++;
      this.maxPlaced = Math.max(this.maxPlaced, this.placed);
      const t = C.TYPES[c.type];
      const size = (t.w * t.h) / (118 * 66) * (t.density / 1.4);
      this.sfx(c.type === 'box' ? 'box' : 'thud', { size: Math.max(0.5, Math.min(2.4, size)), vol: Math.min(1.2, 0.5 + speed * 0.08) });
      const pitch = c.type === 'kitten' ? 1.55 : c.type === 'chonk' ? 0.72 : 0.9 + ((c.seed % 100) / 100) * 0.3;
      if (c.type !== 'box') {
        if (this.vrng() < 0.8) this.sfx('meow', { pitch, vol: 0.9 });
        else this.sfx('mrrp', { pitch });
      }
      this.toasts.push({ text: c.name, cat: c, t0: this.t, dur: 1.3, size: 30, color: '#2b2520', dy: -1 });
      const b = c.body;
      switch (c.type) {
        case 'chonk':
          this.shake = Math.max(this.shake, 14);
          break;
        case 'pudim':
          c.wob = 0.17; c.wobT = 0;
          this.sfx('boing');
          break;
        case 'cupcake':
          this.burst(b.position.x, b.position.y - 30, 22, 'sprinkle');
          this.sfx('sparkle', { vol: 0.6 });
          break;
        case 'zoomies':
          c.zoomUntil = this.t + 1.3;
          this.sfx('nyoom');
          break;
        case 'galaxy':
          this.calmUntil = this.t + 1.4;
          this.burst(b.position.x, b.position.y, 26, 'star');
          this.sfx('sparkle');
          this.banners.push({ kind: 'word', text: this.lang === 'pt' ? 'calma cósmica' : 'cosmic calm', color: '#6b4fd8', t0: this.t, dur: 1.4 });
          break;
        case 'rainbow':
          this.burst(b.position.x, b.position.y, 16, 'rainbow');
          break;
        case 'perfect':
          this.burst(b.position.x, b.position.y - 20, 12, 'star');
          this.sfx('sparkle', { vol: 0.6 });
          break;
        default:
          break;
      }
      this.emit('land', c);
    }

    weld(c, other) {
      if (c.welds >= 3 || c.gone) return;
      const oc = this.byBody.get(other);
      if (oc && oc.gone) return;
      const a = c.body;
      const dx = other.position.x - a.position.x, dy = other.position.y - a.position.y;
      const len = Math.hypot(dx, dy);
      const perp = { x: (-dy / (len || 1)) * 22, y: (dx / (len || 1)) * 22 };
      // Constraint points are world-oriented offsets; Matter rotates them with the bodies.
      const mk = (pa) => {
        const wa = { x: a.position.x + pa.x * 0.5 + dx * 0.5, y: a.position.y + pa.y * 0.5 + dy * 0.5 };
        return M.Constraint.create({
          bodyA: a, bodyB: other,
          pointA: { x: wa.x - a.position.x, y: wa.y - a.position.y },
          pointB: { x: wa.x - other.position.x, y: wa.y - other.position.y },
          length: 0, stiffness: 0.5, damping: 0.1, render: { visible: false },
        });
      };
      const cons = [mk(perp), mk({ x: -perp.x, y: -perp.y })];
      cons.forEach((k) => { k.ltA = c; k.ltB = oc || null; });
      M.Composite.add(this.engine.world, cons);
      c.welds++;
      this.sfx('ding', { note: 88 + c.welds * 3 });
      this.burst((a.position.x + other.position.x) / 2, (a.position.y + other.position.y) / 2, 8, 'rainbow');
    }

    burst(x, y, n, kind) {
      const cols = {
        sprinkle: ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#9775fa', '#ff9ec7'],
        star: ['#ffe066', '#ffffff', '#b197fc'],
        rainbow: ['#ff7b7b', '#ffaa55', '#ffe066', '#7ee08a', '#6cb8ff', '#a98bff'],
        dust: ['#c9bfae', '#ddd4c3'],
      }[kind];
      for (let i = 0; i < n; i++) {
        const a = this.vrng() * Math.PI * 2, s = 2 + this.vrng() * 6;
        this.particles.push({
          x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 3, life: 0, max: 0.7 + this.vrng() * 0.6,
          kind, color: cols[i % cols.length], rot: this.vrng() * 6, size: 3 + this.vrng() * 4,
        });
      }
    }

    /* ---------- main update ---------- */
    step() {
      const dt = STEP;
      this.t += dt;
      this.frame++;

      // dropper
      if (this.state === 'play' || this.state === 'demo') {
        const h = this.topSmooth == null ? 0 : Math.max(0, (GROUND_Y - this.topSmooth) * CM_PER_PX);
        const speed = DROP_SPEED + Math.min(DROP_SPEED_MAX_EXTRA, h * DROP_SPEED_PER_CM);
        this.dropPhase += dt * speed;
        this.dropX = this.manualX != null ? this.manualX : CX + 222 * (Math.asin(0.97 * Math.sin(this.dropPhase)) / Math.asin(0.97));
        if (!this.held) {
          this.heldTimer -= dt;
          if (this.heldTimer <= 0) this.spawnHeld();
        }
        if (this.state === 'demo') this.demoAI();
      }

      M.Engine.update(this.engine, 1000 * dt);

      for (const [c, other] of this.pendingWelds) this.weld(c, other);
      this.pendingWelds.length = 0;

      // loads (who is sitting on whom)
      for (const c of this.cats) c.load = 0;
      for (const p of this.engine.pairs.list) {
        if (!p.isActive) continue;
        const ca = this.byBody.get(p.bodyA.parent), cb = this.byBody.get(p.bodyB.parent);
        if (!ca || !cb) continue;
        const up = ca.body.position.y < cb.body.position.y ? ca : cb;
        const dn = up === ca ? cb : ca;
        dn.load += up.frozen ? dn.body.mass * 2 : up.body.mass;
      }

      let top = GROUND_Y;
      for (const c of this.cats) {
        if (c.gone) continue;
        const b = c.body;
        if (!c.landed && (c.type === 'rainbow' || c.type === 'galaxy')) {
          c.trail.push([b.position.x, b.position.y]);
          if (c.trail.length > 16) c.trail.shift();
        } else if (c.trail.length) c.trail.shift();
        if (c.wob > 0) { c.wob *= 0.95; c.wobT += dt; if (c.wob < 0.002) c.wob = 0; }

        if (b.position.y > FALL_Y) { this.fallen(c); continue; }

        if (c.landed && b.speed < 3 && b.position.y < GROUND_Y + 10) top = Math.min(top, b.bounds.min.y);
        this.updateFace(c);
      }
      this.towerTop = top;
      if (this.topSmooth == null) { this.topSmooth = top; this.topVel = 0; }
      // Critically damped spring: position AND velocity stay continuous, so the peg and camera
      // glide with no kicks. Rises briskly, sinks gently after collapses.
      const k = top < this.topSmooth ? 6 : 3;
      this.topVel += ((top - this.topSmooth) * k * k - 2 * k * this.topVel) * dt;
      this.topSmooth += this.topVel * dt;

      // Settle the base: cats buried deep below the top that have stopped moving become solid.
      if (this.opts.freeze !== false) {
        for (const c of this.cats) {
          if (c.gone || !c.landed || c.frozen || this.t - c.landedT < 1.5) continue;
          const b = c.body;
          if (b.bounds.min.y > top + (this.opts.freezeDepth || FREEZE_DEPTH) && b.speed < 0.3 && Math.abs(b.angularVelocity) < 0.012) {
            M.Body.setStatic(b, true);
            c.frozen = true;
          }
        }
      }
      this.height = Math.max(0, (GROUND_Y - top) * CM_PER_PX);
      if (this.state === 'play') {
        if (this.height > this.bestRun) this.bestRun = this.height;
        if (this.best > 20 && !this.recordShown && this.bestRun > this.best) {
          this.recordShown = true;
          this.banners.push({ kind: 'word', text: this.L.newRecord, color: '#e8590c', t0: this.t, dur: 1.8 });
          this.sfx('record');
        }
      }

      // camera
      const target = Math.min(0, this.topSmooth - 610);
      this.camY += (target - this.camY) * Math.min(1, dt * 2.2);
      this.shake *= 0.86;

      // particles
      for (const p of this.particles) {
        p.life += dt;
        p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.vx *= 0.98; p.rot += 0.2;
      }
      this.particles = this.particles.filter((p) => p.life < p.max);
      this.toasts = this.toasts.filter((x) => this.t - x.t0 < x.dur);
      this.bubbles = this.bubbles.filter((x) => this.t - x.t0 < x.dur && !x.cat.gone);
      this.banners = this.banners.filter((x) => this.t - x.t0 < x.dur);

      if (this.state === 'over' && !this.overEventSent && this.t - this.overAt > 1.7) {
        this.overEventSent = true;
        this.emit('over', this.summary());
      }
    }

    updateFace(c) {
      const b = c.body, t = this.t;
      let f = 'sleep';
      if (!c.landed) f = 'startle';
      else if (c.zoomUntil > t) f = 'dizzy';
      else if (t - c.landedT < 0.7) f = c.type === 'kitten' ? 'open' : 'happy';
      else if (Math.abs(b.angularVelocity) > 0.035 || b.speed > 2.2) f = 'worry';
      else if (c.load > b.mass * 1.25) f = 'squish';
      else if (c.blinkUntil > t) f = 'open';
      else if (this.vrng() < 0.0015) c.blinkUntil = t + 1.1;
      if (f !== c.prevFace && t - this.lastBubbleT > 2.2 && this.state !== 'demo') {
        const B = this.L.bubbles;
        if (f === 'squish' && this.vrng() < 0.45) this.bubble(c, B.squish[this.vrng.int(B.squish.length)]);
        else if (f === 'worry' && c.prevFace !== 'startle' && this.vrng() < 0.3) this.bubble(c, B.worry[this.vrng.int(B.worry.length)]);
      }
      c.prevFace = f;
      c.face = f;
    }

    bubble(c, text) {
      this.bubbles.push({ cat: c, text, t0: this.t, dur: 1.6 });
      this.lastBubbleT = this.t;
    }

    fallen(c) {
      c.gone = true;
      c.goneT = this.t;
      M.Composite.remove(this.engine.world, c.body);
      for (const k of M.Composite.allConstraints(this.engine.world)) {
        if (k.bodyA === c.body || k.bodyB === c.body) M.Composite.remove(this.engine.world, k);
      }
      this.byBody.delete(c.body);
      if (this.state === 'demo') return;
      this.falls.push({ t: this.t, cat: c, blame: this.lastDrop });
      if (this.firstFallT == null) this.firstFallT = this.t;
      if (c.landed) this.placed = Math.max(0, this.placed - 1);
      this.sfx('fall');
      const stackN = this.toasts.filter((x) => x.screen).length;
      this.toasts.push({ text: this.L.fell(c.name), screen: true, x: 360, y: 1180 - stackN * 46, t0: this.t, dur: 1.6, size: 34, color: '#c92a2a', dy: -1 });
      const recent = this.falls.filter((f) => this.t - f.t < 2.5).length;
      if (recent >= 3 && this.t - this.collapseShownAt > 3) {
        this.collapseShownAt = this.t;
        this.banners.push({ kind: 'collapse', text: this.L.collapse, t0: this.t, dur: 1.6 });
        this.sfx('crash');
        this.shake = 18;
      }
      if (this.state === 'play') {
        const grace = !this.opts.strictLives && this.t - this.lastLifeLossT < LIFE_GRACE;
        if (!grace) {
          this.lives--;
          this.lastLifeLossT = this.t;
          this.emit('life', this.lives);
          if (this.lives <= 0) this.gameOver();
        }
      }
    }

    gameOver() {
      this.state = 'over';
      this.overAt = this.t;
      const lastFall = this.falls[this.falls.length - 1];
      this.culprit = (lastFall && lastFall.blame) || (lastFall && lastFall.cat) || this.lastDrop;
      this.held = null;
      this.sfx('gameover');
    }

    summary() {
      return {
        cats: Math.max(this.maxPlaced, this.placed),
        dropped: this.dropped,
        placed: this.placed,
        height: Math.round(this.bestRun),
        best: Math.max(this.best, Math.round(this.bestRun)),
        newBest: this.bestRun > this.best,
        culprit: this.culprit ? { name: this.culprit.name, type: this.culprit.type } : null,
        firstFallT: this.firstFallT,
        lastFallT: this.falls.length ? this.falls[this.falls.length - 1].t : null,
        seed: this.seed,
      };
    }

    // Title-screen autopilot: drops near the tower centre.
    demoAI() {
      if (!this.held || !this.canDrop()) return;
      let cx = CX, n = 0;
      for (const c of this.cats) if (!c.gone && c.landed) { cx += c.body.position.x; n++; }
      cx = n ? (cx - CX) / n : CX;
      if (Math.abs(this.dropX - cx) < 7) this.drop();
      if (this.dropped > 11 || this.cats.some((c) => c.gone)) {
        if (!this.demoResetAt) this.demoResetAt = this.t + 2.5;
      }
      if (this.demoResetAt && this.t > this.demoResetAt) {
        this.demoResetAt = 0;
        this.reset((this.seed + 1) >>> 0);
      }
    }

    /* ---------- snapshot for rendering & replay ---------- */
    snapshot(takeSfx) {
      const cats = [];
      for (const c of this.cats) {
        if (c.gone) continue;
        const b = c.body;
        cats.push({
          id: c.id, type: c.type, pal: c.pal, seed: c.seed, name: c.name, x: b.position.x, y: b.position.y, a: b.angle,
          off: c.off, face: c.face, wob: c.wob, wobT: c.wobT, zoom: c.zoomUntil > this.t,
          trail: c.trail.length ? c.trail.map((p) => p) : null,
        });
      }
      const held = this.held
        ? { type: this.held.type, pal: this.held.pal, seed: this.held.seed, name: this.held.name, x: this.dropX, y: this.dropY(), a: this.heldAngle(), off: C.getOff(this.held.type),
            pop: LT.clamp((this.t - this.held.popT) / 0.3, 0, 1), face: 'open' }
        : null;
      const towerTop = this.towerTop == null ? GROUND_Y : this.towerTop;
      return {
        t: this.t, camY: this.camY, shake: this.shake, state: this.state, lang: this.lang,
        lives: this.lives, maxLives: this.opts.lives || 3, height: this.height, bestRun: this.bestRun, best: this.best,
        dropped: this.dropped, placed: this.placed, held, towerTop,
        next: this.nextSpec ? { type: this.nextSpec.type, pal: this.nextSpec.pal, seed: this.nextSpec.seed } : null,
        cats,
        welds: M.Composite.allConstraints(this.engine.world).filter((k) => k.ltA).map((k) => {
          const pa = M.Vector.add(k.bodyA.position, k.pointA), pb = M.Vector.add(k.bodyB.position, k.pointB);
          return [pa.x, pa.y, pb.x, pb.y];
        }),
        particles: this.particles.map((p) => ({ x: p.x, y: p.y, kind: p.kind, color: p.color, rot: p.rot, size: p.size, k: p.life / p.max })),
        toasts: this.toasts.map((x) => ({
          text: x.text, size: x.size, color: x.color, k: (this.t - x.t0) / x.dur, screen: !!x.screen,
          x: x.cat ? x.cat.body.position.x : x.x, y: x.cat ? x.cat.body.bounds.min.y - 26 : x.y,
        })),
        bubbles: this.bubbles.map((x) => ({ text: x.text, k: (this.t - x.t0) / x.dur, x: x.cat.body.position.x, y: x.cat.body.bounds.min.y - 10, seed: x.cat.seed })),
        banners: this.banners.map((x) => Object.assign({}, x, { k: (this.t - x.t0) / x.dur })),
        sfx: takeSfx ? this.sfxSince.splice(0) : null,
      };
    }
  }

  Game.CONST = { CX, GROUND_Y, PLAT_W, PLAT_H, FALL_Y, CM_PER_PX, DROP_SCREEN_Y, STEP };
  LT.Game = Game;
})();
