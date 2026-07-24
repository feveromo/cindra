let firstShortcutXTime = 0;
let selectionComposerHost = null;
let selectedTextForComposer = '';
let selectionComposerTimer = null;
let selectionComposerInitialized = false;
let selectionComposerRange = null;
let selectionComposerScrollFrame = null;
let selectionComposerDismissedText = '';
let selectionHighlightHost = null;

globalThis.CindraContentScriptReady = true;

const SHORTCUT_SEQUENCE_TIMEOUT_MS = 700;
const DEFAULT_SUMMARY_PROMPT = 'Summarize the following content in 5-10 bullet points with timestamp if it\'s transcript.';
const providerRegistry = globalThis.CindraProviders;
const extraction = globalThis.CindraExtraction;
const messageBus = globalThis.CindraMessages;
const ACTIONS = messageBus.ACTIONS;

try {
  window.addEventListener('keydown', handleShortcut, true);
  window.addEventListener('keyup', handleShortcutKeyup, true);
} catch (error) {
  if (error.message.includes('Extension context invalidated')) {
    detachShortcutListeners();
  }
}

function handleShortcut(e) {
  // Hot reloads can invalidate the extension context while this page is still open.
  if (typeof chrome.runtime === 'undefined' || chrome.runtime.id === undefined) {
    detachShortcutListeners();
    return;
  }

  if (!shouldHandleShortcutEvent(e)) {
    resetShortcutState();
    return;
  }

  const isCtrlX = e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'x';
  if (!isCtrlX) {
    resetShortcutState();
    return;
  }

  if (e.repeat) {
    return;
  }

  const currentTime = Date.now();
  if (firstShortcutXTime && (currentTime - firstShortcutXTime) < SHORTCUT_SEQUENCE_TIMEOUT_MS) {
    e.preventDefault();
    e.stopPropagation();

    try {
      triggerSummarize();
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        detachShortcutListeners();
      }
    }

    resetShortcutState();
    return;
  }

  firstShortcutXTime = currentTime;
}

function handleShortcutKeyup(e) {
  if (!e.ctrlKey || e.key === 'Control') {
    resetShortcutState();
  }
}

function resetShortcutState() {
  firstShortcutXTime = 0;
}

function detachShortcutListeners() {
  window.removeEventListener('keydown', handleShortcut, true);
  window.removeEventListener('keyup', handleShortcutKeyup, true);
}

function triggerSummarize() {
  // Hot reloads can invalidate the extension context while this page is still open.
  if (typeof chrome.runtime === 'undefined' || chrome.runtime.id === undefined) {
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

      void messageBus.runtimeSendMessage({
        action: ACTIONS.SUMMARIZE,
        url: window.location.href,
        summaryPrompt,
        aiModel: settings.aiModel,
        ...buildShortcutSummaryPayload(settings.contentSource)
      }, {
        context: 'start summary from keyboard shortcut',
        timeoutMs: 5000
      }).catch((error) => {
        if (error?.message?.includes('Extension context invalidated')) {
          detachShortcutListeners();
          return;
        }
        console.error('[Cindra] Could not start summary from keyboard shortcut.', error);
      });
    });
  } catch (error) {
    // Extension context invalidated during hot reload — nothing to do.
  }
}

