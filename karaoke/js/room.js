/* Karaoke room helper (window.KRoom), loaded by every karaoke page before its own script.
   The original app talked to /api on its own LAN server; online, every party is a "room" with a
   4-letter code and the API lives under /karaoke/api/r/<CODE>. See C:\karaoke\ARCHITECTURE.md. */
(function () {
    'use strict';

    const CODE_RE = /^[A-HJ-NP-Z]{4}$/;
    const params = new URLSearchParams(location.search);
    const raw = (params.get('r') || '').trim().toUpperCase();
    const code = CODE_RE.test(raw) ? raw : '';

    function store(kind) {
        try { return kind === 'session' ? window.sessionStorage : window.localStorage; } catch (e) { return null; }
    }
    function read(kind, key) {
        try { const s = store(kind); return s ? s.getItem(key) : null; } catch (e) { return null; }
    }
    function write(kind, key, value) {
        try {
            const s = store(kind);
            if (!s) return;
            if (value === null || value === undefined || value === '') s.removeItem(key);
            else s.setItem(key, value);
        } catch (e) { /* private mode: keep going without storage */ }
    }

    const hostKeyName = 'karaoke_host_' + code;
    const pinName = 'karaoke_pin_' + code;
    const catalogKeyName = 'karaoke_catalog_key';

    const KRoom = {
        code,
        CODE_RE,

        require() {
            if (!code) {
                location.replace('/karaoke/?join=1');
                throw new Error('No room code');
            }
            return code;
        },

        api(path) {
            return '/karaoke/api/r/' + code + (path.startsWith('/') ? path : '/' + path);
        },

        headers(extra) {
            const h = new Headers(extra || {});
            const host = read('local', hostKeyName);
            if (host && !h.has('X-Host-Key')) h.set('X-Host-Key', host);
            const pin = read('session', pinName);
            if (pin && !h.has('X-Admin-Pin')) h.set('X-Admin-Pin', pin);
            const ck = read('local', catalogKeyName);
            if (ck && !h.has('X-Catalog-Key')) h.set('X-Catalog-Key', ck);
            return h;
        },

        fetch(path, opts) {
            const o = Object.assign({}, opts || {});
            o.headers = KRoom.headers(o.headers);
            if (o.body && typeof o.body === 'string' && !o.headers.has('Content-Type')) {
                o.headers.set('Content-Type', 'application/json');
            }
            return fetch(KRoom.api(path), o);
        },

        wsUrl() {
            const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
            return proto + '//' + location.host + KRoom.api('/ws');
        },

        joinUrl() {
            return location.origin + '/karaoke/sing/?r=' + code;
        },

        page(name) {
            return '/karaoke/' + name + '/?r=' + code;
        },

        thumb(song) {
            if (!song) return '';
            if (song.thumbnail_url) return song.thumbnail_url;
            return song.youtube_id ? 'https://i.ytimg.com/vi/' + song.youtube_id + '/hqdefault.jpg' : '';
        },

        isHost() { return !!read('local', hostKeyName); },
        setHostKey(c, key) { write('local', 'karaoke_host_' + c, key); },

        get pin() { return read('session', pinName) || ''; },
        setPin(pin) { write('session', pinName, pin); },

        get catalogKey() { return read('local', catalogKeyName) || ''; },
        setCatalogKey(k) { write('local', catalogKeyName, k); },

        // Create a party; remembers the host key and returns the code.
        async create() {
            const res = await fetch('/karaoke/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.success) throw new Error(json.error || 'Could not create the party');
            KRoom.setHostKey(json.data.code, json.data.host_key);
            return json.data.code;
        },

        // Does this room exist? (true / false; throws on network errors)
        async exists(c) {
            const res = await fetch('/karaoke/api/r/' + c + '/room');
            return res.ok;
        }
    };

    window.KRoom = KRoom;
})();
