/* LaTeX Notebook sharing API (everything under /latex/api/*). Docs: C:\latex\docs\COLLAB.md.
   Compiling never goes through here (the browser calls the LaTeX-on-HTTP server directly):
   this is only for shared projects, one LatexRoom Durable Object each.

   POST   /latex/api/rooms                    body: initial Yjs snapshot -> {room, edit, view, owner}
   GET    /latex/api/rooms/:room/ws           WebSocket (the key is sent in the first message)
   GET    /latex/api/rooms/:room/info         Authorization: Bearer <key> -> {role, seq, sizes, limits}
   DELETE /latex/api/rooms/:room              owner key: stop sharing (deletes everything)
   POST   /latex/api/rooms/:room/update       big update (> 900 KB) that doesn't fit a WebSocket frame
   GET    /latex/api/rooms/:room/update/:seq  fetch such an update
   POST   /latex/api/rooms/:room/compact?seq= full snapshot replacing the log up to seq
   POST   /latex/api/rooms/:room/blobs/check  {hashes} -> {missing}
   GET|PUT /latex/api/rooms/:room/blobs/:sha256  binary files

   Needs (wrangler.jsonc): LATEX_ROOM (Durable Object namespace, SQLite-backed class LatexRoom). */

import { sha256Hex } from './room.js';

export const LATEX_PREFIX = '/latex/api/';
const ROOM_RE = /^[A-Za-z0-9_-]{22}$/;
const CREATE_PER_HOUR = 20; // per IP, soft limit (Cache API, per data centre)

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function token(bytes = 16) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function tooManyCreates(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const hour = Math.floor(Date.now() / 3600e3);
  const key = new Request(`https://latex-room-limit.invalid/${encodeURIComponent(ip)}/${hour}`);
  try {
    const cache = caches.default;
    const hit = await cache.match(key);
    const n = hit ? Number(await hit.text()) || 0 : 0;
    if (n >= CREATE_PER_HOUR) return true;
    await cache.put(key, new Response(String(n + 1), { headers: { 'Cache-Control': 'max-age=3600' } }));
  } catch { /* no cache (local dev): no limit */ }
  return false;
}

export async function handleLatex(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.slice(LATEX_PREFIX.length).split('/').filter(Boolean);
  if (!env.LATEX_ROOM) return json({ error: 'sharing_not_configured' }, 503);
  try {
    if (parts[0] !== 'rooms') return json({ error: 'not_found' }, 404);

    if (parts.length === 1 && request.method === 'POST') {
      if (await tooManyCreates(request)) return json({ error: 'too_many_rooms' }, 429);
      const body = await request.arrayBuffer();
      if (!body.byteLength) return json({ error: 'empty' }, 400);
      const room = token(16).slice(0, 22);
      const keys = { edit: token(18), view: token(18), owner: token(18) };
      const hashes = { edit: await sha256Hex(keys.edit), view: await sha256Hex(keys.view), owner: await sha256Hex(keys.owner) };
      const stub = env.LATEX_ROOM.get(env.LATEX_ROOM.idFromName(room));
      const res = await stub.fetch('https://room/__init', { method: 'POST', headers: { 'X-Room-Keys': JSON.stringify(hashes) }, body });
      if (!res.ok) return new Response(res.body, { status: res.status, headers: res.headers });
      return json({ room, ...keys }, 201);
    }

    const room = parts[1];
    if (!ROOM_RE.test(room || '')) return json({ error: 'not_found' }, 404);
    const rest = '/' + parts.slice(2).join('/');
    const stub = env.LATEX_ROOM.get(env.LATEX_ROOM.idFromName(room));
    const inner = new URL('https://room' + (rest === '/' ? '/' : rest.replace(/\/$/, '')));
    inner.search = url.search;
    return await stub.fetch(new Request(inner, request));
  } catch (err) {
    console.error('latex api', err);
    return json({ error: 'server_error' }, 500);
  }
}
