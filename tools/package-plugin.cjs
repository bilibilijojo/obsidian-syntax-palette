/*
 * SPDX-License-Identifier: Apache-2.0
 */
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
const pluginFiles = fs.readdirSync(outDir).filter((name) => name !== '.DS_Store').sort();
const sourceDateEpoch = Number(process.env.SOURCE_DATE_EPOCH || '315532800'); // 1980-01-01, ZIP's earliest supported timestamp.
if (!Number.isInteger(sourceDateEpoch) || sourceDateEpoch < 315532800) {
  throw new Error('SOURCE_DATE_EPOCH must be a Unix timestamp on or after 1980-01-01');
}
const zipDate = new Date(sourceDateEpoch * 1000);
for (const name of pluginFiles) {
  const filePath = path.join(outDir, name);
  fs.chmodSync(filePath, 0o644);
  fs.utimesSync(filePath, zipDate, zipDate);
}
execFileSync('zip', ['-X', '-q', zipPath, ...pluginFiles.map((name) => `${pluginFolder}/${name}`)], {
  cwd: path.join(root, 'plugin'),
  // ZIP stores local wall-clock timestamps; pin UTC so macOS and CI agree.
  env: { ...process.env, TZ: 'UTC' },
  stdio: 'inherit',
});
const hash = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
fs.writeFileSync(sumsPath, `${hash}  ${path.basename(zipPath)}\n`);
const listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
console.log(`Packaged ${path.relative(root, zipPath)} (${(fs.statSync(zipPath).size / 1024).toFixed(0)} KiB)`);
console.log(`SHA-256 ${hash}`);
console.log(listing.split('\n').filter((line) => line.includes(pluginFolder) || line.includes('files')).join('\n'));
