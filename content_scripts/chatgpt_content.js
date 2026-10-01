CindraProviderRuntime.registerAdapter({
  providerId: 'chatgpt',
  inputSelectors: [
    'form .ProseMirror[contenteditable="true"][role="textbox"]',
    '#prompt-textarea',
    'textarea[data-id="root"]',
    'textarea.w-full',
    'div[contenteditable="true"]#prompt-textarea',
    'div[contenteditable="true"].w-full'
  ],
  contentEditable: { mode: 'paragraph' },
  settleDelayMs: 500,
  submitSelectors: [
    'button[data-testid="send-button"]:not([disabled])',
    'button[type="submit"]:not([disabled])',
    'button[aria-label*="Send" i]:not([disabled])'
  ],
  submitTimeoutMs: 2500,
  fallbackSubmit: ({ input }) => CindraInject.pressEnter(input, {
    eventTypes: ['keydown']
  })
});
