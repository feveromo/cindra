import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const excluded = new Set(['.codegraph', '.git', 'node_modules', 'vendor', 'test-results', 'playwright-report']);

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

const errors = [];
for (const file of walk(root)) {
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

const referencedFiles = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...manifest.content_scripts.flatMap(block => [...(block.js || []), ...(block.css || [])])
].filter(Boolean);
for (const file of referencedFiles) {
  if (!existsSync(join(root, file))) errors.push(`Manifest references missing file: ${file}`);
}

const forbiddenMarkers = ['site_probe.js', 'probeCurrentSite', 'cindraLastProviderProbe'];
for (const marker of forbiddenMarkers) {
  for (const file of walk(root)) {
    if (relative(root, file) === 'scripts/check.mjs') continue;
    if (readFileSync(file, 'utf8').includes(marker)) {
      errors.push(`Removed diagnostic marker ${marker} remains in ${relative(root, file)}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n\n'));
  process.exit(1);
}

console.log(`Checked ${walk(root).length} JavaScript files and ${referencedFiles.length} manifest references.`);
