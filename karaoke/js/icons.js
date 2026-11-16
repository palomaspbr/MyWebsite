/* Hand-drawn icons for the karaoke pages (no icon fonts, no emojis).
   The pages keep the original markup <span class="material-icons-round">pause</span>; this script swaps
   every such element - also ones added or changed later by the page scripts - for a sketchy inline SVG
   (ink strokes in currentColor, marker fills, the site's "rough" wobble filter).
   The icon name stays inside as visually hidden text, so code that reads or sets el.textContent
   ('pause' / 'play_arrow') keeps working. Add new drawings to ICONS (24 x 24 box). */
(function () {
  'use strict';

  // Marker colours: y yellow, p pink, b blue, g green, v violet, w white paper, k ink (solid)
  const ICONS = {
    close: '<path d="M6 6.5 L17.6 17.8 M17.8 6.2 L6.3 17.6"/>',
    add: '<path d="M12.2 4.8 L11.8 19.3 M4.7 12.1 L19.3 11.8"/>',
    check: '<path d="M4.6 12.8 L9.6 17.6 L19.6 6.3"/>',
    check_circle: '<path class="g" d="M12 2.9 C17.4 2.7 21.3 6.8 21.1 12.2 C20.9 17.6 16.9 21.2 11.8 21.1 C6.6 21 2.8 17.2 2.9 11.9 C3 6.8 6.9 3.1 12 2.9 Z"/><path d="M7.4 12.4 L10.6 15.6 L16.8 8.6"/>',
    play_arrow: '<path class="y" d="M7.2 4.6 L19.2 12.1 L7 19.6 Z"/>',
    play_circle: '<path class="w" d="M12 2.9 C17.4 2.7 21.3 6.8 21.1 12.2 C20.9 17.6 16.9 21.2 11.8 21.1 C6.6 21 2.8 17.2 2.9 11.9 C3 6.8 6.9 3.1 12 2.9 Z"/><path class="y" d="M9.6 7.6 L16.4 12 L9.5 16.4 Z"/>',
    pause: '<path class="y" d="M6.4 5 L10.1 5.2 L9.9 19.1 L6.2 18.9 Z M14 5.1 L17.7 4.9 L17.9 19 L14.2 19.1 Z"/>',
    skip_next: '<path class="y" d="M5 5.2 L14.8 12 L5.1 18.9 Z"/><path d="M18.4 5 L18.7 19.1"/>',
    replay: '<path d="M5.2 12.8 C5.1 8.4 8.4 5 12.4 5 C16.4 5.1 19.3 8.3 19.1 12.4 C18.9 16.4 15.8 19.2 12 19.1 C9.9 19 8.2 18.2 7 16.8"/><path d="M2.6 10.2 L5.2 13.4 L8.1 10.6"/>',
    shuffle: '<path d="M3.6 7.2 C9 7 12.4 17 18.8 16.8 M3.8 16.9 C7.6 17 9.4 13.6 10.6 12 M13.8 9 C15.2 7.8 16.6 7.1 18.9 7.2"/><path d="M16.4 4.6 L19.4 7.2 L16.5 9.8 M16.3 14.2 L19.3 16.8 L16.4 19.4"/>',
    queue_music: '<path d="M3.6 6.2 L15.4 6 M3.7 11 L15.3 10.8 M3.6 15.8 L10.2 15.7"/><path d="M17.6 18.6 L17.8 8.4 L21 9.6"/><path class="v" d="M13.2 18.4 C13.3 16.8 15.4 16.2 16.9 16.9 C18 17.5 17.9 19.4 16.5 20 C15 20.6 13.2 19.9 13.2 18.4 Z"/>',
    playlist_remove: '<path d="M3.6 6.2 L15.4 6 M3.7 11 L15.3 10.8 M3.6 15.8 L10.2 15.7"/><path class="p" d="M14.2 14.3 L20.3 20.1 M20.2 14.2 L14.3 20.2"/>',
    playlist_add: '<path d="M3.6 6.2 L15.4 6 M3.7 11 L15.3 10.8 M3.6 15.8 L10.2 15.7"/><path d="M17.3 13 L17.1 21 M13.2 17 L21.1 16.9"/>',
    music_note: '<path d="M14.6 17.2 L14.8 4.4 L19.4 6.2"/><path class="v" d="M8.2 17.4 C8.3 15.2 11.3 14.4 13.4 15.4 C15 16.2 14.9 18.9 12.9 19.7 C10.8 20.5 8.2 19.5 8.2 17.4 Z"/>',
    library_music: '<path class="b" d="M3.4 3.6 L20.4 3.4 L20.6 20.4 L3.6 20.6 Z"/><path d="M13.2 15 L13.4 7 L16.6 8.2"/><path class="v" d="M8.4 15.2 C8.5 13.8 10.5 13.2 11.9 13.9 C13 14.5 12.9 16.3 11.6 16.8 C10.2 17.4 8.4 16.6 8.4 15.2 Z"/>',
    lyrics: '<path class="w" d="M4 4.4 L20.2 4.2 L20 15.8 L10.4 16 L6 20 L6.4 16 L4.2 16.1 Z"/><path d="M7.2 8.4 L16.8 8.2 M7.3 12 L13.6 11.9"/>',
    mic: '<path class="y" d="M12.1 2.8 C14.3 2.8 15.4 4.4 15.3 6.4 L15.2 11.4 C15.1 13.4 13.8 14.6 12 14.6 C10 14.6 8.8 13.3 8.9 11.3 L8.9 6.3 C8.9 4.3 10.1 2.8 12.1 2.8 Z"/><path d="M5.8 10.8 C5.9 15 8.6 17.6 12.1 17.6 C15.4 17.5 18.1 15 18.2 10.8 M12 17.8 L12.1 21.2 M8.4 21.3 L15.7 21.1"/>',
    headphones: '<path d="M4 15.4 L4.1 12 C4.2 7.1 7.6 3.9 12 3.9 C16.5 3.9 19.9 7.2 19.9 12 L20 15.4"/><path class="p" d="M3.8 13.6 L7.6 13.4 L7.8 20 L4 20.2 Z M16.4 13.5 L20.1 13.4 L20.2 20.1 L16.5 20 Z"/>',
    tv: '<path class="b" d="M2.8 5 L21.2 4.8 L21 16.8 L3 17 Z"/><path d="M8.2 20.6 L15.8 20.4 M12 17.2 L12.1 20.4"/><path class="y" d="M10 8.4 L14.6 10.9 L10 13.4 Z"/>',
    videocam_off: '<path class="b" d="M3 7 L15.2 6.8 L15.1 17.2 L3.1 17.1 Z"/><path d="M15.4 10.4 L20.8 7.4 L20.9 16.6 L15.4 13.6"/><path class="p" d="M3.2 3.6 L20.6 20.6"/>',
    smartphone: '<path class="w" d="M7.2 2.6 L16.8 2.4 C17.6 2.4 18 2.9 18 3.6 L18.1 20.3 C18.1 21 17.6 21.5 16.9 21.5 L7.2 21.6 C6.4 21.6 6 21.1 6 20.4 L5.9 3.7 C5.9 3 6.4 2.6 7.2 2.6 Z"/><path d="M10.6 18.6 L13.4 18.5"/>',
    search: '<path class="b" d="M10.2 3.6 C14 3.5 16.8 6.3 16.7 10.1 C16.6 13.8 13.8 16.6 10.1 16.6 C6.4 16.5 3.7 13.8 3.7 10.1 C3.7 6.4 6.5 3.7 10.2 3.6 Z"/><path d="M15 15.1 L20.6 20.6"/>',
    search_off: '<path class="b" d="M10.2 3.6 C14 3.5 16.8 6.3 16.7 10.1 C16.6 13.8 13.8 16.6 10.1 16.6 C6.4 16.5 3.7 13.8 3.7 10.1 C3.7 6.4 6.5 3.7 10.2 3.6 Z"/><path d="M15 15.1 L20.6 20.6 M7.6 7.6 L12.8 12.6 M12.7 7.5 L7.5 12.7"/>',
    youtube_searched_for: '<path class="b" d="M10.2 3.6 C14 3.5 16.8 6.3 16.7 10.1 C16.6 13.8 13.8 16.6 10.1 16.6 C6.4 16.5 3.7 13.8 3.7 10.1 C3.7 6.4 6.5 3.7 10.2 3.6 Z"/><path d="M15 15.1 L20.6 20.6"/><path class="p" d="M8.6 7.4 L12.6 10.1 L8.6 12.7 Z"/>',
    settings: '<path class="y" d="M10.4 2.8 L13.6 2.7 L14.2 5.4 L16.4 6.6 L18.9 5.5 L20.6 8.2 L18.6 10.2 L18.7 12.8 L20.8 14.6 L19.2 17.4 L16.6 16.6 L14.4 17.9 L13.8 20.8 L10.4 20.9 L9.8 18.1 L7.6 16.9 L5 17.8 L3.4 15.2 L5.4 13.2 L5.3 10.6 L3.3 8.8 L4.9 6 L7.5 6.8 L9.7 5.5 Z"/><path class="w" d="M12 9 C13.8 9 15 10.3 14.9 12 C14.8 13.7 13.6 14.8 11.9 14.8 C10.2 14.7 9 13.5 9.1 11.8 C9.2 10.1 10.4 9 12 9 Z"/>',
    tune: '<path d="M3.6 6.4 L20.4 6.2 M3.6 12.1 L20.4 11.9 M3.7 17.7 L20.4 17.6"/><path class="y" d="M14.2 4.2 L16.6 4.1 L16.7 8.5 L14.3 8.6 Z M6.4 9.9 L8.8 9.8 L8.9 14.2 L6.5 14.3 Z M11.6 15.5 L14 15.4 L14.1 19.8 L11.7 19.9 Z"/>',
    settings_remote: '<path class="w" d="M8.4 6.6 L15.6 6.4 L15.8 21.4 L8.6 21.5 Z"/><path class="p" d="M11.9 9 C12.8 9 13.4 9.6 13.4 10.5 C13.3 11.4 12.7 12 11.9 11.9 C11 11.9 10.4 11.3 10.5 10.4 C10.5 9.6 11.1 9 11.9 9 Z"/><path d="M8.6 3.6 C10.8 1.8 13.4 1.9 15.4 3.6 M10.4 15.4 L13.6 15.3 M10.4 18.2 L13.6 18.1"/>',
    power_settings_new: '<path d="M7.8 6.4 C5.4 7.8 4 10.2 4.1 13 C4.2 17.4 7.6 20.6 12 20.5 C16.4 20.4 19.8 17.2 19.8 12.9 C19.8 10.1 18.4 7.7 16.1 6.3"/><path class="p" d="M12.1 3 L11.9 11.6"/>',
    delete: '<path class="p" d="M5.6 7 L18.4 6.8 L17.2 20.4 L6.8 20.6 Z"/><path d="M3.8 6.8 L20.2 6.6 M9.2 6.6 L9.6 3.6 L14.4 3.5 L14.8 6.6 M10 10.2 L10.2 17 M14 10.1 L13.9 17"/>',
    edit: '<path class="y" d="M15.4 3.6 L20.4 8.4 L9 19.8 L3.6 20.4 L4.2 15 Z"/><path d="M13.2 5.8 L18.2 10.6 M4.4 15.2 L8.8 19.6"/>',
    lock: '<path class="y" d="M4.6 10.4 L19.4 10.2 L19.5 20.6 L4.7 20.7 Z"/><path d="M7.6 10.3 L7.6 7.4 C7.6 4.8 9.6 3.2 12 3.2 C14.4 3.2 16.4 4.8 16.4 7.4 L16.4 10.2 M12 14 L12.1 17.2"/>',
    lock_open: '<path class="g" d="M4.6 10.4 L19.4 10.2 L19.5 20.6 L4.7 20.7 Z"/><path d="M7.6 10.3 L7.6 7.4 C7.6 4.8 9.6 3.2 12 3.2 C14 3.2 15.6 4.2 16.2 6 M12 14 L12.1 17.2"/>',
    key: '<path class="y" d="M7.6 8.6 C10 8.5 11.8 10.3 11.7 12.6 C11.6 14.9 9.8 16.5 7.5 16.5 C5.2 16.4 3.6 14.6 3.7 12.4 C3.8 10.2 5.4 8.6 7.6 8.6 Z"/><path d="M11.6 12.4 L20.6 12.2 L20.7 15.6 M17.4 12.3 L17.5 14.8"/>',
    shield: '<path class="b" d="M12 2.8 L19.6 5.6 C19.8 12.6 17 18.4 12.1 21.2 C7.2 18.5 4.3 12.8 4.4 5.7 Z"/><path d="M8.6 11.8 L11.2 14.4 L15.6 9.2"/>',
    print: '<path class="w" d="M7 3.4 L17 3.3 L17.1 8.4 L7.1 8.5 Z"/><path class="b" d="M3.4 8.6 L20.6 8.4 L20.5 16.6 L3.5 16.7 Z"/><path class="w" d="M7 13.6 L17 13.5 L17.1 20.7 L7.1 20.8 Z"/><path d="M9.2 16.4 L14.8 16.3 M9.2 18.6 L13.2 18.5"/>',
    open_in_new: '<path d="M10.4 4.6 L4.4 4.7 L4.5 19.6 L19.4 19.5 L19.4 13.6"/><path d="M13.6 4 L20.2 3.9 L20.1 10.4 M20 4.1 L11 13"/>',
    exit_to_app: '<path d="M13.4 4.4 L4.4 4.5 L4.5 19.6 L13.4 19.5"/><path d="M9.4 12.1 L20.4 11.9 M16.8 8.2 L20.5 11.9 L16.9 15.8"/>',
    arrow_upward: '<path d="M12.1 20.2 L11.9 4.2 M5.6 10.4 L11.9 4 L18.4 10.3"/>',
    arrow_downward: '<path d="M11.9 3.8 L12.1 19.8 M5.6 13.6 L12.1 20 L18.4 13.7"/>',
    expand_more: '<path d="M5.4 9.2 L12.1 15.6 L18.6 9"/>',
    expand_less: '<path d="M5.4 14.8 L12 8.4 L18.6 15"/>',
    unfold_more: '<path d="M7 9.4 L12 4.6 L17.1 9.5 M7 14.6 L12.1 19.4 L17 14.5"/>',
    unfold_less: '<path d="M7 4.6 L12 9.4 L17.1 4.5 M7 19.4 L12.1 14.6 L17 19.5"/>',
    swap_vert: '<path d="M8 19.6 L8.2 4.6 M4.4 8.2 L8.2 4.4 L11.8 8.3 M16 4.4 L15.8 19.4 M12.2 15.8 L15.9 19.6 L19.6 15.7"/>',
    warning: '<path class="y" d="M12 3 L21.4 19.8 L2.6 20 Z"/><path d="M12 9.2 L12.1 14.2 M12 16.9 L12.1 17.3"/>',
    info: '<path class="b" d="M12 2.9 C17.4 2.7 21.3 6.8 21.1 12.2 C20.9 17.6 16.9 21.2 11.8 21.1 C6.6 21 2.8 17.2 2.9 11.9 C3 6.8 6.9 3.1 12 2.9 Z"/><path d="M12 10.8 L12.1 16.8 M12 7.3 L12.1 7.6"/>',
    block: '<path class="p" d="M12 2.9 C17.4 2.7 21.3 6.8 21.1 12.2 C20.9 17.6 16.9 21.2 11.8 21.1 C6.6 21 2.8 17.2 2.9 11.9 C3 6.8 6.9 3.1 12 2.9 Z"/><path d="M5.6 5.8 L18.4 18.4"/>',
    celebration: '<path class="y" d="M3.4 20.6 L8 8.6 L15.4 16 Z"/><path d="M12.6 7.4 C13.8 5.6 13.4 4 12.6 3 M15.6 9.6 C17.4 8.4 19 8.6 20.6 9.4 M14.4 4.6 L14.6 4.8 M19.2 5 L19.4 5.2 M18.8 13.6 L19 13.8"/><path class="p" d="M16.6 2.8 L17.6 4.2 L16.2 5 Z"/>',
    language: '<path class="b" d="M12 2.9 C17.4 2.7 21.3 6.8 21.1 12.2 C20.9 17.6 16.9 21.2 11.8 21.1 C6.6 21 2.8 17.2 2.9 11.9 C3 6.8 6.9 3.1 12 2.9 Z"/><path d="M3.2 12.1 L20.8 11.9 M12 3 C8.6 7.4 8.6 16.6 12.1 21 M12 3 C15.4 7.4 15.4 16.6 11.9 21"/>',
    volume_up: '<path class="y" d="M3.4 9.2 L7.4 9.1 L12.4 4.6 L12.6 19.4 L7.4 14.9 L3.5 14.8 Z"/><path d="M15.6 9 C16.8 10.6 16.8 13.4 15.6 15 M18.2 6.4 C20.6 9.4 20.6 14.6 18.2 17.6"/>',
    volume_down: '<path class="y" d="M5.4 9.2 L9.4 9.1 L14.4 4.6 L14.6 19.4 L9.4 14.9 L5.5 14.8 Z"/><path d="M17.6 9 C18.8 10.6 18.8 13.4 17.6 15"/>',
    qr_code_2: '<path class="w" d="M3.4 3.4 L10.2 3.3 L10.3 10.2 L3.5 10.3 Z M13.8 3.4 L20.6 3.3 L20.7 10.2 L13.9 10.3 Z M3.4 13.8 L10.2 13.7 L10.3 20.6 L3.5 20.7 Z"/><path class="k" d="M5.6 5.6 L8 5.5 L8.1 8 L5.7 8.1 Z M16 5.6 L18.4 5.5 L18.5 8 L16.1 8.1 Z M5.6 16 L8 15.9 L8.1 18.4 L5.7 18.5 Z"/><path d="M14 14 L14.2 14.2 M17.4 13.8 L20.4 13.9 M14 17.4 L16.8 17.6 L16.9 20.6 M20.2 16.8 L20.4 20.4 L19 20.5"/>',
    content_copy: '<path class="w" d="M8.4 7.6 L19.6 7.4 L19.8 20.6 L8.6 20.8 Z"/><path d="M15.4 4.6 L15.4 3.4 L4.4 3.6 L4.5 16.4 L5.8 16.4"/>',
    share: '<path d="M7.4 11 L16.4 6.4 M7.4 13.2 L16.4 17.8"/><path class="y" d="M17.6 3.2 C19.2 3.2 20.4 4.4 20.3 6 C20.2 7.6 19 8.7 17.5 8.6 C15.9 8.6 14.8 7.4 14.9 5.8 C14.9 4.3 16.1 3.2 17.6 3.2 Z M6.2 9.4 C7.8 9.4 9 10.6 8.9 12.2 C8.8 13.8 7.6 14.9 6.1 14.8 C4.5 14.8 3.4 13.6 3.5 12 C3.5 10.5 4.7 9.4 6.2 9.4 Z M17.6 15.4 C19.2 15.4 20.4 16.6 20.3 18.2 C20.2 19.8 19 20.9 17.5 20.8 C15.9 20.8 14.8 19.6 14.9 18 C14.9 16.5 16.1 15.4 17.6 15.4 Z"/>',
    groups: '<path class="p" d="M8.2 4.6 C10 4.6 11.2 5.9 11.1 7.6 C11 9.3 9.8 10.4 8.1 10.4 C6.4 10.3 5.3 9.1 5.4 7.4 C5.5 5.7 6.6 4.6 8.2 4.6 Z"/><path class="b" d="M16.2 6.2 C17.8 6.2 18.9 7.4 18.8 8.9 C18.7 10.4 17.6 11.4 16.1 11.4 C14.6 11.3 13.6 10.2 13.7 8.7 C13.8 7.2 14.8 6.2 16.2 6.2 Z"/><path d="M2.6 19.4 C2.8 15.6 5.2 13.2 8.2 13.2 C11.2 13.2 13.4 15.6 13.6 19.4 M13.4 14.6 C14.2 14 15.2 13.8 16.2 13.8 C19 13.8 21 16 21.2 19.2"/>',
    storefront: '<path class="p" d="M3 4 L21 3.8 L21.6 9 C21 10.6 19.6 11.2 18.4 11 C17.2 10.8 16.4 10 16.2 9 C15.8 10.4 14.4 11.2 12.1 11.1 C9.8 11 8.4 10.2 7.9 9 C7.6 10.2 6.6 11 5.4 11 C4 11 3 10.2 2.5 9 Z"/><path d="M4.4 11 L4.5 20.4 L19.6 20.3 L19.6 11 M9.6 20.4 L9.7 14.6 L14.4 14.5 L14.5 20.3"/>',
    tag: '<path d="M9.6 3.6 L7.6 20.4 M16.4 3.6 L14.4 20.4 M4.4 8.6 L20.4 8.4 M3.6 15.4 L19.6 15.2"/>',
    schedule: '<path class="w" d="M12 2.9 C17.4 2.7 21.3 6.8 21.1 12.2 C20.9 17.6 16.9 21.2 11.8 21.1 C6.6 21 2.8 17.2 2.9 11.9 C3 6.8 6.9 3.1 12 2.9 Z"/><path d="M12 6.6 L12.1 12.2 L15.8 14.6"/>',
    hourglass_empty: '<path class="w" d="M6.4 3.4 L17.6 3.3 C17.6 7.6 15.6 10.4 12.6 12 C15.6 13.6 17.6 16.4 17.6 20.6 L6.4 20.7 C6.4 16.4 8.4 13.6 11.4 12 C8.4 10.4 6.4 7.6 6.4 3.4 Z"/><path d="M4.6 3.3 L19.4 3.2 M4.6 20.7 L19.4 20.6"/>',
    calendar_today: '<path class="w" d="M3.6 5.4 L20.4 5.2 L20.5 20.4 L3.7 20.5 Z"/><path class="p" d="M3.6 5.4 L20.4 5.2 L20.4 9.6 L3.6 9.7 Z"/><path d="M8 3 L8.1 7 M16 2.9 L16.1 7"/>',
    save: '<path class="b" d="M3.6 3.6 L17 3.4 L20.5 6.8 L20.4 20.4 L3.7 20.5 Z"/><path class="w" d="M7 3.6 L16 3.5 L16 8.6 L7.1 8.7 Z M6.8 13 L17.2 12.9 L17.3 20.4 L6.9 20.4 Z"/>',
    cloud_off: '<path class="w" d="M6.6 18.6 C4.2 18.6 2.6 17 2.7 14.8 C2.8 12.8 4.4 11.4 6.4 11.4 C6.8 8 9.2 5.6 12.4 5.6 C15.6 5.7 17.8 8 18.2 11 C20.2 11.2 21.4 12.8 21.3 14.8 C21.2 17 19.6 18.5 17.4 18.5 Z"/><path class="p" d="M3.4 3.4 L20.6 20.6"/>',
    cloud_download: '<path class="w" d="M6.6 18.6 C4.2 18.6 2.6 17 2.7 14.8 C2.8 12.8 4.4 11.4 6.4 11.4 C6.8 8 9.2 5.6 12.4 5.6 C15.6 5.7 17.8 8 18.2 11 C20.2 11.2 21.4 12.8 21.3 14.8 C21.2 17 19.6 18.5 17.4 18.5 Z"/><path d="M12 9.6 L12.1 16.4 M9.2 13.8 L12.1 16.6 L14.9 13.7"/>',
    keyboard_return: '<path d="M19.4 5 L19.5 12.4 L5.2 12.6 M9 8.6 L5 12.6 L9.1 16.6"/>',
    menu: '<path d="M3.8 6.4 L20.2 6.2 M3.7 12.1 L20.3 11.9 M3.8 17.8 L20.2 17.6"/>',
    star: '<path class="y" d="M12 2.6 L14.8 8.6 L21.2 9.2 L16.4 13.6 L17.8 20.2 L12.1 16.8 L6.2 20.3 L7.6 13.7 L2.8 9.3 L9.2 8.6 Z"/>',
    person: '<path class="p" d="M12 3.4 C14.2 3.4 15.6 5 15.5 7.1 C15.4 9.2 13.9 10.6 11.9 10.6 C9.8 10.5 8.4 9 8.5 6.9 C8.6 4.8 10 3.4 12 3.4 Z"/><path d="M4.4 20.4 C4.6 15.8 7.8 13.2 12 13.2 C16.2 13.2 19.4 15.8 19.6 20.4"/>',
    timer: '<path class="w" d="M12 5.4 C16.4 5.3 19.6 8.6 19.5 13 C19.4 17.4 16.2 20.6 11.9 20.6 C7.6 20.5 4.4 17.3 4.5 12.9 C4.6 8.6 7.8 5.5 12 5.4 Z"/><path d="M9.4 2.6 L14.6 2.5 M12 9 L12.1 13.2 M17.8 6 L19.2 4.6"/>',
    download: '<path d="M12 3.6 L12.1 15 M7.4 10.6 L12.1 15.2 L16.7 10.5 M4.4 19.8 L19.6 19.6"/>',
    link: '<path d="M10.4 13.6 C11.6 15 13.6 15 15 13.6 L18.6 10 C20 8.6 20 6.4 18.6 5 C17.2 3.6 15 3.6 13.6 5 L12.4 6.2 M13.6 10.4 C12.4 9 10.4 9 9 10.4 L5.4 14 C4 15.4 4 17.6 5.4 19 C6.8 20.4 9 20.4 10.4 19 L11.6 17.8"/>',
    dot: '<path class="y" d="M12 6.4 C15.2 6.4 17.6 8.8 17.5 12 C17.4 15.2 15 17.6 11.9 17.5 C8.8 17.4 6.4 15 6.5 11.9 C6.6 8.8 9 6.4 12 6.4 Z"/>'
  };

  const ALIASES = {
    task_alt: 'check_circle', fact_check: 'check_circle', done: 'check', done_all: 'check',
    refresh: 'replay', restore_from_trash: 'replay', restore: 'replay', sync: 'replay', autorenew: 'replay',
    delete_outline: 'delete', delete_forever: 'delete', delete_sweep: 'delete', remove_circle: 'block',
    error: 'warning', error_outline: 'warning', warning_amber: 'warning', report: 'warning',
    library_add: 'playlist_add', add_circle: 'add', add_box: 'add', queue: 'playlist_add',
    mic_external_on: 'mic', mic_none: 'mic', keyboard_voice: 'mic', record_voice_over: 'mic',
    ondemand_video: 'tv', live_tv: 'tv', cast: 'tv', slideshow: 'tv',
    phone_android: 'smartphone', phone_iphone: 'smartphone',
    power_off: 'power_settings_new', logout: 'exit_to_app',
    close_fullscreen: 'close', clear: 'close', cancel: 'close',
    up: 'arrow_upward', down: 'arrow_downward', keyboard_arrow_up: 'expand_less', keyboard_arrow_down: 'expand_more',
    music_off: 'music_note', audiotrack: 'music_note', queue_play_next: 'queue_music', playlist_play: 'queue_music',
    format_list_numbered: 'queue_music', list: 'menu', people: 'groups', group: 'groups', account_circle: 'person',
    emoji_events: 'star', grade: 'star', military_tech: 'star', sports_score: 'star',
    help: 'info', help_outline: 'info', notifications: 'info', visibility: 'search',
    pin: 'tag', numbers: 'tag', translate: 'language', public: 'language', wifi: 'language',
    edit_note: 'edit', drive_file_rename_outline: 'edit', create: 'edit',
    file_download: 'download', get_app: 'download', picture_as_pdf: 'print', description: 'print',
    hourglass_top: 'hourglass_empty', pending: 'hourglass_empty', access_time: 'schedule', timer_off: 'timer',
    skip_previous: 'replay', fast_forward: 'skip_next', stop: 'pause', stop_circle: 'pause', pause_circle: 'pause',
    volume_mute: 'volume_down', volume_off: 'volume_down', speaker: 'volume_up',
    qr_code: 'qr_code_2', qr_code_scanner: 'qr_code_2', link_off: 'link', ios_share: 'share', send: 'share',
    party_mode: 'celebration', auto_awesome: 'celebration', local_offer: 'tag', lock_outline: 'lock',
    admin_panel_settings: 'shield', verified_user: 'shield', security: 'shield', vpn_key: 'key', password: 'key',
    store: 'storefront', home: 'storefront', settings_suggest: 'settings', build: 'settings', tune_rounded: 'tune',
    cloud_upload: 'cloud_download', block_flipped: 'block', do_not_disturb: 'block', sentiment_dissatisfied: 'warning',
    open_in_full: 'open_in_new', launch: 'open_in_new', exit: 'exit_to_app', arrow_back: 'keyboard_return',
    chevron_left: 'keyboard_return', chevron_right: 'skip_next', swap_horiz: 'swap_vert', drag_indicator: 'menu',
    library_books: 'library_music', album: 'library_music', subtitles: 'lyrics', notes: 'lyrics', chat: 'lyrics'
  };

  const STYLE = `
.material-icons-round { display: inline-flex; align-items: center; justify-content: center; width: 1em; height: 1em;
  font-size: 24px; line-height: 1; vertical-align: middle; flex: none; overflow: hidden; position: relative;
  font-family: inherit; font-style: normal; font-weight: normal; letter-spacing: normal; text-transform: none; }
.material-icons-round:not([data-icon]) { color: transparent !important; }
.material-icons-round > .k-icon { width: 100%; height: 100%; overflow: visible; display: block; }
.material-icons-round > .k-icon-name { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.k-icon path { fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.k-icon .y { fill: #ffd43b; } .k-icon .p { fill: #ffc9c9; } .k-icon .b { fill: #a5d8ff; }
.k-icon .g { fill: #b2f2bb; } .k-icon .v { fill: #d0bfff; } .k-icon .w { fill: var(--paper-2, #fffdf6); } .k-icon .k { fill: currentColor; }
.k-icon.k-plain .y, .k-icon.k-plain .p, .k-icon.k-plain .b, .k-icon.k-plain .g, .k-icon.k-plain .v, .k-icon.k-plain .w { fill: none; }
`;

  const FILTER = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">' +
    '<filter id="k-rough" x="-10%" y="-10%" width="120%" height="120%">' +
    '<feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="3" result="n"/>' +
    '<feDisplacementMap in="SourceGraphic" in2="n" scale="0.9" xChannelSelector="R" yChannelSelector="G"/>' +
    '</filter></svg>';

  const warned = new Set();
  function markup(name) {
    const key = ICONS[name] ? name : ALIASES[name];
    if (!key && !warned.has(name)) { warned.add(name); console.warn('[icons] no hand-drawn icon for "' + name + '"'); }
    // A small tilt per icon name makes rows of icons look drawn one by one.
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    const tilt = ((Math.abs(h) % 7) - 3) * 1.2;
    return '<svg class="k-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<g filter="url(#k-rough)" transform="rotate(' + tilt.toFixed(1) + ' 12 12)">' + ICONS[key || 'dot'] + '</g></svg>';
  }

  function render(el) {
    // The name is the element's own text (ignoring our hidden label, if the page didn't replace it).
    const label = el.querySelector(':scope > .k-icon-name');
    const svg = el.querySelector(':scope > .k-icon');
    let name;
    if (label && svg && el.childNodes.length === 2) name = label.textContent.trim();
    else name = el.textContent.trim();
    if (!name) return;
    if (el.dataset.icon === name && label && svg && el.childNodes.length === 2) return; // already drawn
    el.dataset.icon = name;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = markup(name) + '<span class="k-icon-name"></span>';
    el.lastChild.textContent = name;
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.classList && root.classList.contains('material-icons-round')) render(root);
    if (root.querySelectorAll) root.querySelectorAll('.material-icons-round').forEach(render);
  }

  function iconOf(node) {
    let n = node && (node.nodeType === 1 ? node : node.parentNode);
    while (n && n.nodeType === 1) {
      if (n.classList.contains('material-icons-round')) return n;
      if (n.classList.contains('k-icon')) n = n.parentNode; else return null;
    }
    return null;
  }

  const observer = new MutationObserver(records => {
    for (const r of records) {
      const host = iconOf(r.target);
      if (host) render(host);
      if (r.type === 'childList') r.addedNodes.forEach(scan);
    }
  });

  function start() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    (document.head || document.documentElement).appendChild(style);
    const holder = document.createElement('div');
    holder.innerHTML = FILTER;
    (document.body || document.documentElement).appendChild(holder.firstChild);
    scan(document.documentElement);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    renderThemeToggles();
  }

  // Dark mode toggles. /static/theme.js (loaded in <head>, key "theme" shared with the whole site) owns
  // the choice; here every <button data-theme-toggle> gets its hand-drawn sun/moon and flips the theme, and
  // every <input type="checkbox" data-theme-switch> shows / sets "dark". Pages with translations set
  // KIcons.themeLabel = (dark) => '...' and call KIcons.renderThemeToggles() when the language changes.
  const PAPER = { light: '#fbf6e9', dark: '#0d1117' };
  function renderThemeToggles() {
    const T = window.SiteTheme;
    if (!T) return;
    const dark = T.isDark();
    const text = (window.KIcons.themeLabel || T.label)(dark);
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      if (btn.dataset.themeIcon !== String(dark)) { btn.innerHTML = T.icon(dark); btn.dataset.themeIcon = String(dark); }
      btn.setAttribute('aria-label', text);
      btn.title = text;
    });
    document.querySelectorAll('input[data-theme-switch]').forEach(cb => { cb.checked = dark; });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? PAPER.dark : PAPER.light);
  }
  if (window.SiteTheme) {
    window.SiteTheme.onChange(renderThemeToggles);
    document.addEventListener('click', ev => {
      const btn = ev.target.closest && ev.target.closest('[data-theme-toggle]');
      if (btn) window.SiteTheme.toggle();
    });
    document.addEventListener('change', ev => {
      const cb = ev.target;
      if (cb && cb.matches && cb.matches('input[data-theme-switch]') && cb.checked !== window.SiteTheme.isDark()) {
        window.SiteTheme.set(cb.checked ? 'dark' : 'light');
      }
    });
    // Another karaoke window of this browser switched (e.g. the player's gear menu while the jukebox is open).
    window.addEventListener('storage', ev => {
      const T = window.SiteTheme;
      if (ev.key === T.key && (ev.newValue === 'light' || ev.newValue === 'dark') &&
          ev.newValue !== document.documentElement.getAttribute('data-theme')) T.set(ev.newValue);
    });
  }

  window.KIcons = { svg: markup, render, names: () => Object.keys(ICONS).concat(Object.keys(ALIASES)),
    renderThemeToggles, themeLabel: null };
  if (document.readyState === 'loading') {
    // Draw icons as the parser inserts them, then finish once the DOM is complete.
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    document.addEventListener('DOMContentLoaded', () => { observer.disconnect(); start(); });
  } else {
    start();
  }
})();
