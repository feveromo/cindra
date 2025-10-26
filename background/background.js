// Listen for messages from popup or content script
// Lightweight in-memory lock for Kimi claim
let kimiClaimLock = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'claimKimiPrompt') {
    // Ensure only one claimer succeeds even if multiple content scripts race
    if (kimiClaimLock) {
      sendResponse({ success: false, error: 'locked' });
      return true;
    }
    kimiClaimLock = true;
    chrome.storage.local.get(['pendingKimiPrompt', 'kimiPromptTimestamp'], (state) => {
      const release = () => { kimiClaimLock = false; };
      if (chrome.runtime.lastError) {
        release();
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      const prompt = state.pendingKimiPrompt;
      const ts = state.kimiPromptTimestamp || 0;
      const fresh = (Date.now() - ts) < 60000;
      if (!prompt || !fresh) {
        // Nothing to claim or stale
        if (!fresh && ts) {
          chrome.storage.local.remove(['pendingKimiPrompt', 'kimiPromptTimestamp']);
        }
        release();
        sendResponse({ success: false, error: 'none' });
        return;
      }
      // Remove keys to ensure exclusivity
      chrome.storage.local.remove(['pendingKimiPrompt', 'kimiPromptTimestamp'], () => {
        release();
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, prompt });
        }
      });
    });
    return true;
  }
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
          
          // Send directly to the selected AI model with individual components
          sendToSelectedModel(
            config.aiModel, 
            config.summaryPrompt, 
            transcriptData.content,
            transcriptData.title,
            transcriptData.url,
            transcriptData.channelName,
            transcriptData.description
          );
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
    
    // Check if it's a 4chan page
    if (tab.url.includes('boards.4chan.org') || tab.url.includes('boards.4channel.org')) {
      extract4chanContent(tab, config);
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
// Extract 4chan content
function extract4chanContent(tab, config) {
  chrome.tabs.sendMessage(tab.id, {
    action: 'extract4chanContent'
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error sending message to 4chan content script:', chrome.runtime.lastError);
      openErrorTab('Could not extract content from 4chan thread.');
      return;
    }

    if (!response || !response.success) {
      openErrorTab(response?.error || 'Could not extract content from 4chan thread.');
      return;
    }

    const threadLog = response.content;
    if (!threadLog || threadLog.trim() === '') {
      openErrorTab('No content found on the 4chan thread to summarize.');
      return;
    }

    // Send to appropriate AI model; title and URL are also present in the log header
    sendToSelectedModel(config.aiModel, config.summaryPrompt, threadLog, tab.title, tab.url);
  });
}


