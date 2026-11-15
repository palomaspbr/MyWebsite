// Shared HTML-escaping helper for all karaoke pages.
// Escapes quotes in addition to & < > so escaped values are also safe inside
// single- or double-quoted HTML attributes (e.g. data-* attributes), not just
// text nodes. Values must still never be interpolated into inline event
// handler strings — attribute values are HTML-decoded before the JS runs.
window.escapeHtml = function (text) {
    return String(text ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
};
