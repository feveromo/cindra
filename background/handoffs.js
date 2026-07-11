(function (root) {
  'use strict';

  const MAX_RECENT_SUMMARIES = 5;
  const MAX_PDF_PROMPT_CONTENT_CHARS = 220000;
  const CEREBRAS_CLOUD_TAB_URL_PATTERN = 'https://cloud.cerebras.ai/*';
  const CEREBRAS_PLAYGROUND_TAB_URL_PATTERN = 'https://cloud.cerebras.ai/*/playground*';

  function create({ providerRegistry, promptBuilder, onError }) {
    let claimQueue = Promise.resolve();

    function setStatus(state, message, details = {}) {
      chrome.storage.local.set({
        cindraLastStatus: {
          state,
          message,
          updatedAt: Date.now(),
          ...details
        }
      });
    }

    function fail(message) {
      if (typeof onError === 'function') onError(message);
      else setStatus('error', message);
    }

    function createRecentSummary(model, promptText, title, url, sourceType) {
      return {
        id: 'summary_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        model,
        promptText,
        title: title || 'Untitled',
        url: url || '',
        sourceType: sourceType || 'page',
        createdAt: Date.now()
      };
    }

    function saveRecentSummary(summary) {
      chrome.storage.sync.get({ promptHistory: 'enabled' }, (settings) => {
        if (settings.promptHistory === 'disabled') {
          chrome.storage.local.remove('cindraRecentSummaries');
          return;
        }

        chrome.storage.local.get({ cindraRecentSummaries: [] }, (items) => {
          const summaries = [summary, ...(items.cindraRecentSummaries || [])]
            .filter((item, index, all) => all.findIndex(other => other.id === item.id) === index)
            .slice(0, MAX_RECENT_SUMMARIES);
          chrome.storage.local.set({ cindraRecentSummaries: summaries });
        });
      });
    }

    function sendToSelectedModel(model, prompt, content, title, url = null, channel = null, description = null, sourceType = 'page') {
      const provider = providerRegistry.getProvider(model);
      const options = provider.id === 'chatgpt'
        ? { cleaner: contentValue => promptBuilder.cleanupContent(contentValue, 'chatgpt') }
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

      saveRecentSummary(recentSummary);
      setStatus('working', `Opening ${provider.label}...`, {
        model: provider.id,
        title,
        url,
        sourceType,
        summaryId: recentSummary.id
      });
      openPreparedPrompt(provider.id, promptText, title, {
        title,
        url,
        sourceType,
        summaryId: recentSummary.id
      });
    }

    function createPendingHandoff(provider, promptText, title, metadata = {}) {
      return {
        id: 'handoff_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
        summaryId: metadata.summaryId || null,
        providerId: provider.id,
        promptText,
        title: title || '',
        createdAt: Date.now()
      };
    }

    function setPendingPrompt(provider, promptText, title, metadata, callback) {
      const handoff = createPendingHandoff(provider, promptText, title, metadata);
      const payload = {
        [providerRegistry.getPendingStorageKey(provider.id)]: handoff,
        [provider.pendingPromptKey]: promptText,
        [provider.timestampKey]: handoff.createdAt
      };
      if (provider.pendingTitleKey) payload[provider.pendingTitleKey] = title || '';
      chrome.storage.local.set(payload, () => callback(handoff));
    }

    function openPreparedPrompt(providerId, promptText, title, metadata = {}) {
      const provider = providerRegistry.getProvider(providerId);
      if (provider.specialOpen === 'cerebras-playground') {
        openCerebrasPreparedPrompt(provider, promptText, title, metadata);
        return;
      }

      setPendingPrompt(provider, promptText, title, metadata, (handoff) => {
        if (chrome.runtime.lastError) {
          fail(`Could not save prompt for ${provider.label}.`);
          return;
        }

        const afterOpen = (tab) => {
          setStatus('working', `Opened ${provider.label}; submitting prompt...`, {
            ...metadata,
            model: provider.id,
            targetUrl: provider.targetUrl,
            handoffId: handoff.id
          });

          if (provider.retryDelayMs && tab?.id) {
            setTimeout(() => {
              sendMessageWithRetry(tab.id, {
                action: 'insertPrompt',
                handoff,
                prompt: promptText,
                title
              }).then(result => handleDeliveryResult(provider, handoff, result, metadata));
            }, provider.retryDelayMs);
          }
        };

        if (provider.reuseTab) {
          chrome.tabs.query({ url: provider.targetUrl + '*' }, (tabs) => {
            if (tabs.length) {
              chrome.tabs.update(tabs[0].id, { active: true, url: provider.targetUrl }, afterOpen);
            } else {
              chrome.tabs.create({ url: provider.targetUrl, active: true }, afterOpen);
            }
          });
          return;
        }
        chrome.tabs.create({ url: provider.targetUrl, active: true }, afterOpen);
      });
    }

    function openCerebrasPreparedPrompt(provider, promptText, title, metadata = {}) {
      setPendingPrompt(provider, promptText, title, metadata, (handoff) => {
        if (chrome.runtime.lastError) {
          fail('Could not save prompt for Cerebras.');
          return;
        }

        const setQueuedStatus = (message, tab) => setStatus('working', message, {
          ...metadata,
          model: provider.id,
          targetUrl: tab?.url || provider.targetUrl,
          handoffId: handoff.id
        });
        const sendToPlaygroundTab = (tab) => {
          setQueuedStatus('Opened Cerebras Playground; submitting prompt...', tab);
          if (!tab?.id) return;

          ensureCerebrasContentScript(tab, () => {
            setTimeout(() => {
              sendMessageWithRetry(tab.id, {
                action: 'insertPrompt',
                handoff,
                prompt: promptText,
                title
              }).then(result => handleDeliveryResult(provider, handoff, result, metadata));
            }, provider.retryDelayMs || 500);
          });
        };

        chrome.tabs.query({ url: CEREBRAS_PLAYGROUND_TAB_URL_PATTERN }, (playgroundTabs) => {
          if (playgroundTabs.length) {
            chrome.tabs.update(playgroundTabs[0].id, { active: true }, tab =>
              sendToPlaygroundTab(tab || playgroundTabs[0]));
            return;
          }

          chrome.tabs.query({ url: CEREBRAS_CLOUD_TAB_URL_PATTERN }, (cloudTabs) => {
            const queuedMessage = 'Open Cerebras Playground; prompt queued.';
            if (cloudTabs.length) {
              chrome.tabs.update(cloudTabs[0].id, { active: true }, (tab) => {
                const activeTab = tab || cloudTabs[0];
                setQueuedStatus(queuedMessage, activeTab);
                ensureCerebrasContentScript(activeTab);
              });
              return;
            }
            chrome.tabs.create({ url: provider.targetUrl, active: true }, tab =>
              setQueuedStatus(queuedMessage, tab));
          });
        });
      });
    }

    function ensureCerebrasContentScript(tab, callback = () => {}) {
      if (!tab?.id || !chrome.scripting?.executeScript) {
        callback();
        return;
      }

      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [
          'content_scripts/lib/inject.js',
          'content_scripts/lib/provider_runtime.js',
          'content_scripts/cerebras_content.js'
        ]
      }, () => {
        if (chrome.runtime.lastError) {
          console.warn('Could not inject Cerebras content script:', chrome.runtime.lastError.message);
        }
        callback();
      });
    }

    function resendSummary(summaryId, sendResponse = () => {}) {
      chrome.storage.local.get({ cindraRecentSummaries: [] }, (items) => {
        const summaries = items.cindraRecentSummaries || [];
        const summary = summaries.find(item => item.id === summaryId) || summaries[0];
        if (!summary?.promptText) {
          setStatus('error', 'No saved prompt to resend.');
          sendResponse({ success: false, error: 'No saved prompt to resend.' });
          return;
        }

        const provider = providerRegistry.getProvider(summary.model);
        setStatus('working', `Resending to ${provider.label}...`, {
          model: provider.id,
          title: summary.title,
          url: summary.url,
          sourceType: summary.sourceType,
          summaryId: summary.id
        });
        sendResponse({ success: true, accepted: true });
        openPreparedPrompt(provider.id, summary.promptText, summary.title, {
          title: summary.title,
          url: summary.url,
          sourceType: summary.sourceType,
          summaryId: summary.id
        });
      });
    }

    function handleProviderHandoffResult(message) {
      const provider = providerRegistry.getProvider(message.providerId);
      const details = {
        model: provider.id,
        summaryId: message.summaryId || null,
        handoffId: message.handoffId || null
      };
      if (message.ok) {
        setStatus('success', `Prompt submitted to ${provider.label}.`, details);
      } else {
        setStatus('error', `${provider.label} could not submit the prompt. ${message.error || 'The prompt remains queued for retry.'}`, details);
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
        setStatus('success', `Prompt submitted to ${provider.label}.`, details);
      } else if (result?.delivered && result.response?.error) {
        setStatus('error', `${provider.label} could not submit the prompt. ${result.response.error}`, details);
      } else {
        setStatus('working', `${provider.label} will pick up the queued prompt when its composer is ready.`, details);
      }
    }

    function sendMessageWithRetry(tabId, message, attempt = 1, maxAttempts = 5) {
      return new Promise((resolve) => {
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError || !tab) {
            resolve({ delivered: false, response: null });
            return;
          }

          chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
              if (attempt < maxAttempts) {
                const retryTime = Math.min(2 ** (attempt - 1) * 500, 5000);
                setTimeout(() => {
                  sendMessageWithRetry(tabId, message, attempt + 1, maxAttempts).then(resolve);
                }, retryTime);
              } else {
                resolve({ delivered: false, response: null });
              }
              return;
            }
            resolve({ delivered: true, response: response || null });
          });
        });
      });
    }

    function claimProviderHandoff(message, sender) {
      const run = async () => {
        const provider = providerRegistry.getProvider(message.providerId);
        const key = providerRegistry.getPendingStorageKey(provider.id);
        const state = await chrome.storage.local.get([key]);
        const handoff = state[key];
        if (!handoff || handoff.id !== message.handoffId) {
          return { success: false, claimed: false, error: 'Pending handoff no longer matches.' };
        }
        if (Date.now() - handoff.createdAt >= 2 * 60 * 1000) {
          await chrome.storage.local.remove([key]);
          return { success: false, claimed: false, error: 'Pending handoff expired.' };
        }

        const tabId = sender.tab?.id || null;
        const claimIsFresh = handoff.claimedAt && Date.now() - handoff.claimedAt < 30000;
        if (claimIsFresh && handoff.claimedByTabId !== tabId) {
          return { success: true, claimed: false, claimedByTabId: handoff.claimedByTabId };
        }

        await chrome.storage.local.set({
          [key]: { ...handoff, claimedByTabId: tabId, claimedAt: Date.now() }
        });
        return { success: true, claimed: true };
      };

      const result = claimQueue.then(run, run);
      claimQueue = result.catch(() => {});
      return result;
    }

    return {
      setStatus,
      sendToSelectedModel,
      resendSummary,
      handleProviderHandoffResult,
      claimProviderHandoff
    };
  }

  root.CindraBackgroundHandoffs = { create };
})(globalThis);
