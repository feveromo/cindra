CindraProviderRuntime.registerAdapter({
  providerId: 'gemini',
  inputSelectors: [
    'div.ql-editor[contenteditable="true"][aria-label="Enter a prompt here"]',
    'div.ql-editor[contenteditable="true"][aria-label="Enter a prompt for Gemini"]',
    'div.ql-editor[contenteditable="true"][data-placeholder="Ask Gemini"]',
    'rich-textarea div.ql-editor[contenteditable="true"]'
  ],
  contentEditable: {
    mode: 'lines',
    blankClass: 'ql-blank',
    inputEventData: null,
    additionalInputEvent: true,
    caretAtEnd: true
  },
  settleDelayMs: 500,
  submitSelectors: [
    'button.send-button[aria-label="Send message"]:not([aria-disabled="true"])',
    'button[aria-label="Send message"]:not([aria-disabled="true"]):not([disabled])',
    'button[type="submit"][aria-label="Send message"]:not([aria-disabled="true"]):not([disabled])'
  ]
});
