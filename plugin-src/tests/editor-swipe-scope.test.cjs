/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function decorations({ sharedTouch = true, wrap = false, active = true } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  const start = source.indexOf('      buildFenceDecorations(state, blocks) {');
  const end = source.indexOf('\n      schedule() {', start);
  assert.ok(start >= 0 && end > start);
  const decoration = spec => ({ range: (from, to) => ({ from, to, spec }) });
  const context = {
    plugin: { active, settings: { wrapCodeBlocks: wrap, lineNumbers: false, codeBlockBackground: true } },
    Decoration: { none: [], line: decoration, mark: decoration, set: ranges => ranges },
    fenceLineDecoration: () => decoration({ class: 'aof-fenced-line' }),
  };
  const method = vm.runInNewContext(`({${source.slice(start, end)}}).buildFenceDecorations`, context);
  const state = { doc: { lines: 5, line: n => ({ from: (n - 1) * 10, to: n * 10 - 1 }) } };
  return method.call({ sharedTouchScroll: sharedTouch }, state, [{ start: 1, end: 4 }]);
}

test('only touch nowrap fenced rows opt out of host page swipe recognition', () => {
  const ranges = decorations();
  const rows = ranges.filter(r => r.spec.attributes?.['data-ignore-swipe']);
  assert.equal(rows.length, 3);
  assert.deepEqual(Array.from(rows, row => row.from), [10, 20, 30]);
  assert.ok(rows.every(row => row.spec.attributes['data-ignore-swipe'] === 'true'));
  assert.ok(rows.every(row => row.spec.attributes['data-aof-scroll'] === '10'));
});

test('desktop, wrapping and disabled plugin do not reserve page swipe gestures', () => {
  for (const options of [{ sharedTouch: false }, { wrap: true }, { active: false }]) {
    assert.ok(decorations(options).every(row => !row.spec.attributes?.['data-ignore-swipe']));
  }
});

function wrappers({ native = true, wrap = false, active = true } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  const start = source.indexOf('      buildBlockWrappers(state, blocks) {');
  const end = source.indexOf('      buildFenceDecorations(state, blocks) {', start);
  const context = {
    plugin: { active, settings: { wrapCodeBlocks: wrap } },
    Decoration: { none: [] },
    BlockWrapper: { create: spec => ({ range: (from, to) => ({ from, to, spec }) }), set: ranges => ranges },
  };
  const method = vm.runInNewContext(`({${source.slice(start, end)}}).buildBlockWrappers`, context);
  return method.call({ nativeBlockScroll: native }, { doc: { lines: 8, line: n => ({ from: (n - 1) * 10, to: n * 10 - 1 }) } }, [{ start: 1, end: 4 }, { start: 5, end: 7 }]);
}
test('native wrappers cover each fence once and opt out of workspace gestures', () => {
  const result = wrappers();
  assert.deepEqual(Array.from(result, r => [r.from, r.to]), [[10, 39], [50, 69]]);
  assert.ok(result.every(r => r.spec.tagName === 'div' && r.spec.attributes.class === 'aof-native-scroll' && r.spec.attributes['data-ignore-swipe'] === 'true'));
});
test('native wrappers disappear for wrapping, plugin disable and compatibility mode', () => {
  for (const options of [{ native: false }, { wrap: true }, { active: false }]) assert.equal(wrappers(options).length, 0);
});
