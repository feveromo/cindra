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

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in AI Studio content script:', message);
  
  if (message.action === 'insertPrompt') {
    // Reset the flag when receiving a new prompt
    promptSubmitted = false;
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
  console.log('Attempting to insert prompt into AI Studio');
  showNotification('💡 Inserting content...');
  
  // Wait for the textarea to be available
  waitForElement('textarea.textarea.gmat-body-medium')
    .then(textarea => {
      console.log('Textarea found, setting value');
      
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
      
      showNotification('💡 Run button found, sending summary to AI...');
      
      // Check if we already submitted - early return if so
      if (promptSubmitted || isGeneratingResponse()) {
        console.log('Already submitted or generation in progress, skipping button click');
        return Promise.reject(new Error('Already submitted'));
      }
      
      // First attempt: Try Ctrl+Enter method directly on textarea
      setTimeout(() => {
        try {
          // Only try if we haven't submitted yet
          if (!promptSubmitted && !isGeneratingResponse()) {
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
            console.log('Ctrl+Enter shortcut sent directly');
            
            // Check if this worked
            setTimeout(() => {
              if (isGeneratingResponse()) {
                promptSubmitted = true;
                console.log('Prompt submission confirmed via Ctrl+Enter');
              }
            }, 500);
          }
        } catch (err) {
          console.error('Error sending Ctrl+Enter:', err);
        }
      }, 100);
      
      // Only proceed to find the button if we haven't submitted yet
      return Promise.any([
        waitForElement('button.run-button[aria-disabled="false"]'),
        waitForElement('button.run-button:not(.disabled)'),
        waitForElement('button.run-button[type="submit"]:not([disabled])')
      ]);
    })
    .then(runButton => {
      console.log('Enabled Run button found, checking if we should click it');
      
      // Check if already submitted or if the button has changed to a stop button
      if (promptSubmitted || isGeneratingResponse()) {
        console.log('Already submitted or generation in progress, aborting button click');
        return;
      }
      
      // Set flag to indicate we're clicking the button
      promptSubmitted = true;
      
      // Only try one click method and immediately mark as submitted
      console.log('Clicking Run button once');
      runButton.click();
      
      // Show completion notification
      showNotification('💡 Summary request sent! Generation should start shortly...');
    })
    .catch(error => {
      // If we already submitted, this is not an error
      if (error.message === 'Already submitted' || promptSubmitted || isGeneratingResponse()) {
        showNotification('💡 Summary request sent!');
        return;
      }
      
      console.error('Error in insertPromptAndSubmit:', error.message);
      
      // Simple fallback with notification but no alert dialog
      showNotification('⚠️ Trying alternate method to send summary request...');
      
      try {
        const textarea = document.querySelector('textarea.textarea');
        if (textarea && !promptSubmitted && !isGeneratingResponse()) {
          // Just set the value and fire events
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
          
          showNotification('💡 Content inserted. You may need to press Ctrl+Enter to start the summary generation.', 8000);
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