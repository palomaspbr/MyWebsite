// Small UI helpers shared by the dashboard and the editor: toasts (sticky notes), modal sheets,
// prompt/confirm, dropdown menus, downloads and the site's sun/moon theme toggle.
import { icon, hydrateIcons } from './icons.js';
import { t } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function h(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  hydrateIcons(tpl.content);
  return tpl.content.firstElementChild;
}

/*#region Toasts*/
export function toast(message, kind = '', ms = 4200, action = null) {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const ic = { success: 'ok', error: 'error', info: 'info', warn: 'warning' }[kind] || 'info';
  const el = h(`<div class="toast ${kind}">${icon(ic)}<span></span>${action ? '<button type="button" class="act"></button>' : ''}<button type="button" class="x" aria-label="${esc(t('common.close'))}">${icon('close')}</button></div>`);
  el.querySelector('span').textContent = message;
  const close = () => { el.remove(); };
  el.querySelector('.x').onclick = close;
  if (action) {
    const b = el.querySelector('.act');
    b.textContent = action.label;
    b.style.cssText = 'text-decoration: underline wavy var(--red) 1.5px; font-size: 16px;';
    b.onclick = () => { close(); action.run(); };
  }
  box.appendChild(el);
  if (ms) setTimeout(close, ms);
  return close;
}
/*#endregion*/

/*#region Modal sheets*/
let openSheets = 0;
/** Open a modal. `body` is an element or HTML. Returns {el, close, done: Promise}. */
export function modal({ title, body, wide = false, onClose }) {
  const back = h(`<div class="backdrop"><div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <button type="button" class="icon-btn close" aria-label="${esc(t('common.close'))}">${icon('close')}</button>
    <h2></h2><div class="sheet-body"></div></div></div>`);
  const sheet = back.firstElementChild;
  sheet.querySelector('h2').textContent = title || '';
  const bodyBox = sheet.querySelector('.sheet-body');
  if (typeof body === 'string') { bodyBox.innerHTML = body; hydrateIcons(bodyBox); } else if (body) bodyBox.appendChild(body);
  const prevFocus = document.activeElement;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  let closed = false;
  function close(value) {
    if (closed) return;
    closed = true;
    back.remove();
    openSheets--;
    document.removeEventListener('keydown', onKey, true);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
    if (onClose) onClose(value);
    resolveDone(value);
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(undefined); }
    if (e.key === 'Tab') {
      // Keep focus inside the sheet.
      const f = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', sheet).filter((x) => !x.disabled && x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  }
  sheet.querySelector('.close').onclick = () => close(undefined);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(undefined); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(back);
  openSheets++;
  setTimeout(() => {
    const first = sheet.querySelector('[autofocus], input, select, textarea, .actions .primary') || sheet.querySelector('.close');
    if (first) { first.focus(); if (first.select && first.tagName === 'INPUT') first.select(); }
  }, 20);
  return { el: sheet, body: bodyBox, close, done };
}
export const modalOpen = () => openSheets > 0;

/** Ask for a line of text. validate(value) returns an error message or ''. */
export function prompt({ title, label = '', value = '', okLabel = t('common.ok'), validate, hint = '' }) {
  const body = h(`<form>
      <label class="row"></label>
      <input class="field" type="text" spellcheck="false" autocomplete="off">
      ${hint ? '<p class="hint"></p>' : ''}
      <p class="err" aria-live="polite"></p>
      <div class="actions"><button type="button" class="btn ghost cancel"></button><button type="submit" class="btn primary"></button></div>
    </form>`);
  body.querySelector('label').textContent = label;
  if (hint) body.querySelector('.hint').textContent = hint;
  const input = body.querySelector('input');
  input.value = value;
  input.setAttribute('aria-label', label || title);
  body.querySelector('.cancel').textContent = t('common.cancel');
  body.querySelector('.primary').textContent = okLabel;
  const m = modal({ title, body });
  // Select the name without its extension, like file managers do.
  setTimeout(() => { const dot = value.lastIndexOf('.'); const slash = value.lastIndexOf('/'); input.focus(); input.setSelectionRange(slash + 1, dot > slash + 1 ? dot : value.length); }, 30);
  body.querySelector('.cancel').onclick = () => m.close(null);
  body.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim();
    const err = validate ? validate(v) : '';
    if (err) { body.querySelector('.err').textContent = err; input.focus(); return; }
    m.close(v);
  });
  return m.done.then((v) => (v === undefined ? null : v));
}

export function confirm({ title, message = '', okLabel = t('common.ok'), danger = false }) {
  const body = h(`<div><p class="msg"></p><div class="actions"><button type="button" class="btn ghost cancel"></button><button type="button" class="btn ${danger ? 'danger' : 'primary'} ok"></button></div></div>`);
  body.querySelector('.msg').textContent = message;
  body.querySelector('.cancel').textContent = t('common.cancel');
  body.querySelector('.ok').textContent = okLabel;
  const m = modal({ title, body });
  body.querySelector('.cancel').onclick = () => m.close(false);
  body.querySelector('.ok').onclick = () => m.close(true);
  setTimeout(() => body.querySelector('.ok').focus(), 30);
  return m.done.then((v) => !!v);
}
/*#endregion*/

/*#region Dropdown menus*/
let currentMenu = null;
export function closeMenu() { if (currentMenu) { currentMenu.remove(); currentMenu = null; } }
/**
 * items: [{label, icon, kbd, run, checked, disabled, danger, sep, head, el}] ; anchor: element or {x, y}
 */
export function openMenu(anchor, items, { align = 'left' } = {}) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { menu.appendChild(h('<div class="sep"></div>')); continue; }
    if (it.head) { const d = h('<div class="head"></div>'); d.textContent = it.head; menu.appendChild(d); continue; }
    if (it.el) { menu.appendChild(it.el); continue; }
    const b = h(`<button type="button" role="menuitem">${it.checked !== undefined ? `<span class="check">${it.checked ? icon('check') : ''}</span>` : it.icon ? icon(it.icon) : ''}<span class="grow"></span>${it.kbd ? `<span class="kbd">${esc(it.kbd)}</span>` : ''}</button>`);
    b.querySelector('.grow').textContent = it.label;
    if (it.danger) b.classList.add('danger');
    if (it.disabled) b.disabled = true;
    b.onclick = (e) => { e.stopPropagation(); if (!it.keepOpen) closeMenu(); it.run && it.run(); };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  currentMenu = menu;
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const mw = menu.offsetWidth; const mh = menu.offsetHeight;
  let x = align === 'right' ? r.right - mw : r.left;
  let y = r.bottom + 6;
  if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 6);
  x = Math.max(8, Math.min(x, innerWidth - mw - 8));
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  const first = menu.querySelector('button:not(:disabled)');
  if (first && !anchor.x) first.focus({ preventScroll: true });
  menu.addEventListener('keydown', (e) => {
    const btns = $$('button:not(:disabled)', menu);
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
    if (e.key === 'Escape') { closeMenu(); if (anchor.focus) anchor.focus(); }
  });
  return menu;
}
document.addEventListener('mousedown', (e) => { if (currentMenu && !currentMenu.contains(e.target)) closeMenu(); });
window.addEventListener('resize', closeMenu);
window.addEventListener('blur', closeMenu);
/*#endregion*/

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

export function safeFileName(name) {
  return (String(name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'project').slice(0, 80);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove(); return ok;
  }
}

/** Wire a button to the site's light/dark toggle (/static/theme.js, key "theme" shared with the site). */
export function themeButton(btn) {
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

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';
