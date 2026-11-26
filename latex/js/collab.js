// Sharing and real-time collaboration for LaTeX Notebook. Server: worker/latex/ (one Durable Object
// per shared project). Protocol: see worker/latex/room.js. Docs: C:\latex\docs\COLLAB.md.
//
// A shared project is still a normal local project (IndexedDB) whose record has
//   share: {room, key, role: 'edit'|'view', edit?, view?, owner?}
// The provider below keeps the local Yjs document and the room in sync, both ways, and survives
// going offline: whatever changed meanwhile is sent when the socket comes back.
import { Y, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from '../vendor/cm.js';
import * as store from './store.js';
import { t } from './i18n.js';
import { h, esc, modal, toast, copyText, confirm } from './ui.js';
import { icon } from './icons.js';

const API = '/latex/api/rooms';
const T = { HELLO: 0, INIT: 1, INIT_END: 2, UPDATE: 3, AWARENESS: 4, COMPACT: 6, BIG: 7, LEFT: 8, ERROR: 9 };
const FRAME_MAX = 900 * 1024;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const shareLink = (room, key) => `${location.origin}/latex/edit/?s=${encodeURIComponent(room)}#k=${encodeURIComponent(key)}`;

function frame(type, payload) {
  const body = payload instanceof Uint8Array ? payload : enc.encode(JSON.stringify(payload));
  const out = new Uint8Array(body.length + 1);
  out[0] = type;
  out.set(body, 1);
  return out;
}

async function api(path, { method = 'GET', key, body, type } = {}) {
  const headers = {};
  if (key) headers.Authorization = 'Bearer ' + key;
  if (type) headers['Content-Type'] = type;
  const res = await fetch(API + path, { method, headers, body });
  if (!res.ok) {
    let code = 'HTTP ' + res.status;
    try { code = (await res.json()).error || code; } catch { /* not JSON */ }
    const err = new Error(code);
    err.status = res.status;
    err.code = code;
    throw err;
  }
  return res;
}

/** Opening a share link: find (or create) the local copy of that shared project. */
export async function openSharedLink(room, key) {
  if (!room || !key) throw new Error(t('dash.join_bad'));
  const info = await (await api('/' + encodeURIComponent(room) + '/info', { key })).json();
  const role = info.role === 'view' ? 'view' : 'edit';
  const list = await store.listProjects();
  const existing = list.find((p) => p.share && p.share.room === room);
  if (existing) {
    // A better key (edit instead of view) upgrades the local copy.
    if (existing.share.role === 'view' && role === 'edit') {
      await store.patchProject(existing.id, { share: { ...existing.share, key, role, edit: key } });
    }
    return existing;
  }
  // The local document must start empty: anything in it would be merged into the shared project.
  const now = Date.now();
  const rec = { id: store.newId(), name: '…', created: now, updated: now, opened: now, share: { room, key, role, [role]: key } };
  await store.putProject(rec);
  return rec;
}

class Provider {
  constructor(app) {
    this.app = app;
    this.doc = app.doc;
    this.awareness = app.awareness;
    this.share = app.record.share;
    this.status = 'connecting';
    this.synced = false;
    this.ws = null;
    this.retry = 0;
    this.gone = false;
    this.maxFile = 10 * 1024 * 1024;
    this.pendingBig = new Set();
    this.uploading = new Set();
    this.listeners = new Set();

    this.onDocUpdate = (update, origin) => {
      if (origin === this || origin === 'idb' || origin === 'bc') {
        // Updates from another tab of this browser: that tab sends them itself.
        return;
      }
      if (this.share.role !== 'edit' || !this.synced) return; // sent with the next sync instead
      this.sendUpdate(update);
    };
    this.doc.on('update', this.onDocUpdate);

    this.onAwareness = ({ added, updated, removed }, origin) => {
      if (origin === this) { this.emit(); return; }
      const changed = added.concat(updated, removed);
      if (this.synced && this.ws && this.ws.readyState === 1) this.ws.send(frame(T.AWARENESS, encodeAwarenessUpdate(this.awareness, changed)));
      this.emit();
    };
    this.awareness.on('update', this.onAwareness);

    // Images added to the project by others: fetch their bytes.
    this.onFiles = () => { if (this.synced) this.syncBlobs(); };
    this.app.project.files.observeDeep(this.onFiles);

    addEventListener('online', () => { if (this.status !== 'connected') this.connect(true); });
    addEventListener('beforeunload', () => removeAwarenessStates(this.awareness, [this.doc.clientID], 'unload'));
    this.connect();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); this.app.setSaveState && this.app.setSaveState(); }
  setStatus(s) { this.status = s; this.emit(); }

  connect(now = false) {
    if (this.gone) return;
    clearTimeout(this.timer);
    if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch { /* ignore */ } }
    const delay = now ? 0 : Math.min(30000, this.retry ? 1000 * 2 ** Math.min(this.retry, 5) : 0);
    this.timer = setTimeout(() => this.open(), delay);
  }

  open() {
    this.setStatus('connecting');
    this.synced = false;
    this.initParts = [];
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${API}/${encodeURIComponent(this.share.room)}/ws`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => ws.send(frame(T.HELLO, { key: this.share.key, clientId: this.doc.clientID }));
    ws.onmessage = (e) => { if (typeof e.data !== 'string') this.onMessage(new Uint8Array(e.data)); };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.synced = false;
      clearInterval(this.pinger);
      // Others' cursors are stale now.
      const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID);
      removeAwarenessStates(this.awareness, others, this);
      if (e.code === 4404 || e.code === 4403) return this.lost(e.reason || 'room_not_found');
      this.setStatus('offline');
      this.retry++;
      this.connect();
    };
    this.pinger = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 25000);
  }

  onMessage(data) {
    const type = data[0];
    const body = data.subarray(1);
    switch (type) {
      case T.HELLO: {
        const hello = JSON.parse(dec.decode(body));
        if (hello.limits) this.maxFile = hello.limits.fileBytes;
        if (hello.role !== this.share.role) {
          this.share.role = hello.role;
          store.patchProject(this.app.id, { share: { ...this.share } });
        }
        break;
      }
      case T.INIT: this.initParts.push(body.slice()); break;
      case T.INIT_END: this.finishInit(); break;
      case T.UPDATE: Y.applyUpdate(this.doc, body, this); break;
      case T.AWARENESS: applyAwarenessUpdate(this.awareness, body, this); break;
      case T.BIG: {
        const { seq } = JSON.parse(dec.decode(body));
        const p = api(`/${this.share.room}/update/${seq}`, { key: this.share.key })
          .then((r) => r.arrayBuffer()).then((b) => Y.applyUpdate(this.doc, new Uint8Array(b), this))
          .catch((e) => { console.warn('big update', e); this.connect(true); })
          .finally(() => this.pendingBig.delete(p));
        this.pendingBig.add(p);
        break;
      }
      case T.COMPACT: this.compact(JSON.parse(dec.decode(body)).seq); break;
      case T.LEFT: removeAwarenessStates(this.awareness, [new DataView(body.buffer, body.byteOffset).getUint32(0)], this); break;
      case T.ERROR: {
        const { code } = JSON.parse(dec.decode(body));
        if (code === 'room_not_found' || code === 'room_deleted' || code === 'bad_key' || code === 'expired') this.lost(code);
        else if (code === 'room_full') toast(t('share.limits', { mb: 25, fmb: Math.round(this.maxFile / 1048576) }), 'error', 8000);
        break;
      }
      default: break;
    }
  }

  finishInit() {
    // The stream is [u32 length][update] repeated.
    const total = this.initParts.reduce((a, p) => a + p.length, 0);
    const buf = new Uint8Array(total);
    let o = 0;
    for (const p of this.initParts) { buf.set(p, o); o += p.length; }
    this.initParts = [];
    const updates = [];
    const dv = new DataView(buf.buffer);
    for (let i = 0; i + 4 <= buf.length;) {
      const len = dv.getUint32(i);
      updates.push(buf.subarray(i + 4, i + 4 + len));
      i += 4 + len;
    }
    const merged = updates.length ? Y.mergeUpdates(updates) : new Uint8Array([0, 0]);
    Y.applyUpdate(this.doc, merged, this);
    // Send what the room doesn't have yet (edits made offline, or the whole project the first time).
    if (this.share.role === 'edit') {
      const diff = Y.encodeStateAsUpdate(this.doc, Y.encodeStateVectorFromUpdate(merged));
      if (diff.length > 2) this.sendUpdate(diff);
    }
    this.synced = true;
    this.retry = 0;
    this.setStatus('connected');
    // Announce ourselves to the others.
    this.ws.send(frame(T.AWARENESS, encodeAwarenessUpdate(this.awareness, [this.doc.clientID])));
    this.syncBlobs();
    if (this.onSynced) { const f = this.onSynced; this.onSynced = null; f(); }
  }

  sendUpdate(update) {
    if (update.length > FRAME_MAX) {
      api(`/${this.share.room}/update`, { method: 'POST', key: this.share.key, body: update, type: 'application/octet-stream' })
        .catch((e) => { console.warn('update', e); this.connect(true); });
    } else if (this.ws && this.ws.readyState === 1) {
      this.ws.send(frame(T.UPDATE, update));
    }
  }

  async compact(seq) {
    if (this.share.role !== 'edit') return;
    await Promise.all([...this.pendingBig]); // the snapshot must contain every update up to seq
    try {
      await api(`/${this.share.room}/compact?seq=${seq}`, { method: 'POST', key: this.share.key, body: Y.encodeStateAsUpdate(this.doc), type: 'application/octet-stream' });
    } catch (e) { console.warn('compact', e); }
  }

  /** Upload images the room lacks, download the ones we lack. */
  async syncBlobs() {
    const hashes = [...this.app.project.hashes()];
    if (!hashes.length) return;
    // Download. A 404 usually means the person who added the file is still uploading it: retry.
    this.blobTries = this.blobTries || new Map();
    let retry = false;
    for (const hsh of hashes) {
      if (await store.hasBlob(hsh)) continue;
      try {
        const res = await api(`/${this.share.room}/blobs/${hsh}`, { key: this.share.key });
        const blob = await res.blob();
        await store.putBlob(blob, blob.type);
        this.blobTries.delete(hsh);
        const cur = this.app.currentId && this.app.project.get(this.app.currentId);
        if (cur && cur.hash === hsh) this.app.openFile(cur.id, { focus: false });
      } catch (e) {
        if (e.status !== 404) console.warn('blob get', e);
        const n = (this.blobTries.get(hsh) || 0) + 1;
        this.blobTries.set(hsh, n);
        if (n < 12) retry = true;
      }
    }
    if (retry) {
      clearTimeout(this.blobTimer);
      this.blobTimer = setTimeout(() => this.syncBlobs(), 1500);
    }
    // Upload.
    if (this.share.role !== 'edit') return;
    try {
      const { missing } = await (await api(`/${this.share.room}/blobs/check`, { method: 'POST', key: this.share.key, body: JSON.stringify({ hashes }), type: 'application/json' })).json();
      for (const hsh of missing) await this.uploadBlob(hsh);
    } catch (e) { console.warn('blob check', e); }
  }

  async uploadBlob(hash) {
    if (this.share.role !== 'edit' || this.uploading.has(hash)) return;
    this.uploading.add(hash);
    try {
      const blob = await store.getBlob(hash);
      if (blob) await api(`/${this.share.room}/blobs/${hash}`, { method: 'PUT', key: this.share.key, body: blob, type: blob.type || 'application/octet-stream' });
    } catch (e) {
      if (e.code === 'room_full' || e.code === 'file_too_big') toast(t('share.limits', { mb: 60, fmb: Math.round(this.maxFile / 1048576) }), 'error', 8000);
      else console.warn('blob put', e);
    } finally { this.uploading.delete(hash); }
  }

  /** The room is gone (deleted or bad key): keep the local copy as a normal project. */
  async lost(code) {
    if (this.gone) return;
    this.gone = true;
    this.destroy();
    this.status = 'gone';
    await store.patchProject(this.app.id, { share: null });
    toast(t('share.gone') + ' (' + code + ')', 'error', 10000);
    this.app.record.share = null;
    this.app.provider = null;
    this.app.readOnly = false;
    this.app.setSaveState && this.app.setSaveState();
  }

  destroy() {
    clearTimeout(this.timer);
    clearInterval(this.pinger);
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwareness);
    this.app.project.files.unobserveDeep(this.onFiles);
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch { /* ignore */ } }
  }
}

export function connect(app) {
  const p = new Provider(app);
  p.on(() => renderFaces(app));
  p.onSynced = () => {
    if (!app.currentId) {
      const first = app.project.mainId || (app.project.fileEntries()[0] || {}).id;
      if (first) app.openFile(first, { focus: false });
    }
  };
  return p;
}

/*#region Collaborators in the top bar*/
function people(app) {
  const out = [];
  app.awareness.getStates().forEach((st, id) => { if (st && st.user) out.push({ id, ...st.user, me: id === app.doc.clientID }); });
  return out.sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0));
}

function renderFaces(app) {
  const box = document.getElementById('faces');
  if (!box) return;
  const others = people(app).filter((p) => !p.me);
  box.replaceChildren();
  for (const p of others.slice(0, 5)) {
    const f = h('<span class="face"></span>');
    f.textContent = (p.name || '?').slice(0, 1).toUpperCase();
    f.style.background = p.color || '#ffd43b';
    f.title = p.name;
    box.appendChild(f);
  }
  if (others.length > 5) box.appendChild(h(`<span class="face" style="background:var(--card)">+${others.length - 5}</span>`));
}
/*#endregion*/

/*#region Share dialog*/
export function openShareDialog(app) {
  const body = h('<div></div>');
  const m = modal({ title: t('share.title'), body, wide: true });
  let off = null;

  const render = () => {
    body.replaceChildren();
    const share = app.record.share;
    if (!share) {
      body.appendChild(h(`<p>${esc(t('share.intro'))}</p>`));
      body.appendChild(h(`<p class="hint">${esc(t('share.note'))}</p>`));
      body.appendChild(h(`<p class="hint">${esc(t('share.limits', { mb: 25, fmb: 10 }))}</p>`));
      const b = h(`<div class="actions"><button type="button" class="btn primary">${icon('share')} ${esc(t('share.start'))}</button></div>`);
      b.querySelector('button').onclick = async (e) => {
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = t('share.creating');
        try { await startSharing(app); render(); } catch (err) {
          console.error(err);
          toast(t('share.unavailable', { err: err.code || err.message }), 'error', 8000);
          render();
        }
      };
      body.appendChild(b);
      return;
    }
    body.appendChild(h(`<p>${esc(t('share.intro'))}</p>`));
    const links = [];
    if (share.edit || share.role === 'edit') links.push(['share.edit_link', share.edit || share.key]);
    if (share.view || share.role === 'view') links.push(['share.view_link', share.view || share.key]);
    for (const [label, key] of links) {
      body.appendChild(h(`<label class="row">${icon(label === 'share.edit_link' ? 'edit' : 'eye')} ${esc(t(label))}</label>`));
      const row = h(`<div class="share-link"><input class="field" readonly><button type="button" class="btn small">${icon('copy')} ${esc(t('common.copy'))}</button></div>`);
      const input = row.querySelector('input');
      input.value = shareLink(share.room, key);
      input.onclick = () => input.select();
      row.querySelector('button').onclick = async (e) => { if (await copyText(input.value)) { e.currentTarget.textContent = t('common.copied'); } };
      body.appendChild(row);
    }
    body.appendChild(h(`<p class="hint">${esc(t('share.note'))}</p>`));

    // Your name + people online.
    body.appendChild(h(`<label class="row" for="share-name">${esc(t('share.your_name'))}</label>`));
    const name = h('<input class="field" id="share-name" maxlength="30">');
    const me = app.awareness.getLocalState().user;
    name.value = me.name;
    name.onchange = () => {
      const user = { ...app.awareness.getLocalState().user, name: name.value.trim().slice(0, 30) || me.name };
      app.awareness.setLocalStateField('user', user);
      try { localStorage.setItem('latex_user', JSON.stringify(user)); } catch { /* ignore */ }
    };
    body.appendChild(name);
    body.appendChild(h(`<label class="row">${icon('users')} ${esc(t('share.people'))}</label>`));
    const ppl = h('<div class="people"></div>');
    for (const p of people(app)) {
      const c = h(`<span class="chip"><span class="swatch"></span><span></span></span>`);
      c.querySelector('.swatch').style.background = p.color;
      c.lastChild.textContent = p.name + (p.me ? ` (${t('share.you')})` : '');
      ppl.appendChild(c);
    }
    body.appendChild(ppl);

    if (share.owner) {
      const a = h(`<div class="actions"><button type="button" class="btn danger">${icon('cloud_off')} ${esc(t('share.stop'))}</button></div>`);
      a.querySelector('button').onclick = async () => {
        if (!(await confirm({ title: t('share.stop'), message: t('share.stop_confirm'), okLabel: t('share.stop'), danger: true }))) return;
        try { await stopSharing(app); toast(t('share.stopped'), 'success'); m.close(); } catch (err) { toast(t('share.unavailable', { err: err.code || err.message }), 'error'); }
      };
      body.appendChild(a);
    }
  };
  render();
  if (app.provider) off = app.provider.on(() => { if (document.body.contains(body) && !body.contains(document.activeElement)) render(); });
  m.done.then(() => off && off());
}

async function startSharing(app) {
  app.flush && app.flush();
  const res = await api('', { method: 'POST', body: Y.encodeStateAsUpdate(app.doc), type: 'application/octet-stream' });
  const { room, edit, view, owner } = await res.json();
  const share = { room, key: owner, role: 'edit', edit, view, owner };
  app.record = await store.patchProject(app.id, { share });
  app.provider = connect(app);
  // Images go up right away (the provider also checks after connecting).
  for (const hsh of app.project.hashes()) app.provider.uploadBlob(hsh);
}

async function stopSharing(app) {
  const share = app.record.share;
  await api('/' + share.room, { method: 'DELETE', key: share.owner });
  if (app.provider) { app.provider.gone = true; app.provider.destroy(); app.provider = null; }
  app.record = await store.patchProject(app.id, { share: null });
  document.getElementById('faces').replaceChildren();
  app.setSaveState();
}
/*#endregion*/

