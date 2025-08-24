// Content script specifically for Perplexity.ai
console.log('Perplexity content script loaded');

// Flag to track whether we've already submitted the prompt
let promptSubmitted = false;
// Flag to track if we're currently in the submission process
let isSubmitting = false;

// Function to check if the page is ready (main content loaded)
function isPageReady() {
  // Check for the new contenteditable input field
  const selectors = [
    '#ask-input',
    'div[contenteditable="true"][role="textbox"]',
    'div[data-lexical-editor="true"]',
    // Fallback selectors for old UI
    'textarea[placeholder="Ask anything..."]',
    '.rounded-3xl textarea',
    'textarea.resize-none'
  ];
  for (const selector of selectors) {
    if (document.querySelector(selector)) {
      return true; // Found one of the potential input areas
    }
  }
  return false; // None of the input areas were found
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in Perplexity content script:', message);
  
  if (message.action === 'insertPrompt') {
    // If already submitting, log and ignore the message to prevent duplicates
    if (isSubmitting || promptSubmitted) {
      console.log('Submission already in progress or completed, ignoring message listener trigger.');
      sendResponse({ status: 'Submission already handled' });
      return true;
    }

    // DO NOT reset flags here, respect the current state
    // isSubmitting = false; 
    // promptSubmitted = false;
    
    // If page is ready, process immediately, otherwise wait for it
    if (isPageReady()) {
      insertPromptAndSubmit(message.prompt, message.title);
      sendResponse({ status: 'Processing prompt' });
    } else {
      // Wait for page to be ready, but not too long
      console.log('Waiting for page to be ready...');
      waitForPageReady().then(() => {
        insertPromptAndSubmit(message.prompt, message.title);
      });
      sendResponse({ status: 'Will process when page is ready' });
    }
    return true;
  }
});

// Function to wait for the page to be ready
function waitForPageReady(timeout = 10000) {
  if (isPageReady()) {
    return Promise.resolve();
  }
  
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkInterval = setInterval(() => {
      if (isPageReady()) {
        clearInterval(checkInterval);
        resolve();
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error('Timeout waiting for page to be ready'));
      }
    }, 100); // Check every 100ms
  });
}

// Function to wait for an element to appear in the DOM
function waitForElement(selectors, timeout = 10000) {
  return new Promise((resolve, reject) => {
    // If selectors is a string, convert to array
    if (typeof selectors === 'string') {
      selectors = [selectors];
    }
    
    // Try all selectors to find one that works
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        console.log(`Element found immediately: ${selector}`);
        return resolve(element);
      }
    }
    
    console.log(`Waiting for elements: ${selectors.join(', ')}`);
    
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          clearInterval(checkInterval);
          console.log(`Element found: ${selector}`);
          resolve(element);
          return;
        }
      }
      
      if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error(`Timeout waiting for elements: ${selectors.join(', ')}`));
      }
    }, 50); // Check more frequently (every 50ms)
  });
}

// Function to find the input area with multiple possible strategies
function findInputArea() {
  console.log('Trying to find Perplexity input area...');
  
  // List of selectors to try, in order of preference. The new UI uses a contenteditable div.
  const selectors = [
    '#ask-input', // Specific ID for the contenteditable div
    'div[contenteditable="true"][role="textbox"]', // More generic selector for the new input
    'div[data-lexical-editor="true"]', // Another specific attribute of the new input
    'textarea[placeholder="Ask anything..."]', // Fallback for old UI
    'textarea.resize-none', // Fallback for old UI
  ];
  
  return waitForElement(selectors);
}

