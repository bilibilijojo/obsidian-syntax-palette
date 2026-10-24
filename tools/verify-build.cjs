'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const out = path.join(root, 'plugin', sourceManifest.id);
const required = [
  'main.js', 'manifest.json', 'styles.css', 'onig.wasm', 'README.md',
  'THIRD-PARTY-NOTICES.txt', 'theme-provenance.json', 'grammar-provenance.json', 'SHA256SUMS.txt',
];
const problems = [];
function check(condition, message) {
  if (!condition) problems.push(message);
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

for (const file of required) check(fs.existsSync(path.join(out, file)), `missing ${file}`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
check(manifest.id === sourceManifest.id, 'plugin id does not match root manifest');
check(manifest.version === packageJson.version, `manifest version ${manifest.version} != package ${packageJson.version}`);
check(manifest.name === sourceManifest.name, 'display name does not match root manifest');
check(manifest.minAppVersion === sourceManifest.minAppVersion, 'unexpected minAppVersion');
check(manifest.isDesktopOnly === true, 'plugin must be marked desktop-only');

const main = fs.readFileSync(path.join(out, 'main.js'), 'utf8');
const asset = JSON.parse(fs.readFileSync(path.join(root, 'plugin-src/assets/themes.json'), 'utf8'));
check(Object.keys(asset.themes).length === 39, `expected 39 themes, found ${Object.keys(asset.themes).length}`);
check(asset.families.length === 15, `expected 15 families, found ${asset.families.length}`);
for (const id of Object.keys(asset.themes)) check(main.includes(id), `bundle missing theme ${id}`);
check(/require\("@codemirror\/state"\)/.test(main), 'StateEffect dependency should stay external');
check(/require\("@codemirror\/view"\)/.test(main), 'CodeMirror view dependency should stay external');
check(/require\("obsidian"\)/.test(main), 'obsidian dependency should stay external');
check(main.includes('aof-fenced-block') && main.includes('aof-fenced-line'), 'fenced background classes missing from bundle');
check(main.includes('syntax-palette-background'), 'background style element missing from bundle');

// v0.4.0 line numbers
check(main.includes('syntax-palette-line-numbers'), 'line number style element missing from bundle');
check(main.includes('aof-ln-on') && main.includes('data-aof-ln'), 'line number markers missing from bundle');
check(main.includes('lineNumbers'), 'line number setting missing from bundle');
// v0.4.2: the editor number must sit in a reserved gutter (absolute positioning
// plus line padding) instead of re-flowing the code line on every scroll.
// v0.4.4: the number itself is `::before` content generated from the line's
// `data-aof-n` attribute, never a CodeMirror widget — a widget is measured and
// mounted per scrolled-in line and paints a frame late (the scroll flash).
check(main.includes('aof-lng-'), 'bundle must reserve the editor line-number gutter');
check(main.includes('data-aof-n'), 'editor line numbers must be line attribute data');
check(main.includes('attr(data-aof-n)'), 'editor line numbers must render through ::before content');
check(main.includes('aof-ln-inline'), 'bundle must keep the inline variant for quoted/list fences');
check(main.includes('--aof-ln-gap'), 'bundle must expose the reading gutter gap variable');
check(!main.includes('getBasePath'), 'bundle must not rely on the legacy adapter filesystem path');
check(main.includes('readBinary'), 'bundle must load runtime resources through the vault adapter');
check(!main.includes('isMobile'), 'bundle must not inspect or report a mobile platform');
check(!main.includes('orientationchange'), 'bundle must not retain a mobile rotation listener');
// WebKit only paints a custom highlight on the element that owns
// the text node, so the descendant form is required for nested token spans.
// It must also exclude the line-number widget: WebKit paints the whole text of
// every matched element, so a bare `*` would dye the numbers in the token colour.
check(/:not\([^)]*\)::highlight\(/.test(main), 'bundle must keep the descendant ::highlight selector for WebKit');
check(!/\*\s*::highlight\(/.test(main), 'bundle must not use a bare *::highlight selector (it dyes line numbers on WebKit)');
check(main.includes('aof-token-'), 'bundle must keep the no-highlight-API compatibility renderer');
check(main.includes('highlightMode'), 'bundle must expose the active render mode for diagnosis');
check(main.includes('collectDiagnostics'), 'bundle must keep the copyable diagnostics report');

// v0.5.0 editor code-block wrapping. The switch is opt-in (native wrapping is
// restored when it is on), so the bundle must always carry the class, the
// generated style node and the per-line rule — a missing rule would silently
// leave long code lines wrapped with no horizontal scrollbar.
check(main.includes('syntax-palette-wrap'), 'wrap style element missing from bundle');
check(main.includes('aof-nowrap'), 'bundle must mark fenced editor lines for the no-wrap rule');
check(main.includes('wrapCodeBlocks'), 'wrap setting missing from bundle');
check(main.includes('white-space: pre'), 'bundle must pin fenced editor lines to a single visual row');
check(main.includes('overflow-x: auto'), 'bundle must expose local scrollports for long code lines');
check(main.includes('data-aof-scroll') && main.includes('--aof-scroll-extent'), 'block-scoped native scroll synchronization missing');
const wrapCss = require('../plugin-src/wrap-style.cjs').buildWrapCss({wrap:false});
check(!wrapCss.includes('.cm-scroller'), 'wrap CSS must not assign horizontal overflow to the entire editor');
// The wrap rules must stay scoped to the editor: a global .cm-content rule
// would stop ordinary markdown from wrapping as well.
check(!/\.cm-content\{?[^}]*white-space/.test(main), 'bundle must not disable wrapping for the whole editor');

const notices = fs.readFileSync(path.join(out, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
for (const text of [
  'Atom One Light', 'GitHub Light Default', 'Ayu Light', 'Catppuccin Latte',
  'Dracula Official', 'VS Code Light+', 'Tokyo Night Light', 'One Dark Pro',
  'Light Owl', 'Nord', 'Solarized Light', 'Kanagawa Wave', 'Material Theme',
  'Monokai', 'Min Dark', 'Copyright (c) 2015 Mahmoud Ali',
  'Apache License', '34.5.0 (Apache-2.0)',
]) {
  check(notices.includes(text), `notices missing ${text}`);
}
for (const file of fs.readdirSync(path.join(root, 'sources/licenses'))) {
  const license = fs.readFileSync(path.join(root, 'sources/licenses', file), 'utf8').trim();
  check(notices.includes(license), `notices missing full text of ${file}`);
}

const sums = fs.readFileSync(path.join(out, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
for (const line of sums) {
  const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
  check(Boolean(match), `bad SHA256SUMS line: ${line}`);
  if (!match) continue;
  check(fs.existsSync(path.join(out, match[2])), `checksum references missing ${match[2]}`);
  if (fs.existsSync(path.join(out, match[2]))) {
    check(sha256(fs.readFileSync(path.join(out, match[2]))) === match[1], `checksum mismatch for ${match[2]}`);
  }
}

for (const file of required) {
  const text = fs.readFileSync(path.join(out, file), 'utf8');
  check(!/\/Users\/[^/]+/.test(text), `${file} contains a local absolute path`);
  check(!text.includes('/Applications/Visual Studio Code.app'), `${file} contains a local app path`);
}

const styles = fs.readFileSync(path.join(out, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
check(!/::highlight/.test(styles), 'static styles should not contain dynamic highlight rules');
check(!/pre\s*>\s*code/.test(styles), 'static styles must not target note code');

const zipPath = path.join(root, `${manifest.id}-${manifest.version}.zip`);
if (fs.existsSync(zipPath)) {
  const listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
  for (const file of required) check(listing.includes(file), `zip missing ${file}`);
  check(fs.existsSync(zipPath + '.sha256'), 'zip checksum missing');
  if (fs.existsSync(zipPath + '.sha256')) {
    const zipHash = fs.readFileSync(zipPath + '.sha256', 'utf8').trim().split(/\s+/)[0];
    check(zipHash === sha256(fs.readFileSync(zipPath)), 'zip checksum mismatch');
  }
}

if (problems.length) {
  console.error('Build verification failed:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`Build verified: ${manifest.name} ${manifest.version}, ${Object.keys(asset.themes).length} themes, ${required.length} files.`);
if (fs.existsSync(zipPath)) console.log(`ZIP verified: ${path.relative(root, zipPath)}`);
