const test = require('node:test');
const assert = require('node:assert/strict');
const messages = require('../../lib/messages.js');

const { ACTIONS } = messages;

test('message contracts accept compatible summarize payloads', () => {
  const result = messages.validateMessage({
    action: ACTIONS.SUMMARIZE,
    tabId: 0,
    url: 'https://example.test/page',
    contentSource: 'selection',
    selectedText: 'Chosen text'
  }, [ACTIONS.SUMMARIZE]);

  assert.deepEqual(result, { ok: true, action: ACTIONS.SUMMARIZE });
});

test('message contracts reject malformed actions, ids, and URLs', () => {
  assert.equal(messages.validateMessage(null).ok, false);
  assert.match(messages.validateMessage({ action: 'unknown' }).error, /unknown/);
  assert.match(messages.validateMessage({
    action: ACTIONS.SUMMARIZE,
    tabId: -1
  }).error, /tabId/);
  assert.match(messages.validateMessage({
    action: ACTIONS.SUMMARIZE,
    url: 'javascript:alert(1)'
  }).error, /HTTP or HTTPS/);
  assert.match(messages.validateMessage({
    action: ACTIONS.CLAIM_PROVIDER_HANDOFF,
    providerId: '../../bad',
    handoffId: 'handoff_1'
  }).error, /Provider id/);
});

test('YouTube extraction messages require a video identity and a boolean panel flag', () => {
  for (const action of [ACTIONS.EXTRACT_TRANSCRIPT, ACTIONS.READ_YOUTUBE_PAGE]) {
    assert.equal(messages.validateMessage({ action }).ok, false);
    assert.equal(messages.validateMessage({ action, videoId: '../bad' }).ok, false);
    assert.equal(messages.validateMessage({ action, videoId: 'valid-video', includePanel: 'yes' }).ok, false);
    assert.equal(messages.validateMessage({ action, videoId: 'valid-video', includePanel: true }).ok, true);
  }
});

test('prompt handoff contracts reject malformed envelopes', () => {
  assert.match(messages.validateMessage({
    action: ACTIONS.INSERT_PROMPT,
    handoff: {
      id: 'handoff_1',
      providerId: 'chatgpt',
      promptText: 'Prompt',
      createdAt: 'yesterday'
    }
  }).error, /envelope/);

  assert.match(messages.validateMessage({
    action: ACTIONS.INSERT_PROMPT,
    handoff: {
      id: 'handoff_1',
      providerId: 'chatgpt',
      promptText: 'x'.repeat(1000001),
      createdAt: Date.now()
    }
  }).error, /envelope/);

  assert.equal(messages.validateMessage({
    action: ACTIONS.INSERT_PROMPT,
    handoff: {
      id: 'handoff_1',
      providerId: 'chatgpt',
      promptText: 'Prompt',
      createdAt: Date.now()
    }
  }).ok, true);
});

test('respondOnce ignores duplicate asynchronous responses', () => {
  const responses = [];
  const respond = messages.respondOnce(value => responses.push(value));

  assert.equal(respond({ success: true }), true);
  assert.equal(respond({ success: false }), false);
  assert.deepEqual(responses, [{ success: true }]);
});

test('runtime message wrapper preserves chrome.runtime.lastError context', async () => {
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      this.lastError = { message: `No receiver for ${message.action}` };
      callback();
      this.lastError = null;
    }
  };

  await assert.rejects(
    messages.runtimeSendMessage({ action: ACTIONS.PDF_EXTRACTOR_PING }, {
      runtime,
      context: 'test ping',
      timeoutMs: 50
    }),
    error => error.name === 'ChromeRuntimeError' && /test ping/.test(error.message)
  );
});

test('runtime message wrapper rejects requests that exceed their timeout', async () => {
  const runtime = {
    sendMessage() {}
  };

  await assert.rejects(
    messages.runtimeSendMessage({ action: ACTIONS.PDF_EXTRACTOR_PING }, {
      runtime,
      context: 'slow ping',
      timeoutMs: 5
    }),
    error => error.name === 'TimeoutError' && /slow ping/.test(error.message)
  );
});
