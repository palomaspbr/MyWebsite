// Project templates. Contents are String.raw so backslashes stay as typed
// (never use backticks or "${" inside them).
const R = String.raw;

const BLANK_EN = R`\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{amsmath, amssymb}
\usepackage{graphicx}
\usepackage[margin=2.5cm]{geometry}

\title{My document}
\author{Your Name}
\date{\today}

\begin{document}
\maketitle

\section{Introduction}
Start writing here. Press \textbf{Ctrl+S} (or Cmd+S) to compile.

\end{document}
`;

const BLANK_PT = R`\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[brazilian]{babel}
\usepackage{amsmath, amssymb}
\usepackage{graphicx}
\usepackage[margin=2.5cm]{geometry}

\title{Meu documento}
\author{Seu Nome}
\date{\today}

\begin{document}
\maketitle

\section{Introdução}
Comece a escrever aqui. Aperte \textbf{Ctrl+S} (ou Cmd+S) para compilar.

\end{document}
`;

const ARTICLE = R`\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{amsmath, amssymb, amsthm}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{tikz}
\usepackage[margin=2.5cm]{geometry}
\usepackage[colorlinks=true, linkcolor=blue!50!black, citecolor=red!60!black]{hyperref}

\newtheorem{theorem}{Theorem}

\title{A Short Article About Nothing in Particular}
\author{Ada Lovelace \and Alan Turing}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
This template shows the basics: sections, maths, a figure drawn with Ti\emph{k}Z,
a table, cross-references and a bibliography. Edit anything and press Ctrl+S to recompile.
\end{abstract}

\section{Introduction}\label{sec:intro}
LaTeX is great for documents with maths, such as Euler's identity $e^{i\pi} + 1 = 0$,
or the Gaussian integral in Equation~\eqref{eq:gauss}:
\begin{equation}\label{eq:gauss}
  \int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}.
\end{equation}
The ideas go back to \cite{knuth1984}; Section~\ref{sec:results} has the results.

\section{Results}\label{sec:results}
\begin{theorem}
For every $n \geq 1$,
\begin{align}
  \sum_{k=1}^{n} k &= \frac{n(n+1)}{2}, \\
  \sum_{k=1}^{n} k^2 &= \frac{n(n+1)(2n+1)}{6}.
\end{align}
\end{theorem}

Figure~\ref{fig:plot} was drawn right here in the source, and Table~\ref{tab:data} lists some numbers.

\begin{figure}[htbp]
  \centering
  \begin{tikzpicture}[scale=1.1]
    \draw[->] (-0.2,0) -- (4.2,0) node[right] {$x$};
    \draw[->] (0,-0.2) -- (0,2.4) node[above] {$y$};
    \draw[thick, blue, domain=0:4, samples=60] plot (\x, {2*exp(-(\x-2)^2)});
    \draw[thick, red, dashed, domain=0:4] plot (\x, {0.5*\x});
  \end{tikzpicture}
  \caption{A bell curve and a line.}
  \label{fig:plot}
\end{figure}

\begin{table}[htbp]
  \centering
  \begin{tabular}{lrr}
    \toprule
    Sample & Mean & Std.\ dev. \\
    \midrule
    A & 1.23 & 0.10 \\
    B & 4.56 & 0.32 \\
    C & 7.89 & 0.05 \\
    \bottomrule
  \end{tabular}
  \caption{Some made-up numbers.}
  \label{tab:data}
\end{table}

\section{Conclusion}
Lists are easy too:
\begin{itemize}
  \item write the text,
  \item compile,
  \item enjoy the PDF.
\end{itemize}

\bibliographystyle{plain}
\bibliography{refs}

\end{document}
`;

const ARTICLE_BIB = R`@book{knuth1984,
  title     = {The {\TeX}book},
  author    = {Knuth, Donald E.},
  publisher = {Addison-Wesley},
  year      = {1984}
}

@book{lamport1994,
  title     = {{\LaTeX}: A Document Preparation System},
  author    = {Lamport, Leslie},
  publisher = {Addison-Wesley},
  edition   = {2},
  year      = {1994}
}
`;

