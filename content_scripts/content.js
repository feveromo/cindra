(() => {
  if (globalThis.__CINDRA_DEBUG__) return;
  if (!globalThis.__CINDRA_LOG_MUTED__) {
    globalThis.__CINDRA_LOG_MUTED__ = true;
    console.log = () => {};
  }
})();

let ctrlPressed = false;
let xPressed = false;
let lastKeyDownTime = 0;
let selectionComposerHost = null;
let selectedTextForComposer = '';
let selectionComposerTimer = null;
let selectionComposerInitialized = false;
let selectionComposerRange = null;
let selectionComposerScrollFrame = null;
let selectionComposerDismissedText = '';
let selectionHighlightHost = null;

const DEFAULT_SUMMARY_PROMPT = 'Summarize the following content in 5-10 bullet points with timestamp if it\'s transcript.';
const PROVIDER_LABELS = {
  'google-ai-studio': 'Google AI Studio',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  grok: 'Grok',
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  'google-learning': 'Google Learning',
  deepseek: 'DeepSeek',
  glm: 'GLM',
  kimi: 'Kimi',
  huggingchat: 'HuggingChat',
  qwen: 'Qwen'
};

try {
  document.addEventListener('keydown', handleShortcut);
} catch (error) {
  if (error.message.includes('Extension context invalidated')) {
    console.log('Extension context was invalidated, removing event listener');
    document.removeEventListener('keydown', handleShortcut);
  }
}

function handleShortcut(e) {
  // Hot reloads can invalidate the extension context while this page is still open.
  if (typeof chrome.runtime === 'undefined' || chrome.runtime.id === undefined) {
    console.log('Extension context invalid, removing event listener');
    document.removeEventListener('keydown', handleShortcut);
    return;
  }

  if (!shouldHandleShortcutEvent(e)) {
    resetKeyState();
    return;
  }

  const currentTime = Date.now();

  if (e.key === 'Control') {
    ctrlPressed = true;
    lastKeyDownTime = currentTime;
    return;
  }

  if (ctrlPressed && e.key.toLowerCase() === 'x') {
    if (!xPressed) {
      xPressed = true;
      lastKeyDownTime = currentTime;
      return;
    }

    if (xPressed && (currentTime - lastKeyDownTime) < 500) {
      e.preventDefault();
      try {
        triggerSummarize();
      } catch (error) {
        if (error.message.includes('Extension context invalidated')) {
          console.log('Extension context invalid during summarize, removing listener');
          document.removeEventListener('keydown', handleShortcut);
        }
      }

      resetKeyState();
      return;
    }
  }

  if (e.key !== 'Control' && e.key.toLowerCase() !== 'x') {
    resetKeyState();
  }
}

function resetKeyState() {
  ctrlPressed = false;
  xPressed = false;
}

document.addEventListener('keyup', (e) => {
  if (e.key === 'Control') {
    ctrlPressed = false;
  }
  if (e.key.toLowerCase() === 'x') {
    const currentTime = Date.now();
    if (currentTime - lastKeyDownTime > 500) {
      xPressed = false;
    }
  }
});

function triggerSummarize() {
  // Hot reloads can invalidate the extension context while this page is still open.
  if (typeof chrome.runtime === 'undefined' || chrome.runtime.id === undefined) {
    console.log('Extension context invalid, cannot trigger summarize');
    return;
  }

  try {
    chrome.storage.sync.get({
      savedPrompts: [],
      activePromptId: null,
      aiModel: 'google-ai-studio',
      contentSource: 'auto'
    }, (settings) => {
      let summaryPrompt = 'Summarize the following content in 5-10 bullet points with timestamp if it\'s transcript.';

      if (settings.activePromptId && settings.savedPrompts.length > 0) {
        const activePrompt = settings.savedPrompts.find(p => p.id === settings.activePromptId);
        if (activePrompt) {
          summaryPrompt = activePrompt.text;
        }
      }

      chrome.runtime.sendMessage({
        action: 'summarize',
        url: window.location.href,
        summaryPrompt: summaryPrompt,
        aiModel: settings.aiModel,
        ...buildShortcutSummaryPayload(settings.contentSource)
      });
    });
  } catch (error) {
    if (error.message.includes('Extension context invalidated')) {
      console.log('Extension context invalid during settings retrieval');
    }
  }
}

