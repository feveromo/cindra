const test = require('node:test');
const assert = require('node:assert/strict');
const youtubeUi = require('../../content_scripts/lib/youtube_ui.js');

test('YouTube video page detection requires a watch path and video id', () => {
  assert.equal(youtubeUi.isYouTubeVideoPage({ pathname: '/watch', search: '?v=abc123' }), true);
  assert.equal(youtubeUi.isYouTubeVideoPage({ pathname: '/watch', search: '' }), false);
  assert.equal(youtubeUi.isYouTubeVideoPage({ pathname: '/shorts/abc123', search: '' }), false);
  assert.equal(youtubeUi.isYouTubeVideoPage(null), false);
});

test('YouTube transcript button validates required dependencies', () => {
  assert.throws(
    () => new youtubeUi.YouTubeTranscriptButton(),
    /requires window, document, and onCopy/
  );
});

test('YouTube transcript button exposes accessible state styles', () => {
  assert.match(youtubeUi.STYLES, /focus-visible/);
  assert.match(youtubeUi.STYLES, /prefers-reduced-motion/);
  assert.match(youtubeUi.ICONS.copy, /aria-hidden="true"/);
});