// Function to find the submit button with multiple strategies
function findSubmitButton() {
  console.log('Trying to find Perplexity submit button...');
  
  // Debug: Log all buttons on the page to understand the structure
  const allButtons = document.querySelectorAll('button');
  console.log(`Found ${allButtons.length} buttons on the page:`);
  allButtons.forEach((btn, index) => {
    console.log(`Button ${index}:`, {
      text: btn.textContent?.trim(),
      ariaLabel: btn.getAttribute('aria-label'),
      dataTestId: btn.getAttribute('data-testid'),
      className: btn.className,
      disabled: btn.disabled,
      type: btn.getAttribute('type')
    });
  });
  
  // First, try to find the submit button specifically by data-testid
  const submitButton = document.querySelector('button[data-testid="submit-button"]');
  if (submitButton && !submitButton.disabled) {
    console.log('Found submit button by data-testid');
    return Promise.resolve(submitButton);
  }
  
  // If no submit button found, look for buttons with "Submit" aria-label (but not "Voice mode")
  const submitButtons = document.querySelectorAll('button[aria-label="Submit"]');
  for (const button of submitButtons) {
    if (!button.disabled && button.getAttribute('aria-label') === 'Submit') {
      console.log('Found submit button by aria-label="Submit"');
      return Promise.resolve(button);
    }
  }
  
  // Look for buttons with arrow-right icon (submit button) but avoid voice button
  const arrowButtons = document.querySelectorAll('button svg.tabler-icon-arrow-right');
  for (const svg of arrowButtons) {
    const button = svg.closest('button');
    if (button && !button.disabled && button.getAttribute('aria-label') !== 'Voice mode') {
      console.log('Found submit button by arrow icon (not voice)');
      return Promise.resolve(button);
    }
  }
  
  // Fallback: look for any button with bg-super class that's not the voice button
  const superButtons = document.querySelectorAll('button.bg-super');
  for (const button of superButtons) {
    if (!button.disabled && button.getAttribute('aria-label') !== 'Voice mode') {
      console.log('Found submit button by bg-super class (not voice)');
      return Promise.resolve(button);
    }
  }
  
  // If still not found, wait for the submit button to appear
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const timeout = 10000; // 10 seconds
    
    const checkInterval = setInterval(() => {
      // Check for submit button by data-testid first
      const submitButton = document.querySelector('button[data-testid="submit-button"]');
      if (submitButton && !submitButton.disabled) {
        clearInterval(checkInterval);
        console.log('Found submit button by data-testid (waited)');
        resolve(submitButton);
        return;
      }
      
      // Check for submit button by aria-label
      const submitButtons = document.querySelectorAll('button[aria-label="Submit"]');
      for (const button of submitButtons) {
        if (!button.disabled && button.getAttribute('aria-label') === 'Submit') {
          clearInterval(checkInterval);
          console.log('Found submit button by aria-label (waited)');
          resolve(button);
          return;
        }
      }
      
      // Check for arrow button that's not voice
      const arrowButtons = document.querySelectorAll('button svg.tabler-icon-arrow-right');
      for (const svg of arrowButtons) {
        const button = svg.closest('button');
        if (button && !button.disabled && button.getAttribute('aria-label') !== 'Voice mode') {
          clearInterval(checkInterval);
          console.log('Found submit button by arrow icon (waited)');
          resolve(button);
          return;
        }
      }
      
      if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error('Submit button not found within timeout'));
      }
    }, 200); // Check every 200ms
  });
}

// Function to insert text into a contenteditable div
function insertTextIntoContentEditable(element, text) {
  console.log('Inserting text into contenteditable element:', element);
  
  // Focus the element first
  element.focus();
  
  // Clear any existing content
  element.innerHTML = '';
  
  // Use execCommand to insert text (works well with rich text editors)
  document.execCommand('insertText', false, text);
  
  // If execCommand doesn't work, try direct textContent
  if (!element.textContent || element.textContent.trim() === '') {
    element.textContent = text;
  }
  
  // Dispatch events to trigger UI updates
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  
  // Focus again to ensure the content is recognized
  element.focus();
  
  // Verify the content was set
  console.log('Text content after insertion:', element.textContent);
  console.log('InnerHTML after insertion:', element.innerHTML);
}