const ARTIGO = R`\documentclass[12pt,a4paper]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[brazilian]{babel}
\usepackage{lmodern}
\usepackage{amsmath, amssymb}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{indentfirst}
\usepackage{csquotes}
\usepackage[a4paper, top=3cm, left=3cm, right=2cm, bottom=2cm]{geometry}
\usepackage{setspace}
\usepackage[hidelinks]{hyperref}

\onehalfspacing

\title{Título do Artigo}
\author{Fulana de Tal\thanks{Universidade de São Paulo. E-mail: fulana@exemplo.com}}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
Escreva aqui o resumo do trabalho, em um único parágrafo, com os objetivos,
o método, os resultados e as conclusões.

\noindent\textbf{Palavras-chave:} LaTeX. Artigo. Modelo.
\end{abstract}

\section{Introdução}
Este modelo usa o pacote \texttt{babel} em português, então títulos como
\enquote{Sumário} e \enquote{Referências} já aparecem traduzidos.
Veja a Equação~\eqref{eq:bhaskara} e a Tabela~\ref{tab:exemplo}.

\begin{equation}\label{eq:bhaskara}
  x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
\end{equation}

\section{Desenvolvimento}
Segundo \cite{lamport1994}, o \LaTeX{} separa o conteúdo da forma.

\begin{table}[htbp]
  \centering
  \caption{Uma tabela de exemplo.}
  \label{tab:exemplo}
  \begin{tabular}{lcc}
    \toprule
    Item & Quantidade & Valor (R\$) \\
    \midrule
    Caderno & 2 & 15,90 \\
    Caneta & 5 & 2,50 \\
    \bottomrule
  \end{tabular}
\end{table}

\section{Conclusão}
Escreva aqui as conclusões.

\bibliographystyle{plain}
\bibliography{referencias}

\end{document}
`;

const ARTIGO_BIB = R`@book{lamport1994,
  title     = {{\LaTeX}: A Document Preparation System},
  author    = {Lamport, Leslie},
  publisher = {Addison-Wesley},
  edition   = {2},
  year      = {1994}
}
`;

const ABNTEX_MAIN = R`% Modelo de TCC / dissertação com abnTeX2 (normas da ABNT).
% Documentação: https://www.abntex.net.br
\documentclass[12pt, oneside, a4paper, english, brazilian]{abntex2}

\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage{indentfirst}
\usepackage{graphicx}
\usepackage{xcolor}
\usepackage{microtype}
\usepackage[brazilian, hyperpageref]{backref}
\usepackage[alf]{abntex2cite}

\titulo{Título do Trabalho}
\autor{Nome do Autor}
\local{São Paulo}
\data{\the\year}
\orientador{Prof. Dr. Nome do Orientador}
\instituicao{Universidade de São Paulo \par Escola Politécnica}
\tipotrabalho{Trabalho de Conclusão de Curso}
\preambulo{Trabalho apresentado à Escola Politécnica da Universidade de São Paulo
para obtenção do título de Engenheiro.}

\makeatletter
\hypersetup{pdftitle={\@title}, pdfauthor={\@author}, colorlinks=true,
  linkcolor=blue!50!black, citecolor=blue!50!black, urlcolor=blue!50!black}
\makeatother

\setlength{\parindent}{1.3cm}
\setlength{\parskip}{0.2cm}

\begin{document}
\selectlanguage{brazilian}
\frenchspacing

\imprimircapa
\imprimirfolhaderosto

\begin{resumo}
Escreva aqui o resumo, com 150 a 500 palavras.

\textbf{Palavras-chave}: palavra 1. palavra 2. palavra 3.
\end{resumo}

\pdfbookmark[0]{\contentsname}{toc}
\tableofcontents*
\cleardoublepage

\textual

\include{capitulos/introducao}
\include{capitulos/desenvolvimento}
\include{capitulos/conclusao}

\postextual
\bibliography{referencias}

\end{document}
`;

const ABNTEX_INTRO = R`\chapter{Introdução}\label{cap:introducao}

Este é o capítulo de introdução. Cada capítulo fica em um arquivo da pasta
\texttt{capitulos/}, incluído no \texttt{main.tex} com \verb|\include|.

As citações seguem a ABNT com o \texttt{abntex2cite}: \citeonline{lamport1994}
mostra uma citação no texto, e no fim da frase fica assim \cite{knuth1984}.

\section{Objetivos}
\begin{itemize}
  \item Objetivo 1;
  \item Objetivo 2.
\end{itemize}
`;

