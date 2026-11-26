// Editor dialogs: settings, keyboard shortcuts, word count and version history.
import { Y } from '../vendor/cm.js';
import { t, lang, setLang, relTime } from './i18n.js';
import { h, esc, modal, prompt, confirm, toast, download, safeFileName, modKey } from './ui.js';
import { COMPILERS, getEndpoint, setEndpoint, DEFAULT_ENDPOINT } from './compile.js';
import { Project, snapshot, dirName, extOf } from './project.js';
import { listVersions, putVersion, deleteVersion } from './store.js';
import { wordCount, stripComments } from './lint.js';
import { exportZip } from './zip.js';

/*#region Settings*/
export function openSettings(app) {
  const s = app.settings;
  const texFiles = app.project.fileEntries().filter((e) => e.type === 'text' && extOf(e.path) === 'tex');
  const body = h(`<div>
    <div class="settings-grid">
      <label for="set-compiler">${esc(t('ed.compiler'))}</label>
      <select class="field" id="set-compiler" ${app.readOnly ? 'disabled' : ''}>${COMPILERS.map((c) => `<option value="${c}">${{ pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' }[c]}</option>`).join('')}</select>
      <label for="set-main">${esc(t('ed.main_doc'))}</label>
      <select class="field" id="set-main" ${app.readOnly ? 'disabled' : ''}>${texFiles.map((e) => `<option value="${e.id}">${esc(e.path)}</option>`).join('')}</select>
      <label for="set-font">${esc(t('ed.font_size'))}</label>
      <select class="field" id="set-font">${[12, 13, 14, 15, 16, 18, 20, 22].map((n) => `<option value="${n}">${n}px</option>`).join('')}</select>
      <label for="set-auto">${esc(t('ed.auto'))}</label><span class="switch"><input type="checkbox" id="set-auto"><span></span></span>
      <label for="set-halt">${esc(t('ed.halt'))}</label><span class="switch"><input type="checkbox" id="set-halt"><span></span></span>
      <label for="set-wrap">${esc(t('ed.wrap'))}</label><span class="switch"><input type="checkbox" id="set-wrap"><span></span></span>
      <label for="set-lines">${esc(t('ed.line_numbers'))}</label><span class="switch"><input type="checkbox" id="set-lines"><span></span></span>
      <label for="set-close">${esc(t('ed.autoclose'))}</label><span class="switch"><input type="checkbox" id="set-close"><span></span></span>
      <label for="set-complete">${esc(t('ed.autocomplete'))}</label><span class="switch"><input type="checkbox" id="set-complete"><span></span></span>
      <label for="set-spell">${esc(t('ed.spell'))}</label><span class="switch"><input type="checkbox" id="set-spell"><span></span></span>
      <label for="set-dark">${esc(t('common.theme_dark'))}</label><span class="switch"><input type="checkbox" id="set-dark"><span></span></span>
      <label for="set-lang">${esc(t('common.language'))}</label>
      <select class="field" id="set-lang"><option value="en">English</option><option value="pt">Português (Brasil)</option></select>
      <label class="full" for="set-server">${esc(t('ed.server'))}</label>
      <div class="full" style="display:flex;gap:8px"><input class="field" id="set-server" type="url" spellcheck="false"><button type="button" class="btn small ghost" id="set-server-reset">${esc(t('ed.server_reset'))}</button></div>
      <p class="hint full">${esc(t('ed.server_hint'))}</p>
    </div>
    <div class="actions"><button type="button" class="btn primary" id="set-done">${esc(t('common.close'))}</button></div>
  </div>`);
  const m = modal({ title: t('ed.settings'), body });
  const $b = (sel) => body.querySelector(sel);
  $b('#set-compiler').value = app.project.compiler;
  $b('#set-main').value = app.project.mainId || '';
  $b('#set-font').value = String(s.fontSize);
  $b('#set-auto').checked = s.autoCompile;
  $b('#set-halt').checked = s.halt;
  $b('#set-wrap').checked = s.wrap;
  $b('#set-lines').checked = s.lineNumbers;
  $b('#set-close').checked = s.autoClose;
  $b('#set-complete').checked = s.autocomplete;
  $b('#set-spell').checked = s.spell;
  $b('#set-dark').checked = window.SiteTheme ? window.SiteTheme.isDark() : false;
  $b('#set-lang').value = lang;
  $b('#set-server').value = getEndpoint();

  $b('#set-compiler').onchange = (e) => { app.project.compiler = e.target.value; };
  $b('#set-main').onchange = (e) => { app.project.mainId = e.target.value; };
  $b('#set-font').onchange = (e) => app.updateSettings({ fontSize: +e.target.value });
  for (const [id, key] of [['#set-auto', 'autoCompile'], ['#set-halt', 'halt'], ['#set-wrap', 'wrap'], ['#set-lines', 'lineNumbers'], ['#set-close', 'autoClose'], ['#set-complete', 'autocomplete'], ['#set-spell', 'spell']]) {
    $b(id).onchange = (e) => app.updateSettings({ [key]: e.target.checked });
  }
  $b('#set-dark').onchange = (e) => window.SiteTheme && window.SiteTheme.set(e.target.checked ? 'dark' : 'light');
  $b('#set-lang').onchange = (e) => { setLang(e.target.value); location.reload(); };
  $b('#set-server').onchange = (e) => {
    const v = e.target.value.trim();
    if (!v || /^https?:\/\/.+/.test(v)) { setEndpoint(v); app.refreshQuota(); } else e.target.value = getEndpoint();
  };
  $b('#set-server-reset').onclick = () => { setEndpoint(DEFAULT_ENDPOINT); $b('#set-server').value = DEFAULT_ENDPOINT; app.refreshQuota(); };
  $b('#set-done').onclick = () => m.close();
}
/*#endregion*/

/*#region Shortcuts*/
export function openShortcuts() {
  const k = (s) => s.split('+').map((x) => `<kbd>${esc(x === 'Mod' ? modKey : x)}</kbd>`).join(' + ');
  const rows = [
    ['keys.save', 'Mod+S'], ['keys.compile', 'Mod+Enter'], ['keys.find', 'Mod+F'], ['keys.goto', 'Mod+Alt+G'],
    ['keys.comment', 'Mod+/'], ['keys.bold', 'Mod+B'], ['keys.italic', 'Mod+I'], ['keys.complete', 'Ctrl+Space'],
    ['keys.undo', 'Mod+Z'], ['keys.fold', 'Mod+Shift+['], ['keys.topdf', 'Mod+Alt+Right'],
  ];
  const body = h(`<div><table class="keys-table">${rows.map(([key, combo]) => `<tr><td>${esc(t(key))}</td><td>${k(combo)}</td></tr>`).join('')}</table>
    <p class="hint">${esc(t('ed.goto_code'))}</p></div>`);
  modal({ title: t('ed.shortcuts'), body });
}
/*#endregion*/

/*#region Word count*/
export function openWordCount(app) {
  const project = app.project;
  const mainId = project.mainId;
  if (!mainId) return;
  const main = project.get(mainId);
  const seen = new Set();
  const parts = [];
  const visit = (entry, depth) => {
    if (!entry || seen.has(entry.id) || depth > 8) return;
    seen.add(entry.id);
    const text = entry.text.toString();
    parts.push({ path: entry.path, words: wordCount(entry.id === mainId ? text : '\\begin{document}' + text + '\\end{document}') });
    const re = /\\(?:input|include|subfile)\{([^}]+)\}/g;
    const clean = stripComments(text);
    let m;
    while ((m = re.exec(clean))) {
      const name = m[1].trim();
      const base = dirName(main.path);
      const tries = [name, name + '.tex'].flatMap((n) => [base ? base + '/' + n : n, n]);
      for (const p of tries) { const e = project.byPath(p); if (e && e.type === 'text') { visit(e, depth + 1); break; } }
    }
  };
  visit(main, 0);
  const total = parts.reduce((a, p) => a + p.words, 0);
  const body = h(`<div>
    <p style="font-family:var(--brush);font-size:38px;margin:0 0 8px">${esc(t('ed.words_n', { n: total.toLocaleString(lang === 'pt' ? 'pt-BR' : 'en') }))}</p>
    <table class="keys-table">${parts.map((p) => `<tr><td>${esc(p.path)}</td><td>${p.words.toLocaleString()}</td></tr>`).join('')}</table>
    <p class="hint">${esc(t('ed.words_hint'))}</p>
  </div>`);
  modal({ title: t('ed.words'), body });
}
/*#endregion*/

/*#region History*/
const MAX_AUTO = 30;

export async function saveVersion(app, label, auto = false) {
  await putVersion(app.id, label, Y.encodeStateAsUpdate(app.doc), auto);
  if (auto) {
    const list = (await listVersions(app.id)).filter((v) => v.auto);
    for (const v of list.slice(MAX_AUTO)) await deleteVersion(app.id, v.at);
  }
}

/** Replace the text of a Y.Text with as small an edit as possible. */
export function replaceText(ytext, next) {
  const cur = ytext.toString();
  if (cur === next) return;
  let a = 0;
  while (a < cur.length && a < next.length && cur[a] === next[a]) a++;
  let b = 0;
  while (b < cur.length - a && b < next.length - a && cur[cur.length - 1 - b] === next[next.length - 1 - b]) b++;
  ytext.delete(a, cur.length - a - b);
  ytext.insert(a, next.slice(a, next.length - b));
}

/** Make the live project look like an old version (as normal edits, so collaborators get it too). */
export function restoreState(app, state) {
  const tmp = new Y.Doc();
  Y.applyUpdate(tmp, state);
  const old = new Project(tmp);
  const cur = app.project;
  app.doc.transact(() => {
    for (const e of cur.entries()) if (!old.files.has(e.id)) cur.files.delete(e.id);
    for (const o of old.entries()) {
      const m = cur.files.get(o.id);
      if (!m) {
        const n = new Y.Map();
        n.set('path', o.path); n.set('type', o.type);
        if (o.type === 'text') n.set('text', new Y.Text(o.text.toString()));
        if (o.type === 'bin') { n.set('hash', o.hash); n.set('size', o.size); n.set('mime', o.mime); }
        cur.files.set(o.id, n);
        continue;
      }
      if (m.get('path') !== o.path) m.set('path', o.path);
      if (o.type === 'text' && m.get('text')) replaceText(m.get('text'), o.text.toString());
      if (o.type === 'bin' && m.get('hash') !== o.hash) { m.set('hash', o.hash); m.set('size', o.size); m.set('mime', o.mime); }
    }
    for (const k of ['name', 'main', 'compiler']) if (old.meta.get(k) !== undefined && old.meta.get(k) !== cur.meta.get(k)) cur.meta.set(k, old.meta.get(k));
  });
  tmp.destroy();
}

export async function openHistory(app) {
  const body = h(`<div>
    <p class="hint">${esc(t('ed.history_hint'))}</p>
    ${app.readOnly ? '' : `<button type="button" class="btn primary" id="hist-save">${esc(t('ed.history_save'))}</button>`}
    <ul class="version-list" id="hist-list"></ul>
  </div>`);
  const m = modal({ title: t('ed.history_title'), body, wide: true });
  const list = body.querySelector('#hist-list');
  async function render() {
    const versions = await listVersions(app.id);
    list.replaceChildren();
    if (!versions.length) { list.appendChild(h(`<li class="muted">${esc(t('ed.history_empty'))}</li>`)); return; }
    for (const v of versions) {
      const name = v.auto ? t('ed.history_auto') : v.label;
      const li = h(`<li><div class="grow"><div class="name"></div><div class="when"></div></div>
        <button type="button" class="btn small ghost dl">${esc(t('ed.history_view'))}</button>
        ${app.readOnly ? '' : `<button type="button" class="btn small restore">${esc(t('common.restore'))}</button>`}
        <button type="button" class="tool del" aria-label="${esc(t('common.delete'))}">✕</button></li>`);
      li.querySelector('.name').textContent = name;
      li.querySelector('.when').textContent = new Date(v.at).toLocaleString(lang === 'pt' ? 'pt-BR' : 'en') + ' · ' + relTime(v.at);
      li.querySelector('.dl').onclick = async () => {
        const tmp = new Y.Doc(); Y.applyUpdate(tmp, v.state);
        const blob = await exportZip(snapshot(new Project(tmp)));
        download(blob, safeFileName(app.project.name + ' - ' + name) + '.zip');
        tmp.destroy();
      };
      const r = li.querySelector('.restore');
      if (r) r.onclick = async () => {
        if (!(await confirm({ title: t('ed.history_restore', { name }), okLabel: t('common.restore') }))) return;
        await saveVersion(app, (lang === 'pt' ? 'Antes de restaurar' : 'Before restoring') + ' “' + name + '”');
        restoreState(app, v.state);
        toast(t('ed.history_restored'), 'success');
        m.close();
      };
      li.querySelector('.del').onclick = async () => { await deleteVersion(app.id, v.at); render(); };
      list.appendChild(li);
    }
  }
  const save = body.querySelector('#hist-save');
  if (save) save.onclick = async () => {
    const label = await prompt({ title: t('ed.history_save'), label: t('ed.history_label'), value: new Date().toLocaleString(lang === 'pt' ? 'pt-BR' : 'en'), okLabel: t('common.save') });
    if (!label) return;
    await saveVersion(app, label);
    render();
  };
  render();
}
/*#endregion*/
