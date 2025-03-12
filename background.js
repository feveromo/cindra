// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'summarize') {
    if (message.tabId) {
      chrome.tabs.get(message.tabId, (tab) => {
        handleSummarize(tab, message);
      });
    } else if (sender.tab) {
      handleSummarize(sender.tab, message);
    } else if (message.url) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
          handleSummarize(tabs[0], message);
        }
      });
    }
  }
  return true;
});

// Handle the summarize action
function handleSummarize(tab, options = {}) {
  // Get settings
  chrome.storage.sync.get({
    summaryPrompt: 'Summarize the following content in 5-10 bullet points with timestamp if it\'s transcript.',
    contentOption: 'entire-content',
    aiModel: 'google-ai-studio'
  }, (settings) => {
    // Merge with options passed in (if any)
    const config = { ...settings, ...options };
    
    // Check if it's a PDF
    if (tab.url.toLowerCase().endsWith('.pdf')) {
      handlePdfExtraction(tab, config);
      return;
    }
    
    // Check if it's YouTube
    if (tab.url.includes('youtube.com/watch')) {
      extractYouTubeTranscript(tab, config);
      return;
    }
    
    // Otherwise, extract content from regular webpage
    extractPageContent(tab, config);
  });
}

// Extract content from regular webpage
function extractPageContent(tab, config) {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: getPageContent
  }, (results) => {
    if (!results || !results[0] || !results[0].result) {
      openErrorTab('Could not extract content from the page.');
      return;
    }
    
    const pageData = results[0].result;
    
    if (!pageData.content || pageData.content.trim() === '') {
      openErrorTab('No content found on the page to summarize.');
      return;
    }
    
    // Create a formatted content string with the URL included separately
    const formattedContent = `URL: ${pageData.url}\n\nContent:\n${pageData.content}`;
    
    openGoogleAIStudio(config.summaryPrompt, formattedContent, pageData.title);
  });
}

// Extract content from a webpage
function getPageContent() {
  // First, try to find the main content elements
  const possibleMainElements = [
    document.querySelector('main'),
    document.querySelector('article'),
    document.querySelector('#content'),
    document.querySelector('.content'),
    document.querySelector('.main-content'),
    document.querySelector('#main')
  ].filter(el => el !== null);
  
  let mainContent = '';
  
  // If we found a main content element, use it
  if (possibleMainElements.length > 0) {
    // Use the first main element found
    const mainElement = possibleMainElements[0];
    
    // Remove any extension UI elements first
    const extensionElements = mainElement.querySelectorAll('.youtube-summary-ext, .yt-summary-widget, [data-extension="youtube-summary"]');
    extensionElements.forEach(el => {
      el.remove();
    });
    
    mainContent = mainElement.innerText;
  } else {
    // Fallback to body text, but try to clean it up
    // First create a clone so we don't modify the actual page
    const bodyClone = document.body.cloneNode(true);
    
    // Remove script, style, nav, footer, header, and extension-related elements
    const elementsToRemove = bodyClone.querySelectorAll('script, style, nav, footer, header, .youtube-summary-ext, .yt-summary-widget, [data-extension="youtube-summary"]');
    elementsToRemove.forEach(el => {
      el.remove();
    });
    
    mainContent = bodyClone.innerText;
  }
  
  // Get metadata
  const title = document.title;
  const url = window.location.href;
  
  // Return the formatted content with the raw URL, not in a formatted string
  return { title, url, content: mainContent };
}

// Extract YouTube transcript
function extractYouTubeTranscript(tab, config) {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: getYouTubeTranscript
  }, (results) => {
    if (!results || !results[0] || !results[0].result) {
      openErrorTab('Could not extract transcript from YouTube video.');
      return;
    }
    
    const transcriptData = results[0].result;
    
    if (!transcriptData.content || transcriptData.content.trim() === '') {
      openErrorTab('No transcript found for this YouTube video.');
      return;
    }
    
    // Create a formatted content string with the URL included separately
    const formattedContent = `URL: ${transcriptData.url}\nVideo ID: ${transcriptData.videoId || 'Not available'}\n\n${transcriptData.content}`;
    
    openGoogleAIStudio(config.summaryPrompt, formattedContent, transcriptData.title);
  });
}

