/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (sourceManifest.version !== version) throw new Error(`Manifest version ${sourceManifest.version} does not match package version ${version}`);
const out = path.join(root, 'plugin', sourceManifest.id);
const wasmBytes = fs.readFileSync(path.join(root, 'node_modules/vscode-oniguruma/release/onig.wasm'));
if (wasmBytes.length < 8 || wasmBytes.subarray(0, 4).toString('hex') !== '0061736d') {
  throw new Error('vscode-oniguruma did not provide a valid onig.wasm module');
}
const wasmBase64 = wasmBytes.toString('base64');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
esbuild.buildSync({
  entryPoints: [path.join(root, 'plugin-src/main.cjs')],
  outfile: path.join(out, 'main.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2020',
  // The two JSON assets are already compact, but the bundled libraries and
  // plugin code are not; minifying shaves a further ~15% off main.js. String
  // literals (CSS selectors, class names, data attributes) are preserved
  // verbatim, which verify-build.cjs relies on.
  minify: true,
  external: ['obsidian', '@codemirror/view', '@codemirror/state', '@codemirror/language'],
  define: { __SYNTAX_PALETTE_ONIG_WASM_BASE64__: JSON.stringify(wasmBase64) },
  logLevel: 'info',
});
fs.copyFileSync(path.join(root, 'plugin-src/styles.css'), path.join(out, 'styles.css'));
fs.copyFileSync(path.join(root, 'docs/INSTALLATION.md'), path.join(out, 'README.md'));
fs.copyFileSync(path.join(root, 'manifest.json'), path.join(out, 'manifest.json'));
const projectLicense = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
const thirdPartyNotices = fs.readFileSync(path.join(root, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
for (const file of fs.readdirSync(path.join(root, 'sources/licenses'))) {
  const license = fs.readFileSync(path.join(root, 'sources/licenses', file), 'utf8').trim();
  if (!thirdPartyNotices.includes(license)) throw new Error(`THIRD-PARTY-NOTICES.txt is missing full text of ${file}`);
}
if (!thirdPartyNotices.includes(fs.readFileSync(path.join(root, 'sources/grammar-licenses.txt'), 'utf8').trim())) {
  throw new Error('THIRD-PARTY-NOTICES.txt is missing the bundled grammar license notices');
}
const fullNotices = [
  'Syntax Palette source license (Apache-2.0)',
  projectLicense,
  'Third-party notices',
  thirdPartyNotices,
].join('\n\n');
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(out, 'LICENSE'));
fs.writeFileSync(path.join(out, 'THIRD-PARTY-NOTICES.txt'), fullNotices);
const embeddedNotices = fullNotices.split(/\r?\n/).map((line) => `// ${line}`).join('\n');
fs.appendFileSync(
  path.join(out, 'main.js'),
  `\n// BEGIN SYNTAX PALETTE LICENSE AND THIRD-PARTY NOTICES\n${embeddedNotices}\n// END SYNTAX PALETTE LICENSE AND THIRD-PARTY NOTICES\n`,
);

fs.copyFileSync(path.join(root, 'sources/theme-provenance.json'), path.join(out, 'theme-provenance.json'));
fs.copyFileSync(path.join(root, 'sources/plugin-grammar-provenance.json'), path.join(out, 'grammar-provenance.json'));
if (fs.existsSync(path.join(root, 'docs/THEME-PROVENANCE.md'))) {
  fs.copyFileSync(path.join(root, 'docs/THEME-PROVENANCE.md'), path.join(out, 'THEME-PROVENANCE.md'));
}

const files = fs.readdirSync(out).filter((name) => name !== 'SHA256SUMS.txt').sort();
const sums = files.map((name) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(out, name))).digest('hex')}  ${name}`);
fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), sums.join('\n') + '\n');

console.log(`Built self-contained plugin ${version}: ${out}`);
console.log(`  ${files.length} files, main.js ${(fs.statSync(path.join(out, 'main.js')).size / 1024).toFixed(0)} KiB`);
