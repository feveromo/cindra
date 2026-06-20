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
    'div.tiptap.ProseMirror[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"].tiptap',
    'div[contenteditable="true"]',
    'textarea[dir="auto"]'
  ])
    .then(inputEl => {
      const isEditableDiv = inputEl.getAttribute && inputEl.getAttribute('contenteditable') === 'true';

      if (isEditableDiv) {
        // Preserve line breaks while writing into Grok's ProseMirror editor.
        inputEl.innerHTML = '';
        inputEl.focus();

        const pre = document.createElement('pre');
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.wordBreak = 'break-word';
        pre.style.margin = '0';
        pre.appendChild(document.createTextNode(prompt));
        inputEl.appendChild(pre);

        try {
          inputEl.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: prompt
          }));
        } catch (_) {}
        try {
          inputEl.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: prompt
          }));
        } catch (_) {
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } else {
        CindraInject.insertTextIntoTextarea(inputEl, prompt);
      }

      return new Promise(resolve => setTimeout(resolve, 600));
    })
    .then(() => {
      return CindraInject.waitForElement([
        'button[aria-label="Submit"]:not([disabled])',
        'button[type="submit"]:not([disabled])'
      ], 1500).catch(() => null);
    })
    .then(submitButton => {
      if (submitButton) {
        submitButton.click();
      } else {
        const editor = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea[dir="auto"]');
        if (editor) {
          editor.focus();
          const keydown = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });
          const keyup = new KeyboardEvent('keyup', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true
          });
          editor.dispatchEvent(keydown);
          editor.dispatchEvent(keyup);
        } else {
          console.warn('No editor found to dispatch Enter');
        }
      }

      promptSubmitted = true;
      isSubmitting = false;

      chrome.storage.local.remove(['pendingGrokPrompt', 'grokPromptTimestamp']);
    })
    .catch(error => {
      isSubmitting = false;

      console.error('Error in insertPromptAndSubmit:', error.message);

      try {
        const editor = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea[dir="auto"]');

        if (editor) {
          if (editor.getAttribute && editor.getAttribute('contenteditable') === 'true') {
            editor.innerHTML = '';
            const pre = document.createElement('pre');
            pre.style.whiteSpace = 'pre-wrap';
            pre.style.wordBreak = 'break-word';
            pre.style.margin = '0';
            pre.appendChild(document.createTextNode(prompt));
            editor.appendChild(pre);
            try {
              editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
            } catch (_) {
              editor.dispatchEvent(new Event('input', { bubbles: true }));
            }
          } else {
            editor.value = prompt;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
          }

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

          chrome.storage.local.remove(['pendingGrokPrompt', 'grokPromptTimestamp']);
        } else {
          console.error('Could not find input field. Please submit manually.');
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

  chrome.storage.local.get(['pendingGrokPrompt', 'grokPromptTimestamp'], function(result) {
    if (result.pendingGrokPrompt) {
      const currentTime = Date.now();
      const promptTime = result.grokPromptTimestamp || 0;
      const twoMinutesInMs = 2 * 60 * 1000;

      if (currentTime - promptTime < twoMinutesInMs) {
        insertPromptAndSubmit(result.pendingGrokPrompt);
      } else {
        chrome.storage.local.remove(['pendingGrokPrompt', 'grokPromptTimestamp']);
      }
    }
  });
}

setTimeout(checkForPendingPrompts, 2000);