function buildShortcutSummaryPayload(contentSource) {
  const normalizedSource = contentSource || 'auto';
  const selectedText = getSelectedPageText();
  const shouldCapturePage = (normalizedSource === 'page' || shouldCapturePageForAutoSource()) &&
    !isPdfUrl(window.location.href);

  if (normalizedSource === 'selection') {
    return {
      contentSource: 'selection',
      selectedText
    };
  }

  if (shouldCapturePage) {
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

function isPdfUrl(url = '') {
  try {
    const parsedUrl = new URL(url);
    return /\.pdf$/i.test(parsedUrl.pathname) ||
      isArxivPdfUrl(parsedUrl);
  } catch (error) {
    return /\.pdf(?:[?#]|$)/i.test(url) ||
      /^https?:\/\/(?:[^/]+\.)?arxiv\.org\/pdf\/[^/?#]+/i.test(url);
  }
}

function isArxivPdfUrl(url) {
  const hostname = url.hostname.toLowerCase();
  return (hostname === 'arxiv.org' || hostname.endsWith('.arxiv.org')) &&
    url.pathname.startsWith('/pdf/');
}

function getSelectedPageText() {
  return extraction.normalizeText(window.getSelection?.().toString() || '');
}

function getCapturedPageData() {
  return {
    description: document.querySelector('meta[name="description"]')?.content || '',
    content: extraction.getReadablePageText(document)
  };
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
          font-family: 'Inter', 'Inter var', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        }

        * {
          box-sizing: border-box;
        }

        .panel {
          border: 1px solid #242728;
          border-radius: 10px;
          background: #0d0d0d;
          color: #cdcdcd;
          box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
          overflow: hidden;
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
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }

        .title {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: -0.005em;
          color: #f4f4f6;
        }

        .meta {
          margin-top: 2px;
          color: #9c9c9d;
          font-size: 12px;
          line-height: 1.4;
        }

        .close {
          width: 30px;
          height: 30px;
          border: 1px solid #242728;
          border-radius: 6px;
          background: #101111;
          color: #9c9c9d;
          cursor: pointer;
          font: inherit;
          font-size: 18px;
          line-height: 1;
        }

        .close:hover {
          border-color: rgba(255, 255, 255, 0.16);
          color: #f4f4f6;
        }

        .body {
          padding: 12px;
        }

        textarea {
          width: 100%;
          min-height: 92px;
          resize: vertical;
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.05);
          color: #f4f4f6;
          padding: 10px;
          font: inherit;
          font-size: 13px;
          line-height: 1.5;
          letter-spacing: 0.2px;
          outline: none;
        }

        textarea::placeholder {
          color: #6a6b6c;
        }

        textarea:focus {
          border-color: rgba(255, 255, 255, 0.16);
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.16);
        }

        .actions {
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          padding-top: 0;
        }

        button {
          min-height: 36px;
          border: 1px solid transparent;
          border-radius: 8px;
          padding: 0 14px;
          font: inherit;
          font-size: 13px;
          font-weight: 500;
          letter-spacing: -0.005em;
          cursor: pointer;
        }

        .secondary {
          border-color: #242728;
          background: transparent;
          color: #f4f4f6;
        }

        .secondary:hover {
          background: #121212;
          border-color: rgba(255, 255, 255, 0.16);
        }

        .primary {
          background: #ffffff;
          color: #000000;
        }

        .primary:hover {
          background: #e8e8e8;
        }

        .status {
          min-height: 18px;
          padding: 0 12px 10px;
          color: #9c9c9d;
          font-size: 12px;
          line-height: 1.4;
        }

        @media (prefers-color-scheme: light) {
          .panel {
            border-color: rgba(0, 0, 0, 0.12);
            background: #ffffff;
            color: #3a3a3c;
            box-shadow: 0 18px 40px rgba(0, 0, 0, 0.12);
          }

          .header {
            border-color: rgba(0, 0, 0, 0.06);
          }

          .title {
            color: #0a0a0a;
          }

          .meta,
          .status {
            color: #6b6b6e;
          }

          .close {
            border-color: rgba(0, 0, 0, 0.12);
            background: #f1f1f2;
            color: #6b6b6e;
          }

          .close:hover {
            border-color: rgba(0, 0, 0, 0.2);
            color: #0a0a0a;
          }

          textarea {
            border-color: rgba(0, 0, 0, 0.06);
            background: rgba(0, 0, 0, 0.04);
            color: #0a0a0a;
          }

          textarea::placeholder {
            color: #9a9a9d;
          }

          textarea:focus {
            border-color: rgba(0, 0, 0, 0.2);
            box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
          }

          .actions {
            border-color: rgba(0, 0, 0, 0.06);
          }

          .secondary {
            border-color: rgba(0, 0, 0, 0.12);
            color: #0a0a0a;
          }

          .secondary:hover {
            background: #e9e9ea;
            border-color: rgba(0, 0, 0, 0.2);
          }

          .primary {
            background: #0a0a0a;
            color: #ffffff;
          }

          .primary:hover {
            background: #2a2a2c;
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
    const providerName = providerRegistry.getProvider(settings.aiModel).label;
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

    messageBus.runtimeSendMessage({
      action: ACTIONS.SUMMARIZE,
      url: window.location.href,
      summaryPrompt,
      aiModel: settings.aiModel,
      contentSource: 'selection',
      selectedText: selectedTextForComposer
    }, {
      context: 'start summary from selection composer',
      timeoutMs: 5000
    }).then((response) => {
      if (!response?.success) {
        throw new Error(response?.error || 'Could not start the handoff.');
      }

      const providerName = providerRegistry.getProvider(settings.aiModel).label;
      setSelectionComposerStatus(`Queued for ${providerName}.`);
      setTimeout(hideSelectionComposer, 700);
    }).catch((error) => {
      setSelectionComposerStatus(error?.message || 'Could not start the handoff.');
    });
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
    'chat.qwen.ai',
    'chat.cerebras.ai'
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
