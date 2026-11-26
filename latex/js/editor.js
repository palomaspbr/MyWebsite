// LaTeX Notebook — editor page (/latex/edit/?p=<projectId>).
// The project is a Yjs document kept in IndexedDB (and synced between tabs with a BroadcastChannel,
// and with collaborators through collab.js when it is shared). CodeMirror edits one file at a time,
// bound to that file's Y.Text. Compiling sends a snapshot to the LaTeX-on-HTTP server (compile.js).
import {
  Y, EditorView, EditorState, Compartment, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine, indentOnInput,
  bracketMatching, foldGutter, foldKeymap, defaultKeymap, indentWithTab, toggleComment, searchKeymap,
  highlightSelectionMatches, search, openSearchPanel, closeBracketsKeymap, closeBrackets, completionKeymap,
  linter, lintGutter, forceLinting, lintKeymap, yCollab, yUndoManagerKeymap, Awareness, EditorSelection, scrollPastEnd,
  startCompletion,
} from '../vendor/cm.js';
import { t, applyI18n, fmtBytes, fmtWait, lang } from './i18n.js';
import { icon, hydrateIcons, fileIcon } from './icons.js';
import { $, $$, h, esc, toast, openMenu, prompt, download, safeFileName, themeButton, modKey, modalOpen, confirm } from './ui.js';
import * as store from './store.js';
import { Project, snapshot, extOf, baseName, dirName, cleanPath, mimeOf, isImagePath } from './project.js';
import { latex } from './latex-lang.js';
import { latexCompletions } from './completions.js';
import { buildIndex, checkFile, outline as outlineOf } from './lint.js';
import { compile, quota } from './compile.js';
import { parseLog, hintFor } from './logparse.js';
import { PdfView } from './pdfview.js';
import { exportZip, toFile } from './zip.js';
import { initTree } from './editor-tree.js';
import { renderLogs } from './editor-logs.js';
import { openSettings, openShortcuts, openWordCount, openHistory, saveVersion } from './editor-dialogs.js';

const MAX_FILE = 15 * 1024 * 1024;

/*#region Settings (per browser)*/
const SETTINGS_KEY = 'latex_settings';
const DEFAULTS = { fontSize: 15, wrap: true, spell: false, lineNumbers: true, autoClose: true, autocomplete: true, autoCompile: false, halt: true, layout: 'both', sideW: 250, pdfW: 46, outlineClosed: false, sidebar: true };
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
/*#endregion*/

const app = {
  id: null, record: null, doc: null, project: null, awareness: null, provider: null, readOnly: false,
  settings: loadSettings(), view: null, currentId: null, pdf: null,
};
window.latexApp = app; // handy for debugging from the console

const compartments = {
  wrap: new Compartment(), lines: new Compartment(), close: new Compartment(), complete: new Compartment(),
  spell: new Compartment(), ro: new Compartment(), lang: new Compartment(),
};

/*#region Boot*/
async function boot() {
  applyI18n();
  hydrateIcons();
  themeButton($('#theme-btn'));
  applySettingsToPage();

  const params = new URLSearchParams(location.search);
  const sharedRoom = params.get('s');
  try {
    if (sharedRoom) {
      const { openSharedLink } = await import('./collab.js');
      const rec = await openSharedLink(sharedRoom, new URLSearchParams(location.hash.slice(1)).get('k'));
      history.replaceState(null, '', '/latex/edit/?p=' + rec.id);
      app.id = rec.id;
    } else {
      app.id = params.get('p');
    }
    app.record = app.id ? await store.getProject(app.id) : null;
  } catch (e) {
    console.error(e);
    if (e.code === 'room_not_found') return notFound(t('share.gone'));
    return notFound(sharedRoom ? t('share.join_fail', { err: e.code || e.message || e }) : String(e.message || e));
  }
  if (!app.record) return notFound();

  // The document.
  const doc = new Y.Doc();
  app.doc = doc;
  const state = await store.getDocState(app.id);
  if (state) Y.applyUpdate(doc, state, 'idb');
  app.project = new Project(doc);
  app.awareness = new Awareness(doc);
  app.awareness.setLocalStateField('user', localUser());
  setupPersistence();

  if (app.record.share) {
    app.readOnly = app.record.share.role === 'view';
    try {
      const { connect } = await import('./collab.js');
      app.provider = connect(app);
    } catch (e) { console.error(e); toast(t('share.unavailable', { err: e.message || e }), 'error', 8000); }
  }

  setupEditor();
  app.tree = initTree(app);
  setupPdf();
  setupTopbar();
  setupLayout();
  setupUploads();
  setupKeys();
  renderAll();
  observeProject();

  // Open the last file used in this project, else the main document.
  let last = null;
  try { last = localStorage.getItem('latex_last_' + app.id); } catch { /* ignore */ }
  const first = (last && app.project.get(last) && app.project.get(last).type !== 'dir') ? last : app.project.mainId || (app.project.fileEntries()[0] || {}).id;
  if (first) openFile(first); else showNoFile();

  store.patchProject(app.id, { opened: Date.now() });
  $('#loading').remove();

  // Last PDF of this project, else compile once (shared projects may still be syncing: wait a bit).
  const cached = await store.getPdf(app.id);
  if (cached && cached.pdf) {
    showPdf(cached.pdf);
    app.lastPdf = cached.pdf;
  } else {
    setPdfEmpty();
    setTimeout(() => { if (!app.lastPdf && app.project.mainId) runCompile({ auto: true, first: true }); }, app.provider ? 2500 : 300);
  }
  refreshQuota();
  setInterval(refreshQuota, 15000);
  setInterval(autoSnapshot, 60000);
  store.persist();
}

function notFound(msg) {
  $('#loading').innerHTML = `<div class="big">${esc(t('app.name'))}</div><p>${esc(msg || t('ed.not_found'))}</p><a class="btn primary" href="/latex/">${esc(t('ed.go_back'))}</a>`;
}

function localUser() {
  let u = null;
  try { u = JSON.parse(localStorage.getItem('latex_user') || 'null'); } catch { /* ignore */ }
  if (!u) {
    const colors = ['#ffd43b', '#ff8787', '#74c0fc', '#8ce99a', '#b197fc', '#ffa94d', '#63e6be', '#f783ac'];
    const animals = lang === 'pt' ? ['Capivara', 'Tucano', 'Jabuti', 'Lontra', 'Tamanduá', 'Arara', 'Quati', 'Boto'] : ['Otter', 'Toucan', 'Tortoise', 'Badger', 'Heron', 'Lynx', 'Panda', 'Fox'];
    const i = Math.floor(Math.random() * colors.length);
    u = { name: animals[Math.floor(Math.random() * animals.length)], color: colors[i], colorLight: colors[i] + '55' };
    try { localStorage.setItem('latex_user', JSON.stringify(u)); } catch { /* ignore */ }
  }
  return u;
}
/*#endregion*/

