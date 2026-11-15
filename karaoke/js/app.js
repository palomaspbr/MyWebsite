// Karaoke App - Main JavaScript (guest phone UI, /karaoke/sing/?r=CODE)
//
// Online version: every request goes through window.KRoom (js/room.js), which
// prefixes the party ("room") code and adds the auth headers. The LAN-only
// connection info (IPs, mDNS, Wi-Fi) is replaced by the party code and an
// invite modal; "download" now means "add this YouTube video to the shared
// catalog" (the server stores metadata only, videos play as YouTube embeds).

// No party code in the URL: room.js sends the guest to /karaoke/?join=1.
KRoom.require();

// Translations
const translations = {
    'pt-BR': {
        // Navigation
        appName: 'Karaokê',
        yourName: 'Seu nome',
        enterNameRequired: 'Digite seu nome (obrigatório)',
        playPause: 'Tocar/Pausar',
        
        // Tabs
        search: 'Buscar',
        catalog: 'Catálogo',
        queue: 'Fila',
        
        // Search
        searchPlaceholder: 'Buscar músicas de karaokê no YouTube...',
        searchCatalog: 'Buscar ou digitar código...',
        searching: 'Buscando no YouTube...',
        searchHint: 'Busque suas músicas favoritas de karaokê',
        noResults: 'Nenhum resultado encontrado',
        searchFailed: 'Busca falhou. Tente novamente.',
        
        // Catalog
        bySong: 'Por Música',
        songDetails: 'Detalhes da Música',
        byArtist: 'Por Artista',
        recent: 'Recentes',
        popular: 'Populares',
        myDownloads: 'Adicionadas por mim',
        allLanguages: 'Todos Idiomas',
        loadingCatalog: 'Carregando catálogo...',
        emptyCatalog: 'O catálogo está vazio',
        emptyCatalogHint: 'Busque no YouTube e adicione músicas para montar o catálogo',
        songs: 'músicas',
        noSongsFound: 'Nenhuma música encontrada',
        downloadCatalog: 'Catálogo para imprimir',
        
        // Queue
        musicQueue: 'Fila de Músicas',
        emptyQueue: 'Fila vazia',
        emptyQueueHint: 'Adicione músicas do catálogo ou busca',
        startPlaying: 'Começar a Tocar',
        addedBy: 'Adicionado por',
        
        // Now Playing
        noSongPlaying: 'Nenhuma música tocando',
        waitingForSongs: 'Esperando músicas...',
        waitingForSongsHint: 'Adicione músicas à fila para começar',
        requestedBy: 'Pedido por',
        
        // Remote Control
        remoteControl: 'Controle Remoto',
        playbackControls: 'Controles de Reprodução',
        pause: 'Pausar',
        resume: 'Continuar',
        skipSong: 'Pular Música',
        restartSong: 'Reiniciar',
        clearQueue: 'Limpar Fila',
        queueManagement: 'Gerenciar Fila',
        
        // Confirmations
        confirm: 'Confirmar',
        cancel: 'Cancelar',
        close: 'Fechar',
        areYouSure: 'Tem certeza?',
        confirmSkipSong: 'Tem certeza que deseja pular "{title}"?',
        confirmClearQueue: 'Tem certeza que deseja limpar todas as {count} músicas da fila?',
        confirmRemoveSong: 'Tem certeza que deseja remover "{title}" da fila?',
        removeSong: 'Remover Música',
        currentSong: 'música atual',
        
        // Actions
        download: 'Adicionar ao catálogo',
        addToQueue: 'Adicionar à fila',
        remove: 'Remover',
        moveUp: 'Mover para cima',
        moveDown: 'Mover para baixo',
        by: 'por',
        
        // Toasts
        songAddedToQueue: 'Música adicionada à fila!',
        queueCleared: 'Fila limpa',
        downloadComplete: 'Música adicionada ao catálogo!',
        downloadFailed: 'Não foi possível adicionar a música. Tente novamente.',
        failedToAddSong: 'Falha ao adicionar música',
        failedToRemoveSong: 'Falha ao remover música',
        failedToClearQueue: 'Falha ao limpar fila',
        onlyDjCanDoThis: 'Só o DJ pode fazer isso',
        cannotRemoveOthersSong: 'Você só pode remover as suas próprias músicas',
        failedToReorderQueue: 'Falha ao reordenar fila',
        mySongs: 'Minhas músicas',
        mySongsHint: 'Mude a ordem das suas músicas. Todos os outros mantêm a sua vez.',
        singEarlier: 'Cantar esta mais cedo',
        singLater: 'Cantar esta mais tarde',
        songsRearranged: 'Suas músicas foram reorganizadas',
        failedToRearrange: 'Não foi possível reorganizar suas músicas',
        inLinePos: '{n}ª na fila',
        status_fetching_info: 'Obtendo informações do vídeo…',
        status_extracting_metadata: 'Lendo detalhes da música…',
        status_downloading: 'Adicionando ao catálogo…',
        status_saving: 'Salvando…',
        failedToControlPlayback: 'Falha ao controlar reprodução',
        failedToSkipSong: 'Falha ao pular música',
        failedToRestartSong: 'Falha ao reiniciar música',
        failedToStartPlayback: 'Falha ao iniciar reprodução',
        playbackStarted: 'Reprodução iniciada!',
        queueIsEmpty: 'Fila está vazia',
        usernameInUse: 'Nome já está em uso por outro usuário',
        enterNameFirst: 'Por favor, digite seu nome primeiro',
        
        // Download modal
        downloading: 'Procurando a música...',
        queuingDownload: 'Lendo os detalhes do vídeo...',
        processing: 'Processando...',
        startingDownload: 'Salvando a música...',
        downloadSuccess: 'Música adicionada',
        songReadyToQueue: 'A música foi adicionada ao catálogo compartilhado.',
        addToQueueNow: 'Adicionar à fila agora',
        downloadAndQueue: 'Adicionar e pôr na fila',
        alreadyOnCatalog: 'Já no catálogo',
        youtubeResults: 'Resultados do YouTube',
        notInCatalog: 'Não está no catálogo',
        notInCatalogDesc: 'Esta música ainda não está no catálogo. Escolha um resultado do YouTube abaixo para adicioná-la.',
        findBelow: 'Procure abaixo',
        notInCatalogTryDownload: 'Não está no catálogo? Encontre no YouTube e adicione.',
        searchYouTubeInstead: 'Procurar no YouTube',
        seeOnYouTube: 'Ver no YouTube',
        
        // Metadata modal
        confirmMetadata: 'Confirmar Metadados',
        confirmMetadataDesc: 'Os dados abaixo foram detectados a partir do título do vídeo. Confira, edite se precisar e confirme para adicionar a música.',
        enterMetadata: 'Inserir Metadados',
        enterMetadataDesc: 'Não foi possível detectar os metadados. Por favor, forneça as informações da música manualmente.',
        titleArtistRequired: 'Título e artista são obrigatórios',
        languageRequired: 'Selecione o idioma antes de continuar',
        confirmDownload: 'Confirmar e adicionar',
        songTitle: 'Título da Música *',
        artistName: 'Nome do Artista *',
        language: 'Idioma',
        enterSongTitle: 'Digite o título da música',
        enterArtistName: 'Digite o nome do artista',
        lyricsBeginning: 'Início da Letra (opcional)',
        lyricsBeginningPlaceholder: 'Primeira linha ou frase da letra...',
        
        // Invite modal
        scanQrCode: 'Escaneie este QR code para entrar na festa:',
        orVisitUrl: 'Ou compartilhe este link:',
        gotIt: 'Beleza!',
        
        // Settings modal
        languageSection: 'Idioma',
        
        // Settings
        settings: 'Configurações',
        interfaceLanguage: 'Idioma da Interface',
        save: 'Salvar',
        settingsSaved: 'Configurações salvas!',
        
        // Player
        upNext: 'Próxima',
        songAddedActivity: 'Música Adicionada',
        songSkipped: 'Música Pulada',
        songRemovedActivity: 'Música Removida',
        queueClearedActivity: 'Fila Limpa',
        queueReordered: 'Fila Reordenada',
        
        // Views
        views: 'visualizações',
        plays: 'reproduções',

        // Welcome
        welcome: 'Bem-vindo ao Karaokê!',
        welcomeDesc: 'Qual é seu nome?',
        continue: 'Continuar',
        nameTaken: 'Esse nome já está em uso',
        nameTakenDesc: 'Alguém já está usando "{name}". Escolha outro nome para continuar.',
        resumeNameConfirm: 'O nome "{name}" já foi usado nesta sessão. Você é o único "{name}" na sala? Deseja continuar com esse nome?',
        chooseAnotherName: 'Escolha outro nome para continuar.',
        signOut: 'Sair',
        signOutConfirm: 'Sair vai remover as suas músicas da fila. Deseja sair?',
        signedOut: 'Você saiu',

        // Settings
        settings: 'Configurações',
        nameSettings: 'Seu Nome',
        nameSettingsDesc: 'Gerencie seu nome de usuário nesta sessão',
        changeName: 'Trocar Nome',
        save: 'Salvar',
        userNameChanged: 'Nome de usuário alterado com sucesso',
        error: 'Erro',

        // Online version: rooms, invites, shared catalog
        addSongsTab: 'Adicionar',
        inviteFriends: 'Convidar amigos',
        partyCode: 'Código da festa',
        copyLink: 'Copiar link',
        linkCopied: 'Link copiado!',
        copyFailed: 'Não deu para copiar. Copie o link manualmente.',
        shareLink: 'Compartilhar',
        shareText: 'Vem cantar comigo no karaokê! Código da festa: {code}',
        leaveParty: 'Sair da festa',
        leavePartyConfirm: 'Sair da festa vai remover as suas músicas da fila. Deseja sair?',
        roomNotFound: 'Festa não encontrada',
        roomNotFoundDesc: 'A festa {code} não existe ou já acabou. Confira o código ou comece uma nova festa.',
        partyEnded: 'A festa acabou!',
        partyEndedDesc: 'O DJ encerrou a festa. Obrigado por cantar!',
        backToStart: 'Voltar ao início'
    },
    'es': {
        // Navigation
        appName: 'Karaoke',
        yourName: 'Tu nombre',
        enterNameRequired: 'Ingresa tu nombre (requerido)',
        playPause: 'Reproducir/Pausar',
        
        // Tabs
        search: 'Buscar',
        catalog: 'Catálogo',
        queue: 'Cola',
        
        // Search
        searchPlaceholder: 'Buscar canciones de karaoke en YouTube...',
        searchCatalog: 'Buscar o ingresar código...',
        searching: 'Buscando en YouTube...',
        searchHint: 'Busca tus canciones favoritas de karaoke',
        noResults: 'No se encontraron resultados',
        searchFailed: 'Búsqueda fallida. Intenta de nuevo.',
        
        // Catalog
        bySong: 'Por Canción',
        songDetails: 'Detalles de la Canción',
        byArtist: 'Por Artista',
        recent: 'Recientes',
        popular: 'Populares',
        myDownloads: 'Añadidas por mí',
        allLanguages: 'Todos Idiomas',
        loadingCatalog: 'Cargando catálogo...',
        emptyCatalog: 'El catálogo está vacío',
        emptyCatalogHint: 'Busca en YouTube y añade canciones para armar el catálogo',
        songs: 'canciones',
        noSongsFound: 'No se encontraron canciones',
        downloadCatalog: 'Catálogo para imprimir',
        
        // Queue
        musicQueue: 'Cola de Música',
        emptyQueue: 'Cola vacía',
        emptyQueueHint: 'Agrega canciones del catálogo o búsqueda',
        startPlaying: 'Empezar a Reproducir',
        addedBy: 'Agregado por',
        
        // Now Playing
        noSongPlaying: 'Ninguna canción reproduciendo',
        waitingForSongs: 'Esperando canciones...',
        waitingForSongsHint: 'Agrega canciones a la cola para comenzar',
        requestedBy: 'Pedido por',
        
        // Remote Control
        remoteControl: 'Control Remoto',
        playbackControls: 'Controles de Reproducción',
        pause: 'Pausar',
        resume: 'Reanudar',
        skipSong: 'Saltar Canción',
        restartSong: 'Reiniciar',
        clearQueue: 'Limpiar Cola',
        queueManagement: 'Gestionar Cola',
        
        // Confirmations
        confirm: 'Confirmar',
        cancel: 'Cancelar',
        close: 'Cerrar',
        areYouSure: '¿Estás seguro?',
        confirmSkipSong: '¿Estás seguro de que deseas saltar "{title}"?',
        confirmClearQueue: '¿Estás seguro de que deseas limpiar todas las {count} canciones de la cola?',
        confirmRemoveSong: '¿Estás seguro de que deseas eliminar "{title}" de la cola?',
        removeSong: 'Eliminar Canción',
        currentSong: 'canción actual',
        
        // Actions
        download: 'Añadir al catálogo',
        addToQueue: 'Agregar a la cola',
        remove: 'Eliminar',
        moveUp: 'Mover arriba',
        moveDown: 'Mover abajo',
        by: 'por',
        
        // Toasts
        songAddedToQueue: '¡Canción agregada a la cola!',
        queueCleared: 'Cola limpia',
        downloadComplete: '¡Canción añadida al catálogo!',
        downloadFailed: 'No se pudo añadir la canción. Intenta de nuevo.',
        failedToAddSong: 'Error al agregar canción',
        failedToRemoveSong: 'Error al eliminar canción',
        failedToClearQueue: 'Error al limpiar cola',
        onlyDjCanDoThis: 'Solo el DJ puede hacer esto',
        cannotRemoveOthersSong: 'Solo puedes eliminar tus propias canciones',
        failedToReorderQueue: 'Error al reordenar cola',
        mySongs: 'Mis canciones',
        mySongsHint: 'Cambia el orden de tus canciones. Todos los demás mantienen su turno.',
        singEarlier: 'Cantar esta antes',
        singLater: 'Cantar esta después',
        songsRearranged: 'Tus canciones fueron reordenadas',
        failedToRearrange: 'No se pudieron reordenar tus canciones',
        inLinePos: '#{n} en la cola',
        status_fetching_info: 'Obteniendo información del video…',
        status_extracting_metadata: 'Leyendo detalles de la canción…',
        status_downloading: 'Añadiendo al catálogo…',
        status_saving: 'Guardando…',
        failedToControlPlayback: 'Error al controlar reproducción',
        failedToSkipSong: 'Error al saltar canción',
        failedToRestartSong: 'Error al reiniciar canción',
        failedToStartPlayback: 'Error al iniciar reproducción',
        playbackStarted: '¡Reproducción iniciada!',
        queueIsEmpty: 'La cola está vacía',
        usernameInUse: 'Nombre ya está en uso por otro usuario',
        enterNameFirst: 'Por favor, ingresa tu nombre primero',
        
        // Download modal
        downloading: 'Buscando la canción...',
        queuingDownload: 'Leyendo los detalles del video...',
        processing: 'Procesando...',
        startingDownload: 'Guardando la canción...',
        downloadSuccess: 'Canción añadida',
        songReadyToQueue: 'La canción se añadió al catálogo compartido.',
        addToQueueNow: 'Agregar a la cola ahora',
        downloadAndQueue: 'Añadir y poner en la cola',
        alreadyOnCatalog: 'Ya en el catálogo',
        youtubeResults: 'Resultados de YouTube',
        notInCatalog: 'No está en el catálogo',
        notInCatalogDesc: 'Esta canción aún no está en el catálogo. Elige un resultado de YouTube abajo para añadirla.',
        findBelow: 'Buscar abajo',
        notInCatalogTryDownload: '¿No está en el catálogo? Búscala en YouTube y añádela.',
        searchYouTubeInstead: 'Buscar en YouTube',
        seeOnYouTube: 'Ver en YouTube',
        
        // Metadata modal
        confirmMetadata: 'Confirmar Metadatos',
        confirmMetadataDesc: 'Los datos de abajo se detectaron a partir del título del video. Revísalos, edítalos si hace falta y confirma para añadir la canción.',
        enterMetadata: 'Ingresar Metadatos',
        enterMetadataDesc: 'No se pudieron detectar los metadatos. Por favor, proporciona la información de la canción manualmente.',
        titleArtistRequired: 'Título y artista son obligatorios',
        languageRequired: 'Selecciona el idioma antes de continuar',
        confirmDownload: 'Confirmar y añadir',
        songTitle: 'Título de la Canción *',
        artistName: 'Nombre del Artista *',
        language: 'Idioma',
        enterSongTitle: 'Ingresa el título de la canción',
        enterArtistName: 'Ingresa el nombre del artista',
        lyricsBeginning: 'Inicio de la Letra (opcional)',
        lyricsBeginningPlaceholder: 'Primera línea o frase de la letra...',
        
        // Invite modal
        scanQrCode: 'Escanea este código QR para unirte a la fiesta:',
        orVisitUrl: 'O comparte este enlace:',
        gotIt: '¡Vale!',
        
        // Settings modal
        languageSection: 'Idioma',
        
        // Settings
        settings: 'Configuración',
        interfaceLanguage: 'Idioma de la Interfaz',
        save: 'Guardar',
        settingsSaved: '¡Configuración guardada!',
        
        // Player
        upNext: 'Siguiente',
        songAddedActivity: 'Canción Agregada',
        songSkipped: 'Canción Saltada',
        songRemovedActivity: 'Canción Eliminada',
        queueClearedActivity: 'Cola Limpia',
        queueReordered: 'Cola Reordenada',
        
        // Views
        views: 'vistas',
        plays: 'reproducciones',

        // Welcome
        welcome: '¡Bienvenido a Karaoke!',
        welcomeDesc: '¿Cuál es tu nombre?',
        continue: 'Continuar',
        nameTaken: 'Ese nombre ya está en uso',
        nameTakenDesc: 'Alguien ya está usando "{name}". Elige otro nombre para continuar.',
        resumeNameConfirm: 'El nombre "{name}" ya se usó en esta sesión. ¿Eres el único "{name}" en la sala? ¿Quieres continuar con este nombre?',
        chooseAnotherName: 'Elige otro nombre para continuar.',
        signOut: 'Cerrar sesión',
        signOutConfirm: 'Al cerrar sesión se quitarán tus canciones de la cola. ¿Cerrar sesión?',
        signedOut: 'Sesión cerrada',

        // Settings
        nameSettings: 'Tu Nombre',
        nameSettingsDesc: 'Administra tu nombre de usuario en esta sesión',
        changeName: 'Cambiar Nombre',
        userNameChanged: 'Nombre de usuario cambiado con éxito',
        error: 'Error',

        // Online version: rooms, invites, shared catalog
        addSongsTab: 'Añadir',
        inviteFriends: 'Invitar amigos',
        partyCode: 'Código de la fiesta',
        copyLink: 'Copiar enlace',
        linkCopied: '¡Enlace copiado!',
        copyFailed: 'No se pudo copiar. Copia el enlace a mano.',
        shareLink: 'Compartir',
        shareText: '¡Ven a cantar conmigo al karaoke! Código de la fiesta: {code}',
        leaveParty: 'Salir de la fiesta',
        leavePartyConfirm: 'Al salir de la fiesta se quitarán tus canciones de la cola. ¿Salir?',
        roomNotFound: 'Fiesta no encontrada',
        roomNotFoundDesc: 'La fiesta {code} no existe o ya terminó. Revisa el código o empieza una fiesta nueva.',
        partyEnded: '¡La fiesta terminó!',
        partyEndedDesc: 'El DJ terminó la fiesta. ¡Gracias por cantar!',
        backToStart: 'Volver al inicio'
    },
    'en': {
        // Navigation
        appName: 'Karaoke',
        yourName: 'Your name',
        enterNameRequired: 'Enter your name (required)',
        playPause: 'Play/Pause',
        
        // Tabs
        search: 'Search',
        catalog: 'Catalog',
        queue: 'Queue',
        
        // Search
        searchPlaceholder: 'Search for karaoke songs on YouTube...',
        searchCatalog: 'Search or enter code...',
        searching: 'Searching YouTube...',
        searchHint: 'Search for your favorite karaoke songs',
        noResults: 'No results found',
        searchFailed: 'Search failed. Please try again.',
        
        // Catalog
        bySong: 'By Song',
        songDetails: 'Song Details',
        byArtist: 'By Artist',
        recent: 'Recent',
        popular: 'Popular',
        myDownloads: 'Added by me',
        allLanguages: 'All Languages',
        loadingCatalog: 'Loading catalog...',
        emptyCatalog: 'The catalog is empty',
        emptyCatalogHint: 'Search YouTube and add songs to build the catalog',
        songs: 'songs',
        noSongsFound: 'No songs found',
        downloadCatalog: 'Printable catalog',
        
        // Queue
        musicQueue: 'Music Queue',
        emptyQueue: 'Queue is empty',
        emptyQueueHint: 'Add songs from the catalog or search',
        startPlaying: 'Start Playing',
        addedBy: 'Added by',
        
        // Now Playing
        noSongPlaying: 'No song playing',
        waitingForSongs: 'Waiting for songs...',
        waitingForSongsHint: 'Add songs to the queue to get started',
        requestedBy: 'Requested by',
        
        // Remote Control
        remoteControl: 'Remote Control',
        playbackControls: 'Playback Controls',
        pause: 'Pause',
        resume: 'Resume',
        skipSong: 'Skip Song',
        restartSong: 'Restart',
        clearQueue: 'Clear Queue',
        queueManagement: 'Queue Management',
        
        // Confirmations
        confirm: 'Confirm',
        cancel: 'Cancel',
        close: 'Close',
        areYouSure: 'Are you sure?',
        confirmSkipSong: 'Are you sure you want to skip "{title}"?',
        confirmClearQueue: 'Are you sure you want to clear all {count} songs from the queue?',
        confirmRemoveSong: 'Are you sure you want to remove "{title}" from the queue?',
        removeSong: 'Remove Song',
        currentSong: 'current song',
        
        // Actions
        download: 'Add to catalog',
        addToQueue: 'Add to queue',
        remove: 'Remove',
        moveUp: 'Move up',
        moveDown: 'Move down',
        by: 'by',
        
        // Toasts
        songAddedToQueue: 'Song added to queue!',
        queueCleared: 'Queue cleared',
        downloadComplete: 'Song added to the catalog!',
        downloadFailed: 'Could not add this song. Please try again.',
        failedToAddSong: 'Failed to add song',
        failedToRemoveSong: 'Failed to remove song',
        failedToClearQueue: 'Failed to clear queue',
        onlyDjCanDoThis: 'Only the DJ can do this',
        cannotRemoveOthersSong: 'You can only remove your own songs',
        failedToReorderQueue: 'Failed to reorder queue',
        mySongs: 'My songs',
        mySongsHint: 'Change the order of your songs. Everyone else keeps their turn.',
        singEarlier: 'Sing this one earlier',
        singLater: 'Sing this one later',
        songsRearranged: 'Your songs were rearranged',
        failedToRearrange: 'Could not rearrange your songs',
        inLinePos: '#{n} in line',
        status_fetching_info: 'Getting video info…',
        status_extracting_metadata: 'Reading song details…',
        status_downloading: 'Adding to the catalog…',
        status_saving: 'Saving…',
        failedToControlPlayback: 'Failed to control playback',
        failedToSkipSong: 'Failed to skip song',
        failedToRestartSong: 'Failed to restart song',
        failedToStartPlayback: 'Failed to start playback',
        playbackStarted: 'Playback started!',
        queueIsEmpty: 'Queue is empty',
        usernameInUse: 'Username already in use by another user',
        enterNameFirst: 'Please enter your name first',
        
        // Download modal
        downloading: 'Looking up the song...',
        queuingDownload: 'Reading the video details...',
        processing: 'Processing...',
        startingDownload: 'Saving the song...',
        downloadSuccess: 'Song added',
        songReadyToQueue: 'The song was added to the shared catalog.',
        addToQueueNow: 'Add to queue now',
        downloadAndQueue: 'Add & queue it',
        alreadyOnCatalog: 'Already on Catalog',
        youtubeResults: 'YouTube Results',
        notInCatalog: 'Not in the catalog',
        notInCatalogDesc: 'This song isn\'t in the catalog yet. Pick a YouTube result below to add it.',
        findBelow: 'Find below',
        notInCatalogTryDownload: 'Not in the catalog? Find it on YouTube and add it.',
        searchYouTubeInstead: 'Search on YouTube',
        seeOnYouTube: 'See on YouTube',
        
        // Metadata modal
        confirmMetadata: 'Confirm Metadata',
        confirmMetadataDesc: 'The details below were detected from the video title. Check them, edit if needed, and confirm to add the song.',
        enterMetadata: 'Enter Metadata',
        enterMetadataDesc: 'Could not detect the metadata. Please provide the song information manually.',
        titleArtistRequired: 'Title and artist are required',
        languageRequired: 'Please select a language before continuing',
        confirmDownload: 'Confirm & add',
        songTitle: 'Song Title *',
        artistName: 'Artist Name *',
        language: 'Language',
        enterSongTitle: 'Enter the song title',
        enterArtistName: 'Enter the artist name',
        lyricsBeginning: 'Lyrics Beginning (optional)',
        lyricsBeginningPlaceholder: 'First line or phrase of lyrics...',
        
        // Invite modal
        scanQrCode: 'Scan this QR code to join the party:',
        orVisitUrl: 'Or share this link:',
        gotIt: 'Got it!',
        
        // Settings modal
        languageSection: 'Language',
        
        // Settings
        settings: 'Settings',
        interfaceLanguage: 'Interface Language',
        save: 'Save',
        settingsSaved: 'Settings saved!',
        
        // Player
        upNext: 'Up Next',
        songAddedActivity: 'Song Added',
        songSkipped: 'Song Skipped',
        songRemovedActivity: 'Song Removed',
        queueClearedActivity: 'Queue Cleared',
        queueReordered: 'Queue Reordered',
        
        // Views
        views: 'views',
        plays: 'plays',

        // Welcome
        welcome: 'Welcome to Karaoke!',
        welcomeDesc: 'What is your name?',
        continue: 'Continue',
        nameTaken: 'Name already in use',
        nameTakenDesc: 'Someone is already using "{name}". Please choose a different name to continue.',
        resumeNameConfirm: 'The name "{name}" was already used in this session. Are you the only "{name}" in the room? Continue with this name?',
        chooseAnotherName: 'Please choose a different name to continue.',
        signOut: 'Sign out',
        signOutConfirm: 'Signing out will remove your songs from the queue. Sign out?',
        signedOut: 'Signed out',

        // Settings
        nameSettings: 'Your Name',
        nameSettingsDesc: 'Manage your username in this session',
        changeName: 'Change Name',
        userNameChanged: 'Username changed successfully',
        error: 'Error',

        // Online version: rooms, invites, shared catalog
        addSongsTab: 'Add songs',
        inviteFriends: 'Invite friends',
        partyCode: 'Party code',
        copyLink: 'Copy link',
        linkCopied: 'Link copied!',
        copyFailed: 'Could not copy. Please copy the link by hand.',
        shareLink: 'Share',
        shareText: 'Come sing karaoke with me! Party code: {code}',
        leaveParty: 'Leave party',
        leavePartyConfirm: 'Leaving the party removes your songs from the queue. Leave?',
        roomNotFound: 'Party not found',
        roomNotFoundDesc: 'Party {code} does not exist or has already ended. Check the code or start a new party.',
        partyEnded: 'The party is over!',
        partyEndedDesc: 'The DJ ended the party. Thanks for singing!',
        backToStart: 'Back to the start'
    }
};

