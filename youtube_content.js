// Content script specifically for YouTube
console.log('YouTube content script loaded');

// Flag to track whether we're already extracting or have extracted
let isExtracting = false;
let hasExtracted = false;

// Function to add copy transcript button
function addCopyTranscriptButton() {
  // Check if button already exists
  if (document.querySelector('.copy-transcript-button')) {
    return;
  }

  // Create the button
  const button = document.createElement('button');
  button.className = 'copy-transcript-button';
  button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
  button.setAttribute('aria-label', 'Copy Transcript');
  button.setAttribute('title', 'Copy Transcript');
  button.style.cssText = `
    background-color: transparent;
    color: #aaaaaa;
    border: none;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.2s, color 0.2s;
    margin-left: 8px;
    padding: 8px;
    box-sizing: border-box;
  `;

  // Add hover effect
  button.addEventListener('mouseover', () => {
    button.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    button.style.color = '#ffffff';
  });

  button.addEventListener('mouseout', () => {
    button.style.backgroundColor = 'transparent';
    button.style.color = '#aaaaaa';
  });

  // Add click handler
  button.addEventListener('click', async () => {
    try {
      // Show loading state
      button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>';
      button.style.color = '#666666';
      button.style.cursor = 'wait';

      // Get the transcript
      const transcriptData = await getYouTubeTranscript();
      
      if (transcriptData && transcriptData.content) {
        // Copy to clipboard
        await navigator.clipboard.writeText(transcriptData.content);
        
        // Show success state
        button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
        button.style.color = '#137333';
        
        // Reset after 2 seconds
        setTimeout(() => {
          button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
          button.style.color = '#aaaaaa';
          button.style.cursor = 'pointer';
        }, 2000);
      } else {
        // Show error state
        button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
        button.style.color = '#ea4335';
        
        // Reset after 2 seconds
        setTimeout(() => {
          button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
          button.style.color = '#aaaaaa';
          button.style.cursor = 'pointer';
        }, 2000);
      }
    } catch (error) {
      // Show error state
      button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
      button.style.color = '#ea4335';
      
      // Reset after 2 seconds
      setTimeout(() => {
        button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
        button.style.color = '#aaaaaa';
        button.style.cursor = 'pointer';
      }, 2000);
    }
  });

  // Based on the HTML structure provided by the user, try multiple insertion points
  
  // First attempt: Try to insert after the subscribe button
  const subscribeButton = document.querySelector('#subscribe-button');
  if (subscribeButton) {
    console.log('Found subscribe button, inserting after it');
    // Check if our button is already a direct sibling
    if (subscribeButton.nextSibling && subscribeButton.nextSibling.classList && 
        subscribeButton.nextSibling.classList.contains('copy-transcript-button')) {
      console.log('Button already exists after subscribe button');
      return;
    }
    subscribeButton.parentNode.insertBefore(button, subscribeButton.nextSibling);
    return;
  }
  
  // Second attempt: Try to insert in #top-row after the subscribe container
  const topRow = document.querySelector('#above-the-fold #top-row');
  if (topRow) {
    console.log('Found top-row, looking for subscribe button within');
    // Find the subscribe button container within top-row
    const subscribeContainer = topRow.querySelector('#subscribe-button');
    if (subscribeContainer) {
      // Check if our button is already next to subscribe container
      if (subscribeContainer.nextSibling && subscribeContainer.nextSibling.classList && 
          subscribeContainer.nextSibling.classList.contains('copy-transcript-button')) {
        console.log('Button already exists after subscribe container');
        return;
      }
      console.log('Found subscribe container, inserting after it');
      topRow.insertBefore(button, subscribeContainer.nextSibling);
    } else {
      // Insert at the end of top-row if we can't find the subscribe button
      console.log('No subscribe container found, appending to top-row');
      topRow.appendChild(button);
    }
    return;
  }

  // Third attempt: Try to add it after the title
  console.log('Trying title element fallback');
  const titleElement = document.querySelector('#above-the-fold #title h1');
  if (titleElement) {
    titleElement.parentNode.insertBefore(button, titleElement.nextSibling);
    return;
  }

  // Fourth attempt: Add directly to the above-the-fold container
  console.log('Trying above-the-fold fallback');
  const aboveTheFold = document.querySelector('#above-the-fold');
  if (aboveTheFold) {
    // Try to insert after title
    const title = aboveTheFold.querySelector('#title');
    if (title) {
      aboveTheFold.insertBefore(button, title.nextSibling);
    } else {
      // Or just append to above-the-fold
      aboveTheFold.appendChild(button);
    }
    return;
  }

  // Fifth attempt: Add to actions section if everything else fails
  console.log('Trying actions fallback');
  const actionsDiv = document.querySelector('#actions');
  if (actionsDiv) {
    // Add to the beginning of actions inner
    const actionsInner = actionsDiv.querySelector('#actions-inner');
    if (actionsInner) {
      actionsInner.insertBefore(button, actionsInner.firstChild);
    } else {
      actionsDiv.insertBefore(button, actionsDiv.firstChild);
    }
    return;
  }

  // Last attempt: Try ytd-watch-metadata
  console.log('Trying ytd-watch-metadata fallback');
  const watchMetadata = document.querySelector('ytd-watch-metadata');
  if (watchMetadata) {
    watchMetadata.insertBefore(button, watchMetadata.firstChild);
  } else {
    console.log('Could not find any suitable insertion point for the button');
  }
}

