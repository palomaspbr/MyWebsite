/* KaraokeRoom Durable Object: one per party (room code).
   Port of services/queue.go + queue_rearrange.go + the room-level parts of api/ (auth, config,
   users, queue handlers, WebSocket). Holds the queue, now playing, the session roster and the room
   config in Durable Object storage (one JSON document), and the WebSockets via the hibernation API.

   Differences from the Go server:
   - "loopback = admin" becomes "has the room's host key" (X-Host-Key, given to the creator).
   - A roster player is "active" while at least one live WebSocket carries its name (read from the
     socket attachments), so the roster survives hibernation without counters.
   - Queue items carry a snapshot of their song (the catalog lives in D1).
   - The room deletes itself 24 h after the last activity, or at once on POST /shutdown ("End party"). */

import { DurableObject } from 'cloudflare:workers';
import { ok, okMessage, message, fail, readBody, uuid, nowIso, clientIp, safeEqual, sha256Hex, str, ApiError, errorResponse } from './http.js';
import { getSong, incrementPlayCount } from './catalog.js';

const IDLE_MS = 24 * 3600 * 1000;
const PIN_MAX_FAILS = 5;
const PIN_WINDOW_MS = 60 * 1000;

const DEFAULT_CONFIG = {
  queue_strategy: 'fifo',
  guest_reorder: 'all',
  jukebox_controls: 'add_only',
  score_screen_enabled: false,
  score_mode: 'heuristic',
  admin_pin: ''
};

const CONFIG_RULES = {
  queue_strategy: v => ['fifo', 'fair'].includes(v) || 'must be fifo or fair',
  guest_reorder: v => ['all', 'own_only'].includes(v) || 'must be all or own_only',
  jukebox_controls: v => ['add_only', 'full'].includes(v) || 'must be add_only or full',
  score_mode: v => ['heuristic', 'random'].includes(v) || 'must be heuristic or random',
  score_screen_enabled: v => typeof v === 'boolean' || 'must be true or false',
  admin_pin: v => v === '' || /^\d{4,12}$/.test(v) || 'must be 4-12 digits (empty to turn it off)'
};

// Song fields kept in queue items (same columns the Go GetQueue join selected, plus lyrics/kind/language).
function songSnapshot(s) {
  const out = {
    id: s.id, code: s.code, title: s.title, artist: s.artist, youtube_id: s.youtube_id, youtube_url: s.youtube_url,
    duration: s.duration, thumbnail_url: s.thumbnail_url, file_size: 0, added_at: s.added_at, play_count: s.play_count,
    language: s.language, lyrics_start: s.lyrics_start, metadata_verified: s.metadata_verified, no_first_line: s.no_first_line,
    needs_optimization: false, youtube_title: s.youtube_title
  };
  if (s.video_kind) out.video_kind = s.video_kind;
  return out;
}

const isAnon = (name) => !name || name === 'Anonymous';

