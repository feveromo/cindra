(function (root, factory) {
  'use strict';

  const dependencies = typeof module === 'object' && module.exports
    ? {
        errors: require('../../lib/errors.js'),
        chromeApi: require('../../lib/chrome.js'),
        messages: require('../../lib/messages.js'),
        providers: require('../../lib/providers.js'),
        inject: require('./inject.js')
      }
    : {
        errors: root.CindraErrors,
        chromeApi: root.CindraChrome,
        messages: root.CindraMessages,
        providers: root.CindraProviders,
        inject: root.CindraInject
      };
  const api = root.CindraProviderRuntime || factory(root, dependencies);
  root.CindraProviderRuntime = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, dependencies) {
  'use strict';

  const { errors, chromeApi, messages, providers, inject } = dependencies;
  if (!errors || !chromeApi || !messages || !inject) {
    throw new TypeError('CindraProviderRuntime dependencies are unavailable.');
  }

  const ACTIONS = messages.ACTIONS;
  const DEFAULT_TTL_MS = 2 * 60 * 1000;
  const DEFAULT_HANDOFF_TIMEOUT_MS = 30000;
  const MAX_COMPLETED_HANDOFFS = 100;
  const registrations = new Map();
  const inFlight = new Map();
  const completed = new Set();
  const completedOrder = [];
  let messageListenerInstalled = false;

  function pendingStorageKey(providerId) {
    return `cindraPendingHandoff:${providerId}`;
  }

  function normalizeError(error, fallback = 'Provider handoff failed.') {
    return errors.debugMessage(error, fallback);
  }

  function contextualError(providerLabel, stage, error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      if (!error.userMessage) {
        error.userMessage = `${providerLabel} could not complete the ${stage} stage.`;
      }
      return error;
    }
    const wrapped = errors.wrap(
      `${providerLabel}: ${stage} failed`,
      error,
      `${providerLabel} could not complete the ${stage} stage.`
    );
    wrapped.stage = stage;
    return wrapped;
  }

  function isFresh(handoff, ttlMs) {
    return Boolean(
      handoff?.promptText &&
      Number.isFinite(handoff?.createdAt) &&
      Date.now() - handoff.createdAt < ttlMs
    );
  }

  function legacyStorageKeys(config) {
    return [
      config.legacyKeys?.prompt,
      config.legacyKeys?.timestamp,
      config.legacyKeys?.title
    ].filter(Boolean);
  }

  function storageGet(keys) {
    return chromeApi.storageGet(root.chrome.storage.local, keys);
  }

  function storageRemove(keys) {
    if (!keys.length) return Promise.resolve();
    return chromeApi.storageRemove(root.chrome.storage.local, keys);
  }

  async function clearMatchingHandoff(config, handoff) {
    const key = pendingStorageKey(config.providerId);
    const state = await storageGet([key]);
    const keys = legacyStorageKeys(config);
    if (!state[key] || state[key].id === handoff.id) keys.push(key);
    await storageRemove(keys);
  }

  async function reportResult(config, handoff, ok, error = null) {
    try {
      await messages.runtimeSendMessage({
        action: ACTIONS.PROVIDER_HANDOFF_RESULT,
        handoffId: handoff.id,
        summaryId: handoff.summaryId || null,
        providerId: config.providerId,
        ok,
        error: error ? normalizeError(error) : null
      }, {
        context: `report ${config.providerId} handoff result`,
        timeoutMs: 5000
      });
    } catch (reportError) {
      if (!/Extension context invalidated/i.test(reportError?.message || '')) {
        errors.logError(`Could not report ${config.providerId} handoff result`, reportError);
      }
    }
  }

  function claimHandoff(config, handoff) {
    if (handoff.id.startsWith('legacy-') || handoff.id.startsWith('legacy-message-')) {
      return Promise.resolve({ success: true, claimed: true });
    }
    return messages.runtimeSendMessage({
      action: ACTIONS.CLAIM_PROVIDER_HANDOFF,
      providerId: config.providerId,
      handoffId: handoff.id
    }, {
      context: `claim ${config.providerId} handoff`,
      timeoutMs: 5000
    }).then(response => response || { success: false, claimed: false });
  }

  function rememberCompleted(handoffId) {
    if (completed.has(handoffId)) return;
    completed.add(handoffId);
    completedOrder.push(handoffId);
    while (completedOrder.length > MAX_COMPLETED_HANDOFFS) {
      completed.delete(completedOrder.shift());
    }
  }

  function createHandoffTimeoutError(config) {
    const seconds = Math.max(1, Math.ceil(config.handoffTimeoutMs / 1000));
    const error = new Error(`${config.providerId} handoff timed out after ${seconds} seconds.`);
    error.name = 'TimeoutError';
    error.userMessage = `${config.providerLabel} did not become ready in time. The prompt remains queued for retry.`;
    return error;
  }

  async function submitWithDeadline(config, handoff) {
    const Controller = root.AbortController || AbortController;
    const controller = new Controller();
    const timeoutError = createHandoffTimeoutError(config);
    const timeout = root.setTimeout(
      () => controller.abort(timeoutError),
      config.handoffTimeoutMs
    );
    const context = {
      signal: controller.signal,
      providerId: config.providerId,
      providerLabel: config.providerLabel,
      handoffId: handoff.id
    };

    const abortPromise = new Promise((resolve, reject) => {
      controller.signal.addEventListener('abort', () => {
        reject(controller.signal.reason instanceof Error
          ? controller.signal.reason
          : inject.createAbortError(controller.signal.reason));
      }, { once: true });
    });
    const submitPromise = Promise.resolve().then(() => config.submitPrompt(
      handoff.promptText,
      handoff.title || '',
      handoff,
      context
    ));

    try {
      await Promise.race([submitPromise, abortPromise]);
      inject.throwIfAborted(controller.signal);
    } finally {
      root.clearTimeout(timeout);
    }
  }

  async function processHandoff(config, handoff) {
    if (!handoff?.promptText) throw new Error('No prompt provided.');
    if (typeof handoff.id !== 'string' || !handoff.id) {
      throw new Error('Provider handoff is missing an id.');
    }
    if (handoff.providerId && handoff.providerId !== config.providerId) {
      throw new Error(
        `Provider handoff mismatch: expected ${config.providerId}, received ${handoff.providerId}.`
      );
    }

    if (completed.has(handoff.id)) {
      await clearMatchingHandoff(config, handoff);
      return { success: true, duplicate: true, handoffId: handoff.id };
    }

    if (inFlight.has(config.providerId)) {
      const activeId = inFlight.get(config.providerId);
      if (activeId === handoff.id) {
        return { success: true, accepted: true, handoffId: handoff.id };
      }
      throw new Error('Another Cindra handoff is already being submitted.');
    }

    if (config.isReady && !config.isReady()) {
      throw new Error(`${config.providerLabel} is not ready for prompt input.`);
    }

    const claim = await claimHandoff(config, handoff);
    if (!claim.success) throw new Error(claim.error || 'Could not claim the pending handoff.');
    if (!claim.claimed) {
      return { success: true, accepted: true, claimedElsewhere: true, handoffId: handoff.id };
    }

    inFlight.set(config.providerId, handoff.id);
    try {
      await submitWithDeadline(config, handoff);
      rememberCompleted(handoff.id);
      await clearMatchingHandoff(config, handoff);
      await reportResult(config, handoff, true);
      return { success: true, handoffId: handoff.id };
    } catch (error) {
      const contextual = contextualError(config.providerLabel, 'submitting the prompt', error);
      await reportResult(config, handoff, false, contextual);
      throw contextual;
    } finally {
      if (inFlight.get(config.providerId) === handoff.id) inFlight.delete(config.providerId);
    }
  }

  function handoffFromMessage(config, message) {
    if (message.handoff?.providerId && message.handoff.providerId !== config.providerId) return null;
    if (message.handoff?.promptText) return message.handoff;
    if (!message.prompt) return null;
    return {
      id: `legacy-message-${config.providerId}-${Date.now()}`,
      providerId: config.providerId,
      promptText: message.prompt,
      title: message.title || '',
      createdAt: Date.now()
    };
  }

  function installMessageListener() {
    if (messageListenerInstalled || !root.chrome?.runtime?.onMessage) return;
    messageListenerInstalled = true;

    root.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.action !== ACTIONS.INSERT_PROMPT) return false;
      const respond = messages.respondOnce(sendResponse);
      const validation = messages.validateMessage(message, [ACTIONS.INSERT_PROMPT]);
      if (!validation.ok) {
        respond({ success: false, error: validation.error });
        return false;
      }

      const requestedProvider = message.handoff?.providerId;
      const config = requestedProvider
        ? registrations.get(requestedProvider)
        : registrations.values().next().value;
      const handoff = config ? handoffFromMessage(config, message) : null;
      if (!config || !handoff) {
        respond({ success: false, error: 'No matching provider adapter is registered.' });
        return false;
      }

      processHandoff(config, handoff)
        .then(respond)
        .catch(error => respond({
          success: false,
          handoffId: handoff.id,
          error: normalizeError(error)
        }));
      return true;
    });
  }

  async function readPendingHandoff(config) {
    const key = pendingStorageKey(config.providerId);
    const legacyKeys = legacyStorageKeys(config);
    const state = await storageGet([key, ...legacyKeys]);
    const current = state[key];

    if (current) {
      if (isFresh(current, config.ttlMs)) return current;
      await storageRemove([key]);
    }

    const prompt = config.legacyKeys?.prompt && state[config.legacyKeys.prompt];
    const createdAt = config.legacyKeys?.timestamp && state[config.legacyKeys.timestamp];
    if (!prompt) return null;
    if (!createdAt || Date.now() - createdAt >= config.ttlMs) {
      await storageRemove(legacyKeys);
      return null;
    }

    return {
      id: `legacy-${config.providerId}-${createdAt}`,
      providerId: config.providerId,
      promptText: prompt,
      title: config.legacyKeys?.title ? state[config.legacyKeys.title] || '' : '',
      createdAt
    };
  }

  async function runPending(providerId) {
    const config = registrations.get(providerId);
    if (!config) return { success: false, error: 'Provider adapter is not registered.' };
    if (config.isReady && !config.isReady()) return { success: false, notReady: true };

    try {
      const handoff = await readPendingHandoff(config);
      if (!handoff) return { success: false, empty: true };
      return await processHandoff(config, handoff);
    } catch (error) {
      errors.logError(`${providerId} pending handoff failed`, error);
      return { success: false, error: normalizeError(error) };
    }
  }

  function schedulePending(config) {
    if (!root.document) return;
    const run = () => root.setTimeout(() => void runPending(config.providerId), config.startupDelayMs);
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      run();
    }
  }

  function getProviderMetadata(providerId) {
    return providers?.getProviderStrict?.(providerId) || null;
  }

  function getLegacyKeys(providerId, options) {
    return options.legacyKeys || providers?.getLegacyStorageKeys?.(providerId) || {};
  }

  function callInsertPrompt(handler, context) {
    return handler.length >= 2
      ? handler(context.input, context.prompt, context)
      : handler(context);
  }

  function createSubmitPrompt(options) {
    if (!options?.providerId || (!options.inputSelectors && !options.findInput)) {
      throw new Error('CindraProviderRuntime adapter requires providerId and an input resolver.');
    }

    const providerId = options.providerId;
    const providerLabel = getProviderMetadata(providerId)?.label || providerId;

    return async function submitPrompt(prompt, title, handoff, runtimeContext = {}) {
      if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('No prompt provided.');
      const context = {
        ...runtimeContext,
        providerId,
        providerLabel,
        prompt,
        title,
        handoff,
        input: null,
        submitControl: null,
        helpers: inject,
        options
      };

      try {
        inject.throwIfAborted(context.signal);
        await options.beforeInput?.(context);
        await options.beforeInsert?.(context);
        inject.throwIfAborted(context.signal);
        context.input = options.findInput
          ? await options.findInput(context)
          : await inject.waitForElement(options.inputSelectors, {
              timeoutMs: options.inputTimeoutMs ?? 10000,
              signal: context.signal,
              description: `${providerLabel} prompt input`
            });
        if (!context.input) throw new Error('Composer input was not found.');
      } catch (error) {
        throw contextualError(providerLabel, 'finding the composer', error);
      }

      try {
        inject.throwIfAborted(context.signal);
        if (typeof options.insertPrompt === 'function') {
          await callInsertPrompt(options.insertPrompt, context);
        } else {
          inject.insertText(context.input, prompt, options.contentEditable || {});
        }
        inject.throwIfAborted(context.signal);
        await options.afterInsert?.(context);
        const settleMs = options.settleMs ?? options.settleDelayMs ?? 0;
        if (settleMs) await inject.sleep(settleMs, context.signal);
        inject.throwIfAborted(context.signal);
      } catch (error) {
        throw contextualError(providerLabel, 'inserting the prompt', error);
      }

      try {
        if (typeof options.findSubmit === 'function') {
          context.submitControl = await options.findSubmit(context);
        } else if (options.submitSelectors) {
          try {
            context.submitControl = await inject.waitForElement(options.submitSelectors, {
              timeoutMs: options.submitTimeoutMs ?? 5000,
              signal: context.signal,
              predicate: options.submitPredicate || inject.isUsableControl,
              description: `${providerLabel} submit control`
            });
          } catch (error) {
            if (
              !options.fallbackSubmit ||
              context.signal?.aborted ||
              !inject.isTimeoutError(error)
            ) {
              throw error;
            }
          }
        }

        inject.throwIfAborted(context.signal);
        if (context.submitControl) {
          if (typeof options.submit === 'function') {
            await options.submit(context);
          } else if (options.clickMode === 'native') {
            inject.nativeClick(context.submitControl);
          } else {
            inject.robustClick(context.submitControl);
          }
        } else if (typeof options.fallbackSubmit === 'function') {
          await options.fallbackSubmit(context);
        } else if (!options.submitOptional) {
          throw new Error('Send control was not found.');
        }
        inject.throwIfAborted(context.signal);
        await options.afterSubmit?.(context);
        inject.throwIfAborted(context.signal);
      } catch (error) {
        throw contextualError(providerLabel, 'submitting the prompt', error);
      }
    };
  }

  function normalizeRegistration(options) {
    if (!options?.providerId || typeof options.submitPrompt !== 'function') {
      throw new Error('CindraProviderRuntime requires providerId and submitPrompt.');
    }
    const provider = getProviderMetadata(options.providerId);
    return {
      ttlMs: DEFAULT_TTL_MS,
      startupDelayMs: provider?.startupDelayMs ?? 250,
      handoffTimeoutMs: DEFAULT_HANDOFF_TIMEOUT_MS,
      legacyKeys: getLegacyKeys(options.providerId, options),
      providerLabel: provider?.label || options.providerId,
      ...options
    };
  }

  function register(options) {
    const config = normalizeRegistration(options);
    if (registrations.has(config.providerId)) {
      return Object.freeze({ runPending: () => runPending(config.providerId) });
    }
    registrations.set(config.providerId, config);
    installMessageListener();
    schedulePending(config);
    return Object.freeze({ runPending: () => runPending(config.providerId) });
  }

  function registerAdapter(options) {
    const submitPrompt = typeof options?.submitPrompt === 'function'
      ? options.submitPrompt
      : createSubmitPrompt(options);
    return register({ ...options, submitPrompt });
  }

  return Object.freeze({
    DEFAULT_HANDOFF_TIMEOUT_MS,
    DEFAULT_TTL_MS,
    MAX_COMPLETED_HANDOFFS,
    createSubmitPrompt,
    normalizeError,
    pendingStorageKey,
    processHandoff,
    register,
    registerAdapter,
    runPending
  });
});
