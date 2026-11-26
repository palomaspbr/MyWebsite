// LaTeX Notebook — project list (/latex/).
import { Y } from '../vendor/cm.js';
import { t, applyI18n, relTime, fmtBytes, lang, setLang } from './i18n.js';
import { icon, hydrateIcons } from './icons.js';
import { $, h, esc, toast, modal, prompt, confirm, download, safeFileName, themeButton, openMenu } from './ui.js';
import * as store from './store.js';
import { Project, createProject, snapshot } from './project.js';
import { TEMPLATES, templateFiles } from './templates.js';
import { importZip, exportZip, guessMain, toFile } from './zip.js';

const EDIT = (id) => '/latex/edit/?p=' + encodeURIComponent(id);

async function openDoc(id) {
  const doc = new Y.Doc();
  const state = await store.getDocState(id);
  if (state) Y.applyUpdate(doc, state);
  return doc;
}

/*#region Project list*/
let projects = [];
const fileCounts = new Map();

async function load() {
  projects = await store.listProjects();
  render();
  // File counts (needs each document) after the first paint.
  for (const p of projects) {
    if (fileCounts.has(p.id)) continue;
    try {
      const doc = await openDoc(p.id);
      fileCounts.set(p.id, new Project(doc).fileEntries().length);
      doc.destroy();
    } catch { /* ignore */ }
  }
  render();
}

function render() {
  const q = $('#search').value.trim().toLowerCase();
  const list = $('#projects');
  list.replaceChildren();
  const shown = projects.filter((p) => !q || p.name.toLowerCase().includes(q));
  if (!projects.length) {
    list.appendChild(h(`<li class="empty-note">${esc(t('dash.empty'))}</li>`));
    return;
  }
  if (!shown.length) {
    list.appendChild(h(`<li class="empty-note"></li>`)).textContent = t('dash.none_found', { q });
    return;
  }
  for (const p of shown) {
    const n = fileCounts.get(p.id);
    const li = h(`<li class="proj">
      ${icon(p.share ? 'users' : 'file_tex', 'doc')}
      <div class="info">
        <a class="name" href="${EDIT(p.id)}"></a>
        <div class="meta"><span>${esc(t('dash.edited', { when: relTime(p.updated || p.created) }))}</span>
          ${n !== undefined ? `<span>· ${esc(t('dash.files', { n }))}</span>` : ''}
          ${p.share ? `<span class="chip purple">${icon('share')} ${esc(t(p.share.role === 'view' ? 'dash.readonly' : 'dash.shared'))}</span>` : ''}</div>
      </div>
      <div class="tools">
        <button type="button" class="tool" data-a="zip" title="${esc(t('ed.download_zip'))}" aria-label="${esc(t('ed.download_zip'))}">${icon('download')}</button>
        <button type="button" class="tool" data-a="more" title="${esc(t('ed.menu'))}" aria-label="${esc(t('ed.menu'))}">${icon('dots')}</button>
      </div>
    </li>`);
    li.querySelector('.name').textContent = p.name;
    li.querySelector('[data-a=zip]').onclick = () => downloadZip(p);
    li.querySelector('[data-a=more]').onclick = (e) => openMenu(e.currentTarget, [
      { label: t('common.open'), icon: 'file_tex', run: () => { location.href = EDIT(p.id); } },
      { label: t('common.rename'), icon: 'edit', disabled: p.share && p.share.role === 'view', run: () => rename(p) },
      { label: t('common.duplicate'), icon: 'copy', run: () => duplicate(p) },
      { label: t('ed.download_zip'), icon: 'download', run: () => downloadZip(p) },
      { sep: true },
      { label: t('common.delete'), icon: 'delete', danger: true, run: () => remove(p) },
    ], { align: 'right' });
    list.appendChild(li);
  }
}

