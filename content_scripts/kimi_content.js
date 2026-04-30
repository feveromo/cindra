console.log('Kimi content script loaded');

let isProcessing = false;

if (!window.kimiMessageListenerRegistered) {
  window.kimiMessageListenerRegistered = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message in Kimi content script:', message);
  if (message.action === 'insertPrompt') {
    if (isProcessing) {
      console.log('Already processing, ignoring message.');
      sendResponse({ success: false, error: 'Already processing' });
      return true;
    }
    isProcessing = true;
    console.log('Setting isProcessing = true (onMessage)');

    insertPromptAndSubmit(message.prompt)
      .then(() => {
        console.log('Prompt inserted and submitted successfully via message.');
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Error inserting prompt via message:', error);
        sendResponse({ success: false, error: error.message });
      })
      .finally(() => {
        isProcessing = false;
        console.log('Processing finished, resetting isProcessing flag to false (onMessage finally).');
        try {
          chrome.storage.local.set({ kimiInFlight: false });
        } catch (e) {}
      });
    return true;
  }
  });
}

function waitForElement(selector, textContent = null, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const intervalTime = 100;
    let elapsedTime = 0;

    const interval = setInterval(() => {
      let element = document.querySelector(selector);
      if (element && textContent) {
        if (element.textContent.trim() !== textContent) {
          element = null;
        }
      }

      if (element) {
        clearInterval(interval);
        resolve(element);
      } else {
        elapsedTime += intervalTime;
        if (elapsedTime >= timeout) {
          clearInterval(interval);
          let errorMsg = `Element not found after ${timeout}ms: ${selector}`;
          if (textContent) {
            errorMsg += ` with textContent "${textContent}"`;
          }
          reject(new Error(errorMsg));
        }
      }
    }, intervalTime);
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
  console.log('Starting text insertion into Lexical editor...');

  editableDiv.focus();

  try {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editableDiv);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('delete');
  } catch (e) {
    console.log('Initial clear failed (non-fatal):', e);
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
    console.log('Synthetic paste failed (non-fatal):', e);
  }

  try {
    editableDiv.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  } catch (e) {}

  editableDiv.focus();

  console.log('Text insertion complete.');
}

function forceSetEditableDivContent(editableDiv, text) {
  try {
    editableDiv.textContent = text;
    editableDiv.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  } catch (e) {
    console.log('Force set failed (non-fatal):', e);
  }
}

function robustClick(element) {
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Prefer one native click to avoid duplicate submit handlers.
  try {
    element.click();
    console.log('Native click() invoked on:', element);
  } catch (e) {
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window
    });
    element.dispatchEvent(clickEvent);
    console.log('Fallback click event dispatched on:', element);
  }
}

function isSendButtonEnabled(sendButtonContainer) {
  const isEnabled = !sendButtonContainer.classList.contains('disabled');
  console.log('Send button enabled check:', isEnabled, 'classList:', sendButtonContainer.classList.toString());
  return isEnabled;
}