// Function to send content to selected AI model
function sendToSelectedModel(model, prompt, content, title, url = null, channel = null, description = null) {
  switch (model) {
    case 'perplexity':
      openPerplexity(prompt, content, title, url, channel, description);
      break;
    case 'grok':
      openGrok(prompt, content, title, url, channel, description);
      break;
    case 'claude':
      openClaude(prompt, content, title, url, channel, description);
      break;
    case 'chatgpt':
      openChatGPT(prompt, content, title, url, channel, description);
      break;
    case 'gemini':
      openGemini(prompt, content, title, url, channel, description);
      break;
    case 'google-learning':
      openGoogleLearning(prompt, content, title, url, channel, description);
      break;
    case 'deepseek':
      openDeepseek(prompt, content, title, url, channel, description);
      break;
    case 'glm':
      openGLM(prompt, content, title, url, channel, description);
      break;
    case 'kimi':
      openKimi(prompt, content, title, url, channel, description);
      break;
    case 'huggingchat':
      openHuggingChat(prompt, content, title, url, channel, description);
      break;
    case 'qwen':
      openQwen(prompt, content, title, url, channel, description);
      break;
    default:
      openGoogleAIStudio(prompt, content, title, url, channel, description);
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
  sendToSelectedModel(config.aiModel, config.summaryPrompt, formattedContent, pageData.title, pageData.url);
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
      channelName: response.channelName,
      description: response.description,
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
    
    // Send to appropriate AI model with individual components
    sendToSelectedModel(
      config.aiModel, 
      config.summaryPrompt, 
      transcriptData.content,
      transcriptData.title,
      transcriptData.url,
      transcriptData.channelName,
      transcriptData.description
    );
    
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
function openGoogleAIStudio(prompt, content, title, url = null, channel = null, description = null) {
  console.log('Opening Google AI Studio with prompt and content');
  
  // Clean up the content formatting
  // Prefer thread-preserving cleanup when content looks like ThreadLog
  const cleanedContent = /\n---\n/.test(content) ? cleanupContentFormattingThreads(content) : cleanupContentFormatting(content);
  
  // Format with XML tags
  let formattedPrompt = `<Task>
${prompt}
</Task>
<ContentTitle>
${title}
</ContentTitle>`;

  if (url) {
    formattedPrompt += `
<URL>
${url}
</URL>`;
  }

  if (channel) {
    formattedPrompt += `
<Channel>
${channel}
</Channel>`;
  }

  if (description) {
    formattedPrompt += `
<Description>
${description}
</Description>`;
  }

  formattedPrompt += `
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
      await new Promise(resolve => setTimeout(resolve, 400));
      
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

// Open Perplexity with the content
function openPerplexity(prompt, content, title, url = null, channel = null, description = null) {
  console.log('Opening Perplexity with prompt and content');
  
  // Clean up the content formatting
  const cleanedContent = /\n---\n/.test(content) ? cleanupContentFormattingThreads(content) : cleanupContentFormatting(content);
  
  // Format with XML tags
  let formattedPrompt = `<Task>
${prompt}
</Task>


<ContentTitle>
${title}
</ContentTitle>`;

  if (url) {
    formattedPrompt += `


<URL>
${url}
</URL>`;
  }

  if (channel) {
    formattedPrompt += `


<Channel>
${channel}
</Channel>`;
  }

  if (description) {
    formattedPrompt += `


<Description>
${description}
</Description>`;
  }

  formattedPrompt += `


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
    
    // No longer need to wait or send message here.
    // The content script's checkForPendingPrompts will handle it.
  });
}

