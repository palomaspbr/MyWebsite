// MyDrive page: login, upload (in 8 MiB parts, with progress and retries), file list, downloads,
// "Baixar tudo" (every file, one download each) and "Deletar tudo". API: /mydrive/api/* (worker/mydrive/).
import { icon, hydrateIcons, fileIcon } from './icons.js';

const API = '/mydrive/api';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let files = [];
let usage = { used: 0, limit: 0 };
const queue = [];
let uploading = false;

/*#region Helpers*/
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function h(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  hydrateIcons(tpl.content);
  return tpl.content.firstElementChild;
}
function size(b) {
  if (b < 1024) return `${b} B`;
  const u = ['KB', 'MB', 'GB'];
  let v = b, i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${u[i]}`;
}
function when(ms) {
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = 'GET', body } = {}) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (method !== 'GET') opt.headers['X-MyDrive'] = '1';
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(API + path, opt);
  let data = {};
  try { data = await res.json(); } catch { /* not json */ }
  if (res.status === 401 && path !== '/login') { showLogin(); }
  return { ok: res.ok, status: res.status, data };
}

function toast(message, kind = 'info', ms = 4500) {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const ic = { success: 'ok', error: 'error', info: 'info', warn: 'warning' }[kind] || 'info';
  const el = h(`<div class="toast ${kind}">${icon(ic)}<span></span><button type="button" class="x" aria-label="Fechar">${icon('close')}</button></div>`);
  el.querySelector('span').textContent = message;
  const close = () => el.remove();
  el.querySelector('.x').onclick = close;
  box.appendChild(el);
  if (ms) setTimeout(close, ms);
}

/** Small confirmation sheet. Resolves true / false. */
function confirmSheet({ title, message, okLabel, danger = false }) {
  return new Promise((resolve) => {
    const back = h(`<div class="backdrop"><div class="sheet" role="dialog" aria-modal="true">
      <button type="button" class="icon-btn close" aria-label="Fechar">${icon('close')}</button>
      <h2></h2><p class="msg"></p>
      <div class="actions"><button type="button" class="btn ghost cancel">Cancelar</button>
      <button type="button" class="btn ${danger ? 'danger' : 'primary'} ok"></button></div></div></div>`);
    const sheet = back.firstElementChild;
    sheet.querySelector('h2').textContent = title;
    sheet.querySelector('.msg').textContent = message;
    sheet.querySelector('.ok').textContent = okLabel;
    const prev = document.activeElement;
    const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); if (prev && prev.focus) prev.focus(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    sheet.querySelector('.close').onclick = () => done(false);
    sheet.querySelector('.cancel').onclick = () => done(false);
    sheet.querySelector('.ok').onclick = () => done(true);
    back.addEventListener('mousedown', (e) => { if (e.target === back) done(false); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    setTimeout(() => sheet.querySelector('.cancel').focus(), 20);
  });
}

function themeButton(btn) {
  const ST = window.SiteTheme;
  if (!ST) { btn.hidden = true; return; }
  const render = (dark) => {
    btn.innerHTML = ST.icon(dark).replace('<svg ', '<svg class="theme" ');
    btn.title = ST.label(dark);
    btn.setAttribute('aria-label', ST.label(dark));
  };
  render(ST.isDark());
  btn.addEventListener('click', () => ST.toggle());
  ST.onChange(render);
}
/*#endregion*/

/*#region Views*/
function showLogin(message = '') {
  $('#loading').hidden = true;
  $('#drive-view').hidden = true;
  $('#logout-btn').hidden = true;
  $('#login-view').hidden = false;
  $('#login-err').textContent = message;
  setTimeout(() => ($('#login-user').value ? $('#login-pass') : $('#login-user')).focus(), 30);
}

async function showDrive() {
  $('#loading').hidden = true;
  $('#login-view').hidden = true;
  $('#drive-view').hidden = false;
  $('#logout-btn').hidden = false;
  await refresh();
}

async function refresh() {
  const r = await api('/files');
  if (!r.ok) { if (r.status !== 401) toast('Não consegui carregar os arquivos.', 'error'); return; }
  files = r.data.files || [];
  usage = { used: r.data.used || 0, limit: r.data.limit || 0 };
  render();
}

function render() {
  const list = $('#files');
  list.innerHTML = '';
  for (const f of files) {
    const url = `${API}/files/${f.id}/download`;
    const li = h(`<li>
      ${icon(fileIcon(f.name))}
      <div class="info"><a class="name" download></a><div class="meta"></div></div>
      <div class="tools">
        <a class="icon-btn" download title="Baixar" aria-label="Baixar">${icon('download')}</a>
        <button type="button" class="icon-btn del" title="Deletar" aria-label="Deletar">${icon('delete')}</button>
      </div></li>`);
    const name = li.querySelector('a.name');
    name.textContent = f.name;
    name.title = f.name;
    name.href = url;
    name.setAttribute('download', f.name);
    const dl = li.querySelector('.tools a');
    dl.href = url;
    dl.setAttribute('download', f.name);
    dl.setAttribute('aria-label', `Baixar ${f.name}`);
    li.querySelector('.meta').textContent = `${size(f.size)} · ${when(f.created)}`;
    li.querySelector('.del').onclick = () => deleteOne(f);
    list.appendChild(li);
  }
  $('#empty').hidden = files.length > 0;
  $('#all-btn').disabled = files.length === 0;
  $('#wipe-btn').disabled = files.length === 0;
  const pct = usage.limit ? Math.min(100, (usage.used / usage.limit) * 100) : 0;
  $('#meter-fill').style.width = `${Math.max(pct, usage.used ? 1 : 0)}%`;
  $('#meter-text').textContent = `${size(usage.used)} de ${size(usage.limit)} usados · ${files.length} ${files.length === 1 ? 'arquivo' : 'arquivos'}`;
  $('#meter').classList.toggle('full', pct > 90);
}
/*#endregion*/

/*#region Upload*/
function putPart(id, n, blob, onProgress) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${API}/files/${id}/parts/${n}`);
    xhr.setRequestHeader('X-MyDrive', '1');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => resolve(0);
    xhr.ontimeout = () => resolve(0);
    xhr.timeout = 10 * 60 * 1000;
    xhr.send(blob);
  });
}

