console.log('Perplexity content script loaded');

let promptSubmitted = false;
let isSubmitting = false;

function isPageReady() {
  const selectors = [
    '#ask-input',
    'div[contenteditable="true"][role="textbox"]',
    'div[data-lexical-editor="true"]',
    'textarea[placeholder="Ask anything..."]',
    '.rounded-3xl textarea',
    'textarea.resize-none'
  ];
  for (const selector of selectors) {
    if (document.querySelector(selector)) {
      return true;
    }
  }
  return false;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in Perplexity content script:', message);

  if (message.action === 'insertPrompt') {
    if (isSubmitting || promptSubmitted) {
      console.log('Submission already in progress or completed, ignoring message listener trigger.');
      sendResponse({ status: 'Submission already handled' });
      return true;
    }

    // Keep the current flags so duplicate listener calls do not restart submission.

    if (isPageReady()) {
      insertPromptAndSubmit(message.prompt, message.title);
      sendResponse({ status: 'Processing prompt' });
    } else {
      console.log('Waiting for page to be ready...');
      waitForPageReady().then(() => {
        insertPromptAndSubmit(message.prompt, message.title);
      });
      sendResponse({ status: 'Will process when page is ready' });
    }
    return true;
  }
});

function waitForPageReady(timeout = 10000) {
  if (isPageReady()) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const checkInterval = setInterval(() => {
      if (isPageReady()) {
        clearInterval(checkInterval);
        resolve();
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error('Timeout waiting for page to be ready'));
      }
    }, 100);
  });
}

function waitForElement(selectors, timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (typeof selectors === 'string') {
      selectors = [selectors];
    }

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        console.log(`Element found immediately: ${selector}`);
        return resolve(element);
      }
    }

    console.log(`Waiting for elements: ${selectors.join(', ')}`);

    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          clearInterval(checkInterval);
          console.log(`Element found: ${selector}`);
          resolve(element);
          return;
        }
      }

      if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error(`Timeout waiting for elements: ${selectors.join(', ')}`));
      }
    }, 50);
  });
}

function findInputArea() {
  console.log('Trying to find Perplexity input area...');

  const selectors = [
    '#ask-input',
    'div[contenteditable="true"][role="textbox"]',
    'div[data-lexical-editor="true"]',
    'textarea[placeholder="Ask anything..."]',
    'textarea.resize-none',
  ];

  return waitForElement(selectors);
}

function findSubmitButton() {
  console.log('Trying to find Perplexity submit button...');

  const allButtons = document.querySelectorAll('button');
  console.log(`Found ${allButtons.length} buttons on the page:`);
  allButtons.forEach((btn, index) => {
    console.log(`Button ${index}:`, {
      text: btn.textContent?.trim(),
      ariaLabel: btn.getAttribute('aria-label'),
      dataTestId: btn.getAttribute('data-testid'),
      className: btn.className,
      disabled: btn.disabled,
      type: btn.getAttribute('type')
    });
  });

  const submitButton = document.querySelector('button[data-testid="submit-button"]');
  if (submitButton && !submitButton.disabled) {
    console.log('Found submit button by data-testid');
    return Promise.resolve(submitButton);
  }

  const submitButtons = document.querySelectorAll('button[aria-label="Submit"]');
  for (const button of submitButtons) {
    if (!button.disabled && button.getAttribute('aria-label') === 'Submit') {
      console.log('Found submit button by aria-label="Submit"');
      return Promise.resolve(button);
    }
  }

  const arrowButtons = document.querySelectorAll('button svg.tabler-icon-arrow-right');
  for (const svg of arrowButtons) {
    const button = svg.closest('button');
    if (button && !button.disabled && button.getAttribute('aria-label') !== 'Voice mode') {
      console.log('Found submit button by arrow icon (not voice)');
      return Promise.resolve(button);
    }
  }

  const superButtons = document.querySelectorAll('button.bg-super');
  for (const button of superButtons) {
    if (!button.disabled && button.getAttribute('aria-label') !== 'Voice mode') {
      console.log('Found submit button by bg-super class (not voice)');
      return Promise.resolve(button);
    }
  }

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const timeout = 10000;

    const checkInterval = setInterval(() => {
      const submitButton = document.querySelector('button[data-testid="submit-button"]');
      if (submitButton && !submitButton.disabled) {
        clearInterval(checkInterval);
        console.log('Found submit button by data-testid (waited)');
        resolve(submitButton);
        return;
      }

      const submitButtons = document.querySelectorAll('button[aria-label="Submit"]');
      for (const button of submitButtons) {
        if (!button.disabled && button.getAttribute('aria-label') === 'Submit') {
          clearInterval(checkInterval);
          console.log('Found submit button by aria-label (waited)');
          resolve(button);
          return;
        }
      }

      const arrowButtons = document.querySelectorAll('button svg.tabler-icon-arrow-right');
      for (const svg of arrowButtons) {
        const button = svg.closest('button');
        if (button && !button.disabled && button.getAttribute('aria-label') !== 'Voice mode') {
          clearInterval(checkInterval);
          console.log('Found submit button by arrow icon (waited)');
          resolve(button);
          return;
        }
      }

      if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error('Submit button not found within timeout'));
      }
    }, 200);
  });
}

