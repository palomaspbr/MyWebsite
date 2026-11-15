/* Loaf Tower - app shell: title + 4 game modes (Tower, Yarn Lines, Purr Merge, Meow Match), input, loop,
   storage, Catdex and collapse clips. */
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
  let mergeBest = store.get('mergeBest', 0);
  const lvlNum = (v) => Math.max(1, Math.floor(+v) || 1); // guard against junk in storage
  let yarnLevel = lvlNum(store.get('yarnLevel', 1)); // highest unlocked Yarn Lines level
  let yarnPlaying = yarnLevel;                // the level being played right now
  let tileLevel = lvlNum(store.get('tileLevel', 1));  // highest unlocked Meow Match level
  let tilePlaying = tileLevel;
  let mjLevel = lvlNum(store.get('mjLevel', 1));      // highest unlocked Meow Match (Mahjong rules) level
  let mjPlaying = mjLevel;
  let tilesVariant = store.get('tilesVariant', 'tiles') === 'mahjong' ? 'mahjong' : 'tiles'; // last Meow Match mode
  const dex = new Set(store.get('dex', []));
  const audio = new LT.AudioEngine();
  const wasMuted = store.get('muted', false); // older versions had one mute switch
  audio.musicOn = store.get('musicOn', !wasMuted);
  audio.sfxOn = store.get('sfxOn', !wasMuted);
  const CALM = { keys: 1, bass: 1, mel: 1, drums: 0 };
  const musicParts = (id) => (id === 'yarn' || id === 'tiles' || id === 'mahjong' ? CALM : null);

  const stage = $('stage');
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  let scale = 1, viewH = LT.H;

  let game = null;        // the active game object (tower demo on the title screen)
  let mode = 'title';     // 'title' | 'play'
  let current = 'tower';  // which game mode is running: 'tower' | 'yarn' | 'merge' | 'tiles'
  let history = [];
  let lastSummary = null;
  let paused = false;
  let menuPaused = false; // the audio menu pauses the game while it's open
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

  function dexText() { return `${C.DEX_ORDER.filter((t) => dex.has(t)).length}/${C.DEX_ORDER.length}`; }
  // win-panel line for newly unlocked cats (a long list becomes a count)
  function newCatsLine(list) {
    if (!list || !list.length) return '';
    if (list.length > 3) return L().newCats(list.length);
    return `${list.length > 1 ? L().newCatsWord : L().newCat} ${list.map((t) => C.catLabel(t, lang)).join(', ')}`;
  }
  // Players who were already past a reward level before that reward existed get it at start-up.
  function catchUpRewards() {
    let added = false;
    const grant = (rewards, solvedUpTo) => {
      for (const [lvl, type] of Object.entries(rewards)) if (+lvl <= solvedUpTo && !dex.has(type)) { dex.add(type); added = true; }
    };
    grant(LT.YarnGame.REWARDS, yarnLevel - 1);
    grant(LT.TileGame.REWARDS, Math.max(tileLevel, mjLevel) - 1);
    if (added) store.set('dex', Array.from(dex));
  }

  function updateTitle() {
    const l = L();
    $('dex-count').textContent = dexText();
    document.querySelectorAll('.dex-count2').forEach((e) => (e.textContent = dexText()));
    $('sub-tower').textContent = best > 0 ? `${l.best} ${best} ${l.cm}` : l.subTower;
    $('sub-yarn').textContent = l.lvlShort(yarnLevel);
    $('sub-merge').textContent = mergeBest > 0 ? `${l.best} ${mergeBest}` : l.subMerge;
    $('sub-tiles').textContent = tilesVariant === 'mahjong' ? `${l.modeMahjongShort} · ${l.lvlShort(mjLevel)}` : l.lvlShort(tileLevel);
    // speaker icon shows a red X only when music and sound effects are both off
    const src = LT.Icons.url('speaker', { off: !audio.musicOn && !audio.sfxOn });
    document.querySelectorAll('img.sound-ico').forEach((im) => { im.src = src; });
    updateAudioMenu();
  }

  /* ---------- hand-drawn icons + audio menu ---------- */
  function placeIcons(root) {
    (root || document).querySelectorAll('i[data-icon]').forEach((el) => {
      const im = LT.Icons.img(el.dataset.icon, {}, el.className);
      el.replaceWith(im);
    });
  }

  function updateAudioMenu() {
    const l = L();
    const set = (id, icon, on) => {
      const b = $(id);
      b.classList.toggle('is-off', !on);
      b.querySelector('.t-ico').src = LT.Icons.url(icon, { off: !on });
      const st = b.querySelector('.t-state');
      st.innerHTML = '';
      st.appendChild(LT.Icons.img('check', { on }, 't-check'));
      st.appendChild(document.createTextNode(on ? l.on : l.off));
    };
    set('btn-music-toggle', 'music', audio.musicOn);
    set('btn-sfx-toggle', 'sfx', audio.sfxOn);
  }

  /* ---------- how-to-play panels (first time in each game, or from the audio menu) ---------- */
  const TUT = {
    tower: [['hand', 'tutTower1'], ['cat', 'tutTower2'], ['paw', 'tutTower3']],
    yarn: [['hand', 'tutYarn1'], ['yarn', 'tutYarn2'], ['check', 'tutYarn3', { on: true }]],
    merge: [['hand', 'tutMerge1'], ['ball', 'tutMerge2'], ['skull', 'tutMerge3']],
    tiles: [['hand', 'tutTiles1'], ['tiles', 'tutTiles2'], ['skull', 'tutTiles3']],
    mahjong: [['hand', 'tutMj1'], ['tiles', 'tutMj2'], ['bulb', 'tutMj3']],
  };
  const modeTitle = (id) => ({ tower: L().modeTower, yarn: L().modeYarn, merge: L().modeMerge, tiles: L().modeTiles, mahjong: L().modeMahjong })[id];
  function openTutorial(id) {
    const l = L();
    $('tut-title').textContent = modeTitle(id);
    const box = $('tut-steps');
    box.innerHTML = '';
    TUT[id].forEach(([icon, key, iconOpts], i) => {
      const row = document.createElement('div');
      row.className = 'tut-step';
      const n = document.createElement('span');
      n.className = 'tut-n';
      n.textContent = i + 1;
      row.appendChild(n);
      row.appendChild(LT.Icons.img(icon, iconOpts || {}, 'tut-ico'));
      const tx = document.createElement('span');
      tx.textContent = l[key];
      row.appendChild(tx);
      box.appendChild(row);
    });
    openTutorial.id = id;
    show('tutorial', true);
    menuPaused = mode === 'play';
  }
  function closeTutorial() {
    if (openTutorial.id) store.set('tut.' + openTutorial.id, true);
    show('tutorial', false);
    menuPaused = !$('audio').classList.contains('hidden') && mode === 'play';
  }

  function openAudio() {
    show('audio', true);
    menuPaused = mode === 'play';
    updateAudioMenu();
  }
  function closeAudio() {
    show('audio', false);
    menuPaused = false;
  }

  // Background music plays everywhere (title, menus, every mode) once the browser allows audio.
  function ensureMusic() {
    audio.init();
    audio.setMusicParts(musicParts(mode === 'play' ? current : 'title'));
    audio.startMusic();
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

  const common = () => ({ lang, dex, onSfx: (name, o) => audio.play(name, o), onEvent: onGameEvent });

  function newTower(demo) {
    game = new LT.Game(Object.assign(common(), { best, demo }));
    history = [];
  }

  function onGameEvent(name, data) {
    if (name === 'dex') { store.set('dex', Array.from(dex)); updateTitle(); }
    if (name === 'drop') show('hint', false);
    if (name === 'over' && current === 'tower') towerOver(data);
    if (name === 'over' && current === 'merge') mergeOver(data);
    if (name === 'won' && current === 'yarn') yarnWon(data);
    if (name === 'over' && (current === 'tiles' || current === 'mahjong')) tilesOver(data);
    if (name === 'won' && (current === 'tiles' || current === 'mahjong')) tilesWon(data);
    if (name === 'restart') restartCurrent();
  }

  function startMode(id, level) {
    if (clipBusy) return;
    if (id === 'yarn') yarnPlaying = LT.clamp(level || yarnLevel, 1, yarnLevel);
    if (id === 'tiles') tilePlaying = LT.clamp(level || tileLevel, 1, tileLevel);
    if (id === 'mahjong') mjPlaying = LT.clamp(level || mjLevel, 1, mjLevel);
    if (id === 'tiles' || id === 'mahjong') { tilesVariant = id; store.set('tilesVariant', id); }
    mode = 'play';
    current = id;
    ensureMusic();
    if (id === 'tower') newTower(false);
    else if (id === 'yarn') game = new LT.YarnGame(Object.assign(common(), { level: yarnPlaying }));
    else if (id === 'tiles') game = new LT.TileGame(Object.assign(common(), { level: tilePlaying }));
    else if (id === 'mahjong') game = new LT.MahjongGame(Object.assign(common(), { level: mjPlaying }));
    else {
      game = new LT.MergeGame(Object.assign(common(), { best: mergeBest, save: store.get('mergeSave', null) })); // resume the box
      if (game.badSave) store.set('mergeSave', null); // a broken save is dropped
    }
    const l = L();
    // Meow Match: the hint sits over the (still empty) tray instead of on the buttons or tiles
    $('hint').style.top = id === 'tiles' ? ((Math.max(0, (viewH - LT.H) * 0.45) + 960) / viewH) * 100 + '%' : '';
    $('hint').style.bottom = id === 'tiles' ? 'auto' : '';
    startedAt = performance.now();
    clearTimeout(startMode.hintT);
    $('hint').textContent = id === 'tower' ? l.tapToDrop : id === 'yarn' ? l.hintYarn : id === 'tiles' ? l.hintTiles : id === 'mahjong' ? l.hintMahjong : l.hintMerge;
    show('title', false);
    show('over', false);
    show('dex', false);
    show('levels', false);
    show('toast', false);
    show('hint', true);
    show('btn-pause-sound', true);
    show('btn-home', true);
    show('tutorial', false);
    if (!store.get('tut.' + id, false)) openTutorial(id); // first time in this game: how to play
    if (id !== 'tower') startMode.hintT = setTimeout(() => { if (current === id) show('hint', false); }, 3500);
  }

  // Back to the title screen (with the self-playing demo tower behind it).
  function backToMenu() {
    if (clipBusy) return;
    // leaving mid-run still keeps your record
    if (mode === 'play' && game) {
      if (current === 'tower' && Math.round(game.bestRun || 0) > best) { best = Math.round(game.bestRun); store.set('best', best); }
      if (current === 'merge' && game.score > mergeBest) { mergeBest = game.score; store.set('mergeBest', mergeBest); }
      saveMerge();
    }
    mode = 'title';
    current = 'tower';
    ensureMusic();
    closeAudio();
    ['over', 'clip', 'hint', 'btn-pause-sound', 'btn-home', 'dex', 'levels', 'board'].forEach((id) => show(id, false));
    LT.Board.sync(bests());
    newTower(true);
    updateTitle();
    show('title', true);
  }

  function openOver(o) {
    // ignore taps for a moment so frantic tapping during a collapse can't hit a button
    const ov = $('over');
    ov.classList.add('arming');
    clearTimeout(openOver.h);
    openOver.h = setTimeout(() => ov.classList.remove('arming'), 700);
    $('over-title').textContent = o.title;
    $('over-tower').textContent = o.line1 || '';
    $('over-culprit').textContent = o.line2 || '';
    if (o.skull) $('over-culprit').appendChild(LT.Icons.img('skull', {}, 'inline'));
    $('over-height').textContent = o.line3 || '';
    $('btn-again').textContent = o.again;
    show('btn-clip', !!o.clip);
    show('btn-over-levels', current === 'yarn' || current === 'tiles' || current === 'mahjong');
    updateTitle();
    show('over', true);
    show('btn-pause-sound', false);
    show('btn-home', false);
    show('hint', false);
  }

  function towerOver(sum) {
    lastSummary = Object.assign({ mode: 'tower' }, sum);
    if (sum.height > best) { best = sum.height; store.set('best', best); }
    const l = L();
    openOver({
      title: l.over,
      line1: l.towerOf(sum.cats),
      line2: sum.culprit ? l.destroyedBy(sum.culprit.name) : '',
      skull: !!sum.culprit,
      line3: `${sum.height} ${l.cm} · ${l.best} ${best} ${l.cm}` + (sum.newBest && sum.height > 0 ? ` — ${l.newRecord}` : ''),
      again: l.again,
      clip: LT.Clip.supported(),
    });
  }

  // Purr Merge keeps its box when you leave (Home, closing the tab); only game over or restart clear it.
  function saveMerge() {
    if (current === 'merge' && mode === 'play' && game && game.serialize) store.set('mergeSave', game.serialize());
  }

  // HUD restart button (Purr Merge / Meow Match): start the same thing over, fresh.
  function restartCurrent() {
    if (current === 'merge') { store.set('mergeSave', null); startMode('merge'); }
    else if (current === 'tiles') startMode('tiles', tilePlaying);
    else if (current === 'mahjong') startMode('mahjong', mjPlaying);
  }

  function mergeOver(sum) {
    store.set('mergeSave', null);
    lastSummary = Object.assign({ mode: 'merge' }, sum);
    const newBest = sum.score > mergeBest;
    if (newBest) { mergeBest = sum.score; store.set('mergeBest', mergeBest); }
    const l = L();
    const bigName = sum.maxTier ? C.catLabel('m' + sum.maxTier, lang) : '';
    openOver({
      title: l.boxFull,
      line1: l.scoreLine(sum.score),
      line2: bigName ? l.biggest(bigName) : '',
      line3: `${l.best} ${mergeBest}` + (newBest && sum.score > 0 ? ` — ${l.newRecord}` : ''),
      again: l.again,
    });
  }

  function yarnWon(sum) {
    lastSummary = Object.assign({ mode: 'yarn' }, sum);
    yarnLevel = Math.max(yarnLevel, sum.level + 1);
    store.set('yarnLevel', yarnLevel);
    const l = L();
    openOver({
      title: l.solved,
      line1: l.solvedLine(sum.level),
      line2: newCatsLine(sum.unlocked),
      line3: l.movesLine(sum.moves, sum.hints),
      again: l.nextLevel,
    });
  }

  function tilesOver(sum) {
    lastSummary = Object.assign({ mode: current, won: false }, sum);
    const l = L();
    openOver({
      title: current === 'mahjong' ? l.noMoves : l.trayFull,
      line1: `${l.level} ${sum.level}`,
      line2: '',
      line3: l.tilesLeft(sum.left),
      again: l.tryAgain,
    });
  }

  function tilesWon(sum) {
    lastSummary = Object.assign({ mode: current, won: true }, sum);
    if (current === 'mahjong') { mjLevel = Math.max(mjLevel, sum.level + 1); store.set('mjLevel', mjLevel); }
    else { tileLevel = Math.max(tileLevel, sum.level + 1); store.set('tileLevel', tileLevel); }
    const l = L();
    openOver({
      title: l.solved,
      line1: l.clearedLine(sum.level),
      line2: newCatsLine(sum.unlocked),
      line3: l.tilesLine(sum.undos, sum.shuffles),
      again: l.nextLevel,
    });
  }

  function again() {
    if (current === 'yarn') startMode('yarn', yarnPlaying + 1);
    else if (current === 'tiles') startMode('tiles', lastSummary && lastSummary.mode === 'tiles' && lastSummary.won ? tilePlaying + 1 : tilePlaying);
    else if (current === 'mahjong') startMode('mahjong', lastSummary && lastSummary.mode === 'mahjong' && lastSummary.won ? mjPlaying + 1 : mjPlaying);
    else startMode(current);
  }

  /* ---------- level menu (Yarn Lines and Meow Match) ---------- */
  function openLevels(kind) {
    const mj = kind === 'mahjong';
    const tiles = kind === 'tiles' || mj;
    const l = L();
    const G = mj ? LT.MahjongGame : tiles ? LT.TileGame : LT.YarnGame;
    const unlocked = mj ? mjLevel : tiles ? tileLevel : yarnLevel;
    // Meow Match: Easy (tray) / Mahjong tabs
    show('levels-tabs', tiles);
    $('lv-tab-easy').classList.toggle('on', !mj);
    $('lv-tab-mj').classList.toggle('on', mj);
    const groupOf = (n) => (tiles ? G.levelSpec(n).layers : G.levelSpec(n).size); // yarn: board size, tiles: layers
    const groupName = (g, a, b) => (tiles ? l.layersGroup(g, a, b) : l.boardSize(g, a, b));
    const title = $('levels-title');
    title.innerHTML = '';
    title.appendChild(LT.Icons.img(tiles ? 'tiles' : 'yarn'));
    title.appendChild(document.createTextNode(' ' + (tiles ? l.modeTiles : l.modeYarn)));
    $('levels-mode-desc').textContent = mj ? l.mjDesc : tiles ? l.easyDesc : '';
    $('levels').classList.toggle('tiles', tiles);
    const grid = $('levels-grid');
    grid.innerHTML = '';
    const total = Math.max(60, Math.ceil(unlocked / 10) * 10 + 10);
    const rewards = G.REWARDS;
    $('levels-sub').textContent = l.levelsSub(unlocked - 1, total);
    let group = null, header = null;
    let currentTile = null;
    for (let n = 1; n <= total; n++) {
      const g = groupOf(n);
      if (g !== group) {
        group = g;
        header = document.createElement('h3');
        header.dataset.from = n;
        grid.appendChild(header);
      }
      header.textContent = groupName(g, +header.dataset.from, n);
      const b = document.createElement('button');
      const locked = n > unlocked, solved = n < unlocked;
      b.className = 'btn lvl' + (locked ? ' locked' : solved ? ' solved' : ' current');
      b.style.rotate = (LT.hash(n, 7, 3) * 2.5).toFixed(2) + 'deg';
      if (locked) b.appendChild(LT.Icons.img('lock', {}, 'lock'));
      else b.textContent = n;
      if (solved) b.appendChild(LT.Icons.img('check', { on: true }, 'badge done'));
      if (rewards[n]) {
        b.appendChild(LT.Icons.img('paw', {}, 'badge reward'));
        b.title = l.rewardCat;
      }
      b.onclick = () => {
        if (locked) {
          b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
          audio.play('thud', { pitch: 1.4, vol: 0.5 });
          toast(l.levelLocked(unlocked));
          return;
        }
        startMode(mj ? 'mahjong' : tiles ? 'tiles' : 'yarn', n);
      };
      if (n === unlocked) currentTile = b;
      grid.appendChild(b);
    }
    show('over', false);
    show('dex', false);
    show('levels', true);
    // start at the top (heading visible); only scroll when the current level is below the fold
    const card = $('levels').querySelector('.card');
    card.scrollTop = 0;
    if (currentTile && currentTile.getBoundingClientRect().bottom > card.getBoundingClientRect().bottom - 90) currentTile.scrollIntoView({ block: 'center' });
  }

  /* ---------- catdex ---------- */
  /* ---------- leaderboard ---------- */
  // best per game for the leaderboard (levels = how many are solved)
  const bests = () => ({ tower: best, merge: mergeBest, yarn: yarnLevel - 1, tiles: tileLevel - 1, mahjong: mjLevel - 1 });
  const BOARD_GAMES = ['tower', 'yarn', 'merge', 'tiles', 'mahjong'];
  let boardGame = 'tower';
  function fmtScore(game, n) {
    const l = L();
    return game === 'tower' ? `${n} ${l.cm}` : game === 'merge' ? `${n}` : l.levelsSolved(n);
  }
  function boardNote() {
    const p = LT.Board.profile, l = L();
    const pub = p && p.public && p.name;
    $('board-note').textContent = pub ? l.boardPublic(p.name) : l.boardPrivate;
    show('btn-board-hide', !!pub);
    if (p && p.name && document.activeElement !== $('board-input')) $('board-input').value = p.name; // hidden players keep their name
  }
  async function openBoard(game) {
    const l = L();
    boardGame = game || boardGame;
    const tabs = $('board-tabs');
    tabs.innerHTML = '';
    BOARD_GAMES.forEach((g) => {
      const b = document.createElement('button');
      b.className = 'btn small-btn tab' + (g === boardGame ? ' on' : '');
      b.textContent = l.boardTab[g];
      b.onclick = () => openBoard(g);
      tabs.appendChild(b);
    });
    $('board-input').placeholder = l.namePlaceholder;
    show('board', true);
    const list = $('board-list');
    list.innerHTML = '';
    const wait = document.createElement('li');
    wait.className = 'muted';
    wait.textContent = l.loading;
    list.appendChild(wait);
    $('board-me').textContent = '';
    LT.Board.sync(bests());
    await LT.Board.flush();
    boardNote();
    const asked = boardGame;
    try {
      const r = await LT.Board.board(asked);
      if (boardGame !== asked) return; // another tab was picked meanwhile
      list.innerHTML = '';
      if (!r.top.length) {
        const li = document.createElement('li');
        li.className = 'muted';
        li.textContent = l.boardEmpty;
        list.appendChild(li);
      }
      r.top.forEach((row, i) => {
        const li = document.createElement('li');
        if (row.me) li.className = 'me';
        const n = document.createElement('span'); n.className = 'b-rank'; n.textContent = i + 1;
        const nm = document.createElement('span'); nm.className = 'b-name'; nm.textContent = row.name;
        const sc = document.createElement('span'); sc.className = 'b-score'; sc.textContent = fmtScore(asked, row.score);
        li.append(n, nm, sc);
        list.appendChild(li);
      });
      $('board-me').textContent = r.me ? l.boardMe(fmtScore(asked, r.me.score), r.me.public ? r.me.rank : null) : l.boardNoScore;
    } catch (e) {
      if (boardGame !== asked) return;
      list.innerHTML = '';
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = l.boardOffline;
      list.appendChild(li);
    }
  }
  // name: text = go public with that name; null = hide (Save with an empty box does nothing)
  async function saveBoardName(name) {
    const l = L();
    if (name === '') { $('board-input').focus(); return; }
    try {
      await LT.Board.setName(name);
      toast(name ? l.nameSaved : l.nameHidden);
      openBoard(boardGame);
    } catch (e) {
      const byCode = { name_taken: l.nameTaken, name_short: l.nameShort, name_long: l.nameLong, bad_name: l.nameShort };
      $('board-note').textContent = byCode[e.code] || (e.status === 409 ? l.nameTaken : l.boardOffline);
    }
  }

  function openDex() {
    const grid = $('dex-grid');
    grid.innerHTML = '';
    for (const sec of C.DEX_SECTIONS) {
      const h = document.createElement('h3');
      const have = sec.types.filter((t) => dex.has(t)).length;
      h.textContent = `${sec.label[lang] || sec.label.en} · ${have}/${sec.types.length}`;
      grid.appendChild(h);
      for (const type of sec.types) {
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
    }
    show('dex', true);
  }

  /* ---------- clip (tower only) ---------- */
  async function makeClip() {
    if (clipBusy || !lastSummary || lastSummary.mode !== 'tower') return;
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
    const l = L();
    const s = lastSummary;
    const text = s.mode === 'yarn' ? l.yarnShare(s.level)
      : s.mode === 'tiles' || s.mode === 'mahjong' ? (s.won ? l.tileShare(s.level) : l.tileStuck(s.level))
      : s.mode === 'merge' ? l.mergeShare(s.score, s.maxTier ? C.catLabel('m' + s.maxTier, lang) : 'cat')
      : l.shareText(s.cats, s.height);
    const url = 'https://palomaliz.com.br/loaf_tower/';
    if (navigator.share) {
      navigator.share({ title: 'Loaf Tower', text, url }).catch(() => {});
    } else {
      try { await navigator.clipboard.writeText(text + ' ' + url); toast(l.copied); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- input ---------- */
  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * LT.W, ((e.clientY - r.top) / r.height) * viewH];
  }
  function playing() { return mode === 'play' && game && !paused && !menuPaused; }

  // Yarn/Merge follow exactly one finger: the one that touched first. Extra fingers are ignored
  // until it lifts (a resting palm or second finger can't hijack a line).
  let activePointer = null;
  let startedAt = 0; // taps right after a level starts are leftovers from the panel button (double tap)
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!playing()) return;
    audio.init();
    if (performance.now() - startedAt < 350) return;
    if (current === 'tower') { game.drop(); return; }
    if (activePointer != null && activePointer !== e.pointerId) return;
    activePointer = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const [x, y] = toLogical(e);
    game.pointer('down', x, y);
    if (current === 'yarn' || current === 'tiles' || current === 'mahjong') show('hint', false);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!playing() || current === 'tower') return;
    if (activePointer != null && e.pointerId !== activePointer) return;
    if (activePointer == null && e.pointerType !== 'mouse') return;
    const [x, y] = toLogical(e);
    game.pointer('move', x, y);
  });
  const up = (e) => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    if (!playing() || current === 'tower') return;
    const [x, y] = toLogical(e);
    game.pointer('up', x, y);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  $('hint').addEventListener('pointerdown', () => { if (playing() && current === 'tower') game.drop(); });

  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return; // typing a name
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowDown') {
      e.preventDefault();
      if (!$('tutorial').classList.contains('hidden')) { closeTutorial(); return; }
      if (['dex', 'clip', 'audio', 'levels', 'board'].some((id) => !$(id).classList.contains('hidden'))) return;
      if (mode === 'title') { startMode('tower'); return; }
      if (!$('over').classList.contains('hidden')) { if (e.code === 'Enter' && !$('over').classList.contains('arming')) again(); return; }
      if (!playing()) return;
      if (current === 'tower') game.drop();
      else if (current === 'merge') game.drop();
    } else if (current === 'merge' && playing() && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      game.aimX = LT.clamp(game.aimX + (e.code === 'ArrowLeft' ? -24 : 24), LT.MergeGame.BOX.l, LT.MergeGame.BOX.r);
    } else if ((current === 'yarn' || current === 'tiles' || current === 'mahjong') && playing() && (e.code === 'KeyZ' || e.code === 'Backspace')) {
      e.preventDefault();
      game.undo();
    } else if (e.code === 'Escape' && ['tutorial', 'dex', 'audio', 'levels', 'board'].some((id) => !$(id).classList.contains('hidden'))) {
      // Escape closes the top overlay first
      if (!$('tutorial').classList.contains('hidden')) closeTutorial();
      else if (!$('board').classList.contains('hidden')) show('board', false);
      else if (!$('audio').classList.contains('hidden')) closeAudio();
      else if (!$('dex').classList.contains('hidden')) show('dex', false);
      else $('btn-levels-close').click();
    } else if (e.code === 'Escape' && mode === 'play') {
      backToMenu();
    }
  });

  // The first touch/click/key anywhere unlocks audio (browser rule) and starts the music.
  const unlockAudio = () => { ensureMusic(); };
  window.addEventListener('pointerdown', unlockAudio, true);
  window.addEventListener('keydown', unlockAudio, true);

  // Every menu button makes a little tap (pointerdown = instant feedback).
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('.btn');
    if (!b) return;
    audio.init();
    audio.play('tap', { pitch: b.classList.contains('big') || b.classList.contains('yellow') ? 0.85 : 1 + Math.random() * 0.08 });
  });

  $('btn-play').onclick = () => startMode('tower');
  $('btn-yarn').onclick = () => openLevels('yarn');
  $('btn-over-levels').onclick = () => openLevels(current);
  $('btn-levels-close').onclick = () => { if (mode === 'play') backToMenu(); else show('levels', false); };
  $('btn-merge').onclick = () => startMode('merge');
  $('btn-tiles').onclick = () => openLevels(tilesVariant);
  $('lv-tab-easy').onclick = () => openLevels('tiles');
  $('lv-tab-mj').onclick = () => openLevels('mahjong');
  $('btn-again').onclick = again;
  $('btn-menu').onclick = backToMenu;
  $('btn-home').onclick = (e) => { e.stopPropagation(); backToMenu(); };
  $('btn-share').onclick = shareScore;
  $('btn-clip').onclick = makeClip;
  $('btn-dex').onclick = openDex;
  $('btn-board').onclick = () => openBoard();
  $('btn-board-close').onclick = () => show('board', false);
  $('btn-board-save').onclick = () => saveBoardName($('board-input').value.trim());
  $('btn-board-hide').onclick = () => saveBoardName(null);
  $('board-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveBoardName($('board-input').value.trim()); }
    else if (e.key === 'Escape') { e.preventDefault(); $('board-input').blur(); show('board', false); }
  });
  $('btn-over-dex').onclick = openDex;
  $('btn-dex-close').onclick = () => show('dex', false);
  $('btn-clip-close').onclick = () => { if (!clipBusy) show('clip', false); };
  // audio menu: separate switches for background music and sound effects
  $('btn-sound').onclick = openAudio;
  $('btn-pause-sound').onclick = (e) => { e.stopPropagation(); openAudio(); };
  $('btn-audio-close').onclick = closeAudio;
  $('btn-tut-ok').onclick = closeTutorial;
  $('btn-howto').onclick = () => { closeAudio(); openTutorial(mode === 'play' ? current : 'tower'); };
  $('btn-music-toggle').onclick = () => {
    audio.init();
    audio.setMusicOn(!audio.musicOn);
    store.set('musicOn', audio.musicOn);
    if (audio.musicOn) ensureMusic();
    updateTitle();
  };
  $('btn-sfx-toggle').onclick = () => {
    audio.init();
    audio.setSfxOn(!audio.sfxOn);
    store.set('sfxOn', audio.sfxOn);
    if (audio.sfxOn) audio.play('tap');
    updateTitle();
  };

  window.addEventListener('pagehide', saveMerge);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveMerge();
    paused = document.hidden;
    if (audio.ctx) { if (paused) audio.ctx.suspend(); else audio.ctx.resume(); }
  });

  /* ---------- loop ---------- */
  const STEP = 1 / 60;
  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused && !menuPaused && game && !clipBusy) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 5) {
        game.step();
        acc -= STEP;
        n++;
        if (current === 'tower' && mode === 'play' && game.frame % 2 === 0 && (game.state === 'play' || game.t - game.overAt < 2.2)) {
          history.push(game.snapshot(true));
          if (history.length > 420) history.shift();
        }
      }
      if (n >= 5) acc = 0;
    }
    if (game) {
      if (current === 'tower') LT.Render.draw(ctx, game.snapshot(false), { scale, viewH, hud: mode === 'play' });
      else game.draw(ctx, { scale, viewH });
    }
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
    catchUpRewards();
    placeIcons();
    LT.Board.sync(bests()); // send any records made before the leaderboard existed
    applyLang();
    newTower(true);
    requestAnimationFrame(frame);
  }

  // Expose for debugging / automated tests.
  LT.app = {
    get game() { return game; }, get mode() { return mode; }, get current() { return current; },
    startMode, startPlay: () => startMode('tower'), backToMenu, get history() { return history; },
    toLogical, get viewH() { return viewH; },
  };
  boot();
})();
