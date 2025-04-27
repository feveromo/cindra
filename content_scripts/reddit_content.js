// Content script specifically for Reddit
console.log('Reddit content script loaded');

// Function to extract comments from the page
function extractRedditComments() {
  const comments = [];
  // Selectors for the new Reddit UI (shreddit-comment)
  const commentElements = document.querySelectorAll('shreddit-comment');

  commentElements.forEach(commentElement => {
    try {
      // Author is an attribute on the shreddit-comment tag itself
      const author = commentElement.getAttribute('author') || '[deleted]';

      // Comment text is inside a div with slot="comment"
      const textElement = commentElement.querySelector('div[slot="comment"]');
      // Get innerText to capture text across multiple potential child elements (like <p>)
      const text = textElement ? textElement.innerText.trim() : '';

      if (author !== '[deleted]' && text !== '') {
        comments.push(`${author}: ${text}`);
      }
    } catch (error) {
      console.error('Error extracting shreddit-comment:', error);
    }
  });

  // --- Attempt to extract comments from OLD Reddit UI as a fallback ---
  // This might be useful if navigating between old/new reddit links
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


  // Also try to get the main post title and text if available (New UI selectors needed)
  let postTitle = '';
  let postText = '';
  try {
    // Try new UI selector for title (adjust if needed based on actual post structure)
    const titleElementNew = document.querySelector('shreddit-post [slot="title"]');
    if (titleElementNew) {
        postTitle = titleElementNew.innerText.trim();
    } else {
        // Fallback to old UI selector
        const titleElementOld = document.querySelector('.thing.link .entry .title .link');
        if (titleElementOld) {
            postTitle = titleElementOld.innerText.trim();
        }
    }

    // Try new UI selector for post body (adjust if needed)
    const postBodyContainerNew = document.querySelector('shreddit-post [data-post-rtjson-content="true"]');
     if (postBodyContainerNew) {
         // Gather text from all paragraphs within the container
         const paragraphs = postBodyContainerNew.querySelectorAll('p');
         // Use \n for joining lines
         postText = Array.from(paragraphs).map(p => p.innerText).join('\n').trim();
    } else {
        // Fallback to old UI selector
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
      // Use template literal which handles multiline correctly, using \n
      formattedContent.push(`Post Body:\n${postText}`);
  }
  if(postTitle || postText){
      formattedContent.push(''); // Add a newline for separation
  }

  if (comments.length > 0) {
    formattedContent.push('Comments:');
    // Use \n for joining comments
    formattedContent.push(comments.join('\n---\n'));
  } else {
    formattedContent.push('No comments found or extracted.');
  }

  // Use \n for final join
  return formattedContent.join('\n');
}

// Listen for messages from the background script to extract content
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractRedditContent') {
    console.log('Extracting Reddit content (new UI selectors)...');
    const content = extractRedditComments();
    sendResponse({ success: true, content: content });
    return true; // Indicates asynchronous response
  }
}); 