function insertTextIntoContentEditable(element, text) {
  console.log('Inserting text into contenteditable element:', element);

  element.focus();

  element.innerHTML = '';

  // Perplexity's rich editor tracks execCommand input more reliably than textContent alone.
  document.execCommand('insertText', false, text);

  if (!element.textContent || element.textContent.trim() === '') {
    element.textContent = text;
  }

  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));

  element.focus();

  console.log('Text content after insertion:', element.textContent);
  console.log('InnerHTML after insertion:', element.innerHTML);
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

  console.log('Setting isSubmitting = true');
  isSubmitting = true;

  console.log('Attempting to insert prompt into Perplexity');

  findInputArea()
    .then(inputArea => {
      console.log('[SUCCESS] Input area found:', inputArea);

      console.log('Focusing input area...');
      inputArea.focus();

      console.log('Setting input area value...');
      if (inputArea.tagName === 'TEXTAREA') {
        inputArea.value = prompt;
        inputArea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        inputArea.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        console.log('Input area is contenteditable, using insertTextIntoContentEditable');
        console.log('Prompt to insert:', prompt);
        insertTextIntoContentEditable(inputArea, prompt);
      }

      console.log('Input area value set to:', (inputArea.value || inputArea.textContent || inputArea.innerText).substring(0, 100) + '...');
      console.log('Input area innerHTML:', inputArea.innerHTML.substring(0, 100) + '...');

      console.log('Refocusing input area...');
      inputArea.focus();

      console.log('Content insertion steps complete. Waiting before finding button...');

      return new Promise(resolve => setTimeout(() => resolve(inputArea), 2000));
    })
    .then((inputArea) => {
      console.log('Looking for submit button...');
      const checkForButton = (attempts = 0, maxAttempts = 15) => {
        return findSubmitButton()
          .then(submitButton => {
            console.log('[SUCCESS] Submit button found, clicking:', submitButton);

            submitButton.click();

            console.log('Setting promptSubmitted = true, isSubmitting = false after click');
            promptSubmitted = true;
            isSubmitting = false;

            console.log('Clearing pending prompt from storage after successful submission.');
            chrome.storage.local.remove(['pendingPerplexityPrompt', 'pendingPerplexityTitle']);

            console.log('Prompt submitted to Perplexity successfully.');
          })
          .catch(error => {
            console.log(`Submit button not found on attempt ${attempts + 1}/${maxAttempts}.`);
            if (attempts < maxAttempts) {
              return new Promise(resolve => setTimeout(() => resolve(checkForButton(attempts + 1, maxAttempts)), 500));
            } else {
              console.error('[FAIL] Submit button not found after multiple attempts.');
              throw new Error('Submit button timeout');
            }
          });
      };

      return checkForButton();
    })
    .catch(error => {
      console.error('[ERROR] Caught error in insertPromptAndSubmit main chain:', error.message);
      console.log('Setting isSubmitting = false in main catch block.');
      isSubmitting = false;

      console.log('Attempting Enter key fallback...');
      try {
        const potentialInputArea = document.querySelector('#ask-input') ||
                                 document.querySelector('div[contenteditable="true"]') ||
                                 document.querySelector('textarea[placeholder="Ask anything..."]');

        if (potentialInputArea) {
          console.log('[FALLBACK] Found input area for fallback:', potentialInputArea);
          console.log('[FALLBACK] Setting input area value...');
          if (potentialInputArea.tagName === 'TEXTAREA') {
            potentialInputArea.value = prompt;
            potentialInputArea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          } else {
            insertTextIntoContentEditable(potentialInputArea, prompt);
          }

          console.log('[FALLBACK] Focusing and simulating Enter key...');
          potentialInputArea.focus();
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });

          potentialInputArea.dispatchEvent(enterEvent);
          console.log('[FALLBACK SUCCESS] Enter key simulated.');

          console.log('[FALLBACK] Setting promptSubmitted = true, isSubmitting = false after fallback success');
          promptSubmitted = true;
          isSubmitting = false;

          console.log('[FALLBACK] Clearing pending prompt from storage after fallback success.');
          chrome.storage.local.remove(['pendingPerplexityPrompt', 'pendingPerplexityTitle']);
        } else {
          console.error('[FALLBACK FAIL] Could not find input area for fallback.');
          isSubmitting = false;
        }
      } catch (e) {
        console.error('[FALLBACK FAIL] Error during Enter key fallback:', e);
        isSubmitting = false;
      }
    });
}

