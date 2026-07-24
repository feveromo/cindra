function parseQwenPromptSections(prompt) {
  const contentStartTag = '<Content>';
  const contentEndTag = '</Content>';
  const contentStartIndex = prompt.indexOf(contentStartTag);
  const contentEndIndex = prompt.indexOf(contentEndTag);

  if (contentStartIndex === -1 || contentEndIndex === -1) {
    return { instructionPart: prompt, contentPart: '' };
  }

  return {
    instructionPart: prompt.slice(0, contentStartIndex).trim(),
    contentPart: prompt
      .slice(contentStartIndex + contentStartTag.length, contentEndIndex)
      .trim()
  };
}

function insertQwenText(input, text) {
  CindraInject.insertText(input, text, {
    mode: 'pre',
    caretAtEnd: true
  });
}

function pasteQwenContent(input, text) {
  input.focus();
  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    input.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true
    }));
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  } catch (error) {
    insertQwenText(input, text);
  }
}

async function insertQwenPrompt(input, prompt, context) {
  const { signal } = context;
  context.isLargeFile = prompt.length > 40960;

  if (!context.isLargeFile) {
    insertQwenText(input, prompt);
    await CindraInject.sleep(800, signal);
    return;
  }

  const { instructionPart, contentPart } = parseQwenPromptSections(prompt);
  if (instructionPart) {
    insertQwenText(input, instructionPart);
    await CindraInject.sleep(300, signal);
  }

  if (contentPart) {
    pasteQwenContent(input, contentPart);
    await CindraInject.sleep(1500, signal);
  } else {
    await CindraInject.sleep(800, signal);
  }
}

async function findQwenSendButton({ signal }) {
  try {
    return await CindraInject.waitForElement([
      'button[type="submit"]:not([disabled])',
      'button[aria-label*="Send" i]:not([disabled])',
      '#open-omni-button + button[type="submit"]:not([disabled])'
    ], {
      timeoutMs: 1500,
      signal,
      description: 'Qwen send control'
    });
  } catch (error) {
    if (!CindraInject.isTimeoutError(error) || signal?.aborted) throw error;
    return null;
  }
}

async function submitQwenPrompt({ submitControl, isLargeFile, signal }) {
  if (isLargeFile) await CindraInject.sleep(750, signal);
  CindraInject.robustClick(submitControl);
}

CindraProviderRuntime.registerAdapter({
  providerId: 'qwen',
  inputSelectors: [
    'textarea#chat-input',
    'textarea[placeholder="How can I help you today?"]',
    'textarea.text-area-box-web',
    'div[contenteditable="true"]'
  ],
  insertPrompt: insertQwenPrompt,
  findSubmit: findQwenSendButton,
  submit: submitQwenPrompt,
  fallbackSubmit: ({ input }) => CindraInject.pressEnter(input, {
    eventTypes: ['keydown', 'keyup']
  })
});
