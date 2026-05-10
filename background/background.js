importScripts('../lib/providers.js');

const providerRegistry = globalThis.CindraProviders;
const DEFAULT_PROMPT = 'Summarize the following content in 5-10 bullet points with timestamp if it\'s transcript.';
const MAX_RECENT_SUMMARIES = 5;

let kimiClaimLock = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'claimKimiPrompt') {
    claimKimiPrompt(sendResponse);
    return true;
  }

  if (message.action === 'summarize') {
    resolveSourceTab(message, sender, (tab) => {
      handleSummarize(tab, message);
    });
    return true;
  }

  if (message.action === 'resendSummary') {
    resendSummary(message.summaryId);
    return true;
  }

  return true;
});

function claimKimiPrompt(sendResponse) {
  if (kimiClaimLock) {
    sendResponse({ success: false, error: 'locked' });
    return;
  }

  kimiClaimLock = true;
  chrome.storage.local.get(['pendingKimiPrompt', 'kimiPromptTimestamp'], (state) => {
    const release = () => { kimiClaimLock = false; };

    if (chrome.runtime.lastError) {
      release();
      sendResponse({ success: false, error: chrome.runtime.lastError.message });
      return;
    }

    const prompt = state.pendingKimiPrompt;
    const ts = state.kimiPromptTimestamp || 0;
    const fresh = (Date.now() - ts) < 60000;

    if (!prompt || !fresh) {
      if (!fresh && ts) {
        chrome.storage.local.remove(['pendingKimiPrompt', 'kimiPromptTimestamp']);
      }
      release();
      sendResponse({ success: false, error: 'none' });
      return;
    }

    chrome.storage.local.remove(['pendingKimiPrompt', 'kimiPromptTimestamp'], () => {
      release();
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, prompt });
      }
    });
  });
}