async function uploadOne(item) {
  const { file, row } = item;
  const bar = row.querySelector('.bar span');
  const pct = row.querySelector('.pct');
  const setPct = (sent) => {
    const p = file.size ? Math.min(100, (sent / file.size) * 100) : 100;
    bar.style.width = `${p}%`;
    pct.textContent = `${Math.floor(p)}%`;
  };
  const fail = (msg) => { row.classList.add('error'); pct.textContent = msg; };

  const start = await api('/files', { method: 'POST', body: { name: file.name, size: file.size, type: file.type } });
  if (!start.ok) {
    if (start.status === 413) return fail('sem espaço');
    if (start.status === 401) return fail('faça login de novo');
    return fail('erro');
  }
  const { id, part } = start.data;
  const parts = Math.max(1, Math.ceil(file.size / part));
  for (let n = 0; n < parts; n++) {
    const blob = file.slice(n * part, Math.min(file.size, (n + 1) * part));
    let status = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      status = await putPart(id, n, blob, (loaded) => setPct(n * part + loaded));
      if (status === 200) break;
      if (status === 401 || status === 404) break;
      pct.textContent = 'tentando de novo…';
      await sleep(1500 * (attempt + 1));
    }
    if (status !== 200) {
      api(`/files/${id}`, { method: 'DELETE' });
      return fail(status === 401 ? 'faça login de novo' : 'falhou');
    }
  }
  const done = await api(`/files/${id}/done`, { method: 'POST' });
  if (!done.ok) return fail('falhou');
  setPct(file.size);
  row.classList.add('done');
  pct.textContent = 'enviado';
  setTimeout(() => row.remove(), 4000);
  return true;
}

async function runQueue() {
  if (uploading) return;
  uploading = true;
  let ok = 0;
  while (queue.length) {
    const item = queue.shift();
    if (await uploadOne(item)) { ok++; await refresh(); }
  }
  uploading = false;
  if (ok) toast(ok === 1 ? 'Arquivo enviado.' : `${ok} arquivos enviados.`, 'success');
}

function addFiles(list) {
  const arr = [...list];
  if (!arr.length) return;
  const free = usage.limit - usage.used - queue.reduce((s, q) => s + q.file.size, 0);
  const total = arr.reduce((s, f) => s + f.size, 0);
  if (usage.limit && total > free) toast(`Pouco espaço: faltam ${size(total - free)}. Alguns arquivos podem não caber.`, 'warn', 7000);
  for (const file of arr) {
    const row = h(`<li><span class="name"></span><span class="pct">na fila</span><div class="bar"><span></span></div></li>`);
    row.querySelector('.name').textContent = `${file.name} (${size(file.size)})`;
    $('#uploads').appendChild(row);
    queue.push({ file, row });
  }
  runQueue();
}
/*#endregion*/

