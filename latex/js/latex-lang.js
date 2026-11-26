// LaTeX language support for CodeMirror 6: a small stream tokenizer (commands, environments,
// math, comments, verbatim, section titles, \ref/\cite keys), the "coloured pens" highlight style,
// and folding for \begin...\end blocks and sections.
import { StreamLanguage, HighlightStyle, syntaxHighlighting, foldService, tags as t, LanguageSupport } from '../vendor/cm.js';

const MATH_ENVS = new Set(['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*',
  'flalign', 'flalign*', 'alignat', 'alignat*', 'eqnarray', 'eqnarray*', 'displaymath', 'math', 'dmath', 'dmath*']);
const VERBATIM_ENVS = new Set(['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment', 'filecontents',
  'filecontents*', 'alltt', 'BVerbatim', 'LVerbatim', 'luacode', 'luacode*', 'pycode', 'tikzcd*']);
VERBATIM_ENVS.delete('tikzcd*');
const HEADING_CMDS = new Set(['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph',
  'title', 'frametitle', 'framesubtitle', 'subtitle']);
const KEY_CMDS = new Set(['label', 'ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref', 'nameref', 'vref', 'cite', 'citep',
  'citet', 'citeauthor', 'citeyear', 'parencite', 'textcite', 'autocite', 'footcite', 'nocite', 'input', 'include',
  'includegraphics', 'bibliography', 'addbibresource', 'usepackage', 'RequirePackage', 'documentclass', 'includeonly',
  'bibliographystyle', 'subfile', 'import', 'lstinputlisting', 'inputminted', 'includepdf', 'href', 'url']);
const STRONG_CMDS = new Set(['textbf', 'mathbf', 'bfseries']);
const EM_CMDS = new Set(['textit', 'emph', 'mathit']);

function startState() {
  return {
    math: '', // '', '$', '$$', '\\(', '\\[', 'env'
    mathEnv: 0,
    verbatim: '',
    env: 0, // 0 none, 1 after \begin|\end, 2 reading name, 3 closing brace
    envEnd: false,
    pendingVerbatim: '',
    arg: '', // pending argument style for the next {...}
    argOn: '', // active argument style
    argDepth: 0,
    depth: 0,
  };
}

function copyState(s) { return { ...s }; }

const inMath = (s) => s.math !== '' || s.mathEnv > 0;

