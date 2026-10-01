// Executed on demand in the page's MAIN world. Return only extraction data;
// never expose a general page-evaluation or arbitrary-URL fetch interface.
(function (root) {
  'use strict';

  function readYouTubePageData(videoId, includePanel = false) {
    if (location.origin !== 'https://www.youtube.com' ||
        location.pathname !== '/watch' || new URLSearchParams(location.search).get('v') !== videoId) {
      return null;
    }
    const player = document.getElementById('movie_player');
    let response;
    try { response = player?.getPlayerResponse?.(); } catch (_) {}
    if (response?.videoDetails?.videoId !== videoId) response = window.ytInitialPlayerResponse;
    if (response?.videoDetails?.videoId !== videoId) response = null;

    const watch = document.querySelector('ytd-watch-flexy');
    const watchData = watch?.data;
    const dataVideoId = data => data?.currentVideoEndpoint?.watchEndpoint?.videoId;
    const currentData = dataVideoId(watchData) === videoId ? watchData :
      dataVideoId(window.ytInitialData) === videoId ? window.ytInitialData : null;
    let params = null;
    let panelRequest = null;
    const findEndpoint = (value, budget = { left: 20000 }, transcriptSection = false) => {
      if (!value || typeof value !== 'object' || --budget.left < 0) return;
      if (typeof value.getTranscriptEndpoint?.params === 'string') params = value.getTranscriptEndpoint.params;
      const endpoint = value.showEngagementPanelEndpoint;
      const panelId = endpoint?.identifier?.tag || endpoint?.panelIdentifier;
      if (transcriptSection && typeof panelId === 'string' && panelId.length <= 128 &&
          typeof endpoint.globalConfiguration?.params === 'string') {
        panelRequest = { panelId, params: endpoint.globalConfiguration.params };
      }
      for (const child of Object.values(value)) findEndpoint(child, budget, transcriptSection);
    };
    if (currentData) {
      findEndpoint(currentData);
      for (const section of document.querySelectorAll('ytd-video-description-transcript-section-renderer')) {
        findEndpoint(section.data, { left: 1000 }, true);
      }
    }
    const config = window.ytcfg?.data_ || {};
    const client = config.INNERTUBE_CONTEXT?.client;
    const context = client ? { client: {
      clientName: client.clientName,
      clientVersion: client.clientVersion,
      hl: client.hl,
      gl: client.gl,
      visitorData: client.visitorData
    } } : null;

    const panelSelector = 'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"], ' +
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"], ' +
      'yt-section-list-renderer[data-target-id="PAmodern_transcript_view"]';
    let panelData = null;
    // Only inspect a panel for a verified, current watch-page model. A retained
    // panel from a previous SPA video must not be mistaken for this video.
    if (includePanel && currentData && watch?.getAttribute('video-id') === videoId) {
      const panel = Array.from(document.querySelectorAll(panelSelector)).find(element =>
        !element.hidden && element.getAttribute('visibility') !== 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
      const container = panel?.closest('ytd-engagement-panel-section-list-renderer') || panel;
      panelData = container?.data || container?.__data?.data || null;
      if (!panelData || typeof panelData !== 'object') panelData = currentData.engagementPanels || null;
      if (panelData?.videoId && panelData.videoId !== videoId) panelData = null;
    }
    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const result = {
      videoId,
      player: response ? {
        videoDetails: response.videoDetails,
        playabilityStatus: { status: response.playabilityStatus?.status },
        microformat: { playerMicroformatRenderer: {
          liveBroadcastDetails: response.microformat?.playerMicroformatRenderer?.liveBroadcastDetails
        } },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks.slice(0, 100).map(track => ({
          baseUrl: track.baseUrl,
          languageCode: track.languageCode,
          kind: track.kind,
          vssId: track.vssId
        })) } }
      } : null,
      transcriptParams: params?.length <= 100000 ? params : null,
      panelRequest: panelRequest?.params.length <= 100000 ? panelRequest : null,
      context,
      panelData
    };
    // Detach page-owned objects before crossing the execution-world boundary.
    const json = JSON.stringify(result);
    return json.length <= 8000000 ? JSON.parse(json) : null;
  }

  root.CindraYouTubePage = { readYouTubePageData };
})(globalThis);