function buildShortcutSummaryPayload(contentSource) {
  const normalizedSource = contentSource || 'auto';
  const selectedText = getSelectedPageText();

  if (normalizedSource === 'selection') {
    return {
      contentSource: 'selection',
      selectedText
    };
  }

  if (normalizedSource === 'page' || shouldCapturePageForAutoSource()) {
    const pageData = getCapturedPageData();
    return {
      contentSource: 'page',
      capturedPageContent: pageData.content,
      capturedPageDescription: pageData.description,
      capturedPageAttempted: true
    };
  }

  return {
    contentSource: normalizedSource
  };
}

function shouldCapturePageForAutoSource() {
  const hostname = window.location.hostname;
  return !window.location.href.includes('youtube.com/watch') &&
    !hostname.includes('reddit.com');
}

function getSelectedPageText() {
  return (window.getSelection?.().toString() || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getCapturedPageData() {
  const description = document.querySelector('meta[name="description"]')?.content || '';
  const selectors = [
    'main',
    'article',
    '[role="main"]',
    '#content',
    '.content',
    '.main-content',
    '#main'
  ];

  const candidates = selectors
    .flatMap(selector => Array.from(document.querySelectorAll(selector)))
    .filter(Boolean);

  const bestCandidate = candidates
    .map(element => ({
      element,
      length: (element.innerText || '').trim().length
    }))
    .sort((a, b) => b.length - a.length)[0]?.element;

  const sourceElement = bestCandidate || document.body;
  const clone = sourceElement?.cloneNode(true);

  if (!clone) {
    return { description, content: '' };
  }

  clone.querySelectorAll([
    'script',
    'style',
    'noscript',
    'nav',
    'footer',
    'header',
    'aside',
    'form',
    'button',
    'input',
    'select',
    'textarea',
    '[hidden]',
    '[aria-hidden="true"]',
    '.cindra-summary-ext',
    '.web-summary-button',
    '.yt-summary-widget',
    '[data-extension="cindra-summary"]'
  ].join(',')).forEach(element => element.remove());

  return {
    description,
    content: normalizeCapturedContent(clone.innerText || '')
  };
}

function normalizeCapturedContent(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function initializeSelectionComposer() {
  if (selectionComposerInitialized) {
    return;
  }

  selectionComposerInitialized = true;
  document.addEventListener('mouseup', scheduleSelectionComposer);
  document.addEventListener('keyup', handleSelectionComposerKeyup);
  document.addEventListener('mousedown', handleSelectionComposerDismiss);
  window.addEventListener('scroll', scheduleSelectionComposerReposition, { passive: true });
  window.addEventListener('resize', scheduleSelectionComposerReposition);
}

function handleSelectionComposerKeyup(event) {
  if (isEventInsideSelectionComposer(event)) {
    return;
  }

  if (event.key === 'Escape') {
    dismissSelectionComposer();
    return;
  }

  scheduleSelectionComposer(event);
}

function handleSelectionComposerDismiss(event) {
  if (isEventInsideSelectionComposer(event)) {
    return;
  }

  dismissSelectionComposer();
}

function scheduleSelectionComposer(event) {
  if (isEventInsideSelectionComposer(event)) {
    return;
  }

  if (selectionComposerTimer) {
    clearTimeout(selectionComposerTimer);
  }

  selectionComposerTimer = setTimeout(() => {
    maybeShowSelectionComposer(event);
  }, 120);
}

function maybeShowSelectionComposer(event) {
  if (!isExtensionContextValid()) {
    hideSelectionComposer();
    return;
  }

  if (event?.target && isEditableTarget(event.target)) {
    hideSelectionComposer();
    return;
  }

  const selection = window.getSelection?.();
  const selectedText = selection?.toString().trim() || '';

  if (!selection || selection.rangeCount === 0 || selectedText.length < 3) {
    selectionComposerDismissedText = '';
    hideSelectionComposer();
    return;
  }

  if (selectedText === selectionComposerDismissedText) {
    return;
  }

  selectionComposerDismissedText = '';

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    hideSelectionComposer();
    return;
  }

  selectedTextForComposer = selectedText;
  selectionComposerRange = range.cloneRange();
  showSelectionComposer(rect, selectedText);
}

function showSelectionComposer(rect, selectedText) {
  if (!selectionComposerHost) {
    selectionComposerHost = document.createElement('div');
    selectionComposerHost.setAttribute('data-extension', 'cindra-summary');
    selectionComposerHost.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      width: min(360px, calc(100vw - 24px));
      pointer-events: auto;
    `;

    const shadow = selectionComposerHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          color-scheme: light dark;
          font-family: "Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
        }

        * {
          box-sizing: border-box;
        }

        .panel {
          border: 1px solid rgba(43, 45, 47, 0.34);
          background: #fbf7ef;
          color: #222426;
          box-shadow: 0 18px 40px rgba(0, 0, 0, 0.22);
        }

        .header,
        .actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 12px;
        }

        .header {
          border-bottom: 1px solid rgba(43, 45, 47, 0.18);
        }

        .title {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .meta {
          margin-top: 2px;
          color: #666155;
          font-size: 11px;
          line-height: 1.4;
        }

        .close {
          width: 30px;
          height: 30px;
          border: 1px solid rgba(43, 45, 47, 0.18);
          background: #ebe3d4;
          color: #222426;
          cursor: pointer;
          font: inherit;
          font-size: 16px;
        }

        .body {
          padding: 12px;
        }

        textarea {
          width: 100%;
          min-height: 92px;
          resize: vertical;
          border: 1px solid rgba(43, 45, 47, 0.34);
          background: #ffffff;
          color: #222426;
          padding: 10px;
          font: inherit;
          font-size: 12px;
          line-height: 1.5;
          outline: none;
        }

        textarea:focus {
          border-color: #c79666;
          box-shadow: 0 0 0 3px rgba(199, 150, 102, 0.22);
        }

        .actions {
          border-top: 1px solid rgba(43, 45, 47, 0.18);
          padding-top: 0;
        }

        button {
          min-height: 36px;
          border: 1px solid rgba(43, 45, 47, 0.34);
          padding: 8px 10px;
          font: inherit;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          cursor: pointer;
        }

        .secondary {
          background: #fbf7ef;
          color: #222426;
        }

        .primary {
          background: #232527;
          color: #f8f4eb;
        }

        .status {
          min-height: 18px;
          padding: 0 12px 10px;
          color: #666155;
          font-size: 11px;
          line-height: 1.4;
        }

        @media (prefers-color-scheme: dark) {
          .panel {
            border-color: rgba(242, 234, 220, 0.3);
            background: #3a3c3f;
            color: #f4efe4;
          }

          .header,
          .actions {
            border-color: rgba(242, 234, 220, 0.12);
          }

          .meta,
          .status {
            color: #bfb5a5;
          }

          .close,
          .secondary {
            border-color: rgba(242, 234, 220, 0.3);
            background: #343639;
            color: #f4efe4;
          }

          textarea {
            border-color: rgba(242, 234, 220, 0.3);
            background: #424447;
            color: #f4efe4;
          }

          .primary {
            background: #f0eadf;
            color: #2a2c2f;
          }
        }
      </style>
      <div class="panel">
        <div class="header">
          <div>
            <div class="title">Ask Cindra</div>
            <div class="meta" id="selection-meta"></div>
          </div>
          <button class="close" id="close" type="button" aria-label="Close">×</button>
        </div>
        <div class="body">
          <textarea id="question" placeholder="Ask a question about the selected text..."></textarea>
        </div>
        <div class="actions">
          <button class="secondary" id="summarize" type="button">Summarize</button>
          <button class="primary" id="ask" type="button">Ask AI</button>
        </div>
        <div class="status" id="status"></div>
      </div>
    `;

    shadow.getElementById('close').addEventListener('click', dismissSelectionComposer);
    shadow.getElementById('summarize').addEventListener('click', () => {
      sendSelectionToAi('');
    });
    shadow.getElementById('ask').addEventListener('click', () => {
      sendSelectionToAi(shadow.getElementById('question').value);
    });
    shadow.getElementById('question').addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        sendSelectionToAi(event.target.value);
      }
    });

    document.body.appendChild(selectionComposerHost);
  }

  chrome.storage.sync.get({ aiModel: 'google-ai-studio' }, (settings) => {
    const providerName = PROVIDER_LABELS[settings.aiModel] || 'AI';
    const shadow = selectionComposerHost.shadowRoot;
    shadow.getElementById('selection-meta').textContent = `${selectedText.length.toLocaleString()} chars selected -> ${providerName}`;
    shadow.getElementById('ask').textContent = `Ask ${providerName}`;
    shadow.getElementById('status').textContent = '';
  });

  positionSelectionComposer(rect);
  paintSelectionHighlight();
  selectionComposerHost.style.display = 'block';
  selectionComposerHost.hidden = false;
}

