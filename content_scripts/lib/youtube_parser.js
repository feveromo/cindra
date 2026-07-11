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

  function parsePlayerResponseFromHtml(html) {
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
        if (parsed?.captions) return parsed;
      }

      searchFrom = assignIndex + 1;
    }

    return null;
  }

  return { extractJsonObjectAt, parsePlayerResponseFromHtml };
});
