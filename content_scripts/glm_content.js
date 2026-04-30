console.log('GLM content script loaded');

let isProcessing = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'insertPrompt') {
        if (isProcessing) {
            console.log('GLM: Already processing, skipping request');
            sendResponse({ success: false, error: 'Already processing' });
            return true;
        }

        isProcessing = true;

        insertPromptAndSubmit(message.prompt)
            .then(() => {
                sendResponse({ success: true });
            })
            .catch(error => {
                console.error('GLM: Error inserting prompt:', error);
                sendResponse({ success: false, error: error.message });
            })
            .finally(() => {
                isProcessing = false;
            });

        return true;
    }
});

async function waitForElement(selector, textContent = null, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        function checkElement() {
            const element = document.querySelector(selector);
            if (element && (!textContent || element.textContent.trim() === textContent)) {
                resolve(element);
                return;
            }

            if (Date.now() - startTime < timeout) {
                setTimeout(checkElement, 250);
            } else {
                reject(new Error(`Element not found: ${selector}${textContent ? ` with text "${textContent}"` : ''}`));
            }
        }

        checkElement();
    });
}

function insertTextIntoTextarea(element, text) {
    element.focus();
    element.value = text;

    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

function robustClick(element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // GLM's handlers are more reliable with the full mouse event sequence.
    const mouseEvents = ['mousedown', 'mouseup', 'click'];
    mouseEvents.forEach(eventType => {
        element.dispatchEvent(new MouseEvent(eventType, {
            view: window,
            bubbles: true,
            cancelable: true
        }));
    });
}

async function insertPromptAndSubmit(prompt) {
    try {
        console.log('GLM: Looking for chat input...');
        const inputField = await waitForElement('#chat-input');
        console.log('GLM: Found chat input');

        insertTextIntoTextarea(inputField, prompt);
        console.log('GLM: Inserted prompt into input field');

        await new Promise(resolve => setTimeout(resolve, 800));

        console.log('GLM: Looking for send button...');
        const sendButton = await waitForElement('#send-message-button:not([disabled])');
        console.log('GLM: Found enabled send button');

        robustClick(sendButton);
        console.log('GLM: Clicked send button');

        chrome.storage.local.remove(['pendingGLMPrompt', 'glmPromptTimestamp'], () => {
            console.log('GLM: Cleared pending prompt from storage');
        });

    } catch (error) {
        console.error('GLM: Error in insertPromptAndSubmit:', error);
        throw error;
    }
}

function checkPendingPrompt() {
    chrome.storage.local.get(['pendingGLMPrompt', 'glmPromptTimestamp'], (result) => {
        if (result.pendingGLMPrompt && result.glmPromptTimestamp) {
            const timestamp = result.glmPromptTimestamp;
            const now = Date.now();

            if ((now - timestamp) < 60000) {
                console.log('GLM: Found pending prompt, processing...');
                const promptToProcess = result.pendingGLMPrompt;

                // Claim the prompt before processing to prevent duplicate sends.
                chrome.storage.local.remove(['pendingGLMPrompt', 'glmPromptTimestamp'], () => {
                    if (isProcessing) return;

                    isProcessing = true;
                    insertPromptAndSubmit(promptToProcess)
                        .catch(error => {
                            console.error('GLM: Error processing pending prompt:', error);
                        })
                        .finally(() => {
                            isProcessing = false;
                        });
                });
            } else {
                console.log('GLM: Pending prompt is too old, ignoring');
                chrome.storage.local.remove(['pendingGLMPrompt', 'glmPromptTimestamp']);
            }
        }
    });
}

setTimeout(checkPendingPrompt, 250);
