const test = require('node:test');
const assert = require('node:assert/strict');
const errors = require('../../lib/errors.js');

test('serialized diagnostics preserve structure while redacting prompt bodies', () => {
  const cause = new Error([
    '<Task>private instruction text</Task>',
    '<Content>captured private page text</Content>',
    'promptText="another private prompt"'
  ].join(' '));
  cause.code = 'E_PRIVATE';
  const wrapped = errors.wrap('Provider submission', cause, 'Could not submit the prompt.');
  const serialized = errors.serialize(wrapped);
  const json = JSON.stringify(serialized);

  assert.equal(serialized.name, 'CindraError');
  assert.equal(serialized.code, 'E_PRIVATE');
  assert.equal(serialized.cause.code, 'E_PRIVATE');
  assert.ok(serialized.stack);
  assert.match(json, /\[redacted\]/);
  assert.doesNotMatch(json, /private instruction text/);
  assert.doesNotMatch(json, /captured private page text/);
  assert.doesNotMatch(json, /another private prompt/);
});

test('debug and user messages redact sensitive XML and respect length limits', () => {
  const message = errors.debugMessage(new Error('<Content>secret body</Content> failed'));
  assert.equal(message, '<Content>[redacted]</Content> failed');

  const cleaned = errors.cleanMessage(`<Task>${'x'.repeat(500)}</Task>`, 'fallback', 40);
  assert.equal(cleaned, '<Task>[redacted]</Task>');
  assert.ok(cleaned.length <= 40);
});

test('Chrome runtime errors keep a safe cause and user-facing message', () => {
  const error = errors.fromChromeLastError(
    { message: '<Content>private tab text</Content> Port closed.' },
    'runtime message'
  );
  assert.equal(error.name, 'ChromeRuntimeError');
  assert.equal(error.userMessage, 'Cindra could not communicate with the browser.');
  assert.doesNotMatch(JSON.stringify(errors.serialize(error)), /private tab text/);
});
