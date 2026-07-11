function normalizePromptForKimi(prompt) {
  try {
    const closeTag = '</Content>';
    const firstCloseIdx = prompt.indexOf(closeTag);
    if (firstCloseIdx !== -1) {
      const trimmed = prompt.slice(0, firstCloseIdx + closeTag.length);
      return trimmed;
    }
    return prompt;
  } catch (e) {
    return prompt;
  }
}

function insertTextIntoEditableDiv(editableDiv, text) {
  editableDiv.focus();

  try {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editableDiv);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('delete');
  } catch (e) {
  }

  // Kimi's Lexical editor can double-insert if paste and fallback both run.
  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true
    });
    editableDiv.dispatchEvent(pasteEvent);
  } catch (e) {
  }

  try {
    editableDiv.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  } catch (e) {}

  editableDiv.focus();
}

function forceSetEditableDivContent(editableDiv, text) {
  try {
    editableDiv.textContent = text;
    editableDiv.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  } catch (e) {
  }
}

function getAttachmentCount() {
  return document.querySelectorAll('.file-card-container').length;
}

function waitForAttachmentCountIncrease(initialCount, timeout = 1500) {
  if (getAttachmentCount() > initialCount) return Promise.resolve(true);

  return new Promise(resolve => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (getAttachmentCount() > initialCount) {
        clearInterval(interval);
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeout) {
        clearInterval(interval);
        resolve(false);
      }
    }, 100);
  });
}

function robustClick(element) {
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Prefer one native click to avoid duplicate submit handlers.
  try {
    element.click();
  } catch (e) {
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window
    });
    element.dispatchEvent(clickEvent);
  }
}

function isSendButtonEnabled(sendButtonContainer) {
  const isEnabled = !sendButtonContainer.classList.contains('disabled');
  return isEnabled;
}

function waitForSendButtonEnabled(timeout = 20000) {
  return new Promise((resolve, reject) => {
    const sendButtonContainer = document.querySelector('.send-button-container');
    if (sendButtonContainer && isSendButtonEnabled(sendButtonContainer)) {
      const sendButton = sendButtonContainer.querySelector('.send-button') || sendButtonContainer;
      if (sendButton) {
        resolve(sendButton);
        return;
      }
    }

    const intervalTime = 100;
    let elapsedTime = 0;

    const interval = setInterval(() => {
      const sendButtonContainer = document.querySelector('.send-button-container');

      if (sendButtonContainer && isSendButtonEnabled(sendButtonContainer)) {
        clearInterval(interval);
        const sendButton = sendButtonContainer.querySelector('.send-button') || sendButtonContainer;
        if (sendButton) {
          resolve(sendButton);
        } else {
          console.error('Send button container found but send button element not found');
          reject(new Error('Send button container found but send button element not found'));
        }
      } else {
        elapsedTime += intervalTime;
        if (elapsedTime >= timeout) {
          clearInterval(interval);
          console.error(`Send button not enabled after ${timeout}ms`);
          if (sendButtonContainer) {
            console.error('Final container state:', sendButtonContainer.classList.toString());
          }
          reject(new Error(`Send button not enabled after ${timeout}ms`));
        }
      }
    }, intervalTime);
  });
}

async function insertPromptAndSubmit(prompt) {
  try {
    const inputSelectors = [
      '.chat-input-editor[contenteditable="true"]',
      '.chat-input [contenteditable="true"]',
      'div[contenteditable="true"][data-lexical-editor="true"]'
    ];

    let inputField = null;
    for (const sel of inputSelectors) {
      try {
        inputField = await CindraInject.waitForElement(sel, 1500);
        if (inputField) break;
      } catch (e) {
      }
    }
    if (!inputField) {
      inputField = await CindraInject.waitForElement('.chat-input-editor[contenteditable="true"]', 10000);
    }

    const normalizedPrompt = normalizePromptForKimi(prompt);
    const attachmentCountBefore = getAttachmentCount();

    insertTextIntoEditableDiv(inputField, normalizedPrompt);

    const attachmentCreated = normalizedPrompt.length > 3500
      ? await waitForAttachmentCountIncrease(attachmentCountBefore)
      : false;
    const insertedText = inputField.textContent || inputField.innerText || '';

    if (!attachmentCreated && insertedText.length < Math.min(100, Math.floor(normalizedPrompt.length * 0.8))) {
      forceSetEditableDivContent(inputField, normalizedPrompt);
    }

    let sendButton;
    try {
      sendButton = await waitForSendButtonEnabled(1000);
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      sendButton = await waitForSendButtonEnabled();
    }

    robustClick(sendButton);

  } catch (error) {
    console.error('Error in insertPromptAndSubmit for Kimi:', error);

    try {
      const inputField = document.querySelector('.chat-input-editor[contenteditable="true"]');

      if (inputField) {
        if (getAttachmentCount() === 0) {
          insertTextIntoEditableDiv(inputField, prompt);
        }

        inputField.focus();
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        });
        inputField.dispatchEvent(enterEvent);
        return;
      }
    } catch (fallbackError) {
      console.error('[FALLBACK FAIL] Error during Enter key fallback:', fallbackError);
    }

    throw error;
  }
}

CindraProviderRuntime.register({
  providerId: 'kimi',
  legacyKeys: {
    prompt: 'pendingKimiPrompt',
    timestamp: 'kimiPromptTimestamp'
  },
  submitPrompt: insertPromptAndSubmit
});
