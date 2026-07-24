function normalizePromptForKimi(prompt) {
  const closeTag = '</Content>';
  const firstCloseIndex = prompt.indexOf(closeTag);
  return firstCloseIndex === -1
    ? prompt
    : prompt.slice(0, firstCloseIndex + closeTag.length);
}

function getKimiAttachmentCount() {
  return document.querySelectorAll('.file-card-container').length;
}

function findEnabledKimiSendButton() {
  const container = document.querySelector('.send-button-container');
  if (!container || container.classList.contains('disabled')) return null;
  return container.querySelector('.send-button') || container;
}

async function waitForKimiAttachment(attachmentCountBefore, signal) {
  try {
    await CindraInject.waitForCondition(
      () => getKimiAttachmentCount() > attachmentCountBefore,
      {
        timeoutMs: 1500,
        signal,
        description: 'Kimi prompt attachment'
      }
    );
    return true;
  } catch (error) {
    if (!CindraInject.isTimeoutError(error) || signal?.aborted) throw error;
    return false;
  }
}

async function waitForKimiSendButton(signal) {
  try {
    return await CindraInject.waitForCondition(
      findEnabledKimiSendButton,
      {
        timeoutMs: 1000,
        signal,
        description: 'Kimi send control'
      }
    );
  } catch (error) {
    if (!CindraInject.isTimeoutError(error) || signal?.aborted) throw error;
  }

  await CindraInject.sleep(2000, signal);
  return CindraInject.waitForCondition(
    findEnabledKimiSendButton,
    {
      timeoutMs: 20000,
      signal,
      description: 'Kimi send control'
    }
  );
}

async function insertKimiPrompt(input, prompt, { signal }) {
  const normalizedPrompt = normalizePromptForKimi(prompt);
  const attachmentCountBefore = getKimiAttachmentCount();

  input.focus();
  try {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('delete');
  } catch (error) {
    input.replaceChildren();
  }

  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', normalizedPrompt);
    input.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true
    }));
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  } catch (error) {
    CindraInject.insertTextIntoContentEditable(input, normalizedPrompt, { mode: 'text' });
  }

  const attachmentCreated = normalizedPrompt.length > 3500
    ? await waitForKimiAttachment(attachmentCountBefore, signal)
    : false;
  const insertedText = input.textContent || input.innerText || '';

  if (
    !attachmentCreated &&
    insertedText.length < Math.min(100, Math.floor(normalizedPrompt.length * 0.8))
  ) {
    CindraInject.insertTextIntoContentEditable(input, normalizedPrompt, {
      mode: 'text',
      caretAtEnd: true
    });
  }
}

CindraProviderRuntime.registerAdapter({
  providerId: 'kimi',
  handoffTimeoutMs: 45000,
  inputTimeoutMs: 14500,
  inputSelectors: [
    '.chat-input-editor[contenteditable="true"]',
    '.chat-input [contenteditable="true"]',
    'div[contenteditable="true"][data-lexical-editor="true"]'
  ],
  insertPrompt: insertKimiPrompt,
  findSubmit: ({ signal }) => waitForKimiSendButton(signal),
  clickMode: 'native',
  fallbackSubmit: ({ input }) => CindraInject.pressEnter(input, {
    eventTypes: ['keydown']
  })
});
