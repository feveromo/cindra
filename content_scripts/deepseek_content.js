console.log('DeepSeek content script loaded');

let isProcessing = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'insertPrompt') {
    if (isProcessing) {
      console.log('DeepSeek: Already processing, ignoring request');
      sendResponse({ success: false, error: 'Already processing' });
      return true;
    }

    isProcessing = true;
    insertPromptAndSubmit(message.prompt)
      .then(() => {
        console.log('DeepSeek: Successfully inserted and submitted prompt');
        sendResponse({ success: true });
      })
      .catch((err) => {
        console.error('DeepSeek: Error inserting prompt:', err);
        sendResponse({ success: false, error: err?.message || String(err) });
      })
      .finally(() => {
        isProcessing = false;
      });
    return true;
  }
});

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      return resolve(element);
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      const element = document.querySelector(selector);
      if (element) {
        clearInterval(interval);
        resolve(element);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(interval);
        reject(new Error(`Timeout waiting for element: ${selector}`));
      }
    }, 100);
  });
}

function insertTextIntoTextarea(textarea, text) {
  textarea.focus();
  textarea.value = text;

  // React-backed inputs need synthetic input/change events after direct value writes.
  textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

function robustClick(element) {
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Some sites ignore element.click(), so send the full mouse event sequence.
  const events = ['mousedown', 'mouseup', 'click'];
  events.forEach(eventType => {
    const event = new MouseEvent(eventType, {
      bubbles: true,
      cancelable: true,
      view: window
    });
    element.dispatchEvent(event);
  });
}

async function insertPromptAndSubmit(prompt) {
  if (!prompt) {
    throw new Error('No prompt provided');
  }

  try {
    console.log('DeepSeek: Starting prompt insertion');

    const textarea = await waitForElement('textarea[placeholder="Message DeepSeek"]');
    console.log('DeepSeek: Found textarea');

    insertTextIntoTextarea(textarea, prompt);
    console.log('DeepSeek: Inserted text into textarea');

    await new Promise(resolve => setTimeout(resolve, 1500));

    const submitButton = await waitForElement('div.bf38813a div[role="button"][aria-disabled="false"]._7436101', 3000);
    console.log('DeepSeek: Found enabled send button');

    robustClick(submitButton);

    // Backup click for DeepSeek's occasionally missed first handler.
    setTimeout(() => {
      submitButton.click();
    }, 200);

    chrome.storage.local.remove(['pendingDeepseekPrompt', 'deepseekPromptTimestamp'], () => {
      console.log('DeepSeek: Cleared stored prompt');
    });

  } catch (error) {
    console.error('DeepSeek: Error in insertPromptAndSubmit:', error);
    throw error;
  }
}

function checkPendingPrompt() {
  chrome.storage.local.get(['pendingDeepseekPrompt', 'deepseekPromptTimestamp'], (result) => {
    const prompt = result.pendingDeepseekPrompt;
    const timestamp = result.deepseekPromptTimestamp;

    if (!prompt) {
      return;
    }

    const isFresh = timestamp && (Date.now() - timestamp) < 120000;
    if (!isFresh) {
      console.log('DeepSeek: Prompt is too old, removing from storage');
      chrome.storage.local.remove(['pendingDeepseekPrompt', 'deepseekPromptTimestamp']);
      return;
    }

    console.log('DeepSeek: Found pending prompt, processing...');

    // Claim the prompt before processing so reloads do not submit it twice.
    chrome.storage.local.remove(['pendingDeepseekPrompt', 'deepseekPromptTimestamp'], () => {
      isProcessing = true;
      insertPromptAndSubmit(prompt)
        .then(() => {
          console.log('DeepSeek: Successfully processed pending prompt');
        })
        .catch((error) => {
          console.error('DeepSeek: Error processing pending prompt:', error);
        })
        .finally(() => {
          isProcessing = false;
        });
    });
  });
}

setTimeout(checkPendingPrompt, 2000);


