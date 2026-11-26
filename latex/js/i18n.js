// English / Brazilian Portuguese. The choice is remembered in localStorage "latex_lang";
// default: the browser language (pt* -> Portuguese). ?lang=en|pt in the URL wins.
// Markup: data-i18n="key" (text), data-i18n-title, data-i18n-placeholder, data-i18n-aria.

const STR = {
  en: {
    'app.name': 'LaTeX Notebook',
    'app.tagline': 'Write LaTeX in your browser and see the PDF right next to it.',
    'app.back_site': 'Back to palomaliz.com.br',
    'common.cancel': 'Cancel', 'common.ok': 'OK', 'common.save': 'Save', 'common.create': 'Create', 'common.close': 'Close',
    'common.delete': 'Delete', 'common.rename': 'Rename', 'common.open': 'Open', 'common.download': 'Download',
    'common.copy': 'Copy', 'common.copied': 'Copied!', 'common.name': 'Name', 'common.loading': 'Loading…',
    'common.language': 'Language', 'common.theme_dark': 'Dark mode', 'common.yes': 'Yes', 'common.no': 'No',
    'common.restore': 'Restore', 'common.duplicate': 'Make a copy', 'common.retry': 'Try again',
    'time.now': 'just now', 'time.min': '{n} min ago', 'time.hour': '{n} h ago', 'time.day': '{n} days ago',
    'time.yesterday': 'yesterday',

    'dash.new': 'New project', 'dash.upload': 'Upload project', 'dash.upload_hint': '.zip or .tex files',
    'dash.your_projects': 'Your projects', 'dash.templates': 'Start from a template',
    'dash.search': 'Search projects…', 'dash.empty': 'No projects yet. Pick a template below or create a blank one!',
    'dash.none_found': 'No project matches “{q}”.',
    'dash.edited': 'edited {when}', 'dash.files': '{n} files', 'dash.shared': 'shared', 'dash.readonly': 'read-only',
    'dash.new_title': 'New project', 'dash.new_name': 'Project name', 'dash.new_default': 'My paper',
    'dash.delete_title': 'Delete “{name}”?', 'dash.delete_body': 'It will be removed from this browser. This cannot be undone.',
    'dash.delete_shared': 'This only removes your copy. Other people with the link keep theirs.',
    'dash.rename_title': 'Rename project', 'dash.copy_of': '{name} (copy)',
    'dash.import_fail': 'Could not read that file: {err}', 'dash.imported': 'Project “{name}” imported',
    'dash.no_tex': 'There is no .tex file in it.',
    'dash.storage': 'Projects are saved in this browser ({used} used). Download a .zip now and then to keep a backup.',
    'dash.how_title': 'How it works',
    'dash.how_1': 'Your files are saved in this browser (nothing is uploaded until you compile or share).',
    'dash.how_2': 'Compiling sends the project to a public TeX Live server, <a href="https://latex.ytotech.com/docs" target="_blank" rel="noopener">LaTeX-on-HTTP</a>, which sends back the PDF.',
    'dash.how_3': 'Share a project with a link to edit it together in real time.',
    'dash.drop': 'Drop a .zip here to import it',
    'dash.join': 'Open a shared link', 'dash.join_hint': 'Paste a share link someone sent you',
    'dash.join_bad': 'That doesn\'t look like a LaTeX Notebook share link.',
    'dash.credits': 'Editor: CodeMirror · PDF viewer: pdf.js · Compiler: LaTeX-on-HTTP by YtoTech',

    'ed.projects': 'Projects', 'ed.recompile': 'Recompile', 'ed.compile': 'Compile', 'ed.compiling': 'Compiling…',
    'ed.compile_menu': 'Compile options', 'ed.auto': 'Auto compile', 'ed.auto_hint': 'Compiles a few seconds after you stop typing',
    'ed.halt': 'Stop on first error', 'ed.compiler': 'Compiler', 'ed.stop': 'Stop',
    'ed.compile_anyway': 'Compile anyway', 'ed.download_pdf': 'Download PDF', 'ed.no_pdf': 'No PDF yet',
    'ed.share': 'Share', 'ed.menu': 'Menu', 'ed.files': 'Files', 'ed.outline': 'Outline', 'ed.editor': 'Editor', 'ed.pdf': 'PDF',
    'ed.logs': 'Logs', 'ed.logs_title': 'Logs and messages', 'ed.raw_log': 'Raw log', 'ed.view_log': 'View log',
    'ed.new_file': 'New file', 'ed.new_folder': 'New folder', 'ed.upload': 'Upload files', 'ed.set_main': 'Set as main document',
    'ed.main_doc': 'Main document', 'ed.file_name': 'File name', 'ed.folder_name': 'Folder name', 'ed.move_to': 'Path',
    'ed.delete_file': 'Delete “{name}”?', 'ed.delete_folder': 'Delete the folder “{name}” and everything in it?',
    'ed.bad_name': 'Invalid name.', 'ed.exists': 'There is already a file or folder with that name.',
    'ed.uploaded': '{n} file(s) added', 'ed.too_big': '{name} is too big (max {max}).',
    'ed.binary': 'This file can\'t be edited here.', 'ed.no_file': 'Pick a file on the left to edit it.',
    'ed.image_info': '{size} · use it with \\includegraphics{{path}}',
    'ed.outline_empty': 'No sections in this file.',
    'ed.words': 'Word count', 'ed.words_n': '{n} words', 'ed.words_hint': 'Approximate: text of the main document and the files it includes, without commands and maths.',
    'ed.saved_local': 'Saved in this browser', 'ed.saving': 'Saving…', 'ed.synced': 'Synced', 'ed.offline': 'Offline: changes are kept and will sync later',
    'ed.connecting': 'Connecting…', 'ed.line_col': 'Line {l}, col {c}',
    'ed.settings': 'Settings', 'ed.font_size': 'Font size', 'ed.wrap': 'Wrap long lines', 'ed.spell': 'Spell check (browser)',
    'ed.line_numbers': 'Line numbers', 'ed.autoclose': 'Auto-close brackets', 'ed.autocomplete': 'Autocomplete',
    'ed.server': 'Compile server', 'ed.server_hint': 'Default: the public LaTeX-on-HTTP instance. You can run your own with Docker and paste its /builds/sync URL here.',
    'ed.server_reset': 'Use the default',
    'ed.download_zip': 'Download source (.zip)', 'ed.history': 'History', 'ed.word_count': 'Word count',
    'ed.shortcuts': 'Keyboard shortcuts', 'ed.layout': 'Layout', 'ed.layout_both': 'Editor & PDF', 'ed.layout_code': 'Editor only', 'ed.layout_pdf': 'PDF only',
    'ed.symbols': 'Symbols', 'ed.find': 'Find and replace',
    'ed.not_found': 'Project not found in this browser.', 'ed.go_back': 'Back to the projects',
    'ed.success': 'Compiled in {s} s', 'ed.failed': 'Compilation failed', 'ed.errors_n': '{n} error(s)', 'ed.warnings_n': '{n} warning(s)',
    'ed.no_errors': 'No errors in the last compile.', 'ed.local_checks': 'Quick checks (while you type)',
    'ed.from_log': 'From the compile log', 'ed.boxes': 'Layout (bad boxes)', 'ed.hint': 'Tip',
    'ed.failed_banner': 'The last compile failed. Showing the previous PDF.', 'ed.failed_banner_nopdf': 'The compile failed: see the errors.',
    'ed.err_network': 'Could not reach the compile server. Check your connection and try again.',
    'ed.err_offline': 'You are offline. Compiling needs the internet (your edits are saved).',
    'ed.err_timeout': 'The compile server took too long to answer.',
    'ed.err_server': 'The compile server answered with an error: {detail}',
    'ed.err_quota_local': 'Compile limit reached ({reason}): you can compile again in {wait}.',
    'ed.err_quota_server': 'The compile server asked to slow down: wait {wait}.',
    'ed.err_quota_ban': 'The compile server paused compiles from your network for {wait}. Don\'t retry until then.',
    'ed.err_nomain': 'There is no main .tex file. Create one or pick one in the menu.',
    'ed.quota': 'Compiles left: {m} this minute, {h} this hour, {d} today',
    'ed.quota_note': 'The public server allows about 6 compiles a minute and 40 an hour per network. Auto compile pauses when you get close to the limit.',
    'ed.reason.second': 'per second', 'ed.reason.minute': 'per minute', 'ed.reason.hour': 'per hour', 'ed.reason.day': 'per day',
    'ed.reason.week': 'per week', 'ed.reason.server': 'server',
    'ed.goto_pdf': 'Find this line in the PDF', 'ed.goto_code': 'Double-click the PDF to jump to the source',
    'ed.goto_none': 'Couldn\'t find this text in the PDF.', 'ed.goto_none_code': 'Couldn\'t find that text in the source.',
    'ed.drop_files': 'Drop files to add them to the project',
    'ed.page': 'Page', 'ed.of': 'of', 'ed.zoom_in': 'Zoom in', 'ed.zoom_out': 'Zoom out', 'ed.fit': 'Fit width', 'ed.fit_page': 'Fit page',
    'ed.toolbar.bold': 'Bold', 'ed.toolbar.italic': 'Italic', 'ed.toolbar.section': 'Section', 'ed.toolbar.subsection': 'Subsection',
    'ed.toolbar.ul': 'Bulleted list', 'ed.toolbar.ol': 'Numbered list', 'ed.toolbar.math': 'Inline maths', 'ed.toolbar.dmath': 'Display maths',
    'ed.toolbar.figure': 'Figure', 'ed.toolbar.table': 'Table', 'ed.toolbar.link': 'Link', 'ed.toolbar.ref': 'Cross-reference',
    'ed.toolbar.cite': 'Citation', 'ed.toolbar.comment': 'Comment / uncomment', 'ed.toolbar.undo': 'Undo', 'ed.toolbar.redo': 'Redo',
    'ed.read_only': 'Read-only: you can read and compile, not edit.',
    'ed.history_title': 'History', 'ed.history_hint': 'Versions are saved in this browser: automatically every 10 minutes of editing and whenever you save one with a name.',
    'ed.history_save': 'Save this version', 'ed.history_label': 'Version name', 'ed.history_empty': 'No saved versions yet.',
    'ed.history_restore': 'Restore “{name}”? The current text is saved as a version first.', 'ed.history_auto': 'automatic',
    'ed.history_restored': 'Version restored', 'ed.history_view': 'Download as .zip',
    'ed.welcome': 'Welcome! Press {key} to compile.',

    'share.title': 'Share this project', 'share.intro': 'Anyone with the link can open the project in their browser. Edits appear for everyone in real time.',
    'share.start': 'Create share links', 'share.creating': 'Uploading the project…',
    'share.edit_link': 'Can edit', 'share.view_link': 'Can only read',
    'share.note': 'The project is stored on palomaliz.com.br so collaborators can reach it. Keep the edit link private.',
    'share.stop': 'Stop sharing', 'share.stop_confirm': 'Stop sharing? The links stop working and the online copy is deleted. Your copy stays in this browser.',
    'share.stopped': 'Sharing stopped.', 'share.people': 'People here now', 'share.you': 'you',
    'share.unavailable': 'Sharing is not available right now: {err}',
    'share.joining': 'Opening the shared project…', 'share.join_fail': 'Could not open this shared project: {err}',
    'share.gone': 'This shared project no longer exists (the owner stopped sharing it).',
    'share.your_name': 'Your name (shown to collaborators)', 'share.limits': 'Limits: {mb} MB per project, files up to {fmb} MB.',

    'lint.ref': 'There is no \\label{{key}} in the project.',
    'lint.cite': 'There is no bibliography entry “{key}”.',
    'lint.file': 'File “{file}” not found in the project.',
    'lint.image': 'Image “{file}” not found in the project.',
    'lint.bib': 'Bibliography file “{file}” not found.',
    'lint.unclosed': '\\begin{{env}} is never closed.',
    'lint.unopened': '\\end{{env}} without a matching \\begin.',
    'lint.duplabel': 'Label “{key}” is defined more than once.',

    'hint.undefined_cs': 'A command LaTeX doesn\'t know. Check the spelling, or load the package that defines it with \\usepackage.',
    'hint.missing_dollar': 'Something that only works in maths (like ^, _ or \\alpha) is outside $...$, or a $ is missing.',
    'hint.file_not_found': 'A file is missing. Check its name and folder (paths are relative to the main document), or upload it.',
    'hint.env_undefined': 'Unknown environment: check the name or load the package that provides it.',
    'hint.env_mismatch': 'A \\begin{...} is closed by a different \\end{...}. Check the order of your environments.',
    'hint.braces': 'Curly braces don\'t match: a { or } is missing or extra.',
    'hint.runaway': 'An argument doesn\'t end where expected, usually because of a missing }. Blank lines aren\'t allowed inside most arguments.',
    'hint.misplaced_amp': '& only works inside tables and alignments (tabular, align...). Write \\& for the symbol.',
    'hint.no_line': '\\\\ is used where there is no line to end (e.g. right after a blank line or at the start of a list).',
    'hint.missing_begin_doc': 'There is text before \\begin{document}, or the document has no \\begin{document}.',
    'hint.unicode': 'A character pdfLaTeX can\'t print (emoji, special symbol). Remove it, or switch the compiler to XeLaTeX or LuaLaTeX.',
    'hint.citation': 'This citation key isn\'t in your .bib file (or the bibliography wasn\'t built yet).',
    'hint.reference': 'A \\ref points to a \\label that doesn\'t exist (or needs one more compile).',
    'hint.rerun': 'Compile once more to update cross-references.',
    'hint.overfull': 'A line sticks out into the margin. Usually a long word or URL; rephrase or allow a break.',
    'hint.underfull': 'A line is too loose. Usually harmless.',
    'hint.font': 'This font isn\'t installed on the server. With XeLaTeX/LuaLaTeX, check the font name.',
    'hint.emergency': 'LaTeX stopped. The real cause is usually the error just before this one.',
    'hint.double_script': 'Two ^ or two _ in a row: group them with braces, like x^{a^b}.',
    'hint.unit': 'A length needs a unit: 2cm, 10pt, 0.5\\linewidth...',
    'hint.option_clash': 'The same package is loaded twice with different options. Load it once.',
    'hint.preamble_only': 'This command must go before \\begin{document}.',
    'hint.floats': 'Too many figures/tables are waiting to be placed. Add \\clearpage or use [htbp].',
    'hint.bibdata': 'The .bib file wasn\'t found, or there are no \\cite commands yet.',
    'hint.missing_pkg': 'Load the package for this command (graphicx, xcolor or hyperref).',

    'keys.compile': 'Compile', 'keys.save': 'Compile (Ctrl+S also works)', 'keys.find': 'Find / replace', 'keys.comment': 'Comment lines',
    'keys.bold': 'Bold', 'keys.italic': 'Italic', 'keys.complete': 'Autocomplete', 'keys.goto': 'Go to line',
    'keys.undo': 'Undo / redo', 'keys.fold': 'Fold / unfold', 'keys.topdf': 'Find the cursor line in the PDF',
  },
  pt: {
    'app.name': 'Caderno LaTeX',
    'app.tagline': 'Escreva LaTeX no navegador e veja o PDF ao lado.',
    'app.back_site': 'Voltar para palomaliz.com.br',
    'common.cancel': 'Cancelar', 'common.ok': 'OK', 'common.save': 'Salvar', 'common.create': 'Criar', 'common.close': 'Fechar',
    'common.delete': 'Excluir', 'common.rename': 'Renomear', 'common.open': 'Abrir', 'common.download': 'Baixar',
    'common.copy': 'Copiar', 'common.copied': 'Copiado!', 'common.name': 'Nome', 'common.loading': 'Carregando…',
    'common.language': 'Idioma', 'common.theme_dark': 'Modo escuro', 'common.yes': 'Sim', 'common.no': 'Não',
    'common.restore': 'Restaurar', 'common.duplicate': 'Fazer uma cópia', 'common.retry': 'Tentar de novo',
    'time.now': 'agora mesmo', 'time.min': 'há {n} min', 'time.hour': 'há {n} h', 'time.day': 'há {n} dias',
    'time.yesterday': 'ontem',

    'dash.new': 'Novo projeto', 'dash.upload': 'Enviar projeto', 'dash.upload_hint': '.zip ou arquivos .tex',
    'dash.your_projects': 'Seus projetos', 'dash.templates': 'Comece com um modelo',
    'dash.search': 'Buscar projetos…', 'dash.empty': 'Nenhum projeto ainda. Escolha um modelo abaixo ou crie um em branco!',
    'dash.none_found': 'Nenhum projeto com “{q}”.',
    'dash.edited': 'editado {when}', 'dash.files': '{n} arquivos', 'dash.shared': 'compartilhado', 'dash.readonly': 'só leitura',
    'dash.new_title': 'Novo projeto', 'dash.new_name': 'Nome do projeto', 'dash.new_default': 'Meu trabalho',
    'dash.delete_title': 'Excluir “{name}”?', 'dash.delete_body': 'Ele será apagado deste navegador. Não dá para desfazer.',
    'dash.delete_shared': 'Isso só apaga a sua cópia. Quem tem o link continua com a dele.',
    'dash.rename_title': 'Renomear projeto', 'dash.copy_of': '{name} (cópia)',
    'dash.import_fail': 'Não consegui ler esse arquivo: {err}', 'dash.imported': 'Projeto “{name}” importado',
    'dash.no_tex': 'Não há nenhum arquivo .tex nele.',
    'dash.storage': 'Os projetos ficam salvos neste navegador ({used} usados). De vez em quando, baixe um .zip como backup.',
    'dash.how_title': 'Como funciona',
    'dash.how_1': 'Seus arquivos ficam salvos neste navegador (nada é enviado até você compilar ou compartilhar).',
    'dash.how_2': 'Ao compilar, o projeto vai para um servidor público com TeX Live, o <a href="https://latex.ytotech.com/docs" target="_blank" rel="noopener">LaTeX-on-HTTP</a>, que devolve o PDF.',
    'dash.how_3': 'Compartilhe um projeto por link para editar junto, em tempo real.',
    'dash.drop': 'Solte um .zip aqui para importar',
    'dash.join': 'Abrir um link compartilhado', 'dash.join_hint': 'Cole o link que alguém te mandou',
    'dash.join_bad': 'Isso não parece um link de compartilhamento do Caderno LaTeX.',
    'dash.credits': 'Editor: CodeMirror · Visualizador de PDF: pdf.js · Compilador: LaTeX-on-HTTP, da YtoTech',

    'ed.projects': 'Projetos', 'ed.recompile': 'Recompilar', 'ed.compile': 'Compilar', 'ed.compiling': 'Compilando…',
    'ed.compile_menu': 'Opções de compilação', 'ed.auto': 'Compilar automaticamente', 'ed.auto_hint': 'Compila alguns segundos depois que você para de digitar',
    'ed.halt': 'Parar no primeiro erro', 'ed.compiler': 'Compilador', 'ed.stop': 'Parar',
    'ed.compile_anyway': 'Compilar mesmo assim', 'ed.download_pdf': 'Baixar PDF', 'ed.no_pdf': 'Ainda não há PDF',
    'ed.share': 'Compartilhar', 'ed.menu': 'Menu', 'ed.files': 'Arquivos', 'ed.outline': 'Estrutura', 'ed.editor': 'Editor', 'ed.pdf': 'PDF',
    'ed.logs': 'Logs', 'ed.logs_title': 'Logs e mensagens', 'ed.raw_log': 'Log completo', 'ed.view_log': 'Ver log',
    'ed.new_file': 'Novo arquivo', 'ed.new_folder': 'Nova pasta', 'ed.upload': 'Enviar arquivos', 'ed.set_main': 'Usar como documento principal',
    'ed.main_doc': 'Documento principal', 'ed.file_name': 'Nome do arquivo', 'ed.folder_name': 'Nome da pasta', 'ed.move_to': 'Caminho',
    'ed.delete_file': 'Excluir “{name}”?', 'ed.delete_folder': 'Excluir a pasta “{name}” e tudo dentro dela?',
    'ed.bad_name': 'Nome inválido.', 'ed.exists': 'Já existe um arquivo ou pasta com esse nome.',
    'ed.uploaded': '{n} arquivo(s) adicionado(s)', 'ed.too_big': '{name} é grande demais (máx. {max}).',
    'ed.binary': 'Este arquivo não pode ser editado aqui.', 'ed.no_file': 'Escolha um arquivo à esquerda para editar.',
    'ed.image_info': '{size} · use com \\includegraphics{{path}}',
    'ed.outline_empty': 'Nenhuma seção neste arquivo.',
    'ed.words': 'Contagem de palavras', 'ed.words_n': '{n} palavras', 'ed.words_hint': 'Aproximada: texto do documento principal e dos arquivos incluídos, sem comandos e matemática.',
    'ed.saved_local': 'Salvo neste navegador', 'ed.saving': 'Salvando…', 'ed.synced': 'Sincronizado', 'ed.offline': 'Sem conexão: as mudanças ficam guardadas e sincronizam depois',
    'ed.connecting': 'Conectando…', 'ed.line_col': 'Linha {l}, col. {c}',
    'ed.settings': 'Configurações', 'ed.font_size': 'Tamanho da fonte', 'ed.wrap': 'Quebrar linhas longas', 'ed.spell': 'Corretor ortográfico (do navegador)',
    'ed.line_numbers': 'Números de linha', 'ed.autoclose': 'Fechar parênteses automaticamente', 'ed.autocomplete': 'Autocompletar',
    'ed.server': 'Servidor de compilação', 'ed.server_hint': 'Padrão: a instância pública do LaTeX-on-HTTP. Você pode rodar a sua com Docker e colar aqui a URL /builds/sync.',
    'ed.server_reset': 'Usar o padrão',
    'ed.download_zip': 'Baixar código-fonte (.zip)', 'ed.history': 'Histórico', 'ed.word_count': 'Contar palavras',
    'ed.shortcuts': 'Atalhos de teclado', 'ed.layout': 'Layout', 'ed.layout_both': 'Editor e PDF', 'ed.layout_code': 'Só o editor', 'ed.layout_pdf': 'Só o PDF',
    'ed.symbols': 'Símbolos', 'ed.find': 'Buscar e substituir',
    'ed.not_found': 'Projeto não encontrado neste navegador.', 'ed.go_back': 'Voltar aos projetos',
    'ed.success': 'Compilado em {s} s', 'ed.failed': 'A compilação falhou', 'ed.errors_n': '{n} erro(s)', 'ed.warnings_n': '{n} aviso(s)',
    'ed.no_errors': 'Nenhum erro na última compilação.', 'ed.local_checks': 'Verificações rápidas (enquanto você digita)',
    'ed.from_log': 'Do log da compilação', 'ed.boxes': 'Diagramação (caixas cheias/vazias)', 'ed.hint': 'Dica',
    'ed.failed_banner': 'A última compilação falhou. Mostrando o PDF anterior.', 'ed.failed_banner_nopdf': 'A compilação falhou: veja os erros.',
    'ed.err_network': 'Não consegui falar com o servidor de compilação. Confira a conexão e tente de novo.',
    'ed.err_offline': 'Você está sem internet. Para compilar é preciso estar online (suas edições estão salvas).',
    'ed.err_timeout': 'O servidor de compilação demorou demais para responder.',
    'ed.err_server': 'O servidor de compilação respondeu com um erro: {detail}',
    'ed.err_quota_local': 'Limite de compilações atingido ({reason}): dá para compilar de novo em {wait}.',
    'ed.err_quota_server': 'O servidor de compilação pediu para ir mais devagar: espere {wait}.',
    'ed.err_quota_ban': 'O servidor pausou as compilações da sua rede por {wait}. Não tente de novo antes disso.',
    'ed.err_nomain': 'Não há um arquivo .tex principal. Crie um ou escolha um no menu.',
    'ed.quota': 'Compilações restantes: {m} neste minuto, {h} nesta hora, {d} hoje',
    'ed.quota_note': 'O servidor público aceita cerca de 6 compilações por minuto e 40 por hora por rede. A compilação automática pausa quando você chega perto do limite.',
    'ed.reason.second': 'por segundo', 'ed.reason.minute': 'por minuto', 'ed.reason.hour': 'por hora', 'ed.reason.day': 'por dia',
    'ed.reason.week': 'por semana', 'ed.reason.server': 'servidor',
    'ed.goto_pdf': 'Achar esta linha no PDF', 'ed.goto_code': 'Clique duas vezes no PDF para ir ao código',
    'ed.goto_none': 'Não achei este texto no PDF.', 'ed.goto_none_code': 'Não achei esse texto no código.',
    'ed.drop_files': 'Solte os arquivos para adicioná-los ao projeto',
    'ed.page': 'Página', 'ed.of': 'de', 'ed.zoom_in': 'Aumentar zoom', 'ed.zoom_out': 'Diminuir zoom', 'ed.fit': 'Ajustar à largura', 'ed.fit_page': 'Página inteira',
    'ed.toolbar.bold': 'Negrito', 'ed.toolbar.italic': 'Itálico', 'ed.toolbar.section': 'Seção', 'ed.toolbar.subsection': 'Subseção',
    'ed.toolbar.ul': 'Lista com marcadores', 'ed.toolbar.ol': 'Lista numerada', 'ed.toolbar.math': 'Matemática no texto', 'ed.toolbar.dmath': 'Equação em destaque',
    'ed.toolbar.figure': 'Figura', 'ed.toolbar.table': 'Tabela', 'ed.toolbar.link': 'Link', 'ed.toolbar.ref': 'Referência cruzada',
    'ed.toolbar.cite': 'Citação', 'ed.toolbar.comment': 'Comentar / descomentar', 'ed.toolbar.undo': 'Desfazer', 'ed.toolbar.redo': 'Refazer',
    'ed.read_only': 'Só leitura: você pode ler e compilar, mas não editar.',
    'ed.history_title': 'Histórico', 'ed.history_hint': 'As versões ficam salvas neste navegador: automaticamente a cada 10 minutos de edição e sempre que você salvar uma com nome.',
    'ed.history_save': 'Salvar esta versão', 'ed.history_label': 'Nome da versão', 'ed.history_empty': 'Nenhuma versão salva ainda.',
    'ed.history_restore': 'Restaurar “{name}”? O texto atual é salvo como versão antes.', 'ed.history_auto': 'automática',
    'ed.history_restored': 'Versão restaurada', 'ed.history_view': 'Baixar como .zip',
    'ed.welcome': 'Bem-vindo(a)! Aperte {key} para compilar.',

    'share.title': 'Compartilhar este projeto', 'share.intro': 'Quem tiver o link abre o projeto no próprio navegador. As edições aparecem para todos em tempo real.',
    'share.start': 'Criar links de compartilhamento', 'share.creating': 'Enviando o projeto…',
    'share.edit_link': 'Pode editar', 'share.view_link': 'Só pode ler',
    'share.note': 'O projeto fica guardado em palomaliz.com.br para que os colaboradores consigam acessá-lo. Não espalhe o link de edição.',
    'share.stop': 'Parar de compartilhar', 'share.stop_confirm': 'Parar de compartilhar? Os links deixam de funcionar e a cópia online é apagada. A sua cópia continua neste navegador.',
    'share.stopped': 'Compartilhamento encerrado.', 'share.people': 'Pessoas aqui agora', 'share.you': 'você',
    'share.unavailable': 'O compartilhamento não está disponível agora: {err}',
    'share.joining': 'Abrindo o projeto compartilhado…', 'share.join_fail': 'Não consegui abrir este projeto compartilhado: {err}',
    'share.gone': 'Este projeto compartilhado não existe mais (o dono parou de compartilhar).',
    'share.your_name': 'Seu nome (aparece para os colaboradores)', 'share.limits': 'Limites: {mb} MB por projeto, arquivos de até {fmb} MB.',

    'lint.ref': 'Não existe \\label{{key}} no projeto.',
    'lint.cite': 'Não existe a referência “{key}” na bibliografia.',
    'lint.file': 'Arquivo “{file}” não encontrado no projeto.',
    'lint.image': 'Imagem “{file}” não encontrada no projeto.',
    'lint.bib': 'Arquivo de bibliografia “{file}” não encontrado.',
    'lint.unclosed': '\\begin{{env}} nunca é fechado.',
    'lint.unopened': '\\end{{env}} sem o \\begin correspondente.',
    'lint.duplabel': 'O rótulo “{key}” foi definido mais de uma vez.',

    'hint.undefined_cs': 'Um comando que o LaTeX não conhece. Confira a grafia ou carregue o pacote que o define com \\usepackage.',
    'hint.missing_dollar': 'Algo que só funciona em modo matemático (como ^, _ ou \\alpha) está fora de $...$, ou falta um $.',
    'hint.file_not_found': 'Falta um arquivo. Confira o nome e a pasta (os caminhos são relativos ao documento principal) ou envie o arquivo.',
    'hint.env_undefined': 'Ambiente desconhecido: confira o nome ou carregue o pacote que o fornece.',
    'hint.env_mismatch': 'Um \\begin{...} foi fechado por um \\end{...} diferente. Confira a ordem dos ambientes.',
    'hint.braces': 'As chaves não batem: falta ou sobra um { ou }.',
    'hint.runaway': 'Um argumento não termina onde deveria, geralmente por falta de }. Linhas em branco não são permitidas dentro da maioria dos argumentos.',
    'hint.misplaced_amp': '& só funciona dentro de tabelas e alinhamentos (tabular, align...). Para o símbolo, escreva \\&.',
    'hint.no_line': '\\\\ foi usado onde não há linha para terminar (por exemplo, logo depois de uma linha em branco ou no início de uma lista).',
    'hint.missing_begin_doc': 'Há texto antes do \\begin{document}, ou o documento não tem \\begin{document}.',
    'hint.unicode': 'Um caractere que o pdfLaTeX não sabe imprimir (emoji, símbolo especial). Remova-o ou troque o compilador para XeLaTeX ou LuaLaTeX.',
    'hint.citation': 'Esta chave de citação não está no seu .bib (ou a bibliografia ainda não foi gerada).',
    'hint.reference': 'Um \\ref aponta para um \\label que não existe (ou falta compilar mais uma vez).',
    'hint.rerun': 'Compile mais uma vez para atualizar as referências cruzadas.',
    'hint.overfull': 'Uma linha invade a margem. Geralmente é uma palavra ou URL longa; reescreva ou permita uma quebra.',
    'hint.underfull': 'Uma linha ficou espaçada demais. Normalmente não é problema.',
    'hint.font': 'Essa fonte não está instalada no servidor. Com XeLaTeX/LuaLaTeX, confira o nome da fonte.',
    'hint.emergency': 'O LaTeX parou. A causa real costuma ser o erro logo antes deste.',
    'hint.double_script': 'Dois ^ ou dois _ seguidos: agrupe com chaves, como x^{a^b}.',
    'hint.unit': 'Um comprimento precisa de unidade: 2cm, 10pt, 0.5\\linewidth...',
    'hint.option_clash': 'O mesmo pacote foi carregado duas vezes com opções diferentes. Carregue só uma vez.',
    'hint.preamble_only': 'Este comando precisa vir antes do \\begin{document}.',
    'hint.floats': 'Há figuras/tabelas demais esperando para serem posicionadas. Use \\clearpage ou [htbp].',
    'hint.bibdata': 'O arquivo .bib não foi encontrado, ou ainda não há nenhum \\cite.',
    'hint.missing_pkg': 'Carregue o pacote deste comando (graphicx, xcolor ou hyperref).',

    'keys.compile': 'Compilar', 'keys.save': 'Compilar (Ctrl+S também)', 'keys.find': 'Buscar / substituir', 'keys.comment': 'Comentar linhas',
    'keys.bold': 'Negrito', 'keys.italic': 'Itálico', 'keys.complete': 'Autocompletar', 'keys.goto': 'Ir para a linha',
    'keys.undo': 'Desfazer / refazer', 'keys.fold': 'Recolher / expandir', 'keys.topdf': 'Achar a linha do cursor no PDF',
  },
};

