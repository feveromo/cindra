let isProcessing = false;

if (!window.kimiMessageListenerRegistered) {
  window.kimiMessageListenerRegistered = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'insertPrompt') {
    if (isProcessing) {
      sendResponse({ success: false, error: 'Already processing' });
      return true;
    }
    isProcessing = true;

    insertPromptAndSubmit(message.prompt)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Error inserting prompt via message:', error);
        sendResponse({ success: false, error: error.message });
      })
      .finally(() => {
        isProcessing = false;
        try {
          chrome.storage.local.set({ kimiInFlight: false });
        } catch (e) {}
      });
    return true;
  }
  });
}

function normalizePromptForKimi(prompt) {
  try {
    const closeTag = '</Content>';
    const firstCloseIdx = prompt.indexOf(closeTag);
    if (firstCloseIdx !== -1) {
      const trimmed = prompt.slice(0, firstCloseIdx + closeTag.length);
      return trimmed;
    }
    return prompt;
  } catch (e) {
    return prompt;
  }
}

function insertTextIntoEditableDiv(editableDiv, text) {
  editableDiv.focus();

  try {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editableDiv);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('delete');
  } catch (e) {
  }

  // Kimi's Lexical editor can double-insert if paste and fallback both run.
  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true
    });
    editableDiv.dispatchEvent(pasteEvent);
  } catch (e) {
  }

  try {
    editableDiv.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  } catch (e) {}

  editableDiv.focus();
}

function forceSetEditableDivContent(editableDiv, text) {
  try {
    editableDiv.textContent = text;
    editableDiv.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  } catch (e) {
  }
}

function robustClick(element) {
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Prefer one native click to avoid duplicate submit handlers.
  try {
    element.click();
  } catch (e) {
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window
    });
    element.dispatchEvent(clickEvent);
  }
}

function isSendButtonEnabled(sendButtonContainer) {
  const isEnabled = !sendButtonContainer.classList.contains('disabled');
  return isEnabled;
}

function waitForSendButtonEnabled(timeout = 20000) {
  return new Promise((resolve, reject) => {
    const sendButtonContainer = document.querySelector('.send-button-container');
    if (sendButtonContainer && isSendButtonEnabled(sendButtonContainer)) {
      const sendButton = sendButtonContainer.querySelector('.send-button');
      if (sendButton) {
        resolve(sendButton);
        return;
      }
    }

    const intervalTime = 100;
    let elapsedTime = 0;

    const interval = setInterval(() => {
      const sendButtonContainer = document.querySelector('.send-button-container');

      if (sendButtonContainer && isSendButtonEnabled(sendButtonContainer)) {
        clearInterval(interval);
        const sendButton = sendButtonContainer.querySelector('.send-button');
        if (sendButton) {
          resolve(sendButton);
        } else {
          console.error('Send button container found but send button element not found');
          reject(new Error('Send button container found but send button element not found'));
        }
      } else {
        elapsedTime += intervalTime;
        if (elapsedTime >= timeout) {
          clearInterval(interval);
          console.error(`Send button not enabled after ${timeout}ms`);
          if (sendButtonContainer) {
            console.error('Final container state:', sendButtonContainer.classList.toString());
          }
          reject(new Error(`Send button not enabled after ${timeout}ms`));
        }
      }
    }, intervalTime);
  });
}

