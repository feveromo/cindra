// Shared helpers for per-provider content scripts. Loaded before every provider
// script via the manifest. Exposed on globalThis.CindraInject.
(function (root) {
  'use strict';

  if (root.CindraInject) {
    return;
  }

  const DEFAULT_POLL_INTERVAL_MS = 250;

  // Resolve a single selector or the first matching selector from an array.
  function queryFirst(selectors) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of list) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function waitForCondition(findValue, timeout = 10000, description = 'condition') {
    let immediate;
    try {
      immediate = findValue();
    } catch (error) {
      return Promise.reject(error);
    }
    if (immediate) return Promise.resolve(immediate);

    return new Promise((resolve, reject) => {
      let settled = false;
      let observer = null;
      let interval = null;
      let timeoutId = null;

      const cleanup = () => {
        observer?.disconnect();
        if (interval) clearInterval(interval);
        if (timeoutId) clearTimeout(timeoutId);
      };

      const settle = (value, error = null) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(value);
      };

      const check = () => {
        try {
          const value = findValue();
          if (value) settle(value);
        } catch (error) {
          settle(null, error);
        }
      };

      if (typeof MutationObserver === 'function' && document.documentElement) {
        observer = new MutationObserver(check);
        observer.observe(document.documentElement, {
          attributes: true,
          childList: true,
          subtree: true
        });
      }

      interval = setInterval(check, DEFAULT_POLL_INTERVAL_MS);
      timeoutId = setTimeout(() => {
        settle(null, new Error(`Timeout waiting for ${description}`));
      }, Math.max(0, timeout));
    });
  }

  // Wait for an element matching a selector (string) or the first match from an
  // array. A MutationObserver handles DOM changes immediately while a low-rate
  // poll covers state changes that do not mutate the observed subtree.
  function waitForElement(selectors, timeout = 10000) {
    const description = Array.isArray(selectors) ? selectors.join(', ') : selectors;
    return waitForCondition(
      () => queryFirst(selectors),
      timeout,
      `element: ${description}`
    );
  }

  function delay(milliseconds = 0) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, milliseconds)));
  }

  function dispatchInput(element, text) {
    try {
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: 'insertText',
        data: text
      }));
    } catch (error) {
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Write text into a <textarea>/<input> and dispatch the events React and
  // similar frameworks need to observe a programmatic value write.
  function insertTextIntoTextarea(textarea, text) {
    textarea.focus();

    const prototype = textarea.tagName?.toLowerCase() === 'input'
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (valueSetter) valueSetter.call(textarea, text);
    else textarea.value = text;

    dispatchInput(textarea, text);
  }

  // Safe default for plain contenteditable composers. Provider-specific editors
  // can override this when their framework requires a richer DOM structure.
  function insertTextIntoContentEditable(element, text) {
    element.focus();
    element.replaceChildren(document.createTextNode(text));
    dispatchInput(element, text);
  }

  function dispatchEnter(element, options = {}) {
    const eventOptions = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      ctrlKey: Boolean(options.ctrlKey),
      metaKey: Boolean(options.metaKey),
      shiftKey: Boolean(options.shiftKey),
      bubbles: true,
      cancelable: true
    };
    element.focus();
    element.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
    if (options.keyup) {
      element.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
    }
  }

  function isUsableElement(element) {
    if (!element || element.disabled || element.getAttribute?.('aria-disabled') === 'true') {
      return false;
    }

    const rect = element.getBoundingClientRect?.();
    return !rect || (rect.width > 0 && rect.height > 0);
  }

  // Full mouse sequence (mousedown -> mouseup -> click); some providers ignore a
  // bare element.click(). Kimi intentionally uses native click() first and keeps
  // its own helper, so this is the shared mousedown-first variant.
  function robustClick(element) {
    if (!element) return;
    element.scrollIntoView({ behavior: 'auto', block: 'center' });

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
    waitForCondition,
    waitForElement,
    delay,
    dispatchInput,
    dispatchEnter,
    insertTextIntoTextarea,
    insertTextIntoContentEditable,
    isUsableElement,
    robustClick,
    normalizeWhitespace
  };
})(globalThis);
