/* karaoke/js/ytplayer.js
   A small wrapper around the YouTube IFrame Player API that looks like an HTML video element, so the
   player page (ported from the original app, which streamed local video files) keeps its logic:

     const v = new KYTPlayer(containerEl);
     v.load(videoId, { autoplay: true, start: 0 });
     v.play()            -> Promise (rejects with name 'NotAllowedError' when the browser blocks playback)
     v.pause(); v.stop();
     v.currentTime       (get / set -> seekTo)
     v.duration, v.paused, v.ended, v.volume (0..1), v.muted, v.videoId, v.error ({code}) , v.isReady
     v.addEventListener('play' | 'pause' | 'ended' | 'timeupdate' | 'error' | 'ready' | 'waiting', fn)

   'timeupdate' is polled ~4x per second while playing. 'error' events carry `event.code`, the YouTube
   error code (2 bad id, 5 HTML5 error, 100 removed/private, 101/150 embedding disabled by the owner). */
(function () {
    'use strict';

    const API_SRC = 'https://www.youtube.com/iframe_api';
    const HOST = 'https://www.youtube-nocookie.com';
    const POLL_MS = 250;
    const BLOCK_TIMEOUT_MS = 4000;     // no PLAYING/BUFFERING after play() -> assume the browser blocked it
    const BUFFER_TIMEOUT_MS = 20000;   // give a slow network this long before giving up on play()

    let apiPromise = null;

    // Load the IFrame API script once and resolve with window.YT when it is ready.
    function loadApi() {
        if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
        if (apiPromise) return apiPromise;
        apiPromise = new Promise((resolve, reject) => {
            const previous = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = function () {
                if (typeof previous === 'function') {
                    try { previous(); } catch (e) { console.error(e); }
                }
                resolve(window.YT);
            };
            if (!document.querySelector('script[src="' + API_SRC + '"]')) {
                const s = document.createElement('script');
                s.src = API_SRC;
                s.async = true;
                s.onerror = () => { apiPromise = null; reject(new Error('Could not load the YouTube player')); };
                document.head.appendChild(s);
            }
        });
        return apiPromise;
    }

    function blockedError() {
        const err = new Error('Playback was blocked by the browser');
        err.name = 'NotAllowedError';
        return err;
    }

    class KYTPlayer {
        constructor(container, options) {
            this.container = typeof container === 'string' ? document.getElementById(container) : container;
            this.options = options || {};
            this._listeners = {};
            this._player = null;
            this.isReady = false;
            this._videoId = '';
            this._paused = true;
            this._ended = false;
            this._endedFired = false;
            this._state = -1;
            this._startAt = 0;
            this._volume = 1;
            this._muted = false;
            this._pendingLoad = null;
            this._pendingPlay = false;
            this._pollTimer = null;
            this._waiters = [];
            this.error = null;

            const mount = document.createElement('div');
            mount.className = 'kyt-mount';
            this.container.appendChild(mount);

            loadApi().then((YT) => this._create(YT, mount)).catch((e) => {
                console.error('[ytplayer]', e);
                this.error = { code: -1, message: e.message };
                this._emit('error', { code: -1, message: e.message });
            });
        }

        _create(YT, mount) {
            this._player = new YT.Player(mount, {
                host: HOST,
                width: '100%',
                height: '100%',
                playerVars: {
                    controls: 0,
                    rel: 0,
                    modestbranding: 1,
                    playsinline: 1,
                    iv_load_policy: 3,
                    disablekb: 1,
                    fs: 0,
                    autoplay: 0,
                    origin: location.origin
                },
                events: {
                    onReady: () => this._onReady(),
                    onStateChange: (e) => this._onState(e.data),
                    onError: (e) => this._onError(e.data)
                }
            });
            // The API normally grants autoplay to its iframe; make sure, since sound needs the
            // delegated user activation of this page.
            try {
                const iframe = this._player.getIframe && this._player.getIframe();
                if (iframe) {
                    const allow = iframe.getAttribute('allow') || '';
                    if (!/\bautoplay\b/.test(allow)) {
                        iframe.setAttribute('allow', (allow ? allow + '; ' : '') + 'autoplay; encrypted-media');
                        if (iframe.src) iframe.src = iframe.src;
                    }
                    iframe.setAttribute('tabindex', '-1');
                    iframe.setAttribute('title', 'YouTube video player');
                }
            } catch (e) { /* ignore */ }
        }

        _onReady() {
            this.isReady = true;
            try {
                this._player.setVolume(Math.round(this._volume * 100));
                if (this._muted) this._player.mute(); else this._player.unMute();
            } catch (e) { /* ignore */ }
            this._emit('ready', {});
            if (this._pendingLoad) {
                const p = this._pendingLoad;
                this._pendingLoad = null;
                this._doLoad(p.videoId, p.autoplay, p.start);
            }
            if (this._pendingPlay) {
                this._pendingPlay = false;
                this._kick();
            }
        }

        _onState(state) {
            this._state = state;
            switch (state) {
                case 1: // PLAYING
                    this._ended = false;
                    this._resolveWaiters(null);
                    if (this._paused) {
                        this._paused = false;
                        this._emit('play', {});
                    }
                    this._startPolling();
                    break;
                case 2: // PAUSED
                    this._stopPolling();
                    if (!this._paused) {
                        this._paused = true;
                        this._emit('pause', {});
                    }
                    break;
                case 0: // ENDED
                    this._stopPolling();
                    this._ended = true;
                    if (!this._paused) {
                        this._paused = true;
                    }
                    this._emit('timeupdate', {});
                    if (!this._endedFired) {
                        this._endedFired = true;
                        this._emit('ended', {});
                    }
                    break;
                case 3: // BUFFERING
                    this._emit('waiting', {});
                    break;
                default: // -1 unstarted, 5 cued
                    break;
            }
        }

        _onError(code) {
            this._stopPolling();
            this.error = { code: code };
            const err = new Error('YouTube error ' + code);
            err.name = 'YouTubeError';
            err.code = code;
            this._resolveWaiters(err);
            this._emit('error', { code: code });
        }

        _startPolling() {
            if (this._pollTimer) return;
            this._pollTimer = setInterval(() => this._emit('timeupdate', {}), POLL_MS);
        }

        _stopPolling() {
            if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
        }

        _resolveWaiters(err) {
            const waiters = this._waiters;
            this._waiters = [];
            waiters.forEach((w) => {
                clearTimeout(w.timer);
                if (err) w.reject(err); else w.resolve();
            });
        }

        _doLoad(videoId, autoplay, start) {
            const args = { videoId: videoId, startSeconds: start || 0 };
            if (autoplay) this._player.loadVideoById(args);
            else this._player.cueVideoById(args);
        }

        _kick() {
            if (!this.isReady || !this._videoId) return;
            try { this._player.playVideo(); } catch (e) { /* ignore */ }
        }

        // ---- video-element-like API ----------------------------------------------------------

        load(videoId, opts) {
            const o = opts || {};
            this._stopPolling();
            this._resolveWaiters(Object.assign(new Error('Replaced by another video'), { name: 'AbortError' }));
            const wasPlaying = !this._paused;
            this._videoId = videoId || '';
            this._ended = false;
            this._endedFired = false;
            this._startAt = o.start || 0;
            this.error = null;
            this._paused = true;
            if (wasPlaying) this._emit('pause', {});
            if (!this._videoId) { this.stop(); return; }
            if (!this.isReady) {
                this._pendingLoad = { videoId: this._videoId, autoplay: !!o.autoplay, start: this._startAt };
                return;
            }
            this._doLoad(this._videoId, !!o.autoplay, this._startAt);
        }

        play() {
            if (!this._videoId) return Promise.reject(Object.assign(new Error('No video loaded'), { name: 'NotSupportedError' }));
            if (this._state === 1 && !this._paused) return Promise.resolve();
            return new Promise((resolve, reject) => {
                const startedAt = Date.now();
                const waiter = { resolve: resolve, reject: reject, timer: null };
                const check = () => {
                    const elapsed = Date.now() - startedAt;
                    if (this._state === 3 && elapsed < BUFFER_TIMEOUT_MS) {
                        waiter.timer = setTimeout(check, 1000); // still buffering: keep waiting
                        return;
                    }
                    this._waiters = this._waiters.filter((w) => w !== waiter);
                    reject(blockedError());
                };
                waiter.timer = setTimeout(check, BLOCK_TIMEOUT_MS);
                this._waiters.push(waiter);
                if (this.isReady) this._kick();
                else this._pendingPlay = true;
            });
        }

        pause() {
            this._pendingPlay = false;
            if (this.isReady && this._videoId) {
                try { this._player.pauseVideo(); } catch (e) { /* ignore */ }
            }
            this._stopPolling();
            if (!this._paused) {
                this._paused = true;
                this._emit('pause', {});
            }
        }

        // Unload the current video (like video.src = '').
        stop() {
            this._pendingLoad = null;
            this._pendingPlay = false;
            this._stopPolling();
            this._resolveWaiters(Object.assign(new Error('Stopped'), { name: 'AbortError' }));
            this._videoId = '';
            this._ended = false;
            this._endedFired = false;
            if (this.isReady) {
                try { this._player.stopVideo(); } catch (e) { /* ignore */ }
            }
            if (!this._paused) {
                this._paused = true;
                this._emit('pause', {});
            }
        }

        get videoId() { return this._videoId; }
        get paused() { return this._paused; }
        get ended() { return this._ended; }

        get currentTime() {
            if (this.isReady && this._player.getCurrentTime) {
                const t = this._player.getCurrentTime();
                if (typeof t === 'number' && !isNaN(t)) return t;
            }
            return this._startAt || 0;
        }
        set currentTime(t) {
            const v = Math.max(0, Number(t) || 0);
            this._ended = false;
            this._endedFired = false;
            if (this.isReady && this._videoId) {
                try { this._player.seekTo(v, true); } catch (e) { /* ignore */ }
            } else if (this._pendingLoad) {
                this._pendingLoad.start = v;
            }
            this._startAt = v;
            this._emit('timeupdate', {});
        }

        get duration() {
            if (this.isReady && this._player.getDuration) {
                const d = this._player.getDuration();
                if (d > 0) return d;
            }
            return NaN;
        }

        get volume() { return this._volume; }
        set volume(v) {
            this._volume = Math.max(0, Math.min(1, Number(v) || 0));
            if (this.isReady) { try { this._player.setVolume(Math.round(this._volume * 100)); } catch (e) { /* ignore */ } }
            this._emit('volumechange', {});
        }

        get muted() { return this._muted; }
        set muted(m) {
            this._muted = !!m;
            if (this.isReady) { try { if (this._muted) this._player.mute(); else this._player.unMute(); } catch (e) { /* ignore */ } }
            this._emit('volumechange', {});
        }

        addEventListener(type, fn) {
            (this._listeners[type] = this._listeners[type] || []).push(fn);
        }

        removeEventListener(type, fn) {
            const list = this._listeners[type];
            if (list) this._listeners[type] = list.filter((f) => f !== fn);
        }

        _emit(type, detail) {
            const ev = Object.assign({ type: type, target: this }, detail || {});
            (this._listeners[type] || []).slice().forEach((fn) => {
                try { fn.call(this, ev); } catch (e) { console.error('[ytplayer] listener for', type, 'failed:', e); }
            });
        }
    }

    KYTPlayer.loadApi = loadApi;
    KYTPlayer.EMBED_ERRORS = { 2: 'bad_id', 5: 'html5', 100: 'removed', 101: 'embed_disabled', 150: 'embed_disabled' };
    window.KYTPlayer = KYTPlayer;
})();
