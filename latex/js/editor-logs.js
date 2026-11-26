// The "Logs" pane over the PDF: errors / warnings / bad boxes from the last compile (with tips for
// common errors), the quick local checks, and the raw log.
import { icon } from './icons.js';
import { t } from './i18n.js';
import { $, h, esc } from './ui.js';
import { hintFor } from './logparse.js';

function item(app, it) {
  const where = it.file ? `${esc(it.file)}${it.line ? ':' + it.line : ''}` : (it.rawFile ? esc(it.rawFile) + (it.line ? ':' + it.line : '') : '');
  const hint = hintFor(it.message + ' ' + (it.content || ''));
  const ic = it.level === 'error' ? 'error' : it.level === 'warning' ? 'warning' : 'info';
  const el = h(`<div class="log-item ${it.level} ${it.file ? '' : 'nofile'}" tabindex="${it.file ? 0 : -1}">
    <div class="where">${icon(ic)}<span>${where || '—'}</span></div>
    <div class="msg"></div>
    ${it.content ? '<div class="ctx"></div>' : ''}
    ${hint ? `<div class="hint"><b>${esc(t('ed.hint'))}:</b> ${esc(t('hint.' + hint))}</div>` : ''}
  </div>`);
  el.querySelector('.msg').textContent = it.message;
  if (it.content) el.querySelector('.ctx').textContent = it.content;
  if (it.file) {
    const go = () => app.goTo(it.file, it.line, it.from);
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }
  return el;
}

/**
 * state: {status: 'none'|'ok'|'failed'|'error', parsed, log, logs, ms, message}
 * local: [{file, line, from, level, message}]
 */
export function renderLogs(app, state, local) {
  const box = $('#logs');
  box.replaceChildren();
  const parsed = state.parsed;

  if (state.status === 'ok') {
    box.appendChild(h(`<div class="ok-line">${icon('ok')}<span>${esc(t('ed.success', { s: (state.ms / 1000).toFixed(1) }))} · ${esc(t('ed.no_errors'))}</span></div>`));
  } else if (state.status === 'error' && state.message) {
    box.appendChild(h(`<div class="ok-line">${icon('warning')}<span></span></div>`));
    box.lastChild.querySelector('span').textContent = state.message;
  }

  if (parsed && parsed.all.length) {
    box.appendChild(h(`<h4>${esc(t('ed.from_log'))}</h4>`));
    for (const it of [...parsed.errors, ...parsed.warnings]) box.appendChild(item(app, it));
    if (parsed.typesetting.length) {
      const det = h(`<details><summary class="muted">${esc(t('ed.boxes'))} (${parsed.typesetting.length})</summary></details>`);
      for (const it of parsed.typesetting) det.appendChild(item(app, it));
      box.appendChild(det);
    }
  } else if (state.status === 'failed') {
    box.appendChild(h(`<div class="ok-line">${icon('error')}<span>${esc(t('ed.failed'))}</span></div>`));
  }

  if (local && local.length) {
    box.appendChild(h(`<h4>${esc(t('ed.local_checks'))}</h4>`));
    for (const it of local.slice(0, 200)) box.appendChild(item(app, it));
  }

  if (state.log || state.logs) {
    const det = h(`<details><summary>${esc(t('ed.raw_log'))}</summary><pre class="raw-log"></pre></details>`);
    det.querySelector('pre').textContent = (state.log || '') + (state.logs ? '\n\n---------- latexmk ----------\n' + state.logs : '');
    box.appendChild(h('<h4></h4>'));
    box.appendChild(det);
  }

  const q = app.quotaText && app.quotaText();
  if (q) {
    const p = h('<p class="quota-line"></p>');
    p.textContent = q + ' · ' + t('ed.quota_note');
    box.appendChild(p);
  }
}
