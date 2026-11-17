/* Hand-drawn rendering helpers: wobbly "boiling" ink lines, marker fills, pencil shading. */
(function () {
  'use strict';
  const LT = window.LT;
  const H = LT.hash;
  const D = (LT.Doodle = {});

  /* ---------- light / dark palette ----------
     LT.PAL holds the current colours for paper, cards and UI ink; LT.Theme switches it.
     The choice comes from /static/theme.js (window.SiteTheme, key "loaf_theme"); without it
     (e.g. the reels composer) the game is always light. The canvas is redrawn every frame,
     so a switch shows up on the next frame; cached images subscribe with LT.Theme.onChange.
     Cats, tiles, yarn heads and other "objects" keep dark ink in both themes (D.fixed). */
  const INK_DARK = '#2b2520';
  const LIGHT = {
    paper: '#fbf6ea', card: '#fffdf5', ink: INK_DARK, soft: '#5c5248', inkRGB: '43,37,32',
    rule: 'rgba(110,160,210,0.32)', margin: 'rgba(225,90,90,0.38)',
    grain: ['rgba(120,100,70,0.05)', 'rgba(255,255,255,0.35)'],
    surface: '#e9e4da', greenBtn: '#d3f9d8', bubble: '#ffffff', rim: 'rgba(0,0,0,0)',
    desk: '#ead6b8', deskLine: 'rgba(150,110,70,0.25)', boxTint: 'rgba(201,154,98,0.16)',
    sil: '#d9d2c3', silInk: '#b3a993', silText: '#9b917a',
    btn: '#ffd43b', // primary canvas buttons and badges (hint, auto-finish, counters, armed restart)
    text: {}, halo: {},
  };
  const DARK = {
    paper: '#0d1117', card: '#161d2b', ink: '#f0f6fc', soft: '#a3adc2', inkRGB: '240,246,252',
    rule: 'rgba(200,210,240,0.1)', margin: 'rgba(255,122,168,0.38)',
    grain: ['rgba(0,0,0,0.14)', 'rgba(255,255,255,0.03)'],
    surface: '#1d2537', greenBtn: '#12301f', bubble: '#1d2537', rim: 'rgba(240,246,252,0.42)',
    desk: '#1a2131', deskLine: 'rgba(0,0,0,0.35)', boxTint: 'rgba(201,154,98,0.10)',
    sil: '#1d2537', silInk: '#3a4466', silText: '#7a84a0',
    btn: '#7c4dff',
    // text colours picked for light paper -> brighter versions that read on dark paper
    text: {
      '#2b2520': '#f0f6fc', '#5c5248': '#a3adc2', '#e8590c': '#ff922b', '#2b8a3e': '#7ee787',
      '#c2255c': '#ff8fb1', '#e03131': '#ff7aa8', '#c92a2a': '#ff8787', '#6b4fd8': '#b197fc',
    },
    // light "halo" strokes behind text -> dark paper
    halo: { '#fffdf5': '#0d1117', '#fbf6ea': '#0d1117', '#fff8e1': '#0d1117' },
  };
  const PAL = (LT.PAL = Object.assign({}, LIGHT));
  D.INK = PAL.ink;
  D.INK_DARK = INK_DARK;
  D.FIXED = false;

  // Run fn with the light-theme ink (dark lines, no colour mapping): cats, tiles, text on yellow buttons.
  D.fixed = function (fn) {
    const ink = D.INK, fixed = D.FIXED;
    D.INK = INK_DARK;
    D.FIXED = true;
    try { return fn(); } finally { D.INK = ink; D.FIXED = fixed; }
  };

  const themeListeners = [];
  const Theme = (LT.Theme = {
    dark: false,
    set(dark) {
      dark = !!dark;
      const changed = dark !== Theme.dark;
      Theme.dark = dark;
      Object.assign(PAL, dark ? DARK : LIGHT);
      D.INK = PAL.ink;
      if (changed) themeListeners.forEach((fn) => { try { fn(dark); } catch (e) { /* keep the others going */ } });
    },
    onChange(fn) { themeListeners.push(fn); },
    // Draw something in the light theme whatever the setting (shareable clips stay light, like the reels).
    withLight(fn) {
      if (!Theme.dark) return fn();
      const saved = Object.assign({}, PAL), ink = D.INK;
      Object.assign(PAL, LIGHT);
      D.INK = PAL.ink;
      Theme.dark = false;
      try { return fn(); } finally { Object.assign(PAL, saved); D.INK = ink; Theme.dark = true; }
    },
  });
  const ST = window.SiteTheme;
  if (ST && typeof ST.isDark === 'function') {
    Theme.set(ST.isDark());
    if (typeof ST.onChange === 'function') ST.onChange((dark) => Theme.set(dark));
  }
  const textColor = (c) => (D.FIXED ? c : PAL.text[c] || c);
  const haloColor = (c) => (D.FIXED ? c : PAL.halo[c] || c);

  function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }

  // Offset each point by a little hash noise. `boil` changes a few times a second,
  // which makes the lines shimmer like frame-by-frame hand animation.
  // D.BOIL_MIX (0..1, optional): how far a boil frame moves away from frame 0 (subtler shimmer).
  D.BOIL_MIX = null;
  D.wobble = function (pts, seed, boil, amp) {
    const out = new Array(pts.length);
    const m = D.BOIL_MIX;
    const n = m == null || !boil ? (s, i) => H(s, i, boil) : (s, i) => H(s, i, 0) * (1 - m) + H(s, i, boil) * m;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      out[i] = [p[0] + n(seed, i) * amp, p[1] + n(seed + 7919, i) * amp];
    }
    return out;
  };

  // Smooth path through the midpoints of a polyline.
  D.trace = function (ctx, pts, closed) {
    const n = pts.length;
    if (n < 2) return;
    if (closed) {
      const m0 = mid(pts[n - 1], pts[0]);
      ctx.moveTo(m0[0], m0[1]);
      for (let i = 0; i < n; i++) {
        const p = pts[i], m = mid(p, pts[(i + 1) % n]);
        ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
      }
      ctx.closePath();
    } else {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < n - 1; i++) {
        const m = mid(pts[i], pts[i + 1]);
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
      }
      ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
    }
  };

  // Split each edge into n pieces so smoothing only softens the corners.
  D.subdiv = function (pts, n, closed) {
    const out = [];
    const m = closed === false ? pts.length - 1 : pts.length;
    for (let i = 0; i < m; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    if (closed === false) out.push(pts[pts.length - 1]);
    return out;
  };

  // Marker-style fill (slightly off-register), then clip and run `inner` for patterns.
  D.fill = function (ctx, pts, o, inner) {
    const amp = o.amp == null ? 1.3 : o.amp;
    const off = o.off || [1.6, 1.3];
    const fp = D.wobble(pts, (o.seed || 1) + 31, o.boil || 0, amp * 1.3);
    ctx.save();
    ctx.translate(off[0], off[1]);
    ctx.beginPath();
    D.trace(ctx, fp, true);
    ctx.restore();
    ctx.fillStyle = o.fill;
    ctx.fill();
    if (inner) {
      ctx.save();
      ctx.clip();
      inner();
      ctx.restore();
    }
  };

  // Double-pass sketchy outline.
  D.outline = function (ctx, pts, o) {
    const seed = o.seed || 1, boil = o.boil || 0;
    const amp = o.amp == null ? 1.3 : o.amp;
    const lw = o.lw || 3.2;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = o.ink || D.INK;
    ctx.beginPath();
    D.trace(ctx, D.wobble(pts, seed, boil, amp), o.closed !== false);
    ctx.lineWidth = lw;
    ctx.stroke();
    if (o.passes !== 1) {
      ctx.globalAlpha *= 0.4;
      ctx.beginPath();
      D.trace(ctx, D.wobble(pts, seed + 101, boil, amp * 1.7), o.closed !== false);
      ctx.lineWidth = lw * 0.55;
      ctx.stroke();
    }
    ctx.restore();
  };

  // Dark theme only: a soft light rim drawn under an object's silhouette (before its fill), so dark
  // cats with dark ink still stand out from the dark paper, like a sticker edge.
  D.rim = function (ctx, pts, o) {
    if (!Theme.dark) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = PAL.rim;
    ctx.beginPath();
    D.trace(ctx, D.wobble(pts, o.seed || 1, o.boil || 0, o.amp == null ? 1.3 : o.amp), o.closed !== false);
    ctx.lineWidth = (o.lw || 3.2) + 5;
    ctx.stroke();
    ctx.restore();
  };

  D.shape = function (ctx, pts, o, inner) {
    if (o.rim) D.rim(ctx, pts, o);
    if (o.fill) D.fill(ctx, pts, o, inner);
    if (!o.noStroke) D.outline(ctx, pts, o);
  };

  D.line = function (ctx, pts, o) {
    D.outline(ctx, pts, Object.assign({ closed: false }, o));
  };

  // Thick outlined tube (tails, strings).
  D.tube = function (ctx, pts, o) {
    const seed = o.seed || 1, boil = o.boil || 0;
    const wp = D.wobble(pts, seed, boil, o.amp == null ? 1 : o.amp);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    D.trace(ctx, wp, false);
    if (o.rim && Theme.dark) {
      ctx.strokeStyle = PAL.rim;
      ctx.lineWidth = o.width + (o.lw || 3.2) * 2 + 5;
      ctx.stroke();
    }
    ctx.strokeStyle = o.ink || D.INK;
    ctx.lineWidth = o.width + (o.lw || 3.2) * 2;
    ctx.stroke();
    ctx.strokeStyle = o.fill;
    ctx.lineWidth = o.width;
    ctx.stroke();
    ctx.restore();
  };

  D.ellipse = function (rx, ry, n, cx, cy) {
    const pts = [];
    n = n || 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([(cx || 0) + Math.cos(a) * rx, (cy || 0) + Math.sin(a) * ry]);
    }
    return pts;
  };

  function dedupe(pts) {
    const out = [];
    for (const p of pts) {
      const q = out[out.length - 1];
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.75) out.push(p);
    }
    const f = out[0], l = out[out.length - 1];
    if (out.length > 2 && Math.hypot(f[0] - l[0], f[1] - l[1]) <= 0.75) out.pop();
    return out;
  }

  // Clockwise (screen space) rounded rectangle centred on 0,0.
  D.roundRect = function (w, h, r, seg) {
    seg = seg || 4;
    r = Math.max(3, Math.min(r, w / 2, h / 2));
    const pts = [];
    const cs = [
      [w / 2 - r, -h / 2 + r, -Math.PI / 2],
      [w / 2 - r, h / 2 - r, 0],
      [-w / 2 + r, h / 2 - r, Math.PI / 2],
      [-w / 2 + r, -h / 2 + r, Math.PI],
    ];
    for (const [cx, cy, a0] of cs) {
      for (let i = 0; i <= seg; i++) {
        const a = a0 + (i / seg) * (Math.PI / 2);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    }
    return dedupe(pts);
  };

  // Round every corner of a convex polygon (clockwise points).
  D.roundPoly = function (corners, r, seg) {
    seg = seg || 3;
    const n = corners.length, out = [];
    for (let i = 0; i < n; i++) {
      const p = corners[i], a = corners[(i - 1 + n) % n], b = corners[(i + 1) % n];
      const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
      const rr = Math.min(r, la / 2.05, lb / 2.05);
      const s = [p[0] + ((a[0] - p[0]) / la) * rr, p[1] + ((a[1] - p[1]) / la) * rr];
      const e = [p[0] + ((b[0] - p[0]) / lb) * rr, p[1] + ((b[1] - p[1]) / lb) * rr];
      for (let k = 0; k <= seg; k++) {
        const t = k / seg, u = 1 - t;
        out.push([u * u * s[0] + 2 * u * t * p[0] + t * t * e[0], u * u * s[1] + 2 * u * t * p[1] + t * t * e[1]]);
      }
    }
    return dedupe(out);
  };

  // Pencil hatching inside the current clip (lower part of a shape).
  D.shade = function (ctx, w, h, seed, boil, alpha) {
    ctx.save();
    ctx.strokeStyle = 'rgba(43,37,32,' + (alpha || 0.13) + ')';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = -w / 2 - 20, i = 0; x < w / 2 + 10; x += 8, i++) {
      const j = H(seed, i, boil) * 1.5;
      ctx.moveTo(x + j, h / 2 + 4);
      ctx.lineTo(x + 16 + j, h / 2 - h * 0.28 + H(seed + 3, i, 0) * 3);
    }
    ctx.stroke();
    ctx.restore();
  };

  // Wobbly hand-lettered text: each glyph gets its own tiny rotation/offset.
  D.text = function (ctx, str, x, y, o) {
    o = o || {};
    const size = o.size || 32;
    ctx.save();
    ctx.font = `${size}px ${o.font || LT.FONT_TITLE}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const chars = Array.from(str);
    const widths = chars.map((c) => ctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) * (o.spacing || 1);
    let cx = o.align === 'left' ? x : o.align === 'right' ? x - total : x - total / 2;
    const boil = o.boil || 0, seed = o.seed || 7;
    for (let i = 0; i < chars.length; i++) {
      const jr = H(seed, i, boil) * (o.jitter == null ? 0.06 : o.jitter);
      const jy = H(seed + 5, i, boil) * size * 0.03;
      ctx.save();
      ctx.translate(cx + widths[i] / 2, y + jy);
      ctx.rotate(jr);
      if (o.stroke) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = o.strokeWidth || size * 0.16;
        ctx.strokeStyle = haloColor(o.stroke);
        ctx.strokeText(chars[i], -widths[i] / 2, 0);
      }
      ctx.fillStyle = o.color ? textColor(o.color) : D.INK;
      ctx.fillText(chars[i], -widths[i] / 2, 0);
      ctx.restore();
      cx += widths[i] * (o.spacing || 1);
    }
    ctx.restore();
    return total;
  };

  // Simple 4-point sparkle.
  D.sparkle = function (ctx, x, y, s, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color || '#ffd43b';
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s * 0.18, -s * 0.18, s, 0);
    ctx.quadraticCurveTo(s * 0.18, s * 0.18, 0, s);
    ctx.quadraticCurveTo(-s * 0.18, s * 0.18, -s, 0);
    ctx.quadraticCurveTo(-s * 0.18, -s * 0.18, 0, -s);
    ctx.fill();
    ctx.restore();
  };
})();