/*#region Persistence: IndexedDB + other tabs*/
function setupPersistence() {
  const doc = app.doc;
  let timer = null;
  let dirty = false;
  const save = async () => {
    timer = null;
    if (!dirty) return;
    dirty = false;
    try {
      await store.putDocState(app.id, Y.encodeStateAsUpdate(doc));
      await store.patchProject(app.id, { updated: Date.now(), name: app.project.name });
    } catch (e) { console.error(e); toast(String(e.message || e), 'error'); }
    setSaveState();
  };
  app.flush = () => { if (timer) { clearTimeout(timer); save(); } };
  let bc = null;
  try { bc = new BroadcastChannel('latex-doc-' + app.id); } catch { /* old browser */ }
  doc.on('update', (update, origin) => {
    if (bc && origin !== 'bc') bc.postMessage({ t: 'u', u: update });
    dirty = true;
    app.snapshotDirty = true;
    if (!timer) timer = setTimeout(save, 700);
    setSaveState(true);
    const local = origin !== 'bc' && origin !== 'idb' && origin !== app.provider && origin !== 'remote';
    if (local) onLocalEdit();
  });
  if (bc) {
    bc.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'u') Y.applyUpdate(doc, m.u, 'bc');
      else if (m.t === 'sv') bc.postMessage({ t: 'u', u: Y.encodeStateAsUpdate(doc, m.sv) });
    };
    bc.postMessage({ t: 'sv', sv: Y.encodeStateVector(doc) });
  }
  addEventListener('pagehide', () => app.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') app.flush(); });
}

function setSaveState(saving = false) {
  const el = $('#save-state');
  const p = app.provider;
  let cls = ''; let txt = t('ed.saved_local');
  if (saving) { cls = 'saving'; txt = t('ed.saving'); }
  if (p) {
    if (p.status === 'connected') txt = saving ? t('ed.saving') : t('ed.synced');
    else if (p.status === 'connecting') { cls = 'saving'; txt = t('ed.connecting'); }
    else { cls = 'offline'; txt = t('ed.offline'); }
  }
  el.className = 'save-state ' + cls;
  el.querySelector('.txt').textContent = txt;
  el.title = txt;
}
app.setSaveState = setSaveState;

async function autoSnapshot() {
  if (!app.snapshotDirty || app.readOnly) return;
  const now = Date.now();
  if (app.lastSnapshot && now - app.lastSnapshot < 10 * 60000) return;
  if (!app.lastSnapshot) { app.lastSnapshot = now; return; } // first edit of the session: start the clock
  app.lastSnapshot = now;
  app.snapshotDirty = false;
  try { await saveVersion(app, 'auto', true); } catch (e) { console.warn(e); }
}
/*#endregion*/

/*#region Editor*/
const undoManagers = new Map();
const viewStates = new Map(); // fileId -> {anchor, head, scrollTop}

function editorKeys() {
  return [
    { key: 'Mod-s', run: () => { runCompile(); return true; }, preventDefault: true },
    { key: 'Mod-Enter', run: () => { runCompile(); return true; } },
    { key: 'Mod-b', run: (v) => wrapSelection(v, '\\textbf{', '}') },
    { key: 'Mod-i', run: (v) => wrapSelection(v, '\\textit{', '}') },
    { key: 'Mod-Alt-ArrowRight', run: () => { forwardSearch(); return true; } },
    { key: 'Mod-/', run: toggleComment },
  ];
}

function makeState(entry) {
  const ytext = entry.text;
  let um = undoManagers.get(entry.id);
  if (!um) { um = new Y.UndoManager(ytext); undoManagers.set(entry.id, um); }
  const s = app.settings;
  const ext = extOf(entry.path);
  const isLatex = ['tex', 'ltx', 'sty', 'cls', 'bib', 'tikz', 'dtx', 'bbx', 'cbx', 'clo', 'def'].includes(ext);
  return EditorState.create({
    doc: ytext.toString(),
    extensions: [
      compartments.lines.of(s.lineNumbers ? [lineNumbers(), foldGutter()] : []),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      compartments.close.of(s.autoClose ? closeBrackets() : []),
      compartments.complete.of(s.autocomplete && isLatex ? latexCompletions(() => getIndex()) : []),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      keymap.of([...editorKeys(), ...closeBracketsKeymap, ...yUndoManagerKeymap, ...defaultKeymap, ...searchKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
      compartments.lang.of(isLatex ? latex() : []),
      compartments.wrap.of(s.wrap ? EditorView.lineWrapping : []),
      compartments.ro.of(EditorState.readOnly.of(app.readOnly)),
      compartments.spell.of(EditorView.contentAttributes.of({ spellcheck: s.spell ? 'true' : 'false', autocorrect: 'off', autocapitalize: 'off', lang: lang === 'pt' ? 'pt-BR' : 'en' })),
      yCollab(ytext, app.awareness, { undoManager: um }),
      linter(lintSource, { delay: 600 }),
      lintGutter(),
      scrollPastEnd(),
      EditorView.updateListener.of(onViewUpdate),
      EditorState.tabSize.of(4),
    ],
  });
}

function setupEditor() {
  app.view = new EditorView({ parent: $('#cm-host'), state: EditorState.create({ doc: '' }) });
  // Toolbar. Buttons that don't fit go into a "⋯" menu (rightmost first).
  const bar = $('#ed-toolbar');
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) { toolbarCommand(b.dataset.cmd, b); }
  });
  const more = h(`<button type="button" class="tool" id="tb-more" hidden>${icon('dots')}</button>`);
  more.title = t('ed.menu');
  bar.insertBefore(more, bar.querySelector('[data-cmd=topdf]'));
  const fit = () => {
    const items = $$('#ed-toolbar > .tool[data-cmd]:not([data-cmd=topdf]), #ed-toolbar > .sep');
    items.forEach((x) => x.classList.remove('ovf'));
    more.hidden = true;
    for (let i = items.length - 1; i >= 0 && bar.scrollWidth > bar.clientWidth + 1; i--) {
      more.hidden = false;
      items[i].classList.add('ovf');
    }
  };
  new ResizeObserver(fit).observe(bar);
  more.onclick = () => openMenu(more, $$('#ed-toolbar > .tool.ovf[data-cmd]').filter((b) => !b.hidden)
    .map((b) => ({ label: b.title, run: () => toolbarCommand(b.dataset.cmd, more) })), { align: 'right' });
}

