// Log when the script starts
console.log('Google Learning content script loaded');

// Flag to prevent concurrent submissions
let isProcessing = false;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message in Google Learning content script:', message);
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

  // Add a small delay after scrolling if needed, though often not necessary with event dispatch
  // await new Promise(resolve => setTimeout(resolve, 100)); 

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
    console.log('Looking for input field for Google Learning...');
    const inputSelector = 'textarea[placeholder="Type or share a file to start..."]';
    const inputField = await waitForElement(inputSelector);
    console.log('Input field found:', inputField);

    insertTextIntoTextarea(inputField, prompt);
    console.log('Prompt text inserted into Google Learning input.');

    await new Promise(resolve => setTimeout(resolve, 750)); // Slightly increased delay

    console.log('Looking for send button for Google Learning...');
    // Refined selector: div.K o_84 o_82 o_79 span.N o_89 o_90 o_79 with text "send"
    const sendButtonSelector = 'div.K.o_84.o_82.o_79 span.N.o_89.o_90.o_79';
    const sendButton = await waitForElement(sendButtonSelector, 'send');
    console.log('Send button found and enabled:', sendButton);

    robustClick(sendButton); // Use robust click
    console.log('Robust send button click attempted.');

    // Clear pending prompt from storage after successful submission
    chrome.storage.local.remove(['pendingGoogleLearningPrompt', 'googleLearningPromptTimestamp'], () => {
      if (chrome.runtime.lastError) {
        console.error('Error clearing pending Google Learning prompt:', chrome.runtime.lastError);
      } else {
        console.log('Cleared pending Google Learning prompt from storage after successful submission.');
      }
    });

  } catch (error) {
    console.error('Error in insertPromptAndSubmit for Google Learning:', error);
    throw error; // Re-throw to be caught by the caller
  }
  // 'isProcessing' is reset by the caller's finally block
}

// Check for pending prompts on page load
function checkPendingPrompt() {
  if (isProcessing) {
    console.log('Processing already in progress, skipping pending Google Learning prompt check.');
    return;
  }
  console.log('Checking for pending Google Learning prompt...');
  chrome.storage.local.get(['pendingGoogleLearningPrompt', 'googleLearningPromptTimestamp'], (result) => {
    if (chrome.runtime.lastError) {
      console.error('Error getting pending Google Learning prompt:', chrome.runtime.lastError);
      return;
    }

    if (isProcessing) { // Check again in case of race condition
      console.log('Processing started while waiting for storage, skipping pending Google Learning prompt.');
      return;
    }

    if (result.pendingGoogleLearningPrompt && result.googleLearningPromptTimestamp) {
      const promptToProcess = result.pendingGoogleLearningPrompt;
      const timestamp = result.googleLearningPromptTimestamp;
      const promptAge = Date.now() - timestamp;

      // Check if the prompt is recent (e.g., within the last 60 seconds)
      if (promptAge < 60000) { // 1 minute
        console.log('Found pending Google Learning prompt from storage:', promptToProcess.substring(0, 50) + '...');
        isProcessing = true;
        console.log('Setting isProcessing = true (checkPendingPrompt)');

        chrome.storage.local.remove(['pendingGoogleLearningPrompt', 'googleLearningPromptTimestamp'], () => {
          if (chrome.runtime.lastError) {
            console.error('Error clearing pending Google Learning prompt before processing:', chrome.runtime.lastError);
            // If we can't clear it, maybe don't proceed to avoid double submission?
            isProcessing = false; 
            console.log('Resetting isProcessing due to clear error (checkPendingPrompt).');
            return;
          }
          console.log('Cleared pending Google Learning prompt from storage before processing.');
          insertPromptAndSubmit(promptToProcess)
            .then(() => console.log('Pending Google Learning prompt processed successfully.'))
            .catch(error => {
              console.error('Error processing pending Google Learning prompt:', error);
              // Optional: Consider re-storing the prompt if submission fails critically?
              // chrome.storage.local.set({ pendingGoogleLearningPrompt: promptToProcess, googleLearningPromptTimestamp: timestamp });
            })
            .finally(() => {
                isProcessing = false;
                console.log('Processing finished, resetting isProcessing flag to false (checkPendingPrompt finally).');
            });
        });
      } else {
        console.log('Pending Google Learning prompt is too old, discarding.');
        chrome.storage.local.remove(['pendingGoogleLearningPrompt', 'googleLearningPromptTimestamp']);
      }
    } else {
      console.log('No pending Google Learning prompt found in storage.');
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

// Example of how to send a message to the background script (if needed)
// function notifyBackground(data) {
//   chrome.runtime.sendMessage({ type: "FROM_GOOGLE_LEARNING_CS", data: data }, response => {
//     if (chrome.runtime.lastError) {
//       console.error("Error sending message to background:", chrome.runtime.lastError.message);
//     } else {
//       console.log("Background script responded:", response);
//     }
//   });
// } 