let isProcessing = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'insertPrompt') {
    if (isProcessing) {
      sendResponse({ success: false, error: 'Already processing' });
      return true;
    }

    isProcessing = true;
    insertPromptAndSubmit(message.prompt)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((err) => {
        console.error('Qwen: Error inserting prompt:', err);
        sendResponse({ success: false, error: err?.message || String(err) });
      })
      .finally(() => {
        isProcessing = false;
      });
    return true;
  }
});

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

async function insertPromptAndSubmit(prompt) {
  if (!prompt) throw new Error('No prompt provided');

  const input = await CindraInject.waitForElement([
    'textarea#chat-input',
    'textarea[placeholder="How can I help you today?"]',
    'textarea.text-area-box-web',
    'div[contenteditable="true"]'
  ]);

  const isLargeFile = prompt.length > 40960;

  // Qwen handles very large prompts better when the content is pasted as a file.
  if (isLargeFile) {
    const { instructionPart, contentPart } = parsePromptSections(prompt);

    if (instructionPart) {
      if (input.tagName && input.tagName.toLowerCase() === 'textarea') {
        CindraInject.insertTextIntoTextarea(input, instructionPart);
      } else {
        insertTextIntoEditableDiv(input, instructionPart);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    if (contentPart) {
      pasteTextAsFile(input, contentPart);
      await new Promise(r => setTimeout(r, 1500));
    } else {
      console.warn('Qwen: No content part found after parsing, proceeding with instruction only');
      await new Promise(r => setTimeout(r, 800));
    }
  } else {
    if (input.tagName && input.tagName.toLowerCase() === 'textarea') {
      CindraInject.insertTextIntoTextarea(input, prompt);
    } else {
      insertTextIntoEditableDiv(input, prompt);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  const sendButton = await CindraInject.waitForElement([
    'button[type="submit"]:not([disabled])',
    'button[aria-label*="Send" i]:not([disabled])',
    '#open-omni-button + button[type="submit"]:not([disabled])'
  ], 1500).catch(() => null);

  if (sendButton) {
    if (isLargeFile) {
      await new Promise(r => setTimeout(r, 750));
    }
    CindraInject.robustClick(sendButton);
    setTimeout(() => sendButton.click(), 150);
  } else {
    const editor = input;
    editor.focus();
    const kd = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
    const ku = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
    editor.dispatchEvent(kd);
    editor.dispatchEvent(ku);
  }

  chrome.storage.local.remove(['pendingQwenPrompt', 'qwenPromptTimestamp'], () => {});
}

function checkPendingPrompt() {
  if (isProcessing) return;
  chrome.storage.local.get(['pendingQwenPrompt', 'qwenPromptTimestamp'], (result) => {
    if (!result || !result.pendingQwenPrompt) return;
    const ts = result.qwenPromptTimestamp || 0;
    const fresh = (Date.now() - ts) < 60000;
    if (!fresh) {
      chrome.storage.local.remove(['pendingQwenPrompt', 'qwenPromptTimestamp']);
      return;
    }
    const prompt = result.pendingQwenPrompt;
    chrome.storage.local.remove(['pendingQwenPrompt', 'qwenPromptTimestamp'], () => {
      isProcessing = true;
      insertPromptAndSubmit(prompt)
        .catch((e) => console.error('Qwen: Error processing pending prompt', e))
        .finally(() => { isProcessing = false; });
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(checkPendingPrompt, 250));
} else {
  setTimeout(checkPendingPrompt, 250);
}
