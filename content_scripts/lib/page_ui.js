(function (root, factory) {
  'use strict';

  const api = root.CindraPageUi || factory();
  root.CindraPageUi = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_SHOW_DELAY_MS = 120;
  const DEFAULT_MAX_HIGHLIGHT_RECTS = 200;
  const COMPOSER_WIDTH_PX = 360;
  const VIEWPORT_GUTTER_PX = 12;

  const COMPOSER_STYLES = `
    :host {
      --cindra-bg: #1b1917;
      --cindra-bg-subtle: #231f1c;
      --cindra-border: #34302c;
      --cindra-border-hover: rgba(255, 238, 222, 0.2);
      --cindra-text: #f3eee9;
      --cindra-text-muted: #9d948c;
      --cindra-input-bg: #231f1c;
      --cindra-ember: #ff5b1f;
      --cindra-flare: #ffae3d;
      --cindra-divider: rgba(255, 238, 222, 0.07);
      all: initial;
      position: fixed;
      z-index: 2147483647;
      width: min(360px, calc(100vw - 24px));
      color-scheme: light dark;
      font-family: 'Inter', 'Inter var', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      pointer-events: auto;
    }

    :host([hidden]) { display: none; }
    *, *::before, *::after { box-sizing: border-box; }

    .cindra-composer {
      overflow: hidden;
      border: 1px solid var(--cindra-border);
      border-radius: 12px;
      background: var(--cindra-bg);
      color: #d4ccc5;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
    }

    .cindra-composer[aria-busy='true'] { cursor: progress; }

    .cindra-composer__header,
    .cindra-composer__actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
    }

    .cindra-composer__header { border-bottom: 1px solid var(--cindra-divider); }
    .cindra-composer__heading { min-width: 0; }
    .cindra-composer__title { color: var(--cindra-text); font-size: 13px; font-weight: 600; letter-spacing: -0.005em; }
    .cindra-composer__meta { margin-top: 2px; color: var(--cindra-text-muted); font-size: 12px; line-height: 1.4; }
    .cindra-composer__body { padding: 12px; }

    .cindra-composer__question {
      width: 100%;
      min-height: 92px;
      resize: vertical;
      border: 1px solid var(--cindra-border);
      border-radius: 9px;
      outline: none;
      background: var(--cindra-input-bg);
      color: var(--cindra-text);
      padding: 10px;
      font: inherit;
      font-size: 13px;
      line-height: 1.5;
      letter-spacing: 0.2px;
    }

    .cindra-composer__question::placeholder { color: #6f6761; }
    .cindra-composer__question:focus-visible { border-color: var(--cindra-ember); box-shadow: 0 0 0 3px rgba(255, 91, 31, 0.16); }
    .cindra-composer__actions { border-top: 1px solid var(--cindra-divider); }

    .cindra-composer__button {
      min-height: 36px;
      border: 1px solid transparent;
      border-radius: 9px;
      padding: 0 14px;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: -0.005em;
      cursor: pointer;
    }

    .cindra-composer__button:focus-visible { outline: 2px solid var(--cindra-ember); outline-offset: 2px; }
    .cindra-composer__button:disabled { cursor: progress; opacity: 0.6; }
    .cindra-composer__button--close { width: 30px; height: 30px; min-height: 30px; border-color: var(--cindra-border); background: var(--cindra-bg-subtle); color: var(--cindra-text-muted); padding: 0; font-size: 18px; line-height: 1; }
    .cindra-composer__button--secondary { border-color: var(--cindra-border); background: transparent; color: var(--cindra-text); }
    .cindra-composer__button--primary { background: linear-gradient(100deg, var(--cindra-ember) 45%, var(--cindra-flare) 130%); color: #1c0c04; }
    .cindra-composer__button--close:hover,
    .cindra-composer__button--secondary:hover { border-color: var(--cindra-border-hover); color: var(--cindra-text); }
    .cindra-composer__button--secondary:hover { background: #2c2825; }
    .cindra-composer__button--primary:hover { background: linear-gradient(100deg, var(--cindra-ember), var(--cindra-flare) 95%); }
    .cindra-composer__status { min-height: 28px; padding: 0 12px 10px; color: var(--cindra-text-muted); font-size: 12px; line-height: 1.4; }
    .cindra-composer__status:empty { min-height: 0; padding: 0; }

    @media (prefers-color-scheme: light) {
      :host {
        --cindra-bg: #ffffff;
        --cindra-bg-subtle: #f2f0ed;
        --cindra-border: #e2ded9;
        --cindra-border-hover: rgba(40, 24, 10, 0.22);
        --cindra-text: #1c1814;
        --cindra-text-muted: #6d655e;
        --cindra-input-bg: #f2f0ed;
        --cindra-ember: #ec4d12;
        --cindra-flare: #f7a128;
        --cindra-divider: rgba(40, 24, 10, 0.07);
      }
      .cindra-composer { color: #3d3732; box-shadow: 0 18px 40px rgba(40, 24, 10, 0.14); }
      .cindra-composer__question::placeholder { color: #9c948c; }
      .cindra-composer__button--secondary:hover { background: #e9e6e2; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.001ms !important; animation-duration: 0.001ms !important; }
    }
  `;

  const HIGHLIGHT_STYLES = `
    :host { all: initial; position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; overflow: hidden; }
    .cindra-highlight { position: fixed; background: rgba(255, 122, 48, 0.26); border-radius: 2px; }
  `;

  const FLOATING_BUTTON_STYLES = `
    :host {
      all: initial;
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 2147483645;
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; }
    .cindra-launcher { position: relative; width: 48px; height: 48px; }
    .cindra-launcher__button {
      display: grid;
      width: 42px;
      height: 42px;
      place-items: center;
      border: 1px solid rgba(255, 238, 222, 0.12);
      border-radius: 50%;
      background: #1b1917;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
      cursor: pointer;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .cindra-launcher__button:hover,
    .cindra-launcher__button:focus-visible { transform: scale(1.08); box-shadow: 0 0 0 3px rgba(255, 91, 31, 0.28), 0 6px 18px rgba(0, 0, 0, 0.32); }
    .cindra-launcher__button:focus-visible,
    .cindra-launcher__close:focus-visible { outline: 2px solid #ff5b1f; outline-offset: 2px; }
    .cindra-launcher__icon { display: block; width: 24px; height: 24px; transform: translateY(-1px); }
    .cindra-launcher__close {
      position: absolute;
      top: -5px;
      right: 0;
      display: grid;
      width: 20px;
      height: 20px;
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: #1b1917;
      color: #f3eee9;
      cursor: pointer;
      font: 700 14px/1 system-ui, sans-serif;
      opacity: 0;
      transition: opacity 0.2s ease, background 0.2s ease;
    }
    .cindra-launcher:hover .cindra-launcher__close,
    .cindra-launcher:focus-within .cindra-launcher__close { opacity: 1; }
    .cindra-launcher__close:hover { background: #2c2825; }
    .cindra-launcher__tooltip {
      position: absolute;
      right: 6px;
      bottom: calc(100% + 8px);
      border-radius: 6px;
      background: #1b1917;
      color: #f3eee9;
      padding: 8px 12px;
      font-size: 12px;
      line-height: 1.2;
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .cindra-launcher:hover .cindra-launcher__tooltip,
    .cindra-launcher:focus-within .cindra-launcher__tooltip { opacity: 1; }
    @media (prefers-reduced-motion: reduce) {
      .cindra-launcher__button,
      .cindra-launcher__close,
      .cindra-launcher__tooltip { transition: none; }
    }
  `;

  function buildQuestionPrompt(question) {
    return [
      'Use only the selected text to answer the user question.',
      'If the selected text does not contain enough information, say what is missing.',
      '',
      `User question: ${question}`
    ].join('\n');
  }

  function getActivePrompt(settings, defaultPrompt) {
    const prompts = Array.isArray(settings?.savedPrompts) ? settings.savedPrompts : [];
    if (settings?.activePromptId && prompts.length) {
      const activePrompt = prompts.find(prompt => prompt.id === settings.activePromptId);
      if (typeof activePrompt?.text === 'string' && activePrompt.text.trim()) {
        return activePrompt.text;
      }
    }
    return defaultPrompt;
  }

  function isEditableTarget(target, nodeCtor = globalThis.Node) {
    const elementNode = nodeCtor?.ELEMENT_NODE || 1;
    const element = target?.nodeType === elementNode ? target : target?.parentElement;
    return Boolean(element?.closest?.(
      'textarea, input, select, [contenteditable="true"], [contenteditable=""]'
    ));
  }

  function safeFocus(element) {
    if (!element?.focus || element.isConnected === false) return;
    try {
      element.focus({ preventScroll: true });
    } catch (error) {
      element.focus();
    }
  }

  class SelectionComposer {
    constructor({
      window: windowLike,
      document: documentLike,
      onSubmit,
      resolveProviderName = async () => 'AI',
      isContextValid = () => true,
      showDelayMs = DEFAULT_SHOW_DELAY_MS,
      maxHighlightRects = DEFAULT_MAX_HIGHLIGHT_RECTS
    } = {}) {
      if (!windowLike || !documentLike || typeof onSubmit !== 'function') {
        throw new TypeError('SelectionComposer requires window, document, and onSubmit.');
      }

      this.window = windowLike;
      this.document = documentLike;
      this.onSubmit = onSubmit;
      this.resolveProviderName = resolveProviderName;
      this.isContextValid = isContextValid;
      this.showDelayMs = Math.max(0, Number(showDelayMs) || 0);
      this.maxHighlightRects = Math.max(1, Math.floor(Number(maxHighlightRects) || 1));
      this.host = null;
      this.highlightHost = null;
      this.range = null;
      this.selectedText = '';
      this.dismissedText = '';
      this.previousActiveElement = null;
      this.showToken = 0;
      this.showTimer = null;
      this.hideTimer = null;
      this.repositionFrame = null;
      this.started = false;
      this.destroyed = false;
      this.submitting = false;

      this.handleMouseUp = event => this.scheduleShow(event);
      this.handleKeyUp = event => this.onDocumentKeyUp(event);
      this.handleMouseDown = event => this.onDocumentMouseDown(event);
      this.handleViewportChange = () => this.scheduleReposition();
      this.handleShadowKeyDown = event => this.onShadowKeyDown(event);
    }

    start() {
      if (this.started || this.destroyed) return this;
      this.started = true;
      this.document.addEventListener('mouseup', this.handleMouseUp);
      this.document.addEventListener('keyup', this.handleKeyUp);
      this.document.addEventListener('mousedown', this.handleMouseDown, true);
      this.window.addEventListener('scroll', this.handleViewportChange, { passive: true });
      this.window.addEventListener('resize', this.handleViewportChange);
      return this;
    }

    destroy({ restoreFocus = false } = {}) {
      if (this.destroyed) return;
      this.destroyed = true;
      this.started = false;
      this.document.removeEventListener('mouseup', this.handleMouseUp);
      this.document.removeEventListener('keyup', this.handleKeyUp);
      this.document.removeEventListener('mousedown', this.handleMouseDown, true);
      this.window.removeEventListener('scroll', this.handleViewportChange);
      this.window.removeEventListener('resize', this.handleViewportChange);
      this.clearTimers();
      this.clearHighlight();
      this.host?.remove();
      this.host = null;
      this.range = null;
      if (restoreFocus) safeFocus(this.previousActiveElement);
      this.previousActiveElement = null;
    }

    clearTimers() {
      if (this.showTimer) this.window.clearTimeout(this.showTimer);
      if (this.hideTimer) this.window.clearTimeout(this.hideTimer);
      if (this.repositionFrame !== null) this.window.cancelAnimationFrame(this.repositionFrame);
      this.showTimer = null;
      this.hideTimer = null;
      this.repositionFrame = null;
    }

    isInside(event) {
      return Boolean(this.host && event?.composedPath?.().includes(this.host));
    }

    onDocumentKeyUp(event) {
      if (this.isInside(event)) return;
      if (event.key === 'Escape') {
        this.dismiss();
        return;
      }
      this.scheduleShow(event);
    }

    onDocumentMouseDown(event) {
      if (!this.isInside(event) && this.visible) this.dismiss();
    }

    scheduleShow(event) {
      if (this.destroyed || this.isInside(event)) return;
      if (this.showTimer) this.window.clearTimeout(this.showTimer);
      const target = event?.target || null;
      this.showTimer = this.window.setTimeout(() => {
        this.showTimer = null;
        this.maybeShow(target);
      }, this.showDelayMs);
    }

    maybeShow(target) {
      if (!this.isContextValid()) {
        this.destroy();
        return;
      }
      if (isEditableTarget(target, this.window.Node)) {
        this.hide({ restoreFocus: false, clearRange: true });
        return;
      }

      const selection = this.window.getSelection?.();
      const selectedText = selection?.toString().trim() || '';
      if (!selection || selection.rangeCount === 0 || selectedText.length < 3) {
        this.dismissedText = '';
        this.hide({ restoreFocus: false, clearRange: true });
        return;
      }
      if (selectedText === this.dismissedText) return;

      let range;
      let rect;
      try {
        range = selection.getRangeAt(0).cloneRange();
        rect = range.getBoundingClientRect();
      } catch (error) {
        this.hide({ restoreFocus: false, clearRange: true });
        return;
      }
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        this.hide({ restoreFocus: false, clearRange: true });
        return;
      }

      this.dismissedText = '';
      this.show(rect, selectedText, range);
    }

    ensureRendered() {
      if (this.host) return;

      const host = this.document.createElement('div');
      host.setAttribute('data-extension', 'cindra-summary');
      host.setAttribute('data-cindra-ui', 'selection-composer');
      host.hidden = true;
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>${COMPOSER_STYLES}</style>
        <section class="cindra-composer" id="dialog" role="dialog" aria-modal="true" aria-labelledby="title" aria-describedby="selection-meta status">
          <header class="cindra-composer__header">
            <div class="cindra-composer__heading">
              <div class="cindra-composer__title" id="title">Ask Cindra</div>
              <div class="cindra-composer__meta" id="selection-meta"></div>
            </div>
            <button class="cindra-composer__button cindra-composer__button--close" id="close" type="button" aria-label="Close selection composer">×</button>
          </header>
          <div class="cindra-composer__body">
            <textarea class="cindra-composer__question" id="question" aria-label="Question about selected text" placeholder="Ask a question about the selected text..."></textarea>
          </div>
          <div class="cindra-composer__actions">
            <button class="cindra-composer__button cindra-composer__button--secondary" id="summarize" type="button">Summarize</button>
            <button class="cindra-composer__button cindra-composer__button--primary" id="ask" type="button">Ask AI</button>
          </div>
          <div class="cindra-composer__status" id="status" role="status" aria-live="polite"></div>
        </section>
      `;

      shadow.getElementById('close').addEventListener('click', () => this.dismiss());
      shadow.getElementById('summarize').addEventListener('click', () => this.submit(''));
      shadow.getElementById('ask').addEventListener('click', () => {
        this.submit(shadow.getElementById('question').value);
      });
      shadow.addEventListener('keydown', this.handleShadowKeyDown);
      (this.document.body || this.document.documentElement).appendChild(host);
      this.host = host;
    }

    show(rect, selectedText, range) {
      this.ensureRendered();
      const wasVisible = this.visible;
      const previousText = this.selectedText;
      this.selectedText = selectedText;
      this.range = range;
      this.showToken += 1;
      const token = this.showToken;

      if (!wasVisible) this.previousActiveElement = this.document.activeElement;
      if (previousText !== selectedText) {
        this.host.shadowRoot.getElementById('question').value = '';
      }
      this.host.shadowRoot.getElementById('selection-meta').textContent =
        `${selectedText.length.toLocaleString()} chars selected`;
      this.host.shadowRoot.getElementById('ask').textContent = 'Ask AI';
      this.setStatus('');
      this.host.hidden = false;
      this.position(rect);
      this.paintHighlight();

      Promise.resolve(this.resolveProviderName())
        .then((providerName) => {
          if (!this.visible || token !== this.showToken) return;
          const label = providerName || 'AI';
          this.host.shadowRoot.getElementById('selection-meta').textContent =
            `${selectedText.length.toLocaleString()} chars selected → ${label}`;
          this.host.shadowRoot.getElementById('ask').textContent = `Ask ${label}`;
        })
        .catch(() => {});

      this.window.requestAnimationFrame(() => {
        if (this.visible && token === this.showToken) {
          safeFocus(this.host.shadowRoot.getElementById('question'));
        }
      });
    }

    position(rect) {
      if (!this.host) return;
      const viewportWidth = Math.max(0, this.window.innerWidth || 0);
      const viewportHeight = Math.max(0, this.window.innerHeight || 0);
      const panelWidth = Math.min(COMPOSER_WIDTH_PX, Math.max(0, viewportWidth - VIEWPORT_GUTTER_PX * 2));
      const panel = this.host.shadowRoot.getElementById('dialog');
      const panelHeight = Math.max(230, panel?.getBoundingClientRect?.().height || 0);
      const left = Math.max(
        VIEWPORT_GUTTER_PX,
        Math.min(
          rect.left + rect.width / 2 - panelWidth / 2,
          viewportWidth - panelWidth - VIEWPORT_GUTTER_PX
        )
      );
      let top = rect.bottom + 10;
      if (top + panelHeight > viewportHeight && rect.top > panelHeight + 10) {
        top = rect.top - panelHeight - 10;
      }

      this.host.style.left = `${Math.round(left)}px`;
      this.host.style.top = `${Math.round(Math.max(VIEWPORT_GUTTER_PX, top))}px`;
    }

    scheduleReposition() {
      if (!this.visible || this.repositionFrame !== null) return;
      this.repositionFrame = this.window.requestAnimationFrame(() => {
        this.repositionFrame = null;
        this.reposition();
      });
    }

    reposition() {
      if (!this.visible || !this.range) return;
      try {
        const rect = this.range.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) {
          this.hide({ restoreFocus: false, clearRange: true });
          return;
        }
        this.position(rect);
        this.paintHighlight();
      } catch (error) {
        this.hide({ restoreFocus: false, clearRange: true });
      }
    }

    onShadowKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.dismiss();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        this.submit(this.host.shadowRoot.getElementById('question').value);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(this.host.shadowRoot.querySelectorAll('button, textarea'))
        .filter(element => !element.disabled && element.tabIndex !== -1);
      if (!focusable.length) return;
      const currentIndex = focusable.indexOf(this.host.shadowRoot.activeElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      safeFocus(focusable[nextIndex]);
    }

    async submit(questionText) {
      if (this.submitting) return;
      if (!this.selectedText.trim()) {
        this.setStatus('No selected text captured.');
        return;
      }

      this.submitting = true;
      this.setSubmitting(true);
      this.setStatus('Sending selected text...');
      const token = this.showToken;
      try {
        const result = await this.onSubmit({
          question: String(questionText || '').trim(),
          selectedText: this.selectedText
        });
        if (!this.visible || token !== this.showToken) return;
        this.setStatus(`Queued for ${result?.providerName || 'AI'}.`);
        this.hideTimer = this.window.setTimeout(() => {
          this.hideTimer = null;
          this.hide();
        }, 700);
      } catch (error) {
        if (this.visible && token === this.showToken) {
          this.setStatus(error?.message || 'Could not start the handoff.');
        }
      } finally {
        this.submitting = false;
        this.setSubmitting(false);
      }
    }

    setSubmitting(value) {
      if (!this.host) return;
      const shadow = this.host.shadowRoot;
      shadow.getElementById('dialog').setAttribute('aria-busy', String(Boolean(value)));
      shadow.getElementById('summarize').disabled = Boolean(value);
      shadow.getElementById('ask').disabled = Boolean(value);
    }

    setStatus(message) {
      if (this.host) this.host.shadowRoot.getElementById('status').textContent = message;
    }

    dismiss() {
      if (!this.visible) return;
      this.dismissedText = this.selectedText;
      this.hide();
    }

    hide({ restoreFocus = true, clearRange = false } = {}) {
      if (this.showTimer) this.window.clearTimeout(this.showTimer);
      if (this.hideTimer) this.window.clearTimeout(this.hideTimer);
      if (this.repositionFrame !== null) this.window.cancelAnimationFrame(this.repositionFrame);
      this.showTimer = null;
      this.hideTimer = null;
      this.repositionFrame = null;
      if (this.host) this.host.hidden = true;
      this.showToken += 1;
      this.clearHighlight();
      if (clearRange) this.range = null;
      if (restoreFocus) safeFocus(this.previousActiveElement);
      this.previousActiveElement = null;
    }

    paintHighlight() {
      if (!this.range) return;
      if (!this.highlightHost) {
        const host = this.document.createElement('div');
        host.setAttribute('data-extension', 'cindra-summary');
        host.setAttribute('data-cindra-ui', 'selection-highlight');
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `<style>${HIGHLIGHT_STYLES}</style><div id="highlights"></div>`;
        (this.document.body || this.document.documentElement).appendChild(host);
        this.highlightHost = host;
      }

      const container = this.highlightHost.shadowRoot.getElementById('highlights');
      container.textContent = '';
      let rects;
      try {
        rects = Array.from(this.range.getClientRects())
          .filter(rect => rect.width > 0 && rect.height > 0)
          .slice(0, this.maxHighlightRects);
      } catch (error) {
        rects = [];
      }

      const fragment = this.document.createDocumentFragment();
      for (const rect of rects) {
        const highlight = this.document.createElement('div');
        highlight.className = 'cindra-highlight';
        highlight.style.left = `${rect.left}px`;
        highlight.style.top = `${rect.top}px`;
        highlight.style.width = `${rect.width}px`;
        highlight.style.height = `${rect.height}px`;
        fragment.appendChild(highlight);
      }
      container.appendChild(fragment);
    }

    clearHighlight() {
      this.highlightHost?.remove();
      this.highlightHost = null;
    }

    get visible() {
      return Boolean(this.host && !this.host.hidden);
    }
  }

  class FloatingSummaryButton {
    constructor({ document: documentLike, chrome: chromeLike, onActivate } = {}) {
      if (!documentLike || typeof onActivate !== 'function') {
        throw new TypeError('FloatingSummaryButton requires document and onActivate.');
      }
      this.document = documentLike;
      this.chrome = chromeLike;
      this.onActivate = onActivate;
      this.host = null;
    }

    start() {
      if (this.host) return this;
      const host = this.document.createElement('div');
      host.setAttribute('data-extension', 'cindra-summary');
      host.setAttribute('data-cindra-ui', 'floating-button');
      const shadow = host.attachShadow({ mode: 'open' });
      let iconUrl = '';
      try {
        iconUrl = this.chrome?.runtime?.getURL?.('images/icon48.png') || '';
      } catch (error) {
        iconUrl = '';
      }
      shadow.innerHTML = `
        <style>${FLOATING_BUTTON_STYLES}</style>
        <div class="cindra-launcher">
          <button class="cindra-launcher__button" id="summarize" type="button" aria-label="Summarize this page with AI" aria-describedby="tooltip">
            ${iconUrl ? `<img class="cindra-launcher__icon" src="${iconUrl}" alt="">` : '<span aria-hidden="true">C</span>'}
          </button>
          <button class="cindra-launcher__close" id="close" type="button" aria-label="Hide Cindra summarize button">×</button>
          <div class="cindra-launcher__tooltip" id="tooltip" role="tooltip">Summarize with AI (Ctrl+X+X)</div>
        </div>
      `;
      shadow.getElementById('summarize').addEventListener('click', () => this.onActivate());
      shadow.getElementById('close').addEventListener('click', () => this.destroy());
      (this.document.body || this.document.documentElement).appendChild(host);
      this.host = host;
      return this;
    }

    destroy() {
      this.host?.remove();
      this.host = null;
    }
  }

  return {
    COMPOSER_STYLES,
    DEFAULT_MAX_HIGHLIGHT_RECTS,
    DEFAULT_SHOW_DELAY_MS,
    FLOATING_BUTTON_STYLES,
    FloatingSummaryButton,
    SelectionComposer,
    buildQuestionPrompt,
    getActivePrompt,
    isEditableTarget
  };
});
