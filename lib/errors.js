(function (root, factory) {
  'use strict';

  const api = factory();
  root.CindraErrors = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_USER_MESSAGE = 'Cindra could not complete that request.';

  function toError(error, fallback = DEFAULT_USER_MESSAGE) {
    if (error instanceof Error) return error;

    const message = typeof error === 'string' && error.trim()
      ? error.trim()
      : fallback;
    return new Error(message);
  }

  function cleanMessage(value, fallback = DEFAULT_USER_MESSAGE, maxLength = 300) {
    const text = typeof value === 'string' ? value : '';
    const cleaned = text
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) return fallback;
    if (cleaned.length <= maxLength) return cleaned;
    return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }

  function wrap(context, error, userMessage = DEFAULT_USER_MESSAGE) {
    const cause = toError(error);
    const prefix = cleanMessage(context, 'Cindra operation', 160);
    let wrapped;

    try {
      wrapped = new Error(`${prefix}: ${cause.message}`, { cause });
    } catch (unsupportedError) {
      wrapped = new Error(`${prefix}: ${cause.message}`);
      wrapped.cause = cause;
    }

    wrapped.name = 'CindraError';
    wrapped.userMessage = cleanMessage(userMessage);
    return wrapped;
  }

  function fromChromeLastError(lastError, context = 'Chrome API request') {
    const cause = toError(lastError?.message || lastError, 'Unknown Chrome runtime error.');
    const wrapped = wrap(context, cause, 'Cindra could not communicate with the browser.');
    wrapped.name = 'ChromeRuntimeError';
    wrapped.chromeLastError = lastError && typeof lastError === 'object'
      ? { ...lastError, message: cause.message }
      : { message: cause.message };
    return wrapped;
  }

  function toUserMessage(error, fallback = DEFAULT_USER_MESSAGE) {
    return cleanMessage(error?.userMessage, cleanMessage(fallback));
  }

  function debugMessage(error, fallback = DEFAULT_USER_MESSAGE) {
    return toError(error, fallback).message;
  }

  function logError(context, error, logger = console) {
    const wrapped = error?.name === 'CindraError' || error?.name === 'ChromeRuntimeError'
      ? error
      : wrap(context, error);
    const cause = wrapped.cause || error;

    logger.error(`[Cindra] ${context}`, wrapped, {
      cause,
      causeStack: cause?.stack || null,
      stack: wrapped.stack || null
    });
    return wrapped;
  }

  return {
    DEFAULT_USER_MESSAGE,
    cleanMessage,
    debugMessage,
    fromChromeLastError,
    logError,
    toError,
    toUserMessage,
    wrap
  };
});
