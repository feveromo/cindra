const test = require('node:test');
const assert = require('node:assert/strict');
const pdf = require('../../lib/pdf.js');

test('accepts only HTTP and HTTPS source URLs', () => {
  assert.equal(pdf.assertFetchablePdfUrl('https://example.test/file.pdf'), 'https://example.test/file.pdf');
  assert.throws(() => pdf.assertFetchablePdfUrl('file:///tmp/file.pdf'), /Only HTTP and HTTPS/);
  assert.throws(() => pdf.assertFetchablePdfUrl('not a url'), /invalid/);
});

test('validates the PDF signature in the leading bytes', () => {
  assert.equal(pdf.ensurePdfBytes(new TextEncoder().encode('%PDF-1.7\n')).byteLength, 9);
  assert.throws(() => pdf.ensurePdfBytes(new TextEncoder().encode('<html>')), /did not return a PDF/);
  assert.throws(() => pdf.ensurePdfBytes(new Uint8Array()), /empty file/);
});

test('streams bytes without exceeding the configured limit', async () => {
  const response = new Response(new TextEncoder().encode('%PDF-1.7\nfixture'));
  const bytes = await pdf.readResponseBytes(response, 100);
  assert.equal(new TextDecoder().decode(bytes), '%PDF-1.7\nfixture');

  const oversized = new Response(new TextEncoder().encode('%PDF-' + 'x'.repeat(100)));
  await assert.rejects(() => pdf.readResponseBytes(oversized, 20), /too large/);
});

test('normalizes extracted PDF whitespace', () => {
  assert.equal(pdf.normalizeExtractedText('A  B \r\n\n\n C'), 'A B\n\n C');
});
