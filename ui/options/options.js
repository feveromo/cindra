const providerRegistry = globalThis.CindraProviders;
const DEFAULT_PROMPT = 'Summarize the following content in 5-10 bullet points with timestamp if it\'s transcript.';

let editingPromptId = null;

document.addEventListener('DOMContentLoaded', () => {
  renderProviderRadios();
  renderContentSourceRadios();

  initializePromptStorage().then(() => {
    chrome.storage.sync.get({
      theme: 'auto',
      floatingButton: 'visible',
      selectionComposer: 'visible',
      aiModel: providerRegistry.DEFAULT_PROVIDER,
      contentSource: providerRegistry.DEFAULT_CONTENT_SOURCE
    }, (items) => {
      checkRadio('theme', items.theme);
      checkRadio('floating-button', items.floatingButton);
      checkRadio('selection-composer', items.selectionComposer);
      checkRadio('ai-model', providerRegistry.getProvider(items.aiModel).id);
      checkRadio('content-source', providerRegistry.getContentSource(items.contentSource).id);
      applyTheme(items.theme);
    });

    loadSavedPrompts();
  });

  document.getElementById('save-btn').addEventListener('click', saveOptions);

  document.querySelectorAll('input[name="theme"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      applyTheme(e.target.value);
    });
  });

  document.getElementById('add-prompt-btn').addEventListener('click', openAddPromptModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', savePrompt);

  document.getElementById('prompt-modal').addEventListener('click', (e) => {
    if (e.target.id === 'prompt-modal') {
      closeModal();
    }
  });

  document.getElementById('prompts-list').addEventListener('click', (e) => {
    const target = e.target;
    const promptItem = target.closest('.prompt-item');

    if (!promptItem) return;

    const promptId = promptItem.dataset.id;

    if (target.classList.contains('edit') || target.closest('.edit')) {
      editPrompt(promptId);
    } else if (target.classList.contains('delete') || target.closest('.delete')) {
      deletePrompt(promptId);
    }
  });
});

function renderProviderRadios() {
  const container = document.getElementById('provider-options');
  container.innerHTML = '';

  providerRegistry.providers.forEach(provider => {
    container.appendChild(createRadio('ai-model', provider.id, provider.label));
  });
}

function renderContentSourceRadios() {
  const container = document.getElementById('content-source-options');
  container.innerHTML = '';

  providerRegistry.contentSources.forEach(source => {
    container.appendChild(createRadio('content-source', source.id, source.label));
  });
}

function createRadio(name, value, labelText) {
  const label = document.createElement('label');
  label.className = 'radio-container';

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.id = `${name}-${value}`;
  input.value = value;

  const span = document.createElement('span');
  span.className = 'radio-label';
  span.textContent = labelText;

  label.append(input, span);
  return label;
}

function checkRadio(name, value) {
  const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (radio) {
    radio.checked = true;
  }
}

function initializePromptStorage() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['savedPrompts', 'summaryPrompt', 'activePromptId'], (items) => {
      if (items.savedPrompts && items.savedPrompts.length > 0) {
        resolve();
        return;
      }

      const defaultPrompt = {
        id: generateId(),
        name: 'General',
        text: items.summaryPrompt || DEFAULT_PROMPT
      };

      chrome.storage.sync.set({
        savedPrompts: [defaultPrompt],
        activePromptId: defaultPrompt.id
      }, resolve);
    });
  });
}

