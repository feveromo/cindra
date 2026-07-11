importScripts('../lib/providers.js', '../lib/prompt.js', '../lib/pdf.js', 'content.js', 'pdf.js', 'handoffs.js');

const providerRegistry = globalThis.CindraProviders;
const promptBuilder = globalThis.CindraPrompt;
const backgroundContent = globalThis.CindraBackgroundContent;
const pdfService = globalThis.CindraBackgroundPdf;
const { isPdfUrl, resolveContentRoute, getPageContent } = backgroundContent;
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
const DEFAULT_PROMPT = 'Summarize the following content in 5-10 bullet points with timestamp if it\'s transcript.';
const PDF_SHORTCUT_SCRIPT_FILES = [
  'lib/providers.js',
  'content_scripts/lib/inject.js',
  'content_scripts/content.js'
];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'summarize') {
    resolveSourceTab(message, sender, (tab, error) => {
      if (!tab) {
        sendResponse({ success: false, error });
        return;
      }
      sendResponse({ success: true, accepted: true });
      handleSummarize(tab, message);
    });
    return true;
  }

  if (message.action === 'resendSummary') {
    resendSummary(message.summaryId, sendResponse);
    return true;
  }

  if (message.action === 'providerHandoffResult') {
    handleProviderHandoffResult(message);
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'claimProviderHandoff') {
    claimProviderHandoff(message, sender)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  }

  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || '';
  if (changeInfo.status === 'complete' && isPdfUrl(url)) {
    ensurePdfShortcutContentScript(tabId);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !isPdfUrl(tab?.url || '')) {
      return;
    }

    ensurePdfShortcutContentScript(tabId);
  });
});

injectOpenPdfTabs();

function resolveSourceTab(message, sender, callback) {
  if (message.tabId) {
    chrome.tabs.get(message.tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        setStatus('error', 'Could not find the current tab.');
        callback(null, 'Could not find the current tab.');
        return;
      }
      callback(tab);
    });
    return;
  }

  if (sender.tab) {
    callback(sender.tab);
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) {
      setStatus('error', 'No active tab found.');
      callback(null, 'No active tab found.');
      return;
    }
    callback(tabs[0]);
  });
}

function handleSummarize(tab, options = {}) {
  if (!tab?.url) {
    setStatus('error', 'No readable page URL found.');
    return;
  }

  chrome.storage.sync.get({
    savedPrompts: [],
    activePromptId: null,
    aiModel: providerRegistry.DEFAULT_PROVIDER,
    contentSource: providerRegistry.DEFAULT_CONTENT_SOURCE
  }, (settings) => {
    const config = {
      ...settings,
      ...options
    };

    config.aiModel = providerRegistry.getProvider(config.aiModel).id;
    config.contentSource = providerRegistry.getContentSource(config.contentSource).id;
    config.summaryPrompt = resolveSummaryPrompt(config);

    setStatus('working', 'Extracting content...', {
      model: config.aiModel,
      title: tab.title,
      url: tab.url
    });

    const route = resolveContentRoute({
      contentSource: config.contentSource,
      selectedText: typeof config.selectedText === 'string' ? config.selectedText : '',
      capturedPageContent: typeof config.capturedPageContent === 'string' ? config.capturedPageContent : '',
      capturedPageAttempted: Boolean(config.capturedPageAttempted),
      isPdf: isPdfUrl(tab.url),
      isYouTube: tab.url.includes('youtube.com/watch'),
      isReddit: tab.url.includes('reddit.com')
    });

    if (route === 'captured-selection') return sendCapturedSelection(tab, config);
    if (route === 'extract-selection') return extractPageContent(tab, config, 'selection');
    if (route === 'captured-page') return sendCapturedPageContent(tab, config);
    if (route === 'empty-captured-page') return openErrorTab('No content found on the page to summarize.');
    if (route === 'pdf') return extractPdfContent(tab, config);
    if (route === 'validate-pdf') return extractPageContent(tab, config, 'pdf');
    if (route === 'youtube') return extractYouTubeTranscriptWithCache(tab, config);
    if (route === 'reddit') return extractRedditContent(tab, config);
    return extractPageContent(tab, config, 'page');
  });
}

function ensurePdfShortcutContentScript(tabId) {
  if (!tabId || !chrome.scripting?.executeScript) {
    return;
  }

  chrome.scripting.executeScript({
    target: { tabId },
    function: isCindraContentScriptReady
  }, (results) => {
    if (chrome.runtime.lastError) {
      console.warn('Could not inspect PDF tab for Cindra shortcut support:', chrome.runtime.lastError.message);
      return;
    }

    if (results?.[0]?.result) {
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId },
      files: PDF_SHORTCUT_SCRIPT_FILES
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn('Could not inject Cindra shortcut support into PDF tab:', chrome.runtime.lastError.message);
      }
    });
  });
}

