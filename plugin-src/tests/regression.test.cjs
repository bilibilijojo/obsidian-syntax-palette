/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SyntaxEngine } = require('../engine.cjs');

const fixture = require('./fixtures/atom-one-baseline.json');
let engine;
before(async () => {
  engine = new SyntaxEngine();
  await engine.initialize(fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')));
});
after(() => engine.dispose());

test('Atom One 0.1.0 output is byte-for-byte stable across all regression samples', () => {
  assert.equal(engine.getState().light, 'atom-one-light');
  assert.equal(engine.getState().dark, 'atom-one-dark');
  assert.equal(engine.getState().coloredBrackets, true);
  for (const item of fixture.cases) {
    const rows = engine.highlight(item.language, item.text);
    assert(rows, item.language);
    assert.deepEqual(rows, item.rows, item.language);
    // The fixture decodes to exactly the original text with no missing or
    // duplicated characters, including Unicode and tabs.
    const lines = item.text.split('\n');
    const reconstructed = rows.map((row, index) => row.map((segment) => lines[index].slice(segment.from, segment.to)).join('')).join('\n');
    assert.equal(reconstructed, item.text, item.language);
  }
});

test('plugin refreshes CodeMirror views through its registered extension, not MarkdownView internals', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  assert.match(source, /this\.editorViews\s*=\s*new Set\(\)/);
  assert.match(source, /plugin\.editorViews\.add\(view\)/);
  assert.match(source, /plugin\.editorViews\.delete\(this\.view\)/);
  assert.match(source, /new Set\(\[\.\.\.this\.editorViews, \.\.\.this\.editorRanges\.keys\(\)\]\)/);
  assert.doesNotMatch(source, /view\?\.editor\?\.cm|\.editor\.cm\b/);
});
