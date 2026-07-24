(function (root, factory) {
  'use strict';

  const api = root.CindraErrors || factory();
  root.CindraErrors = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_USER_MESSAGE = 'Cindra could not complete that request.';
  const MAX_DIAGNOSTIC_LENGTH = 12000;
  const MAX_CAUSE_DEPTH = 4;
  const SENSITIVE_BLOCK_PATTERN = /<(Task|Content)>[\s\S]*?<\/\1>/gi;
  const SENSITIVE_FIELD_PATTERN = /\b(prompt(?:Text)?|capturedPageContent|selectedText|content|transcript)\s*[:=]\s*(?:"[^"]*"|'[^']*'|`[^`]*`|\{[\s\S]*?\}|\[[\s\S]*?\])/gi;

  function limitText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }

  function redactSensitiveText(value) {
    return String(value ?? '')
      .replace(SENSITIVE_BLOCK_PATTERN, '<$1>[redacted]</$1>')
      .replace(SENSITIVE_FIELD_PATTERN, '$1: [redacted]');
  }

  function cleanDiagnosticText(value, maxLength = MAX_DIAGNOSTIC_LENGTH) {
    const cleaned = redactSensitiveText(value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim();
    return limitText(cleaned, Math.max(1, Math.floor(Number(maxLength) || MAX_DIAGNOSTIC_LENGTH)));
  }

  function cleanMessage(value, fallback = DEFAULT_USER_MESSAGE, maxLength = 300) {
    const cleaned = redactSensitiveText(typeof value === 'string' ? value : '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const safeFallback = redactSensitiveText(fallback || DEFAULT_USER_MESSAGE)
      .replace(/\s+/g, ' ')
      .trim() || DEFAULT_USER_MESSAGE;
    const normalizedMax = Math.max(1, Math.floor(Number(maxLength) || 300));
    return limitText(cleaned || safeFallback, normalizedMax);
  }

  function toError(error, fallback = DEFAULT_USER_MESSAGE) {
    if (error instanceof Error) return error;
    const message = typeof error === 'string' && error.trim()
      ? cleanDiagnosticText(error)
      : cleanMessage(fallback);
    return new Error(message);
  }

  function wrap(context, error, userMessage = DEFAULT_USER_MESSAGE) {
    const cause = toError(error);
    const prefix = cleanMessage(context, 'Cindra operation', 160);
    const causeMessage = cleanMessage(cause.message, DEFAULT_USER_MESSAGE, 2000);
    let wrapped;

    try {
      wrapped = new Error(`${prefix}: ${causeMessage}`, { cause });
    } catch (unsupportedError) {
      wrapped = new Error(`${prefix}: ${causeMessage}`);
      wrapped.cause = cause;
    }

    wrapped.name = 'CindraError';
    wrapped.userMessage = cleanMessage(userMessage);
    if (cause.code !== undefined) wrapped.code = cause.code;
    return wrapped;
  }

  function fromChromeLastError(lastError, context = 'Chrome API request') {
    const causeMessage = cleanMessage(
      lastError?.message || lastError,
      'Unknown Chrome runtime error.',
      2000
    );
    const cause = new Error(causeMessage);
    const wrapped = wrap(context, cause, 'Cindra could not communicate with the browser.');
    wrapped.name = 'ChromeRuntimeError';
    wrapped.chromeLastError = { message: causeMessage };
    return wrapped;
  }

  function toUserMessage(error, fallback = DEFAULT_USER_MESSAGE) {
    return cleanMessage(error?.userMessage, cleanMessage(fallback));
  }

  function debugMessage(error, fallback = DEFAULT_USER_MESSAGE) {
    return cleanMessage(toError(error, fallback).message, fallback, 2000);
  }

  function serialize(error, options = {}) {
    const depth = Math.max(0, Number(options.depth) || 0);
    const maxDepth = Math.max(0, Number(options.maxDepth) || MAX_CAUSE_DEPTH);
    const normalized = toError(error);
    const context = typeof options.context === 'string' && options.context.trim()
      ? `${cleanMessage(options.context, 'Cindra operation', 160)}: `
      : '';
    const serialized = {
      name: cleanMessage(normalized.name, 'Error', 120),
      message: `${context}${debugMessage(normalized)}`,
      stack: cleanDiagnosticText(normalized.stack || '', MAX_DIAGNOSTIC_LENGTH) || null
    };

    if (normalized.code !== undefined && normalized.code !== null) {
      serialized.code = cleanMessage(String(normalized.code), 'UNKNOWN', 160);
    }
    if (normalized.userMessage) {
      serialized.userMessage = cleanMessage(normalized.userMessage);
    }
    if (normalized.cause && depth < maxDepth) {
      serialized.cause = serialize(normalized.cause, {
        depth: depth + 1,
        maxDepth
      });
    }
    return serialized;
  }

  function logError(context, error, logger = console) {
    const wrapped = error?.name === 'CindraError' || error?.name === 'ChromeRuntimeError'
      ? error
      : wrap(context, error);
    logger.error(`[Cindra] ${cleanMessage(context, 'Operation failed', 200)}`, serialize(wrapped));
    return wrapped;
  }

  return Object.freeze({
    DEFAULT_USER_MESSAGE,
    MAX_DIAGNOSTIC_LENGTH,
    cleanDiagnosticText,
    cleanMessage,
    debugMessage,
    fromChromeLastError,
    logError,
    redactSensitiveText,
    serialize,
    toError,
    toUserMessage,
    wrap
  });
});
