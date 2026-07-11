(function (root) {
  'use strict';

  const DEFAULT_PROVIDER = 'google-ai-studio';
  const DEFAULT_CONTENT_SOURCE = 'auto';

  const providers = [
    {
      id: 'google-ai-studio',
      label: 'Google AI Studio',
      targetUrl: 'https://aistudio.google.com/app/prompts/new_chat',
      pendingPromptKey: 'pendingAIStudioPrompt',
      pendingTitleKey: 'pendingAIStudioTitle',
      timestampKey: 'aiStudioPromptTimestamp',
      retryDelayMs: 400
    },
    {
      id: 'gemini',
      label: 'Gemini',
      targetUrl: 'https://gemini.google.com/app',
      pendingPromptKey: 'pendingGeminiPrompt',
      timestampKey: 'geminiPromptTimestamp',
      retryDelayMs: 1000
    },
    {
      id: 'perplexity',
      label: 'Perplexity',
      targetUrl: 'https://www.perplexity.ai/',
      pendingPromptKey: 'pendingPerplexityPrompt',
      timestampKey: 'perplexityPromptTimestamp',
      // Perplexity rejects typed queries past ~4k chars. Keep the content well
      // under that so the XML-wrapped prompt still fits after scaffolding overhead.
      maxContentChars: 3500
    },
    {
      id: 'grok',
      label: 'Grok',
      targetUrl: 'https://grok.com/',
      pendingPromptKey: 'pendingGrokPrompt',
      timestampKey: 'grokPromptTimestamp',
      retryDelayMs: 1000
    },
    {
      id: 'claude',
      label: 'Claude',
      targetUrl: 'https://claude.ai/',
      pendingPromptKey: 'pendingClaudePrompt',
      timestampKey: 'claudePromptTimestamp',
      retryDelayMs: 1000
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      targetUrl: 'https://chatgpt.com/',
      pendingPromptKey: 'pendingChatGPTPrompt',
      timestampKey: 'chatgptPromptTimestamp',
      retryDelayMs: 1000
    },
    {
      id: 'google-learning',
      label: 'Google Learning',
      targetUrl: 'https://learning.google.com/experiments/learn-about',
      pendingPromptKey: 'pendingGoogleLearningPrompt',
      timestampKey: 'googleLearningPromptTimestamp',
      reuseTab: true
    },
    {
      id: 'deepseek',
      label: 'DeepSeek',
      targetUrl: 'https://chat.deepseek.com/',
      pendingPromptKey: 'pendingDeepseekPrompt',
      timestampKey: 'deepseekPromptTimestamp',
      reuseTab: true,
      retryDelayMs: 1000
    },
    {
      id: 'glm',
      label: 'GLM (Z.AI)',
      targetUrl: 'https://chat.z.ai/',
      pendingPromptKey: 'pendingGLMPrompt',
      timestampKey: 'glmPromptTimestamp',
      reuseTab: true
    },
    {
      id: 'kimi',
      label: 'Kimi',
      targetUrl: 'https://kimi.com/',
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
      pendingPromptKey: 'pendingHuggingChatPrompt',
      timestampKey: 'huggingChatPromptTimestamp',
      reuseTab: true
    },
    {
      id: 'qwen',
      label: 'Qwen',
      targetUrl: 'https://chat.qwen.ai/',
      pendingPromptKey: 'pendingQwenPrompt',
      timestampKey: 'qwenPromptTimestamp',
      reuseTab: true,
      retryDelayMs: 1000
    },
    {
      id: 'cerebras',
      label: 'Cerebras',
      targetUrl: 'https://cloud.cerebras.ai/platform/',
      pendingPromptKey: 'pendingCerebrasPrompt',
      timestampKey: 'cerebrasPromptTimestamp',
      reuseTab: true,
      specialOpen: 'cerebras-playground',
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

  function getContentSource(id) {
    return contentSources.find(source => source.id === id) ||
      contentSources.find(source => source.id === DEFAULT_CONTENT_SOURCE);
  }

  function getPendingStorageKey(providerId) {
    return `cindraPendingHandoff:${getProvider(providerId).id}`;
  }

  const api = {
    DEFAULT_PROVIDER,
    DEFAULT_CONTENT_SOURCE,
    providers,
    contentSources,
    getProvider,
    getContentSource,
    getPendingStorageKey
  };

  root.CindraProviders = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(globalThis);