// Function to extract YouTube transcript
function getYouTubeTranscript() {
  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(selector)) {
        return resolve(document.querySelector(selector));
      }
      
      const observer = new MutationObserver(() => {
        if (document.querySelector(selector)) {
          observer.disconnect();
          resolve(document.querySelector(selector));
        }
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
      
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for element: ${selector}`));
      }, timeout);
    });
  }
  
  return new Promise(async (resolve) => {
    try {
      // Get video title and URL
      const title = document.title.replace(' - YouTube', '');
      const url = window.location.href;
      const videoId = new URLSearchParams(window.location.search).get('v');
      
      // Try to open transcript if not already open
      const menuButton = document.querySelector('#primary button.ytp-button[aria-label="More actions"]');
      if (menuButton) {
        menuButton.click();
        
        // Wait for menu to appear
        await waitForElement('.ytp-settings-menu');
        
        // Find the transcript option and click it
        const menuItems = Array.from(document.querySelectorAll('.ytp-menuitem'));
        const transcriptMenuItem = menuItems.find(item => {
          const label = item.querySelector('.ytp-menuitem-label');
          return label && label.textContent.toLowerCase().includes('transcript');
        });
        
        if (transcriptMenuItem) {
          transcriptMenuItem.click();
        }
      }
      
      // Wait for transcript panel to appear
      const transcriptPanel = await waitForElement('#panels-container');
      
      // Extract transcript text with timestamps
      const transcriptItems = transcriptPanel.querySelectorAll('ytd-transcript-segment-renderer');
      
      if (transcriptItems.length === 0) {
        resolve({
          title,
          url,
          videoId,
          content: 'Transcript not available for this video.'
        });
        return;
      }
      
      let transcriptText = 'Transcript:\n';
      
      transcriptItems.forEach(item => {
        const timestamp = item.querySelector('.segment-timestamp').textContent.trim();
        const text = item.querySelector('.segment-text').textContent.trim();
        transcriptText += `[${timestamp}] ${text}\n`;
      });
      
      resolve({
        title,
        url,
        videoId,
        content: transcriptText
      });
    } catch (error) {
      resolve({
        title: document.title,
        url: window.location.href,
        content: `Error extracting transcript: ${error.message}`
      });
    }
  });
}

// Handle PDF extraction
function handlePdfExtraction(tab, config) {
  // This is a placeholder for PDF extraction functionality
  // PDF extraction requires more complex handling that might need additional libraries
  openErrorTab('PDF extraction is not yet implemented.');
}

// Open Google AI Studio with the content
function openGoogleAIStudio(prompt, content, title) {
  console.log('Opening Google AI Studio with prompt and content');
  
  // Clean up the content formatting
  const cleanedContent = cleanupContentFormatting(content);
  
  // Format with requested tags - ensure URLs are untouched with minimal line spacing
  const formattedPrompt = `<Task>${prompt}</Task>
<ContentTitle>${title}</ContentTitle>
<Transcript>${cleanedContent}</Transcript>`;

  console.log('Formatted prompt length:', formattedPrompt.length);
  
  // Store the prompt in local storage for the content script to pick up
  chrome.storage.local.set({
    pendingPrompt: formattedPrompt,
    pendingTitle: title
  }, function() {
    console.log('Prompt stored in local storage');
  });
  
  // Open Google AI Studio
  chrome.tabs.create({ url: 'https://aistudio.google.com/prompts/new_chat' }, (newTab) => {
    console.log('New tab created for Google AI Studio, tab ID:', newTab.id);
    
    // We'll let the content script handle the insertion
    // But we'll also send a message to the tab after a delay to ensure it's loaded
    setTimeout(() => {
      console.log('Sending message to content script');
      chrome.tabs.sendMessage(newTab.id, {
        action: 'insertPrompt',
        prompt: formattedPrompt,
        title: title
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error sending message:', chrome.runtime.lastError);
        } else {
          console.log('Response from content script:', response);
        }
      });
    }, 1000); // Give the page 1 second to load
  });
}

// Function to clean up content formatting by removing excessive whitespace
function cleanupContentFormatting(content) {
  if (!content) return '';
  
  // First, find and temporarily replace URLs to protect them
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = [];
  
  let protectedContent = content.replace(urlRegex, (match) => {
    const placeholder = `__URL_PLACEHOLDER_${urls.length}__`;
    urls.push(match);
    return placeholder;
  });
  
  // Remove our extension's widget text
  protectedContent = protectedContent.replace(/🤖\s*Summarize\s*with\s*AI\s*\(Ctrl\+X\+X\)/g, '');
  
  // Replace common HTML entities with their characters
  let cleaned = protectedContent
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  
  // Replace multiple newlines and line breaks with a single space
  cleaned = cleaned.replace(/(\r\n|\n|\r)+/g, ' ');
  
  // Replace multiple spaces with a single space
  cleaned = cleaned.replace(/\s+/g, ' ');
  
  // Replace multiple tabs with a single space
  cleaned = cleaned.replace(/\t+/g, ' ');
  
  // Remove non-breaking spaces and other invisibles
  cleaned = cleaned.replace(/\u00A0/g, ' ');
  
  // Preserve sentence structure by ensuring period, question mark, and exclamation mark
  // are followed by a single space but not preceded by one
  cleaned = cleaned.replace(/\s*([.!?])\s*/g, '$1 ');
  
  // Fix cases where we might have double spaces after sentence punctuation
  cleaned = cleaned.replace(/([.!?])\s{2,}/g, '$1 ');
  
  // Trim leading and trailing whitespace
  cleaned = cleaned.trim();
  
  // Restore the original URLs
  urls.forEach((url, index) => {
    const placeholder = `__URL_PLACEHOLDER_${index}__`;
    cleaned = cleaned.replace(placeholder, url);
  });
  
  // Escape any double quotes in the content since we're using them in the template string
  cleaned = cleaned.replace(/"/g, '\\"');
  
  return cleaned;
}

// Open an error tab with a message
function openErrorTab(message) {
  const errorHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>YouTube Summary Error</title>
      <style>
        body {
          font-family: 'Roboto', 'Segoe UI', Arial, sans-serif;
          background-color: #f8f9fa;
          color: #202124;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
        }
        .error-container {
          background-color: white;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
          padding: 24px;
          max-width: 500px;
          text-align: center;
        }
        h1 {
          color: #ea4335;
          font-size: 24px;
          margin-bottom: 16px;
        }
        p {
          margin-bottom: 24px;
          line-height: 1.5;
        }
        button {
          background-color: #4285f4;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 4px;
          font-weight: 500;
          cursor: pointer;
        }
        button:hover {
          background-color: #3367d6;
        }
      </style>
    </head>
    <body>
      <div class="error-container">
        <h1>Error</h1>
        <p>${message}</p>
        <button onclick="window.close()">Close</button>
      </div>
    </body>
    </html>
  `;
  
  // Create a blob URL for the HTML
  const blob = new Blob([errorHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  
  // Open the error page in a new tab
  chrome.tabs.create({ url });
} 