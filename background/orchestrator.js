(function (root, factory) {
  'use strict';

  const api = factory();
  root.CindraBackgroundOrchestrator = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_PROMPT = 'Summarize the following content in 5-10 bullet points with timestamp if it\'s transcript.';

  function createUserError(message, cause = null) {
    const error = cause instanceof Error ? cause : new Error(message);
    error.userMessage = message;
    return error;
  }

  function extractYouTubeVideoId(url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'youtu.be') {
        return parsed.pathname.split('/').filter(Boolean)[0] || '';
      }
      return parsed.searchParams.get('v') || '';
    } catch (error) {
      return '';
    }
  }

  function mergeDefined(base, overrides) {
    const merged = { ...base };
    for (const [key, value] of Object.entries(overrides || {})) {
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }

  class ContentExtractionOrchestrator {
    constructor(dependencies = {}) {
      const required = [
        'providerRegistry',
        'storageGet',
        'resolveContentRoute',
        'isPdfUrl',
        'normalizeText',
        'extractPage',
        'extractPdf',
        'extractReddit',
        'extractTranscript',
        'transcriptCache',
        'sendToModel',
        'setStatus',
        'openError'
      ];

      for (const name of required) {
        if (!dependencies[name]) {
          throw new TypeError(`ContentExtractionOrchestrator requires ${name}.`);
        }
      }

      Object.assign(this, dependencies);
      this.defaultPrompt = dependencies.defaultPrompt || DEFAULT_PROMPT;
      this.logError = dependencies.logError || ((context, error) => console.error(context, error));
      this.toUserMessage = dependencies.toUserMessage || ((error, fallback) => error?.userMessage || fallback);
      this.sendTranscriptStatus = dependencies.sendTranscriptStatus || (() => Promise.resolve());
      this.schedule = dependencies.schedule || ((callback, delay) => setTimeout(callback, delay));
    }

    async run(tab, options = {}) {
      try {
        const config = await this.normalizeSettings(options);
        this.setStatus('working', 'Extracting content...', {
          model: config.aiModel,
          title: tab?.title,
          url: tab?.url
        });

        const route = this.resolveRoute(tab, config);
        const extracted = await this.extractContent(route, tab, config);
        const formatted = this.formatContent(extracted);
        this.handoff(formatted, config);

        return {
          success: true,
          route,
          sourceType: formatted.sourceType
        };
      } catch (error) {
        const fallback = error?.message || 'Cindra could not extract content from this page.';
        const message = this.toUserMessage(error, error?.userMessage || fallback);
        this.logError('Content extraction pipeline failed', error);
        this.openError(message);
        return { success: false, error: message };
      }
    }

    async normalizeSettings(options = {}) {
      const defaults = {
        savedPrompts: [],
        activePromptId: null,
        aiModel: this.providerRegistry.DEFAULT_PROVIDER,
        contentSource: this.providerRegistry.DEFAULT_CONTENT_SOURCE
      };
      const stored = await this.storageGet(defaults);
      const config = mergeDefined(stored, options);

      config.savedPrompts = Array.isArray(config.savedPrompts) ? config.savedPrompts : [];
      config.aiModel = this.providerRegistry.getProvider(config.aiModel).id;
      config.contentSource = this.providerRegistry.getContentSource(config.contentSource).id;
      config.summaryPrompt = this.resolveSummaryPrompt(config);
      config.selectedText = typeof config.selectedText === 'string' ? config.selectedText : '';
      config.capturedPageContent = typeof config.capturedPageContent === 'string'
        ? config.capturedPageContent
        : '';
      config.capturedPageDescription = typeof config.capturedPageDescription === 'string'
        ? config.capturedPageDescription
        : '';
      config.capturedPageAttempted = Boolean(config.capturedPageAttempted);

      return config;
    }

    resolveSummaryPrompt(config) {
      if (typeof config.summaryPrompt === 'string' && config.summaryPrompt.trim()) {
        return config.summaryPrompt;
      }

      if (config.activePromptId && config.savedPrompts.length) {
        const activePrompt = config.savedPrompts.find(prompt => prompt.id === config.activePromptId);
        if (typeof activePrompt?.text === 'string' && activePrompt.text.trim()) {
          return activePrompt.text;
        }
      }

      return this.defaultPrompt;
    }

    resolveRoute(tab, config) {
      if (!tab?.url) {
        throw createUserError('No readable page URL found.');
      }

      return this.resolveContentRoute({
        contentSource: config.contentSource,
        selectedText: config.selectedText,
        capturedPageContent: config.capturedPageContent,
        capturedPageAttempted: config.capturedPageAttempted,
        isPdf: this.isPdfUrl(tab.url),
        isYouTube: tab.url.includes('youtube.com/watch'),
        isReddit: tab.url.includes('reddit.com')
      });
    }

    async extractContent(route, tab, config) {
      switch (route) {
        case 'captured-selection':
          return this.createTextResult(tab, config.selectedText, 'selection', {
            heading: 'Selected Text'
          });
        case 'extract-selection':
          return this.extractPageResult(tab, 'selection');
        case 'captured-page':
          return this.createTextResult(tab, config.capturedPageContent, 'page', {
            description: config.capturedPageDescription,
            heading: 'Content'
          });
        case 'empty-captured-page':
          throw createUserError('No content found on the page to summarize.');
        case 'pdf':
          return this.extractPdfResult(tab, config);
        case 'validate-pdf':
          return this.extractPageResult(tab, 'pdf');
        case 'youtube':
          return this.extractYouTubeResult(tab, config);
        case 'reddit':
          return this.extractRedditResult(tab, config);
        case 'page':
        default:
          return this.extractPageResult(tab, 'page');
      }
    }

    createTextResult(tab, content, sourceType, extras = {}) {
      const normalized = this.normalizeText(content);
      if (!normalized) {
        throw createUserError('No content found on the page to summarize.');
      }

      return {
        title: tab.title,
        url: tab.url,
        content: normalized,
        sourceType,
        ...extras
      };
    }

    async extractPageResult(tab, contentSource) {
      let pageData;
      try {
        pageData = await this.extractPage(tab, contentSource);
      } catch (error) {
        throw createUserError(
          'Could not read this page. Try refreshing it and running Cindra again.',
          error
        );
      }

      if (!pageData || pageData.error) {
        throw createUserError(pageData?.error || 'Could not extract content from the page.');
      }
      if (!this.normalizeText(pageData.content)) {
        throw createUserError('No content found on the page to summarize.');
      }

      return {
        title: pageData.title || tab.title,
        url: pageData.url || tab.url,
        description: pageData.description || '',
        content: pageData.content,
        sourceType: pageData.sourceType || contentSource,
        heading: pageData.sourceType === 'selection'
          ? 'Selected Text'
          : pageData.sourceType === 'pdf' ? 'PDF Text' : 'Content'
      };
    }

    async extractPdfResult(tab, config) {
      this.setStatus('working', 'Extracting PDF text...', {
        model: config.aiModel,
        title: tab.title,
        url: tab.url,
        sourceType: 'pdf'
      });

      try {
        const text = this.normalizeText(await this.extractPdf(tab));
        if (!text) {
          throw createUserError('No extractable PDF text found. Scanned PDFs need OCR.');
        }
        return this.createTextResult(tab, text, 'pdf', { heading: 'PDF Text' });
      } catch (error) {
        if (error?.userMessage) throw error;
        const detail = error?.message || 'Please refresh the PDF and try again.';
        throw createUserError(`Could not extract full PDF text. ${detail}`, error);
      }
    }

    async extractRedditResult(tab, config) {
      this.setStatus('working', 'Extracting Reddit thread...', {
        model: config.aiModel,
        title: tab.title,
        url: tab.url,
        sourceType: 'reddit-thread'
      });

      let response;
      try {
        response = await this.extractReddit(tab);
      } catch (error) {
        this.logError('Reddit helper unavailable; falling back to page text', error);
        this.setStatus('working', 'Reddit helper unavailable; using page text...', {
          model: config.aiModel,
          title: tab.title,
          url: tab.url,
          sourceType: 'page'
        });
        return this.extractPageResult(tab, 'page');
      }

      const content = this.normalizeText(response?.content);
      if (!response?.success || !content) {
        this.setStatus('working', 'Reddit content was unavailable; using page text...', {
          model: config.aiModel,
          title: tab.title,
          url: tab.url,
          sourceType: 'page'
        });
        return this.extractPageResult(tab, 'page');
      }

      return {
        title: tab.title,
        url: tab.url,
        content,
        sourceType: 'reddit-thread',
        format: 'reddit'
      };
    }

    async extractYouTubeResult(tab, config) {
      const videoId = extractYouTubeVideoId(tab.url);
      if (!videoId) {
        throw createUserError('Could not identify this YouTube video.');
      }

      this.setStatus('working', 'Checking YouTube transcript cache...', {
        model: config.aiModel,
        title: tab.title,
        url: tab.url,
        sourceType: 'youtube-transcript'
      });

      const cached = await this.transcriptCache.get(videoId);
      if (cached) {
        this.setStatus('working', 'Using cached YouTube transcript...', {
          model: config.aiModel,
          title: cached.title,
          url: cached.url,
          sourceType: 'youtube-transcript'
        });
        return {
          ...cached,
          sourceType: 'youtube-transcript',
          format: 'raw'
        };
      }

      await this.sendTranscriptStatus(tab.id, 'Extracting transcript...', true);
      this.setStatus('working', 'Extracting YouTube transcript...', {
        model: config.aiModel,
        title: tab.title,
        url: tab.url,
        sourceType: 'youtube-transcript'
      });

      let response;
      try {
        response = await this.extractTranscript(tab);
      } catch (error) {
        throw createUserError(
          'Could not extract transcript. Please refresh the page and try again.',
          error
        );
      }

      if (!response?.success) {
        const message = response?.error || 'Could not extract transcript from YouTube video.';
        await this.sendTranscriptStatus(tab.id, message, false);
        throw createUserError(message);
      }

      const transcriptData = {
        title: (tab.title || '').replace(' - YouTube', ''),
        url: tab.url,
        videoId,
        channelName: response.channelName,
        description: response.description,
        content: response.transcript
      };

      if (!this.normalizeText(transcriptData.content)) {
        await this.sendTranscriptStatus(tab.id, 'No transcript found for this video.', false);
        throw createUserError('No transcript found for this YouTube video.');
      }

      const cacheable = await this.transcriptCache.set(videoId, transcriptData);
      if (cacheable === false) {
        const message = 'Could not extract a usable transcript. This video may not have captions available.';
        await this.sendTranscriptStatus(tab.id, message, false);
        throw createUserError(message);
      }
      await this.sendTranscriptStatus(tab.id, 'Transcript extracted. Sending to AI...', true);
      this.schedule(() => {
        this.sendTranscriptStatus(tab.id, 'Transcript queued for AI.', false);
      }, 1000);

      return {
        ...transcriptData,
        sourceType: 'youtube-transcript',
        format: 'raw'
      };
    }

    formatContent(extracted) {
      if (extracted.format === 'raw') {
        return { ...extracted, formattedContent: extracted.content };
      }
      if (extracted.format === 'reddit') {
        return {
          ...extracted,
          formattedContent: `URL: ${extracted.url}\nTitle: ${extracted.title}\n\n${extracted.content}`
        };
      }

      const heading = extracted.heading || (
        extracted.sourceType === 'selection'
          ? 'Selected Text'
          : extracted.sourceType === 'pdf' ? 'PDF Text' : 'Content'
      );
      return {
        ...extracted,
        formattedContent: `URL: ${extracted.url}\n\n${heading}:\n${extracted.content}`
      };
    }

    handoff(result, config) {
      this.sendToModel(
        config.aiModel,
        config.summaryPrompt,
        result.formattedContent,
        result.title,
        result.url,
        result.channelName || null,
        result.description || null,
        result.sourceType
      );
    }
  }

  return {
    ContentExtractionOrchestrator,
    DEFAULT_PROMPT,
    createUserError,
    extractYouTubeVideoId,
    mergeDefined
  };
});