export class KaraokeRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.state = null; // null = room not initialised (or ended)
    this.pinFails = new Map(); // ip -> {failures, last, lockedUntil}
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get('state')) || null;
    });
    // Browsers' keep-alive pings are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  /*#region Persistence & lifecycle*/

  async save() {
    if (!this.state) return;
    await this.ctx.storage.put('state', this.state);
  }

  async touch() {
    if (!this.state) return;
    const now = Date.now();
    this.state.lastActivity = now;
    const alarm = await this.ctx.storage.getAlarm();
    // Only move the alarm when it is missing or more than an hour early (saves storage writes).
    if (!alarm || alarm < now + IDLE_MS - 3600e3) await this.ctx.storage.setAlarm(now + IDLE_MS);
  }

  async alarm() {
    if (!this.state) { await this.ctx.storage.deleteAll(); return; }
    const idle = Date.now() - (this.state.lastActivity || 0);
    if (idle >= IDLE_MS && this.ctx.getWebSockets().length === 0) {
      await this.endRoom('expired');
    } else {
      await this.ctx.storage.setAlarm(Date.now() + Math.max(IDLE_MS - idle, 3600e3));
    }
  }

  async endRoom(reason) {
    this.broadcast({ type: 'server_shutdown', payload: { reason } });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(4404, 'room_ended'); } catch (e) { /* already closed */ }
    }
    this.state = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /*#endregion*/

  /*#region HTTP entry*/

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/__init') return await this.init(request);
      if (url.pathname === '/__exists') return this.state ? ok(true) : fail(404, 'Room not found', { code: 'room_not_found' });

      const m = /^\/karaoke\/api\/r\/[A-Z]{4}(\/.*)?$/.exec(url.pathname);
      const path = (m && m[1]) || '/';

      if (!this.state) {
        if (path === '/ws' && request.headers.get('Upgrade') === 'websocket') return this.rejectSocket();
        return fail(404, 'Room not found', { code: 'room_not_found' });
      }

      await this.touch();
      if (path === '/ws') return this.acceptSocket(request);
      return await this.route(request, request.method, path, url);
    } catch (e) {
      return errorResponse(e);
    }
  }

  async init(request) {
    const body = await readBody(request);
    if (this.state) return fail(409, 'Room code taken');
    this.state = {
      code: body.code,
      createdAt: nowIso(),
      hostKeyHash: body.hostKeyHash,
      config: { ...DEFAULT_CONFIG },
      queue: [],
      isPlaying: false,
      players: {},
      lastActivity: Date.now()
    };
    await this.save();
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    return ok({ code: body.code });
  }

  async route(req, method, path, url) {
    const seg = path.split('/').filter(Boolean).map(decodeURIComponent);
    const [a, b, c] = seg;

    if (a === 'room' && method === 'GET' && seg.length === 1) {
      return ok({ code: this.state.code, created_at: this.state.createdAt, is_host: await this.isHost(req) });
    }
    if (a === 'admin' && b === 'verify' && method === 'POST') {
      await this.requireAdmin(req);
      return message('OK');
    }
    if (a === 'shutdown' && method === 'POST') {
      await this.requireAdmin(req);
      // Answer first, then end the party.
      this.ctx.waitUntil(new Promise(r => setTimeout(r, 50)).then(() => this.endRoom('ended')));
      return message('Party ended');
    }
    if (a === 'config' && seg.length === 1) {
      if (method === 'GET') return this.getConfig(req);
      if (method === 'PUT') return this.updateConfig(req);
    }
    if (a === 'users') {
      if (seg.length === 1 && method === 'GET') return ok(this.getPlayers());
      if (b === 'check' && method === 'POST') return this.checkUserName(req);
      if (b === 'rename' && method === 'POST') return this.renamePlayerHandler(req);
      if (b === 'signout' && method === 'POST') return this.signOutHandler(req);
    }
    if (a === 'queue') {
      if (seg.length === 1) {
        if (method === 'GET') return ok({ queue: this.getQueue(), now_playing: this.nowPlaying(), is_playing: this.state.isPlaying });
        if (method === 'POST') return this.addToQueueHandler(req);
        if (method === 'DELETE') { await this.requireAdmin(req); return this.clearQueueHandler(req); }
      }
      if (seg.length === 2 && method === 'POST') {
        switch (b) {
          case 'play': return ok(await this.playNext());
          case 'skip': { const body = (await readBody(req)) || {}; return ok(await this.skip(str(body.user_name) || 'Anonymous')); }
          case 'pause': this.pause(); return message('Playback paused');
          case 'resume':
            if (!this.nowPlaying()) return fail(400, 'nothing to resume');
            this.resume(); return message('Playback resumed');
          case 'restart': this.restart(); return message('Song restarted');
          case 'shuffle': {
            await this.requireAdmin(req);
            const n = await this.shuffle();
            return okMessage({ count: n }, 'Queue shuffled');
          }
        }
      }
      if (seg.length === 2 && method === 'DELETE') return this.removeHandler(req, b);
      if (seg.length === 3 && c === 'reorder' && method === 'PUT') return this.reorderHandler(req, b);
      if (seg.length === 3 && c === 'rearrange' && method === 'POST') return this.rearrangeHandler(req, b);
    }
    return fail(404, 'not found');
  }

  /*#endregion*/

  /*#region Auth (port of api/auth.go)*/

  async isHost(req) {
    const key = req.headers.get('X-Host-Key');
    if (!key || !this.state.hostKeyHash) return false;
    return safeEqual(await sha256Hex(key), this.state.hostKeyHash);
  }

  pinLockedFor(ip) {
    const e = this.pinFails.get(ip);
    if (!e) return 0;
    const left = e.lockedUntil - Date.now();
    return left > 0 ? left : 0;
  }

  // 'ok' | 'required' | 'invalid' | 'locked' (cached per request object)
  async evalAdmin(req) {
    if (req._admin) return req._admin;
    let res;
    if (await this.isHost(req)) res = 'ok';
    else if (!this.state.config.admin_pin) res = 'ok';
    else {
      const ip = clientIp(req);
      if (this.pinLockedFor(ip) > 0) res = 'locked';
      else {
        const sent = req.headers.get('X-Admin-Pin') || '';
        if (!sent) res = 'required';
        else if (safeEqual(sent, this.state.config.admin_pin)) { this.pinFails.delete(ip); res = 'ok'; }
        else {
          const now = Date.now();
          const e = this.pinFails.get(ip) || { failures: 0, last: 0, lockedUntil: 0 };
          if (now - e.last > PIN_WINDOW_MS) e.failures = 0;
          e.failures++;
          e.last = now;
          if (e.failures >= PIN_MAX_FAILS) { e.lockedUntil = now + PIN_WINDOW_MS; e.failures = 0; res = 'locked'; } else res = 'invalid';
          this.pinFails.set(ip, e);
          if (this.pinFails.size > 500) for (const [k, v] of this.pinFails) if (now - v.last > PIN_WINDOW_MS && v.lockedUntil < now) this.pinFails.delete(k);
        }
      }
    }
    req._admin = res;
    return res;
  }

  adminError(req, res) {
    if (res === 'locked') {
      const secs = Math.ceil(this.pinLockedFor(clientIp(req)) / 1000) + 1;
      return new ApiError(429, 'Too many wrong DJ PIN attempts. Try again in a minute.', { code: 'admin_pin_locked', retry_after: secs });
    }
    if (res === 'invalid') return new ApiError(401, 'Wrong DJ PIN', { code: 'admin_pin_invalid' });
    return new ApiError(401, 'DJ PIN required', { code: 'admin_pin_required' });
  }

  async requireAdmin(req) {
    const res = await this.evalAdmin(req);
    if (res !== 'ok') throw this.adminError(req, res);
  }

  playerOwnedBy(name, clientId) {
    if (!clientId || !name) return false;
    const p = this.state.players[name];
    return !!p && !!p.clientId && p.clientId === clientId;
  }

  async authorizePlayerAction(req, name, clientId, what) {
    const res = await this.evalAdmin(req);
    if (res === 'ok' || this.playerOwnedBy(name, clientId)) return;
    if (res === 'invalid' || res === 'locked') throw this.adminError(req, res);
    throw new ApiError(403, 'Only the DJ or the device that owns this player can ' + what, { code: 'not_owner' });
  }

  catalogAdmin(req) {
    const secret = this.env.KARAOKE_ADMIN_PASSWORD;
    const sent = req.headers.get('X-Catalog-Key');
    return !!secret && !!sent && safeEqual(sent, secret);
  }

  /*#endregion*/

  /*#region Config*/

  async getConfig(req) {
    const cfg = this.state.config;
    const origin = new URL(req.url).origin;
    return ok({
      queue_strategy: cfg.queue_strategy,
      guest_reorder: cfg.guest_reorder,
      jukebox_controls: cfg.jukebox_controls,
      score_screen_enabled: cfg.score_screen_enabled,
      score_mode: cfg.score_mode,
      admin_pin_set: cfg.admin_pin !== '',
      is_admin: (await this.evalAdmin(req)) === 'ok',
      is_host: await this.isHost(req),
      is_local: await this.isHost(req), // the original's "is_local" (loopback) maps to the host
      catalog_admin: this.catalogAdmin(req),
      catalog_admin_available: !!this.env.KARAOKE_ADMIN_PASSWORD,
      room_code: this.state.code,
      join_url: `${origin}/karaoke/sing/?r=${this.state.code}`
    });
  }

  async updateConfig(req) {
    await this.requireAdmin(req);
    const body = await readBody(req);
    if (!body) return fail(400, 'Invalid request');
    const next = { ...this.state.config };
    for (const key of Object.keys(CONFIG_RULES)) {
      if (body[key] === undefined || body[key] === null) continue;
      const v = typeof body[key] === 'string' ? body[key].trim() : body[key];
      const verdict = CONFIG_RULES[key](v);
      if (verdict !== true) return fail(400, `Invalid ${key}: ${verdict}`);
      next[key] = v;
    }
    this.state.config = next;
    await this.save();
    this.broadcast({
      type: 'config_update',
      payload: {
        jukebox_controls: next.jukebox_controls,
        guest_reorder: next.guest_reorder,
        score_screen_enabled: next.score_screen_enabled,
        score_mode: next.score_mode
      }
    });
    return message('Configuration updated.');
  }

  /*#endregion*/

  /*#region Queue (port of services/queue.go)*/

  nowPlaying() {
    return this.state.queue.find(i => i.status === 'playing') || null;
  }

  pending() {
    return this.state.queue.filter(i => i.status === 'pending').sort((x, y) => x.position - y.position);
  }

  // Playing first, then pending by position (Go: ORDER BY status DESC, position).
  getQueue() {
    const np = this.nowPlaying();
    return np ? [np, ...this.pending()] : this.pending();
  }

  broadcastUpdate(action, item, activity) {
    const payload = {
      action,
      queue: this.getQueue(),
      now_playing: this.nowPlaying(),
      is_playing: this.state.isPlaying
    };
    if (item) payload.item = item;
    if (activity) payload.activity = activity;
    this.broadcast({ type: 'queue_update', payload });
  }

  // Drop roster entries with no live socket, no owning device and no song left (ghost singers).
  pruneOrphanGhostPlayers() {
    const inQueue = new Set(this.state.queue.map(i => i.user_name));
    const active = this.activeNames();
    for (const [name, p] of Object.entries(this.state.players)) {
      if (!active.has(name) && !p.clientId && !inQueue.has(name)) delete this.state.players[name];
    }
  }

  async addToQueueHandler(req) {
    const body = await readBody(req);
    if (!body || !str(body.song_id)) return fail(400, 'Song ID is required');
    const userName = str(body.user_name) || 'Anonymous';
    const song = await getSong(this.env.KARAOKE_DB, body.song_id);
    if (!song || song.deleted_at) return fail(404, 'song not found');
    if (this.pending().some(i => i.song_id === song.id)) return fail(409, 'song already in queue');
    const np = this.nowPlaying();
    if (np && np.song_id === song.id) return fail(409, 'song is currently playing');

    const item = {
      id: uuid(), song_id: song.id, song: songSnapshot(song), user_name: userName,
      position: 0, status: 'pending', added_at: nowIso()
    };
    if (this.state.config.queue_strategy === 'fair') this.insertFair(item);
    else this.insertFifo(item);
    this.state.queue.push(item);

    if (body.register_player === true && !isAnon(userName) && !this.state.players[userName]) {
      const now = nowIso();
      this.state.players[userName] = { name: userName, clientId: '', firstSeen: now, lastSeen: now };
    }
    await this.save();
    this.broadcastUpdate('add', item, { action: 'add', user_name: userName, song_title: song.title });
    return okMessage(item, 'Song added to queue');
  }

  insertFifo(item) {
    const max = this.pending().reduce((m, i) => Math.max(m, i.position), 0);
    item.position = max + 1;
  }

  // Port of database.addToQueueFair ("Fair Play" rounds; the current singer opens the first round).
  insertFair(item) {
    const entries = this.pending();
    if (!entries.length) return this.insertFifo(item);
    let round = new Set();
    const np = this.nowPlaying();
    if (np) round.add(np.user_name);
    let insertPosition = -1;
    for (const e of entries) {
      if (round.has(e.user_name)) {
        if (!round.has(item.user_name)) { insertPosition = e.position; break; }
        round = new Set([e.user_name]);
      } else {
        round.add(e.user_name);
      }
    }
    if (insertPosition === -1) return this.insertFifo(item);
    for (const e of entries) if (e.position >= insertPosition) e.position++;
    item.position = insertPosition;
  }

  async removeHandler(req, itemId) {
    const body = (await readBody(req)) || {};
    const userName = str(body.user_name) || 'Anonymous';
    const item = this.state.queue.find(i => i.id === itemId);
    if (item) await this.authorizePlayerAction(req, item.user_name, str(body.client_id), 'remove this song');
    if (!item) return fail(404, 'queue item not found');
    if (item.status === 'playing') return fail(409, 'cannot remove the song that is playing; skip it instead');
    this.state.queue = this.state.queue.filter(i => i.id !== itemId);
    this.pruneOrphanGhostPlayers();
    await this.save();
    this.broadcastUpdate('remove', item, { action: 'remove', user_name: userName, song_title: item.song ? item.song.title : '' });
    return message('Item removed from queue');
  }

  async finishCurrent(status) {
    const np = this.nowPlaying();
    if (!np) return;
    this.state.queue = this.state.queue.filter(i => i.id !== np.id);
    if (status === 'completed') {
      try { await incrementPlayCount(this.env.KARAOKE_DB, np.song_id); } catch (e) { console.error('play count', e); }
    }
  }

  async playNext() {
    await this.finishCurrent('completed');
    return this.startNext();
  }

  async startNext() {
    const next = this.pending()[0];
    this.pruneOrphanGhostPlayers();
    if (!next) {
      this.state.isPlaying = false;
      await this.save();
      this.broadcastUpdate('stop', null);
      return null;
    }
    next.status = 'playing';
    next.started_at = nowIso();
    this.state.isPlaying = true;
    await this.save();
    this.broadcastUpdate('play', next);
    return next;
  }

  async skip(userName) {
    const np = this.nowPlaying();
    const skippedTitle = np && np.song ? np.song.title : '';
    if (np) await this.finishCurrent('skipped');
    const result = await this.startNext();
    if (skippedTitle) this.broadcastUpdate('skip', result, { action: 'skip', user_name: userName, song_title: skippedTitle });
    return result;
  }

  pause() {
    this.state.isPlaying = false;
    this.ctx.waitUntil(this.save());
    this.broadcastUpdate('pause', this.nowPlaying());
  }

  resume() {
    this.state.isPlaying = true;
    this.ctx.waitUntil(this.save());
    this.broadcastUpdate('resume', this.nowPlaying());
  }

  restart() {
    const np = this.nowPlaying();
    if (np && this.state.isPlaying) this.broadcastUpdate('restart', np);
  }

  async togglePlayPause() {
    const np = this.nowPlaying();
    if (np) {
      if (this.state.isPlaying) this.pause(); else this.resume();
      return;
    }
    await this.playNext();
  }

  async clearQueueHandler(req) {
    const body = (await readBody(req)) || {};
    this.state.queue = this.state.queue.filter(i => i.status !== 'pending');
    this.pruneOrphanGhostPlayers();
    await this.save();
    this.broadcastUpdate('clear', null, { action: 'clear', user_name: str(body.user_name) || 'Anonymous' });
    return message('Queue cleared');
  }

  async reorderHandler(req, itemId) {
    // Guest reorder guard (api/queue_rearrange.go guestReorderGuard)
    if (this.state.config.guest_reorder === 'own_only') {
      const res = await this.evalAdmin(req);
      if (res === 'invalid' || res === 'locked') throw this.adminError(req, res);
      if (res !== 'ok') return fail(403, 'Guests can only rearrange their own songs', { code: 'guest_reorder_own_only' });
    }
    const body = await readBody(req);
    if (!body) return fail(400, 'Invalid request');
    const userName = str(body.user_name) || 'Anonymous';
    const newPosition = Number.isInteger(body.position) ? body.position : -1;
    const pending = this.pending();
    const current = pending.findIndex(i => i.id === itemId);
    if (current === -1 || newPosition < 0 || newPosition >= pending.length || newPosition === current) {
      return message('Queue reordered');
    }
    const [moved] = pending.splice(current, 1);
    pending.splice(newPosition, 0, moved);
    pending.forEach((it, i) => { it.position = i + 1; });
    await this.save();
    this.broadcastUpdate('reorder', null, {
      action: 'reorder', user_name: userName, song_title: moved.song ? moved.song.title : '', direction: str(body.direction)
    });
    return message('Queue reordered');
  }

  async rearrangeHandler(req, itemId) {
    const body = await readBody(req);
    const direction = body ? str(body.direction) : '';
    if (direction !== 'earlier' && direction !== 'later') return fail(400, 'direction must be "earlier" or "later"');
    const pending = this.pending();
    const idx = pending.findIndex(i => i.id === itemId);
    const anyItem = this.state.queue.find(i => i.id === itemId);
    if (!anyItem) return fail(404, 'queue item not found');
    const owner = anyItem.user_name;
    if (isAnon(owner)) return fail(400, 'Songs added anonymously cannot be rearranged');
    await this.authorizePlayerAction(req, owner, str(body.client_id), 'rearrange');
    if (idx < 0) return fail(404, 'queue item not found');
    const step = direction === 'later' ? 1 : -1;
    let other = -1;
    for (let j = idx + step; j >= 0 && j < pending.length; j += step) {
      if (pending[j].user_name === owner) { other = j; break; }
    }
    if (other < 0) return okMessage({ moved: false }, 'Nothing to rearrange');
    const a = pending[idx], b = pending[other];
    [a.position, b.position] = [b.position, a.position];
    await this.save();
    this.broadcastUpdate('reorder', null, {
      action: 'reorder', user_name: owner, song_title: a.song ? a.song.title : '',
      direction: direction === 'later' ? 'own_later' : 'own_earlier'
    });
    return okMessage({ moved: true }, 'Songs rearranged');
  }

  async shuffle() {
    const pending = this.pending();
    if (pending.length < 2) return pending.length;
    for (let i = pending.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pending[i], pending[j]] = [pending[j], pending[i]];
    }
    pending.forEach((it, i) => { it.position = i + 1; });
    await this.save();
    this.broadcastUpdate('reorder', null, { action: 'reorder', user_name: 'DJ', direction: 'shuffle' });
    return pending.length;
  }

  /*#endregion*/

  /*#region Roster (port of the player parts of services/queue.go)*/

  activeNames() {
    const names = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (att && att.userName) names.add(att.userName);
    }
    return names;
  }

  getPlayers() {
    const active = this.activeNames();
    return Object.values(this.state.players)
      .map(p => ({ name: p.name, status: active.has(p.name) ? 'active' : 'inactive' }))
      .sort((x, y) => {
        if ((x.status === 'active') !== (y.status === 'active')) return x.status === 'active' ? -1 : 1;
        const a = x.name.toLowerCase(), b = y.name.toLowerCase();
        return a < b ? -1 : a > b ? 1 : 0;
      });
  }

  evaluateClaim(name, clientId) {
    const p = this.state.players[name];
    if (!p || (clientId && p.clientId === clientId)) return 'ok';
    if (this.activeNames().has(name)) return 'active_conflict';
    return 'confirm_resume';
  }

  async checkUserName(req) {
    const body = await readBody(req);
    const name = body ? str(body.user_name).trim() : '';
    if (!name) return fail(400, 'Username is required');
    switch (this.evaluateClaim(name, str(body.client_id))) {
      case 'active_conflict':
        return fail(409, 'Username is already in use by another device', { status: 'active_conflict' });
      case 'confirm_resume':
        return body.confirm === true ? okMessage({ status: 'ok' }, 'Username available') : ok({ status: 'confirm_resume' });
      default:
        return okMessage({ status: 'ok' }, 'Username available');
    }
  }

  async renamePlayerHandler(req) {
    const body = await readBody(req);
    const oldName = body ? str(body.old_name) : '';
    const newName = body ? str(body.new_name) : '';
    const clientId = body ? str(body.client_id) : '';
    if (!oldName || !newName) return fail(400, 'Old and new names are required');
    if (oldName !== newName && oldName !== 'Anonymous') await this.authorizePlayerAction(req, oldName, clientId, 'rename this player');
    if (isAnon(newName)) return fail(400, 'invalid name');
    if (oldName === newName || isAnon(oldName)) return okMessage({ status: 'ok' }, 'Name updated');

    const active = this.activeNames();
    const dst = this.state.players[newName];
    if (dst && active.has(newName) && (!clientId || dst.clientId !== clientId)) {
      return fail(409, 'Username is already in use by another device', { status: 'active_conflict' });
    }
    const now = nowIso();
    const src = this.state.players[oldName];
    if (src) {
      this.state.players[newName] = Object.assign(dst || { name: newName, firstSeen: src.firstSeen }, { name: newName, clientId, lastSeen: now });
      delete this.state.players[oldName];
    }
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (att && att.userName === oldName) ws.serializeAttachment({ userName: newName, clientId });
    }
    for (const it of this.state.queue) if (it.user_name === oldName) it.user_name = newName;
    await this.save();
    this.broadcastUpdate('rename_user', null);
    return okMessage({ status: 'ok' }, 'Name updated');
  }

  async signOutHandler(req) {
    const body = await readBody(req);
    const name = body ? str(body.user_name) : '';
    if (!name) return fail(400, 'Username is required');
    if (name !== 'Anonymous') await this.authorizePlayerAction(req, name, str(body.client_id), 'sign this player out');
    if (isAnon(name)) return okMessage({ removed: 0 }, 'Signed out');
    const before = this.state.queue.length;
    this.state.queue = this.state.queue.filter(i => i.user_name !== name || i.status === 'playing');
    const removed = before - this.state.queue.length;
    delete this.state.players[name];
    await this.save();
    this.broadcastUpdate('remove', null, { action: 'remove', user_name: name });
    return okMessage({ removed }, 'Signed out');
  }

  // register_user over the WebSocket: bind the socket to a player (create / resume / take over).
  registerClientUser(ws, userName, clientId) {
    const holder = this.state.players[userName];
    // Defensive guard: never grab a name another device holds online.
    const onlineElsewhere = this.ctx.getWebSockets().some(other => {
      if (other === ws) return false;
      const att = other.deserializeAttachment();
      return !!att && att.userName === userName;
    });
    if (holder && onlineElsewhere && (!clientId || holder.clientId !== clientId)) return false;
    const now = nowIso();
    const p = holder || { name: userName, firstSeen: now };
    p.clientId = clientId;
    p.lastSeen = now;
    this.state.players[userName] = p;
    ws.serializeAttachment({ userName, clientId });
    return true;
  }

  /*#endregion*/

  /*#region WebSockets (hibernation API)*/

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(data); } catch (e) { /* closing */ }
    }
  }

  acceptSocket(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return fail(426, 'Expected a WebSocket');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userName: '', clientId: '' });
    server.send(JSON.stringify({
      type: 'init',
      payload: { action: 'init', queue: this.getQueue(), now_playing: this.nowPlaying(), is_playing: this.state.isPlaying }
    }));
    return new Response(null, { status: 101, webSocket: client });
  }

  rejectSocket() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    server.close(4404, 'room_not_found');
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (!this.state) { try { ws.close(4404, 'room_not_found'); } catch (e) { /* closed */ } return; }
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'ping':
        ws.send('{"type":"pong"}');
        break;
      case 'register_user': {
        const p = msg.payload || {};
        const name = str(p.user_name).trim();
        if (name && this.registerClientUser(ws, name, str(p.client_id))) {
          await this.touch();
          await this.save();
        }
        break;
      }
      case 'player_action':
        if (msg.payload && msg.payload.action === 'toggle_play') {
          await this.touch();
          await this.togglePlayPause();
        }
        break;
    }
  }

  async webSocketClose(ws, code) {
    // The player stays in the roster (inactive) - nothing to do but finish the close handshake.
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch (e) { /* closed */ }
  }

  async webSocketError(ws) {
    try { ws.close(1011, 'error'); } catch (e) { /* closed */ }
  }

  /*#endregion*/
}