const ABNTEX_DEV = R`\chapter{Desenvolvimento}\label{cap:desenvolvimento}

Veja o Capítulo~\ref{cap:introducao} e a Figura~\ref{fig:exemplo}.

\begin{figure}[htbp]
  \centering
  \caption{Uma figura de exemplo.}
  \label{fig:exemplo}
  \fbox{\parbox{0.6\textwidth}{\centering\vspace{2cm}Coloque aqui sua figura com
  \texttt{\textbackslash includegraphics}\vspace{2cm}}}
  \legend{Fonte: elaborado pelo autor.}
\end{figure}

\section{Equações}
\begin{equation}
  E = mc^2
\end{equation}
`;

const ABNTEX_CONC = R`\chapter{Conclusão}

Escreva aqui a conclusão do trabalho.
`;

const ABNTEX_BIB = R`@book{knuth1984,
  title     = {The {\TeX}book},
  author    = {Knuth, Donald E.},
  publisher = {Addison-Wesley},
  address   = {Reading},
  year      = {1984}
}

@book{lamport1994,
  title     = {{\LaTeX}: a document preparation system},
  author    = {Lamport, Leslie},
  publisher = {Addison-Wesley},
  address   = {Reading},
  edition   = {2},
  year      = {1994}
}
`;

const BEAMER = R`\documentclass{beamer}
\usetheme{Madrid}
\usecolortheme{beaver}
\usepackage[utf8]{inputenc}
\usepackage{amsmath}
\usepackage{tikz}

\title{My Presentation}
\subtitle{Made with Beamer}
\author{Your Name}
\institute{Your Institution}
\date{\today}

\begin{document}

\begin{frame}
  \titlepage
\end{frame}

\begin{frame}{Outline}
  \tableofcontents
\end{frame}

\section{Introduction}
\begin{frame}{Bullet points, one at a time}
  \begin{itemize}
    \item<1-> First point
    \item<2-> Second point
    \item<3-> Third point
  \end{itemize}
\end{frame}

\section{Content}
\begin{frame}{Two columns}
  \begin{columns}
    \column{0.5\textwidth}
    \begin{block}{A block}
      Blocks highlight important things.
    \end{block}
    \begin{alertblock}{Careful!}
      This one is an alert.
    \end{alertblock}
    \column{0.5\textwidth}
    \centering
    \begin{tikzpicture}
      \filldraw[fill=red!20, draw=red!60!black, thick] (0,0) circle (1.2);
      \node at (0,0) {Hello!};
    \end{tikzpicture}
  \end{columns}
\end{frame}

\begin{frame}{Maths}
  \begin{equation*}
    \oint_{\partial \Sigma} \mathbf{B} \cdot d\boldsymbol{\ell}
      = \mu_0 \iint_{\Sigma} \mathbf{J} \cdot d\mathbf{S}
  \end{equation*}
\end{frame}

\begin{frame}
  \centering \Huge Thank you!
\end{frame}

\end{document}
`;

const LETTER = R`\documentclass[11pt]{letter}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[margin=2.5cm]{geometry}

\signature{Your Name}
\address{Your Street, 123 \\ Your City \\ Your Country}

\begin{document}
\begin{letter}{Recipient Name \\ Company \\ Street, 456 \\ City}

\opening{Dear Sir or Madam,}

I am writing to let you know that writing letters in \LaTeX{} is surprisingly pleasant.
Replace this text with the body of your letter.

Thank you for your time.

\closing{Yours faithfully,}

\ps{P.S. Don't forget to sign.}

\end{letter}
\end{document}
`;

