(function initializeCindraOptions(root) {
  'use strict';

  root.CindraOptions?.cleanup?.();

  const errors = root.CindraErrors;
  const chromeApi = root.CindraChrome;
  const promptBuilder = root.CindraPrompt;
  const providerRegistry = root.CindraProviders;
  const theme = root.CindraTheme;
  if (!errors || !chromeApi || !promptBuilder || !providerRegistry || !theme) {
    console.error('[Cindra] Options dependencies are unavailable.');
    return;
  }

  const DEFAULT_PROMPT = promptBuilder.DEFAULT_SUMMARY_PROMPT;
  const MAX_PROMPTS = 50;
  const elements = {};
  let editingPromptId = null;
  let modalPreviousFocus = null;
  let modalFocusFrame = null;
  let statusTimer = null;
  let storageListener = null;
  let initialized = false;

  function byId(id) {
    return root.document.getElementById(id);
  }

  function cacheElements() {
    [
      'version-pill',
      'ai-model',
      'content-source-options',
      'clear-history-btn',
      'prompts-list',
      'add-prompt-btn',
      'save-btn',
      'status',
      'prompt-modal',
      'prompt-form',
      'modal-title',
      'modal-close',
      'modal-cancel',
      'modal-save',
      'modal-status',
      'prompt-name',
      'prompt-text'
    ].forEach(id => {
      elements[id] = byId(id);
    });
  }

  function generateId() {
    const random = root.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12) ||
      Math.random().toString(36).slice(2, 14);
    return `prompt_${Date.now()}_${random}`;
  }

  function renderProviderSelect() {
    const fragment = root.document.createDocumentFragment();
    for (const provider of providerRegistry.providers) {
      const option = root.document.createElement('option');
      option.value = provider.id;
      option.textContent = provider.label;
      fragment.appendChild(option);
    }
    elements['ai-model'].replaceChildren(fragment);
  }

  function createRadio(name, value, labelText) {
    const label = root.document.createElement('label');
    label.className = 'radio-container';
    const input = root.document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.id = `${name}-${value}`;
    const text = root.document.createElement('span');
    text.className = 'radio-label';
    text.textContent = labelText;
    label.append(input, text);
    return label;
  }

  function renderContentSourceRadios() {
    const fragment = root.document.createDocumentFragment();
    for (const source of providerRegistry.contentSources) {
      fragment.appendChild(createRadio('content-source', source.id, source.label));
    }
    elements['content-source-options'].replaceChildren(fragment);
  }

  function checkRadio(name, value, fallback) {
    const desired = root.document.querySelector(`input[name="${name}"][value="${value}"]`);
    const radio = desired || root.document.querySelector(`input[name="${name}"][value="${fallback}"]`);
    if (radio) radio.checked = true;
  }

  function checkedValue(name, fallback) {
    return root.document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
  }

  async function initializePromptStorage() {
    const items = await chromeApi.storageGet(root.chrome.storage.sync, [
      'savedPrompts',
      'summaryPrompt',
      'activePromptId'
    ]);
    const prompts = Array.isArray(items.savedPrompts) ? items.savedPrompts : [];
    if (prompts.length) {
      if (!prompts.some(prompt => prompt.id === items.activePromptId)) {
        await chromeApi.storageSet(root.chrome.storage.sync, { activePromptId: prompts[0].id });
      }
      return;
    }

    const defaultPrompt = {
      id: generateId(),
      name: 'General',
      text: typeof items.summaryPrompt === 'string' && items.summaryPrompt.trim()
        ? items.summaryPrompt
        : DEFAULT_PROMPT
    };
    await chromeApi.storageSet(root.chrome.storage.sync, {
      savedPrompts: [defaultPrompt],
      activePromptId: defaultPrompt.id
    });
  }

  async function loadSettings() {
    const items = await chromeApi.storageGet(root.chrome.storage.sync, {
      theme: 'auto',
      floatingButton: 'visible',
      selectionComposer: 'visible',
      promptHistory: 'enabled',
      aiModel: providerRegistry.DEFAULT_PROVIDER,
      contentSource: providerRegistry.DEFAULT_CONTENT_SOURCE
    });

    elements['ai-model'].value = providerRegistry.getProvider(items.aiModel).id;
    checkRadio('content-source', providerRegistry.getContentSource(items.contentSource).id, 'auto');
    checkRadio('theme', theme.normalizeTheme(items.theme), 'auto');
    checkRadio('floating-button', items.floatingButton, 'visible');
    checkRadio('selection-composer', items.selectionComposer, 'visible');
    checkRadio('prompt-history', items.promptHistory, 'enabled');
    theme.applyTheme(items.theme);
  }

  function setSaveBusy(busy) {
    elements['save-btn'].disabled = busy;
    elements['save-btn'].textContent = busy ? 'Saving…' : 'Save Settings';
  }

  async function saveOptions() {
    if (elements['save-btn'].disabled) return;
    setSaveBusy(true);
    const settings = {
      theme: checkedValue('theme', 'auto'),
      floatingButton: checkedValue('floating-button', 'visible'),
      selectionComposer: checkedValue('selection-composer', 'visible'),
      promptHistory: checkedValue('prompt-history', 'enabled'),
      aiModel: providerRegistry.getProvider(elements['ai-model'].value).id,
      contentSource: providerRegistry.getContentSource(
        checkedValue('content-source', providerRegistry.DEFAULT_CONTENT_SOURCE)
      ).id
    };

    try {
      await chromeApi.storageSet(root.chrome.storage.sync, settings);
      theme.applyTheme(settings.theme);
      if (settings.promptHistory === 'disabled') {
        await chromeApi.storageRemove(root.chrome.storage.local, ['cindraRecentSummaries']);
        showStatus('Settings saved. Prompt history cleared.', 'success');
      } else {
        showStatus('Settings saved.', 'success');
      }
    } catch (error) {
      errors.logError('Could not save options', error);
      showStatus('Could not save settings.', 'error');
    } finally {
      setSaveBusy(false);
    }
  }

  function createPromptElement(prompt, activePromptId) {
    const item = root.document.createElement('article');
    item.className = 'prompt-item';
    item.dataset.id = prompt.id;

    const info = root.document.createElement('div');
    info.className = 'prompt-info';
    const name = root.document.createElement('div');
    name.className = 'prompt-name';
    name.textContent = prompt.id === activePromptId
      ? `${prompt.name || 'Untitled'} · Active`
      : prompt.name || 'Untitled';
    const preview = root.document.createElement('div');
    preview.className = 'prompt-preview';
    const text = String(prompt.text || '');
    preview.textContent = text.length > 140 ? `${text.slice(0, 140)}…` : text;
    info.append(name, preview);

    const actions = root.document.createElement('div');
    actions.className = 'prompt-actions';
    for (const [action, label] of [['activate', 'Use'], ['edit', 'Edit'], ['delete', 'Delete']]) {
      const button = root.document.createElement('button');
      button.type = 'button';
      button.className = `icon-btn ${action}`;
      button.dataset.action = action;
      button.textContent = label;
      button.setAttribute('aria-label', `${label} prompt ${prompt.name || 'Untitled'}`);
      if (action === 'activate' && prompt.id === activePromptId) button.disabled = true;
      actions.appendChild(button);
    }
    item.append(info, actions);
    return item;
  }

  async function loadSavedPrompts() {
    const result = await chromeApi.storageGet(root.chrome.storage.sync, {
      savedPrompts: [],
      activePromptId: null
    });
    const prompts = Array.isArray(result.savedPrompts) ? result.savedPrompts : [];
    if (!prompts.length) {
      const empty = root.document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No saved prompts yet.';
      elements['prompts-list'].replaceChildren(empty);
      return;
    }
    elements['prompts-list'].replaceChildren(
      ...prompts.map(prompt => createPromptElement(prompt, result.activePromptId))
    );
  }

  function setModalStatus(message) {
    elements['modal-status'].textContent = message;
  }

  function openPromptModal(prompt = null, trigger = root.document.activeElement) {
    editingPromptId = prompt?.id || null;
    modalPreviousFocus = trigger;
    elements['modal-title'].textContent = prompt ? 'Edit Prompt' : 'Add New Prompt';
    elements['prompt-name'].value = prompt?.name || '';
    elements['prompt-text'].value = prompt?.text || '';
    setModalStatus('');
    elements['prompt-modal'].hidden = false;
    elements['prompt-modal'].classList.add('active');
    root.document.body.classList.add('modal-open');
    if (modalFocusFrame) root.cancelAnimationFrame(modalFocusFrame);
    modalFocusFrame = root.requestAnimationFrame(() => {
      modalFocusFrame = null;
      if (!elements['prompt-modal'].hidden) elements['prompt-name'].focus();
    });
  }

  function closeModal({ restoreFocus = true } = {}) {
    if (modalFocusFrame) root.cancelAnimationFrame(modalFocusFrame);
    modalFocusFrame = null;
    elements['prompt-modal'].classList.remove('active');
    elements['prompt-modal'].hidden = true;
    root.document.body.classList.remove('modal-open');
    editingPromptId = null;
    setModalStatus('');
    if (restoreFocus && modalPreviousFocus?.isConnected) modalPreviousFocus.focus();
    modalPreviousFocus = null;
  }

  function focusableModalElements() {
    return Array.from(elements['prompt-form'].querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled])'
    ));
  }

  function handleModalKeydown(event) {
    if (elements['prompt-modal'].hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableModalElements();
    if (!focusable.length) return;
    const index = focusable.indexOf(root.document.activeElement);
    const next = event.shiftKey
      ? (index <= 0 ? focusable.length - 1 : index - 1)
      : (index === focusable.length - 1 ? 0 : index + 1);
    event.preventDefault();
    focusable[next].focus();
  }

  async function editPrompt(promptId, trigger) {
    const result = await chromeApi.storageGet(root.chrome.storage.sync, { savedPrompts: [] });
    const prompt = (result.savedPrompts || []).find(item => item.id === promptId);
    if (prompt) openPromptModal(prompt, trigger);
  }

  async function activatePrompt(promptId) {
    await chromeApi.storageSet(root.chrome.storage.sync, { activePromptId: promptId });
    await loadSavedPrompts();
    showStatus('Active prompt updated.', 'success');
  }

  async function savePrompt(event) {
    event.preventDefault();
    const name = elements['prompt-name'].value.trim();
    const text = elements['prompt-text'].value.trim();
    if (!name) {
      setModalStatus('Enter a prompt name.');
      elements['prompt-name'].focus();
      return;
    }
    if (!text) {
      setModalStatus('Enter prompt text.');
      elements['prompt-text'].focus();
      return;
    }

    elements['modal-save'].disabled = true;
    try {
      const result = await chromeApi.storageGet(root.chrome.storage.sync, {
        savedPrompts: [],
        activePromptId: null
      });
      const prompts = Array.isArray(result.savedPrompts) ? [...result.savedPrompts] : [];
      const updates = {};

      if (editingPromptId) {
        const index = prompts.findIndex(prompt => prompt.id === editingPromptId);
        if (index < 0) throw new Error('The prompt no longer exists.');
        prompts[index] = { ...prompts[index], name, text };
      } else {
        if (prompts.length >= MAX_PROMPTS) {
          setModalStatus(`Cindra supports up to ${MAX_PROMPTS} saved prompts.`);
          return;
        }
        const prompt = { id: generateId(), name, text };
        prompts.push(prompt);
        if (!result.activePromptId) updates.activePromptId = prompt.id;
      }

      await chromeApi.storageSet(root.chrome.storage.sync, {
        ...updates,
        savedPrompts: prompts
      });
      closeModal();
      await loadSavedPrompts();
      showStatus('Prompt saved.', 'success');
    } catch (error) {
      errors.logError('Could not save prompt', error);
      setModalStatus(error?.message || 'Could not save the prompt.');
    } finally {
      elements['modal-save'].disabled = false;
    }
  }

  async function deletePrompt(promptId) {
    const result = await chromeApi.storageGet(root.chrome.storage.sync, {
      savedPrompts: [],
      activePromptId: null
    });
    const prompts = Array.isArray(result.savedPrompts) ? result.savedPrompts : [];
    const prompt = prompts.find(item => item.id === promptId);
    if (!prompt) return;
    if (prompts.length <= 1) {
      showStatus('Keep at least one saved prompt.', 'error');
      return;
    }
    if (!root.confirm(`Delete “${prompt.name || 'Untitled'}”?`)) return;

    const remaining = prompts.filter(item => item.id !== promptId);
    await chromeApi.storageSet(root.chrome.storage.sync, {
      savedPrompts: remaining,
      activePromptId: result.activePromptId === promptId
        ? remaining[0].id
        : result.activePromptId
    });
    await loadSavedPrompts();
    showStatus('Prompt deleted.', 'success');
  }

  async function clearHandoffHistory() {
    try {
      await chromeApi.storageRemove(root.chrome.storage.local, ['cindraRecentSummaries']);
      showStatus('Handoff history cleared.', 'success');
    } catch (error) {
      errors.logError('Could not clear handoff history', error);
      showStatus('Could not clear handoff history.', 'error');
    }
  }

  function showStatus(message, type = 'success') {
    if (statusTimer) root.clearTimeout(statusTimer);
    elements.status.textContent = message;
    elements.status.dataset.state = type;
    statusTimer = root.setTimeout(() => {
      elements.status.textContent = '';
      delete elements.status.dataset.state;
      statusTimer = null;
    }, 4000);
  }

  function handlePromptListClick(event) {
    const button = event.target.closest('button[data-action]');
    const item = button?.closest('.prompt-item');
    if (!button || !item) return;
    const promptId = item.dataset.id;
    if (button.dataset.action === 'activate') void activatePrompt(promptId);
    if (button.dataset.action === 'edit') void editPrompt(promptId, button);
    if (button.dataset.action === 'delete') void deletePrompt(promptId);
  }

  function bindEvents() {
    elements['save-btn'].addEventListener('click', () => void saveOptions());
    elements['clear-history-btn'].addEventListener('click', () => void clearHandoffHistory());
    elements['add-prompt-btn'].addEventListener('click', event => openPromptModal(null, event.currentTarget));
    elements['modal-close'].addEventListener('click', () => closeModal());
    elements['modal-cancel'].addEventListener('click', () => closeModal());
    elements['prompt-form'].addEventListener('submit', event => void savePrompt(event));
    elements['prompt-form'].addEventListener('keydown', handleModalKeydown);
    elements['prompt-modal'].addEventListener('mousedown', event => {
      if (event.target === elements['prompt-modal']) closeModal();
    });
    elements['prompts-list'].addEventListener('click', handlePromptListClick);
    root.document.querySelectorAll('input[name="theme"]').forEach(radio => {
      radio.addEventListener('change', event => theme.applyTheme(event.target.value));
    });

    storageListener = (changes, areaName) => {
      if (areaName !== 'sync') return;
      if (changes.savedPrompts || changes.activePromptId) {
        void loadSavedPrompts();
      }
      if (
        changes.theme ||
        changes.floatingButton ||
        changes.selectionComposer ||
        changes.promptHistory ||
        changes.aiModel ||
        changes.contentSource
      ) {
        void loadSettings();
      }
    };
    root.chrome.storage.onChanged.addListener(storageListener);
    root.addEventListener('pagehide', cleanup, { once: true });
  }

  function cleanup() {
    if (statusTimer) root.clearTimeout(statusTimer);
    statusTimer = null;
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
    renderProviderSelect();
    renderContentSourceRadios();
    bindEvents();

    try {
      await initializePromptStorage();
      await Promise.all([loadSettings(), loadSavedPrompts()]);
    } catch (error) {
      errors.logError('Could not initialize options page', error);
      showStatus('Could not load Cindra settings.', 'error');
    }
  }

  root.CindraOptions = {
    cleanup,
    closeModal,
    initialize,
    openPromptModal
  };
  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', () => void initialize(), { once: true });
  } else {
    void initialize();
  }
})(globalThis);
