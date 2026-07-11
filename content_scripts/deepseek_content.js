async function insertPromptAndSubmit(prompt) {
  if (!prompt) {
    throw new Error('No prompt provided');
  }

  try {
    const textarea = await CindraInject.waitForElement('textarea[placeholder="Message DeepSeek"]');

    CindraInject.insertTextIntoTextarea(textarea, prompt);

    await new Promise(resolve => setTimeout(resolve, 1500));

    const submitButton = await CindraInject.waitForElement([
      '.bf38813a div[role="button"].ds-button--primary.ds-button--circle:not(.ds-button--disabled)',
      'div.bf38813a div[role="button"][aria-disabled="false"]._7436101'
    ], 3000);

    CindraInject.robustClick(submitButton);

  } catch (error) {
    console.error('DeepSeek: Error in insertPromptAndSubmit:', error);
    throw error;
  }
}

CindraProviderRuntime.register({
  providerId: 'deepseek',
  startupDelayMs: 1000,
  legacyKeys: {
    prompt: 'pendingDeepseekPrompt',
    timestamp: 'deepseekPromptTimestamp'
  },
  submitPrompt: insertPromptAndSubmit
});
