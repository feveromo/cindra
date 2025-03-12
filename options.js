document.addEventListener('DOMContentLoaded', () => {
  // Load saved settings
  chrome.storage.sync.get({
    theme: 'auto',
    copyFormat: 'plain',
    ytWidget: 'visible',
    thumbButton: 'visible',
    webButton: 'visible'
  }, (items) => {
    document.querySelector(`input[name="theme"][value="${items.theme}"]`).checked = true;
    document.querySelector(`input[name="copy-format"][value="${items.copyFormat}"]`).checked = true;
    document.querySelector(`input[name="yt-widget"][value="${items.ytWidget}"]`).checked = true;
    document.querySelector(`input[name="thumb-button"][value="${items.thumbButton}"]`).checked = true;
    document.querySelector(`input[name="web-button"][value="${items.webButton}"]`).checked = true;
    
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
  const ytWidget = document.querySelector('input[name="yt-widget"]:checked').value;
  const thumbButton = document.querySelector('input[name="thumb-button"]:checked').value;
  const webButton = document.querySelector('input[name="web-button"]:checked').value;

  chrome.storage.sync.set({
    theme,
    copyFormat,
    ytWidget,
    thumbButton,
    webButton
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