// Open Grok with the content
function openGrok(prompt, content, title, url = null, channel = null, description = null) {
  console.log('Opening Grok with prompt and content');
  
  // Clean up the content formatting
  const cleanedContent = /\n---\n/.test(content) ? cleanupContentFormattingThreads(content) : cleanupContentFormatting(content);
  
  // Format with XML tags
  let formattedPrompt = `<Task>
${prompt}
</Task>

<ContentTitle>
${title}
</ContentTitle>`;

  if (url) {
    formattedPrompt += `

<URL>
${url}
</URL>`;
  }

  if (channel) {
    formattedPrompt += `

<Channel>
${channel}
</Channel>`;
  }

  if (description) {
    formattedPrompt += `

<Description>
${description}
</Description>`;
  }

  formattedPrompt += `

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
function openClaude(prompt, content, title, url = null, channel = null, description = null) {
  console.log('Opening Claude with prompt and content');
  
  // Clean up the content formatting
  const cleanedContent = /\n---\n/.test(content) ? cleanupContentFormattingThreads(content) : cleanupContentFormatting(content);
  
  // Format with XML tags
  let formattedPrompt = `<Task>
${prompt}
</Task>

<ContentTitle>
${title}
</ContentTitle>`;

  if (url) {
    formattedPrompt += `

<URL>
${url}
</URL>`;
  }

  if (channel) {
    formattedPrompt += `

<Channel>
${channel}
</Channel>`;
  }

  if (description) {
    formattedPrompt += `

<Description>
${description}
</Description>`;
  }

  formattedPrompt += `

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
function openGemini(prompt, content, title, url = null, channel = null, description = null) {
  console.log('Opening Gemini with prompt and content');
  
  // Clean up the content formatting
  const cleanedContent = /\n---\n/.test(content) ? cleanupContentFormattingThreads(content) : cleanupContentFormatting(content);
  
  // Format with XML tags
  let formattedPrompt = `<Task>
${prompt}
</Task>


<ContentTitle>
${title}
</ContentTitle>`;

  if (url) {
    formattedPrompt += `


<URL>
${url}
</URL>`;
  }

  if (channel) {
    formattedPrompt += `


<Channel>
${channel}
</Channel>`;
  }

  if (description) {
    formattedPrompt += `


<Description>
${description}
</Description>`;
  }

  formattedPrompt += `


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

// Cleanup variant that preserves post boundaries (e.g., ThreadLog separators)
function cleanupContentFormattingThreads(content) {
  if (!content) return '';

  // Protect URLs
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = [];
  let protectedContent = content.replace(urlRegex, (match) => {
    const placeholder = `__URL_PLACEHOLDER_${urls.length}__`;
    urls.push(match);
    return placeholder;
  });

  // Replace HTML entities
  let cleaned = protectedContent
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Preserve post separators "\n---\n" and single newlines between posts.
  // Temporarily mark separators and blank-line boundaries
  cleaned = cleaned
    .replace(/\n---\n/g, '__POST_SEP__')
    .replace(/\n\n/g, '__BLANK_LINE__');

  // Within remaining content, collapse newlines and spaces aggressively
  cleaned = cleaned.replace(/(\r\n|\n|\r)+/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.replace(/\t+/g, ' ');
  cleaned = cleaned.replace(/\u00A0/g, ' ');
  cleaned = cleaned.replace(/\s*([.!?])\s*/g, '$1 ');
  cleaned = cleaned.replace(/([.!?])\s{2,}/g, '$1 ');
  cleaned = cleaned.trim();

  // Restore separators and blank lines
  cleaned = cleaned
    .replace(/__BLANK_LINE__/g, '\n\n')
    .replace(/__POST_SEP__/g, '\n---\n');

  // Restore URLs
  urls.forEach((url, idx) => {
    cleaned = cleaned.replace(`__URL_PLACEHOLDER_${idx}__`, url);
  });

  // Escape quotes for embedding
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

function openChatGPT(prompt, content, title, url = null, channel = null, description = null) {
  // Clean up the content formatting
  const cleanedContent = /\n---\n/.test(content) ? cleanupContentFormattingThreads(content) : cleanupContentFormatting(content);
  
  // Format with XML tags
  let formattedPrompt = `<Task>
${prompt}
</Task>


<ContentTitle>
${title}
</ContentTitle>`;

  if (url) {
    formattedPrompt += `


<URL>
${url}
</URL>`;
  }

  if (channel) {
    formattedPrompt += `


<Channel>
${channel}
</Channel>`;
  }

  if (description) {
    formattedPrompt += `


<Description>
${description}
</Description>`;
  }

  formattedPrompt += `


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

// Function to open Google Learning and pass prompt
function openGoogleLearning(prompt, content, title, url = null, channel = null, description = null) {
  const cleanedContent = /\n---\n/.test(content) ? cleanupContentFormattingThreads(content) : cleanupContentFormatting(content);
  let combinedPrompt = `<Task>
${prompt}
</Task>

<ContentTitle>
${title || 'N/A'}
</ContentTitle>`;

  if (url) {
    combinedPrompt += `

<URL>
${url}
</URL>`;
  }

  if (channel) {
    combinedPrompt += `

<Channel>
${channel}
</Channel>`;
  }

  if (description) {
    combinedPrompt += `

<Description>
${description}
</Description>`;
  }

  combinedPrompt += `

<Content>
${cleanedContent}
</Content>`;
  const targetUrl = 'https://learning.google.com/experiments/learn-about'; // Ensure no trailing slash for consistency with manifest match

  // Store the prompt for the content script to pick up
  chrome.storage.local.set({
    pendingGoogleLearningPrompt: combinedPrompt,
    googleLearningPromptTimestamp: Date.now()
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error setting pendingGoogleLearningPrompt in storage:', chrome.runtime.lastError);
      openErrorTab('Could not save prompt for Google Learning.');
      return;
    }
    console.log('Google Learning prompt stored. Searching for existing tab or creating new one.');

    // Check if a Google Learning tab is already open
    chrome.tabs.query({ url: targetUrl + '*' }, (tabs) => {
      if (tabs.length > 0) {
        // Tab exists, update it and focus
        chrome.tabs.update(tabs[0].id, { active: true, url: targetUrl }, (updatedTab) => {
          // Ensure the tab is fully loaded before trying to send a message
          // The content script will pick up from storage on load
          console.log('Focused existing Google Learning tab:', updatedTab.id);
        });
      } else {
        // No tab exists, create a new one
        chrome.tabs.create({ url: targetUrl }, (newTab) => {
          console.log('Created new Google Learning tab:', newTab.id);
          // Content script will pick up from storage on load
        });
      }
    });
  });
} 

// Open DeepSeek with the content
function openDeepseek(prompt, content, title, url = null, channel = null, description = null) {
  console.log('Opening DeepSeek with prompt and content');
  const cleanedContent = /\n---\n/.test(content) ? cleanupContentFormattingThreads(content) : cleanupContentFormatting(content);
  let formattedPrompt = `<Task>
${prompt}
</Task>

<ContentTitle>
${title || 'N/A'}
</ContentTitle>`;

  if (url) {
    formattedPrompt += `

<URL>
${url}
</URL>`;
  }

  if (channel) {
    formattedPrompt += `

<Channel>
${channel}
</Channel>`;
  }

  if (description) {
    formattedPrompt += `

<Description>
${description}
</Description>`;
  }

  formattedPrompt += `

<Content>
${cleanedContent}
</Content>`;
  const targetUrl = 'https://chat.deepseek.com/';

  chrome.storage.local.set({
    pendingDeepseekPrompt: formattedPrompt,
    pendingDeepseekTitle: title,
    deepseekPromptTimestamp: Date.now()
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error setting pendingDeepseekPrompt in storage:', chrome.runtime.lastError);
      openErrorTab('Could not save prompt for DeepSeek.');
      return;
    }
    console.log('DeepSeek prompt stored. Searching for existing tab or creating new one.');
    chrome.tabs.query({ url: targetUrl + '*' }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true, url: targetUrl }, () => {
          console.log('Focused existing DeepSeek tab');
        });
      } else {
        chrome.tabs.create({ url: targetUrl }, async (newTab) => {
          console.log('Created new DeepSeek tab:', newTab.id);
          // Try to send message once the tab is (likely) ready; content script will also pick up from storage
          await new Promise(resolve => setTimeout(resolve, 1000));
          const success = await sendMessageWithRetry(newTab.id, {
            action: 'insertPrompt',
            prompt: formattedPrompt,
            title: title
          }).catch(() => false);
          if (!success) {
            console.log('DeepSeek message will be handled by content script on load');
          }
        });
      }
    });
  });
}