function isCindraContentScriptReady() {
  return Boolean(globalThis.CindraContentScriptReady);
}

function injectOpenPdfTabs() {
  chrome.tabs.query({}, (tabs) => {
    if (chrome.runtime.lastError) {
      return;
    }

    tabs.forEach((tab) => {
      if (isPdfUrl(tab.url || '')) {
        ensurePdfShortcutContentScript(tab.id);
      }
    });
  });
}

function sendCapturedPageContent(tab, config) {
  const pageContent = normalizeCapturedText(config.capturedPageContent);
  const formattedContent = `URL: ${tab.url}\n\nContent:\n${pageContent}`;

  sendToSelectedModel(
    config.aiModel,
    config.summaryPrompt,
    formattedContent,
    tab.title,
    tab.url,
    null,
    config.capturedPageDescription,
    'page'
  );
}

function sendCapturedSelection(tab, config) {
  const selectedText = normalizeCapturedText(config.selectedText);
  const formattedContent = `URL: ${tab.url}\n\nSelected Text:\n${selectedText}`;

  sendToSelectedModel(
    config.aiModel,
    config.summaryPrompt,
    formattedContent,
    tab.title,
    tab.url,
    null,
    null,
    'selection'
  );
}

function normalizeCapturedText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function resolveSummaryPrompt(config) {
  if (config.summaryPrompt) {
    return config.summaryPrompt;
  }

  if (config.activePromptId && config.savedPrompts.length > 0) {
    const activePrompt = config.savedPrompts.find(p => p.id === config.activePromptId);
    if (activePrompt) {
      return activePrompt.text;
    }
  }

  return DEFAULT_PROMPT;
}

function extractYouTubeTranscriptWithCache(tab, config) {
  const videoId = new URLSearchParams(new URL(tab.url).search).get('v');
  const cacheKey = `transcript_${videoId}`;

  setStatus('working', 'Checking YouTube transcript cache...', {
    model: config.aiModel,
    title: tab.title,
    url: tab.url,
    sourceType: 'youtube-transcript'
  });

  chrome.storage.local.get([cacheKey], (result) => {
    if (result[cacheKey]) {
      const transcriptData = result[cacheKey];
      setStatus('working', 'Using cached YouTube transcript...', {
        model: config.aiModel,
        title: transcriptData.title,
        url: transcriptData.url,
        sourceType: 'youtube-transcript'
      });
      sendToSelectedModel(
        config.aiModel,
        config.summaryPrompt,
        transcriptData.content,
        transcriptData.title,
        transcriptData.url,
        transcriptData.channelName,
        transcriptData.description,
        'youtube-transcript'
      );
      return;
    }

    extractYouTubeTranscript(tab, config, cacheKey, videoId);
  });
}

function extractPageContent(tab, config, contentSource) {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: getPageContent,
    args: [contentSource]
  }, (results) => {
    if (chrome.runtime.lastError) {
      openErrorTab('Could not read this page. Try refreshing it and running Cindra again.');
      return;
    }

    const pageData = results?.[0]?.result;
    if (!pageData || pageData.error) {
      openErrorTab(pageData?.error || 'Could not extract content from the page.');
      return;
    }

    if (!pageData.content || pageData.content.trim() === '') {
      openErrorTab('No content found on the page to summarize.');
      return;
    }

    const heading = pageData.sourceType === 'selection'
      ? 'Selected Text'
      : pageData.sourceType === 'pdf' ? 'PDF Text' : 'Content';
    const formattedContent = `URL: ${pageData.url}\n\n${heading}:\n${pageData.content}`;

    sendToSelectedModel(
      config.aiModel,
      config.summaryPrompt,
      formattedContent,
      pageData.title,
      pageData.url,
      null,
      pageData.description,
      pageData.sourceType
    );
  });
}

async function extractPdfContent(tab, config) {
  setStatus('working', 'Extracting PDF text...', {
    model: config.aiModel,
    title: tab.title,
    url: tab.url,
    sourceType: 'pdf'
  });

  try {
    const pdfText = await pdfService.extractFullText(tab);
    if (!pdfText) {
      openErrorTab('No extractable PDF text found. Scanned PDFs need OCR.');
      return;
    }

    const formattedContent = `URL: ${tab.url}\n\nPDF Text:\n${pdfText}`;
    sendToSelectedModel(
      config.aiModel,
      config.summaryPrompt,
      formattedContent,
      tab.title,
      tab.url,
      null,
      null,
      'pdf'
    );
  } catch (error) {
    console.warn('PDF extraction failed.', error);
    openErrorTab(`Could not extract full PDF text. ${error?.message || 'Please refresh the PDF and try again.'}`);
  }
}

