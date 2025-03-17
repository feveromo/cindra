// Listen for keyboard shortcut events
document.addEventListener('keydown', handleShortcut);

// Track key states for Ctrl+X+X shortcut
let ctrlPressed = false;
let xPressed = false;
let lastKeyDownTime = 0;

function handleShortcut(e) {
  const currentTime = Date.now();
  
  // Check for Ctrl key
  if (e.key === 'Control') {
    ctrlPressed = true;
    lastKeyDownTime = currentTime;
    return;
  }
  
  // Check for X key while Ctrl is pressed
  if (ctrlPressed && e.key.toLowerCase() === 'x') {
    // First X press
    if (!xPressed) {
      xPressed = true;
      lastKeyDownTime = currentTime;
      return;
    }
    
    // Second X press (within 500ms of first X)
    if (xPressed && (currentTime - lastKeyDownTime) < 500) {
      e.preventDefault();
      triggerSummarize();
      
      // Reset state
      resetKeyState();
      return;
    }
  }
  
  // If any other key, reset state
  if (e.key !== 'Control' && e.key.toLowerCase() !== 'x') {
    resetKeyState();
  }
}

// Reset key tracking state
function resetKeyState() {
  ctrlPressed = false;
  xPressed = false;
}

// Listen for key up to track when Ctrl is released
document.addEventListener('keyup', (e) => {
  if (e.key === 'Control') {
    ctrlPressed = false;
  }
  if (e.key.toLowerCase() === 'x') {
    // Only reset xPressed if enough time has passed since the last keydown
    const currentTime = Date.now();
    if (currentTime - lastKeyDownTime > 500) {
      xPressed = false;
    }
  }
});

// Trigger the summarize action
function triggerSummarize() {
  // Get settings just like the popup does
  chrome.storage.sync.get({
    summaryPrompt: 'Summarize the following content in 5-10 bullet points with timestamp if it\'s transcript.',
    contentOption: 'entire-content',
    aiModel: 'google-ai-studio'
  }, (settings) => {
    chrome.runtime.sendMessage({
      action: 'summarize',
      url: window.location.href,
      summaryPrompt: settings.summaryPrompt,
      contentOption: settings.contentOption,
      aiModel: settings.aiModel
    });
  });
}

// Add YouTube UI elements if settings allow and we're on YouTube
if (window.location.href.includes('youtube.com')) {
  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'transcriptStatus') {
      // Remove any existing loading notification
      const loadingNotification = document.querySelector('.yt-summary-notification');
      if (loadingNotification) {
        loadingNotification.remove();
      }
      
      // Show the new status
      showNotification(message.status, message.isLoading);
    }
  });

  chrome.storage.sync.get({
    ytWidget: 'visible',
    thumbButton: 'visible'
  }, (settings) => {
    if (settings.ytWidget === 'visible') {
      addYouTubeWidgets();
    }
    
    if (settings.thumbButton === 'visible') {
      addThumbnailButtons();
    }
  });
}

