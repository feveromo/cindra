(function (root) {
  'use strict';

  if (root.__cindraCerebrasContentLoaded) {
    return;
  }

  root.__cindraCerebrasContentLoaded = true;

  let lastObservedUrl = location.href;

  const MAX_CEREBRAS_PROMPT_CHARS = 18000;
  const CHAT_INPUT_SELECTORS = [
    'textarea[placeholder="What do you want to know?"]',
    'main textarea:not(.g-recaptcha-response)'
  ];

  async function insertPromptAndSubmit(prompt) {
    if (!prompt) {
      throw new Error('No prompt provided');
    }

    const limitedPrompt = limitPromptForCerebras(prompt);
    const textarea = await waitForChatTextarea(10000);
    insertTextIntoCerebrasTextarea(textarea, prompt);
    await waitForUiSettle(150);

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

  function findChatTextarea() {
    for (const selector of CHAT_INPUT_SELECTORS) {
      const textarea = Array.from(document.querySelectorAll(selector)).find(element =>
        !element.disabled &&
        !element.readOnly &&
        !element.classList.contains('g-recaptcha-response') &&
        isVisible(element)
      );
      if (textarea) return textarea;
    }
    return null;
  }

  function waitForChatTextarea(timeout) {
    return waitForElement(() => findChatTextarea(), timeout, 'Cerebras: chat input did not become available');
  }

  function findChatSendButton(textarea) {
    const roots = [
      textarea.parentElement,
      textarea.closest('form'),
      textarea.closest('section'),
    ].filter(Boolean);

    for (const root of roots) {
      const buttons = Array.from(root.querySelectorAll('button'));
      const button = buttons.find(isLikelyChatSendButton);

      if (button) {
        return button;
      }

      const fallback = buttons.filter(isUsableUnlabelledComposerButton).at(-1);
      if (fallback) return fallback;
    }

    return null;
  }

  function isLikelyChatSendButton(button) {
    if (!isUsableButton(button)) {
      return false;
    }

    const label = getButtonLabel(button);
    if (/\b(?:add|attach|image|model|upload|voice)\b/i.test(label)) return false;

    return /\b(?:send|submit)\b/i.test(label) ||
      button.type === 'submit' ||
      Boolean(button.querySelector('svg.lucide-arrow-up, [data-lucide="arrow-up"]'));
  }

  function isUsableUnlabelledComposerButton(button) {
    return isUsableButton(button) &&
      !getButtonLabel(button) &&
      Boolean(button.querySelector('svg'));
  }

  function isUsableButton(button) {
    if (!isVisible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') {
      return false;
    }

    const rect = button.getBoundingClientRect();
    return rect.width <= 64 && rect.height <= 64;
  }

  function getButtonLabel(button) {
    return [
      button.getAttribute('aria-label'),
      button.getAttribute('title'),
      button.textContent
    ].filter(Boolean).join(' ').trim();
  }

  function waitForChatSendButton(textarea, timeout = 5000) {
    const immediate = findChatSendButton(textarea);
    if (immediate) {
      return Promise.resolve(immediate);
    }

    return waitForElement(
      () => findChatSendButton(textarea),
      timeout,
      'Cerebras: chat send button did not become available'
    );
  }

  function waitForElement(findElement, timeout, errorMessage) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const interval = setInterval(() => {
        const element = findElement();
        if (element) {
          clearInterval(interval);
          resolve(element);
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
