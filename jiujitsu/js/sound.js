/* Synthesized sound effects (WebAudio, no audio files). */
(function () {
  'use strict';
  const KEY = 'jj.sound';
  let ctx = null, master = null;
  let enabled = true;
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch (_) { /* private mode */ }

  function ac() {
    if (!enabled) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  let noiseBuf = null;
  function noise(c) {
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = c.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    return s;
  }

  function env(c, t, peak, attack, decay) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  function tone(c, t, freq, type, peak, dur, glideTo) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = env(c, t, peak, 0.008, dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function hiss(c, t, dur, peak, type, f0, f1, q) {
    const s = noise(c);
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.Q.value = q || 1;
    const g = env(c, t, peak, 0.01, dur);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  // A palm slapping the mat: low thump plus a short slap of noise.
  function slap(c, t, v) {
    tone(c, t, 150, 'sine', 0.9 * v, 0.16, 50);
    hiss(c, t, 0.06, 0.5 * v, 'bandpass', 1800, 900, 0.8);
  }

  const S = {
    // Pencil tick for buttons.
    click() {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      hiss(c, t, 0.035, 0.35, 'highpass', 3500, 0, 0.7);
      tone(c, t, 900, 'triangle', 0.06, 0.03);
    },
    // Paper swoosh when a sheet (dialog) opens.
    open() {
      const c = ac(); if (!c) return;
      hiss(c, c.currentTime, 0.22, 0.28, 'bandpass', 600, 3200, 1.2);
    },
    // Pencil scribble while picking an option.
    scribble() {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      for (let i = 0; i < 4; i++) hiss(c, t + i * 0.045, 0.04, 0.18, 'bandpass', 2600 + Math.random() * 1600, 0, 3);
    },
    // Tap, tap, tap: logging a roll.
    tap() {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      slap(c, t, 1); slap(c, t + 0.16, 0.9); slap(c, t + 0.32, 1);
    },
    // Little victory fanfare.
    win() {
      const c = ac(); if (!c) return;
      const t = c.currentTime + 0.45;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, t + i * 0.09, f, 'triangle', 0.32, i === 3 ? 0.6 : 0.16));
      tone(c, t + 0.27, 1318.5, 'sine', 0.12, 0.7);
      hiss(c, t + 0.25, 0.9, 0.08, 'bandpass', 1200, 2400, 0.6); // tiny crowd
    },
    // Sad trombone, shortened.
    lose() {
      const c = ac(); if (!c) return;
      const t = c.currentTime + 0.45;
      [392, 370, 349.2].forEach((f, i) => tone(c, t + i * 0.22, f, 'sawtooth', 0.09, 0.2));
      tone(c, t + 0.66, 329.6, 'sawtooth', 0.1, 0.55, 300);
    },
    // Two even notes for a draw.
    draw() {
      const c = ac(); if (!c) return;
      const t = c.currentTime + 0.45;
      tone(c, t, 440, 'triangle', 0.25, 0.25);
      tone(c, t + 0.2, 440, 'triangle', 0.25, 0.35);
    },
    // Gong for a new member or a promotion.
    gong() {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      [1, 1.48, 2.03, 2.71, 3.6].forEach((m, i) => tone(c, t, 110 * m, 'sine', 0.28 / (i + 1), 2.4 - i * 0.3));
      hiss(c, t, 0.12, 0.25, 'lowpass', 900, 300, 0.7);
    },
    // Eraser rubbing for deletes.
    erase() {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      for (let i = 0; i < 5; i++) hiss(c, t + i * 0.07, 0.06, 0.3, 'bandpass', 900 + (i % 2) * 500, 0, 1.5);
    },
    // Referee buzz for errors.
    error() {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      tone(c, t, 140, 'square', 0.12, 0.18);
      tone(c, t + 0.2, 110, 'square', 0.12, 0.25);
    },
  };

  window.JJSound = {
    play(name) { try { if (S[name]) S[name](); } catch (_) { /* audio is optional */ } },
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch (_) { /* ignore */ }
      if (enabled) S.click();
      return enabled;
    },
  };
})();