const CV = R`\documentclass[11pt,a4paper,sans]{moderncv}
\moderncvstyle{classic}
\moderncvcolor{blue}
\usepackage[utf8]{inputenc}
\usepackage[scale=0.8]{geometry}

\name{Ada}{Lovelace}
\title{Curriculum Vitae}
\address{12 Analytical Street}{London}{United Kingdom}
\phone[mobile]{+44~(000)~000~0000}
\email{ada@example.com}
\homepage{example.com}
\social[github]{ada}

\begin{document}
\makecvtitle

\section{Education}
\cventry{1830--1833}{Mathematics}{Private tutoring}{London}{}{Studied with Augustus De Morgan and Mary Somerville.}

\section{Experience}
\cventry{1842--1843}{Translator and annotator}{Analytical Engine notes}{London}{}{%
\begin{itemize}
  \item Translated Menabrea's article on the Analytical Engine.
  \item Wrote Note G, the first published algorithm intended for a machine.
\end{itemize}}

\section{Skills}
\cvitem{Mathematics}{Calculus, Bernoulli numbers}
\cvitem{Languages}{English (native), French (fluent), Italian (reading)}

\section{Interests}
\cvitem{}{Poetical science, music, horses}

\end{document}
`;

const HOMEWORK = R`\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{amsmath, amssymb, amsthm}
\usepackage{enumitem}
\usepackage[margin=2.2cm]{geometry}
\usepackage{fancyhdr}

\pagestyle{fancy}
\fancyhf{}
\lhead{Calculus I --- Problem Set 1}
\rhead{Your Name}
\cfoot{\thepage}

\newtheorem*{solution}{Solution}
\newcommand{\R}{\mathbb{R}}
\newcommand{\dd}{\,\mathrm{d}}

\begin{document}

\section*{Problem 1}
Compute $\displaystyle \lim_{x \to 0} \frac{\sin x}{x}$.

\begin{solution}
By L'H\^opital's rule,
\[
  \lim_{x \to 0} \frac{\sin x}{x} = \lim_{x \to 0} \frac{\cos x}{1} = 1.
\]
\end{solution}

\section*{Problem 2}
Let $f\colon \R \to \R$, $f(x) = x^3 - 3x$.
\begin{enumerate}[label=(\alph*)]
  \item Find the critical points of $f$.
  \item Classify each one as a local maximum or minimum.
\end{enumerate}

\begin{solution}
\begin{enumerate}[label=(\alph*)]
  \item $f'(x) = 3x^2 - 3 = 0 \iff x = \pm 1$.
  \item $f''(x) = 6x$, so $x=-1$ is a local maximum and $x=1$ a local minimum.
\end{enumerate}
\end{solution}

\section*{Problem 3}
Evaluate $\displaystyle \int_0^1 x e^{x} \dd x$.

\begin{solution}
Integrating by parts, $\int_0^1 x e^x \dd x = \left[x e^x\right]_0^1 - \int_0^1 e^x \dd x = e - (e - 1) = 1$.
\end{solution}

\end{document}
`;

const TIKZ = R`\documentclass[tikz, border=10pt]{standalone}
\usetikzlibrary{arrows.meta, positioning, shapes.geometric}

\begin{document}
\begin{tikzpicture}[
  node distance=1.4cm and 2cm,
  box/.style={draw, thick, rounded corners, fill=yellow!20, minimum width=2.6cm, minimum height=1cm, align=center},
  choice/.style={draw, thick, diamond, aspect=2, fill=blue!10, align=center},
  arrow/.style={-{Stealth[length=3mm]}, thick}
]
  \node[box] (start) {Write \LaTeX};
  \node[box, below=of start] (compile) {Compile};
  \node[choice, below=of compile] (ok) {Errors?};
  \node[box, right=of ok, fill=red!15] (fix) {Read the log\\and fix};
  \node[box, below=of ok, fill=green!20] (done) {Enjoy the PDF};

  \draw[arrow] (start) -- (compile);
  \draw[arrow] (compile) -- (ok);
  \draw[arrow] (ok) -- node[above] {yes} (fix);
  \draw[arrow] (fix) |- (compile);
  \draw[arrow] (ok) -- node[right] {no} (done);
\end{tikzpicture}
\end{document}
`;

