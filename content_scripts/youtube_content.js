(function initializeCindraYouTubeContent(root) {
  'use strict';

  root.CindraYouTubeContent?.cleanup?.();

  const errors = root.CindraErrors;
  const messages = root.CindraMessages;
  const youtubeUi = root.CindraYouTubeUi;
  if (!errors || !messages || !youtubeUi) {
    console.error('[Cindra] YouTube content dependencies are unavailable.');
    return;
  }

  const ACTIONS = messages.ACTIONS;
  let activeExtractionPromise = null;
  let transcriptButton = null;
  let cleanedUp = false;

  function extractTranscriptOnce() {
    if (!activeExtractionPromise) {
      activeExtractionPromise = Promise.resolve()
        .then(() => getYouTubeTranscript())
        .finally(() => {
          activeExtractionPromise = null;
        });
    }
    return activeExtractionPromise;
  }

  function handleMessage(message, sender, sendResponse) {
    if (message?.action !== ACTIONS.EXTRACT_TRANSCRIPT) return false;
    const respond = messages.respondOnce(sendResponse);
    const validation = messages.validateMessage(message, [ACTIONS.EXTRACT_TRANSCRIPT]);
    if (!validation.ok) {
      respond({ success: false, error: validation.error });
      return false;
    }
    if (sender.id !== root.chrome.runtime.id) {
      respond({ success: false, error: 'YouTube transcript request was not trusted.' });
      return false;
    }

    extractTranscriptOnce()
      .then((transcriptData) => {
        if (!transcriptData?.content || !/^Transcript:\s/i.test(transcriptData.content.trim())) {
          throw new Error(transcriptData?.error || 'Could not extract transcript. Please ensure the video has captions available.');
        }
        respond({
          success: true,
          transcript: transcriptData.content,
          channelName: transcriptData.channelName,
          description: transcriptData.description
        });
      })
      .catch((error) => {
        errors.logError('YouTube transcript extraction failed', error);
        respond({ success: false, error: error?.message || 'Could not extract transcript.' });
      });
    return true;
  }

  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    transcriptButton?.destroy();
    transcriptButton = null;
    root.chrome.runtime.onMessage.removeListener(handleMessage);
  }

  root.chrome.runtime.onMessage.addListener(handleMessage);
  transcriptButton = new youtubeUi.YouTubeTranscriptButton({
    window: root,
    document: root.document,
    onCopy: async () => {
      const transcriptData = await extractTranscriptOnce();
      if (!transcriptData?.content || !/^Transcript:\s/i.test(transcriptData.content.trim())) {
        throw new Error(transcriptData?.error || 'Could not extract a usable transcript.');
      }
      return transcriptData.content;
    },
    onError: error => errors.logError('Could not copy YouTube transcript', error)
  }).start();

  root.CindraYouTubeContent = { cleanup, extractTranscriptOnce };

function removeTimestamps(text) {
  if (!text) return text;

  // Strip bracketed timestamps and normalize the gaps they leave behind.
  return text
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getChannelName() {
  try {
    const selectors = [
      'ytd-video-owner-renderer #channel-name #text a',
      '#owner ytd-channel-name yt-formatted-string a',
      'ytd-video-owner-renderer ytd-channel-name a',
      '#upload-info ytd-channel-name a',
      'ytd-channel-name #text a',
      'ytd-channel-name yt-formatted-string a'
    ];

    for (const selector of selectors) {
      const channelElement = document.querySelector(selector);
      if (channelElement && channelElement.textContent) {
        return channelElement.textContent.trim();
      }
    }

    // Keep the broad handle-link fallback scoped to video metadata.
    const scopeSelectors = ['#owner', 'ytd-video-owner-renderer', '#above-the-fold'];
    for (const scopeSelector of scopeSelectors) {
      const scope = document.querySelector(scopeSelector);
      if (scope) {
        const channelLinks = scope.querySelectorAll('a[href*="/@"]');
        for (const link of channelLinks) {
          const text = link.textContent.trim();
          if (text && text.length > 0 && text.length < 100) {
            return text;
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Error extracting channel name:', error);
    return null;
  }
}

function getVideoDescription() {
  try {
    const selectors = [
      'ytd-text-inline-expander#description-inline-expander yt-attributed-string',
      '#description-inline-expander yt-attributed-string',
      'ytd-watch-metadata #description yt-attributed-string',
      '#description yt-formatted-string'
    ];

    for (const selector of selectors) {
      const descElement = document.querySelector(selector);
      if (descElement && descElement.textContent) {
        let description = descElement.textContent.trim();
        description = description.replace(/\s+/g, ' ').trim();
        if (description.length > 0) {
          return description;
        }
      }
    }

    const expandedDesc = document.querySelector('#description-inner #expanded yt-attributed-string');
    if (expandedDesc && expandedDesc.textContent) {
      let description = expandedDesc.textContent.trim();
      description = description.replace(/\s+/g, ' ').trim();
      if (description.length > 0) {
        return description;
      }
    }

    return null;
  } catch (error) {
    console.error('Error extracting video description:', error);
    return null;
  }
}

function getYouTubeTranscript() {
  return new Promise(async (resolve) => {
    try {
      const title = document.title.replace(' - YouTube', '');
      const url = window.location.href;
      const videoId = new URLSearchParams(window.location.search).get('v');

      const channelName = getChannelName();
      const videoDescription = getVideoDescription();

      if (!videoId) {
        resolve({
          title,
          url,
          channelName,
          description: videoDescription,
          content: null,
          error: 'Could not find a YouTube video ID on this page.'
        });
        return;
      }

      const extractionTimeout = 8000;

      const timeoutPromise = new Promise(resolve => {
        setTimeout(() => {
          resolve({
            source: 'timeout',
            content: null
          });
        }, extractionTimeout);
      });

      // Prefer the visible transcript panel when it can be opened quickly.
      const domMethodPromise = new Promise(async (resolve) => {
        try {
          let transcriptText = getExistingTranscriptFromDOM();
          if (transcriptText) {
            resolve({
              source: 'dom-existing',
              content: transcriptText
            });
            return;
          }

          const transcriptButton = findTranscriptButton();
          if (transcriptButton) {
            transcriptButton.click();

            // YouTube may lazy-load segments after the panel opens.
            let attempts = 0;
            const maxAttempts = 15;
            while (attempts < maxAttempts) {
              await new Promise(r => setTimeout(r, 350));
              transcriptText = getExistingTranscriptFromDOM();
              if (transcriptText) {
                resolve({
                  source: 'dom-clicked',
                  content: transcriptText
                });
                return;
              }
              // Scroll the panel once loaded to encourage lazy-rendered segments.
              const scrollContainer = document.querySelector(
                'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"] .ytSectionListRendererContents, ' +
                'yt-section-list-renderer[data-target-id="PAmodern_transcript_view"] .ytSectionListRendererContents'
              );
              if (scrollContainer) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
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

      const playerDataPromise = new Promise(async (resolve) => {
        try {
          const playerResponse = getPlayerResponse();
          if (playerResponse && playerResponse.captions) {
            const captionTracks = playerResponse.captions.playerCaptionsTracklistRenderer?.captionTracks;
            if (captionTracks && captionTracks.length > 0) {
              const transcriptData = await getTranscriptContent(videoId, captionTracks);
              if (transcriptData) {
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

      // Modern YouTube no longer refreshes window.ytInitialPlayerResponse after
      // SPA navigation, and the get_transcript InnerTube endpoint 400s on a
      // hand-built params payload. Fetching the watch document same-origin is
      // the reliable way to recover captionTracks (baseUrl includes the pot /
      // signature tokens needed by the timedtext fetch).
      const pageFetchPromise = new Promise(async (resolve) => {
        try {
          const playerResponse = await getPlayerResponseViaFetch(videoId);
          if (playerResponse && playerResponse.captions) {
            const captionTracks = playerResponse.captions.playerCaptionsTracklistRenderer?.captionTracks;
            if (captionTracks && captionTracks.length > 0) {
              const transcriptData = await getTranscriptContent(videoId, captionTracks);
              if (transcriptData) {
                resolve({
                  source: 'page-fetch',
                  content: transcriptData
                });
                return;
              }
            }
          }
          resolve({
            source: 'page-fetch-failed',
            content: null
          });
        } catch (error) {
          console.error('Error with page fetch method:', error);
          resolve({
            source: 'page-fetch-error',
            content: null
          });
        }
      });

      const windowDataPromise = new Promise(async (resolve) => {
        try {
          if (window.ytInitialPlayerResponse) {
            const captionTracks = window.ytInitialPlayerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            if (captionTracks && captionTracks.length > 0) {
              const transcriptData = await getTranscriptContent(videoId, captionTracks);
              if (transcriptData) {
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

      // Give the DOM path first chance, then race the data-backed fallbacks.
      setTimeout(() => {
        Promise.race([domMethodPromise, timeoutPromise]).then(result => {
          if (result.content) {
            resolve({
              title,
              url,
              videoId,
              channelName,
              description: videoDescription,
              content: result.content
            });
          } else {
            Promise.race([
              playerDataPromise,
              pageFetchPromise,
              windowDataPromise,
              timeoutPromise
            ]).then(result => {
              if (result.content) {
                resolve({
                  title,
                  url,
                  videoId,
                  channelName,
                  description: videoDescription,
                  content: result.content
                });
              } else {
                resolve({
                  title,
                  url,
                  videoId,
                  channelName,
                  description: videoDescription,
                  content: null,
                  error: 'Could not extract transcript automatically. This video may not have captions available.'
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
        channelName: getChannelName(),
        description: getVideoDescription(),
        content: null,
        error: `Error extracting transcript: ${error.message}. Please check if this video has captions available.`
      });
    }
  });
}

function getYtcfg() {
  try {
    if (window.ytcfg && window.ytcfg.data_) {
      return window.ytcfg.data_;
    }

    // Some pages expose ytcfg only inside script tags.
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

function findTranscriptButton() {
  const possibleLabels = [
    'Show transcript',
    'Show Transcript',
    'Transcript',
    'Open transcript panel'
  ];

  for (const label of possibleLabels) {
    const btn = document.querySelector(`button[aria-label="${label}"]`);
    if (btn) {
      return btn;
    }
  }

  const menuItems = document.querySelectorAll('ytd-menu-service-item-renderer');
  for (const item of menuItems) {
    const text = item.textContent?.trim();
    if (text && possibleLabels.some(label => text.toLowerCase() === label.toLowerCase())) {
      return item;
    }
  }

  const possibleSelectors = [
    'tp-yt-paper-item:contains("Show transcript")',
    'button.ytp-button[aria-label="More actions"]',
    'ytd-menu-service-item-renderer:contains("Show transcript")',
    'button.ytp-subtitles-button',
    '.dropdown-trigger[aria-label="More actions"]',
    '.ytd-video-primary-info-renderer button.dropdown-trigger',
    'ytd-button-renderer.dropdown-trigger'
  ];

  for (const selector of possibleSelectors) {
    if (selector.includes(':contains')) {
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

function getPlayerResponse() {
  try {
    if (window.ytInitialPlayerResponse) {
      return window.ytInitialPlayerResponse;
    }

    if (window.ytplayer && window.ytplayer.config) {
      const playerResponse = window.ytplayer.config.args?.player_response;
      if (playerResponse) {
        return JSON.parse(playerResponse);
      }
    }

    const scriptElements = Array.from(document.querySelectorAll('script'));
    for (const script of scriptElements) {
      if (script.textContent.includes('ytInitialPlayerResponse')) {
        const match = script.textContent.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
        if (match && match[1]) {
          try {
            return JSON.parse(match[1]);
          } catch (e) {}
        }
      }

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

// Extract the first valid JSON object beginning at html[startIndex], honouring
// string literals and escapes so embedded braces do not confuse the depth count.
function extractJsonObjectAt(html, startIndex) {
  return CindraYouTubeParser.extractJsonObjectAt(html, startIndex);
}

// Locate `ytInitialPlayerResponse` in the watch page (it appears under several
// assignment forms) and brace-match its JSON object. Returns the object that
// actually carries captions, scanning past non-player assignments if needed.
function parsePlayerResponseFromHtml(html) {
  return CindraYouTubeParser.parsePlayerResponseFromHtml(html);
}

// Same-origin fetch of the watch document gives us a fresh player response with
// valid caption baseUrls (pot/signature included) for the current session.
async function getPlayerResponseViaFetch(videoId) {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      credentials: 'include'
    });
    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    return parsePlayerResponseFromHtml(html);
  } catch (error) {
    console.error('Error fetching watch page for player response:', error);
    return null;
  }
}

async function getTranscriptContent(videoId, captionTracks) {
  try {
    let selectedTrack = null;

    const englishTracks = captionTracks.filter(track =>
      track.languageCode === 'en' ||
      track.name?.simpleText?.toLowerCase().includes('english')
    );

    if (englishTracks.length > 0) {
      const manualTracks = englishTracks.filter(track =>
        !track.name?.simpleText?.toLowerCase().includes('auto-generated') &&
        !track.name?.simpleText?.toLowerCase().includes('automatic')
      );

      selectedTrack = manualTracks.length > 0 ? manualTracks[0] : englishTracks[0];
    } else {
      selectedTrack = captionTracks[0];
    }

    if (selectedTrack && selectedTrack.baseUrl) {
      let transcriptUrl = selectedTrack.baseUrl;

      if (!transcriptUrl.includes('&fmt=')) {
        transcriptUrl += '&fmt=json3';
      }

      try {
        const response = await fetch(transcriptUrl);
        if (!response.ok) throw new Error('Failed to fetch transcript data');

        const transcriptData = await response.text();

        try {
          if (transcriptData.startsWith('{')) {
            const jsonData = JSON.parse(transcriptData);
            if (jsonData.events) {
              let formattedText = 'Transcript:\n';
              for (const event of jsonData.events) {
                if (event.segs && event.tStartMs !== undefined) {
                  const text = event.segs.map(seg => seg.utf8).join(' ').trim();
                  if (text) {
                    const cleanText = removeTimestamps(text);
                    if (cleanText) {
                      formattedText += `${cleanText}\n`;
                    }
                  }
                }
              }
              return formattedText;
            }
          }

          return parseTranscriptXml(transcriptData);
        } catch (e) {
          console.error('Error parsing transcript data:', e);
          return null;
        }
      } catch (fetchError) {
        console.error('Fetch error:', fetchError);

        // Fall back to an iframe when direct fetch is blocked by CORS.
        return new Promise((resolve) => {
          const iframe = document.createElement('iframe');
          iframe.style.display = 'none';
          document.body.appendChild(iframe);

          const scriptId = `youtube_transcript_data_${Date.now()}`;
          const script = document.createElement('script');
          script.textContent = `
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

          iframe.contentDocument.body.appendChild(script);

          let attempt = 0;
          const maxAttempts = 10;
          const checkTranscriptData = () => {
            if (attempt >= maxAttempts) {
              document.body.removeChild(iframe);
              resolve(null);
              return;
            }

            const transcriptData = iframe.contentWindow[scriptId];
            if (transcriptData) {
              document.body.removeChild(iframe);

              try {
                if (transcriptData.startsWith('{')) {
                  const jsonData = JSON.parse(transcriptData);
                  if (jsonData.events) {
                    let formattedText = 'Transcript:\n';
                    for (const event of jsonData.events) {
                      if (event.segs && event.tStartMs !== undefined) {
                        const text = event.segs.map(seg => seg.utf8).join(' ').trim();
                        if (text) {
                          const cleanText = removeTimestamps(text);
                          if (cleanText) {
                            formattedText += `${cleanText}\n`;
                          }
                        }
                      }
                    }
                    resolve(formattedText);
                    return;
                  }
                }

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

function extractTranscriptFromApiResponse(data) {
  try {
    if (data && data.actions && data.actions.length > 0) {
      for (const action of data.actions) {
        if (action.updateEngagementPanelAction) {
          const content = action.updateEngagementPanelAction.content;
          if (content && content.transcriptRenderer && content.transcriptRenderer.body) {
            const cueGroups = content.transcriptRenderer.body.transcriptBodyRenderer.cueGroups;
            if (cueGroups && cueGroups.length > 0) {
              return formatTranscriptFromCueGroups(cueGroups);
            }
          }
        }

        if (action.appendContinuationItemsAction) {
          const items = action.appendContinuationItemsAction.continuationItems;
          if (items && items.length > 0) {
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
              let transcriptText = 'Transcript:\n\n';
              let currentParagraph = '';
              let lastEndTime = -1;

              for (const segment of segments) {
                const cleanText = removeTimestamps(segment.text);
                if (!cleanText) continue;

                // Paragraph breaks follow transcript pauses or sentence endings.
                if (lastEndTime !== -1 && segment.startTime - lastEndTime > 4 ||
                   (currentParagraph.length > 0 && currentParagraph.endsWith('.'))) {
                  transcriptText += `${currentParagraph.trim()}\n\n`;

                  currentParagraph = cleanText;
                } else {
                  if (currentParagraph.length > 0) {
                    currentParagraph += ' ';
                  }
                  currentParagraph += cleanText;
                }

                lastEndTime = segment.startTime;
              }

              if (currentParagraph.length > 0) {
                transcriptText += `${currentParagraph.trim()}\n`;
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

function formatTranscriptFromCueGroups(cueGroups) {
  let transcriptText = 'Transcript:\n\n';
  let currentParagraph = '';
  let lastEndTime = -1;

  for (const cueGroup of cueGroups) {
    if (cueGroup.transcriptCueGroupRenderer) {
      const cues = cueGroup.transcriptCueGroupRenderer.cues;
      if (cues && cues.length > 0) {
        for (const cue of cues) {
          if (cue.transcriptCueRenderer) {
            const text = cue.transcriptCueRenderer.cue?.simpleText || '';
            const startMs = parseInt(cue.transcriptCueRenderer.startOffsetMs || '0');
            const startSec = Math.floor(startMs / 1000);

            if (text) {
              const cleanText = removeTimestamps(text);
              if (!cleanText) continue;

              // Paragraph breaks follow transcript pauses or sentence endings.
              if (lastEndTime !== -1 && startSec - lastEndTime > 4 ||
                 (currentParagraph.length > 0 && currentParagraph.endsWith('.'))) {
                transcriptText += `${currentParagraph.trim()}\n\n`;

                currentParagraph = cleanText;
              } else {
                if (currentParagraph.length > 0) {
                  currentParagraph += ' ';
                }
                currentParagraph += cleanText;
              }

              lastEndTime = startSec;
            }
          }
        }
      }
    }
  }

  if (currentParagraph.length > 0) {
    transcriptText += `${currentParagraph.trim()}\n`;
  }

  return transcriptText.length > 15 ? transcriptText : null;
}

function getYtInitialData() {
  const scriptElements = Array.from(document.querySelectorAll('script'));
  for (const script of scriptElements) {
    if (script.textContent.includes('ytInitialData')) {
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

function parseTranscriptXml(xmlText) {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    const textElements = xmlDoc.getElementsByTagName('text');

    if (textElements.length === 0) {
      return null;
    }

    let transcriptText = 'Transcript:\n\n';
    let currentParagraph = '';
    let lastEndTime = -1;

    for (let i = 0; i < textElements.length; i++) {
      const text = textElements[i].textContent.trim();
      if (text) {
        const cleanText = removeTimestamps(text);
        if (!cleanText) continue;

        const startTime = parseFloat(textElements[i].getAttribute('start') || '0');

        // Paragraph breaks follow transcript pauses or sentence endings.
        if (lastEndTime !== -1 && startTime - lastEndTime > 4 ||
           (currentParagraph.length > 0 && currentParagraph.endsWith('.'))) {
          transcriptText += `${currentParagraph.trim()}\n\n`;

          currentParagraph = cleanText;
        } else {
          if (currentParagraph.length > 0) {
            currentParagraph += ' ';
          }
          currentParagraph += cleanText;
        }

        lastEndTime = startTime;
      }
    }

    if (currentParagraph.length > 0) {
      transcriptText += `${currentParagraph.trim()}\n`;
    }

    return transcriptText.length > 15 ? transcriptText : null;
  } catch (error) {
    console.error('Error parsing XML:', error);
    return null;
  }
}

function getExistingTranscriptFromDOM() {
  try {
    // Closed transcript panels can remain in the DOM, so require visible state or segment content.
    const possiblePanelSelectors = [
      'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]',
      'yt-section-list-renderer[data-target-id="PAmodern_transcript_view"]',
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
      for (const panel of panels) {
        const visibility = panel.getAttribute('visibility');
        const hasContent = panel.querySelector('transcript-segment-view-model, ytd-transcript-segment-renderer');
        if (!visibility || visibility.includes('EXPANDED') || hasContent) {
          transcriptPanel = panel;
          break;
        }
      }
      if (transcriptPanel) break;
    }

    if (!transcriptPanel) {
      return null;
    }

    // Current transcript panels render each row as transcript-segment-view-model.
    const newSegments = transcriptPanel.querySelectorAll('transcript-segment-view-model');
    if (newSegments.length > 0) {
      let transcriptText = 'Transcript:\n\n';
      let currentParagraph = '';

      newSegments.forEach(segment => {
        const textEl = segment.querySelector('span[role="text"]');
        const text = textEl ? textEl.textContent.trim() : '';

        if (text) {
          const cleanText = removeTimestamps(text);
          if (!cleanText) return;

          if (currentParagraph.length > 0 &&
             (currentParagraph.endsWith('.') || currentParagraph.endsWith('?') || currentParagraph.endsWith('!'))) {
            transcriptText += `${currentParagraph.trim()}\n\n`;
            currentParagraph = cleanText;
          } else {
            if (currentParagraph.length > 0) {
              currentParagraph += ' ';
            }
            currentParagraph += cleanText;
          }
        }
      });

      if (currentParagraph.length > 0) {
        transcriptText += `${currentParagraph.trim()}\n`;
      }

      if (transcriptText.length > 15) {
        return transcriptText;
      }
    }

    // Legacy panels expose several older segment shapes.
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

    let transcriptText = 'Transcript:\n\n';
    let currentParagraph = '';

    if (transcriptPanel.querySelector('ytd-transcript-segment-renderer')) {
      Array.from(segments).forEach(item => {
        const text = item.querySelector('.segment-text, .cue-text, .text, .subtitle-text')?.textContent?.trim() || '';

        if (text) {
          const cleanText = removeTimestamps(text);
          if (!cleanText) return;

          if (currentParagraph.length > 0 &&
             (currentParagraph.endsWith('.') || currentParagraph.endsWith('?') || currentParagraph.endsWith('!'))) {
            transcriptText += `${currentParagraph.trim()}\n\n`;
            currentParagraph = cleanText;
          } else {
            if (currentParagraph.length > 0) {
              currentParagraph += ' ';
            }
            currentParagraph += cleanText;
          }
        }
      });
    } else {
      Array.from(segments).forEach(item => {
        let text = '';

        const spans = item.querySelectorAll('span');
        if (spans.length >= 2) {
          text = spans[1].textContent.trim();
        } else {
          text = item.textContent.trim();
          const match = text.match(/^(\d+:\d+)\s+(.+)$/);
          if (match) {
            text = match[2];
          }
        }

        if (text) {
          const cleanText = removeTimestamps(text);
          if (!cleanText) return;

          if (currentParagraph.length > 0 &&
             (currentParagraph.endsWith('.') || currentParagraph.endsWith('?') || currentParagraph.endsWith('!'))) {
            transcriptText += `${currentParagraph.trim()}\n\n`;
            currentParagraph = cleanText;
          } else {
            if (currentParagraph.length > 0) {
              currentParagraph += ' ';
            }
            currentParagraph += cleanText;
          }
        }
      });
    }

    if (currentParagraph.length > 0) {
      transcriptText += `${currentParagraph.trim()}\n`;
    }

    return transcriptText.length > 15 ? transcriptText : null;
  } catch (error) {
    console.error('Error extracting from DOM:', error);
    return null;
  }
}

})(globalThis);
