// Content script specifically for Reddit
console.log('Reddit content script loaded');

// Function to extract comments from the page
function extractRedditComments() {
  const comments = [];
  const commentElements = document.querySelectorAll('.thing.comment .entry');

  commentElements.forEach(commentElement => {
    try {
      const authorElement = commentElement.querySelector('.tagline .author');
      const author = authorElement ? authorElement.innerText : '[deleted]';

      // The comment text is typically within a div with class "md"
      const textElement = commentElement.querySelector('.usertext-body .md');
      const text = textElement ? textElement.innerText : '';

      if (text.trim() !== '') {
        comments.push(`${author}: ${text.trim()}`);
      }
    } catch (error) {
      console.error('Error extracting comment:', error);
    }
  });

  // Also try to get the main post title and text if available
  let postTitle = '';
  let postText = '';
  try {
    const titleElement = document.querySelector('.thing.link .entry .title .link');
    if (titleElement) {
      postTitle = titleElement.innerText.trim();
    }
    const textElement = document.querySelector('.thing.link .entry .expando .usertext-body .md');
     if (textElement) {
      postText = textElement.innerText.trim();
    }
  } catch (error) {
    console.error('Error extracting post title/text:', error);
  }

  const formattedContent = [];
  if (postTitle) {
      formattedContent.push(`Title: ${postTitle}`);
  }
  if (postText) {
      formattedContent.push(`Post Body: ${postText}`);
  }
  if(postTitle || postText){
      formattedContent.push(''); // Add a newline for separation
  }
  formattedContent.push('Comments:');
  formattedContent.push(comments.join('\n---\n'));

  return formattedContent.join('\n');
}

// Listen for messages from the background script to extract content
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractRedditContent') {
    console.log('Extracting Reddit content...');
    const content = extractRedditComments();
    sendResponse({ success: true, content: content });
    return true; // Indicates asynchronous response
  }
}); 