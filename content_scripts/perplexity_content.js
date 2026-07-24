const PERPLEXITY_INPUT_SELECTORS = [
  '#ask-input',
  'div[contenteditable="true"][role="textbox"]',
  'div[data-lexical-editor="true"]',
  'textarea[placeholder="Ask anything..."]',
  '.rounded-3xl textarea',
  'textarea.resize-none'
];

const PERPLEXITY_NON_SUBMIT_LABELS = new Set([
  'Voice mode',
  'Use voice mode',
  'Dictation',
  'Model',
  'Add files or tools'
]);

function findPerplexitySubmitButton() {
  const byTestId = document.querySelector(
    'button[data-testid="submit-button"], button[data-testid="composer-submit-button"]'
  );
  if (CindraInject.isUsableControl(byTestId)) return byTestId;

  const byAria = CindraInject.queryFirst(
    ['button[aria-label="Submit"]', 'button[aria-label="Send"]'],
    document,
    CindraInject.isUsableControl
  );
  if (byAria) return byAria;

  const sendIcons = document.querySelectorAll([
    'button svg use[*|href="#pplx-icon-arrow-up"]',
    'button svg use[xlink\\:href="#pplx-icon-arrow-up"]',
    'button svg.tabler-icon-arrow-right',
    'button svg use[*|href="#pplx-icon-send"]',
    'button svg use[xlink\\:href="#pplx-icon-send"]'
  ].join(','));

  for (const icon of sendIcons) {
    const button = icon.closest('button');
    if (
      CindraInject.isUsableControl(button) &&
      !PERPLEXITY_NON_SUBMIT_LABELS.has(button.getAttribute('aria-label'))
    ) {
      return button;
    }
  }
  return null;
}

function insertPerplexityPrompt(input, prompt) {
  if (input.tagName?.toLowerCase() === 'textarea') {
    CindraInject.insertTextIntoTextarea(input, prompt);
    return;
  }
  CindraInject.insertTextIntoContentEditable(input, prompt, {
    mode: 'blocks',
    caretAtEnd: true,
    additionalInputEvent: true
  });
}

CindraProviderRuntime.registerAdapter({
  providerId: 'perplexity',
  inputSelectors: PERPLEXITY_INPUT_SELECTORS,
  insertPrompt: insertPerplexityPrompt,
  settleDelayMs: 1000,
  findSubmit: ({ signal }) => CindraInject.waitForCondition(
    findPerplexitySubmitButton,
    {
      timeoutMs: 2500,
      intervalMs: 150,
      signal,
      description: 'Perplexity submit control'
    }
  ),
  fallbackSubmit: ({ input }) => CindraInject.pressEnter(input, {
    eventTypes: ['keydown', 'keypress', 'keyup']
  })
});
