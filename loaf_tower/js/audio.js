/* Synthesized sound effects and an original lo-fi music loop (WebAudio, no audio files).
   Every function takes (ctx, out, time, opts) so the same code works live,
   while recording a clip, and in an OfflineAudioContext for the reels. */
(function () {
  'use strict';
  const LT = window.LT;

  const noiseCache = new WeakMap();
  function noiseBuf(ctx) {
    let b = noiseCache.get(ctx);
    if (!b) {
      const len = Math.floor(ctx.sampleRate * 2);
      b = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = b.getChannelData(0);
      let s = 12345;
      for (let i = 0; i < len; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        d[i] = s / 0x3fffffff - 1;
      }
      noiseCache.set(ctx, b);
    }
    return b;
  }
  function noise(ctx, t, dur) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf(ctx);
    src.loop = true;
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    return src;
  }
  function gainEnv(ctx, t, peak, a, d) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    return g;
  }
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  const S = (LT.SFX = {});

  // Cat meow: sawtooth through two formant filters with a pitch arc.
  S.meow = function (ctx, out, t, o) {
    o = o || {};
    const p = o.pitch || 1, v = o.vol == null ? 1 : o.vol;
    const dur = (o.dur || 0.42) / Math.pow(p, 0.35);
    const f0 = 470 * p;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0 * 0.72, t);
    osc.frequency.linearRampToValueAtTime(f0 * 1.32, t + dur * 0.32);
    osc.frequency.linearRampToValueAtTime(f0 * 1.12, t + dur * 0.65);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.68, t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6.5;
    const lg = ctx.createGain();
    lg.gain.value = f0 * 0.025;
    lfo.connect(lg).connect(osc.frequency);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 4;
    f1.frequency.setValueAtTime(750 * p, t);
    f1.frequency.linearRampToValueAtTime(1750 * p, t + dur * 0.35);
    f1.frequency.linearRampToValueAtTime(1050 * p, t + dur);
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 6;
    f2.frequency.value = 2500 * p;
    const g2 = ctx.createGain();
    g2.gain.value = 0.45;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1.6 * v, t + 0.05);
    g.gain.setValueAtTime(1.45 * v, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f1).connect(g);
    osc.connect(f2).connect(g2).connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  };

  // Short "mrrp" trill.
  S.mrrp = function (ctx, out, t, o) {
    o = o || {};
    const p = o.pitch || 1, dur = 0.22;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(330 * p, t);
    osc.frequency.linearRampToValueAtTime(520 * p, t + dur);
    const am = ctx.createOscillator();
    am.frequency.value = 28;
    const amg = ctx.createGain();
    amg.gain.value = 0.5;
    const g = gainEnv(ctx, t, 0.55 * (o.vol || 1), 0.02, dur);
    am.connect(amg).connect(g.gain);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    osc.connect(f).connect(g).connect(out);
    osc.start(t); osc.stop(t + dur + 0.1);
    am.start(t); am.stop(t + dur + 0.1);
  };

  // Soft landing thud; size ~ 0.5 (kitten) .. 2 (chonk).
  S.thud = function (ctx, out, t, o) {
    o = o || {};
    const s = o.size || 1, v = Math.min(1.4, o.vol == null ? 1 : o.vol);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(170 / Math.sqrt(s), t);
    osc.frequency.exponentialRampToValueAtTime(48 / Math.sqrt(s), t + 0.16);
    const g = gainEnv(ctx, t, 0.9 * v, 0.004, 0.2 + s * 0.06);
    osc.connect(g).connect(out);
    osc.start(t); osc.stop(t + 0.5);
    const n = noise(ctx, t, 0.08);
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 900;
    const ng = gainEnv(ctx, t, 0.35 * v, 0.002, 0.07);
    n.connect(nf).connect(ng).connect(out);
  };

  S.box = function (ctx, out, t, o) {
    S.thud(ctx, out, t, { size: 0.8, vol: 0.8 });
    const n = noise(ctx, t, 0.12);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 520;
    f.Q.value = 2;
    const g = gainEnv(ctx, t, 0.6, 0.003, 0.12);
    n.connect(f).connect(g).connect(out);
  };

  // Jelly boing for the pudim cat.
  S.boing = function (ctx, out, t, o) {
    o = o || {};
    const v = o.vol == null ? 1 : o.vol;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(230, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.08);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.5);
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(16, t);
    lfo.frequency.linearRampToValueAtTime(7, t + 0.5);
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(70, t);
    lg.gain.exponentialRampToValueAtTime(4, t + 0.55);
    lfo.connect(lg).connect(osc.frequency);
    const g = gainEnv(ctx, t, 0.5 * v, 0.01, 0.55);
    osc.connect(g).connect(out);
    osc.start(t); osc.stop(t + 0.7);
    lfo.start(t); lfo.stop(t + 0.7);
  };

  S.whoosh = function (ctx, out, t, o) {
    const n = noise(ctx, t, 0.25);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.2);
    const g = gainEnv(ctx, t, 0.18 * ((o && o.vol) || 1), 0.05, 0.18);
    n.connect(f).connect(g).connect(out);
  };

  S.pop = function (ctx, out, t, o) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520 * ((o && o.pitch) || 1), t);
    osc.frequency.exponentialRampToValueAtTime(980 * ((o && o.pitch) || 1), t + 0.06);
    const g = gainEnv(ctx, t, 0.35, 0.003, 0.08);
    osc.connect(g).connect(out);
    osc.start(t); osc.stop(t + 0.15);
  };

  // UI button: a soft papery "tock" with a little pitch blip.
  S.tap = function (ctx, out, t, o) {
    const p = (o && o.pitch) || 1;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(740 * p, t);
    osc.frequency.exponentialRampToValueAtTime(420 * p, t + 0.07);
    const g = gainEnv(ctx, t, 0.32, 0.003, 0.09);
    osc.connect(g).connect(out);
    osc.start(t); osc.stop(t + 0.15);
    const n = noise(ctx, t, 0.04);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2600 * p;
    f.Q.value = 1.2;
    const ng = gainEnv(ctx, t, 0.22, 0.001, 0.03);
    n.connect(f).connect(ng).connect(out);
  };

  S.sparkle = function (ctx, out, t, o) {
    const notes = [88, 91, 95, 100];
    notes.forEach((n, i) => {
      const tt = t + i * 0.07;
      for (const [mul, amp] of [[1, 0.22], [2.01, 0.06]]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = midi(n) * mul;
        const g = gainEnv(ctx, tt, amp * ((o && o.vol) || 1), 0.004, 0.45);
        osc.connect(g).connect(out);
        osc.start(tt); osc.stop(tt + 0.55);
      }
    });
  };

  S.nyoom = function (ctx, out, t) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(1300, t + 0.18);
    osc.frequency.exponentialRampToValueAtTime(380, t + 0.42);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2200;
    const g = gainEnv(ctx, t, 0.16, 0.02, 0.42);
    osc.connect(f).connect(g).connect(out);
    osc.start(t); osc.stop(t + 0.5);
  };

  // Cartoon falling whistle.
  S.fall = function (ctx, out, t) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1500, t);
    osc.frequency.exponentialRampToValueAtTime(380, t + 0.75);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.05);
    g.gain.setValueAtTime(0.16, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    osc.connect(g).connect(out);
    osc.start(t); osc.stop(t + 0.85);
  };

  S.crash = function (ctx, out, t) {
    for (let i = 0; i < 5; i++) S.thud(ctx, out, t + i * 0.07 + Math.random() * 0.03, { size: 0.8 + Math.random(), vol: 0.9 });
    const n = noise(ctx, t, 1.2);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2500;
    const g = gainEnv(ctx, t, 0.22, 0.005, 1.1);
    n.connect(f).connect(g).connect(out);
    const b = ctx.createOscillator();
    b.type = 'sine';
    b.frequency.setValueAtTime(70, t);
    b.frequency.exponentialRampToValueAtTime(32, t + 0.8);
    const bg = gainEnv(ctx, t, 0.9, 0.005, 0.9);
    b.connect(bg).connect(out);
    b.start(t); b.stop(t + 1);
  };

  // Sad trombone-ish "wah wah wah waaah".
  S.gameover = function (ctx, out, t) {
    const seq = [[67, 0.3], [66, 0.3], [65, 0.3], [64, 0.95]];
    let tt = t;
    seq.forEach(([n, d], i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(midi(n - 12), tt);
      if (i === 3) {
        osc.frequency.linearRampToValueAtTime(midi(n - 12) * 0.94, tt + d);
        const vib = ctx.createOscillator();
        vib.frequency.value = 5.5;
        const vg = ctx.createGain();
        vg.gain.value = 5;
        vib.connect(vg).connect(osc.frequency);
        vib.start(tt); vib.stop(tt + d + 0.1);
      }
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(500, tt);
      f.frequency.linearRampToValueAtTime(1300, tt + d * 0.4);
      f.frequency.linearRampToValueAtTime(600, tt + d);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.32, tt + 0.04);
      g.gain.setValueAtTime(0.3, tt + d * 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + d);
      osc.connect(f).connect(g).connect(out);
      osc.start(tt); osc.stop(tt + d + 0.05);
      tt += d + 0.04;
    });
  };

  S.record = function (ctx, out, t) { S.sparkle(ctx, out, t, { vol: 1.2 }); S.sparkle(ctx, out, t + 0.3, { vol: 0.8 }); };

  // Reel-only helpers.
  S.riser = function (ctx, out, t, o) {
    const d = (o && o.dur) || 3;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + d);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(3500, t + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 * ((o && o.vol) || 1), t + d);
    g.gain.linearRampToValueAtTime(0.0001, t + d + 0.03);
    osc.connect(f).connect(g).connect(out);
    osc.start(t); osc.stop(t + d + 0.05);
    const n = noise(ctx, t, d);
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.setValueAtTime(400, t);
    nf.frequency.exponentialRampToValueAtTime(6000, t + d);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.1 * ((o && o.vol) || 1), t + d);
    ng.gain.linearRampToValueAtTime(0.0001, t + d + 0.03);
    n.connect(nf).connect(ng).connect(out);
  };
  S.heartbeat = function (ctx, out, t, o) {
    for (const [dt, a] of [[0, 1], [0.22, 0.7]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(75, t + dt);
      osc.frequency.exponentialRampToValueAtTime(40, t + dt + 0.15);
      const g = gainEnv(ctx, t + dt, 0.8 * a * ((o && o.vol) || 1), 0.005, 0.18);
      osc.connect(g).connect(out);
      osc.start(t + dt); osc.stop(t + dt + 0.3);
    }
  };
  S.scratch = function (ctx, out, t) {
    const n = noise(ctx, t, 0.35);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.12);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.3);
    const g = gainEnv(ctx, t, 0.5, 0.01, 0.32);
    n.connect(f).connect(g).connect(out);
  };
  S.ding = function (ctx, out, t, o) {
    const n = (o && o.note) || 84;
    for (const [mul, amp] of [[1, 0.3], [2.76, 0.08], [5.4, 0.03]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = midi(n) * mul;
      const g = gainEnv(ctx, t, amp, 0.003, 0.9);
      osc.connect(g).connect(out);
      osc.start(t); osc.stop(t + 1);
    }
  };

  /* ---------------- music ---------------- */
  const Music = (LT.Music = {});
  Music.bpm = 84;
  Music.barDur = (60 / Music.bpm) * 4;
  const CHORDS = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59, 62]];
  const BASS = [41, 40, 38, 36];
  const MEL = [65, 67, 69, 72, 74, 77, 79];

  function key(ctx, out, t, n, dur, amp) {
    for (const [type, mul, a] of [['sine', 1, 1], ['triangle', 2, 0.12], ['sine', 3, 0.04]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = midi(n) * mul;
      osc.detune.value = (Math.random() - 0.5) * 8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(amp * a, t + 0.012);
      g.gain.exponentialRampToValueAtTime(amp * a * 0.35, t + Math.min(dur, 1.2));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.4);
    }
  }
  function pluck(ctx, out, t, n, amp) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midi(n);
    const g = gainEnv(ctx, t, amp, 0.004, 0.55);
    osc.connect(g).connect(out);
    osc.start(t); osc.stop(t + 0.6);
  }
  function kick(ctx, out, t, amp) {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = gainEnv(ctx, t, amp, 0.003, 0.22);
    osc.connect(g).connect(out);
    osc.start(t); osc.stop(t + 0.3);
  }
  function snare(ctx, out, t, amp) {
    const n = noise(ctx, t, 0.16);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    f.Q.value = 0.8;
    const g = gainEnv(ctx, t, amp, 0.002, 0.14);
    n.connect(f).connect(g).connect(out);
  }
  function hat(ctx, out, t, amp) {
    const n = noise(ctx, t, 0.05);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = gainEnv(ctx, t, amp, 0.001, 0.04);
    n.connect(f).connect(g).connect(out);
  }

  // Schedule one bar. parts: {keys, bass, drums, mel} (truthy = on).
  Music.bar = function (ctx, out, t, i, parts) {
    parts = parts || { keys: 1, bass: 1, drums: 1, mel: 1 };
    const beat = 60 / Music.bpm;
    const ch = CHORDS[i % 4];
    const sw = 0.58;
    if (parts.keys) {
      ch.forEach((n, k) => key(ctx, out, t + k * 0.012, n, beat * 1.6, 0.05));
      ch.forEach((n, k) => key(ctx, out, t + beat * 2.5 + k * 0.012, n, beat * 1.3, 0.035));
    }
    if (parts.bass) {
      key(ctx, out, t, BASS[i % 4], beat * 2.2, 0.16);
      key(ctx, out, t + beat * 2.5, BASS[i % 4] + (i % 2 ? 7 : 12), beat * 1.2, 0.1);
    }
    if (parts.drums) {
      kick(ctx, out, t, 0.5);
      kick(ctx, out, t + beat * 2.5, 0.38);
      snare(ctx, out, t + beat, 0.14);
      snare(ctx, out, t + beat * 3, 0.14);
      for (let k = 0; k < 8; k++) {
        const off = Math.floor(k / 2) * beat + (k % 2 ? beat * sw : 0);
        hat(ctx, out, t + off, k % 2 ? 0.03 : 0.05);
      }
    }
    if (parts.mel) {
      const r = LT.rng(i * 7919 + 17);
      const slots = [0, 0.5 + sw - 0.5, 1.5, 2, 3, 3.5];
      const count = 2 + r.int(2);
      for (let k = 0; k < count; k++) {
        const s = slots[r.int(slots.length)];
        pluck(ctx, out, t + s * beat, r.pick(MEL), 0.09);
      }
    }
  };

  // Music bus with a lo-fi low-pass. Returns the input node.
  Music.bus = function (ctx, dest, vol) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const g = ctx.createGain();
    g.gain.value = vol == null ? 0.55 : vol;
    lp.connect(g).connect(dest);
    return { input: lp, gain: g };
  };

  /* ---------------- live engine ---------------- */
  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.music = null;
      this.taps = [];
    }
    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.out = comp;
      this.master.connect(comp).connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.gain.value = 0.8;
      this.sfx.connect(this.master);
    }
    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.03);
    }
    play(name, o) {
      if (!this.ctx || !LT.SFX[name]) return;
      try { LT.SFX[name](this.ctx, this.sfx, this.ctx.currentTime + 0.01, o || {}); } catch (e) { /* ignore */ }
    }
    // Route everything (after the compressor) into a MediaStream for clip recording.
    tap() {
      if (!this.ctx || !this.ctx.createMediaStreamDestination) return null;
      const d = this.ctx.createMediaStreamDestination();
      this.out.connect(d);
      return d;
    }
    untap(d) { try { this.out.disconnect(d); } catch (e) { /* ignore */ } }
    startMusic(parts) {
      if (!this.ctx || this.music) return;
      const bus = Music.bus(this.ctx, this.master, 0.5);
      const m = (this.music = { bus, bar: 0, next: this.ctx.currentTime + 0.1, parts: parts || null });
      m.timer = setInterval(() => {
        if (!this.ctx) return;
        while (m.next < this.ctx.currentTime + 0.7) {
          Music.bar(this.ctx, bus.input, m.next, m.bar, m.parts);
          m.next += Music.barDur;
          m.bar++;
        }
      }, 80);
    }
    stopMusic() {
      const m = this.music;
      if (!m) return;
      clearInterval(m.timer);
      const g = m.bus.gain;
      g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
      setTimeout(() => { try { g.disconnect(); } catch (e) { /* ignore */ } }, 1500);
      this.music = null;
    }
  }
  LT.AudioEngine = AudioEngine;
})();
