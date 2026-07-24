(function (root) {
  'use strict';

  if (root.CindraProviderRuntime) {
    return;
  }

  const errors = root.CindraErrors;
  const chromeApi = root.CindraChrome;
  const messages = root.CindraMessages;
  if (!errors || !chromeApi || !messages) {
    console.error('[Cindra] Provider runtime dependencies are unavailable.');
    return;
  }
  const ACTIONS = messages.ACTIONS;
  const DEFAULT_TTL_MS = 2 * 60 * 1000;
  const MAX_COMPLETED_HANDOFFS = 50;
  const registrations = new Map();
  const inFlight = new Map();
  const completed = new Set();
  let messageListenerInstalled = false;

  function pendingStorageKey(providerId) {
    return `cindraPendingHandoff:${providerId}`;
  }

  function normalizeError(error) {
    return errors.debugMessage(error, 'Provider handoff failed.');
  }

  function contextualError(providerId, stage, error) {
    const cause = errors.toError(error, 'Provider handoff failed.');
    const contextual = errors.wrap(
      `${providerId}: ${stage} failed`,
      cause,
      `${providerId} could not complete the ${stage} stage.`
    );
    contextual.message = `${providerId}: ${stage} failed. ${cause.message}`;
    return contextual;
  }

  function isFresh(handoff, ttlMs) {
    return Boolean(
      handoff?.promptText &&
      handoff?.createdAt &&
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

    if (!state[key] || state[key].id === handoff.id) {
      keys.push(key);
    }

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
      // Prompt submission already finished. A stale or reloaded extension
      // context must not turn a successful provider action into a retry loop.
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

  async function processHandoff(config, handoff) {
    if (!handoff?.promptText) {
      throw new Error('No prompt provided.');
    }

    if (completed.has(handoff.id)) {
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
      throw new Error(`${config.providerId} is not ready for prompt input.`);
    }

    const claim = await claimHandoff(config, handoff);
    if (!claim.success) {
      throw new Error(claim.error || 'Could not claim the pending handoff.');
    }
    if (!claim.claimed) {
      return { success: true, accepted: true, claimedElsewhere: true, handoffId: handoff.id };
    }

    inFlight.set(config.providerId, handoff.id);
    try {
      await config.submitPrompt(handoff.promptText, handoff.title || '', handoff);
      if (completed.size >= MAX_COMPLETED_HANDOFFS) {
        completed.delete(completed.values().next().value);
      }
      completed.add(handoff.id);
      await clearMatchingHandoff(config, handoff);
      await reportResult(config, handoff, true);
      return { success: true, handoffId: handoff.id };
    } catch (error) {
      await reportResult(config, handoff, false, error);
      throw error;
    } finally {
      if (inFlight.get(config.providerId) === handoff.id) {
        inFlight.delete(config.providerId);
      }
    }
  }

  function handoffFromMessage(config, message) {
    if (message.handoff?.providerId && message.handoff.providerId !== config.providerId) {
      return null;
    }

    if (message.handoff?.promptText) {
      return message.handoff;
    }

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
    if (messageListenerInstalled) return;
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
    if (config.isReady && !config.isReady()) {
      return { success: false, notReady: true };
    }

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
    const run = () => setTimeout(() => runPending(config.providerId), config.startupDelayMs);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      run();
    }
  }

  function getProviderMetadata(providerId) {
    return root.CindraProviders?.getProviderStrict?.(providerId) || null;
  }

  function getLegacyKeys(providerId, options) {
    return options.legacyKeys ||
      root.CindraProviders?.getLegacyStorageKeys?.(providerId) ||
      {};
  }

  function createSubmitPrompt(options) {
    if (!options?.providerId) {
      throw new Error('CindraProviderRuntime adapter requires providerId.');
    }

    const providerId = options.providerId;
    const providerLabel = getProviderMetadata(providerId)?.label || providerId;

    return async function submitPrompt(prompt, title, handoff) {
      if (typeof prompt !== 'string' || !prompt.trim()) {
        throw new Error('No prompt provided.');
      }

      const context = {
        providerId,
        providerLabel,
        prompt,
        title,
        handoff,
        input: null,
        submitControl: null,
        helpers: root.CindraInject
      };

      try {
        if (typeof options.beforeInput === 'function') {
          await options.beforeInput(context);
        }

        if (typeof options.findInput === 'function') {
          context.input = await options.findInput(context);
        } else if (options.inputSelectors) {
          context.input = await root.CindraInject.waitForElement(
            options.inputSelectors,
            options.inputTimeoutMs ?? 10000
          );
        }

        if (!context.input) {
          throw new Error('Composer input was not found.');
        }
      } catch (error) {
        throw contextualError(providerLabel, 'finding the composer', error);
      }

      try {
        if (typeof options.insertPrompt === 'function') {
          await options.insertPrompt(context);
        } else if (context.input.getAttribute?.('contenteditable') === 'true') {
          root.CindraInject.insertTextIntoContentEditable(context.input, prompt);
        } else {
          root.CindraInject.insertTextIntoTextarea(context.input, prompt);
        }

        if (typeof options.afterInsert === 'function') {
          await options.afterInsert(context);
        }
        if (options.settleMs) {
          await root.CindraInject.delay(options.settleMs);
        }
      } catch (error) {
        throw contextualError(providerLabel, 'inserting the prompt', error);
      }

      try {
        if (typeof options.findSubmit === 'function') {
          context.submitControl = await options.findSubmit(context);
        } else if (options.submitSelectors) {
          context.submitControl = await root.CindraInject.waitForElement(
            options.submitSelectors,
            options.submitTimeoutMs ?? 10000
          ).catch((error) => {
            if (options.fallbackSubmit || options.submitOptional) return null;
            throw error;
          });
        }

        if (context.submitControl) {
          if (typeof options.submit === 'function') {
            await options.submit(context);
          } else {
            root.CindraInject.robustClick(context.submitControl);
          }
        } else if (typeof options.fallbackSubmit === 'function') {
          await options.fallbackSubmit(context);
        } else if (!options.submitOptional) {
          throw new Error('Send control was not found.');
        }

        if (typeof options.afterSubmit === 'function') {
          await options.afterSubmit(context);
        }
      } catch (error) {
        throw contextualError(providerLabel, 'submitting the prompt', error);
      }
    };
  }

  function register(options) {
    if (!options?.providerId || typeof options.submitPrompt !== 'function') {
      throw new Error('CindraProviderRuntime requires providerId and submitPrompt.');
    }

    const provider = getProviderMetadata(options.providerId);
    const config = {
      ttlMs: DEFAULT_TTL_MS,
      startupDelayMs: provider?.startupDelayMs ?? 250,
      legacyKeys: getLegacyKeys(options.providerId, options),
      ...options
    };

    if (registrations.has(config.providerId)) {
      return { runPending: () => runPending(config.providerId) };
    }

    registrations.set(config.providerId, config);
    installMessageListener();
    schedulePending(config);
    return { runPending: () => runPending(config.providerId) };
  }

  function registerAdapter(options) {
    const submitPrompt = typeof options?.submitPrompt === 'function'
      ? options.submitPrompt
      : createSubmitPrompt(options);
    return register({ ...options, submitPrompt });
  }

  root.CindraProviderRuntime = {
    DEFAULT_TTL_MS,
    createSubmitPrompt,
    normalizeError,
    pendingStorageKey,
    register,
    registerAdapter,
    runPending
  };
})(globalThis);
