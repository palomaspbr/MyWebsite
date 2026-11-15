// End-to-end smoke test of the karaoke API against a running `wrangler dev`.
//   npx wrangler dev --port 8788 --var KARAOKE_ADMIN_PASSWORD:test-catalog-pw
//   node tests/karaoke/api_smoke.mjs [http://localhost:8788]
// Uses the real YouTube (search, video info), so it needs internet access.

const BASE = process.argv[2] || 'http://localhost:8788';
const CATALOG_PW = 'test-catalog-pw';
let failures = 0;
let freshSongs = 0; // songs this run actually added (others already existed in the catalog)

function check(cond, label, extra) {
  if (cond) console.log('  ok   ' + label);
  else { failures++; console.log('  FAIL ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

async function call(method, path, { body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* not json */ }
  return { status: res.status, json };
}

function openSocket(code) {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + `/karaoke/api/r/${code}/ws`);
  const messages = [];
  const waiters = [];
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    messages.push(msg);
    for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  });
  const opened = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const closed = new Promise(res => ws.addEventListener('close', ev => res(ev.code)));
  const next = (pred, ms = 5000) => {
    const found = messages.find(pred);
    if (found) { messages.splice(messages.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error('timeout')); } }, ms);
    });
  };
  return { ws, opened, closed, next, messages };
}

async function addSong(code, videoId, title, artist, user = 'Ana') {
  const d = await call('POST', `/karaoke/api/r/${code}/youtube/download`, { body: { video_id: videoId, user_name: user } });
  if (d.json?.data?.job?.status === 'completed') return d.json.data.job.result;
  const s = await call('POST', `/karaoke/api/r/${code}/youtube/submit-metadata`, {
    body: { video_id: videoId, title, artist, language: 'EN', lyrics_start: '', user_name: user }
  });
  if (s.json?.data?.job?.result) freshSongs++;
  return s.json?.data?.job?.result;
}

