const test = require('node:test');
const assert = require('node:assert/strict');
const { createUiHarness, flush } = require('../helpers/ui-harness');

const a = { id: 'a', name: 'A', text: 'Prompt A' };
const b = { id: 'b', name: 'B', text: 'Prompt B' };
async function setup() {
  const h = createUiHarness('ui/options/options.js', { savedPrompts: [a, b], activePromptId: 'a' });
  await h.context.CindraOptions.initialize();
  return h;
}

function editAndSubmit(h) {
  h.elements.get('prompt-name').value = 'Edited A';
  h.elements.get('prompt-text').value = 'Edited prompt A';
  h.elements.get('prompt-form').dispatch('submit');
}

test('saving then closing and editing another preset preserves the original target and newer modal', async () => {
  const h = await setup();
  h.context.CindraOptions.openPromptModal(a);
  const release = h.deferNextRead();
  editAndSubmit(h);
  h.context.CindraOptions.closeModal();
  h.context.CindraOptions.openPromptModal(b);
  release();
  await flush();
  assert.deepEqual(h.sync.savedPrompts, [{ ...a, name: 'Edited A', text: 'Edited prompt A' }, b]);
  assert.equal(h.elements.get('prompt-modal').hidden, false);
  assert.equal(h.elements.get('prompt-name').value, 'B');
  assert.equal(h.elements.get('prompt-text').value, 'Prompt B');
  assert.equal(h.elements.get('modal-save').disabled, false);
});

test('repeated submit events create only one new preset while storage is pending', async () => {
  const h = await setup();
  h.context.CindraOptions.openPromptModal();
  const release = h.deferNextRead();
  editAndSubmit(h);
  h.elements.get('prompt-form').dispatch('submit');
  release();
  await flush();
  assert.equal(h.sync.savedPrompts.length, 3);
  assert.equal(h.writes.filter(write => write.savedPrompts).length, 1);
  assert.equal(h.elements.get('prompt-modal').hidden, true);
});

test('failure from an earlier save does not replace a newer modal status', async () => {
  const h = await setup();
  h.context.CindraOptions.openPromptModal(a);
  const release = h.deferNextRead();
  editAndSubmit(h);
  h.context.CindraOptions.closeModal();
  h.context.CindraOptions.openPromptModal(b);
  h.failNextWrite(new Error('Storage quota exceeded'));
  release();
  await flush();
  assert.deepEqual(h.sync.savedPrompts, [a, b]);
  assert.equal(h.elements.get('modal-status').textContent, '');
  assert.equal(h.elements.get('status').textContent, 'Storage quota exceeded');
  assert.equal(h.elements.get('prompt-modal').hidden, false);
  assert.equal(h.elements.get('modal-save').disabled, false);
});

test('failed save keeps the originating modal editable and displays the error', async () => {
  const h = await setup();
  h.context.CindraOptions.openPromptModal(a);
  h.failNextWrite(new Error('Storage quota exceeded'));
  editAndSubmit(h);
  await flush();
  assert.equal(h.elements.get('modal-status').textContent, 'Storage quota exceeded');
  assert.equal(h.elements.get('prompt-modal').hidden, false);
  assert.equal(h.elements.get('modal-save').disabled, false);
});