function waitForSendButtonEnabled(timeout = 20000) {
  return new Promise((resolve, reject) => {
    const sendButtonContainer = document.querySelector('.send-button-container');
    if (sendButtonContainer && isSendButtonEnabled(sendButtonContainer)) {
      const sendButton = sendButtonContainer.querySelector('.send-button');
      if (sendButton) {
        console.log('Send button immediately available and enabled!');
        resolve(sendButton);
        return;
      }
    }

    const intervalTime = 100;
    let elapsedTime = 0;
    let lastLogTime = 0;

    console.log('Starting send button polling...');
    const interval = setInterval(() => {
      const sendButtonContainer = document.querySelector('.send-button-container');

      // Keep long waits observable without spamming every poll.
      if (elapsedTime - lastLogTime >= 3000) {
        console.log(`Waiting for send button... elapsed: ${elapsedTime}ms, container found: ${!!sendButtonContainer}`);
        if (sendButtonContainer) {
          console.log('Container classes:', sendButtonContainer.classList.toString());
        }
        lastLogTime = elapsedTime;
      }

      if (sendButtonContainer && isSendButtonEnabled(sendButtonContainer)) {
        clearInterval(interval);
        const sendButton = sendButtonContainer.querySelector('.send-button');
        if (sendButton) {
          console.log(`Send button found and enabled after ${elapsedTime}ms!`);
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
    console.log('Looking for input field for Kimi...');

    const inputSelectors = [
      '.chat-input-editor[contenteditable="true"]',
      '.chat-input [contenteditable="true"]',
      'div[contenteditable="true"][data-lexical-editor="true"]'
    ];

    let inputField = null;
    for (const sel of inputSelectors) {
      try {
        inputField = await waitForElement(sel, null, 1500);
        if (inputField) break;
      } catch (e) {
      }
    }
    if (!inputField) {
      inputField = await waitForElement('.chat-input-editor[contenteditable="true"]', null, 10000);
    }
    console.log('Input field found:', inputField);

    const initialSendContainer = document.querySelector('.send-button-container');
    console.log('Initial send button state:', initialSendContainer?.classList.toString() || 'not found');

    const normalizedPrompt = normalizePromptForKimi(prompt);

    insertTextIntoEditableDiv(inputField, normalizedPrompt);
    console.log('Prompt text inserted into Kimi input.');

    const insertedText = inputField.textContent || inputField.innerText || '';
    console.log('Verification - inserted text length:', insertedText.length);
    console.log('Verification - expected text length:', normalizedPrompt.length);

    if (insertedText.length < Math.min(100, Math.floor(normalizedPrompt.length * 0.8))) {
      console.log('Detected truncated insertion; applying force-set fallback...');
      forceSetEditableDivContent(inputField, normalizedPrompt);
    }

    const postInsertSendContainer = document.querySelector('.send-button-container');
    console.log('Post-insert send button state:', postInsertSendContainer?.classList.toString() || 'not found');

    console.log('Checking if send button is already enabled...');
    let sendButton;
    try {
      sendButton = await waitForSendButtonEnabled(1000);
      console.log('Send button was immediately available!');
    } catch (error) {
      console.log('Send button not immediately available, waiting for UI update...');

      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('Looking for enabled send button for Kimi (full check)...');
      sendButton = await waitForSendButtonEnabled();
    }
    console.log('Send button found and enabled:', sendButton);

    robustClick(sendButton);
    console.log('Send button click attempted.');

    chrome.storage.local.remove(['pendingKimiPrompt', 'kimiPromptTimestamp'], () => {
      if (chrome.runtime.lastError) {
        console.error('Error clearing pending Kimi prompt:', chrome.runtime.lastError);
      } else {
        console.log('Cleared pending Kimi prompt from storage after successful submission.');
      }
    });

  } catch (error) {
    console.error('Error in insertPromptAndSubmit for Kimi:', error);

    console.log('Attempting Enter key fallback...');
    try {
      const inputField = document.querySelector('.chat-input-editor[contenteditable="true"]');

      if (inputField) {
        console.log('[FALLBACK] Found input field, ensuring content is set...');
        insertTextIntoEditableDiv(inputField, prompt);

        console.log('[FALLBACK] Simulating Enter key...');
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
        console.log('[FALLBACK SUCCESS] Enter key simulated.');

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
    console.log('Processing already in progress, skipping pending Kimi prompt check.');
    return;
  }
  console.log('Checking for pending Kimi prompt...');
  // Ask the background worker to claim the prompt so multiple Kimi tabs cannot submit it.
  try {
    chrome.runtime.sendMessage({ action: 'claimKimiPrompt' }, (resp) => {
      if (chrome.runtime.lastError) {
        console.log('claimKimiPrompt failed, falling back to local get:', chrome.runtime.lastError.message);
        fallbackClaim();
        return;
      }
      if (!resp || !resp.success) {
        console.log('No claimable Kimi prompt or locked; skipping.');
        return;
      }
      isProcessing = true;
      console.log('Setting isProcessing = true (claimed via background)');
      insertPromptAndSubmit(resp.prompt)
        .then(() => console.log('Pending Kimi prompt processed successfully.'))
        .catch(error => {
          console.error('Error processing pending Kimi prompt:', error);
        })
        .finally(() => {
          isProcessing = false;
          console.log('Processing finished, resetting isProcessing flag to false (claimed finally).');
          try {
            chrome.storage.local.set({ kimiInFlight: false });
          } catch (e) {}
        });
    });
  } catch (e) {
    console.log('claimKimiPrompt threw; falling back to local get:', e);
    fallbackClaim();
  }

  function fallbackClaim() {
    chrome.storage.local.get(['pendingKimiPrompt', 'kimiPromptTimestamp'], (result) => {
    if (chrome.runtime.lastError) {
      console.error('Error getting pending Kimi prompt:', chrome.runtime.lastError);
      return;
    }

    if (isProcessing) {
      console.log('Processing started while waiting for storage, skipping pending Kimi prompt.');
      return;
    }

    if (result.pendingKimiPrompt && result.kimiPromptTimestamp) {
      const promptToProcess = result.pendingKimiPrompt;
      const timestamp = result.kimiPromptTimestamp;
      const promptAge = Date.now() - timestamp;

      if (promptAge < 60000) {
        console.log('Found pending Kimi prompt from storage:', promptToProcess.substring(0, 50) + '...');
        isProcessing = true;
        console.log('Setting isProcessing = true (checkPendingPrompt)');

        chrome.storage.local.remove(['pendingKimiPrompt', 'kimiPromptTimestamp'], () => {
          if (chrome.runtime.lastError) {
            console.error('Error clearing pending Kimi prompt before processing:', chrome.runtime.lastError);
            isProcessing = false;
            console.log('Resetting isProcessing due to clear error (checkPendingPrompt).');
            return;
          }
          console.log('Cleared pending Kimi prompt from storage before processing.');
          insertPromptAndSubmit(promptToProcess)
            .then(() => console.log('Pending Kimi prompt processed successfully.'))
            .catch(error => {
              console.error('Error processing pending Kimi prompt:', error);
            })
            .finally(() => {
                isProcessing = false;
                console.log('Processing finished, resetting isProcessing flag to false (checkPendingPrompt finally).');
                try {
                  chrome.storage.local.set({ kimiInFlight: false });
                } catch (e) {}
            });
        });
      } else {
        console.log('Pending Kimi prompt is too old, discarding.');
        chrome.storage.local.remove(['pendingKimiPrompt', 'kimiPromptTimestamp']);
      }
    } else {
      console.log('No pending Kimi prompt found in storage.');
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
