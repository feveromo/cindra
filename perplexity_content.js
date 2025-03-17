// Content script specifically for Perplexity.ai
console.log('Perplexity content script loaded');

// Flag to track whether we've already submitted the prompt
let promptSubmitted = false;
// Flag to track if we're currently in the submission process
let isSubmitting = false;

// Function to check if the page is ready (main content loaded)
function isPageReady() {
  return document.querySelector('textarea[placeholder="Ask anything..."]') !== null ||
         document.querySelector('.rounded-3xl textarea') !== null ||
         document.querySelector('.grid-rows-1fr-auto textarea') !== null;
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in Perplexity content script:', message);
  
  if (message.action === 'insertPrompt') {
    // If we're already submitting, don't start another submission
    if (isSubmitting || promptSubmitted) {
      console.log('Already submitting or submitted, ignoring duplicate request');
      sendResponse({ status: 'Already submitting' });
      return true;
    }
    
    // Reset the flag when receiving a new prompt
    promptSubmitted = false;
    
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
  
  // List of selectors to try, in order of preference, based on the actual Perplexity HTML
  const selectors = [
    'textarea[placeholder="Ask anything..."]',
    '.rounded-3xl textarea',
    'textarea.resize-none',
    'textarea[autofocus]',
    'div.rounded-md textarea',
    // Add more specific selectors based on the new HTML structure
    '.grid-rows-1fr-auto textarea',
    '.col-start-1.col-end-4 textarea',
    'textarea.overflow-auto'
  ];
  
  return waitForElement(selectors);
}

// Function to find the submit button with multiple strategies
function findSubmitButton() {
  console.log('Trying to find Perplexity submit button...');
  
  // List of selectors to try, in order of preference, based on the actual Perplexity HTML
  const selectors = [
    'button[aria-label="Submit"]:not([disabled])',
    'button:not([disabled]).bg-super',
    'button:not([disabled]) svg path[d="M5 12l14 0"]',
    'button:not([disabled]) svg path[d="M13 18l6 -6"]',
    // Add more specific selectors based on the new HTML structure
    '.ml-sm button:not([disabled])',
    'button:not([disabled]) .tabler-icon-arrow-right',
    'button[type="button"]:not([disabled]) svg.tabler-icon-arrow-right'
  ];
  
  return waitForElement(selectors);
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
  
  console.log('Attempting to insert prompt into Perplexity');

  // Try to find the input area immediately
  findInputArea()
    .then(inputArea => {
      console.log('Input area found:', inputArea);
      
      // Focus the input area
      inputArea.focus();
      
      // For textarea, we set the value directly
      inputArea.value = prompt;
      
      // Dispatch events to trigger UI updates for textarea
      inputArea.dispatchEvent(new Event('input', { bubbles: true }));
      inputArea.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Focus again to ensure the content is recognized
      inputArea.focus();
      
      console.log('Content inserted, content length:', inputArea.value.length);
      
      // Give the UI a moment to update - we'll reduce the wait time since we know it works
      return new Promise(resolve => setTimeout(() => resolve(), 500));
    })
    .then(() => {
      // Look for the enabled submit button - keep checking for a while if not found immediately
      const checkForButton = (attempts = 0, maxAttempts = 10) => {
        return findSubmitButton()
          .then(submitButton => {
            console.log('Submit button found, clicking:', submitButton);
            
            // Click the submit button
            submitButton.click();
            
            // Mark as submitted
            promptSubmitted = true;
            isSubmitting = false;
            
            // Clear the pending prompt to prevent resubmission when tab is reopened
            chrome.storage.local.remove(['pendingPerplexityPrompt', 'pendingPerplexityTitle']);
            
            console.log('Prompt submitted to Perplexity');
          })
          .catch(error => {
            if (attempts < maxAttempts) {
              console.log(`Button not found yet, attempt ${attempts + 1}/${maxAttempts}...`);
              return new Promise(resolve => setTimeout(() => resolve(checkForButton(attempts + 1, maxAttempts)), 300)); // Reduced retry interval
            } else {
              throw error;
            }
          });
      };
      
      return checkForButton();
    })
    .catch(error => {
      // Reset the submission flag
      isSubmitting = false;
      
      console.error('Error in insertPromptAndSubmit:', error.message);
      
      // Let's try simulating Enter for textarea
      try {
        console.log('Trying Enter key method');
        const inputArea = document.querySelector('textarea') || 
                          document.querySelector('textarea[placeholder="Ask anything..."]');
        
        if (inputArea) {
          // Make sure content is set
          inputArea.value = prompt;
          inputArea.dispatchEvent(new Event('input', { bubbles: true }));
          
          // Focus and simulate Enter
          inputArea.focus();
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });
          
          inputArea.dispatchEvent(enterEvent);
          console.log('Enter key simulated');
          
          // Mark as submitted
          promptSubmitted = true;
          
          // Clear the pending prompt to prevent resubmission when tab is reopened
          chrome.storage.local.remove(['pendingPerplexityPrompt', 'pendingPerplexityTitle']);
        }
      } catch (e) {
        console.error('Enter key fallback failed:', e);
      }
    });
}

// Auto-check for pending prompts when the page loads
function checkForPendingPrompts() {
  // Only check if not already submitting
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
        console.log('Found fresh pending prompt for Perplexity, inserting');
        insertPromptAndSubmit(result.pendingPerplexityPrompt, result.pendingPerplexityTitle);
      } else {
        console.log('Found stale pending prompt for Perplexity, ignoring');
        // Clear old prompts to prevent future resubmissions
        chrome.storage.local.remove(['pendingPerplexityPrompt', 'pendingPerplexityTitle', 'perplexityPromptTimestamp']);
      }
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