function findGoogleLearningSendButton() {
  const spans = document.querySelectorAll('span');
  for (const span of spans) {
    const text = span.textContent.trim();
    if (
      text === 'send' &&
      span.style.fontFamily?.includes('Google Symbols') &&
      span.style.cursor === 'pointer'
    ) {
      return span;
    }
  }

  return Array.from(spans).find(span => (
    span.textContent.trim() === 'send' &&
    (span.style.cursor === 'pointer' || span.onclick || span.getAttribute('role') === 'button')
  )) || null;
}

CindraProviderRuntime.registerAdapter({
  providerId: 'google-learning',
  inputSelectors: [
    'textarea[placeholder="Ask Learn About"]',
    'textarea[aria-label*="Ask"]',
    'textarea[aria-label*="Learn"]'
  ],
  settleDelayMs: 750,
  findSubmit: ({ signal }) => CindraInject.waitForCondition(
    findGoogleLearningSendButton,
    {
      timeoutMs: 10000,
      signal,
      description: 'Google Learning send control'
    }
  )
});
