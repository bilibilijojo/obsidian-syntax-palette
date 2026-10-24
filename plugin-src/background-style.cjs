/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

const COLOR_RE = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;

// Optional background override. The only property ever written here is
// background-color, and every selector is scoped to a verified fenced code
// block in reading or edit mode. Inline code, prose, editor chrome and fenced
// marker text styling are deliberately untouched.
function backgroundSelectors(mode) {
  return [
    `.theme-${mode} .markdown-rendered pre.aof-fenced-block`,
    `.theme-${mode} .markdown-rendered pre.aof-fenced-block > code`,
    `.theme-${mode} .markdown-source-view.mod-cm6 .cm-line.aof-fenced-line`,
  ];
}

function validBackground(theme) {
  const color = theme && theme.background;
  return typeof color === 'string' && COLOR_RE.test(color) ? color.toUpperCase() : null;
}

function buildBackgroundCss(options = {}) {
  if (!options.enabled) return '';
  const rules = [];
  for (const [mode, theme] of [['light', options.light], ['dark', options.dark]]) {
    const color = validBackground(theme);
    if (!color) continue;
    rules.push(`${backgroundSelectors(mode).join(',\n')} { background-color: ${color}; }`);
  }
  return rules.join('\n\n');
}

module.exports = { backgroundSelectors, buildBackgroundCss };
