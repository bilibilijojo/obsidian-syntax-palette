/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

const TOUCH_LINE_SELECTOR = '.markdown-source-view.mod-cm6 .aof-touch-scroll .cm-line.aof-nowrap';
const EDITOR_LINE_SELECTOR = '.markdown-source-view.mod-cm6 .cm-line.aof-nowrap';

function buildWrapCss(options = {}) {
  if (options.wrap !== false) return '';
  return [
    `${EDITOR_LINE_SELECTOR} { white-space: pre; overflow-x: auto; overflow-y: hidden; position: relative; scrollbar-width: none; }`,
    // Absolute, empty generated content changes scroll extent without adding
    // selectable text, changing the line height, or touching CM's child nodes.
    `${EDITOR_LINE_SELECTOR}::after { content: ''; position: absolute; left: var(--aof-scroll-extent, 0px); width: 1px; height: 1px; pointer-events: none; }`,
    `${EDITOR_LINE_SELECTOR}[data-aof-scroll-end] { scrollbar-width: thin; }`,
    // overflow:clip is deliberately not hidden: hidden remains a programmatic
    // scrollport and focus/native selection can scroll one row independently.
    `${TOUCH_LINE_SELECTOR} { overflow: clip; touch-action: pan-y pinch-zoom; }`,
    `${TOUCH_LINE_SELECTOR}::after { display: none; }`,
    // Relative inline positioning preserves CM's line breaks, mark fragments,
    // hit testing and selection geometry without making text atomic boxes.
    `${TOUCH_LINE_SELECTOR} .aof-scroll-content { position: relative; left: var(--aof-scroll-offset, 0px); }`,
    `.markdown-source-view.mod-cm6 .aof-native-scroll { overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: none; }`,
    `.markdown-source-view.mod-cm6 .aof-native-blocks .cm-line.aof-nowrap { overflow: visible; box-sizing: border-box; min-width: calc(var(--aof-scroll-extent, 0px) + 1px); }`,
    `.markdown-source-view.mod-cm6 .aof-native-blocks .cm-line.aof-nowrap::after { display: none; }`,
    `${TOUCH_LINE_SELECTOR}.aof-ln-line::before { left: calc(var(--size-4-3, 12px) + var(--aof-scroll-offset, 0px)); }`,
  ].join('\n\n');
}

module.exports = { EDITOR_LINE_SELECTOR, buildWrapCss };