function resolveSourceTab(message, sender, callback) {
  if (message.tabId) {
    chrome.tabs.get(message.tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        setStatus('error', 'Could not find the current tab.');
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

    if (config.contentSource === 'selection' && typeof config.selectedText === 'string' && config.selectedText.trim()) {
      sendCapturedSelection(tab, config);
      return;
    }

    if (config.contentSource === 'selection') {
      openErrorTab('No selected text found on this page.');
      return;
    }

    if (typeof config.capturedPageContent === 'string' && config.capturedPageContent.trim()) {
      sendCapturedPageContent(tab, config);
      return;
    }

    if (config.capturedPageAttempted) {
      openErrorTab('No content found on the page to summarize.');
      return;
    }

    if (config.contentSource === 'selection' || config.contentSource === 'page') {
      extractPageContent(tab, config, config.contentSource);
      return;
    }

    if (tab.url.includes('youtube.com/watch')) {
      extractYouTubeTranscriptWithCache(tab, config);
      return;
    }

    if (tab.url.includes('reddit.com')) {
      extractRedditContent(tab, config);
      return;
    }

    if (tab.url.toLowerCase().endsWith('.pdf')) {
      handlePdfExtraction(tab);
      return;
    }

    extractPageContent(tab, config, 'page');
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

    const heading = pageData.sourceType === 'selection' ? 'Selected Text' : 'Content';
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

function getPageContent(contentSource = 'page') {
  const title = document.title;
  const url = window.location.href;
  const description = document.querySelector('meta[name="description"]')?.content || '';
  const selection = window.getSelection?.().toString().trim() || '';

  if (contentSource === 'selection') {
    if (!selection) {
      return {
        title,
        url,
        error: 'No selected text found on this page.'
      };
    }

    return {
      title,
      url,
      description,
      sourceType: 'selection',
      content: normalizeExtractedText(selection)
    };
  }

  const mainContent = getReadablePageText();
  return {
    title,
    url,
    description,
    sourceType: 'page',
    content: mainContent
  };

  function getReadablePageText() {
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
    if (!sourceElement) return '';

    const clone = sourceElement.cloneNode(true);
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

    return normalizeExtractedText(clone.innerText || '');
  }

  function normalizeExtractedText(text) {
    return text
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }
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

    chrome.storage.local.set({ [cacheKey]: transcriptData });
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

function handlePdfExtraction(tab) {
  openErrorTab('PDF extraction is not yet implemented.');
}

function sendToSelectedModel(model, prompt, content, title, url = null, channel = null, description = null, sourceType = 'page') {
  const provider = providerRegistry.getProvider(model);
  const options = provider.id === 'chatgpt' ? { cleaner: cleanupContentFormattingChatGPT } : {};
  const { promptText, cleanedContent } = buildSummaryPrompt(prompt, content, title, url, channel, description, options);
  const recentSummary = createRecentSummary(provider.id, promptText, title, url, sourceType);

  saveRecentSummary(recentSummary);
  setStatus('working', `Opening ${provider.label}...`, {
    model: provider.id,
    title,
    url,
    sourceType,
    summaryId: recentSummary.id,
    promptLength: promptText.length,
    contentLength: cleanedContent.length
  });

  openPreparedPrompt(provider.id, promptText, title, {
    title,
    url,
    sourceType,
    summaryId: recentSummary.id
  });
}

function openPreparedPrompt(providerId, promptText, title, metadata = {}) {
  const provider = providerRegistry.getProvider(providerId);

  if (provider.specialOpen === 'kimi') {
    openKimiPreparedPrompt(provider, promptText, title, metadata);
    return;
  }

  setPendingPrompt(provider, promptText, title, () => {
    if (chrome.runtime.lastError) {
      openErrorTab(`Could not save prompt for ${provider.label}.`);
      return;
    }

    const afterOpen = (tab) => {
      setStatus('success', `Opened ${provider.label}; prompt queued.`, {
        ...metadata,
        model: provider.id,
        targetUrl: provider.targetUrl
      });

      if (provider.retryDelayMs && tab?.id) {
        setTimeout(() => {
          sendMessageWithRetry(tab.id, {
            action: 'insertPrompt',
            prompt: promptText,
            title
          }).then((success) => {
            if (!success) {
              setStatus('success', `${provider.label} will pick up the queued prompt on load.`, {
                ...metadata,
                model: provider.id,
                targetUrl: provider.targetUrl
              });
            }
          });
        }, provider.retryDelayMs);
      }
    };

    if (provider.reuseTab) {
      chrome.tabs.query({ url: provider.targetUrl + '*' }, (tabs) => {
        if (tabs.length > 0) {
          chrome.tabs.update(tabs[0].id, {
            active: true,
            url: provider.targetUrl
          }, afterOpen);
        } else {
          chrome.tabs.create({ url: provider.targetUrl, active: true }, afterOpen);
        }
      });
      return;
    }

    chrome.tabs.create({ url: provider.targetUrl, active: true }, afterOpen);
  });
}

function setPendingPrompt(provider, promptText, title, callback) {
  const payload = {
    [provider.pendingPromptKey]: promptText,
    [provider.timestampKey]: Date.now()
  };

  if (provider.pendingTitleKey) {
    payload[provider.pendingTitleKey] = title || '';
  }

  chrome.storage.local.set(payload, callback);
}

function openKimiPreparedPrompt(provider, promptText, title, metadata = {}) {
  if (!openKimiPreparedPrompt.lock) {
    openKimiPreparedPrompt.lock = { inFlight: false, ts: 0 };
  }

  const now = Date.now();
  if (openKimiPreparedPrompt.lock.inFlight && (now - openKimiPreparedPrompt.lock.ts) < 8000) {
    setStatus('working', 'Kimi handoff already in progress.', {
      ...metadata,
      model: provider.id
    });
    return;
  }

  openKimiPreparedPrompt.lock.inFlight = true;
  openKimiPreparedPrompt.lock.ts = now;

  const promptSignature = `${title || ''}::${promptText.length}`;

  chrome.storage.local.get(['kimiInFlight', 'kimiInFlightTs', 'kimiLastSignature', 'kimiLastSetAt'], (state) => {
    const nowTs = Date.now();
    const inFlight = state.kimiInFlight === true && (nowTs - (state.kimiInFlightTs || 0)) < 15000;
    const isDuplicate = state.kimiLastSignature === promptSignature && (nowTs - (state.kimiLastSetAt || 0)) < 15000;

    if (inFlight || isDuplicate) {
      setStatus('working', 'Kimi already has this prompt queued.', {
        ...metadata,
        model: provider.id
      });
      setTimeout(() => { openKimiPreparedPrompt.lock.inFlight = false; }, 500);
      return;
    }

    chrome.storage.local.set({
      [provider.pendingPromptKey]: promptText,
      [provider.timestampKey]: nowTs,
      kimiInFlight: true,
      kimiInFlightTs: nowTs,
      kimiLastSignature: promptSignature,
      kimiLastSetAt: nowTs
    }, () => {
      if (chrome.runtime.lastError) {
        openKimiPreparedPrompt.lock.inFlight = false;
        openErrorTab('Could not save prompt for Kimi.');
        return;
      }

      const release = () => {
        setTimeout(() => {
          openKimiPreparedPrompt.lock.inFlight = false;
          chrome.storage.local.set({ kimiInFlight: false });
        }, 5000);
      };

      const afterOpen = () => {
        setStatus('success', 'Opened Kimi; prompt queued.', {
          ...metadata,
          model: provider.id,
          targetUrl: provider.targetUrl
        });
        release();
      };

      chrome.tabs.query({ url: provider.targetUrl + '*' }, (tabs) => {
        if (tabs.length > 0) {
          chrome.tabs.update(tabs[0].id, {
            active: true,
            url: provider.targetUrl
          }, afterOpen);
        } else {
          chrome.tabs.create({ url: provider.targetUrl, active: true }, afterOpen);
        }
      });
    });
  });
}

function resendSummary(summaryId) {
  chrome.storage.local.get({ cindraRecentSummaries: [] }, (items) => {
    const summaries = items.cindraRecentSummaries || [];
    const summary = summaries.find(item => item.id === summaryId) || summaries[0];

    if (!summary?.promptText) {
      setStatus('error', 'No saved prompt to resend.');
      return;
    }

    const provider = providerRegistry.getProvider(summary.model);
    setStatus('working', `Resending to ${provider.label}...`, {
      model: provider.id,
      title: summary.title,
      url: summary.url,
      sourceType: summary.sourceType,
      summaryId: summary.id
    });

    openPreparedPrompt(provider.id, summary.promptText, summary.title, {
      title: summary.title,
      url: summary.url,
      sourceType: summary.sourceType,
      summaryId: summary.id
    });
  });
}

function createRecentSummary(model, promptText, title, url, sourceType) {
  return {
    id: 'summary_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    model,
    promptText,
    promptLength: promptText.length,
    title: title || 'Untitled',
    url: url || '',
    sourceType: sourceType || 'page',
    createdAt: Date.now()
  };
}

function saveRecentSummary(summary) {
  chrome.storage.local.get({ cindraRecentSummaries: [] }, (items) => {
    const summaries = [summary, ...(items.cindraRecentSummaries || [])]
      .filter((item, index, all) => all.findIndex(other => other.id === item.id) === index)
      .slice(0, MAX_RECENT_SUMMARIES);

    chrome.storage.local.set({ cindraRecentSummaries: summaries });
  });
}

function setStatus(state, message, details = {}) {
  chrome.storage.local.set({
    cindraLastStatus: {
      state,
      message,
      updatedAt: Date.now(),
      ...details
    }
  });
}

function sendMessageWithRetry(tabId, message, attempt = 1, maxAttempts = 5) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        resolve(false);
        return;
      }

      chrome.tabs.sendMessage(tabId, message, () => {
        if (chrome.runtime.lastError) {
          if (attempt < maxAttempts) {
            const retryTime = Math.min(Math.pow(2, attempt - 1) * 500, 5000);
            setTimeout(() => {
              sendMessageWithRetry(tabId, message, attempt + 1, maxAttempts).then(resolve);
            }, retryTime);
          } else {
            resolve(false);
          }
          return;
        }

        resolve(true);
      });
    });
  });
}

