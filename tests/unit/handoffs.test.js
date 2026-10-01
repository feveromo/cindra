const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const providers = require('../../lib/providers.js');
const promptBuilder = require('../../lib/prompt.js');
const messages = require('../../lib/messages.js');

const source = fs.readFileSync(path.join(__dirname, '../../background/handoffs.js'), 'utf8');

function createHarness({ summaries = [], deliveryResponse = { success: true } } = {}) {
  const local = { cindraRecentSummaries: summaries };
  const sync = {};
  const calls = { tabs: [], statuses: [], timers: [], messages: [], errors: [] };
  const context = vm.createContext({
    chrome: { storage: { local, sync } },
    setTimeout(callback) {
      calls.timers.push(callback);
    },
    CindraChrome: {
      async storageGet(area, keys) {
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.filter(key => Object.hasOwn(area, key))
            .map(key => [key, structuredClone(area[key])]));
        }
        return { ...keys, ...structuredClone(area) };
      },
      async storageSet(area, items) {
        Object.assign(area, structuredClone(items));
        if (items.cindraLastStatus) calls.statuses.push(items.cindraLastStatus);
      },
      async storageRemove(area, keys) {
        keys.forEach(key => delete area[key]);
      },
      async tabsCreate(options) {
        calls.tabs.push(options);
        return { id: 42 };
      },
      async tabsGet(id) { return { id }; }
    },
    CindraMessages: {
      ...messages,
      async tabsSendMessage(tabId, message) {
        calls.messages.push({ tabId, message });
        return deliveryResponse;
      }
    },
    CindraErrors: {
      cleanMessage: message => message,
      logError: (message, error) => calls.errors.push({ message, error })
    }
  });
  vm.runInContext(source, context, { filename: 'background/handoffs.js' });
  const service = context.CindraBackgroundHandoffs.create({
    providerRegistry: providers,
    promptBuilder
  });
  return { service, local, calls };
}

function summary(id, promptText = id) {
  return { id, promptText, model: 'chatgpt', title: id, sourceType: 'page' };
}

async function settle() {
  await new Promise(resolve => setImmediate(resolve));
}

test('resending a missing history ID never sends an unrelated saved prompt', async () => {
  const { service, local, calls } = createHarness({ summaries: [summary('newest')] });
  const result = await new Promise(resolve => service.resendSummary('removed', resolve));
  await settle();

  assert.equal(result.success, false);
  assert.match(result.error, /No saved prompt/);
  assert.equal(calls.tabs.length, 0);
  assert.equal(local[providers.getPendingStorageKey('chatgpt')], undefined);
  assert.equal(local.cindraLastStatus.state, 'error');
});

test('resending an existing history ID preserves the selected prompt', async () => {
  const { service, local, calls } = createHarness({
    summaries: [summary('newest'), summary('selected', 'Exact selected prompt')]
  });
  const result = await new Promise(resolve => service.resendSummary('selected', resolve));
  await settle();

  assert.equal(result.success, true);
  assert.equal(calls.tabs.length, 1);
  const handoff = local[providers.getPendingStorageKey('chatgpt')];
  assert.equal(handoff.summaryId, 'selected');
  assert.equal(handoff.promptText, 'Exact selected prompt');
});

test('resending without a history ID still uses the latest prompt', async () => {
  const { service, local } = createHarness({ summaries: [summary('newest')] });
  const result = await new Promise(resolve => service.resendSummary(undefined, resolve));
  await settle();

  assert.equal(result.success, true);
  assert.equal(local[providers.getPendingStorageKey('chatgpt')].summaryId, 'newest');
});

for (const response of [
  { success: true, accepted: true },
  { success: true, accepted: true, claimedElsewhere: true }
]) {
  test(`delivery acceptance is not submission success (${JSON.stringify(response)})`, async () => {
    const { service, local, calls } = createHarness({
      summaries: [summary('pending')],
      deliveryResponse: response
    });
    await new Promise(resolve => service.resendSummary('pending', resolve));
    await settle();
    assert.equal(calls.timers.length, 1);
    calls.timers.shift()();
    await settle();

    assert.equal(calls.messages.length, 1);
    assert.equal(local.cindraLastStatus.state, 'working');
    assert.equal(calls.statuses.some(status => status.state === 'success'), false);

    const handoff = local[providers.getPendingStorageKey('chatgpt')];
    service.handleProviderHandoffResult({
      providerId: 'chatgpt', handoffId: handoff.id, summaryId: handoff.summaryId, ok: true
    });
    await settle();
    assert.equal(local.cindraLastStatus.state, 'success');
  });
}

test('a completed eager delivery reports success', async () => {
  const { service, local, calls } = createHarness({ summaries: [summary('completed')] });
  await new Promise(resolve => service.resendSummary('completed', resolve));
  await settle();
  calls.timers.shift()();
  await settle();

  assert.equal(local.cindraLastStatus.state, 'success');
  assert.match(local.cindraLastStatus.message, /Prompt submitted/);
});

test('a failed eager delivery retains its prompt and reports the error', async () => {
  const { service, local, calls } = createHarness({
    summaries: [summary('failed')],
    deliveryResponse: { success: false, error: 'Composer unavailable.' }
  });
  await new Promise(resolve => service.resendSummary('failed', resolve));
  await settle();
  calls.timers.shift()();
  await settle();

  assert.equal(local.cindraLastStatus.state, 'error');
  assert.match(local.cindraLastStatus.message, /Composer unavailable/);
  assert.equal(local[providers.getPendingStorageKey('chatgpt')].summaryId, 'failed');
});
