'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const version = packageJson.version;
const pluginFolder = sourceManifest.id;
const outDir = path.join(root, 'plugin', pluginFolder);
const zipPath = path.join(root, `${pluginFolder}-${version}.zip`);
const sumsPath = zipPath + '.sha256';

if (!fs.existsSync(path.join(outDir, 'main.js')) || !fs.existsSync(path.join(outDir, 'manifest.json'))) {
  throw new Error('Build output is missing. Run npm run build first.');
}
const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
if (manifest.version !== version) throw new Error(`Manifest version ${manifest.version} does not match package version ${version}`);

fs.rmSync(zipPath, { force: true });
fs.rmSync(sumsPath, { force: true });
execFileSync('zip', ['-r', '-q', zipPath, pluginFolder, '-x', '*.DS_Store'], {
  cwd: path.join(root, 'plugin'),
  stdio: 'inherit',
});
const hash = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
fs.writeFileSync(sumsPath, `${hash}  ${path.basename(zipPath)}\n`);
const listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
console.log(`Packaged ${path.relative(root, zipPath)} (${(fs.statSync(zipPath).size / 1024).toFixed(0)} KiB)`);
console.log(`SHA-256 ${hash}`);
console.log(listing.split('\n').filter((line) => line.includes(pluginFolder) || line.includes('files')).join('\n'));
