// Compiling: the browser sends the project straight to a LaTeX-on-HTTP server (default: the public
// instance at latex.ytotech.com, full TeX Live, latexmk runs bibtex/biber and reruns as needed).
// No server of ours is involved, and the quota is counted per visitor IP, not per site.
//
// That public instance has a fair-use quota per IP (calendar-aligned UTC windows):
//   2 / second, 6 / minute, 40 / hour, 150 / day, 400 / week.
// Going over it returns 429, and insisting gets the IP banned (1 h, then 24 h). So this module keeps
// its own count of the requests sent from this browser (localStorage, shared by all tabs) and refuses
// locally, with a countdown, before the server would. A 429 from the server (other devices behind the
// same IP) blocks compiling until its retry_after has passed. Never retry automatically.
import { getBlob } from './store.js';
import { dirName } from './project.js';

export const DEFAULT_ENDPOINT = 'https://latex.ytotech.com/builds/sync';
export const COMPILERS = ['pdflatex', 'xelatex', 'lualatex'];
const LIMITS = [
  { key: 'second', ms: 1000, max: 2 },
  { key: 'minute', ms: 60000, max: 6 },
  { key: 'hour', ms: 3600000, max: 40 },
  { key: 'day', ms: 86400000, max: 150 },
  { key: 'week', ms: 7 * 86400000, max: 400, offset: 4 * 86400000 }, // weeks start on Monday 00:00 UTC
];
const LOG_KEY = 'latex_compile_times';
const BLOCK_KEY = 'latex_compile_block_until';
const ENDPOINT_KEY = 'latex_endpoint';

function readJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function writeJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }

export function getEndpoint() {
  try { return localStorage.getItem(ENDPOINT_KEY) || DEFAULT_ENDPOINT; } catch { return DEFAULT_ENDPOINT; }
}
export function setEndpoint(url) {
  try {
    if (!url || url === DEFAULT_ENDPOINT) localStorage.removeItem(ENDPOINT_KEY);
    else localStorage.setItem(ENDPOINT_KEY, url);
  } catch { /* ignore */ }
}
const usesPublicQuota = () => getEndpoint() === DEFAULT_ENDPOINT;

const windowStart = (now, l) => Math.floor((now - (l.offset || 0)) / l.ms) * l.ms + (l.offset || 0);

/** How many compiles are left and how long to wait if none: {ok, waitMs, reason, used:{minute,hour,day}}. */
export function quota(now = Date.now()) {
  const used = {};
  const block = readJSON(BLOCK_KEY, 0);
  if (!usesPublicQuota()) return { ok: true, waitMs: 0, used, limits: null };
  const times = readJSON(LOG_KEY, []);
  let waitMs = 0; let reason = null;
  for (const l of LIMITS) {
    const start = windowStart(now, l);
    const n = times.filter((t) => t >= start).length;
    used[l.key] = { n, max: l.max };
    if (n >= l.max) {
      const w = start + l.ms - now;
      if (w > waitMs) { waitMs = w; reason = l.key; }
    }
  }
  if (block > now && block - now > waitMs) { waitMs = block - now; reason = 'server'; }
  return { ok: waitMs <= 0, waitMs, reason, used, limits: LIMITS };
}

function recordSend(now = Date.now()) {
  const weekAgo = now - 8 * 86400000;
  const times = readJSON(LOG_KEY, []).filter((t) => t > weekAgo);
  times.push(now);
  writeJSON(LOG_KEY, times.slice(-450));
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Path of `path` as seen from the folder of the main file. */
export function relativeTo(mainDir, path) {
  if (!mainDir) return path;
  const a = mainDir.split('/'); const b = path.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return '../'.repeat(a.length - i) + b.slice(i).join('/');
}

export class CompileError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); }
}

/**
 * Compile. files: snapshot() entries; mainPath: the main .tex file.
 * Resolves {pdf: Blob, ms} or rejects with CompileError kind:
 *   'latex'   (compilation failed: .log, .logs)      'quota' (.waitMs, .local)
 *   'network' (offline / server unreachable)         'server' (anything else: .status, .detail)
 *   'abort'
 */
export async function compile({ files, mainPath, compiler = 'pdflatex', haltOnError = true, signal }) {
  const q = quota();
  if (!q.ok) throw new CompileError('quota', 'quota', { waitMs: q.waitMs, reason: q.reason, local: q.reason !== 'server' });

  const mainDir = dirName(mainPath);
  const resources = [];
  let bytes = 0;
  for (const f of files) {
    if (f.type === 'dir') continue;
    if (f.path === mainPath) {
      resources.unshift({ main: true, content: f.content });
      bytes += f.content.length;
    } else if (f.type === 'text') {
      resources.push({ path: relativeTo(mainDir, f.path), content: f.content });
      bytes += f.content.length;
    } else {
      const blob = await getBlob(f.hash);
      if (!blob) continue; // shared project whose image hasn't arrived yet: compile without it
      resources.push({ path: relativeTo(mainDir, f.path), file: await blobToBase64(blob) });
      bytes += blob.size * 1.34;
    }
  }
  if (!resources.length || !resources[0].main) throw new CompileError('server', 'no main file', { detail: 'NO_MAIN' });

  const body = JSON.stringify({
    compiler,
    resources,
    options: {
      compiler: { halt_on_error: !!haltOnError, bibliography: true },
      response: { log_files_on_failure: true },
    },
  });

  const t0 = performance.now();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 240000);
  const onAbort = () => timeout.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  let res;
  recordSend();
  try {
    res = await fetch(getEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: timeout.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (signal && signal.aborted) throw new CompileError('abort', 'aborted');
    if (timeout.signal.aborted) throw new CompileError('network', 'timeout', { timeout: true });
    throw new CompileError('network', String(e && e.message || e), { offline: !navigator.onLine });
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }

  try {
    const ms = Math.round(performance.now() - t0);
    const type = res.headers.get('Content-Type') || '';
    if (res.ok && type.includes('pdf')) {
      return { pdf: await res.blob(), ms, bytes };
    }
    let json = null;
    try { json = type.includes('json') ? await res.json() : null; } catch { /* not JSON */ }
    if (res.status === 429) {
      const retry = (json && json.quota && json.quota.retry_after) || 60;
      writeJSON(BLOCK_KEY, Date.now() + retry * 1000);
      throw new CompileError('quota', 'quota', { waitMs: retry * 1000, reason: 'server', banned: !!(json && json.quota && json.quota.banned), local: false });
    }
    if (json && json.error === 'COMPILATION_ERROR') {
      const logFiles = json.log_files || {};
      const mainLog = Object.keys(logFiles).find((k) => k.endsWith('.log'));
      throw new CompileError('latex', 'compilation failed', {
        log: mainLog ? logFiles[mainLog] : '', logs: json.logs || '', ms, duration: json.duration,
      });
    }
    let detail = json ? (json.error || '') + (json.message ? ': ' + json.message : '') : '';
    if (!detail) { try { detail = (await res.text()).slice(0, 300); } catch { detail = ''; } }
    throw new CompileError('server', 'HTTP ' + res.status, { status: res.status, detail });
  } finally {
    clearTimeout(timer);
  }
}
