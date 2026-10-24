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
  logLevel: 'info',
});
fs.copyFileSync(path.join(root, 'node_modules/vscode-oniguruma/release/onig.wasm'), path.join(out, 'onig.wasm'));
fs.copyFileSync(path.join(root, 'plugin-src/styles.css'), path.join(out, 'styles.css'));
fs.copyFileSync(path.join(root, 'PLUGIN-README.md'), path.join(out, 'README.md'));

fs.copyFileSync(path.join(root, 'manifest.json'), path.join(out, 'manifest.json'));

const notices = ['Syntax Palette — bundled third-party notices\n'];
notices.push('\nPlugin code is a local customization. The theme and grammar color data below are third-party works used under their respective licenses.\n');
notices.push('\n=== Theme sources ===\n');
notices.push('Atom One Light / Dark: akamud/vscode-theme-onelight and akamud/vscode-theme-onedark (MIT).\n');
notices.push('GitHub Light Default / Dark Default / Dark Dimmed: GitHub.github-vscode-theme 6.3.5 (MIT).\n');
notices.push('Ayu Light / Dark / Mirage: teabyii.ayu 1.5.0 (MIT).\n');
notices.push('VS Code Light+ / Dark+ / Light Modern / Dark Modern: Microsoft VS Code 1.142.0 built-in theme-defaults (MIT).\n');
notices.push('Catppuccin Latte / Frappé / Macchiato / Mocha: Catppuccin.catppuccin-vsc 3.19.0 (MIT).\n');
notices.push('Dracula Official: dracula-theme.theme-dracula 2.25.1 (MIT).\n');
notices.push('Tokyo Night Light / Night / Storm: enkia.tokyo-night 1.1.2 (MIT).\n');
notices.push('One Dark Pro / Darker / Flat: Binaryify/OneDark-Pro, zhuangtongfa.Material-theme 3.20.3 (MIT).\n');
notices.push('Light Owl / Night Owl: sdras.night-owl 2.1.1 (MIT).\n');
notices.push('Nord: arcticicestudio.nord-visual-studio-code 0.19.0 (MIT).\n');
notices.push('Solarized Light / Dark: ryanolsonx.solarized 3.0.0 (MIT), a port of Ethan Schoonover\'s Solarized palette.\n');
notices.push('Kanagawa Lotus / Kanagawa Wave / Kanagawa Dragon: metaphore.kanagawa-vscode-color-theme 1.2.0 (MIT), a VS Code port of Kanagawa.nvim by rebelot.\n');
notices.push('Material Theme / Darker / Palenight / Ocean / Lighter: Equinusocio.vsc-material-theme 34.5.0 (Apache-2.0). This is a frozen official release from before later restrictive license terms; no later Material Theme assets are bundled.\n');
notices.push('Monokai: Microsoft VS Code 1.142.0 built-in theme-monokai (MIT).\n');
notices.push('Min Light / Min Dark: miguelsolorio.min-theme 1.5.0 (MIT).\n');
notices.push('Exact source URLs, versions and SHA-256 hashes are in theme-provenance.json. Only foreground token colors, editor.foreground and editor.background are bundled; font styles and other UI colors are not.\n');

const licenseOrder = [
  ['akamud-vscode-theme-onelight-MIT.txt', 'Atom One Light (akamud)'],
  ['akamud-vscode-theme-onedark-MIT.txt', 'Atom One Dark (akamud)'],
  ['github-vscode-theme-MIT.txt', 'GitHub Theme for VS Code (Primer)'],
  ['ayu-vscode-MIT.txt', 'Ayu for VS Code (Ike Kurghinyan)'],
  ['catppuccin-vscode-MIT.txt', 'Catppuccin for VS Code'],
  ['dracula-vscode-MIT.txt', 'Dracula Theme for VS Code'],
  ['vscode-MIT.txt', 'Visual Studio Code theme-defaults and theme-monokai (Microsoft)'],
  ['tokyo-night-MIT.txt', 'Tokyo Night for VS Code (Enkia)'],
  ['one-dark-pro-MIT.txt', 'One Dark Pro (Binaryify)'],
  ['night-owl-MIT.txt', 'Night Owl (Sarah Drasner)'],
  ['nord-MIT.txt', 'Nord for Visual Studio Code (Arctic Ice Studio / Sven Greb)'],
  ['solarized-vscode-MIT.txt', 'Solarized for VS Code (Ryan Olson)'],
  ['solarized-upstream-MIT.txt', 'Solarized palette (Ethan Schoonover)'],
  ['kanagawa-vscode-MIT.txt', 'Kanagawa Flavors for VS Code (Pierre-Alain Castella)'],
  ['kanagawa-nvim-MIT.txt', 'Kanagawa.nvim (rebelot)'],
  ['material-theme-Apache-2.0.txt', 'Material Theme 34.5.0 (Apache-2.0)'],
  ['min-theme-MIT.txt', 'Min Theme (Miguel Solorio)'],
];
for (const [file, label] of licenseOrder) {
  const licensePath = path.join(root, 'sources/licenses', file);
  if (!fs.existsSync(licensePath)) throw new Error(`Missing license file: ${licensePath}`);
  notices.push(`\n\n=== ${label} ===\n${fs.readFileSync(licensePath, 'utf8')}`);
}

for (const name of ['vscode-textmate', 'vscode-oniguruma', 'markdown-it', 'mdurl', 'uc.micro', 'linkify-it', 'punycode.js', 'entities', 'argparse']) {
  const dir = path.join(root, 'node_modules', name);
  if (!fs.existsSync(dir)) continue;
  const license = fs.readdirSync(dir).find((entry) => /^licen[sc]e/i.test(entry));
  if (license) notices.push(`\n\n=== ${name} ===\n${fs.readFileSync(path.join(dir, license), 'utf8')}`);
}
notices.push('\n\n=== Bundled grammar licenses ===\n' + fs.readFileSync(path.join(root, 'sources/grammar-licenses.txt'), 'utf8'));
fs.writeFileSync(path.join(out, 'THIRD-PARTY-NOTICES.txt'), notices.join(''));

fs.copyFileSync(path.join(root, 'sources/theme-provenance.json'), path.join(out, 'theme-provenance.json'));
fs.copyFileSync(path.join(root, 'sources/plugin-grammar-provenance.json'), path.join(out, 'grammar-provenance.json'));
if (fs.existsSync(path.join(root, 'THEME-PROVENANCE.md'))) {
  fs.copyFileSync(path.join(root, 'THEME-PROVENANCE.md'), path.join(out, 'THEME-PROVENANCE.md'));
}

const files = fs.readdirSync(out).filter((name) => name !== 'SHA256SUMS.txt').sort();
const sums = files.map((name) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(out, name))).digest('hex')}  ${name}`);
fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), sums.join('\n') + '\n');

console.log(`Built self-contained plugin ${version}: ${out}`);
console.log(`  ${files.length} files, main.js ${(fs.statSync(path.join(out, 'main.js')).size / 1024).toFixed(0)} KiB`);
