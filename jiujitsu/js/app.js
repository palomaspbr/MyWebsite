/* Chacrinha Jiu-Jitsu: leaderboard UI. Vanilla JS, talks to /jiujitsu/api. */
(function () {
  'use strict';

  const API = '/jiujitsu/api';
  const ADMIN_NAME = 'Paloma';
  const BELTS = JJStats.BELTS;
  const BELT_COLORS = { white: '#f6f3ec', blue: '#2f5fb3', purple: '#6b3fa0', brown: '#7a4a26', black: '#26221f' };
  const FEED_STEP = 15;
  const Sound = window.JJSound;

  const state = {
    players: [],
    rolls: [],
    meId: null,
    adminPw: null,
    adminConfigured: false,
    feedLimit: FEED_STEP,
    loadedAt: 0,
    firstLoad: true,
  };

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  // ---------- storage ----------
  function store(key, val) {
    try { if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, String(val)); } catch (_) { /* ignore */ }
  }
  function recall(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  state.meId = Number(recall('jj.me')) || null;
  state.adminPw = recall('jj.admin');

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function player(id) { return state.players.find((p) => p.id === id) || null; }
  function me() { return state.meId ? player(state.meId) : null; }
  function isAdminName(name) { return String(name).toLowerCase() === ADMIN_NAME.toLowerCase(); }
  function isAdmin() { const m = me(); return !!(m && isAdminName(m.name) && state.adminPw); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function niceDate(iso) {
    const today = todayISO();
    if (iso === today) return 'today';
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (iso === `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`) return 'yesterday';
    const d = new Date(iso + 'T12:00:00');
    const opts = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = '2-digit';
    return d.toLocaleDateString('en-US', opts);
  }
  function beltName(b) { return b.charAt(0).toUpperCase() + b.slice(1); }

  function beltSvg(belt, stripes) {
    const color = BELT_COLORS[belt] || BELT_COLORS.white;
    const bar = belt === 'black' ? '#c0392b' : '#1f1b18';
    let tape = '';
    for (let i = 0; i < (stripes || 0); i++) tape += `<rect x="${55 + i * 4.2}" y="3.5" width="2.2" height="13" fill="#fff"/>`;
    const stitch = belt === 'white' ? '#cfc6b6' : 'rgba(255,255,255,.35)';
    return `<svg class="belt" viewBox="0 0 80 20" role="img" aria-label="${beltName(belt)} belt${stripes ? `, ${stripes} stripe${stripes > 1 ? 's' : ''}` : ''}">` +
      `<g filter="url(#rough)"><rect x="2" y="3" width="76" height="14" rx="2.5" fill="${color}" stroke="#2b2520" stroke-width="1.8"/>` +
      `<path d="M5 7.5 H50 M5 12.5 H50" stroke="${stitch}" stroke-width="1" stroke-dasharray="2 2"/>` +
      `<rect x="52" y="3" width="20" height="14" fill="${bar}" stroke="#2b2520" stroke-width="1.8"/>${tape}</g></svg>`;
  }

  function rankBadge(rank) {
    if (rank === 1) {
      return `<svg viewBox="0 0 44 44" role="img" aria-label="1st"><g filter="url(#rough)" stroke="#2b2520" stroke-width="2.4" stroke-linejoin="round">` +
        `<path d="M6 32 L4 12 L14 20 L22 6 L30 20 L40 12 L38 32 Z" fill="#e9b949"/><path d="M6 32 H38 V38 H6 Z" fill="#e9b949"/>` +
        `<circle cx="22" cy="6" r="2.5" fill="#c0392b"/></g><text x="22" y="30" text-anchor="middle" font-family="Caveat Brush, cursive" font-size="15" fill="#2b2520">1</text></svg>`;
    }
    if (rank === 2 || rank === 3) {
      const fill = rank === 2 ? '#b8bcc4' : '#c98a4b';
      return `<svg viewBox="0 0 44 44" role="img" aria-label="${rank === 2 ? '2nd' : '3rd'}"><g filter="url(#rough)" stroke="#2b2520" stroke-width="2.4" stroke-linejoin="round">` +
        `<path d="M14 2 L20 16 M30 2 L24 16" stroke-width="4"/>` +
        `<circle cx="22" cy="27" r="13" fill="${fill}"/></g>` +
        `<text x="22" y="33" text-anchor="middle" font-family="Caveat Brush, cursive" font-size="18" fill="#2b2520">${rank}</text></svg>`;
    }
    return `<span>${rank}</span>`;
  }

  function soundIcon(on) {
    const waves = on
      ? '<path d="M24 14 Q29 20 24 26 M28 10 Q36 20 28 30" fill="none"/>'
      : '<path d="M24 14 L34 26 M34 14 L24 26"/>';
    return `<svg viewBox="0 0 40 40" aria-hidden="true"><g filter="url(#rough)" stroke="#2b2520" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="M6 16 H12 L20 9 V31 L12 24 H6 Z" fill="#fff2a8"/>${waves}</g></svg>`;
  }

  // ---------- network ----------
  async function api(method, path, body, opts) {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const pw = opts && opts.password !== undefined ? opts.password : state.adminPw;
    if (pw && isAdminSession(opts)) headers['x-admin-password'] = pw;
    let res;
    try {
      res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch (_) {
      throw Object.assign(new Error("Couldn't reach the server. Check your connection."), { status: 0 });
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* not JSON */ }
    if (!res.ok) {
      const msg = (data && data.error) || (res.status === 404 ? 'The leaderboard server is not deployed yet.' : `Server error (${res.status}).`);
      throw Object.assign(new Error(msg), { status: res.status });
    }
    return data || {};
  }
  function isAdminSession(opts) { return (opts && opts.password !== undefined) || isAdmin(); }

  async function load(quiet) {
    try {
      const data = await api('GET', '/state');
      state.players = data.players || [];
      state.rolls = data.rolls || [];
      state.adminConfigured = !!data.adminConfigured;
      state.loadedAt = Date.now();
      if (state.meId && !me()) setMe(null);
      if (me() && isAdminName(me().name) && !state.adminPw) setMe(null);
      $('#banner').hidden = true;
      render();
    } catch (err) {
      $('#loading').hidden = true;
      if (!quiet || state.firstLoad) {
        const b = $('#banner');
        b.hidden = false;
        b.textContent = err.status === 503
          ? `The leaderboard isn't hooked up to its database yet. ${err.message}`
          : err.message;
      }
    }
  }

  // ---------- identity ----------
  function setMe(id, adminPw) {
    state.meId = id;
    store('jj.me', id);
    if (adminPw !== undefined) { state.adminPw = adminPw; store('jj.admin', adminPw); }
    if (!id) { state.adminPw = null; store('jj.admin', null); }
  }

  function pickMe(p) {
    if (isAdminName(p.name)) {
      openAdmin((pw) => { setMe(p.id, pw); render(); toast(`Welcome back, ${p.name}! Admin mode on.`); Sound.play('gong'); });
      return;
    }
    setMe(p.id);
    Sound.play('scribble');
    render();
    toast(`Oss, ${p.name}!`);
  }

  // ---------- rendering ----------
  function render() {
    $('#loading').hidden = true;
    state.firstLoad = false;
    const m = me();
    $('#welcome').hidden = !!m;
    $('#board-wrap').hidden = !m;
    renderChip();
    if (!m) renderWho();
    else { renderBoard(); renderFeed(); }
  }

  function renderChip() {
    const chip = $('#me-chip');
    const m = me();
    chip.hidden = !m;
    if (!m) { chip.innerHTML = ''; return; }
    chip.innerHTML = `${beltSvg(m.belt, m.stripes)}<span class="who">${esc(m.name)}</span>` +
      `<button class="link-btn" type="button" data-act="switch">switch</button>`;
  }

  function renderWho() {
    const q = $('#who-search').value.trim().toLowerCase();
    const list = $('#who-list');
    const people = state.players
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    list.innerHTML = people.length
      ? people.map((p) => `<button type="button" class="who-btn" data-id="${p.id}">${beltSvg(p.belt, p.stripes)}<span>${esc(p.name)}</span></button>`).join('')
      : `<p class="muted">${q ? 'Nobody by that name yet. Sign up below!' : 'No one here yet. Be the first!'}</p>`;
  }

  function renderBoard() {
    const rows = JJStats.table(state.players, state.rolls);
    const board = $('#board');
    const prevOrder = board.dataset.order || '';
    const order = rows.map((r) => r.player.id).join(',');
    const animate = prevOrder !== order;
    board.dataset.order = order;
    $('#board-count').textContent = `${rows.length} ${rows.length === 1 ? 'grappler' : 'grapplers'} · ${state.rolls.length} ${state.rolls.length === 1 ? 'roll' : 'rolls'}`;
    board.innerHTML = rows.map((r, i) => {
      const p = r.player;
      const streak = r.streak >= 3 ? `<span class="streak">${r.streak} wins in a row!</span>` : '';
      return `<li data-id="${p.id}" class="${p.id === state.meId ? 'me' : ''} ${animate ? 'enter' : ''}" style="${animate ? `animation-delay:${Math.min(i, 12) * 35}ms` : ''}" tabindex="0" role="button" aria-label="${esc(p.name)}, rank ${r.rank}, ${r.points} points">` +
        `<div class="rank">${r.rolls ? rankBadge(r.rank) : '<span class="muted" title="No rolls yet">–</span>'}</div>` +
        `<div class="pl"><span class="name">${esc(p.name)}</span><span class="meta">${beltSvg(p.belt, p.stripes)}<span>${r.wins}W ${r.draws}D ${r.losses}L</span>${streak}</span></div>` +
        `<div class="pts"><b>${r.points}</b><span>pts</span></div></li>`;
    }).join('');
  }

  function rollSentence(r) {
    const A = player(r.a), B = player(r.b);
    const an = `<b>${esc(A ? A.name : '?')}</b>`, bn = `<b>${esc(B ? B.name : '?')}</b>`;
    const how = r.method ? ` <span class="how">by ${esc(r.method.toLowerCase())}</span>` : '';
    if (r.winner == null) return `${an} and ${bn} drew${how}`;
    return r.winner === r.a ? `${an} beat ${bn}${how}` : `${bn} beat ${an}${how}`;
  }

  function renderFeed() {
    const feed = $('#feed');
    const admin = isAdmin();
    $('#admin-tag').hidden = !admin;
    const shown = state.rolls.slice(0, state.feedLimit);
    feed.innerHTML = shown.length ? shown.map((r) =>
      `<li data-id="${r.id}"><span class="when">${esc(niceDate(r.date))}</span>` +
      `<span class="what">${rollSentence(r)}${r.note ? `<span class="note">"${esc(r.note)}"</span>` : ''}</span>` +
      (admin ? `<span class="tools"><button class="tool" type="button" data-act="edit-roll" aria-label="Edit roll">&#9998;</button>` +
        `<button class="tool del" type="button" data-act="del-roll" aria-label="Delete roll">&#10005;</button></span>` : '') +
      `</li>`).join('')
      : '<li class="empty">No rolls yet. Go grab someone and slap hands!</li>';
    $('#more-btn').hidden = state.rolls.length <= state.feedLimit;
  }

  // ---------- belt + stripe pickers ----------
  function setupPicker(el, kind) {
    el.setAttribute('role', 'radiogroup');
    el.setAttribute('aria-label', kind === 'belt' ? 'Belt' : 'Stripes');
    const opts = kind === 'belt' ? BELTS : [0, 1, 2, 3, 4];
    el.innerHTML = opts.map((v) => kind === 'belt'
      ? `<button type="button" class="belt-opt" role="radio" aria-checked="false" data-v="${v}">${beltSvg(v, 0)}<span>${beltName(v)}</span></button>`
      : `<button type="button" class="stripe-opt" role="radio" aria-checked="false" data-v="${v}">${v}</button>`).join('');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      setPick(el, b.dataset.v);
      Sound.play('scribble');
    });
    el.addEventListener('keydown', (e) => {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!(e.key in keys)) return;
      e.preventDefault();
      const opts = $$('[data-v]', el);
      const i = opts.findIndex((b) => b.dataset.v === el.dataset.value);
      const next = opts[(i + keys[e.key] + opts.length) % opts.length];
      setPick(el, next.dataset.v);
      next.focus();
      Sound.play('scribble');
    });
  }
  function setPick(el, v) {
    el.dataset.value = String(v);
    $$('[data-v]', el).forEach((b) => {
      const on = b.dataset.v === String(v);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }
  function pickerValue(sel) { return $(sel).dataset.value; }

  // ---------- dialogs ----------
  function openDlg(dlg) {
    if (!dlg.open) dlg.showModal();
    Sound.play('open');
  }
  function closeDlg(dlg) { if (dlg.open) dlg.close(); }

  function confirmBox(title, text) {
    const dlg = $('#confirm-dlg');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    dlg.returnValue = '';
    openDlg(dlg);
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true });
    });
  }

  let adminCallback = null;
  function openAdmin(cb) {
    adminCallback = cb;
    $('#admin-pw').value = '';
    $('#admin-err').textContent = state.adminConfigured ? '' : 'Heads up: no admin password is set on the server yet.';
    openDlg($('#admin-dlg'));
    setTimeout(() => $('#admin-pw').focus(), 30);
  }

  // Roll dialog: create (rollId null) or admin edit.
  let editingRollId = null;
  function fillSelect(sel, ids, placeholder, value) {
    const people = ids.map(player).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    sel.innerHTML = (placeholder ? `<option value="">${esc(placeholder)}</option>` : '') +
      people.map((p) => `<option value="${p.id}">${esc(p.name)} (${p.belt}${p.stripes ? ', ' + p.stripes + 's' : ''})</option>`).join('');
    sel.value = value ? String(value) : '';
  }
  function refreshRollLabels() {
    const a = Number($('#roll-a').value), b = Number($('#roll-b').value);
    const A = player(a), B = player(b);
    const mine = !editingRollId && a === state.meId;
    $('#a-label').textContent = mine ? 'You' : 'Player A';
    $('#b-label').textContent = mine ? 'Opponent' : 'Player B';
    $('#res-a').textContent = mine ? 'I won' : `${A ? A.name : 'A'} won`;
    $('#res-b').textContent = mine ? (B ? `${B.name} won` : 'They won') : `${B ? B.name : 'B'} won`;
  }
  function refreshOpponents() {
    const a = Number($('#roll-a').value);
    const sel = $('#roll-b');
    const keep = Number(sel.value);
    fillSelect(sel, state.players.map((p) => p.id).filter((id) => id !== a), 'Pick someone...', keep !== a ? keep : null);
    refreshRollLabels();
  }

  function openRoll(roll) {
    editingRollId = roll ? roll.id : null;
    const form = $('#roll-form');
    form.reset();
    $('#roll-err').textContent = '';
    $('#roll-title').textContent = roll ? 'Fix this roll' : 'Log a roll';
    $('#roll-submit').textContent = roll ? 'Save changes' : 'Save roll';
    const selA = $('#roll-a');
    fillSelect(selA, state.players.map((p) => p.id), null, roll ? roll.a : state.meId);
    selA.disabled = !isAdmin();
    refreshOpponents();
    if (roll) $('#roll-b').value = String(roll.b);
    refreshRollLabels();
    const result = roll ? (roll.winner == null ? 'draw' : roll.winner === roll.a ? 'a' : 'b') : null;
    $$('input[name=result]').forEach((i) => { i.checked = i.value === result; });
    $('#roll-method').value = roll ? roll.method : '';
    $('#roll-note').value = roll ? roll.note : '';
    $('#roll-date').max = todayISO();
    $('#roll-date').value = roll ? roll.date : todayISO();
    openDlg($('#roll-dlg'));
  }

  async function submitRoll(e) {
    e.preventDefault();
    const err = $('#roll-err');
    err.textContent = '';
    const a = Number($('#roll-a').value), b = Number($('#roll-b').value);
    const result = ($('input[name=result]:checked') || {}).value;
    if (!b) { err.textContent = 'Who did you roll with?'; Sound.play('error'); return; }
    if (!result) { err.textContent = 'Who won? (Draws count too.)'; Sound.play('error'); return; }
    if (!$('#roll-date').value) { err.textContent = 'When was it?'; Sound.play('error'); return; }
    const body = {
      a, b,
      winner: result === 'draw' ? null : result === 'a' ? a : b,
      method: $('#roll-method').value.trim(),
      note: $('#roll-note').value.trim(),
      date: $('#roll-date').value,
    };
    const btn = $('#roll-submit');
    btn.disabled = true;
    try {
      if (editingRollId) {
        await api('PATCH', `/rolls/${editingRollId}`, body);
        closeDlg($('#roll-dlg'));
        Sound.play('scribble');
        toast('Roll fixed.');
      } else {
        body.by = state.meId;
        await api('POST', '/rolls', body);
        closeDlg($('#roll-dlg'));
        Sound.play('tap');
        const iWon = body.winner === state.meId;
        const iLost = body.winner !== null && (a === state.meId || b === state.meId) && !iWon;
        if (body.winner === null) { Sound.play('draw'); toast('A draw! Run it back next time.'); }
        else if (iWon) { Sound.play('win'); confetti(); toast('Tap, tap! Victory logged. Oss!'); }
        else if (iLost) { Sound.play('lose'); toast("Logged. Tapping is learning. Oss!"); }
        else { Sound.play('win'); toast('Roll logged.'); }
      }
      await load();
    } catch (ex) {
      handleErr(ex, err);
    } finally {
      btn.disabled = false;
    }
  }

  function handleErr(ex, el) {
    Sound.play('error');
    if (ex.status === 401 && isAdmin()) {
      setMe(null);
      render();
      closeAllDialogs();
      toast('Admin password changed or expired. Pick Paloma again to log in.', true);
      return;
    }
    if (el) el.textContent = ex.message;
    else toast(ex.message, true);
    // Someone else changed the board (name taken, player deleted...): refresh our copy.
    if (ex.status === 404 || ex.status === 409) {
      load(true).then(() => {
        if ($('#roll-dlg').open && !editingRollId) refreshOpponents();
      });
    }
  }
  function closeAllDialogs() { $$('dialog[open]').forEach((d) => d.close()); }

  // Player profile.
  let profileId = null;
  function openProfile(id) {
    const p = player(id);
    if (!p) return;
    profileId = id;
    const rows = JJStats.table(state.players, state.rolls);
    const r = rows.find((x) => x.player.id === id);
    const mine = id === state.meId;
    const admin = isAdmin();
    const theirRolls = state.rolls.filter((x) => x.a === id || x.b === id);
    const rate = r.rolls ? Math.round((r.wins / r.rolls) * 100) : 0;
    let h2h = '';
    if (!mine && state.meId) {
      const h = JJStats.headToHead(state.rolls, state.meId, id);
      if (h.wins + h.draws + h.losses) h2h = `<p class="prof-line">You vs ${esc(p.name)}: <b>${h.wins}W ${h.draws}D ${h.losses}L</b></p>`;
      else h2h = `<p class="prof-line muted">You two haven't rolled yet. Fix that!</p>`;
    }
    const hist = theirRolls.map((x) => {
      const opp = player(x.a === id ? x.b : x.a);
      const res = x.winner == null ? '<span class="res d">D</span>' : x.winner === id ? '<span class="res w">W</span>' : '<span class="res l">L</span>';
      return `<li>${res}vs ${esc(opp ? opp.name : '?')}${x.method ? ` <span class="muted">· ${esc(x.method.toLowerCase())}</span>` : ''} <span class="muted">· ${esc(niceDate(x.date))}</span></li>`;
    }).join('');
    const actions = [];
    if (mine) actions.push('<button class="btn small" type="button" data-act="edit-me">Change my belt</button>');
    if (admin && !mine) {
      actions.push('<button class="btn small" type="button" data-act="admin-edit-player">Edit name / belt</button>');
      actions.push('<button class="btn small danger" type="button" data-act="del-player">Delete player</button>');
    }
    $('#player-body').innerHTML =
      `<div class="prof-head"><h2>${esc(p.name)}</h2>${beltSvg(p.belt, p.stripes)}</div>` +
      `<p class="prof-line muted">${beltName(p.belt)} belt${p.stripes ? `, ${p.stripes} stripe${p.stripes > 1 ? 's' : ''}` : ''} · rank #${r.rank} of ${rows.length}${isAdminName(p.name) ? ' · admin' : ''}</p>` +
      `<div class="statgrid"><div class="stat"><b>${r.points}</b><span>points</span></div><div class="stat"><b>${r.wins}</b><span>wins</span></div>` +
      `<div class="stat"><b>${r.draws}</b><span>draws</span></div><div class="stat"><b>${r.losses}</b><span>losses</span></div></div>` +
      (r.rolls ? `<p class="prof-line">Win rate: <b>${rate}%</b>${r.favorite ? ` · Favorite finish: <b>${esc(r.favorite.toLowerCase())}</b>` : ''}${r.streak >= 2 ? ` · On a <b>${r.streak}</b>-win streak` : ''}</p>` : '') +
      h2h +
      (actions.length ? `<div class="prof-actions">${actions.join('')}</div>` : '') +
      `<h3>Rolls</h3>` +
      (hist ? `<ul class="mini-feed">${hist}</ul>` : '<p class="muted">No rolls yet.</p>');
    openDlg($('#player-dlg'));
  }

  // Change belt (self) or admin edit.
  let editPlayerId = null;
  function openEditPlayer(id, adminMode) {
    const p = player(id);
    if (!p) return;
    editPlayerId = id;
    $('#edit-player-title').textContent = adminMode ? `Edit ${p.name}` : 'Got promoted?';
    $('#rename-wrap').hidden = !adminMode;
    $('#edit-name').value = p.name;
    $('#edit-player-err').textContent = '';
    setPick($('.belt-picker[data-for=edit]'), p.belt);
    setPick($('.stripe-picker[data-for=edit]'), p.stripes);
    closeDlg($('#player-dlg'));
    openDlg($('#edit-player-dlg'));
  }

  async function submitEditPlayer(e) {
    e.preventDefault();
    const p = player(editPlayerId);
    if (!p) return;
    const body = {
      belt: pickerValue('.belt-picker[data-for=edit]'),
      stripes: Number(pickerValue('.stripe-picker[data-for=edit]')),
    };
    if (!$('#rename-wrap').hidden) {
      const name = $('#edit-name').value.trim();
      if (name !== p.name) body.name = name;
    }
    const btn = $('#edit-player-form button[type=submit]');
    btn.disabled = true;
    try {
      await api('PATCH', `/players/${p.id}`, body);
      closeDlg($('#edit-player-dlg'));
      const up = BELTS.indexOf(body.belt) > BELTS.indexOf(p.belt) || (body.belt === p.belt && body.stripes > p.stripes);
      if (up) { Sound.play('gong'); confetti(); toast(`Promoted! Congrats, ${body.name || p.name}! Oss!`); }
      else { Sound.play('scribble'); toast('Saved.'); }
      await load();
    } catch (ex) {
      handleErr(ex, $('#edit-player-err'));
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- toast & confetti ----------
  let toastTimer = null;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('err', !!isErr);
    t.hidden = false;
    if (t.showPopover) {
      try { if (t.matches(':popover-open')) t.hidePopover(); t.showPopover(); } catch (_) { /* old browser */ }
    }
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (t.hidePopover) { try { t.hidePopover(); } catch (_) { /* ignore */ } }
      t.hidden = true;
    }, 2800);
  }

  function confetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#e9b949', '#2f5fb3', '#6b3fa0', '#c0392b', '#2e8b57', '#fff2a8', '#7a4a26'];
    for (let i = 0; i < 36; i++) {
      const c = document.createElement('span');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
      c.style.setProperty('--rot', (Math.random() * 900 - 450) + 'deg');
      c.style.animationDuration = (1.4 + Math.random() * 1.2) + 's';
      c.style.animationDelay = (Math.random() * 0.3) + 's';
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 3200);
    }
  }

  // ---------- events ----------
  function bind() {
    const sb = $('#sound-btn');
    const paintSound = () => {
      sb.innerHTML = soundIcon(Sound.enabled);
      sb.setAttribute('aria-label', Sound.enabled ? 'Sound on' : 'Sound off');
      sb.setAttribute('aria-pressed', String(Sound.enabled));
    };
    paintSound();
    sb.addEventListener('click', () => { Sound.toggle(); paintSound(); });

    // Pencil tick on every button press.
    document.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.btn, .who-btn, .tool, .link-btn, .board li, .result-pick span')) Sound.play('click');
    });

    $('#who-search').addEventListener('input', renderWho);
    $('#who-list').addEventListener('click', (e) => {
      const b = e.target.closest('.who-btn');
      if (b) pickMe(player(Number(b.dataset.id)));
    });

    setupPicker($('.belt-picker[data-for=signup]'), 'belt');
    setupPicker($('.stripe-picker[data-for=signup]'), 'stripes');
    setupPicker($('.belt-picker[data-for=edit]'), 'belt');
    setupPicker($('.stripe-picker[data-for=edit]'), 'stripes');
    setPick($('.belt-picker[data-for=signup]'), 'white');
    setPick($('.stripe-picker[data-for=signup]'), 0);

    $('#signup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#signup-name').value.trim();
      if (!name) { Sound.play('error'); toast('Write your name first.', true); return; }
      const existing = state.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (existing) { pickMe(existing); return; }
      const btn = $('#signup-form button[type=submit]');
      btn.disabled = true;
      try {
        const data = await api('POST', '/players', {
          name,
          belt: pickerValue('.belt-picker[data-for=signup]'),
          stripes: Number(pickerValue('.stripe-picker[data-for=signup]')),
        });
        setMe(data.player.id);
        $('#signup-name').value = '';
        Sound.play('gong');
        toast(`Welcome to the mat, ${data.player.name}! Oss!`);
        await load();
      } catch (ex) {
        handleErr(ex);
      } finally {
        btn.disabled = false;
      }
    });

    $('#me-chip').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b && b.dataset.act === 'switch') { setMe(null); Sound.play('erase'); render(); }
      else if (!b && me()) openProfile(state.meId);
    });

    $('#log-btn').addEventListener('click', () => {
      if (state.players.length < 2) { Sound.play('error'); toast('You need someone to roll with! Get a friend to sign up.', true); return; }
      openRoll(null);
    });
    $('#roll-a').addEventListener('change', refreshOpponents);
    $('#roll-b').addEventListener('change', refreshRollLabels);
    $('#roll-form').addEventListener('submit', submitRoll);
    $$('input[name=result]').forEach((i) => i.addEventListener('change', () => Sound.play('scribble')));

    $('#board').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (li) openProfile(Number(li.dataset.id));
    });
    $('#board').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const li = e.target.closest('li[data-id]');
      if (li) { e.preventDefault(); openProfile(Number(li.dataset.id)); }
    });

    $('#feed').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = Number(b.closest('li').dataset.id);
      const roll = state.rolls.find((r) => r.id === id);
      if (!roll) return;
      if (b.dataset.act === 'edit-roll') openRoll(roll);
      if (b.dataset.act === 'del-roll') {
        const tmp = document.createElement('div');
        tmp.innerHTML = rollSentence(roll);
        if (!(await confirmBox('Delete this roll?', `${tmp.textContent} (${niceDate(roll.date)}). Points will be recalculated.`))) return;
        try {
          await api('DELETE', `/rolls/${id}`);
          Sound.play('erase');
          toast('Roll erased.');
          await load();
        } catch (ex) { handleErr(ex); }
      }
    });
    $('#more-btn').addEventListener('click', () => { state.feedLimit += FEED_STEP; renderFeed(); });

    $('#player-dlg').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const p = player(profileId);
      if (!p) return;
      if (b.dataset.act === 'edit-me') openEditPlayer(p.id, false);
      if (b.dataset.act === 'admin-edit-player') openEditPlayer(p.id, true);
      if (b.dataset.act === 'del-player') {
        closeDlg($('#player-dlg'));
        const n = state.rolls.filter((r) => r.a === p.id || r.b === p.id).length;
        if (!(await confirmBox(`Delete ${p.name}?`, `This also deletes their ${n} roll${n === 1 ? '' : 's'}. No undo.`))) return;
        try {
          await api('DELETE', `/players/${p.id}`);
          Sound.play('erase');
          toast(`${p.name} was erased from the board.`);
          await load();
        } catch (ex) { handleErr(ex); }
      }
    });
    $('#edit-player-form').addEventListener('submit', submitEditPlayer);

    $('#admin-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = $('#admin-pw').value;
      const btn = $('#admin-form button[type=submit]');
      btn.disabled = true;
      try {
        await api('POST', '/admin/login', { password: pw }, { password: pw });
        closeDlg($('#admin-dlg'));
        if (adminCallback) adminCallback(pw);
        adminCallback = null;
      } catch (ex) {
        Sound.play('error');
        $('#admin-err').textContent = ex.message;
      } finally {
        btn.disabled = false;
      }
    });

    // Close buttons and backdrop clicks.
    $$('dialog').forEach((d) => {
      d.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) { d.close(); return; }
        if (e.target === d) {
          const r = d.getBoundingClientRect();
          const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          if (!inside) d.close();
        }
      });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - state.loadedAt > 20000) load(true);
    });
  }

  bind();
  load();
})();
