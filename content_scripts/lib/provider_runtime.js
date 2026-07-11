(function (root) {
  'use strict';

  if (root.CindraProviderRuntime) {
    return;
  }

  const DEFAULT_TTL_MS = 2 * 60 * 1000;
  const registrations = new Map();
  const inFlight = new Map();
  const completed = new Set();
  let messageListenerInstalled = false;

  function pendingStorageKey(providerId) {
    return `cindraPendingHandoff:${providerId}`;
  }

  function normalizeError(error) {
    return error?.message || String(error || 'Provider handoff failed.');
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
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result || {});
      });
    });
  }

  function storageRemove(keys) {
    if (!keys.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
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

  function reportResult(config, handoff, ok, error = null) {
    try {
      chrome.runtime.sendMessage({
        action: 'providerHandoffResult',
        handoffId: handoff.id,
        summaryId: handoff.summaryId || null,
        providerId: config.providerId,
        ok,
        error: error ? normalizeError(error) : null
      }, () => {
        void chrome.runtime.lastError;
      });
    } catch (reportError) {
      // A hot-reloaded extension can invalidate this content-script context.
    }
  }

  function claimHandoff(config, handoff) {
    if (handoff.id.startsWith('legacy-') || handoff.id.startsWith('legacy-message-')) {
      return Promise.resolve({ success: true, claimed: true });
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'claimProviderHandoff',
        providerId: config.providerId,
        handoffId: handoff.id
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response || { success: false, claimed: false });
      });
    });
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
      completed.add(handoff.id);
      await clearMatchingHandoff(config, handoff);
      reportResult(config, handoff, true);
      return { success: true, handoffId: handoff.id };
    } catch (error) {
      reportResult(config, handoff, false, error);
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

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.action !== 'insertPrompt') return false;

      const requestedProvider = message.handoff?.providerId;
      const config = requestedProvider
        ? registrations.get(requestedProvider)
        : registrations.values().next().value;
      const handoff = config ? handoffFromMessage(config, message) : null;

      if (!config || !handoff) {
        sendResponse({ success: false, error: 'No matching provider adapter is registered.' });
        return false;
      }

      processHandoff(config, handoff)
        .then(sendResponse)
        .catch(error => sendResponse({
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
      console.error(`Cindra ${providerId} pending handoff failed:`, error);
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

  function register(options) {
    if (!options?.providerId || typeof options.submitPrompt !== 'function') {
      throw new Error('CindraProviderRuntime requires providerId and submitPrompt.');
    }

    const config = {
      ttlMs: DEFAULT_TTL_MS,
      startupDelayMs: 250,
      legacyKeys: {},
      ...options
    };
    registrations.set(config.providerId, config);
    installMessageListener();
    schedulePending(config);
    return { runPending: () => runPending(config.providerId) };
  }

  root.CindraProviderRuntime = {
    DEFAULT_TTL_MS,
    pendingStorageKey,
    register,
    runPending
  };
})(globalThis);
