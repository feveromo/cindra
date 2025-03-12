// Content script specifically for Google AI Studio
console.log('AI Studio content script loaded');

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
      font-family: 'Google Sans', sans-serif;
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
// Flag to track the last prompt we attempted to submit
let lastSubmittedPrompt = '';
// Flag to track if we're currently in the submission process
let isSubmitting = false;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in AI Studio content script:', message);
  
  if (message.action === 'insertPrompt') {
    // If we're already submitting, don't start another submission
    if (isSubmitting || promptSubmitted || isGeneratingResponse()) {
      console.log('Already submitting or submitted, ignoring duplicate request');
      sendResponse({ status: 'Already submitting' });
      return true;
    }
    
    // Reset the flag when receiving a new prompt
    promptSubmitted = false;
    lastSubmittedPrompt = message.prompt || '';
    insertPromptAndSubmit(message.prompt, message.title);
    sendResponse({ status: 'Attempting to insert prompt' });
    return true;
  }
});

// Function to wait for an element to appear in the DOM
function waitForElement(selector, timeout = 30000) {
  return new Promise((resolve, reject) => {
    // Check if element already exists
    const element = document.querySelector(selector);
    if (element) {
      console.log(`Element found immediately: ${selector}`);
      return resolve(element);
    }
    
    console.log(`Waiting for element: ${selector}`);
    
    // Set a timeout
    const timeoutId = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for element: ${selector}`));
    }, timeout);
    
    // Create an observer to watch for the element
    const observer = new MutationObserver((mutations, observer) => {
      const element = document.querySelector(selector);
      if (element) {
        clearTimeout(timeoutId);
        observer.disconnect();
        console.log(`Element found after waiting: ${selector}`);
        resolve(element);
      }
    });
    
    // Start observing
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  });
}

// Function to check if the UI shows we're generating a response
function isGeneratingResponse() {
  // Check for elements that indicate generation is in progress
  const stopButton = document.querySelector('button.run-button.stop-generating');
  const progressIndicator = document.querySelector('.response-container .progress-indicator');
  
  return stopButton !== null || progressIndicator !== null;
}

// Function to insert prompt into the textarea and submit
function insertPromptAndSubmit(prompt, title) {
  if (!prompt) {
    console.warn('Received empty prompt, not inserting');
    return;
  }
  
  // If we're already submitting or submitted, don't start again
  if (isSubmitting || promptSubmitted || isGeneratingResponse()) {
    console.log('Already submitting or submitted, ignoring duplicate call');
    return;
  }
  
  // Set flag that we're in the submission process
  isSubmitting = true;
  
  // Store the prompt we're about to submit
  lastSubmittedPrompt = prompt;
  
  console.log('Attempting to insert prompt into AI Studio');
  showNotification('💡 Inserting content...');
  
  // Wait for the textarea to be available
  waitForElement('textarea.textarea.gmat-body-medium')
    .then(textarea => {
      console.log('Textarea found, setting value');
      
      // Check if we're already generating - don't overwrite if so
      if (isGeneratingResponse()) {
        console.log('Response already generating, not modifying textarea');
        promptSubmitted = true;
        isSubmitting = false;
        return Promise.reject(new Error('Already submitted'));
      }
      
      // Clear the textarea first to avoid appending to existing content
      textarea.value = '';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Small delay to ensure clearing took effect
      return new Promise(resolve => setTimeout(() => resolve(textarea), 100));
    })
    .then(textarea => {
      // Set the prompt in the textarea
      textarea.value = prompt;
      
      // Better event simulation for Angular components
      const inputEvent = new Event('input', { bubbles: true, cancelable: true });
      textarea.dispatchEvent(inputEvent);
      
      const changeEvent = new Event('change', { bubbles: true, cancelable: true });
      textarea.dispatchEvent(changeEvent);
      
      // Focus the textarea to ensure the UI updates properly
      textarea.focus();
      
      // Fire a keypress event which often helps with Angular components
      textarea.dispatchEvent(new KeyboardEvent('keypress', { key: 'a' }));
      
      showNotification('💡 Content inserted, waiting for Run button...');
      console.log('Content inserted, waiting for Run button to enable');
      
      // Give the UI time to update and register the content
      return new Promise(resolve => setTimeout(() => resolve(textarea), 1500));
    })
    .then((textarea) => {
      // Set the document title for reference
      if (title) {
        document.title = `Summary: ${title} - Google AI Studio`;
      }
      
      // Double-check we're not already generating
      if (promptSubmitted || isGeneratingResponse()) {
        console.log('Already submitted or generation in progress, skipping button click');
        isSubmitting = false;
        return Promise.reject(new Error('Already submitted'));
      }
      
      showNotification('💡 Run button found, sending summary to AI...');
      
      // Use a single submission method: Ctrl+Enter
      // Create a keyboard event for Ctrl+Enter that should trigger submit
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      });
      
      // Focus and send Ctrl+Enter
      textarea.focus();
      textarea.dispatchEvent(enterEvent);
      console.log('Ctrl+Enter shortcut sent');
      
      // Mark as submitted to prevent duplicate submissions
      promptSubmitted = true;
      
      // Allow small window before checking if we actually managed to submit
      return new Promise(resolve => setTimeout(() => {
        // If we're generating a response, all good
        if (isGeneratingResponse()) {
          console.log('Submission confirmed - response generation detected');
          resolve();
        } else {
          // We're not generating, something didn't work
          console.log('Submission may have failed - no response generation detected');
          resolve();
        }
      }, 1000));
    })
    .then(() => {
      // Reset the submission flag
      isSubmitting = false;
      
      // No need for a notification here, the generation UI will show progress
      
      // Add a MutationObserver to watch for and remove any duplicate text that might appear
      const observer = new MutationObserver((mutations) => {
        const textarea = document.querySelector('textarea.textarea.gmat-body-medium');
        if (textarea && textarea.value && textarea.value !== lastSubmittedPrompt) {
          if (textarea.value.includes(lastSubmittedPrompt) && 
              textarea.value.length > lastSubmittedPrompt.length) {
            console.log('Detected extra content in textarea, cleaning up');
            textarea.value = lastSubmittedPrompt;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      });
      
      // Start observing with a short timeout to allow the normal submission to complete
      setTimeout(() => {
        const textarea = document.querySelector('textarea.textarea.gmat-body-medium');
        if (textarea) {
          observer.observe(textarea, { attributes: true, childList: true, characterData: true, subtree: true });
          
          // Stop observing after 2 seconds
          setTimeout(() => observer.disconnect(), 2000);
        }
      }, 500);
    })
    .catch(error => {
      // Reset the submission flag
      isSubmitting = false;
      
      // If we already submitted, this is not an error
      if (error.message === 'Already submitted' || promptSubmitted || isGeneratingResponse()) {
        return;
      }
      
      console.error('Error in insertPromptAndSubmit:', error.message);
      
      // Simple fallback with notification but no alert dialog
      showNotification('⚠️ Trying alternate method to send summary request...');
      
      try {
        const textarea = document.querySelector('textarea.textarea');
        if (textarea && !promptSubmitted && !isGeneratingResponse()) {
          // Clear the textarea first
          textarea.value = '';
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          
          // Small delay to ensure clearing took effect
          setTimeout(() => {
            // Set the value and fire events
            textarea.value = prompt;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            
            // Try a direct click via injected script
            const scriptEl = document.createElement('script');
            scriptEl.textContent = `
              (function() {
                setTimeout(() => {
                  // Check if already generating
                  const stopButton = document.querySelector('button.run-button.stop-generating');
                  const progressIndicator = document.querySelector('.response-container .progress-indicator');
                  
                  if (stopButton !== null || progressIndicator !== null) {
                    console.log('Generation already in progress, not clicking again');
                    return;
                  }
                  
                  const runButton = document.querySelector('button.run-button:not(.disabled)');
                  if (runButton) {
                    console.log('Fallback method: Found button and clicking');
                    runButton.click();
                  } else {
                    console.log('Fallback method: Button not found');
                    // Try Ctrl+Enter shortcut as last resort
                    const textarea = document.querySelector('textarea.textarea');
                    if (textarea) {
                      textarea.focus();
                      const e = new KeyboardEvent('keydown', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        ctrlKey: true,
                        bubbles: true,
                        cancelable: true
                      });
                      textarea.dispatchEvent(e);
                    }
                  }
                }, 1000);
              })();
            `;
            document.body.appendChild(scriptEl);
            setTimeout(() => {
              if (scriptEl.parentNode) scriptEl.parentNode.removeChild(scriptEl);
            }, 2000);
            
            // Mark as submitted
            promptSubmitted = true;
            
            showNotification('💡 Content inserted. You may need to press Ctrl+Enter to start the summary generation.', 8000);
          }, 100);
        }
      } catch (e) {
        console.error('Fallback also failed:', e);
        showNotification('⚠️ Unable to auto-submit. Please press Ctrl+Enter to run.', 8000);
      }
    });
}

// Auto-check for pending prompts when the page loads
setTimeout(() => {
  if (window.location.pathname.includes('/prompts/new_chat')) {
    console.log('New chat page detected, checking for pending prompts');
    
    chrome.storage.local.get(['pendingPrompt', 'pendingTitle'], function(result) {
      if (result.pendingPrompt) {
        console.log('Found pending prompt, inserting');
        insertPromptAndSubmit(result.pendingPrompt, result.pendingTitle);
        
        // Clear the stored prompt after attempting to insert it
        chrome.storage.local.remove(['pendingPrompt', 'pendingTitle']);
      }
    });
  }
}, 2000); 