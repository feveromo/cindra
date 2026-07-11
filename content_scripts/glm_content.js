async function insertPromptAndSubmit(prompt) {
  if (!prompt) {
    throw new Error('No prompt provided');
  }

  const inputField = await CindraInject.waitForElement('#chat-input');
  CindraInject.insertTextIntoTextarea(inputField, prompt);
  await new Promise(resolve => setTimeout(resolve, 800));

  const sendButton = await CindraInject.waitForElement('#send-message-button:not([disabled])');
  CindraInject.robustClick(sendButton);
}

CindraProviderRuntime.register({
  providerId: 'glm',
  legacyKeys: {
    prompt: 'pendingGLMPrompt',
    timestamp: 'glmPromptTimestamp'
  },
  submitPrompt: insertPromptAndSubmit
});
