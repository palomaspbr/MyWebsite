// Autocomplete for LaTeX: commands (with snippets), \begin{...} environments, \ref/\cite keys,
// file names for \input / \includegraphics / \bibliography, and package names for \usepackage.
// Project data (labels, bib keys, files, user commands) comes from getIndex() — see lint.js.
import { snippetCompletion as snip, autocompletion } from '../vendor/cm.js';

// [name, snippet (without the backslash) or null, detail]
const COMMANDS = [
  ['section', 'section{${title}}', 'heading'], ['section*', 'section*{${title}}', 'heading'],
  ['subsection', 'subsection{${title}}', 'heading'], ['subsubsection', 'subsubsection{${title}}', 'heading'],
  ['chapter', 'chapter{${title}}', 'heading'], ['part', 'part{${title}}', 'heading'], ['paragraph', 'paragraph{${title}}', 'heading'],
  ['textbf', 'textbf{${}}', 'bold'], ['textit', 'textit{${}}', 'italic'], ['emph', 'emph{${}}', 'emphasis'],
  ['underline', 'underline{${}}', ''], ['texttt', 'texttt{${}}', 'monospace'], ['textsc', 'textsc{${}}', 'small caps'],
  ['textsf', 'textsf{${}}', 'sans serif'], ['textrm', 'textrm{${}}', ''], ['textcolor', 'textcolor{${color}}{${text}}', 'xcolor'],
  ['footnote', 'footnote{${}}', ''], ['label', 'label{${key}}', ''], ['ref', 'ref{${}}', ''], ['eqref', 'eqref{${}}', 'amsmath'],
  ['pageref', 'pageref{${}}', ''], ['autoref', 'autoref{${}}', 'hyperref'], ['cref', 'cref{${}}', 'cleveref'],
  ['cite', 'cite{${}}', ''], ['citep', 'citep{${}}', 'natbib'], ['citet', 'citet{${}}', 'natbib'],
  ['parencite', 'parencite{${}}', 'biblatex'], ['textcite', 'textcite{${}}', 'biblatex'], ['nocite', 'nocite{${*}}', ''],
  ['url', 'url{${}}', 'url/hyperref'], ['href', 'href{${url}}{${text}}', 'hyperref'],
  ['includegraphics', 'includegraphics[width=${0.8}\\linewidth]{${file}}', 'graphicx'],
  ['input', 'input{${file}}', ''], ['include', 'include{${file}}', ''],
  ['usepackage', 'usepackage{${package}}', ''], ['documentclass', 'documentclass{${article}}', ''],
  ['title', 'title{${}}', ''], ['author', 'author{${}}', ''], ['date', 'date{${\\today}}', ''],
  ['maketitle', null, ''], ['tableofcontents', null, ''], ['listoffigures', null, ''], ['listoftables', null, ''],
  ['newpage', null, ''], ['clearpage', null, ''], ['noindent', null, ''], ['centering', null, ''], ['today', null, ''],
  ['item', 'item ${}', ''], ['caption', 'caption{${}}', ''], ['hline', null, 'tabular'], ['toprule', null, 'booktabs'],
  ['midrule', null, 'booktabs'], ['bottomrule', null, 'booktabs'], ['multicolumn', 'multicolumn{${n}}{${c}}{${text}}', ''],
  ['vspace', 'vspace{${1em}}', ''], ['hspace', 'hspace{${1em}}', ''], ['vfill', null, ''], ['hfill', null, ''],
  ['bibliography', 'bibliography{${refs}}', 'BibTeX'], ['bibliographystyle', 'bibliographystyle{${plain}}', 'BibTeX'],
  ['addbibresource', 'addbibresource{${refs.bib}}', 'biblatex'], ['printbibliography', null, 'biblatex'],
  ['newcommand', 'newcommand{\\${name}}[${1}]{${}}', ''], ['renewcommand', 'renewcommand{\\${name}}{${}}', ''],
  ['newenvironment', 'newenvironment{${name}}{${begin}}{${end}}', ''],
  ['frac', 'frac{${num}}{${den}}', 'math'], ['dfrac', 'dfrac{${num}}{${den}}', 'amsmath'], ['sqrt', 'sqrt{${}}', 'math'],
  ['sum', 'sum_{${i=1}}^{${n}}', 'math'], ['prod', 'prod_{${i=1}}^{${n}}', 'math'], ['int', 'int_{${a}}^{${b}}', 'math'],
  ['iint', null, 'math'], ['oint', null, 'math'], ['lim', 'lim_{${x \\to \\infty}}', 'math'],
  ['infty', null, 'math'], ['partial', null, 'math'], ['nabla', null, 'math'], ['cdot', null, 'math'], ['cdots', null, 'math'],
  ['ldots', null, ''], ['dots', null, ''], ['times', null, 'math'], ['div', null, 'math'], ['pm', null, 'math'], ['mp', null, 'math'],
  ['leq', null, 'math'], ['geq', null, 'math'], ['neq', null, 'math'], ['approx', null, 'math'], ['equiv', null, 'math'],
  ['sim', null, 'math'], ['propto', null, 'math'], ['in', null, 'math'], ['notin', null, 'math'], ['subset', null, 'math'],
  ['subseteq', null, 'math'], ['cup', null, 'math'], ['cap', null, 'math'], ['emptyset', null, 'math'], ['forall', null, 'math'],
  ['exists', null, 'math'], ['to', null, 'math'], ['rightarrow', null, 'math'], ['leftarrow', null, 'math'],
  ['Rightarrow', null, 'math'], ['Leftrightarrow', null, 'math'], ['mapsto', null, 'math'], ['implies', null, 'amsmath'],
  ['iff', null, 'amsmath'], ['left', 'left( ${} \\right)', 'math'], ['right', null, 'math'],
  ['mathbb', 'mathbb{${R}}', 'amssymb'], ['mathcal', 'mathcal{${}}', 'math'], ['mathrm', 'mathrm{${}}', 'math'],
  ['mathbf', 'mathbf{${}}', 'math'], ['boldsymbol', 'boldsymbol{${}}', 'amsmath'], ['text', 'text{${}}', 'amsmath'],
  ['operatorname', 'operatorname{${}}', 'amsmath'], ['hat', 'hat{${}}', 'math'], ['bar', 'bar{${}}', 'math'],
  ['vec', 'vec{${}}', 'math'], ['dot', 'dot{${}}', 'math'], ['tilde', 'tilde{${}}', 'math'], ['overline', 'overline{${}}', 'math'],
  ['binom', 'binom{${n}}{${k}}', 'amsmath'], ['sin', null, 'math'], ['cos', null, 'math'], ['tan', null, 'math'],
  ['log', null, 'math'], ['ln', null, 'math'], ['exp', null, 'math'], ['max', null, 'math'], ['min', null, 'math'],
  ['alpha', null, 'greek'], ['beta', null, 'greek'], ['gamma', null, 'greek'], ['Gamma', null, 'greek'], ['delta', null, 'greek'],
  ['Delta', null, 'greek'], ['epsilon', null, 'greek'], ['varepsilon', null, 'greek'], ['zeta', null, 'greek'], ['eta', null, 'greek'],
  ['theta', null, 'greek'], ['Theta', null, 'greek'], ['iota', null, 'greek'], ['kappa', null, 'greek'], ['lambda', null, 'greek'],
  ['Lambda', null, 'greek'], ['mu', null, 'greek'], ['nu', null, 'greek'], ['xi', null, 'greek'], ['pi', null, 'greek'],
  ['Pi', null, 'greek'], ['rho', null, 'greek'], ['sigma', null, 'greek'], ['Sigma', null, 'greek'], ['tau', null, 'greek'],
  ['phi', null, 'greek'], ['varphi', null, 'greek'], ['Phi', null, 'greek'], ['chi', null, 'greek'], ['psi', null, 'greek'],
  ['Psi', null, 'greek'], ['omega', null, 'greek'], ['Omega', null, 'greek'],
  ['quad', null, 'space'], ['qquad', null, 'space'], ['linewidth', null, 'length'], ['textwidth', null, 'length'],
  ['small', null, 'size'], ['footnotesize', null, 'size'], ['large', null, 'size'], ['Large', null, 'size'], ['LARGE', null, 'size'],
  ['huge', null, 'size'], ['normalsize', null, 'size'], ['bfseries', null, ''], ['itshape', null, ''],
  ['appendix', null, ''], ['frametitle', 'frametitle{${}}', 'beamer'], ['pause', null, 'beamer'],
  ['tikz', null, 'tikz'], ['draw', 'draw ${(0,0) -- (1,1)};', 'tikz'], ['node', 'node at (${0,0}) {${}};', 'tikz'],
];

