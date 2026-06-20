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
      })
      .finally(() => {
        isProcessing = false;
      });
    return true;
  }
});

async function insertPromptAndSubmit(prompt) {
  try {
    const inputSelector = 'textarea[placeholder="Ask anything"]';
    const inputField = await CindraInject.waitForElement(inputSelector);

    CindraInject.insertTextIntoTextarea(inputField, prompt);

    await new Promise(resolve => setTimeout(resolve, 750));

    const sendButtonSelector = 'button[type="submit"][aria-label="Send message"]:not([disabled])';
    const sendButton = await CindraInject.waitForElement(sendButtonSelector);

    CindraInject.robustClick(sendButton);

    chrome.storage.local.remove(['pendingHuggingChatPrompt', 'huggingChatPromptTimestamp'], () => {
      if (chrome.runtime.lastError) {
        console.error('Error clearing pending HuggingChat prompt:', chrome.runtime.lastError);
      }
    });

  } catch (error) {
    console.error('Error in insertPromptAndSubmit for HuggingChat:', error);
    throw error;
  }
}

function checkPendingPrompt() {
  if (isProcessing) {
    return;
  }
  chrome.storage.local.get(['pendingHuggingChatPrompt', 'huggingChatPromptTimestamp'], (result) => {
    if (chrome.runtime.lastError) {
      console.error('Error getting pending HuggingChat prompt:', chrome.runtime.lastError);
      return;
    }

    if (isProcessing) {
      return;
    }

    if (result.pendingHuggingChatPrompt && result.huggingChatPromptTimestamp) {
      const promptToProcess = result.pendingHuggingChatPrompt;
      const timestamp = result.huggingChatPromptTimestamp;
      const promptAge = Date.now() - timestamp;

      if (promptAge < 60000) {
        isProcessing = true;

        chrome.storage.local.remove(['pendingHuggingChatPrompt', 'huggingChatPromptTimestamp'], () => {
          if (chrome.runtime.lastError) {
            console.error('Error clearing pending HuggingChat prompt before processing:', chrome.runtime.lastError);
            isProcessing = false;
            return;
          }
          insertPromptAndSubmit(promptToProcess)
            .then(() => {})
            .catch(error => {
              console.error('Error processing pending HuggingChat prompt:', error);
            })
            .finally(() => {
                isProcessing = false;
            });
        });
      } else {
        chrome.storage.local.remove(['pendingHuggingChatPrompt', 'huggingChatPromptTimestamp']);
      }
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkPendingPrompt);
} else {
  setTimeout(checkPendingPrompt, 250);
}