// Function to check if we're on a video page
function isVideoPage() {
  return window.location.pathname === '/watch' && new URLSearchParams(window.location.search).get('v');
}

// Make sure we're trying multiple times in case YouTube's UI loads slowly
function initializeCopyButton() {
  if (isVideoPage()) {
    // Try immediately when detected as a video page
    addCopyTranscriptButton();
    
    // Then try again after short delays to ensure YouTube's UI has fully loaded
    setTimeout(addCopyTranscriptButton, 1000);
    setTimeout(addCopyTranscriptButton, 3000);
  }
}

// Watch for changes to video area as YouTube is a dynamic SPA
function setupMutationObserver() {
  // Watch for URL changes
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      // Reset and initialize when URL changes
      setTimeout(initializeCopyButton, 1000);
    }
  }).observe(document, { subtree: true, childList: true });

  // Wait for video container to be available in the DOM
  function setupVideoObserver() {
    const videoContainer = document.querySelector('ytd-page-manager') || document.body;
    
    if (!videoContainer) {
      // If somehow both selectors failed, retry after a short delay
      setTimeout(setupVideoObserver, 500);
      return;
    }
    
    // Now we have a valid element to observe
    new MutationObserver((mutations) => {
      // Check if any video player related elements were added
      const shouldTryAddButton = mutations.some(mutation => {
        return Array.from(mutation.addedNodes).some(node => {
          if (node.nodeName === 'YTD-WATCH-METADATA' || 
              node.id === 'above-the-fold' || 
              node.id === 'top-row') {
            return true;
          }
          return false;
        });
      });
      
      if (shouldTryAddButton) {
        setTimeout(addCopyTranscriptButton, 500);
      }
    }).observe(videoContainer, { childList: true, subtree: true });
  }

  // Start the setup process
  setupVideoObserver();
}

// Initialize button when page loads and setup observers
initializeCopyButton();
setupMutationObserver();

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in YouTube content script:', message);
  
  if (message.action === 'extractTranscript') {
    // Reset flags for each new request
    isExtracting = false;
    hasExtracted = false;
    
    // Extract transcript
    getYouTubeTranscript()
      .then(transcriptData => {
        if (!transcriptData || !transcriptData.content) {
          throw new Error('Could not extract transcript. Please ensure the video has captions available.');
        }
        sendResponse({ success: true, transcript: transcriptData.content });
        hasExtracted = true;
      })
      .catch(error => {
        console.error('Failed to extract transcript:', error);
        sendResponse({ success: false, error: error.message });
      })
      .finally(() => {
        isExtracting = false;
      });
    
    return true; // Keep the message channel open for async response
  }
});

// Function to get YouTube transcript
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
                  content: 'Could not extract transcript automatically. This video may not have captions available.\n\n' +
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
}

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