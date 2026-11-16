/* Chacrinha Jiu-Jitsu: leaderboard UI. Vanilla JS, talks to /jiujitsu/api. */
(function () {
  'use strict';

  const API = '/jiujitsu/api';
  const ADMIN_NAME = 'Paloma';
  const BELTS = JJStats.BELTS;
  const BELT_COLORS = { white: '#f6f3ec', blue: '#2f5fb3', purple: '#6b3fa0', brown: '#7a4a26', black: '#26221f' };
  const FEED_STEP = 15;
  const MIN_PW = 4;
  const PHOTO_SIZE = 256;
  const Sound = window.JJSound;

  const state = {
    players: [],
    rolls: [],          // every roll, including pending ones
    me: null,           // {id, admin} from the server, when logged in
    token: null,
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
  state.token = recall('jj.token');
  // Old versions kept the chosen name and the admin password in the browser. Forget them.
  store('jj.me', null);
  store('jj.admin', null);

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function player(id) { return state.players.find((p) => p.id === id) || null; }
  function meId() { return state.me ? state.me.id : null; }
  function me() { return state.me ? player(state.me.id) : null; }
  function isAdmin() { return !!(state.me && state.me.admin); }
  function isAdminName(name) { return String(name).toLowerCase() === ADMIN_NAME.toLowerCase(); }
  function isPending(r) { return r.status === 'pending'; }
  function confirmedRolls() { return state.rolls.filter((r) => !isPending(r)); }
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
  function photoUrl(p) { return `${API}/players/${p.id}/photo?v=${p.photo_v}`; }

  function beltSvg(belt) {
    const color = BELT_COLORS[belt] || BELT_COLORS.white;
    const bar = belt === 'black' ? '#c0392b' : '#1f1b18';
    const stitch = belt === 'white' ? '#cfc6b6' : 'rgba(255,255,255,.35)';
    return `<svg class="belt" viewBox="0 0 80 20" role="img" aria-label="${beltName(belt)} belt">` +
      `<g filter="url(#rough)"><rect x="2" y="3" width="76" height="14" rx="2.5" fill="${color}" stroke="#2b2520" stroke-width="1.8"/>` +
      `<path d="M5 7.5 H50 M5 12.5 H50" stroke="${stitch}" stroke-width="1" stroke-dasharray="2 2"/>` +
      `<rect x="52" y="3" width="20" height="14" fill="${bar}" stroke="#2b2520" stroke-width="1.8"/></g></svg>`;
  }

  // Round, hand-drawn avatar: the photo, or the first letter on the belt color.
  function avatar(p, cls) {
    const c = 'avatar ' + (cls || '');
    if (p && p.photo_v > 0) return `<span class="${c}"><img src="${photoUrl(p)}" alt="" loading="lazy" decoding="async"></span>`;
    const letter = p ? Array.from(p.name.trim())[0] || '?' : '?';
    const belt = p ? p.belt : 'white';
    const dark = belt !== 'white';
    return `<span class="${c} letter" style="background:${BELT_COLORS[belt]};color:${dark ? '#fffdf6' : '#2b2520'}" aria-hidden="true">${esc(letter.toUpperCase())}</span>`;
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
    let payload;
    if (body instanceof Blob) {
      headers['content-type'] = body.type || 'application/octet-stream';
      payload = body;
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    if (state.token) headers.authorization = 'Bearer ' + state.token;
    let res;
    try {
      res = await fetch(API + path, { method, headers, body: payload, cache: 'no-store' });
    } catch (_) {
      throw Object.assign(new Error("Couldn't reach the server. Check your connection."), { status: 0 });
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* not JSON */ }
    if (!res.ok) {
      const msg = (data && data.error) || (res.status === 404 ? 'The leaderboard server is not deployed yet.' : `Server error (${res.status}).`);
      throw Object.assign(new Error(msg), { status: res.status, code: data && data.code });
    }
    return data || {};
  }

  async function load(quiet) {
    try {
      const data = await api('GET', '/state');
      state.players = data.players || [];
      state.rolls = data.rolls || [];
      state.adminConfigured = !!data.adminConfigured;
      state.me = data.me || null;
      if (state.token && !state.me) setToken(null); // expired, password changed, or deleted
      state.loadedAt = Date.now();
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

  function setToken(token) {
    state.token = token || null;
    store('jj.token', state.token);
    if (!token) state.me = null;
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
    else { renderPending(); renderBoard(); renderFeed(); }
  }

  function renderChip() {
    const chip = $('#me-chip');
    const m = me();
    chip.hidden = !m;
    if (!m) { chip.innerHTML = ''; return; }
    chip.innerHTML = `${avatar(m, 'tiny')}<span class="who">${esc(m.name)}</span>` +
      `<button class="link-btn" type="button" data-act="logout">log out</button>`;
  }

  function renderWho() {
    const q = $('#who-search').value.trim().toLowerCase();
    const list = $('#who-list');
    const people = state.players
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    list.innerHTML = people.length
      ? people.map((p) => `<button type="button" class="who-btn" data-id="${p.id}">${avatar(p, 'tiny')}<span>${esc(p.name)}</span>${beltSvg(p.belt)}</button>`).join('')
      : `<p class="muted">${q ? 'Nobody by that name yet. Sign up below!' : 'No one here yet. Be the first!'}</p>`;
  }

  function renderBoard() {
    const rolls = confirmedRolls();
    const rows = JJStats.table(state.players, rolls);
    const board = $('#board');
    const prevOrder = board.dataset.order || '';
    const order = rows.map((r) => r.player.id).join(',');
    const animate = prevOrder !== order;
    board.dataset.order = order;
    $('#board-count').textContent = `${rows.length} ${rows.length === 1 ? 'grappler' : 'grapplers'} · ${rolls.length} ${rolls.length === 1 ? 'roll' : 'rolls'}`;
    board.innerHTML = rows.map((r, i) => {
      const p = r.player;
      const streak = r.streak >= 3 ? `<span class="streak">${r.streak} wins in a row!</span>` : '';
      return `<li data-id="${p.id}" class="${p.id === meId() ? 'me' : ''} ${animate ? 'enter' : ''}" style="${animate ? `animation-delay:${Math.min(i, 12) * 35}ms` : ''}" tabindex="0" role="button" aria-label="${esc(p.name)}, ${r.rank ? `rank ${r.rank}` : 'no rolls yet'}, ${r.points} points">` +
        `<div class="rank">${r.rolls ? rankBadge(r.rank) : '<span class="muted" title="No rolls yet">–</span>'}</div>` +
        `<div class="pl">${avatar(p)}<div class="pl-text"><span class="name">${esc(p.name)}</span><span class="meta">${beltSvg(p.belt)}<span>${r.wins}W ${r.draws}D ${r.losses}L</span>${streak}</span></div></div>` +
        `<div class="pts"><b>${r.points}</b><span>pts</span></div></li>`;
    }).join('');
  }

  function beltOf(id) { const p = player(id); return p && p.belt; }
  function signed(n) { return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0'; }
  // "+5 / −4": points for the first and second name in the sentence.
  function deltaChip(r) {
    const d = JJStats.rollDelta(r, beltOf);
    const first = r.winner === r.b ? d.b : d.a, second = r.winner === r.b ? d.a : d.b;
    return ` <span class="delta" title="Points from this roll">${signed(first)} / ${signed(second)}</span>`;
  }
  function rollSentence(r) {
    const A = player(r.a), B = player(r.b);
    const an = `<b>${esc(A ? A.name : '?')}</b>`, bn = `<b>${esc(B ? B.name : '?')}</b>`;
    const how = r.method ? ` <span class="how">by ${esc(r.method.toLowerCase())}</span>` : '';
    const pts = deltaChip(r);
    if (r.winner == null) return `${an} and ${bn} drew${how}${pts}`;
    return r.winner === r.a ? `${an} beat ${bn}${how}${pts}` : `${bn} beat ${an}${how}${pts}`;
  }
  function plainSentence(r) {
    const tmp = document.createElement('div');
    tmp.innerHTML = rollSentence(r);
    return tmp.textContent;
  }

  // Pending rolls the logged-in player can act on.
  function pendingForMe() {
    const id = meId();
    return state.rolls.filter((r) => isPending(r) && (isAdmin() || r.a === id || r.b === id));
  }

  function renderPending() {
    const id = meId();
    const list = pendingForMe();
    $('#pending-card').hidden = !list.length;
    $('#pending').innerHTML = list.map((r) => {
      const mineToAnswer = (r.a === id || r.b === id) && r.by !== id;
      const loggedByMe = r.by === id;
      const by = player(r.by);
      let tools;
      if (mineToAnswer || isAdmin()) {
        tools = `<button class="btn small primary" type="button" data-act="accept">Accept</button>` +
          `<button class="btn small" type="button" data-act="reject">${loggedByMe ? 'Cancel' : 'Reject'}</button>`;
      } else {
        tools = `<button class="btn small" type="button" data-act="reject">Cancel</button>`;
      }
      const who = loggedByMe
        ? `Waiting for ${esc((player(r.a === id ? r.b : r.a) || {}).name || '?')} to confirm`
        : `${esc(by ? by.name : 'Someone')} says:`;
      return `<li data-id="${r.id}" class="pend"><span class="when">${esc(niceDate(r.date))}</span>` +
        `<span class="what"><span class="pend-who">${who}</span> ${rollSentence(r)}${r.note ? `<span class="note">"${esc(r.note)}"</span>` : ''}</span>` +
        `<span class="pend-tools">${tools}</span></li>`;
    }).join('');
  }

  function renderFeed() {
    const feed = $('#feed');
    const admin = isAdmin();
    const rolls = confirmedRolls();
    $('#admin-tag').hidden = !admin;
    const shown = rolls.slice(0, state.feedLimit);
    feed.innerHTML = shown.length ? shown.map((r) =>
      `<li data-id="${r.id}"><span class="when">${esc(niceDate(r.date))}</span>` +
      `<span class="what">${rollSentence(r)}${r.note ? `<span class="note">"${esc(r.note)}"</span>` : ''}</span>` +
      (admin ? `<span class="tools"><button class="tool" type="button" data-act="edit-roll" aria-label="Edit roll">&#9998;</button>` +
        `<button class="tool del" type="button" data-act="del-roll" aria-label="Delete roll">&#10005;</button></span>` : '') +
      `</li>`).join('')
      : '<li class="empty">No rolls yet. Go grab someone and slap hands!</li>';
    $('#more-btn').hidden = rolls.length <= state.feedLimit;
  }

  // ---------- belt picker ----------
  function setupPicker(el) {
    el.setAttribute('role', 'radiogroup');
    el.setAttribute('aria-label', 'Belt');
    el.innerHTML = BELTS.map((v) =>
      `<button type="button" class="belt-opt" role="radio" aria-checked="false" data-v="${v}">${beltSvg(v)}<span>${beltName(v)}</span></button>`).join('');
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
    // Keep a visible toast above the dialog's backdrop.
    const t = $('#toast');
    if (!t.hidden && t.showPopover) {
      try { if (t.matches(':popover-open')) t.hidePopover(); t.showPopover(); } catch (_) { /* ignore */ }
    }
  }
  function closeDlg(dlg) { if (dlg.open) dlg.close(); }
  function closeAllDialogs() { $$('dialog[open]').forEach((d) => d.close()); }

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

  function handleErr(ex, el) {
    Sound.play('error');
    if (ex.code === 'login_required' && state.token) {
      // Session is gone (password changed on another device, reset by the admin, or expired).
      setToken(null);
      closeAllDialogs();
      toast('Please log in again.', true);
      load(true);
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

  // ---------- login / signup ----------
  let loginId = null;
  function openLogin(p) {
    loginId = p.id;
    const claim = !p.has_pw && !isAdminName(p.name);
    $('#login-title').textContent = `Hi, ${p.name}!`;
    $('#login-hint').textContent = isAdminName(p.name)
      ? 'Admin profile: use the admin password.'
      : claim ? "You don't have a password yet. Choose one now; you'll use it from now on." : '';
    $('#login-hint').hidden = !$('#login-hint').textContent;
    $('#login-pw-label').textContent = claim ? 'New password (at least 4 characters)' : 'Password';
    $('#login-pw').autocomplete = claim ? 'new-password' : 'current-password';
    $('#login-pw2-wrap').hidden = !claim;
    $('#login-submit').textContent = claim ? 'Save and log in' : 'Log in';
    $('#login-pw').value = '';
    $('#login-pw2').value = '';
    $('#login-err').textContent = '';
    openDlg($('#login-dlg'));
    setTimeout(() => $('#login-pw').focus(), 30);
  }

  async function submitLogin(e) {
    e.preventDefault();
    const p = player(loginId);
    if (!p) return;
    const err = $('#login-err');
    const pw = $('#login-pw').value;
    const claim = !$('#login-pw2-wrap').hidden;
    if (!pw) { err.textContent = 'Type your password.'; Sound.play('error'); return; }
    if (claim) {
      if (pw.length < MIN_PW) { err.textContent = `Use at least ${MIN_PW} characters.`; Sound.play('error'); return; }
      if (pw !== $('#login-pw2').value) { err.textContent = "The two passwords don't match."; Sound.play('error'); return; }
    }
    const btn = $('#login-submit');
    btn.disabled = true;
    try {
      const data = await api('POST', '/login', { id: p.id, password: pw });
      setToken(data.token);
      closeDlg($('#login-dlg'));
      await load();
      if (data.admin) { Sound.play('gong'); toast(`Welcome back, ${p.name}! Admin mode on.`); }
      else { Sound.play('scribble'); toast(data.claimed ? `Password saved. Oss, ${p.name}!` : `Oss, ${p.name}!`); }
    } catch (ex) {
      handleErr(ex, err);
    } finally {
      btn.disabled = false;
    }
  }

  async function submitSignup(e) {
    e.preventDefault();
    const err = $('#signup-err');
    err.textContent = '';
    const name = $('#signup-name').value.trim();
    const pw = $('#signup-pw').value;
    if (!name) { err.textContent = 'Write your name first.'; Sound.play('error'); return; }
    const existing = state.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) { openLogin(existing); return; }
    if (pw.length < MIN_PW) { err.textContent = `Choose a password with at least ${MIN_PW} characters.`; Sound.play('error'); return; }
    if (pw !== $('#signup-pw2').value) { err.textContent = "The two passwords don't match."; Sound.play('error'); return; }
    const btn = $('#signup-form button[type=submit]');
    btn.disabled = true;
    try {
      const data = await api('POST', '/players', { name, belt: pickerValue('.belt-picker[data-for=signup]'), password: pw });
      setToken(data.token);
      $('#signup-form').reset();
      setPick($('.belt-picker[data-for=signup]'), 'white');
      Sound.play('gong');
      toast(`Welcome to the mat, ${data.player.name}! Tap your name to add a photo and bio.`);
      await load();
    } catch (ex) {
      handleErr(ex, err);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- rolls ----------
  let editingRollId = null;
  function fillSelect(sel, ids, placeholder, value) {
    const people = ids.map(player).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    sel.innerHTML = (placeholder ? `<option value="">${esc(placeholder)}</option>` : '') +
      people.map((p) => `<option value="${p.id}">${esc(p.name)} (${p.belt})</option>`).join('');
    sel.value = value ? String(value) : '';
  }
  function refreshRollLabels() {
    const a = Number($('#roll-a').value), b = Number($('#roll-b').value);
    const A = player(a), B = player(b);
    const mine = !editingRollId && a === meId();
    $('#a-label').textContent = mine ? 'You' : 'Player A';
    $('#b-label').textContent = mine ? 'Opponent' : 'Player B';
    $('#res-a').textContent = mine ? 'I won' : `${A ? A.name : 'A'} won`;
    $('#res-b').textContent = mine ? (B ? `${B.name} won` : 'They won') : `${B ? B.name : 'B'} won`;
    refreshPreview();
  }
  // "You'd get +5 · Bia ±0", shown while filling in the roll.
  function refreshPreview() {
    const a = Number($('#roll-a').value), b = Number($('#roll-b').value);
    const A = player(a), B = player(b);
    const result = ($('input[name=result]:checked') || {}).value;
    const out = $('#roll-preview');
    if (!A || !B || !result || editingRollId) { out.textContent = ''; out.hidden = true; return; }
    const d = JJStats.rollDelta({ a, b, winner: result === 'draw' ? null : result === 'a' ? a : b }, beltOf);
    out.hidden = false;
    out.textContent = a === meId()
      ? `You'd get ${signed(d.a)} · ${B.name} ${signed(d.b)}`
      : `${A.name} ${signed(d.a)} · ${B.name} ${signed(d.b)}`;
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
    $('#roll-form').reset();
    $('#roll-err').textContent = '';
    $('#roll-title').textContent = roll ? 'Fix this roll' : 'Log a roll';
    $('#roll-submit').textContent = roll ? 'Save changes' : isAdmin() ? 'Save roll' : 'Send for confirmation';
    const selA = $('#roll-a');
    fillSelect(selA, state.players.map((p) => p.id), null, roll ? roll.a : meId());
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
        const data = await api('POST', '/rolls', body);
        closeDlg($('#roll-dlg'));
        Sound.play('tap');
        if (data.roll && isPending(data.roll)) {
          const other = player(a === meId() ? b : a);
          toast(`Sent! It counts once ${other ? other.name : 'they'} accept${other ? 's' : ''}.`);
        } else {
          Sound.play('win');
          toast('Roll logged.');
        }
      }
      await load();
    } catch (ex) {
      handleErr(ex, err);
    } finally {
      btn.disabled = false;
    }
  }

  // Accept / reject / cancel a pending roll.
  async function answerRoll(roll, act) {
    const id = meId();
    try {
      if (act === 'accept') {
        await api('POST', `/rolls/${roll.id}/accept`);
        Sound.play('tap');
        const iWon = roll.winner === id;
        const inIt = roll.a === id || roll.b === id;
        if (roll.winner === null) { Sound.play('draw'); toast('Confirmed: a draw! Run it back next time.'); }
        else if (iWon) { Sound.play('win'); confetti(); toast('Confirmed. Victory! Oss!'); }
        else if (inIt) { Sound.play('lose'); toast('Confirmed. Tapping is learning. Oss!'); }
        else { Sound.play('win'); toast('Roll confirmed.'); }
      } else {
        const cancel = roll.by === id;
        const ok = await confirmBox(cancel ? 'Cancel this roll?' : 'Reject this roll?',
          `${plainSentence(roll)} (${niceDate(roll.date)}). It will be removed.`);
        if (!ok) return;
        await api('POST', `/rolls/${roll.id}/reject`);
        Sound.play('erase');
        toast(cancel ? 'Roll cancelled.' : 'Roll rejected.');
      }
      await load();
    } catch (ex) {
      handleErr(ex);
    }
  }

  // ---------- profile ----------
  let profileId = null;
  function openProfile(id) {
    const p = player(id);
    if (!p) return;
    profileId = id;
    const rolls = confirmedRolls();
    const rows = JJStats.table(state.players, rolls);
    const r = rows.find((x) => x.player.id === id);
    const mine = id === meId();
    const admin = isAdmin();
    const theirRolls = rolls.filter((x) => x.a === id || x.b === id);
    const rate = r.rolls ? Math.round((r.wins / r.rolls) * 100) : 0;
    let h2h = '';
    if (!mine && meId()) {
      const h = JJStats.headToHead(rolls, meId(), id);
      if (h.wins + h.draws + h.losses) h2h = `<p class="prof-line">You vs ${esc(p.name)}: <b>${h.wins}W ${h.draws}D ${h.losses}L</b></p>`;
      else h2h = `<p class="prof-line muted">You two haven't rolled yet. Fix that!</p>`;
    }
    const hist = theirRolls.map((x) => {
      const opp = player(x.a === id ? x.b : x.a);
      const res = x.winner == null ? '<span class="res d">D</span>' : x.winner === id ? '<span class="res w">W</span>' : '<span class="res l">L</span>';
      return `<li>${res}vs ${esc(opp ? opp.name : '?')}${x.method ? ` <span class="muted">· ${esc(x.method.toLowerCase())}</span>` : ''} <span class="muted">· ${esc(niceDate(x.date))}</span></li>`;
    }).join('');
    const actions = [];
    if (mine) {
      actions.push('<button class="btn small" type="button" data-act="edit-me">Edit profile</button>');
      if (!isAdminName(p.name)) actions.push('<button class="btn small" type="button" data-act="change-pw">Change password</button>');
    }
    if (admin && !mine) {
      actions.push('<button class="btn small" type="button" data-act="admin-edit-player">Edit profile</button>');
      actions.push('<button class="btn small" type="button" data-act="reset-pw">Reset password</button>');
      actions.push('<button class="btn small danger" type="button" data-act="del-player">Delete player</button>');
    }
    const photo = p.photo_v > 0
      ? `<figure class="polaroid"><img src="${photoUrl(p)}" alt="Photo of ${esc(p.name)}"></figure>`
      : '';
    const bio = p.bio
      ? `<p class="bio">${esc(p.bio).replace(/\n/g, '<br>')}</p>`
      : (mine ? '<p class="bio muted">No bio yet. Tap "Edit profile" to add a photo and a few words about you.</p>' : '');
    $('#player-body').innerHTML =
      `<div class="prof-top">${photo}<div class="prof-id">` +
      `<div class="prof-head"><h2>${esc(p.name)}</h2>${beltSvg(p.belt)}</div>` +
      `<p class="prof-line muted">${beltName(p.belt)} belt${r.rank ? ` · rank #${r.rank} of ${rows.filter((x) => x.rank).length}` : ' · no rolls yet'}${isAdminName(p.name) ? ' · admin' : ''}</p>` +
      bio + `</div></div>` +
      `<div class="statgrid"><div class="stat"><b>${r.points}</b><span>points</span></div><div class="stat"><b>${r.wins}</b><span>wins</span></div>` +
      `<div class="stat"><b>${r.draws}</b><span>draws</span></div><div class="stat"><b>${r.losses}</b><span>losses</span></div></div>` +
      (r.rolls ? `<p class="prof-line">Win rate: <b>${rate}%</b>${r.favorite ? ` · Favorite finish: <b>${esc(r.favorite.toLowerCase())}</b>` : ''}${r.streak >= 2 ? ` · On a <b>${r.streak}</b>-win streak` : ''}</p>` : '') +
      h2h +
      (actions.length ? `<div class="prof-actions">${actions.join('')}</div>` : '') +
      `<h3>Rolls</h3>` +
      (hist ? `<ul class="mini-feed">${hist}</ul>` : '<p class="muted">No rolls yet.</p>');
    openDlg($('#player-dlg'));
  }

  // Edit profile: self, or any player for the admin.
  let editPlayerId = null;
  let photoBlob = null;      // new photo waiting to be uploaded
  let photoRemove = false;   // remove the current photo on save
  let photoPreviewUrl = null;

  function paintPhotoPreview(p) {
    const box = $('#edit-photo-preview');
    if (photoPreviewUrl) { URL.revokeObjectURL(photoPreviewUrl); photoPreviewUrl = null; }
    if (photoBlob) {
      photoPreviewUrl = URL.createObjectURL(photoBlob);
      box.innerHTML = `<img src="${photoPreviewUrl}" alt="New photo">`;
    } else if (!photoRemove && p.photo_v > 0) {
      box.innerHTML = `<img src="${photoUrl(p)}" alt="Current photo">`;
    } else {
      box.innerHTML = avatar(Object.assign({}, p, { photo_v: 0 }), 'big');
    }
    $('#edit-photo-remove').hidden = !(photoBlob || (!photoRemove && p.photo_v > 0));
  }

  function openEditPlayer(id, adminMode) {
    const p = player(id);
    if (!p) return;
    editPlayerId = id;
    photoBlob = null;
    photoRemove = false;
    $('#edit-player-title').textContent = adminMode ? `Edit ${p.name}` : 'Edit profile';
    $('#rename-wrap').hidden = !adminMode;
    $('#edit-name').value = p.name;
    $('#edit-bio').value = p.bio || '';
    $('#edit-photo').value = '';
    updateBioCount();
    $('#edit-player-err').textContent = '';
    setPick($('.belt-picker[data-for=edit]'), p.belt);
    paintPhotoPreview(p);
    closeDlg($('#player-dlg'));
    openDlg($('#edit-player-dlg'));
  }
  function updateBioCount() {
    const n = $('#edit-bio').value.length;
    $('#edit-bio-count').textContent = `${n}/280`;
  }

  // Square-crop and shrink a picked photo in the browser (keeps uploads around 20 KB).
  async function shrinkPhoto(file) {
    let src;
    try {
      src = await createImageBitmap(file);
    } catch (_) {
      src = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Couldn't read that image. Try a JPEG or PNG."));
        img.src = URL.createObjectURL(file);
      });
    }
    const w = src.width, h = src.height;
    const side = Math.min(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PHOTO_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fffdf6';
    ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
    ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    if (src.close) src.close();
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process that image."))), 'image/jpeg', 0.85);
    });
  }

  async function submitEditPlayer(e) {
    e.preventDefault();
    const p = player(editPlayerId);
    if (!p) return;
    const err = $('#edit-player-err');
    err.textContent = '';
    const body = { belt: pickerValue('.belt-picker[data-for=edit]'), bio: $('#edit-bio').value };
    if (!$('#rename-wrap').hidden) {
      const name = $('#edit-name').value.trim();
      if (name !== p.name) body.name = name;
    }
    const btn = $('#edit-player-form button[type=submit]');
    btn.disabled = true;
    try {
      await api('PATCH', `/players/${p.id}`, body);
      if (photoBlob) await api('PUT', `/players/${p.id}/photo`, photoBlob);
      else if (photoRemove) await api('DELETE', `/players/${p.id}/photo`);
      closeDlg($('#edit-player-dlg'));
      const up = BELTS.indexOf(body.belt) > BELTS.indexOf(p.belt);
      if (up) { Sound.play('gong'); confetti(); toast(`Promoted! Congrats, ${body.name || p.name}! Oss!`); }
      else { Sound.play(photoBlob ? 'shutter' : 'scribble'); toast('Profile saved.'); }
      await load();
    } catch (ex) {
      handleErr(ex, err);
    } finally {
      btn.disabled = false;
    }
  }

  // Change your own password, or (admin) reset someone else's.
  let pwPlayerId = null;
  function openPassword(id, reset) {
    const p = player(id);
    if (!p) return;
    pwPlayerId = id;
    $('#pw-form').reset();
    $('#pw-err').textContent = '';
    $('#pw-title').textContent = reset ? `New password for ${p.name}` : 'Change password';
    $('#pw-current-wrap').hidden = reset;
    closeDlg($('#player-dlg'));
    openDlg($('#pw-dlg'));
    setTimeout(() => (reset ? $('#pw-new') : $('#pw-current')).focus(), 30);
  }

  async function submitPassword(e) {
    e.preventDefault();
    const p = player(pwPlayerId);
    if (!p) return;
    const err = $('#pw-err');
    const reset = $('#pw-current-wrap').hidden;
    const pw = $('#pw-new').value;
    if (!reset && !$('#pw-current').value) { err.textContent = 'Type your current password.'; Sound.play('error'); return; }
    if (pw.length < MIN_PW) { err.textContent = `Use at least ${MIN_PW} characters.`; Sound.play('error'); return; }
    if (pw !== $('#pw-new2').value) { err.textContent = "The two passwords don't match."; Sound.play('error'); return; }
    const btn = $('#pw-form button[type=submit]');
    btn.disabled = true;
    try {
      const body = { password: pw };
      if (!reset) body.currentPassword = $('#pw-current').value;
      const data = await api('PATCH', `/players/${p.id}`, body);
      if (data.token) setToken(data.token);
      closeDlg($('#pw-dlg'));
      Sound.play('scribble');
      toast(reset ? `${p.name}'s password was reset. Tell them the new one.` : 'Password changed.');
      await load(true);
    } catch (ex) {
      handleErr(ex, err);
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
    }, 3200);
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

    // Light/dark: shared with the rest of the site (/static/theme.js).
    const tb = $('#theme-btn');
    const Theme = window.SiteTheme;
    if (Theme) {
      const paintTheme = (dark) => {
        tb.innerHTML = Theme.icon(dark);
        tb.setAttribute('aria-label', Theme.label(dark));
        tb.title = Theme.label(dark);
      };
      paintTheme(Theme.isDark());
      Theme.onChange(paintTheme);
      tb.addEventListener('click', Theme.toggle);
    } else {
      tb.hidden = true;
    }

    // Pencil tick on every button press.
    document.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.btn, .who-btn, .tool, .link-btn, .board li, .result-pick span')) Sound.play('click');
    });

    $('#who-search').addEventListener('input', renderWho);
    $('#who-list').addEventListener('click', (e) => {
      const b = e.target.closest('.who-btn');
      if (b) openLogin(player(Number(b.dataset.id)));
    });
    $('#login-form').addEventListener('submit', submitLogin);

    setupPicker($('.belt-picker[data-for=signup]'));
    setupPicker($('.belt-picker[data-for=edit]'));
    setPick($('.belt-picker[data-for=signup]'), 'white');
    $('#signup-form').addEventListener('submit', submitSignup);

    $('#me-chip').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (b && b.dataset.act === 'logout') {
        try { await api('POST', '/logout'); } catch (_) { /* logging out locally is enough */ }
        setToken(null);
        Sound.play('erase');
        render();
      } else if (!b && me()) openProfile(meId());
    });

    $('#log-btn').addEventListener('click', () => {
      if (state.players.length < 2) { Sound.play('error'); toast('You need someone to roll with! Get a friend to sign up.', true); return; }
      openRoll(null);
    });
    $('#roll-a').addEventListener('change', refreshOpponents);
    $('#roll-b').addEventListener('change', refreshRollLabels);
    $('#roll-form').addEventListener('submit', submitRoll);
    $$('input[name=result]').forEach((i) => i.addEventListener('change', () => { Sound.play('scribble'); refreshPreview(); }));

    $('#pending').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const roll = state.rolls.find((r) => r.id === Number(b.closest('li').dataset.id));
      if (roll) answerRoll(roll, b.dataset.act);
    });

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
        if (!(await confirmBox('Delete this roll?', `${plainSentence(roll)} (${niceDate(roll.date)}). Points will be recalculated.`))) return;
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
      const act = b.dataset.act;
      if (act === 'edit-me') openEditPlayer(p.id, false);
      if (act === 'admin-edit-player') openEditPlayer(p.id, true);
      if (act === 'change-pw') openPassword(p.id, false);
      if (act === 'reset-pw') openPassword(p.id, true);
      if (act === 'del-player') {
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
    $('#edit-bio').addEventListener('input', updateBioCount);
    $('#edit-photo').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      $('#edit-player-err').textContent = '';
      try {
        photoBlob = await shrinkPhoto(file);
        photoRemove = false;
        Sound.play('shutter');
      } catch (ex) {
        photoBlob = null;
        Sound.play('error');
        $('#edit-player-err').textContent = ex.message;
      }
      paintPhotoPreview(player(editPlayerId));
    });
    $('#edit-photo-remove').addEventListener('click', () => {
      photoBlob = null;
      photoRemove = true;
      $('#edit-photo').value = '';
      Sound.play('erase');
      paintPhotoPreview(player(editPlayerId));
    });

    $('#pw-form').addEventListener('submit', submitPassword);

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
