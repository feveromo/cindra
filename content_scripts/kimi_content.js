// Log when the script starts
console.log('Kimi content script loaded');

// Flag to prevent concurrent submissions
let isProcessing = false;

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
      });
    return true; // Indicates asynchronous response
  }
});

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

// Function to insert text into the content-editable div
function insertTextIntoEditableDiv(editableDiv, text) {
  console.log('Starting text insertion into Lexical editor...');
  editableDiv.focus();
  
  // Method 1: Try execCommand first (works well with rich text editors)
  try {
    // Clear existing content
    editableDiv.innerHTML = '';
    
    // Use execCommand to insert text
    const success = document.execCommand('insertText', false, text);
    console.log('execCommand insertText result:', success);
    
    if (success && editableDiv.textContent.trim()) {
      console.log('execCommand successful, text inserted:', editableDiv.textContent.length, 'characters');
    } else {
      throw new Error('execCommand failed or no text inserted');
    }
  } catch (error) {
    console.log('execCommand failed, trying direct insertion:', error.message);
    
    // Method 2: Direct DOM manipulation as fallback
    editableDiv.innerHTML = '';
    
    // Create a paragraph element with the text
    const p = document.createElement('p');
    p.textContent = text;
    editableDiv.appendChild(p);
    
    console.log('Direct DOM insertion completed');
  }
  
  // Method 3: Also try typing simulation for Lexical
  try {
    // Create and dispatch typing events
    const beforeInputEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
      composed: true
    });
    editableDiv.dispatchEvent(beforeInputEvent);
    
    const inputEvent = new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: text,
      composed: true
    });
    editableDiv.dispatchEvent(inputEvent);
    
    // Also dispatch change event
    editableDiv.dispatchEvent(new Event('change', { bubbles: true }));
    
    console.log('InputEvent and change events dispatched');
  } catch (error) {
    console.log('InputEvent dispatch failed:', error.message);
    
    // Fallback to basic events
    editableDiv.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    editableDiv.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('Basic events dispatched as fallback');
  }
  
  // Log final state
  console.log('Final editor content:', editableDiv.textContent.length, 'characters');
  console.log('Text inserted into content-editable div and events dispatched.');
}

// Alternative insertion method - character by character typing simulation
async function tryAlternativeInsertion(inputField, text) {
  console.log('Trying alternative character-by-character insertion...');
  
  inputField.focus();
  inputField.innerHTML = '';
  
  // Clear the field and ensure cursor is at the start
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(inputField);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  
  // Try pasting the text
  try {
    if (navigator.clipboard && window.ClipboardEvent) {
      // Store current clipboard content to restore later (if possible)
      let originalClipboard = '';
      try {
        originalClipboard = await navigator.clipboard.readText();
      } catch (e) {
        console.log('Cannot read clipboard:', e.message);
      }
      
      // Write our text to clipboard
      await navigator.clipboard.writeText(text);
      
      // Simulate Ctrl+V paste
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer()
      });
      pasteEvent.clipboardData.setData('text/plain', text);
      inputField.dispatchEvent(pasteEvent);
      
      // Restore original clipboard content
      if (originalClipboard) {
        try {
          await navigator.clipboard.writeText(originalClipboard);
        } catch (e) {
          console.log('Cannot restore clipboard:', e.message);
        }
      }
      
      console.log('Paste event dispatched');
    } else {
      throw new Error('Clipboard API not available');
    }
  } catch (error) {
    console.log('Paste method failed, trying direct textContent:', error.message);
    
    // Last resort - direct textContent
    inputField.textContent = text;
    
    // Dispatch comprehensive events
    inputField.dispatchEvent(new Event('focus', { bubbles: true }));
    inputField.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    inputField.dispatchEvent(new Event('change', { bubbles: true }));
    inputField.dispatchEvent(new Event('blur', { bubbles: true }));
    inputField.focus(); // Re-focus
  }
  
  // Final check
  const finalText = inputField.textContent || inputField.innerText || '';
  console.log('Alternative insertion result - text length:', finalText.length);
  
  return finalText.length > 0;
}

// Function to perform a robust click
function robustClick(element) {
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Since we already confirmed the button is ready, click immediately
  const mousedownEvent = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    view: window
  });
  const mouseupEvent = new MouseEvent('mouseup', {
    bubbles: true,
    cancelable: true,
    view: window
  });
  const clickEvent = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window
  });

  element.dispatchEvent(mousedownEvent);
  element.dispatchEvent(mouseupEvent);
  element.dispatchEvent(clickEvent);
  console.log('Robust click events dispatched on:', element);
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
    
    // Find the content-editable input field
    const inputSelector = '.chat-input-editor[contenteditable="true"]';
    const inputField = await waitForElement(inputSelector);
    console.log('Input field found:', inputField);

    // Check initial send button state
    const initialSendContainer = document.querySelector('.send-button-container');
    console.log('Initial send button state:', initialSendContainer?.classList.toString() || 'not found');

    insertTextIntoEditableDiv(inputField, prompt);
    console.log('Prompt text inserted into Kimi input.');
    
    // Verify text was actually inserted
    const insertedText = inputField.textContent || inputField.innerText || '';
    console.log('Verification - inserted text length:', insertedText.length);
    console.log('Verification - expected text length:', prompt.length);
    
    if (insertedText.trim().length === 0) {
      console.log('No text detected, trying alternative insertion method...');
      await tryAlternativeInsertion(inputField, prompt);
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
      
      // Give a brief wait for UI to update
      await new Promise(resolve => setTimeout(resolve, 300));
      
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
    throw error; // Re-throw to be caught by the caller
  }
}

// Check for pending prompts on page load
function checkPendingPrompt() {
  if (isProcessing) {
    console.log('Processing already in progress, skipping pending Kimi prompt check.');
    return;
  }
  console.log('Checking for pending Kimi prompt...');
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

// Check pending prompt when the script loads or the page becomes ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkPendingPrompt);
} else {
  // Small delay to ensure page elements might be more ready
  setTimeout(checkPendingPrompt, 250); 
}
