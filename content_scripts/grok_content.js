CindraProviderRuntime.registerAdapter({
  providerId: 'grok',
  inputSelectors: [
    'div.tiptap.ProseMirror[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"].tiptap',
    'textarea[dir="auto"]'
  ],
  contentEditable: { mode: 'paragraph' },
  settleDelayMs: 600,
  submitSelectors: [
    'button[aria-label="Submit"]:not([disabled])',
    'button[type="submit"]:not([disabled])'
  ],
  submitTimeoutMs: 2000,
  fallbackSubmit: ({ input }) => CindraInject.pressEnter(input)
});
