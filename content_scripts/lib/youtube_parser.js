(function (root, factory) {
  'use strict';

  const api = factory();
  root.CindraYouTubeParser = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function extractJsonObjectAt(html, startIndex) {
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let index = startIndex; index < html.length; index += 1) {
      const character = html[index];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (character === '\\') {
          escape = true;
        } else if (character === '"') {
          inString = false;
        }
      } else if (character === '"') {
        inString = true;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(startIndex, index + 1));
          } catch (error) {
            return null;
          }
        }
      }
    }

    return null;
  }

  function parsePlayerResponseFromHtml(html, videoId = null) {
    if (typeof html !== 'string' || !html) return null;

    const marker = 'ytInitialPlayerResponse';
    let searchFrom = 0;
    while (searchFrom < html.length) {
      const markerIndex = html.indexOf(marker, searchFrom);
      if (markerIndex === -1) return null;

      const assignIndex = html.indexOf('=', markerIndex + marker.length);
      if (assignIndex === -1 || assignIndex - markerIndex > 128) {
        searchFrom = markerIndex + marker.length;
        continue;
      }

      let jsonStart = assignIndex + 1;
      while (jsonStart < html.length && /\s/.test(html[jsonStart])) jsonStart += 1;
      if (html[jsonStart] === '{') {
        const parsed = extractJsonObjectAt(html, jsonStart);
        if (parsed && (videoId ? parsed.videoDetails?.videoId === videoId : parsed.captions)) return parsed;
      }

      searchFrom = assignIndex + 1;
    }

    return null;
  }

  function normalizeSegments(segments) {
    const unique = new Map();
    for (const segment of segments) {
      const startMs = Number(segment.startMs);
      const durationMs = Number(segment.durationMs || 0);
      const text = String(segment.text || '').replace(/\s+/g, ' ').trim();
      if (!text || !Number.isFinite(startMs) || startMs < 0 ||
          !Number.isFinite(durationMs) || durationMs < 0) continue;
      // Deduplicate repeated renderer entries, not repeated spoken words.
      unique.set(`${startMs}:${text}`, { startMs, durationMs, text });
    }
    return Array.from(unique.values()).sort((left, right) => left.startMs - right.startMs);
  }

  function formatSegments(segments) {
    const paragraphs = [];
    let paragraph = '';
    let previous;
    for (const segment of normalizeSegments(segments)) {
      if (paragraph && (/[.!?。！？]$/.test(paragraph) ||
          segment.startMs - (previous.startMs + previous.durationMs) > 4000)) {
        paragraphs.push(paragraph);
        paragraph = '';
      }
      paragraph += (paragraph ? ' ' : '') + segment.text;
      previous = segment;
    }
    if (paragraph) paragraphs.push(paragraph);
    return paragraphs.length ? `Transcript:\n\n${paragraphs.join('\n\n')}` : null;
  }

  function parseCaptions(payload, Parser = globalThis.DOMParser) {
    if (typeof payload !== 'string' || payload.length > 8000000) return [];
    const text = payload.trim();
    try {
      if (text.startsWith('{')) {
        const data = JSON.parse(text);
        if (!Array.isArray(data.events)) return [];
        return normalizeSegments(data.events.filter(event => event.tStartMs !== undefined).map(event => ({
          startMs: event.tStartMs,
          durationMs: event.dDurationMs,
          // JSON3 segment boundaries are often word fragments with their own spaces.
          text: event.segs?.map(segment => segment.utf8 || '').join('')
        })));
      }
      if (!Parser) return [];
      const doc = new Parser().parseFromString(text, 'text/xml');
      if (doc.querySelector('parsererror')) return [];
      if (doc.documentElement.tagName === 'transcript') {
        return normalizeSegments(Array.from(doc.querySelectorAll('text')).map(element => ({
          startMs: Number(element.getAttribute('start')) * 1000,
          durationMs: Number(element.getAttribute('dur')) * 1000,
          text: element.textContent
        })));
      }
      if (doc.documentElement.tagName === 'timedtext') {
        return normalizeSegments(Array.from(doc.querySelectorAll('body > p')).map(element => ({
          startMs: Number(element.getAttribute('t')),
          durationMs: Number(element.getAttribute('d')),
          text: element.textContent
        })));
      }
    } catch (_) {}
    return [];
  }

  function selectTrack(tracks) {
    const available = (tracks || []).filter(track => typeof track.baseUrl === 'string');
    const english = available.filter(track => /^en(?:-|$)/i.test(track.languageCode || ''));
    const candidates = english.length ? english : available;
    return candidates.find(track => track.kind !== 'asr') || candidates[0] || null;
  }

  function textOf(value) {
    if (typeof value === 'string') return value;
    return value?.simpleText || value?.content || value?.runs?.map(run => run.text || '').join('') || '';
  }

  function parseTranscriptResponse(data) {
    const segments = [];
    let incomplete = false;
    let language = null;
    let remaining = 50000;
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (--remaining < 0) { incomplete = true; return; }
      if (value.continuationItemRenderer || value.continuations?.length) incomplete = true;
      const segment = value.transcriptSegmentRenderer;
      const cue = value.transcriptCueRenderer;
      const modern = value.transcriptSegmentViewModel;
      if (modern) {
        const parts = String(modern.timestamp || '').split(':');
        const seconds = parts.every(part => /^\d+$/.test(part))
          ? parts.reduce((total, part) => total * 60 + Number(part), 0) : NaN;
        segments.push({ startMs: seconds * 1000, text: textOf(modern.attributedText) || modern.simpleText });
        return;
      }
      if (segment) {
        segments.push({
          startMs: segment.startMs,
          durationMs: Math.max(0, Number(segment.endMs) - Number(segment.startMs)) || 0,
          text: textOf(segment.snippet)
        });
        return;
      }
      if (cue) {
        segments.push({ startMs: cue.startOffsetMs, durationMs: cue.durationMs, text: textOf(cue.cue) });
        return;
      }
      if (value.selected && value.title && value.continuation?.reloadContinuationData) {
        language = textOf(value.title);
      }
      for (const child of Object.values(value)) visit(child);
    }
    visit(data);
    return { segments: normalizeSegments(segments), complete: !incomplete, language };
  }

  return {
    extractJsonObjectAt, parsePlayerResponseFromHtml, normalizeSegments,
    formatSegments, parseCaptions, selectTrack, parseTranscriptResponse
  };
});