function onViewUpdate(u) {
  if (u.selectionSet || u.docChanged) {
    const pos = u.state.selection.main.head;
    const line = u.state.doc.lineAt(pos);
    $('#st-pos').textContent = t('ed.line_col', { l: line.number, c: pos - line.from + 1 });
    scheduleOutline(u.docChanged);
  }
}

function openFile(id, { line, from, focus = true } = {}) {
  const entry = app.project.get(id);
  if (!entry || entry.type === 'dir') return;
  saveViewState();
  app.currentId = id;
  try { localStorage.setItem('latex_last_' + app.id, id); } catch { /* ignore */ }
  $('#no-file').hidden = true;
  if (entry.type === 'text') {
    $('#cm-host').hidden = false;
    $('#binary-view').hidden = true;
    app.view.setState(makeState(entry));
    const vs = viewStates.get(id);
    const doc = app.view.state.doc;
    if (line || from !== undefined) {
      const pos = from !== undefined ? Math.min(from, doc.length) : doc.line(Math.min(Math.max(1, line), doc.lines)).from;
      app.view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    } else if (vs) {
      const clamp = (n) => Math.min(n, doc.length);
      app.view.dispatch({ selection: EditorSelection.single(clamp(vs.anchor), clamp(vs.head)) });
      requestAnimationFrame(() => { app.view.scrollDOM.scrollTop = vs.scrollTop; });
    }
    // On phones, focusing would pop the keyboard up over the file the person just picked.
    if (focus && !matchMedia('(max-width: 860px)').matches) app.view.focus();
  } else {
    showBinary(entry);
  }
  renderCrumb();
  app.tree.render();
  app.tree.reveal(entry.path);
  renderOutline();
}
app.openFile = openFile;

function saveViewState() {
  if (!app.currentId || $('#cm-host').hidden) return;
  const sel = app.view.state.selection.main;
  viewStates.set(app.currentId, { anchor: sel.anchor, head: sel.head, scrollTop: app.view.scrollDOM.scrollTop });
}

function showNoFile() {
  app.currentId = null;
  $('#cm-host').hidden = true;
  $('#binary-view').hidden = true;
  $('#no-file').hidden = false;
  renderCrumb();
  renderOutline();
}

async function showBinary(entry) {
  $('#cm-host').hidden = true;
  const box = $('#binary-view');
  box.hidden = false;
  box.replaceChildren();
  const blob = await store.getBlob(entry.hash);
  const info = h(`<p class="muted"></p>`);
  const rel = (() => { const main = app.project.mainId && app.project.get(app.project.mainId); const d = main ? dirName(main.path) : ''; return d && entry.path.startsWith(d + '/') ? entry.path.slice(d.length + 1) : entry.path; })();
  info.textContent = t('ed.image_info', { size: fmtBytes(entry.size || 0), path: rel });
  if (blob && isImagePath(entry.path)) {
    const img = document.createElement('img');
    img.alt = entry.path;
    img.src = URL.createObjectURL(blob);
    img.onload = () => setTimeout(() => URL.revokeObjectURL(img.src), 1000);
    box.appendChild(img);
  } else {
    box.appendChild(h(`<div class="big-ic">${icon(fileIcon(entry.path))}</div>`));
    box.appendChild(h(`<p></p>`)).textContent = blob ? t('ed.binary') : t('common.loading');
  }
  box.appendChild(info);
  const dl = h(`<button type="button" class="btn">${icon('download')} ${esc(t('common.download'))}</button>`);
  dl.onclick = async () => { const b = await store.getBlob(entry.hash); if (b) download(b, baseName(entry.path)); };
  box.appendChild(dl);
}

function renderCrumb() {
  const c = $('#crumb');
  const e = app.currentId && app.project.get(app.currentId);
  if (!e) { c.textContent = ''; return; }
  const d = dirName(e.path);
  c.innerHTML = `${icon(fileIcon(e.path, e.id === app.project.mainId))}${d ? `<span class="dir">${esc(d)}/</span>` : ''}<span></span>`;
  c.lastChild.textContent = baseName(e.path);
  c.title = e.path;
}

function wrapSelection(view, before, after) {
  if (app.readOnly) return true;
  const changes = view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to);
    return {
      changes: [{ from: range.from, insert: before }, { from: range.to, insert: after }],
      range: text ? EditorSelection.range(range.from + before.length, range.to + before.length) : EditorSelection.cursor(range.from + before.length),
    };
  });
  view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: 'input' }));
  view.focus();
  return true;
}

