document.addEventListener('DOMContentLoaded', () => {
  // Load saved settings
  chrome.storage.sync.get({
    aiModel: 'google-ai-studio',
    summaryPrompt: 'Summarize the following content in 5-10 bullet points with timestamp if it\'s transcript.',
    contentOption: 'entire-content',
    theme: 'auto'
  }, (items) => {
    document.getElementById('ai-model').value = items.aiModel;
    document.getElementById('summary-prompt').value = items.summaryPrompt;
    document.getElementById(items.contentOption).checked = true;
    
    // Apply theme
    applyTheme(items.theme);
  });

  // Save settings when changed
  document.getElementById('ai-model').addEventListener('change', saveSettings);
  document.getElementById('summary-prompt').addEventListener('input', saveSettings);
  document.querySelectorAll('input[name="content-option"]').forEach(radio => {
    radio.addEventListener('change', saveSettings);
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

function saveSettings() {
  const aiModel = document.getElementById('ai-model').value;
  const summaryPrompt = document.getElementById('summary-prompt').value;
  let contentOption;
  
  document.querySelectorAll('input[name="content-option"]').forEach(radio => {
    if (radio.checked) {
      contentOption = radio.id;
    }
  });

  chrome.storage.sync.set({
    aiModel,
    summaryPrompt,
    contentOption
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
    chrome.storage.sync.get({
      summaryPrompt: 'Summarize the following content in 5-10 bullet points with timestamp if it\'s transcript.',
      contentOption: 'entire-content',
      aiModel: 'google-ai-studio'
    }, (settings) => {
      chrome.runtime.sendMessage({
        action: 'summarize',
        tabId: currentTab.id,
        url: currentTab.url,
        summaryPrompt: settings.summaryPrompt,
        contentOption: settings.contentOption,
        aiModel: settings.aiModel
      });
    });
  });
} 