// Content script for Qwen Chat (chat.qwen.ai)
console.log('Qwen content script loaded');

let isProcessing = false;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'insertPrompt') {
    if (isProcessing) {
      console.log('Qwen: Already processing, ignoring request');
      sendResponse({ success: false, error: 'Already processing' });
      return true;
    }

    isProcessing = true;
    insertPromptAndSubmit(message.prompt)
      .then(() => {
        console.log('Qwen: Successfully inserted and submitted prompt');
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

// Wait for an element to appear in the DOM (single or array of selectors)
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const tryFind = (sel) => document.querySelector(sel);

    if (Array.isArray(selector)) {
      for (const sel of selector) {
        const el = tryFind(sel);
        if (el) return resolve(el);
      }
      const start = Date.now();
      const iv = setInterval(() => {
        for (const sel of selector) {
          const el = tryFind(sel);
          if (el) {
            clearInterval(iv);
            resolve(el);
            return;
          }
        }
        if (Date.now() - start > timeout) {
          clearInterval(iv);
          reject(new Error(`Timeout waiting for elements: ${selector.join(', ')}`));
        }
      }, 100);
      return;
    }

    const el = tryFind(selector);
    if (el) return resolve(el);
    const start = Date.now();
    const iv = setInterval(() => {
      const el2 = tryFind(selector);
      if (el2) {
        clearInterval(iv);
        resolve(el2);
        return;
      }
      if (Date.now() - start > timeout) {
        clearInterval(iv);
        reject(new Error(`Timeout waiting for element: ${selector}`));
      }
    }, 100);
  });
}

function insertTextIntoTextarea(textarea, text) {
  textarea.focus();
  textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

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

function robustClick(element) {
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  ['mousedown', 'mouseup', 'click'].forEach(type => {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, view: window });
    element.dispatchEvent(ev);
  });
}

async function insertPromptAndSubmit(prompt) {
  if (!prompt) throw new Error('No prompt provided');

  // Find the input field. Prefer Qwen's textarea, then fallback to contenteditable.
  const input = await waitForElement([
    'textarea#chat-input',
    'textarea[placeholder="How can I help you today?"]',
    'textarea.text-area-box-web',
    'div[contenteditable="true"]'
  ]);

  if (input.tagName && input.tagName.toLowerCase() === 'textarea') {
    insertTextIntoTextarea(input, prompt);
  } else {
    insertTextIntoEditableDiv(input, prompt);
  }

  // Allow UI to enable send
  await new Promise(r => setTimeout(r, 800));

  // Try to find a send/submit button; otherwise simulate Enter
  const sendButton = await waitForElement([
    'button[type="submit"]:not([disabled])',
    'button[aria-label*="Send" i]:not([disabled])',
    '#open-omni-button + button[type="submit"]:not([disabled])'
  ], 1500).catch(() => null);

  if (sendButton) {
    robustClick(sendButton);
    setTimeout(() => sendButton.click(), 150);
  } else {
    const editor = input;
    editor.focus();
    const kd = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
    const ku = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
    editor.dispatchEvent(kd);
    editor.dispatchEvent(ku);
  }

  chrome.storage.local.remove(['pendingQwenPrompt', 'qwenPromptTimestamp'], () => {
    console.log('Qwen: Cleared stored prompt');
  });
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


