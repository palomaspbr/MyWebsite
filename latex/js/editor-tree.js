// File tree of the editor: folders and files of the project, selection, context menu
// (rename, delete, main document, download, new file/folder here, upload here), drag and drop to move,
// and dropping files from the computer into a folder.
import { icon, fileIcon } from './icons.js';
import { t } from './i18n.js';
import { $, esc, openMenu, prompt, confirm, toast, download, h } from './ui.js';
import { baseName, dirName, cleanPath, extOf, isTextPath } from './project.js';
import { getBlob } from './store.js';

export function initTree(app) {
  const tree = $('#tree');
  const collapsedKey = 'latex_tree_closed_' + app.id;
  let closed = new Set();
  try { closed = new Set(JSON.parse(localStorage.getItem(collapsedKey)) || []); } catch { /* ignore */ }
  const saveClosed = () => { try { localStorage.setItem(collapsedKey, JSON.stringify([...closed])); } catch { /* ignore */ } };

  /** Nested structure: {folders: Map(name -> node), files: [entry]} */
  function build() {
    const root = { path: '', folders: new Map(), files: [] };
    const ensure = (path) => {
      let node = root;
      if (!path) return node;
      let acc = '';
      for (const part of path.split('/')) {
        acc = acc ? acc + '/' + part : part;
        if (!node.folders.has(part)) node.folders.set(part, { path: acc, folders: new Map(), files: [] });
        node = node.folders.get(part);
      }
      return node;
    };
    for (const e of app.project.entries()) {
      if (e.type === 'dir') ensure(e.path);
      else ensure(dirName(e.path)).files.push(e);
    }
    return root;
  }

  function render() {
    const root = build();
    const mainId = app.project.mainId;
    const problems = app.problemFiles ? app.problemFiles() : new Map();
    const frag = document.createDocumentFragment();
    const addRows = (node, depth) => {
      const folders = [...node.folders.values()].sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
      for (const f of folders) {
        const isClosed = closed.has(f.path);
        const row = h(`<div class="tree-row folder ${isClosed ? 'closed' : ''}" role="treeitem" aria-expanded="${!isClosed}" tabindex="0" draggable="${!app.readOnly}">
          <span class="chev">${icon('chevron_down')}</span>${icon(isClosed ? 'folder' : 'folder_open')}<span class="name"></span>
          ${app.readOnly ? '' : `<button type="button" class="more" aria-label="${esc(t('ed.menu'))}">${icon('dots')}</button>`}</div>`);
        row.style.setProperty('--depth', depth);
        row.dataset.path = f.path;
        row.dataset.kind = 'dir';
        row.querySelector('.name').textContent = baseName(f.path);
        frag.appendChild(row);
        if (!isClosed) addRows(f, depth + 1);
      }
      const files = [...node.files].sort((a, b) => baseName(a.path).localeCompare(baseName(b.path), undefined, { sensitivity: 'base' }));
      for (const e of files) {
        const isMain = e.id === mainId;
        const prob = problems.get(e.path);
        const row = h(`<div class="tree-row file ${e.id === app.currentId ? 'selected' : ''}" role="treeitem" tabindex="0" draggable="${!app.readOnly}">
          <span class="chev"></span>${icon(fileIcon(e.path, isMain))}<span class="name"></span>
          ${prob ? `<span class="err-dot ${prob === 'warning' ? 'warn' : ''}"></span>` : ''}
          ${app.readOnly ? '' : `<button type="button" class="more" aria-label="${esc(t('ed.menu'))}">${icon('dots')}</button>`}</div>`);
        row.style.setProperty('--depth', depth);
        row.dataset.id = e.id;
        row.dataset.path = e.path;
        row.dataset.kind = 'file';
        row.querySelector('.name').textContent = baseName(e.path);
        row.title = e.path + (isMain ? ' · ' + t('ed.main_doc') : '');
        frag.appendChild(row);
      }
    };
    addRows(root, 0);
    tree.replaceChildren(frag);
    if (!tree.children.length) tree.appendChild(h(`<div class="tree-empty">—</div>`));
  }

  /*#region Actions*/
  const validateNew = (dir) => (v) => {
    const p = cleanPath((dir ? dir + '/' : '') + v);
    if (!p) return t('ed.bad_name');
    if (app.project.exists(p)) return t('ed.exists');
    return '';
  };

  async function newFile(dir = '') {
    const name = await prompt({ title: t('ed.new_file'), label: t('ed.file_name'), value: 'chapter.tex', okLabel: t('common.create'), validate: validateNew(dir) });
    if (!name) return;
    const path = cleanPath((dir ? dir + '/' : '') + name);
    if (dir) closed.delete(dir);
    const id = app.project.createText(path, '');
    app.openFile(id);
  }

  async function newFolder(dir = '') {
    const name = await prompt({ title: t('ed.new_folder'), label: t('ed.folder_name'), value: '', okLabel: t('common.create'), validate: validateNew(dir) });
    if (!name) return;
    const path = cleanPath((dir ? dir + '/' : '') + name);
    if (dir) { closed.delete(dir); saveClosed(); }
    app.project.createFolder(path);
  }

  async function rename(row) {
    const old = row.dataset.path;
    const isDir = row.dataset.kind === 'dir';
    const v = await prompt({
      title: t('common.rename'), label: t('ed.move_to'), value: old, okLabel: t('common.rename'),
      validate: (val) => {
        const p = cleanPath(val);
        if (!p) return t('ed.bad_name');
        if (p !== old && app.project.exists(p)) return t('ed.exists');
        if (isDir && p.startsWith(old + '/')) return t('ed.bad_name');
        return '';
      },
    });
    if (!v) return;
    const p = cleanPath(v);
    if (p === old) return;
    if (isDir) app.project.renameFolder(old, p);
    else app.project.renameFile(row.dataset.id, p);
  }

  async function remove(row) {
    const isDir = row.dataset.kind === 'dir';
    const name = baseName(row.dataset.path);
    const ok = await confirm({ title: t(isDir ? 'ed.delete_folder' : 'ed.delete_file', { name }), okLabel: t('common.delete'), danger: true });
    if (!ok) return;
    if (isDir) app.project.deleteFolder(row.dataset.path);
    else app.project.deleteFile(row.dataset.id);
  }

  async function downloadFile(id) {
    const e = app.project.get(id);
    if (!e) return;
    if (e.type === 'text') download(new Blob([e.text.toString()], { type: 'text/plain;charset=utf-8' }), baseName(e.path));
    else { const b = await getBlob(e.hash); if (b) download(b, baseName(e.path)); }
  }

  function menuFor(row, anchor) {
    const isDir = row.dataset.kind === 'dir';
    const items = [];
    if (isDir) {
      items.push({ label: t('ed.new_file'), icon: 'new_file', run: () => newFile(row.dataset.path) });
      items.push({ label: t('ed.new_folder'), icon: 'new_folder', run: () => newFolder(row.dataset.path) });
      items.push({ label: t('ed.upload'), icon: 'upload', run: () => app.pickUpload(row.dataset.path) });
      items.push({ sep: true });
    } else {
      const e = app.project.get(row.dataset.id);
      if (e && e.type === 'text' && extOf(e.path) === 'tex' && e.id !== app.project.mainId) {
        items.push({ label: t('ed.set_main'), icon: 'star', run: () => { app.project.mainId = e.id; toast(t('ed.main_doc') + ': ' + e.path, 'success', 2500); } });
      }
      items.push({ label: t('common.download'), icon: 'download', run: () => downloadFile(row.dataset.id) });
    }
    items.push({ label: t('common.rename'), icon: 'edit', run: () => rename(row) });
    items.push({ label: t('common.delete'), icon: 'delete', danger: true, run: () => remove(row) });
    openMenu(anchor, items);
  }
  /*#endregion*/

  /*#region Events*/
  tree.addEventListener('click', (e) => {
    const row = e.target.closest('.tree-row');
    if (!row) return;
    if (e.target.closest('.more')) { if (!app.readOnly) menuFor(row, e.target.closest('.more')); return; }
    if (row.dataset.kind === 'dir') {
      if (closed.has(row.dataset.path)) closed.delete(row.dataset.path); else closed.add(row.dataset.path);
      saveClosed();
      render();
      const again = tree.querySelector(`.tree-row[data-path="${CSS.escape(row.dataset.path)}"]`);
      if (again) again.focus();
    } else {
      app.openFile(row.dataset.id);
      app.showMobile && app.showMobile('editor');
    }
  });
  tree.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.tree-row');
    if (!row || app.readOnly) return;
    e.preventDefault();
    menuFor(row, { x: e.clientX, y: e.clientY });
  });
  tree.addEventListener('keydown', (e) => {
    const row = e.target.closest('.tree-row');
    if (!row) return;
    const rows = [...tree.querySelectorAll('.tree-row')];
    const i = rows.indexOf(row);
    if (e.key === 'ArrowDown') { e.preventDefault(); (rows[i + 1] || row).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (rows[i - 1] || row).focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
    else if (e.key === 'F2' && !app.readOnly) { e.preventDefault(); rename(row); }
    else if (e.key === 'Delete' && !app.readOnly) { e.preventDefault(); remove(row); }
    else if (e.key === 'ArrowLeft' && row.dataset.kind === 'dir' && !closed.has(row.dataset.path)) row.click();
    else if (e.key === 'ArrowRight' && row.dataset.kind === 'dir' && closed.has(row.dataset.path)) row.click();
  });

  // Drag rows to move them into folders; drop files from the computer to upload.
  let dragging = null;
  tree.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.tree-row');
    if (!row || app.readOnly) return;
    dragging = { kind: row.dataset.kind, path: row.dataset.path, id: row.dataset.id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dataset.path);
  });
  tree.addEventListener('dragend', () => { dragging = null; clearTargets(); });
  const clearTargets = () => { tree.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target')); tree.classList.remove('drop-root'); };
  const targetDir = (e) => {
    const row = e.target.closest('.tree-row');
    if (!row) return '';
    return row.dataset.kind === 'dir' ? row.dataset.path : dirName(row.dataset.path);
  };
  tree.addEventListener('dragover', (e) => {
    const files = e.dataTransfer.types.includes('Files');
    if (!dragging && !files) return;
    if (app.readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    clearTargets();
    const dir = targetDir(e);
    const row = dir ? tree.querySelector(`.tree-row.folder[data-path="${CSS.escape(dir)}"]`) : null;
    if (row) row.classList.add('drop-target'); else tree.classList.add('drop-root');
    e.dataTransfer.dropEffect = files ? 'copy' : 'move';
  });
  tree.addEventListener('dragleave', (e) => { if (!tree.contains(e.relatedTarget)) clearTargets(); });
  tree.addEventListener('drop', async (e) => {
    if (app.readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    clearTargets();
    app.hideDropOverlay && app.hideDropOverlay();
    const dir = targetDir(e);
    if (e.dataTransfer.files && e.dataTransfer.files.length && !dragging) {
      await app.uploadFiles([...e.dataTransfer.files], dir);
      return;
    }
    if (!dragging) return;
    const name = baseName(dragging.path);
    const dest = (dir ? dir + '/' : '') + name;
    if (dest === dragging.path || (dragging.kind === 'dir' && (dir === dragging.path || dir.startsWith(dragging.path + '/')))) return;
    if (app.project.exists(dest)) { toast(t('ed.exists'), 'error'); return; }
    if (dragging.kind === 'dir') app.project.renameFolder(dragging.path, dest);
    else app.project.renameFile(dragging.id, dest);
    if (dir) { closed.delete(dir); saveClosed(); }
    dragging = null;
  });
  /*#endregion*/

  $('#new-file').onclick = () => newFile(app.currentId ? dirName(app.project.get(app.currentId)?.path || '') : '');
  $('#new-folder').onclick = () => newFolder('');
  $('#upload').onclick = () => app.pickUpload('');

  return {
    render,
    reveal(path) {
      let d = dirName(path); let changed = false;
      while (d) { if (closed.delete(d)) changed = true; d = dirName(d); }
      if (changed) { saveClosed(); render(); }
    },
    newFile, newFolder,
  };
}

/** Is this a file we should open as text? (used by uploads) */
export const looksText = (name) => isTextPath(name);
