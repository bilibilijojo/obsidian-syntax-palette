/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

// Line-number planning. Everything here is pure: it only maps Markdown source
// positions to numbers and never touches Obsidian, CodeMirror or the DOM, so
// the numbering rules can be tested without a running Obsidian.

const MAX_WIDTH_CLASS = 6;

function digitsFor(count) {
  return String(Math.max(1, Number(count) || 1)).length;
}

// A block's numbers are right aligned in a fixed width so the code text keeps a
// single left edge. The width comes from the block's largest number, never from
// individual lines.
function widthClass(count) {
  return `aof-ln-w${Math.min(digitsFor(count), MAX_WIDTH_CLASS)}`;
}

// One row per fenced code content line: 1-based numbers restarting at 1 for
// every block, plus the source column of the first code character (used to put
// the number inside the block background for list and blockquote fences).
// `positions` comes from allFencedBlocks() and only contains content lines:
// fence markers, indented code and inline code are excluded.
function blockNumberRows(block) {
  // An empty fence has no code line to point at. Reading mode already renders
  // no gutter for it, so the editor stays consistent instead of numbering a
  // line that contains nothing.
  if (!block || block.text === '') return [];
  const positions = block && Array.isArray(block.positions) ? block.positions : [];
  const cls = widthClass(positions.length);
  const rows = [];
  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];
    if (!position || !Number.isFinite(position.line)) continue;
    rows.push({
      line: position.line,
      column: Math.max(0, Number(position.column) || 0),
      number: rows.length + 1,
      widthClass: cls,
    });
  }
  return rows;
}

// Reading mode has no per-line elements, so the gutter is a single string with
// one number per logical code line. The token text never contains the closing
// fence, and blank lines are kept as they are real code lines.
function readingNumbering(text) {
  const value = typeof text === 'string' ? text : '';
  if (value === '') return { count: 0, text: '', widthClass: widthClass(1) };
  const lines = value.split('\n');
  return {
    count: lines.length,
    text: lines.map((line, index) => String(index + 1)).join('\n'),
    widthClass: widthClass(lines.length),
  };
}

// CSS custom properties written on a numbered reading <pre>. Kept in one place
// so cleanup removes exactly what was added. `--aof-ln-digits` is written
// synchronously (it is just the width of the largest number); the rest are
// measured vertical metrics. `--aof-ln-numw` is no longer written by 0.4.3 but
// stays in the cleanup list so a downgrade/upgrade cannot leave it behind.
const READING_STYLE_PROPERTIES = Object.freeze([
  '--aof-ln-inset',
  '--aof-ln-numw',
  '--aof-ln-gap',
  '--aof-ln-digits',
  '--aof-ln-top',
  '--aof-ln-lh',
  '--aof-ln-size',
  '--aof-ln-font',
  '--aof-ln-maxh',
]);

module.exports = {
  MAX_WIDTH_CLASS,
  digitsFor,
  widthClass,
  blockNumberRows,
  readingNumbering,
  READING_STYLE_PROPERTIES,
};
