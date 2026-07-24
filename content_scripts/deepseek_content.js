CindraProviderRuntime.registerAdapter({
  providerId: 'deepseek',
  inputSelectors: 'textarea[placeholder="Message DeepSeek"]',
  settleMs: 1500,
  submitSelectors: [
    '.bf38813a div[role="button"].ds-button--primary.ds-button--circle:not(.ds-button--disabled)',
    'div.bf38813a div[role="button"][aria-disabled="false"]._7436101'
  ],
  submitTimeoutMs: 3000
});
