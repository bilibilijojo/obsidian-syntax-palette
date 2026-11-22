/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { foldChanged, visibleSegments } = require('../editor-fold.cjs');

test('fold and unfold invalidate connected cached editor highlights', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  const start = source.indexOf('const extension = ViewPlugin.fromClass(class {');
  const end = source.indexOf('this.registerEditorExtension(extension);', start);
  assert.ok(start >= 0 && end > start);
  const foldEffect = {}, unfoldEffect = {}, refreshEffect = {};
  const plugin = { active: true, engineReady: true, editorUsesMarks: false };
  const Extension = vm.runInNewContext(`${source.slice(start, end)}\nextension`, {
    ViewPlugin: { fromClass: (klass) => klass }, EditorView: {},
    plugin, foldChanged, foldEffect, unfoldEffect, refreshEffect,
  });
  const instance = Object.create(Extension.prototype);
  const doc = {};
  instance.document = doc;
  instance.builtLines = new Map([[10, 3]]);
  instance.lineAttempts = new Map([[10, 2]]);
  instance.fenceScroll = { update() {} };
  instance.needsRangeRebuild = () => false;
  let scheduled = 0;
  instance.schedule = () => scheduled++;
  const update = (effect) => instance.update({ state: { doc }, docChanged: false,
    transactions: [{ effects: [{ is: (type) => type === effect }] }] });
  update(foldEffect);
  assert.equal(instance.builtLines.size, 0);
  assert.equal(instance.lineAttempts.size, 0);
  assert.equal(scheduled, 1);
  instance.builtLines.set(10, 3);
  update(unfoldEffect);
  assert.equal(instance.builtLines.size, 0);
  assert.equal(scheduled, 2);
});

test('visible token fragments exclude folded and offscreen text', () => {
  assert.deepEqual(visibleSegments(3, 15, [{ from: 0, to: 5 }, { from: 9, to: 12 }, { from: 14, to: 20 }]),
    [{ from: 3, to: 5 }, { from: 9, to: 12 }, { from: 14, to: 15 }]);
  assert.deepEqual(visibleSegments(5, 9, [{ from: 0, to: 5 }, { from: 9, to: 12 }]), []);
});