async function insertPromptAndSubmit(prompt) {
  try {
    const inputSelectors = [
      '.chat-input-editor[contenteditable="true"]',
      '.chat-input [contenteditable="true"]',
      'div[contenteditable="true"][data-lexical-editor="true"]'
    ];

    let inputField = null;
    for (const sel of inputSelectors) {
      try {
        inputField = await CindraInject.waitForElement(sel, 1500);
        if (inputField) break;
      } catch (e) {
      }
    }
    if (!inputField) {
      inputField = await CindraInject.waitForElement('.chat-input-editor[contenteditable="true"]', 10000);
    }

    const normalizedPrompt = normalizePromptForKimi(prompt);

    insertTextIntoEditableDiv(inputField, normalizedPrompt);

    const insertedText = inputField.textContent || inputField.innerText || '';

    if (insertedText.length < Math.min(100, Math.floor(normalizedPrompt.length * 0.8))) {
      forceSetEditableDivContent(inputField, normalizedPrompt);
    }

    let sendButton;
    try {
      sendButton = await waitForSendButtonEnabled(1000);
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      sendButton = await waitForSendButtonEnabled();
    }

    robustClick(sendButton);

    chrome.storage.local.remove(['pendingKimiPrompt', 'kimiPromptTimestamp'], () => {
      if (chrome.runtime.lastError) {
        console.error('Error clearing pending Kimi prompt:', chrome.runtime.lastError);
      }
    });

  } catch (error) {
    console.error('Error in insertPromptAndSubmit for Kimi:', error);

    try {
      const inputField = document.querySelector('.chat-input-editor[contenteditable="true"]');

      if (inputField) {
        insertTextIntoEditableDiv(inputField, prompt);

        inputField.focus();
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        });
        inputField.dispatchEvent(enterEvent);

        chrome.storage.local.remove(['pendingKimiPrompt', 'kimiPromptTimestamp']);
      }
    } catch (fallbackError) {
      console.error('[FALLBACK FAIL] Error during Enter key fallback:', fallbackError);
    }

    throw error;
  }
}

function checkPendingPrompt() {
  if (isProcessing) {
    return;
  }
  // Ask the background worker to claim the prompt so multiple Kimi tabs cannot submit it.
  try {
    chrome.runtime.sendMessage({ action: 'claimKimiPrompt' }, (resp) => {
      if (chrome.runtime.lastError) {
        fallbackClaim();
        return;
      }
      if (!resp || !resp.success) {
        return;
      }
      isProcessing = true;
      insertPromptAndSubmit(resp.prompt)
        .then(() => {})
        .catch(error => {
          console.error('Error processing pending Kimi prompt:', error);
        })
        .finally(() => {
          isProcessing = false;
          try {
            chrome.storage.local.set({ kimiInFlight: false });
          } catch (e) {}
        });
    });
  } catch (e) {
    fallbackClaim();
  }

  function fallbackClaim() {
    chrome.storage.local.get(['pendingKimiPrompt', 'kimiPromptTimestamp'], (result) => {
    if (chrome.runtime.lastError) {
      console.error('Error getting pending Kimi prompt:', chrome.runtime.lastError);
      return;
    }

    if (isProcessing) {
      return;
    }

    if (result.pendingKimiPrompt && result.kimiPromptTimestamp) {
      const promptToProcess = result.pendingKimiPrompt;
      const timestamp = result.kimiPromptTimestamp;
      const promptAge = Date.now() - timestamp;

      if (promptAge < 60000) {
        isProcessing = true;

        chrome.storage.local.remove(['pendingKimiPrompt', 'kimiPromptTimestamp'], () => {
          if (chrome.runtime.lastError) {
            console.error('Error clearing pending Kimi prompt before processing:', chrome.runtime.lastError);
            isProcessing = false;
            return;
          }
          insertPromptAndSubmit(promptToProcess)
            .then(() => {})
            .catch(error => {
              console.error('Error processing pending Kimi prompt:', error);
            })
            .finally(() => {
                isProcessing = false;
                try {
                  chrome.storage.local.set({ kimiInFlight: false });
                } catch (e) {}
            });
        });
      } else {
        chrome.storage.local.remove(['pendingKimiPrompt', 'kimiPromptTimestamp']);
      }
    }
  });
  }
}

if (!window.kimiPendingPromptChecked) {
  window.kimiPendingPromptChecked = true;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPendingPrompt);
  } else {
    setTimeout(checkPendingPrompt, 250);
  }
}
