let promptSubmitted = false;
let isSubmitting = false;

function isGeneratingResponse() {
  const stopButton = document.querySelector('button.run-button.stop-generating');
  const progressIndicator = document.querySelector('.response-container .progress-indicator');
  const processingIndicator = document.querySelector('.processing-indicator');

  return stopButton !== null || progressIndicator !== null || processingIndicator !== null;
}

function insertPromptAndSubmit(prompt, title) {
  if (!prompt) {
    throw new Error('No prompt provided');
  }

  if (isSubmitting || isGeneratingResponse()) {
    throw new Error('Google AI Studio is already processing a prompt.');
  }

  promptSubmitted = false;
  isSubmitting = true;

  const textareaSelectors = [
    'textarea[formcontrolname="promptText"]',
    'textarea[aria-label="Enter a prompt"]',
    'textarea.textarea',
    'textarea.textarea.gmat-body-medium',
    '.input-area textarea',
    'div[contenteditable="true"]'
  ];

  const findTextarea = () => CindraInject.waitForElement(textareaSelectors, 2000);

  return findTextarea()
    .then(textarea => {
      if (isGeneratingResponse()) {
        promptSubmitted = true;
        isSubmitting = false;
        return Promise.reject(new Error('Already submitted'));
      }

      if (textarea.tagName.toLowerCase() === 'div') {
        textarea.textContent = '';
      } else {
        textarea.value = '';
      }

      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      // Let the input handler observe the clear before setting the real prompt.
      return new Promise(resolve => setTimeout(() => resolve(textarea), 50));
    })
    .then(textarea => {
      if (textarea.tagName.toLowerCase() === 'div') {
        textarea.textContent = prompt;
      } else {
        textarea.value = prompt;
      }

      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));

      textarea.focus();

      if (title) {
        document.title = `Summary: ${title} - Google AI Studio`;
      }

      return new Promise(resolve => setTimeout(() => resolve(textarea), 100));
    })
    .then(textarea => {
      if (promptSubmitted || isGeneratingResponse()) {
        isSubmitting = false;
        return Promise.reject(new Error('Already submitted'));
      }

      const runButtonSelectors = [
        'ms-run-button button[type="submit"]:not([aria-disabled="true"]):not([disabled])',
        'button.ctrl-enter-submits[type="submit"]:not([aria-disabled="true"]):not([disabled])',
        'button.run-button:not(.disabled):not([aria-disabled="true"])',
        'button[aria-label="Send message"]:not([aria-disabled="true"]):not([disabled])',
        'button.send-button:not([disabled]):not([aria-disabled="true"])'
      ];

      const findAndClickButton = async () => {
        try {
          const button = await CindraInject.waitForElement(runButtonSelectors, 2000);
          CindraInject.robustClick(button);
          return true;
        } catch (e) {
          return false;
        }
      };

      return findAndClickButton().then(buttonClicked => {
        if (buttonClicked) {
          promptSubmitted = true;
        } else {
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            ctrlKey: true,
            bubbles: true,
            cancelable: true
          });

          textarea.focus();
          textarea.dispatchEvent(enterEvent);

          return new Promise(resolve =>
            setTimeout(() => {
              if (isGeneratingResponse()) {
                promptSubmitted = true;
                resolve(true);
              } else {
                resolve(false);
              }
            }, 200)
          );
        }
      });
    })
    .then(success => {
      if (!success && !promptSubmitted) {
        throw new Error('Google AI Studio did not accept the submit action.');
      }
    })
    .catch(error => {
      if (error.message === 'Already submitted' || promptSubmitted || isGeneratingResponse()) {
        isSubmitting = false;
        return;
      }

      console.error('Error in insertPromptAndSubmit:', error.message);
      throw error;
    })
    .finally(() => {
      isSubmitting = false;
    });
}

CindraProviderRuntime.register({
  providerId: 'google-ai-studio',
  startupDelayMs: 800,
  legacyKeys: {
    prompt: 'pendingAIStudioPrompt',
    timestamp: 'aiStudioPromptTimestamp',
    title: 'pendingAIStudioTitle'
  },
  submitPrompt: insertPromptAndSubmit
});
