const test = require('node:test');
const assert = require('node:assert/strict');
const theme = require('../../ui/theme.js');

test('theme resolution supports auto, light, dark, and malformed values', () => {
  assert.equal(theme.resolveTheme('auto', true), 'dark');
  assert.equal(theme.resolveTheme('auto', false), 'light');
  assert.equal(theme.resolveTheme('light', true), 'light');
  assert.equal(theme.resolveTheme('dark', false), 'dark');
  assert.equal(theme.normalizeTheme('sepia'), 'auto');
});
