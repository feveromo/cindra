let isProcessing = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'insertPrompt') {
    if (isProcessing) {
      sendResponse({ success: false, error: 'Already processing' });
      return true;
    }
    isProcessing = true;

    insertPromptAndSubmit(message.prompt)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Error inserting prompt via message:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

async function insertTextIntoEditableDiv(div, text) {
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
}

async function insertPromptAndSubmit(prompt) {
  try {
    const inputSelector = 'div.ql-editor[contenteditable="true"][aria-label="Enter a prompt here"]';
    const inputField = await CindraInject.waitForElement(inputSelector);

    await insertTextIntoEditableDiv(inputField, prompt);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Gemini marks disabled state through aria-disabled rather than disabled.
    const sendButtonSelector = 'button.send-button[aria-label="Send message"]:not([aria-disabled="true"])';
    const sendButton = await CindraInject.waitForElement(sendButtonSelector);

    sendButton.click();

    // Failsafe in case checkPendingPrompt did not claim the prompt first.
    chrome.storage.local.remove(['pendingGeminiPrompt', 'geminiPromptTimestamp'], () => {
    });

  } catch (error) {
    console.error('Error in insertPromptAndSubmit:', error);
    throw error;
  } finally {
    isProcessing = false;
  }
}

function checkPendingPrompt() {
  if (isProcessing) {
    return;
  }
  chrome.storage.local.get(['pendingGeminiPrompt', 'geminiPromptTimestamp'], (result) => {
    // The message listener may start processing while storage is loading.
    if (isProcessing) {
      return;
    }
    if (result.pendingGeminiPrompt && result.geminiPromptTimestamp) {
      const promptToProcess = result.pendingGeminiPrompt;
      const timestamp = result.geminiPromptTimestamp;

      const promptAge = Date.now() - result.geminiPromptTimestamp;

      if (promptAge < 60000) {
        isProcessing = true;

        // Claim the prompt before submit so reloads do not send it twice.
        chrome.storage.local.remove(['pendingGeminiPrompt', 'geminiPromptTimestamp'], () => {
          insertPromptAndSubmit(promptToProcess)
            .then(() => {})
            .catch(error => {
              console.error('Error processing pending prompt:', error);
              if (isProcessing) {
                console.warn('Resetting isProcessing flag in pending prompt catch block.');
                isProcessing = false;
              }
            });
        });
      } else {
        chrome.storage.local.remove(['pendingGeminiPrompt', 'geminiPromptTimestamp']);
      }
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkPendingPrompt);
} else {
  checkPendingPrompt();
}