// Function to insert prompt into the input area and submit
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
  console.log('Setting isSubmitting = true');
  isSubmitting = true;
  
  console.log('Attempting to insert prompt into Perplexity');

  // Try to find the input area immediately
  findInputArea()
    .then(inputArea => {
      console.log('[SUCCESS] Input area found:', inputArea);
      
      // Focus the input area
      console.log('Focusing input area...');
      inputArea.focus();
      
      // Check if it's a textarea or a contenteditable div and set value accordingly
      console.log('Setting input area value...');
      if (inputArea.tagName === 'TEXTAREA') {
        // Handle textarea (old UI)
        inputArea.value = prompt;
        inputArea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        inputArea.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        // Handle contenteditable div (new UI)
        console.log('Input area is contenteditable, using insertTextIntoContentEditable');
        console.log('Prompt to insert:', prompt);
        insertTextIntoContentEditable(inputArea, prompt);
      }
      
      console.log('Input area value set to:', (inputArea.value || inputArea.textContent || inputArea.innerText).substring(0, 100) + '...');
      console.log('Input area innerHTML:', inputArea.innerHTML.substring(0, 100) + '...');

      // Focus again to ensure the content is recognized
      console.log('Refocusing input area...');
      inputArea.focus();
      
      console.log('Content insertion steps complete. Waiting before finding button...');
      
      // Give the UI a moment to update
      return new Promise(resolve => setTimeout(() => resolve(inputArea), 2000)); // Increased delay for new UI to show submit button
    })
    .then((inputArea) => { // Receive inputArea if needed
      // Look for the enabled submit button
      console.log('Looking for submit button...');
      const checkForButton = (attempts = 0, maxAttempts = 15) => {
        return findSubmitButton()
          .then(submitButton => {
            console.log('[SUCCESS] Submit button found, clicking:', submitButton);
            
            // Click the submit button
            submitButton.click();
            
            // Mark as submitted
            console.log('Setting promptSubmitted = true, isSubmitting = false after click');
            promptSubmitted = true;
            isSubmitting = false;
            
            // Clear the pending prompt
            console.log('Clearing pending prompt from storage after successful submission.');
            chrome.storage.local.remove(['pendingPerplexityPrompt', 'pendingPerplexityTitle']);
            
            console.log('Prompt submitted to Perplexity successfully.');
          })
          .catch(error => {
            console.log(`Submit button not found on attempt ${attempts + 1}/${maxAttempts}.`);
            if (attempts < maxAttempts) {
              return new Promise(resolve => setTimeout(() => resolve(checkForButton(attempts + 1, maxAttempts)), 500)); // Increased delay
            } else {
              console.error('[FAIL] Submit button not found after multiple attempts.');
              // Pass the original input area to the catch block if needed
              throw new Error('Submit button timeout'); 
            }
          });
      };
      
      return checkForButton();
    })
    .catch(error => {
      console.error('[ERROR] Caught error in insertPromptAndSubmit main chain:', error.message);
      // Reset the submission flag regardless of fallback outcome
      console.log('Setting isSubmitting = false in main catch block.');
      isSubmitting = false;
      
      // Fallback: Try simulating Enter for contenteditable
      console.log('Attempting Enter key fallback...');
      try {
        // Reuse the input area if passed, otherwise query again
        const potentialInputArea = document.querySelector('#ask-input') || 
                                 document.querySelector('div[contenteditable="true"]') ||
                                 document.querySelector('textarea[placeholder="Ask anything..."]');
        
        if (potentialInputArea) {
          console.log('[FALLBACK] Found input area for fallback:', potentialInputArea);
          // Ensure content is set (might have failed before)
          console.log('[FALLBACK] Setting input area value...');
          if (potentialInputArea.tagName === 'TEXTAREA') {
            potentialInputArea.value = prompt;
            potentialInputArea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          } else {
            insertTextIntoContentEditable(potentialInputArea, prompt);
          }
          
          // Focus and simulate Enter
          console.log('[FALLBACK] Focusing and simulating Enter key...');
          potentialInputArea.focus();
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });
          
          potentialInputArea.dispatchEvent(enterEvent);
          console.log('[FALLBACK SUCCESS] Enter key simulated.');
          
          // Mark as submitted and reset flags
          console.log('[FALLBACK] Setting promptSubmitted = true, isSubmitting = false after fallback success');
          promptSubmitted = true;
          isSubmitting = false; // Ensure reset here
          
          // Clear the pending prompt
          console.log('[FALLBACK] Clearing pending prompt from storage after fallback success.');
          chrome.storage.local.remove(['pendingPerplexityPrompt', 'pendingPerplexityTitle']);
        } else {
          console.error('[FALLBACK FAIL] Could not find input area for fallback.');
          // Ensure flag is reset
          isSubmitting = false;
        }
      } catch (e) {
        console.error('[FALLBACK FAIL] Error during Enter key fallback:', e);
        // Ensure flag is reset
        isSubmitting = false;
      }
    });
}

