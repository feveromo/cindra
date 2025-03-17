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
    
    // Send to appropriate AI model based on settings
    if (config.aiModel === 'perplexity') {
      openPerplexity(config.summaryPrompt, formattedContent, pageData.title);
    } else if (config.aiModel === 'grok') {
      openGrok(config.summaryPrompt, formattedContent, pageData.title);
    } else if (config.aiModel === 'claude') {
      openClaude(config.summaryPrompt, formattedContent, pageData.title);
    } else {
      // Default to Google AI Studio
      openGoogleAIStudio(config.summaryPrompt, formattedContent, pageData.title);
    }
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
  // Send initial status
  chrome.tabs.sendMessage(tab.id, {
    action: 'transcriptStatus',
    status: 'Extracting transcript...',
    isLoading: true
  });

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: getYouTubeTranscript
  }, (results) => {
    if (!results || !results[0] || !results[0].result) {
      // Send error status
      chrome.tabs.sendMessage(tab.id, {
        action: 'transcriptStatus',
        status: 'Could not extract transcript. Please try again.',
        isLoading: false
      });
      
      openErrorTab('Could not extract transcript from YouTube video.');
      return;
    }
    
    const transcriptData = results[0].result;
    
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
    
    // Check if the content indicates an error
    if (transcriptData.content.includes('Transcript not available') || 
        transcriptData.content.includes('Error extracting transcript')) {
      // Send error status with the message from the transcript function
      chrome.tabs.sendMessage(tab.id, {
        action: 'transcriptStatus',
        status: transcriptData.content.replace('Transcript:', '').trim(),
        isLoading: false
      });
      
      openErrorTab(transcriptData.content);
      return;
    }
    
    // Send success status
    chrome.tabs.sendMessage(tab.id, {
      action: 'transcriptStatus',
      status: 'Transcript extracted successfully! Sending to AI...',
      isLoading: true
    });
    
    // Create a formatted content string with the URL included separately
    const formattedContent = `URL: ${transcriptData.url}\nVideo ID: ${transcriptData.videoId || 'Not available'}\n\n${transcriptData.content}`;
    
    // Send to appropriate AI model based on settings
    if (config.aiModel === 'perplexity') {
      openPerplexity(config.summaryPrompt, formattedContent, transcriptData.title);
    } else if (config.aiModel === 'grok') {
      openGrok(config.summaryPrompt, formattedContent, transcriptData.title);
    } else if (config.aiModel === 'claude') {
      openClaude(config.summaryPrompt, formattedContent, transcriptData.title);
    } else {
      // Default to Google AI Studio
      openGoogleAIStudio(config.summaryPrompt, formattedContent, transcriptData.title);
    }
    
    // Final status message that fades away after 5 seconds
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'transcriptStatus',
        status: 'Transcript sent to AI. Opening in new tab...',
        isLoading: false
      });
    }, 1000);
  });
}

