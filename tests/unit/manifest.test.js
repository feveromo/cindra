const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../../manifest.json');
const packageJson = require('../../package.json');
const providers = require('../../lib/providers.js');

const root = path.join(__dirname, '..', '..');
const providerRuntimePrefix = [
  'lib/errors.js',
  'lib/chrome.js',
  'lib/messages.js',
  'content_scripts/lib/inject.js',
  'content_scripts/lib/provider_runtime.js'
];

test('manifest and package versions stay synchronized', () => {
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.minimum_chrome_version, '125');
});

test('every provider has one runtime-backed manifest adapter', () => {
  assert.equal(providers.providers.length, 13);
  assert.deepEqual(providers.validateRegistry(), []);

  for (const provider of providers.providers) {
    const expected = provider.contentScript.file;
    const blocks = manifest.content_scripts.filter(block => block.js?.includes(expected));
    assert.equal(blocks.length, 1, `${provider.id} adapter block`);
    assert.deepEqual(blocks[0].matches, provider.contentScript.matches);
    assert.deepEqual(blocks[0].js, [...providerRuntimePrefix, expected]);
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

test('provider registry is deeply immutable and returns canonical entries', () => {
  const chatgpt = providers.getProviderStrict('chatgpt');
  assert.equal(providers.getProvider('chatgpt'), chatgpt);
  assert.equal(Object.isFrozen(providers), true);
  assert.equal(Object.isFrozen(providers.providers), true);
  assert.equal(Object.isFrozen(chatgpt), true);
  assert.equal(Object.isFrozen(chatgpt.contentScript), true);
  assert.equal(Object.isFrozen(chatgpt.contentScript.matches), true);
  assert.equal(Object.isFrozen(providers.contentSources), true);
});

test('provider pending storage keys are unique and namespaced', () => {
  const keys = providers.providers.map(provider => providers.getPendingStorageKey(provider.id));
  assert.equal(new Set(keys).size, providers.providers.length);
  assert.ok(keys.every(key => key.startsWith('cindraPendingHandoff:')));
});

test('Cerebras uses the public chat site only', () => {
  const provider = providers.getProvider('cerebras');
  const block = manifest.content_scripts.find(item =>
    item.js?.includes('content_scripts/cerebras_content.js'));

  assert.equal(provider.targetUrl, 'https://chat.cerebras.ai/');
  assert.deepEqual(block.matches, ['https://chat.cerebras.ai/*']);
  assert.equal('specialOpen' in provider, false);
});

test('shared extraction and message helpers load before the main content script', () => {
  const generalBlock = manifest.content_scripts.find(block =>
    block.matches?.includes('<all_urls>'));

  assert.deepEqual(generalBlock.js, [
    'lib/errors.js',
    'lib/chrome.js',
    'lib/messages.js',
    'lib/extraction.js',
    'lib/prompt.js',
    'lib/providers.js',
    'content_scripts/lib/inject.js',
    'content_scripts/lib/page_ui.js',
    'content_scripts/content.js'
  ]);

  const backgroundSource = fs.readFileSync(
    path.join(root, 'background', 'background.js'),
    'utf8'
  );
  const expectedImports = [
    '../lib/errors.js',
    '../lib/chrome.js',
    '../lib/messages.js',
    '../lib/extraction.js',
    '../lib/prompt.js',
    'transcript-cache.js',
    'orchestrator.js'
  ];
  let previousIndex = -1;
  for (const script of expectedImports) {
    const index = backgroundSource.indexOf(`'${script}'`);
    assert.ok(index > previousIndex, `${script} import order`);
    previousIndex = index;
  }
  assert.match(backgroundSource, /func: getPageContent/);
  assert.doesNotMatch(backgroundSource, /function: getPageContent/);
});

test('offscreen PDF extraction loads shared message contracts first', () => {
  const html = fs.readFileSync(path.join(root, 'offscreen', 'pdf_extractor.html'), 'utf8');
  assert.ok(html.indexOf('../lib/errors.js') < html.indexOf('../lib/messages.js'));
  assert.ok(html.indexOf('../lib/messages.js') < html.indexOf('../lib/pdf.js'));
});

test('error reporting uses a packaged extension page instead of an inline data URL', () => {
  const backgroundSource = fs.readFileSync(
    path.join(root, 'background', 'background.js'),
    'utf8'
  );
  const html = fs.readFileSync(path.join(root, 'ui', 'error', 'error.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'ui', 'error', 'error.js'), 'utf8');

  assert.match(backgroundSource, /getURL\('ui\/error\/error\.html'\)/);
  assert.doesNotMatch(backgroundSource, /data:text\/html/);
  assert.match(html, /role="alert"/);
  assert.match(script, /messageElement\.textContent/);
  assert.doesNotMatch(script, /innerHTML/);
});

test('the vendored PDF.js version matches the pinned dependency', () => {
  const versionFile = fs.readFileSync(path.join(root, 'vendor', 'pdfjs', 'VERSION'), 'utf8');
  assert.match(versionFile, new RegExp(`pdfjs-dist ${packageJson.devDependencies['pdfjs-dist']}`));
  assert.equal(fs.existsSync(path.join(root, 'vendor', 'pdfjs', 'LICENSE')), true);
});
