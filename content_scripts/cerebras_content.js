(function (root) {
  'use strict';

  if (root.__cindraCerebrasContentLoaded) {
    return;
  }

  root.__cindraCerebrasContentLoaded = true;

  let lastObservedUrl = location.href;

  const MAX_CEREBRAS_PROMPT_CHARS = 18000;
  const PLAYGROUND_INPUT_SELECTOR = 'textarea[data-testid="chat-textarea"]';
  const PLAYGROUND_SUBMIT_SELECTORS = [
    'button[data-testid="chat-submit-button"]:not([disabled])',
    'form button[type="submit"]:not([disabled])'
  ];
  const CHAT_INPUT_SELECTORS = [
    'textarea[placeholder="What do you want to know?"]',
    'textarea'
  ];

  async function insertPromptAndSubmit(prompt) {
    if (!prompt) {
      throw new Error('No prompt provided');
    }

    const limitedPrompt = limitPromptForCerebras(prompt);

    if (isCerebrasPlayground()) {
      await insertPromptIntoPlayground(limitedPrompt);
    } else if (isCerebrasChat()) {
      await insertPromptIntoChat(limitedPrompt);
    } else {
      throw new Error('Open Cerebras Cloud Playground before sending a prompt.');
    }

  }

  async function insertPromptIntoPlayground(prompt) {
    const textarea = await CindraInject.waitForElement(PLAYGROUND_INPUT_SELECTOR, 10000);
    insertTextIntoCerebrasTextarea(textarea, prompt);
    await waitForUiSettle(150);

    const submitButton = await waitForPlaygroundSubmitButton(textarea, 5000);
    CindraInject.robustClick(submitButton);
  }

  async function insertPromptIntoChat(prompt) {
    const textarea = await CindraInject.waitForElement(CHAT_INPUT_SELECTORS, 10000);
    insertTextIntoCerebrasTextarea(textarea, prompt);

    const sendButton = await waitForChatSendButton(textarea, 5000);
    CindraInject.robustClick(sendButton);
  }

  function limitPromptForCerebras(prompt) {
    const text = prompt || '';
    if (text.length <= MAX_CEREBRAS_PROMPT_CHARS) {
      return text;
    }

    const headChars = Math.floor(MAX_CEREBRAS_PROMPT_CHARS * 0.7);
    const tailChars = MAX_CEREBRAS_PROMPT_CHARS - headChars;
    const head = text.slice(0, headChars).trimEnd();
    const tail = text.slice(-tailChars).trimStart();
    const omitted = text.length - head.length - tail.length;
    const notice = `[Cindra note: ${omitted.toLocaleString()} characters were omitted from the middle because Cerebras rejected the original message size.]`;

    return `${head}\n\n${notice}\n\n${tail}`;
  }

  function insertTextIntoCerebrasTextarea(textarea, text) {
    textarea.focus();

    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), 'value') ||
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');

    if (descriptor?.set) {
      descriptor.set.call(textarea, text);
    } else {
      textarea.value = text;
    }

    try {
      textarea.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: text
      }));
    } catch (_) {
      textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }

    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findPlaygroundSubmitButton(textarea) {
    const roots = [
      textarea.closest('form'),
      document
    ].filter(Boolean);

    for (const root of roots) {
      const button = Array.from(root.querySelectorAll(PLAYGROUND_SUBMIT_SELECTORS.join(',')))
        .find(isUsablePlaygroundSubmitButton);

      if (button) {
        return button;
      }
    }

    return null;
  }

  function isUsablePlaygroundSubmitButton(button) {
    if (!isVisible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') {
      return false;
    }

    return button.matches('button[data-testid="chat-submit-button"]') ||
      (button.type === 'submit' && /\brun\b/i.test(button.textContent || ''));
  }

  function waitForPlaygroundSubmitButton(textarea, timeout = 5000) {
    const immediate = findPlaygroundSubmitButton(textarea);
    if (immediate) {
      return Promise.resolve(immediate);
    }

    return waitForButton(() => findPlaygroundSubmitButton(textarea), timeout, 'Cerebras: playground run button did not become available');
  }

  function findChatSendButton(textarea) {
    const roots = [
      textarea.parentElement,
      textarea.closest('section'),
      document
    ].filter(Boolean);

    for (const root of roots) {
      const button = Array.from(root.querySelectorAll('button:not([disabled])'))
        .find(isLikelyChatSendButton);

      if (button) {
        return button;
      }
    }

    return null;
  }

  function isLikelyChatSendButton(button) {
    if (!isVisible(button)) {
      return false;
    }

    const rect = button.getBoundingClientRect();
    if (rect.width > 64 || rect.height > 64) {
      return false;
    }

    return Boolean(button.querySelector('svg')) ||
      /(?:^|\s)(?:bg-brand-51|hover:bg-\[#D44A1A\])(?:\s|$)/.test(button.className || '');
  }

  function waitForChatSendButton(textarea, timeout = 5000) {
    const immediate = findChatSendButton(textarea);
    if (immediate) {
      return Promise.resolve(immediate);
    }

    return waitForButton(() => findChatSendButton(textarea), timeout, 'Cerebras: chat send button did not become available');
  }

  function waitForButton(findButton, timeout, errorMessage) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const interval = setInterval(() => {
        const button = findButton();
        if (button) {
          clearInterval(interval);
          resolve(button);
          return;
        }

        if (Date.now() - start >= timeout) {
          clearInterval(interval);
          reject(new Error(errorMessage));
        }
      }, 100);
    });
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      rect.width > 0 &&
      rect.height > 0;
  }

  function isSupportedCerebrasInputPage() {
    return isCerebrasPlayground() || isCerebrasChat();
  }

  function isCerebrasPlayground() {
    return location.hostname === 'cloud.cerebras.ai' &&
      /\/playground(?:\/|$)/.test(location.pathname);
  }

  function isCerebrasChat() {
    return location.hostname === 'chat.cerebras.ai';
  }

  function waitForUiSettle(delay) {
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  function watchCerebrasRouteChanges(providerRuntime) {
    setInterval(() => {
      if (location.href === lastObservedUrl) {
        return;
      }

      lastObservedUrl = location.href;
      setTimeout(providerRuntime.runPending, 250);
    }, 750);
  }

  const providerRuntime = CindraProviderRuntime.register({
    providerId: 'cerebras',
    legacyKeys: {
      prompt: 'pendingCerebrasPrompt',
      timestamp: 'cerebrasPromptTimestamp'
    },
    isReady: isSupportedCerebrasInputPage,
    submitPrompt: insertPromptAndSubmit
  });

  watchCerebrasRouteChanges(providerRuntime);
})(globalThis);