// Detect system language, default to Portuguese
function detectLanguage() {
    const stored = localStorage.getItem('karaoke_language');
    if (stored && translations[stored]) {
        return stored;
    }
    
    const browserLang = navigator.language || navigator.languages?.[0] || navigator.userLanguage || '';
    
    let detected = 'pt-BR'; // Default to Portuguese
    if (browserLang.toLowerCase().startsWith('pt')) detected = 'pt-BR';
    else if (browserLang.toLowerCase().startsWith('es')) detected = 'es';
    else if (browserLang.toLowerCase().startsWith('en')) detected = 'en';
    
    // Store detected language so player can use it
    localStorage.setItem('karaoke_language', detected);
    
    return detected;
}

let currentLang = detectLanguage();

function t(key) {
    return translations[currentLang]?.[key] || translations['pt-BR']?.[key] || key;
}

function setLanguage(lang) {
    if (translations[lang]) {
        currentLang = lang;
        localStorage.setItem('karaoke_language', lang);
        if (window.app) {
            window.app.updateUILanguage();
        }
    }
}

class KaraokeApp {
    constructor() {
        this.ws = null;
        this.guestReorder = 'all'; // 'all' | 'own_only' (config guest_reorder)
        this.rearranging = false;
        this.queue = [];
        this.nowPlaying = null;
        this.isPlaying = false;
        this.catalog = [];
        this.catalogYtIdMap = {};
        this.artists = [];
        this.activeUsers = new Set();
        this.confirmCallback = null;
        this.resolvingNameConflict = false;
        this.youtubeVideosMap = {};
        this.myDownloadIds = new Set();
        this.roomGone = false; // online version: set once the party is missing or ended

        this.init();
    }

