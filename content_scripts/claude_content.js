function insertTextIntoClaudeEditor(editor, prompt) {
  editor.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);

  if (!document.execCommand('insertText', false, prompt)) {
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', prompt);
      editor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
      }));
    } catch (error) {
      CindraInject.insertTextIntoContentEditable(editor, prompt, { mode: 'paragraph' });
      return;
    }
  }

  CindraInject.dispatchTextInput(editor, prompt);
}

CindraProviderRuntime.registerAdapter({
  providerId: 'claude',
  inputSelectors: [
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"]#prompt-textarea',
    'div[contenteditable="true"].w-full'
  ],
  insertPrompt: insertTextIntoClaudeEditor,
  settleDelayMs: 300,
  submitSelectors: 'button[aria-label="Send message"]:not(:disabled):not([aria-disabled="true"])',
  submitTimeoutMs: 2500,
  fallbackSubmit: ({ input }) => CindraInject.pressEnter(input, {
    eventTypes: ['keydown']
  })
});
