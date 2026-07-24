const test = require('node:test');
const assert = require('node:assert/strict');
const inject = require('../../content_scripts/lib/inject.js');

test('legacy waitForCondition signature remains supported', async () => {
  let ready = false;
  setTimeout(() => { ready = true; }, 5);
  const value = await inject.waitForCondition(
    () => ready && 'ready',
    100,
    'legacy fixture'
  );
  assert.equal(value, 'ready');
});

test('waitForCondition reports bounded timeouts', async () => {
  await assert.rejects(
    () => inject.waitForCondition(() => null, {
      timeoutMs: 5,
      intervalMs: 10,
      observeRoot: null,
      description: 'fixture condition'
    }),
    error => error.name === 'TimeoutError' && /fixture condition/.test(error.message)
  );
});

test('waits and sleeps stop immediately when their abort signal fires', async () => {
  const waitController = new AbortController();
  const wait = inject.waitForCondition(() => null, {
    timeoutMs: 1000,
    intervalMs: 10,
    signal: waitController.signal,
    observeRoot: null,
    description: 'aborted fixture'
  });
  waitController.abort();
  await assert.rejects(wait, error => error.name === 'AbortError');

  const sleepController = new AbortController();
  const sleeping = inject.sleep(1000, sleepController.signal);
  sleepController.abort();
  await assert.rejects(sleeping, error => error.name === 'AbortError');
});

test('shared whitespace normalization remains stable', () => {
  assert.equal(inject.normalizeWhitespace('A  B \r\n\n\n C'), 'A B\n\n C');
});
