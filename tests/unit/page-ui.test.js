const test = require('node:test');
const assert = require('node:assert/strict');
const pageUi = require('../../content_scripts/lib/page_ui.js');

test('selection question prompts stay scoped to selected text', () => {
  assert.equal(pageUi.buildQuestionPrompt('What changed?'), [
    'Use only the selected text to answer the user question.',
    'If the selected text does not contain enough information, say what is missing.',
    '',
    'User question: What changed?'
  ].join('\n'));
});

test('active prompt selection ignores malformed and empty presets', () => {
  const fallback = 'Fallback prompt';
  assert.equal(pageUi.getActivePrompt({
    activePromptId: 'two',
    savedPrompts: [
      { id: 'one', text: 'First' },
      { id: 'two', text: '  Second  ' }
    ]
  }, fallback), '  Second  ');
  assert.equal(pageUi.getActivePrompt({
    activePromptId: 'empty',
    savedPrompts: [{ id: 'empty', text: '   ' }]
  }, fallback), fallback);
  assert.equal(pageUi.getActivePrompt(null, fallback), fallback);
});

test('editable target detection covers form controls and contenteditable elements', () => {
  const editable = { closest: selector => selector.includes('textarea') ? {} : null, nodeType: 1 };
  const nested = { parentElement: editable, nodeType: 3 };
  const plain = { closest: () => null, nodeType: 1 };
  const nodeCtor = { ELEMENT_NODE: 1 };

  assert.equal(pageUi.isEditableTarget(editable, nodeCtor), true);
  assert.equal(pageUi.isEditableTarget(nested, nodeCtor), true);
  assert.equal(pageUi.isEditableTarget(plain, nodeCtor), false);
});

test('page UI classes validate their required dependencies', () => {
  assert.throws(() => new pageUi.SelectionComposer(), /requires window, document, and onSubmit/);
  assert.throws(() => new pageUi.FloatingSummaryButton(), /requires document and onActivate/);
});
