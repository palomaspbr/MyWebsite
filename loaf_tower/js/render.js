/* Draws a game snapshot: notebook paper, cushion + books, cats, effects and HUD. */
(function () {
  'use strict';
  const LT = window.LT;
  const D = LT.Doodle;
  const C = LT.Cats;
  const K = () => LT.Game.CONST;
  const H = LT.hash;

  const paperCache = new WeakMap();
  function paperPattern(ctx) {
    let p = paperCache.get(ctx);
    if (p) return p;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#fbf6ea';
    g.fillRect(0, 0, 256, 256);
    const r = LT.rng(99);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(120,100,70,0.05)' : 'rgba(255,255,255,0.35)';
      g.fillRect(r() * 256, r() * 256, 1 + r() * 1.5, 1 + r() * 1.5);
    }
    p = ctx.createPattern(c, 'repeat');
    paperCache.set(ctx, p);
    return p;
  }

  function drawPaper(ctx, camY, viewH) {
    ctx.save();
    ctx.translate(0, -camY % 256);
    ctx.fillStyle = paperPattern(ctx);
    ctx.fillRect(0, -256, LT.W, viewH + 512);
    ctx.restore();
    const gap = 48;
    const start = -(((camY % gap) + gap) % gap);
    ctx.save();
    ctx.strokeStyle = 'rgba(110,160,210,0.32)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = start; y < viewH; y += gap) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(LT.W, y + 0.5);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(225,90,90,0.38)';
    ctx.beginPath();
    ctx.moveTo(64, 0);
    ctx.lineTo(64, viewH);
    ctx.stroke();
    ctx.restore();
  }

  function drawBase(ctx, boil) {
    const { CX, GROUND_Y, PLAT_W, PLAT_H } = K();
    // stack of books under the cushion
    const books = [
      { w: 280, h: 48, c: '#6fa8dc', s: '#3d6f9f', title: 'CATS' },
      { w: 256, h: 40, c: '#e9c46a', s: '#b38f2f', title: '' },
      { w: 290, h: 54, c: '#e76f51', s: '#a8432b', title: 'PHYSICS' },
      { w: 266, h: 46, c: '#8ac926', s: '#5b8a14', title: '' },
    ];
    let y = GROUND_Y + PLAT_H - 6;
    books.forEach((b, i) => {
      const x = CX + (i % 2 ? -8 : 10);
      const pts = D.roundRect(b.w, b.h, 6, 2).map((p) => [p[0] + x, p[1] + y + b.h / 2]);
      D.shape(ctx, pts, { fill: b.c, seed: 300 + i, boil, lw: 3 }, () => {
        ctx.fillStyle = b.s;
        ctx.fillRect(x - b.w / 2 + 18, y, 12, b.h);
        ctx.fillRect(x + b.w / 2 - 30, y, 12, b.h);
      });
      if (b.title) D.text(ctx, b.title, x, y + b.h / 2 + 1, { size: 26, font: LT.FONT_TEXT, color: '#fffbea', seed: 40 + i, boil });
      y += b.h - 2;
    });
    // desk line
    D.line(ctx, [[-20, y + 6], [LT.W + 20, y + 2]], { seed: 350, boil, lw: 3.5 });
    // cushion
    const cush = D.roundRect(PLAT_W + 6, PLAT_H + 6, 20, 5).map((p) => [p[0] + CX, p[1] + GROUND_Y + PLAT_H / 2]);
    D.shape(ctx, cush, { fill: '#b197fc', seed: 360, boil, lw: 3.4 }, () => {
      D.shade(ctx, PLAT_W, PLAT_H, 361, boil, 0.1);
    });
    ctx.save();
    ctx.setLineDash([9, 8]);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2.5;
    const sp = D.roundRect(PLAT_W - 22, PLAT_H - 16, 12, 4).map((p) => [p[0] + CX, p[1] + GROUND_Y + PLAT_H / 2]);
    ctx.beginPath();
    D.trace(ctx, sp, true);
    ctx.stroke();
    ctx.restore();
    for (const s of [-1, 1]) {
      const tx = CX + s * (PLAT_W / 2 + 2), ty = GROUND_Y + 6;
      D.line(ctx, [[tx, ty], [tx + s * 10, ty - 8], [tx + s * 16, ty - 2]], { seed: 370 + s, boil, lw: 3 });
    }
  }

  function drawBestLine(ctx, snap, boil) {
    const best = snap.best;
    if (!best || best < 10) return;
    const { GROUND_Y, CM_PER_PX } = K();
    const y = GROUND_Y - best / CM_PER_PX;
    ctx.save();
    ctx.setLineDash([16, 12]);
    ctx.strokeStyle = 'rgba(232,89,12,0.75)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const pts = [];
    for (let x = 80; x <= LT.W - 20; x += 40) pts.push([x, y + H(5, x, boil) * 1.5]);
    D.trace(ctx, pts, false);
    ctx.stroke();
    ctx.restore();
    const L = LT.I18N[snap.lang] || LT.I18N.en;
    D.text(ctx, `${L.best} ${Math.round(best)} ${L.cm}`, 86, y - 18, { size: 26, font: LT.FONT_TEXT, color: '#e8590c', align: 'left', seed: 9, boil });
  }

  function drawHeld(ctx, snap, T, boil) {
    const h = snap.held;
    if (!h) return;
    const t = C.TYPES[h.type];
    const s = LT.ease.outBack(h.pop);
    const topY = snap.camY - 10;
    // string + clothes peg
    D.line(ctx, [[h.x, topY], [h.x + Math.sin(T * 3) * 2, (topY + h.y - t.h / 2) / 2], [h.x, h.y - t.h / 2 - 16]], { seed: 401, boil, lw: 2.6, passes: 1 });
    const peg = D.roundRect(16, 30, 5, 2).map((p) => [p[0] + h.x, p[1] + h.y - t.h / 2 - 12]);
    D.shape(ctx, peg, { fill: '#f08c00', seed: 402, boil, lw: 2.6 });
    // aiming guide
    ctx.save();
    ctx.setLineDash([6, 14]);
    ctx.strokeStyle = 'rgba(43,37,32,0.22)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(h.x, h.y + t.h / 2 + 10);
    ctx.lineTo(h.x, Math.max(h.y + t.h / 2 + 12, (snap.towerTop || K().GROUND_Y) - 6));
    ctx.stroke();
    ctx.restore();
    LT.Cats.drawCat(ctx, { type: h.type, pal: h.pal, seed: h.seed, face: 'open', x: h.x, y: h.y, a: Math.sin(T * 2.4) * 0.035, scale: s, off: null }, T, boil);
  }

  function drawTrails(ctx, cats) {
    for (const c of cats) {
      if (!c.trail || c.trail.length < 2) continue;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (c.type === 'rainbow') {
        const cols = ['#ff7b7b', '#ffaa55', '#ffe066', '#7ee08a', '#6cb8ff', '#a98bff'];
        cols.forEach((col, i) => {
          ctx.strokeStyle = col;
          ctx.lineWidth = 7;
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          c.trail.forEach((p, k) => {
            const x = p[0] + (i - 2.5) * 7, y = p[1] - 10;
            if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.stroke();
        });
      } else {
        c.trail.forEach((p, k) => {
          if (k % 2) return;
          D.sparkle(ctx, p[0] + Math.sin(k * 7) * 26, p[1] - 20, 3 + (k / c.trail.length) * 5, k % 4 ? '#ffffff' : '#ffe066');
        });
      }
      ctx.restore();
    }
  }

  function drawParticles(ctx, ps) {
    for (const p of ps) {
      ctx.save();
      ctx.globalAlpha = 1 - p.k;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.kind === 'star') D.sparkle(ctx, 0, 0, p.size + 2, p.color);
      else {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size, -1.6, p.size * 2, 3.2);
      }
      ctx.restore();
    }
  }

  function drawWelds(ctx, welds, T) {
    for (const w of welds) {
      const x = (w[0] + w[2]) / 2, y = (w[1] + w[3]) / 2;
      D.sparkle(ctx, x, y, 5 + Math.sin(T * 8 + x) * 2, '#ff8fab');
    }
  }

  function bubbleAt(ctx, x, y, text, k, seed, boil) {
    const a = k < 0.12 ? k / 0.12 : k > 0.85 ? (1 - k) / 0.15 : 1;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.font = `30px ${LT.FONT_TEXT}`;
    const w = Math.max(56, ctx.measureText(text).width + 30), h = 46;
    const bx = LT.clamp(x + 44, 20, LT.W - w - 20), by = y - h - 30;
    const pts = D.roundRect(w, h, 20, 4).map((p) => [p[0] + bx + w / 2, p[1] + by + h / 2]);
    const tail = [[bx + 20, by + h - 3], [x + 6, y - 6], [bx + 40, by + h - 3]];
    D.fill(ctx, tail, { fill: '#ffffff', seed, boil, off: [0, 0] });
    D.shape(ctx, pts, { fill: '#ffffff', seed: seed + 1, boil, lw: 2.8 });
    D.line(ctx, tail, { seed: seed + 2, boil, lw: 2.6, passes: 1 });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx + 22, by + h - 7, 16, 6);
    D.text(ctx, text, bx + w / 2, by + h / 2 + 1, { size: 30, font: LT.FONT_TEXT, seed, boil });
    ctx.restore();
  }

  function drawFish(ctx, x, y, alive, seed, boil) {
    const body = D.ellipse(20, 12, 14, x, y);
    const tail = D.subdiv([[x + 16, y], [x + 32, y - 12], [x + 32, y + 12]], 3, true);
    const col = alive ? '#ff922b' : '#d6cfc0';
    D.shape(ctx, tail, { fill: col, seed: seed + 1, boil, lw: 2.8 });
    D.shape(ctx, body, { fill: col, seed, boil, lw: 2.8 });
    ctx.fillStyle = D.INK;
    ctx.beginPath();
    ctx.arc(x - 9, y - 2, 2.8, 0, Math.PI * 2);
    ctx.fill();
    if (!alive) {
      D.line(ctx, [[x - 18, y - 16], [x + 30, y + 16]], { seed: seed + 5, boil, lw: 3.4, ink: '#c92a2a' });
    }
  }

  function drawHUD(ctx, snap, T, boil) {
    const L = LT.I18N[snap.lang] || LT.I18N.en;
    D.text(ctx, `${Math.round(snap.height)} ${L.cm}`, 92, 74, { size: 74, align: 'left', seed: 11, boil, stroke: '#fbf6ea', strokeWidth: 10 });
    D.text(ctx, `${snap.placed} ${snap.placed === 1 ? L.cat : L.cats}`, 96, 128, { size: 32, font: LT.FONT_TEXT, align: 'left', seed: 12, boil, color: '#5c5248' });
    for (let i = 0; i < snap.maxLives; i++) drawFish(ctx, 520 + i * 62, 62, i < snap.lives, 500 + i * 7, boil);
    if (snap.next && snap.state === 'play') {
      D.text(ctx, L.next, 574, 118, { size: 26, font: LT.FONT_TEXT, seed: 13, boil, color: '#5c5248', align: 'right' });
      const t = C.TYPES[snap.next.type];
      const sc = Math.min(0.5, 62 / t.w);
      LT.Cats.drawCat(ctx, { type: snap.next.type, pal: snap.next.pal, seed: snap.next.seed, face: 'sleep', x: 632, y: 128, a: 0, scale: sc }, T, boil);
    }
  }

  function drawBanners(ctx, snap, T, boil, view) {
    view = view || {};
    const L = LT.I18N[snap.lang] || LT.I18N.en;
    for (const b of snap.banners) {
      if (view.noUnlock && b.kind === 'unlock') continue;
      const k = b.k;
      const inA = LT.clamp(k / 0.12, 0, 1), outA = LT.clamp((1 - k) / 0.15, 0, 1);
      ctx.save();
      ctx.globalAlpha *= Math.min(inA, outA);
      if (b.kind === 'collapse') {
        const s = 0.6 + LT.ease.outBack(inA) * 0.4;
        ctx.translate(360, 470);
        ctx.rotate(-0.08);
        ctx.scale(s, s);
        D.text(ctx, b.text, 0, 0, { size: 120, color: '#e03131', stroke: '#fff8e1', strokeWidth: 16, seed: 21, boil, jitter: 0.12 });
      } else if (b.kind === 'word') {
        const s = 0.7 + LT.ease.outBack(inA) * 0.3;
        ctx.translate(360, 540);
        ctx.rotate(0.04);
        ctx.scale(s, s);
        D.text(ctx, b.text, 0, 0, { size: 68, color: b.color || '#2b2520', stroke: '#fffdf5', strokeWidth: 12, seed: 23, boil });
      } else if (b.kind === 'unlock') {
        const slide = (1 - LT.ease.outCubic(inA)) * -40;
        ctx.translate(360, 380 + slide);
        ctx.rotate(-0.025);
        const card = D.roundRect(470, 150, 16, 4);
        D.shape(ctx, card, { fill: '#fffdf5', seed: 31, boil, lw: 3 });
        // tape
        ctx.save();
        ctx.rotate(0.06);
        ctx.fillStyle = 'rgba(255,212,59,0.65)';
        ctx.fillRect(-50, -88, 100, 26);
        ctx.restore();
        const t = C.TYPES[b.type];
        const sc = Math.min(0.85, 110 / t.w);
        LT.Cats.drawCat(ctx, { type: b.type, pal: b.pal, seed: 77, face: 'happy', x: -160, y: 8, a: 0, scale: sc }, T, boil);
        if (b.isNew) D.text(ctx, L.newCat, -78, -40, { size: 34, color: '#e8590c', align: 'left', seed: 32, boil });
        D.text(ctx, C.catLabel(b.type, snap.lang), -78, b.isNew ? 2 : -16, { size: 40, align: 'left', seed: 33, boil });
        D.text(ctx, C.catDesc(b.type, snap.lang), -78, b.isNew ? 44 : 30, { size: 24, font: LT.FONT_TEXT, align: 'left', color: '#5c5248', seed: 34, boil, jitter: 0.03 });
      }
      ctx.restore();
    }
  }

  /* view: {scale, viewH, hud, zoom, fx, fy, ox, oy} */
  function draw(ctx, snap, view) {
    const T = snap.t;
    const boil = Math.floor(T * 8) % 4;
    const viewH = view.viewH || LT.H;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(view.scale, view.scale);
    if (view.zoom && view.zoom !== 1) {
      ctx.translate(LT.W / 2, viewH / 2);
      ctx.scale(view.zoom, view.zoom);
      ctx.translate(-(view.fx == null ? LT.W / 2 : view.fx), -(view.fy == null ? viewH / 2 : view.fy));
    }
    if (view.rot) {
      ctx.translate(LT.W / 2, viewH / 2);
      ctx.rotate(view.rot);
      ctx.translate(-LT.W / 2, -viewH / 2);
    }
    const sx = snap.shake ? H(1, snap.t * 60, 0) * snap.shake : 0;
    const sy = snap.shake ? H(2, snap.t * 60, 0) * snap.shake * 0.6 : 0;
    const camY = snap.camY + (view.camOffset || 0);
    drawPaper(ctx, camY, viewH);
    ctx.save();
    ctx.translate(sx, -camY + sy);
    drawBase(ctx, boil);
    drawBestLine(ctx, snap, boil);
    drawTrails(ctx, snap.cats);
    if (snap.state !== 'over' && !view.hideHeld) drawHeld(ctx, snap, T, boil);
    for (const c of snap.cats) {
      if (c.y - camY < -200 || c.y - camY > viewH + 200) continue;
      LT.Cats.drawCat(ctx, c, T, boil);
    }
    drawWelds(ctx, snap.welds || [], T);
    drawParticles(ctx, snap.particles);
    for (const x of snap.toasts) {
      if (x.screen) continue;
      const a = x.k > 0.7 ? (1 - x.k) / 0.3 : 1;
      ctx.save();
      ctx.globalAlpha *= a;
      D.text(ctx, x.text, x.x, x.y - x.k * 30, { size: x.size, color: x.color, stroke: '#fffdf5', strokeWidth: 8, seed: 50, boil });
      ctx.restore();
    }
    if (!view.hideBubbles) for (const b of snap.bubbles) bubbleAt(ctx, b.x, b.y, b.text, b.k, b.seed, boil);
    ctx.restore();
    ctx.restore();

    // screen-space layer (never zoomed)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(view.scale, view.scale);
    if (view.hud !== false && snap.state !== 'demo') drawHUD(ctx, snap, T, boil);
    if (view.banners !== false) drawBanners(ctx, snap, T, boil, view);
    for (const x of snap.toasts) {
      if (!x.screen || view.noScreenToasts) continue;
      const a = x.k > 0.7 ? (1 - x.k) / 0.3 : 1;
      ctx.save();
      ctx.globalAlpha *= a;
      D.text(ctx, x.text, x.x, Math.min(viewH - 60, x.y) - x.k * 40, { size: x.size, color: x.color, stroke: '#fffdf5', strokeWidth: 9, seed: 51, boil });
      ctx.restore();
    }
    ctx.restore();
  }

  LT.Render = { draw, drawPaper, drawFish };
})();