/** All templates. name/desc are {en, pt}. files: {path: content}. */
export const TEMPLATES = [
  {
    id: 'blank', icon: 'file_tex', compiler: 'pdflatex', main: 'main.tex',
    name: { en: 'Blank document', pt: 'Documento em branco' },
    desc: { en: 'Just the essentials, ready for you to write.', pt: 'Só o essencial, pronto para escrever.' },
    files: (lang) => ({ 'main.tex': lang === 'pt' ? BLANK_PT : BLANK_EN }),
  },
  {
    id: 'article', icon: 'file_tex', compiler: 'pdflatex', main: 'main.tex',
    name: { en: 'Article', pt: 'Artigo (inglês)' },
    desc: { en: 'Sections, maths, a TikZ figure, a table, references and a bibliography.', pt: 'Seções, matemática, figura em TikZ, tabela, referências cruzadas e bibliografia.' },
    files: () => ({ 'main.tex': ARTICLE, 'refs.bib': ARTICLE_BIB }),
  },
  {
    id: 'artigo', icon: 'file_tex', compiler: 'pdflatex', main: 'main.tex',
    name: { en: 'Article in Portuguese', pt: 'Artigo em português' },
    desc: { en: 'Brazilian Portuguese, A4 with ABNT-like margins, abstract and keywords.', pt: 'Português do Brasil, A4 com margens no estilo ABNT, resumo e palavras-chave.' },
    files: () => ({ 'main.tex': ARTIGO, 'referencias.bib': ARTIGO_BIB }),
  },
  {
    id: 'abntex2', icon: 'book', compiler: 'pdflatex', main: 'main.tex',
    name: { en: 'Thesis (abnTeX2, Brazil)', pt: 'TCC / Tese (abnTeX2)' },
    desc: { en: 'ABNT rules: cover, title page, abstract, chapters in separate files.', pt: 'Normas da ABNT: capa, folha de rosto, resumo, capítulos em arquivos separados.' },
    files: () => ({
      'main.tex': ABNTEX_MAIN,
      'capitulos/introducao.tex': ABNTEX_INTRO,
      'capitulos/desenvolvimento.tex': ABNTEX_DEV,
      'capitulos/conclusao.tex': ABNTEX_CONC,
      'referencias.bib': ABNTEX_BIB,
    }),
  },
  {
    id: 'beamer', icon: 'columns', compiler: 'pdflatex', main: 'main.tex',
    name: { en: 'Presentation (Beamer)', pt: 'Apresentação (Beamer)' },
    desc: { en: 'Slides with overlays, columns, blocks and maths.', pt: 'Slides com animações, colunas, blocos e matemática.' },
    files: () => ({ 'main.tex': BEAMER }),
  },
  {
    id: 'homework', icon: 'sigma', compiler: 'pdflatex', main: 'main.tex',
    name: { en: 'Problem set', pt: 'Lista de exercícios' },
    desc: { en: 'Problems and solutions with a header, custom commands and lettered items.', pt: 'Questões e soluções com cabeçalho, comandos próprios e itens (a), (b).' },
    files: () => ({ 'main.tex': HOMEWORK }),
  },
  {
    id: 'cv', icon: 'users', compiler: 'pdflatex', main: 'main.tex',
    name: { en: 'CV (moderncv)', pt: 'Currículo (moderncv)' },
    desc: { en: 'A classic one-page curriculum vitae.', pt: 'Um currículo clássico de uma página.' },
    files: () => ({ 'main.tex': CV }),
  },
  {
    id: 'letter', icon: 'file', compiler: 'pdflatex', main: 'main.tex',
    name: { en: 'Letter', pt: 'Carta' },
    desc: { en: 'A formal letter with addresses and signature.', pt: 'Uma carta formal com endereços e assinatura.' },
    files: () => ({ 'main.tex': LETTER }),
  },
  {
    id: 'tikz', icon: 'pen', compiler: 'pdflatex', main: 'main.tex',
    name: { en: 'TikZ drawing', pt: 'Desenho em TikZ' },
    desc: { en: 'A standalone flowchart, cropped to its size.', pt: 'Um fluxograma avulso, recortado no tamanho do desenho.' },
    files: () => ({ 'main.tex': TIKZ }),
  },
];

export function templateFiles(tpl, lang) {
  const files = tpl.files(lang);
  return Object.entries(files).map(([path, content]) => ({ path, content }));
}