// Open GLM (Z.AI) with the content
function openGLM(prompt, content, title, url = null, channel = null, description = null) {
  console.log('Opening GLM (Z.AI) with prompt and content');
  const cleanedContent = /\n---\n/.test(content) ? cleanupContentFormattingThreads(content) : cleanupContentFormatting(content);
  let formattedPrompt = `<Task>
${prompt}
</Task>

<ContentTitle>
${title || 'N/A'}
</ContentTitle>`;

  if (url) {
    formattedPrompt += `

<URL>
${url}
</URL>`;
  }

  if (channel) {
    formattedPrompt += `

<Channel>
${channel}
</Channel>`;
  }

  if (description) {
    formattedPrompt += `

<Description>
${description}
</Description>`;
  }

  formattedPrompt += `

<Content>
${cleanedContent}
</Content>`;
  const targetUrl = 'https://chat.z.ai/';

  chrome.storage.local.set({
    pendingGLMPrompt: formattedPrompt,
    glmPromptTimestamp: Date.now()
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error setting pendingGLMPrompt in storage:', chrome.runtime.lastError);
      openErrorTab('Could not save prompt for GLM.');
      return;
    }
    console.log('GLM prompt stored. Searching for existing tab or creating new one.');
    
    // Check if a GLM tab is already open
    chrome.tabs.query({ url: targetUrl + '*' }, (tabs) => {
      if (tabs.length > 0) {
        // Tab exists, update it and focus
        chrome.tabs.update(tabs[0].id, { active: true, url: targetUrl }, () => {
          console.log('Focused existing GLM tab');
        });
      } else {
        // No tab exists, create a new one
        chrome.tabs.create({ url: targetUrl }, (newTab) => {
          console.log('Created new GLM tab:', newTab.id);
          // Content script will pick up from storage on load
        });
      }
    });
  });
}

