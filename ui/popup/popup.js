const providerRegistry = globalThis.CindraProviders;
const DEFAULT_PROMPT = 'Summarize the following content in 5-10 bullet points with timestamp if it\'s transcript.';

document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('popup-body');

  renderProviderOptions();
  renderContentSourceOptions();

  initializeStorage().then(() => {
    loadSettings();
    loadLastHandoff();
  });

  document.getElementById('ai-model').addEventListener('change', saveSettings);
  document.getElementById('content-source').addEventListener('change', saveSettings);
  document.getElementById('options-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById('summarize-btn').addEventListener('click', summarizeCurrentPage);
  document.getElementById('copy-last-prompt').addEventListener('click', copyLastPrompt);
  document.getElementById('resend-last-prompt').addEventListener('click', resendLastPrompt);
  document.getElementById('clear-handoff-history').addEventListener('click', clearHandoffHistory);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.cindraLastStatus || changes.cindraRecentSummaries) {
      loadLastHandoff();
    }
  });
});

function renderProviderOptions() {
  const aiModel = document.getElementById('ai-model');
  aiModel.innerHTML = '';

  providerRegistry.providers.forEach(provider => {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.label;
    aiModel.appendChild(option);
  });
}

function renderContentSourceOptions() {
  const contentSource = document.getElementById('content-source');
  contentSource.innerHTML = '';

  providerRegistry.contentSources.forEach(source => {
    const option = document.createElement('option');
    option.value = source.id;
    option.textContent = source.label;
    contentSource.appendChild(option);
  });
}

async function initializeStorage() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([
      'savedPrompts',
      'summaryPrompt',
      'activePromptId',
      'contentSource'
    ], (items) => {
      const updates = {};

      if (!items.savedPrompts || items.savedPrompts.length === 0) {
        const defaultPrompt = {
          id: generateId(),
          name: 'General',
          text: items.summaryPrompt || DEFAULT_PROMPT
        };

        updates.savedPrompts = [defaultPrompt];
        updates.activePromptId = defaultPrompt.id;
      }

      if (!items.contentSource) {
        updates.contentSource = providerRegistry.DEFAULT_CONTENT_SOURCE;
      }

      if (Object.keys(updates).length === 0) {
        resolve();
        return;
      }

      chrome.storage.sync.set(updates, resolve);
    });
  });
}

function generateId() {
  return 'prompt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function loadSettings() {
  chrome.storage.sync.get({
    aiModel: providerRegistry.DEFAULT_PROVIDER,
    contentSource: providerRegistry.DEFAULT_CONTENT_SOURCE,
    savedPrompts: [],
    activePromptId: null,
    theme: 'auto'
  }, (items) => {
    const provider = providerRegistry.getProvider(items.aiModel);
    const source = providerRegistry.getContentSource(items.contentSource);

    document.getElementById('ai-model').value = provider.id;
    document.getElementById('content-source').value = source.id;

    const promptSelector = document.getElementById('prompt-selector');
    promptSelector.innerHTML = '';

    items.savedPrompts.forEach(prompt => {
      const option = document.createElement('option');
      option.value = prompt.id;
      option.textContent = prompt.name;
      promptSelector.appendChild(option);
    });

    if (items.activePromptId) {
      promptSelector.value = items.activePromptId;
      const activePrompt = items.savedPrompts.find(p => p.id === items.activePromptId);
      if (activePrompt) {
        document.getElementById('summary-prompt').value = activePrompt.text;
      }
    }

    promptSelector.addEventListener('change', onPromptSelected);

    applyTheme(items.theme);
  });
}

function onPromptSelected() {
  const promptSelector = document.getElementById('prompt-selector');
  const selectedId = promptSelector.value;

  chrome.storage.sync.get(['savedPrompts'], (items) => {
    const selectedPrompt = (items.savedPrompts || []).find(p => p.id === selectedId);
    if (!selectedPrompt) return;

    document.getElementById('summary-prompt').value = selectedPrompt.text;
    chrome.storage.sync.set({ activePromptId: selectedId });
  });
}

function saveSettings() {
  chrome.storage.sync.set({
    aiModel: document.getElementById('ai-model').value,
    contentSource: document.getElementById('content-source').value
  });
}

function applyTheme(theme) {
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

function summarizeCurrentPage() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) return;

    const currentTab = tabs[0];
    const summaryPrompt = document.getElementById('summary-prompt').value;

    chrome.storage.sync.get({
      aiModel: providerRegistry.DEFAULT_PROVIDER,
      contentSource: providerRegistry.DEFAULT_CONTENT_SOURCE
    }, (settings) => {
      setLocalStatus({
        state: 'working',
        message: 'Preparing handoff...',
        model: settings.aiModel,
        url: currentTab.url,
        title: currentTab.title
      });

      chrome.runtime.sendMessage({
        action: 'summarize',
        tabId: currentTab.id,
        url: currentTab.url,
        summaryPrompt: summaryPrompt,
        aiModel: settings.aiModel,
        contentSource: document.getElementById('content-source').value
      });
    });
  });
}

function setLocalStatus(status) {
  chrome.storage.local.set({
    cindraLastStatus: {
      ...status,
      updatedAt: Date.now()
    }
  });
}

function loadLastHandoff() {
  chrome.storage.local.get({
    cindraLastStatus: null,
    cindraRecentSummaries: []
  }, (items) => {
    renderStatus(items.cindraLastStatus, items.cindraRecentSummaries);
  });
}

function renderStatus(status, recentSummaries) {
  const panel = document.getElementById('handoff-status');
  const text = document.getElementById('handoff-status-text');
  const actions = document.getElementById('handoff-actions');
  const latestSummary = Array.isArray(recentSummaries) ? recentSummaries[0] : null;

  panel.classList.remove('is-idle', 'is-working', 'is-success', 'is-error');
  panel.classList.add(`is-${status?.state || 'idle'}`);

  text.textContent = status?.message || 'Ready.';
  actions.hidden = !latestSummary;
}

function copyLastPrompt() {
  chrome.storage.local.get({ cindraRecentSummaries: [] }, async (items) => {
    const latestSummary = items.cindraRecentSummaries[0];
    if (!latestSummary?.promptText) {
      renderStatus({ state: 'error', message: 'No saved prompt to copy.' }, []);
      return;
    }

    try {
      await navigator.clipboard.writeText(latestSummary.promptText);
      setLocalStatus({
        state: 'success',
        message: 'Prompt copied.',
        model: latestSummary.model,
        title: latestSummary.title,
        url: latestSummary.url
      });
    } catch (error) {
      setLocalStatus({
        state: 'error',
        message: 'Could not copy prompt.',
        model: latestSummary.model,
        title: latestSummary.title,
        url: latestSummary.url
      });
    }
  });
}

function resendLastPrompt() {
  chrome.storage.local.get({ cindraRecentSummaries: [] }, (items) => {
    const latestSummary = items.cindraRecentSummaries[0];
    if (!latestSummary) {
      setLocalStatus({ state: 'error', message: 'No saved prompt to resend.' });
      return;
    }

    setLocalStatus({
      state: 'working',
      message: `Resending to ${providerRegistry.getProvider(latestSummary.model).label}...`,
      model: latestSummary.model,
      title: latestSummary.title,
      url: latestSummary.url
    });

    chrome.runtime.sendMessage({
      action: 'resendSummary',
      summaryId: latestSummary.id
    });
  });
}

function clearHandoffHistory() {
  chrome.storage.local.remove('cindraRecentSummaries', () => {
    setLocalStatus({
      state: 'success',
      message: 'Handoff history cleared.'
    });
  });
}
