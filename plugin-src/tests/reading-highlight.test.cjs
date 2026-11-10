/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildHighlightCss, buildFallbackCss } = require('../highlight-style.cjs');

const source = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
function method(name, next) {
  const start = source.indexOf(`  ${name}(`);
  const end = source.indexOf(`  ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}
const methods = method('colorReading', 'applyReading') + method('applyReading', 'applyReadingRanges') +
  method('rebuildStyle', 'scheduleFallbackStyle') + method('restoreReading', 'onunload');
class Observer { observe() {} disconnect() {} }
class Child { constructor(el) { this.el = el; } }
const Reading = vm.runInNewContext(`(class { ${methods} })`, {
  MutationObserver: Observer, MarkdownRenderChild: Child, buildHighlightCss, buildFallbackCss,
});

test('reading blocks publish their own styles immediately, even when custom highlights are supported', () => {
  const plugin = new Reading();
  Object.assign(plugin, {
    active: true, engineReady: true, highlightSupported: true, styleDirty: false,
    readingStyle: { textContent: '' }, readingLanguages: new Map(), readingObservers: new Map(),
    readingOriginals: new Map(), readingPalettes: new Map(), fallbackClasses: new Map(),
    clearRanges() {},
    applyReadingRanges() { assert.fail('reading must not use imprecise WebKit ranges'); },
    applyReadingDom() {
      this.fallbackClasses.set('aof-token-aabbcc-112233', { light: '#AABBCC', dark: '#112233' });
      this.styleDirty = true;
    },
  });
  const code = {};
  plugin.colorReading(code, 'python', {}, { addChild() {} });
  assert.match(plugin.readingStyle.textContent, /aof-token-aabbcc-112233/);
  assert.equal(plugin.readingLanguages.get(code), 'python');
});

test('reading wrappers are removed on unload even when custom highlights are available', () => {
  const plugin = new Reading();
  let unwrapped = false;
  Object.assign(plugin, {
    highlightSupported: true, readingObservers: new Map(), readingOriginals: new Map(),
    readingLanguages: new Map(), clearRanges() {}, unwrapReading() { unwrapped = true; }, rebuildStyle() {},
  });
  plugin.restoreReading({});
  assert.equal(unwrapped, true);
});
