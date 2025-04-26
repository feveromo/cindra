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
    
    // Check if it's a YouTube video page
    if (tab.url.includes('youtube.com/watch')) {
      const videoId = new URLSearchParams(new URL(tab.url).search).get('v');
      const cacheKey = `transcript_${videoId}`;
      
      // Try to get cached transcript first
      chrome.storage.local.get([cacheKey], (result) => {
        if (result[cacheKey]) {
          // We have a cached transcript, use it directly
          const transcriptData = result[cacheKey];
          const formattedContent = `URL: ${tab.url}\nVideo ID: ${videoId || 'Not available'}\n\n${transcriptData.content}`;
          
          // Send directly to the selected AI model
          sendToSelectedModel(config.aiModel, config.summaryPrompt, formattedContent, transcriptData.title);
          return;
        }
        
        // No cached transcript, extract it normally
        extractYouTubeTranscript(tab, config);
      });
      return;
    }
    
    // Check if it's a Reddit page
    if (tab.url.includes('reddit.com')) {
      extractRedditContent(tab, config);
      return;
    }
    
    // Handle PDF and regular webpages as before
    if (tab.url.toLowerCase().endsWith('.pdf')) {
      handlePdfExtraction(tab, config);
      return;
    }
    
    extractPageContent(tab, config);
  });
}

// Function to send content to selected AI model
function sendToSelectedModel(model, prompt, content, title) {
  switch (model) {
    case 'perplexity':
      openPerplexity(prompt, content, title);
      break;
    case 'grok':
      openGrok(prompt, content, title);
      break;
    case 'claude':
      openClaude(prompt, content, title);
      break;
    case 'chatgpt':
      openChatGPT(prompt, content, title);
      break;
    case 'gemini':
      openGemini(prompt, content, title);
      break;
    default:
      openGoogleAIStudio(prompt, content, title);
  }
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
    
    // Send to appropriate AI model based on settings
    sendToSelectedModel(config.aiModel, config.summaryPrompt, formattedContent, pageData.title);
  });
}

// Extract Reddit content
function extractRedditContent(tab, config) {
  chrome.tabs.sendMessage(tab.id, {
    action: 'extractRedditContent'
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error sending message to Reddit content script:', chrome.runtime.lastError);
      openErrorTab('Could not extract content from Reddit page.');
      return;
    }

    if (!response || !response.success) {
      openErrorTab(response?.error || 'Could not extract content from Reddit page.');
      return;
    }

    const redditContent = response.content;

    if (!redditContent || redditContent.trim() === '') {
      openErrorTab('No content found on the Reddit page to summarize.');
      return;
    }

    // Create a formatted content string with the URL and title
    const formattedContent = `URL: ${tab.url}\nTitle: ${tab.title}\n\n${redditContent}`;

    // Send to appropriate AI model
    sendToSelectedModel(config.aiModel, config.summaryPrompt, formattedContent, tab.title);
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
    const extensionElements = mainElement.querySelectorAll('.cindra-summary-ext, .yt-summary-widget, [data-extension="cindra-summary"]');
    extensionElements.forEach(el => {
      el.remove();
    });
    
    mainContent = mainElement.innerText;
  } else {
    // Fallback to body text, but try to clean it up
    // First create a clone so we don't modify the actual page
    const bodyClone = document.body.cloneNode(true);
    
    // Remove script, style, nav, footer, header, and extension-related elements
    const elementsToRemove = bodyClone.querySelectorAll('script, style, nav, footer, header, .cindra-summary-ext, .yt-summary-widget, [data-extension="cindra-summary"]');
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
  // Send initial status
  chrome.tabs.sendMessage(tab.id, {
    action: 'transcriptStatus',
    status: 'Extracting transcript...',
    isLoading: true
  });

  // Extract video ID
  const videoId = new URLSearchParams(new URL(tab.url).search).get('v');
  const cacheKey = `transcript_${videoId}`;

  // Send message to youtube_content.js to extract transcript
  chrome.tabs.sendMessage(tab.id, {
    action: 'extractTranscript'
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error sending message:', chrome.runtime.lastError);
      openErrorTab('Could not extract transcript. Please try refreshing the page.');
      return;
    }

    if (!response || !response.success) {
      // Send error status
      chrome.tabs.sendMessage(tab.id, {
        action: 'transcriptStatus',
        status: response?.error || 'Could not extract transcript. Please try again.',
        isLoading: false
      });
      
      openErrorTab(response?.error || 'Could not extract transcript from YouTube video.');
      return;
    }
    
    const transcriptData = {
      title: tab.title.replace(' - YouTube', ''),
      url: tab.url,
      videoId: videoId,
      content: response.transcript
    };
    
    if (!transcriptData.content || transcriptData.content.trim() === '') {
      // Send no transcript status
      chrome.tabs.sendMessage(tab.id, {
        action: 'transcriptStatus',
        status: 'No transcript found for this video.',
        isLoading: false
      });
      
      openErrorTab('No transcript found for this YouTube video.');
      return;
    }
    
    // Cache the transcript
    chrome.storage.local.set({
      [cacheKey]: transcriptData
    });
    
    // Send success status
    chrome.tabs.sendMessage(tab.id, {
      action: 'transcriptStatus',
      status: 'Transcript extracted successfully! Sending to AI...',
      isLoading: true
    });
    
    // Create a formatted content string with the URL included separately
    const formattedContent = `URL: ${transcriptData.url}\nVideo ID: ${transcriptData.videoId || 'Not available'}\n\n${transcriptData.content}`;
    
    // Send to appropriate AI model
    sendToSelectedModel(config.aiModel, config.summaryPrompt, formattedContent, transcriptData.title);
    
    // Final status message
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'transcriptStatus',
        status: 'Transcript sent to AI. Opening in new tab...',
        isLoading: false
      });
    }, 1000);
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
  
  // Format with XML tags
  const formattedPrompt = `<Task>
${prompt}
</Task>

<ContentTitle>
${title}
</ContentTitle>

<Content>
${cleanedContent}
</Content>`;

  console.log('Formatted prompt length for Google AI Studio:', formattedPrompt.length);
  
  // Store the prompt in local storage first
  chrome.storage.local.set({
    pendingAIStudioPrompt: formattedPrompt,
    pendingAIStudioTitle: title,
    aiStudioPromptTimestamp: Date.now()
  }, () => {
    // Then open Google AI Studio in a new tab
    chrome.tabs.create({ url: 'https://aistudio.google.com/app/prompts/new_chat' }, async (newTab) => {
      console.log('New tab created for Google AI Studio, tab ID:', newTab.id);
      
      // Wait a moment before first attempt
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Try to send the message
      const success = await sendMessageWithRetry(newTab.id, {
        action: 'insertPrompt',
        prompt: formattedPrompt,
        title: title
      }).catch(error => {
        console.error('Error in message sending:', error);
        return false;
      });
      
      if (!success) {
        console.log('Message will be handled by content script when it loads');
      }
    });
  });
}