function insertBlock(view, text, cursorOffset) {
  if (app.readOnly) return;
  const { from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const atLineStart = from === line.from;
  const indent = /^\s*/.exec(line.text)[0];
  const sel = view.state.sliceDoc(from, to);
  let body = text.replace(/\n/g, '\n' + indent).replace('$SEL$', sel);
  const prefix = atLineStart || !line.text.trim() ? '' : '\n' + indent;
  body = prefix + body;
  const caret = body.indexOf('$CUR$');
  body = body.replace('$CUR$', '');
  view.dispatch({ changes: { from, to, insert: body }, selection: EditorSelection.cursor(from + (caret >= 0 ? caret : body.length)), scrollIntoView: true, userEvent: 'input' });
  view.focus();
}

function toolbarCommand(cmd, btn) {
  const v = app.view;
  if (cmd === 'topdf') return forwardSearch();
  if ($('#cm-host').hidden) return;
  const um = undoManagers.get(app.currentId);
  switch (cmd) {
    case 'undo': if (um) um.undo(); break;
    case 'redo': if (um) um.redo(); break;
    case 'bold': wrapSelection(v, '\\textbf{', '}'); break;
    case 'italic': wrapSelection(v, '\\textit{', '}'); break;
    case 'section':
      openMenu(btn, ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph'].map((s) => ({ label: '\\' + s, run: () => insertBlock(v, `\\${s}{$SEL$$CUR$}`) })));
      return;
    case 'ul': insertBlock(v, '\\begin{itemize}\n    \\item $SEL$$CUR$\n\\end{itemize}'); break;
    case 'ol': insertBlock(v, '\\begin{enumerate}\n    \\item $SEL$$CUR$\n\\end{enumerate}'); break;
    case 'math': wrapSelection(v, '$', '$'); break;
    case 'dmath': insertBlock(v, '\\begin{equation}\n    $SEL$$CUR$\n\\end{equation}'); break;
    case 'figure': {
      const imgs = app.project.fileEntries().filter((e) => e.type === 'bin' && /\.(png|jpe?g|pdf|eps)$/i.test(e.path));
      const main = app.project.mainId && app.project.get(app.project.mainId);
      const d = main ? dirName(main.path) : '';
      const name = imgs[0] ? (d && imgs[0].path.startsWith(d + '/') ? imgs[0].path.slice(d.length + 1) : imgs[0].path) : 'image.png';
      insertBlock(v, `\\begin{figure}[htbp]\n    \\centering\n    \\includegraphics[width=0.8\\linewidth]{${name}}\n    \\caption{$SEL$$CUR$}\n    \\label{fig:}\n\\end{figure}`);
      break;
    }
    case 'table': insertBlock(v, '\\begin{table}[htbp]\n    \\centering\n    \\begin{tabular}{c c c}\n        $CUR$ &  &  \\\\\n         &  &  \\\\\n    \\end{tabular}\n    \\caption{$SEL$}\n    \\label{tab:}\n\\end{table}'); break;
    case 'ref': wrapSelection(v, '\\ref{', '}'); startCompletion(v); break;
    case 'cite': wrapSelection(v, '\\cite{', '}'); startCompletion(v); break;
    case 'link': wrapSelection(v, '\\href{https://}{', '}'); break;
    case 'comment': toggleComment(v); v.focus(); break;
    case 'find': openSearchPanel(v); break;
    default: break;
  }
}

function applyEditorSettings() {
  const s = app.settings;
  if (!app.view || !app.currentId) return;
  const e = app.project.get(app.currentId);
  const isLatex = e && ['tex', 'ltx', 'sty', 'cls', 'bib', 'tikz'].includes(extOf(e.path));
  app.view.dispatch({
    effects: [
      compartments.wrap.reconfigure(s.wrap ? EditorView.lineWrapping : []),
      compartments.lines.reconfigure(s.lineNumbers ? [lineNumbers(), foldGutter()] : []),
      compartments.close.reconfigure(s.autoClose ? closeBrackets() : []),
      compartments.complete.reconfigure(s.autocomplete && isLatex ? latexCompletions(() => getIndex()) : []),
      compartments.spell.reconfigure(EditorView.contentAttributes.of({ spellcheck: s.spell ? 'true' : 'false', lang: lang === 'pt' ? 'pt-BR' : 'en' })),
    ],
  });
}

app.updateSettings = (patch) => {
  Object.assign(app.settings, patch);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(app.settings)); } catch { /* ignore */ }
  applySettingsToPage();
  applyEditorSettings();
  if ('autoCompile' in patch || 'halt' in patch) refreshQuota();
};

function applySettingsToPage() {
  const s = app.settings;
  document.body.style.setProperty('--cm-font', s.fontSize + 'px');
  document.body.style.setProperty('--cm-lh', Math.round(s.fontSize * 1.6) + 'px');
  document.body.style.setProperty('--side-w', s.sideW + 'px');
  document.body.style.setProperty('--pdf-w', s.pdfW + '%');
  const ws = $('#workspace');
  if (ws) {
    ws.dataset.layout = s.layout;
    ws.classList.toggle('no-sidebar', !s.sidebar);
  }
  $$('.seg.layout button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === s.layout)));
  const ow = $('#outline-wrap');
  if (ow) ow.classList.toggle('collapsed', !!s.outlineClosed);
  if (app.view) app.view.requestMeasure();
}
/*#endregion*/

/*#region Index, lint, outline*/
let index = null;
function getIndex() {
  if (!index) index = buildIndex(app.project);
  return index;
}

const compileDiags = new Map(); // path -> [{line, level, message, content}]

function lintSource(view) {
  const e = app.currentId && app.project.get(app.currentId);
  if (!e || e.type !== 'text') return [];
  const doc = view.state.doc;
  const out = [];
  for (const d of compileDiags.get(e.path) || []) {
    const ln = Math.min(Math.max(1, d.line || 1), doc.lines);
    const line = doc.line(ln);
    const from = line.from + (line.text.length - line.text.trimStart().length);
    const hint = hintFor(d.message + ' ' + (d.content || ''));
    out.push({
      from, to: Math.max(from, line.to),
      severity: d.level === 'error' ? 'error' : d.level === 'warning' ? 'warning' : 'info',
      message: d.message,
      source: 'LaTeX',
      renderMessage: () => {
        const el = document.createElement('div');
        el.textContent = d.message;
        if (hint) { const s = document.createElement('span'); s.className = 'hint'; s.textContent = t('ed.hint') + ': ' + t('hint.' + hint); el.appendChild(s); }
        return el;
      },
    });
  }
  const local = checkFile(doc.toString(), e.path, getIndex(), t);
  for (const d of local) if (d.to <= doc.length) out.push({ ...d, source: '✓' });
  return out;
}

/** All quick checks across the project (for the logs pane and the tree dots). */
function allLocalChecks() {
  const idx = getIndex();
  const out = [];
  for (const e of app.project.fileEntries()) {
    if (e.type !== 'text' || extOf(e.path) !== 'tex') continue;
    const text = e.text.toString();
    for (const d of checkFile(text, e.path, idx, t)) {
      const line = text.slice(0, d.from).split('\n').length;
      out.push({ level: d.severity, message: d.message, file: e.path, line, from: d.from, content: '' });
    }
  }
  return out;
}

app.problemFiles = () => {
  const m = new Map();
  for (const [path, list] of compileDiags) {
    if (list.some((d) => d.level === 'error')) m.set(path, 'error');
    else if (list.some((d) => d.level === 'warning')) m.set(path, 'warning');
  }
  return m;
};

let outlineTimer = null;
function scheduleOutline(changed) {
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(() => renderOutline(!changed), changed ? 400 : 80);
}

let outlineItems = [];
function renderOutline(onlyCurrent = false) {
  const box = $('#outline');
  const e = app.currentId && app.project.get(app.currentId);
  if (!onlyCurrent) {
    outlineItems = e && e.type === 'text' && ['tex', 'ltx'].includes(extOf(e.path)) ? outlineOf(app.view.state.doc.toString()) : [];
    box.replaceChildren();
    if (!outlineItems.length) { box.appendChild(h(`<div class="tree-empty">${esc(t('ed.outline_empty'))}</div>`)); return; }
    const minLevel = Math.min(...outlineItems.map((o) => o.level));
    for (const o of outlineItems) {
      const b = h('<button type="button" class="outline-item"></button>');
      b.textContent = o.title;
      b.title = o.title;
      b.dataset.kind = o.kind;
      b.style.setProperty('--level', o.level - minLevel);
      b.onclick = () => {
        const pos = Math.min(o.pos, app.view.state.doc.length);
        app.view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 40 }) });
        app.view.focus();
        showMobile('editor');
      };
      box.appendChild(b);
    }
  }
  if (!outlineItems.length || $('#cm-host').hidden) return;
  const head = app.view.state.selection.main.head;
  let cur = -1;
  outlineItems.forEach((o, i) => { if (o.pos <= head) cur = i; });
  $$('.outline-item', box).forEach((b, i) => b.classList.toggle('current', i === cur));
}
/*#endregion*/