async function rename(p) {
  const v = await prompt({ title: t('dash.rename_title'), label: t('common.name'), value: p.name, okLabel: t('common.rename'), validate: (x) => (x.trim() ? '' : t('ed.bad_name')) });
  if (!v) return;
  const doc = await openDoc(p.id);
  new Project(doc).name = v;
  await store.putDocState(p.id, Y.encodeStateAsUpdate(doc));
  doc.destroy();
  await store.patchProject(p.id, { name: v, updated: Date.now() });
  load();
}

async function duplicate(p) {
  const doc = await openDoc(p.id);
  const project = new Project(doc);
  const files = [];
  for (const f of snapshot(project)) {
    if (f.type === 'text') files.push({ path: f.path, content: f.content });
    else if (f.type === 'dir') files.push({ path: f.path, dir: true });
    else { const b = await store.getBlob(f.hash); if (b) files.push({ path: f.path, bytes: new Uint8Array(await b.arrayBuffer()) }); }
  }
  const main = project.mainId ? project.get(project.mainId).path : null;
  const rec = await createProject({ name: t('dash.copy_of', { name: project.name }), files, main, compiler: project.compiler });
  doc.destroy();
  toast(rec.name, 'success', 2500);
  load();
}

async function downloadZip(p) {
  const doc = await openDoc(p.id);
  const blob = await exportZip(snapshot(new Project(doc)));
  doc.destroy();
  download(blob, safeFileName(p.name) + '.zip');
}

async function remove(p) {
  const ok = await confirm({
    title: t('dash.delete_title', { name: p.name }),
    message: t('dash.delete_body') + (p.share ? ' ' + t('dash.delete_shared') : ''),
    okLabel: t('common.delete'), danger: true,
  });
  if (!ok) return;
  await store.deleteProject(p.id);
  load();
  gc();
}
/*#endregion*/

/*#region New project*/
async function fromTemplate(tpl, name) {
  const files = templateFiles(tpl, lang);
  const rec = await createProject({ name: name || tpl.name[lang], files, main: tpl.main, compiler: tpl.compiler });
  location.href = EDIT(rec.id);
}

function newProjectDialog(preselect = 'blank') {
  const body = h(`<form>
    <label class="row" for="np-name">${esc(t('dash.new_name'))}</label>
    <input class="field" id="np-name" type="text" autocomplete="off">
    <div class="tpl-pick">${TEMPLATES.map((tp) => `<label><input type="radio" name="tpl" value="${tp.id}">${icon(tp.icon)}<b>${esc(tp.name[lang])}</b></label>`).join('')}</div>
    <div class="actions"><button type="button" class="btn ghost cancel">${esc(t('common.cancel'))}</button><button type="submit" class="btn primary">${esc(t('common.create'))}</button></div>
  </form>`);
  const input = body.querySelector('#np-name');
  input.value = t('dash.new_default');
  const radio = body.querySelector(`input[value="${preselect}"]`) || body.querySelector('input[type=radio]');
  radio.checked = true;
  const m = modal({ title: t('dash.new_title'), body, wide: true });
  body.querySelector('.cancel').onclick = () => m.close();
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tpl = TEMPLATES.find((x) => x.id === body.querySelector('input[name=tpl]:checked').value);
    const name = input.value.trim() || tpl.name[lang];
    m.close();
    await fromTemplate(tpl, name);
  });
}

function renderTemplates() {
  const box = $('#templates');
  box.replaceChildren();
  for (const tp of TEMPLATES) {
    const b = h(`<button type="button" class="tpl">${icon(tp.icon)}<b></b><span></span></button>`);
    b.querySelector('b').textContent = tp.name[lang];
    b.querySelector('span').textContent = tp.desc[lang];
    b.onclick = () => newProjectDialog(tp.id);
    box.appendChild(b);
  }
}
/*#endregion*/