// Function to send message with retry logic
function sendMessageWithRetry(tabId, message, attempt = 1, maxAttempts = 5) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        console.log('Tab not found or error:', chrome.runtime.lastError);
        resolve(false);
        return;
      }

      // Special handling for YouTube
      const isYouTube = tab.url.includes('youtube.com/watch');
      if (isYouTube) {
        // For YouTube, we need to ensure the content script is injected into the correct frame
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: () => {
            // Check if we're in the main frame
            if (window.location === window.parent.location) {
              return typeof getYouTubeTranscript === 'function';
            }
            return false;
          }
        }).then(() => {
          chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
              if (attempt < maxAttempts) {
                const retryTime = Math.min(Math.pow(2, attempt - 1) * 500, 5000);
                setTimeout(() => {
                  sendMessageWithRetry(tabId, message, attempt + 1, maxAttempts)
                    .then(resolve);
                }, retryTime);
              } else {
                resolve(false);
              }
            } else {
              resolve(true);
            }
          });
        }).catch(() => {
          if (attempt < maxAttempts) {
            const retryTime = Math.min(Math.pow(2, attempt - 1) * 500, 5000);
            setTimeout(() => {
              sendMessageWithRetry(tabId, message, attempt + 1, maxAttempts)
                .then(resolve);
            }, retryTime);
          } else {
            resolve(false);
          }
        });
      } else {
        // Normal handling for non-YouTube sites
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) {
            if (attempt < maxAttempts) {
              const retryTime = Math.min(Math.pow(2, attempt - 1) * 500, 5000);
              setTimeout(() => {
                sendMessageWithRetry(tabId, message, attempt + 1, maxAttempts)
                  .then(resolve);
              }, retryTime);
            } else {
              resolve(false);
            }
          } else {
            resolve(true);
          }
        });
      }
    });
  });
}

