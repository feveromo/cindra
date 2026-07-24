importScripts(
  '../lib/errors.js',
  '../lib/chrome.js',
  '../lib/messages.js',
  '../lib/extraction.js',
  '../lib/providers.js',
  '../lib/prompt.js',
  '../lib/pdf.js',
  'content.js',
  'pdf.js',
  'transcript-cache.js',
  'orchestrator.js',
  'handoffs.js'
);

const errors = globalThis.CindraErrors;
const chromeApi = globalThis.CindraChrome;
const messages = globalThis.CindraMessages;
const extraction = globalThis.CindraExtraction;
const providerRegistry = globalThis.CindraProviders;
const promptBuilder = globalThis.CindraPrompt;
const backgroundContent = globalThis.CindraBackgroundContent;
const pdfService = globalThis.CindraBackgroundPdf;
const transcriptCacheFactory = globalThis.CindraTranscriptCache;
const { ContentExtractionOrchestrator } = globalThis.CindraBackgroundOrchestrator;
const { isPdfUrl, resolveContentRoute, getPageContent } = backgroundContent;
const ACTIONS = messages.ACTIONS;
const BACKGROUND_ACTIONS = [
  ACTIONS.SUMMARIZE,
  ACTIONS.RESEND_SUMMARY,
  ACTIONS.PROVIDER_HANDOFF_RESULT,
  ACTIONS.CLAIM_PROVIDER_HANDOFF
];
const PDF_SHORTCUT_SCRIPT_FILES = [
  'lib/errors.js',
  'lib/chrome.js',
  'lib/messages.js',
  'lib/extraction.js',
  'lib/prompt.js',
  'lib/providers.js',
  'content_scripts/lib/inject.js',
  'content_scripts/lib/page_ui.js',
  'content_scripts/content.js'
];

const handoffService = globalThis.CindraBackgroundHandoffs.create({
  providerRegistry,
  promptBuilder,
  onError: message => openErrorTab(message)
});
const {
  setStatus,
  sendToSelectedModel,
  resendSummary,
  handleProviderHandoffResult,
  claimProviderHandoff
} = handoffService;

const transcriptCache = transcriptCacheFactory.create({
  get: keys => chromeApi.storageGet(chrome.storage.local, keys),
  set: items => chromeApi.storageSet(chrome.storage.local, items),
  remove: keys => chromeApi.storageRemove(chrome.storage.local, keys)
});

const orchestrator = new ContentExtractionOrchestrator({
  providerRegistry,
  storageGet: defaults => chromeApi.storageGet(chrome.storage.sync, defaults),
  resolveContentRoute,
  isPdfUrl,
  normalizeText: extraction.normalizeText,
  extractPage: extractPageContent,
  extractPdf: tab => pdfService.extractFullText(tab),
  extractReddit: tab => messages.tabsSendMessage(tab.id, {
    action: ACTIONS.EXTRACT_REDDIT_CONTENT
  }, {
    context: `extract Reddit content from tab ${tab.id}`,
    timeoutMs: 5000
  }),
  extractTranscript: tab => messages.tabsSendMessage(tab.id, {
    action: ACTIONS.EXTRACT_TRANSCRIPT
  }, {
    context: `extract YouTube transcript from tab ${tab.id}`,
    timeoutMs: 45000
  }),
  transcriptCache,
  sendToModel: sendToSelectedModel,
  setStatus,
  sendTranscriptStatus,
  openError: openErrorTab,
  logError: (context, error) => errors.logError(context, error),
  toUserMessage: (error, fallback) => errors.toUserMessage(error, fallback)
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !BACKGROUND_ACTIONS.includes(message.action)) return false;

  const respond = messages.respondOnce(sendResponse);
  const validation = messages.validateMessage(message, BACKGROUND_ACTIONS);
  if (!validation.ok) {
    respond({ success: false, error: validation.error });
    return false;
  }

  if (message.action === ACTIONS.SUMMARIZE) {
    resolveSourceTab(message, sender)
      .then((tab) => {
        respond({ success: true, accepted: true });
        void orchestrator.run(tab, message);
      })
      .catch((error) => {
        errors.logError('Could not resolve source tab', error);
        const userMessage = error?.userMessage || 'Could not find the current tab.';
        setStatus('error', userMessage);
        respond({ success: false, error: userMessage });
      });
    return true;
  }

  if (message.action === ACTIONS.RESEND_SUMMARY) {
    resendSummary(message.summaryId, respond);
    return true;
  }

  if (message.action === ACTIONS.PROVIDER_HANDOFF_RESULT) {
    try {
      handleProviderHandoffResult(message);
      respond({ success: true });
    } catch (error) {
      errors.logError('Could not process provider handoff result', error);
      respond({ success: false, error: 'Could not update the provider handoff status.' });
    }
    return false;
  }

  claimProviderHandoff(message, sender)
    .then(respond)
    .catch((error) => {
      errors.logError('Could not claim provider handoff', error);
      respond({
        success: false,
        error: errors.toUserMessage(error, 'Could not claim the pending provider handoff.')
      });
    });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || '';
  if (changeInfo.status === 'complete' && isPdfUrl(url)) {
    void ensurePdfShortcutContentScript(tabId);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chromeApi.tabsGet(tabId)
    .then((tab) => {
      if (isPdfUrl(tab?.url || '')) {
        void ensurePdfShortcutContentScript(tabId);
      }
    })
    .catch(error => errors.logError('Could not inspect activated tab', error));
});

