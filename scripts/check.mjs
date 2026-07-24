import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import process from 'node:process';

const root = process.cwd();
const require = createRequire(import.meta.url);
const excluded = new Set([
  '.codegraph',
  '.git',
  'node_modules',
  'vendor',
  'test-results',
  'playwright-report'
]);

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (excluded.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (/\.(?:js|mjs)$/.test(entry)) files.push(path);
  }
  return files;
}

function extensionPathFromHtml(htmlFile, reference) {
  if (!reference || /^(?:[a-z]+:|#)/i.test(reference)) return null;
  const clean = reference.split(/[?#]/)[0];
  return clean.startsWith('/')
    ? join(root, clean.slice(1))
    : resolve(dirname(htmlFile), clean);
}

function collectHtmlReferences(htmlFile) {
  const html = readFileSync(htmlFile, 'utf8');
  const references = [];
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
    const path = extensionPathFromHtml(htmlFile, match[1]);
    if (path) references.push(path);
  }
  return references;
}

const errors = [];
const javascriptFiles = walk(root);
for (const file of javascriptFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    errors.push(`${relative(root, file)}\n${result.stderr || result.stdout}`);
  }
}

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (manifest.version !== packageJson.version) {
  errors.push(`Version mismatch: manifest ${manifest.version}, package ${packageJson.version}`);
}

const providers = require(join(root, 'lib', 'providers.js'));
for (const error of providers.validateRegistry()) {
  errors.push(`Provider registry: ${error}`);
}

const manifestReferences = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...manifest.content_scripts.flatMap(block => [...(block.js || []), ...(block.css || [])])
].filter(Boolean);
for (const file of manifestReferences) {
  if (!existsSync(join(root, file))) errors.push(`Manifest references missing file: ${file}`);
}

const htmlFiles = [
  manifest.action?.default_popup,
  manifest.options_page,
  'offscreen/pdf_extractor.html',
  'ui/error/error.html'
]
  .filter(Boolean)
  .map(file => join(root, file));
let htmlReferenceCount = 0;
for (const htmlFile of htmlFiles) {
  if (!existsSync(htmlFile)) continue;
  for (const reference of collectHtmlReferences(htmlFile)) {
    htmlReferenceCount += 1;
    if (!existsSync(reference)) {
      errors.push(
        `${relative(root, htmlFile)} references missing file: ${relative(root, reference)}`
      );
    }
  }
}

const forbiddenMarkers = ['site_probe.js', 'probeCurrentSite', 'cindraLastProviderProbe'];
for (const marker of forbiddenMarkers) {
  for (const file of javascriptFiles) {
    if (relative(root, file) === 'scripts/check.mjs') continue;
    if (readFileSync(file, 'utf8').includes(marker)) {
      errors.push(`Removed diagnostic marker ${marker} remains in ${relative(root, file)}`);
    }
  }
}

const runtimeRoots = ['background/', 'content_scripts/', 'offscreen/', 'ui/'];
for (const file of javascriptFiles) {
  const projectPath = relative(root, file).replaceAll('\\', '/');
  if (!runtimeRoots.some(prefix => projectPath.startsWith(prefix))) continue;
  if (projectPath === 'lib/messages.js') continue;
  const source = readFileSync(file, 'utf8');
  if (/\bchrome\.runtime\.sendMessage\s*\(/.test(source) ||
      /\bchrome\.tabs\.sendMessage\s*\(/.test(source)) {
    errors.push(`Direct Chrome messaging bypasses lib/messages.js in ${projectPath}`);
  }
  if (/chrome\.scripting\.executeScript\s*\(\s*\{[\s\S]{0,500}?\bfunction\s*:/.test(source)) {
    errors.push(`Deprecated executeScript function property remains in ${projectPath}; use func`);
  }
}

if (errors.length) {
  console.error(errors.join('\n\n'));
  process.exit(1);
}

console.log(
  `Checked ${javascriptFiles.length} JavaScript files, ` +
  `${manifestReferences.length} manifest references, and ${htmlReferenceCount} HTML references.`
);
