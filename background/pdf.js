(function (root) {
  'use strict';

  const pdfUtils = root.CindraPdf;
  const OFFSCREEN_DOCUMENT_PATH = 'offscreen/pdf_extractor.html';
  const PDF_MODULE_URL = chrome.runtime.getURL('vendor/pdfjs/pdf.min.mjs');
  const PDF_WORKER_URL = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');
  const PDF_CMAP_URL = chrome.runtime.getURL('vendor/pdfjs/cmaps/');
  const PDF_STANDARD_FONT_URL = chrome.runtime.getURL('vendor/pdfjs/standard_fonts/');
  const PDF_WASM_URL = chrome.runtime.getURL('vendor/pdfjs/wasm/');
  const FETCH_TIMEOUT_MS = 30000;
  let extractionQueue = Promise.resolve();

  async function extractFullText(tab) {
    const errors = [];

    try {
      return await queueOffscreenExtraction(tab.url);
    } catch (error) {
      errors.push(`offscreen: ${error?.message || error}`);
      console.warn('Offscreen PDF extraction failed; trying tab extraction.', error);
    }

    try {
      return await extractFromTab(tab.id, tab.url);
    } catch (error) {
      errors.push(`tab: ${error?.message || error}`);
    }

    throw new Error(errors.join(' | '));
  }

  function queueOffscreenExtraction(url) {
    const run = async () => {
      await ensureOffscreenDocument();
      try {
        await waitForOffscreenReady();
        const result = await chrome.runtime.sendMessage({
          action: 'extractPdfTextInOffscreen',
          url,
          maxBytes: pdfUtils.DEFAULT_MAX_BYTES,
          timeoutMs: FETCH_TIMEOUT_MS
        });

        if (!result?.success) {
          throw new Error(result?.error || 'PDF extractor did not respond.');
        }
        return pdfUtils.normalizeExtractedText(result.text || '');
      } finally {
        await closeOffscreenDocument();
      }
    };

    const result = extractionQueue.then(run, run);
    extractionQueue = result.catch(() => {});
    return result;
  }

  async function ensureOffscreenDocument() {
    if (!chrome.offscreen?.createDocument) {
      throw new Error('Chrome offscreen documents are unavailable.');
    }

    if (await hasOffscreenDocument()) return;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['DOM_PARSER'],
      justification: 'Extract text from a user-selected PDF for summarization.'
    });
  }

  async function hasOffscreenDocument() {
    if (chrome.offscreen?.hasDocument) {
      return chrome.offscreen.hasDocument();
    }
    if (!chrome.runtime.getContexts) return false;

    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });
    return contexts.length > 0;
  }

  async function waitForOffscreenReady() {
    let lastError = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'pdfExtractorPing' });
        if (response?.ready) return;
      } catch (error) {
        lastError = error;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(lastError?.message || 'PDF extractor did not become ready.');
  }

  async function closeOffscreenDocument() {
    try {
      if (await hasOffscreenDocument()) {
        await chrome.offscreen.closeDocument();
      }
    } catch (error) {
      console.warn('Could not close Cindra PDF extractor.', error);
    }
  }

  function extractFromTab(tabId, pdfUrl) {
    if (!tabId) {
      return Promise.reject(new Error('No PDF tab id available.'));
    }

    return new Promise((resolve, reject) => {
      chrome.scripting.executeScript({
        target: { tabId },
        function: extractCurrentPdfText,
        args: [
          PDF_MODULE_URL,
          PDF_WORKER_URL,
          PDF_CMAP_URL,
          PDF_STANDARD_FONT_URL,
          PDF_WASM_URL,
          pdfUtils.DEFAULT_MAX_BYTES,
          FETCH_TIMEOUT_MS,
          pdfUrl
        ]
      }, (results) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const result = results?.[0]?.result;
        if (!result?.success) {
          reject(new Error(result?.error || 'PDF tab extraction failed.'));
          return;
        }
        resolve(pdfUtils.normalizeExtractedText(result.text || ''));
      });
    });
  }

  // Serialized into the PDF tab; keep every helper inside this function.
  async function extractCurrentPdfText(moduleUrl, workerUrl, cMapUrl, standardFontDataUrl, wasmUrl, maxBytes, timeoutMs, pdfUrl) {
    const normalizeText = (text) => (text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    let fetchTimeout = null;

    try {
      const sourceUrl = typeof pdfUrl === 'string' && pdfUrl ? pdfUrl : window.location.href;
      const parsedUrl = new URL(sourceUrl);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('Only HTTP and HTTPS PDF URLs can be downloaded.');
      }

      const controller = new AbortController();
      fetchTimeout = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(parsedUrl.href, {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`PDF tab download failed with HTTP ${response.status}.`);
      }

      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > maxBytes) {
        throw new Error(`PDF is too large to extract (${contentLength} bytes).`);
      }

      const reader = response.body?.getReader();
      const chunks = [];
      let totalBytes = 0;
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value?.byteLength) continue;
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel();
            throw new Error(`PDF is too large to extract (more than ${maxBytes} bytes).`);
          }
          chunks.push(value);
        }
      } else {
        const buffer = await response.arrayBuffer();
        totalBytes = buffer.byteLength;
        if (totalBytes > maxBytes) throw new Error(`PDF is too large to extract (${totalBytes} bytes).`);
        chunks.push(new Uint8Array(buffer));
      }
      clearTimeout(fetchTimeout);
      fetchTimeout = null;

      const bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (!bytes.byteLength) throw new Error('PDF download returned an empty file.');

      let header = '';
      for (let index = 0; index < Math.min(bytes.byteLength, 1024); index += 1) {
        header += String.fromCharCode(bytes[index]);
      }
      if (!header.includes('%PDF-')) throw new Error('PDF download did not return a PDF file.');

      const pdfjsLib = await import(moduleUrl);
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      const loadingTask = pdfjsLib.getDocument({
        data: bytes,
        cMapUrl,
        cMapPacked: true,
        standardFontDataUrl,
        wasmUrl,
        isEvalSupported: false
      });
      const pdf = await loadingTask.promise;
      const pages = [];

      try {
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map(item => (item.str || '') + (item.hasEOL ? '\n' : ' '))
            .join('')
            .trim();
          if (pageText) pages.push(`[Page ${pageNumber}]\n${pageText}`);
          page.cleanup?.();
        }
      } finally {
        await pdf.destroy?.();
      }

      return { success: true, text: normalizeText(pages.join('\n\n')) };
    } catch (error) {
      return { success: false, error: error?.message || 'PDF tab extraction failed.' };
    } finally {
      if (fetchTimeout) clearTimeout(fetchTimeout);
    }
  }

  root.CindraBackgroundPdf = { extractFullText, closeOffscreenDocument };
})(globalThis);
