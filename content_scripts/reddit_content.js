console.log('Reddit content script loaded');

function extractRedditComments() {
  const comments = [];
  const commentElements = document.querySelectorAll('shreddit-comment');

  commentElements.forEach(commentElement => {
    try {
      const author = commentElement.getAttribute('author') || '[deleted]';

      const textElement = commentElement.querySelector('div[slot="comment"]');
      const text = textElement ? textElement.innerText.trim() : '';

      if (author !== '[deleted]' && text !== '') {
        comments.push(`${author}: ${text}`);
      }
    } catch (error) {
      console.error('Error extracting shreddit-comment:', error);
    }
  });

  // Support old.reddit.com and old-style comment markup as a fallback.
  if (comments.length === 0) {
      const oldCommentElements = document.querySelectorAll('.thing.comment .entry');
      oldCommentElements.forEach(commentElement => {
          try {
              const authorElement = commentElement.querySelector('.tagline .author');
              const author = authorElement ? authorElement.innerText : '[deleted]';
              const textElement = commentElement.querySelector('.usertext-body .md');
              const text = textElement ? textElement.innerText.trim() : '';

              if (author !== '[deleted]' && text !== '') {
                comments.push(`${author}: ${text}`);
              }
          } catch (error) {
              console.error('Error extracting old Reddit comment:', error);
          }
      });
  }


  let postTitle = '';
  let postText = '';
  try {
    const titleElementNew = document.querySelector('shreddit-post [slot="title"]');
    if (titleElementNew) {
        postTitle = titleElementNew.innerText.trim();
    } else {
        const titleElementOld = document.querySelector('.thing.link .entry .title .link');
        if (titleElementOld) {
            postTitle = titleElementOld.innerText.trim();
        }
    }

    const postBodyContainerNew = document.querySelector('shreddit-post [data-post-rtjson-content="true"]');
     if (postBodyContainerNew) {
         const paragraphs = postBodyContainerNew.querySelectorAll('p');
         postText = Array.from(paragraphs).map(p => p.innerText).join('\n').trim();
    } else {
        const textElementOld = document.querySelector('.thing.link .entry .expando .usertext-body .md');
         if (textElementOld) {
          postText = textElementOld.innerText.trim();
        }
    }
  } catch (error) {
    console.error('Error extracting post title/text:', error);
  }

  const formattedContent = [];
  if (postTitle) {
      formattedContent.push(`Title: ${postTitle}`);
  }
  if (postText) {
      formattedContent.push(`Post Body:\n${postText}`);
  }
  if(postTitle || postText){
      formattedContent.push('');
  }

  if (comments.length > 0) {
    formattedContent.push('Comments:');
    formattedContent.push(comments.join('\n---\n'));
  } else {
    formattedContent.push('No comments found or extracted.');
  }

  return formattedContent.join('\n');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractRedditContent') {
    console.log('Extracting Reddit content (new UI selectors)...');
    const content = extractRedditComments();
    sendResponse({ success: true, content: content });
    return true;
  }
});