const KEY = 'latex_lang';

function detect() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'pt' || q === 'en') return q;
  try { const s = localStorage.getItem(KEY); if (s === 'pt' || s === 'en') return s; } catch { /* ignore */ }
  return (navigator.language || 'en').toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

export let lang = detect();
document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';

/** t('key', {n: 3}) -> string. "{{x}}" in a string keeps literal braces around the value: \label{{key}} -> \label{abc}. */
export function t(key, vars) {
  let s = (STR[lang] && STR[lang][key]) ?? STR.en[key] ?? key;
  if (vars) {
    s = s.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? '{' + vars[k] + '}' : m));
    s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }
  return s;
}

export function setLang(l) {
  lang = l === 'pt' ? 'pt' : 'en';
  try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
}

export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}

export function relTime(ms) {
  const d = Date.now() - ms;
  if (d < 60000) return t('time.now');
  if (d < 3600000) return t('time.min', { n: Math.floor(d / 60000) });
  if (d < 86400000) return t('time.hour', { n: Math.floor(d / 3600000) });
  if (d < 2 * 86400000) return t('time.yesterday');
  if (d < 30 * 86400000) return t('time.day', { n: Math.floor(d / 86400000) });
  return new Date(ms).toLocaleDateString(lang === 'pt' ? 'pt-BR' : 'en');
}

export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export function fmtWait(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return s + ' s';
  const m = Math.ceil(s / 60);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  return h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
}
