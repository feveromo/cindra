// Content script specifically for ChatGPT
console.log('ChatGPT content script loaded');

// Flag to track whether we've already submitted the prompt
let promptSubmitted = false;
// Flag to track if we're currently in the submission process
let isSubmitting = false;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in ChatGPT content script:', message);
  
  if (message.action === 'insertPrompt') {
    // If we're already submitting, don't start another submission
    if (isSubmitting || promptSubmitted) {
      console.log('Already submitting or submitted, ignoring duplicate request');
      sendResponse({ status: 'Already submitting' });
      return true;
    }
    
    // Reset the flag when receiving a new prompt
    promptSubmitted = false;
    
    // Format the prompt to preserve XML tags
    const formattedPrompt = formatPromptForChatGPT(message.prompt);
    insertPromptAndSubmit(formattedPrompt, message.title);
    sendResponse({ status: 'Processing prompt' });
    return true;
  }
});

// Function to format prompt for ChatGPT
function formatPromptForChatGPT(prompt) {
  // Extract XML parts
  const taskMatch = prompt.match(/<Task>(.*?)<\/Task>/s);
  const titleMatch = prompt.match(/<ContentTitle>(.*?)<\/ContentTitle>/s);
  const contentMatch = prompt.match(/<Content>(.*?)<\/Content>/s);
  
  if (!taskMatch || !titleMatch || !contentMatch) {
    return prompt; // Return original if no XML tags found
  }
  
  const task = taskMatch[1].trim();
  const title = titleMatch[1].trim();
  const content = contentMatch[1].trim();
  
  // Format in a way that ChatGPT can understand better
  return `Task: ${task}

Title: ${title}

Content to analyze:
----------------
${content}
----------------

Please provide your analysis following the task instructions above.`;
}

// Function to wait for an element to appear in the DOM
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    // Handle array of selectors
    if (Array.isArray(selector)) {
      // Check if any of the elements already exist
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
    
    // Handle single selector (original functionality)
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
  
  console.log('Attempting to insert prompt into ChatGPT');

  // Try to find the textarea with multiple selectors
  waitForElement([
    '#prompt-textarea',
    'textarea[data-id="root"]',
    'textarea.w-full',
    'div[contenteditable="true"]#prompt-textarea',
    'div[contenteditable="true"].w-full'
  ])
    .then(textarea => {
      console.log('Textarea found:', textarea);
      
      // Check if it's a contenteditable div
      if (textarea.getAttribute('contenteditable') === 'true') {
        // Clear existing content
        textarea.innerHTML = '';
        textarea.focus();
        
        // Set the new content for contenteditable
        textarea.innerHTML = prompt;
        
        // Create and dispatch input event
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: prompt
        });
        textarea.dispatchEvent(inputEvent);
      } else {
        // Handle regular textarea
        textarea.value = '';
        textarea.focus();
        textarea.value = prompt;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
      
      console.log('Content inserted');
      
      // Give the UI a moment to update
      return new Promise(resolve => setTimeout(() => resolve(textarea), 500));
    })
    .then(textarea => {
      // Look for the submit button with multiple selectors
      return waitForElement([
        'button[data-testid="send-button"]:not([disabled])',
        'button[type="submit"]:not([disabled])',
        'button.text-white:not([disabled])',
        'button.bg-black:not([disabled])',
        'button.absolute.right-2:not([disabled])',
        'button.absolute.right-1\\.5:not([disabled])'
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
      chrome.storage.local.remove(['pendingChatGPTPrompt', 'pendingChatGPTTitle']);
      
      console.log('Prompt submitted to ChatGPT');
    })
    .catch(error => {
      // Reset the submission flag
      isSubmitting = false;
      
      console.error('Error in insertPromptAndSubmit:', error.message);
      
      // Try alternative method - Enter key
      try {
        console.log('Trying Enter key method');
        const textarea = document.querySelector('#prompt-textarea') || 
                        document.querySelector('textarea[data-id="root"]') ||
                        document.querySelector('div[contenteditable="true"]');
        
        if (textarea) {
          // Make sure content is set
          if (textarea.getAttribute('contenteditable') === 'true') {
            textarea.innerHTML = prompt;
          } else {
            textarea.value = prompt;
          }
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
          
          // Clear the pending prompt
          chrome.storage.local.remove(['pendingChatGPTPrompt', 'pendingChatGPTTitle']);
          
          console.log('Prompt submitted with alternative method');
        } else {
          console.error('Could not find textarea. Please submit manually.');
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
  
  console.log('Checking for pending prompts for ChatGPT');
  
  chrome.storage.local.get(['pendingChatGPTPrompt', 'pendingChatGPTTitle', 'chatgptPromptTimestamp'], function(result) {
    if (result.pendingChatGPTPrompt) {
      // Check if the prompt is fresh (created within the last 2 minutes)
      const currentTime = Date.now();
      const promptTime = result.chatgptPromptTimestamp || 0;
      const twoMinutesInMs = 2 * 60 * 1000;
      
      if (currentTime - promptTime < twoMinutesInMs) {
        console.log('Found fresh pending prompt for ChatGPT, inserting');
        const formattedPrompt = formatPromptForChatGPT(result.pendingChatGPTPrompt);
        insertPromptAndSubmit(formattedPrompt, result.pendingChatGPTTitle);
      } else {
        console.log('Found stale pending prompt for ChatGPT, ignoring');
        // Clear old prompts to prevent future resubmissions
        chrome.storage.local.remove(['pendingChatGPTPrompt', 'pendingChatGPTTitle', 'chatgptPromptTimestamp']);
      }
    }
  });
}

// Check for pending prompts after a short delay
setTimeout(checkForPendingPrompts, 2000);