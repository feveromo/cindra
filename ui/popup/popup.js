(function initializeCindraPopup(root) {
  'use strict';

  root.CindraPopup?.cleanup?.();

  const errors = root.CindraErrors;
  const chromeApi = root.CindraChrome;
  const messages = root.CindraMessages;
  const promptBuilder = root.CindraPrompt;
  const providerRegistry = root.CindraProviders;
  const theme = root.CindraTheme;
  if (!errors || !chromeApi || !messages || !promptBuilder || !providerRegistry || !theme) {
    console.error('[Cindra] Popup dependencies are unavailable.');
    return;
  }

  const ACTIONS = messages.ACTIONS;
  const DEFAULT_PROMPT = promptBuilder.DEFAULT_SUMMARY_PROMPT;
  const STATUS_STATES = new Set(['idle', 'working', 'success', 'error']);
  const elements = {};
  let storageListener = null;
  let initialized = false;

  function byId(id) {
    return root.document.getElementById(id);
  }

  function cacheElements() {
    [
      'version-pill',
      'ai-model',
      'content-source',
      'prompt-selector',
      'summary-prompt',
      'summarize-btn',
      'handoff-status',
      'handoff-status-text',
      'handoff-actions',
      'copy-last-prompt',
      'resend-last-prompt',
      'clear-handoff-history',
      'options-btn'
    ].forEach(id => {
      elements[id] = byId(id);
    });
  }

  function generateId() {
    const random = root.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12) ||
      Math.random().toString(36).slice(2, 14);
    return `prompt_${Date.now()}_${random}`;
  }

  async function initializeStorage() {
    const items = await chromeApi.storageGet(root.chrome.storage.sync, [
      'savedPrompts',
      'summaryPrompt',
      'activePromptId',
      'contentSource'
    ]);
    const prompts = Array.isArray(items.savedPrompts) ? items.savedPrompts : [];
    const updates = {};

    if (!prompts.length) {
      const defaultPrompt = {
        id: generateId(),
        name: 'General',
        text: typeof items.summaryPrompt === 'string' && items.summaryPrompt.trim()
          ? items.summaryPrompt
          : DEFAULT_PROMPT
      };
      updates.savedPrompts = [defaultPrompt];
      updates.activePromptId = defaultPrompt.id;
    } else if (!prompts.some(prompt => prompt.id === items.activePromptId)) {
      updates.activePromptId = prompts[0].id;
    }

    if (!providerRegistry.getContentSourceStrict(items.contentSource)) {
      updates.contentSource = providerRegistry.DEFAULT_CONTENT_SOURCE;
    }

    if (Object.keys(updates).length) {
      await chromeApi.storageSet(root.chrome.storage.sync, updates);
    }
  }

  function renderRegistryOptions(select, entries) {
    const fragment = root.document.createDocumentFragment();
    for (const entry of entries) {
      const option = root.document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.label;
      fragment.appendChild(option);
    }
    select.replaceChildren(fragment);
  }

  function renderPromptOptions(prompts, activePromptId) {
    const fragment = root.document.createDocumentFragment();
    for (const prompt of prompts) {
      const option = root.document.createElement('option');
      option.value = prompt.id;
      option.textContent = prompt.name || 'Untitled prompt';
      fragment.appendChild(option);
    }
    elements['prompt-selector'].replaceChildren(fragment);
    const active = prompts.find(prompt => prompt.id === activePromptId) || prompts[0];
    if (active) {
      elements['prompt-selector'].value = active.id;
      elements['summary-prompt'].value = active.text || DEFAULT_PROMPT;
    } else {
      elements['summary-prompt'].value = DEFAULT_PROMPT;
    }
  }

  async function loadSettings() {
    const items = await chromeApi.storageGet(root.chrome.storage.sync, {
      aiModel: providerRegistry.DEFAULT_PROVIDER,
      contentSource: providerRegistry.DEFAULT_CONTENT_SOURCE,
      savedPrompts: [],
      activePromptId: null,
      theme: 'auto'
    });
    const prompts = Array.isArray(items.savedPrompts) ? items.savedPrompts : [];
    elements['ai-model'].value = providerRegistry.getProvider(items.aiModel).id;
    elements['content-source'].value = providerRegistry.getContentSource(items.contentSource).id;
    renderPromptOptions(prompts, items.activePromptId);
    theme.applyTheme(items.theme);
  }

  async function saveWorkflowSettings() {
    await chromeApi.storageSet(root.chrome.storage.sync, {
      aiModel: elements['ai-model'].value,
      contentSource: elements['content-source'].value
    });
  }

  async function selectPrompt() {
    const selectedId = elements['prompt-selector'].value;
    const items = await chromeApi.storageGet(root.chrome.storage.sync, { savedPrompts: [] });
    const selected = (items.savedPrompts || []).find(prompt => prompt.id === selectedId);
    if (!selected) return;
    elements['summary-prompt'].value = selected.text || DEFAULT_PROMPT;
    await chromeApi.storageSet(root.chrome.storage.sync, { activePromptId: selectedId });
  }

  async function setLocalStatus(status) {
    await chromeApi.storageSet(root.chrome.storage.local, {
      cindraLastStatus: {
        ...status,
        updatedAt: Date.now()
      }
    });
  }

  function renderStatus(status, recentSummaries) {
    const state = STATUS_STATES.has(status?.state) ? status.state : 'idle';
    elements['handoff-status'].classList.remove(
      'is-idle',
      'is-working',
      'is-success',
      'is-error'
    );
    elements['handoff-status'].classList.add(`is-${state}`);
    elements['handoff-status-text'].textContent = status?.message || 'Ready.';
    const latest = Array.isArray(recentSummaries) ? recentSummaries[0] : null;
    elements['handoff-actions'].hidden = !latest?.promptText;
  }

  async function loadLastHandoff() {
    const items = await chromeApi.storageGet(root.chrome.storage.local, {
      cindraLastStatus: null,
      cindraRecentSummaries: []
    });
    renderStatus(items.cindraLastStatus, items.cindraRecentSummaries);
  }

  async function latestSummary() {
    const items = await chromeApi.storageGet(root.chrome.storage.local, {
      cindraRecentSummaries: []
    });
    return Array.isArray(items.cindraRecentSummaries)
      ? items.cindraRecentSummaries[0] || null
      : null;
  }

  function setSummarizeBusy(busy) {
    elements['summarize-btn'].disabled = busy;
    elements['summarize-btn'].textContent = busy ? 'Preparing…' : 'Summarize Current Page';
  }

  async function summarizeCurrentPage() {
    if (elements['summarize-btn'].disabled) return;
    setSummarizeBusy(true);
    try {
      const [tab] = await chromeApi.tabsQuery({ active: true, currentWindow: true });
      if (!tab || !Number.isInteger(tab.id)) throw new Error('No active tab found.');

      const settings = await chromeApi.storageGet(root.chrome.storage.sync, {
        aiModel: providerRegistry.DEFAULT_PROVIDER,
        contentSource: providerRegistry.DEFAULT_CONTENT_SOURCE
      });
      const provider = providerRegistry.getProvider(settings.aiModel);
      await setLocalStatus({
        state: 'working',
        message: `Preparing handoff to ${provider.label}…`,
        model: provider.id,
        url: tab.url || '',
        title: tab.title || ''
      });

      const response = await messages.runtimeSendMessage({
        action: ACTIONS.SUMMARIZE,
        tabId: tab.id,
        url: tab.url,
        summaryPrompt: elements['summary-prompt'].value,
        aiModel: provider.id,
        contentSource: elements['content-source'].value
      }, {
        context: 'start summary from popup',
        timeoutMs: 10000
      });
      if (!response?.success) throw new Error(response?.error || 'Could not start the handoff.');
    } catch (error) {
      errors.logError('Popup summary request failed', error);
      await setLocalStatus({
        state: 'error',
        message: error?.message || 'Could not start the handoff.'
      });
    } finally {
      setSummarizeBusy(false);
    }
  }

  async function copyLastPrompt() {
    const summary = await latestSummary();
    if (!summary?.promptText) {
      await setLocalStatus({ state: 'error', message: 'No saved prompt to copy.' });
      return;
    }
    try {
      await root.navigator.clipboard.writeText(summary.promptText);
      await setLocalStatus({
        state: 'success',
        message: 'Prompt copied.',
        model: summary.model,
        title: summary.title,
        url: summary.url
      });
    } catch (error) {
      errors.logError('Could not copy recent prompt', error);
      await setLocalStatus({ state: 'error', message: 'Could not copy the saved prompt.' });
    }
  }

  async function resendLastPrompt() {
    const summary = await latestSummary();
    if (!summary?.id) {
      await setLocalStatus({ state: 'error', message: 'No saved prompt to resend.' });
      return;
    }
    const provider = providerRegistry.getProvider(summary.model);
    await setLocalStatus({
      state: 'working',
      message: `Resending to ${provider.label}…`,
      model: provider.id,
      title: summary.title,
      url: summary.url
    });
    try {
      const response = await messages.runtimeSendMessage({
        action: ACTIONS.RESEND_SUMMARY,
        summaryId: summary.id
      }, {
        context: 'resend recent summary from popup',
        timeoutMs: 10000
      });
      if (!response?.success) throw new Error(response?.error || 'Could not resend the prompt.');
    } catch (error) {
      errors.logError('Could not resend recent prompt', error);
      await setLocalStatus({ state: 'error', message: error?.message || 'Could not resend the prompt.' });
    }
  }

  async function clearHandoffHistory() {
    await chromeApi.storageRemove(root.chrome.storage.local, ['cindraRecentSummaries']);
    await setLocalStatus({ state: 'success', message: 'Handoff history cleared.' });
  }

  async function openOptions() {
    try {
      await chromeApi.callbackPromise(
        callback => root.chrome.runtime.openOptionsPage(callback),
        'chrome.runtime.openOptionsPage'
      );
    } catch (error) {
      errors.logError('Could not open settings', error);
      await setLocalStatus({ state: 'error', message: 'Could not open Settings.' });
    }
  }

  function bindEvents() {
    elements['ai-model'].addEventListener('change', () => void saveWorkflowSettings());
    elements['content-source'].addEventListener('change', () => void saveWorkflowSettings());
    elements['prompt-selector'].addEventListener('change', () => void selectPrompt());
    elements['summarize-btn'].addEventListener('click', () => void summarizeCurrentPage());
    elements['copy-last-prompt'].addEventListener('click', () => void copyLastPrompt());
    elements['resend-last-prompt'].addEventListener('click', () => void resendLastPrompt());
    elements['clear-handoff-history'].addEventListener('click', () => void clearHandoffHistory());
    elements['options-btn'].addEventListener('click', () => void openOptions());

    storageListener = (changes, areaName) => {
      if (areaName === 'local' && (changes.cindraLastStatus || changes.cindraRecentSummaries)) {
        void loadLastHandoff();
      }
      if (areaName === 'sync' && (changes.savedPrompts || changes.activePromptId || changes.theme)) {
        void loadSettings();
      }
    };
    root.chrome.storage.onChanged.addListener(storageListener);
    root.addEventListener('pagehide', cleanup, { once: true });
  }

  function cleanup() {
    if (storageListener) root.chrome.storage.onChanged.removeListener(storageListener);
    storageListener = null;
    root.removeEventListener('pagehide', cleanup);
    theme.cleanup?.();
    initialized = false;
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    cacheElements();
    elements['version-pill'].textContent = `v${root.chrome.runtime.getManifest().version}`;
    renderRegistryOptions(elements['ai-model'], providerRegistry.providers);
    renderRegistryOptions(elements['content-source'], providerRegistry.contentSources);
    bindEvents();

    try {
      await initializeStorage();
      await Promise.all([loadSettings(), loadLastHandoff()]);
    } catch (error) {
      errors.logError('Could not initialize popup', error);
      renderStatus({ state: 'error', message: 'Could not load Cindra settings.' }, []);
    }
  }

  root.CindraPopup = { cleanup, initialize };
  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', () => void initialize(), { once: true });
  } else {
    void initialize();
  }
})(globalThis);
