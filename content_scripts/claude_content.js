function insertTextIntoClaudeEditor({ input, prompt }) {
  input.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);

  if (!document.execCommand('insertText', false, prompt)) {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', prompt);
    input.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer
    }));
  }

  CindraInject.dispatchInput(input, prompt);
}

CindraProviderRuntime.registerAdapter({
  providerId: 'claude',
  inputSelectors: [
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"]#prompt-textarea',
    'div[contenteditable="true"].w-full'
  ],
  insertPrompt: insertTextIntoClaudeEditor,
  settleMs: 300,
  submitSelectors: 'button[aria-label="Send message"]:not(:disabled):not([aria-disabled="true"])',
  submitTimeoutMs: 2500,
  fallbackSubmit: ({ input }) => CindraInject.dispatchEnter(input)
});
