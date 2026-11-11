/* Loaf Tower - app shell: screens, input, loop, storage, clips. */
(function () {
  'use strict';
  const LT = window.LT;
  const C = LT.Cats;
  const $ = (id) => document.getElementById(id);

  const store = {
    get(k, d) {
      try { const v = localStorage.getItem('lt.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) { try { localStorage.setItem('lt.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  const params = new URLSearchParams(location.search);
  let lang = params.get('lang') === 'pt' ? 'pt' : 'en';
  let best = store.get('best', 0);
  const dex = new Set(store.get('dex', []));
  const audio = new LT.AudioEngine();
  audio.muted = store.get('muted', false);

  const stage = $('stage');
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  let scale = 1, viewH = LT.H;

  let game = null;
  let mode = 'title';
  let history = [];
  let lastSummary = null;
  let paused = false;
  let clipBusy = false;

  function L() { return LT.I18N[lang] || LT.I18N.en; }

  function applyLang() {
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const v = L()[el.dataset.i18n];
      if (typeof v === 'string') el.textContent = v;
    });
    if (game) game.lang = lang;
    updateTitle();
  }

  function updateTitle() {
    $('dex-count').textContent = `${dex.size}/${C.DEX_ORDER.length}`;
    document.querySelectorAll('.dex-count2').forEach((e) => (e.textContent = `${dex.size}/${C.DEX_ORDER.length}`));
    $('title-best').textContent = best > 0 ? `${L().best}: ${best} ${L().cm}` : '';
    const icon = audio.muted ? '🔇' : '🔊';
    $('btn-sound').textContent = icon;
    $('btn-pause-sound').textContent = icon;
  }

  function resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(vw, vh * (9 / 16) * 1.0001);
    stage.style.width = w + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(vh * dpr);
    scale = canvas.width / LT.W;
    viewH = canvas.height / scale;
  }
  window.addEventListener('resize', resize);

  function show(id, on) { $(id).classList.toggle('hidden', !on); }

  function newGame(demo) {
    game = new LT.Game({
      lang, best, dex, demo,
      onSfx: (name, o) => audio.play(name, o),
      onEvent: onGameEvent,
    });
    history = [];
  }

  function onGameEvent(name, data) {
    if (name === 'dex') store.set('dex', Array.from(dex));
    if (name === 'drop') show('hint', false);
    if (name === 'over') gameOver(data);
  }

  function startPlay() {
    audio.init();
    audio.setMuted(audio.muted);
    audio.startMusic();
    mode = 'play';
    newGame(false);
    show('title', false);
    show('over', false);
    show('hint', true);
    show('btn-pause-sound', true);
  }

  // Back to the title screen (with the self-playing demo tower behind it).
  function backToMenu() {
    if (clipBusy) return;
    audio.stopMusic();
    mode = 'title';
    show('over', false);
    show('clip', false);
    show('hint', false);
    show('btn-pause-sound', false);
    newGame(true);
    updateTitle();
    show('title', true);
  }

  function gameOver(sum) {
    lastSummary = sum;
    if (sum.height > best) { best = sum.height; store.set('best', best); }
    const l = L();
    $('over-tower').textContent = l.towerOf(sum.cats);
    $('over-culprit').textContent = sum.culprit ? l.destroyedBy(sum.culprit.name) : '';
    $('over-height').textContent = `${sum.height} ${l.cm} · ${l.best} ${best} ${l.cm}` + (sum.newBest && sum.height > 0 ? ` — ${l.newRecord}` : '');
    show('btn-clip', LT.Clip.supported());
    updateTitle();
    show('over', true);
    show('btn-pause-sound', false);
  }

  /* ---------- catdex ---------- */
  function openDex() {
    const grid = $('dex-grid');
    grid.innerHTML = '';
    for (const type of C.DEX_ORDER) {
      const item = document.createElement('div');
      const known = dex.has(type);
      item.className = 'dex-item' + (known ? '' : ' locked');
      const cv = document.createElement('canvas');
      cv.width = 220; cv.height = 170;
      const g = cv.getContext('2d');
      const t = C.TYPES[type];
      const sc = Math.min(1.1, 170 / t.w, 110 / t.h);
      if (known) C.drawCat(g, { type, pal: 'orange', seed: 42, face: 'happy', x: 110, y: 96, a: 0, scale: sc }, 0, 0);
      else C.drawSilhouette(g, type, 110, 96, sc, 0);
      const label = document.createElement('div');
      label.textContent = known ? C.catLabel(type, lang) : L().locked;
      item.title = known ? C.catDesc(type, lang) : '';
      item.appendChild(cv);
      item.appendChild(label);
      grid.appendChild(item);
    }
    show('dex', true);
  }

  /* ---------- clip ---------- */
  async function makeClip() {
    if (clipBusy || !lastSummary) return;
    clipBusy = true;
    const l = L();
    show('clip', true);
    show('clip-video', false);
    show('btn-clip-share', false);
    show('btn-clip-dl', false);
    $('clip-status').textContent = l.clipMaking;
    $('clip-bar').style.width = '0%';
    const falls = game.falls;
    const lastT = falls.length ? falls[falls.length - 1].t : game.t;
    let focusT = lastT;
    for (let i = falls.length - 1; i >= 0; i--) {
      if (lastT - falls[i].t < 3.5) focusT = falls[i].t; else break;
    }
    const endT = Math.min(game.overAt + 1.6, lastT + 1.4);
    try {
      const res = await LT.Clip.make({
        history, lang, audio, focusT, endT,
        info: { cats: lastSummary.cats, culprit: lastSummary.culprit, height: lastSummary.height },
        onProgress: (k) => { $('clip-bar').style.width = Math.round(k * 100) + '%'; },
      });
      const url = URL.createObjectURL(res.blob);
      const v = $('clip-video');
      v.src = url;
      show('clip-video', true);
      v.play().catch(() => {});
      $('clip-status').textContent = l.clipReady;
      const fname = `loaf-tower-${lastSummary.cats}-cats.${res.ext}`;
      const dl = $('btn-clip-dl');
      dl.href = url;
      dl.download = fname;
      show('btn-clip-dl', true);
      const file = new File([res.blob], fname, { type: res.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        show('btn-clip-share', true);
        $('btn-clip-share').onclick = () => {
          navigator.share({ files: [file], title: 'Loaf Tower', text: l.shareText(lastSummary.cats, lastSummary.height) + ' palomaliz.com.br/loaf_tower' }).catch(() => {});
        };
      }
    } catch (e) {
      $('clip-status').textContent = l.clipUnsupported;
    }
    clipBusy = false;
  }

  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    show('toast', true);
    clearTimeout(toast.h);
    toast.h = setTimeout(() => show('toast', false), 1800);
  }

  async function shareScore() {
    if (!lastSummary) return;
    const text = L().shareText(lastSummary.cats, lastSummary.height);
    const url = 'https://palomaliz.com.br/loaf_tower/';
    if (navigator.share) {
      navigator.share({ title: 'Loaf Tower', text, url }).catch(() => {});
    } else {
      try { await navigator.clipboard.writeText(text + ' ' + url); toast(L().copied); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- input ---------- */
  function tryDrop() {
    if (mode !== 'play' || !game || paused) return;
    audio.init();
    game.drop();
  }
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); tryDrop(); });
  $('hint').addEventListener('pointerdown', tryDrop);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowDown') {
      e.preventDefault();
      if (mode === 'title') startPlay();
      else if (mode === 'play' && game.state === 'over' && !$('over').classList.contains('hidden') && e.code === 'Enter') startPlay();
      else tryDrop();
    }
  });

  // Every menu button makes a little tap (pointerdown = instant feedback, also unlocks audio on mobile).
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('.btn');
    if (!b) return;
    audio.init();
    audio.play('tap', { pitch: b.classList.contains('big') || b.classList.contains('yellow') ? 0.85 : 1 + Math.random() * 0.08 });
  });

  $('btn-play').onclick = startPlay;
  $('btn-again').onclick = startPlay;
  $('btn-menu').onclick = backToMenu;
  $('btn-share').onclick = shareScore;
  $('btn-clip').onclick = makeClip;
  $('btn-dex').onclick = openDex;
  $('btn-over-dex').onclick = openDex;
  $('btn-dex-close').onclick = () => show('dex', false);
  $('btn-clip-close').onclick = () => { if (!clipBusy) show('clip', false); };
  const toggleSound = () => {
    audio.setMuted(!audio.muted);
    store.set('muted', audio.muted);
    updateTitle();
  };
  $('btn-sound').onclick = toggleSound;
  $('btn-pause-sound').onclick = (e) => { e.stopPropagation(); toggleSound(); };

  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    if (audio.ctx) { if (paused) audio.ctx.suspend(); else audio.ctx.resume(); }
  });

  /* ---------- loop ---------- */
  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused && game && !clipBusy) {
      acc += dt;
      let n = 0;
      while (acc >= LT.Game.CONST.STEP && n < 5) {
        game.step();
        acc -= LT.Game.CONST.STEP;
        n++;
        if (mode === 'play' && game.frame % 2 === 0 && (game.state === 'play' || game.t - game.overAt < 2.2)) {
          history.push(game.snapshot(true));
          if (history.length > 420) history.shift();
        }
      }
      if (n >= 5) acc = 0;
    }
    if (game) LT.Render.draw(ctx, game.snapshot(false), { scale, viewH, hud: mode === 'play' });
    requestAnimationFrame(frame);
  }

  async function boot() {
    resize();
    try {
      await Promise.race([
        Promise.all([document.fonts.load(`40px 'Caveat Brush'`), document.fonts.load(`40px 'Patrick Hand'`)]),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    } catch (e) { /* fonts are optional */ }
    applyLang();
    newGame(true);
    requestAnimationFrame(frame);
  }

  // Expose for debugging / automated tests.
  LT.app = { get game() { return game; }, startPlay, get history() { return history; } };
  boot();
})();