/*#region Delete + download all*/
async function deleteOne(f) {
  const yes = await confirmSheet({ title: 'Deletar arquivo?', message: `"${f.name}" (${size(f.size)}) será apagado para sempre.`, okLabel: 'Deletar', danger: true });
  if (!yes) return;
  const r = await api(`/files/${f.id}`, { method: 'DELETE' });
  if (r.ok) toast('Arquivo deletado.', 'success'); else toast('Não consegui deletar.', 'error');
  refresh();
}

async function deleteAll() {
  if (!files.length) return;
  const yes = await confirmSheet({
    title: 'Deletar tudo?',
    message: `Isso apaga os ${files.length} ${files.length === 1 ? 'arquivo' : 'arquivos'} (${size(usage.used)}) para sempre. Não dá para desfazer.`,
    okLabel: 'Deletar tudo', danger: true,
  });
  if (!yes) return;
  const r = await api('/delete-all', { method: 'POST', body: { confirm: true } });
  if (r.ok) toast('Tudo deletado.', 'success'); else toast('Não consegui deletar.', 'error');
  refresh();
}

async function downloadAll() {
  if (!files.length) return;
  const btn = $('#all-btn');
  btn.disabled = true;
  toast(files.length === 1 ? 'Baixando 1 arquivo…' : `Baixando ${files.length} arquivos, um de cada vez. Se o navegador perguntar, permita vários downloads.`, 'info', 8000);
  for (const f of [...files]) {
    const a = document.createElement('a');
    a.href = `${API}/files/${f.id}/download`;
    a.download = f.name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    await sleep(1200);
  }
  btn.disabled = files.length === 0;
}
/*#endregion*/

/*#region Wiring*/
function wire() {
  hydrateIcons(document);
  themeButton($('#theme-btn'));

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-btn');
    btn.disabled = true;
    $('#login-err').textContent = '';
    const r = await api('/login', { method: 'POST', body: { user: $('#login-user').value, password: $('#login-pass').value } });
    btn.disabled = false;
    if (r.ok) { $('#login-pass').value = ''; showDrive(); return; }
    const d = r.data || {};
    let msg = 'Não consegui entrar. Tente de novo.';
    if (d.error === 'wrong_login') msg = d.left > 0 ? `Usuário ou senha errados. Mais ${d.left} ${d.left === 1 ? 'tentativa' : 'tentativas'} antes de uma pausa.` : 'Usuário ou senha errados.';
    if (d.error === 'too_many_attempts') msg = `Muitas tentativas. Tente de novo em ${Math.max(1, Math.ceil((d.retryAfter || 60) / 60))} min.`;
    if (d.error === 'not_configured') msg = 'A senha ainda não foi definida no Cloudflare (secret MYDRIVE_PASSWORD).';
    $('#login-err').textContent = msg;
    $('#login-pass').select();
  });

  $('#logout-btn').onclick = async () => { await api('/logout', { method: 'POST' }); files = []; showLogin(); };
  $('#file-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('#all-btn').onclick = downloadAll;
  $('#wipe-btn').onclick = deleteAll;

  // Drag and drop anywhere on the page.
  let depth = 0;
  const zone = $('#drop-zone');
  const canDrop = (e) => !$('#drive-view').hidden && [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!canDrop(e)) return; e.preventDefault(); depth++; zone.hidden = false; });
  window.addEventListener('dragover', (e) => { if (canDrop(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) zone.hidden = true; });
  window.addEventListener('drop', (e) => {
    if (!canDrop(e)) return;
    e.preventDefault();
    depth = 0;
    zone.hidden = true;
    addFiles(e.dataTransfer.files);
  });
  window.addEventListener('beforeunload', (e) => { if (uploading) { e.preventDefault(); e.returnValue = ''; } });
}

async function start() {
  wire();
  const r = await api('/me');
  if (r.ok) showDrive();
  else showLogin(r.data && r.data.error === 'not_configured' ? 'A senha ainda não foi definida no Cloudflare (secret MYDRIVE_PASSWORD).' : '');
}
start();
/*#endregion*/
