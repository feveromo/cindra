const test = require('node:test');
const assert = require('node:assert/strict');
const content = require('../../background/content.js');
const extraction = require('../../lib/extraction.js');
const {
  ContentExtractionOrchestrator,
  extractYouTubeVideoId,
  mergeDefined
} = require('../../background/orchestrator.js');

function createHarness(overrides = {}) {
  const calls = {
    errors: [],
    handoffs: [],
    statuses: [],
    transcriptStatuses: []
  };
  const providerRegistry = {
    DEFAULT_PROVIDER: 'google-ai-studio',
    DEFAULT_CONTENT_SOURCE: 'auto',
    getProvider(id) {
      return { id: id || this.DEFAULT_PROVIDER };
    },
    getContentSource(id) {
      return { id: id || this.DEFAULT_CONTENT_SOURCE };
    }
  };
  const dependencies = {
    providerRegistry,
    storageGet: async defaults => ({ ...defaults }),
    resolveContentRoute: content.resolveContentRoute,
    isPdfUrl: content.isPdfUrl,
    normalizeText: extraction.normalizeText,
    extractPage: async (tab, source) => ({
      title: tab.title,
      url: tab.url,
      description: 'Page description',
      sourceType: source,
      content: `${source} content`
    }),
    extractPdf: async () => 'PDF body',
    extractReddit: async () => ({ success: true, content: 'Reddit thread' }),
    extractTranscript: async () => ({
      success: true,
      transcript: 'Transcript: new transcript',
      channelName: 'Channel',
      description: 'Video description'
    }),
    transcriptCache: {
      get: async () => null,
      set: async () => true
    },
    sendToModel: (...args) => calls.handoffs.push(args),
    setStatus: (...args) => calls.statuses.push(args),
    sendTranscriptStatus: async (...args) => calls.transcriptStatuses.push(args),
    openError: message => calls.errors.push(message),
    logError: (context, error) => error,
    toUserMessage: (error, fallback) => error?.userMessage || fallback,
    schedule: callback => callback(),
    ...overrides
  };

  return {
    calls,
    orchestrator: new ContentExtractionOrchestrator(dependencies)
  };
}

test('captured selections flow through normalize, format, and handoff stages', async () => {
  const { calls, orchestrator } = createHarness();
  const result = await orchestrator.run({
    id: 1,
    title: 'Example',
    url: 'https://example.test/page'
  }, {
    aiModel: 'chatgpt',
    contentSource: 'selection',
    selectedText: '  chosen   text  ',
    summaryPrompt: 'Explain this.'
  });

  assert.equal(result.success, true);
  assert.equal(result.route, 'captured-selection');
  assert.deepEqual(calls.handoffs[0], [
    'chatgpt',
    'Explain this.',
    'URL: https://example.test/page\n\nSelected Text:\nchosen text',
    'Example',
    'https://example.test/page',
    null,
    null,
    'selection'
  ]);
});

test('undefined message fields do not overwrite stored settings', async () => {
  const { orchestrator } = createHarness({
    storageGet: async defaults => ({
      ...defaults,
      aiModel: 'claude',
      contentSource: 'page'
    })
  });

  const settings = await orchestrator.normalizeSettings({
    aiModel: undefined,
    contentSource: undefined
  });

  assert.equal(settings.aiModel, 'claude');
  assert.equal(settings.contentSource, 'page');
});

test('Reddit helper delivery failures fall back to shared page extraction', async () => {
  const { calls, orchestrator } = createHarness({
    extractReddit: async () => {
      throw new Error('No receiving end');
    }
  });
  const result = await orchestrator.run({
    id: 2,
    title: 'Thread',
    url: 'https://www.reddit.com/r/test/comments/abc/thread/'
  });

  assert.equal(result.success, true);
  assert.equal(result.route, 'reddit');
  assert.equal(calls.handoffs[0][7], 'page');
  assert.match(calls.handoffs[0][2], /page content/);
});

test('cached YouTube transcripts bypass live extraction', async () => {
  let liveExtractions = 0;
  const { calls, orchestrator } = createHarness({
    transcriptCache: {
      get: async () => ({
        title: 'Cached video',
        url: 'https://www.youtube.com/watch?v=abc123',
        content: 'Transcript: cached text',
        channelName: 'Cached channel',
        description: 'Cached description'
      }),
      set: async () => true
    },
    extractTranscript: async () => {
      liveExtractions += 1;
      return { success: false };
    }
  });

  const result = await orchestrator.run({
    id: 3,
    title: 'Video - YouTube',
    url: 'https://www.youtube.com/watch?v=abc123'
  });

  assert.equal(result.success, true);
  assert.equal(liveExtractions, 0);
  assert.equal(calls.handoffs[0][2], 'Transcript: cached text');
  assert.equal(calls.handoffs[0][7], 'youtube-transcript');
});

test('empty captured pages produce one user-facing error and no handoff', async () => {
  const { calls, orchestrator } = createHarness();
  const result = await orchestrator.run({
    id: 4,
    title: 'Empty',
    url: 'https://example.test/empty'
  }, {
    capturedPageAttempted: true,
    capturedPageContent: ''
  });

  assert.equal(result.success, false);
  assert.deepEqual(calls.errors, ['No content found on the page to summarize.']);
  assert.equal(calls.handoffs.length, 0);
});

test('orchestrator helpers parse video IDs and merge only defined overrides', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=abc123'), 'abc123');
  assert.equal(extractYouTubeVideoId('https://youtu.be/abc123?t=1'), 'abc123');
  assert.equal(extractYouTubeVideoId('not a url'), '');
  assert.deepEqual(mergeDefined({ one: 1, two: 2 }, { one: undefined, two: 3 }), {
    one: 1,
    two: 3
  });
});
