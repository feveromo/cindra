(function (root, factory) {
  'use strict';

  const api = factory();
  root.CindraExtraction = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_EXTRACTED_PAGE_CHARS = 500000;
  const HEAD_RATIO = 80000 / 110000;
  const READABLE_ROOT_SELECTORS = Object.freeze([
    '#delform',
    '.thread',
    'main',
    'article',
    '[role="main"]',
    '#content',
    '.content',
    '.main-content',
    '#main'
  ]);
  const EXTRACTION_NOISE_SELECTORS = Object.freeze([
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
    '[data-extension="cindra-summary"]',
    '[data-cindra-ui]'
  ]);
  const PDF_TEXT_SELECTORS = Object.freeze([
    '.textLayer',
    '.text-layer',
    '[class*="textLayer"]',
    '[class*="text-layer"]',
    'pdf-viewer-page',
    'viewer-page',
    '#viewer .page',
    '.page'
  ]);

  function normalizeText(text) {
    return (text || '')
      .toString()
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function omissionNotice(omittedChars) {
    return `[Cindra note: ${omittedChars.toLocaleString('en-US')} characters were omitted from the middle of this page during extraction.]`;
  }

  function limitExtractedText(text, maxChars = MAX_EXTRACTED_PAGE_CHARS) {
    const source = text || '';
    const limit = Math.max(0, Math.floor(Number(maxChars) || 0));

    if (source.length <= limit) {
      return { text: source, truncated: false, omittedChars: 0 };
    }
    if (limit === 0) {
      return { text: '', truncated: true, omittedChars: source.length };
    }

    let notice = omissionNotice(source.length);
    if (notice.length >= limit) {
      return {
        text: notice.slice(0, limit),
        truncated: true,
        omittedChars: source.length
      };
    }

    let headLength = 0;
    let tailLength = 0;
    let omittedChars = source.length;
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const contentBudget = Math.max(0, limit - notice.length - 4);
      headLength = Math.floor(contentBudget * HEAD_RATIO);
      tailLength = contentBudget - headLength;
      omittedChars = Math.max(0, source.length - headLength - tailLength);
      notice = omissionNotice(omittedChars);
    }

    const contentBudget = Math.max(0, limit - notice.length - 4);
    headLength = Math.floor(contentBudget * HEAD_RATIO);
    tailLength = contentBudget - headLength;
    const head = source.slice(0, headLength);
    const tail = tailLength > 0 ? source.slice(-tailLength) : '';
    omittedChars = Math.max(0, source.length - head.length - tail.length);
    notice = omissionNotice(omittedChars);

    return {
      text: `${head}\n\n${notice}\n\n${tail}`.slice(0, limit),
      truncated: true,
      omittedChars
    };
  }

  function elementTextLength(element) {
    return (element?.innerText || element?.textContent || '').trim().length;
  }

  function selectLargestRoot(documentLike, selectors = READABLE_ROOT_SELECTORS) {
    if (!documentLike?.querySelectorAll) return documentLike?.body || null;

    const seen = new Set();
    let bestElement = null;
    let bestLength = -1;

    for (const selector of selectors) {
      const matches = documentLike.querySelectorAll(selector) || [];
      for (const element of matches) {
        if (!element || seen.has(element)) continue;
        seen.add(element);

        const length = elementTextLength(element);
        const overlapsBest = bestElement &&
          (bestElement.contains?.(element) || element.contains?.(bestElement));
        if (overlapsBest && length <= bestLength) continue;

        if (length > bestLength) {
          bestElement = element;
          bestLength = length;
        }
      }
    }

    return bestElement || documentLike.body || null;
  }

  function getReadablePageText(documentLike, maxChars = MAX_EXTRACTED_PAGE_CHARS) {
    const sourceElement = selectLargestRoot(documentLike);
    if (!sourceElement?.cloneNode) return '';

    const clone = sourceElement.cloneNode(true);
    if (clone.querySelectorAll) {
      clone.querySelectorAll(EXTRACTION_NOISE_SELECTORS.join(','))
        .forEach(element => element.remove?.());
    }

    const normalized = normalizeText(clone.innerText || clone.textContent || '');
    return limitExtractedText(normalized, maxChars).text;
  }

  function isArxivPdfUrl(url) {
    const hostname = url.hostname.toLowerCase();
    return (hostname === 'arxiv.org' || hostname.endsWith('.arxiv.org')) &&
      url.pathname.startsWith('/pdf/');
  }

  function isPdfDocument(documentLike, url = '') {
    try {
      const parsedUrl = new URL(url);
      if (/\.pdf$/i.test(parsedUrl.pathname) || isArxivPdfUrl(parsedUrl)) return true;
    } catch (error) {
      if (/\.pdf(?:[?#]|$)/i.test(url)) return true;
    }

    if (documentLike?.contentType === 'application/pdf') return true;
    if (documentLike?.querySelector?.([
      'embed[type="application/pdf"]',
      'object[type="application/pdf"]',
      'pdf-viewer',
      'viewer-toolbar',
      'viewer-page-indicator'
    ].join(','))) return true;

    return Array.from(documentLike?.querySelectorAll?.('iframe, embed, object') || [])
      .some(element => /\.pdf(?:[?#]|$)/i.test(element.src || element.data || ''));
  }

  function getPdfText(documentLike) {
    const roots = [documentLike];
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

      for (const selector of PDF_TEXT_SELECTORS) {
        currentRoot.querySelectorAll(selector).forEach(element => {
          if (seenElements.has(element)) return;
          seenElements.add(element);
          const text = (element.innerText || element.textContent || '').trim();
          if (text) chunks.push(text);
        });
      }
    }

    return normalizeText(chunks.join('\n\n'));
  }

  function getPageContent(documentLike, windowLike, contentSource = 'page') {
    const title = (documentLike?.title || '').toString();
    const url = (windowLike?.location?.href || '').toString();
    const description = documentLike
      ?.querySelector?.('meta[name="description"]')
      ?.content || '';
    const selection = normalizeText(windowLike?.getSelection?.().toString() || '');
    const isPdf = isPdfDocument(documentLike, url);

    if (contentSource === 'selection') {
      if (!selection) {
        return { title, url, error: 'No selected text found on this page.' };
      }

      return {
        title,
        url,
        description,
        sourceType: 'selection',
        content: selection
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
      const pdfContent = getPdfText(documentLike);
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
      content: getReadablePageText(documentLike)
    };
  }

  return {
    EXTRACTION_NOISE_SELECTORS,
    MAX_EXTRACTED_PAGE_CHARS,
    PDF_TEXT_SELECTORS,
    READABLE_ROOT_SELECTORS,
    getPageContent,
    getPdfText,
    getReadablePageText,
    isPdfDocument,
    limitExtractedText,
    normalizeText,
    selectLargestRoot
  };
});
