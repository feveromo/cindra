// Log when the script starts
console.log('Gemini content script loaded');

// Flag to prevent concurrent submissions
let isProcessing = false;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message in Gemini content script:', message);
  if (message.action === 'insertPrompt') {
    // Check if already processing
    if (isProcessing) {
      console.log('Already processing, ignoring message.');
      sendResponse({ success: false, error: 'Already processing' });
      return true; // Indicate async response handled
    }
    isProcessing = true; // Set flag
    console.log('Setting isProcessing = true (onMessage)');

    insertPromptAndSubmit(message.prompt, message.title)
      .then(() => {
        console.log('Prompt inserted and submitted successfully via message.');
        sendResponse({ success: true });
        // isProcessing is reset in the finally block of insertPromptAndSubmit
      })
      .catch(error => {
        console.error('Error inserting prompt via message:', error);
        sendResponse({ success: false, error: error.message });
        // isProcessing is reset in the finally block of insertPromptAndSubmit
      });
    return true; // Indicates asynchronous response
  }
});

// Function to find element with retry mechanism
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const intervalTime = 100;
    let elapsedTime = 0;

    const interval = setInterval(() => {
      const element = document.querySelector(selector);
      if (element) {
        clearInterval(interval);
        resolve(element);
      } else {
        elapsedTime += intervalTime;
        if (elapsedTime >= timeout) {
          clearInterval(interval);
          reject(new Error(`Element not found after ${timeout}ms: ${selector}`));
        }
      }
    }, intervalTime);
  });
}

// Function to insert text into the contenteditable div
function insertTextIntoEditableDiv(div, text) {
  // Ensure the div is focused
  div.focus();
  
  // Clear existing content (if any)
  div.innerHTML = ''; 
  
  // Insert the new text
  // We might need to simulate typing for some complex editors
  // Using execCommand as a fallback, might not work in all cases
  try {
    if (!document.execCommand('insertText', false, text)) {
      // Fallback: directly set innerText or textContent if execCommand fails
      div.textContent = text;
    }
  } catch (e) {
      // If execCommand throws error (e.g., in non-designMode), use direct assignment
      div.textContent = text;
  }

  // Dispatch input events to trigger any attached listeners
  div.dispatchEvent(new Event('input', { bubbles: true }));
  div.dispatchEvent(new Event('change', { bubbles: true }));
}

// Main function to handle inserting prompt and submitting
async function insertPromptAndSubmit(prompt, title) {
  try {
    console.log('Looking for input field...');
    // Selector for the input area (contenteditable div)
    const inputSelector = 'div.ql-editor[contenteditable="true"][data-placeholder="Ask Gemini"]';
    const inputField = await waitForElement(inputSelector);
    console.log('Input field found:', inputField);

    // Insert the prompt text
    insertTextIntoEditableDiv(inputField, prompt);
    console.log('Prompt text inserted.');

    // Wait a brief moment for the UI to update (e.g., enable the send button)
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('Looking for send button...');
    // Selector for the send button (ensure it's not disabled)
    // The button might lose the 'aria-disabled' attribute or it might be set to 'false' when enabled
    const sendButtonSelector = 'button.send-button[aria-label="Send message"]:not([aria-disabled="true"])';
    const sendButton = await waitForElement(sendButtonSelector);
    console.log('Send button found and enabled:', sendButton);

    // Click the send button
    sendButton.click();
    console.log('Send button clicked.');
    
    // Clear the pending prompt from storage after successful submission
    // Moved clearing primarily to checkPendingPrompt, but keep here as failsafe
    chrome.storage.local.remove(['pendingGeminiPrompt', 'pendingGeminiTitle', 'geminiPromptTimestamp'], () => {
      console.log('Cleared pending prompt from storage after successful submission.');
    });

  } catch (error) {
    console.error('Error in insertPromptAndSubmit:', error);
    // Optionally clear storage even on error, depending on desired behavior
    // chrome.storage.local.remove(['pendingGeminiPrompt', 'pendingGeminiTitle', 'geminiPromptTimestamp']);
    throw error; // Re-throw to be caught by the caller
  } finally {
    // Ensure the processing flag is always reset
    isProcessing = false;
    console.log('Processing finished, resetting isProcessing flag to false.');
  }
}

// Check for pending prompts on page load
function checkPendingPrompt() {
  // Check flag before starting
  if (isProcessing) {
    console.log('Processing already in progress, skipping pending prompt check.');
    return;
  }
  console.log('Checking for pending prompt...');
  chrome.storage.local.get(['pendingGeminiPrompt', 'pendingGeminiTitle', 'geminiPromptTimestamp'], (result) => {
    // Check flag again inside async callback, in case message listener started processing
    if (isProcessing) {
      console.log('Processing started while waiting for storage, skipping pending prompt.');
      return;
    }
    if (result.pendingGeminiPrompt && result.geminiPromptTimestamp) {
      const promptToProcess = result.pendingGeminiPrompt;
      const titleToProcess = result.pendingGeminiTitle;
      const timestamp = result.geminiPromptTimestamp;
      
      const promptAge = Date.now() - result.geminiPromptTimestamp;
      
      // Check if the prompt is recent (e.g., within the last 60 seconds)
      if (promptAge < 60000) {
        console.log('Found pending Gemini prompt from storage:', result.pendingGeminiTitle);
        
        // Set flag before starting async operations
        isProcessing = true;
        console.log('Setting isProcessing = true (checkPendingPrompt)');

        // IMPORTANT: Clear the prompt from storage *before* attempting to submit 
        // to prevent re-submission if the page reloads or the script runs again.
        chrome.storage.local.remove(['pendingGeminiPrompt', 'pendingGeminiTitle', 'geminiPromptTimestamp'], () => {
          console.log('Cleared pending prompt from storage before processing.');
          // Now attempt to submit
          insertPromptAndSubmit(promptToProcess, titleToProcess)
            .then(() => console.log('Pending prompt processed successfully.'))
            .catch(error => {
              console.error('Error processing pending prompt:', error);
              // isProcessing should be reset by the finally block, but as a safeguard:
              if (isProcessing) {
                 console.warn('Resetting isProcessing flag in pending prompt catch block.');
                 isProcessing = false;
              }
              // Optional: Consider re-storing the prompt if submission fails critically?
              // chrome.storage.local.set({ pendingGeminiPrompt: promptToProcess, pendingGeminiTitle: titleToProcess, geminiPromptTimestamp: timestamp });
            });
        });
      } else {
        console.log('Pending Gemini prompt is too old, discarding.');
        // Clear the old prompt
        chrome.storage.local.remove(['pendingGeminiPrompt', 'pendingGeminiTitle', 'geminiPromptTimestamp']);
      }
    } else {
      console.log('No pending Gemini prompt found in storage.');
    }
  });
}

// Check pending prompt when the script loads or the page becomes ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkPendingPrompt);
} else {
  checkPendingPrompt();
}
