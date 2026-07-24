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

  return CindraInject.waitForCondition(
    () => getAttachmentCount() > initialCount,
    timeout,
    'Kimi attachment'
  ).then(() => true, () => false);
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
  return CindraInject.waitForCondition(() => {
    const sendButtonContainer = document.querySelector('.send-button-container');
    if (sendButtonContainer && isSendButtonEnabled(sendButtonContainer)) {
      const sendButton = sendButtonContainer.querySelector('.send-button') || sendButtonContainer;
      if (sendButton) {
        return sendButton;
      }
    }

    return null;
  }, timeout, 'Kimi send button');
}

async function insertPrompt(context) {
  const { input: inputField, prompt } = context;
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
}

async function findSendButtonWithRetry() {
  try {
    return await waitForSendButtonEnabled(1000);
  } catch (error) {
    await CindraInject.delay(2000);
    return waitForSendButtonEnabled().catch(() => null);
  }
}

CindraProviderRuntime.registerAdapter({
  providerId: 'kimi',
  inputSelectors: [
    '.chat-input-editor[contenteditable="true"]',
    '.chat-input [contenteditable="true"]',
    'div[contenteditable="true"][data-lexical-editor="true"]'
  ],
  insertPrompt,
  findSubmit: findSendButtonWithRetry,
  submit: ({ submitControl }) => robustClick(submitControl),
  fallbackSubmit: ({ input, prompt }) => {
    if (getAttachmentCount() === 0) {
      insertTextIntoEditableDiv(input, prompt);
    }
    CindraInject.dispatchEnter(input);
  }
});