function positionSelectionComposer(rect) {
  const panelWidth = Math.min(360, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left + rect.width / 2 - panelWidth / 2, window.innerWidth - panelWidth - 12));
  let top = rect.bottom + 10;

  if (top + 230 > window.innerHeight && rect.top > 240) {
    top = rect.top - 230;
  }

  selectionComposerHost.style.left = `${left}px`;
  selectionComposerHost.style.top = `${Math.max(12, top)}px`;
}

function scheduleSelectionComposerReposition() {
  if (selectionComposerScrollFrame) {
    cancelAnimationFrame(selectionComposerScrollFrame);
  }

  selectionComposerScrollFrame = requestAnimationFrame(repositionSelectionComposer);
}

function repositionSelectionComposer() {
  selectionComposerScrollFrame = null;

  if (!selectionComposerHost || selectionComposerHost.hidden || !selectionComposerRange) {
    return;
  }

  const rect = selectionComposerRange.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return;
  }

  positionSelectionComposer(rect);
  paintSelectionHighlight();
}

function sendSelectionToAi(questionText) {
  if (!selectedTextForComposer.trim()) {
    setSelectionComposerStatus('No selected text captured.');
    return;
  }

  chrome.storage.sync.get({
    savedPrompts: [],
    activePromptId: null,
    aiModel: 'google-ai-studio'
  }, (settings) => {
    const basePrompt = getActivePrompt(settings);
    const question = questionText.trim();
    const summaryPrompt = question
      ? buildQuestionPrompt(question)
      : basePrompt;

    setSelectionComposerStatus('Sending selected text...');

    chrome.runtime.sendMessage({
      action: 'summarize',
      url: window.location.href,
      summaryPrompt,
      aiModel: settings.aiModel,
      contentSource: 'selection',
      selectedText: selectedTextForComposer,
      selectionQuestion: question
    });

    const providerName = PROVIDER_LABELS[settings.aiModel] || 'AI';
    setSelectionComposerStatus(`Sent to ${providerName}.`);
    setTimeout(hideSelectionComposer, 700);
  });
}

