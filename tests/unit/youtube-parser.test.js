const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../../content_scripts/lib/youtube_parser.js');

test('extracts JSON containing braces and escaped quotes inside strings', () => {
  const json = '{"text":"brace } and \\\"quote\\\"","nested":{"ok":true}}';
  assert.deepEqual(parser.extractJsonObjectAt(json, 0), {
    text: 'brace } and "quote"',
    nested: { ok: true }
  });
});

test('finds the caption-bearing player response after unrelated assignments', () => {
  const html = `
    <script>window.ytInitialPlayerResponse = {"videoDetails":{"id":"wrong"}};</script>
    <script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://captions.test"}]}}};</script>
  `;
  const result = parser.parsePlayerResponseFromHtml(html);
  assert.equal(result.captions.playerCaptionsTracklistRenderer.captionTracks[0].baseUrl, 'https://captions.test');
});

test('returns null for malformed or captionless pages', () => {
  assert.equal(parser.parsePlayerResponseFromHtml('no player data'), null);
  assert.equal(parser.parsePlayerResponseFromHtml('ytInitialPlayerResponse = {broken'), null);
});
