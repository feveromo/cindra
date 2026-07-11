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

  } catch (error) {
    console.error('Error in insertPromptAndSubmit for Google Learning:', error);
    throw error;
  }
}

CindraProviderRuntime.register({
  providerId: 'google-learning',
  legacyKeys: {
    prompt: 'pendingGoogleLearningPrompt',
    timestamp: 'googleLearningPromptTimestamp'
  },
  submitPrompt: insertPromptAndSubmit
});
