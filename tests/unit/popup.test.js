const test = require('node:test');
const assert = require('node:assert/strict');
const { createUiHarness, flush } = require('../helpers/ui-harness');

async function setup() {
  const h = createUiHarness('ui/popup/popup.js', {
    aiModel: 'chatgpt', contentSource: 'auto', savedPrompts: [{ id: 'a', name: 'A', text: 'Prompt A' }], activePromptId: 'a'
  });
  await h.context.CindraPopup.initialize();
  return h;
}

test('summary uses visible provider even while its preference write is pending', async () => {
  const h = await setup();
  const write = h.chromeApi.storageSet;
  let release;
  h.chromeApi.storageSet = async (area, items) => {
    if (items.aiModel) await new Promise(resolve => { release = resolve; });
    return write(area, items);
  };
  h.elements.get('ai-model').value = 'claude';
  h.elements.get('ai-model').dispatch('change');
  h.elements.get('summarize-btn').dispatch('click');
  await flush();
  assert.equal(h.sync.aiModel, 'chatgpt');
  assert.equal(h.messages[0].aiModel, 'claude');
  release();
  await flush();
});

test('summary snapshots source and prompt before asynchronous tab resolution', async () => {
  const h = await setup();
  let release;
  h.chromeApi.tabsQuery = () => new Promise(resolve => { release = resolve; });
  h.elements.get('content-source').value = 'selection';
  h.elements.get('summary-prompt').value = 'Use this prompt';
  h.elements.get('summarize-btn').dispatch('click');
  h.elements.get('ai-model').value = 'claude';
  h.elements.get('content-source').value = 'pdf';
  h.elements.get('summary-prompt').value = 'Next prompt';
  release([{ id: 1, url: 'https://example.com', title: 'Fixture' }]);
  await flush();
  assert.equal(h.messages[0].aiModel, 'chatgpt');
  assert.equal(h.messages[0].contentSource, 'selection');
  assert.equal(h.messages[0].summaryPrompt, 'Use this prompt');
});

test('repeated resend clicks send once while pending and allow an intentional later retry', async () => {
  const h = await setup();
  h.local.cindraRecentSummaries = [{ id: 'summary_a', model: 'chatgpt', promptText: 'Fixture' }];
  let release;
  h.context.CindraMessages.runtimeSendMessage = message => {
    h.messages.push(message);
    return new Promise(resolve => { release = resolve; });
  };
  const button = h.elements.get('resend-last-prompt');
  button.dispatch('click');
  button.dispatch('click');
  await flush();
  assert.equal(h.messages.length, 1);
  assert.equal(button.disabled, true);
  release({ success: true });
  await flush();
  assert.equal(button.disabled, false);
  button.dispatch('click');
  await flush();
  assert.equal(h.messages.length, 2);
  release({ success: true });
  await flush();
});

test('failed resend re-enables recovery and reports its error', async () => {
  const h = await setup();
  h.local.cindraRecentSummaries = [{ id: 'summary_a', model: 'chatgpt', promptText: 'Fixture' }];
  h.context.CindraMessages.runtimeSendMessage = async () => ({ success: false, error: 'No saved prompt to resend.' });
  const button = h.elements.get('resend-last-prompt');
  button.dispatch('click');
  await flush();
  assert.equal(button.disabled, false);
  assert.equal(h.local.cindraLastStatus.state, 'error');
  assert.equal(h.local.cindraLastStatus.message, 'No saved prompt to resend.');
});

async function setupPresets() {
  const h = await setup();
  h.sync.savedPrompts.push({ id: 'b', name: 'B', text: 'Prompt B' });
  return h;
}

test('a slower earlier preset selection cannot replace a newer selection', async () => {
  const h = await setupPresets();
  const selector = h.elements.get('prompt-selector');
  const release = h.deferNextRead();
  selector.value = 'a';
  selector.dispatch('change');
  selector.value = 'b';
  selector.dispatch('change');
  await flush();
  release();
  await flush();
  assert.equal(selector.value, 'b');
  assert.equal(h.elements.get('summary-prompt').value, 'Prompt B');
  assert.equal(h.sync.activePromptId, 'b');
});

test('own active-preset notification preserves an edited handoff draft', async () => {
  const h = await setupPresets();
  const write = h.chromeApi.storageSet;
  let release;
  h.chromeApi.storageSet = async (area, items) => {
    if (items.activePromptId) await new Promise(resolve => { release = resolve; });
    return write(area, items);
  };
  const selector = h.elements.get('prompt-selector');
  selector.value = 'b';
  selector.dispatch('change');
  await flush();
  const draft = h.elements.get('summary-prompt');
  draft.value = 'My unsent edited draft';
  draft.dispatch('input');
  release();
  await flush();
  h.emitStorage({ activePromptId: { newValue: 'b' } });
  await flush();
  assert.equal(draft.value, 'My unsent edited draft');
  assert.equal(selector.value, 'b');
});

test('draft edits during a pending preset refresh are retained', async () => {
  const h = await setupPresets();
  const release = h.deferNextRead();
  h.emitStorage({ savedPrompts: { newValue: h.sync.savedPrompts } });
  const draft = h.elements.get('summary-prompt');
  draft.value = 'Typed while refreshing';
  draft.dispatch('input');
  release();
  await flush();
  assert.equal(draft.value, 'Typed while refreshing');
});

test('draft edits while resolving a selected preset are retained', async () => {
  const h = await setupPresets();
  const release = h.deferNextRead();
  h.elements.get('prompt-selector').value = 'b';
  h.elements.get('prompt-selector').dispatch('change');
  const draft = h.elements.get('summary-prompt');
  draft.value = 'Typed while selecting';
  draft.dispatch('input');
  release();
  await flush();
  assert.equal(draft.value, 'Typed while selecting');
  assert.equal(h.sync.activePromptId, 'b');
});

test('theme changes do not reset a handoff draft', async () => {
  const h = await setup();
  const draft = h.elements.get('summary-prompt');
  draft.value = 'Keep my draft';
  draft.dispatch('input');
  h.emitStorage({ theme: { newValue: 'dark' } });
  await flush();
  assert.equal(draft.value, 'Keep my draft');
});