const ENVIRONMENTS = [
  ['itemize', '\\item ${}'], ['enumerate', '\\item ${}'], ['description', '\\item[${term}] ${}'],
  ['equation', '${}'], ['equation*', '${}'], ['align', '${} &= ${} \\\\'], ['align*', '${} &= ${}'],
  ['gather', '${}'], ['multline', '${}'], ['cases', '${} & ${} \\\\'], ['matrix', '${}'], ['pmatrix', '${}'], ['bmatrix', '${}'],
  ['figure', '\\centering\n\t\\includegraphics[width=0.8\\linewidth]{${file}}\n\t\\caption{${caption}}\n\t\\label{fig:${}}', '[htbp]'],
  ['table', '\\centering\n\t\\begin{tabular}{${c c}}\n\t\t${} \\\\\n\t\\end{tabular}\n\t\\caption{${caption}}\n\t\\label{tab:${}}', '[htbp]'],
  ['tabular', '${} \\\\', '{${c c}}'], ['center', '${}'], ['flushleft', '${}'], ['flushright', '${}'],
  ['quote', '${}'], ['quotation', '${}'], ['verbatim', '${}'], ['abstract', '${}'], ['minipage', '${}', '{${0.45\\linewidth}}'],
  ['theorem', '${}'], ['lemma', '${}'], ['proof', '${}'], ['definition', '${}'], ['corollary', '${}'], ['example', '${}'],
  ['frame', '\\frametitle{${title}}\n\t${}'], ['columns', '\\column{0.5\\textwidth}\n\t${}'], ['block', '${}', '{${title}}'],
  ['tikzpicture', '${}'], ['lstlisting', '${}'], ['minted', '${}', '{${python}}'], ['thebibliography', '\\bibitem{${key}} ${}', '{${9}}'],
  ['document', '${}'], ['subfigure', '${}', '{${0.45\\linewidth}}'], ['wrapfigure', '${}', '{${r}}{${0.4\\linewidth}}'],
  ['array', '${}', '{${cc}}'], ['split', '${}'], ['appendices', '${}'], ['landscape', '${}'], ['multicols', '${}', '{${2}}'],
];