/*#region Project changes*/
function observeProject() {
  let treeTimer = null;
  app.project.files.observeDeep((events) => {
    index = null;
    // Structure changed (files added, removed, renamed)?
    const structural = events.some((ev) => ev.target === app.project.files || (ev.target instanceof Y.Map && ev.keysChanged && (ev.keysChanged.has('path') || ev.keysChanged.has('hash'))));
    if (structural) {
      clearTimeout(treeTimer);
      treeTimer = setTimeout(() => {
        app.tree.render();
        renderCrumb();
        if (app.currentId && !app.project.get(app.currentId)) {
          const next = app.project.mainId || (app.project.fileEntries()[0] || {}).id;
          if (next) openFile(next, { focus: false }); else showNoFile();
        } else if (app.currentId) {
          const e = app.project.get(app.currentId);
          if (e && e.type === 'bin' && events.some((ev) => ev.target === e.map)) showBinary(e);
        }
      }, 60);
    }
  });
  app.project.meta.observe((ev) => {
    if (ev.keysChanged.has('name')) renderName();
    if (ev.keysChanged.has('main')) { app.tree.render(); renderCrumb(); index = null; }
  });
}

function renderName() {
  const n = app.project.name;
  $('#proj-name').textContent = n;
  document.title = n + ' · ' + t('app.name');
}

function renderAll() {
  renderName();
  setSaveState();
  $('#st-ro').hidden = !app.readOnly;
  if (app.readOnly) {
    $$('#new-file, #new-folder, #upload').forEach((b) => { b.hidden = true; });
    $$('#ed-toolbar .tool').forEach((b) => { if (!['find', 'topdf'].includes(b.dataset.cmd)) b.hidden = true; });
    $$('#ed-toolbar .sep').forEach((s) => { s.hidden = true; });
  }
  updateWordsButton();
}
/*#endregion*/

/*#region Compile*/
let compiling = null;
let again = false;
let autoTimer = null;
app.lastCompileAt = 0;
app.compileState = { status: 'none' };

function onLocalEdit() {
  if (!app.settings.autoCompile || app.readOnly) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(tryAutoCompile, 2500);
}

function tryAutoCompile() {
  const q = quota();
  const since = Date.now() - app.lastCompileAt;
  if (compiling) { again = true; return; }
  // Leave room for manual compiles: auto compile stops a bit before the public quota runs out.
  const tight = q.used.minute && (q.used.minute.n >= q.used.minute.max - 2 || q.used.hour.max - q.used.hour.n <= 8 || q.used.day.max - q.used.day.n <= 15);
  if (!q.ok || tight) { refreshQuota(); return; }
  if (since < 12000) { autoTimer = setTimeout(tryAutoCompile, 12000 - since); return; }
  runCompile({ auto: true });
}

async function runCompile({ auto = false, force = false, first = false } = {}) {
  if (compiling) { if (!auto) again = true; return; }
  const mainId = app.project.mainId;
  if (!mainId) { if (!first) toast(t('ed.err_nomain'), 'error'); return; }
  const q = quota();
  if (!q.ok) {
    showQuotaBanner(q.waitMs, q.reason, false);
    if (!auto) toast(t(q.reason === 'server' ? 'ed.err_quota_server' : 'ed.err_quota_local', { wait: fmtWait(q.waitMs), reason: t('ed.reason.' + q.reason) }), 'warn', 6000);
    return;
  }
  app.flush && app.flush();
  clearTimeout(autoTimer);
  const ac = new AbortController();
  compiling = ac;
  document.body.classList.add('compiling');
  $('#veil').hidden = false;
  $('#compile .txt').textContent = t('ed.compiling');
  app.lastCompileAt = Date.now();
  const main = app.project.get(mainId);
  const files = snapshot(app.project);
  try {
    const res = await compile({ files, mainPath: main.path, compiler: app.project.compiler, haltOnError: force ? false : app.settings.halt, signal: ac.signal });
    app.lastPdf = res.pdf;
    await showPdf(res.pdf);
    store.putPdf(app.id, res.pdf, res.ms).catch(() => {});
    if (!force) compileDiags.clear();
    app.compileState = force ? { ...app.compileState, status: 'forced', ms: res.ms } : { status: 'ok', ms: res.ms };
    hideBanner();
    $('#st-quota').dataset.last = t('ed.success', { s: (res.ms / 1000).toFixed(1) });
  } catch (e) {
    if (e.kind === 'abort') return;
    if (e.kind === 'latex') {
      const parsed = parseLog(e.log, { mainPath: main.path, files: files.map((f) => f.path), extra: e.logs });
      compileDiags.clear();
      for (const it of parsed.all) {
        if (!it.file) continue;
        if (!compileDiags.has(it.file)) compileDiags.set(it.file, []);
        compileDiags.get(it.file).push(it);
      }
      app.compileState = { status: 'failed', parsed, log: e.log, logs: e.logs, ms: e.ms };
      showFailBanner(parsed);
      // No PDF to show: show the errors instead (without switching panes on phones for automatic compiles).
      if (!app.lastPdf) setLogsOpen(true, { switchPane: !auto });
    } else if (e.kind === 'quota') {
      showQuotaBanner(e.waitMs, e.reason, e.banned);
      app.compileState = { ...app.compileState, status: app.compileState.status };
    } else {
      const msg = e.kind === 'network' ? t(e.offline ? 'ed.err_offline' : e.timeout ? 'ed.err_timeout' : 'ed.err_network') : t('ed.err_server', { detail: e.detail || e.message });
      app.compileState = { status: 'error', message: msg };
      showErrorBanner(msg);
    }
  } finally {
    compiling = null;
    document.body.classList.remove('compiling');
    $('#veil').hidden = true;
    $('#compile .txt').textContent = app.lastPdf ? t('ed.recompile') : t('ed.compile');
    updateBadges();
    if (!$('#logs').hidden) renderLogsPane();
    if (app.view && app.currentId) forceLinting(app.view);
    app.tree.render();
    refreshQuota();
    if (again) { again = false; setTimeout(() => runCompile({ auto: true }), 400); }
  }
}
app.compile = runCompile;

