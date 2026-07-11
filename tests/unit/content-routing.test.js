const test = require('node:test');
const assert = require('node:assert/strict');
const content = require('../../background/content.js');

test('recognizes direct and arXiv PDF URLs', () => {
  assert.equal(content.isPdfUrl('https://example.test/report.pdf?download=1'), true);
  assert.equal(content.isPdfUrl('https://arxiv.org/pdf/2401.12345'), true);
  assert.equal(content.isPdfUrl('https://example.test/report'), false);
});

test('selection mode falls back to extracting the live browser selection', () => {
  assert.equal(content.resolveContentRoute({ contentSource: 'selection' }), 'extract-selection');
  assert.equal(content.resolveContentRoute({ contentSource: 'selection', selectedText: 'chosen' }), 'captured-selection');
});

test('explicit and automatic source routing is deterministic', () => {
  assert.equal(content.resolveContentRoute({ capturedPageContent: 'captured' }), 'captured-page');
  assert.equal(content.resolveContentRoute({ capturedPageAttempted: true }), 'empty-captured-page');
  assert.equal(content.resolveContentRoute({ isPdf: true, isYouTube: true }), 'pdf');
  assert.equal(content.resolveContentRoute({ contentSource: 'pdf' }), 'validate-pdf');
  assert.equal(content.resolveContentRoute({ isYouTube: true }), 'youtube');
  assert.equal(content.resolveContentRoute({ isReddit: true }), 'reddit');
  assert.equal(content.resolveContentRoute({}), 'page');
});
