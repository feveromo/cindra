(function (root, factory) {
  'use strict';

  const api = factory();
  root.CindraTranscriptCache = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CACHE_KEY_PREFIX = 'transcript_';
  const METADATA_KEY = 'cindraTranscriptCacheMetadata';
  const MAX_ENTRIES = 20;
  const TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

  function cacheKey(videoId) {
    if (!VIDEO_ID_PATTERN.test(videoId || '')) {
      throw new TypeError('YouTube video id is malformed.');
    }
    return `${CACHE_KEY_PREFIX}${videoId}`;
  }

  function isCacheableTranscript(content) {
    const text = typeof content === 'string' ? content.trim() : '';
    if (!/^Transcript:\s/.test(text)) return false;
    return !/^Transcript:\s*(?:Error extracting|Could not extract|To access the transcript manually)/i
      .test(text);
  }

  function isCacheableRecord(videoId, transcript) {
    return transcript?.videoId === videoId && transcript.extractionVersion === 2 &&
      transcript.complete === true && isCacheableTranscript(transcript.content);
  }

  function normalizeMetadata(value) {
    const entries = value?.version === 1 && value.entries && typeof value.entries === 'object'
      ? value.entries
      : {};
    return { version: 1, entries: { ...entries } };
  }

  function create({
    get,
    set,
    remove,
    now = () => Date.now(),
    maxEntries = MAX_ENTRIES,
    ttlMs = TTL_MS
  }) {
    if (typeof get !== 'function' || typeof set !== 'function' || typeof remove !== 'function') {
      throw new TypeError('Transcript cache requires get, set, and remove storage functions.');
    }

    const normalizedMaxEntries = Math.max(1, Math.floor(Number(maxEntries) || MAX_ENTRIES));
    const normalizedTtlMs = Math.max(1, Math.floor(Number(ttlMs) || TTL_MS));

    async function loadState() {
      return (await get(null)) || {};
    }

    async function maintain(state, accessedVideoId = null) {
      const timestamp = now();
      const metadata = normalizeMetadata(state[METADATA_KEY]);
      const removals = [];
      const liveEntries = [];

      for (const [key, transcript] of Object.entries(state)) {
        if (!key.startsWith(CACHE_KEY_PREFIX)) continue;
        const videoId = key.slice(CACHE_KEY_PREFIX.length);
        if (!VIDEO_ID_PATTERN.test(videoId) || !isCacheableRecord(videoId, transcript)) {
          removals.push(key);
          delete metadata.entries[videoId];
          continue;
        }

        const existing = metadata.entries[videoId] || {};
        // Records from the old DOM-slice extractor are discarded above: their
        // completeness and video association were never verified.
        const cachedAt = Number(existing.cachedAt || transcript.cachedAt || 0) || timestamp;
        const lastAccessedAt = videoId === accessedVideoId
          ? timestamp
          : Number(existing.lastAccessedAt || cachedAt);

        if (timestamp - cachedAt >= normalizedTtlMs) {
          removals.push(key);
          delete metadata.entries[videoId];
          continue;
        }

        metadata.entries[videoId] = { cachedAt, lastAccessedAt };
        liveEntries.push({ key, videoId, cachedAt, lastAccessedAt });
      }

      liveEntries.sort((left, right) =>
        right.lastAccessedAt - left.lastAccessedAt ||
        right.cachedAt - left.cachedAt ||
        left.videoId.localeCompare(right.videoId)
      );

      for (const entry of liveEntries.slice(normalizedMaxEntries)) {
        removals.push(entry.key);
        delete metadata.entries[entry.videoId];
      }

      if (removals.length) await remove([...new Set(removals)]);
      await set({ [METADATA_KEY]: metadata });

      return {
        metadata,
        removedKeys: [...new Set(removals)],
        keptVideoIds: liveEntries
          .slice(0, normalizedMaxEntries)
          .map(entry => entry.videoId)
      };
    }

    async function getTranscript(videoId) {
      const key = cacheKey(videoId);
      const state = await loadState();
      const maintenance = await maintain(state, videoId);
      if (maintenance.removedKeys.includes(key)) return null;

      const transcript = state[key];
      return isCacheableRecord(videoId, transcript) ? transcript : null;
    }

    async function setTranscript(videoId, transcript) {
      const key = cacheKey(videoId);
      if (!isCacheableRecord(videoId, transcript)) {
        await remove([key]);
        const state = await loadState();
        await maintain(state);
        return false;
      }

      const timestamp = now();
      const state = await loadState();
      const metadata = normalizeMetadata(state[METADATA_KEY]);
      const storedTranscript = {
        ...transcript,
        videoId,
        cachedAt: timestamp
      };

      state[key] = storedTranscript;
      metadata.entries[videoId] = {
        cachedAt: timestamp,
        lastAccessedAt: timestamp
      };
      state[METADATA_KEY] = metadata;
      await set({
        [key]: storedTranscript,
        [METADATA_KEY]: metadata
      });
      await maintain(state, videoId);
      return true;
    }

    async function removeTranscript(videoId) {
      const key = cacheKey(videoId);
      const state = await loadState();
      const metadata = normalizeMetadata(state[METADATA_KEY]);
      delete metadata.entries[videoId];
      await remove([key]);
      await set({ [METADATA_KEY]: metadata });
    }

    async function cleanup() {
      return maintain(await loadState());
    }

    return {
      cleanup,
      get: getTranscript,
      remove: removeTranscript,
      set: setTranscript
    };
  }

  return {
    CACHE_KEY_PREFIX,
    MAX_ENTRIES,
    METADATA_KEY,
    TTL_MS,
    VIDEO_ID_PATTERN,
    cacheKey,
    create,
    isCacheableTranscript,
    normalizeMetadata
  };
});