const PACKAGES = ['amsmath', 'amssymb', 'amsthm', 'mathtools', 'graphicx', 'xcolor', 'hyperref', 'geometry', 'babel',
  'inputenc', 'fontenc', 'lmodern', 'microtype', 'booktabs', 'tabularx', 'longtable', 'multirow', 'array', 'caption',
  'subcaption', 'float', 'wrapfig', 'tikz', 'pgfplots', 'siunitx', 'listings', 'minted', 'algorithm', 'algpseudocode',
  'algorithm2e', 'biblatex', 'natbib', 'cleveref', 'enumitem', 'fancyhdr', 'titlesec', 'setspace', 'parskip', 'lipsum',
  'csquotes', 'fontspec', 'polyglossia', 'url', 'xurl', 'physics', 'chemfig', 'mhchem', 'tcolorbox', 'mdframed',
  'abntex2cite', 'indentfirst', 'pdfpages', 'appendix', 'glossaries', 'acronym', 'makeidx', 'todonotes', 'comment',
  'ifthen', 'etoolbox', 'xparse', 'calc', 'textcomp', 'gensymb', 'bm', 'cancel', 'esint', 'dsfont', 'stmaryrd',
  'fontawesome5', 'multicol', 'framed', 'soul', 'ulem', 'colortbl', 'pifont', 'qrcode', 'standalone', 'import', 'subfiles'];

/** Find the command whose argument the cursor is in: "\cite{a,b|" -> {cmd:'cite', from, prefix}. */
function argContext(context) {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const m = /\\([a-zA-Z]+\*?)(?:\[[^\]]*\])*\{([^{}]*)$/.exec(before);
  if (!m) return null;
  const inside = m[2];
  const lastComma = inside.lastIndexOf(',');
  const prefix = inside.slice(lastComma + 1).trimStart();
  return { cmd: m[1].replace(/\*$/, ''), from: context.pos - prefix.length, prefix };
}

