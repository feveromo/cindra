// Log when the script starts
console.log('Kimi content script loaded');

// Flag to prevent concurrent submissions
let isProcessing = false;

// Prevent duplicate message listener registration
if (!window.kimiMessageListenerRegistered) {
  window.kimiMessageListenerRegistered = true;
  
  // Listen for messages from the background script
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
    return true; // Indicates asynchronous response
  }
  });
}

// Function to find element with retry mechanism
function waitForElement(selector, textContent = null, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const intervalTime = 100;
    let elapsedTime = 0;

    const interval = setInterval(() => {
      let element = document.querySelector(selector);
      if (element && textContent) {
        if (element.textContent.trim() !== textContent) {
          element = null; // Not the right element
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

// Ensure we only send one XML block (drop any accidental duplicate blocks)
function normalizePromptForKimi(prompt) {
  try {
    const closeTag = '</Content>';
    const firstCloseIdx = prompt.indexOf(closeTag);
    if (firstCloseIdx !== -1) {
      // Keep everything up to and including the first closing Content tag
      const trimmed = prompt.slice(0, firstCloseIdx + closeTag.length);
      return trimmed;
    }
    return prompt;
  } catch (e) {
    return prompt;
  }
}

// Function to insert text into the content-editable div
function insertTextIntoEditableDiv(editableDiv, text) {
  console.log('Starting text insertion into Lexical editor...');

  // Ensure focus
  editableDiv.focus();

  // Select and clear any existing content in the editor
  try {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editableDiv);
    selection.removeAllRanges();
    selection.addRange(range);
    // Delete current contents to avoid concatenation
    document.execCommand('delete');
  } catch (e) {
    console.log('Initial clear failed (non-fatal):', e);
  }

  // Use a single paste pathway to avoid double insertion; do not immediately fallback here.
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

  // Dispatch a single input event to notify listeners
  try {
    editableDiv.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  } catch (e) {}

  // Refocus to ensure recognition
  editableDiv.focus();

  console.log('Text insertion complete.');
}

// Forcefully set content when rich editor paste/insert fails
function forceSetEditableDivContent(editableDiv, text) {
  try {
    editableDiv.textContent = text;
    editableDiv.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  } catch (e) {
    console.log('Force set failed (non-fatal):', e);
  }
}

// Function to perform a robust click
function robustClick(element) {
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Prefer a single native click to avoid duplicate handlers
  try {
    element.click();
    console.log('Native click() invoked on:', element);
  } catch (e) {
    // Fallback: dispatch a single click event
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window
    });
    element.dispatchEvent(clickEvent);
    console.log('Fallback click event dispatched on:', element);
  }
}

// Function to check if send button is enabled (not disabled)
function isSendButtonEnabled(sendButtonContainer) {
  const isEnabled = !sendButtonContainer.classList.contains('disabled');
  console.log('Send button enabled check:', isEnabled, 'classList:', sendButtonContainer.classList.toString());
  return isEnabled;
}

// Function to wait for send button to be enabled with immediate check
function waitForSendButtonEnabled(timeout = 20000) {
  return new Promise((resolve, reject) => {
    // Try immediate check first
    const sendButtonContainer = document.querySelector('.send-button-container');
    if (sendButtonContainer && isSendButtonEnabled(sendButtonContainer)) {
      const sendButton = sendButtonContainer.querySelector('.send-button');
      if (sendButton) {
        console.log('Send button immediately available and enabled!');
        resolve(sendButton);
        return;
      }
    }

    const intervalTime = 100; // Check more frequently
    let elapsedTime = 0;
    let lastLogTime = 0;

    console.log('Starting send button polling...');
    const interval = setInterval(() => {
      const sendButtonContainer = document.querySelector('.send-button-container');
      
      // Log periodically for debugging but less frequently 
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

// Main function to handle inserting prompt and submitting
async function insertPromptAndSubmit(prompt) {
  try {
    console.log('Looking for input field for Kimi...');
    
    // Find the content-editable input field with robust selectors
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
        // continue trying next selector
      }
    }
    if (!inputField) {
      // Final attempt with default selector and longer timeout
      inputField = await waitForElement('.chat-input-editor[contenteditable="true"]', null, 10000);
    }
    console.log('Input field found:', inputField);

    // Check initial send button state
    const initialSendContainer = document.querySelector('.send-button-container');
    console.log('Initial send button state:', initialSendContainer?.classList.toString() || 'not found');

    // Normalize to avoid duplicated XML blocks
    const normalizedPrompt = normalizePromptForKimi(prompt);

    insertTextIntoEditableDiv(inputField, normalizedPrompt);
    console.log('Prompt text inserted into Kimi input.');
    
    // Verify text was actually inserted
    const insertedText = inputField.textContent || inputField.innerText || '';
    console.log('Verification - inserted text length:', insertedText.length);
    console.log('Verification - expected text length:', normalizedPrompt.length);

    // If insertion clearly failed or is severely truncated, force set the value
    if (insertedText.length < Math.min(100, Math.floor(normalizedPrompt.length * 0.8))) {
      console.log('Detected truncated insertion; applying force-set fallback...');
      forceSetEditableDivContent(inputField, normalizedPrompt);
    }

    // Check send button state after text insertion (but before waiting)
    const postInsertSendContainer = document.querySelector('.send-button-container');
    console.log('Post-insert send button state:', postInsertSendContainer?.classList.toString() || 'not found');

    // Try immediate button detection (might already be enabled)
    console.log('Checking if send button is already enabled...');
    let sendButton;
    try {
      sendButton = await waitForSendButtonEnabled(1000); // Very short timeout for immediate check
      console.log('Send button was immediately available!');
    } catch (error) {
      console.log('Send button not immediately available, waiting for UI update...');
      
      // Give Lexical time to sync its internal state with the DOM
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('Looking for enabled send button for Kimi (full check)...');
      sendButton = await waitForSendButtonEnabled();
    }
    console.log('Send button found and enabled:', sendButton);

    robustClick(sendButton);
    console.log('Send button click attempted.');

    // Clear pending prompt from storage after successful submission
    chrome.storage.local.remove(['pendingKimiPrompt', 'kimiPromptTimestamp'], () => {
      if (chrome.runtime.lastError) {
        console.error('Error clearing pending Kimi prompt:', chrome.runtime.lastError);
      } else {
        console.log('Cleared pending Kimi prompt from storage after successful submission.');
      }
    });

  } catch (error) {
    console.error('Error in insertPromptAndSubmit for Kimi:', error);
    
    // Fallback: Try Enter key simulation
    console.log('Attempting Enter key fallback...');
    try {
      const inputField = document.querySelector('.chat-input-editor[contenteditable="true"]');
      
      if (inputField) {
        console.log('[FALLBACK] Found input field, ensuring content is set...');
        insertTextIntoEditableDiv(inputField, prompt);
        
        // Simulate Enter key
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
        
        // Clear storage after fallback
        chrome.storage.local.remove(['pendingKimiPrompt', 'kimiPromptTimestamp']);
      }
    } catch (fallbackError) {
      console.error('[FALLBACK FAIL] Error during Enter key fallback:', fallbackError);
    }
    
    throw error; // Re-throw original error
  }
}

// Check for pending prompts on page load
function checkPendingPrompt() {
  if (isProcessing) {
    console.log('Processing already in progress, skipping pending Kimi prompt check.');
    return;
  }
  console.log('Checking for pending Kimi prompt...');
  // Ask background to atomically claim the prompt to avoid multi-claim across windows
  try {
    chrome.runtime.sendMessage({ action: 'claimKimiPrompt' }, (resp) => {
      if (chrome.runtime.lastError) {
        // Fallback to local get if messaging fails
        console.log('claimKimiPrompt failed, falling back to local get:', chrome.runtime.lastError.message);
        fallbackClaim();
        return;
      }
      if (!resp || !resp.success) {
        console.log('No claimable Kimi prompt or locked; skipping.');
        return;
      }
      // We obtained the prompt exclusively
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

    if (isProcessing) { // Check again in case of race condition
      console.log('Processing started while waiting for storage, skipping pending Kimi prompt.');
      return;
    }

    if (result.pendingKimiPrompt && result.kimiPromptTimestamp) {
      const promptToProcess = result.pendingKimiPrompt;
      const timestamp = result.kimiPromptTimestamp;
      const promptAge = Date.now() - timestamp;

      // Check if the prompt is recent (e.g., within the last 60 seconds)
      if (promptAge < 60000) { // 1 minute
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

// Check pending prompt when the script loads or the page becomes ready
// Only run once to prevent duplicate processing
if (!window.kimiPendingPromptChecked) {
  window.kimiPendingPromptChecked = true;
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPendingPrompt);
  } else {
    // Small delay to ensure page elements might be more ready
    setTimeout(checkPendingPrompt, 250); 
  }
}
