const AI_STUDIO_INPUT_SELECTORS = [
  'textarea[formcontrolname="promptText"]',
  'textarea[aria-label="Enter a prompt"]',
  'textarea.textarea',
  'textarea.textarea.gmat-body-medium',
  '.input-area textarea',
  'div[contenteditable="true"]'
];

const AI_STUDIO_SUBMIT_SELECTORS = [
  'ms-run-button button[type="submit"]:not([aria-disabled="true"]):not([disabled])',
  'button.ctrl-enter-submits[type="submit"]:not([aria-disabled="true"]):not([disabled])',
  'button.run-button:not(.disabled):not([aria-disabled="true"])',
  'button[aria-label="Send message"]:not([aria-disabled="true"]):not([disabled])',
  'button.send-button:not([disabled]):not([aria-disabled="true"])'
];

function isAiStudioGeneratingResponse() {
  return Boolean(document.querySelector([
    'button.run-button.stop-generating',
    '.response-container .progress-indicator',
    '.processing-indicator'
  ].join(',')));
}

async function insertAiStudioPrompt(input, prompt, { signal }) {
  CindraInject.insertText(input, '', { mode: 'text' });
  await CindraInject.sleep(50, signal);
  CindraInject.insertText(input, prompt, { mode: 'text' });
}

CindraProviderRuntime.registerAdapter({
  providerId: 'google-ai-studio',
  inputSelectors: AI_STUDIO_INPUT_SELECTORS,
  inputTimeoutMs: 5000,
  beforeInsert: () => {
    if (isAiStudioGeneratingResponse()) {
      throw new Error('Google AI Studio is already processing a prompt.');
    }
  },
  insertPrompt: insertAiStudioPrompt,
  afterInsert: ({ title }) => {
    if (title) document.title = `Summary: ${title} - Google AI Studio`;
  },
  settleDelayMs: 100,
  submitSelectors: AI_STUDIO_SUBMIT_SELECTORS,
  submitTimeoutMs: 2000,
  fallbackSubmit: async ({ input, signal }) => {
    CindraInject.pressEnter(input, { ctrlKey: true, eventTypes: ['keydown'] });
    await CindraInject.sleep(250, signal);
    if (!isAiStudioGeneratingResponse()) {
      throw new Error('Google AI Studio did not accept the submit action.');
    }
  }
});
