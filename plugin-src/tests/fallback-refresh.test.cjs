/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('compatibility editor decorations follow theme changes without an edit or viewport change', () => {
  // Exercise the actual registered ViewPlugin class with small CodeMirror and
  // Obsidian stand-ins. The surrounding onload needs a complete host app.
  const source = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  const start = source.indexOf('const tokenExtension = ViewPlugin.fromClass(class {');
  const end = source.indexOf('this.registerEditorExtension(tokenExtension);', start);
  assert.ok(start >= 0 && end > start, 'compatibility extension must be present');
  const refreshEffect = {};
  let color = 'old';
  const plugin = {
    active: true, engineReady: true, highlightSupported: true, editorUsesMarks: true,
    engine: { highlight: () => [[{ from: 0, to: 3, light: color, dark: color }]] },
    fallbackClasses: new Map(), scheduleFallbackStyle() {},
  };
  const state = {
    doc: { length: 11, lines: 3, toString: () => '```js\nabc\n```', line: (n) => n === 2 ? { from: 6, to: 9 } : n === 1 ? { from: 0, to: 5 } : { from: 10, to: 13 } },
    field: () => ({ file: { extension: 'md' } }),
  };
  const view = { state, visibleRanges: [{ from: 0, to: 13 }] };
  const context = {
    plugin, refreshEffect, editorInfoField: {}, tokenClassNodeProp: {},
    ViewPlugin: { fromClass: (klass) => klass },
    Decoration: { none: [], mark: ({ class: name }) => name },
    RangeSetBuilder: class { constructor() { this.items = []; } add(from, to, mark) { this.items.push({ from, to, mark }); } finish() { return this.items; } },
    syntaxTree: () => ({ resolveInner: () => ({ type: { prop: () => 'hmd-codeblock' } }) }),
    allFencedBlocks: () => [{ start: 0, end: 3, language: 'js', text: 'abc', positions: [{ line: 1, column: 0 }] }],
    highlightClass: (light, dark) => `${light}-${dark}`, tokenMark: (name) => name,
  };
  const Extension = vm.runInNewContext(`${source.slice(start, end)}\ntokenExtension`, context);
  const extension = new Extension(view);
  assert.equal(extension.decorations[0].mark, 'old-old');
  color = 'new';
  extension.update({ state, view, docChanged: false, viewportChanged: false,
    transactions: [{ effects: [{ is: (effect) => effect === refreshEffect }] }] });
  assert.equal(extension.decorations[0].mark, 'new-new');
  assert.ok(plugin.fallbackClasses.has('new-new'));
});
