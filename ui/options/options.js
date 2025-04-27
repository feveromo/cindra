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

  // Save button click
  document.getElementById('save-btn').addEventListener('click', saveOptions);

  // Theme changes
  document.querySelectorAll('input[name="theme"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      applyTheme(e.target.value);
    });
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