// Function to extract YouTube transcript
function getYouTubeTranscript() {
  return new Promise(async (resolve) => {
    try {
      // Get video title and URL
      const title = document.title.replace(' - YouTube', '');
      const url = window.location.href;
      const videoId = new URLSearchParams(window.location.search).get('v');
      
      if (!videoId) {
        resolve({
          title,
          url,
          content: 'Could not find video ID. This doesn\'t appear to be a valid YouTube video.'
        });
        return;
      }
      
      console.log('Attempting to extract transcript for video:', videoId);
      
      // Setup faster extraction with timeout
      const extractionTimeout = 8000; // 8 seconds timeout for the entire process
      
      // Create a timeout promise
      const timeoutPromise = new Promise(resolve => {
        setTimeout(() => {
          resolve({
            source: 'timeout',
            content: null
          });
        }, extractionTimeout);
      });
      
      // --- Create promises for each extraction method ---
      
      // Method 1: Extract from DOM by simulating user actions (PRIORITIZED)
      const domMethodPromise = new Promise(async (resolve) => {
        try {
          // Check if transcript panel is already open
          let transcriptText = getExistingTranscriptFromDOM();
          if (transcriptText) {
            console.log('Transcript panel already open, extracted content');
            resolve({
              source: 'dom-existing',
              content: transcriptText
            });
            return;
          }
          
          // Check if transcript button exists
          const transcriptButton = findTranscriptButton();
          if (transcriptButton) {
            // Click the transcript button to open the transcript panel
            console.log('Found transcript button, attempting to open transcript panel');
            transcriptButton.click();
            
            // Wait for the transcript panel to open with a shorter timeout
            let attempts = 0;
            const maxAttempts = 10;
            while (attempts < maxAttempts) {
              await new Promise(r => setTimeout(r, 300)); // Check every 300ms
              transcriptText = getExistingTranscriptFromDOM();
              if (transcriptText) {
                console.log('Successfully extracted transcript after opening panel');
                resolve({
                  source: 'dom-clicked',
                  content: transcriptText
                });
                return;
              }
              attempts++;
            }
          }
          resolve({
            source: 'dom-failed',
            content: null
          });
        } catch (error) {
          console.error('Error with DOM interaction:', error);
          resolve({
            source: 'dom-error',
            content: null
          });
        }
      });
      
      // Method 2: Access the captions directly through player data
      const playerDataPromise = new Promise(async (resolve) => {
        try {
          const playerResponse = getPlayerResponse();
          if (playerResponse && playerResponse.captions) {
            const captionTracks = playerResponse.captions.playerCaptionsTracklistRenderer?.captionTracks;
            if (captionTracks && captionTracks.length > 0) {
              const transcriptData = await getTranscriptContent(videoId, captionTracks);
              if (transcriptData) {
                console.log('Successfully extracted transcript from player data');
                resolve({
                  source: 'player-data',
                  content: transcriptData
                });
                return;
              }
            }
          }
          resolve({
            source: 'player-data-failed',
            content: null
          });
        } catch (error) {
          console.error('Error accessing player data:', error);
          resolve({
            source: 'player-data-error',
            content: null
          });
        }
      });
      
      // Method 3: Extract from YouTube's current innertube API
      const apiMethodPromise = new Promise(async (resolve) => {
        try {
          const ytcfg = getYtcfg();
          if (ytcfg) {
            const apiKey = ytcfg.INNERTUBE_API_KEY || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
            const clientVersion = ytcfg.INNERTUBE_CLIENT_VERSION || '2.20240401.00.00'; 
            
            const response = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-YouTube-Client-Name': '1',
                'X-YouTube-Client-Version': clientVersion
              },
              body: JSON.stringify({
                context: {
                  client: {
                    clientName: 'WEB',
                    clientVersion: clientVersion,
                    hl: 'en',
                    gl: 'US'
                  }
                },
                videoId: videoId,
                params: btoa(JSON.stringify({videoId}))
              }),
            });
            
            if (response.ok) {
              const data = await response.json();
              const transcriptData = extractTranscriptFromApiResponse(data);
              if (transcriptData) {
                console.log('Successfully extracted transcript from API');
                resolve({
                  source: 'api',
                  content: transcriptData
                });
                return;
              }
            }
          }
          resolve({
            source: 'api-failed',
            content: null
          });
        } catch (error) {
          console.error('Error with API method:', error);
          resolve({
            source: 'api-error',
            content: null
          });
        }
      });
      
      // Method 4: Extract from window.ytInitialPlayerResponse
      const windowDataPromise = new Promise(async (resolve) => {
        try {
          if (window.ytInitialPlayerResponse) {
            const captionTracks = window.ytInitialPlayerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            if (captionTracks && captionTracks.length > 0) {
              const transcriptData = await getTranscriptContent(videoId, captionTracks);
              if (transcriptData) {
                console.log('Successfully extracted transcript from window.ytInitialPlayerResponse');
                resolve({
                  source: 'window-data',
                  content: transcriptData
                });
                return;
              }
            }
          }
          resolve({
            source: 'window-data-failed',
            content: null
          });
        } catch (error) {
          console.error('Error accessing window data:', error);
          resolve({
            source: 'window-data-error',
            content: null
          });
        }
      });
      
      // Race all methods with timeout - try DOM method first and give it a head start
      setTimeout(() => {
        // Start with DOM method first with a 1-second head start
        Promise.race([domMethodPromise, timeoutPromise]).then(result => {
          if (result.content) {
            resolve({
              title,
              url,
              videoId,
              content: result.content
            });
          } else {
            // If DOM method fails, race all other methods together
            Promise.race([
              playerDataPromise, 
              apiMethodPromise, 
              windowDataPromise, 
              timeoutPromise
            ]).then(result => {
              if (result.content) {
                resolve({
                  title,
                  url,
                  videoId,
                  content: result.content
                });
              } else {
                // If all methods time out or fail, return helpful message
                resolve({
                  title,
                  url,
                  videoId,
                  content: 'Could not extract transcript automatically. This video may not have captions available, or they may be disabled.\n\n' +
                           'To access the transcript manually:\n' +
                           '1. Look for the "..." or "More actions" button below the video\n' +
                           '2. Select "Show transcript" from the menu\n' +
                           '3. The transcript will appear in a panel to the right of the video\n\n' +
                           'If you don\'t see this option, the video might not have captions available.'
                });
              }
            });
          }
        });
      }, 0);
    } catch (error) {
      console.error('Error in transcript extraction:', error);
      resolve({
        title: document.title,
        url: window.location.href,
        content: `Error extracting transcript: ${error.message}. Please check if this video has captions available.`
      });
    }
  });
  
  // Helper function to get ytcfg data
  function getYtcfg() {
    try {
      if (window.ytcfg && window.ytcfg.data_) {
        return window.ytcfg.data_;
      }
      
      // Fallback: extract from page
      const scriptElements = Array.from(document.querySelectorAll('script'));
      for (const script of scriptElements) {
        if (script.textContent.includes('ytcfg.set')) {
          const configMatches = script.textContent.matchAll(/ytcfg\.set\s*\(\s*({[^;]+})\s*\)\s*;/g);
          for (const match of configMatches) {
            if (match && match[1]) {
              try {
                const config = JSON.parse(match[1]);
                if (config.INNERTUBE_API_KEY) {
                  return config;
                }
              } catch (e) {}
            }
          }
        }
      }
    } catch (e) {
      console.error('Error getting ytcfg:', e);
    }
    return null;
  }
  
  // Helper function to find transcript button in DOM
  function findTranscriptButton() {
    // Try various selectors for the transcript button
    const possibleSelectors = [
      // Modern YouTube selectors
      'button[aria-label="Show transcript"]',
      'ytd-menu-service-item-renderer[aria-label="Show transcript"]',
      'tp-yt-paper-item:contains("Show transcript")',
      // More button + transcript option
      'button.ytp-button[aria-label="More actions"]',
      'ytd-menu-service-item-renderer:contains("Show transcript")',
      // Old YouTube UI selectors
      'button.ytp-subtitles-button',
      // Try with classes that might contain the transcript button
      '.dropdown-trigger[aria-label="More actions"]',
      '.ytd-video-primary-info-renderer button.dropdown-trigger',
      // Click the "..." menu if all else fails
      'ytd-button-renderer.dropdown-trigger'
    ];
    
    for (const selector of possibleSelectors) {
      if (selector.includes(':contains')) {
        // Handle jQuery-like :contains selector
        const [tagName, text] = selector.split(':contains(');
        const textToFind = text.replace(')', '').replace(/"/g, '');
        const elements = document.querySelectorAll(tagName);
        for (const element of elements) {
          if (element.textContent.includes(textToFind)) {
            return element;
          }
        }
      } else {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          return elements[0];
        }
      }
    }
    
    return null;
  }
  
  // Helper function to get player response data
  function getPlayerResponse() {
    try {
      // Method 1: Window object
      if (window.ytInitialPlayerResponse) {
        return window.ytInitialPlayerResponse;
      }
      
      // Method 2: ytplayer config
      if (window.ytplayer && window.ytplayer.config) {
        const playerResponse = window.ytplayer.config.args?.player_response;
        if (playerResponse) {
          return JSON.parse(playerResponse);
        }
      }
      
      // Method 3: Extract from script tags
      const scriptElements = Array.from(document.querySelectorAll('script'));
      for (const script of scriptElements) {
        // Look for ytInitialPlayerResponse
        if (script.textContent.includes('ytInitialPlayerResponse')) {
          const match = script.textContent.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
          if (match && match[1]) {
            try {
              return JSON.parse(match[1]);
            } catch (e) {}
          }
        }
        
        // Look for PLAYER_VARS or PLAYER_RESPONSE
        if (script.textContent.includes('PLAYER_VARS') || script.textContent.includes('PLAYER_RESPONSE')) {
          let match = script.textContent.match(/PLAYER_RESPONSE'\s*:\s*'(.+?)'/);
          if (!match) {
            match = script.textContent.match(/PLAYER_RESPONSE"\s*:\s*"(.+?)"/);
          }
          if (match && match[1]) {
            try {
              return JSON.parse(match[1].replace(/\\([\s\S])/g, '$1'));
            } catch (e) {}
          }
        }
      }
    } catch (error) {
      console.error('Error getting player response:', error);
    }
    return null;
  }
  
  // Helper function to get transcript content directly from caption tracks
  async function getTranscriptContent(videoId, captionTracks) {
    try {
      // Find the best caption track (prefer English or manual captions)
      let selectedTrack = null;
      
      // First look for English tracks
      const englishTracks = captionTracks.filter(track => 
        track.languageCode === 'en' || 
        track.name?.simpleText?.toLowerCase().includes('english')
      );
      
      if (englishTracks.length > 0) {
        // Prefer tracks that are not auto-generated
        const manualTracks = englishTracks.filter(track => 
          !track.name?.simpleText?.toLowerCase().includes('auto-generated') && 
          !track.name?.simpleText?.toLowerCase().includes('automatic')
        );
        
        selectedTrack = manualTracks.length > 0 ? manualTracks[0] : englishTracks[0];
      } else {
        // If no English tracks, take the first one
        selectedTrack = captionTracks[0];
      }
      
      if (selectedTrack && selectedTrack.baseUrl) {
        // Extract the transcript URL
        let transcriptUrl = selectedTrack.baseUrl;
        
        // Add language and format parameters if not present
        if (!transcriptUrl.includes('&fmt=')) {
          transcriptUrl += '&fmt=json3';
        }
        
        // Use more efficient method with native fetch directly
        try {
          // Use fetch directly without iframe - this is more likely to work with recent YouTube changes
          const response = await fetch(transcriptUrl);
          if (!response.ok) throw new Error('Failed to fetch transcript data');
          
          const transcriptData = await response.text();
          
          // Parse the transcript data
          try {
            // Try JSON format first
            if (transcriptData.startsWith('{')) {
              const jsonData = JSON.parse(transcriptData);
              if (jsonData.events) {
                // Format JSON transcript
                let formattedText = 'Transcript:\n';
                for (const event of jsonData.events) {
                  if (event.segs && event.tStartMs !== undefined) {
                    const text = event.segs.map(seg => seg.utf8).join(' ').trim();
                    if (text) {
                      const startSec = Math.floor(event.tStartMs / 1000);
                      const minutes = Math.floor(startSec / 60);
                      const seconds = startSec % 60;
                      const timestamp = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                      formattedText += `[${timestamp}] ${text}\n`;
                    }
                  }
                }
                return formattedText;
              }
            } 
            
            // Try XML format as fallback
            return parseTranscriptXml(transcriptData);
          } catch (e) {
            console.error('Error parsing transcript data:', e);
            return null;
          }
        } catch (fetchError) {
          console.error('Fetch error:', fetchError);
          
          // Fallback to the iframe method if direct fetch fails due to CORS
          return new Promise((resolve) => {
            // Create a hidden iframe to load the transcript
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            document.body.appendChild(iframe);
            
            // Create a script that will fetch the transcript and store it in a global variable
            const scriptId = `youtube_transcript_data_${Date.now()}`;
            const script = document.createElement('script');
            script.textContent = `
              // Use a unique name to avoid conflicts
              window.${scriptId} = null;
              fetch('${transcriptUrl}')
                .then(response => response.text())
                .then(data => {
                  window.${scriptId} = data;
                })
                .catch(error => {
                  console.error('Failed to fetch transcript:', error);
                });
            `;
            
            // Add the script to the iframe
            iframe.contentDocument.body.appendChild(script);
            
            // Wait for the transcript to be fetched
            let attempt = 0;
            const maxAttempts = 10;
            const checkTranscriptData = () => {
              if (attempt >= maxAttempts) {
                document.body.removeChild(iframe);
                resolve(null);
                return;
              }
              
              // Check if transcript data is available
              const transcriptData = iframe.contentWindow[scriptId];
              if (transcriptData) {
                // Clean up
                document.body.removeChild(iframe);
                
                // Parse the transcript data
                try {
                  // Try JSON format first
                  if (transcriptData.startsWith('{')) {
                    const jsonData = JSON.parse(transcriptData);
                    if (jsonData.events) {
                      // Format JSON transcript
                      let formattedText = 'Transcript:\n';
                      for (const event of jsonData.events) {
                        if (event.segs && event.tStartMs !== undefined) {
                          const text = event.segs.map(seg => seg.utf8).join(' ').trim();
                          if (text) {
                            const startSec = Math.floor(event.tStartMs / 1000);
                            const minutes = Math.floor(startSec / 60);
                            const seconds = startSec % 60;
                            const timestamp = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                            formattedText += `[${timestamp}] ${text}\n`;
                          }
                        }
                      }
                      resolve(formattedText);
                      return;
                    }
                  } 
                  
                  // Try XML format as fallback
                  resolve(parseTranscriptXml(transcriptData));
                } catch (e) {
                  console.error('Error parsing transcript data:', e);
                  resolve(null);
                }
              } else {
                attempt++;
                setTimeout(checkTranscriptData, 300);
              }
            };
            
            checkTranscriptData();
          });
        }
      }
    } catch (error) {
      console.error('Error getting transcript content:', error);
    }
    
    return null;
  }
  
  // Helper function to extract transcript from API response
  function extractTranscriptFromApiResponse(data) {
    try {
      if (data && data.actions && data.actions.length > 0) {
        // Navigate through different possible structures
        for (const action of data.actions) {
          // Format 1: updateEngagementPanelAction
          if (action.updateEngagementPanelAction) {
            const content = action.updateEngagementPanelAction.content;
            if (content && content.transcriptRenderer && content.transcriptRenderer.body) {
              const cueGroups = content.transcriptRenderer.body.transcriptBodyRenderer.cueGroups;
              if (cueGroups && cueGroups.length > 0) {
                return formatTranscriptFromCueGroups(cueGroups);
              }
            }
          }
          
          // Format 2: appendContinuationItemsAction
          if (action.appendContinuationItemsAction) {
            const items = action.appendContinuationItemsAction.continuationItems;
            if (items && items.length > 0) {
              // Look for transcript segments
              const segments = [];
              for (const item of items) {
                if (item.transcriptSegmentRenderer) {
                  segments.push({
                    text: item.transcriptSegmentRenderer.snippet?.simpleText || '',
                    startTime: parseInt(item.transcriptSegmentRenderer.startTimeMs || '0') / 1000
                  });
                }
              }
              
              if (segments.length > 0) {
                let transcriptText = 'Transcript:\n';
                for (const segment of segments) {
                  const startSec = Math.floor(segment.startTime);
                  const minutes = Math.floor(startSec / 60);
                  const seconds = startSec % 60;
                  const timestamp = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                  transcriptText += `[${timestamp}] ${segment.text}\n`;
                }
                return transcriptText;
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error extracting from API response:', error);
    }
    return null;
  }
  
  // Helper function to format transcript from cue groups
  function formatTranscriptFromCueGroups(cueGroups) {
    let transcriptText = 'Transcript:\n';
    
    for (const cueGroup of cueGroups) {
      if (cueGroup.transcriptCueGroupRenderer) {
        const cues = cueGroup.transcriptCueGroupRenderer.cues;
        if (cues && cues.length > 0) {
          for (const cue of cues) {
            if (cue.transcriptCueRenderer) {
              const text = cue.transcriptCueRenderer.cue?.simpleText || '';
              const startMs = parseInt(cue.transcriptCueRenderer.startOffsetMs || '0');
              const startSec = Math.floor(startMs / 1000);
              const minutes = Math.floor(startSec / 60);
              const seconds = startSec % 60;
              const timestamp = `${minutes}:${seconds.toString().padStart(2, '0')}`;
              
              if (text) {
                transcriptText += `[${timestamp}] ${text}\n`;
              }
            }
          }
        }
      }
    }
    
    return transcriptText.length > 15 ? transcriptText : null; // Ensure we have meaningful content
  }
  
  // Helper function to get ytInitialData from page source
  function getYtInitialData() {
    // Try to find ytInitialData in the page source
    const scriptElements = Array.from(document.querySelectorAll('script'));
    for (const script of scriptElements) {
      if (script.textContent.includes('ytInitialData')) {
        // Use regex with a capturing group and non-greedy matching
        const dataMatch = script.textContent.match(/ytInitialData\s*=\s*({.+?});(?:\s|$)/);
        if (dataMatch && dataMatch[1]) {
          try {
            return JSON.parse(dataMatch[1]);
          } catch (e) {
            console.error('Failed to parse ytInitialData:', e);
          }
        }
      }
    }
    return null;
  }
  
  // Helper function to parse XML transcript
  function parseTranscriptXml(xmlText) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      const textElements = xmlDoc.getElementsByTagName('text');
      
      if (textElements.length === 0) {
        return null;
      }
      
      let transcriptText = 'Transcript:\n';
      
      for (let i = 0; i < textElements.length; i++) {
        const text = textElements[i].textContent.trim();
        if (text) {
          const startTime = parseFloat(textElements[i].getAttribute('start') || '0');
          const minutes = Math.floor(startTime / 60);
          const seconds = Math.floor(startTime % 60);
          const timestamp = `${minutes}:${seconds.toString().padStart(2, '0')}`;
          
          transcriptText += `[${timestamp}] ${text}\n`;
        }
      }
      
      return transcriptText.length > 15 ? transcriptText : null; // Ensure we have meaningful content
    } catch (error) {
      console.error('Error parsing XML:', error);
      return null;
    }
  }
  
  // Helper function to extract transcript from DOM if already visible
  function getExistingTranscriptFromDOM() {
    try {
      // Check for transcript panel in DOM - try multiple selectors to be robust
      const possiblePanelSelectors = [
        '#panels-container ytd-transcript-search-panel-renderer',
        '#panels-container ytd-transcript-renderer',
        '#panels-container [data-panel-id="transcript-search-panel"]',
        'ytd-transcript-search-panel-renderer',
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
        '#engagement-panel-searchable-transcript'
      ];
      
      let transcriptPanel = null;
      for (const selector of possiblePanelSelectors) {
        const panels = document.querySelectorAll(selector);
        if (panels.length > 0) {
          transcriptPanel = panels[0];
          break;
        }
      }
      
      if (!transcriptPanel) {
        return null;
      }
      
      // Look for transcript segments in any found panel using various selectors
      const possibleSegmentSelectors = [
        'ytd-transcript-segment-renderer',
        '[role="listitem"]',
        '.segment-text',
        '.cue-group',
        '.transcript-cue',
        '.subtitle-line'
      ];
      
      let segments = [];
      for (const selector of possibleSegmentSelectors) {
        const foundSegments = transcriptPanel.querySelectorAll(selector);
        if (foundSegments.length > 0) {
          segments = foundSegments;
          break;
        }
      }
      
      if (segments.length === 0) {
        return null;
      }
      
      let transcriptText = 'Transcript:\n';
      
      // Try different approaches to extract the text and timestamps
      if (transcriptPanel.querySelector('ytd-transcript-segment-renderer')) {
        // Modern YouTube structure
        Array.from(segments).forEach(item => {
          const timestamp = item.querySelector('.segment-timestamp, .cue-timestamp, .timestamp')?.textContent?.trim() || '';
          const text = item.querySelector('.segment-text, .cue-text, .text, .subtitle-text')?.textContent?.trim() || '';
          
          if (text) {
            transcriptText += timestamp ? `[${timestamp}] ${text}\n` : `${text}\n`;
          }
        });
      } else {
        // Alternative structure
        Array.from(segments).forEach(item => {
          // Try to find timestamp and text
          let timestamp = '';
          let text = '';
          
          // Look for spans that might contain timestamp and text
          const spans = item.querySelectorAll('span');
          if (spans.length >= 2) {
            timestamp = spans[0].textContent.trim();
            text = spans[1].textContent.trim();
          } else {
            // Otherwise just use the entire content
            text = item.textContent.trim();
            const match = text.match(/^(\d+:\d+)\s+(.+)$/);
            if (match) {
              timestamp = match[1];
              text = match[2];
            }
          }
          
          if (text) {
            transcriptText += timestamp ? `[${timestamp}] ${text}\n` : `${text}\n`;
          }
        });
      }
      
      return transcriptText.length > 15 ? transcriptText : null; // Ensure we have meaningful content
    } catch (error) {
      console.error('Error extracting from DOM:', error);
      return null;
    }
  }
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
    pendingTitle: title,
    promptTimestamp: Date.now()
  }, function() {
    console.log('Prompt stored in local storage');
    
    // Open Google AI Studio
    chrome.tabs.create({ url: 'https://aistudio.google.com/app/prompts/new_chat' }, (newTab) => {
      console.log('New tab created for Google AI Studio, tab ID:', newTab.id);
      
      // Implement retry mechanism with increasing delays
      let attempts = 0;
      const maxAttempts = 10;
      const sendMessageWithRetry = () => {
        if (attempts >= maxAttempts) {
          console.error('Failed to send message to content script after maximum attempts');
          return;
        }
        
        attempts++;
        const delay = Math.min(500 * attempts, 5000); // Start with 500ms, max 5s
        
        setTimeout(() => {
          chrome.tabs.sendMessage(newTab.id, {
            action: 'insertPrompt',
            prompt: formattedPrompt,
            title: title
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.warn(`Attempt ${attempts}: Error sending message:`, chrome.runtime.lastError);
              // Only retry if we haven't reached max attempts
              if (attempts < maxAttempts) {
                console.log(`Retrying in ${delay}ms...`);
                sendMessageWithRetry();
              }
            } else {
              console.log('Response from content script:', response);
            }
          });
        }, delay);
      };
      
      // Start the retry process after a short initial delay
      setTimeout(sendMessageWithRetry, 1000);
    });
  });
}

// Open Perplexity with the content
function openPerplexity(prompt, content, title) {
  console.log('Opening Perplexity with prompt and content');
  
  // Clean up the content formatting
  const cleanedContent = cleanupContentFormatting(content);
  
  // Format the prompt for Perplexity - create a cleaner format without quotes around content
  const formattedPrompt = `${prompt}\n\nTitle: ${title}\n\n${cleanedContent}`;

  console.log('Formatted prompt length for Perplexity:', formattedPrompt.length);
  
  // Store the prompt in local storage for the content script to pick up
  chrome.storage.local.set({
    pendingPerplexityPrompt: formattedPrompt,
    pendingPerplexityTitle: title,
    perplexityPromptTimestamp: Date.now()
  }, function() {
    console.log('Prompt stored in local storage for Perplexity');
    
    // Open Perplexity in a new tab - moved inside the callback to ensure storage is set first
    chrome.tabs.create({ url: 'https://www.perplexity.ai/' }, (newTab) => {
      console.log('New tab created for Perplexity, tab ID:', newTab.id);
      
      // Send a message to the content script with a shorter initial delay
      setTimeout(() => {
        console.log('Sending message to Perplexity content script');
        // We'll try multiple times with increasing delays to ensure the message is delivered
        sendMessageWithRetry(newTab.id, {
          action: 'insertPrompt',
          prompt: formattedPrompt,
          title: title
        });
      }, 1000); // Reduced initial delay to 1 second
    });
  });
}

// Open Grok with the content
function openGrok(prompt, content, title) {
  console.log('Opening Grok with prompt and content');
  
  // Clean up the content formatting
  const cleanedContent = cleanupContentFormatting(content);
  
  // Format the prompt for Grok - simple format similar to Perplexity
  const formattedPrompt = `${prompt}\n\nTitle: ${title}\n\n${cleanedContent}`;

  console.log('Formatted prompt length for Grok:', formattedPrompt.length);
  
  // Store the prompt in local storage for the content script to pick up
  chrome.storage.local.set({
    pendingGrokPrompt: formattedPrompt,
    pendingGrokTitle: title,
    grokPromptTimestamp: Date.now()
  }, function() {
    console.log('Prompt stored in local storage for Grok');
    
    // Open Grok in a new tab
    chrome.tabs.create({ url: 'https://grok.com/' }, (newTab) => {
      console.log('New tab created for Grok, tab ID:', newTab.id);
      
      // Send a message to the content script after a delay to ensure it's loaded
      setTimeout(() => {
        console.log('Sending message to Grok content script');
        // We'll try multiple times with increasing delays to ensure the message is delivered
        sendMessageWithRetry(newTab.id, {
          action: 'insertPrompt',
          prompt: formattedPrompt,
          title: title
        });
      }, 1000);
    });
  });
}

// Open Claude with the content
function openClaude(prompt, content, title) {
  console.log('Opening Claude with prompt and content');
  
  // Clean up the content formatting
  const cleanedContent = cleanupContentFormatting(content);
  
  // Format the prompt for Claude
  const formattedPrompt = `${prompt}\n\nTitle: ${title}\n\n${cleanedContent}`;

  console.log('Formatted prompt length for Claude:', formattedPrompt.length);
  
  // Store the prompt in local storage for the content script to pick up
  chrome.storage.local.set({
    pendingClaudePrompt: formattedPrompt,
    pendingClaudeTitle: title,
    claudePromptTimestamp: Date.now()
  }, function() {
    console.log('Prompt stored in local storage for Claude');
    
    // Open Claude in a new tab
    chrome.tabs.create({ url: 'https://claude.ai/new' }, (newTab) => {
      console.log('New tab created for Claude, tab ID:', newTab.id);
      
      // Send a message to the content script after a delay
      setTimeout(() => {
        console.log('Sending message to Claude content script');
        // We'll try multiple times with increasing delays to ensure the message is delivered
        sendMessageWithRetry(newTab.id, {
          action: 'insertPrompt',
          prompt: formattedPrompt,
          title: title
        });
      }, 1000);
    });
  });
}

// Function to send a message with retry logic
function sendMessageWithRetry(tabId, message, attempt = 1, maxAttempts = 5) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (chrome.runtime.lastError) {
      console.warn(`Attempt ${attempt}: Error sending message:`, chrome.runtime.lastError);
      
      if (attempt < maxAttempts) {
        // Use shorter retry times for earlier attempts
        const retryTime = attempt === 1 ? 500 : attempt * 1000; // 500ms for first retry, then 2s, 3s, etc.
        console.log(`Retrying in ${retryTime}ms...`);
        setTimeout(() => {
          sendMessageWithRetry(tabId, message, attempt + 1, maxAttempts);
        }, retryTime);
      } else {
        console.error('Failed to send message after multiple attempts');
      }
    } else {
      console.log('Response from content script:', response);
    }
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
        title: 'YouTube Summary Error',
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
            document.title = 'YouTube Summary Error';
          },
          args: [message]
        });
      } catch (scriptError) {
        console.error('Failed to execute script:', scriptError);
      }
    });
  }
} 