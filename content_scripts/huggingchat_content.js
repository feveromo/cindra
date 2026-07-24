CindraProviderRuntime.registerAdapter({
  providerId: 'huggingchat',
  inputSelectors: 'textarea[placeholder="Ask anything"]',
  settleMs: 750,
  submitSelectors: 'button[type="submit"][aria-label="Send message"]:not([disabled])'
});
