function insertTextIntoClaudeEditor(editor, prompt) {
  editor.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);

  if (!document.execCommand('insertText', false, prompt)) {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', prompt);
    editor.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer
    }));
  }

  editor.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: prompt
  }));
}

async function insertPromptAndSubmit(prompt) {
  if (!prompt) throw new Error('No prompt provided');

  const editor = await CindraInject.waitForElement([
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"]#prompt-textarea',
    'div[contenteditable="true"].w-full'
  ]);
  insertTextIntoClaudeEditor(editor, prompt);
  await new Promise(resolve => setTimeout(resolve, 300));

  const submitButton = await CindraInject.waitForElement(
    'button[aria-label="Send message"]:not(:disabled):not([aria-disabled="true"])',
    2500
  ).catch(() => null);

  if (submitButton) {
    CindraInject.robustClick(submitButton);
    return;
  }

  editor.focus();
  editor.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  }));
}

CindraProviderRuntime.register({
  providerId: 'claude',
  startupDelayMs: 1000,
  legacyKeys: {
    prompt: 'pendingClaudePrompt',
    timestamp: 'claudePromptTimestamp'
  },
  submitPrompt: insertPromptAndSubmit
});