// Function to ensure content script is loaded
async function ensureContentScriptLoaded(tabId) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isYouTube = tab.url.includes('youtube.com/watch');

    if (isYouTube) {
      // For YouTube, check for specific YouTube functions
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          return typeof getYouTubeTranscript === 'function' && 
                 typeof extractTranscriptFromApiResponse === 'function';
        }
      });
    } else {
      // For other sites, check for general content script functions
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          return typeof isPageReady === 'function' && 
                 typeof insertPromptAndSubmit === 'function';
        }
      });
    }
    return true;
  } catch (error) {
    console.log('Content script not loaded, will retry');
    return false;
  }
}

// Function to wait for tab to be ready
function waitForTab(tabId) {
  return new Promise((resolve) => {
    function checkTab() {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          setTimeout(checkTab, 100);
        } else if (tab.status === 'complete') {
          resolve(tab);
        } else {
          setTimeout(checkTab, 100);
        }
      });
    }
    checkTab();
  });
}

// Open Perplexity with the content
function openPerplexity(prompt, content, title) {
  console.log('Opening Perplexity with prompt and content');
  
  // Clean up the content formatting
  const cleanedContent = cleanupContentFormatting(content);
  
  // Format with XML tags
  const formattedPrompt = `<Task>
${prompt}
</Task>

<ContentTitle>
${title}
</ContentTitle>

<Content>
${cleanedContent}
</Content>`;

  console.log('Formatted prompt length for Perplexity:', formattedPrompt.length);
  
  // Store the prompt in local storage first
  chrome.storage.local.set({
    pendingPerplexityPrompt: formattedPrompt,
    pendingPerplexityTitle: title,
    perplexityPromptTimestamp: Date.now()
  }, async () => {
    // Then open Perplexity in a new tab
    const newTab = await chrome.tabs.create({ url: 'https://www.perplexity.ai/' });
    console.log('New tab created for Perplexity, tab ID:', newTab.id);
    
    // Wait for the tab to be fully loaded
    await waitForTab(newTab.id);
    
    // Wait a moment to ensure content script initialization
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Ensure content script is loaded
    let isLoaded = await ensureContentScriptLoaded(newTab.id);
    let attempts = 0;
    
    while (!isLoaded && attempts < 5) {
      await new Promise(resolve => setTimeout(resolve, Math.min(Math.pow(2, attempts) * 500, 5000)));
      isLoaded = await ensureContentScriptLoaded(newTab.id);
      attempts++;
    }
    
    // Try to send the message
    const success = await sendMessageWithRetry(newTab.id, {
      action: 'insertPrompt',
      prompt: formattedPrompt,
      title: title
    }).catch(() => false);
    
    if (!success) {
      console.log('Message will be handled by content script when it loads');
    }
  });
}

// Open Grok with the content
function openGrok(prompt, content, title) {
  console.log('Opening Grok with prompt and content');
  
  // Clean up the content formatting
  const cleanedContent = cleanupContentFormatting(content);
  
  // Format with XML tags
  const formattedPrompt = `<Task>
${prompt}
</Task>

<ContentTitle>
${title}
</ContentTitle>

<Content>
${cleanedContent}
</Content>`;

  console.log('Formatted prompt length for Grok:', formattedPrompt.length);
  
  // Store the prompt in local storage first
  chrome.storage.local.set({
    pendingGrokPrompt: formattedPrompt,
    pendingGrokTitle: title,
    grokPromptTimestamp: Date.now()
  }, () => {
    // Then open Grok in a new tab
    chrome.tabs.create({ url: 'https://grok.com/' }, async (newTab) => {
      console.log('New tab created for Grok, tab ID:', newTab.id);
      
      // Wait a moment before first attempt
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Try to send the message
      const success = await sendMessageWithRetry(newTab.id, {
        action: 'insertPrompt',
        prompt: formattedPrompt,
        title: title
      }).catch(error => {
        console.error('Error in message sending:', error);
        return false;
      });
      
      if (!success) {
        console.log('Message will be handled by content script when it loads');
      }
    });
  });
}

// Open Claude with the content
function openClaude(prompt, content, title) {
  console.log('Opening Claude with prompt and content');
  
  // Clean up the content formatting
  const cleanedContent = cleanupContentFormatting(content);
  
  // Format with XML tags
  const formattedPrompt = `<Task>
${prompt}
</Task>

<ContentTitle>
${title}
</ContentTitle>

<Content>
${cleanedContent}
</Content>`;

  console.log('Formatted prompt length for Claude:', formattedPrompt.length);
  
  // Store the prompt in local storage first
  chrome.storage.local.set({
    pendingClaudePrompt: formattedPrompt,
    pendingClaudeTitle: title,
    claudePromptTimestamp: Date.now()
  }, () => {
    // Then open Claude in a new tab
    chrome.tabs.create({ url: 'https://claude.ai/' }, async (newTab) => {
      console.log('New tab created for Claude, tab ID:', newTab.id);
      
      // Wait a moment before first attempt
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Try to send the message
      const success = await sendMessageWithRetry(newTab.id, {
        action: 'insertPrompt',
        prompt: formattedPrompt,
        title: title
      }).catch(error => {
        console.error('Error in message sending:', error);
        return false;
      });
      
      if (!success) {
        console.log('Message will be handled by content script when it loads');
      }
    });
  });
}

