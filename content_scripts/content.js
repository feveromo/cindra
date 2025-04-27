// Track key states for Ctrl+X+X shortcut
let ctrlPressed = false;
let xPressed = false;
let lastKeyDownTime = 0;

// Listen for keyboard shortcut events
try {
  document.addEventListener('keydown', handleShortcut);
} catch (error) {
  if (error.message.includes('Extension context invalidated')) {
    console.log('Extension context was invalidated, removing event listener');
    document.removeEventListener('keydown', handleShortcut);
  }
}

function handleShortcut(e) {
  // Check if extension context is still valid
  // Safely check if chrome.runtime exists before accessing its properties
  if (typeof chrome.runtime === 'undefined' || chrome.runtime.id === undefined) {
    console.log('Extension context invalid, removing event listener');
    document.removeEventListener('keydown', handleShortcut);
    return;
  }

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
      try {
        triggerSummarize();
      } catch (error) {
        if (error.message.includes('Extension context invalidated')) {
          console.log('Extension context invalid during summarize, removing listener');
          document.removeEventListener('keydown', handleShortcut);
        }
      }
      
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
  // Check extension context before proceeding
  // Safely check if chrome.runtime exists
  if (typeof chrome.runtime === 'undefined' || chrome.runtime.id === undefined) {
    console.log('Extension context invalid, cannot trigger summarize');
    return;
  }

  // Get settings just like the popup does
  try {
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
  } catch (error) {
    if (error.message.includes('Extension context invalidated')) {
      console.log('Extension context invalid during settings retrieval');
    }
  }
}

// Initialize UI elements based on settings
chrome.storage.sync.get({
  floatingButton: 'visible'
}, (settings) => {
  // Add floating button if enabled (for all sites)
  if (settings.floatingButton === 'visible') {
    addWebPageButton();
  }
});

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
    background-color: white;
    color: #202124;
    border-radius: 50%;
    width: 42px;
    height: 42px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 9999;
    transition: transform 0.2s;
  `;
  
  // Button icon - Use Cindra logo
  const buttonIcon = document.createElement('img');
  try {
    // Make sure images/icon48.png exists in your project
    buttonIcon.src = chrome.runtime.getURL('images/icon48.png'); 
  } catch (e) {
    // Fallback if runtime is not available (e.g., during development hot-reloading)
    buttonIcon.alt = 'Summarize'; 
    console.warn("Could not get extension URL for icon. Is the extension loaded?");
  }
  buttonIcon.style.cssText = `
    width: 24px;
    height: 24px;
    display: block;
    position: relative;
    top: -2px;
  `;
  
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
    closeButton.style.opacity = '1';
  });
  
  floatingButton.addEventListener('mouseout', () => {
    floatingButton.style.transform = 'scale(1.0)';
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
  
  // Add to page
  document.body.appendChild(floatingButton);
} 