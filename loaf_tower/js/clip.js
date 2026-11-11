/* Turns the last seconds of a game into a vertical video clip the player can share. */
(function () {
  'use strict';
  const LT = window.LT;
  const D = LT.Doodle;

  const MIMES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];

  function supported() {
    return !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);
  }
  function pickMime() {
    for (const m of MIMES) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* ignore */ }
    }
    return '';
  }

  // Build the list of source times for each output frame (30 fps): normal speed, then slow motion, then a hold.
  // Normal speed -> ~2.4 s of slow motion around the first fall -> normal speed to the end -> hold.
  function timeline(hist, focusT, endT) {
    const t0 = hist[0].t;
    const tEnd = Math.min(hist[hist.length - 1].t, endT == null ? Infinity : endT);
    const start = Math.max(t0, focusT - 4);
    const slowFrom = Math.max(start, focusT - 0.6), slowTo = Math.min(tEnd, focusT + 0.6);
    const out = [];
    let t = start;
    while (t < slowFrom) { out.push({ t, slow: false }); t += 1 / 30; }
    while (t < slowTo) { out.push({ t, slow: true }); t += 0.5 / 30; }
    while (t < tEnd && out.length < 30 * 11) { out.push({ t, slow: false }); t += 1 / 30; }
    const last = out.length ? out[out.length - 1].t : tEnd;
    for (let i = 0; i < 45; i++) out.push({ t: last, slow: false, hold: i / 45 });
    return out;
  }

  function overlay(ctx, frame, info, L, boil) {
    // top caption
    ctx.save();
    ctx.fillStyle = 'rgba(255,253,245,0.0)';
    D.text(ctx, L.towerOf(info.cats), 360, 300, { size: 64, stroke: '#fffdf5', strokeWidth: 12, seed: 61, boil });
    if (frame.slow) {
      D.text(ctx, 'slow-mo', 360, 360, { size: 34, font: LT.FONT_TEXT, color: '#e03131', stroke: '#fffdf5', strokeWidth: 8, seed: 62, boil });
    }
    if (frame.hold != null && info.culprit) {
      const k = LT.ease.outBack(Math.min(1, frame.hold * 3));
      ctx.translate(360, 640);
      ctx.rotate(-0.05);
      ctx.scale(k, k);
      const card = D.roundRect(600, 170, 20, 4);
      D.shape(ctx, card, { fill: '#fffdf5', seed: 63, boil, lw: 3.4 });
      const tw = D.text(ctx, L.destroyedBy(info.culprit.name), -24, -18, { size: 54, color: '#e03131', seed: 64, boil });
      LT.Icons.draw(ctx, 'skull', tw / 2 + 12, -20, 54, { boil });
      D.text(ctx, `${info.height} cm`, 0, 46, { size: 40, font: LT.FONT_TEXT, color: '#5c5248', seed: 65, boil });
    }
    ctx.restore();
    // watermark
    ctx.save();
    D.text(ctx, 'LOAF TOWER · palomaliz.com.br/loaf_tower', 360, 1252, { size: 30, font: LT.FONT_TEXT, color: '#2b2520', stroke: '#fffdf5', strokeWidth: 7, seed: 66, boil, jitter: 0.03 });
    ctx.restore();
  }

  async function make(o) {
    const hist = o.history;
    if (!supported()) throw new Error('unsupported');
    if (!hist || hist.length < 20) throw new Error('too short');
    const L = LT.I18N[o.lang] || LT.I18N.en;
    const frames = timeline(hist, o.focusT == null ? hist[hist.length - 1].t - 2 : o.focusT, o.endT);

    const canvas = document.createElement('canvas');
    canvas.width = LT.W;
    canvas.height = LT.H;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(30);
    let tap = null;
    if (o.audio && o.audio.ctx) {
      o.audio.init();
      tap = o.audio.tap();
      if (tap) tap.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      o.audio.stopMusic();
      o.audio.startMusic();
    }
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 5000000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });

    let si = 0, lastSrcT = frames[0].t;
    const draw = (f) => {
      while (si < hist.length - 1 && hist[si + 1].t <= f.t) si++;
      const snap = hist[si];
      LT.Render.draw(ctx, snap, { scale: 1, viewH: LT.H, hud: true, hideHeld: true, noUnlock: true });
      overlay(ctx, f, o.info, L, Math.floor((f.hold != null ? snap.t + f.hold * 1.5 : snap.t) * 8) % 4);
    };
    draw(frames[0]);
    rec.start(200);
    const t0 = performance.now();
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      // sounds that happened between the previous and current source time
      if (o.audio && f.hold == null) {
        for (let k = 0; k < hist.length; k++) {
          const s = hist[k];
          if (s.t <= lastSrcT || s.t > f.t || !s.sfx) continue;
          for (const ev of s.sfx) {
            const opt = Object.assign({}, ev.o);
            if (f.slow) opt.pitch = (opt.pitch || 1) * 0.8;
            o.audio.play(ev.name, opt);
          }
        }
        lastSrcT = f.t;
      }
      if (f.hold != null && Math.abs(f.hold - 0) < 1e-6 && o.audio) o.audio.play('gameover');
      draw(f);
      if (o.onProgress) o.onProgress((i + 1) / frames.length);
      const wait = t0 + ((i + 1) * 1000) / 30 - performance.now();
      await new Promise((r) => setTimeout(r, Math.max(0, wait)));
    }
    rec.stop();
    await done;
    if (o.audio) {
      // restart the background loop (it was restarted from bar 0 for the clip)
      o.audio.stopMusic();
      o.audio.startMusic();
      if (tap) o.audio.untap(tap);
    }
    const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
    const ext = type.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
    return { blob: new Blob(chunks, { type }), type, ext };
  }

  LT.Clip = { supported, make };
})();