function getActivePrompt(settings) {
  if (settings.activePromptId && settings.savedPrompts.length > 0) {
    const activePrompt = settings.savedPrompts.find(p => p.id === settings.activePromptId);
    if (activePrompt) {
      return activePrompt.text;
    }
  }

  return DEFAULT_SUMMARY_PROMPT;
}

function buildQuestionPrompt(question) {
  return [
    'Use only the selected text to answer the user question.',
    'If the selected text does not contain enough information, say what is missing.',
    '',
    `User question: ${question}`
  ].join('\n');
}

function setSelectionComposerStatus(message) {
  if (!selectionComposerHost?.shadowRoot) return;

  selectionComposerHost.shadowRoot.getElementById('status').textContent = message;
}

function dismissSelectionComposer() {
  selectionComposerDismissedText = selectedTextForComposer;
  hideSelectionComposer();
}

function hideSelectionComposer() {
  if (!selectionComposerHost) {
    clearSelectionHighlight();
    return;
  }

  selectionComposerHost.style.display = 'none';
  selectionComposerHost.hidden = true;
  clearSelectionHighlight();
}

function isEventInsideSelectionComposer(event) {
  return Boolean(selectionComposerHost && event?.composedPath?.().includes(selectionComposerHost));
}

function paintSelectionHighlight() {
  if (!selectionComposerRange) return;

  if (!selectionHighlightHost) {
    selectionHighlightHost = document.createElement('div');
    selectionHighlightHost.setAttribute('data-extension', 'cindra-summary');
    selectionHighlightHost.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      pointer-events: none;
      overflow: hidden;
    `;
    document.body.appendChild(selectionHighlightHost);
  }

  selectionHighlightHost.textContent = '';
  const rects = Array.from(selectionComposerRange.getClientRects())
    .filter(rect => rect.width > 0 && rect.height > 0);

  rects.forEach(rect => {
    const highlight = document.createElement('div');
    highlight.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      background: rgba(47, 117, 255, 0.28);
      border-radius: 2px;
    `;
    selectionHighlightHost.appendChild(highlight);
  });
}

function clearSelectionHighlight() {
  if (!selectionHighlightHost) return;

  selectionHighlightHost.remove();
  selectionHighlightHost = null;
}

function shouldHandleShortcutEvent(event) {
  return !event.defaultPrevented &&
    shouldRunOnCurrentPage() &&
    !isProviderDestinationHost() &&
    !isEditableTarget(event.target);
}

function shouldOfferGenericPageUi() {
  return shouldRunOnCurrentPage() &&
    !isProviderDestinationHost() &&
    !isSpecialExtractionHost();
}

function shouldRunOnCurrentPage() {
  return window.location.protocol === 'http:' || window.location.protocol === 'https:';
}

