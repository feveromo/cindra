function insertTextIntoGrokEditor({ input, prompt }) {
  const isContentEditable = input.getAttribute?.('contenteditable') === 'true';
  if (!isContentEditable) {
    CindraInject.insertTextIntoTextarea(input, prompt);
    return;
  }

  input.replaceChildren();
  input.focus();
  const paragraph = document.createElement('p');
  paragraph.textContent = prompt;
  input.appendChild(paragraph);
  CindraInject.dispatchInput(input, prompt);
}

CindraProviderRuntime.registerAdapter({
  providerId: 'grok',
  inputSelectors: [
    'div.tiptap.ProseMirror[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"].tiptap',
    'textarea[dir="auto"]'
  ],
  insertPrompt: insertTextIntoGrokEditor,
  settleMs: 600,
  submitSelectors: [
    'button[aria-label="Submit"]:not([disabled])',
    'button[type="submit"]:not([disabled])'
  ],
  submitTimeoutMs: 2000,
  fallbackSubmit: ({ input }) => CindraInject.dispatchEnter(input, { keyup: true })
});
