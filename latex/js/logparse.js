// Turns a TeX .log (plus latexmk/BibTeX output) into a list of errors, warnings and bad boxes
// with the project file and line they belong to. Inspired by Overleaf's latex-log-parser.
// The server compiles with -file-line-error, and renames the main file to __main_document__.tex.
import { dirName } from './project.js';

const MAX_LINE = 79; // TeX wraps log lines at max_print_line = 79 characters

function unwrap(log) {
  const lines = log.replace(/\r/g, '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (line.length > 0 && line.length % MAX_LINE === 0 && i + 1 < lines.length && !/^(!|l\.\d|\.\/)/.test(lines[i + 1])) {
      line += lines[++i];
    }
    out.push(line);
  }
  return out;
}

/** Map a file name from the log to a project path (null for TeX Live's own files). */
function projectPath(raw, mainPath, known) {
  if (!raw) return null;
  let f = raw.trim().replace(/^"|"$/g, '');
  if (/__main_document__\.tex$/.test(f)) return mainPath;
  if (f.startsWith('/') && !f.startsWith('/tmp') && !f.includes('/latexonhttp')) return null;
  f = f.replace(/^.*?\/(?=__main_document__)/, '');
  f = f.replace(/^\.\//, '');
  const base = dirName(mainPath);
  const candidates = [base ? base + '/' + f : f, f, f + '.tex', (base ? base + '/' : '') + f + '.tex'];
  for (const c of candidates) {
    const norm = normalize(c);
    if (known.has(norm)) return norm;
  }
  return null;
}
function normalize(p) {
  const out = [];
  for (const s of p.split('/')) {
    if (s === '..') out.pop(); else if (s && s !== '.') out.push(s);
  }
  return out.join('/');
}

const FILE_RE = /\((\.?\/?[^\s()"]+?\.(?:tex|ltx|sty|cls|clo|cfg|def|fd|bbl|aux|toc|lof|lot|out|nav|snm|bib|ind|gls|pdf_tex|tikz|pgf))(?=[\s()]|$)/g;

/**
 * @returns {{errors:[], warnings:[], typesetting:[], all:[]}} each item:
 *   {level, message, file, line, content, raw}
 */
export function parseLog(log, { mainPath = 'main.tex', files = [], extra = '' } = {}) {
  const known = new Set(files);
  const lines = unwrap(log || '');
  const items = [];
  // File stack from the "(file ... )" groups: a project path, '' for TeX Live's own files (warnings
  // from inside a package belong to no project file), undefined for parentheses that aren't files.
  const stack = [];
  const current = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i] !== undefined) return stack[i] || null;
    return null;
  };

  const push = (it) => {
    it.message = it.message.trim();
    if (!it.message) return;
    // Same error repeated by later latexmk passes: keep one.
    if (items.some((o) => o.level === it.level && o.message === it.message && o.line === it.line && o.file === it.file)) return;
    items.push(it);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ./file.tex:12: message     (file-line-error style errors)
    let m = /^(\.?\/?[^:\s]+\.\w+|__main_document__\.tex):(\d+): (.*)$/.exec(line);
    if (m) {
      const ctx = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '' && ctx.length < 6) ctx.push(lines[j++]);
      let message = m[3];
      // "LaTeX Error: ..." messages continue on the next lines until a blank or "See the LaTeX manual".
      push({ level: 'error', message, file: projectPath(m[1], mainPath, known), rawFile: m[1], line: +m[2], content: ctx.join('\n'), raw: [line, ...ctx].join('\n') });
      i = j - 1;
      continue;
    }

    // ! Error without file:line (emergency stop, errors from TeX Live files, ...)
    if (line.startsWith('! ')) {
      const ctx = [];
      let j = i + 1;
      let lineNo = null;
      while (j < lines.length && ctx.length < 8) {
        const l = lines[j];
        const ln = /^l\.(\d+)/.exec(l);
        if (ln) { lineNo = +ln[1]; ctx.push(l); if (lines[j + 1] !== undefined) ctx.push(lines[j + 1]); j += 2; break; }
        if (l.trim() === '' && ctx.length) break;
        ctx.push(l); j++;
      }
      push({ level: 'error', message: line.slice(2), file: current(), line: lineNo, content: ctx.join('\n'), raw: [line, ...ctx].join('\n') });
      i = j - 1;
      continue;
    }

    // LaTeX Warning / Package xyz Warning / Class xyz Warning (may span several lines)
    m = /^((?:LaTeX|Package|Class|Module)(?: ([\w.-]+))? Warning): (.*)$/.exec(line);
    if (m) {
      let message = m[3];
      let j = i + 1;
      const pkg = m[2];
      if (pkg) {
        // Package warnings continue on lines starting with "(pkgname)".
        while (j < lines.length && lines[j].startsWith('(' + pkg + ')')) {
          message += ' ' + lines[j].replace(/^\([\w.-]+\)\s*/, '').trim();
          j++;
        }
      } else {
        while (!/\.\s*$/.test(message) && j < lines.length && j - i < 4 && lines[j].trim() !== ''
          && !/^(\(|\)|\[|LaTeX|Package|Class|Overfull|Underfull|!)/.test(lines[j])) {
          message += ' ' + lines[j].trim();
          j++;
        }
      }
      const ln = /on input line (\d+)/.exec(message);
      const level = /^LaTeX Font Warning|Font shape|Size substitutions/.test(m[1] + message) ? 'info' : 'warning';
      push({ level, message: (pkg ? pkg + ': ' : '') + message, file: current(), line: ln ? +ln[1] : null, content: '', raw: lines.slice(i, j).join('\n') });
      i = j - 1;
      continue;
    }

    // Overfull / Underfull boxes
    m = /^(Over|Under)full \\([hv])box \((.*?)\) (?:in paragraph at lines (\d+)--(\d+)|detected at line (\d+)|has occurred while \\output is active|in alignment at lines (\d+)--(\d+))/.exec(line);
    if (m) {
      const ln = m[4] || m[6] || m[7];
      const ctx = lines[i + 1] && lines[i + 1].trim() && !/^\[|^\(/.test(lines[i + 1]) ? lines[i + 1] : '';
      push({ level: 'typesetting', message: line, file: current(), line: ln ? +ln : null, content: ctx, raw: line });
      continue;
    }

    // Missing files reported by LaTeX itself.
    m = /^No file (.+)\.$/.exec(line);
    if (m && !/\.(aux|toc|lof|lot|out|nav|snm|ind|gls|bbl)$/.test(m[1])) {
      push({ level: 'warning', message: line, file: current(), line: null, content: '', raw: line });
      continue;
    }

    // Track which file we are in: "(./chapters/intro.tex" opens, ")" closes.
    let k = 0;
    while (k < line.length) {
      const ch = line[k];
      if (ch === '(') {
        FILE_RE.lastIndex = k;
        const fm = FILE_RE.exec(line);
        if (fm && fm.index === k) {
          stack.push(projectPath(fm[1], mainPath, known) || '');
          k += fm[0].length;
          continue;
        }
        stack.push(undefined);
      } else if (ch === ')') {
        stack.pop();
      }
      k++;
    }
  }

  // BibTeX / Biber / latexmk messages (in the latexmk output, not in the .log).
  for (const raw of (extra || '').replace(/\r/g, '').split('\n')) {
    const l = raw.trim();
    let m2;
    if ((m2 = /^Warning--(.*)$/.exec(l))) push({ level: 'warning', message: 'BibTeX: ' + m2[1], file: null, line: null, content: '', raw: l });
    else if (/^(I couldn't open|I found no|Repeated entry|You're missing a field|I was expecting)/.test(l)) push({ level: 'error', message: 'BibTeX: ' + l, file: null, line: null, content: '', raw: l });
    else if ((m2 = /^(?:INFO|WARN|ERROR) - (.*)$/.exec(l)) && /^(WARN|ERROR)/.test(l)) push({ level: l.startsWith('ERROR') ? 'error' : 'warning', message: 'Biber: ' + m2[1], file: null, line: null, content: '', raw: l });
  }

  // Errors first, then warnings, then boxes; inside a level keep log order.
  const errors = items.filter((x) => x.level === 'error');
  const warnings = items.filter((x) => x.level === 'warning');
  const typesetting = items.filter((x) => x.level === 'typesetting');
  const info = items.filter((x) => x.level === 'info');
  return { errors, warnings, typesetting, info, all: [...errors, ...warnings, ...typesetting] };
}

/** Short explanations for the most common errors (key into i18n: hint.<id>). */
const HINTS = [
  [/Undefined control sequence/, 'undefined_cs'],
  [/Missing \$ inserted/, 'missing_dollar'],
  [/File `[^']+' not found|LaTeX Error: File/, 'file_not_found'],
  [/Environment \S+ undefined/, 'env_undefined'],
  [/\\begin\{[^}]*\} on input line \d+ ended by \\end|ended by \\end\{/, 'env_mismatch'],
  [/Missing \} inserted|Extra \}, or forgotten|Too many \}'s|Missing \{ inserted/, 'braces'],
  [/Paragraph ended before .* was complete|Runaway argument/, 'runaway'],
  [/Misplaced alignment tab character &/, 'misplaced_amp'],
  [/There's no line here to end/, 'no_line'],
  [/Missing \\begin\{document\}/, 'missing_begin_doc'],
  [/Unicode character .* not set up for use with LaTeX|Invalid UTF-8/, 'unicode'],
  [/Citation .* undefined|Citation .* on page .* undefined/, 'citation'],
  [/Reference .* undefined|There were undefined references/, 'reference'],
  [/Label\(s\) may have changed/, 'rerun'],
  [/Overfull \\hbox/, 'overfull'],
  [/Underfull \\hbox/, 'underfull'],
  [/Font .* not found|The font .* cannot be found/, 'font'],
  [/Emergency stop|Fatal error occurred/, 'emergency'],
  [/Double superscript|Double subscript/, 'double_script'],
  [/Illegal unit of measure/, 'unit'],
  [/Option clash for package/, 'option_clash'],
  [/Can be used only in preamble/, 'preamble_only'],
  [/Too many unprocessed floats/, 'floats'],
  [/I couldn't open database file|I found no \\bibdata/, 'bibdata'],
  [/Undefined control sequence.*\\(?:includegraphics|textcolor|url|href)/, 'missing_pkg'],
];
export function hintFor(message) {
  for (const [re, id] of HINTS) if (re.test(message)) return id;
  return null;
}