async function main() {
  console.log('Karaoke API smoke test against ' + BASE);

  console.log('\nRooms');
  const created = await call('POST', '/karaoke/api/rooms', { body: {} });
  check(created.status === 200 && /^[A-HJ-NP-Z]{4}$/.test(created.json?.data?.code), 'create room', created);
  const code = created.json.data.code;
  const host = { 'X-Host-Key': created.json.data.host_key };
  const R = (p) => `/karaoke/api/r/${code}${p}`;
  check((await call('GET', R('/room'))).status === 200, 'room exists');
  const missing = await call('GET', '/karaoke/api/r/ZZZZ/queue');
  check(missing.status === 404 && missing.json?.data?.code === 'room_not_found', 'unknown room -> 404 room_not_found', missing);
  const roomHost = await call('GET', R('/room'), { headers: host });
  check(roomHost.json?.data?.is_host === true, 'host key recognised');

  console.log('\nConfig + DJ PIN');
  let cfg = await call('GET', R('/config'));
  check(cfg.json?.data?.queue_strategy === 'fifo' && cfg.json?.data?.is_admin === true, 'default config, no PIN = admin', cfg.json);
  check((await call('PUT', R('/config'), { body: { queue_strategy: 'nope' } })).status === 400, 'invalid enum rejected');
  check((await call('PUT', R('/config'), { body: { admin_pin: '12' } })).status === 400, 'short PIN rejected');
  check((await call('PUT', R('/config'), { body: { admin_pin: '4321', queue_strategy: 'fair' }, headers: host })).status === 200, 'host sets PIN + fair');
  cfg = await call('GET', R('/config'));
  check(cfg.json?.data?.admin_pin_set === true && cfg.json?.data?.is_admin === false && !('admin_pin' in cfg.json.data), 'PIN set, guest not admin, PIN hidden', cfg.json);
  const noPin = await call('POST', R('/admin/verify'));
  check(noPin.status === 401 && noPin.json?.data?.code === 'admin_pin_required', 'admin_pin_required', noPin);
  const badPin = await call('POST', R('/admin/verify'), { headers: { 'X-Admin-Pin': '0000' } });
  check(badPin.status === 401 && badPin.json?.data?.code === 'admin_pin_invalid', 'admin_pin_invalid', badPin);
  check((await call('POST', R('/admin/verify'), { headers: { 'X-Admin-Pin': '4321' } })).status === 200, 'correct PIN accepted');

  console.log('\nCatalog + YouTube');
  const search = await call('GET', R('/youtube/search?q=' + encodeURIComponent('dancing queen abba')));
  check(search.status === 200 && Array.isArray(search.json?.data) && search.json.data.length > 0, 'youtube search returns results', search.json?.error);
  const results = search.json?.data || [];
  const r0 = results[0] || {};
  check(r0.video_id && r0.title && r0.thumbnail_url, 'search result shape', r0);
  const dl = await call('POST', R('/youtube/download'), { body: { video_id: r0.video_id, user_name: 'Ana' } });
  const job = dl.json?.data?.job;
  check(dl.status === 200 && job && ['confirm_metadata', 'completed'].includes(job.status), 'download -> confirm_metadata job', dl.json);
  if (job?.status === 'confirm_metadata') {
    console.log('       extracted: ' + JSON.stringify({ artist: job.data.extracted_artist, title: job.data.extracted_title, lang: job.data.extracted_language }));
  }
  const songs = [];
  for (const r of results.slice(0, 6)) {
    const s = await addSong(code, r.video_id, r.title.slice(0, 40), 'Test Artist ' + songs.length);
    if (s) songs.push(s);
  }
  check(songs.length >= 4, 'added >= 4 songs to the catalog', songs.length);
  check(songs.every(s => s.code >= 1001), 'songs have codes');
  const byCode = await call('GET', R('/catalog/code/' + songs[0].code));
  check(byCode.json?.data?.id === songs[0].id, 'lookup by song code');
  const cat = await call('GET', R('/catalog'));
  check(cat.json?.data?.length >= songs.length, 'catalog lists songs');
  const srch = await call('GET', R('/catalog/search?q=' + encodeURIComponent(songs[0].title.slice(0, 6))));
  check(srch.json?.data?.some(s => s.id === songs[0].id), 'catalog search finds song');
  const mine = await call('GET', R('/catalog/my-downloads?user=Ana'));
  check(Array.isArray(mine.json?.data) && mine.json.data.length >= Math.min(freshSongs, 1), 'my-downloads (' + freshSongs + ' new songs this run)', mine.json);
  check((await call('GET', R('/languages'))).json?.data?.length >= 10, 'default languages');

  console.log('\nCatalog admin');
  const noKey = await call('PUT', R('/catalog/songs/' + songs[0].id), { body: { title: 'X' } });
  check(noKey.status === 401 && noKey.json?.data?.code === 'catalog_key_required', 'catalog_key_required', noKey);
  const ck = { 'X-Catalog-Key': CATALOG_PW };
  const upd = await call('PUT', R('/catalog/songs/' + songs[0].id), { body: { title: 'my edited title', video_kind: 'karaoke' }, headers: ck });
  check(upd.json?.data?.title === 'My Edited Title' && upd.json?.data?.video_kind_source === 'dj', 'edit song (title case, dj kind)', upd.json);
  const ver = await call('POST', R('/catalog/songs/' + songs[0].id + '/verify'), { body: { lyrics_start: 'hello there' }, headers: ck });
  check(ver.json?.data?.metadata_verified === true && ver.json?.data?.lyrics_start === 'Hello there', 'verify song', ver.json);
  const review = await call('GET', R('/catalog/review'), { headers: ck });
  check(review.status === 200 && review.json?.data?.counts && Array.isArray(review.json.data.items), 'review queue', review.json?.error);
  const sugg = await call('GET', R('/catalog/songs/' + songs[1].id + '/suggestions'), { headers: ck });
  check(sugg.status === 200 && sugg.json?.data, 'suggestions computed on demand', sugg.json?.error);
  if (sugg.json?.data) console.log('       suggestion keys: ' + Object.keys(sugg.json.data).join(', '));

  console.log('\nQueue + WebSocket');
  const sock = openSocket(code);
  await sock.opened;
  const init = await sock.next(m => m.type === 'init');
  check(init.payload?.action === 'init' && Array.isArray(init.payload.queue), 'ws init');
  sock.ws.send(JSON.stringify({ type: 'register_user', payload: { user_name: 'Ana', client_id: 'dev-ana' } }));
  sock.ws.send(JSON.stringify({ type: 'ping' }));
  check((await sock.next(m => m.type === 'pong')).type === 'pong', 'ping -> pong');
  await new Promise(r => setTimeout(r, 200));
  const players = await call('GET', R('/users'));
  check(players.json?.data?.some(p => p.name === 'Ana' && p.status === 'active'), 'Ana active in roster', players.json);
  const claim = await call('POST', R('/users/check'), { body: { user_name: 'Ana', client_id: 'other-phone' } });
  check(claim.status === 409 && claim.json?.data?.status === 'active_conflict', 'name held online -> active_conflict', claim.json);
  const claimOwn = await call('POST', R('/users/check'), { body: { user_name: 'Ana', client_id: 'dev-ana' } });
  check(claimOwn.json?.data?.status === 'ok', 'same device -> ok');

  // Fair play: Ana, Ana, Bob -> Bob is inserted before Ana's second song.
  const q1 = await call('POST', R('/queue'), { body: { song_id: songs[0].id, user_name: 'Ana' } });
  check(q1.status === 200, 'queue add', q1.json);
  check((await sock.next(m => m.type === 'queue_update' && m.payload.action === 'add')).payload.activity?.user_name === 'Ana', 'ws queue_update add with activity');
  await call('POST', R('/queue'), { body: { song_id: songs[1].id, user_name: 'Ana' } });
  await call('POST', R('/queue'), { body: { song_id: songs[2].id, user_name: 'Bob', register_player: true } });
  let q = (await call('GET', R('/queue'))).json.data;
  check(q.queue.map(i => i.user_name).join(',') === 'Ana,Bob,Ana', 'fair play order Ana,Bob,Ana', q.queue.map(i => i.user_name));
  check((await call('POST', R('/queue'), { body: { song_id: songs[0].id, user_name: 'Bob' } })).status === 409, 'duplicate song -> 409');

  // Ownership: Bob (jukebox singer, no device) song can't be removed by a guest with a wrong client id.
  const bobItem = q.queue.find(i => i.user_name === 'Bob');
  const rm = await call('DELETE', R('/queue/' + bobItem.id), { body: { user_name: 'Eve', client_id: 'eve' } });
  check(rm.status === 403 && rm.json?.data?.code === 'not_owner', 'remove someone else\'s song -> not_owner', rm.json);

  // Rearrange own songs (Ana's two songs swap; Bob stays in the middle).
  const anaFirst = q.queue[0];
  const re = await call('POST', R('/queue/' + anaFirst.id + '/rearrange'), { body: { direction: 'later', client_id: 'dev-ana' } });
  check(re.json?.data?.moved === true, 'rearrange own songs', re.json);
  q = (await call('GET', R('/queue'))).json.data;
  check(q.queue[2].id === anaFirst.id && q.queue[1].user_name === 'Bob', 'rearrange kept Bob in place');

  // Playback.
  const play = await call('POST', R('/queue/play'));
  check(play.json?.data?.status === 'playing', 'play next', play.json);
  const pu = await sock.next(m => m.type === 'queue_update' && m.payload.action === 'play');
  check(pu.payload.now_playing?.id === play.json.data.id && pu.payload.is_playing === true, 'ws play update');
  check((await call('POST', R('/queue/pause'))).status === 200, 'pause');
  check((await sock.next(m => m.type === 'queue_update' && m.payload.action === 'pause')).payload.is_playing === false, 'ws pause');
  sock.ws.send(JSON.stringify({ type: 'player_action', payload: { action: 'toggle_play' } }));
  check((await sock.next(m => m.type === 'queue_update' && m.payload.action === 'resume')).payload.is_playing === true, 'ws toggle_play -> resume');
  const sk = await call('POST', R('/queue/skip'), { body: { user_name: 'DJ' } });
  check(sk.status === 200, 'skip');
  check((await sock.next(m => m.type === 'queue_update' && m.payload.action === 'skip')).payload.activity?.action === 'skip', 'ws skip activity');

  // Guest reorder guard with own_only + PIN.
  await call('PUT', R('/config'), { body: { guest_reorder: 'own_only' }, headers: host });
  check((await sock.next(m => m.type === 'config_update')).payload.guest_reorder === 'own_only', 'ws config_update');
  for (const s of songs.slice(3, 5)) await call('POST', R('/queue'), { body: { song_id: s.id, user_name: 'Cris' } });
  q = (await call('GET', R('/queue'))).json.data;
  const pend = q.queue.filter(i => i.status === 'pending');
  check(pend.length >= 2, 'two pending songs for the reorder checks', pend.length);
  if (pend.length >= 2) {
    const g = await call('PUT', R('/queue/' + pend[1].id + '/reorder'), { body: { position: 0, user_name: 'Eve' } });
    check(g.status === 403 && g.json?.data?.code === 'guest_reorder_own_only', 'guest reorder blocked (own_only)', g.json);
    const h = await call('PUT', R('/queue/' + pend[1].id + '/reorder'), { body: { position: 0, user_name: 'DJ' }, headers: host });
    check(h.status === 200, 'host can reorder');
  }
  check((await call('POST', R('/queue/shuffle'))).status === 401, 'shuffle needs DJ');
  check((await call('POST', R('/queue/shuffle'), { headers: { 'X-Admin-Pin': '4321' } })).status === 200, 'shuffle with PIN');

  // Rename and sign out.
  const ren = await call('POST', R('/users/rename'), { body: { old_name: 'Ana', new_name: 'Ana Maria', client_id: 'dev-ana' } });
  check(ren.json?.data?.status === 'ok', 'rename', ren.json);
  q = (await call('GET', R('/queue'))).json.data;
  check(!q.queue.some(i => i.user_name === 'Ana'), 'rename moved queued songs');
  const so = await call('POST', R('/users/signout'), { body: { user_name: 'Ana Maria', client_id: 'dev-ana' } });
  check(so.status === 200, 'sign out', so.json);

  console.log('\nTrash');
  check((await call('DELETE', R('/catalog/songs/' + songs[3].id), { headers: ck })).status === 200, 'soft delete');
  check((await call('GET', R('/catalog/trash'), { headers: ck })).json?.data?.some(s => s.id === songs[3].id), 'in trash');
  check((await call('POST', R('/catalog/songs/' + songs[3].id + '/restore'), { headers: ck })).status === 200, 'restore');

  console.log('\nEnd party');
  const end = await call('POST', R('/shutdown'), { headers: host });
  check(end.status === 200, 'end party');
  check((await sock.next(m => m.type === 'server_shutdown')).type === 'server_shutdown', 'ws server_shutdown');
  const closeCode = await Promise.race([sock.closed, new Promise(r => setTimeout(() => r('no close'), 3000))]);
  check(closeCode === 4404, 'socket closed with 4404', closeCode);
  check((await call('GET', R('/queue'))).status === 404, 'room gone after end');

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