function cleanupContentFormatting(content) {
  if (!content) return '';

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = [];
  let protectedContent = content.replace(urlRegex, (match) => {
    const placeholder = `__URL_PLACEHOLDER_${urls.length}__`;
    urls.push(match);
    return placeholder;
  });

  protectedContent = protectedContent.replace(/Summarize\s*with\s*AI\s*\(Ctrl\+X\+X\)/g, '');

  let cleaned = protectedContent
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\u00A0/g, ' ')
    .replace(/(\r\n|\n|\r)+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([.!?])\s*/g, '$1 ')
    .replace(/([.!?])\s{2,}/g, '$1 ')
    .trim();

  urls.forEach((url, index) => {
    cleaned = cleaned.replace(`__URL_PLACEHOLDER_${index}__`, url);
  });

  return cleaned.replace(/"/g, '\\"');
}

function cleanupContentFormattingThreads(content) {
  if (!content) return '';

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = [];
  let protectedContent = content.replace(urlRegex, (match) => {
    const placeholder = `__URL_PLACEHOLDER_${urls.length}__`;
    urls.push(match);
    return placeholder;
  });

  let cleaned = protectedContent
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n---\n/g, '__POST_SEP__')
    .replace(/\n\n/g, '__BLANK_LINE__');

  cleaned = cleaned
    .replace(/(\r\n|\n|\r)+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/\s*([.!?])\s*/g, '$1 ')
    .replace(/([.!?])\s{2,}/g, '$1 ')
    .trim()
    .replace(/__BLANK_LINE__/g, '\n\n')
    .replace(/__POST_SEP__/g, '\n---\n');

  urls.forEach((url, index) => {
    cleaned = cleaned.replace(`__URL_PLACEHOLDER_${index}__`, url);
  });

  return cleaned.replace(/"/g, '\\"');
}

