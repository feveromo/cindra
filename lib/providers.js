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
      pendingTitleKey: 'pendingGeminiTitle',
      timestampKey: 'geminiPromptTimestamp',
      retryDelayMs: 1000
    },
    {
      id: 'perplexity',
      label: 'Perplexity',
      targetUrl: 'https://www.perplexity.ai/',
      pendingPromptKey: 'pendingPerplexityPrompt',
      pendingTitleKey: 'pendingPerplexityTitle',
      timestampKey: 'perplexityPromptTimestamp'
    },
    {
      id: 'grok',
      label: 'Grok',
      targetUrl: 'https://grok.com/',
      pendingPromptKey: 'pendingGrokPrompt',
      pendingTitleKey: 'pendingGrokTitle',
      timestampKey: 'grokPromptTimestamp',
      retryDelayMs: 1000
    },
    {
      id: 'claude',
      label: 'Claude',
      targetUrl: 'https://claude.ai/',
      pendingPromptKey: 'pendingClaudePrompt',
      pendingTitleKey: 'pendingClaudeTitle',
      timestampKey: 'claudePromptTimestamp',
      retryDelayMs: 1000
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      targetUrl: 'https://chatgpt.com/',
      pendingPromptKey: 'pendingChatGPTPrompt',
      pendingTitleKey: 'pendingChatGPTTitle',
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
      specialOpen: 'kimi'
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
    }
  ];

  const contentSources = [
    {
      id: 'auto',
      label: 'Best Available',
      description: 'Uses transcripts and thread extraction where available.'
    },
    {
      id: 'selection',
      label: 'Selected Text',
      description: 'Only sends the highlighted text on the current page.'
    },
    {
      id: 'page',
      label: 'Page Text',
      description: 'Sends cleaned visible text from the current page.'
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

  root.CindraProviders = {
    DEFAULT_PROVIDER,
    DEFAULT_CONTENT_SOURCE,
    providers,
    contentSources,
    getProvider,
    getContentSource
  };
})(globalThis);
