let promptSubmitted = false;
let isSubmitting = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'insertPrompt') {
    isSubmitting = false;
    promptSubmitted = false;

    insertPromptAndSubmit(message.prompt, message.title);
    sendResponse({ status: 'Attempting to insert prompt' });
    return true;
  }
});

function isGeneratingResponse() {
  const stopButton = document.querySelector('button.run-button.stop-generating');
  const progressIndicator = document.querySelector('.response-container .progress-indicator');
  const processingIndicator = document.querySelector('.processing-indicator');

  return stopButton !== null || progressIndicator !== null || processingIndicator !== null;
}

function insertPromptAndSubmit(prompt, title) {
  if (!prompt) {
    console.warn('Received empty prompt, not inserting');
    return;
  }

  if (isSubmitting || promptSubmitted || isGeneratingResponse()) {
    return;
  }

  isSubmitting = true;

  const textareaSelectors = [
    'textarea.textarea',
    'textarea.textarea.gmat-body-medium',
    'div[contenteditable="true"]',
    '.input-area textarea'
  ];

  const findTextarea = async () => {
    for (const selector of textareaSelectors) {
      try {
        const textarea = await CindraInject.waitForElement(selector, 1000);
        if (textarea) return textarea;
      } catch (e) {
      }
    }
    throw new Error('Textarea not found');
  };

  findTextarea()
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
        'button.run-button:not(.disabled)',
        'button[aria-label="Send message"]',
        'button.send-button:not([disabled])'
      ];

      const findAndClickButton = async () => {
        for (const selector of runButtonSelectors) {
          try {
            const button = await CindraInject.waitForElement(selector, 2000);
            if (button) {
              button.click();
              return true;
            }
          } catch (e) {
          }
        }
        return false;
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
      if (success || promptSubmitted) {
        chrome.storage.local.remove(['pendingAIStudioPrompt', 'pendingAIStudioTitle', 'aiStudioPromptTimestamp']);
      } else {
        // Run the final submit attempt in the page context so AI Studio sees native events.
        const script = document.createElement('script');
        script.textContent = `
          (function() {
            try {
              const runButtons = [
                document.querySelector('button.run-button:not(.disabled)'),
                document.querySelector('button[aria-label="Send message"]'),
                document.querySelector('button.send-button:not([disabled])')
              ].filter(btn => btn !== null);

              if (runButtons.length > 0) {
                console.log('Found button through injected script, clicking');
                runButtons[0].click();
              } else {
                console.log('No button found through injected script');

                const textarea = document.querySelector('textarea.textarea') ||
                                document.querySelector('div[contenteditable="true"]');
                if (textarea) {
                  console.log('Found textarea, sending keyboard event');
                  textarea.focus();

                  const enterEvent = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    ctrlKey: true,
                    bubbles: true,
                    cancelable: true
                  });
                  textarea.dispatchEvent(enterEvent);
                }
              }
            } catch (e) {
              console.error('Error in injected script:', e);
            }
          })();
        `;

        document.body.appendChild(script);
        setTimeout(() => {
          script.remove();

          if (isGeneratingResponse()) {
            promptSubmitted = true;
            chrome.storage.local.remove(['pendingAIStudioPrompt', 'pendingAIStudioTitle', 'aiStudioPromptTimestamp']);
          }
        }, 300);
      }
    })
    .catch(error => {
      if (error.message === 'Already submitted' || promptSubmitted || isGeneratingResponse()) {
        isSubmitting = false;
        return;
      }

      console.error('Error in insertPromptAndSubmit:', error.message);
    })
    .finally(() => {
      isSubmitting = false;
    });
}

window.addEventListener('load', () => {
  setTimeout(() => {
    if (window.location.pathname.includes('/prompts/new_chat') ||
        window.location.pathname.includes('/app') ||
        window.location.href.includes('aistudio.google.com')) {

      chrome.storage.local.get(['pendingAIStudioPrompt', 'pendingAIStudioTitle', 'aiStudioPromptTimestamp'], function(result) {
        const prompt = result.pendingAIStudioPrompt;
        const title = result.pendingAIStudioTitle;
        const ts = result.aiStudioPromptTimestamp || 0;
        if (prompt) {
          const currentTime = Date.now();
          const fiveMinutesInMs = 5 * 60 * 1000;

          if (currentTime - ts < fiveMinutesInMs) {
            // Remove before submitting so reloads do not submit the same prompt twice.
            chrome.storage.local.remove(['pendingAIStudioPrompt', 'pendingAIStudioTitle', 'aiStudioPromptTimestamp'], () => {
              insertPromptAndSubmit(prompt, title);
            });
          } else {
            chrome.storage.local.remove(['pendingAIStudioPrompt', 'pendingAIStudioTitle', 'aiStudioPromptTimestamp']);
          }
        }
      });
    }
  }, 800);
});
