(function (root, factory) {
  'use strict';

  const api = factory();
  root.CindraBackgroundContent = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function isArxivPdfUrl(url) {
    const hostname = url.hostname.toLowerCase();
    return (hostname === 'arxiv.org' || hostname.endsWith('.arxiv.org')) &&
      url.pathname.startsWith('/pdf/');
  }

  function isPdfUrl(url = '') {
    try {
      const parsedUrl = new URL(url);
      return /\.pdf$/i.test(parsedUrl.pathname) || isArxivPdfUrl(parsedUrl);
    } catch (error) {
      return /\.pdf(?:[?#]|$)/i.test(url) ||
        /^https?:\/\/(?:[^/]+\.)?arxiv\.org\/pdf\/[^/?#]+/i.test(url);
    }
  }

  function resolveContentRoute({
    contentSource = 'auto',
    selectedText = '',
    capturedPageContent = '',
    capturedPageAttempted = false,
    isPdf = false,
    isYouTube = false,
    isReddit = false
  } = {}) {
    if (contentSource === 'selection') {
      return selectedText.trim() ? 'captured-selection' : 'extract-selection';
    }

    if (capturedPageContent.trim()) return 'captured-page';
    if (capturedPageAttempted) return isPdf ? 'pdf' : 'empty-captured-page';
    if (isPdf) return 'pdf';
    if (contentSource === 'pdf') return 'validate-pdf';
    if (contentSource === 'page') return 'page';
    if (isYouTube) return 'youtube';
    if (isReddit) return 'reddit';
    return 'page';
  }

  // This function is passed directly to chrome.scripting.executeScript and
  // therefore must remain self-contained.
  function getPageContent(contentSource = 'page') {
    const title = document.title;
    const url = window.location.href;
    const description = document.querySelector('meta[name="description"]')?.content || '';
    const selection = window.getSelection?.().toString().trim() || '';
    const isPdf = isPdfDocument();

    if (contentSource === 'selection') {
      if (!selection) {
        return { title, url, error: 'No selected text found on this page.' };
      }

      return {
        title,
        url,
        description,
        sourceType: 'selection',
        content: normalizeExtractedText(selection)
      };
    }

    if (contentSource === 'pdf' && !isPdf) {
      return {
        title,
        url,
        error: 'This tab does not look like a PDF. Use Page Text for normal webpages.'
      };
    }

    if (contentSource === 'pdf' || isPdf) {
      const pdfContent = getPdfText();
      if (pdfContent) {
        return {
          title,
          url,
          description,
          sourceType: 'pdf',
          content: pdfContent
        };
      }

      return {
        title,
        url,
        error: 'No selectable PDF text found. Scanned PDFs need OCR, and protected viewers may block extraction.'
      };
    }

    return {
      title,
      url,
      description,
      sourceType: 'page',
      content: getReadablePageText()
    };

    function getReadablePageText() {
      const selectors = [
        '#delform',
        '.thread',
        'main',
        'article',
        '[role="main"]',
        '#content',
        '.content',
        '.main-content',
        '#main'
      ];

      const candidates = selectors
        .flatMap(selector => Array.from(document.querySelectorAll(selector)))
        .filter(Boolean);
      const bestCandidate = candidates
        .map(element => ({ element, length: (element.innerText || '').trim().length }))
        .sort((a, b) => b.length - a.length)[0]?.element;
      const sourceElement = bestCandidate || document.body;
      if (!sourceElement) return '';

      const clone = sourceElement.cloneNode(true);
      clone.querySelectorAll([
        'script',
        'style',
        'noscript',
        'nav',
        'footer',
        'header',
        'aside',
        'form',
        'button',
        'input',
        'select',
        'textarea',
        '[hidden]',
        '[aria-hidden="true"]',
        '.cindra-summary-ext',
        '.web-summary-button',
        '.yt-summary-widget',
        '[data-extension="cindra-summary"]'
      ].join(',')).forEach(element => element.remove());

      return normalizeExtractedText(clone.innerText || clone.textContent || '');
    }

    function getPdfText() {
      const selectors = [
        '.textLayer',
        '.text-layer',
        '[class*="textLayer"]',
        '[class*="text-layer"]',
        'pdf-viewer-page',
        'viewer-page',
        '#viewer .page',
        '.page'
      ];
      const roots = [document];
      const seenRoots = new Set();
      const seenElements = new Set();
      const chunks = [];

      for (let index = 0; index < roots.length; index += 1) {
        const currentRoot = roots[index];
        if (!currentRoot || seenRoots.has(currentRoot) || !currentRoot.querySelectorAll) continue;
        seenRoots.add(currentRoot);

        currentRoot.querySelectorAll('*').forEach(element => {
          if (element.shadowRoot) roots.push(element.shadowRoot);
        });

        selectors.forEach(selector => {
          currentRoot.querySelectorAll(selector).forEach(element => {
            if (seenElements.has(element)) return;
            seenElements.add(element);
            const text = (element.innerText || element.textContent || '').trim();
            if (text) chunks.push(text);
          });
        });
      }

      return normalizeExtractedText(chunks.join('\n\n'));
    }

    function isPdfDocument() {
      try {
        const parsedUrl = new URL(url);
        if (/\.pdf$/i.test(parsedUrl.pathname)) return true;
        const hostname = parsedUrl.hostname.toLowerCase();
        if ((hostname === 'arxiv.org' || hostname.endsWith('.arxiv.org')) && parsedUrl.pathname.startsWith('/pdf/')) {
          return true;
        }
      } catch (error) {
        if (/\.pdf(?:[?#]|$)/i.test(url)) return true;
      }

      if (document.contentType === 'application/pdf') return true;
      if (document.querySelector([
        'embed[type="application/pdf"]',
        'object[type="application/pdf"]',
        'pdf-viewer',
        'viewer-toolbar',
        'viewer-page-indicator'
      ].join(','))) return true;

      return Array.from(document.querySelectorAll('iframe, embed, object'))
        .some(element => /\.pdf(?:[?#]|$)/i.test(element.src || element.data || ''));
    }

    function normalizeExtractedText(text) {
      return (text || '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
    }
  }

  return { isPdfUrl, isArxivPdfUrl, resolveContentRoute, getPageContent };
});
