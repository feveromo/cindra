// Perplexity frequently redesigns the ask bar, so matching by volatile class
// names breaks. Match stable signals in order: explicit submit testids, then
// aria-label "Submit"/"Send", then send/arrow icons (excluding known
// non-submit controls like voice/dictation/model). Returns null on timeout
// rather than rejecting so the caller can fall back to the Enter-key submit.
function findSubmitButton() {
  const NON_SUBMIT_LABELS = ['Voice mode', 'Use voice mode', 'Dictation', 'Model', 'Add files or tools'];

  const byTestid = document.querySelector(
    'button[data-testid="submit-button"], button[data-testid="composer-submit-button"]'
  );
  if (byTestid && !byTestid.disabled && byTestid.getAttribute('aria-disabled') !== 'true') {
    return byTestid;
  }

  const byAria = document.querySelectorAll('button[aria-label="Submit"], button[aria-label="Send"]');
  for (const button of byAria) {
    if (!button.disabled && button.getAttribute('aria-disabled') !== 'true') {
      return button;
    }
  }

  // Send/arrow icons referenced by Perplexity's icon sprite.
  const sendIcons = document.querySelectorAll(
    'button svg use[*|href="#pplx-icon-arrow-up"], button svg use[xlink\\:href="#pplx-icon-arrow-up"],' +
    'button svg.tabler-icon-arrow-right, button svg use[*|href="#pplx-icon-send"],' +
    'button svg use[xlink\\:href="#pplx-icon-send"]'
  );
  for (const svg of sendIcons) {
    const button = svg.closest('button');
    if (button && !button.disabled && !NON_SUBMIT_LABELS.includes(button.getAttribute('aria-label'))) {
      return button;
    }
  }

  return null;
}

function waitForSubmitButton() {
  return CindraInject.waitForCondition(
    findSubmitButton,
    2500,
    'Perplexity submit button'
  ).catch(() => null);
}

function submitViaEnter({ input }) {
  input.focus();
  ['keydown', 'keypress', 'keyup'].forEach(type => {
    input.dispatchEvent(new KeyboardEvent(type, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    }));
  });
}

function insertPrompt({ input, prompt }) {
  input.focus();
  if (input.tagName === 'TEXTAREA') {
    CindraInject.insertTextIntoTextarea(input, prompt);
  } else {
    insertTextIntoContentEditable(input, prompt);
  }
}

CindraProviderRuntime.registerAdapter({
  providerId: 'perplexity',
  inputSelectors: [
    '#ask-input',
    'div[contenteditable="true"][role="textbox"]',
    'div[data-lexical-editor="true"]',
    'textarea[placeholder="Ask anything..."]',
    '.rounded-3xl textarea',
    'textarea.resize-none'
  ],
  insertPrompt,
  settleMs: 1000,
  findSubmit: waitForSubmitButton,
  fallbackSubmit: submitViaEnter
});

// Perplexity's #ask-input is a Lexical-based contenteditable, but Perplexity's
// build does NOT expose the __lexicalEditor instance on the element, so the
// instance API can't be driven. What works: writing the text into the DOM and
// dispatching a synthetic input event — Perplexity's React layer observes that
// and ingests the value into its editor state. Multiline text is rendered as
// <div>per-line blocks to match how the editor expects block content.
function setEditorText(element, text) {
  // Normalize CRLF/CR to LF so carriage returns don't bleed into the editor.
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const fragment = document.createDocumentFragment();
  for (const line of lines) {
    const div = document.createElement('div');
    if (line.length) {
      div.textContent = line;
    } else {
      div.appendChild(document.createElement('br'));
    }
    fragment.appendChild(div);
  }

  element.focus();
  element.replaceChildren(fragment);

  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    composed: true,
    inputType: 'insertText',
    data: text
  }));
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.focus();
}

function insertTextIntoContentEditable(element, text) {
  // Perplexity's editor re-renders the DOM asynchronously from its React/Lexical
  // state, so reading element.textContent right after writing it is racy (React
  // may have reverted it to empty on its own commit cycle). The proven-working
  // mechanism is: write block content into the DOM, then fire input/change so
  // Perplexity's React layer ingests the value. Don't try to verify synchronously
  // — a false-negative there only produces spurious errors. The submit phase will
  // surface a real failure if no text is present (no enabled submit button, and
  // the Enter fallback fires).
  setEditorText(element, text);
}
