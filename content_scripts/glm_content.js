let isProcessing = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'insertPrompt') {
        if (isProcessing) {
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

async function insertPromptAndSubmit(prompt) {
    try {
        const inputField = await CindraInject.waitForElement('#chat-input');

        CindraInject.insertTextIntoTextarea(inputField, prompt);

        await new Promise(resolve => setTimeout(resolve, 800));

        const sendButton = await CindraInject.waitForElement('#send-message-button:not([disabled])');

        CindraInject.robustClick(sendButton);

        chrome.storage.local.remove(['pendingGLMPrompt', 'glmPromptTimestamp'], () => {});

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
                chrome.storage.local.remove(['pendingGLMPrompt', 'glmPromptTimestamp']);
            }
        }
    });
}

setTimeout(checkPendingPrompt, 250);
