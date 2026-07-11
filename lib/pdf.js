(function (root, factory) {
  'use strict';

  const api = factory();
  root.CindraPdf = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

  function assertFetchablePdfUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      throw new Error('PDF URL is invalid.');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only HTTP and HTTPS PDF URLs can be downloaded.');
    }

    return parsed.href;
  }

  function ensurePdfBytes(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    if (!view.byteLength) {
      throw new Error('PDF download returned an empty file.');
    }

    const headerLength = Math.min(view.byteLength, 1024);
    let headerText = '';
    for (let index = 0; index < headerLength; index += 1) {
      headerText += String.fromCharCode(view[index]);
    }

    if (!headerText.includes('%PDF-')) {
      throw new Error('PDF download did not return a PDF file.');
    }

    return view;
  }

  async function readResponseBytes(response, maxBytes = DEFAULT_MAX_BYTES) {
    const limit = Math.max(1, Math.floor(Number(maxBytes) || DEFAULT_MAX_BYTES));
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > limit) {
      throw new Error(`PDF is too large to extract (${contentLength} bytes).`);
    }

    if (!response.body?.getReader) {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > limit) {
        throw new Error(`PDF is too large to extract (${buffer.byteLength} bytes).`);
      }
      return ensurePdfBytes(new Uint8Array(buffer));
    }

    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;

        totalBytes += value.byteLength;
        if (totalBytes > limit) {
          await reader.cancel('PDF exceeded Cindra size limit.');
          throw new Error(`PDF is too large to extract (more than ${limit} bytes).`);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock?.();
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return ensurePdfBytes(bytes);
  }

  function normalizeExtractedText(text) {
    return (text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  return {
    DEFAULT_MAX_BYTES,
    assertFetchablePdfUrl,
    ensurePdfBytes,
    readResponseBytes,
    normalizeExtractedText
  };
});
