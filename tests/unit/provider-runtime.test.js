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
      callback?.({ success: true, claimed: true });
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

test('simultaneous same-tab deliveries claim and submit a handoff only once', async () => {
  const handoff = {
    id: 'simultaneous-fixture-1',
    providerId: 'simultaneous-fixture',
    promptText: 'Submit once',
    createdAt: Date.now()
  };
  storageState[runtime.pendingStorageKey(handoff.providerId)] = handoff;
  let submissions = 0;
  const config = {
    providerId: handoff.providerId,
    providerLabel: 'Simultaneous Fixture',
    handoffTimeoutMs: 100,
    legacyKeys: {},
    submitPrompt: async () => { submissions += 1; }
  };

  const results = await Promise.all([
    runtime.processHandoff(config, handoff),
    runtime.processHandoff(config, handoff)
  ]);

  assert.equal(submissions, 1);
  assert.equal(results.every(result => result.success), true);
  assert.equal(results.filter(result => result.accepted).length, 1);
  assert.equal(reportedMessages.filter(message =>
    message.action === 'claimProviderHandoff' && message.handoffId === handoff.id).length, 1);
});

test('a failed claim releases the same-tab reservation for a later retry', async (t) => {
  const sendMessage = chrome.runtime.sendMessage;
  let claims = 0;
  t.mock.method(chrome.runtime, 'sendMessage', (message, callback) => {
    if (message.action === 'claimProviderHandoff' && claims++ === 0) {
      callback({ success: false, claimed: false, error: 'Temporary claim failure.' });
      return;
    }
    sendMessage(message, callback);
  });
  const handoff = {
    id: 'retry-claim-fixture-1',
    providerId: 'retry-claim-fixture',
    promptText: 'Retry claim',
    createdAt: Date.now()
  };
  storageState[runtime.pendingStorageKey(handoff.providerId)] = handoff;
  let submissions = 0;
  const config = {
    providerId: handoff.providerId,
    providerLabel: 'Retry Claim Fixture',
    handoffTimeoutMs: 100,
    legacyKeys: {},
    submitPrompt: async () => { submissions += 1; }
  };

  await assert.rejects(runtime.processHandoff(config, handoff), /Temporary claim failure/);
  const result = await runtime.processHandoff(config, handoff);
  assert.equal(result.success, true);
  assert.equal(submissions, 1);
});

for (const retainEnvelope of [true, false]) {
  test(`completing an older handoff preserves newer recovery keys (envelope: ${retainEnvelope})`, async () => {
    const providerId = `newer-recovery-fixture-${retainEnvelope}`;
    const key = runtime.pendingStorageKey(providerId);
    const legacyKeys = {
      prompt: `${providerId}-prompt`,
      timestamp: `${providerId}-timestamp`,
      title: `${providerId}-title`
    };
    const oldHandoff = {
      id: `${providerId}-old`, providerId, promptText: 'Old prompt', createdAt: Date.now() - 1000
    };
    const newHandoff = {
      id: `${providerId}-new`, providerId, promptText: 'New prompt', title: 'New title', createdAt: Date.now()
    };
    storageState[key] = oldHandoff;
    const config = {
      providerId,
      providerLabel: 'Newer Recovery Fixture',
      handoffTimeoutMs: 100,
      legacyKeys,
      submitPrompt: async () => {
        if (retainEnvelope) storageState[key] = newHandoff;
        else delete storageState[key];
        storageState[legacyKeys.prompt] = newHandoff.promptText;
        storageState[legacyKeys.timestamp] = newHandoff.createdAt;
        storageState[legacyKeys.title] = newHandoff.title;
      }
    };

    await runtime.processHandoff(config, oldHandoff);
    // A delayed duplicate result must not clear the newer recovery entry either.
    await runtime.processHandoff(config, oldHandoff);

    assert.equal(storageState[key], retainEnvelope ? newHandoff : undefined);
    assert.equal(storageState[legacyKeys.prompt], newHandoff.promptText);
    assert.equal(storageState[legacyKeys.timestamp], newHandoff.createdAt);
    assert.equal(storageState[legacyKeys.title], newHandoff.title);
  });
}

test('successful handoffs clear matching namespaced and legacy recovery keys', async () => {
  const providerId = 'matching-recovery-fixture';
  const key = runtime.pendingStorageKey(providerId);
  const legacyKeys = {
    prompt: `${providerId}-prompt`,
    timestamp: `${providerId}-timestamp`,
    title: `${providerId}-title`
  };
  const handoff = {
    id: `${providerId}-1`, providerId, promptText: 'Matching prompt', title: 'Matching title', createdAt: Date.now()
  };
  storageState[key] = handoff;
  storageState[legacyKeys.prompt] = handoff.promptText;
  storageState[legacyKeys.timestamp] = handoff.createdAt;
  storageState[legacyKeys.title] = handoff.title;

  await runtime.processHandoff({
    providerId,
    providerLabel: 'Matching Recovery Fixture',
    handoffTimeoutMs: 100,
    legacyKeys,
    submitPrompt: async () => {}
  }, handoff);

  for (const storageKey of [key, ...Object.values(legacyKeys)]) {
    assert.equal(storageState[storageKey], undefined);
  }
});
