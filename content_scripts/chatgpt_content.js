let promptSubmitted = false;
let isSubmitting = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'insertPrompt') {
    isSubmitting = false;
    promptSubmitted = false;

    const formattedPrompt = message.prompt;
    insertPromptAndSubmit(formattedPrompt);
    sendResponse({ status: 'Processing prompt' });
    return true;
  }
});

// Set prompt text on either a textarea or contenteditable editor while preserving line breaks
function setPromptOnEditor(editor, prompt) {
  const isContentEditable = editor.getAttribute('contenteditable') === 'true';

  if (isContentEditable) {
    editor.innerHTML = '';

    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-word';
    pre.style.margin = '0';
    pre.textContent = prompt;

    editor.appendChild(pre);
  } else {
    editor.value = prompt;
  }
}

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
    '#prompt-textarea',
    'textarea[data-id="root"]',
    'textarea.w-full',
    'div[contenteditable="true"]#prompt-textarea',
    'div[contenteditable="true"].w-full'
  ])
    .then(textarea => {
      textarea.focus();
      setPromptOnEditor(textarea, prompt);

      if (textarea.getAttribute('contenteditable') === 'true') {
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: prompt
        });
        textarea.dispatchEvent(inputEvent);
      } else {
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }

      return new Promise(resolve => setTimeout(() => resolve(textarea), 500));
    })
    .then(textarea => {
      return CindraInject.waitForElement([
        'button[data-testid="send-button"]:not([disabled])',
        'button[type="submit"]:not([disabled])',
        'button.text-white:not([disabled])',
        'button.bg-black:not([disabled])',
        'button.absolute.right-2:not([disabled])',
        'button.absolute.right-1\\.5:not([disabled])'
      ]);
    })
    .then(submitButton => {
      submitButton.click();

      promptSubmitted = true;
      isSubmitting = false;

      chrome.storage.local.remove(['pendingChatGPTPrompt']);
    })
    .catch(error => {
      isSubmitting = false;

      console.error('Error in insertPromptAndSubmit:', error.message);

      try {
        const textarea = document.querySelector('#prompt-textarea') ||
                        document.querySelector('textarea[data-id="root"]') ||
                        document.querySelector('div[contenteditable="true"]');

        if (textarea) {
          textarea.focus();
          setPromptOnEditor(textarea, prompt);

          if (textarea.getAttribute('contenteditable') === 'true') {
            textarea.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: prompt
            }));
          } else {
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
          }

          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });

          textarea.dispatchEvent(enterEvent);

          promptSubmitted = true;

          chrome.storage.local.remove(['pendingChatGPTPrompt']);
        } else {
          console.error('Could not find textarea. Please submit manually.');
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

  chrome.storage.local.get(['pendingChatGPTPrompt', 'chatgptPromptTimestamp'], function(result) {
    if (result.pendingChatGPTPrompt) {
      const currentTime = Date.now();
      const promptTime = result.chatgptPromptTimestamp || 0;
      const twoMinutesInMs = 2 * 60 * 1000;

      if (currentTime - promptTime < twoMinutesInMs) {
        const formattedPrompt = result.pendingChatGPTPrompt;
        insertPromptAndSubmit(formattedPrompt);
      } else {
        chrome.storage.local.remove(['pendingChatGPTPrompt', 'chatgptPromptTimestamp']);
      }
    }
  });
}

setTimeout(checkForPendingPrompts, 2000);
