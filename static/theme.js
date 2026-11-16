// static/theme.js
// Light/dark theme: follows the device setting; a sun/moon toggle overrides it (remembered in this browser).
// Load it in <head> (not deferred) so the saved theme applies before the page paints.
//
//   <script src="/static/theme.js"></script>
//       Portfolio pages: key "theme", adds the round toggle in the top-right corner.
//   <script src="/static/theme.js" data-button="none"></script>
//       Same setting as the site (Chacrinha Jiu-Jitsu), but the page places its own toggle.
//   <script src="/static/theme.js" data-key="karaoke_theme" data-button="none"></script>
//       An app with its own, separate choice (Karaoke, Loaf Tower).
//
// The theme is written to <html data-theme="light|dark"> only when the user picked one;
// CSS uses `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) ... }`
// plus `:root[data-theme="dark"] ...`. Scripts use window.SiteTheme:
//   SiteTheme.isDark()         current state (choice, else device)
//   SiteTheme.toggle()         flip and remember
//   SiteTheme.onChange(fn)     fn(isDark) after a toggle or a device change
//   SiteTheme.icon(dark)       hand-drawn SVG for a toggle button (sun when dark, moon when light)
//   SiteTheme.label(dark)      matching aria-label in English

(function () {
    const script = document.currentScript;
    const KEY = (script && script.dataset.key) || 'theme';
    const AUTO_BUTTON = !(script && script.dataset.button === 'none');
    const root = document.documentElement;
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const listeners = [];

    function saved() {
        try { return localStorage.getItem(KEY); } catch (e) { return null; }
    }

    const choice = saved();
    if (choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);

    function isDark() {
        const theme = root.getAttribute('data-theme');
        return theme ? theme === 'dark' : darkQuery.matches;
    }

    function notify() {
        const dark = isDark();
        listeners.forEach(function (fn) { fn(dark); });
    }

    function set(theme) {
        root.setAttribute('data-theme', theme);
        try { localStorage.setItem(KEY, theme); } catch (e) { /* private mode: still switches for this page */ }
        notify();
    }

    // Hand-drawn icons, in the same wobbly ink style as the rest of the site.
    const SUN = '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<path d="M20 12.5c4.3-.2 7.6 3.1 7.5 7.4-.1 4.4-3.4 7.7-7.6 7.6-4.2-.1-7.5-3.5-7.4-7.7.1-4 3.3-7.2 7.5-7.3z" fill="#ffd43b" stroke="#2b2520"/>'
        + '<path d="M20 3.5v4.2M20 32.4v4.1M3.6 20.2h4.1M32.4 19.8h4.1M8.3 8.6l2.9 2.8M28.8 28.6l2.9 3M8.5 31.6l2.8-2.9M28.7 11.4l3-2.9"/></svg>';
    const MOON = '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<path d="M25.6 6.2c-7.8 1.6-11.6 9.8-8.4 16.6 2.6 5.5 8.6 8.4 14.6 6.8-2.9 4.4-8.6 6.7-14.1 5.2C10.5 33 6.2 26.3 7 19.6 7.9 11.6 15.8 4.6 25.6 6.2z" fill="#fff2a8"/>'
        + '<path d="M30.5 9.8v4.6M28.2 12.1h4.6M33.4 19.2v3M31.9 20.7h3"/></svg>';

    const SiteTheme = {
        key: KEY,
        isDark: isDark,
        set: set,
        toggle: function () { set(isDark() ? 'light' : 'dark'); },
        onChange: function (fn) { listeners.push(fn); },
        icon: function (dark) { return dark ? SUN : MOON; },
        label: function (dark) { return dark ? 'Switch to light mode' : 'Switch to dark mode'; },
    };
    window.SiteTheme = SiteTheme;

    // The device setting only matters while the user hasn't picked a theme.
    darkQuery.addEventListener('change', function () {
        if (!root.getAttribute('data-theme')) notify();
    });

    if (!AUTO_BUTTON) return;

    document.addEventListener('DOMContentLoaded', function () {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'icon-btn theme-toggle';
        function render(dark) {
            btn.innerHTML = SiteTheme.icon(dark);
            btn.setAttribute('aria-label', SiteTheme.label(dark));
            btn.title = SiteTheme.label(dark);
        }
        render(isDark());
        btn.addEventListener('click', SiteTheme.toggle);
        SiteTheme.onChange(render);
        document.body.appendChild(btn);
    });
})();
