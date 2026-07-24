const test = require('node:test');
const assert = require('node:assert/strict');
const cacheModule = require('../../background/transcript-cache.js');

function createStorage(initial = {}) {
  const state = { ...initial };
  return {
    state,
    async get(keys) {
      if (keys === null) return { ...state };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.map(key => [key, state[key]]));
    },
    async set(items) {
      Object.assign(state, items);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key];
    }
  };
}

function transcript(videoId) {
  return {
    videoId,
    title: videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    content: `Transcript: ${videoId} content`
  };
}

test('legacy transcript keys are adopted instead of discarded', async () => {
  const storage = createStorage({ transcript_abc123: transcript('abc123') });
  const cache = cacheModule.create({
    get: storage.get,
    set: storage.set,
    remove: storage.remove,
    now: () => 100000
  });

  await cache.cleanup();
  assert.deepEqual(await cache.get('abc123'), transcript('abc123'));
  assert.deepEqual(storage.state[cacheModule.METADATA_KEY].entries.abc123, {
    cachedAt: 100000,
    lastAccessedAt: 100000
  });
});

test('cache rejects manual transcript instructions and clears poisoned entries', async () => {
  const storage = createStorage();
  const cache = cacheModule.create({
    get: storage.get,
    set: storage.set,
    remove: storage.remove,
    now: () => 200000
  });

  const accepted = await cache.set('abc123', {
    ...transcript('abc123'),
    content: 'To access the transcript manually, open YouTube captions.'
  });

  assert.equal(accepted, false);
  assert.equal(storage.state.transcript_abc123, undefined);
});

test('cache expires stale entries and enforces its LRU entry cap', async () => {
  const storage = createStorage();
  let now = 1000;
  const cache = cacheModule.create({
    get: storage.get,
    set: storage.set,
    remove: storage.remove,
    now: () => now,
    maxEntries: 2,
    ttlMs: 100
  });

  await cache.set('video01', transcript('video01'));
  now += 10;
  await cache.set('video02', transcript('video02'));
  now += 10;
  await cache.set('video03', transcript('video03'));

  assert.equal(storage.state.transcript_video01, undefined);
  assert.ok(storage.state.transcript_video02);
  assert.ok(storage.state.transcript_video03);

  now += 101;
  assert.equal(await cache.get('video03'), null);
  assert.equal(storage.state.transcript_video03, undefined);
});
