// Content script specifically for Grok.com
console.log('Grok content script loaded');

// Setup notification system without intrusive alerts
function showNotification(message, duration = 5000) {
  // Create or get notification container
  let container = document.getElementById('summary-extension-notification');
  if (!container) {
    container = document.createElement('div');
    container.id = 'summary-extension-notification';
    container.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 20px;
      background-color: rgba(66, 133, 244, 0.9);
      color: white;
      padding: 10px 20px;
      border-radius: 4px;
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
      transition: opacity 0.3s;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }

  // Set message and show
  container.textContent = message;
  container.style.opacity = '1';
  
  // Auto-hide after duration
  setTimeout(() => {
    container.style.opacity = '0';
  }, duration);
}

// Flag to track whether we've already submitted the prompt
let promptSubmitted = false;
// Flag to track if we're currently in the submission process
let isSubmitting = false;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in Grok content script:', message);
  
  if (message.action === 'insertPrompt') {
    // If we're already submitting, don't start another submission
    if (isSubmitting || promptSubmitted) {
      console.log('Already submitting or submitted, ignoring duplicate request');
      sendResponse({ status: 'Already submitting' });
      return true;
    }
    
    // Reset the flag when receiving a new prompt
    promptSubmitted = false;
    
    insertPromptAndSubmit(message.prompt, message.title);
    sendResponse({ status: 'Processing prompt' });
    return true;
  }
});

// Function to wait for an element to appear in the DOM
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    // Check if element already exists
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
  showNotification('💡 Inserting content...');

  // Try to find the textarea for input
  waitForElement('textarea[dir="auto"]')
    .then(textarea => {
      console.log('Textarea found:', textarea);
      
      // Clear existing content and focus the textarea
      textarea.value = '';
      textarea.focus();
      
      // Set the new content
      textarea.value = prompt;
      
      // Dispatch events to trigger UI updates
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      
      showNotification('💡 Content inserted, waiting for submit button...');
      console.log('Content inserted, content length:', textarea.value.length);
      
      // Give the UI a moment to update
      return new Promise(resolve => setTimeout(() => resolve(textarea), 500));
    })
    .then(textarea => {
      // Look for the submit button - after text is entered it should be enabled
      return waitForElement('button[type="submit"]:not([disabled])');
    })
    .then(submitButton => {
      showNotification('💡 Submit button found, sending to Grok...');
      console.log('Submit button found, clicking:', submitButton);
      
      // Click the submit button
      submitButton.click();
      
      // Mark as submitted
      promptSubmitted = true;
      isSubmitting = false;
      
      // Clear the pending prompt to prevent resubmission when tab is reopened
      chrome.storage.local.remove(['pendingGrokPrompt', 'pendingGrokTitle']);
      
      console.log('Prompt submitted to Grok');
    })
    .catch(error => {
      // Reset the submission flag
      isSubmitting = false;
      
      console.error('Error in insertPromptAndSubmit:', error.message);
      showNotification('⚠️ Could not submit automatically. Trying alternative method...');
      
      // Try alternative method - Enter key
      try {
        console.log('Trying Enter key method');
        const textarea = document.querySelector('textarea[dir="auto"]');
        
        if (textarea) {
          // Make sure content is set
          textarea.value = prompt;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          
          // Focus and simulate Enter
          textarea.focus();
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });
          
          textarea.dispatchEvent(enterEvent);
          console.log('Enter key simulated');
          
          // Mark as submitted
          promptSubmitted = true;
          
          // Clear the pending prompt to prevent resubmission when tab is reopened
          chrome.storage.local.remove(['pendingGrokPrompt', 'pendingGrokTitle']);
          
          showNotification('💡 Content submitted with alternative method');
        } else {
          showNotification('⚠️ Could not find input field. Please submit manually.', 10000);
        }
      } catch (e) {
        console.error('Alternative method failed:', e);
        showNotification('⚠️ All submission methods failed. Please submit manually.', 10000);
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