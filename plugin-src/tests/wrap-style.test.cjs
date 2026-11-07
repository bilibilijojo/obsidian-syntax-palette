/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EDITOR_LINE_SELECTOR, buildWrapCss } = require('../wrap-style.cjs');
test('wrap enabled emits no layout override', () => {
  assert.equal(buildWrapCss({wrap:true}), '');
  assert.equal(buildWrapCss(), '');
});
test('only fenced editable rows become native scrollports', () => {
  const css=buildWrapCss({wrap:false});
  assert.match(css,/white-space: pre;/);
  assert.match(css,/overflow-x: auto;/);
  assert.doesNotMatch(css,/\.cm-scroller|\.cm-content|white-space: nowrap/);
  assert.match(EDITOR_LINE_SELECTOR,/^\.markdown-source-view\.mod-cm6 \.cm-line\.aof-nowrap$/);
});
test('short rows share the measured block extent without inserting text', () => {
  const css=buildWrapCss({wrap:false});
  assert.match(css,/::after.*content: '';.*position: absolute;.*--aof-scroll-extent/);
  assert.match(css,/pointer-events: none/);
});
test('closing fence exposes a scrollbar without changing every code row height', () => {
  const css=buildWrapCss({wrap:false});
  assert.match(css,/scrollbar-width: none/);
  assert.match(css,/\[data-aof-scroll-end\].*scrollbar-width: thin/);
  assert.match(css,/\.aof-touch-scroll .*overflow: clip; touch-action: pan-y pinch-zoom/);
  assert.match(css,/\.aof-scroll-content.*position: relative; left: var\(--aof-scroll-offset/);
  assert.doesNotMatch(css,/user-select|transform|contenteditable/);
});
test('native mobile scrolling belongs to the block wrapper, with non-scrolling rows', () => {
  const css = buildWrapCss({wrap:false});
  assert.match(css, /\.aof-native-scroll \{ overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain/);
  assert.match(css, /\.aof-native-blocks \.cm-line\.aof-nowrap \{ overflow: visible; box-sizing: border-box; min-width:/);
});
