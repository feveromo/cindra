// Content script specifically for Grok.com
console.log('Grok content script loaded');

// Flag to track whether we've already submitted the prompt
let promptSubmitted = false;
// Flag to track if we're currently in the submission process
let isSubmitting = false;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in Grok content script:', message);
  
  if (message.action === 'insertPrompt') {
    // Reset flags for each new request
    isSubmitting = false;
    promptSubmitted = false;
    
    insertPromptAndSubmit(message.prompt, message.title);
    sendResponse({ status: 'Processing prompt' });
    return true;
  }
});

// Function to wait for an element (or one of many) to appear in the DOM
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    // Handle array of selectors
    if (Array.isArray(selector)) {
      // Immediate check
      for (const sel of selector) {
        const element = document.querySelector(sel);
        if (element) {
          console.log(`Element found immediately: ${sel}`);
          return resolve(element);
        }
      }

      console.log(`Waiting for elements: ${selector.join(', ')}`);

      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        for (const sel of selector) {
          const element = document.querySelector(sel);
          if (element) {
            clearInterval(checkInterval);
            console.log(`Element found: ${sel}`);
            resolve(element);
            return;
          }
        }

        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          reject(new Error(`Timeout waiting for elements: ${selector.join(', ')}`));
        }
      }, 100);
      return;
    }

    // Single selector handling
    const element = document.querySelector(selector);
    if (element) {
      console.log(`Element found immediately: ${selector}`);
      return resolve(element);
    }

    console.log(`Waiting for element: ${selector}`);

    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      const element = document.querySelector(selector);
      if (element) {
        clearInterval(checkInterval);
        console.log(`Element found: ${selector}`);
        resolve(element);
        return;
      }

      if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error(`Timeout waiting for element: ${selector}`));
      }
    }, 100);
  });
}

// Function to insert prompt into the textarea and submit
function insertPromptAndSubmit(prompt, title) {
  if (!prompt) {
    console.warn('Received empty prompt, not inserting');
    return;
  }
  
  // If we're already submitting or submitted, don't start again
  if (isSubmitting || promptSubmitted) {
    console.log('Already submitting or submitted, ignoring duplicate call');
    return;
  }
  
  // Set flag that we're in the submission process
  isSubmitting = true;
  
  console.log('Attempting to insert prompt into Grok');

  // Try to find the editor/input (ProseMirror or textarea)
  waitForElement([
    'div.tiptap.ProseMirror[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"].tiptap',
    'div[contenteditable="true"]',
    'textarea[dir="auto"]'
  ])
    .then(inputEl => {
      console.log('Input element found:', inputEl);

      const isEditableDiv = inputEl.getAttribute && inputEl.getAttribute('contenteditable') === 'true';

      if (isEditableDiv) {
        // Clear, focus, and inject text preserving formatting
        inputEl.innerHTML = '';
        inputEl.focus();

        const pre = document.createElement('pre');
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.wordBreak = 'break-word';
        pre.style.margin = '0';
        pre.appendChild(document.createTextNode(prompt));
        inputEl.appendChild(pre);

        // Dispatch input events so the editor detects changes
        try {
          inputEl.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: prompt
          }));
        } catch (_) {}
        try {
          inputEl.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: prompt
          }));
        } catch (_) {
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }

        console.log('Content inserted into ProseMirror, length:', (inputEl.textContent || '').length);
      } else {
        // Fallback: plain textarea
        inputEl.value = '';
        inputEl.focus();
        inputEl.value = prompt;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));

        console.log('Content inserted into textarea, length:', inputEl.value.length);
      }

      // Give the UI a moment to enable send
      return new Promise(resolve => setTimeout(resolve, 600));
    })
    .then(() => {
      // Prefer a visible, enabled submit button if present
      return waitForElement([
        'button[aria-label="Submit"]:not([disabled])',
        'button[type="submit"]:not([disabled])'
      ], 1500).catch(() => null);
    })
    .then(submitButton => {
      if (submitButton) {
        console.log('Submit button found, clicking:', submitButton);
        submitButton.click();
      } else {
        // Fall back to simulating Enter key on the editor
        console.log('Submit button not found; attempting Enter key submit');
        const editor = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea[dir="auto"]');
        if (editor) {
          editor.focus();
          const keydown = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });
          const keyup = new KeyboardEvent('keyup', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true
          });
          editor.dispatchEvent(keydown);
          editor.dispatchEvent(keyup);
        } else {
          console.warn('No editor found to dispatch Enter');
        }
      }

      // Mark as submitted
      promptSubmitted = true;
      isSubmitting = false;

      // Clear the pending prompt to prevent resubmission when tab is reopened
      chrome.storage.local.remove(['pendingGrokPrompt', 'pendingGrokTitle', 'grokPromptTimestamp']);

      console.log('Prompt submitted to Grok');
    })
    .catch(error => {
      // Reset the submission flag
      isSubmitting = false;
      
      console.error('Error in insertPromptAndSubmit:', error.message);
      
      // Try alternative method - Enter key
      try {
        console.log('Trying Enter key method');
        const editor = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea[dir="auto"]');

        if (editor) {
          // Ensure content is present
          if (editor.getAttribute && editor.getAttribute('contenteditable') === 'true') {
            editor.innerHTML = '';
            const pre = document.createElement('pre');
            pre.style.whiteSpace = 'pre-wrap';
            pre.style.wordBreak = 'break-word';
            pre.style.margin = '0';
            pre.appendChild(document.createTextNode(prompt));
            editor.appendChild(pre);
            try {
              editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
            } catch (_) {
              editor.dispatchEvent(new Event('input', { bubbles: true }));
            }
          } else {
            editor.value = prompt;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
          }

          // Focus and simulate Enter
          editor.focus();
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });

          editor.dispatchEvent(enterEvent);
          console.log('Enter key simulated');

          // Mark as submitted
          promptSubmitted = true;

          // Clear the pending prompt to prevent resubmission when tab is reopened
          chrome.storage.local.remove(['pendingGrokPrompt', 'pendingGrokTitle', 'grokPromptTimestamp']);

          console.log('Prompt submitted with alternative method');
        } else {
          console.error('Could not find input field. Please submit manually.');
        }
      } catch (e) {
        console.error('Alternative method failed:', e);
        console.error('All submission methods failed. Please submit manually.');
      }
    });
}

// Auto-check for pending prompts when the page loads
function checkForPendingPrompts() {
  // Only check if not already submitting
  if (isSubmitting || promptSubmitted) {
    return;
  }
  
  console.log('Checking for pending prompts for Grok');
  
  chrome.storage.local.get(['pendingGrokPrompt', 'pendingGrokTitle', 'grokPromptTimestamp'], function(result) {
    if (result.pendingGrokPrompt) {
      // Check if the prompt is fresh (created within the last 2 minutes)
      const currentTime = Date.now();
      const promptTime = result.grokPromptTimestamp || 0;
      const twoMinutesInMs = 2 * 60 * 1000;
      
      if (currentTime - promptTime < twoMinutesInMs) {
        console.log('Found fresh pending prompt for Grok, inserting');
        insertPromptAndSubmit(result.pendingGrokPrompt, result.pendingGrokTitle);
      } else {
        console.log('Found stale pending prompt for Grok, ignoring');
        // Clear old prompts to prevent future resubmissions
        chrome.storage.local.remove(['pendingGrokPrompt', 'pendingGrokTitle', 'grokPromptTimestamp']);
      }
    }
  });
}

// Check for pending prompts after a short delay
setTimeout(checkForPendingPrompts, 2000); 