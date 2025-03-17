// Content script specifically for Google AI Studio
console.log('AI Studio content script loaded');

// Flag to track whether we've already submitted the prompt
let promptSubmitted = false;
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
  const processingIndicator = document.querySelector('.processing-indicator');
  
  return stopButton !== null || progressIndicator !== null || processingIndicator !== null;
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
  
  console.log('Attempting to insert prompt into AI Studio');
  
  // Try to find the textarea and submit button using multiple selectors
  const textareaSelectors = [
    'textarea.textarea.gmat-body-medium',
    'textarea.textarea',
    'div[contenteditable="true"]',
    '.input-area textarea'
  ];
  
  const findTextarea = async () => {
    for (const selector of textareaSelectors) {
      try {
        const textarea = await waitForElement(selector, 5000);
        if (textarea) return textarea;
      } catch (e) {
        console.log(`Textarea not found with selector: ${selector}`);
      }
    }
    throw new Error('Textarea not found');
  };
  
  findTextarea()
    .then(textarea => {
      console.log('Textarea found, setting value');
      
      // Check if we're already generating
      if (isGeneratingResponse()) {
        console.log('Response already generating, not modifying textarea');
        promptSubmitted = true;
        isSubmitting = false;
        return Promise.reject(new Error('Already submitted'));
      }
      
      // Clear the textarea first
      if (textarea.tagName.toLowerCase() === 'div') {
        // Handle contenteditable div
        textarea.innerHTML = '';
      } else {
        // Handle textarea
        textarea.value = '';
      }
      
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Small delay to ensure clearing took effect
      return new Promise(resolve => setTimeout(() => resolve(textarea), 300));
    })
    .then(textarea => {
      // Set the prompt
      if (textarea.tagName.toLowerCase() === 'div') {
        // Handle contenteditable div
        textarea.innerHTML = prompt;
      } else {
        // Handle textarea
        textarea.value = prompt;
      }
      
      // Fire appropriate events
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Focus on the textarea
      textarea.focus();
      
      // Set the document title for reference
      if (title) {
        document.title = `Summary: ${title} - Google AI Studio`;
      }
      
      // Give the UI time to update
      return new Promise(resolve => setTimeout(() => resolve(textarea), 1000));
    })
    .then(textarea => {
      // Double-check we're not already generating
      if (promptSubmitted || isGeneratingResponse()) {
        console.log('Already submitted or generation in progress, skipping button click');
        isSubmitting = false;
        return Promise.reject(new Error('Already submitted'));
      }
      
      // Try multiple methods to submit the prompt
      
      // Method 1: Find and click the run button
      const runButtonSelectors = [
        'button.run-button:not(.disabled)',
        'button[aria-label="Send message"]',
        'button.send-button:not([disabled])'
      ];
      
      const findAndClickButton = async () => {
        for (const selector of runButtonSelectors) {
          try {
            const button = await waitForElement(selector, 2000);
            if (button) {
              console.log(`Found button with selector: ${selector}, clicking`);
              button.click();
              return true;
            }
          } catch (e) {
            console.log(`Button not found with selector: ${selector}`);
          }
        }
        return false;
      };
      
      return findAndClickButton().then(buttonClicked => {
        if (buttonClicked) {
          console.log('Run button clicked');
          promptSubmitted = true;
        } else {
          // Method 2: Use keyboard shortcut (Ctrl+Enter)
          console.log('No button found, trying keyboard shortcut');
          
          // Create a keyboard event for Ctrl+Enter
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
          
          // Give a slight delay to check if it worked
          return new Promise(resolve => 
            setTimeout(() => {
              if (isGeneratingResponse()) {
                promptSubmitted = true;
                resolve(true);
              } else {
                resolve(false);
              }
            }, 1000)
          );
        }
      });
    })
    .then(success => {
      if (success || promptSubmitted) {
        console.log('Prompt submitted successfully');
        
        // Clear the pending prompt to prevent resubmission
        chrome.storage.local.remove(['pendingPrompt', 'pendingTitle', 'promptTimestamp']);
      } else {
        console.log('Neither button nor shortcut worked, trying direct DOM injection');
        
        // Method 3: Inject script into page to bypass potential CSP issues
        const script = document.createElement('script');
        script.textContent = `
          (function() {
            try {
              // Find the button via DOM
              const runButtons = [
                document.querySelector('button.run-button:not(.disabled)'),
                document.querySelector('button[aria-label="Send message"]'),
                document.querySelector('button.send-button:not([disabled])')
              ].filter(btn => btn !== null);
              
              if (runButtons.length > 0) {
                console.log('Found button through injected script, clicking');
                runButtons[0].click();
              } else {
                console.log('No button found through injected script');
                
                // Try to find the textarea and use Enter
                const textarea = document.querySelector('textarea.textarea') || 
                                document.querySelector('div[contenteditable="true"]');
                if (textarea) {
                  console.log('Found textarea, sending keyboard event');
                  textarea.focus();
                  
                  // Create and dispatch keyboard event
                  const enterEvent = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    ctrlKey: true,
                    bubbles: true,
                    cancelable: true
                  });
                  textarea.dispatchEvent(enterEvent);
                }
              }
            } catch (e) {
              console.error('Error in injected script:', e);
            }
          })();
        `;
        
        document.body.appendChild(script);
        setTimeout(() => {
          script.remove();
          
          // Check one more time if we're generating
          if (isGeneratingResponse()) {
            promptSubmitted = true;
            console.log('Prompt submission confirmed via injected script');
            chrome.storage.local.remove(['pendingPrompt', 'pendingTitle', 'promptTimestamp']);
          } else {
            console.log('Submission failed even with injected script');
          }
        }, 1000);
      }
    })
    .catch(error => {
      console.error('Error in insertPromptAndSubmit:', error.message);
      
      // If already submitted, this is not an error
      if (error.message === 'Already submitted' || promptSubmitted || isGeneratingResponse()) {
        isSubmitting = false;
        return;
      }
    })
    .finally(() => {
      // Always reset submission flag when done
      isSubmitting = false;
    });
}

// Auto-check for pending prompts when the page loads
window.addEventListener('load', () => {
  // Small delay to ensure page is fully loaded
  setTimeout(() => {
    if (window.location.pathname.includes('/prompts/new_chat') || 
        window.location.pathname.includes('/app') ||
        window.location.href.includes('aistudio.google.com')) {
      
      console.log('AI Studio page detected, checking for pending prompts');
      
      chrome.storage.local.get(['pendingPrompt', 'pendingTitle', 'promptTimestamp'], function(result) {
        if (result.pendingPrompt) {
          // Check if the prompt is fresh (created within the last 5 minutes)
          const currentTime = Date.now();
          const promptTime = result.promptTimestamp || 0;
          const fiveMinutesInMs = 5 * 60 * 1000;
          
          if (currentTime - promptTime < fiveMinutesInMs) {
            console.log('Found fresh pending prompt, inserting');
            insertPromptAndSubmit(result.pendingPrompt, result.pendingTitle);
          } else {
            console.log('Found stale pending prompt, ignoring');
            // Clear old prompts to prevent future resubmissions
            chrome.storage.local.remove(['pendingPrompt', 'pendingTitle', 'promptTimestamp']);
          }
        }
      });
    }
  }, 2000);
}); 