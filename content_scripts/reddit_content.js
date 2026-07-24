(function (root, factory) {
  'use strict';

  const api = factory();
  root.CindraRedditContent = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root.document && root.chrome?.runtime?.onMessage) {
    root.CindraRedditContentRuntime?.cleanup?.();
    root.CindraRedditContentRuntime = api.install(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function textOf(element) {
    return (element?.innerText || element?.textContent || '').trim();
  }

  function extractRedditComments(documentLike) {
    const comments = [];

    documentLike.querySelectorAll('shreddit-comment').forEach((commentElement) => {
      const author = commentElement.getAttribute('author') || '[deleted]';
      const text = textOf(commentElement.querySelector('div[slot="comment"]'));
      if (author !== '[deleted]' && text) comments.push(`${author}: ${text}`);
    });

    if (!comments.length) {
      documentLike.querySelectorAll('.thing.comment .entry').forEach((commentElement) => {
        const author = textOf(commentElement.querySelector('.tagline .author')) || '[deleted]';
        const text = textOf(commentElement.querySelector('.usertext-body .md'));
        if (author !== '[deleted]' && text) comments.push(`${author}: ${text}`);
      });
    }

    const postTitle = textOf(
      documentLike.querySelector('shreddit-post [slot="title"]') ||
      documentLike.querySelector('.thing.link .entry .title .link')
    );
    const newPostBody = documentLike.querySelector(
      'shreddit-post [data-post-rtjson-content="true"]'
    );
    const postText = newPostBody
      ? Array.from(newPostBody.querySelectorAll('p')).map(textOf).filter(Boolean).join('\n')
      : textOf(documentLike.querySelector('.thing.link .entry .expando .usertext-body .md'));

    const sections = [];
    if (postTitle) sections.push(`Title: ${postTitle}`);
    if (postText) sections.push(`Post Body:\n${postText}`);
    if (comments.length) sections.push(`Comments:\n${comments.join('\n---\n')}`);
    return sections.join('\n\n');
  }

  function install(root) {
    const errors = root.CindraErrors;
    const messages = root.CindraMessages;
    const ACTIONS = messages?.ACTIONS;
    if (!errors || !messages || !ACTIONS) {
      console.error('[Cindra] Reddit content dependencies are unavailable.');
      return { cleanup() {} };
    }

    const handleMessage = (message, sender, sendResponse) => {
      if (message?.action !== ACTIONS.EXTRACT_REDDIT_CONTENT) return false;
      const respond = messages.respondOnce(sendResponse);
      const validation = messages.validateMessage(message, [ACTIONS.EXTRACT_REDDIT_CONTENT]);
      if (!validation.ok) {
        respond({ success: false, error: validation.error });
        return false;
      }
      if (sender.id !== root.chrome.runtime.id) {
        respond({ success: false, error: 'Reddit extraction request was not trusted.' });
        return false;
      }

      try {
        const content = extractRedditComments(root.document);
        respond({
          success: Boolean(content),
          content,
          ...(content ? {} : { error: 'No Reddit post or comments were found.' })
        });
      } catch (error) {
        errors.logError('Reddit content extraction failed', error);
        respond({ success: false, error: 'Could not extract content from this Reddit page.' });
      }
      return false;
    };

    root.chrome.runtime.onMessage.addListener(handleMessage);
    return {
      cleanup() {
        root.chrome.runtime.onMessage.removeListener(handleMessage);
      }
    };
  }

  return { extractRedditComments, install, textOf };
});
