console.log('Claude content script loaded');

let promptSubmitted = false;
let isSubmitting = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in Claude content script:', message);

  if (message.action === 'insertPrompt') {
    isSubmitting = false;
    promptSubmitted = false;

    const formattedPrompt = formatPromptForClaude(message.prompt);
    insertPromptAndSubmit(formattedPrompt, message.title);
    sendResponse({ status: 'Processing prompt' });
    return true;
  }
});

function formatPromptForClaude(prompt) {
  return prompt;
}

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
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

  console.log('Attempting to insert prompt into Claude');

  waitForElement([
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"]#prompt-textarea',
    'div[contenteditable="true"].w-full'
  ])
    .then(editor => {
      console.log('Editor found:', editor);

      editor.focus();

      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);

      // ProseMirror needs input-style mutations so its internal state stays in sync.
      const inserted = document.execCommand('insertText', false, prompt);

      if (!inserted) {
        console.log('execCommand failed, trying clipboard paste method');

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

      console.log('Content inserted, content length:', editor.textContent.length);

      return new Promise(resolve => setTimeout(() => resolve(editor), 300));
    })
    .then(editor => {
      return waitForElement(
        'button[aria-label="Send message"]:not(:disabled)'
      );
    })
    .then(submitButton => {
      console.log('Submit button found, clicking:', submitButton);

      submitButton.click();

      promptSubmitted = true;
      isSubmitting = false;

      chrome.storage.local.remove(['pendingClaudePrompt', 'pendingClaudeTitle']);

      console.log('Prompt submitted to Claude');
    })
    .catch(error => {
      isSubmitting = false;

      console.error('Error in insertPromptAndSubmit:', error.message);

      try {
        console.log('Trying Enter key method');
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
          console.log('Enter key simulated');

          promptSubmitted = true;

          chrome.storage.local.remove(['pendingClaudePrompt', 'pendingClaudeTitle']);

          console.log('Prompt submitted with alternative method');
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

  console.log('Checking for pending prompts for Claude');

  chrome.storage.local.get(['pendingClaudePrompt', 'pendingClaudeTitle', 'claudePromptTimestamp'], function (result) {
    if (result.pendingClaudePrompt) {
      const currentTime = Date.now();
      const promptTime = result.claudePromptTimestamp || 0;
      const twoMinutesInMs = 2 * 60 * 1000;

      if (currentTime - promptTime < twoMinutesInMs) {
        console.log('Found fresh pending prompt for Claude, inserting');
        const formattedPrompt = formatPromptForClaude(result.pendingClaudePrompt);
        insertPromptAndSubmit(formattedPrompt, result.pendingClaudeTitle);
      } else {
        console.log('Found stale pending prompt for Claude, ignoring');
        chrome.storage.local.remove(['pendingClaudePrompt', 'pendingClaudeTitle', 'claudePromptTimestamp']);
      }
    }
  });
}

setTimeout(checkForPendingPrompts, 2000);
