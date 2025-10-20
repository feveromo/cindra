// Content script specifically for 4chan threads
console.log('4chan content script loaded');

// Extract the entire thread as a compact, AI-friendly ThreadLog v1
function extract4chanThread() {
  try {
    const url = window.location.href;
    const title = document.title || '';

    // Find the thread container
    const thread = document.querySelector('div.thread[id^="t"], form#delform .thread');
    if (!thread) {
      return `Thread: ${title}\nURL: ${url}\nPosts: 0\n\n(No thread content found)`;
    }

    // Collect posts in DOM order
    const postContainers = Array.from(thread.querySelectorAll('div.postContainer'));
    const posts = [];
    let opPostId = '';

    for (const container of postContainers) {
      const post = container.querySelector('div.post');
      if (!post) continue;

      // Determine postId
      let postId = '';
      if (post.id && post.id.startsWith('p')) {
        postId = post.id.slice(1);
      } else {
        const postNumLink = post.querySelector('.postNum a:last-child');
        if (postNumLink && postNumLink.textContent) {
          postId = postNumLink.textContent.trim();
        }
      }

      if (!postId) continue;
      const isOp = container.classList.contains('opContainer') || post.classList.contains('op');
      if (isOp) opPostId = opPostId || postId;

      // Extract message body
      const message = post.querySelector('blockquote.postMessage');
      let body = '';
      if (message) {
        const clone = message.cloneNode(true);
        // Remove quote links like >>123 and (OP) markers inside them
        clone.querySelectorAll('a.quotelink').forEach(el => el.remove());

        // Remove any residual elements that are not core text
        clone.querySelectorAll('.abbr, .backlink, .deadlink').forEach(el => el.remove());

        // Get raw text
        body = (clone.innerText || '').replace(/\r\n/g, '\n');
      }

      // Fallback to empty body if missing
      body = body || '';

      // Strip any stray >>123 tags that may have been plain text
      body = body.replace(/(^|\s)>>\d+(?:\s*\(OP\))?/g, ' ');

      // Normalize intra-post whitespace but preserve line breaks and greentext
      body = body
        // Trim each line and collapse internal spaces
        .split('\n')
        .map(line => {
          // Preserve leading '>' for greentext lines
          const isGreen = line.trimStart().startsWith('>');
          let normalized = line.replace(/\s+/g, ' ').trim();
          if (isGreen && !normalized.startsWith('>')) {
            normalized = '>' + normalized;
          }
          return normalized;
        })
        // Collapse multiple empty lines to a single empty line
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      posts.push({ id: postId, isOp, body });
    }

    // Build ThreadLog v1
    const lines = [];
    lines.push(`Thread: ${title}`);
    lines.push(`URL: ${url}`);
    if (opPostId) lines.push(`OP: ${opPostId}`);
    lines.push(`Posts: ${posts.length}`);
    lines.push('');

    const sections = posts.map(p => {
      const header = p.isOp ? `#${p.id} [OP]` : `#${p.id}`;
      return p.body ? `${header}\n${p.body}` : header;
    });

    const content = `${lines.join('\n')}\n${sections.join('\n---\n')}`;
    return content;
  } catch (error) {
    return `Thread: ${document.title || ''}\nURL: ${window.location.href}\nPosts: 0\n\n(Extraction error: ${error.message})`;
  }
}

// Listen for messages from the background script to extract content
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extract4chanContent') {
    try {
      const content = extract4chanThread();
      sendResponse({ success: true, content });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
    return true;
  }
});


