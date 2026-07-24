import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

const pdfUtils = globalThis.CindraPdf;
const errors = globalThis.CindraErrors;
const messages = globalThis.CindraMessages;
const ACTIONS = messages.ACTIONS;
const DEFAULT_TIMEOUT_MS = 30000;
const OFFSCREEN_ACTIONS = [
  ACTIONS.PDF_EXTRACTOR_PING,
  ACTIONS.EXTRACT_PDF_TEXT_IN_OFFSCREEN
];

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !OFFSCREEN_ACTIONS.includes(message.action)) return false;

  const respond = messages.respondOnce(sendResponse);
  const validation = messages.validateMessage(message, OFFSCREEN_ACTIONS);
  if (!validation.ok) {
    respond({ success: false, error: validation.error });
    return false;
  }

  if (sender.id !== chrome.runtime.id || sender.tab) {
    respond({ success: false, error: 'PDF extraction request was not trusted.' });
    return false;
  }

  if (message.action === ACTIONS.PDF_EXTRACTOR_PING) {
    respond({ ready: true });
    return false;
  }

  extractPdfTextFromUrl(
    message.url,
    message.maxBytes || pdfUtils.DEFAULT_MAX_BYTES,
    message.timeoutMs || DEFAULT_TIMEOUT_MS
  )
    .then(text => respond({ success: true, text }))
    .catch((error) => {
      errors.logError('Offscreen PDF extraction failed', error);
      respond({
        success: false,
        error: errors.toUserMessage(error, error?.message || 'PDF extraction failed.')
      });
    });
  return true;
});

async function extractPdfTextFromUrl(url, maxBytes, timeoutMs) {
  const sourceUrl = pdfUtils.assertFetchablePdfUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let bytes;

  try {
    response = await fetch(sourceUrl, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`PDF download failed with HTTP ${response.status}.`);
    }

    bytes = await pdfUtils.readResponseBytes(response, maxBytes);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('PDF download timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const loadingTask = pdfjsLib.getDocument({
    data: bytes,
    cMapUrl: chrome.runtime.getURL('vendor/pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL('vendor/pdfjs/standard_fonts/'),
    wasmUrl: chrome.runtime.getURL('vendor/pdfjs/wasm/'),
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

      if (pageText) {
        pages.push(`[Page ${pageNumber}]\n${pageText}`);
      }
      page.cleanup?.();
    }
  } finally {
    await pdf.destroy?.();
  }

  return pdfUtils.normalizeExtractedText(pages.join('\n\n'));
}