function isProviderDestinationHost() {
  const hostname = window.location.hostname.toLowerCase();
  const providerHosts = [
    'aistudio.google.com',
    'gemini.google.com',
    'perplexity.ai',
    'claude.ai',
    'chat.openai.com',
    'chatgpt.com',
    'chat.com',
    'grok.com',
    'learning.google.com',
    'chat.deepseek.com',
    'chat.z.ai',
    'kimi.com',
    'chat.qwen.ai'
  ];

  if (hostname === 'huggingface.co' && window.location.pathname.startsWith('/chat')) {
    return true;
  }

  return providerHosts.some(host => hostname === host || hostname.endsWith(`.${host}`));
}

function isSpecialExtractionHost() {
  const hostname = window.location.hostname.toLowerCase();
  return hostname === 'youtube.com' ||
    hostname.endsWith('.youtube.com') ||
    hostname === 'reddit.com' ||
    hostname.endsWith('.reddit.com');
}

function isEditableTarget(target) {
  const element = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
  return Boolean(element?.closest?.('textarea, input, select, [contenteditable="true"], [contenteditable=""]'));
}

function isExtensionContextValid() {
  return typeof chrome !== 'undefined' &&
    typeof chrome.runtime !== 'undefined' &&
    typeof chrome.runtime.id !== 'undefined';
}

chrome.storage.sync.get({
  floatingButton: 'visible',
  selectionComposer: 'visible'
}, (settings) => {
  if (!shouldOfferGenericPageUi()) {
    return;
  }

  if (settings.floatingButton === 'visible') {
    addWebPageButton();
  }

  if (settings.selectionComposer === 'visible') {
    initializeSelectionComposer();
  }
});

function addWebPageButton() {
  if (window.location.href.toLowerCase().endsWith('.pdf')) {
    return;
  }

  const floatingButton = document.createElement('div');
  floatingButton.className = 'web-summary-button';
  floatingButton.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background-color: white;
    color: #202124;
    border-radius: 50%;
    width: 42px;
    height: 42px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 9999;
    transition: transform 0.2s;
  `;

  const buttonIcon = document.createElement('img');
  try {
    buttonIcon.src = chrome.runtime.getURL('images/icon48.png');
  } catch (e) {
    buttonIcon.alt = 'Summarize';
    console.warn("Could not get extension URL for icon. Is the extension loaded?");
  }
  buttonIcon.style.cssText = `
    width: 24px;
    height: 24px;
    display: block;
    position: relative;
    top: -2px;
  `;

  const closeButton = document.createElement('div');
  closeButton.style.cssText = `
    position: absolute;
    top: -4px;
    right: -4px;
    background-color: #202124;
    color: white;
    border-radius: 50%;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    opacity: 0;
    transition: opacity 0.2s;
    z-index: 10000;
    padding: 2px;
    margin: -2px;
  `;
  closeButton.textContent = '×';

  closeButton.addEventListener('click', (e) => {
    e.stopPropagation();
    floatingButton.remove();
  });

  closeButton.addEventListener('mouseover', (e) => {
    e.stopPropagation();
    closeButton.style.backgroundColor = '#3c4043';
    closeButton.style.opacity = '1';
  });

  closeButton.addEventListener('mouseout', (e) => {
    e.stopPropagation();
    closeButton.style.backgroundColor = '#202124';
    if (!floatingButton.matches(':hover')) {
      closeButton.style.opacity = '0';
    }
  });

  floatingButton.appendChild(buttonIcon);
  floatingButton.appendChild(closeButton);

  floatingButton.addEventListener('mouseover', () => {
    floatingButton.style.transform = 'scale(1.1)';
    closeButton.style.opacity = '1';
  });

  floatingButton.addEventListener('mouseout', () => {
    floatingButton.style.transform = 'scale(1.0)';
    if (!closeButton.matches(':hover')) {
      closeButton.style.opacity = '0';
    }
  });

  floatingButton.addEventListener('click', () => {
    triggerSummarize();
  });

  const tooltip = document.createElement('div');
  tooltip.style.cssText = `
    position: absolute;
    top: -40px;
    right: 0;
    background-color: #202124;
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
  `;
  tooltip.textContent = 'Summarize with AI (Ctrl+X+X)';

  floatingButton.addEventListener('mouseenter', () => {
    tooltip.style.opacity = '1';
  });

  floatingButton.addEventListener('mouseleave', () => {
    tooltip.style.opacity = '0';
  });

  floatingButton.appendChild(tooltip);

  document.body.appendChild(floatingButton);
}
