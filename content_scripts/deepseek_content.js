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

async function insertPromptAndSubmit(prompt) {
  if (!prompt) {
    throw new Error('No prompt provided');
  }

  try {
    const textarea = await CindraInject.waitForElement('textarea[placeholder="Message DeepSeek"]');

    CindraInject.insertTextIntoTextarea(textarea, prompt);

    await new Promise(resolve => setTimeout(resolve, 1500));

    const submitButton = await CindraInject.waitForElement('div.bf38813a div[role="button"][aria-disabled="false"]._7436101', 3000);

    CindraInject.robustClick(submitButton);

    // Backup click for DeepSeek's occasionally missed first handler.
    setTimeout(() => {
      submitButton.click();
    }, 200);

    chrome.storage.local.remove(['pendingDeepseekPrompt', 'deepseekPromptTimestamp'], () => {});

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
      chrome.storage.local.remove(['pendingDeepseekPrompt', 'deepseekPromptTimestamp']);
      return;
    }

    // Claim the prompt before processing so reloads do not submit it twice.
    chrome.storage.local.remove(['pendingDeepseekPrompt', 'deepseekPromptTimestamp'], () => {
      isProcessing = true;
      insertPromptAndSubmit(prompt)
        .then(() => {})
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
