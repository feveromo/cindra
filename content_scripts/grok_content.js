console.log('Grok content script loaded');

let promptSubmitted = false;
let isSubmitting = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in Grok content script:', message);

  if (message.action === 'insertPrompt') {
    isSubmitting = false;
    promptSubmitted = false;

    insertPromptAndSubmit(message.prompt, message.title);
    sendResponse({ status: 'Processing prompt' });
    return true;
  }
});

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

  console.log('Attempting to insert prompt into Grok');

  waitForElement([
    'div.tiptap.ProseMirror[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"].tiptap',
    'div[contenteditable="true"]',
    'textarea[dir="auto"]'
  ])
    .then(inputEl => {
      console.log('Input element found:', inputEl);

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

        console.log('Content inserted into ProseMirror, length:', (inputEl.textContent || '').length);
      } else {
        inputEl.value = '';
        inputEl.focus();
        inputEl.value = prompt;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));

        console.log('Content inserted into textarea, length:', inputEl.value.length);
      }

      return new Promise(resolve => setTimeout(resolve, 600));
    })
    .then(() => {
      return waitForElement([
        'button[aria-label="Submit"]:not([disabled])',
        'button[type="submit"]:not([disabled])'
      ], 1500).catch(() => null);
    })
    .then(submitButton => {
      if (submitButton) {
        console.log('Submit button found, clicking:', submitButton);
        submitButton.click();
      } else {
        console.log('Submit button not found; attempting Enter key submit');
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

      chrome.storage.local.remove(['pendingGrokPrompt', 'pendingGrokTitle', 'grokPromptTimestamp']);

      console.log('Prompt submitted to Grok');
    })
    .catch(error => {
      isSubmitting = false;

      console.error('Error in insertPromptAndSubmit:', error.message);

      try {
        console.log('Trying Enter key method');
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
          console.log('Enter key simulated');

          promptSubmitted = true;

          chrome.storage.local.remove(['pendingGrokPrompt', 'pendingGrokTitle', 'grokPromptTimestamp']);

          console.log('Prompt submitted with alternative method');
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

  console.log('Checking for pending prompts for Grok');

  chrome.storage.local.get(['pendingGrokPrompt', 'pendingGrokTitle', 'grokPromptTimestamp'], function(result) {
    if (result.pendingGrokPrompt) {
      const currentTime = Date.now();
      const promptTime = result.grokPromptTimestamp || 0;
      const twoMinutesInMs = 2 * 60 * 1000;

      if (currentTime - promptTime < twoMinutesInMs) {
        console.log('Found fresh pending prompt for Grok, inserting');
        insertPromptAndSubmit(result.pendingGrokPrompt, result.pendingGrokTitle);
      } else {
        console.log('Found stale pending prompt for Grok, ignoring');
        chrome.storage.local.remove(['pendingGrokPrompt', 'pendingGrokTitle', 'grokPromptTimestamp']);
      }
    }
  });
}

setTimeout(checkForPendingPrompts, 2000);
