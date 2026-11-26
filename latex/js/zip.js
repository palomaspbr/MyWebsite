// Import / export projects as .zip (fflate).
import { zipSync, unzipSync, strToU8 } from '../vendor/fflate.js';
import { getBlob } from './store.js';
import { bytesToText, cleanPath, extOf } from './project.js';

/** files: snapshot() entries. Returns a Blob. */
export async function exportZip(files, extra = {}) {
  const out = {};
  for (const f of files) {
    if (f.type === 'dir') { out[f.path + '/'] = new Uint8Array(0); continue; }
    if (f.type === 'text') out[f.path] = strToU8(f.content);
    else {
      const b = await getBlob(f.hash);
      if (b) out[f.path] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }];
    }
  }
  for (const [p, data] of Object.entries(extra)) out[p] = [data, { level: 0 }];
  return new Blob([zipSync(out, { level: 6 })], { type: 'application/zip' });
}

const SKIP = /(^|\/)(__MACOSX|\.git|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)|\.(aux|log|out|toc|lof|lot|fls|fdb_latexmk|synctex\.gz|synctex|bbl|blg|nav|snm|vrb|run\.xml|bcf|xdv|dvi)$/i;

/** Unzip into [{path, content} | {path, bytes}]; drops build leftovers and strips a single top folder. */
export function importZip(buf) {
  const entries = unzipSync(new Uint8Array(buf));
  let files = [];
  for (const [rawPath, data] of Object.entries(entries)) {
    if (rawPath.endsWith('/')) continue;
    if (SKIP.test(rawPath)) continue;
    const path = cleanPath(rawPath);
    if (!path) continue;
    files.push({ path, data });
  }
  // "project/main.tex, project/refs.bib" -> "main.tex, refs.bib"
  const tops = new Set(files.map((f) => f.path.split('/')[0]));
  if (tops.size === 1 && files.every((f) => f.path.includes('/'))) {
    const top = [...tops][0] + '/';
    files = files.map((f) => ({ ...f, path: f.path.slice(top.length) }));
  }
  return files.map(({ path, data }) => toFile(path, data));
}

/** Decide whether bytes are an editable text file. */
export function toFile(path, data) {
  const ext = extOf(path);
  const binaryExt = ['png', 'jpg', 'jpeg', 'gif', 'pdf', 'eps', 'ps', 'svg', 'webp', 'bmp', 'tif', 'tiff', 'zip', 'ttf', 'otf', 'woff', 'woff2', 'gz', 'xlsx', 'docx', 'mp4'];
  if (!binaryExt.includes(ext)) {
    const text = bytesToText(data, path);
    if (text !== null) return { path, content: text };
  }
  return { path, bytes: data };
}

/** Pick the main file: main.tex, else a .tex with \documentclass (shortest path first). */
export function guessMain(files) {
  const tex = files.filter((f) => f.content !== undefined && extOf(f.path) === 'tex');
  const withClass = tex.filter((f) => /^[^%\n]*\\documentclass/m.test(f.content)).sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.length - b.path.length);
  const named = withClass.find((f) => /(^|\/)main\.tex$/.test(f.path));
  return (named || withClass[0] || tex.find((f) => /(^|\/)main\.tex$/.test(f.path)) || tex[0] || {}).path || null;
}