function updateBadges() {
  const st = app.compileState;
  const errs = st.status === 'failed' && st.parsed ? st.parsed.errors.length : 0;
  const warns = st.status === 'failed' && st.parsed ? st.parsed.warnings.length : 0;
  const eb = $('#err-badge'); const wb = $('#warn-badge'); const mb = $('#m-err-badge');
  eb.hidden = !errs; eb.textContent = errs;
  wb.hidden = !warns; wb.textContent = warns;
  mb.hidden = !errs; mb.textContent = errs;
}

function hideBanner() { $('#pdf-banner').hidden = true; }

function showFailBanner(parsed) {
  const b = $('#pdf-banner');
  b.className = 'pdf-banner';
  const n = parsed.errors.length;
  b.innerHTML = `${icon('error')}<span class="grow"></span><button type="button" class="btn small" data-a="logs">${esc(t('ed.view_log'))}</button><button type="button" class="btn small ghost" data-a="force">${esc(t('ed.compile_anyway'))}</button>`;
  b.querySelector('.grow').textContent = (app.lastPdf ? t('ed.failed_banner') : t('ed.failed_banner_nopdf')) + (n ? ' (' + t('ed.errors_n', { n }) + ')' : '');
  b.querySelector('[data-a=logs]').onclick = () => setLogsOpen(true);
  b.querySelector('[data-a=force]').onclick = () => runCompile({ force: true });
  b.hidden = false;
}

function showErrorBanner(msg) {
  const b = $('#pdf-banner');
  b.className = 'pdf-banner';
  b.innerHTML = `${icon('warning')}<span class="grow"></span><button type="button" class="btn small" data-a="retry">${esc(t('common.retry'))}</button>`;
  b.querySelector('.grow').textContent = msg;
  b.querySelector('[data-a=retry]').onclick = () => runCompile();
  b.hidden = false;
}

let quotaTimer = null;
function showQuotaBanner(waitMs, reason, banned) {
  const b = $('#pdf-banner');
  b.className = 'pdf-banner quota';
  const until = Date.now() + waitMs;
  clearInterval(quotaTimer);
  const tick = () => {
    const left = until - Date.now();
    if (left <= 0) { clearInterval(quotaTimer); hideBanner(); refreshQuota(); return; }
    const key = banned ? 'ed.err_quota_ban' : reason === 'server' ? 'ed.err_quota_server' : 'ed.err_quota_local';
    b.innerHTML = `${icon('info')}<span class="grow"></span>`;
    b.querySelector('.grow').textContent = t(key, { wait: fmtWait(left), reason: t('ed.reason.' + reason) });
  };
  tick();
  quotaTimer = setInterval(tick, 1000);
  b.hidden = false;
}

function quotaText() {
  const q = quota();
  if (!q.limits || !q.used.minute) return '';
  const left = (k) => Math.max(0, q.used[k].max - q.used[k].n);
  return t('ed.quota', { m: left('minute'), h: left('hour'), d: left('day') });
}
app.quotaText = quotaText;

function refreshQuota() {
  const q = quota();
  const el = $('#st-quota');
  if (!q.limits || !q.used.minute) { el.textContent = el.dataset.last || ''; el.title = ''; return; }
  const left = (k) => Math.max(0, q.used[k].max - q.used[k].n);
  const last = el.dataset.last ? el.dataset.last + ' · ' : '';
  el.textContent = `${last}${left('minute')}/min · ${left('hour')}/h${app.settings.autoCompile ? ' · auto' : ''}`;
  el.title = quotaText() + '\n' + t('ed.quota_note');
}
app.refreshQuota = refreshQuota;
/*#endregion*/

