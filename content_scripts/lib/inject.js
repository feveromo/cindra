// Shared helpers for per-provider content scripts. Loaded before every provider
// script via the manifest. Exposed on globalThis.CindraInject.
(function (root) {
  'use strict';

  // Resolve a single selector or the first matching selector from an array.
  function queryFirst(selectors) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of list) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  // Wait for an element matching a selector (string) or the first match from an
  // array of selectors. Polls at 100ms and rejects after `timeout`. The textContent
  // match in earlier per-provider copies was always null/unused, so it is dropped.
  // ponytail: polling, not MutationObserver — providers run at known ready states
  // and the 100ms tax is negligible; MutationObserver added complexity for no win.
  function waitForElement(selectors, timeout = 10000) {
    const immediate = queryFirst(selectors);
    if (immediate) return Promise.resolve(immediate);

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const interval = setInterval(() => {
        const element = queryFirst(selectors);
        if (element) {
          clearInterval(interval);
          resolve(element);
          return;
        }

        if (Date.now() - startTime > timeout) {
          clearInterval(interval);
          const description = Array.isArray(selectors) ? selectors.join(', ') : selectors;
          reject(new Error(`Timeout waiting for element: ${description}`));
        }
      }, 100);
    });
  }

  // Write text into a <textarea> and dispatch the input/change events React and
  // similar frameworks need to pick up a programmatic value write.
  function insertTextIntoTextarea(textarea, text) {
    textarea.focus();
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Full mouse sequence (mousedown -> mouseup -> click); some providers ignore a
  // bare element.click(). Kimi intentionally uses native click() first and keeps
  // its own helper, so this is the shared mousedown-first variant.
  function robustClick(element) {
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    ['mousedown', 'mouseup', 'click'].forEach(type => {
      element.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    });
  }

  // Collapse CRLF/trailing-space/blank-run/tabs to a single canonical form.
  // Shared by the content extractor and the captured-text paths.
  function normalizeWhitespace(text) {
    return (text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  root.CindraInject = {
    queryFirst,
    waitForElement,
    insertTextIntoTextarea,
    robustClick,
    normalizeWhitespace
  };
})(globalThis);
