(function (root) {
  'use strict';

  root.CindraCerebrasContent?.cleanup?.();

  let lastObservedUrl = location.href;
  let routeCleanup = null;

  const MAX_CEREBRAS_PROMPT_CHARS = 18000;
  const CHAT_INPUT_SELECTORS = [
    'textarea[placeholder="What do you want to know?"]',
    'main textarea:not(.g-recaptcha-response)'
  ];

  async function insertPromptAndSubmit(prompt, title, handoff, { signal } = {}) {
    if (!prompt) throw new Error('No prompt provided');

    const limitedPrompt = limitPromptForCerebras(prompt);
    const textarea = await waitForChatTextarea(10000, signal);
    insertTextIntoCerebrasTextarea(textarea, limitedPrompt);
    await CindraInject.sleep(150, signal);

    const sendButton = await waitForChatSendButton(textarea, 5000, signal);
    CindraInject.robustClick(sendButton);
  }

  function limitPromptForCerebras(prompt) {
    const text = prompt || '';
    if (text.length <= MAX_CEREBRAS_PROMPT_CHARS) return text;

    let notice = '';
    let headChars = 0;
    let tailChars = 0;
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const contentBudget = Math.max(0, MAX_CEREBRAS_PROMPT_CHARS - notice.length - 4);
      headChars = Math.floor(contentBudget * 0.7);
      tailChars = contentBudget - headChars;
      const omitted = Math.max(0, text.length - headChars - tailChars);
      notice = `[Cindra note: ${omitted.toLocaleString()} characters were omitted from the middle because Cerebras rejected the original message size.]`;
    }

    const contentBudget = Math.max(0, MAX_CEREBRAS_PROMPT_CHARS - notice.length - 4);
    headChars = Math.floor(contentBudget * 0.7);
    tailChars = contentBudget - headChars;
    const head = text.slice(0, headChars).trimEnd();
    const tail = tailChars ? text.slice(-tailChars).trimStart() : '';
    return `${head}\n\n${notice}\n\n${tail}`.slice(0, MAX_CEREBRAS_PROMPT_CHARS);
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

  function waitForChatTextarea(timeout, signal) {
    return CindraInject.waitForCondition(findChatTextarea, {
      timeoutMs: timeout,
      signal,
      description: 'Cerebras chat input'
    });
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

  function waitForChatSendButton(textarea, timeout = 5000, signal = null) {
    const immediate = findChatSendButton(textarea);
    if (immediate) return Promise.resolve(immediate);

    return CindraInject.waitForCondition(
      () => findChatSendButton(textarea),
      {
        timeoutMs: timeout,
        signal,
        description: 'Cerebras chat send button'
      }
    );
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

  function watchCerebrasRouteChanges(providerRuntime) {
    let retryTimer = null;
    let observer = null;

    const handleRouteChange = () => {
      if (location.href === lastObservedUrl) return;
      lastObservedUrl = location.href;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void providerRuntime.runPending(), 250);
    };

    root.addEventListener('popstate', handleRouteChange);
    root.navigation?.addEventListener?.('currententrychange', handleRouteChange);
    if (typeof MutationObserver === 'function' && document.documentElement) {
      observer = new MutationObserver(handleRouteChange);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    return () => {
      root.removeEventListener('popstate', handleRouteChange);
      root.navigation?.removeEventListener?.('currententrychange', handleRouteChange);
      observer?.disconnect();
      if (retryTimer) clearTimeout(retryTimer);
    };
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

  routeCleanup = watchCerebrasRouteChanges(providerRuntime);
  root.CindraCerebrasContent = {
    cleanup() {
      routeCleanup?.();
      routeCleanup = null;
    }
  };
})(globalThis);
