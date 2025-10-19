// Log when the script starts
console.log('HuggingChat content script loaded');

// Flag to prevent concurrent submissions
let isProcessing = false;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message in HuggingChat content script:', message);
  if (message.action === 'insertPrompt') {
    if (isProcessing) {
      console.log('Already processing, ignoring message.');
      sendResponse({ success: false, error: 'Already processing' });
      return true;
    }
    isProcessing = true;
    console.log('Setting isProcessing = true (onMessage)');

    insertPromptAndSubmit(message.prompt)
      .then(() => {
        console.log('Prompt inserted and submitted successfully via message.');
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Error inserting prompt via message:', error);
        sendResponse({ success: false, error: error.message });
      })
      .finally(() => {
        isProcessing = false;
        console.log('Processing finished, resetting isProcessing flag to false (onMessage finally).');
      });
    return true; // Indicates asynchronous response
  }
});

// Function to find element with retry mechanism
function waitForElement(selector, textContent = null, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const intervalTime = 100;
    let elapsedTime = 0;

    const interval = setInterval(() => {
      let element = document.querySelector(selector);
      if (element && textContent) {
        if (element.textContent.trim() !== textContent) {
          element = null; // Not the right element
        }
      }
      
      if (element) {
        clearInterval(interval);
        resolve(element);
      } else {
        elapsedTime += intervalTime;
        if (elapsedTime >= timeout) {
          clearInterval(interval);
          let errorMsg = `Element not found after ${timeout}ms: ${selector}`;
          if (textContent) {
            errorMsg += ` with textContent "${textContent}"`;
          }
          reject(new Error(errorMsg));
        }
      }
    }, intervalTime);
  });
}

// Function to insert text into the textarea
function insertTextIntoTextarea(textarea, text) {
  textarea.focus();
  textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
  console.log('Text inserted into textarea and events dispatched.');
}

// Function to perform a robust click
function robustClick(element) {
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const mousedownEvent = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    view: window
  });
  const mouseupEvent = new MouseEvent('mouseup', {
    bubbles: true,
    cancelable: true,
    view: window
  });
  const clickEvent = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window
  });

  element.dispatchEvent(mousedownEvent);
  element.dispatchEvent(mouseupEvent);
  element.dispatchEvent(clickEvent);
  console.log('Robust click events dispatched on:', element);
}

// Main function to handle inserting prompt and submitting
async function insertPromptAndSubmit(prompt) {
  try {
    console.log('Looking for input field for HuggingChat...');
    
    // Debug: Log all textareas on the page
    const allTextareas = document.querySelectorAll('textarea');
    console.log(`Found ${allTextareas.length} textarea elements on the page`);
    allTextareas.forEach((textarea, index) => {
      console.log(`Textarea ${index}: placeholder="${textarea.placeholder}", aria-label="${textarea.getAttribute('aria-label')}"`);
    });
    
    // Selector for HuggingChat textarea
    const inputSelector = 'textarea[placeholder="Ask anything"]';
    const inputField = await waitForElement(inputSelector);
    console.log('Input field found:', inputField);

    insertTextIntoTextarea(inputField, prompt);
    console.log('Prompt text inserted into HuggingChat input.');

    await new Promise(resolve => setTimeout(resolve, 750));

    console.log('Looking for send button for HuggingChat...');
    // Wait for button to be enabled (loses disabled attribute)
    const sendButtonSelector = 'button[type="submit"][aria-label="Send message"]:not([disabled])';
    const sendButton = await waitForElement(sendButtonSelector);
    console.log('Send button found and enabled:', sendButton);

    robustClick(sendButton);
    console.log('Robust send button click attempted.');

    // Clear pending prompt from storage after successful submission
    chrome.storage.local.remove(['pendingHuggingChatPrompt', 'huggingChatPromptTimestamp'], () => {
      if (chrome.runtime.lastError) {
        console.error('Error clearing pending HuggingChat prompt:', chrome.runtime.lastError);
      } else {
        console.log('Cleared pending HuggingChat prompt from storage after successful submission.');
      }
    });

  } catch (error) {
    console.error('Error in insertPromptAndSubmit for HuggingChat:', error);
    throw error; // Re-throw to be caught by the caller
  }
}

// Check for pending prompts on page load
function checkPendingPrompt() {
  if (isProcessing) {
    console.log('Processing already in progress, skipping pending HuggingChat prompt check.');
    return;
  }
  console.log('Checking for pending HuggingChat prompt...');
  chrome.storage.local.get(['pendingHuggingChatPrompt', 'huggingChatPromptTimestamp'], (result) => {
    if (chrome.runtime.lastError) {
      console.error('Error getting pending HuggingChat prompt:', chrome.runtime.lastError);
      return;
    }

    if (isProcessing) { // Check again in case of race condition
      console.log('Processing started while waiting for storage, skipping pending HuggingChat prompt.');
      return;
    }

    if (result.pendingHuggingChatPrompt && result.huggingChatPromptTimestamp) {
      const promptToProcess = result.pendingHuggingChatPrompt;
      const timestamp = result.huggingChatPromptTimestamp;
      const promptAge = Date.now() - timestamp;

      // Check if the prompt is recent (e.g., within the last 60 seconds)
      if (promptAge < 60000) { // 1 minute
        console.log('Found pending HuggingChat prompt from storage:', promptToProcess.substring(0, 50) + '...');
        isProcessing = true;
        console.log('Setting isProcessing = true (checkPendingPrompt)');

        chrome.storage.local.remove(['pendingHuggingChatPrompt', 'huggingChatPromptTimestamp'], () => {
          if (chrome.runtime.lastError) {
            console.error('Error clearing pending HuggingChat prompt before processing:', chrome.runtime.lastError);
            isProcessing = false; 
            console.log('Resetting isProcessing due to clear error (checkPendingPrompt).');
            return;
          }
          console.log('Cleared pending HuggingChat prompt from storage before processing.');
          insertPromptAndSubmit(promptToProcess)
            .then(() => console.log('Pending HuggingChat prompt processed successfully.'))
            .catch(error => {
              console.error('Error processing pending HuggingChat prompt:', error);
            })
            .finally(() => {
                isProcessing = false;
                console.log('Processing finished, resetting isProcessing flag to false (checkPendingPrompt finally).');
            });
        });
      } else {
        console.log('Pending HuggingChat prompt is too old, discarding.');
        chrome.storage.local.remove(['pendingHuggingChatPrompt', 'huggingChatPromptTimestamp']);
      }
    } else {
      console.log('No pending HuggingChat prompt found in storage.');
    }
  });
}

// Check pending prompt when the script loads or the page becomes ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkPendingPrompt);
} else {
  // Small delay to ensure page elements might be more ready
  setTimeout(checkPendingPrompt, 250); 
}

