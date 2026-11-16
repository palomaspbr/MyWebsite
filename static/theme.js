// static/theme.js
// Light/dark theme: follows the device setting; the sun/moon button overrides it
// (remembered in this browser). Loaded in <head> so the saved theme applies before the page paints.

(function () {
    const KEY = 'theme';
    const root = document.documentElement;
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function saved() {
        try { return localStorage.getItem(KEY); } catch (e) { return null; }
    }

    const choice = saved();
    if (choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);

    function isDark() {
        const theme = root.getAttribute('data-theme');
        return theme ? theme === 'dark' : darkQuery.matches;
    }

    // Hand-drawn icons, in the same wobbly ink style as the rest of the site.
    const SUN = '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<path d="M20 12.5c4.3-.2 7.6 3.1 7.5 7.4-.1 4.4-3.4 7.7-7.6 7.6-4.2-.1-7.5-3.5-7.4-7.7.1-4 3.3-7.2 7.5-7.3z" fill="#ffd43b" stroke="#2b2520"/>'
        + '<path d="M20 3.5v4.2M20 32.4v4.1M3.6 20.2h4.1M32.4 19.8h4.1M8.3 8.6l2.9 2.8M28.8 28.6l2.9 3M8.5 31.6l2.8-2.9M28.7 11.4l3-2.9"/></svg>';
    const MOON = '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<path d="M25.6 6.2c-7.8 1.6-11.6 9.8-8.4 16.6 2.6 5.5 8.6 8.4 14.6 6.8-2.9 4.4-8.6 6.7-14.1 5.2C10.5 33 6.2 26.3 7 19.6 7.9 11.6 15.8 4.6 25.6 6.2z" fill="#fff2a8"/>'
        + '<path d="M30.5 9.8v4.6M28.2 12.1h4.6M33.4 19.2v3M31.9 20.7h3"/></svg>';

    function render(btn) {
        const dark = isDark();
        btn.innerHTML = dark ? SUN : MOON;
        const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
        btn.setAttribute('aria-label', label);
        btn.title = label;
    }

    document.addEventListener('DOMContentLoaded', function () {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'icon-btn theme-toggle';
        render(btn);
        btn.addEventListener('click', function () {
            const next = isDark() ? 'light' : 'dark';
            root.setAttribute('data-theme', next);
            try { localStorage.setItem(KEY, next); } catch (e) { /* private mode: still switches for this page */ }
            render(btn);
        });
        darkQuery.addEventListener('change', function () { render(btn); });
        document.body.appendChild(btn);
    });
})();
