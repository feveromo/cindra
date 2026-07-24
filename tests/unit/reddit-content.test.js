const test = require('node:test');
const assert = require('node:assert/strict');
const reddit = require('../../content_scripts/reddit_content.js');

function element(text, attributes = {}) {
  return {
    innerText: text,
    textContent: text,
    getAttribute(name) {
      return attributes[name] || null;
    },
    querySelector(selector) {
      return attributes.children?.[selector] || null;
    },
    querySelectorAll(selector) {
      return attributes.lists?.[selector] || [];
    }
  };
}

test('Reddit extraction formats modern post content and comments', () => {
  const postBody = element('', {
    lists: {
      p: [element('First paragraph.'), element('Second paragraph.')]
    }
  });
  const comment = element('', {
    author: 'alice',
    children: {
      'div[slot="comment"]': element('Useful reply.')
    }
  });
  const documentLike = {
    querySelectorAll(selector) {
      if (selector === 'shreddit-comment') return [comment];
      return [];
    },
    querySelector(selector) {
      const values = {
        'shreddit-post [slot="title"]': element('Fixture post'),
        'shreddit-post [data-post-rtjson-content="true"]': postBody
      };
      return values[selector] || null;
    }
  };

  assert.equal(reddit.extractRedditComments(documentLike), [
    'Title: Fixture post',
    'Post Body:\nFirst paragraph.\nSecond paragraph.',
    'Comments:\nalice: Useful reply.'
  ].join('\n\n'));
});

test('Reddit extraction returns an empty string when no useful content exists', () => {
  const documentLike = {
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
  assert.equal(reddit.extractRedditComments(documentLike), '');
});
