const test = require('node:test');
const assert = require('node:assert/strict');
const extraction = require('../../lib/extraction.js');

test('selectLargestRoot chooses the largest unique candidate without sorting', () => {
  const small = {
    innerText: 'small',
    contains: () => false
  };
  const large = {
    innerText: 'large '.repeat(100),
    contains: () => false
  };
  const body = { innerText: 'body' };
  const documentLike = {
    body,
    querySelectorAll(selector) {
      if (selector === 'main') return [small, large];
      if (selector === 'article') return [large];
      return [];
    }
  };

  assert.equal(extraction.selectLargestRoot(documentLike, ['main', 'article']), large);
});

test('readable extraction removes Cindra and page chrome before normalizing text', () => {
  const clone = {
    innerText: 'Main   content\n\n\nNavigation',
    querySelectorAll(selector) {
      assert.match(selector, /\[data-cindra-ui\]/);
      return [{
        remove() {
          clone.innerText = 'Main   content';
        }
      }];
    }
  };
  const source = {
    innerText: 'Main content Navigation',
    contains: () => false,
    cloneNode: () => clone
  };
  const documentLike = {
    body: source,
    querySelectorAll(selector) {
      return selector === 'main' ? [source] : [];
    }
  };

  assert.equal(extraction.getReadablePageText(documentLike), 'Main content');
});

test('long-page extraction preserves the beginning and ending inside the cap', () => {
  const source = 'A'.repeat(6000) + 'MIDDLE' + 'Z'.repeat(4000);
  const result = extraction.limitExtractedText(source, 1000);

  assert.equal(result.text.length, 1000);
  assert.equal(result.truncated, true);
  assert.match(result.text, /^A+/);
  assert.match(result.text, /characters were omitted from the middle/);
  assert.match(result.text, /Z+$/);
  assert.ok(result.omittedChars > 0);
});

test('page-content extraction returns normalized live selections', () => {
  const documentLike = {
    title: 'Example',
    contentType: 'text/html',
    querySelector(selector) {
      if (selector === 'meta[name="description"]') return { content: 'Description' };
      return null;
    },
    querySelectorAll: () => []
  };
  const windowLike = {
    location: { href: 'https://example.test/page' },
    getSelection: () => ({ toString: () => '  selected   text  ' })
  };

  assert.deepEqual(extraction.getPageContent(documentLike, windowLike, 'selection'), {
    title: 'Example',
    url: 'https://example.test/page',
    description: 'Description',
    sourceType: 'selection',
    content: 'selected text'
  });
});
