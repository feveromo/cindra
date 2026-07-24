function setPromptOnChatGptEditor({ input, prompt }) {
  const isContentEditable = input.getAttribute('contenteditable') === 'true';
  input.focus();

  if (isContentEditable) {
    input.replaceChildren();
    const paragraph = document.createElement('p');
    paragraph.textContent = prompt;
    input.appendChild(paragraph);
    CindraInject.dispatchInput(input, prompt);
    return;
  }

  CindraInject.insertTextIntoTextarea(input, prompt);
}

CindraProviderRuntime.registerAdapter({
  providerId: 'chatgpt',
  inputSelectors: [
    '#prompt-textarea',
    'textarea[data-id="root"]',
    'textarea.w-full',
    'div[contenteditable="true"]#prompt-textarea',
    'div[contenteditable="true"].w-full'
  ],
  insertPrompt: setPromptOnChatGptEditor,
  settleMs: 500,
  submitSelectors: [
    'button[data-testid="send-button"]:not([disabled])',
    'button[type="submit"]:not([disabled])',
    'button[aria-label*="Send" i]:not([disabled])'
  ],
  submitTimeoutMs: 2500,
  fallbackSubmit: ({ input }) => CindraInject.dispatchEnter(input)
});
