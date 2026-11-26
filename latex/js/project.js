// A LaTeX project is one Yjs document (CRDT), so the same model works offline, across tabs and,
// when shared, between collaborators in real time:
//   doc.getMap('meta')   name, main (file id), compiler, created
//   doc.getMap('files')  id -> Y.Map { path, type: 'text' | 'bin' | 'dir', text: Y.Text (text files),
//                                      hash, size, mime (binary files: bytes live in the blob store) }
// File ids are stable, so renaming or moving a file while someone else types in it keeps their edits.
import { Y } from '../vendor/cm.js';
import { newId, putBlob, putDocState, putProject } from './store.js';

export const TEXT_EXT = new Set(['tex', 'ltx', 'latex', 'bib', 'bst', 'bbx', 'cbx', 'lbx', 'dbx', 'cls', 'sty',
  'clo', 'cfg', 'def', 'fd', 'dtx', 'ins', 'txt', 'md', 'csv', 'tsv', 'dat', 'tikz', 'pgf', 'asy', 'mp', 'gnuplot',
  'gp', 'py', 'r', 'm', 'jl', 'js', 'json', 'xml', 'yaml', 'yml', 'toml', 'ist', 'gst', 'bbl', 'latexmkrc',
  'lua', 'sh', 'bat', 'c', 'h', 'cpp', 'hpp', 'java', 'html', 'css', 'log', 'gitignore', 'rkt', 'sql', 'hs', 'rs', 'go']);

export const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
  webp: 'image/webp', pdf: 'application/pdf', eps: 'application/postscript', bmp: 'image/bmp',
  tif: 'image/tiff', tiff: 'image/tiff', zip: 'application/zip', ttf: 'font/ttf', otf: 'font/otf',
};

export function extOf(path) {
  const base = path.split('/').pop();
  if (base.startsWith('.') && base.indexOf('.', 1) === -1) return base.slice(1).toLowerCase();
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}
export const isTextPath = (path) => TEXT_EXT.has(extOf(path)) || !extOf(path);
export const isImagePath = (path) => ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(extOf(path));
export const mimeOf = (path) => MIME[extOf(path)] || 'application/octet-stream';
export const baseName = (path) => path.split('/').pop();
export const dirName = (path) => { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i); };

/** Clean a user-typed path; returns '' when it isn't acceptable. */
export function cleanPath(p) {
  p = String(p || '').replace(/\\/g, '/').trim().replace(/^\.?\/+/, '').replace(/\/+/g, '/').replace(/\/$/, '');
  if (!p || p.split('/').some((s) => !s.trim() || s === '.' || s === '..')) return '';
  if (/[\u0000-\u001f<>:"|?*]/.test(p)) return '';
  if (p.length > 200) return '';
  return p;
}

/** Decode bytes as UTF-8 text when they look like text (no NULs, valid UTF-8). */
export function bytesToText(bytes, path = '') {
  if (bytes.length > 4 * 1024 * 1024) return null;
  for (let i = 0; i < Math.min(bytes.length, 8000); i++) if (bytes[i] === 0) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); } catch { /* not UTF-8 */ }
  if (TEXT_EXT.has(extOf(path))) {
    // Old projects are often Latin-1: accept it for known text extensions.
    try { return new TextDecoder('windows-1252').decode(bytes); } catch { return null; }
  }
  return null;
}

export class Project {
  constructor(doc) {
    this.doc = doc;
    this.meta = doc.getMap('meta');
    this.files = doc.getMap('files');
  }

  get name() { return this.meta.get('name') || 'Untitled'; }
  set name(v) { this.meta.set('name', String(v).slice(0, 120)); }
  get compiler() { return this.meta.get('compiler') || 'pdflatex'; }
  set compiler(v) { this.meta.set('compiler', v); }
  get mainId() {
    const id = this.meta.get('main');
    const m = id && this.files.get(id);
    if (m && m.get('type') === 'text') return id;
    // Fallback: main.tex, else the first .tex file with \documentclass, else the first .tex file.
    const texts = this.entries().filter((e) => e.type === 'text' && extOf(e.path) === 'tex');
    const byName = texts.find((e) => e.path === 'main.tex');
    if (byName) return byName.id;
    const withClass = texts.find((e) => /\\documentclass/.test(e.text.toString()));
    return (withClass || texts[0] || {}).id || null;
  }
  set mainId(id) { this.meta.set('main', id); }

  /** All entries, sorted by path. */
  entries() {
    const out = [];
    this.files.forEach((m, id) => {
      const path = m.get('path');
      if (typeof path !== 'string') return;
      out.push({ id, path, type: m.get('type'), text: m.get('text'), hash: m.get('hash'), size: m.get('size'), mime: m.get('mime'), map: m });
    });
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }
  fileEntries() { return this.entries().filter((e) => e.type !== 'dir'); }
  get(id) {
    const m = this.files.get(id);
    if (!m) return null;
    return { id, path: m.get('path'), type: m.get('type'), text: m.get('text'), hash: m.get('hash'), size: m.get('size'), mime: m.get('mime'), map: m };
  }
  byPath(path) { return this.entries().find((e) => e.path === path) || null; }

