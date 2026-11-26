// IndexedDB storage for LaTeX Notebook. Everything stays in this browser.
//   projects  {id, name, created, updated, opened, share?: {room, key, role}}   project list (dashboard)
//   docs      {id, state: Uint8Array}       the project's Yjs document (Y.encodeStateAsUpdate)
//   blobs     {hash, data: Blob, type, size} binary files (images, PDFs...), content-addressed by SHA-256
//   pdfs      {id, pdf: Blob, at, ms}        last compiled PDF of each project
//   history   {key: [id, at], id, at, label, state}  saved versions (snapshots of the Yjs doc)

const DB_NAME = 'latex-notebook';
const DB_VERSION = 1;
let dbPromise = null;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'hash' });
      if (!db.objectStoreNames.contains('pdfs')) db.createObjectStore('pdfs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('history')) {
        const h = db.createObjectStore('history', { keyPath: ['id', 'at'] });
        h.createIndex('byProject', 'id');
      }
    };
    r.onsuccess = () => {
      const db = r.result;
      // Another tab upgraded the schema: let it, and reload this one on next use.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result;
    Promise.resolve(fn(t.objectStore(store), t)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });
}

const get = (store, key) => tx(store, 'readonly', (s) => req(s.get(key)));
const put = (store, value) => tx(store, 'readwrite', (s) => req(s.put(value)));
const del = (store, key) => tx(store, 'readwrite', (s) => req(s.delete(key)));
const all = (store) => tx(store, 'readonly', (s) => req(s.getAll()));

/*#region Projects*/
export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(b, (x) => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join('');
}

export async function listProjects() {
  const list = await all('projects');
  return list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}
export const getProject = (id) => get('projects', id);
export const putProject = (p) => put('projects', p);
export async function patchProject(id, patch) {
  return tx('projects', 'readwrite', async (s) => {
    const cur = await req(s.get(id));
    if (!cur) return null;
    const next = { ...cur, ...patch };
    await req(s.put(next));
    return next;
  });
}

/** Delete a project and everything that belongs to it (blobs are garbage-collected separately). */
export async function deleteProject(id) {
  await del('projects', id);
  await del('docs', id);
  await del('pdfs', id);
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const t = db.transaction('history', 'readwrite');
    const idx = t.objectStore('history').index('byProject');
    const c = idx.openKeyCursor(IDBKeyRange.only(id));
    c.onsuccess = () => { const cur = c.result; if (cur) { t.objectStore('history').delete(cur.primaryKey); cur.continue(); } };
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}
/*#endregion*/

/*#region Yjs documents*/
export async function getDocState(id) {
  const r = await get('docs', id);
  return r ? r.state : null;
}
export const putDocState = (id, state) => put('docs', { id, state });
/*#endregion*/

/*#region Blobs*/
export async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Store bytes and return their hash. */
export async function putBlob(data, type = 'application/octet-stream') {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const hash = await sha256(buf);
  const existing = await get('blobs', hash);
  if (!existing) await put('blobs', { hash, data: new Blob([buf], { type }), type, size: buf.byteLength });
  return { hash, size: buf.byteLength, type };
}
export async function getBlob(hash) {
  const r = await get('blobs', hash);
  return r ? r.data : null;
}
export async function hasBlob(hash) {
  const db = await openDb();
  return new Promise((resolve) => {
    const r = db.transaction('blobs').objectStore('blobs').getKey(hash);
    r.onsuccess = () => resolve(r.result !== undefined);
    r.onerror = () => resolve(false);
  });
}
/** Remove blobs no project refers to. `used` is a Set of hashes still referenced. */
export async function gcBlobs(used) {
  const db = await openDb();
  return new Promise((resolve) => {
    let removed = 0;
    const t = db.transaction('blobs', 'readwrite');
    const c = t.objectStore('blobs').openKeyCursor();
    c.onsuccess = () => {
      const cur = c.result;
      if (!cur) return;
      if (!used.has(cur.key)) { t.objectStore('blobs').delete(cur.key); removed++; }
      cur.continue();
    };
    t.oncomplete = () => resolve(removed);
    t.onerror = () => resolve(removed);
  });
}
/*#endregion*/

/*#region PDFs*/
export const getPdf = (id) => get('pdfs', id);
export const putPdf = (id, pdf, ms) => put('pdfs', { id, pdf, at: Date.now(), ms });
/*#endregion*/

/*#region History (saved versions)*/
export const putVersion = (id, label, state, auto = false) => put('history', { id, at: Date.now(), label, state, auto });
export async function listVersions(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction('history').objectStore('history').index('byProject').getAll(IDBKeyRange.only(id));
    r.onsuccess = () => resolve(r.result.sort((a, b) => b.at - a.at));
    r.onerror = () => reject(r.error);
  });
}
export const deleteVersion = (id, at) => del('history', [id, at]);
/*#endregion*/

/** Rough storage usage, for the dashboard footer. */
export async function estimate() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}
export async function persist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
  return false;
}
