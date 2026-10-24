'use strict';

const EDITOR_LINE_SELECTOR = '.markdown-source-view.mod-cm6 .cm-line.aof-nowrap';

function buildWrapCss(options = {}) {
  if (options.wrap !== false) return '';
  return [
    `${EDITOR_LINE_SELECTOR} { white-space: pre; overflow-x: auto; overflow-y: hidden; position: relative; scrollbar-width: none; }`,
    // Absolute, empty generated content changes scroll extent without adding
    // selectable text, changing the line height, or touching CM's child nodes.
    `${EDITOR_LINE_SELECTOR}::after { content: ''; position: absolute; left: var(--aof-scroll-extent, 0px); width: 1px; height: 1px; pointer-events: none; }`,
    `${EDITOR_LINE_SELECTOR}[data-aof-scroll-end] { scrollbar-width: thin; }`,
  ].join('\n\n');
}

module.exports = { EDITOR_LINE_SELECTOR, buildWrapCss };
