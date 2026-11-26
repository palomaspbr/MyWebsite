// Project index (labels, bibliography keys, files, user commands) for autocomplete, and quick local
// checks that run while typing: undefined \ref / \cite keys, missing \input / \includegraphics files,
// unbalanced \begin / \end, duplicate labels. The compile server only returns a log when a build
// fails, so these checks give the warnings Overleaf would show after a successful compile.
import { dirName, extOf } from './project.js';

/** Blank out comments (keeping offsets) so we don't match commented-out code. */
export function stripComments(text) {
  return text.replace(/(^|[^\\])(%.*)$/gm, (m, a, c) => a + ' '.repeat(c.length));
}

const LABEL_RE = /\\label\{([^}#]+)\}/g;
const BIBITEM_RE = /\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}/g;
const NEWCMD_RE = /\\(?:re)?newcommand\*?\s*\{?\\([a-zA-Z@]+)\}?\s*(?:\[(\d)\])?|\\DeclareMathOperator\*?\s*\{?\\([a-zA-Z]+)\}?|\\def\\([a-zA-Z@]+)/g;
const NEWENV_RE = /\\(?:re)?newenvironment\*?\{([^}]+)\}|\\newtheorem\*?\{([^}]+)\}/g;

function parseBib(text, file, out) {
  const re = /@(\w+)\s*[{(]\s*([^,\s{}()]+)\s*,/g;
  let m;
  while ((m = re.exec(text))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    const rest = text.slice(m.index, m.index + 1200);
    const t = /\btitle\s*=\s*[{"]\s*\{?([^}"]{1,200})/i.exec(rest);
    out.push({ key: m[2], title: t ? t[1].replace(/\s+/g, ' ').trim() : '', file });
  }
}

export function buildIndex(project) {
  const labels = []; const bibKeys = []; const commands = []; const envs = new Set();
  const entries = project.fileEntries();
  for (const e of entries) {
    if (e.type !== 'text') continue;
    const ext = extOf(e.path);
    const text = e.text.toString();
    if (ext === 'bib') { parseBib(text, e.path, bibKeys); continue; }
    if (!['tex', 'ltx', 'sty', 'cls', 'tikz'].includes(ext)) continue;
    const clean = stripComments(text);
    let m;
    LABEL_RE.lastIndex = 0;
    while ((m = LABEL_RE.exec(clean))) labels.push({ key: m[1].trim(), file: e.path, pos: m.index });
    BIBITEM_RE.lastIndex = 0;
    while ((m = BIBITEM_RE.exec(clean))) bibKeys.push({ key: m[1].trim(), title: '', file: e.path });
    NEWCMD_RE.lastIndex = 0;
    while ((m = NEWCMD_RE.exec(clean))) {
      const name = m[1] || m[3] || m[4];
      if (name) commands.push({ name, args: m[2] ? +m[2] : 0 });
    }
    NEWENV_RE.lastIndex = 0;
    while ((m = NEWENV_RE.exec(clean))) envs.add(m[1] || m[2]);
  }
  const mainId = project.mainId;
  const main = mainId ? project.get(mainId) : null;
  return {
    labels,
    bibKeys,
    commands,
    envs: [...envs],
    files: entries.map((e) => e.path),
    mainDir: main ? dirName(main.path) : '',
    hasBib: entries.some((e) => extOf(e.path) === 'bib') || bibKeys.length > 0,
  };
}

function resolve(idx, name, exts) {
  const fileSet = new Set(idx.files);
  const bases = [idx.mainDir ? idx.mainDir + '/' + name : name, name];
  for (const b of bases) {
    const norm = b.replace(/^\.\//, '').replace(/\/\.\//g, '/');
    if (fileSet.has(norm)) return true;
    for (const x of exts) if (fileSet.has(norm + x)) return true;
  }
  return false;
}

/**
 * Diagnostics for one text file.
 * @returns [{from, to, severity: 'warning'|'error'|'info', message, code}]
 */
export function checkFile(text, path, idx, t) {
  const out = [];
  if (!['tex', 'ltx'].includes(extOf(path))) return out;
  const clean = stripComments(text);
  const labelSet = new Set(idx.labels.map((l) => l.key));
  const bibSet = new Set(idx.bibKeys.map((b) => b.key));
  let m;

  const refRe = /\\(ref|eqref|pageref|autoref|cref|Cref|nameref|vref)\*?\{([^}]*)\}/g;
  while ((m = refRe.exec(clean))) {
    let off = m.index + m[0].indexOf('{') + 1;
    for (const part of m[2].split(',')) {
      const key = part.trim();
      const at = off + part.indexOf(key);
      if (key && !key.includes('#') && !labelSet.has(key)) {
        out.push({ from: at, to: at + key.length, severity: 'warning', message: t('lint.ref', { key }), code: 'ref' });
      }
      off += part.length + 1;
    }
  }

  if (idx.hasBib) {
    const citeRe = /\\(?:cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite|smartcite|Cite|Textcite|Parencite|citeonline|apud|fullcite)\*?(?:\[[^\]]*\]){0,2}\{([^}]*)\}/g;
    while ((m = citeRe.exec(clean))) {
      let off = m.index + m[0].lastIndexOf('{') + 1;
      for (const part of m[1].split(',')) {
        const key = part.trim();
        const at = off + part.indexOf(key);
        if (key && key !== '*' && !key.includes('#') && !bibSet.has(key)) {
          out.push({ from: at, to: at + key.length, severity: 'warning', message: t('lint.cite', { key }), code: 'cite' });
        }
        off += part.length + 1;
      }
    }
  }

  const inRe = /\\(input|include|subfile)\{([^}#\\]+)\}/g;
  while ((m = inRe.exec(clean))) {
    const name = m[2].trim();
    if (!name || resolve(idx, name, ['.tex'])) continue;
    const at = m.index + m[0].indexOf('{') + 1;
    out.push({ from: at, to: at + m[2].length, severity: 'error', message: t('lint.file', { file: name }), code: 'file' });
  }

  const gp = /\\graphicspath\s*\{((?:\{[^}]*\})+)\}/.exec(clean);
  const gpaths = gp ? [...gp[1].matchAll(/\{([^}]*)\}/g)].map((x) => x[1].replace(/^\.\//, '')) : [];
  const igRe = /\\includegraphics\*?(?:\[[^\]]*\])?\{([^}#\\]+)\}/g;
  while ((m = igRe.exec(clean))) {
    const name = m[1].trim();
    const exts = ['.pdf', '.png', '.jpg', '.jpeg', '.eps', '.PNG', '.JPG', '.jbig2', '.svg'];
    if (!name || resolve(idx, name, exts) || gpaths.some((g) => resolve(idx, g + name, exts))) continue;
    const at = m.index + m[0].lastIndexOf('{') + 1;
    out.push({ from: at, to: at + m[1].length, severity: 'warning', message: t('lint.image', { file: name }), code: 'image' });
  }

  const bibRe = /\\(bibliography|addbibresource)(?:\[[^\]]*\])?\{([^}#]+)\}/g;
  while ((m = bibRe.exec(clean))) {
    let off = m.index + m[0].lastIndexOf('{') + 1;
    for (const part of m[2].split(',')) {
      const name = part.trim();
      const at = off + part.indexOf(name);
      if (name && !resolve(idx, name, ['.bib'])) {
        out.push({ from: at, to: at + name.length, severity: 'warning', message: t('lint.bib', { file: name }), code: 'bib' });
      }
      off += part.length + 1;
    }
  }

  // \begin / \end balance (skipping verbatim-like environments).
  const stack = [];
  const envRe = /\\(begin|end)\s*\{([^}]+)\}/g;
  let verb = null;
  while ((m = envRe.exec(clean))) {
    const name = m[2].trim();
    if (verb) { if (m[1] === 'end' && name === verb) verb = null; continue; }
    if (m[1] === 'begin') {
      stack.push({ name, at: m.index, len: m[0].length });
      if (/^(verbatim\*?|Verbatim|lstlisting|minted|comment|filecontents\*?)$/.test(name)) { verb = name; stack.pop(); }
    } else {
      const top = stack[stack.length - 1];
      if (top && top.name === name) stack.pop();
      else if (stack.some((s) => s.name === name)) {
        // Something opened inside was never closed.
        while (stack.length && stack[stack.length - 1].name !== name) {
          const s = stack.pop();
          out.push({ from: s.at, to: s.at + s.len, severity: 'error', message: t('lint.unclosed', { env: s.name }), code: 'env' });
        }
        stack.pop();
      } else {
        out.push({ from: m.index, to: m.index + m[0].length, severity: 'error', message: t('lint.unopened', { env: name }), code: 'env' });
      }
    }
  }
  for (const s of stack) out.push({ from: s.at, to: s.at + s.len, severity: 'error', message: t('lint.unclosed', { env: s.name }), code: 'env' });

  // Duplicate labels in this file.
  const seen = new Map();
  for (const l of idx.labels) seen.set(l.key, (seen.get(l.key) || 0) + 1);
  LABEL_RE.lastIndex = 0;
  while ((m = LABEL_RE.exec(clean))) {
    const key = m[1].trim();
    if (seen.get(key) > 1) {
      const at = m.index + 7;
      out.push({ from: at, to: at + key.length, severity: 'warning', message: t('lint.duplabel', { key }), code: 'duplabel' });
    }
  }
  return out;
}

/** Outline of a file: [{level, title, pos, line}] for \part ... \subsubsection (and beamer frames). */
export function outline(text) {
  const clean = stripComments(text);
  const out = [];
  const re = /\\(part|chapter|section|subsection|subsubsection|paragraph|frametitle)(\*?)\s*(?:\[[^\]]*\])?\s*\{/g;
  const LEVEL = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, frametitle: 3 };
  let m;
  while ((m = re.exec(clean))) {
    // Read a balanced {...} title.
    let i = m.index + m[0].length; let depth = 1; let title = '';
    while (i < clean.length && depth > 0 && title.length < 200) {
      const c = clean[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (!depth) break; }
      title += c; i++;
    }
    title = title.replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, '').replace(/[{}$~]/g, '').replace(/\s+/g, ' ').trim();
    out.push({ level: LEVEL[m[1]], kind: m[1], title: title || '…', pos: m.index });
  }
  return out;
}

/** Approximate word count (like texcount's "words in text"): drops commands, math and comments. */
export function wordCount(text) {
  let s = stripComments(text);
  const body = /\\begin\{document\}([\s\S]*?)(\\end\{document\}|$)/.exec(s);
  if (body) s = body[1];
  s = s.replace(/\\begin\{(equation|align|gather|multline|eqnarray|displaymath|tikzpicture|verbatim|lstlisting|minted)\*?\}[\s\S]*?\\end\{\1\*?\}/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, ' ')
    .replace(/\\(label|ref|eqref|cite\w*|input|include|includegraphics|usepackage|bibliography\w*|begin|end|vspace|hspace|url|documentclass)\*?(\[[^\]]*\])?(\{[^}]*\})?/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?/g, ' ')
    .replace(/[{}[\]&~^_\\%#]/g, ' ');
  const words = s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return words ? words.length : 0;
}