// Open Gemini with the content
function openGemini(prompt, content, title) {
  console.log('Opening Gemini with prompt and content');
  
  // Clean up the content formatting
  const cleanedContent = cleanupContentFormatting(content);
  
  // Format with XML tags
  const formattedPrompt = `<Task>
${prompt}
</Task>

<ContentTitle>
${title}
</ContentTitle>

<Content>
${cleanedContent}
</Content>`;

  console.log('Formatted prompt length for Gemini:', formattedPrompt.length);
  
  // Store the prompt in local storage first
  chrome.storage.local.set({
    pendingGeminiPrompt: formattedPrompt,
    pendingGeminiTitle: title,
    geminiPromptTimestamp: Date.now()
  }, () => {
    // Then open Gemini in a new tab
    chrome.tabs.create({ url: 'https://gemini.google.com/app' }, async (newTab) => {
      console.log('New tab created for Gemini, tab ID:', newTab.id);
      
      // Wait a moment before first attempt
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Try to send the message
      const success = await sendMessageWithRetry(newTab.id, {
        action: 'insertPrompt',
        prompt: formattedPrompt,
        title: title
      }).catch(error => {
        console.error('Error in message sending:', error);
        return false;
      });
      
      if (!success) {
        console.log('Message will be handled by content script when it loads');
      }
    });
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
  try {
    // First attempt: Try to show a native Chrome notification if available
    if (chrome.notifications && chrome.notifications.create) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'images/icon128.png',
        title: 'Cindra Summary Error',
        message: message
      });
      return;
    }
  } catch (error) {
    console.error('Failed to create notification:', error);
  }
  
  try {
    // Second attempt: Use a data URL instead of a Blob URL
    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Cindra Summary Error</title>
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
          <p>${message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')}</p>
          <button onclick="window.close()">Close</button>
        </div>
      </body>
      </html>
    `;
    
    // Use data URL instead of creating a Blob
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml);
    
    // Open the error page in a new tab
    chrome.tabs.create({ url: dataUrl });
  } catch (error) {
    // Third attempt: Fallback to a simple error message
    console.error('Failed to open error tab:', error);
    
    // Fall back to the simplest possible approach
    chrome.tabs.create({ url: 'about:blank' }, (tab) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to create tab:', chrome.runtime.lastError);
        return;
      }
      
      try {
        // Try to execute a script that shows an alert
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: (errorMsg) => {
            document.body.innerHTML = `<div style="font-family: sans-serif; padding: 20px;">
              <h1 style="color: #d93025;">Error</h1>
              <p>${errorMsg}</p>
            </div>`;
            document.title = 'Cindra Summary Error';
          },
          args: [message]
        });
      } catch (scriptError) {
        console.error('Failed to execute script:', scriptError);
      }
    });
  }
}

function openChatGPT(prompt, content, title) {
  // Clean up the content formatting
  const cleanedContent = cleanupContentFormatting(content);
  
  // Format with XML tags
  const formattedPrompt = `<Task>
${prompt}
</Task>

<ContentTitle>
${title}
</ContentTitle>

<Content>
${cleanedContent}
</Content>`;

  // Store the prompt and title temporarily
  chrome.storage.local.set({
    pendingChatGPTPrompt: formattedPrompt,
    pendingChatGPTTitle: title,
    chatgptPromptTimestamp: Date.now()
  }, () => {
    // Open ChatGPT in a new tab
    chrome.tabs.create({
      url: 'https://chat.openai.com/',
      active: true
    }, (tab) => {
      // Set up a retry mechanism to ensure the content script is ready
      const sendMessageWithRetry = () => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'insertPrompt',
          prompt: formattedPrompt,
          title: title
        }, (response) => {
          if (chrome.runtime.lastError) {
            // If the content script isn't ready yet, retry after a delay
            setTimeout(sendMessageWithRetry, 1000);
          }
        });
      };
      
      // Start trying to send the message
      setTimeout(sendMessageWithRetry, 1000);
    });
  });
} 