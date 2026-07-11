async function insertPromptAndSubmit(prompt) {
  try {
    const inputSelector = 'textarea[placeholder="Ask anything"]';
    const inputField = await CindraInject.waitForElement(inputSelector);

    CindraInject.insertTextIntoTextarea(inputField, prompt);

    await new Promise(resolve => setTimeout(resolve, 750));

    const sendButtonSelector = 'button[type="submit"][aria-label="Send message"]:not([disabled])';
    const sendButton = await CindraInject.waitForElement(sendButtonSelector);

    CindraInject.robustClick(sendButton);

  } catch (error) {
    console.error('Error in insertPromptAndSubmit for HuggingChat:', error);
    throw error;
  }
}

CindraProviderRuntime.register({
  providerId: 'huggingchat',
  legacyKeys: {
    prompt: 'pendingHuggingChatPrompt',
    timestamp: 'huggingChatPromptTimestamp'
  },
  submitPrompt: insertPromptAndSubmit
});
