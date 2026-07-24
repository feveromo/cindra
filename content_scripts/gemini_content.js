async function insertTextIntoEditableDiv({ input, prompt }) {
  input.focus();

  // Gemini's Quill editor accepts direct DOM text plus input events more reliably than execCommand.
  input.replaceChildren();

  const fragment = document.createDocumentFragment();
  const lines = prompt.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      fragment.appendChild(document.createElement('br'));
    }
    if (lines[i]) {
      fragment.appendChild(document.createTextNode(lines[i]));
    }
  }

  input.appendChild(fragment);

  input.classList.remove('ql-blank');

  // InputEvent.data can truncate large prompts, so the text lives in the DOM instead.
  const inputEvent = new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: 'insertText',
    data: null
  });
  input.dispatchEvent(inputEvent);

  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  input.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

CindraProviderRuntime.registerAdapter({
  providerId: 'gemini',
  inputSelectors: [
    'div.ql-editor[contenteditable="true"][aria-label="Enter a prompt here"]',
    'div.ql-editor[contenteditable="true"][aria-label="Enter a prompt for Gemini"]',
    'div.ql-editor[contenteditable="true"][data-placeholder="Ask Gemini"]',
    'rich-textarea div.ql-editor[contenteditable="true"]'
  ],
  insertPrompt: insertTextIntoEditableDiv,
  settleMs: 500,
  // Gemini marks disabled state through aria-disabled rather than disabled.
  submitSelectors: [
    'button.send-button[aria-label="Send message"]:not([aria-disabled="true"])',
    'button[aria-label="Send message"]:not([aria-disabled="true"]):not([disabled])',
    'button[type="submit"][aria-label="Send message"]:not([aria-disabled="true"]):not([disabled])'
  ]
});
