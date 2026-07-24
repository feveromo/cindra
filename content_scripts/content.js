(function initializeCindraContentScript(root) {
  'use strict';

  root.CindraContentScript?.cleanup?.();

  const SHORTCUT_SEQUENCE_TIMEOUT_MS = 700;
  const promptBuilder = root.CindraPrompt;
  const providerRegistry = root.CindraProviders;
  const extraction = root.CindraExtraction;
  const messageBus = root.CindraMessages;
  const chromeApi = root.CindraChrome;
  const pageUi = root.CindraPageUi;
  const ACTIONS = messageBus?.ACTIONS;
  const DEFAULT_SUMMARY_PROMPT = promptBuilder?.DEFAULT_SUMMARY_PROMPT;

  let firstShortcutXTime = 0;
  let selectionComposer = null;
  let floatingButton = null;
  let initialized = false;
  let cleanedUp = false;

  if (
    !promptBuilder ||
    !DEFAULT_SUMMARY_PROMPT ||
    !providerRegistry ||
    !extraction ||
    !messageBus ||
    !chromeApi ||
    !pageUi
  ) {
    console.error('[Cindra] Content script dependencies are unavailable.');
    root.CindraContentScriptReady = false;
    return;
  }

  function initialize() {
    if (initialized || cleanedUp) return;
    initialized = true;
    root.CindraContentScriptReady = true;
    root.addEventListener('keydown', handleShortcut, true);
    root.addEventListener('keyup', handleShortcutKeyup, true);
    root.addEventListener('pagehide', cleanup, { once: true });
    void initializePageUi();
  }

  async function initializePageUi() {
    if (!shouldOfferGenericPageUi()) return;

    try {
      const settings = await chromeApi.storageGet(root.chrome.storage.sync, {
        floatingButton: 'visible',
        selectionComposer: 'visible'
      });
      if (cleanedUp || !isExtensionContextValid()) return;

      if (settings.floatingButton === 'visible') {
        floatingButton = new pageUi.FloatingSummaryButton({
          document: root.document,
          chrome: root.chrome,
          onActivate: () => void triggerSummarize()
        }).start();
      }

      if (settings.selectionComposer === 'visible') {
        selectionComposer = new pageUi.SelectionComposer({
          window: root,
          document: root.document,
          onSubmit: submitSelection,
          resolveProviderName,
          isContextValid: isExtensionContextValid
        }).start();
      }
    } catch (error) {
      if (isInvalidatedContextError(error)) {
        cleanup();
        return;
      }
      console.error('[Cindra] Could not initialize page controls.', error);
    }
  }

  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    initialized = false;
    root.removeEventListener('keydown', handleShortcut, true);
    root.removeEventListener('keyup', handleShortcutKeyup, true);
    root.removeEventListener('pagehide', cleanup);
    selectionComposer?.destroy();
    selectionComposer = null;
    floatingButton?.destroy();
    floatingButton = null;
    resetShortcutState();
    root.CindraContentScriptReady = false;
  }

  function handleShortcut(event) {
    if (!isExtensionContextValid()) {
      cleanup();
      return;
    }
    if (!shouldHandleShortcutEvent(event)) {
      resetShortcutState();
      return;
    }

    const isCtrlX = event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      event.key.toLowerCase() === 'x';
    if (!isCtrlX) {
      resetShortcutState();
      return;
    }
    if (event.repeat) return;

    const now = Date.now();
    if (firstShortcutXTime && now - firstShortcutXTime < SHORTCUT_SEQUENCE_TIMEOUT_MS) {
      event.preventDefault();
      event.stopPropagation();
      resetShortcutState();
      void triggerSummarize();
      return;
    }
    firstShortcutXTime = now;
  }

  function handleShortcutKeyup(event) {
    if (!event.ctrlKey || event.key === 'Control') resetShortcutState();
  }

  function resetShortcutState() {
    firstShortcutXTime = 0;
  }

  async function triggerSummarize() {
    if (!isExtensionContextValid()) {
      cleanup();
      return { success: false, error: 'Extension context is unavailable.' };
    }

    try {
      const settings = await chromeApi.storageGet(root.chrome.storage.sync, {
        savedPrompts: [],
        activePromptId: null,
        aiModel: providerRegistry.DEFAULT_PROVIDER,
        contentSource: providerRegistry.DEFAULT_CONTENT_SOURCE
      });
      const summaryPrompt = pageUi.getActivePrompt(settings, DEFAULT_SUMMARY_PROMPT);
      return await messageBus.runtimeSendMessage({
        action: ACTIONS.SUMMARIZE,
        url: root.location.href,
        summaryPrompt,
        aiModel: settings.aiModel,
        ...buildShortcutSummaryPayload(settings.contentSource)
      }, {
        context: 'start summary from page shortcut',
        timeoutMs: 5000
      });
    } catch (error) {
      if (isInvalidatedContextError(error)) {
        cleanup();
        return { success: false, error: 'Extension context is unavailable.' };
      }
      console.error('[Cindra] Could not start summary from the page.', error);
      return { success: false, error: error?.message || 'Could not start the summary.' };
    }
  }

  async function submitSelection({ selectedText, question }) {
    if (!isExtensionContextValid()) {
      cleanup();
      throw new Error('Cindra was reloaded. Refresh this page and try again.');
    }

    try {
      const settings = await chromeApi.storageGet(root.chrome.storage.sync, {
        savedPrompts: [],
        activePromptId: null,
        aiModel: providerRegistry.DEFAULT_PROVIDER
      });
      const summaryPrompt = question
        ? pageUi.buildQuestionPrompt(question)
        : pageUi.getActivePrompt(settings, DEFAULT_SUMMARY_PROMPT);
      const response = await messageBus.runtimeSendMessage({
        action: ACTIONS.SUMMARIZE,
        url: root.location.href,
        summaryPrompt,
        aiModel: settings.aiModel,
        contentSource: 'selection',
        selectedText
      }, {
        context: 'start summary from selection composer',
        timeoutMs: 5000
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Could not start the handoff.');
      }
      return {
        providerName: providerRegistry.getProvider(settings.aiModel).label
      };
    } catch (error) {
      if (isInvalidatedContextError(error)) cleanup();
      throw error;
    }
  }

  async function resolveProviderName() {
    const settings = await chromeApi.storageGet(root.chrome.storage.sync, {
      aiModel: providerRegistry.DEFAULT_PROVIDER
    });
    return providerRegistry.getProvider(settings.aiModel).label;
  }

  function buildShortcutSummaryPayload(contentSource) {
    const normalizedSource = providerRegistry.getContentSource(contentSource).id;
    const selectedText = getSelectedPageText();
    const shouldCapturePage = (
      normalizedSource === 'page' || shouldCapturePageForAutoSource()
    ) && !isPdfUrl(root.location.href);

    if (normalizedSource === 'selection') {
      return { contentSource: 'selection', selectedText };
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
    return { contentSource: normalizedSource };
  }

  function shouldCapturePageForAutoSource() {
    return !isYouTubeWatchPage() && !isRedditHost();
  }

  function getSelectedPageText() {
    return extraction.normalizeText(root.getSelection?.().toString() || '');
  }

  function getCapturedPageData() {
    return {
      description: root.document.querySelector('meta[name="description"]')?.content || '',
      content: extraction.getReadablePageText(root.document)
    };
  }

  function shouldHandleShortcutEvent(event) {
    return !event.defaultPrevented &&
      shouldRunOnCurrentPage() &&
      !isProviderDestination() &&
      !pageUi.isEditableTarget(event.target, root.Node);
  }

  function shouldOfferGenericPageUi() {
    return shouldRunOnCurrentPage() &&
      !isProviderDestination() &&
      !isSpecialExtractionHost();
  }

  function shouldRunOnCurrentPage() {
    return root.location.protocol === 'http:' || root.location.protocol === 'https:';
  }

  function isProviderDestination() {
    return Boolean(providerRegistry.findProviderForUrl(root.location.href));
  }

  function isSpecialExtractionHost() {
    return isYouTubeHost() || isRedditHost();
  }

  function isYouTubeWatchPage() {
    return isYouTubeHost() && root.location.pathname === '/watch';
  }

  function isYouTubeHost() {
    const hostname = root.location.hostname.toLowerCase();
    return hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
  }

  function isRedditHost() {
    const hostname = root.location.hostname.toLowerCase();
    return hostname === 'reddit.com' || hostname.endsWith('.reddit.com');
  }

  function isPdfUrl(url = '') {
    try {
      const parsedUrl = new URL(url);
      return /\.pdf$/i.test(parsedUrl.pathname) || isArxivPdfUrl(parsedUrl);
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

  function isExtensionContextValid() {
    try {
      return Boolean(root.chrome?.runtime?.id);
    } catch (error) {
      return false;
    }
  }

  function isInvalidatedContextError(error) {
    return /Extension context invalidated|context.*invalid/i.test(error?.message || '');
  }

  root.CindraContentScript = {
    buildShortcutSummaryPayload,
    cleanup,
    getCapturedPageData,
    getSelectedPageText,
    initialize,
    isProviderDestination,
    shouldOfferGenericPageUi,
    triggerSummarize
  };

  initialize();
})(globalThis);
