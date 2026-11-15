/* Shared helpers for the karaoke API: the original JSON envelope {success, data, error, message},
   body parsing, ids, constant-time compare and hashing. */

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export function json(status, body, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(extraHeaders || {})
    }
  });
}

function envelope(success, fields) {
  const out = { success };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

export const ok = (data) => json(200, envelope(true, { data }));
export const okMessage = (data, message) => json(200, envelope(true, { data, message }));
export const message = (msg) => json(200, envelope(true, { message: msg }));
export const fail = (status, error, data, headers) => json(status, envelope(false, { error, data }), headers);

export function errorResponse(e) {
  if (e instanceof ApiError) {
    const headers = e.data && e.data.retry_after ? { 'Retry-After': String(e.data.retry_after) } : undefined;
    return fail(e.status, e.message, e.data, headers);
  }
  console.error('karaoke api error', e && e.stack || e);
  return fail(500, 'Internal error');
}

// Parsed JSON body; {} for an empty body; null when the body is not valid JSON.
export async function readBody(request) {
  let text = '';
  try { text = await request.text(); } catch (e) { return null; }
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch (e) {
    return null;
  }
}

export const uuid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'local';
}

export function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const str = (v) => (typeof v === 'string' ? v : '');
export const capitalizeFirst = (s) => {
  const t = String(s || '').trim();
  if (!t) return '';
  const chars = Array.from(t);
  return chars[0].toUpperCase() + chars.slice(1).join('');
};
