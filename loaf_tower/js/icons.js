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
    D.line(ctx, [[-40, 40], [40, -40]], { seed: 91, boil: b, lw: 9, ink: LT.PAL.card, passes: 1 });
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
    gear(ctx, o) {
      // settings: an 8-tooth cog with a hole; o.off adds a small red X (everything muted)
      const b = o.boil;
      const teeth = 8, rOut = 42, rIn = 31, pts = [];
      for (let k = 0; k < teeth; k++) {
        const a = (k / teeth) * Math.PI * 2;
        [[rIn, -0.3], [rOut, -0.17], [rOut, 0.17], [rIn, 0.3]].forEach(([r, d]) => pts.push([Math.cos(a + d) * r, Math.sin(a + d) * r]));
      }
      D.shape(ctx, pts, { fill: '#ffd43b', seed: 191, boil: b, lw: 5, amp: 0.8 });
      D.shape(ctx, D.ellipse(13, 13, 14), { fill: LT.PAL.card, seed: 192, boil: b, lw: 5 });
      if (o.off) {
        D.line(ctx, [[22, 22], [44, 44]], { seed: 193, boil: b, lw: 9, ink: LT.PAL.card, passes: 1 });
        D.line(ctx, [[44, 22], [22, 44]], { seed: 194, boil: b, lw: 9, ink: LT.PAL.card, passes: 1 });
        D.line(ctx, [[22, 22], [44, 44]], { seed: 195, boil: b, lw: 6, ink: RED });
        D.line(ctx, [[44, 22], [22, 44]], { seed: 196, boil: b, lw: 6, ink: RED });
      }
    },
    globe(ctx, o) {
      // language: a little globe with a meridian and two parallels
      const b = o.boil;
      D.shape(ctx, D.ellipse(38, 38, 18), { fill: '#a5d8ff', seed: 197, boil: b, lw: 5 });
      D.line(ctx, arc(0, 0, 38, -Math.PI / 2, Math.PI / 2, 2).map(([x, y]) => [x * 0.42, y]), { seed: 198, boil: b, lw: 4 });
      D.line(ctx, arc(0, 0, 38, Math.PI / 2, Math.PI * 1.5, 2).map(([x, y]) => [x * 0.42, y]), { seed: 199, boil: b, lw: 4 });
      D.line(ctx, [[-36, 0], [36, 0]], { seed: 200, boil: b, lw: 4 });
      D.line(ctx, [[-30, -20], [30, -20]], { seed: 201, boil: b, lw: 3.5 });
      D.line(ctx, [[-30, 20], [30, 20]], { seed: 202, boil: b, lw: 3.5 });
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
    undo(ctx, o) {
      // curved arrow sweeping back to the left
      const b = o.boil;
      D.line(ctx, [[26, 40]].concat(arc(4, 14, 30, -Math.PI * 0.95, Math.PI * 0.05, 14).reverse()), { seed: 75, boil: b, lw: 7 });
      const ex = 4 + Math.cos(-Math.PI * 0.95) * 30, ey = 14 + Math.sin(-Math.PI * 0.95) * 30;
      D.shape(ctx, poly([[ex - 15, ey - 2], [ex + 15, ey - 2], [ex, ey + 22]]), { fill: '#74c0fc', seed: 76, boil: b, lw: 4.5 });
    },
    lock(ctx, o) {
      const b = o.boil;
      D.line(ctx, arc(0, -8, 20, Math.PI, Math.PI * 2, 10).concat([[20, 6]]).reverse().concat([[-20, 6]]), { seed: 111, boil: b, lw: 7 });
      D.shape(ctx, D.roundRect(60, 46, 10, 3).map((p) => [p[0], p[1] + 18]), { fill: '#ffd43b', seed: 112, boil: b, lw: 5 });
      ctx.fillStyle = D.INK;
      ctx.beginPath(); ctx.arc(0, 14, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-2.5, 14, 5, 14);
    },
    paw(ctx, o) {
      const b = o.boil, c = o.color || '#f783ac';
      D.shape(ctx, D.ellipse(24, 20, 12, 0, 16), { fill: c, seed: 121, boil: b, lw: 4.5 });
      [[-27, -8], [-10, -26], [10, -26], [27, -8]].forEach(([x, y], k) => D.shape(ctx, D.ellipse(9, 11, 10, x, y), { fill: c, seed: 122 + k, boil: b, lw: 4 }));
    },
    check(ctx, o) {
      const b = o.boil;
      D.shape(ctx, D.roundRect(70, 70, 12, 3), { fill: o.on ? LT.PAL.greenBtn : LT.PAL.card, seed: 81, boil: b, lw: 5 });
      if (o.on) D.line(ctx, [[-22, 0], [-6, 18], [26, -26]], { seed: 82, boil: b, lw: 9, ink: LT.Theme.dark ? '#69db7c' : '#2b8a3e' });
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
      // index finger up on the LEFT edge of the fist, three folded fingers to its right, thumb in front
      D.shape(ctx, D.roundRect(19, 56, 9, 4).map((p) => [p[0], p[1] - 18]), { fill: skin, seed: 102, boil: b, lw: 5 });
      D.shape(ctx, D.roundRect(56, 46, 18, 4).map((p) => [p[0] + 20, p[1] + 24]), { fill: skin, seed: 101, boil: b, lw: 5 });
      for (let k = 0; k < 3; k++) {
        D.shape(ctx, D.ellipse(8.5, 9, 10, 17 + k * 14, 3), { fill: skin, seed: 103 + k, boil: b, lw: 3.6 });
      }
      D.shape(ctx, D.roundRect(30, 15, 7, 3).map((p) => [p[0] + 14, p[1] + 26]), { fill: '#ffd3ad', seed: 107, boil: b, lw: 3.8 });
      D.line(ctx, [[-5, -38], [5, -38]], { seed: 108, boil: b, lw: 3, passes: 1 });
    },
    shuffle(ctx, o) {
      // two crossing arrows
      const b = o.boil;
      D.line(ctx, [[-40, 24], [-20, 24], [12, -22], [28, -22]], { seed: 131, boil: b, lw: 7 });
      D.line(ctx, [[-40, -22], [-20, -22], [12, 24], [28, 24]], { seed: 132, boil: b, lw: 7 });
      D.shape(ctx, poly([[24, -38], [46, -22], [24, -6]]), { fill: '#b197fc', seed: 133, boil: b, lw: 4.5 });
      D.shape(ctx, poly([[24, 8], [46, 24], [24, 40]]), { fill: '#ffa94d', seed: 134, boil: b, lw: 4.5 });
    },
    wand(ctx, o) {
      // magic wand with a star at the tip
      const b = o.boil;
      D.line(ctx, [[-38, 38], [10, -10]], { seed: 151, boil: b, lw: 10 });
      D.line(ctx, [[-30, 30], [-20, 20]], { seed: 152, boil: b, lw: 5, ink: '#fffdf5', passes: 1 });
      const star = [];
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 9 : 22; star.push([20 + Math.cos(a) * r, -20 + Math.sin(a) * r]); }
      D.shape(ctx, star, { fill: '#ffd43b', seed: 153, boil: b, lw: 4.5, amp: 0.8 });
      D.sparkle(ctx, -14, -32, 7, '#b197fc');
      D.sparkle(ctx, 38, 14, 6, '#74c0fc');
    },
    tiles(ctx, o) {
      // two stacked game tiles, the front one with a paw print
      const b = o.boil;
      const tile = (x, y, rot, fill, seed) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        D.shape(ctx, D.roundRect(48, 58, 9, 3).map((p) => [p[0] + 4, p[1] + 5]), { fill: '#69db7c', seed, boil: b, lw: 4.5 });
        D.shape(ctx, D.roundRect(48, 58, 9, 3), { fill, seed: seed + 1, boil: b, lw: 4.5 });
        ctx.restore();
      };
      tile(-14, -8, -0.18, '#fff3bf', 141);
      tile(14, 6, 0.12, '#fffdf5', 143);
      ctx.save();
      ctx.translate(14, 6);
      ctx.rotate(0.12);
      ctx.fillStyle = '#f783ac';
      ctx.beginPath(); ctx.ellipse(0, 6, 10, 8, 0, 0, Math.PI * 2); ctx.fill();
      [[-11, -5], [-4, -12], [4, -12], [11, -5]].forEach(([x, y]) => { ctx.beginPath(); ctx.ellipse(x, y, 3.6, 4.4, 0, 0, Math.PI * 2); ctx.fill(); });
      ctx.restore();
    },
    cat(ctx, o) {
      LT.Cats.drawCat(ctx, { type: 'loaf', pal: 'orange', seed: 9, face: 'happy', x: -6, y: 8, a: 0, scale: 0.7 }, 0, o.boil || 0);
    },
    trophy(ctx, o) {
      // golden cup with a star
      const b = o.boil;
      for (const s of [-1, 1]) D.line(ctx, [[s * 24, -26], [s * 40, -24], [s * 38, -6], [s * 20, 4]], { seed: 160 + s, boil: b, lw: 5 });
      D.shape(ctx, D.subdiv([[-28, -34], [28, -34], [24, -4], [10, 10], [-10, 10], [-24, -4]], 3, true), { fill: '#ffd43b', seed: 162, boil: b, lw: 5 });
      D.shape(ctx, D.roundRect(14, 18, 3, 2).map((p) => [p[0], p[1] + 18]), { fill: '#fcc419', seed: 163, boil: b, lw: 4 });
      D.shape(ctx, D.roundRect(46, 14, 5, 2).map((p) => [p[0], p[1] + 34]), { fill: '#c99a62', seed: 164, boil: b, lw: 4.5 });
      D.sparkle(ctx, 0, -18, 9, '#fffdf5');
    },
    ball(ctx, o) {
      // Purr Merge: a round "ball cat" (orange tier) with a tiny bit of bounce shadow
      ctx.fillStyle = `rgba(${LT.PAL.inkRGB},0.12)`;
      ctx.beginPath(); ctx.ellipse(0, 42, 30, 6, 0, 0, Math.PI * 2); ctx.fill();
      LT.Cats.drawCat(ctx, { type: 'm4', seed: 9, face: 'happy', x: 0, y: 6, a: 0, scale: 0.72 }, 0, o.boil || 0);
    },
    moon(ctx, o) {
      // crescent moon + two little stars (dark mode on)
      const b = o.boil;
      const R = 36, cx2 = 15, cy2 = -13, r2 = 29;
      const inC2 = (x, y) => Math.hypot(x - cx2, y - cy2) < r2;
      // outer rim: the part of the big circle that the "bite" circle doesn't cover
      const rim = [];
      for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; const x = Math.cos(a) * R, y = Math.sin(a) * R; rim.push([x, y, inC2(x, y)]); }
      const start = rim.findIndex((p, i) => p[2] && !rim[(i + 1) % rim.length][2]);
      const pts = [];
      for (let k = 1; k <= rim.length; k++) { const p = rim[(start + k) % rim.length]; if (p[2]) break; pts.push([p[0], p[1]]); }
      // inner edge: walk the bite circle back from the rim's end to its start, through the inside of the moon
      const last = pts[pts.length - 1], first = pts[0];
      const a0 = Math.atan2(last[1] - cy2, last[0] - cx2);
      let a1 = Math.atan2(first[1] - cy2, first[0] - cx2);
      const mid = (a0 + a1) / 2;
      if (Math.hypot(cx2 + Math.cos(mid) * r2, cy2 + Math.sin(mid) * r2) > R) a1 += a1 < a0 ? Math.PI * 2 : -Math.PI * 2;
      for (let i = 1; i < 12; i++) { const a = a0 + ((a1 - a0) * i) / 12; pts.push([cx2 + Math.cos(a) * r2, cy2 + Math.sin(a) * r2]); }
      D.shape(ctx, pts.map((p) => [p[0] - 4, p[1] + 4]), { fill: '#fff2a8', seed: 171, boil: b, lw: 5 });
      D.sparkle(ctx, 30, -30, 9, '#ffd43b');
      D.sparkle(ctx, 40, 4, 6, '#ffd43b');
      if (o.off) strike(ctx, b);
    },
    sun(ctx, o) {
      const b = o.boil;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        D.line(ctx, [[Math.cos(a) * 32, Math.sin(a) * 32], [Math.cos(a) * 44, Math.sin(a) * 44]], { seed: 180 + k, boil: b, lw: 5, passes: 1 });
      }
      D.shape(ctx, D.ellipse(22, 22, 16), { fill: '#ffd43b', seed: 189, boil: b, lw: 5 });
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

  // HTML icons are PNG data URLs, cached per theme (their lines follow the light / dark ink).
  const cache = {};
  const made = new Map(); // data URL -> [name, opts], so refresh() can redraw any <img> for the other theme
  function url(name, o) {
    const key = (LT.Theme.dark ? 'd:' : 'l:') + name + JSON.stringify(o || {});
    if (!cache[key]) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      draw(cv.getContext('2d'), name, 64, 64, 112, o);
      cache[key] = cv.toDataURL('image/png');
      made.set(cache[key], [name, o]);
    }
    return cache[key];
  }
  // After a theme switch: redraw every hand-drawn icon already on the page.
  function refresh(root) {
    (root || document).querySelectorAll('img.ico').forEach((im) => {
      const m = made.get(im.getAttribute('src'));
      if (m) im.src = url(m[0], m[1]);
    });
  }
  function img(name, o, cls) {
    const im = new Image();
    im.src = url(name, o);
    im.alt = '';
    im.draggable = false;
    im.className = 'ico' + (cls ? ' ' + cls : '');
    return im;
  }

  LT.Icons = { draw, url, img, refresh, names: Object.keys(ICONS) };
})();
