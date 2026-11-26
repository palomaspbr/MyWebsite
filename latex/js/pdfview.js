// PDF preview with pdf.js (PDFViewer component: lazy page rendering, selectable text, working links).
// Keeps the zoom and scroll position across recompiles, finds text (source -> PDF) and reports
// the text under a double-click (PDF -> source).
const BASE = new URL('../vendor/pdfjs/', import.meta.url).href;
let libPromise = null;

function loadLib() {
  if (!libPromise) {
    libPromise = (async () => {
      const lib = await import(BASE + 'pdf.min.mjs');
      globalThis.pdfjsLib = lib;
      lib.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.mjs';
      const viewer = await import(BASE + 'pdf_viewer.min.mjs');
      return { lib, viewer };
    })();
  }
  return libPromise;
}

export class PdfView {
  /**
   * @param container  scrollable element, position:absolute (pdf.js requirement)
   * @param on {page(n,total), scale(s), reverse(text, context), ready()}
   */
  constructor(container, on = {}) {
    this.container = container;
    this.on = on;
    this.doc = null;
    this.loadingTask = null;
    this.scaleValue = 'page-width';
    this.ready = this.init();
  }

  async init() {
    const { lib, viewer: V } = await loadLib();
    this.lib = lib; this.V = V;
    const inner = document.createElement('div');
    inner.className = 'pdfViewer';
    this.container.appendChild(inner);
    this.eventBus = new V.EventBus();
    this.linkService = new V.PDFLinkService({ eventBus: this.eventBus, externalLinkTarget: V.LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' });
    this.findController = new V.PDFFindController({ eventBus: this.eventBus, linkService: this.linkService });
    this.viewer = new V.PDFViewer({
      container: this.container,
      viewer: inner,
      eventBus: this.eventBus,
      linkService: this.linkService,
      findController: this.findController,
      textLayerMode: 1,
      annotationMode: lib.AnnotationMode.ENABLE,
      removePageBorders: true,
      enableHWA: false,
    });
    this.linkService.setViewer(this.viewer);
    this.eventBus.on('pagechanging', (e) => this.on.page && this.on.page(e.pageNumber, this.viewer.pagesCount));
    this.eventBus.on('scalechanging', (e) => this.on.scale && this.on.scale(e.scale, e.presetValue));
    this.eventBus.on('updatefindcontrolstate', (e) => {
      if (this.pendingFind && e.state !== V.FindState.PENDING) {
        const found = e.state === V.FindState.FOUND || e.state === V.FindState.WRAPPED;
        const cb = this.pendingFind; this.pendingFind = null;
        cb(found);
      }
    });
    this.container.addEventListener('dblclick', (e) => this.onDblClick(e));
    // Ctrl + wheel zooms the PDF instead of the page.
    this.container.addEventListener('wheel', (e) => {
      if (!e.ctrlKey || !this.doc) return;
      e.preventDefault();
      const s = this.viewer.currentScale * (e.deltaY < 0 ? 1.1 : 1 / 1.1);
      this.setScale(Math.min(5, Math.max(0.25, s)));
    }, { passive: false });
    new ResizeObserver(() => {
      if (this.doc && typeof this.scaleValue === 'string') this.viewer.currentScaleValue = this.scaleValue;
    }).observe(this.container);
  }

  /** Show a PDF (Blob or Uint8Array), keeping zoom and position. */
  async load(pdf) {
    await this.ready;
    const data = pdf instanceof Blob ? new Uint8Array(await pdf.arrayBuffer()) : pdf;
    const keep = this.doc ? this.position() : null;
    const oldTask = this.loadingTask;
    this.loadingTask = this.lib.getDocument({
      data,
      standardFontDataUrl: BASE + 'standard_fonts/',
      wasmUrl: BASE + 'wasm/',
      isEvalSupported: false,
      enableXfa: false,
    });
    const doc = await this.loadingTask.promise;
    this.doc = doc;
    await new Promise((resolve) => {
      const onInit = () => { this.eventBus.off('pagesinit', onInit); resolve(); };
      this.eventBus.on('pagesinit', onInit);
      this.viewer.setDocument(doc);
      this.linkService.setDocument(doc, null);
    });
    this.viewer.currentScaleValue = this.scaleValue;
    if (keep) this.restore(keep);
    // Free the previous document only now, so the old pages stay visible while the new one loads.
    if (oldTask) oldTask.destroy().catch(() => {});
    this.on.page && this.on.page(this.viewer.currentPageNumber, this.viewer.pagesCount);
    this.on.scale && this.on.scale(this.viewer.currentScale, typeof this.scaleValue === 'string' ? this.scaleValue : null);
  }

  clear() {
    if (!this.viewer) return;
    this.viewer.setDocument(null);
    this.linkService.setDocument(null);
    if (this.loadingTask) this.loadingTask.destroy().catch(() => {});
    this.loadingTask = null;
    this.doc = null;
  }

  position() {
    const c = this.container;
    return { top: c.scrollTop / Math.max(1, c.scrollHeight), left: c.scrollLeft };
  }
  restore(p) {
    const c = this.container;
    requestAnimationFrame(() => { c.scrollTop = p.top * c.scrollHeight; c.scrollLeft = p.left; });
  }

  setScale(v) {
    if (!this.viewer || !this.doc) { this.scaleValue = v; return; }
    this.scaleValue = v;
    if (typeof v === 'string') this.viewer.currentScaleValue = v;
    else this.viewer.currentScale = v;
  }
  zoom(dir) {
    if (!this.doc) return;
    const s = this.viewer.currentScale;
    const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
    const next = dir > 0 ? steps.find((x) => x > s + 0.01) || 5 : [...steps].reverse().find((x) => x < s - 0.01) || 0.25;
    this.setScale(next);
  }
  goToPage(n) { if (this.doc) this.viewer.currentPageNumber = Math.max(1, Math.min(n, this.viewer.pagesCount)); }
  get pages() { return this.viewer ? this.viewer.pagesCount : 0; }

  /** Find a phrase in the PDF, scroll to it and highlight it. Resolves true when found. */
  find(query) {
    if (!this.doc || !query) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.pendingFind = resolve;
      this.eventBus.dispatch('find', {
        source: this, type: '', query, caseSensitive: false, entireWord: false,
        highlightAll: false, findPrevious: false, matchDiacritics: false,
      });
      setTimeout(() => { if (this.pendingFind === resolve) { this.pendingFind = null; resolve(false); } }, 4000);
    });
  }
  clearFind() {
    if (this.eventBus) this.eventBus.dispatch('findbarclose', { source: this });
  }

  onDblClick(e) {
    const span = e.target.closest && e.target.closest('.textLayer span, .textLayer');
    if (!span || !this.on.reverse) return;
    // The text layer splits the page into runs; send the run plus its neighbours for context.
    const el = e.target.closest('.textLayer span') || span;
    const text = (el.textContent || '').trim();
    const prev = el.previousElementSibling ? el.previousElementSibling.textContent : '';
    const next = el.nextElementSibling ? el.nextElementSibling.textContent : '';
    const sel = String(window.getSelection() || '').trim();
    this.on.reverse(text, { word: sel, prev, next });
  }
}
