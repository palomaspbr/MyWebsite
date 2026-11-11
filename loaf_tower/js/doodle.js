/* Hand-drawn rendering helpers: wobbly "boiling" ink lines, marker fills, pencil shading. */
(function () {
  'use strict';
  const LT = window.LT;
  const H = LT.hash;
  const D = (LT.Doodle = {});

  D.INK = '#2b2520';

  function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }

  // Offset each point by a little hash noise. `boil` changes a few times a second,
  // which makes the lines shimmer like frame-by-frame hand animation.
  D.wobble = function (pts, seed, boil, amp) {
    const out = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      out[i] = [p[0] + H(seed, i, boil) * amp, p[1] + H(seed + 7919, i, boil) * amp];
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

  D.shape = function (ctx, pts, o, inner) {
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
        ctx.strokeStyle = o.stroke;
        ctx.strokeText(chars[i], -widths[i] / 2, 0);
      }
      ctx.fillStyle = o.color || D.INK;
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