// Auto-check for pending prompts when the page loads
function checkForPendingPrompts() {
  // Reset flags at the beginning of the check to ensure a clean state for this page load
  console.log('Resetting isSubmitting and promptSubmitted flags in checkForPendingPrompts');
  isSubmitting = false;
  promptSubmitted = false;
  
  // Only check if not already submitting (redundant now but safe)
  if (isSubmitting || promptSubmitted) {
    return;
  }
  
  console.log('Checking for pending prompts for Perplexity');
  
  chrome.storage.local.get(['pendingPerplexityPrompt', 'pendingPerplexityTitle', 'perplexityPromptTimestamp'], function(result) {
    if (result.pendingPerplexityPrompt) {
      // Check if the prompt is fresh (created within the last 2 minutes)
      const currentTime = Date.now();
      const promptTime = result.perplexityPromptTimestamp || 0;
      const twoMinutesInMs = 2 * 60 * 1000;
      
      if (currentTime - promptTime < twoMinutesInMs) {
        console.log('Found fresh pending prompt for Perplexity, processing...');
        const promptToProcess = result.pendingPerplexityPrompt;
        const titleToProcess = result.pendingPerplexityTitle;
        
        // DO NOT set flags here; insertPromptAndSubmit will handle it.
        
        // Clear the prompt from storage BEFORE attempting to submit
        chrome.storage.local.remove(['pendingPerplexityPrompt', 'pendingPerplexityTitle', 'perplexityPromptTimestamp'], () => {
          console.log('Cleared pending prompt from storage before processing.');
          // Now attempt to submit
          insertPromptAndSubmit(promptToProcess, titleToProcess);
          // Note: isSubmitting and promptSubmitted are reset inside insertPromptAndSubmit upon completion/error
        });
      } else {
        console.log('Found stale pending prompt for Perplexity, ignoring and clearing.');
        // Clear old prompts to prevent future resubmissions
        chrome.storage.local.remove(['pendingPerplexityPrompt', 'pendingPerplexityTitle', 'perplexityPromptTimestamp']);
      }
    } else {
      // console.log('No pending Perplexity prompt found.'); // Optional: less verbose logging
    }
  });
}

// Wait for page to be ready, then check for pending prompts
if (isPageReady()) {
  checkForPendingPrompts();
} else {
  // Start checking as soon as possible, but also set a backup timeout
  const readyCheckInterval = setInterval(() => {
    if (isPageReady()) {
      clearInterval(readyCheckInterval);
      checkForPendingPrompts();
    }
  }, 100);
  
  // Still set a backup timeout to ensure we check eventually
  setTimeout(() => {
    clearInterval(readyCheckInterval);
    checkForPendingPrompts();
  }, 2000);
}