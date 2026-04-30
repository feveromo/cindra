console.log('ChatGPT content script loaded');

let promptSubmitted = false;
let isSubmitting = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in ChatGPT content script:', message);

  if (message.action === 'insertPrompt') {
    isSubmitting = false;
    promptSubmitted = false;

    const formattedPrompt = formatPromptForChatGPT(message.prompt);
    insertPromptAndSubmit(formattedPrompt, message.title);
    sendResponse({ status: 'Processing prompt' });
    return true;
  }
});

function formatPromptForChatGPT(prompt) {
  return prompt;
}

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

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (Array.isArray(selector)) {
      for (const sel of selector) {
        const element = document.querySelector(sel);
        if (element) {
          console.log(`Element found immediately: ${sel}`);
          return resolve(element);
        }
      }

      console.log(`Waiting for elements: ${selector.join(', ')}`);

      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        for (const sel of selector) {
          const element = document.querySelector(sel);
          if (element) {
            clearInterval(checkInterval);
            console.log(`Element found: ${sel}`);
            resolve(element);
            return;
          }
        }

        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          reject(new Error(`Timeout waiting for elements: ${selector.join(', ')}`));
        }
      }, 100);
      return;
    }

    const element = document.querySelector(selector);
    if (element) {
      console.log(`Element found immediately: ${selector}`);
      return resolve(element);
    }

    console.log(`Waiting for element: ${selector}`);

    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      const element = document.querySelector(selector);
      if (element) {
        clearInterval(checkInterval);
        console.log(`Element found: ${selector}`);
        resolve(element);
        return;
      }

      if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error(`Timeout waiting for element: ${selector}`));
      }
    }, 100);
  });
}

function insertPromptAndSubmit(prompt, title) {
  if (!prompt) {
    console.warn('Received empty prompt, not inserting');
    return;
  }

  if (isSubmitting || promptSubmitted) {
    console.log('Already submitting or submitted, ignoring duplicate call');
    return;
  }

  isSubmitting = true;

  console.log('Attempting to insert prompt into ChatGPT');

  waitForElement([
    '#prompt-textarea',
    'textarea[data-id="root"]',
    'textarea.w-full',
    'div[contenteditable="true"]#prompt-textarea',
    'div[contenteditable="true"].w-full'
  ])
    .then(textarea => {
      console.log('Textarea found:', textarea);

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

      console.log('Content inserted');

      return new Promise(resolve => setTimeout(() => resolve(textarea), 500));
    })
    .then(textarea => {
      return waitForElement([
        'button[data-testid="send-button"]:not([disabled])',
        'button[type="submit"]:not([disabled])',
        'button.text-white:not([disabled])',
        'button.bg-black:not([disabled])',
        'button.absolute.right-2:not([disabled])',
        'button.absolute.right-1\\.5:not([disabled])'
      ]);
    })
    .then(submitButton => {
      console.log('Submit button found, clicking:', submitButton);

      submitButton.click();

      promptSubmitted = true;
      isSubmitting = false;

      chrome.storage.local.remove(['pendingChatGPTPrompt', 'pendingChatGPTTitle']);

      console.log('Prompt submitted to ChatGPT');
    })
    .catch(error => {
      isSubmitting = false;

      console.error('Error in insertPromptAndSubmit:', error.message);

      try {
        console.log('Trying Enter key method');
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
          console.log('Enter key simulated');

          promptSubmitted = true;

          chrome.storage.local.remove(['pendingChatGPTPrompt', 'pendingChatGPTTitle']);

          console.log('Prompt submitted with alternative method');
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

  console.log('Checking for pending prompts for ChatGPT');

  chrome.storage.local.get(['pendingChatGPTPrompt', 'pendingChatGPTTitle', 'chatgptPromptTimestamp'], function(result) {
    if (result.pendingChatGPTPrompt) {
      const currentTime = Date.now();
      const promptTime = result.chatgptPromptTimestamp || 0;
      const twoMinutesInMs = 2 * 60 * 1000;

      if (currentTime - promptTime < twoMinutesInMs) {
        console.log('Found fresh pending prompt for ChatGPT, inserting');
        const formattedPrompt = formatPromptForChatGPT(result.pendingChatGPTPrompt);
        insertPromptAndSubmit(formattedPrompt, result.pendingChatGPTTitle);
      } else {
        console.log('Found stale pending prompt for ChatGPT, ignoring');
        chrome.storage.local.remove(['pendingChatGPTPrompt', 'pendingChatGPTTitle', 'chatgptPromptTimestamp']);
      }
    }
  });
}

setTimeout(checkForPendingPrompts, 2000);