function checkForPendingPrompts() {
  console.log('Resetting isSubmitting and promptSubmitted flags in checkForPendingPrompts');
  isSubmitting = false;
  promptSubmitted = false;

  if (isSubmitting || promptSubmitted) {
    return;
  }

  console.log('Checking for pending prompts for Perplexity');

  chrome.storage.local.get(['pendingPerplexityPrompt', 'pendingPerplexityTitle', 'perplexityPromptTimestamp'], function(result) {
    if (result.pendingPerplexityPrompt) {
      const currentTime = Date.now();
      const promptTime = result.perplexityPromptTimestamp || 0;
      const twoMinutesInMs = 2 * 60 * 1000;

      if (currentTime - promptTime < twoMinutesInMs) {
        console.log('Found fresh pending prompt for Perplexity, processing...');
        const promptToProcess = result.pendingPerplexityPrompt;
        const titleToProcess = result.pendingPerplexityTitle;

        // Claim the prompt before submit so reloads do not send it twice.
        chrome.storage.local.remove(['pendingPerplexityPrompt', 'pendingPerplexityTitle', 'perplexityPromptTimestamp'], () => {
          console.log('Cleared pending prompt from storage before processing.');
          insertPromptAndSubmit(promptToProcess, titleToProcess);
        });
      } else {
        console.log('Found stale pending prompt for Perplexity, ignoring and clearing.');
        chrome.storage.local.remove(['pendingPerplexityPrompt', 'pendingPerplexityTitle', 'perplexityPromptTimestamp']);
      }
    } else {
    }
  });
}

if (isPageReady()) {
  checkForPendingPrompts();
} else {
  const readyCheckInterval = setInterval(() => {
    if (isPageReady()) {
      clearInterval(readyCheckInterval);
      checkForPendingPrompts();
    }
  }, 100);

  // Backup timer covers Perplexity route changes that do not expose the input quickly.
  setTimeout(() => {
    clearInterval(readyCheckInterval);
    checkForPendingPrompts();
  }, 2000);
}
