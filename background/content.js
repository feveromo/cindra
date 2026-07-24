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

  // This function is serialized into the target tab by chrome.scripting. Keep
  // its dependencies on globals that are loaded in the same isolated world.
  function getPageContent(contentSource = 'page') {
    const extraction = globalThis.CindraExtraction;
    if (!extraction?.getPageContent) {
      return {
        title: document.title,
        url: window.location.href,
        error: 'Cindra page extraction helpers are unavailable. Refresh the page and try again.'
      };
    }
    return extraction.getPageContent(document, window, contentSource);
  }

  return {
    getPageContent,
    isArxivPdfUrl,
    isPdfUrl,
    resolveContentRoute
  };
});