void injectOpenPdfTabs();
void transcriptCache.cleanup()
  .catch(error => errors.logError('Could not maintain transcript cache', error));

async function resolveSourceTab(message, sender) {
  if (Number.isInteger(message.tabId)) {
    try {
      const tab = await chromeApi.tabsGet(message.tabId);
      if (tab) return tab;
    } catch (error) {
      const wrapped = errors.wrap(
        `Resolve tab ${message.tabId}`,
        error,
        'Could not find the current tab.'
      );
      wrapped.userMessage = 'Could not find the current tab.';
      throw wrapped;
    }
  }

  if (sender.tab) return sender.tab;

  const tabs = await chromeApi.tabsQuery({ active: true, currentWindow: true });
  if (!tabs.length) {
    const error = new Error('No active tab found.');
    error.userMessage = 'No active tab found.';
    throw error;
  }
  return tabs[0];
}

async function extractPageContent(tab, contentSource) {
  const results = await chromeApi.executeScript({
    target: { tabId: tab.id },
    func: getPageContent,
    args: [contentSource]
  });
  return results?.[0]?.result || null;
}

async function sendTranscriptStatus(tabId, status, isLoading) {
  try {
    await messages.tabsSendMessage(tabId, {
      action: ACTIONS.TRANSCRIPT_STATUS,
      status,
      isLoading
    }, {
      context: `update transcript status in tab ${tabId}`,
      timeoutMs: 3000
    });
  } catch (error) {
    // Status text is optional; extraction and handoff must continue if the
    // YouTube helper was reloaded or is no longer attached to the tab.
    console.debug('[Cindra] Transcript status update was not delivered.', error?.message || error);
  }
}

async function ensurePdfShortcutContentScript(tabId) {
  if (!Number.isInteger(tabId) || !chrome.scripting?.executeScript) return;

  try {
    const results = await chromeApi.executeScript({
      target: { tabId },
      func: isCindraContentScriptReady
    });
    if (results?.[0]?.result) return;

    await chromeApi.executeScript({
      target: { tabId },
      files: PDF_SHORTCUT_SCRIPT_FILES
    });
  } catch (error) {
    errors.logError(`Could not inject shortcut support into PDF tab ${tabId}`, error);
  }
}

function isCindraContentScriptReady() {
  return Boolean(globalThis.CindraContentScriptReady);
}

async function injectOpenPdfTabs() {
  try {
    const tabs = await chromeApi.tabsQuery({});
    for (const tab of tabs) {
      if (isPdfUrl(tab.url || '')) {
        void ensurePdfShortcutContentScript(tab.id);
      }
    }
  } catch (error) {
    errors.logError('Could not inspect open PDF tabs', error);
  }
}

function openErrorTab(message) {
  const userMessage = errors.cleanMessage(message, 'Cindra could not complete that request.');
  setStatus('error', userMessage);

  const url = new URL(chrome.runtime.getURL('ui/error/error.html'));
  url.searchParams.set('message', userMessage);
  chromeApi.tabsCreate({ url: url.href })
    .catch(error => errors.logError('Could not open error tab', error));
}