/*#region Import*/
async function importFiles(fileList) {
  const list = [...fileList];
  if (!list.length) return;
  try {
    let files = [];
    let name = '';
    if (list.length === 1 && /\.zip$/i.test(list[0].name)) {
      files = importZip(await list[0].arrayBuffer());
      name = list[0].name.replace(/\.zip$/i, '');
    } else {
      for (const f of list) {
        if (/\.zip$/i.test(f.name)) continue;
        files.push(toFile(f.name, new Uint8Array(await f.arrayBuffer())));
      }
      name = (list.find((f) => /\.tex$/i.test(f.name)) || list[0]).name.replace(/\.[^.]+$/, '');
    }
    const main = guessMain(files);
    if (!main) { toast(t('dash.import_fail', { err: t('dash.no_tex') }), 'error', 6000); return; }
    // Pick the compiler from a "% !TEX program = xelatex" magic comment when there is one.
    const mainText = files.find((f) => f.path === main).content;
    const magic = /%\s*!\s*TEX\s+(?:TS-)?program\s*=\s*(\w+)/i.exec(mainText);
    let compiler = magic ? magic[1].toLowerCase() : 'pdflatex';
    if (!['pdflatex', 'xelatex', 'lualatex'].includes(compiler)) compiler = /\\usepackage(\[[^\]]*\])?\{fontspec\}/.test(mainText) ? 'xelatex' : 'pdflatex';
    const rec = await createProject({ name, files, main, compiler });
    toast(t('dash.imported', { name }), 'success');
    location.href = EDIT(rec.id);
  } catch (e) {
    console.error(e);
    toast(t('dash.import_fail', { err: e.message || e }), 'error', 6000);
  }
}

function setupDrop() {
  let overlay = null; let depth = 0;
  const hide = () => { depth = 0; if (overlay) { overlay.remove(); overlay = null; } };
  addEventListener('dragenter', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    depth++;
    if (!overlay) { overlay = h(`<div class="drop-zone">${esc(t('dash.drop'))}</div>`); document.body.appendChild(overlay); }
  });
  addEventListener('dragleave', () => { if (--depth <= 0) hide(); });
  addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  addEventListener('drop', (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); hide(); importFiles(e.dataTransfer.files); });
}
/*#endregion*/

async function joinLink() {
  const v = await prompt({
    title: t('dash.join'), label: t('dash.join_hint'), value: '', okLabel: t('common.open'),
    validate: (x) => (/[?&]s=[\w-]+/.test(x) && /#k=[\w-]+/.test(x) ? '' : t('dash.join_bad')),
  });
  if (!v) return;
  const u = new URL(v, location.href);
  location.href = '/latex/edit/' + u.search + u.hash;
}

/** Delete images no project uses any more. */
async function gc() {
  try {
    const used = new Set();
    for (const p of await store.listProjects()) {
      const doc = await openDoc(p.id);
      for (const hsh of new Project(doc).hashes()) used.add(hsh);
      doc.destroy();
      // Images only an old version still uses must survive too (History can restore them).
      for (const v of await store.listVersions(p.id)) {
        const old = new Y.Doc();
        Y.applyUpdate(old, v.state);
        for (const hsh of new Project(old).hashes()) used.add(hsh);
        old.destroy();
      }
    }
    await store.gcBlobs(used);
  } catch (e) { console.warn('gc', e); }
}

async function showStorage() {
  const est = await store.estimate();
  if (est && est.usage !== undefined) $('#storage').textContent = t('dash.storage', { used: fmtBytes(est.usage) });
}

function setupLang() {
  const b = $('#lang-btn');
  b.textContent = lang === 'pt' ? 'EN' : 'PT';
  b.title = lang === 'pt' ? 'English' : 'Português';
  b.onclick = () => { setLang(lang === 'pt' ? 'en' : 'pt'); location.reload(); };
}

applyI18n();
hydrateIcons();
themeButton($('#theme-btn'));
setupLang();
renderTemplates();
setupDrop();
$('#new-btn').onclick = () => newProjectDialog();
$('#upload-btn').onclick = () => { $('#upload-input').value = ''; $('#upload-input').click(); };
$('#upload-input').onchange = (e) => importFiles(e.target.files);
$('#join-btn').onclick = joinLink;
$('#search').addEventListener('input', render);
document.title = t('app.name');
load().then(() => { showStorage(); setTimeout(gc, 3000); });
store.persist();
