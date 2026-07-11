const test = require('node:test');
const assert = require('node:assert/strict');
const prompt = require('../../lib/prompt.js');

test('keeps content unchanged below the limit', () => {
  assert.deepEqual(prompt.limitPromptContent('short text', 100), {
    text: 'short text',
    truncated: false,
    omittedChars: 0
  });
});

test('truncation includes its notice inside the exact character budget', () => {
  const source = 'A'.repeat(6000) + 'MIDDLE' + 'Z'.repeat(4000);
  const result = prompt.limitPromptContent(source, 1000);

  assert.equal(result.text.length, 1000);
  assert.equal(result.truncated, true);
  assert.match(result.text, /characters were omitted from the middle/);
  assert.match(result.text, /^A+/);
  assert.match(result.text, /Z+$/);
  assert.ok(result.omittedChars > 0);
});

test('buildSummaryPrompt emits stable metadata sections', () => {
  const result = prompt.buildSummaryPrompt(
    'Summarize this.',
    'First line.\nSecond line.',
    'Example',
    'https://example.test/page',
    'Example channel',
    'Description'
  );

  assert.match(result.promptText, /<Task>\nSummarize this\.\n<\/Task>/);
  assert.match(result.promptText, /<ContentTitle>\nExample\n<\/ContentTitle>/);
  assert.match(result.promptText, /<URL>\nhttps:\/\/example\.test\/page\n<\/URL>/);
  assert.match(result.promptText, /<Content>\nFirst line\. Second line\.\n<\/Content>/);
});

test('thread cleanup preserves separators and paragraph breaks', () => {
  const cleaned = prompt.cleanSummaryContent('First post.\n\nMore.\n---\nSecond post.');
  assert.equal(cleaned, 'First post.\n\nMore.\n---\nSecond post.');
});
