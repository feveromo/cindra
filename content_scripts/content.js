let ctrlPressed = false;
let xPressed = false;
let lastKeyDownTime = 0;

try {
  document.addEventListener('keydown', handleShortcut);
} catch (error) {
  if (error.message.includes('Extension context invalidated')) {
    console.log('Extension context was invalidated, removing event listener');
    document.removeEventListener('keydown', handleShortcut);
  }
}

function handleShortcut(e) {
  // Hot reloads can invalidate the extension context while this page is still open.
  if (typeof chrome.runtime === 'undefined' || chrome.runtime.id === undefined) {
    console.log('Extension context invalid, removing event listener');
    document.removeEventListener('keydown', handleShortcut);
    return;
  }

  const currentTime = Date.now();

  if (e.key === 'Control') {
    ctrlPressed = true;
    lastKeyDownTime = currentTime;
    return;
  }

  if (ctrlPressed && e.key.toLowerCase() === 'x') {
    if (!xPressed) {
      xPressed = true;
      lastKeyDownTime = currentTime;
      return;
    }

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

      resetKeyState();
      return;
    }
  }

  if (e.key !== 'Control' && e.key.toLowerCase() !== 'x') {
    resetKeyState();
  }
}

function resetKeyState() {
  ctrlPressed = false;
  xPressed = false;
}

document.addEventListener('keyup', (e) => {
  if (e.key === 'Control') {
    ctrlPressed = false;
  }
  if (e.key.toLowerCase() === 'x') {
    const currentTime = Date.now();
    if (currentTime - lastKeyDownTime > 500) {
      xPressed = false;
    }
  }
});

function triggerSummarize() {
  // Hot reloads can invalidate the extension context while this page is still open.
  if (typeof chrome.runtime === 'undefined' || chrome.runtime.id === undefined) {
    console.log('Extension context invalid, cannot trigger summarize');
    return;
  }

  try {
    chrome.storage.sync.get({
      savedPrompts: [],
      activePromptId: null,
      aiModel: 'google-ai-studio'
    }, (settings) => {
      let summaryPrompt = 'Summarize the following content in 5-10 bullet points with timestamp if it\'s transcript.';

      if (settings.activePromptId && settings.savedPrompts.length > 0) {
        const activePrompt = settings.savedPrompts.find(p => p.id === settings.activePromptId);
        if (activePrompt) {
          summaryPrompt = activePrompt.text;
        }
      }

      chrome.runtime.sendMessage({
        action: 'summarize',
        url: window.location.href,
        summaryPrompt: summaryPrompt,
        aiModel: settings.aiModel
      });
    });
  } catch (error) {
    if (error.message.includes('Extension context invalidated')) {
      console.log('Extension context invalid during settings retrieval');
    }
  }
}

chrome.storage.sync.get({
  floatingButton: 'visible'
}, (settings) => {
  if (settings.floatingButton === 'visible') {
    addWebPageButton();
  }
});

function addWebPageButton() {
  if (window.location.href.toLowerCase().endsWith('.pdf')) {
    return;
  }

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

  const buttonIcon = document.createElement('img');
  try {
    buttonIcon.src = chrome.runtime.getURL('images/icon48.png');
  } catch (e) {
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
    if (!floatingButton.matches(':hover')) {
      closeButton.style.opacity = '0';
    }
  });

  floatingButton.appendChild(buttonIcon);
  floatingButton.appendChild(closeButton);

  floatingButton.addEventListener('mouseover', () => {
    floatingButton.style.transform = 'scale(1.1)';
    closeButton.style.opacity = '1';
  });

  floatingButton.addEventListener('mouseout', () => {
    floatingButton.style.transform = 'scale(1.0)';
    if (!closeButton.matches(':hover')) {
      closeButton.style.opacity = '0';
    }
  });

  floatingButton.addEventListener('click', () => {
    triggerSummarize();
  });

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

  document.body.appendChild(floatingButton);
}