function cleanupContentFormattingChatGPT(content) {
  if (!content) return '';

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = [];
  let protectedContent = content.replace(urlRegex, (match) => {
    const placeholder = `__URL_PLACEHOLDER_${urls.length}__`;
    urls.push(match);
    return placeholder;
  });

  protectedContent = protectedContent.replace(/Summarize\s*with\s*AI\s*\(Ctrl\+X\+X\)/g, '');

  let cleaned = protectedContent
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]*---[ \t]*\n/g, '\n__POST_SEP__\n')
    .replace(/\n{2,}/g, '\n__PARA_BREAK__\n')
    .replace(/\n/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*([.!?])\s*/g, '$1 ')
    .replace(/([.!?])\s{2,}/g, '$1 ')
    .trim()
    .replace(/\s*__PARA_BREAK__\s*/g, '\n\n')
    .replace(/\s*__POST_SEP__\s*/g, '\n---\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  urls.forEach((url, index) => {
    cleaned = cleaned.replace(`__URL_PLACEHOLDER_${index}__`, url);
  });

  return cleaned;
}

function buildXmlSection(tagName, sectionContent) {
  const text = (sectionContent ?? '').toString().trim();
  return `<${tagName}>\n${text}\n</${tagName}>`;
}

function cleanSummaryContent(content, cleaner = null) {
  if (cleaner) {
    return cleaner(content);
  }

  return /\n---\n/.test(content)
    ? cleanupContentFormattingThreads(content)
    : cleanupContentFormatting(content);
}

function buildSummaryPrompt(prompt, content, title, url = null, channel = null, description = null, options = {}) {
  const cleanedContent = cleanSummaryContent(content, options.cleaner);
  const sections = [
    buildXmlSection('Task', prompt || ''),
    buildXmlSection('ContentTitle', title || 'N/A')
  ];

  const normalizedUrl = typeof url === 'string' ? url.trim() : '';
  const normalizedChannel = typeof channel === 'string' ? channel.trim() : '';
  const normalizedDescription = typeof description === 'string' ? description.trim() : '';

  if (normalizedUrl) {
    sections.push(buildXmlSection('URL', normalizedUrl));
  }

  if (normalizedChannel) {
    sections.push(buildXmlSection('Channel', normalizedChannel));
  }

  if (normalizedDescription) {
    sections.push(buildXmlSection('Description', normalizedDescription));
  }

  sections.push(buildXmlSection('Content', cleanedContent));

  return {
    promptText: sections.join(options.sectionSeparator || '\n\n'),
    cleanedContent
  };
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
