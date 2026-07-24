function findSendButton() {
  const spans = document.querySelectorAll('span');

  for (const span of spans) {
    const text = span.textContent.trim();
    const fontFamily = span.style.fontFamily;
    const cursor = span.style.cursor;

    if (text === 'send' &&
        fontFamily &&
        fontFamily.includes('Google Symbols') &&
        cursor === 'pointer') {
      return span;
    }
  }

  for (const span of spans) {
    const text = span.textContent.trim();
    if (text === 'send' && (span.style.cursor === 'pointer' || span.onclick || span.getAttribute('role') === 'button')) {
      return span;
    }
  }

  return null;
}

CindraProviderRuntime.registerAdapter({
  providerId: 'google-learning',
  inputSelectors: [
    'textarea[placeholder="Ask Learn About"]',
    'textarea[aria-label*="Ask"]',
    'textarea[aria-label*="Learn"]'
  ],
  settleMs: 750,
  findSubmit: () => CindraInject.waitForCondition(
    findSendButton,
    10000,
    'Google Learning send button'
  )
});