    init() {
        this.updateUILanguage();
        this.showRoomCode();
        this.checkRoom();
        this.loadUserName();
        const hasName = localStorage.getItem('karaoke_username');

        if (!hasName) {
            // Show welcome modal if no name is set
            this.showWelcomeModal();
        } else {
            this.startApp();
        }
    }

    startApp() {
        this.setupEventListeners();
        this.connectWebSocket(); // syncMyDownloads called after name confirmed in onopen
        this.loadCatalog();
        this.loadQueue();
        this.loadGuestReorder();
        this.updateUserDisplay();
    }

    updateUILanguage() {
        // Update elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key && translations[currentLang]?.[key]) {
                el.textContent = t(key);
            }
        });
        
        // Update elements with data-i18n-placeholder attribute
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key && translations[currentLang]?.[key]) {
                el.placeholder = t(key);
            }
        });
        
        // Update elements with data-i18n-title attribute
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (key && translations[currentLang]?.[key]) {
                el.title = t(key);
            }
        });
        
        // Re-render dynamic content
        if (this.catalog && this.catalog.length > 0) {
            this.renderCatalog();
        }
        if (this.queue) {
            this.renderQueue();
            this.renderRemoteQueue();
        }
        this.renderNowPlaying();
        this.updateRemotePauseButton();
    }

    // Welcome modal
    showWelcomeModal() {
        const modal = document.getElementById('welcomeModal');
        const input = document.getElementById('welcomeInput');
        const errorDiv = document.getElementById('welcomeError');
        const btnContinue = document.getElementById('btnWelcomeContinue');

        modal.classList.add('active');
        input.focus();
        errorDiv.style.display = 'none';

        const handleContinue = async () => {
            const name = input.value.trim();
            if (!name) {
                errorDiv.textContent = t('enterNameRequired');
                errorDiv.style.display = 'block';
                return;
            }

            const res = await this.claimNameInteractive(name);
            if (!res.ok) {
                errorDiv.textContent = res.status === 'active_conflict'
                    ? t('usernameInUse')
                    : (res.status === 'cancelled' ? t('chooseAnotherName') : t('error'));
                errorDiv.style.display = 'block';
                return;
            }

            // Save name and start app (the WebSocket registers it on connect)
            localStorage.setItem('karaoke_username', name);
            document.getElementById('userName').value = name;
            modal.classList.remove('active');
            this.startApp();
        };

        btnContinue.onclick = handleContinue;
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleContinue();
        });
    }

    showNameConflictModal(takenName) {
        // Reuse welcome modal — no backdrop dismiss, no close button
        const modal = document.getElementById('welcomeModal');
        const input = document.getElementById('welcomeInput');
        const errorDiv = document.getElementById('welcomeError');
        const btnContinue = document.getElementById('btnWelcomeContinue');
        const title = modal.querySelector('[data-i18n="welcome"]');

        title.textContent = t('nameTaken');
        input.value = '';
        input.placeholder = t('changeName');
        errorDiv.textContent = t('nameTakenDesc').replace('{name}', takenName);
        errorDiv.style.display = 'block';
        modal.classList.add('active');
        input.focus();

        const handleContinue = async () => {
            const name = input.value.trim();
            if (!name) {
                errorDiv.textContent = t('enterNameRequired');
                errorDiv.style.display = 'block';
                return;
            }

            const res = await this.claimNameInteractive(name);
            if (!res.ok) {
                errorDiv.textContent = res.status === 'active_conflict'
                    ? (t('usernameInUse') + ' ' + t('nameTakenDesc').replace('{name}', name))
                    : (res.status === 'cancelled' ? t('chooseAnotherName') : t('error'));
                errorDiv.style.display = 'block';
                return;
            }

            localStorage.setItem('karaoke_username', name);
            document.getElementById('userName').value = name;
            this.updateUserDisplay();
            this.resolvingNameConflict = false;
            modal.classList.remove('active');

            this.registerUser(name);
            this.syncMyDownloads(name);
        };

        btnContinue.onclick = handleContinue;
        input.onkeypress = (e) => { if (e.key === 'Enter') handleContinue(); };
    }

    // Settings modal - name change
    updateUserDisplay() {
        const display = document.getElementById('userDisplay');
        if (display) {
            display.textContent = this.getUserName();
        }
    }

    // Username validation (for queue operations)
    validateUserName() {
        const name = this.getUserName();
        if (!name || name === 'Anonymous' || name.trim() === '') {
            this.showToast(t('enterNameFirst'), 'warning');
            return false;
        }
        return true;
    }

    // WebSocket
    connectWebSocket() {
        if (this.roomGone) return;
        this.ws = new WebSocket(KRoom.wsUrl());

        this.ws.onopen = async () => {
            console.log('WebSocket connected');
            // If user is already resolving a conflict, don't race with the modal
            if (this.resolvingNameConflict) return;

            const name = this.getUserName();
            if (!name || name === 'Anonymous') return;

            // Already confirmed a resume for this name in this session — just bind.
            if (this.confirmedResumeName === name) {
                this.registerUser(name);
                this.syncMyDownloads(name);
                return;
            }

            try {
                const res = await this.checkName(name);
                if (res.status === 'ok') {
                    // Free, or same device reconnecting — silent resume.
                    this.registerUser(name);
                    this.syncMyDownloads(name);
                } else if (res.status === 'confirm_resume') {
                    // Name exists but nobody holds it online (e.g. our claim was
                    // lost in a server restart). Offer the resume prompt instead
                    // of the "name taken" modal — it's almost always this device's
                    // own identity.
                    const r = await this.claimNameInteractive(name);
                    if (r.ok) {
                        this.registerUser(name);
                        this.syncMyDownloads(name);
                    } else {
                        this.resolvingNameConflict = true;
                        this.showNameConflictModal(name);
                    }
                } else {
                    // active_conflict — another device is online with this name.
                    this.resolvingNameConflict = true;
                    this.showNameConflictModal(name);
                }
            } catch (e) {
                // API unreachable — register anyway and sync
                this.registerUser(name);
                this.syncMyDownloads(name);
            }
        };

        this.ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            this.handleWebSocketMessage(msg);
        };

        this.ws.onclose = (event) => {
            // Online version: close code 4404 = the party does not exist (any more).
            if (event && event.code === 4404) {
                this.showRoomGone('notFound');
                return;
            }
            if (this.roomGone) return;
            console.log('WebSocket disconnected, reconnecting...');
            setTimeout(() => this.connectWebSocket(), 3000);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    handleWebSocketMessage(msg) {
        console.log('[WebSocket] Received:', msg.type, msg.payload);
        switch (msg.type) {
            case 'init':
            case 'queue_update':
                this.queue = msg.payload.queue || [];
                this.nowPlaying = msg.payload.now_playing;
                if (msg.payload.is_playing !== undefined) {
                    this.isPlaying = msg.payload.is_playing;
                }
                // Handle stop action - return to waiting state
                if (msg.payload.action === 'stop') {
                    this.nowPlaying = null;
                    this.isPlaying = false;
                }
                this.renderQueue();
                this.renderNowPlaying();
                this.updateQueueBadge();
                this.updatePlayPauseButton();
                this.renderRemoteQueue();
                break;
            case 'job_update':
                // Online version: no longer broadcast (the HTTP answer carries the job);
                // kept harmless, it only reacts to the job this page is waiting for.
                this.handleJobUpdate(msg.payload);
                break;
            case 'server_shutdown':
                // Online version: the DJ ended the party (the room is deleted).
                this.showRoomGone('ended');
                break;
            case 'active_users':
                this.activeUsers = new Set(msg.payload.users || []);
                break;
            case 'config_update':
                if (msg.payload && msg.payload.guest_reorder) {
                    this.setGuestReorder(msg.payload.guest_reorder);
                }
                break;
        }
    }

    // Event Listeners
    setupEventListeners() {
        // Tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        // Search
        document.getElementById('btnSearch').addEventListener('click', () => this.searchYouTube());
        document.getElementById('searchInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.searchYouTube();
        });

        // Catalog search - text filtering on input, code matching only on Enter
        document.getElementById('catalogSearch').addEventListener('input', (e) => {
            this.filterCatalog(e.target.value, false);
        });
        document.getElementById('catalogSearch').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.filterCatalog(e.target.value, true);
        });

        // PDF download button
        const btnDownloadPdf = document.getElementById('btnDownloadPdf');
        if (btnDownloadPdf) {
            btnDownloadPdf.addEventListener('click', () => this.downloadPdfCatalog());
        }

        // Auto-hide catalog header (PDF button + search) on scroll down,
        // re-show on any scroll up or when near the top; filter chips stay visible
        const catalogResults = document.getElementById('catalogResults');
        const catalogHeader = document.getElementById('catalogHeader');
        if (catalogResults && catalogHeader) {
            let lastCatalogScrollTop = 0;
            catalogResults.addEventListener('scroll', () => {
                const st = catalogResults.scrollTop;
                const delta = st - lastCatalogScrollTop;
                lastCatalogScrollTop = Math.max(st, 0);
                if (st <= 10 || delta < -5) {
                    catalogHeader.classList.remove('collapsed');
                } else if (delta > 5 && !catalogHeader.classList.contains('collapsed')) {
                    // Only collapse if enough scroll room remains afterwards,
                    // otherwise the browser clamps scrollTop and re-triggers a show
                    const room = catalogResults.scrollHeight - catalogResults.clientHeight - catalogHeader.offsetHeight;
                    if (st < room) {
                        catalogHeader.classList.add('collapsed');
                    }
                }
            }, { passive: true });
        }

        // Song cards in the catalog: one delegated listener instead of inline
        // onclick attributes (the add button sits inside the card).
        if (catalogResults) {
            catalogResults.addEventListener('click', (e) => {
                const card = e.target.closest('.song-card[data-song-id]');
                if (!card) return;
                if (e.target.closest('.song-add-btn')) this.addToQueue(card.dataset.songId);
                else this.openSongDetail(card.dataset.songId);
            });
        }

        // Filter chips
        document.querySelectorAll('.chip').forEach(chip => {
            chip.addEventListener('click', () => this.setFilter(chip));
        });

        // Queue controls
        const btnPlayPause = document.getElementById('btnPlayPause');
        if (btnPlayPause) {
            btnPlayPause.addEventListener('click', () => {
                console.log('Play/Pause button clicked');
                this.playPause();
            });
        } else {
            console.error('btnPlayPause not found!');
        }

        // Remote control button
        const btnRemoteControl = document.getElementById('btnRemoteControl');
        if (btnRemoteControl) {
            btnRemoteControl.addEventListener('click', () => this.openRemoteModal());
        }

        // Remote modal controls
        const remoteModal = document.getElementById('remoteModal');
        if (remoteModal) {
            remoteModal.querySelector('.modal-backdrop').addEventListener('click', () => this.closeRemoteModal());
            remoteModal.querySelector('.modal-close').addEventListener('click', () => this.closeRemoteModal());
        }
        
        document.getElementById('remotePauseResume')?.addEventListener('click', () => this.playPause());
        document.getElementById('remoteRestart')?.addEventListener('click', () => this.restartSong());
        document.getElementById('remoteSkip')?.addEventListener('click', () => this.confirmSkipSong());
        document.getElementById('remoteClearQueue')?.addEventListener('click', () => this.confirmClearQueue());

        // Confirmation modal
        const confirmModal = document.getElementById('confirmModal');
        if (confirmModal) {
            confirmModal.querySelector('.modal-backdrop').addEventListener('click', () => this.closeConfirmModal());
            confirmModal.querySelector('.modal-close').addEventListener('click', () => this.closeConfirmModal());
            document.getElementById('confirmCancel')?.addEventListener('click', () => this.closeConfirmModal());
            document.getElementById('confirmOk')?.addEventListener('click', () => this.executeConfirm());
        }

        // Metadata modal
        const metadataModal = document.getElementById('metadataModal');
        if (metadataModal) {
            metadataModal.querySelector('.modal-backdrop').addEventListener('click', () => this.closeMetadataModal());
        }

        const btnSettings = document.getElementById('btnSettings');
        if (btnSettings) {
            btnSettings.addEventListener('click', () => this.openSettingsModal());
        }

        // Modal
        document.querySelector('#modal .modal-backdrop').addEventListener('click', () => this.closeModal());
        document.querySelector('#modal .modal-close').addEventListener('click', () => this.closeModal());

        // Settings modal
        const settingsModal = document.getElementById('settingsModal');
        if (settingsModal) {
            settingsModal.querySelector('.modal-backdrop').addEventListener('click', () => this.closeSettingsModal());
        }
        document.getElementById('btnLeaveParty')?.addEventListener('click', () => this.leaveParty());

        // Online version: invite modal (party code, QR code, link) instead of LAN connection info
        document.getElementById('btnShare')?.addEventListener('click', () => this.openShareModal());
        document.getElementById('roomCodeBtn')?.addEventListener('click', () => this.openShareModal());
        const shareModal = document.getElementById('shareModal');
        if (shareModal) {
            shareModal.querySelector('.modal-backdrop').addEventListener('click', () => this.closeShareModal());
            shareModal.querySelector('.modal-close').addEventListener('click', () => this.closeShareModal());
            document.getElementById('btnShareDone')?.addEventListener('click', () => this.closeShareModal());
            document.getElementById('btnCopyLink')?.addEventListener('click', () => this.copyJoinLink());
            document.getElementById('btnNativeShare')?.addEventListener('click', () => this.nativeShare());
        }
    }

    switchTab(tabId) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        document.querySelector(`.tab[data-tab="${tabId}"]`).classList.add('active');
        document.getElementById(`${tabId}Tab`).classList.add('active');
    }

    loadUserName() {
        const name = localStorage.getItem('karaoke_username') || '';
        // Create a hidden element to store the name for consistency with old code
        let userNameEl = document.getElementById('userName');
        if (!userNameEl) {
            userNameEl = document.createElement('input');
            userNameEl.id = 'userName';
            userNameEl.type = 'hidden';
            document.body.appendChild(userNameEl);
        }
        userNameEl.value = name;
        this.updateUserDisplay();
    }

    getUserName() {
        return localStorage.getItem('karaoke_username') || 'Anonymous';
    }

    // Stable per-device id so the server can tell "same phone reconnecting"
    // (silent resume) from "a different phone claiming this name".
    getClientId() {
        let id = localStorage.getItem('karaoke_client_id');
        if (!id) {
            id = (window.crypto && crypto.randomUUID)
                ? crypto.randomUUID()
                : 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            localStorage.setItem('karaoke_client_id', id);
        }
        return id;
    }

    // Ask the server whether this device may use `name`. Returns
    // { ok, status: 'ok'|'confirm_resume'|'active_conflict'|'error', error }.
    async checkName(name, confirm = false) {
        try {
            const result = await this.api('/users/check', {
                method: 'POST',
                body: JSON.stringify({ user_name: name, client_id: this.getClientId(), confirm })
            });
            const status = (result.data && result.data.status) || (result.success ? 'ok' : 'active_conflict');
            return { ok: result.success && status === 'ok', status, error: result.error };
        } catch (e) {
            return { ok: false, status: 'error', error: e };
        }
    }

    // Bind this connection to `name` on the server.
    registerUser(name) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'register_user',
                payload: { user_name: name, client_id: this.getClientId() }
            }));
        }
    }

    // Transfer this device's existing session (roster identity + queued songs)
    // from oldName to newName, instead of claiming a fresh name and orphaning
    // the old one. Returns { ok, status: 'ok'|'active_conflict'|'error' }.
    async renameName(oldName, newName) {
        try {
            const result = await this.api('/users/rename', {
                method: 'POST',
                body: JSON.stringify({ old_name: oldName, new_name: newName, client_id: this.getClientId() })
            });
            const status = (result.data && result.data.status) || (result.success ? 'ok' : 'active_conflict');
            return { ok: result.success && status === 'ok', status, error: result.error };
        } catch (e) {
            return { ok: false, status: 'error', error: e };
        }
    }

    // Full claim flow with the resume confirmation. Returns { ok, status }.
    async claimNameInteractive(name) {
        let res = await this.checkName(name);
        if (res.status === 'confirm_resume') {
            if (!window.confirm(t('resumeNameConfirm').replace(/\{name\}/g, name))) {
                return { ok: false, status: 'cancelled' };
            }
            this.confirmedResumeName = name; // skip a second prompt when the WS re-checks
            res = await this.checkName(name, true);
        }
        return { ok: res.ok, status: res.status, error: res.error };
    }

    // Leave the session: remove this player's queued songs and roster entry,
    // then return to the welcome screen.
    // Online version: `leave` = "Leave party" (sign out, then back to /karaoke/).
    async signOut(leave = false) {
        const name = this.getUserName();
        if (name && name !== 'Anonymous') {
            if (!window.confirm(t(leave ? 'leavePartyConfirm' : 'signOutConfirm'))) return;
            try {
                await this.api('/users/signout', {
                    method: 'POST',
                    body: JSON.stringify({ user_name: name, client_id: this.getClientId() })
                });
            } catch (e) { /* sign out locally even if the request failed */ }
        }
        localStorage.removeItem('karaoke_username');
        this.confirmedResumeName = null;
        this.showToast(t('signedOut'), 'success');
        if (leave) {
            this.roomGone = true; // stop the WebSocket from reconnecting while we leave
            if (this.ws) { try { this.ws.close(); } catch (e) { /* ignore */ } }
            setTimeout(() => { location.href = '/karaoke/'; }, 400);
        } else {
            setTimeout(() => location.reload(), 400);
        }
    }

    leaveParty() {
        return this.signOut(true);
    }

    // API Methods
    // Online version: KRoom.fetch adds the room prefix and the auth headers.
    async api(endpoint, options = {}) {
        console.log('API call:', endpoint, options);
        try {
            const response = await KRoom.fetch(endpoint, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });
            const data = await response.json();
            console.log('API response:', data);
            if (response.status === 404 && data && data.data && data.data.code === 'room_not_found') {
                this.showRoomGone('notFound');
            }
            return data;
        } catch (error) {
            console.error('API error:', error);
            throw error;
        }
    }

    // Extract video ID from YouTube URL (handles both youtube.com and youtu.be formats, strips query params)
    extractYouTubeVideoId(input) {
        try {
            // Try to parse as URL
            const url = new URL(input);
            
            // Handle youtube.com links
            if (url.hostname.includes('youtube.com')) {
                const videoId = url.searchParams.get('v');
                if (videoId) return videoId;
            }
            
            // Handle youtu.be short links
            if (url.hostname.includes('youtu.be')) {
                const match = url.pathname.match(/^\/([a-zA-Z0-9_-]{11})/);
                if (match) return match[1];
            }
        } catch (e) {
            // Not a valid URL
        }
        
        return null;
    }

    // YouTube Search
    async searchYouTube() {
        const query = document.getElementById('searchInput').value.trim();
        if (!query) return;

        const container = document.getElementById('searchResults');
        
        // Check if input is a YouTube link
        const videoId = this.extractYouTubeVideoId(query);
        if (videoId) {
            // Direct YouTube link detected - load video info directly
            container.innerHTML = `<div class="loading"><div class="spinner"></div><p>${t('searching')}</p></div>`;
            try {
                const result = await this.api(`/youtube/video/${videoId}`);
                if (result.success && result.data) {
                    this.renderSearchResults([], [result.data.video]);
                } else {
                    container.innerHTML = `<div class="empty-state">
                        <span class="material-icons-round">error_outline</span>
                        <p>${this.escapeHtml(result.error || t('noResults'))}</p>
                    </div>`;
                }
            } catch (error) {
                container.innerHTML = `<div class="empty-state">
                    <span class="material-icons-round">error_outline</span>
                    <p>${t('searchFailed')}</p>
                </div>`;
            }
            return;
        }

        // Regular search query - search both catalog and YouTube
        container.innerHTML = `<div class="loading"><div class="spinner"></div><p>${t('searching')}</p></div>`;

        try {
            // Search catalog and YouTube in parallel
            const [catalogResult, youtubeResult] = await Promise.all([
                this.api(`/catalog/search?q=${encodeURIComponent(query)}`),
                this.api(`/youtube/search?q=${encodeURIComponent(query)}`)
            ]);

            const catalogSongs = (catalogResult.success && catalogResult.data) ? catalogResult.data : [];
            const youtubeVideos = (youtubeResult.success && youtubeResult.data) ? youtubeResult.data : [];

            if (catalogSongs.length === 0 && youtubeVideos.length === 0) {
                container.innerHTML = `<div class="empty-state">
                    <span class="material-icons-round">search_off</span>
                    <p>${t('noResults')}</p>
                </div>`;
            } else {
                this.renderSearchResults(catalogSongs, youtubeVideos);
            }
        } catch (error) {
            console.error('Search error:', error);
            container.innerHTML = `<div class="empty-state">
                <span class="material-icons-round">error_outline</span>
                <p>${t('searchFailed')}</p>
            </div>`;
        }
    }

    renderSearchResults(catalogSongs = [], youtubeVideos = []) {
        const container = document.getElementById('searchResults');
        let html = '';

        // Show catalog results first (up to 3)
        if (catalogSongs && catalogSongs.length > 0) {
            const topCatalogSongs = catalogSongs.slice(0, 3);
            html += '<div class="results-group">';
            html += `<h3 class="results-heading">${t('alreadyOnCatalog')}</h3>`;
            html += topCatalogSongs.map(song => this.renderSimplifiedSongCard(song)).join('');
            html += '</div>';
        }

        // Show YouTube results — catalog ID matches first
        if (youtubeVideos && youtubeVideos.length > 0) {
            const sorted = [...youtubeVideos].sort((a, b) => {
                const aMatch = !!this.catalogYtIdMap[a.video_id];
                const bMatch = !!this.catalogYtIdMap[b.video_id];
                return bMatch - aMatch;
            });
            html += '<div>';
            html += `<h3 class="results-heading">${t('youtubeResults')}</h3>`;
            html += sorted.map(video => this.renderYouTubeCard(video, this.catalogYtIdMap[video.video_id] || null)).join('');
            html += '</div>';
        }

        container.innerHTML = html;

        // Click handlers are bound here instead of inline onclick attributes so
        // titles with quotes can't break out of the handler (XSS).
        container.querySelectorAll('.simplified-song-card, .song-card[data-video-id]').forEach(el => {
            el.addEventListener('click', () => {
                if (el.dataset.searchTitle !== undefined) {
                    this.switchToSearchInCatalog(el.dataset.searchTitle);
                } else {
                    this.openYouTubeVideoModal(el.dataset.videoId);
                }
            });
        });
    }

    renderSimplifiedSongCard(song) {
        return `
            <div class="simplified-song-card" data-search-title="${this.escapeHtml(song.title)}">
                <div>
                    <div class="song-name">${this.escapeHtml(song.title)}</div>
                    <div class="song-artist-name">${this.escapeHtml(song.artist)}</div>
                </div>
                <div class="catalog-arrow">
                    <span class="material-icons-round">open_in_new</span>
                </div>
            </div>
        `;
    }

    renderYouTubeCard(video, catalogMatch = null) {
        // Store video data for modal access
        if (!this.youtubeVideosMap) this.youtubeVideosMap = {};
        this.youtubeVideosMap[video.video_id] = video;

        // Construct thumbnail URL from video ID (YouTube CDN)
        const thumbnailUrl = `https://img.youtube.com/vi/${encodeURIComponent(video.video_id)}/hqdefault.jpg`;

        const catalogBox = catalogMatch
            ? `<div class="catalog-match-badge">
                <span class="material-icons-round">library_music</span>
                ${t('alreadyOnCatalog')}
               </div>`
            : '';

        const catalogArrow = catalogMatch
            ? `<div class="catalog-match-arrow"><span class="material-icons-round">open_in_new</span></div>`
            : '';

        const searchTitleAttr = catalogMatch
            ? ` data-search-title="${this.escapeHtml(catalogMatch.title)}"`
            : '';

        return `
            <div class="song-card${catalogMatch ? ' catalog-match' : ''}" data-video-id="${this.escapeHtml(video.video_id)}"${searchTitleAttr}>
                <img class="yt-card-thumb" src="${thumbnailUrl}" alt="${this.escapeHtml(video.title)}">
                <div class="song-info">
                    <div class="yt-card-title">${this.escapeHtml(video.title)}</div>
                    <div class="yt-card-meta">
                        <span>${this.escapeHtml(video.duration || '--:--')}</span>
                        <span class="dot-sep">•</span>
                        <span>${this.escapeHtml(video.channel)}</span>
                    </div>
                    ${catalogBox}
                </div>
                ${catalogArrow}
            </div>
        `;
    }

    switchToSearchInCatalog(searchQuery) {
        // Set the catalog search input
        document.getElementById('catalogSearch').value = searchQuery;
        // Switch to catalog tab
        this.switchTab('catalog');
        // Filter the catalog
        this.filterCatalog(searchQuery, false);
    }

    searchOnYouTube(searchQuery) {
        // Set the search input on download tab
        document.getElementById('searchInput').value = searchQuery;
        // Switch to download/search tab
        this.switchTab('search');
        // Perform the search
        this.searchYouTube();
    }

    openYouTubeVideoModal(videoId) {
        // Look up video from stored map
        const video = this.youtubeVideosMap && this.youtubeVideosMap[videoId];
        if (!video) {
            this.showToast('Video data not found', 'error');
            return;
        }
        
        const youtubeUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(video.video_id)}`;
        // Construct thumbnail URL from video_id using YouTube CDN
        const thumbnail = `https://img.youtube.com/vi/${encodeURIComponent(video.video_id)}/hqdefault.jpg`;
        
        const content = `
            <div class="yt-modal">
                <a href="${youtubeUrl}" target="_blank" rel="noopener" class="yt-thumb-link">
                    <img src="${thumbnail}" alt="${this.escapeHtml(video.title)}">
                    <div class="yt-thumb-overlay">
                        <div class="yt-thumb-overlay-pill">
                            <span class="material-icons-round">open_in_new</span>
                            ${t('seeOnYouTube') || 'See on YouTube'}
                        </div>
                    </div>
                </a>
                <div class="yt-modal-text">
                    <h3 class="yt-modal-title">${this.escapeHtml(video.title)}</h3>
                    <p class="yt-modal-channel">${this.escapeHtml(video.channel)}</p>
                    <p class="yt-modal-meta">${this.escapeHtml(video.duration || '--:--')} • ${this.escapeHtml(video.view_count ?? '')} ${t('views')}</p>
                </div>
            </div>
        `;

        const footer = `
            <button class="btn-secondary" id="ytModalDownload" type="button">
                <span class="material-icons-round">library_add</span>
                ${t('download')}
            </button>
            <button class="btn-primary" id="ytModalDownloadQueue" type="button">
                <span class="material-icons-round">queue_music</span>
                ${t('downloadAndQueue')}
            </button>
        `;

        this.showModal(`${video.title}`, content, footer);
        document.getElementById('ytModalDownload').addEventListener('click', () => {
            this.closeModal();
            this.downloadVideo(video.video_id);
        });
        document.getElementById('ytModalDownloadQueue').addEventListener('click', () => {
            this.closeModal();
            this.downloadVideoAndQueue(video.video_id);
        });
    }

    // Download
    async downloadVideo(videoId) {
        // Store the video ID so we can match job updates before API response
        this.pendingVideoId = videoId;
        
        this.showModal(t('downloading'), `
            <div class="progress-container">
                <div class="progress-bar" aria-hidden="true">
                    <div class="progress-fill" id="downloadProgress" style="width: 100%"></div>
                </div>
                <p class="progress-text" id="downloadStatus">${t('queuingDownload')}</p>
            </div>
        `);

        try {
            const result = await this.api('/youtube/download', {
                method: 'POST',
                body: JSON.stringify({ video_id: videoId, user_name: this.getUserName() })
            });

            if (result.success && result.data && result.data.job_id) {
                this.currentJobId = result.data.job_id;
                this.pendingVideoId = null;
                // Online version: the job runs synchronously and comes back in this answer.
                this.applyJobResult(result.data);
            } else {
                this.pendingVideoId = null;
                this.closeModal();
                this.showToast(result.error || t('downloadFailed'), 'error', 5000);
            }
        } catch (error) {
            this.pendingVideoId = null;
            this.closeModal();
            this.showToast(t('downloadFailed'), 'error', 5000);
        }
    }

    // Online version: POST /youtube/download and /youtube/submit-metadata answer
    // {job_id, job} with a finished job snapshot; feed it to the existing handler.
    applyJobResult(data) {
        const job = data && data.job;
        if (!job || !job.status) {
            this.currentJobId = null;
            this.addToQueueAfterDownload = false;
            this.closeModal();
            this.showToast(t('downloadFailed'), 'error', 5000);
            return;
        }
        this.handleJobUpdate({ ...job, id: data.job_id });
    }

    async downloadVideoAndQueue(videoId) {
        this.addToQueueAfterDownload = true;
        await this.downloadVideo(videoId);
    }

    // Raw yt-dlp/catalog progress statuses -> translated text; anything else passes through.
    jobStatusText(message) {
        const key = 'status_' + message;
        return (message && translations[currentLang]?.[key]) ? t(key) : message;
    }

    async handleJobUpdate(job) {
        // Match by job ID or by pending video ID (for race condition)
        const isCurrentJob = (this.currentJobId && job.id === this.currentJobId) || 
                            (this.pendingVideoId && job.type === 'download');
        
        if (isCurrentJob) {
            // Update currentJobId if we matched by pendingVideoId
            if (!this.currentJobId && job.id) {
                this.currentJobId = job.id;
            }
            
            const progressBar = document.getElementById('downloadProgress');
            const statusText = document.getElementById('downloadStatus');

            if (progressBar) progressBar.style.width = `${job.progress}%`;
            if (statusText) statusText.textContent = this.jobStatusText(job.message) || t('processing');

            // Handle metadata confirmation
            if (job.status === 'confirm_metadata') {
                this.pendingVideoId = null;
                this.closeModal();
                this.openMetadataModal(job.data);
                return;
            }

            if (job.status === 'completed') {
                this.currentJobId = null;
                this.pendingVideoId = null;
                this.closeModal();
                if (job.result && job.result.id) {
                    this.myDownloadIds.add(job.result.id);
                    const userName = this.getUserName();
                    localStorage.setItem(`karaoke_my_downloads_${userName}`, JSON.stringify([...this.myDownloadIds]));
                }
                this.loadCatalog();
                if (this.addToQueueAfterDownload && job.result && job.result.id) {
                    this.addToQueueAfterDownload = false;
                    await this.addToQueue(job.result.id);
                } else {
                    this.showToast(t('downloadComplete'), 'success');
                }
            } else if (job.status === 'failed') {
                this.currentJobId = null;
                this.pendingVideoId = null;
                this.addToQueueAfterDownload = false;
                this.closeModal();
                this.showToast(job.error || t('downloadFailed'), 'error', 5000);
            }
        }
    }

    // Metadata Modal Methods
    openMetadataModal(data) {
        console.log('Opening metadata modal with data:', data);
        const modal = document.getElementById('metadataModal');
        if (!modal) return;

        // Store video ID for submission
        document.getElementById('metadataVideoId').value = data?.video_id || '';
        document.getElementById('metadataVideoTitle').textContent = data?.video_title || 'Unknown';
        document.getElementById('metadataVideoChannel').textContent = data?.video_channel || 'Unknown';
        
        // Pre-fill form with the extracted metadata
        document.getElementById('metadataTitle').value = data?.extracted_title || '';
        document.getElementById('metadataArtist').value = data?.extracted_artist || '';
        const langSelect = document.getElementById('metadataLanguage');
        langSelect.value = (data?.extracted_language || '').toUpperCase();
        // If the code isn't among the known options the select stays blank.
        // Try the interface language next; if that's also not an option, fall back to OTHER.
        if (!langSelect.value) langSelect.value = (currentLang || 'en').toUpperCase();
        if (!langSelect.value) langSelect.value = 'OTHER';

        // Update modal title and description
        const modalTitle = document.getElementById('metadataModalTitle');
        const modalDesc = document.getElementById('metadataModalDesc');
        if (data?.extracted_title && data?.extracted_artist) {
            modalTitle.innerHTML = '<span class="material-icons-round">check_circle</span> ' + escapeHtml(t('confirmMetadata'));
            modalDesc.textContent = t('confirmMetadataDesc');
        } else {
            modalTitle.innerHTML = '<span class="material-icons-round">warning</span> ' + escapeHtml(t('enterMetadata'));
            modalDesc.textContent = t('enterMetadataDesc');
        }

        modal.classList.add('active');
    }

    closeMetadataModal() {
        const modal = document.getElementById('metadataModal');
        if (modal) {
            modal.classList.remove('active');
        }
        this.currentJobId = null;
        this.addToQueueAfterDownload = false;
        console.log('Download cancelled by user');
    }

    swapTitleArtist() {
        const titleInput = document.getElementById('metadataTitle');
        const artistInput = document.getElementById('metadataArtist');
        const tempTitle = titleInput.value;
        titleInput.value = artistInput.value;
        artistInput.value = tempTitle;
    }

    async submitMetadata() {
        const videoId = document.getElementById('metadataVideoId').value.trim();
        const title = document.getElementById('metadataTitle').value.trim();
        const artist = document.getElementById('metadataArtist').value.trim();
        const language = document.getElementById('metadataLanguage').value.trim();

        console.log('Submitting metadata:', { videoId, title, artist, language });

        if (!videoId) {
            this.showToast('Video ID is missing', 'error');
            return;
        }

        if (!title || !artist) {
            this.showToast(t('titleArtistRequired'), 'error');
            return;
        }

        if (!language) {
            this.showToast(t('languageRequired'), 'error');
            return;
        }

        try {
            // Close modal directly — avoid closeMetadataModal() which resets addToQueueAfterDownload
            document.getElementById('metadataModal')?.classList.remove('active');

            // Show download progress modal
            this.showModal(
                t('downloading'),
                `<div class="progress-container">
                    <div class="progress-bar" aria-hidden="true">
                        <div class="progress-fill" id="downloadProgress" style="width: 100%"></div>
                    </div>
                    <p class="progress-text" id="downloadStatus">${t('startingDownload')}</p>
                </div>`
            );

            const result = await this.api('/youtube/submit-metadata', {
                method: 'POST',
                body: JSON.stringify({
                    video_id: videoId,
                    title: title,
                    artist: artist,
                    language: language || (currentLang || 'EN').toUpperCase(),
                    user_name: this.getUserName()
                })
            });

            console.log('Submit metadata result:', result);

            if (result.success && result.data?.job_id) {
                this.currentJobId = result.data.job_id;
                // Online version: the job comes back finished in this answer.
                this.applyJobResult(result.data);
            } else {
                this.closeModal();
                this.showToast(result.error || t('downloadFailed'), 'error');
            }
        } catch (error) {
            console.error('Submit metadata error:', error);
            this.closeModal();
            this.showToast(t('downloadFailed'), 'error');
        }
    }

    // Catalog
    async loadCatalog() {
        try {
            const result = await this.api('/catalog');
            if (result.success) {
                this.catalog = result.data || [];
                this.catalogYtIdMap = {};
                for (const song of this.catalog) {
                    if (song.youtube_id) this.catalogYtIdMap[song.youtube_id] = song;
                }
                this.renderCatalog();
            }
        } catch (error) {
            console.error('Failed to load catalog:', error);
        }
    }

    // Online version: there is no PDF generator; the printable catalog page
    // (/karaoke/print/, "Save as PDF" in the browser) opens in a new tab, in the
    // interface language like the original PDF.
    downloadPdfCatalog() {
        const url = `/karaoke/print/?r=${KRoom.code}&lang=${encodeURIComponent(currentLang)}`;
        const win = window.open(url, '_blank');
        if (win) win.opener = null;
        else window.location.href = url; // pop-up blocked: open it here
    }

    renderCatalog() {
        const container = document.getElementById('catalogResults');
        const chip = document.querySelector('.chip.active');
        const sortFilter = document.getElementById('sortFilter')?.value || 'all';
        const filter = chip ? chip.dataset.filter : sortFilter;
        const languageFilter = document.getElementById('languageFilter')?.value || '';

        // Update language filter dropdown options
        this.updateLanguageFilterOptions();

        if (!this.catalog || this.catalog.length === 0) {
            container.innerHTML = `<div class="empty-state">
                <span class="material-icons-round">library_music</span>
                <p>${t('emptyCatalog')}</p>
                <small>${t('emptyCatalogHint')}</small>
            </div>`;
            return;
        }

        // Filter by language if selected
        let filteredCatalog = this.catalog;
        if (languageFilter) {
            filteredCatalog = this.catalog.filter(song => song.language === languageFilter);
        }

        if (filteredCatalog.length === 0) {
            container.innerHTML = `<div class="empty-state">
                <span class="material-icons-round">library_music</span>
                <p>${t('noSongsFound')}</p>
            </div>`;
            return;
        }

        if (filter === 'myDownloads') {
            const songs = filteredCatalog.filter(song => this.myDownloadIds.has(song.id));
            if (songs.length === 0) {
                container.innerHTML = `<div class="empty-state">
                    <span class="material-icons-round">cloud_download</span>
                    <p>${t('noSongsFound')}</p>
                </div>`;
            } else {
                container.innerHTML = songs.map(song => this.renderSongCard(song, true)).join('');
            }
        } else if (filter === 'artists') {
            this.renderCatalogByArtist(container, filteredCatalog);
        } else {
            let songs = [...filteredCatalog];
            if (filter === 'recent') {
                songs.sort((a, b) => new Date(b.added_at) - new Date(a.added_at));
            } else if (filter === 'popular') {
                songs.sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
            } else {
                songs.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
            }
            container.innerHTML = songs.map(song => this.renderSongCard(song, true)).join('');
        }
    }

    async updateLanguageFilterOptions() {
        const select = document.getElementById('languageFilter');
        if (!select || !this.catalog) return;

        // Get unique languages from catalog
        const catalogLanguages = [...new Set(this.catalog.map(song => song.language).filter(Boolean))];

        // Remember current selection
        const currentValue = select.value;

        // Fetch language names from API
        let langNames = {};
        try {
            const result = await this.api('/languages');
            if (result.success && result.data) {
                result.data.forEach(lang => {
                    langNames[lang.id] = lang.name;
                });
            }
        } catch (e) {
            // Fallback to hardcoded names if API fails
            langNames = {
                'PT-BR': 'Português (BR)',
                'PT': 'Português (PT)',
                'EN': 'English',
                'ES': 'Español',
                'FR': 'Français',
                'IT': 'Italiano',
                'DE': 'Deutsch',
                'JA': '日本語',
                'KO': '한국어'
            };
        }

        // Sort languages by their display name
        catalogLanguages.sort((a, b) => {
            const nameA = langNames[a] || a;
            const nameB = langNames[b] || b;
            return nameA.localeCompare(nameB);
        });

        // Rebuild options
        select.innerHTML = `<option value="" data-i18n="allLanguages">${t('allLanguages') || 'All Languages'}</option>`;
        catalogLanguages.forEach(lang => {
            const name = langNames[lang] || lang;
            select.innerHTML += `<option value="${this.escapeHtml(lang)}">${this.escapeHtml(name)}</option>`;
        });

        // Restore selection if still valid
        if (catalogLanguages.includes(currentValue)) {
            select.value = currentValue;
        }
    }

    renderCatalogByArtist(container, catalogToRender = null) {
        const catalog = catalogToRender || this.catalog;
        const byArtist = {};
        catalog.forEach(song => {
            const artist = song.artist || 'Unknown Artist';
            if (!byArtist[artist]) byArtist[artist] = [];
            byArtist[artist].push(song);
        });

        const artists = Object.keys(byArtist).sort();

        const artistRows = artists.map(artist => `
            <div class="artist-section">
                <div class="artist-header" role="button" tabindex="0">
                    <div class="artist-avatar">${this.escapeHtml(artist.charAt(0).toUpperCase())}</div>
                    <div class="artist-name">${this.escapeHtml(artist)}</div>
                    <div class="artist-count">${byArtist[artist].length} ${t('songs')}</div>
                    <span class="material-icons-round">expand_more</span>
                </div>
                <div class="artist-songs hidden">
                    ${byArtist[artist].map(song => this.renderSongCard(song, true)).join('')}
                </div>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="artist-view-bar">
                <button class="btn-text-icon" id="artistToggleBtn" type="button">
                    <span class="material-icons-round">unfold_more</span>
                    <span id="artistToggleBtnLabel">Expand all</span>
                </button>
            </div>
            ${artistRows}
        `;

        // Handlers bound here instead of inline onclick attributes.
        container.querySelector('#artistToggleBtn').addEventListener('click', () => this.toggleAllArtists());
        container.querySelectorAll('.artist-header').forEach(header => {
            const toggle = () => {
                const songs = header.nextElementSibling;
                songs.classList.toggle('hidden');
                header.querySelector('.material-icons-round').textContent = songs.classList.contains('hidden') ? 'expand_more' : 'expand_less';
                this.updateArtistToggleBtn();
            };
            header.addEventListener('click', toggle);
            header.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
            });
        });
    }

    toggleAllArtists() {
        const songs = document.querySelectorAll('#catalogResults .artist-songs');
        const allExpanded = [...songs].every(el => !el.classList.contains('hidden'));
        songs.forEach(el => {
            const isHidden = allExpanded ? true : false;
            el.classList.toggle('hidden', isHidden);
            el.previousElementSibling.querySelector('.material-icons-round').textContent = isHidden ? 'expand_more' : 'expand_less';
        });
        this.updateArtistToggleBtn();
    }

    updateArtistToggleBtn() {
        const btn = document.getElementById('artistToggleBtn');
        const label = document.getElementById('artistToggleBtnLabel');
        if (!btn || !label) return;
        const songs = document.querySelectorAll('#catalogResults .artist-songs');
        const allExpanded = [...songs].every(el => !el.classList.contains('hidden'));
        btn.querySelector('.material-icons-round').textContent = allExpanded ? 'unfold_less' : 'unfold_more';
        label.textContent = allExpanded ? 'Collapse all' : 'Expand all';
    }

    // Video-type chips ('' for plain karaoke / unchecked songs); see videokind.js.
    videoKindChips(song) {
        return window.videoKindChips ? window.videoKindChips(song, currentLang) : '';
    }

    renderSongCard(song, showAdd = false) {
        return `
            <div class="song-card" data-song-id="${this.escapeHtml(song.id)}">
                <div class="song-info">
                    <div class="song-title">
                        ${song.code ? `<span class="song-code-inline">${this.escapeHtml(song.code)}</span>` : ''}
                        ${this.escapeHtml(song.title)}
                    </div>
                    <div class="song-artist">${this.escapeHtml(song.artist)}</div>
                    ${song.lyrics_start ? `<div class="song-lyrics"><span class="material-icons-round">lyrics</span>${this.escapeHtml(song.lyrics_start)}</div>` : ''}
                    <div class="song-meta">
                        ${this.videoKindChips(song)}
                        <span>${this.formatDuration(song.duration)}</span>
                        <span>${song.play_count || 0} ${t('plays')}</span>
                    </div>
                </div>
                <div class="song-actions">
                    ${showAdd ? `
                        <button class="btn-icon song-add-btn" type="button" title="${t('addToQueue')}" aria-label="${t('addToQueue')}">
                            <span class="material-icons-round">add</span>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    openSongDetail(songId) {
        const song = this.catalog.find(s => String(s.id) === String(songId));
        if (!song) return;

        const modal = document.getElementById('songDetailModal');
        if (!modal) return;

        const thumbWrap = modal.querySelector('#detailThumbWrap');
        // Online version: thumbnails come from YouTube (KRoom.thumb), not from the server.
        const thumbSrc = KRoom.thumb(song);
        const img = `<img src="${this.escapeHtml(thumbSrc)}" alt="" class="detail-thumb" onerror="this.closest('.detail-thumb-wrap').style.display='none'">`;
        if (song.youtube_url) {
            thumbWrap.innerHTML = `
                <a href="${this.escapeHtml(song.youtube_url)}" target="_blank" rel="noopener" class="yt-thumb-link">
                    ${img}
                    <div class="yt-thumb-overlay">
                        <div class="yt-thumb-overlay-pill">
                            <span class="material-icons-round">open_in_new</span>
                            ${t('seeOnYouTube')}
                        </div>
                    </div>
                </a>`;
        } else {
            thumbWrap.innerHTML = thumbSrc ? img : '';
        }
        thumbWrap.style.display = '';

        modal.querySelector('#detailTitle').textContent = song.title;
        modal.querySelector('#detailArtist').textContent = song.artist;
        modal.querySelector('#detailCode').textContent = song.code ? `#${song.code}` : '—';
        modal.querySelector('#detailLanguage').textContent = song.language || '—';
        modal.querySelector('#detailDuration').textContent = this.formatDuration(song.duration);
        modal.querySelector('#detailPlays').textContent = song.play_count || 0;
        modal.querySelector('#detailAdded').textContent = song.added_at
            ? new Date(song.added_at).toLocaleDateString()
            : '—';

        const vkEl = modal.querySelector('#detailVideoKind');
        if (vkEl) {
            const vkHtml = window.videoKindDetail ? window.videoKindDetail(song, currentLang) : '';
            vkEl.innerHTML = vkHtml;
            vkEl.style.display = vkHtml ? '' : 'none';
        }

        const lyricsEl = modal.querySelector('#detailLyrics');
        if (song.lyrics_start) {
            lyricsEl.innerHTML = `<span class="material-icons-round">lyrics</span>${this.escapeHtml(song.lyrics_start)}`;
            lyricsEl.style.display = '';
        } else {
            lyricsEl.style.display = 'none';
        }

        const addBtn = modal.querySelector('#detailAddToQueue');
        addBtn.onclick = () => { this.closeSongDetail(); this.addToQueue(song.id); };

        modal.classList.add('active');
    }

    closeSongDetail() {
        document.getElementById('songDetailModal')?.classList.remove('active');
    }

    // Utility: Remove accents from text for accent-insensitive search
    removeAccents(text) {
        return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    ngramTokens(str, n = 3) {
        const padded = ` ${str} `;
        const tokens = new Set();
        for (let i = 0; i <= padded.length - n; i++) {
            tokens.add(padded.slice(i, i + n));
        }
        return tokens;
    }

    songSearch(songs, query) {
        const q = this.removeAccents(query).toLowerCase();
        if (!q) return songs;
        const qGrams = this.ngramTokens(q);
        return songs
            .map(song => {
                const title = this.removeAccents(song.title || '').toLowerCase();
                const artist = this.removeAccents(song.artist || '').toLowerCase();
                const combined = title + ' ' + artist;
                let score = 0;
                if (title.includes(q) || artist.includes(q)) {
                    score = 2;
                } else if (qGrams.size > 0) {
                    const tGrams = this.ngramTokens(combined);
                    let matches = 0;
                    for (const g of qGrams) { if (tGrams.has(g)) matches++; }
                    score = matches / qGrams.size;
                }
                return { song, score };
            })
            .filter(({ score }) => score > 0.6)
            .sort((a, b) => b.score - a.score)
            .map(({ song }) => song);
    }

    filterCatalog(query, addOnCodeMatch = false) {
        const container = document.getElementById('catalogResults');
        query = query.trim();

        if (!query) {
            this.renderCatalog();
            return;
        }

        // Check if query is a numeric code (4+ digits)
        const code = parseInt(query);
        if (!isNaN(code) && code >= 1001 && query.match(/^\d+$/)) {
            // Search by code - find exact match first
            const exactMatch = this.catalog.find(song => song.code === code);
            if (exactMatch && addOnCodeMatch) {
                // Auto-add to queue only when Enter is pressed
                this.addToQueue(exactMatch.id);
                // Clear the search input
                document.getElementById('catalogSearch').value = '';
                this.renderCatalog();
                return;
            } else if (exactMatch) {
                // Show the exact match without auto-adding
                container.innerHTML = this.renderSongCard(exactMatch, true);
                return;
            }
            // Show partial matches (codes starting with these digits)
            const partialMatches = this.catalog.filter(song => 
                song.code && song.code.toString().startsWith(query)
            );
            if (partialMatches.length > 0) {
                container.innerHTML = partialMatches.map(song => this.renderSongCard(song, true)).join('');
                return;
            }
        }

        // N-gram search on title + artist
        const filtered = this.songSearch(this.catalog, query);

        if (filtered.length === 0) {
            container.innerHTML = `<div class="no-match-note">
                <span class="material-icons-round no-match-icon">search_off</span>
                <p class="no-match-title">${t('noSongsFound')}</p>
                <p class="no-match-hint">${t('notInCatalogTryDownload')}</p>
                <button class="btn-primary" type="button">
                    <span class="material-icons-round">search</span>
                    ${t('searchYouTubeInstead')}
                </button>
            </div>`;
            container.querySelector('button.btn-primary')
                .addEventListener('click', () => this.searchOnYouTube(query));
            return;
        }

        container.innerHTML = filtered.map(song => this.renderSongCard(song, true)).join('');
    }

    async syncMyDownloads(userName) {
        if (!userName || userName === 'Anonymous') return;
        try {
            const result = await this.api(`/catalog/my-downloads?user=${encodeURIComponent(userName)}`);
            if (result.success) {
                const ids = (result.data || []).map(s => s.id);
                this.myDownloadIds = new Set(ids);
                // Persist per-user so page reloads survive, but backend is authoritative
                localStorage.setItem(`karaoke_my_downloads_${userName}`, JSON.stringify(ids));
                this.renderCatalog();
            }
        } catch (e) {
            // Fallback to local cache if backend unreachable
            const cached = localStorage.getItem(`karaoke_my_downloads_${userName}`);
            if (cached) this.myDownloadIds = new Set(JSON.parse(cached));
        }
    }

    setFilter(chip) {
        const isActive = chip.classList.contains('active');
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        if (!isActive) chip.classList.add('active');
        this.renderCatalog();
    }

    // Guest queue reordering policy ("all" | "own_only"), set by the DJ.
    async loadGuestReorder() {
        try {
            const result = await this.api('/config');
            if (result.success && result.data) this.setGuestReorder(result.data.guest_reorder);
        } catch (error) {
            console.error('Failed to load config:', error);
        }
    }

    setGuestReorder(mode) {
        const next = mode === 'own_only' ? 'own_only' : 'all';
        if (next === this.guestReorder) return;
        this.guestReorder = next;
        this.renderRemoteQueue();
    }

    // "My songs": the guest's own pending songs, reorderable among themselves.
    renderMySongs() {
        const box = document.getElementById('mySongs');
        if (!box) return;
        const me = this.getUserName();
        const pending = this.queue ? this.queue.filter(item => item.status === 'pending') : [];
        const mine = pending.map((item, i) => ({ item, line: i + 1 }))
            .filter(e => me && e.item.user_name === me);
        if (mine.length < 2) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        box.hidden = false;
        box.innerHTML = `
            <h3 class="my-songs-title">${t('mySongs')}</h3>
            <p class="my-songs-hint">${t('mySongsHint')}</p>
            ${mine.map((e, i) => {
                const song = e.item.song || {};
                return `
                <div class="my-song-row" data-item-id="${this.escapeHtml(e.item.id)}">
                    <div class="queue-position">${i + 1}</div>
                    <div class="song-info">
                        <div class="song-title">${this.escapeHtml(song.title || 'Unknown')}</div>
                        <div class="queue-user vk-line"><span class="vk-line-text">${t('inLinePos').replace('{n}', e.line)}</span>${this.videoKindChips(song)}</div>
                    </div>
                    <div class="my-song-actions">
                        <button class="btn-icon-lg" data-dir="earlier" ${i === 0 || this.rearranging ? 'disabled' : ''} aria-label="${t('singEarlier')}" title="${t('singEarlier')}">
                            <span class="material-icons-round">arrow_upward</span>
                        </button>
                        <button class="btn-icon-lg" data-dir="later" ${i === mine.length - 1 || this.rearranging ? 'disabled' : ''} aria-label="${t('singLater')}" title="${t('singLater')}">
                            <span class="material-icons-round">arrow_downward</span>
                        </button>
                    </div>
                </div>`;
            }).join('')}`;
        if (!box.dataset.bound) {
            box.dataset.bound = '1';
            box.addEventListener('click', (ev) => {
                const btn = ev.target.closest('button[data-dir]');
                const row = ev.target.closest('.my-song-row');
                if (btn && row && !btn.disabled) this.rearrangeOwnSong(row.dataset.itemId, btn.dataset.dir);
            });
        }
    }

    async rearrangeOwnSong(itemId, direction) {
        if (this.rearranging || !this.validateUserName()) return;
        const me = this.getUserName();
        const prev = this.queue;
        // Optimistic: swap the item with the neighbouring song of mine in the local queue.
        const idx = this.queue.findIndex(i => i.id === itemId);
        const step = direction === 'earlier' ? -1 : 1;
        let j = idx + step;
        while (j >= 0 && j < this.queue.length &&
               !(this.queue[j].status === 'pending' && this.queue[j].user_name === me)) j += step;
        if (idx < 0 || j < 0 || j >= this.queue.length) return;
        const next = this.queue.slice();
        [next[idx], next[j]] = [next[j], next[idx]];
        this.queue = next;
        this.rearranging = true;
        this.renderQueue();
        try {
            const result = await this.api(`/queue/${encodeURIComponent(itemId)}/rearrange`, {
                method: 'POST',
                body: JSON.stringify({ direction, user_name: me, client_id: this.getClientId() })
            });
            if (result.success) {
                this.showToast(t('songsRearranged'), 'success');
            } else {
                this.queue = prev;
                this.showToast(t('failedToRearrange'), 'error');
            }
        } catch (error) {
            this.queue = prev;
            this.showToast(t('failedToRearrange'), 'error');
        } finally {
            this.rearranging = false;
            this.renderQueue();
        }
    }

    // Queue
    async loadQueue() {
        try {
            const result = await this.api('/queue');
            if (result.success) {
                this.queue = result.data.queue || [];
                this.nowPlaying = result.data.now_playing;
                this.isPlaying = result.data.is_playing || false;
                this.renderQueue();
                this.renderNowPlaying();
                this.updateQueueBadge();
                this.updatePlayPauseButton();
            }
        } catch (error) {
            console.error('Failed to load queue:', error);
        }
    }

    renderQueue() {
        const container = document.getElementById('queueList');
        this.renderMySongs();

        // Filter out playing item for mobile view as it's shown in the top bar
        const displayQueue = this.queue ? this.queue.filter(item => item.status === 'pending') : [];

        if (displayQueue.length === 0 && !(!this.nowPlaying && this.queue && this.queue.length > 0)) {
            container.innerHTML = `<div class="empty-state">
                <span class="material-icons-round">queue_music</span>
                <p>${t('emptyQueue')}</p>
                <small>${t('emptyQueueHint')}</small>
            </div>`;
            return;
        }

        // Show start playing button if queue has items but nothing is playing
        let startPlayingBtn = '';
        if (!this.nowPlaying && this.queue && this.queue.length > 0) {
            startPlayingBtn = `
                <div class="start-playing-container">
                    <button class="btn-start-playing" type="button">
                        <span class="material-icons-round">play_circle</span>
                        ${t('startPlaying')}
                    </button>
                </div>
            `;
        }

        container.innerHTML = startPlayingBtn + displayQueue.map((item, index) => {
            const song = item.song || {};
            return `
                <div class="queue-item" data-item-id="${this.escapeHtml(item.id)}">
                    <div class="queue-position">${index + 1}</div>
                    <div class="song-thumbnail">
                        ${KRoom.thumb(song) ? `<img src="${this.escapeHtml(KRoom.thumb(song))}" alt="" loading="lazy">` : ''}
                    </div>
                    <div class="song-info">
                        <div class="song-title">${this.escapeHtml(song.title || 'Unknown')}</div>
                        <div class="song-artist">
                            ${song.code ? `<span class="song-code-inline">${this.escapeHtml(song.code)}</span>` : ''}${this.escapeHtml(song.artist || 'Unknown')}
                        </div>
                        <div class="queue-user vk-line"><span class="vk-line-text">${t('addedBy')} ${this.escapeHtml(item.user_name)}</span>${this.videoKindChips(song)}</div>
                    </div>
                </div>
            `;
        }).join('');
        container.querySelector('.btn-start-playing')?.addEventListener('click', () => this.startPlaying());
    }

    renderNowPlaying() {
        const thumbnail = document.getElementById('npThumbnail');
        const title = document.getElementById('npTitle');
        const artist = document.getElementById('npArtist');
        const user = document.getElementById('npUser');

        if (this.nowPlaying && this.nowPlaying.song) {
            const song = this.nowPlaying.song;
            thumbnail.src = KRoom.thumb(song); // online version: YouTube thumbnail
            title.textContent = song.title || 'Unknown';
            artist.textContent = song.artist || 'Unknown';
            user.textContent = `${t('requestedBy')} ${this.nowPlaying.user_name}`;
        } else {
            thumbnail.src = '';
            title.textContent = t('waitingForSongs');
            artist.textContent = t('waitingForSongsHint');
            user.textContent = '';
        }
    }

    updateQueueBadge() {
        const badge = document.getElementById('queueBadge');
        const count = this.queue ? this.queue.filter(item => item.status === 'pending').length : 0;
        badge.textContent = count;
        badge.dataset.count = count;
    }

    async addToQueue(songId) {
        if (!this.validateUserName()) return;
        
        try {
            const result = await this.api('/queue', {
                method: 'POST',
                body: JSON.stringify({
                    song_id: songId,
                    user_name: this.getUserName()
                })
            });

            if (result.success) {
                this.showToast(t('songAddedToQueue'), 'success');
            } else {
                this.showToast(result.error || t('failedToAddSong'), 'error');
            }
        } catch (error) {
            this.showToast(t('failedToAddSong'), 'error');
        }
    }

    async removeFromQueue(itemId) {
        if (!this.validateUserName()) return;
        
        try {
            const result = await this.api(`/queue/${itemId}`, {
                method: 'DELETE',
                body: JSON.stringify({ user_name: this.getUserName(), client_id: this.getClientId() })
            });
            if (result && !result.success) {
                // not_owner: when the DJ set a PIN, guests may only remove their own songs
                const code = result.data && result.data.code;
                this.showToast(code === 'not_owner' ? t('cannotRemoveOthersSong') : t('failedToRemoveSong'), 'error');
            }
        } catch (error) {
            this.showToast(t('failedToRemoveSong'), 'error');
        }
    }

    confirmRemoveFromQueue(itemId, songTitle) {
        if (!this.validateUserName()) return;
        this.showConfirmModal(
            t('removeSong'),
            t('confirmRemoveSong').replace('{title}', songTitle),
            () => this.removeFromQueue(itemId)
        );
    }

    async skipSong() {
        if (!this.validateUserName()) return;
        
        try {
            await this.api('/queue/skip', { 
                method: 'POST',
                body: JSON.stringify({ user_name: this.getUserName() })
            });
        } catch (error) {
            this.showToast(t('failedToSkipSong'), 'error');
        }
    }

    async restartSong() {
        try {
            await this.api('/queue/restart', { method: 'POST' });
        } catch (error) {
            this.showToast(t('failedToRestartSong'), 'error');
        }
    }

    confirmSkipSong() {
        if (!this.validateUserName()) return;
        const songTitle = this.nowPlaying?.song?.title || t('currentSong');
        this.showConfirmModal(
            t('skipSong'),
            t('confirmSkipSong').replace('{title}', songTitle),
            () => {
                this.skipSong();
                this.closeRemoteModal();
            }
        );
    }

    async playPause() {
        console.log('playPause called, isPlaying:', this.isPlaying, 'nowPlaying:', this.nowPlaying);
        try {
            if (this.isPlaying) {
                // Pause
                console.log('Sending pause request...');
                const result = await this.api('/queue/pause', { method: 'POST' });
                console.log('Pause result:', result);
                this.isPlaying = false;
            } else {
                // Play or resume
                if (this.nowPlaying) {
                    console.log('Sending resume request...');
                    const result = await this.api('/queue/resume', { method: 'POST' });
                    console.log('Resume result:', result);
                    this.isPlaying = true;
                } else {
                    console.log('Sending play request...');
                    const result = await this.api('/queue/play', { method: 'POST' });
                    console.log('Play result:', result);
                    if (result.success && result.data) {
                        this.isPlaying = true;
                    } else {
                        this.showToast(t('queueIsEmpty'), 'warning');
                        return;
                    }
                }
            }
            this.updatePlayPauseButton();
            this.updateRemotePauseButton();
        } catch (error) {
            console.error('playPause error:', error);
            this.showToast(t('failedToControlPlayback'), 'error');
        }
    }

    updatePlayPauseButton() {
        const btn = document.getElementById('btnPlayPause');
        if (btn) {
            const icon = btn.querySelector('.material-icons-round');
            if (icon) {
                icon.textContent = this.isPlaying ? 'pause' : 'play_arrow';
            }
            if (this.isPlaying) {
                btn.classList.add('playing');
            } else {
                btn.classList.remove('playing');
            }
        }
    }

    async startPlaying() {
        console.log('startPlaying called');
        try {
            const result = await this.api('/queue/play', { method: 'POST' });
            console.log('startPlaying result:', result);
            
            if (result.success && result.data) {
                this.isPlaying = true;
                this.updatePlayPauseButton();
                this.showToast(t('playbackStarted'), 'success');
            } else {
                this.showToast(t('queueIsEmpty'), 'warning');
            }
        } catch (error) {
            console.error('startPlaying error:', error);
            this.showToast(t('failedToStartPlayback'), 'error');
        }
    }

    async clearQueue() {
        if (!this.validateUserName()) return;
        
        try {
            const result = await this.api('/queue', {
                method: 'DELETE',
                body: JSON.stringify({ user_name: this.getUserName() })
            });
            if (result && !result.success) {
                // Clearing the whole queue is a DJ action once a DJ PIN is set
                const code = result.data && result.data.code;
                this.showToast(code && code.startsWith('admin_pin') ? t('onlyDjCanDoThis') : t('failedToClearQueue'), 'error');
                return;
            }
            this.showToast(t('queueCleared'), 'info');
        } catch (error) {
            this.showToast(t('failedToClearQueue'), 'error');
        }
    }

    confirmClearQueue() {
        if (!this.validateUserName()) return;
        const count = this.queue ? this.queue.filter(item => item.status === 'pending').length : 0;
        this.showConfirmModal(
            t('clearQueue'),
            t('confirmClearQueue').replace('{count}', count),
            () => {
                this.clearQueue();
                this.closeRemoteModal();
            }
        );
    }

    // Remote Control Modal
    openRemoteModal() {
        if (!this.validateUserName()) return;
        this.renderRemoteQueue();
        this.updateRemotePauseButton();
        document.getElementById('remoteModal').classList.add('active');
    }

    closeRemoteModal() {
        document.getElementById('remoteModal').classList.remove('active');
    }

    updateRemotePauseButton() {
        const btn = document.getElementById('remotePauseResume');
        const icon = document.getElementById('remotePauseResumeIcon');
        const text = document.getElementById('remotePauseResumeText');
        
        if (btn && icon && text) {
            if (this.isPlaying) {
                icon.textContent = 'pause';
                text.textContent = t('pause');
            } else {
                icon.textContent = 'play_arrow';
                text.textContent = t('resume');
            }
        }
    }

    renderRemoteQueue() {
        const container = document.getElementById('remoteQueueList');
        if (!container) return;

        const pendingQueue = this.queue ? this.queue.filter(item => item.status === 'pending') : [];

        if (pendingQueue.length === 0) {
            container.innerHTML = `<div class="empty-state-small">
                <span class="material-icons-round">queue_music</span>
                <p>${t('emptyQueue')}</p>
            </div>`;
            return;
        }

        container.innerHTML = pendingQueue.map((item, index) => {
            const song = item.song || {};
            return `
                <div class="remote-queue-item" data-item-id="${this.escapeHtml(item.id)}">
                    <div class="remote-queue-position">${index + 1}</div>
                    <div class="remote-queue-info">
                        <div class="remote-queue-title">${this.escapeHtml(song.title || 'Unknown')}</div>
                        <div class="remote-queue-user vk-line"><span class="vk-line-text">${t('by')} ${this.escapeHtml(item.user_name)}</span>${this.videoKindChips(song)}</div>
                    </div>
                    <div class="remote-queue-actions">
                        ${this.guestReorder === 'own_only' ? '' : `                        <button class="btn-icon-sm remote-move-btn" type="button" data-item-id="${this.escapeHtml(item.id)}" data-position="${index - 1}" ${index === 0 ? 'disabled' : ''} title="${t('moveUp')}">
                            <span class="material-icons-round">arrow_upward</span>
                        </button>
                        <button class="btn-icon-sm remote-move-btn" type="button" data-item-id="${this.escapeHtml(item.id)}" data-position="${index + 1}" ${index === pendingQueue.length - 1 ? 'disabled' : ''} title="${t('moveDown')}">
                            <span class="material-icons-round">arrow_downward</span>
                        </button>`}
                        <button class="btn-icon-sm btn-danger-sm remote-remove-btn" data-item-id="${this.escapeHtml(item.id)}" data-title="${this.escapeHtml(song.title || 'Unknown')}" title="${t('remove')}">
                            <span class="material-icons-round">delete</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.remote-move-btn').forEach(btn => {
            btn.addEventListener('click', () =>
                this.moveInQueue(btn.dataset.itemId, parseInt(btn.dataset.position, 10)));
        });
        container.querySelectorAll('.remote-remove-btn').forEach(btn => {
            btn.addEventListener('click', () =>
                this.confirmRemoveFromQueue(btn.dataset.itemId, btn.dataset.title));
        });
    }

    async moveInQueue(itemId, newPosition) {
        if (!this.validateUserName()) return;
        if (newPosition < 0) return;
        
        // Find current item to determine direction
        const queue = this.queue.filter(item => item.status === 'pending');
        const currentIndex = queue.findIndex(item => item.id === itemId);
        const direction = newPosition < currentIndex ? 'up' : 'down';
        
        try {
            await this.api(`/queue/${itemId}/reorder`, {
                method: 'PUT',
                body: JSON.stringify({ 
                    position: newPosition,
                    user_name: this.getUserName(),
                    direction: direction
                })
            });
        } catch (error) {
            this.showToast(t('failedToReorderQueue'), 'error');
        }
    }

    // Confirmation Modal
    showConfirmModal(title, message, callback) {
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMessage').textContent = message;
        this.confirmCallback = callback;
        document.getElementById('confirmModal').classList.add('active');
    }

    closeConfirmModal() {
        document.getElementById('confirmModal').classList.remove('active');
        this.confirmCallback = null;
    }

    executeConfirm() {
        if (this.confirmCallback) {
            this.confirmCallback();
        }
        this.closeConfirmModal();
    }

    // Modal
    showModal(title, content, footer = '') {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalBody').innerHTML = content;
        document.getElementById('modalFooter').innerHTML = footer;
        document.getElementById('modal').classList.add('active');
    }

    closeModal() {
        document.getElementById('modal').classList.remove('active');
    }

    // Toast
    showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toasts');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="material-icons-round">${type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info'}</span>
            <span>${this.escapeHtml(message)}</span>
        `;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // Utilities
    escapeHtml(text) {
        return window.escapeHtml(text);
    }

    formatDuration(seconds) {
        if (!seconds) return '--:--';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Settings Modal Methods (mobile - language only)
    async openSettingsModal() {
        const modal = document.getElementById('settingsModal');
        if (!modal) return;

        const langSelect = document.getElementById('settingLanguage');
        if (langSelect) langSelect.value = currentLang;

        const nameInput = document.getElementById('settingName');
        if (nameInput) {
            nameInput.value = this.getUserName();
            nameInput.placeholder = this.getUserName();
        }

        document.getElementById('settingNameError').style.display = 'none';
        modal.classList.add('active');
    }

    closeSettingsModal() {
        const modal = document.getElementById('settingsModal');
        if (modal) {
            modal.classList.remove('active');
        }
    }

    async saveSettings() {
        const modal = document.getElementById('settingsModal');
        const saveBtn = modal.querySelector('.btn-primary');
        const newLang = document.getElementById('settingLanguage')?.value;
        const newName = document.getElementById('settingName')?.value?.trim();
        const currentName = this.getUserName();
        const errorDiv = document.getElementById('settingNameError');

        errorDiv.style.display = 'none';

        // Validate and save name if changed
        if (newName && newName !== currentName) {
            saveBtn.disabled = true;
            // With an existing session, transfer it (roster identity + queued
            // songs) to the new name rather than claiming a fresh user and
            // leaving the old name — and its songs — orphaned. A first-time name
            // (Anonymous) is just a normal claim.
            const hasSession = currentName && currentName !== 'Anonymous';
            const res = hasSession
                ? await this.renameName(currentName, newName)
                : await this.claimNameInteractive(newName);
            if (!res.ok) {
                const msg = res.status === 'active_conflict'
                    ? t('usernameInUse')
                    : (res.status === 'cancelled' ? t('chooseAnotherName') : t('error'));
                errorDiv.textContent = msg;
                errorDiv.style.display = 'block';
                this.showToast(msg, 'error');
                saveBtn.disabled = false;
                return;
            }
            localStorage.setItem('karaoke_username', newName);
            document.getElementById('userName').value = newName;
            this.confirmedResumeName = newName; // we now own this name; skip a WS re-prompt
            this.updateUserDisplay();
            this.registerUser(newName);
            this.syncMyDownloads(newName);
            saveBtn.disabled = false;
        }

        if (newLang && newLang !== currentLang) {
            setLanguage(newLang);
        }

        this.showToast(t('settingsSaved') || 'Settings saved!', 'success');
        this.closeSettingsModal();
    }

    // --- Online version: party code, invite modal, missing/ended party ---
    // (replaces the LAN connection modal: IPs, mDNS name and the Wi-Fi QR code)

    showRoomCode() {
        ['roomCodeBtn', 'welcomeRoomCode', 'shareRoomCode'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = KRoom.code;
        });
        document.title = `Karaoke · ${KRoom.code}`;
    }

    // Early check so a wrong or expired code shows the message right away.
    async checkRoom() {
        try {
            const res = await KRoom.fetch('/room');
            if (res.status === 404) {
                const data = await res.json().catch(() => null);
                if (!data || !data.data || data.data.code === 'room_not_found') this.showRoomGone('notFound');
            }
        } catch (e) { /* offline: the WebSocket keeps retrying */ }
    }

    // kind: 'notFound' (unknown/expired party) | 'ended' (the DJ ended it)
    showRoomGone(kind) {
        if (this.roomGone && document.getElementById('roomGone')?.hidden === false) return;
        this.roomGone = true;
        if (this.ws) { try { this.ws.close(); } catch (e) { /* ignore */ } }
        document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
        const box = document.getElementById('roomGone');
        if (!box) return;
        const ended = kind === 'ended';
        document.getElementById('roomGoneTitle').textContent = t(ended ? 'partyEnded' : 'roomNotFound');
        document.getElementById('roomGoneText').textContent = ended
            ? t('partyEndedDesc')
            : t('roomNotFoundDesc').replace('{code}', KRoom.code);
        document.getElementById('roomGoneLink').textContent = t('backToStart');
        box.hidden = false;
    }

    openShareModal() {
        const modal = document.getElementById('shareModal');
        if (!modal) return;
        const url = KRoom.joinUrl();
        document.getElementById('shareUrl').textContent = url;
        document.getElementById('btnNativeShare').hidden = !navigator.share;
        const qr = document.getElementById('shareQrcode');
        if (qr && typeof QRCode !== 'undefined' && qr.dataset.url !== url) {
            qr.innerHTML = '';
            new QRCode(qr, {
                text: url,
                width: 180,
                height: 180,
                colorDark: '#2b2520',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });
            qr.dataset.url = url;
        }
        modal.classList.add('active');
    }

    closeShareModal() {
        document.getElementById('shareModal')?.classList.remove('active');
    }

    async copyJoinLink() {
        const url = KRoom.joinUrl();
        try {
            await navigator.clipboard.writeText(url);
            this.showToast(t('linkCopied'), 'success');
        } catch (e) {
            // Clipboard API unavailable (e.g. not a secure context): select the text instead.
            const box = document.getElementById('shareUrl');
            const range = document.createRange();
            range.selectNodeContents(box);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
            this.showToast(t(ok ? 'linkCopied' : 'copyFailed'), ok ? 'success' : 'error');
        }
    }

    async nativeShare() {
        if (!navigator.share) return;
        try {
            await navigator.share({
                title: 'Karaoke',
                text: t('shareText').replace('{code}', KRoom.code),
                url: KRoom.joinUrl()
            });
        } catch (e) { /* cancelled */ }
    }
}

// Initialize app
const app = new KaraokeApp();
