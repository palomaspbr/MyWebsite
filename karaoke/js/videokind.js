// Shared "video type" chips for every karaoke page (guest, DJ panel, kiosk).
// Plain karaoke and unchecked songs render nothing; a video with the original
// singer gets an amber "With vocals" chip, one without lyrics on screen a
// stronger red "No lyrics" chip (a music video gets both, No lyrics first).
// Styling lives in /karaoke/css/videokind.css. Information only: it never
// blocks or confirms anything.
(function () {
    var T = {
        en: {
            vocals: 'With vocals', noLyrics: 'No lyrics',
            vocalsTip: 'The original singer can be heard in this video',
            noLyricsTip: 'This video shows no lyrics on screen'
        },
        'pt-BR': {
            vocals: 'Com voz', noLyrics: 'Sem letra',
            vocalsTip: 'Dá para ouvir o cantor original neste vídeo',
            noLyricsTip: 'Este vídeo não mostra a letra na tela'
        },
        es: {
            vocals: 'Con voz', noLyrics: 'Sin letra',
            vocalsTip: 'Se oye al cantante original en este video',
            noLyricsTip: 'Este video no muestra la letra en pantalla'
        }
    };

    function esc(s) {
        return window.escapeHtml ? window.escapeHtml(s) : String(s);
    }

    function pick(lang) {
        var l = String(lang || '').toLowerCase();
        if (l.indexOf('pt') === 0) return T['pt-BR'];
        if (l.indexOf('es') === 0) return T.es;
        return T.en;
    }

    function flags(song) {
        var k = song && song.video_kind;
        return {
            vocals: k === 'lyric_video' || k === 'music_video',
            noLyrics: k === 'instrumental' || k === 'music_video'
        };
    }

    function chip(cls, icon, label, tip) {
        return '<span class="vk-chip ' + cls + '" role="img" title="' + esc(tip) +
            '" aria-label="' + esc(tip) + '"><span class="material-icons-round" aria-hidden="true">' +
            icon + '</span>' + esc(label) + '</span>';
    }

    // chips(song, lang) -> escaped HTML ('' when there is nothing to warn about).
    function videoKindChips(song, lang) {
        var f = flags(song), s = pick(lang), out = '';
        if (f.noLyrics) out += chip('vk-nolyrics', 'subtitles_off', s.noLyrics, s.noLyricsTip);
        if (f.vocals) out += chip('vk-vocals', 'record_voice_over', s.vocals, s.vocalsTip);
        return out ? '<span class="vk-chips">' + out + '</span>' : '';
    }

    // detail(song, lang) -> chips each followed by their sentence as visible text.
    function videoKindDetail(song, lang) {
        var f = flags(song), s = pick(lang), out = '';
        if (f.noLyrics) out += '<div class="vk-detail-row">' +
            chip('vk-nolyrics', 'subtitles_off', s.noLyrics, s.noLyricsTip) + '<span>' + esc(s.noLyricsTip) + '</span></div>';
        if (f.vocals) out += '<div class="vk-detail-row">' +
            chip('vk-vocals', 'record_voice_over', s.vocals, s.vocalsTip) + '<span>' + esc(s.vocalsTip) + '</span></div>';
        return out;
    }

    window.videoKindChips = videoKindChips;
    window.videoKindDetail = videoKindDetail;
})();
