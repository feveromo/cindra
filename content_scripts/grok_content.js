function insertTextIntoGrokEditor(editor, prompt) {
  const isContentEditable = editor.getAttribute?.('contenteditable') === 'true';
  if (!isContentEditable) {
    CindraInject.insertTextIntoTextarea(editor, prompt);
    return;
  }

  editor.innerHTML = '';
  editor.focus();
  const paragraph = document.createElement('p');
  paragraph.style.whiteSpace = 'pre-wrap';
  paragraph.textContent = prompt;
  editor.appendChild(paragraph);

  try {
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: prompt
    }));
  } catch (error) {
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function submitGrokWithEnter(editor) {
  editor.focus();
  ['keydown', 'keyup'].forEach(type => {
    editor.dispatchEvent(new KeyboardEvent(type, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    }));
  });
}

async function insertPromptAndSubmit(prompt) {
  if (!prompt) throw new Error('No prompt provided');

  const editor = await CindraInject.waitForElement([
    'div.tiptap.ProseMirror[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"].tiptap',
    'textarea[dir="auto"]'
  ]);
  insertTextIntoGrokEditor(editor, prompt);
  await new Promise(resolve => setTimeout(resolve, 600));

  const submitButton = await CindraInject.waitForElement([
    'button[aria-label="Submit"]:not([disabled])',
    'button[type="submit"]:not([disabled])'
  ], 2000).catch(() => null);

  if (submitButton) {
    CindraInject.robustClick(submitButton);
    return;
  }

  submitGrokWithEnter(editor);
}

CindraProviderRuntime.register({
  providerId: 'grok',
  startupDelayMs: 1000,
  legacyKeys: {
    prompt: 'pendingGrokPrompt',
    timestamp: 'grokPromptTimestamp'
  },
  submitPrompt: insertPromptAndSubmit
});
