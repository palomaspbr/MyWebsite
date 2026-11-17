/* Leaderboard client: per-device profile id, best-score sync and API calls (worker/loaf.js).
   The device id is a random UUID kept in localStorage; no personal data is sent. Scores are always
   saved privately; they only show on the public leaderboard once the player picks a name. */
(function () {
  'use strict';
  const LT = window.LT;
  const API = '/loaf_tower/api';
  const KEY = 'lt.device', PKEY = 'lt.boardProfile', RKEY = 'lt.resetSeen';
  const TIMEOUT = 6000;
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  };

  let device = null; // kept in memory too, so a browser that blocks storage still has one id per visit
  function deviceId() {
    if (device) return device;
    const d = ls.get(KEY);
    if (typeof d === 'string' && d.length >= 16) return (device = d);
    if (window.crypto && crypto.randomUUID) device = crypto.randomUUID();
    else { device = ''; for (let i = 0; i < 32; i++) device += Math.floor(Math.random() * 16).toString(16); }
    ls.set(KEY, device);
    return device;
  }

  async function call(path, opts) {
    const ctl = window.AbortController ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), TIMEOUT);
    let r;
    try { r = await fetch(API + path, Object.assign({}, opts, ctl ? { signal: ctl.signal } : {})); }
    finally { clearTimeout(timer); }
    let j = {};
    try { j = await r.json(); } catch (e) { /* not JSON: offline / local file server */ }
    if (!r.ok) { const err = new Error(j.error || 'HTTP ' + r.status); err.status = r.status; err.code = j.code; throw err; }
    return j;
  }
  const post = (path, data) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

  let profile = ls.get(PKEY); // last known profile (shown while offline)
  let pending = null, timer = null, lastSent = null;
  // every profile that comes back from the server is handed to the game (records, Catdex, Merge box)
  const keep = (p) => { profile = p; ls.set(PKEY, p); if (p && LT.Board.onProfile) { try { LT.Board.onProfile(p); } catch (e) { /* ignore */ } } return p; };

  // data: {scores: {tower, merge, yarn, tiles, mahjong}, dex: [types], merge: {box, at}}
  function sync(data) {
    pending = data;
    clearTimeout(timer);
    timer = setTimeout(flush, 600);
  }
  async function flush() {
    clearTimeout(timer);
    if (!pending) return profile;
    const data = pending;
    pending = null;
    const scores = {};
    for (const [k, v] of Object.entries(data.scores || {})) if (Number.isInteger(v) && v > 0) scores[k] = v;
    const dex = Array.isArray(data.dex) ? data.dex : [];
    const merge = data.merge && data.merge.at ? data.merge : null;
    const sig = JSON.stringify([scores, dex.length, merge && merge.at, resetSeen()]);
    if ((!Object.keys(scores).length && !dex.length && !merge) || sig === lastSent) return profile; // nothing new to send
    try { keep((await post('/sync', { device: deviceId(), scores, dex, merge, resetSeen: resetSeen() })).profile); lastSent = sig; } catch (e) { /* offline: next time */ }
    return profile;
  }
  // Admin score fixes: the server sends resetAt; once this device has adopted those exact values it says so
  // (until then the server ignores its uploads, so old higher records can't come back).
  function resetSeen() { const r = ls.get(RKEY); return r && r.device === deviceId() ? r.at || 0 : 0; }
  function ackReset(at) { ls.set(RKEY, { device: deviceId(), at }); lastSent = null; }
  // rename (accounts only)
  async function setName(name) { return keep((await post('/name', { device: deviceId(), name })).profile); }
  const board = (game) => call(`/board?game=${encodeURIComponent(game)}&device=${encodeURIComponent(deviceId())}`);

  // Log in with name + password: this device becomes that profile (its scores are merged in on the server).
  async function login(name, password) {
    const r = await post('/login', { device: deviceId(), name, password });
    device = r.device;
    ls.set(KEY, device);
    lastSent = null;
    return keep(r.profile);
  }
  // Sign up: name + password together; the only way onto the public board.
  async function signup(name, password) {
    const r = await post('/signup', { device: deviceId(), name, password });
    lastSent = null;
    return keep(r.profile);
  }
  // set (first time) or change (needs the current one) the profile's password
  async function setPassword(password, current) {
    const r = await post('/password', { device: deviceId(), password, current });
    if (r.device) { device = r.device; ls.set(KEY, device); lastSent = null; } // the profile moved to a new id
    return keep(r.profile);
  }
  // Log out: this device starts a fresh anonymous profile (local records stay on the device).
  function logout() {
    device = null;
    try { localStorage.removeItem(KEY); localStorage.removeItem(PKEY); } catch (e) { /* ignore */ }
    profile = null;
    lastSent = null;
    deviceId();
  }

  LT.Board = { deviceId, sync, flush, setName, board, login, signup, setPassword, resetSeen, ackReset, logout, get profile() { return profile; } };
})();