function saveOptions() {
  const theme = document.querySelector('input[name="theme"]:checked').value;
  const floatingButton = document.querySelector('input[name="floating-button"]:checked').value;
  const selectionComposer = document.querySelector('input[name="selection-composer"]:checked').value;
  const aiModel = document.querySelector('input[name="ai-model"]:checked').value;
  const contentSource = document.querySelector('input[name="content-source"]:checked').value;

  chrome.storage.sync.set({
    theme,
    floatingButton,
    selectionComposer,
    aiModel,
    contentSource
  }, () => {
    showStatus('Settings saved.', 'success');
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

function generateId() {
  return 'prompt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function loadSavedPrompts() {
  chrome.storage.sync.get(['savedPrompts'], (result) => {
    const prompts = result.savedPrompts || [];
    const promptsList = document.getElementById('prompts-list');

    if (prompts.length === 0) {
      promptsList.innerHTML = '<div class="empty-state">No saved prompts yet.</div>';
      return;
    }

    promptsList.innerHTML = '';
    prompts.forEach(prompt => {
      promptsList.appendChild(createPromptElement(prompt));
    });
  });
}

function createPromptElement(prompt) {
  const div = document.createElement('div');
  div.className = 'prompt-item';
  div.dataset.id = prompt.id;

  const preview = prompt.text.length > 100 ? prompt.text.substring(0, 100) + '...' : prompt.text;

  div.innerHTML = `
    <div class="prompt-info">
      <div class="prompt-name">${escapeHtml(prompt.name)}</div>
      <div class="prompt-preview">${escapeHtml(preview)}</div>
    </div>
    <div class="prompt-actions">
      <button class="icon-btn edit">Edit</button>
      <button class="icon-btn delete">Delete</button>
    </div>
  `;

  return div;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function openAddPromptModal() {
  editingPromptId = null;
  document.getElementById('modal-title').textContent = 'Add New Prompt';
  document.getElementById('prompt-name').value = '';
  document.getElementById('prompt-text').value = '';
  document.getElementById('prompt-modal').classList.add('active');
  document.getElementById('prompt-name').focus();
}

function editPrompt(promptId) {
  chrome.storage.sync.get(['savedPrompts'], (result) => {
    const prompts = result.savedPrompts || [];
    const prompt = prompts.find(p => p.id === promptId);

    if (!prompt) return;

    editingPromptId = promptId;
    document.getElementById('modal-title').textContent = 'Edit Prompt';
    document.getElementById('prompt-name').value = prompt.name;
    document.getElementById('prompt-text').value = prompt.text;
    document.getElementById('prompt-modal').classList.add('active');
    document.getElementById('prompt-name').focus();
  });
}

function closeModal() {
  document.getElementById('prompt-modal').classList.remove('active');
  editingPromptId = null;
}

function savePrompt() {
  const name = document.getElementById('prompt-name').value.trim();
  const text = document.getElementById('prompt-text').value.trim();

  if (!name) {
    alert('Please enter a prompt name.');
    document.getElementById('prompt-name').focus();
    return;
  }

  if (!text) {
    alert('Please enter the prompt text.');
    document.getElementById('prompt-text').focus();
    return;
  }

  chrome.storage.sync.get(['savedPrompts', 'activePromptId'], (result) => {
    let prompts = result.savedPrompts || [];
    const updates = {};

    if (editingPromptId) {
      const index = prompts.findIndex(p => p.id === editingPromptId);
      if (index !== -1) {
        prompts[index].name = name;
        prompts[index].text = text;
      }
    } else {
      const newPrompt = {
        id: generateId(),
        name,
        text
      };
      prompts.push(newPrompt);

      if (prompts.length === 1) {
        updates.activePromptId = newPrompt.id;
      }
    }

    chrome.storage.sync.set({
      ...updates,
      savedPrompts: prompts
    }, () => {
      loadSavedPrompts();
      closeModal();
      showStatus('Prompt saved.', 'success');
    });
  });
}

function deletePrompt(promptId) {
  if (!confirm('Are you sure you want to delete this prompt?')) {
    return;
  }

  chrome.storage.sync.get(['savedPrompts', 'activePromptId'], (result) => {
    let prompts = result.savedPrompts || [];

    if (prompts.length === 1) {
      alert('You cannot delete the last prompt.');
      return;
    }

    prompts = prompts.filter(p => p.id !== promptId);

    const updates = { savedPrompts: prompts };
    if (result.activePromptId === promptId) {
      updates.activePromptId = prompts[0].id;
    }

    chrome.storage.sync.set(updates, () => {
      loadSavedPrompts();
      showStatus('Prompt deleted.', 'success');
    });
  });
}

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.style.color = type === 'success' ? '#34a853' : '#d93025';

  setTimeout(() => {
    status.textContent = '';
  }, 3000);
}
