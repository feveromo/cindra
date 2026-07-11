const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../../manifest.json');
const packageJson = require('../../package.json');
const providers = require('../../lib/providers.js');

const root = path.join(__dirname, '..', '..');
const providerScripts = {
  'google-ai-studio': 'ai_studio_content.js',
  gemini: 'gemini_content.js',
  perplexity: 'perplexity_content.js',
  grok: 'grok_content.js',
  claude: 'claude_content.js',
  chatgpt: 'chatgpt_content.js',
  'google-learning': 'google_learning_content.js',
  deepseek: 'deepseek_content.js',
  glm: 'glm_content.js',
  kimi: 'kimi_content.js',
  huggingchat: 'huggingchat_content.js',
  qwen: 'qwen_content.js',
  cerebras: 'cerebras_content.js'
};

test('manifest and package versions stay synchronized', () => {
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.minimum_chrome_version, '125');
});

test('every provider has one runtime-backed manifest adapter', () => {
  assert.equal(providers.providers.length, 13);
  for (const provider of providers.providers) {
    const expected = `content_scripts/${providerScripts[provider.id]}`;
    const blocks = manifest.content_scripts.filter(block => block.js?.includes(expected));
    assert.equal(blocks.length, 1, `${provider.id} adapter block`);
    assert.deepEqual(blocks[0].js.slice(-3), [
      'content_scripts/lib/inject.js',
      'content_scripts/lib/provider_runtime.js',
      expected
    ]);
  }
});

test('all direct manifest file references exist', () => {
  const references = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_page,
    ...manifest.content_scripts.flatMap(block => block.js || [])
  ];
  for (const reference of references) {
    assert.equal(fs.existsSync(path.join(root, reference)), true, reference);
  }
});

test('provider pending storage keys are unique and namespaced', () => {
  const keys = providers.providers.map(provider => providers.getPendingStorageKey(provider.id));
  assert.equal(new Set(keys).size, providers.providers.length);
  assert.ok(keys.every(key => key.startsWith('cindraPendingHandoff:')));
});

test('the vendored PDF.js version matches the pinned dependency', () => {
  const versionFile = fs.readFileSync(path.join(root, 'vendor', 'pdfjs', 'VERSION'), 'utf8');
  assert.match(versionFile, new RegExp(`pdfjs-dist ${packageJson.devDependencies['pdfjs-dist']}`));
  assert.equal(fs.existsSync(path.join(root, 'vendor', 'pdfjs', 'LICENSE')), true);
});
