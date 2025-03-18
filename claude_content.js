// Content script specifically for Claude.ai
console.log('Claude content script loaded');

// Flag to track whether we've already submitted the prompt
let promptSubmitted = false;
// Flag to track if we're currently in the submission process
let isSubmitting = false;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in Claude content script:', message);
  
  if (message.action === 'insertPrompt') {
    // Reset flags for each new request
    isSubmitting = false;
    promptSubmitted = false;
    
    // Format the prompt to preserve XML tags
    const formattedPrompt = formatPromptForClaude(message.prompt);
    insertPromptAndSubmit(formattedPrompt, message.title);
    sendResponse({ status: 'Processing prompt' });
    return true;
  }
});

// Function to format prompt for Claude
function formatPromptForClaude(prompt) {
  // Return the prompt as-is to preserve XML tags
  return prompt;
}

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

// Function to insert prompt into the editor and submit
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
  
  console.log('Attempting to insert prompt into Claude');

  // Try to find the editor div
  waitForElement([
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"]#prompt-textarea',
    'div[contenteditable="true"].w-full'
  ])
    .then(editor => {
      console.log('Editor found:', editor);
      
      // Clear existing content and focus the editor
      editor.innerHTML = '';
      editor.focus();
      
      // Create a pre element to preserve formatting
      const pre = document.createElement('pre');
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.wordBreak = 'break-word';
      pre.style.margin = '0';
      
      // Create a text node to preserve XML tags
      const textNode = document.createTextNode(prompt);
      pre.appendChild(textNode);
      editor.appendChild(pre);
      
      // Dispatch events to trigger UI updates
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      
      console.log('Content inserted, content length:', editor.textContent.length);
      
      // Give the UI a moment to update
      return new Promise(resolve => setTimeout(() => resolve(editor), 500));
    })
    .then(editor => {
      // Look for the submit button
      return waitForElement([
        'button[aria-label="Send Message"]',
        'button[type="submit"]',
        'button.absolute.right-2',
        'button.absolute.right-1\\.5'
      ]);
    })
    .then(submitButton => {
      console.log('Submit button found, clicking:', submitButton);
      
      // Click the submit button
      submitButton.click();
      
      // Mark as submitted
      promptSubmitted = true;
      isSubmitting = false;
      
      // Clear the pending prompt to prevent resubmission
      chrome.storage.local.remove(['pendingClaudePrompt', 'pendingClaudeTitle']);
      
      console.log('Prompt submitted to Claude');
    })
    .catch(error => {
      // Reset the submission flag
      isSubmitting = false;
      
      console.error('Error in insertPromptAndSubmit:', error.message);
      
      // Try alternative method - Enter key
      try {
        console.log('Trying Enter key method');
        const editor = document.querySelector('div[contenteditable="true"]');
        
        if (editor) {
          // Make sure content is set
          editor.innerHTML = prompt;
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          
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
          
          // Clear the pending prompt
          chrome.storage.local.remove(['pendingClaudePrompt', 'pendingClaudeTitle']);
          
          console.log('Prompt submitted with alternative method');
        } else {
          console.error('Could not find editor. Please submit manually.');
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
  
  console.log('Checking for pending prompts for Claude');
  
  chrome.storage.local.get(['pendingClaudePrompt', 'pendingClaudeTitle', 'claudePromptTimestamp'], function(result) {
    if (result.pendingClaudePrompt) {
      // Check if the prompt is fresh (created within the last 2 minutes)
      const currentTime = Date.now();
      const promptTime = result.claudePromptTimestamp || 0;
      const twoMinutesInMs = 2 * 60 * 1000;
      
      if (currentTime - promptTime < twoMinutesInMs) {
        console.log('Found fresh pending prompt for Claude, inserting');
        const formattedPrompt = formatPromptForClaude(result.pendingClaudePrompt);
        insertPromptAndSubmit(formattedPrompt, result.pendingClaudeTitle);
      } else {
        console.log('Found stale pending prompt for Claude, ignoring');
        // Clear old prompts to prevent future resubmissions
        chrome.storage.local.remove(['pendingClaudePrompt', 'pendingClaudeTitle', 'claudePromptTimestamp']);
      }
    }
  });
}

// Check for pending prompts after a short delay
setTimeout(checkForPendingPrompts, 2000);