/*#region PDF*/
function setupPdf() {
  app.pdf = new PdfView($('#pdf-scroll'), {
    page: (n, total) => { $('#page-input').value = n; $('#page-total').textContent = '/ ' + total; },
    scale: (s) => { $('#zoom-val').textContent = Math.round(s * 100) + '%'; },
    reverse: reverseSearch,
  });
  $('#zoom-in').onclick = () => app.pdf.zoom(1);
  $('#zoom-out').onclick = () => app.pdf.zoom(-1);
  $('#fit').onclick = () => app.pdf.setScale(app.pdf.scaleValue === 'page-width' ? 'page-fit' : 'page-width');
  $('#zoom-val').onclick = (e) => openMenu(e.currentTarget, [
    { label: t('ed.fit'), run: () => app.pdf.setScale('page-width') },
    { label: t('ed.fit_page'), run: () => app.pdf.setScale('page-fit') },
    { sep: true },
    ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((s) => ({ label: Math.round(s * 100) + '%', run: () => app.pdf.setScale(s) })),
  ]);
  $('#page-input').addEventListener('change', (e) => app.pdf.goToPage(parseInt(e.target.value, 10) || 1));
  $('#page-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('#dl-pdf').onclick = downloadPdf;
  $('#logs-btn').onclick = () => setLogsOpen($('#logs').hidden);
}

async function showPdf(blob) {
  $('#pdf-empty').hidden = true;
  try { await app.pdf.load(blob); } catch (e) { console.error(e); toast(String(e.message || e), 'error'); }
  $('#compile .txt').textContent = t('ed.recompile');
}

function setPdfEmpty() {
  $('#pdf-empty').hidden = false;
  const msg = $('#pdf-empty-msg');
  msg.replaceChildren();
  msg.appendChild(h(`<p>${esc(t('ed.no_pdf'))}</p>`));
  const b = h(`<button type="button" class="btn primary">${icon('play')} ${esc(t('ed.compile'))}</button>`);
  b.onclick = () => runCompile();
  msg.appendChild(b);
  msg.appendChild(h(`<p class="muted" style="font-size:16px">${esc(t('ed.welcome', { key: modKey + '+S' }))}</p>`));
  $('#compile .txt').textContent = t('ed.compile');
}

function downloadPdf() {
  if (!app.lastPdf) { toast(t('ed.no_pdf'), 'info'); return; }
  download(app.lastPdf, safeFileName(app.project.name) + '.pdf');
}

function setLogsOpen(open, { switchPane = true } = {}) {
  $('#logs').hidden = !open;
  $('#logs-btn').setAttribute('aria-pressed', String(open));
  if (open) { renderLogsPane(); if (switchPane) showMobile('pdf'); }
}

function renderLogsPane() {
  renderLogs(app, app.compileState, allLocalChecks());
}

/** Go to file:line (from logs). */
app.goTo = (path, line, from) => {
  const e = app.project.byPath(path);
  if (!e) return;
  openFile(e.id, { line, from });
  showMobile('editor');
};

/** Source -> PDF: find the text of the cursor line in the PDF. */
async function forwardSearch() {
  if (!app.lastPdf || $('#cm-host').hidden) { toast(t('ed.no_pdf'), 'info'); return; }
  const st = app.view.state;
  const line = st.doc.lineAt(st.selection.main.head);
  const candidates = phrasesFrom(line.text);
  // Also try neighbouring lines (the cursor may be on a command-only line).
  for (let d = 1; d <= 3 && candidates.length < 4; d++) {
    if (line.number + d <= st.doc.lines) candidates.push(...phrasesFrom(st.doc.line(line.number + d).text));
    if (line.number - d >= 1) candidates.push(...phrasesFrom(st.doc.line(line.number - d).text));
  }
  setLayoutIfHidden();
  for (const p of candidates) {
    if (await app.pdf.find(p)) {
      const sc = $('#pdf-scroll');
      sc.classList.remove('flash'); void sc.offsetWidth; sc.classList.add('flash');
      showMobile('pdf');
      return;
    }
  }
  toast(t('ed.goto_none'), 'info', 2500);
}

function phrasesFrom(text) {
  const clean = text.replace(/(^|[^\\])%.*$/, '$1')
    .replace(/\\(begin|end|label|ref|eqref|cite\w*|input|include|includegraphics|usepackage|documentclass)\*?(\[[^\]]*\])?\{[^}]*\}/g, ' ')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?/g, ' ')
    .replace(/[{}[\]\\&~^_#$]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').filter((w) => w.length > 0);
  if (words.length < 2) return words.length && words[0].length > 5 ? [words[0]] : [];
  const out = [];
  const n = Math.min(5, words.length);
  // Middle of the line first (line starts often contain commands rendered differently).
  const startMid = Math.max(0, Math.floor((words.length - n) / 2));
  out.push(words.slice(startMid, startMid + n).join(' '));
  if (words.length > n) out.push(words.slice(0, n).join(' '));
  if (n > 3) out.push(words.slice(startMid, startMid + 3).join(' '));
  return out;
}

/** PDF -> source: look for the double-clicked text in the .tex files. */
function reverseSearch(text, ctx) {
  const words = (text || '').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter((w) => w.length > 1);
  const files = app.project.fileEntries().filter((e) => e.type === 'text' && ['tex', 'ltx'].includes(extOf(e.path)));
  const tries = [];
  for (let n = Math.min(6, words.length); n >= 2; n--) {
    for (let i = 0; i + n <= words.length; i += Math.max(1, Math.floor(n / 2))) tries.push(words.slice(i, i + n));
    if (tries.length > 30) break;
  }
  if (ctx && ctx.word && ctx.word.length > 3) tries.push([ctx.word]);
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Prefer the file being edited, then the main file.
  files.sort((a, b) => (b.id === app.currentId) - (a.id === app.currentId) || (b.id === app.project.mainId) - (a.id === app.project.mainId));
  for (const ws of tries) {
    const re = new RegExp(ws.map(escRe).join('(?:[\\s~]|\\\\[a-zA-Z]+\\*?\\{|[{}]|%[^\\n]*\\n)+'), 'iu');
    for (const f of files) {
      const m = re.exec(f.text.toString());
      if (m) {
        openFile(f.id, { from: m.index, focus: true });
        app.view.dispatch({ selection: EditorSelection.range(m.index, m.index + m[0].length), effects: EditorView.scrollIntoView(m.index, { y: 'center' }) });
        showMobile('editor');
        return;
      }
    }
  }
  toast(t('ed.goto_none_code'), 'info', 2500);
}

function setLayoutIfHidden() {
  if (app.settings.layout === 'code' && !matchMedia('(max-width: 860px)').matches) app.updateSettings({ layout: 'both' });
}
/*#endregion*/

/*#region Top bar & menus*/
function setupTopbar() {
  $('#compile').onclick = () => runCompile();
  $('#compile-menu').onclick = (e) => {
    const s = app.settings;
    const comp = app.project.compiler;
    openMenu(e.currentTarget, [
      { label: t('ed.auto'), checked: s.autoCompile, run: () => { app.updateSettings({ autoCompile: !s.autoCompile }); toast(t('ed.auto') + ': ' + (app.settings.autoCompile ? t('common.yes') : t('common.no')) + ' — ' + t('ed.auto_hint'), 'info', 3500); } },
      { label: t('ed.halt'), checked: s.halt, run: () => app.updateSettings({ halt: !s.halt }) },
      { sep: true },
      { head: t('ed.compiler') },
      ...[['pdflatex', 'pdfLaTeX'], ['xelatex', 'XeLaTeX'], ['lualatex', 'LuaLaTeX']].map(([v, l]) => ({ label: l, checked: comp === v, disabled: app.readOnly, run: () => { app.project.compiler = v; } })),
      { sep: true },
      { label: t('ed.compile_anyway'), icon: 'play', run: () => runCompile({ force: true }) },
      { label: t('ed.stop'), icon: 'close', disabled: !compiling, run: () => compiling && compiling.abort() },
      { sep: true },
      { label: quotaText() || t('ed.server'), icon: 'info', disabled: true },
    ], { align: 'right' });
  };
  $('#proj-name').onclick = async () => {
    if (app.readOnly) return;
    const v = await prompt({ title: t('dash.rename_title'), label: t('common.name'), value: app.project.name, okLabel: t('common.rename'), validate: (x) => (x.trim() ? '' : t('ed.bad_name')) });
    if (v) app.project.name = v;
  };
  $$('.seg.layout button').forEach((b) => { b.onclick = () => app.updateSettings({ layout: b.dataset.layout }); });
  $('#menu-btn').onclick = (e) => openMenu(e.currentTarget, [
    { label: t('ed.download_pdf'), icon: 'file_pdf', disabled: !app.lastPdf, run: downloadPdf },
    { label: t('ed.download_zip'), icon: 'download', run: downloadZip },
    { sep: true },
    { label: t('ed.history'), icon: 'history', run: () => openHistory(app) },
    { label: t('ed.word_count'), icon: 'hash', run: () => openWordCount(app) },
    { label: t('ed.find'), icon: 'search', run: () => { if (!$('#cm-host').hidden) openSearchPanel(app.view); } },
    { sep: true },
    { label: t('ed.files') + ' / ' + t('ed.outline'), checked: app.settings.sidebar, run: () => app.updateSettings({ sidebar: !app.settings.sidebar }) },
    { label: t('ed.settings'), icon: 'settings', run: () => openSettings(app) },
    { label: t('ed.shortcuts'), icon: 'keyboard', run: openShortcuts },
    { sep: true },
    { label: t('ed.projects'), icon: 'back', run: () => { location.href = '/latex/'; } },
  ], { align: 'right' });
  $('#share').onclick = async () => {
    try {
      const { openShareDialog } = await import('./collab.js');
      openShareDialog(app);
    } catch (e) { console.error(e); toast(t('share.unavailable', { err: e.message || e }), 'error'); }
  };
  $('#st-words').onclick = () => openWordCount(app);
  $('#st-quota').onclick = () => setLogsOpen(true);
  $('#outline-fold').onclick = () => app.updateSettings({ outlineClosed: !app.settings.outlineClosed });
}

async function downloadZip() {
  const blob = await exportZip(snapshot(app.project));
  download(blob, safeFileName(app.project.name) + '.zip');
}

let wordsTimer = null;
function updateWordsButton() {
  clearTimeout(wordsTimer);
  wordsTimer = setTimeout(async () => {
    const { wordCount } = await import('./lint.js');
    const main = app.project.mainId && app.project.get(app.project.mainId);
    $('#st-words span').textContent = main ? t('ed.words_n', { n: wordCount(main.text.toString()) }) : '';
  }, 1500);
}
/*#endregion*/

/*#region Layout: resizers, mobile panes*/
function setupLayout() {
  $$('.gutter').forEach((g) => {
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      g.classList.add('drag');
      document.body.classList.add('dragging');
      const ws = $('#workspace').getBoundingClientRect();
      const move = (ev) => {
        if (g.dataset.resize === 'side') {
          const w = Math.min(Math.max(160, ev.clientX - ws.left), 480);
          document.body.style.setProperty('--side-w', w + 'px');
          app.settings.sideW = w;
        } else {
          const pct = Math.min(Math.max(20, ((ws.right - ev.clientX) / ws.width) * 100), 80);
          document.body.style.setProperty('--pdf-w', pct + '%');
          app.settings.pdfW = Math.round(pct * 10) / 10;
        }
      };
      const up = () => {
        g.classList.remove('drag');
        document.body.classList.remove('dragging');
        g.removeEventListener('pointermove', move);
        g.removeEventListener('pointerup', up);
        app.updateSettings({});
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', up);
    });
    g.addEventListener('dblclick', () => app.updateSettings(g.dataset.resize === 'side' ? { sideW: DEFAULTS.sideW } : { pdfW: DEFAULTS.pdfW }));
  });
  $$('#mobile-tabs button').forEach((b) => { b.onclick = () => showMobile(b.dataset.pane, true); });
  showMobile('editor', true);
}

