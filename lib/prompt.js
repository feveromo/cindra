(function (root, factory) {
  'use strict';

  const api = factory();
  root.CindraPrompt = api;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_MAX_CONTENT_CHARS = 120000;
  const HEAD_CHARS = 80000;
  const TAIL_CHARS = 30000;
  const TAIL_RATIO = TAIL_CHARS / (HEAD_CHARS + TAIL_CHARS);

  function cleanupContent(content, mode, { stripMarker = true, escapeQuotes = false } = {}) {
    if (!content) return '';

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = [];
    let protectedContent = content.replace(urlRegex, (match) => {
      const placeholder = `__CINDRA_URL_${urls.length}__`;
      urls.push(match);
      return placeholder;
    });

    if (stripMarker) {
      protectedContent = protectedContent.replace(/Summarize\s*with\s*AI\s*\(Ctrl\+X\+X\)/g, '');
    }

    let cleaned = protectedContent
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    if (mode === 'flat') {
      cleaned = cleaned
        .replace(/\u00A0/g, ' ')
        .replace(/(\r\n|\n|\r)+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\s*([.!?])\s*/g, '$1 ')
        .replace(/([.!?])\s{2,}/g, '$1 ')
        .trim();
    } else if (mode === 'threads') {
      cleaned = cleaned
        .replace(/\n---\n/g, '__CINDRA_POST_SEP__')
        .replace(/\n\n/g, '__CINDRA_BLANK_LINE__')
        .replace(/(\r\n|\n|\r)+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\u00A0/g, ' ')
      .replace(/\s*([.!?])\s*/g, '$1 ')
      .replace(/([.!?])\s{2,}/g, '$1 ')
      .trim()
      .replace(/\s*__CINDRA_BLANK_LINE__\s*/g, '\n\n')
      .replace(/\s*__CINDRA_POST_SEP__\s*/g, '\n---\n');
    } else {
      cleaned = cleaned
        .replace(/\u00A0/g, ' ')
        .replace(/\r\n?/g, '\n')
        .replace(/\n[ \t]*---[ \t]*\n/g, '\n__CINDRA_POST_SEP__\n')
        .replace(/\n{2,}/g, '\n__CINDRA_PARA_BREAK__\n')
        .replace(/\n/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*([.!?])\s*/g, '$1 ')
        .replace(/([.!?])\s{2,}/g, '$1 ')
        .trim()
        .replace(/\s*__CINDRA_PARA_BREAK__\s*/g, '\n\n')
        .replace(/\s*__CINDRA_POST_SEP__\s*/g, '\n---\n\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    urls.forEach((url, index) => {
      cleaned = cleaned.replace(`__CINDRA_URL_${index}__`, url);
    });

    return escapeQuotes ? cleaned.replace(/"/g, '\\"') : cleaned;
  }

  function buildXmlSection(tagName, sectionContent) {
    const text = (sectionContent ?? '').toString().trim();
    return `<${tagName}>\n${text}\n</${tagName}>`;
  }

  function cleanSummaryContent(content, cleaner = null) {
    if (cleaner) {
      return cleaner(content);
    }

    return /\n---\n/.test(content)
      ? cleanupContent(content, 'threads', { escapeQuotes: true, stripMarker: false })
      : cleanupContent(content, 'flat', { escapeQuotes: true });
  }

  function omissionNotice(omittedChars) {
    return `[Cindra note: ${omittedChars.toLocaleString('en-US')} characters were omitted from the middle to keep this handoff within browser and provider limits.]`;
  }

  function limitPromptContent(content, maxChars = DEFAULT_MAX_CONTENT_CHARS) {
    const text = content || '';
    const normalizedMax = Math.max(0, Math.floor(Number(maxChars) || 0));

    if (text.length <= normalizedMax) {
      return { text, truncated: false, omittedChars: 0 };
    }

    if (normalizedMax === 0) {
      return { text: '', truncated: true, omittedChars: text.length };
    }

    let notice = omissionNotice(text.length);
    if (notice.length >= normalizedMax) {
      return {
        text: notice.slice(0, normalizedMax),
        truncated: true,
        omittedChars: text.length
      };
    }

    let headBudget = 0;
    let tailBudget = 0;
    let omittedChars = text.length;

    // The omitted count changes the notice length at digit boundaries. A few
    // iterations make the final budget exact without sacrificing the tail.
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const contentBudget = Math.max(0, normalizedMax - notice.length - 4);
      tailBudget = Math.floor(contentBudget * TAIL_RATIO);
      headBudget = contentBudget - tailBudget;
      omittedChars = Math.max(0, text.length - headBudget - tailBudget);
      notice = omissionNotice(omittedChars);
    }

    const contentBudget = Math.max(0, normalizedMax - notice.length - 4);
    tailBudget = Math.floor(contentBudget * TAIL_RATIO);
    headBudget = contentBudget - tailBudget;
    const head = text.slice(0, headBudget);
    const tail = tailBudget > 0 ? text.slice(-tailBudget) : '';
    omittedChars = Math.max(0, text.length - head.length - tail.length);
    notice = omissionNotice(omittedChars);

    const limited = `${head}\n\n${notice}\n\n${tail}`.slice(0, normalizedMax);
    return { text: limited, truncated: true, omittedChars };
  }

  function buildSummaryPrompt(prompt, content, title, url = null, channel = null, description = null, options = {}) {
    const limitedContent = limitPromptContent(
      cleanSummaryContent(content, options.cleaner),
      options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS
    );
    const cleanedContent = limitedContent.text;
    const sections = [
      buildXmlSection('Task', prompt || ''),
      buildXmlSection('ContentTitle', title || 'N/A')
    ];

    const normalizedUrl = typeof url === 'string' ? url.trim() : '';
    const normalizedChannel = typeof channel === 'string' ? channel.trim() : '';
    const normalizedDescription = typeof description === 'string' ? description.trim() : '';

    if (normalizedUrl) sections.push(buildXmlSection('URL', normalizedUrl));
    if (normalizedChannel) sections.push(buildXmlSection('Channel', normalizedChannel));
    if (normalizedDescription) sections.push(buildXmlSection('Description', normalizedDescription));

    sections.push(buildXmlSection('Content', cleanedContent));

    return {
      promptText: sections.join(options.sectionSeparator || '\n\n'),
      cleanedContent,
      truncated: limitedContent.truncated,
      omittedChars: limitedContent.omittedChars
    };
  }

  return {
    DEFAULT_MAX_CONTENT_CHARS,
    cleanupContent,
    buildXmlSection,
    cleanSummaryContent,
    limitPromptContent,
    buildSummaryPrompt
  };
});