  /** Every folder path: explicit (empty) folders plus the parents of every file. */
  folders() {
    const set = new Set();
    for (const e of this.entries()) {
      if (e.type === 'dir') set.add(e.path);
      let d = dirName(e.path);
      while (d) { set.add(d); d = dirName(d); }
    }
    return set;
  }
  exists(path) { return !!this.byPath(path) || this.folders().has(path); }

  /** A free path near `path` ("fig.png" -> "fig (2).png"). */
  freePath(path) {
    if (!this.exists(path)) return path;
    const dir = dirName(path); const base = baseName(path);
    const i = base.lastIndexOf('.');
    const stem = i > 0 ? base.slice(0, i) : base; const ext = i > 0 ? base.slice(i) : '';
    for (let n = 2; n < 1000; n++) {
      const p = (dir ? dir + '/' : '') + `${stem} (${n})${ext}`;
      if (!this.exists(p)) return p;
    }
    return path + '-' + Date.now();
  }

  createText(path, content = '') {
    const id = newId();
    this.doc.transact(() => {
      const m = new Y.Map();
      m.set('path', path);
      m.set('type', 'text');
      m.set('text', new Y.Text(content));
      this.files.set(id, m);
    });
    return id;
  }

  /** Add or replace a binary file (bytes must already be in the blob store). */
  putBinary(path, { hash, size, type }) {
    const cur = this.byPath(path);
    if (cur && cur.type === 'bin') {
      this.doc.transact(() => { cur.map.set('hash', hash); cur.map.set('size', size); cur.map.set('mime', type); });
      return cur.id;
    }
    const id = newId();
    this.doc.transact(() => {
      const m = new Y.Map();
      m.set('path', path);
      m.set('type', 'bin');
      m.set('hash', hash);
      m.set('size', size);
      m.set('mime', type);
      this.files.set(id, m);
    });
    return id;
  }

  createFolder(path) {
    const id = newId();
    this.doc.transact(() => {
      const m = new Y.Map();
      m.set('path', path);
      m.set('type', 'dir');
      this.files.set(id, m);
    });
    return id;
  }

  /** Rename/move a file (by id) or a folder (by path, with everything inside). */
  renameFile(id, newPath) {
    const m = this.files.get(id);
    if (m) m.set('path', newPath);
  }
  renameFolder(oldPath, newPath) {
    this.doc.transact(() => {
      for (const e of this.entries()) {
        if (e.path === oldPath && e.type === 'dir') e.map.set('path', newPath);
        else if (e.path.startsWith(oldPath + '/')) e.map.set('path', newPath + e.path.slice(oldPath.length));
      }
      if (!this.entries().some((e) => e.path === newPath || e.path.startsWith(newPath + '/'))) this.createFolder(newPath);
    });
  }
  deleteFile(id) { this.files.delete(id); }
  deleteFolder(path) {
    this.doc.transact(() => {
      for (const e of this.entries()) if (e.path === path || e.path.startsWith(path + '/')) this.files.delete(e.id);
    });
  }

  /** Hashes of every binary file (for blob garbage collection and sharing). */
  hashes() { return new Set(this.fileEntries().filter((e) => e.type === 'bin').map((e) => e.hash)); }
}

/** Build a brand-new project document from plain files and save it. Returns the project record.
 *  files: [{path, content: string} | {path, bytes: Uint8Array}] */
export async function createProject({ name, files, main, compiler = 'pdflatex', share = null }) {
  const doc = new Y.Doc();
  const project = new Project(doc);
  const blobs = [];
  for (const f of files) if (f.bytes) blobs.push({ f, info: await putBlob(f.bytes, mimeOf(f.path)) });
  let mainId = null;
  doc.transact(() => {
    project.name = name;
    project.compiler = compiler;
    project.meta.set('created', Date.now());
    for (const f of files) {
      if (f.dir) { project.createFolder(f.path); continue; }
      if (f.bytes) continue;
      const id = project.createText(f.path, f.content);
      if (f.path === main) mainId = id;
    }
    for (const { f, info } of blobs) project.putBinary(f.path, info);
    if (mainId) project.mainId = mainId;
  });
  const id = newId();
  const now = Date.now();
  const record = { id, name: project.name, created: now, updated: now, opened: 0, share };
  await putDocState(id, Y.encodeStateAsUpdate(doc));
  await putProject(record);
  doc.destroy();
  return record;
}

/** Plain copy of every file (text content or blob hash) — used by compile, zip export and duplicate. */
export function snapshot(project) {
  return project.entries().map((e) => (e.type === 'text'
    ? { path: e.path, type: 'text', content: e.text.toString() }
    : e.type === 'bin' ? { path: e.path, type: 'bin', hash: e.hash, size: e.size, mime: e.mime } : { path: e.path, type: 'dir' }));
}