// Add summary widgets to YouTube video page
function addYouTubeWidgets() {
  // Wait for YouTube elements to load
  const observer = new MutationObserver((mutations) => {
    if (document.querySelector('#above-the-fold')) {
      addVideoPageButton();
      observer.disconnect();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Add summary button on YouTube video page
function addVideoPageButton() {
  // Don't add if button already exists
  if (document.querySelector('.yt-summary-button')) {
    return;
  }
  
  const aboveTheFold = document.querySelector('#above-the-fold');
  if (!aboveTheFold) return;
  
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'yt-summary-button';
  buttonContainer.style.cssText = `
    margin-top: 8px;
    display: flex;
    align-items: center;
  `;
  
  const summaryButton = document.createElement('button');
  summaryButton.textContent = '🤖 Summarize Video';
  summaryButton.style.cssText = `
    background-color: #f0f0f0;
    border: none;
    border-radius: 18px;
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    transition: background-color 0.2s;
  `;
  
  summaryButton.addEventListener('mouseover', () => {
    summaryButton.style.backgroundColor = '#e0e0e0';
  });
  
  summaryButton.addEventListener('mouseout', () => {
    summaryButton.style.backgroundColor = '#f0f0f0';
  });
  
  summaryButton.addEventListener('click', () => {
    triggerSummarize();
  });
  
  buttonContainer.appendChild(summaryButton);
  aboveTheFold.appendChild(buttonContainer);
}

// Add summary buttons to video thumbnails
function addThumbnailButtons() {
  // Initialize observer for thumbnail grids
  const observer = new MutationObserver((mutations) => {
    const thumbnails = document.querySelectorAll('ytd-thumbnail:not(.yt-summary-processed)');
    
    thumbnails.forEach(thumbnail => {
      thumbnail.classList.add('yt-summary-processed');
      
      const thumbnailOverlay = document.createElement('div');
      thumbnailOverlay.className = 'yt-summary-thumbnail-button';
      thumbnailOverlay.style.cssText = `
        position: absolute;
        bottom: 4px;
        right: 4px;
        background-color: rgba(0, 0, 0, 0.7);
        color: white;
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        z-index: 10;
        display: none;
      `;
      
      thumbnailOverlay.textContent = '🤖 Summarize';
      
      thumbnail.addEventListener('mouseenter', () => {
        thumbnailOverlay.style.display = 'block';
      });
      
      thumbnail.addEventListener('mouseleave', () => {
        thumbnailOverlay.style.display = 'none';
      });
      
      thumbnailOverlay.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Get the video URL
        const videoLink = thumbnail.closest('a');
        if (videoLink && videoLink.href) {
          chrome.runtime.sendMessage({
            action: 'summarize',
            url: videoLink.href
          });
        }
      });
      
      // Add overlay to thumbnail
      thumbnail.appendChild(thumbnailOverlay);
    });
  });
  
  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Handle website and PDF button if settings allow
if (!window.location.href.includes('youtube.com')) {
  chrome.storage.sync.get({
    webButton: 'visible'
  }, (settings) => {
    if (settings.webButton === 'visible') {
      addWebPageButton();
    }
  });
}

// Add summary button on regular web pages and PDFs
function addWebPageButton() {
  const isPDF = window.location.href.toLowerCase().endsWith('.pdf');
  
  // Create the floating button
  const floatingButton = document.createElement('div');
  floatingButton.className = 'web-summary-button';
  floatingButton.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background-color: #4285f4;
    color: white;
    border-radius: 50%;
    width: 56px;
    height: 56px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 9999;
    transition: transform 0.2s, background-color 0.2s;
  `;
  
  // Button icon
  const buttonIcon = document.createElement('div');
  buttonIcon.innerHTML = '🤖';
  buttonIcon.style.fontSize = '24px';
  
  // Close button
  const closeButton = document.createElement('div');
  closeButton.style.cssText = `
    position: absolute;
    top: -4px;
    right: -4px;
    background-color: #202124;
    color: white;
    border-radius: 50%;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    opacity: 0;
    transition: opacity 0.2s;
    z-index: 10000;
    padding: 2px;
    margin: -2px;
  `;
  closeButton.textContent = '×';
  
  closeButton.addEventListener('click', (e) => {
    e.stopPropagation();
    floatingButton.remove();
  });
  
  closeButton.addEventListener('mouseover', (e) => {
    e.stopPropagation();
    closeButton.style.backgroundColor = '#3c4043';
    closeButton.style.opacity = '1';
  });
  
  closeButton.addEventListener('mouseout', (e) => {
    e.stopPropagation();
    closeButton.style.backgroundColor = '#202124';
    // Only hide if the main button isn't being hovered
    if (!floatingButton.matches(':hover')) {
      closeButton.style.opacity = '0';
    }
  });
  
  floatingButton.appendChild(buttonIcon);
  floatingButton.appendChild(closeButton);
  
  // Hover effect
  floatingButton.addEventListener('mouseover', () => {
    floatingButton.style.transform = 'scale(1.1)';
    floatingButton.style.backgroundColor = '#3367d6';
    closeButton.style.opacity = '1';
  });
  
  floatingButton.addEventListener('mouseout', () => {
    floatingButton.style.transform = 'scale(1.0)';
    floatingButton.style.backgroundColor = '#4285f4';
    // Only hide if the close button isn't being hovered
    if (!closeButton.matches(':hover')) {
      closeButton.style.opacity = '0';
    }
  });
  
  // Click handler
  floatingButton.addEventListener('click', () => {
    triggerSummarize();
  });
  
  // Add tooltip
  const tooltip = document.createElement('div');
  tooltip.style.cssText = `
    position: absolute;
    top: -40px;
    right: 0;
    background-color: #202124;
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
  `;
  tooltip.textContent = 'Summarize with AI (Ctrl+X+X)';
  
  floatingButton.addEventListener('mouseenter', () => {
    tooltip.style.opacity = '1';
  });
  
  floatingButton.addEventListener('mouseleave', () => {
    tooltip.style.opacity = '0';
  });
  
  floatingButton.appendChild(tooltip);
  
  // Check if button should be hidden
  chrome.storage.sync.get({ webButtonHidden: false }, (settings) => {
    if (!settings.webButtonHidden) {
      // Add to page only if not hidden
      document.body.appendChild(floatingButton);
    }
  });
} 