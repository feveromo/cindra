(function (root) {
  'use strict';

  if (root.CindraBackgroundHandoffs) return;

  const chromeApi = root.CindraChrome;
  const messages = root.CindraMessages;
  const errors = root.CindraErrors;
  const ACTIONS = messages?.ACTIONS;
  const MAX_RECENT_SUMMARIES = 5;
  const MAX_PDF_PROMPT_CONTENT_CHARS = 220000;
  const HANDOFF_TTL_MS = 2 * 60 * 1000;
  const CLAIM_TTL_MS = 30000;

  function create({ providerRegistry, promptBuilder, onError }) {
    if (!chromeApi || !messages || !errors || !providerRegistry || !promptBuilder) {
      throw new TypeError('Background handoffs require Chrome, message, error, provider, and prompt helpers.');
    }

    let claimQueue = Promise.resolve();
    let historyQueue = Promise.resolve();

    function setStatus(state, message, details = {}) {
      const normalizedState = ['idle', 'working', 'success', 'error'].includes(state)
        ? state
        : 'error';
      const status = {
        state: normalizedState,
        message: errors.cleanMessage(message),
        updatedAt: Date.now(),
        ...details
      };
      return chromeApi.storageSet(root.chrome.storage.local, {
        cindraLastStatus: status
      }).catch(error => {
        errors.logError('Could not persist Cindra handoff status', error);
      });
    }

    function fail(message, error = null) {
      if (error) errors.logError(message, error);
      if (typeof onError === 'function') onError(message);
      else void setStatus('error', message);
    }

    function createRecentSummary(model, promptText, title, url, sourceType) {
      return {
        id: `summary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        model,
        promptText,
        title: title || 'Untitled',
        url: url || '',
        sourceType: sourceType || 'page',
        createdAt: Date.now()
      };
    }

    function saveRecentSummary(summary) {
      const run = async () => {
        const settings = await chromeApi.storageGet(root.chrome.storage.sync, {
          promptHistory: 'enabled'
        });
        if (settings.promptHistory === 'disabled') {
          await chromeApi.storageRemove(root.chrome.storage.local, ['cindraRecentSummaries']);
          return;
        }

        const items = await chromeApi.storageGet(root.chrome.storage.local, {
          cindraRecentSummaries: []
        });
        const existing = Array.isArray(items.cindraRecentSummaries)
          ? items.cindraRecentSummaries
          : [];
        const summaries = [summary, ...existing]
          .filter((item, index, all) => all.findIndex(other => other.id === item.id) === index)
          .slice(0, MAX_RECENT_SUMMARIES);
        await chromeApi.storageSet(root.chrome.storage.local, {
          cindraRecentSummaries: summaries
        });
      };

      const result = historyQueue.then(run, run);
      historyQueue = result.catch(error => {
        errors.logError('Could not save recent Cindra prompt', error);
      });
      return result;
    }

    function sendToSelectedModel(
      model,
      prompt,
      content,
      title,
      url = null,
      channel = null,
      description = null,
      sourceType = 'page'
    ) {
      const provider = providerRegistry.getProvider(model);
      const options = provider.id === 'chatgpt'
        ? { cleaner: value => promptBuilder.cleanupContent(value, 'chatgpt') }
        : {};

      if (provider.maxContentChars) options.maxContentChars = provider.maxContentChars;
      else if (sourceType === 'pdf') options.maxContentChars = MAX_PDF_PROMPT_CONTENT_CHARS;

      const { promptText } = promptBuilder.buildSummaryPrompt(
        prompt,
        content,
        title,
        url,
        channel,
        description,
        options
      );
      const recentSummary = createRecentSummary(provider.id, promptText, title, url, sourceType);

      void saveRecentSummary(recentSummary);
      void setStatus('working', `Opening ${provider.label}...`, {
        model: provider.id,
        title,
        url,
        sourceType,
        summaryId: recentSummary.id
      });
      void openPreparedPrompt(provider.id, promptText, title, {
        title,
        url,
        sourceType,
        summaryId: recentSummary.id
      });
      return recentSummary;
    }

    function createPendingHandoff(provider, promptText, title, metadata = {}) {
      return {
        id: `handoff_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        summaryId: metadata.summaryId || null,
        providerId: provider.id,
        promptText,
        title: title || '',
        createdAt: Date.now()
      };
    }

    async function setPendingPrompt(provider, promptText, title, metadata) {
      const handoff = createPendingHandoff(provider, promptText, title, metadata);
      const payload = {
        [providerRegistry.getPendingStorageKey(provider.id)]: handoff,
        [provider.pendingPromptKey]: promptText,
        [provider.timestampKey]: handoff.createdAt
      };
      if (provider.pendingTitleKey) payload[provider.pendingTitleKey] = title || '';
      await chromeApi.storageSet(root.chrome.storage.local, payload);
      return handoff;
    }

    async function openProviderTab(provider) {
      if (provider.reuseTab) {
        const tabs = await chromeApi.tabsQuery({ url: `${provider.targetUrl}*` });
        if (tabs.length) {
          return chromeApi.tabsUpdate(tabs[0].id, {
            active: true,
            url: provider.targetUrl
          });
        }
      }
      return chromeApi.tabsCreate({ url: provider.targetUrl, active: true });
    }

    async function openPreparedPrompt(providerId, promptText, title, metadata = {}) {
      const provider = providerRegistry.getProvider(providerId);
      let handoff;
      try {
        handoff = await setPendingPrompt(provider, promptText, title, metadata);
      } catch (error) {
        fail(`Could not save prompt for ${provider.label}.`, error);
        return null;
      }

      let tab;
      try {
        tab = await openProviderTab(provider);
      } catch (error) {
        fail(`Could not open ${provider.label}. The prompt remains queued for retry.`, error);
        return handoff;
      }

      void setStatus('working', `Opened ${provider.label}; submitting prompt...`, {
        ...metadata,
        model: provider.id,
        targetUrl: provider.targetUrl,
        handoffId: handoff.id
      });

      if (provider.retryDelayMs && Number.isInteger(tab?.id)) {
        root.setTimeout(() => {
          void sendMessageWithRetry(tab.id, {
            action: ACTIONS.INSERT_PROMPT,
            handoff,
            prompt: promptText,
            title
          }).then(result => handleDeliveryResult(provider, handoff, result, metadata));
        }, provider.retryDelayMs);
      }
      return handoff;
    }

    function resendSummary(summaryId, sendResponse = () => {}) {
      const respond = messages.respondOnce(sendResponse);
      void (async () => {
        try {
          const items = await chromeApi.storageGet(root.chrome.storage.local, {
            cindraRecentSummaries: []
          });
          const summaries = Array.isArray(items.cindraRecentSummaries)
            ? items.cindraRecentSummaries
            : [];
          const summary = summaries.find(item => item.id === summaryId) || summaries[0];
          if (!summary?.promptText) {
            void setStatus('error', 'No saved prompt to resend.');
            respond({ success: false, error: 'No saved prompt to resend.' });
            return;
          }

          const provider = providerRegistry.getProvider(summary.model);
          void setStatus('working', `Resending to ${provider.label}...`, {
            model: provider.id,
            title: summary.title,
            url: summary.url,
            sourceType: summary.sourceType,
            summaryId: summary.id
          });
          respond({ success: true, accepted: true });
          await openPreparedPrompt(provider.id, summary.promptText, summary.title, {
            title: summary.title,
            url: summary.url,
            sourceType: summary.sourceType,
            summaryId: summary.id
          });
        } catch (error) {
          errors.logError('Could not resend recent Cindra prompt', error);
          void setStatus('error', 'Could not resend the saved prompt.');
          respond({ success: false, error: 'Could not resend the saved prompt.' });
        }
      })();
    }

    function handleProviderHandoffResult(message) {
      const provider = providerRegistry.getProvider(message.providerId);
      const details = {
        model: provider.id,
        summaryId: message.summaryId || null,
        handoffId: message.handoffId || null
      };
      if (message.ok) {
        void setStatus('success', `Prompt submitted to ${provider.label}.`, details);
      } else {
        void setStatus(
          'error',
          `${provider.label} could not submit the prompt. ${message.error || 'The prompt remains queued for retry.'}`,
          details
        );
      }
    }

    function handleDeliveryResult(provider, handoff, result, metadata = {}) {
      const details = {
        ...metadata,
        model: provider.id,
        targetUrl: provider.targetUrl,
        handoffId: handoff.id
      };
      if (result?.response?.success) {
        void setStatus('success', `Prompt submitted to ${provider.label}.`, details);
      } else if (result?.delivered && result.response?.error) {
        void setStatus(
          'error',
          `${provider.label} could not submit the prompt. ${result.response.error}`,
          details
        );
      } else {
        void setStatus(
          'working',
          `${provider.label} will pick up the queued prompt when its composer is ready.`,
          details
        );
      }
    }

    async function sendMessageWithRetry(tabId, message, attempt = 1, maxAttempts = 5) {
      try {
        const tab = await chromeApi.tabsGet(tabId);
        if (!tab) return { delivered: false, response: null };
        const response = await messages.tabsSendMessage(tabId, message, {
          context: `deliver ${message.handoff?.providerId || 'provider'} handoff`,
          timeoutMs: 10000
        });
        return { delivered: true, response: response || null };
      } catch (error) {
        if (attempt >= maxAttempts) {
          errors.logError(`Provider handoff delivery exhausted for tab ${tabId}`, error);
          return { delivered: false, response: null };
        }
        const retryTime = Math.min(2 ** (attempt - 1) * 500, 5000);
        await new Promise(resolve => root.setTimeout(resolve, retryTime));
        return sendMessageWithRetry(tabId, message, attempt + 1, maxAttempts);
      }
    }

    function claimProviderHandoff(message, sender) {
      const run = async () => {
        const provider = providerRegistry.getProvider(message.providerId);
        const key = providerRegistry.getPendingStorageKey(provider.id);
        const state = await chromeApi.storageGet(root.chrome.storage.local, [key]);
        const handoff = state[key];
        if (!handoff || handoff.id !== message.handoffId) {
          return { success: false, claimed: false, error: 'Pending handoff no longer matches.' };
        }
        if (!Number.isFinite(handoff.createdAt) || Date.now() - handoff.createdAt >= HANDOFF_TTL_MS) {
          await chromeApi.storageRemove(root.chrome.storage.local, [key]);
          return { success: false, claimed: false, error: 'Pending handoff expired.' };
        }

        const tabId = sender.tab?.id || null;
        const claimIsFresh = handoff.claimedAt && Date.now() - handoff.claimedAt < CLAIM_TTL_MS;
        if (claimIsFresh && handoff.claimedByTabId !== tabId) {
          return { success: true, claimed: false, claimedByTabId: handoff.claimedByTabId };
        }

        await chromeApi.storageSet(root.chrome.storage.local, {
          [key]: { ...handoff, claimedByTabId: tabId, claimedAt: Date.now() }
        });
        return { success: true, claimed: true };
      };

      const result = claimQueue.then(run, run);
      claimQueue = result.catch(error => {
        errors.logError('Provider handoff claim queue failed', error);
      });
      return result;
    }

    return {
      claimProviderHandoff,
      handleProviderHandoffResult,
      resendSummary,
      sendToSelectedModel,
      setStatus
    };
  }

  root.CindraBackgroundHandoffs = { create };
})(globalThis);