// Open Kimi with the content
function openKimi(prompt, content, title, url = null, channel = null, description = null) {
  // De-dup guard: prevent double-opens within a short interval
  if (!openKimi.__lock) {
    openKimi.__lock = { inFlight: false, ts: 0 };
  }
  const now = Date.now();
  if (openKimi.__lock.inFlight && (now - openKimi.__lock.ts) < 8000) {
    console.log('openKimi dedup: request suppressed (another open is in flight)');
    return;
  }
  openKimi.__lock.inFlight = true;
  openKimi.__lock.ts = now;

  console.log('Opening Kimi with prompt and content');
  const cleanedContent = /\n---\n/.test(content) ? cleanupContentFormattingThreads(content) : cleanupContentFormatting(content);

  // If the incoming prompt already appears to be fully wrapped (has a closing </Content>),
  // avoid re-wrapping to prevent duplicate XML blocks.
  const alreadyWrapped = typeof prompt === 'string' && prompt.includes('</Content>');

  let formattedPrompt = alreadyWrapped ? prompt : `
<Task>
${prompt}
</Task>

<ContentTitle>
${title || 'N/A'}
</ContentTitle>`;

  if (!alreadyWrapped && url) {
    formattedPrompt += `

<URL>
${url}
</URL>`;
  }

  if (!alreadyWrapped && channel) {
    formattedPrompt += `

<Channel>
${channel}
</Channel>`;
  }

  if (!alreadyWrapped && description) {
    formattedPrompt += `

<Description>
${description}
</Description>`;
  }

  if (!alreadyWrapped) {
    formattedPrompt += `

<Content>
${cleanedContent}
</Content>`;
  }
  const targetUrl = 'https://kimi.com/';
  
  // Build a signature to detect near-duplicate requests
  const promptSignature = `${title || ''}::${prompt.length}::${cleanedContent.length}`;

  // Check storage-level dedup to handle worker restarts or parallel triggers
  chrome.storage.local.get(['kimiInFlight', 'kimiInFlightTs', 'kimiLastSignature', 'kimiLastSetAt'], (state) => {
    const nowTs = Date.now();
    const inFlight = state.kimiInFlight === true && (nowTs - (state.kimiInFlightTs || 0)) < 15000;
    const isDuplicate = state.kimiLastSignature === promptSignature && (nowTs - (state.kimiLastSetAt || 0)) < 15000;

    if (inFlight || isDuplicate) {
      console.log('openKimi storage dedup: suppressed duplicate request', { inFlight, isDuplicate });
      // Release in-memory lock quickly since we are suppressing
      setTimeout(() => { openKimi.__lock.inFlight = false; }, 500);
      return;
    }

    // Mark in-flight and store the prompt for the content script
    chrome.storage.local.set({
      pendingKimiPrompt: formattedPrompt,
      kimiPromptTimestamp: nowTs,
      kimiInFlight: true,
      kimiInFlightTs: nowTs,
      kimiLastSignature: promptSignature,
      kimiLastSetAt: nowTs
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error setting pendingKimiPrompt in storage:', chrome.runtime.lastError);
        openErrorTab('Could not save prompt for Kimi.');
        openKimi.__lock.inFlight = false;
        return;
      }
      console.log('Kimi prompt stored. Searching for existing tab or creating new one.');
      
      // Check if a Kimi tab is already open
      chrome.tabs.query({ url: targetUrl + '*' }, (tabs) => {
        if (tabs.length > 0) {
          // Tab exists: reload to base so content script picks prompt from storage
          chrome.tabs.update(tabs[0].id, { active: true, url: targetUrl }, () => {
            console.log('Focused and reloaded existing Kimi tab; content script will pick up from storage');
            // Release locks shortly after focusing/reloading (content script also clears storage lock on success)
            setTimeout(() => {
              openKimi.__lock.inFlight = false;
              chrome.storage.local.set({ kimiInFlight: false });
            }, 5000);
          });
        } else {
          // No tab exists, create a new one
          chrome.tabs.create({ url: targetUrl }, (newTab) => {
            console.log('Created new Kimi tab:', newTab.id);
            // Content script will pick up from storage on load
            setTimeout(() => {
              openKimi.__lock.inFlight = false;
              chrome.storage.local.set({ kimiInFlight: false });
            }, 5000);
          });
        }
      });
    });
  });
}

