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

test('requires the requested video identity when recovering player data from HTML', () => {
  const html = `ytInitialPlayerResponse = {"videoDetails":{"videoId":"old-video"},"captions":{}};
    ytInitialPlayerResponse = {"videoDetails":{"videoId":"new-video"}};`;
  assert.equal(parser.parsePlayerResponseFromHtml(html, 'new-video').videoDetails.videoId, 'new-video');
  assert.equal(parser.parsePlayerResponseFromHtml(html, 'missing'), null);
});

test('caption parsing preserves word fragments, repeated words, and chronological unique cues', () => {
  const segments = parser.parseCaptions(JSON.stringify({ events: [
    { tStartMs: 4000, segs: [{ utf8: 'Last cue.' }] },
    { tStartMs: 0, segs: [{ utf8: 'Bon' }, { utf8: 'jour. I really really agree.' }] },
    { tStartMs: 4000, segs: [{ utf8: 'Last cue.' }] },
    { tStartMs: 2000 }
  ] }));
  assert.equal(segments.length, 2);
  assert.equal(parser.formatSegments(segments), 'Transcript:\n\nBonjour. I really really agree.\n\nLast cue.');
  for (const value of ['', 'not captions', '{broken', '{"events":[]}']) assert.deepEqual(parser.parseCaptions(value), []);
});

test('selects manual English, then automatic English, then a usable original-language track', () => {
  const fr = { baseUrl: 'fr', languageCode: 'fr' };
  const auto = { baseUrl: 'auto', languageCode: 'en', kind: 'asr' };
  const manual = { baseUrl: 'manual', languageCode: 'en-GB' };
  assert.equal(parser.selectTrack([fr, auto, manual]), manual);
  assert.equal(parser.selectTrack([fr, auto]), auto);
  assert.equal(parser.selectTrack([fr]), fr);
  assert.equal(parser.selectTrack([]), null);
});

test('modern and legacy transcript models parse without chapter labels; continuations are incomplete', () => {
  const response = { contents: [
    { transcriptSectionHeaderRenderer: { title: 'Do not copy this chapter' } },
    { transcriptSegmentRenderer: { startMs: '0', endMs: '1000', snippet: { runs: [{ text: 'First.' }] } } },
    { transcriptSegmentViewModel: { timestamp: '1:02:03', attributedText: { content: 'Final 日本語.' } } }
  ] };
  const parsed = parser.parseTranscriptResponse(response);
  assert.equal(parsed.complete, true);
  assert.deepEqual(parsed.segments.map(segment => segment.startMs), [0, 3723000]);
  assert.equal(parser.formatSegments(parsed.segments), 'Transcript:\n\nFirst.\n\nFinal 日本語.');
  response.contents.push({ continuationItemRenderer: {} });
  assert.equal(parser.parseTranscriptResponse(response).complete, false);
});

test('returns null for malformed or captionless pages', () => {
  assert.equal(parser.parsePlayerResponseFromHtml('no player data'), null);
  assert.equal(parser.parsePlayerResponseFromHtml('ytInitialPlayerResponse = {broken'), null);
});
