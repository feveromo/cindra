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

function parsePromptSections(prompt) {
  // Extract the Content section and everything before it
  const contentStartTag = '<Content>';
  const contentEndTag = '</Content>';
  
  const contentStartIndex = prompt.indexOf(contentStartTag);
  const contentEndIndex = prompt.indexOf(contentEndTag);
  
  if (contentStartIndex === -1 || contentEndIndex === -1) {
    // If no Content tags found, return original prompt as instruction and empty content
    console.log('Qwen: No Content tags found in prompt, treating entire prompt as instruction');
    return {
      instructionPart: prompt,
      contentPart: ''
    };
  }
  
  // Extract content between Content tags
  const contentPart = prompt.substring(
    contentStartIndex + contentStartTag.length,
    contentEndIndex
  ).trim();
  
  // Extract everything before Content tag (Task, ContentTitle, URL, Channel, Description)
  const instructionPart = prompt.substring(0, contentStartIndex).trim();
  
  return {
    instructionPart,
    contentPart
  };
}

function pasteTextAsFile(element, text) {
  // Focus the element first
  element.focus();
  
  // Don't clear existing content - we want to append the file to any existing text
  // The element may already have the instruction text in it
  
  // Create a paste event with DataTransfer to trigger file upload for large text
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
    console.log('Qwen: Synthetic paste failed (non-fatal):', e);
    // Fallback to regular insertion if paste fails
    if (element.tagName && element.tagName.toLowerCase() === 'textarea') {
      insertTextIntoTextarea(element, text);
    } else {
      insertTextIntoEditableDiv(element, text);
    }
  }
  
  // Dispatch input event for UI updates
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
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

  // Track if this is a large file upload
  const isLargeFile = prompt.length > 40960;

  // If prompt exceeds 40960 characters, split it and handle separately
  if (isLargeFile) {
    console.log('Qwen: Prompt exceeds 40960 characters, splitting prompt for file upload');
    const { instructionPart, contentPart } = parsePromptSections(prompt);
    
    // First, insert the instruction part (Task, ContentTitle, etc.) into the text input
    if (instructionPart) {
      console.log('Qwen: Inserting instruction part into text input');
      if (input.tagName && input.tagName.toLowerCase() === 'textarea') {
        insertTextIntoTextarea(input, instructionPart);
      } else {
        insertTextIntoEditableDiv(input, instructionPart);
      }
      // Small delay to ensure instruction text is set
      await new Promise(r => setTimeout(r, 300));
    }
    
    // Then, paste the content part as a file (this should append/add the file)
    if (contentPart) {
      console.log('Qwen: Pasting content part as file');
      pasteTextAsFile(input, contentPart);
      // Allow more time for file upload processing
      await new Promise(r => setTimeout(r, 1500));
    } else {
      console.warn('Qwen: No content part found after parsing, proceeding with instruction only');
      await new Promise(r => setTimeout(r, 800));
    }
  } else {
    // Use regular insertion for smaller prompts
    if (input.tagName && input.tagName.toLowerCase() === 'textarea') {
      insertTextIntoTextarea(input, prompt);
    } else {
      insertTextIntoEditableDiv(input, prompt);
    }
    // Allow UI to enable send
    await new Promise(r => setTimeout(r, 800));
  }

  // Try to find a send/submit button; otherwise simulate Enter
  const sendButton = await waitForElement([
    'button[type="submit"]:not([disabled])',
    'button[aria-label*="Send" i]:not([disabled])',
    '#open-omni-button + button[type="submit"]:not([disabled])'
  ], 1500).catch(() => null);

  if (sendButton) {
    // Add a small delay before clicking submit for large file uploads
    if (isLargeFile) {
      await new Promise(r => setTimeout(r, 750));
    }
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


