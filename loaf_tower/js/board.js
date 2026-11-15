/* Leaderboard client: per-device profile id, best-score sync and API calls (worker/loaf.js).
   The device id is a random UUID kept in localStorage; no personal data is sent. Scores are always
   saved privately; they only show on the public leaderboard once the player picks a name. */
(function () {
  'use strict';
  const LT = window.LT;
  const API = '/loaf_tower/api';
  const KEY = 'lt.device', PKEY = 'lt.boardProfile';
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
  const keep = (p) => { profile = p; ls.set(PKEY, p); return p; };

  // scores: {tower, merge, yarn, tiles, mahjong} (bests; zero/missing ones are skipped)
  function sync(scores) {
    pending = scores;
    clearTimeout(timer);
    timer = setTimeout(flush, 600);
  }
  async function flush() {
    clearTimeout(timer);
    if (!pending) return profile;
    const scores = {};
    for (const [k, v] of Object.entries(pending)) if (Number.isInteger(v) && v > 0) scores[k] = v;
    pending = null;
    const sig = JSON.stringify(scores);
    if (!Object.keys(scores).length || sig === lastSent) return profile; // nothing new to send
    try { keep((await post('/sync', { device: deviceId(), scores })).profile); lastSent = sig; } catch (e) { /* offline: next time */ }
    return profile;
  }
  // name = text to go public with that name; null = hide (the name stays reserved)
  async function setName(name) { return keep((await post('/name', { device: deviceId(), name })).profile); }
  const board = (game) => call(`/board?game=${encodeURIComponent(game)}&device=${encodeURIComponent(deviceId())}`);

  LT.Board = { deviceId, sync, flush, setName, board, get profile() { return profile; } };
})();
