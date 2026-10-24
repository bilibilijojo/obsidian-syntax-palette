/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outputPath = path.join(root, 'THIRD-PARTY-NOTICES.txt');
const dependencyLicenses = [
  ['vscode-textmate', '9.2.0', 'sources/licenses/vscode-textmate-MIT.txt'],
  ['vscode-oniguruma', '2.0.1', 'sources/licenses/vscode-oniguruma-MIT.txt'],
  ['markdown-it', '14.3.3', 'sources/licenses/markdown-it-MIT.txt'],
];
const dependencyNotices = [
  ['vscode-oniguruma', '2.0.1', 'sources/notices/vscode-oniguruma-NOTICES.txt'],
];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n').trimEnd();
}

function validateDependencyLicenses() {
  for (const [name, expectedVersion, licensePath] of dependencyLicenses) {
    const packagePath = path.join(root, 'node_modules', name, 'package.json');
    if (!fs.existsSync(packagePath)) throw new Error(`Missing installed package metadata for ${name}`);
    const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    if (metadata.version !== expectedVersion) throw new Error(`${name} version ${metadata.version} does not match ${expectedVersion}`);
    if (metadata.license !== 'MIT') throw new Error(`${name} reports ${metadata.license || 'no SPDX license'}, expected MIT`);
    const licenseName = fs.readdirSync(path.dirname(packagePath)).find((entry) => /^licen[sc]e/i.test(entry));
    if (!licenseName) throw new Error(`${name} package does not contain a license file`);
    const installed = fs.readFileSync(path.join(path.dirname(packagePath), licenseName));
    const vendored = fs.readFileSync(path.join(root, licensePath));
    if (!installed.equals(vendored)) {
      throw new Error(`${licensePath} differs from ${name}@${expectedVersion}'s installed license text`);
    }
  }
  for (const [name, expectedVersion, noticePath] of dependencyNotices) {
    const packagePath = path.join(root, 'node_modules', name, 'package.json');
    if (!fs.existsSync(packagePath)) throw new Error(`Missing installed package metadata for ${name}`);
    const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    if (metadata.version !== expectedVersion) throw new Error(`${name} version ${metadata.version} does not match ${expectedVersion}`);
    const installedPath = path.join(path.dirname(packagePath), 'NOTICES.txt');
    if (!fs.existsSync(installedPath)) throw new Error(`${name} package is missing its upstream NOTICES.txt`);
    if (!fs.readFileSync(installedPath).equals(fs.readFileSync(path.join(root, noticePath)))) {
      throw new Error(`${noticePath} differs from ${name}@${expectedVersion}'s upstream NOTICES.txt`);
    }
  }
}

function buildNotices() {
  validateDependencyLicenses();
  const themeData = JSON.parse(read('sources/theme-provenance.json'));
  const grammarData = JSON.parse(read('sources/plugin-grammar-provenance.json'));
  if (themeData.themeCount !== 39 || themeData.themes.length !== 39) throw new Error('Expected provenance for all 39 themes');
  if (!Array.isArray(grammarData) || grammarData.length !== 11) throw new Error('Expected provenance for all 11 bundled grammar scopes');

  const lines = [
    'Syntax Palette — third-party notices',
    '====================================',
    '',
    'The files and data listed below remain under their respective upstream licenses. The Syntax Palette source license does not replace these terms.',
    '',
    'Theme assets',
    '------------',
    '',
    '| Included variants | Upstream project | Version | License |',
    '| --- | --- | --- | --- |',
  ];
  const groups = new Map();
  for (const theme of themeData.themes) {
    // VS Code's in-tree themes identify their snapshot through vscodeVersion;
    // extension themes use `version`. Do not leak an `undefined` version into
    // the distributed notice when both source formats share this report.
    const version = theme.source.version || theme.source.vscodeVersion;
    if (!version) throw new Error(`Missing upstream version for theme ${theme.id}`);
    const key = [theme.source.project, version, theme.license.spdx, theme.license.file].join('\0');
    if (!groups.has(key)) groups.set(key, { themes: [], project: theme.source.project, version, spdx: theme.license.spdx, file: theme.license.file });
    groups.get(key).themes.push(theme.name);
  }
  for (const item of groups.values()) {
    lines.push(`| ${item.themes.join(', ')} | ${item.project} | ${item.version} | ${item.spdx} |`);
  }
  lines.push(
    '',
    'The five Material Theme variants are frozen from version 34.5.0 under Apache-2.0. No later Material Theme/Vira release is included.',
    'All other theme snapshots are MIT-licensed. Exact source URLs, per-file hashes, copyright lines, and variant mappings are recorded in `sources/theme-provenance.json` and `docs/THEME-PROVENANCE.md`.',
    '',
    'TextMate grammar assets',
    '-----------------------',
    '',
    '| TextMate scope | Upstream path | Version | Source | SHA-256 |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const grammar of grammarData) {
    lines.push(`| ${grammar.scope} | ${grammar.path} | ${grammar.version} | ${grammar.repository.url} | ${grammar.sha256} |`);
  }
  lines.push(
    '',
    'The grammar license notices and original copyright statements follow below. They are preserved from the upstream grammar packages and TextMate bundles.',
    '',
    'Upstream NOTICE statements',
    '--------------------------',
    '',
  );
  for (const name of fs.readdirSync(path.join(root, 'sources/notices'))
    .filter((entry) => /\.(?:txt|md)$/i.test(entry))
    .sort()) {
    lines.push(`### ${name}`, '', '```text', read(`sources/notices/${name}`), '```', '');
  }
  lines.push(
    'Bundled runtime and adapted parser code',
    '---------------------------------------',
    '',
    '- `vscode-textmate@9.2.0` (MIT) is bundled into `main.js`.',
    '- `vscode-oniguruma@2.0.1` (MIT) and its embedded Oniguruma `6.9.5_rev1` WASM runtime (BSD-2-Clause) are bundled into `main.js`; both upstream notices are preserved and no separate WASM file is required.',
    '- `markdown-it@14.3.3` (MIT) is used only by development and test tooling and is not bundled. `plugin-src/fences.cjs` is an MIT-licensed port of its block-rule behavior; the original MIT attribution is retained below.',
    '',
  );
  lines.push('Full license texts', '-------------------', '');

  const licenseFiles = fs.readdirSync(path.join(root, 'sources/licenses'))
    .filter((name) => /\.(?:txt|md)$/i.test(name))
    .sort();
  for (const name of licenseFiles) {
    lines.push('', `### ${name}`, '', '```text', read(`sources/licenses/${name}`), '```');
  }
  lines.push('', '### Bundled grammar license notices', '', '```text', read('sources/grammar-licenses.txt'), '```', '');

  return lines.join('\n').trimEnd() + '\n';
}

function main() {
  const expected = buildNotices();
  if (process.argv.includes('--write')) {
    fs.writeFileSync(outputPath, expected);
    console.log(`Wrote ${path.basename(outputPath)} (${expected.split('\n').length - 1} lines, SHA-256 ${sha256(expected)})`);
    return;
  }
  if (!fs.existsSync(outputPath)) throw new Error('THIRD-PARTY-NOTICES.txt is missing; run npm run update-notices');
  const actual = fs.readFileSync(outputPath, 'utf8').replace(/\r\n/g, '\n');
  if (actual !== expected) throw new Error('THIRD-PARTY-NOTICES.txt is stale; run npm run update-notices and review the diff');
  console.log(`Third-party notices verified (${expected.split('\n').length - 1} lines, SHA-256 ${sha256(expected)})`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
