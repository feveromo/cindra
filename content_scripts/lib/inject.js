// Shared helpers for per-provider content scripts. Loaded before every provider
// adapter and exposed on globalThis.CindraInject.
(function (root, factory) {
  'use strict';

  const api = root.CindraInject || factory(root);
  root.CindraInject = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 10000;
  const DEFAULT_POLL_INTERVAL_MS = 250;

  function createTimeoutError(description = 'condition', timeoutMs = DEFAULT_TIMEOUT_MS) {
    const error = new Error(`Timeout waiting for ${description} after ${timeoutMs} ms.`);
    error.name = 'TimeoutError';
    error.userMessage = `The ${description} did not become ready in time.`;
    return error;
  }

  function createAbortError(reason = 'Operation was canceled.') {
    if (reason instanceof Error) return reason;
    const message = typeof reason === 'string' && reason.trim()
      ? reason.trim()
      : 'Operation was canceled.';
    let error;
    try {
      error = new DOMException(message, 'AbortError');
    } catch (unsupportedError) {
      error = new Error(message);
      error.name = 'AbortError';
    }
    return error;
  }

  function isTimeoutError(error) {
    return error?.name === 'TimeoutError';
  }

  function isAbortError(error) {
    return error?.name === 'AbortError';
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw createAbortError(signal.reason);
  }

  function normalizeWaitOptions(timeoutOrOptions, legacyDescription) {
    if (timeoutOrOptions && typeof timeoutOrOptions === 'object') {
      return {
        timeoutMs: timeoutOrOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        intervalMs: timeoutOrOptions.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
        signal: timeoutOrOptions.signal || null,
        description: timeoutOrOptions.description || legacyDescription || 'condition',
        observeRoot: timeoutOrOptions.observeRoot || root.document?.documentElement || null,
        scope: timeoutOrOptions.scope || root.document,
        predicate: timeoutOrOptions.predicate || isUsableControl
      };
    }

    return {
      timeoutMs: timeoutOrOptions ?? DEFAULT_TIMEOUT_MS,
      intervalMs: DEFAULT_POLL_INTERVAL_MS,
      signal: null,
      description: legacyDescription || 'condition',
      observeRoot: root.document?.documentElement || null,
      scope: root.document,
      predicate: isUsableControl
    };
  }

  function queryFirst(selectors, scope = root.document, predicate = () => true) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    if (!scope?.querySelectorAll) return null;

    for (const selector of list.filter(Boolean)) {
      const matches = scope.querySelectorAll(selector);
      for (const element of matches) {
        if (predicate(element)) return element;
      }
    }
    return null;
  }

  function waitForCondition(findValue, timeoutOrOptions = DEFAULT_TIMEOUT_MS, legacyDescription = 'condition') {
    if (typeof findValue !== 'function') {
      return Promise.reject(new TypeError('waitForCondition requires a predicate function.'));
    }

    const options = normalizeWaitOptions(timeoutOrOptions, legacyDescription);
    const timeoutMs = Math.max(0, Math.floor(Number(options.timeoutMs) || 0));
    const requestedIntervalMs = Math.max(
      10,
      Math.floor(Number(options.intervalMs) || DEFAULT_POLL_INTERVAL_MS)
    );
    const intervalMs = timeoutMs > 0
      ? Math.min(requestedIntervalMs, Math.max(10, Math.floor(timeoutMs / 4)))
      : requestedIntervalMs;

    try {
      throwIfAborted(options.signal);
      const immediate = findValue();
      if (immediate) return Promise.resolve(immediate);
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let observer = null;
      let interval = null;
      let timeout = null;

      const cleanup = () => {
        observer?.disconnect();
        if (interval !== null) root.clearInterval(interval);
        if (timeout !== null) root.clearTimeout(timeout);
        options.signal?.removeEventListener?.('abort', handleAbort);
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
          throwIfAborted(options.signal);
          const value = findValue();
          if (value) settle(value);
        } catch (error) {
          settle(null, error);
        }
      };

      const handleAbort = () => settle(null, createAbortError(options.signal?.reason));
      options.signal?.addEventListener?.('abort', handleAbort, { once: true });

      const Observer = root.MutationObserver;
      if (typeof Observer === 'function' && options.observeRoot?.nodeType) {
        observer = new Observer(check);
        observer.observe(options.observeRoot, {
          attributes: true,
          childList: true,
          subtree: true
        });
      }

      interval = root.setInterval(check, intervalMs);
      timeout = root.setTimeout(
        () => settle(null, createTimeoutError(options.description, timeoutMs)),
        timeoutMs
      );
    });
  }

  function waitForElement(selectors, timeoutOrOptions = DEFAULT_TIMEOUT_MS, legacyDescription = null) {
    const description = legacyDescription ||
      `element: ${Array.isArray(selectors) ? selectors.join(', ') : selectors}`;
    const options = normalizeWaitOptions(timeoutOrOptions, description);
    return waitForCondition(
      () => queryFirst(selectors, options.scope, options.predicate),
      options
    );
  }

  function sleep(milliseconds = 0, signal = null) {
    const delayMs = Math.max(0, Math.floor(Number(milliseconds) || 0));
    try {
      throwIfAborted(signal);
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      const handleAbort = () => {
        root.clearTimeout(timeout);
        signal?.removeEventListener?.('abort', handleAbort);
        reject(createAbortError(signal?.reason));
      };
      const timeout = root.setTimeout(() => {
        signal?.removeEventListener?.('abort', handleAbort);
        resolve();
      }, delayMs);
      signal?.addEventListener?.('abort', handleAbort, { once: true });
    });
  }

  function delay(milliseconds = 0, signal = null) {
    return sleep(milliseconds, signal);
  }

  function dispatchTextInput(element, text, options = {}) {
    const data = options.inputEventData === undefined ? text : options.inputEventData;
    try {
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: 'insertText',
        data
      }));
    } catch (error) {
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    if (options.additionalInputEvent) {
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function dispatchInput(element, text, options = {}) {
    dispatchTextInput(element, text, options);
  }

  function insertTextIntoTextarea(textarea, text) {
    textarea.focus();
    const tagName = textarea.tagName?.toLowerCase();
    const prototype = tagName === 'input'
      ? root.HTMLInputElement?.prototype
      : root.HTMLTextAreaElement?.prototype;
    const valueSetter = prototype
      ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      : null;
    if (valueSetter) valueSetter.call(textarea, text);
    else textarea.value = text;
    dispatchTextInput(textarea, text);
  }

  function appendContentEditableText(element, text, mode) {
    const documentLike = element.ownerDocument || root.document;
    const normalized = String(text ?? '').replace(/\r\n?/g, '\n');

    if (mode === 'pre') {
      const pre = documentLike.createElement('pre');
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.wordBreak = 'break-word';
      pre.style.margin = '0';
      pre.appendChild(documentLike.createTextNode(normalized));
      element.appendChild(pre);
      return;
    }

    if (mode === 'paragraph') {
      const paragraph = documentLike.createElement('p');
      paragraph.textContent = normalized;
      element.appendChild(paragraph);
      return;
    }

    if (mode === 'lines') {
      normalized.split('\n').forEach((line, index) => {
        if (index > 0) element.appendChild(documentLike.createElement('br'));
        if (line) element.appendChild(documentLike.createTextNode(line));
      });
      return;
    }

    if (mode === 'blocks') {
      for (const line of normalized.split('\n')) {
        const block = documentLike.createElement('div');
        if (line) block.textContent = line;
        else block.appendChild(documentLike.createElement('br'));
        element.appendChild(block);
      }
      return;
    }

    element.appendChild(documentLike.createTextNode(normalized));
  }

  function setCaretAtEnd(element) {
    const documentLike = element.ownerDocument || root.document;
    const selection = documentLike.defaultView?.getSelection?.() || root.getSelection?.();
    if (!selection || !documentLike.createRange) return;
    const range = documentLike.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertTextIntoContentEditable(element, text, options = {}) {
    element.focus();
    element.replaceChildren();
    appendContentEditableText(element, text, options.mode || 'text');
    if (options.blankClass) element.classList?.remove(options.blankClass);
    dispatchTextInput(element, text, options);
    if (options.caretAtEnd) setCaretAtEnd(element);
  }

  function insertText(element, text, options = {}) {
    const tagName = element?.tagName?.toLowerCase();
    if (tagName === 'textarea' || tagName === 'input') {
      insertTextIntoTextarea(element, text);
      return;
    }
    insertTextIntoContentEditable(element, text, options);
  }

  function pressEnter(element, options = {}) {
    const eventTypes = Array.isArray(options.eventTypes) && options.eventTypes.length
      ? options.eventTypes
      : ['keydown'];
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
    for (const type of eventTypes) {
      element.dispatchEvent(new KeyboardEvent(type, eventOptions));
    }
  }

  function dispatchEnter(element, options = {}) {
    const eventTypes = options.eventTypes || [
      'keydown',
      ...(options.keypress ? ['keypress'] : []),
      ...(options.keyup ? ['keyup'] : [])
    ];
    pressEnter(element, { ...options, eventTypes });
  }

  function isUsableControl(element) {
    if (!element || element.disabled || element.getAttribute?.('aria-disabled') === 'true') {
      return false;
    }
    const rect = element.getBoundingClientRect?.();
    if (rect && rect.width === 0 && rect.height === 0) return false;
    return true;
  }

  function isUsableElement(element) {
    return isUsableControl(element);
  }

  function robustClick(element) {
    if (!element) return;
    element.scrollIntoView?.({ behavior: 'auto', block: 'center' });
    for (const type of ['mousedown', 'mouseup', 'click']) {
      element.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: root
      }));
    }
  }

  function nativeClick(element) {
    if (!element) return;
    element.scrollIntoView?.({ behavior: 'auto', block: 'center' });
    try {
      element.click();
    } catch (error) {
      element.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: root
      }));
    }
  }

  function normalizeWhitespace(text) {
    return String(text ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  return Object.freeze({
    DEFAULT_TIMEOUT_MS,
    createAbortError,
    createTimeoutError,
    delay,
    dispatchEnter,
    dispatchInput,
    dispatchTextInput,
    insertText,
    insertTextIntoContentEditable,
    insertTextIntoTextarea,
    isAbortError,
    isTimeoutError,
    isUsableControl,
    isUsableElement,
    nativeClick,
    normalizeWhitespace,
    pressEnter,
    queryFirst,
    robustClick,
    sleep,
    throwIfAborted,
    waitForCondition,
    waitForElement
  });
});
