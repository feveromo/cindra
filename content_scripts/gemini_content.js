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
    const inputSelector = [
      'div.ql-editor[contenteditable="true"][aria-label="Enter a prompt here"]',
      'div.ql-editor[contenteditable="true"][aria-label="Enter a prompt for Gemini"]',
      'div.ql-editor[contenteditable="true"][data-placeholder="Ask Gemini"]',
      'rich-textarea div.ql-editor[contenteditable="true"]'
    ];
    const inputField = await CindraInject.waitForElement(inputSelector);

    await insertTextIntoEditableDiv(inputField, prompt);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Gemini marks disabled state through aria-disabled rather than disabled.
    const sendButtonSelector = [
      'button.send-button[aria-label="Send message"]:not([aria-disabled="true"])',
      'button[aria-label="Send message"]:not([aria-disabled="true"]):not([disabled])',
      'button[type="submit"][aria-label="Send message"]:not([aria-disabled="true"]):not([disabled])'
    ];
    const sendButton = await CindraInject.waitForElement(sendButtonSelector);

    CindraInject.robustClick(sendButton);

  } catch (error) {
    console.error('Error in insertPromptAndSubmit:', error);
    throw error;
  }
}

CindraProviderRuntime.register({
  providerId: 'gemini',
  legacyKeys: {
    prompt: 'pendingGeminiPrompt',
    timestamp: 'geminiPromptTimestamp'
  },
  submitPrompt: insertPromptAndSubmit
});
