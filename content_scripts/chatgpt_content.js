function setPromptOnChatGptEditor(editor, prompt) {
  const isContentEditable = editor.getAttribute('contenteditable') === 'true';
  editor.focus();

  if (isContentEditable) {
    editor.innerHTML = '';
    const paragraph = document.createElement('p');
    paragraph.style.whiteSpace = 'pre-wrap';
    paragraph.textContent = prompt;
    editor.appendChild(paragraph);
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: prompt
    }));
    return;
  }

  CindraInject.insertTextIntoTextarea(editor, prompt);
}

function submitChatGptWithEnter(editor) {
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

async function insertPromptAndSubmit(prompt) {
  if (!prompt) throw new Error('No prompt provided');

  const editor = await CindraInject.waitForElement([
    '#prompt-textarea',
    'textarea[data-id="root"]',
    'textarea.w-full',
    'div[contenteditable="true"]#prompt-textarea',
    'div[contenteditable="true"].w-full'
  ]);
  setPromptOnChatGptEditor(editor, prompt);
  await new Promise(resolve => setTimeout(resolve, 500));

  const submitButton = await CindraInject.waitForElement([
    'button[data-testid="send-button"]:not([disabled])',
    'button[type="submit"]:not([disabled])',
    'button[aria-label*="Send" i]:not([disabled])'
  ], 2500).catch(() => null);

  if (submitButton) {
    CindraInject.robustClick(submitButton);
    return;
  }

  submitChatGptWithEnter(editor);
}

CindraProviderRuntime.register({
  providerId: 'chatgpt',
  startupDelayMs: 1000,
  legacyKeys: {
    prompt: 'pendingChatGPTPrompt',
    timestamp: 'chatgptPromptTimestamp'
  },
  submitPrompt: insertPromptAndSubmit
});
