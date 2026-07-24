(function (root, factory) {
  'use strict';

  const api = root.CindraYouTubeUi || factory();
  root.CindraYouTubeUi = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ICONS = Object.freeze({
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/></svg>',
    loading: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4V1L8 5l4 4V6a6 6 0 0 1 5.3 8.8l1.46 1.46A8 8 0 0 0 12 4Zm0 14a6 6 0 0 1-5.3-8.8L5.24 7.74A8 8 0 0 0 12 20v3l4-4-4-4v3Z"/></svg>',
    success: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 16.17-4.17-4.17-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z"/></svg>',
    error: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z"/></svg>'
  });

  const STYLES = `
    :host { display: inline-flex; margin-left: 8px; vertical-align: middle; color-scheme: dark; }
    * { box-sizing: border-box; }
    button {
      display: grid;
      width: 40px;
      height: 40px;
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: #aaa;
      padding: 8px;
      cursor: pointer;
      transition: background-color 0.2s ease, color 0.2s ease;
    }
    button:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
    button:focus-visible { outline: 2px solid #3ea6ff; outline-offset: 2px; }
    button:disabled { cursor: progress; opacity: 0.7; }
    button[data-state='success'] { color: #59d499; }
    button[data-state='error'] { color: #ff6161; }
    svg { width: 24px; height: 24px; fill: currentColor; }
    .status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    @media (prefers-reduced-motion: reduce) { button { transition: none; } }
  `;

  function isYouTubeVideoPage(locationLike) {
    if (!locationLike) return false;
    try {
      return locationLike.pathname === '/watch' &&
        Boolean(new URLSearchParams(locationLike.search || '').get('v'));
    } catch (error) {
      return false;
    }
  }

  class YouTubeTranscriptButton {
    constructor({
      window: windowLike,
      document: documentLike,
      onCopy,
      onError = () => {},
      retryDelayMs = 500
    } = {}) {
      if (!windowLike || !documentLike || typeof onCopy !== 'function') {
        throw new TypeError('YouTubeTranscriptButton requires window, document, and onCopy.');
      }
      this.window = windowLike;
      this.document = documentLike;
      this.onCopy = onCopy;
      this.onError = onError;
      this.retryDelayMs = Math.max(50, Math.floor(Number(retryDelayMs) || 500));
      this.host = null;
      this.observer = null;
      this.timers = new Map();
      this.lastUrl = '';
      this.started = false;
      this.destroyed = false;
      this.copying = false;

      this.handleNavigation = () => this.onNavigation();
      this.handleMutations = () => this.onMutations();
      this.handleReady = () => this.initializeDom();
      this.handlePageHide = () => this.destroy();
    }

    start() {
      if (this.started || this.destroyed) return this;
      this.started = true;
      this.lastUrl = this.window.location.href;
      this.window.addEventListener('yt-navigate-finish', this.handleNavigation);
      this.window.addEventListener('popstate', this.handleNavigation);
      this.window.addEventListener('pagehide', this.handlePageHide, { once: true });
      if (this.document.readyState === 'loading') {
        this.document.addEventListener('DOMContentLoaded', this.handleReady, { once: true });
      } else {
        this.initializeDom();
      }
      return this;
    }

    initializeDom() {
      if (this.destroyed) return;
      const observerRoot = this.document.querySelector('ytd-page-manager') ||
        this.document.documentElement ||
        this.document.body;
      if (!observerRoot) {
        this.schedule('initialize', () => this.initializeDom(), this.retryDelayMs);
        return;
      }

      this.observer?.disconnect();
      this.observer = new this.window.MutationObserver(this.handleMutations);
      this.observer.observe(observerRoot, { childList: true, subtree: true });
      this.scheduleEnsure(0);
    }

    onNavigation() {
      if (this.destroyed) return;
      const url = this.window.location.href;
      if (url !== this.lastUrl) {
        this.lastUrl = url;
        this.removeButton();
      }
      this.scheduleEnsure(100);
    }

    onMutations() {
      if (this.destroyed) return;
      if (this.window.location.href !== this.lastUrl) {
        this.onNavigation();
        return;
      }
      if (isYouTubeVideoPage(this.window.location) && !this.host?.isConnected) {
        this.scheduleEnsure(100);
      }
    }

    schedule(key, callback, delay) {
      const existing = this.timers.get(key);
      if (existing) this.window.clearTimeout(existing);
      const timer = this.window.setTimeout(() => {
        this.timers.delete(key);
        if (!this.destroyed) callback();
      }, Math.max(0, delay));
      this.timers.set(key, timer);
    }

    scheduleEnsure(delay = this.retryDelayMs) {
      this.schedule('ensure-button', () => this.ensureButton(), delay);
    }

    ensureButton() {
      if (this.destroyed) return;
      if (!isYouTubeVideoPage(this.window.location)) {
        this.removeButton();
        return;
      }
      if (this.host?.isConnected) return;

      const placement = this.findPlacement();
      if (!placement) {
        this.scheduleEnsure();
        return;
      }

      const host = this.document.createElement('span');
      host.setAttribute('data-extension', 'cindra-summary');
      host.setAttribute('data-cindra-ui', 'youtube-transcript-copy');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>${STYLES}</style>
        <button id="copy" type="button" data-state="idle" aria-label="Copy YouTube transcript" aria-describedby="status">${ICONS.copy}</button>
        <span class="status" id="status" role="status" aria-live="polite"></span>
      `;
      shadow.getElementById('copy').addEventListener('click', () => void this.copyTranscript());
      placement.parent.insertBefore(host, placement.before || null);
      this.host = host;
    }

    findPlacement() {
      const subscribeButton = this.document.querySelector('#subscribe-button');
      if (subscribeButton?.parentNode) {
        return { parent: subscribeButton.parentNode, before: subscribeButton.nextSibling };
      }

      const topRow = this.document.querySelector('#above-the-fold #top-row');
      if (topRow) {
        const subscribe = topRow.querySelector('#subscribe-button');
        return { parent: topRow, before: subscribe?.nextSibling || null };
      }

      const title = this.document.querySelector('#above-the-fold #title h1');
      if (title?.parentNode) return { parent: title.parentNode, before: title.nextSibling };

      const aboveFold = this.document.querySelector('#above-the-fold');
      if (aboveFold) {
        const titleContainer = aboveFold.querySelector('#title');
        return { parent: aboveFold, before: titleContainer?.nextSibling || null };
      }

      const actions = this.document.querySelector('#actions-inner') ||
        this.document.querySelector('#actions');
      if (actions) return { parent: actions, before: actions.firstChild };

      const metadata = this.document.querySelector('ytd-watch-metadata');
      if (metadata) return { parent: metadata, before: metadata.firstChild };
      return null;
    }

    async copyTranscript() {
      if (this.copying || !this.host) return;
      this.copying = true;
      this.setState('loading', 'Extracting transcript...');
      try {
        const content = await this.onCopy();
        if (!content) throw new Error('No transcript was available to copy.');
        await this.window.navigator.clipboard.writeText(content);
        this.setState('success', 'Transcript copied.');
      } catch (error) {
        this.onError(error);
        this.setState('error', error?.message || 'Could not copy transcript.');
      } finally {
        this.copying = false;
        this.schedule('reset-state', () => this.setState('idle', ''), 2000);
      }
    }

    setState(state, message) {
      if (!this.host) return;
      const button = this.host.shadowRoot.getElementById('copy');
      const status = this.host.shadowRoot.getElementById('status');
      button.dataset.state = state;
      button.disabled = state === 'loading';
      button.innerHTML = ICONS[state] || ICONS.copy;
      status.textContent = message;
    }

    removeButton() {
      this.host?.remove();
      this.host = null;
      const reset = this.timers.get('reset-state');
      if (reset) this.window.clearTimeout(reset);
      this.timers.delete('reset-state');
      this.copying = false;
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.started = false;
      this.document.removeEventListener('DOMContentLoaded', this.handleReady);
      this.window.removeEventListener('yt-navigate-finish', this.handleNavigation);
      this.window.removeEventListener('popstate', this.handleNavigation);
      this.window.removeEventListener('pagehide', this.handlePageHide);
      this.observer?.disconnect();
      this.observer = null;
      for (const timer of this.timers.values()) this.window.clearTimeout(timer);
      this.timers.clear();
      this.removeButton();
    }
  }

  return {
    ICONS,
    STYLES,
    YouTubeTranscriptButton,
    isYouTubeVideoPage
  };
});
