/* Hand-drawn icons, drawn with the same doodle renderer as the cats (wobbly ink, marker fills).
   Canvas: LT.Icons.draw(ctx, name, x, y, size, {boil, ...}).  HTML: LT.Icons.img(name, opts) -> <img>. */
(function () {
  'use strict';
  const LT = window.LT;
  const D = LT.Doodle;

  const RED = '#e03131';
  const arc = (cx, cy, r, a0, a1, n) => {
    const pts = [];
    n = n || 10;
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return pts;
  };
  const poly = (pts, k) => D.subdiv(pts, k || 3, true);
  const strike = (ctx, b) => {
    D.line(ctx, [[-40, 40], [40, -40]], { seed: 91, boil: b, lw: 9, ink: '#fffdf5', passes: 1 });
    D.line(ctx, [[-40, 40], [40, -40]], { seed: 92, boil: b, lw: 6, ink: RED });
  };

  // Every icon draws inside a 100 x 100 box centred on 0,0.
  const ICONS = {
    speaker(ctx, o) {
      const b = o.boil;
      D.shape(ctx, poly([[-40, -14], [-18, -14], [6, -36], [6, 36], [-18, 14], [-40, 14]]), { fill: '#ffd43b', seed: 11, boil: b, lw: 5 });
      if (o.off) {
        D.line(ctx, [[18, -16], [42, 16]], { seed: 13, boil: b, lw: 6, ink: RED });
        D.line(ctx, [[42, -16], [18, 16]], { seed: 14, boil: b, lw: 6, ink: RED });
      } else {
        D.line(ctx, arc(8, 0, 20, -0.9, 0.9, 8), { seed: 15, boil: b, lw: 5 });
        D.line(ctx, arc(8, 0, 36, -0.85, 0.85, 10), { seed: 16, boil: b, lw: 5 });
      }
    },
    music(ctx, o) {
      const b = o.boil;
      D.line(ctx, [[-16, 24], [-16, -30], [30, -40], [30, 14]], { seed: 21, boil: b, lw: 5 });
      D.line(ctx, [[-16, -18], [30, -28]], { seed: 22, boil: b, lw: 7 });
      D.shape(ctx, D.ellipse(14, 10, 12, -28, 26), { fill: '#b197fc', seed: 23, boil: b, lw: 5 });
      D.shape(ctx, D.ellipse(14, 10, 12, 18, 16), { fill: '#b197fc', seed: 24, boil: b, lw: 5 });
      if (o.off) strike(ctx, b);
    },
    sfx(ctx, o) {
      // a little "pop" burst = sound effects
      const b = o.boil;
      const star = [];
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 18 : 38; star.push([Math.cos(a) * r, Math.sin(a) * r]); }
      D.shape(ctx, star, { fill: '#ffa94d', seed: 25, boil: b, lw: 5, amp: 1.2 });
      D.shape(ctx, D.ellipse(9, 9, 10, 0, 0), { fill: '#fffdf5', seed: 26, boil: b, lw: 4 });
      if (o.off) strike(ctx, b);
    },
    home(ctx, o) {
      const b = o.boil;
      D.shape(ctx, poly([[22, -32], [32, -32], [32, -10], [22, -18]]), { fill: '#c99a62', seed: 31, boil: b, lw: 4.5 });
      D.shape(ctx, poly([[-32, -6], [32, -6], [32, 38], [-32, 38]]), { fill: '#fff3bf', seed: 32, boil: b, lw: 5 });
      D.shape(ctx, poly([[-44, -2], [0, -42], [44, -2]]), { fill: '#ff8787', seed: 33, boil: b, lw: 5 });
      D.shape(ctx, poly([[-10, 12], [10, 12], [10, 38], [-10, 38]]), { fill: '#c99a62', seed: 34, boil: b, lw: 4.5 });
    },
    clip(ctx, o) {
      const b = o.boil;
      D.shape(ctx, poly([[-40, -8], [40, -8], [40, 38], [-40, 38]]), { fill: '#3e3946', seed: 41, boil: b, lw: 5 });
      ctx.save();
      ctx.translate(-40, -12);
      ctx.rotate(-0.28);
      D.shape(ctx, poly([[0, -16], [82, -16], [82, 0], [0, 0]]), { fill: '#fffdf5', seed: 42, boil: b, lw: 4.5 }, () => {
        ctx.fillStyle = '#3e3946';
        for (let x = 6; x < 82; x += 20) { ctx.beginPath(); ctx.moveTo(x, -16); ctx.lineTo(x + 10, -16); ctx.lineTo(x + 2, 0); ctx.lineTo(x - 8, 0); ctx.fill(); }
      });
      ctx.restore();
      D.shape(ctx, D.ellipse(7, 7, 10, 22, 16), { fill: RED, seed: 43, boil: b, lw: 3.5 });
    },
    skull(ctx, o) {
      const b = o.boil;
      D.shape(ctx, poly([[-16, 16], [16, 16], [14, 36], [-14, 36]]), { fill: '#fffdf5', seed: 51, boil: b, lw: 4.5 });
      D.shape(ctx, D.ellipse(34, 30, 16, 0, -8), { fill: '#fffdf5', seed: 52, boil: b, lw: 5 });
      ctx.fillStyle = D.INK;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * 13, -6, 9, 10, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.beginPath(); ctx.moveTo(-4, 12); ctx.lineTo(4, 12); ctx.lineTo(0, 4); ctx.fill();
      D.line(ctx, [[-6, 22], [-6, 34]], { seed: 53, boil: b, lw: 3, passes: 1 });
      D.line(ctx, [[6, 22], [6, 34]], { seed: 54, boil: b, lw: 3, passes: 1 });
    },
    bulb(ctx, o) {
      const b = o.boil;
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k - 2) * 0.6;
        D.line(ctx, [[Math.cos(a) * 36, -10 + Math.sin(a) * 36], [Math.cos(a) * 46, -10 + Math.sin(a) * 46]], { seed: 60 + k, boil: b, lw: 4.5, passes: 1 });
      }
      D.shape(ctx, poly([[-12, 18], [12, 18], [10, 38], [-10, 38]]), { fill: '#adb5bd', seed: 66, boil: b, lw: 4.5 });
      D.shape(ctx, D.ellipse(24, 26, 16, 0, -8), { fill: '#ffd43b', seed: 67, boil: b, lw: 5 });
      D.line(ctx, [[-8, -12], [-12, -2]], { seed: 68, boil: b, lw: 4, ink: '#fffdf5', passes: 1 });
    },
    restart(ctx, o) {
      const b = o.boil;
      D.line(ctx, arc(0, 0, 30, -Math.PI * 0.35, Math.PI * 1.45, 16), { seed: 71, boil: b, lw: 7 });
      const ex = Math.cos(-Math.PI * 0.35) * 30, ey = Math.sin(-Math.PI * 0.35) * 30;
      D.shape(ctx, poly([[ex - 18, ey - 8], [ex + 8, ey - 14], [ex + 2, ey + 12]]), { fill: '#69db7c', seed: 72, boil: b, lw: 4.5 });
    },
    check(ctx, o) {
      const b = o.boil;
      D.shape(ctx, D.roundRect(70, 70, 12, 3), { fill: o.on ? '#d3f9d8' : '#fffdf5', seed: 81, boil: b, lw: 5 });
      if (o.on) D.line(ctx, [[-22, 0], [-6, 18], [26, -26]], { seed: 82, boil: b, lw: 9, ink: '#2b8a3e' });
    },
    yarn(ctx, o) {
      const b = o.boil;
      D.shape(ctx, D.ellipse(34, 34, 18), { fill: '#f783ac', seed: 91, boil: b, lw: 5 }, () => {
        ctx.strokeStyle = '#c2255c';
        ctx.lineWidth = 4;
        for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(0, 0, 32, 13, -0.8 + k * 0.5, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke(); }
      });
      D.line(ctx, [[22, 26], [36, 38], [46, 30]], { seed: 93, boil: b, lw: 4, ink: '#c2255c', passes: 1 });
    },
    hand(ctx, o) {
      // pointing hand, fingertip at the top centre (0, -46)
      const b = o.boil, skin = '#ffe0c2';
      D.shape(ctx, D.roundRect(54, 50, 20, 4).map((p) => [p[0] + 4, p[1] + 22]), { fill: skin, seed: 101, boil: b, lw: 5 });
      D.shape(ctx, D.roundRect(20, 58, 10, 4).map((p) => [p[0], p[1] - 18]), { fill: skin, seed: 102, boil: b, lw: 5 });
      for (let k = 0; k < 3; k++) D.line(ctx, [[12 + k * 9, 4], [12 + k * 9, 16]], { seed: 103 + k, boil: b, lw: 3.5, passes: 1 });
      D.shape(ctx, D.roundRect(16, 24, 8, 3).map((p) => [p[0] - 30, p[1] + 20]), { fill: skin, seed: 107, boil: b, lw: 4.5 });
      D.line(ctx, [[-6, -38], [6, -38]], { seed: 108, boil: b, lw: 3, passes: 1 });
    },
    cat(ctx, o) {
      LT.Cats.drawCat(ctx, { type: 'loaf', pal: 'orange', seed: 9, face: 'happy', x: -6, y: 8, a: 0, scale: 0.7 }, 0, o.boil || 0);
    },
    box(ctx, o) {
      LT.Cats.drawCat(ctx, { type: 'box', pal: 'box', seed: 9, face: 'open', x: 0, y: 12, a: 0, scale: 0.5 }, 0, o.boil || 0);
    },
  };

  function draw(ctx, name, x, y, size, o) {
    const f = ICONS[name];
    if (!f) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 100, size / 100);
    f(ctx, Object.assign({ boil: 0 }, o || {}));
    ctx.restore();
  }

  const cache = {};
  function url(name, o) {
    const key = name + JSON.stringify(o || {});
    if (!cache[key]) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      draw(cv.getContext('2d'), name, 64, 64, 112, o);
      cache[key] = cv.toDataURL('image/png');
    }
    return cache[key];
  }
  function img(name, o, cls) {
    const im = new Image();
    im.src = url(name, o);
    im.alt = '';
    im.draggable = false;
    im.className = 'ico' + (cls ? ' ' + cls : '');
    return im;
  }

  LT.Icons = { draw, url, img, names: Object.keys(ICONS) };
})();