function token(stream, state) {
  // Verbatim-like environments: everything up to \end{name} is plain monospace.
  if (state.verbatim) {
    const end = '\\end{' + state.verbatim + '}';
    const at = stream.string.indexOf(end, stream.pos);
    if (at === stream.pos) {
      stream.pos += 4; // \end
      state.verbatim = '';
      state.env = 1; state.envEnd = true;
      return 'keyword';
    }
    if (at > stream.pos) { stream.pos = at; return 'monospace'; }
    stream.skipToEnd();
    return 'monospace';
  }

  // \begin{ name }
  if (state.env === 1) {
    if (stream.eatSpace()) return null;
    if (stream.eat('{')) { state.env = 2; return 'brace'; }
    state.env = 0;
  }
  if (state.env === 2) {
    if (stream.match(/^[^}%\s]+/)) {
      const name = stream.current();
      if (!state.envEnd) {
        if (MATH_ENVS.has(name)) state.mathEnv++;
        if (VERBATIM_ENVS.has(name)) state.pendingVerbatim = name;
      } else if (MATH_ENVS.has(name) && state.mathEnv > 0) state.mathEnv--;
      state.env = 3;
      return 'className';
    }
    state.env = 3;
  }
  if (state.env === 3) {
    if (stream.eatSpace()) return null;
    state.env = 0;
    if (stream.eat('}')) {
      if (state.pendingVerbatim) { state.verbatim = state.pendingVerbatim; state.pendingVerbatim = ''; }
      return 'brace';
    }
  }

  // A style waiting for its {argument} is dropped if something else comes first.
  if (state.arg && !/[\[{\s*]/.test(stream.peek() || '')) state.arg = '';

  const ch = stream.peek();

  if (ch === '%') { stream.skipToEnd(); return 'comment'; }

  if (ch === '\\') {
    stream.next();
    if (stream.match(/^[a-zA-Z@]+\*?/)) {
      const name = stream.current().slice(1).replace(/\*$/, '');
      if (name === 'begin' || name === 'end') {
        state.env = 1; state.envEnd = name === 'end';
        return 'keyword';
      }
      if (HEADING_CMDS.has(name)) state.arg = 'heading';
      else if (KEY_CMDS.has(name)) state.arg = 'labelName';
      else if (STRONG_CMDS.has(name)) state.arg = 'strong';
      else if (EM_CMDS.has(name)) state.arg = 'emphasis';
      if (/^(documentclass|usepackage|newcommand|renewcommand|providecommand|newenvironment|renewenvironment|def|let|DeclareMathOperator|NewDocumentCommand|newtheorem)$/.test(name)) return 'macroName definitionKeyword';
      return 'macroName';
    }
    const c = stream.next();
    if (c === '(' || c === '[') { if (!inMath(state)) state.math = '\\' + c; return 'meta'; }
    if (c === ')' || c === ']') { if (state.math === '\\(' || state.math === '\\[') state.math = ''; return 'meta'; }
    if (c === '\\') return 'operator';
    return 'escape';
  }

  if (ch === '$') {
    stream.next();
    const dbl = stream.eat('$');
    if (state.math === '$' || state.math === '$$') state.math = '';
    else if (!state.mathEnv && !state.math) state.math = dbl ? '$$' : '$';
    return 'meta';
  }

  if (ch === '{') {
    stream.next();
    state.depth++;
    if (state.arg) { state.argOn = state.arg; state.argDepth = state.depth; state.arg = ''; }
    return 'brace';
  }
  if (ch === '}') {
    stream.next();
    if (state.argOn && state.depth === state.argDepth) state.argOn = '';
    state.depth = Math.max(0, state.depth - 1);
    return 'brace';
  }
  if (ch === '[' || ch === ']') { stream.next(); return 'squareBracket'; }
  if (ch === '&') { stream.next(); return 'operator'; }
  if (ch === '#') { stream.next(); stream.match(/^\d/); return 'variableName'; }
  if (ch === '~') { stream.next(); return 'operator'; }
  if ((ch === '^' || ch === '_') && inMath(state)) { stream.next(); return 'operator'; }

  if (stream.eatSpace()) return null;
  stream.match(/^[^\\%{}\[\]$&#~^_\s]+/) || stream.next();
  if (inMath(state)) return 'string';
  if (state.argOn) return state.argOn;
  return null;
}

export const latexLanguage = StreamLanguage.define({
  name: 'latex',
  startState,
  copyState,
  token,
  blankLine(state) { if (state.math === '$') state.math = ''; },
  languageData: {
    commentTokens: { line: '%' },
    closeBrackets: { brackets: ['(', '[', '{', '$'] },
    wordChars: '@\\',
  },
  tokenTable: {
    brace: t.brace,
    squareBracket: t.squareBracket,
    labelName: t.labelName,
    monospace: t.monospace,
  },
});

export const latexHighlight = HighlightStyle.define([
  { tag: t.macroName, color: 'var(--syn-macro)' },
  { tag: t.definitionKeyword, color: 'var(--syn-keyword)' },
  { tag: t.keyword, color: 'var(--syn-keyword)', fontWeight: 'bold' },
  { tag: t.className, color: 'var(--syn-env)', fontWeight: 'bold' },
  { tag: t.heading, color: 'var(--syn-heading)', fontWeight: 'bold', textDecoration: 'underline 2px var(--hi)', textUnderlineOffset: '3px' },
  { tag: t.labelName, color: 'var(--syn-label)' },
  { tag: t.string, color: 'var(--syn-math)' },
  { tag: t.meta, color: 'var(--syn-math)', fontWeight: 'bold' },
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.brace, color: 'var(--syn-brace)' },
  { tag: t.squareBracket, color: 'var(--syn-brace)' },
  { tag: t.operator, color: 'var(--syn-op)' },
  { tag: t.escape, color: 'var(--syn-op)' },
  { tag: t.variableName, color: 'var(--syn-param)' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.monospace, color: 'var(--ink-soft)' },
]);

/*#region Folding*/
const SECTION_LEVEL = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };
const SECTION_RE = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/;

const latexFold = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.lineAt(lineStart);
  const text = line.text;
  const doc = state.doc;
  const maxLines = Math.min(doc.lines, line.number + 4000);

  // \begin{env} ... \end{env}
  const b = /\\begin\{([^}]+)\}/.exec(text);
  if (b && !text.includes('\\end{' + b[1] + '}', b.index)) {
    let depth = 0;
    const open = '\\begin{' + b[1] + '}'; const close = '\\end{' + b[1] + '}';
    for (let n = line.number + 1; n <= maxLines; n++) {
      const l = doc.line(n).text.replace(/(^|[^\\])%.*$/, '$1');
      depth += l.split(open).length - 1;
      const closes = l.split(close).length - 1;
      if (closes > depth) {
        const endLine = doc.line(n);
        if (n === line.number + 1 && endLine.text.trim() === close) return null;
        return { from: lineEnd, to: doc.line(n - 1).to };
      }
      depth -= closes;
    }
    return null;
  }

  // Sections: until the next heading of the same or a higher level.
  const s = SECTION_RE.exec(text);
  if (s) {
    const level = SECTION_LEVEL[s[1]];
    let last = line.number;
    for (let n = line.number + 1; n <= maxLines; n++) {
      const l = doc.line(n).text;
      const m = SECTION_RE.exec(l);
      if ((m && SECTION_LEVEL[m[1]] <= level) || /^\s*\\(end\{document\}|bibliography\{|printbibliography|appendix)/.test(l)) break;
      if (l.trim()) last = n;
    }
    if (last > line.number) return { from: lineEnd, to: doc.line(last).to };
  }
  return null;
});
/*#endregion*/

export function latex() {
  return new LanguageSupport(latexLanguage, [syntaxHighlighting(latexHighlight), latexFold]);
}
