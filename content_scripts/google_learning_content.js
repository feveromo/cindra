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

function findSendButton() {
  const spans = document.querySelectorAll('span');

  for (const span of spans) {
    const text = span.textContent.trim();
    const fontFamily = span.style.fontFamily;
    const cursor = span.style.cursor;

    if (text === 'send' &&
        fontFamily &&
        fontFamily.includes('Google Symbols') &&
        cursor === 'pointer') {
      return span;
    }
  }

  for (const span of spans) {
    const text = span.textContent.trim();
    if (text === 'send' && (span.style.cursor === 'pointer' || span.onclick || span.getAttribute('role') === 'button')) {
      return span;
    }
  }

  return null;
}

function waitForSendButton(timeout = 10000) {
  return new Promise((resolve, reject) => {
    const intervalTime = 100;
    let elapsedTime = 0;

    const interval = setInterval(() => {
      const sendButton = findSendButton();

      if (sendButton) {
        clearInterval(interval);
        resolve(sendButton);
      } else {
        elapsedTime += intervalTime;
        if (elapsedTime >= timeout) {
          clearInterval(interval);
          reject(new Error(`Send button not found after ${timeout}ms`));
        }
      }
    }, intervalTime);
  });
}

async function insertPromptAndSubmit(prompt) {
  try {
    const inputSelector = 'textarea[placeholder="Ask Learn About"]';
    let inputField;

    try {
      inputField = await CindraInject.waitForElement(inputSelector);
    } catch (error) {
      const fallbackSelector = 'textarea[aria-label*="Ask"], textarea[aria-label*="Learn"]';
      inputField = await CindraInject.waitForElement(fallbackSelector);
    }

    CindraInject.insertTextIntoTextarea(inputField, prompt);

    await new Promise(resolve => setTimeout(resolve, 750));

    const sendButton = await waitForSendButton();

    CindraInject.robustClick(sendButton);

    chrome.storage.local.remove(['pendingGoogleLearningPrompt', 'googleLearningPromptTimestamp'], () => {
      if (chrome.runtime.lastError) {
        console.error('Error clearing pending Google Learning prompt:', chrome.runtime.lastError);
      }
    });

  } catch (error) {
    console.error('Error in insertPromptAndSubmit for Google Learning:', error);
    throw error;
  }
}

function checkPendingPrompt() {
  if (isProcessing) {
    return;
  }
  chrome.storage.local.get(['pendingGoogleLearningPrompt', 'googleLearningPromptTimestamp'], (result) => {
    if (chrome.runtime.lastError) {
      console.error('Error getting pending Google Learning prompt:', chrome.runtime.lastError);
      return;
    }

    if (isProcessing) {
      return;
    }

    if (result.pendingGoogleLearningPrompt && result.googleLearningPromptTimestamp) {
      const promptToProcess = result.pendingGoogleLearningPrompt;
      const timestamp = result.googleLearningPromptTimestamp;
      const promptAge = Date.now() - timestamp;

      if (promptAge < 60000) {
        isProcessing = true;

        chrome.storage.local.remove(['pendingGoogleLearningPrompt', 'googleLearningPromptTimestamp'], () => {
          if (chrome.runtime.lastError) {
            console.error('Error clearing pending Google Learning prompt before processing:', chrome.runtime.lastError);
            isProcessing = false;
            return;
          }
          insertPromptAndSubmit(promptToProcess)
            .catch(error => {
              console.error('Error processing pending Google Learning prompt:', error);
            })
            .finally(() => {
                isProcessing = false;
            });
        });
      } else {
        chrome.storage.local.remove(['pendingGoogleLearningPrompt', 'googleLearningPromptTimestamp']);
      }
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkPendingPrompt);
} else {
  setTimeout(checkPendingPrompt, 250);
}
