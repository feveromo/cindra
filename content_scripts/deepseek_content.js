// Content script specifically for DeepSeek Chat
console.log('DeepSeek content script loaded');

let isProcessing = false;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'insertPrompt') {
    if (isProcessing) {
      console.log('DeepSeek: Already processing, ignoring request');
      sendResponse({ success: false, error: 'Already processing' });
      return true;
    }
    
    isProcessing = true;
    insertPromptAndSubmit(message.prompt)
      .then(() => {
        console.log('DeepSeek: Successfully inserted and submitted prompt');
        sendResponse({ success: true });
      })
      .catch((err) => {
        console.error('DeepSeek: Error inserting prompt:', err);
        sendResponse({ success: false, error: err?.message || String(err) });
      })
      .finally(() => {
        isProcessing = false;
      });
    return true;
  }
});

// Wait for an element to appear in the DOM
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      return resolve(element);
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      const element = document.querySelector(selector);
      if (element) {
        clearInterval(interval);
        resolve(element);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(interval);
        reject(new Error(`Timeout waiting for element: ${selector}`));
      }
    }, 100);
  });
}

// Insert text into a textarea element
function insertTextIntoTextarea(textarea, text) {
  textarea.focus();
  textarea.value = text;
  
  // Dispatch events to trigger React's onChange handlers
  textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

// Perform a robust click on an element
function robustClick(element) {
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  
  // Dispatch mouse events to simulate a real click
  const events = ['mousedown', 'mouseup', 'click'];
  events.forEach(eventType => {
    const event = new MouseEvent(eventType, {
      bubbles: true,
      cancelable: true,
      view: window
    });
    element.dispatchEvent(event);
  });
}

// Main function to insert prompt and submit
async function insertPromptAndSubmit(prompt) {
  if (!prompt) {
    throw new Error('No prompt provided');
  }

  try {
    console.log('DeepSeek: Starting prompt insertion');
    
    // Wait for the textarea to be available
    const textarea = await waitForElement('textarea#chat-input');
    console.log('DeepSeek: Found textarea');
    
    // Insert the prompt into the textarea
    insertTextIntoTextarea(textarea, prompt);
    console.log('DeepSeek: Inserted text into textarea');
    
    // Wait a bit for the UI to update and enable the submit button
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Look for the submit button (the one that's not disabled)
    const submitButton = await waitForElement('div[role="button"][aria-disabled="false"]');
    console.log('DeepSeek: Found enabled submit button');
    
    // Click the submit button
    robustClick(submitButton);
    console.log('DeepSeek: Clicked submit button');
    
    // Clear the stored prompt to prevent reprocessing
    chrome.storage.local.remove(['pendingDeepseekPrompt', 'deepseekPromptTimestamp'], () => {
      console.log('DeepSeek: Cleared stored prompt');
    });
    
  } catch (error) {
    console.error('DeepSeek: Error in insertPromptAndSubmit:', error);
    throw error;
  }
}

// Check for pending prompts when the page loads
function checkPendingPrompt() {
  chrome.storage.local.get(['pendingDeepseekPrompt', 'deepseekPromptTimestamp'], (result) => {
    const prompt = result.pendingDeepseekPrompt;
    const timestamp = result.deepseekPromptTimestamp;
    
    if (!prompt) {
      return;
    }
    
    // Check if the prompt is still fresh (within 2 minutes)
    const isFresh = timestamp && (Date.now() - timestamp) < 120000;
    if (!isFresh) {
      console.log('DeepSeek: Prompt is too old, removing from storage');
      chrome.storage.local.remove(['pendingDeepseekPrompt', 'deepseekPromptTimestamp']);
      return;
    }
    
    console.log('DeepSeek: Found pending prompt, processing...');
    
    // Remove the prompt from storage before processing to avoid duplicates
    chrome.storage.local.remove(['pendingDeepseekPrompt', 'deepseekPromptTimestamp'], () => {
      // Process the prompt
      isProcessing = true;
      insertPromptAndSubmit(prompt)
        .then(() => {
          console.log('DeepSeek: Successfully processed pending prompt');
        })
        .catch((error) => {
          console.error('DeepSeek: Error processing pending prompt:', error);
        })
        .finally(() => {
          isProcessing = false;
        });
    });
  });
}

// Run the check for pending prompts after the page has loaded
setTimeout(checkPendingPrompt, 2000);


