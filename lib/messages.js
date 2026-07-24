(function (root, factory) {
  'use strict';

  const errors = typeof module === 'object' && module.exports
    ? require('./errors.js')
    : root.CindraErrors;
  const api = factory(root, errors);
  root.CindraMessages = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, errors) {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 15000;
  const ACTIONS = Object.freeze({
    SUMMARIZE: 'summarize',
    RESEND_SUMMARY: 'resendSummary',
    PROVIDER_HANDOFF_RESULT: 'providerHandoffResult',
    CLAIM_PROVIDER_HANDOFF: 'claimProviderHandoff',
    INSERT_PROMPT: 'insertPrompt',
    EXTRACT_REDDIT_CONTENT: 'extractRedditContent',
    TRANSCRIPT_STATUS: 'transcriptStatus',
    EXTRACT_TRANSCRIPT: 'extractTranscript',
    EXTRACT_PDF_TEXT_IN_OFFSCREEN: 'extractPdfTextInOffscreen',
    PDF_EXTRACTOR_PING: 'pdfExtractorPing'
  });
  const ACTION_VALUES = new Set(Object.values(ACTIONS));
  const CONTENT_SOURCES = new Set(['auto', 'page', 'selection', 'pdf']);
  const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
  const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

  function validId(value, { optional = false, provider = false } = {}) {
    if (value === undefined || value === null || value === '') return optional;
    if (typeof value !== 'string') return false;
    return (provider ? PROVIDER_ID_PATTERN : ID_PATTERN).test(value);
  }

  function validHttpUrl(value, { optional = false } = {}) {
    if (value === undefined || value === null || value === '') return optional;
    if (typeof value !== 'string') return false;

    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function validOptionalString(value, maxLength = Infinity) {
    return value === undefined ||
      value === null ||
      (typeof value === 'string' && value.length <= maxLength);
  }

  function validateSummarize(message) {
    if (message.tabId !== undefined &&
        (!Number.isInteger(message.tabId) || message.tabId < 0)) {
      return 'Summarize tabId must be a non-negative integer.';
    }
    if (!validHttpUrl(message.url, { optional: true })) {
      return 'Summarize URL must use HTTP or HTTPS.';
    }
    if (message.contentSource !== undefined && !CONTENT_SOURCES.has(message.contentSource)) {
      return 'Summarize contentSource is invalid.';
    }
    if (!validOptionalString(message.aiModel, 64) ||
        !validOptionalString(message.summaryPrompt, 20000) ||
        !validOptionalString(message.selectedText, 1000000) ||
        !validOptionalString(message.capturedPageContent, 2000000) ||
        !validOptionalString(message.capturedPageDescription, 20000)) {
      return 'Summarize text fields are malformed or too large.';
    }
    if (message.capturedPageAttempted !== undefined &&
        typeof message.capturedPageAttempted !== 'boolean') {
      return 'Summarize capturedPageAttempted must be a boolean.';
    }
    return null;
  }

  function validateResendSummary(message) {
    return validId(message.summaryId, { optional: true })
      ? null
      : 'Summary id is malformed.';
  }

  function validateProviderHandoffResult(message) {
    if (!validId(message.providerId, { provider: true })) return 'Provider id is malformed.';
    if (!validId(message.handoffId)) return 'Handoff id is malformed.';
    if (!validId(message.summaryId, { optional: true })) return 'Summary id is malformed.';
    if (typeof message.ok !== 'boolean') return 'Provider result must include an ok boolean.';
    if (!validOptionalString(message.error, 2000)) return 'Provider error is malformed.';
    return null;
  }

  function validateClaimProviderHandoff(message) {
    if (!validId(message.providerId, { provider: true })) return 'Provider id is malformed.';
    if (!validId(message.handoffId)) return 'Handoff id is malformed.';
    return null;
  }

  function validateInsertPrompt(message) {
    const handoff = message.handoff;
    const hasLegacyPrompt = typeof message.prompt === 'string' && message.prompt.length > 0;
    const hasHandoff = handoff &&
      validId(handoff.id) &&
      validId(handoff.providerId, { provider: true }) &&
      typeof handoff.promptText === 'string' &&
      handoff.promptText.length > 0;

    if (!hasHandoff && !hasLegacyPrompt) {
      return 'Prompt handoff is malformed.';
    }
    if (!validOptionalString(message.prompt, 1000000) ||
        !validOptionalString(message.title, 2000)) {
      return 'Prompt handoff text is malformed or too large.';
    }
    return null;
  }

  function validateTranscriptStatus(message) {
    if (typeof message.status !== 'string' || message.status.length > 1000) {
      return 'Transcript status text is malformed.';
    }
    if (typeof message.isLoading !== 'boolean') {
      return 'Transcript loading state must be a boolean.';
    }
    return null;
  }

  function validatePdfExtraction(message) {
    if (!validHttpUrl(message.url)) return 'PDF extraction URL must use HTTP or HTTPS.';
    if (message.maxBytes !== undefined &&
        (!Number.isFinite(message.maxBytes) || message.maxBytes <= 0)) {
      return 'PDF extraction byte limit is invalid.';
    }
    if (message.timeoutMs !== undefined &&
        (!Number.isFinite(message.timeoutMs) || message.timeoutMs <= 0)) {
      return 'PDF extraction timeout is invalid.';
    }
    return null;
  }

  const validators = {
    [ACTIONS.SUMMARIZE]: validateSummarize,
    [ACTIONS.RESEND_SUMMARY]: validateResendSummary,
    [ACTIONS.PROVIDER_HANDOFF_RESULT]: validateProviderHandoffResult,
    [ACTIONS.CLAIM_PROVIDER_HANDOFF]: validateClaimProviderHandoff,
    [ACTIONS.INSERT_PROMPT]: validateInsertPrompt,
    [ACTIONS.TRANSCRIPT_STATUS]: validateTranscriptStatus,
    [ACTIONS.EXTRACT_PDF_TEXT_IN_OFFSCREEN]: validatePdfExtraction
  };

  function validateMessage(message, allowedActions = null) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return { ok: false, error: 'Message must be an object.' };
    }
    if (typeof message.action !== 'string' || !ACTION_VALUES.has(message.action)) {
      return { ok: false, error: 'Message action is unknown.' };
    }
    if (allowedActions && !allowedActions.includes(message.action)) {
      return { ok: false, error: 'Message action is not handled in this context.' };
    }

    const error = validators[message.action]?.(message) || null;
    return error ? { ok: false, action: message.action, error } : {
      ok: true,
      action: message.action
    };
  }

  function assertValidMessage(message, allowedActions = null) {
    const result = validateMessage(message, allowedActions);
    if (!result.ok) throw new TypeError(result.error);
    return message;
  }

  function respondOnce(sendResponse) {
    let responded = false;
    return (response) => {
      if (responded || typeof sendResponse !== 'function') return false;
      responded = true;
      sendResponse(response);
      return true;
    };
  }

  function normalizeTimeout(timeoutMs) {
    const value = Number(timeoutMs);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_TIMEOUT_MS;
  }

  function createTimeoutError(context, timeoutMs) {
    const error = new Error(`${context} timed out after ${timeoutMs} ms.`);
    error.name = 'TimeoutError';
    error.userMessage = 'Cindra did not receive a browser response in time.';
    return error;
  }

  function sendWithCallback(invoke, {
    context,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    runtime = root.chrome?.runtime
  }) {
    const normalizedTimeout = normalizeTimeout(timeoutMs);

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      const resolveOnce = finish(resolve);
      const rejectOnce = finish(reject);
      const timer = setTimeout(() => {
        rejectOnce(createTimeoutError(context, normalizedTimeout));
      }, normalizedTimeout);

      try {
        invoke((response) => {
          const lastError = runtime?.lastError;
          if (lastError) {
            rejectOnce(errors.fromChromeLastError(lastError, context));
            return;
          }
          resolveOnce(response);
        });
      } catch (error) {
        rejectOnce(errors.wrap(context, error, 'Cindra could not communicate with the browser.'));
      }
    });
  }

  function runtimeSendMessage(message, options = {}) {
    assertValidMessage(message);
    const runtime = options.runtime || root.chrome?.runtime;
    if (!runtime?.sendMessage) {
      return Promise.reject(new Error('chrome.runtime.sendMessage is unavailable.'));
    }

    return sendWithCallback(
      callback => runtime.sendMessage(message, callback),
      {
        ...options,
        context: options.context || `runtime message "${message.action}"`,
        runtime
      }
    );
  }

  function tabsSendMessage(tabId, message, options = {}) {
    assertValidMessage(message);
    if (!Number.isInteger(tabId) || tabId < 0) {
      return Promise.reject(new TypeError('Tab id must be a non-negative integer.'));
    }

    const chromeApi = options.chromeApi || root.chrome;
    if (!chromeApi?.tabs?.sendMessage) {
      return Promise.reject(new Error('chrome.tabs.sendMessage is unavailable.'));
    }

    return sendWithCallback(
      callback => chromeApi.tabs.sendMessage(tabId, message, callback),
      {
        ...options,
        context: options.context || `tab ${tabId} message "${message.action}"`,
        runtime: chromeApi.runtime
      }
    );
  }

  return {
    ACTIONS,
    DEFAULT_TIMEOUT_MS,
    assertValidMessage,
    respondOnce,
    runtimeSendMessage,
    tabsSendMessage,
    validHttpUrl,
    validId,
    validateMessage
  };
});
