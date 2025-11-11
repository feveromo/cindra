// Global variables for prompt editing
let editingPromptId = null;

document.addEventListener('DOMContentLoaded', () => {
  // Load saved settings
  chrome.storage.sync.get({
    theme: 'auto',
    copyFormat: 'plain',
    floatingButton: 'visible',
    aiModel: 'google-ai-studio'
  }, (items) => {
    document.querySelector(`input[name="theme"][value="${items.theme}"]`).checked = true;
    document.querySelector(`input[name="copy-format"][value="${items.copyFormat}"]`).checked = true;
    document.querySelector(`input[name="floating-button"][value="${items.floatingButton}"]`).checked = true;
    document.querySelector(`input[name="ai-model"][value="${items.aiModel}"]`).checked = true;
    
    // Apply theme
    applyTheme(items.theme);
  });

  // Load prompts
  loadSavedPrompts();

  // Save button click
  document.getElementById('save-btn').addEventListener('click', saveOptions);

  // Theme changes
  document.querySelectorAll('input[name="theme"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      applyTheme(e.target.value);
    });
  });

  // Prompt management event listeners
  document.getElementById('add-prompt-btn').addEventListener('click', openAddPromptModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', savePrompt);
  
  // Close modal when clicking outside
  document.getElementById('prompt-modal').addEventListener('click', (e) => {
    if (e.target.id === 'prompt-modal') {
      closeModal();
    }
  });
});

function saveOptions() {
  const theme = document.querySelector('input[name="theme"]:checked').value;
  const copyFormat = document.querySelector('input[name="copy-format"]:checked').value;
  const floatingButton = document.querySelector('input[name="floating-button"]:checked').value;
  const aiModel = document.querySelector('input[name="ai-model"]:checked').value;

  chrome.storage.sync.set({
    theme,
    copyFormat,
    floatingButton,
    aiModel
  }, () => {
    const status = document.getElementById('status');
    status.textContent = 'Settings saved.';
    status.style.color = '#34a853';
    
    setTimeout(() => {
      status.textContent = '';
    }, 2000);
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

// ===== PROMPT MANAGEMENT FUNCTIONS =====

// Generate unique ID for prompts
function generateId() {
  return 'prompt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Load and display saved prompts
function loadSavedPrompts() {
  chrome.storage.sync.get(['savedPrompts'], (result) => {
    const prompts = result.savedPrompts || [];
    const promptsList = document.getElementById('prompts-list');
    
    if (prompts.length === 0) {
      promptsList.innerHTML = '<div class="empty-state">No saved prompts yet. Click "Add New Prompt" to create one.</div>';
      return;
    }
    
    promptsList.innerHTML = '';
    prompts.forEach(prompt => {
      const promptItem = createPromptElement(prompt);
      promptsList.appendChild(promptItem);
    });
  });
}

// Create prompt list item element
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
      <button class="icon-btn edit" onclick="editPrompt('${prompt.id}')">Edit</button>
      <button class="icon-btn delete" onclick="deletePrompt('${prompt.id}')">Delete</button>
    </div>
  `;
  
  return div;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Open modal to add new prompt
function openAddPromptModal() {
  editingPromptId = null;
  document.getElementById('modal-title').textContent = 'Add New Prompt';
  document.getElementById('prompt-name').value = '';
  document.getElementById('prompt-text').value = '';
  document.getElementById('prompt-modal').classList.add('active');
  document.getElementById('prompt-name').focus();
}

// Open modal to edit existing prompt
function editPrompt(promptId) {
  chrome.storage.sync.get(['savedPrompts'], (result) => {
    const prompts = result.savedPrompts || [];
    const prompt = prompts.find(p => p.id === promptId);
    
    if (prompt) {
      editingPromptId = promptId;
      document.getElementById('modal-title').textContent = 'Edit Prompt';
      document.getElementById('prompt-name').value = prompt.name;
      document.getElementById('prompt-text').value = prompt.text;
      document.getElementById('prompt-modal').classList.add('active');
      document.getElementById('prompt-name').focus();
    }
  });
}

// Close modal
function closeModal() {
  document.getElementById('prompt-modal').classList.remove('active');
  editingPromptId = null;
}

// Save prompt (create or update)
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
    
    if (editingPromptId) {
      // Update existing prompt
      const index = prompts.findIndex(p => p.id === editingPromptId);
      if (index !== -1) {
        prompts[index].name = name;
        prompts[index].text = text;
      }
    } else {
      // Create new prompt
      const newPrompt = {
        id: generateId(),
        name: name,
        text: text
      };
      prompts.push(newPrompt);
      
      // If this is the first prompt, set it as active
      if (prompts.length === 1) {
        chrome.storage.sync.set({ activePromptId: newPrompt.id });
      }
    }
    
    chrome.storage.sync.set({ savedPrompts: prompts }, () => {
      loadSavedPrompts();
      closeModal();
      showStatus('Prompt saved successfully!', 'success');
    });
  });
}

// Delete prompt
function deletePrompt(promptId) {
  if (!confirm('Are you sure you want to delete this prompt?')) {
    return;
  }
  
  chrome.storage.sync.get(['savedPrompts', 'activePromptId'], (result) => {
    let prompts = result.savedPrompts || [];
    
    if (prompts.length === 1) {
      alert('You cannot delete the last prompt. You must have at least one prompt.');
      return;
    }
    
    prompts = prompts.filter(p => p.id !== promptId);
    
    const updates = { savedPrompts: prompts };
    
    // If we deleted the active prompt, set a new one
    if (result.activePromptId === promptId) {
      updates.activePromptId = prompts[0].id;
    }
    
    chrome.storage.sync.set(updates, () => {
      loadSavedPrompts();
      showStatus('Prompt deleted successfully!', 'success');
    });
  });
}

// Show status message
function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.style.color = type === 'success' ? '#34a853' : '#d93025';
  
  setTimeout(() => {
    status.textContent = '';
  }, 3000);
}

// Make functions globally accessible for onclick handlers
window.editPrompt = editPrompt;
window.deletePrompt = deletePrompt; 