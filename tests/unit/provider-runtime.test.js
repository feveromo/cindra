const test = require('node:test');
const assert = require('node:assert/strict');

const storageState = {};
const removedKeys = [];
const reportedMessages = [];

function readStorage(keys) {
  if (keys === null || keys === undefined) return { ...storageState };
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys
      .filter(key => Object.hasOwn(storageState, key))
      .map(key => [key, storageState[key]]));
  }
  if (typeof keys === 'object') return { ...keys, ...storageState };
  return Object.hasOwn(storageState, keys) ? { [keys]: storageState[keys] } : {};
}

global.chrome = {
  runtime: {
    lastError: null,
    sendMessage(message, callback) {
      reportedMessages.push(message);
      callback?.({ success: true });
    },
    onMessage: {
      addListener() {},
      removeListener() {}
    }
  },
  storage: {
    local: {
      get(keys, callback) { callback(readStorage(keys)); },
      set(items, callback) {
        Object.assign(storageState, items);
        callback?.();
      },
      remove(keys, callback) {
        for (const key of [].concat(keys || [])) {
          removedKeys.push(key);
          delete storageState[key];
        }
        callback?.();
      }
    }
  }
};

const inject = require('../../content_scripts/lib/inject.js');
const runtime = require('../../content_scripts/lib/provider_runtime.js');

test('provider handoff deadlines abort work and preserve the queued envelope', async () => {
  const key = runtime.pendingStorageKey('fixture');
  const handoff = {
    id: 'legacy-fixture-timeout',
    providerId: 'fixture',
    promptText: 'Prompt',
    createdAt: Date.now()
  };
  storageState[key] = handoff;
  let observedSignal = null;

  const config = {
    providerId: 'fixture',
    providerLabel: 'Fixture',
    handoffTimeoutMs: 15,
    legacyKeys: {},
    submitPrompt: async (prompt, title, envelope, context) => {
      observedSignal = context.signal;
      await inject.sleep(1000, context.signal);
    }
  };

  await assert.rejects(
    () => runtime.processHandoff(config, handoff),
    error => error.name === 'TimeoutError' && /timed out/.test(error.message)
  );
  assert.equal(observedSignal.aborted, true);
  assert.equal(storageState[key], handoff);
  assert.equal(removedKeys.includes(key), false);
  assert.equal(reportedMessages.at(-1).ok, false);
  assert.match(reportedMessages.at(-1).error, /timed out/);
});

test('successful provider handoffs clear once and deduplicate retries', async () => {
  const key = runtime.pendingStorageKey('success-fixture');
  const handoff = {
    id: 'legacy-success-fixture-1',
    providerId: 'success-fixture',
    promptText: 'Prompt',
    createdAt: Date.now()
  };
  storageState[key] = handoff;
  let submissions = 0;
  const config = {
    providerId: 'success-fixture',
    providerLabel: 'Success Fixture',
    handoffTimeoutMs: 100,
    legacyKeys: {},
    submitPrompt: async () => { submissions += 1; }
  };

  const first = await runtime.processHandoff(config, handoff);
  const second = await runtime.processHandoff(config, handoff);

  assert.equal(first.success, true);
  assert.equal(second.duplicate, true);
  assert.equal(submissions, 1);
  assert.equal(storageState[key], undefined);
  assert.equal(removedKeys.filter(item => item === key).length >= 1, true);
});