function extractRedditContent(tab, config) {
  setStatus('working', 'Extracting Reddit thread...', {
    model: config.aiModel,
    title: tab.title,
    url: tab.url,
    sourceType: 'reddit-thread'
  });

  chrome.tabs.sendMessage(tab.id, {
    action: 'extractRedditContent'
  }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus('working', 'Reddit helper unavailable; using page text...', {
        model: config.aiModel,
        title: tab.title,
        url: tab.url,
        sourceType: 'page'
      });
      extractPageContent(tab, config, 'page');
      return;
    }

    if (!response || !response.success) {
      openErrorTab(response?.error || 'Could not extract content from Reddit page.');
      return;
    }

    const redditContent = response.content;
    if (!redditContent || redditContent.trim() === '') {
      openErrorTab('No content found on the Reddit page to summarize.');
      return;
    }

    const formattedContent = `URL: ${tab.url}\nTitle: ${tab.title}\n\n${redditContent}`;
    sendToSelectedModel(
      config.aiModel,
      config.summaryPrompt,
      formattedContent,
      tab.title,
      tab.url,
      null,
      null,
      'reddit-thread'
    );
  });
}

function extractYouTubeTranscript(tab, config, cacheKey, videoId) {
  chrome.tabs.sendMessage(tab.id, {
    action: 'transcriptStatus',
    status: 'Extracting transcript...',
    isLoading: true
  });

  setStatus('working', 'Extracting YouTube transcript...', {
    model: config.aiModel,
    title: tab.title,
    url: tab.url,
    sourceType: 'youtube-transcript'
  });

  chrome.tabs.sendMessage(tab.id, {
    action: 'extractTranscript'
  }, (response) => {
    if (chrome.runtime.lastError) {
      openErrorTab('Could not extract transcript. Please refresh the page and try again.');
      return;
    }

    if (!response || !response.success) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'transcriptStatus',
        status: response?.error || 'Could not extract transcript. Please try again.',
        isLoading: false
      });
      openErrorTab(response?.error || 'Could not extract transcript from YouTube video.');
      return;
    }

    const transcriptData = {
      title: tab.title.replace(' - YouTube', ''),
      url: tab.url,
      videoId,
      channelName: response.channelName,
      description: response.description,
      content: response.transcript
    };

    if (!transcriptData.content || transcriptData.content.trim() === '') {
      chrome.tabs.sendMessage(tab.id, {
        action: 'transcriptStatus',
        status: 'No transcript found for this video.',
        isLoading: false
      });
      openErrorTab('No transcript found for this YouTube video.');
      return;
    }

    // Only cache genuine transcripts. The extractor also returns a long
    // "manual instructions" block when captions are unavailable, and caching
    // that would poison every retry for the same video. Real transcripts always
    // begin with the "Transcript:" header set by the per-source formatters.
    if (/^Transcript:\s/.test(transcriptData.content.trim())) {
      chrome.storage.local.set({ [cacheKey]: transcriptData });
    } else {
      chrome.storage.local.remove(cacheKey);
    }
    chrome.tabs.sendMessage(tab.id, {
      action: 'transcriptStatus',
      status: 'Transcript extracted. Sending to AI...',
      isLoading: true
    });

    sendToSelectedModel(
      config.aiModel,
      config.summaryPrompt,
      transcriptData.content,
      transcriptData.title,
      transcriptData.url,
      transcriptData.channelName,
      transcriptData.description,
      'youtube-transcript'
    );

    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'transcriptStatus',
        status: 'Transcript queued for AI.',
        isLoading: false
      });
    }, 1000);
  });
}

function openErrorTab(message) {
  setStatus('error', message);

  try {
    const escapedMessage = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Cindra Summary Error</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #f8f9fa;
            color: #202124;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
          }
          .error-container {
            background-color: white;
            border: 1px solid #dadce0;
            padding: 24px;
            max-width: 500px;
            text-align: center;
          }
          h1 {
            color: #d93025;
            font-size: 24px;
            margin-bottom: 16px;
          }
          p {
            margin-bottom: 24px;
            line-height: 1.5;
          }
          button {
            background-color: #202124;
            color: white;
            border: none;
            padding: 10px 20px;
            font-weight: 600;
            cursor: pointer;
          }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h1>Error</h1>
          <p>${escapedMessage}</p>
          <button onclick="window.close()">Close</button>
        </div>
      </body>
      </html>
    `;

    chrome.tabs.create({
      url: 'data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml)
    });
  } catch (error) {
    console.error('Failed to open error tab:', error);
  }
}
