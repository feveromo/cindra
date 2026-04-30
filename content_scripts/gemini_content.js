console.log('Gemini content script loaded');

let isProcessing = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message in Gemini content script:', message);
  if (message.action === 'insertPrompt') {
    if (isProcessing) {
      console.log('Already processing, ignoring message.');
      sendResponse({ success: false, error: 'Already processing' });
      return true;
    }
    isProcessing = true;
    console.log('Setting isProcessing = true (onMessage)');

    insertPromptAndSubmit(message.prompt, message.title)
      .then(() => {
        console.log('Prompt inserted and submitted successfully via message.');
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Error inserting prompt via message:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

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

async function insertTextIntoEditableDiv(div, text) {
  console.log(`Inserting text of length: ${text.length}`);

  div.focus();

  // Gemini's Quill editor accepts direct DOM text plus input events more reliably than execCommand.
  div.innerHTML = '';

  const fragment = document.createDocumentFragment();
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      fragment.appendChild(document.createElement('br'));
    }
    if (lines[i]) {
      fragment.appendChild(document.createTextNode(lines[i]));
    }
  }

  div.appendChild(fragment);

  div.classList.remove('ql-blank');

  // InputEvent.data can truncate large prompts, so the text lives in the DOM instead.
  const inputEvent = new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: 'insertText',
    data: null
  });
  div.dispatchEvent(inputEvent);

  div.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  div.dispatchEvent(new Event('change', { bubbles: true }));

  div.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(div);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);

  console.log('Text insertion complete, final div content length:', div.textContent.length);
}

async function insertPromptAndSubmit(prompt, title) {
  try {
    console.log('Looking for input field...');
    const inputSelector = 'div.ql-editor[contenteditable="true"][aria-label="Enter a prompt here"]';
    const inputField = await waitForElement(inputSelector);
    console.log('Input field found:', inputField);

    await insertTextIntoEditableDiv(inputField, prompt);
    console.log('Prompt text inserted.');

    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('Looking for send button...');
    // Gemini marks disabled state through aria-disabled rather than disabled.
    const sendButtonSelector = 'button.send-button[aria-label="Send message"]:not([aria-disabled="true"])';
    const sendButton = await waitForElement(sendButtonSelector);
    console.log('Send button found and enabled:', sendButton);

    sendButton.click();
    console.log('Send button clicked.');

    // Failsafe in case checkPendingPrompt did not claim the prompt first.
    chrome.storage.local.remove(['pendingGeminiPrompt', 'pendingGeminiTitle', 'geminiPromptTimestamp'], () => {
      console.log('Cleared pending prompt from storage after successful submission.');
    });

  } catch (error) {
    console.error('Error in insertPromptAndSubmit:', error);
    throw error;
  } finally {
    isProcessing = false;
    console.log('Processing finished, resetting isProcessing flag to false.');
  }
}

function checkPendingPrompt() {
  if (isProcessing) {
    console.log('Processing already in progress, skipping pending prompt check.');
    return;
  }
  console.log('Checking for pending prompt...');
  chrome.storage.local.get(['pendingGeminiPrompt', 'pendingGeminiTitle', 'geminiPromptTimestamp'], (result) => {
    // The message listener may start processing while storage is loading.
    if (isProcessing) {
      console.log('Processing started while waiting for storage, skipping pending prompt.');
      return;
    }
    if (result.pendingGeminiPrompt && result.geminiPromptTimestamp) {
      const promptToProcess = result.pendingGeminiPrompt;
      const titleToProcess = result.pendingGeminiTitle;
      const timestamp = result.geminiPromptTimestamp;
      console.log(`Gemini content script received prompt of length: ${promptToProcess.length}`);

      const promptAge = Date.now() - result.geminiPromptTimestamp;

      if (promptAge < 60000) {
        console.log('Found pending Gemini prompt from storage:', result.pendingGeminiTitle);

        isProcessing = true;
        console.log('Setting isProcessing = true (checkPendingPrompt)');

        // Claim the prompt before submit so reloads do not send it twice.
        chrome.storage.local.remove(['pendingGeminiPrompt', 'pendingGeminiTitle', 'geminiPromptTimestamp'], () => {
          console.log('Cleared pending prompt from storage before processing.');
          insertPromptAndSubmit(promptToProcess, titleToProcess)
            .then(() => console.log('Pending prompt processed successfully.'))
            .catch(error => {
              console.error('Error processing pending prompt:', error);
              if (isProcessing) {
                console.warn('Resetting isProcessing flag in pending prompt catch block.');
                isProcessing = false;
              }
            });
        });
      } else {
        console.log('Pending Gemini prompt is too old, discarding.');
        chrome.storage.local.remove(['pendingGeminiPrompt', 'pendingGeminiTitle', 'geminiPromptTimestamp']);
      }
    } else {
      console.log('No pending Gemini prompt found in storage.');
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkPendingPrompt);
} else {
  checkPendingPrompt();
}
