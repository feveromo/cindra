document.addEventListener('DOMContentLoaded', () => {
  // Add class to body for specific styling
  document.body.classList.add('popup-body');

  // Initialize and migrate storage if needed
  initializeStorage().then(() => {
    loadSettings();
  });

  // Save settings when changed
  document.getElementById('ai-model').addEventListener('change', saveSettings);
  document.getElementById('summary-prompt').addEventListener('input', () => {
    // Don't auto-save textarea changes, only save when prompt is selected from dropdown
  });

  // Options button click
  document.getElementById('options-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Summarize button click
  document.getElementById('summarize-btn').addEventListener('click', () => {
    summarizeCurrentPage();
  });
});

// Initialize storage and migrate from old schema if needed
async function initializeStorage() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['savedPrompts', 'summaryPrompt', 'activePromptId'], (items) => {
      // Check if we need to migrate from old single prompt system
      if (!items.savedPrompts || items.savedPrompts.length === 0) {
        const defaultPromptText = items.summaryPrompt || 'Summarize the following content in 5-10 bullet points with timestamp if it\'s transcript.';
        const defaultPrompt = {
          id: generateId(),
          name: 'General',
          text: defaultPromptText
        };
        
        chrome.storage.sync.set({
          savedPrompts: [defaultPrompt],
          activePromptId: defaultPrompt.id
        }, resolve);
      } else {
        resolve();
      }
    });
  });
}

// Generate unique ID for prompts
function generateId() {
  return 'prompt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Load settings and populate UI
function loadSettings() {
  chrome.storage.sync.get({
    aiModel: 'google-ai-studio',
    savedPrompts: [],
    activePromptId: null,
    theme: 'auto'
  }, (items) => {
    // Set AI model
    document.getElementById('ai-model').value = items.aiModel;
    
    // Populate prompt selector
    const promptSelector = document.getElementById('prompt-selector');
    promptSelector.innerHTML = '';
    
    items.savedPrompts.forEach(prompt => {
      const option = document.createElement('option');
      option.value = prompt.id;
      option.textContent = prompt.name;
      promptSelector.appendChild(option);
    });
    
    // Set active prompt
    if (items.activePromptId) {
      promptSelector.value = items.activePromptId;
      const activePrompt = items.savedPrompts.find(p => p.id === items.activePromptId);
      if (activePrompt) {
        document.getElementById('summary-prompt').value = activePrompt.text;
      }
    }
    
    // Add prompt selector change listener
    promptSelector.addEventListener('change', onPromptSelected);
    
    // Apply theme
    applyTheme(items.theme);
  });
}

// Handle prompt selection from dropdown
function onPromptSelected() {
  const promptSelector = document.getElementById('prompt-selector');
  const selectedId = promptSelector.value;
  
  chrome.storage.sync.get(['savedPrompts'], (items) => {
    const selectedPrompt = items.savedPrompts.find(p => p.id === selectedId);
    if (selectedPrompt) {
      document.getElementById('summary-prompt').value = selectedPrompt.text;
      
      // Save the active prompt ID
      chrome.storage.sync.set({ activePromptId: selectedId });
    }
  });
}

function saveSettings() {
  const aiModel = document.getElementById('ai-model').value;

  chrome.storage.sync.set({
    aiModel
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
      aiModel: 'google-ai-studio'
    }, (settings) => {
      chrome.runtime.sendMessage({
        action: 'summarize',
        tabId: currentTab.id,
        url: currentTab.url,
        summaryPrompt: summaryPrompt,
        contentOption: 'entire-content',
        aiModel: settings.aiModel
      });
    });
  });
} 