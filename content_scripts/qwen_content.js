function insertTextIntoEditableDiv(div, text) {
  div.focus();
  div.innerHTML = '';
  const pre = document.createElement('pre');
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.wordBreak = 'break-word';
  pre.style.margin = '0';
  pre.appendChild(document.createTextNode(text));
  div.appendChild(pre);
  try {
    div.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  } catch (_) {
    div.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function parsePromptSections(prompt) {
  const contentStartTag = '<Content>';
  const contentEndTag = '</Content>';

  const contentStartIndex = prompt.indexOf(contentStartTag);
  const contentEndIndex = prompt.indexOf(contentEndTag);

  if (contentStartIndex === -1 || contentEndIndex === -1) {
    return {
      instructionPart: prompt,
      contentPart: ''
    };
  }

  const contentPart = prompt.substring(
    contentStartIndex + contentStartTag.length,
    contentEndIndex
  ).trim();

  const instructionPart = prompt.substring(0, contentStartIndex).trim();

  return {
    instructionPart,
    contentPart
  };
}

function pasteTextAsFile(element, text) {
  element.focus();

  // Keep the instruction text in place; Qwen turns pasted large text into an attached file.
  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true
    });
    element.dispatchEvent(pasteEvent);
  } catch (e) {
    if (element.tagName && element.tagName.toLowerCase() === 'textarea') {
      CindraInject.insertTextIntoTextarea(element, text);
    } else {
      insertTextIntoEditableDiv(element, text);
    }
  }

  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

async function insertPrompt(context) {
  const { input, prompt } = context;
  const isLargeFile = prompt.length > 40960;
  context.isLargeFile = isLargeFile;

  // Qwen handles very large prompts better when the content is pasted as a file.
  if (isLargeFile) {
    const { instructionPart, contentPart } = parsePromptSections(prompt);

    if (instructionPart) {
      if (input.tagName && input.tagName.toLowerCase() === 'textarea') {
        CindraInject.insertTextIntoTextarea(input, instructionPart);
      } else {
        insertTextIntoEditableDiv(input, instructionPart);
      }
      await CindraInject.delay(300);
    }

    if (contentPart) {
      pasteTextAsFile(input, contentPart);
      await CindraInject.delay(1500);
    } else {
      console.warn('Qwen: No content part found after parsing, proceeding with instruction only');
      await CindraInject.delay(800);
    }
  } else {
    if (input.tagName && input.tagName.toLowerCase() === 'textarea') {
      CindraInject.insertTextIntoTextarea(input, prompt);
    } else {
      insertTextIntoEditableDiv(input, prompt);
    }
    await CindraInject.delay(800);
  }
}

function waitForSendButton() {
  return CindraInject.waitForElement([
    'button[type="submit"]:not([disabled])',
    'button[aria-label*="Send" i]:not([disabled])',
    '#open-omni-button + button[type="submit"]:not([disabled])'
  ], 1500).catch(() => null);
}

async function submitPrompt(context) {
  if (context.isLargeFile) {
    await CindraInject.delay(750);
  }
  CindraInject.robustClick(context.submitControl);
}

CindraProviderRuntime.registerAdapter({
  providerId: 'qwen',
  inputSelectors: [
    'textarea#chat-input',
    'textarea[placeholder="How can I help you today?"]',
    'textarea.text-area-box-web',
    'div[contenteditable="true"]'
  ],
  insertPrompt,
  findSubmit: waitForSendButton,
  submit: submitPrompt,
  fallbackSubmit: ({ input }) => CindraInject.dispatchEnter(input, { keyup: true })
});
