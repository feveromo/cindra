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
  if (message.action === 'insertPrompt') {
    if (isSubmitting || promptSubmitted) {
      sendResponse({ status: 'Submission already handled' });
      return true;
    }

    // Keep the current flags so duplicate listener calls do not restart submission.

    if (isPageReady()) {
      insertPromptAndSubmit(message.prompt);
      sendResponse({ status: 'Processing prompt' });
    } else {
      waitForPageReady().then(() => {
        insertPromptAndSubmit(message.prompt);
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

function findInputArea() {
  const selectors = [
    '#ask-input',
    'div[contenteditable="true"][role="textbox"]',
    'div[data-lexical-editor="true"]',
    'textarea[placeholder="Ask anything..."]',
    'textarea.resize-none',
  ];

  return CindraInject.waitForElement(selectors);
}

// Perplexity frequently redesigns the ask bar, so matching by volatile class
// names breaks. Match stable signals in order: explicit submit testids, then
// aria-label "Submit"/"Send", then send/arrow icons (excluding known
// non-submit controls like voice/dictation/model). Returns null on timeout
// rather than rejecting so the caller can fall back to the Enter-key submit.
function findSubmitButton() {
  const NON_SUBMIT_LABELS = ['Voice mode', 'Use voice mode', 'Dictation', 'Model', 'Add files or tools'];

  function findNow() {
    const byTestid = document.querySelector(
      'button[data-testid="submit-button"], button[data-testid="composer-submit-button"]'
    );
    if (byTestid && !byTestid.disabled && !byTestid.getAttribute('aria-disabled')) {
      return byTestid;
    }

    const byAria = document.querySelectorAll('button[aria-label="Submit"], button[aria-label="Send"]');
    for (const button of byAria) {
      if (!button.disabled) {
        return button;
      }
    }

    // Send/arrow icons referenced by Perplexity's icon sprite.
    const sendIcons = document.querySelectorAll(
      'button svg use[*|href="#pplx-icon-arrow-up"], button svg use[xlink\\:href="#pplx-icon-arrow-up"],' +
      'button svg.tabler-icon-arrow-right, button svg use[*|href="#pplx-icon-send"],' +
      'button svg use[xlink\\:href="#pplx-icon-send"]'
    );
    for (const svg of sendIcons) {
      const button = svg.closest('button');
      if (button && !button.disabled && !NON_SUBMIT_LABELS.includes(button.getAttribute('aria-label'))) {
        return button;
      }
    }

    return null;
  }

  const immediate = findNow();
  if (immediate) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    const startTime = Date.now();
    const timeout = 2500;

    const checkInterval = setInterval(() => {
      const button = findNow();
      if (button) {
        clearInterval(checkInterval);
        resolve(button);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        resolve(null);
      }
    }, 200);
  });
}

// Enter on the ask-input contenteditable submits the query in Perplexity's UI.
// Used as the selector-independent fallback when no submit button can be found.
function submitViaEnter() {
  const inputArea = document.querySelector('#ask-input') ||
    document.querySelector('div[contenteditable="true"][role="textbox"]') ||
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector('textarea[placeholder="Ask anything..."]');
  if (!inputArea) {
    console.error('[FALLBACK FAIL] Could not find input area for Enter submit.');
    return;
  }

  inputArea.focus();
  ['keydown', 'keypress', 'keyup'].forEach(type => {
    inputArea.dispatchEvent(new KeyboardEvent(type, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    }));
  });
}

// Perplexity's #ask-input is a Lexical-based contenteditable, but Perplexity's
// build does NOT expose the __lexicalEditor instance on the element, so the
// instance API can't be driven. What works: writing the text into the DOM and
// dispatching a synthetic input event — Perplexity's React layer observes that
// and ingests the value into its editor state. Multiline text is rendered as
// <div>per-line blocks to match how the editor expects block content.
function setEditorText(element, text) {
  // Normalize CRLF/CR to LF so carriage returns don't bleed into the editor.
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const fragment = document.createDocumentFragment();
  for (const line of lines) {
    const div = document.createElement('div');
    if (line.length) {
      div.textContent = line;
    } else {
      div.appendChild(document.createElement('br'));
    }
    fragment.appendChild(div);
  }

  element.focus();
  element.replaceChildren(fragment);

  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    composed: true,
    inputType: 'insertText',
    data: text
  }));
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.focus();
}

function insertTextIntoContentEditable(element, text) {
  // Perplexity's editor re-renders the DOM asynchronously from its React/Lexical
  // state, so reading element.textContent right after writing it is racy (React
  // may have reverted it to empty on its own commit cycle). The proven-working
  // mechanism is: write block content into the DOM, then fire input/change so
  // Perplexity's React layer ingests the value. Don't try to verify synchronously
  // — a false-negative there only produces spurious errors. The submit phase will
  // surface a real failure if no text is present (no enabled submit button, and
  // the Enter fallback fires).
  setEditorText(element, text);
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

  findInputArea()
    .then(inputArea => {
      inputArea.focus();

      if (inputArea.tagName === 'TEXTAREA') {
        inputArea.value = prompt;
        inputArea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        inputArea.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        insertTextIntoContentEditable(inputArea, prompt);
      }

      inputArea.focus();

      return new Promise(resolve => setTimeout(() => resolve(inputArea), 1000));
    })
    .then(() => {
      // findSubmitButton resolves null when no matching control appears
      // (Perplexity redesigned the bar). Give it a short window, then submit
      // via Enter on the contenteditable, which Perplexity always honors.
      const checkForButton = (attempts = 0, maxAttempts = 6) => {
        return findSubmitButton()
          .then(submitButton => {
            if (submitButton) {
              submitButton.click();
            } else if (attempts < maxAttempts) {
              return new Promise(resolve => setTimeout(() => resolve(checkForButton(attempts + 1, maxAttempts)), 500));
            } else {
              submitViaEnter();
            }

            promptSubmitted = true;
            isSubmitting = false;

            chrome.storage.local.remove(['pendingPerplexityPrompt']);
          });
      };

      return checkForButton();
    })
    .catch(error => {
      console.error('[ERROR] Caught error in insertPromptAndSubmit main chain:', error.message);
      isSubmitting = false;

      submitViaEnter();
      promptSubmitted = true;
      isSubmitting = false;

      chrome.storage.local.remove(['pendingPerplexityPrompt']);
    });
}

function checkForPendingPrompts() {
  isSubmitting = false;
  promptSubmitted = false;

  if (isSubmitting || promptSubmitted) {
    return;
  }

  chrome.storage.local.get(['pendingPerplexityPrompt', 'perplexityPromptTimestamp'], function(result) {
    if (result.pendingPerplexityPrompt) {
      const currentTime = Date.now();
      const promptTime = result.perplexityPromptTimestamp || 0;
      const twoMinutesInMs = 2 * 60 * 1000;

      if (currentTime - promptTime < twoMinutesInMs) {
        const promptToProcess = result.pendingPerplexityPrompt;

        // Claim the prompt before submit so reloads do not send it twice.
        chrome.storage.local.remove(['pendingPerplexityPrompt', 'perplexityPromptTimestamp'], () => {
          insertPromptAndSubmit(promptToProcess);
        });
      } else {
        chrome.storage.local.remove(['pendingPerplexityPrompt', 'perplexityPromptTimestamp']);
      }
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
