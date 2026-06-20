let promptSubmitted = false;
let isSubmitting = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'insertPrompt') {
    isSubmitting = false;
    promptSubmitted = false;

    insertPromptAndSubmit(message.prompt);
    sendResponse({ status: 'Processing prompt' });
    return true;
  }
});

function insertPromptAndSubmit(prompt) {
  if (!prompt) {
    console.warn('Received empty prompt, not inserting');
    return;
  }

  if (isSubmitting || promptSubmitted) {
    return;
  }

  isSubmitting = true;

  CindraInject.waitForElement([
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"]#prompt-textarea',
    'div[contenteditable="true"].w-full'
  ])
    .then(editor => {
      editor.focus();

      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);

      // ProseMirror needs input-style mutations so its internal state stays in sync.
      const inserted = document.execCommand('insertText', false, prompt);

      if (!inserted) {
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', prompt);

        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer
        });

        editor.dispatchEvent(pasteEvent);
      }

      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: prompt
      }));

      return new Promise(resolve => setTimeout(() => resolve(editor), 300));
    })
    .then(editor => {
      return CindraInject.waitForElement(
        'button[aria-label="Send message"]:not(:disabled)'
      );
    })
    .then(submitButton => {
      submitButton.click();

      promptSubmitted = true;
      isSubmitting = false;

      chrome.storage.local.remove(['pendingClaudePrompt']);
    })
    .catch(error => {
      isSubmitting = false;

      console.error('Error in insertPromptAndSubmit:', error.message);

      try {
        const editor = document.querySelector('div[contenteditable="true"]');

        if (editor) {
          editor.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);

          document.execCommand('insertText', false, prompt);

          editor.focus();
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });

          editor.dispatchEvent(enterEvent);

          promptSubmitted = true;

          chrome.storage.local.remove(['pendingClaudePrompt']);
        } else {
          console.error('Could not find editor. Please submit manually.');
        }
      } catch (e) {
        console.error('Alternative method failed:', e);
        console.error('All submission methods failed. Please submit manually.');
      }
    });
}

function checkForPendingPrompts() {
  if (isSubmitting || promptSubmitted) {
    return;
  }

  chrome.storage.local.get(['pendingClaudePrompt', 'claudePromptTimestamp'], function (result) {
    if (result.pendingClaudePrompt) {
      const currentTime = Date.now();
      const promptTime = result.claudePromptTimestamp || 0;
      const twoMinutesInMs = 2 * 60 * 1000;

      if (currentTime - promptTime < twoMinutesInMs) {
        insertPromptAndSubmit(result.pendingClaudePrompt);
      } else {
        chrome.storage.local.remove(['pendingClaudePrompt', 'claudePromptTimestamp']);
      }
    }
  });
}

setTimeout(checkForPendingPrompts, 2000);
