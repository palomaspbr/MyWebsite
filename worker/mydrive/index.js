/* MyDrive API (everything under /mydrive/api/*): forwards to the single MyDriveStore Durable Object,
   which does the login, the sessions and the storage (see store.js for the routes).
   Here: only same-site requests may change anything (Origin + a custom header, which a cross-site
   form or image can't send). Needs (wrangler.jsonc): MYDRIVE (Durable Object, SQLite class
   MyDriveStore) and the secret MYDRIVE_PASSWORD (Cloudflare dashboard > Worker > Settings). */

export const MYDRIVE_PREFIX = '/mydrive/api/';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function handleMyDrive(request, env) {
  const url = new URL(request.url);
  if (!env.MYDRIVE) return json({ error: 'not_configured' }, 503);

  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('Origin');
    if ((origin && origin !== url.origin) || request.headers.get('X-MyDrive') !== '1') {
      return json({ error: 'forbidden' }, 403);
    }
  }

  const inner = new URL('https://drive/' + url.pathname.slice(MYDRIVE_PREFIX.length));
  const headers = new Headers(request.headers);
  headers.set('X-Client-IP', request.headers.get('CF-Connecting-IP') || 'local');
  headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
  try {
    const stub = env.MYDRIVE.get(env.MYDRIVE.idFromName('drive'));
    return await stub.fetch(new Request(inner, { method: request.method, headers, body: request.body }));
  } catch (err) {
    console.error('mydrive api', err);
    return json({ error: 'server_error' }, 500);
  }
}