const REF_CMDS = /^(ref|eqref|pageref|autoref|cref|Cref|nameref|vref|labelcref|cpageref)$/;
const CITE_CMDS = /^(cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite|smartcite|nocite|fullcite|Cite|Textcite|Parencite|citeonline|apud)$/;

export function latexCompletions(getIndex) {
  const cmdOptions = COMMANDS.map(([name, s, detail]) => (s
    ? snip('\\' + s, { label: '\\' + name, detail, type: 'function', boost: name.length < 6 ? 1 : 0 })
    : { label: '\\' + name, detail, type: 'keyword' }));
  const envBeginOptions = ENVIRONMENTS.map(([name, body, args = '']) => snip(
    `\\begin{${name}}${args}\n\t${body}\n\\end{${name}}`, { label: '\\begin{' + name + '}', detail: 'environment', type: 'class' },
  ));

  function source(context) {
    const idx = getIndex() || {};
    const arg = argContext(context);
    if (arg) {
      const { cmd, from } = arg;
      if (cmd === 'begin' || cmd === 'end') {
        const names = new Set([...ENVIRONMENTS.map((e) => e[0]), ...(idx.envs || [])]);
        if (cmd === 'begin') {
          return {
            from,
            options: [...names].map((name) => {
              const env = ENVIRONMENTS.find((e) => e[0] === name);
              const body = env ? env[1] : '${}';
              const args = env && env[2] ? env[2] : '';
              return snip(`${name}}${args}\n\t${body}\n\\end{${name}}`, { label: name, type: 'class' });
            }),
            validFor: /^[\w*]*$/,
          };
        }
        return { from, options: [...names].map((n) => ({ label: n, type: 'class' })), validFor: /^[\w*]*$/ };
      }
      if (REF_CMDS.test(cmd)) {
        return { from, options: (idx.labels || []).map((l) => ({ label: l.key, detail: l.file, type: 'variable' })), validFor: /^[^,}\s]*$/ };
      }
      if (CITE_CMDS.test(cmd)) {
        return { from, options: (idx.bibKeys || []).map((b) => ({ label: b.key, detail: b.title ? b.title.slice(0, 60) : b.file, type: 'text' })), validFor: /^[^,}\s]*$/ };
      }
      if (/^(usepackage|RequirePackage)$/.test(cmd)) {
        return { from, options: PACKAGES.map((p) => ({ label: p, type: 'namespace' })), validFor: /^[\w-]*$/ };
      }
      if (/^(input|include|subfile|includeonly|lstinputlisting|inputminted|import)$/.test(cmd)) {
        const files = (idx.files || []).filter((f) => /\.(tex|ltx|sty|cls|py|txt|tikz)$/i.test(f));
        return { from, options: files.map((f) => ({ label: /\.tex$/.test(f) ? f.replace(/\.tex$/, '') : f, detail: f, type: 'text' })), validFor: /^[^}]*$/ };
      }
      if (/^(includegraphics|includepdf|includesvg)$/.test(cmd)) {
        const files = (idx.files || []).filter((f) => /\.(png|jpe?g|pdf|eps|svg|gif)$/i.test(f));
        return { from, options: files.map((f) => ({ label: f, type: 'text' })), validFor: /^[^}]*$/ };
      }
      if (/^(bibliography|addbibresource)$/.test(cmd)) {
        const files = (idx.files || []).filter((f) => /\.bib$/i.test(f));
        return { from, options: files.map((f) => ({ label: cmd === 'bibliography' ? f.replace(/\.bib$/, '') : f, type: 'text' })), validFor: /^[^},]*$/ };
      }
      return null;
    }

    const word = context.matchBefore(/\\[a-zA-Z@]*\*?/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const user = (idx.commands || []).map((c) => (c.args
      ? snip('\\' + c.name + '{${}}'.repeat(Math.min(c.args, 4)), { label: '\\' + c.name, detail: 'user', type: 'function', boost: 2 })
      : { label: '\\' + c.name, detail: 'user', type: 'function', boost: 2 }));
    return { from: word.from, options: [...user, ...cmdOptions, ...envBeginOptions], validFor: /^\\[a-zA-Z@]*\*?$/ };
  }

  return autocompletion({
    override: [source],
    activateOnTyping: true,
    icons: false,
    defaultKeymap: true,
    maxRenderedOptions: 80,
  });
}
