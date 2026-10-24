/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lockfile = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const nodeVersion = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();
const licenseText = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
const problems = [];
const releaseMode = process.argv.includes('--for-release');
const expect = (condition, message) => { if (!condition) problems.push(message); };

expect(packageJson.name === 'obsidian-syntax-palette', 'package.json name must be obsidian-syntax-palette');
expect(manifest.id === 'syntax-palette', 'manifest id must be syntax-palette');
expect(manifest.name === 'Syntax Palette', 'manifest name must be Syntax Palette');
expect(manifest.author === 'Frank', 'manifest author must match the owner-confirmed public name Frank');
expect(manifest.authorUrl === 'https://github.com/bilibilijojo', 'manifest authorUrl must match the confirmed GitHub profile');
expect(packageJson.author?.name === manifest.author && packageJson.author?.url === manifest.authorUrl, 'package author must match the manifest public author and URL');
expect(manifest.version === packageJson.version, 'manifest and package versions must match');
expect(/^\d+\.\d+\.\d+$/.test(manifest.version), 'release version must use x.y.z format');
expect(typeof manifest.minAppVersion === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.minAppVersion), 'minAppVersion must use x.y.z format');
expect(manifest.isDesktopOnly === true, 'manifest must mark the plugin desktop-only');
expect(typeof manifest.description === 'string' && manifest.description.length <= 250 && manifest.description.endsWith('.'), 'manifest description must be <=250 characters and end with a period');
expect(packageJson.private === true, 'package.json must remain private to prevent accidental npm publication');
expect(packageJson.license === 'Apache-2.0' && lockfile.packages?.['']?.license === packageJson.license, 'project package license and lockfile must match Apache-2.0; third-party licenses remain separate');
expect(packageJson.repository?.url === 'https://github.com/bilibilijojo/obsidian-syntax-palette.git', 'package repository URL must match the intended GitHub repository');
expect(packageJson.engines?.node === nodeVersion, '.nvmrc and package.json Node versions must match exactly');
expect(lockfile.packages?.['']?.version === packageJson.version, 'package-lock root version must match package.json');
expect(licenseText.includes('APPENDIX: How to apply the Apache License to your work.'), 'root LICENSE must include the complete Apache-2.0 appendix');
expect(licenseText.includes('Copyright [yyyy] [name of copyright owner]'), 'root LICENSE appendix is incomplete or modified');
expect(!licenseText.includes('brackets "{}"'), 'root LICENSE must not alter the standard Apache-2.0 appendix');

if (releaseMode) {
  expect(typeof manifest.author === 'string' && manifest.author.trim() !== '' && manifest.author !== 'Local customization', 'manifest author must be confirmed by the project owner before a release');
  expect(manifest.minAppVersion === '1.14.5', 'release minimum Obsidian version must match the lowest version tested in the current evidence');
}

if (problems.length) {
  console.error(problems.map((message) => `- ${message}`).join('\n'));
  process.exit(1);
}

console.log(`Release metadata is consistent for ${manifest.name} (${manifest.id}) ${manifest.version}${releaseMode ? ' and public author metadata is set; copyright scope still requires owner review' : ''}.`);