function showMobile(pane, force = false) {
  const ws = $('#workspace');
  if (!force && !matchMedia('(max-width: 860px)').matches) return;
  ws.dataset.mobile = pane;
  $$('#mobile-tabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pane === pane)));
  if (pane === 'editor' && app.view) app.view.requestMeasure();
}
app.showMobile = showMobile;
/*#endregion*/

/*#region Uploads*/
function setupUploads() {
  const input = $('#upload-input');
  let targetDir = '';
  app.pickUpload = (dir = '') => { targetDir = dir; input.value = ''; input.click(); };
  input.onchange = () => { if (input.files.length) app.uploadFiles([...input.files], targetDir); };

  // Drop files anywhere on the page.
  let overlay = null; let depth = 0;
  const hide = () => { depth = 0; if (overlay) { overlay.remove(); overlay = null; } };
  app.hideDropOverlay = hide;
  addEventListener('dragenter', (e) => {
    if (app.readOnly || !e.dataTransfer.types.includes('Files')) return;
    depth++;
    if (!overlay) { overlay = h(`<div class="drop-overlay">${esc(t('ed.drop_files'))}</div>`); document.body.appendChild(overlay); }
  });
  addEventListener('dragleave', () => { if (--depth <= 0) hide(); });
  addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  addEventListener('drop', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    hide();
    if (!app.readOnly && e.dataTransfer.files.length) app.uploadFiles([...e.dataTransfer.files], '');
  });
}

app.uploadFiles = async (files, dir = '') => {
  let n = 0;
  const limit = app.provider ? app.provider.maxFile : MAX_FILE;
  for (const f of files) {
    if (f.size > limit) { toast(t('ed.too_big', { name: f.name, max: fmtBytes(limit) }), 'error', 6000); continue; }
    const path = cleanPath((dir ? dir + '/' : '') + f.name);
    if (!path) continue;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const file = toFile(path, bytes);
    const existing = app.project.byPath(path);
    if (file.content !== undefined) {
      if (existing && existing.type === 'text') {
        if (!(await confirm({ title: t('ed.exists'), message: path, okLabel: t('common.ok') }))) continue;
        const { replaceText } = await import('./editor-dialogs.js');
        replaceText(existing.text, file.content);
      } else {
        app.project.createText(existing ? app.project.freePath(path) : path, file.content);
      }
    } else {
      const info = await store.putBlob(bytes, f.type || mimeOf(path));
      if (existing && existing.type === 'text') app.project.putBinary(app.project.freePath(path), info);
      else app.project.putBinary(path, info);
      if (app.provider) app.provider.uploadBlob(info.hash);
    }
    n++;
  }
  if (n) toast(t('ed.uploaded', { n }), 'success', 2500);
  if (dir) app.tree.reveal(dir + '/x');
};
/*#endregion*/

/*#region Global keys*/
function setupKeys() {
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return; // already handled by the editor's own keymap
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (!modalOpen()) runCompile(); }
    else if (mod && e.key === 'Enter' && !app.view.hasFocus) { e.preventDefault(); runCompile(); }
    else if (e.key === 'Escape' && !$('#logs').hidden && !modalOpen()) setLogsOpen(false);
  });
  // Keep the word count fresh.
  app.doc.on('afterTransaction', () => updateWordsButton());
}
/*#endregion*/

boot().catch((e) => { console.error(e); notFound(String(e && e.message || e)); });