// Open HuggingChat with the content
function openHuggingChat(prompt, content, title, url = null, channel = null, description = null) {
  console.log('Opening HuggingChat with prompt and content');
  const cleanedContent = /\n---\n/.test(content) ? cleanupContentFormattingThreads(content) : cleanupContentFormatting(content);
  let combinedPrompt = `<Task>
${prompt}
</Task>

<ContentTitle>
${title || 'N/A'}
</ContentTitle>`;

  if (url) {
    combinedPrompt += `

<URL>
${url}
</URL>`;
  }

  if (channel) {
    combinedPrompt += `

<Channel>
${channel}
</Channel>`;
  }

  if (description) {
    combinedPrompt += `

<Description>
${description}
</Description>`;
  }

  combinedPrompt += `

<Content>
${cleanedContent}
</Content>`;
  const targetUrl = 'https://huggingface.co/chat/';

  // Store the prompt for the content script to pick up
  chrome.storage.local.set({
    pendingHuggingChatPrompt: combinedPrompt,
    huggingChatPromptTimestamp: Date.now()
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error setting pendingHuggingChatPrompt in storage:', chrome.runtime.lastError);
      openErrorTab('Could not save prompt for HuggingChat.');
      return;
    }
    console.log('HuggingChat prompt stored. Searching for existing tab or creating new one.');

    // Check if a HuggingChat tab is already open
    chrome.tabs.query({ url: targetUrl + '*' }, (tabs) => {
      if (tabs.length > 0) {
        // Tab exists, update it and focus
        chrome.tabs.update(tabs[0].id, { active: true, url: targetUrl }, (updatedTab) => {
          console.log('Focused existing HuggingChat tab:', updatedTab.id);
        });
      } else {
        // No tab exists, create a new one
        chrome.tabs.create({ url: targetUrl }, (newTab) => {
          console.log('Created new HuggingChat tab:', newTab.id);
          // Content script will pick up from storage on load
        });
      }
    });
  });
}

// Open Qwen with the content
function openQwen(prompt, content, title, url = null, channel = null, description = null) {
  console.log('Opening Qwen with prompt and content');
  const cleanedContent = /\n---\n/.test(content) ? cleanupContentFormattingThreads(content) : cleanupContentFormatting(content);
  let combinedPrompt = `<Task>
${prompt}
</Task>

<ContentTitle>
${title || 'N/A'}
</ContentTitle>`;

  if (url) {
    combinedPrompt += `

<URL>
${url}
</URL>`;
  }

  if (channel) {
    combinedPrompt += `

<Channel>
${channel}
</Channel>`;
  }

  if (description) {
    combinedPrompt += `

<Description>
${description}
</Description>`;
  }

  combinedPrompt += `

<Content>
${cleanedContent}
</Content>`;

  const targetUrl = 'https://chat.qwen.ai/';

  chrome.storage.local.set({
    pendingQwenPrompt: combinedPrompt,
    pendingQwenTitle: title,
    qwenPromptTimestamp: Date.now()
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error setting pendingQwenPrompt in storage:', chrome.runtime.lastError);
      openErrorTab('Could not save prompt for Qwen.');
      return;
    }
    console.log('Qwen prompt stored. Searching for existing tab or creating new one.');

    chrome.tabs.query({ url: targetUrl + '*' }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true, url: targetUrl }, () => {
          console.log('Focused existing Qwen tab');
        });
      } else {
        chrome.tabs.create({ url: targetUrl }, async (newTab) => {
          console.log('Created new Qwen tab:', newTab.id);
          // Attempt immediate message; content script will also pick up from storage
          await new Promise(resolve => setTimeout(resolve, 1000));
          const success = await sendMessageWithRetry(newTab.id, {
            action: 'insertPrompt',
            prompt: combinedPrompt,
            title: title
          }).catch(() => false);
          if (!success) {
            console.log('Qwen message will be handled by content script on load');
          }
        });
      }
    });
  });
}