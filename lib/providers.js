(function (root) {
  'use strict';

  const DEFAULT_PROVIDER = 'google-ai-studio';
  const DEFAULT_CONTENT_SOURCE = 'auto';
  const PROVIDER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  const providers = [
    {
      id: 'google-ai-studio',
      label: 'Google AI Studio',
      targetUrl: 'https://aistudio.google.com/app/prompts/new_chat',
      contentScript: {
        matches: ['*://aistudio.google.com/*'],
        file: 'content_scripts/ai_studio_content.js'
      },
      pendingPromptKey: 'pendingAIStudioPrompt',
      pendingTitleKey: 'pendingAIStudioTitle',
      timestampKey: 'aiStudioPromptTimestamp',
      startupDelayMs: 800,
      retryDelayMs: 400
    },
    {
      id: 'gemini',
      label: 'Gemini',
      targetUrl: 'https://gemini.google.com/app',
      contentScript: {
        matches: ['https://gemini.google.com/app/*'],
        file: 'content_scripts/gemini_content.js'
      },
      pendingPromptKey: 'pendingGeminiPrompt',
      timestampKey: 'geminiPromptTimestamp',
      retryDelayMs: 1000
    },
    {
      id: 'perplexity',
      label: 'Perplexity',
      targetUrl: 'https://www.perplexity.ai/',
      contentScript: {
        matches: ['*://*.perplexity.ai/*'],
        file: 'content_scripts/perplexity_content.js'
      },
      pendingPromptKey: 'pendingPerplexityPrompt',
      timestampKey: 'perplexityPromptTimestamp',
      startupDelayMs: 500,
      // Perplexity rejects typed queries past ~4k chars. Keep the content well
      // under that so the XML-wrapped prompt still fits after scaffolding overhead.
      maxContentChars: 3500
    },
    {
      id: 'grok',
      label: 'Grok',
      targetUrl: 'https://grok.com/',
      contentScript: {
        matches: ['*://grok.com/*'],
        file: 'content_scripts/grok_content.js'
      },
      pendingPromptKey: 'pendingGrokPrompt',
      timestampKey: 'grokPromptTimestamp',
      startupDelayMs: 1000,
      retryDelayMs: 1000
    },
    {
      id: 'claude',
      label: 'Claude',
      targetUrl: 'https://claude.ai/',
      contentScript: {
        matches: ['*://claude.ai/*'],
        file: 'content_scripts/claude_content.js'
      },
      pendingPromptKey: 'pendingClaudePrompt',
      timestampKey: 'claudePromptTimestamp',
      startupDelayMs: 1000,
      retryDelayMs: 1000
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      targetUrl: 'https://chatgpt.com/',
      contentScript: {
        matches: [
          '*://chat.openai.com/*',
          '*://chatgpt.com/*',
          '*://chat.com/*'
        ],
        file: 'content_scripts/chatgpt_content.js'
      },
      pendingPromptKey: 'pendingChatGPTPrompt',
      timestampKey: 'chatgptPromptTimestamp',
      startupDelayMs: 1000,
      retryDelayMs: 1000
    },
    {
      id: 'google-learning',
      label: 'Google Learning',
      targetUrl: 'https://learning.google.com/experiments/learn-about',
      contentScript: {
        matches: ['https://learning.google.com/experiments/learn-about*'],
        file: 'content_scripts/google_learning_content.js'
      },
      pendingPromptKey: 'pendingGoogleLearningPrompt',
      timestampKey: 'googleLearningPromptTimestamp',
      reuseTab: true
    },
    {
      id: 'deepseek',
      label: 'DeepSeek',
      targetUrl: 'https://chat.deepseek.com/',
      contentScript: {
        matches: ['https://chat.deepseek.com/*'],
        file: 'content_scripts/deepseek_content.js'
      },
      pendingPromptKey: 'pendingDeepseekPrompt',
      timestampKey: 'deepseekPromptTimestamp',
      reuseTab: true,
      startupDelayMs: 1000,
      retryDelayMs: 1000
    },
    {
      id: 'glm',
      label: 'GLM (Z.AI)',
      targetUrl: 'https://chat.z.ai/',
      contentScript: {
        matches: ['https://chat.z.ai/*'],
        file: 'content_scripts/glm_content.js'
      },
      pendingPromptKey: 'pendingGLMPrompt',
      timestampKey: 'glmPromptTimestamp',
      reuseTab: true
    },
    {
      id: 'kimi',
      label: 'Kimi',
      targetUrl: 'https://kimi.com/',
      contentScript: {
        matches: [
          'https://kimi.com/*',
          'https://www.kimi.com/*'
        ],
        file: 'content_scripts/kimi_content.js'
      },
      pendingPromptKey: 'pendingKimiPrompt',
      timestampKey: 'kimiPromptTimestamp',
      reuseTab: true,
      // Kimi converts pasted content above ~4 KB into a txt attachment.
      maxContentChars: 3000
    },
    {
      id: 'huggingchat',
      label: 'HuggingChat',
      targetUrl: 'https://huggingface.co/chat/',
      contentScript: {
        matches: ['https://huggingface.co/chat/*'],
        file: 'content_scripts/huggingchat_content.js'
      },
      pendingPromptKey: 'pendingHuggingChatPrompt',
      timestampKey: 'huggingChatPromptTimestamp',
      reuseTab: true
    },
    {
      id: 'qwen',
      label: 'Qwen',
      targetUrl: 'https://chat.qwen.ai/',
      contentScript: {
        matches: ['https://chat.qwen.ai/*'],
        file: 'content_scripts/qwen_content.js'
      },
      pendingPromptKey: 'pendingQwenPrompt',
      timestampKey: 'qwenPromptTimestamp',
      reuseTab: true,
      retryDelayMs: 1000
    },
    {
      id: 'cerebras',
      label: 'Cerebras',
      targetUrl: 'https://chat.cerebras.ai/',
      contentScript: {
        matches: ['https://chat.cerebras.ai/*'],
        file: 'content_scripts/cerebras_content.js'
      },
      pendingPromptKey: 'pendingCerebrasPrompt',
      timestampKey: 'cerebrasPromptTimestamp',
      reuseTab: true,
      retryDelayMs: 1000,
      // Cerebras rejects oversized single messages before submission.
      maxContentChars: 12000
    }
  ];

  const contentSources = [
    {
      id: 'auto',
      label: 'Best Available'
    },
    {
      id: 'selection',
      label: 'Selected Text'
    },
    {
      id: 'page',
      label: 'Page Text'
    },
    {
      id: 'pdf',
      label: 'PDF Text'
    }
  ];

  function getProvider(id) {
    return providers.find(provider => provider.id === id) ||
      providers.find(provider => provider.id === DEFAULT_PROVIDER);
  }

  function getProviderStrict(id) {
    return providers.find(provider => provider.id === id) || null;
  }

  function getContentSource(id) {
    return contentSources.find(source => source.id === id) ||
      contentSources.find(source => source.id === DEFAULT_CONTENT_SOURCE);
  }

  function getContentSourceStrict(id) {
    return contentSources.find(source => source.id === id) || null;
  }

  function getPendingStorageKey(providerId) {
    return `cindraPendingHandoff:${getProvider(providerId).id}`;
  }

  function getLegacyStorageKeys(providerId) {
    const provider = getProviderStrict(providerId);
    if (!provider) return {};

    return {
      prompt: provider.pendingPromptKey,
      timestamp: provider.timestampKey,
      ...(provider.pendingTitleKey ? { title: provider.pendingTitleKey } : {})
    };
  }

  function matchPatternToRegExp(pattern) {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/^\*:\\\/\\\//, 'https?:\\/\\/')
      .replace(/\\\*\\\./g, '(?:[^./]+\\.)*')
      .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
  }

  function providerMatchesUrl(provider, url) {
    if (!provider?.contentScript?.matches || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      return provider.contentScript.matches.some(pattern => matchPatternToRegExp(pattern).test(parsed.href));
    } catch (error) {
      return false;
    }
  }

  function findProviderForUrl(url) {
    return providers.find(provider => providerMatchesUrl(provider, url)) || null;
  }

  function validateRegistry() {
    const errors = [];
    const providerIds = new Set();
    const contentSourceIds = new Set();
    const storageKeys = new Set();

    providers.forEach((provider, index) => {
      const prefix = `providers[${index}]`;
      if (!PROVIDER_ID_PATTERN.test(provider.id || '')) {
        errors.push(`${prefix}.id is invalid.`);
      } else if (providerIds.has(provider.id)) {
        errors.push(`${prefix}.id duplicates ${provider.id}.`);
      }
      providerIds.add(provider.id);

      try {
        const targetUrl = new URL(provider.targetUrl);
        if (targetUrl.protocol !== 'https:') {
          errors.push(`${provider.id}.targetUrl must use HTTPS.`);
        }
      } catch (error) {
        errors.push(`${provider.id}.targetUrl is invalid.`);
      }

      if (!provider.contentScript?.file?.endsWith('_content.js')) {
        errors.push(`${provider.id}.contentScript.file is invalid.`);
      }
      if (!Array.isArray(provider.contentScript?.matches) || !provider.contentScript.matches.length) {
        errors.push(`${provider.id}.contentScript.matches is empty.`);
      }

      [provider.pendingPromptKey, provider.pendingTitleKey, provider.timestampKey]
        .filter(Boolean)
        .forEach((key) => {
          if (storageKeys.has(key)) errors.push(`${provider.id} duplicates storage key ${key}.`);
          storageKeys.add(key);
        });
    });

    contentSources.forEach((source, index) => {
      if (!PROVIDER_ID_PATTERN.test(source.id || '')) {
        errors.push(`contentSources[${index}].id is invalid.`);
      } else if (contentSourceIds.has(source.id)) {
        errors.push(`contentSources[${index}].id duplicates ${source.id}.`);
      }
      contentSourceIds.add(source.id);
    });

    if (!providerIds.has(DEFAULT_PROVIDER)) errors.push('DEFAULT_PROVIDER is not registered.');
    if (!contentSourceIds.has(DEFAULT_CONTENT_SOURCE)) errors.push('DEFAULT_CONTENT_SOURCE is not registered.');
    return errors;
  }

  const api = {
    DEFAULT_PROVIDER,
    DEFAULT_CONTENT_SOURCE,
    providers,
    contentSources,
    getProvider,
    getProviderStrict,
    getContentSource,
    getContentSourceStrict,
    getPendingStorageKey,
    getLegacyStorageKeys,
    providerMatchesUrl,
    findProviderForUrl,
    validateRegistry
  };

  root.CindraProviders = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(globalThis);
