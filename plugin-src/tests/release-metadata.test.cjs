/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');

function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syntax-palette-metadata-'));
  try {
    fs.mkdirSync(path.join(dir, 'tools'));
    for (const name of ['manifest.json', 'package.json', 'package-lock.json', '.nvmrc', 'LICENSE', 'tools/check-release-metadata.cjs']) {
      fs.copyFileSync(path.join(root, name), path.join(dir, name));
    }
    run(dir, () => spawnSync(process.execPath, [path.join(dir, 'tools/check-release-metadata.cjs'), '--for-release'], { encoding: 'utf8' }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('Release metadata accepts confirmed public credit without asserting copyright clearance', () => {
  fixture((dir, check) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.author, 'Frank');
    assert.equal(manifest.authorUrl, 'https://github.com/bilibilijojo');
    const result = check();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /copyright scope still requires owner review/);
  });
});

test('Release metadata rejects author, homepage, and package credit drift', () => {
  fixture((dir, check) => {
    for (const [file, key, value] of [
      ['manifest.json', 'author', 'Local customization'],
      ['manifest.json', 'authorUrl', 'https://example.com'],
      ['package.json', 'author', { name: 'Other', url: 'https://github.com/bilibilijojo' }],
    ]) {
      const target = path.join(dir, file);
      const original = fs.readFileSync(target, 'utf8');
      const data = JSON.parse(original);
      data[key] = value;
      fs.writeFileSync(target, JSON.stringify(data));
      assert.notEqual(check().status, 0, `${file} ${key} drift must fail`);
      fs.writeFileSync(target, original);
    }
  });
});
