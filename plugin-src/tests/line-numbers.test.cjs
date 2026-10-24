/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

// Unit tests for the v0.4.0 line-number planning layer. These run without
// Obsidian: they cover the numbering rules (one sequence per block, blank lines
// counted, fence markers excluded) and the pure CSS/width helpers.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_WIDTH_CLASS,
  digitsFor,
  widthClass,
  blockNumberRows,
  readingNumbering,
  READING_STYLE_PROPERTIES,
} = require('../line-numbers.cjs');
const { allFencedBlocks, codeBlockTokens } = require('../fences.cjs');
const { buildLineNumberCss, lineNumberColor, contrastRatio, EDITOR_LINE_PREFIX } = require('../line-number-style.cjs');
const themeCatalog = require('../themes.cjs');

function hexToRgb(value) {
  const hex = value.replace('#', '');
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

function rowsFor(markdown) {
  return allFencedBlocks(markdown).map((block) => blockNumberRows(block));
}

test('width class follows the digit count of the largest number', () => {
  assert.equal(digitsFor(1), 1);
  assert.equal(digitsFor(9), 1);
  assert.equal(digitsFor(10), 2);
  assert.equal(digitsFor(99), 2);
  assert.equal(digitsFor(100), 3);
  assert.equal(digitsFor(1000), 4);
  assert.equal(digitsFor(1000000), 7);
  // A missing or nonsense count still yields a usable single-digit class.
  assert.equal(digitsFor(undefined), 1);
  assert.equal(digitsFor(0), 1);
  assert.equal(digitsFor('12'), 2);
});

test('width class is clamped so the gutter cannot grow without bound', () => {
  assert.equal(widthClass(1), 'aof-ln-w1');
  assert.equal(widthClass(10), 'aof-ln-w2');
  assert.equal(widthClass(100), 'aof-ln-w3');
  assert.equal(widthClass(10 ** 9), `aof-ln-w${MAX_WIDTH_CLASS}`);
  assert.equal(MAX_WIDTH_CLASS, 6);
});

test('every block restarts at 1 and stops at its own line count', () => {
  const rows = rowsFor('```python\na = 1\nb = 2\n```\n\n```js\nc = 3\n```\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].map((row) => row.number), [1, 2]);
  assert.deepEqual(rows[1].map((row) => row.number), [1]);
});

test('fence markers are never numbered', () => {
  const markdown = '```python\na = 1\nb = 2\n```\n';
  const rows = rowsFor(markdown)[0];
  // Content starts on document line 1 (0-based), i.e. right after the opener.
  assert.deepEqual(rows.map((row) => row.line), [1, 2]);
  assert.equal(rows.length, 2);
});

test('blank lines inside a block are counted', () => {
  const markdown = '```python\na = 1\n\nb = 2\n```\n';
  const rows = rowsFor(markdown)[0];
  assert.deepEqual(rows.map((row) => row.number), [1, 2, 3]);
});

test('a block whose closing fence is missing still numbers its content', () => {
  const rows = rowsFor('```python\na = 1\nb = 2')[0];
  assert.deepEqual(rows.map((row) => row.number), [1, 2]);
});

test('consecutive blocks never share a sequence', () => {
  const rows = rowsFor('```\na\n```\n```\nb\nc\n```\n```\nd\n```\n');
  assert.deepEqual(rows.map((block) => block.map((row) => row.number)), [[1], [1, 2], [1]]);
});

test('unlabeled and unknown-language fences are numbered like any other block', () => {
  const rows = rowsFor('```\na\nb\n```\n\n```not-a-real-language\nc\n```\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].map((row) => row.number), [1, 2]);
  assert.deepEqual(rows[1].map((row) => row.number), [1]);
});

test('indented code blocks are not fenced blocks, so they stay unnumbered', () => {
  const markdown = '```js\na\n```\n\n    indented = true\n';
  const rows = rowsFor(markdown);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].map((row) => row.number), [1]);
});

test('fences hidden inside %% comments are not numbered', () => {
  const markdown = '```js\nreal = 1\n```\n\n%%\n```js\nhidden = 2\n```\n%%\n';
  const rows = rowsFor(markdown);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].map((row) => row.number), [1]);
});

test('inline code is not treated as a block', () => {
  const markdown = 'Use `a = 1` inline.\n```js\nreal = 2\n```\n';
  assert.equal(allFencedBlocks(markdown).length, 1);
  assert.deepEqual(rowsFor(markdown)[0].map((row) => row.number), [1]);
});

test('blocks inside list items and blockquotes keep their column offset', () => {
  const markdown = [
    '- item',
    '  ```python',
    '  listed = True',
    '  ```',
    '',
    '> quote',
    '> ```python',
    '> quoted = True',
    '> ```',
    '',
  ].join('\n');
  const blocks = allFencedBlocks(markdown);
  assert.equal(blocks.length, 2);
  const rows = blocks.map((block) => blockNumberRows(block));
  assert.deepEqual(rows[0].map((row) => row.number), [1]);
  assert.deepEqual(rows[1].map((row) => row.number), [1]);
  // The number must land after the list marker / quote marker so it stays
  // inside the block background instead of on the container edge.
  assert.equal(rows[0][0].column, 2);
  assert.equal(rows[1][0].column, 2);
});

test('a single long logical line still gets a single number', () => {
  const long = 'x'.repeat(4000);
  const rows = rowsFor(`\`\`\`text\n${long}\n\`\`\`\n`)[0];
  assert.deepEqual(rows.map((row) => row.number), [1]);
});

test('CRLF documents number the same as LF documents', () => {
  const lf = rowsFor('```python\na = 1\n\nb = 2\n```\n');
  const crlf = rowsFor('```python\r\na = 1\r\n\r\nb = 2\r\n```\r\n');
  assert.deepEqual(
    crlf.map((block) => block.map((row) => [row.number, row.column])),
    lf.map((block) => block.map((row) => [row.number, row.column])),
  );
});

test('frontmatter before the first block does not shift the numbering', () => {
  const markdown = '---\ntitle: demo\n---\n\n```python\na = 1\nb = 2\n```\n';
  const rows = rowsFor(markdown)[0];
  assert.deepEqual(rows.map((row) => row.number), [1, 2]);
});

test('blockNumberRows tolerates missing or malformed input', () => {
  assert.deepEqual(blockNumberRows(null), []);
  assert.deepEqual(blockNumberRows({}), []);
  assert.deepEqual(blockNumberRows({ positions: 'nope' }), []);
  assert.deepEqual(blockNumberRows({ positions: [null, { line: 3 }] }), [
    { line: 3, column: 0, number: 1, widthClass: 'aof-ln-w1' },
  ]);
});

test('an empty fence is numbered in neither mode', () => {
  assert.deepEqual(blockNumberRows({ text: '', positions: [{ line: 4, column: 0 }] }), []);
  assert.equal(readingNumbering('').count, 0);
});

test('blockNumberRows gives every row of a block the same width class', () => {
  const text = Array.from({ length: 12 }, (_, index) => `line_${index}`).join('\n');
  const rows = rowsFor(`\`\`\`text\n${text}\n\`\`\`\n`)[0];
  assert.equal(rows.length, 12);
  assert.ok(rows.every((row) => row.widthClass === 'aof-ln-w2'));
});

test('reading mode numbers one entry per logical line', () => {
  const result = readingNumbering('a = 1\n\nb = 2\nc = 3');
  assert.equal(result.count, 4);
  assert.equal(result.text, '1\n2\n3\n4');
  assert.equal(result.widthClass, 'aof-ln-w1');
});

test('reading mode keeps a blank-only block numbered', () => {
  const result = readingNumbering('\n\n');
  assert.equal(result.count, 3);
  assert.equal(result.text, '1\n2\n3');
});

test('reading mode renders nothing for an empty block', () => {
  const result = readingNumbering('');
  assert.equal(result.count, 0);
  assert.equal(result.text, '');
  // A width class is still reported so callers never see undefined.
  assert.equal(result.widthClass, 'aof-ln-w1');
});

test('reading mode ignores non-string token text', () => {
  assert.deepEqual(readingNumbering(undefined), { count: 0, text: '', widthClass: 'aof-ln-w1' });
  assert.deepEqual(readingNumbering(null), { count: 0, text: '', widthClass: 'aof-ln-w1' });
});

test('reading mode switches width class at 10 and 100 lines', () => {
  const nine = readingNumbering(Array.from({ length: 9 }, () => 'x').join('\n'));
  const ten = readingNumbering(Array.from({ length: 10 }, () => 'x').join('\n'));
  const hundred = readingNumbering(Array.from({ length: 100 }, () => 'x').join('\n'));
  assert.equal(nine.widthClass, 'aof-ln-w1');
  assert.equal(ten.widthClass, 'aof-ln-w2');
  assert.equal(hundred.widthClass, 'aof-ln-w3');
});

test('line-number CSS is empty while the feature is off', () => {
  assert.equal(buildLineNumberCss({ enabled: false }), '');
  assert.equal(buildLineNumberCss({}), '');
});

test('line-number CSS is scoped and never restyles note code globally', () => {
  const css = buildLineNumberCss({ enabled: true });
  assert.match(css, /\.markdown-source-view\.mod-cm6 \.aof-ln\b/);
  assert.match(css, /pre\.aof-ln-on/);
  // Only numbered reading blocks get the gutter, never every <pre> in a note.
  assert.ok(!/(^|\n)\s*pre\s*\{\s*position/.test(css));
  assert.ok(!/::highlight/.test(css));
  // Numbers must not be selectable, so copying a block never yields them.
  assert.match(css, /user-select:\s*none/);
  assert.match(css, /pointer-events:\s*none/);
  assert.ok(!css.includes('display: none'), 'numbers must be hidden from copy, not from view');
});

test('line-number CSS declares every width class it can emit', () => {
  const css = buildLineNumberCss({ enabled: true });
  for (let index = 1; index <= MAX_WIDTH_CLASS; index++) {
    assert.ok(css.includes(`aof-ln-w${index}`), `missing aof-ln-w${index}`);
  }
});

test('reading gutter is driven by CSS variables that cleanup can remove', () => {
  const css = buildLineNumberCss({ enabled: true });
  // Horizontal geometry is CSS + the digit count only; vertical metrics are the
  // measured ones. A measured pixel column used to be the second source of truth
  // for the same width, and the two disagreed for a frame on every re-render.
  const consumed = [
    '--aof-ln-inset',
    '--aof-ln-gap',
    '--aof-ln-digits',
    '--aof-ln-top',
    '--aof-ln-lh',
    '--aof-ln-size',
    '--aof-ln-font',
    '--aof-ln-maxh',
  ];
  for (const property of consumed) {
    assert.ok(css.includes(`var(${property}`), `CSS does not consume ${property}`);
    assert.ok(READING_STYLE_PROPERTIES.includes(property), `${property} would not be cleaned up`);
  }
  // Still cleaned up (0.4.2 wrote it inline) but deliberately not consumed.
  assert.ok(READING_STYLE_PROPERTIES.includes('--aof-ln-numw'));
  assert.ok(!css.includes('var(--aof-ln-numw'), 'the measured pixel column must not drive layout');
  const gutter = /pre\.aof-ln-on > code \{[\s\S]*?padding-left:\s*(calc\([\s\S]*?\));/.exec(css);
  assert.ok(gutter, 'missing reading gutter rule');
  assert.match(gutter[1], /--aof-ln-digits/);
  assert.match(gutter[1], /1ch/);
  assert.equal(new Set(READING_STYLE_PROPERTIES).size, READING_STYLE_PROPERTIES.length);
});

test('editor numbers are absolute and the line reserves the gutter', () => {
  const css = buildLineNumberCss({ enabled: true });
  // Inline numbers re-flow the code line whenever CodeMirror mounts one during
  // a scroll (text jumps by the gutter width, wrapped rows land under the
  // number). Absolute positioning plus line padding removes both symptoms.
  assert.match(css, /\.aof-ln\s*\{[^}]*position:\s*absolute/s);
  for (let width = 1; width <= MAX_WIDTH_CLASS; width++) {
    const rule = new RegExp(`${EDITOR_LINE_PREFIX.replace(/\./g, '\\.')}\\.aof-lng-${width}\\s*\\{[^}]*padding-left:\\s*calc\\([^}]*${width}ch`);
    assert.match(css, rule, `missing gutter padding for ${width} digits`);
  }
  // The gap has to clear Obsidian's fold chevron, which is a 15px icon anchored
  // at the text edge; a 10px gap put it on top of the last digit.
  const gapRule = new RegExp(`${EDITOR_LINE_PREFIX.replace(/\./g, '\\.')}\\.aof-lng-1\\s*\\{[\\s\\S]*?padding-left:\\s*(calc\\([\\s\\S]*?\\));`);
  const gap = gapRule.exec(css);
  assert.ok(gap, 'missing gutter padding for the 1-digit class');
  const emGap = /([\d.]+)em/.exec(gap[1]);
  assert.ok(emGap, 'gutter gap must be expressed in em so it scales with the code font');
  const pixelsAtDefaultSize = Number(emGap[1]) * 14;
  assert.ok(pixelsAtDefaultSize >= 16, `gutter gap ${pixelsAtDefaultSize}px would collide with the fold chevron`);
  // A code font smaller than 15px would make 1.3em narrower than the 15px icon,
  // so the gap is floored in px as well.
  const floor = /max\([\d.]+em,\s*(\d+)px\)/.exec(gap[1]);
  assert.ok(floor, 'gutter gap needs a px floor for small code fonts');
  assert.ok(Number(floor[1]) >= 18, `gutter gap floor ${floor[1]}px leaves no room for the fold chevron`);
  // The widget must not contribute width to the text flow.
  assert.ok(!/\.aof-ln\s*\{[^}]*display:\s*inline-block/s.test(css));
});

test('line-number colour is derived from the theme, never the code colour', () => {
  const css = buildLineNumberCss({
    enabled: true,
    light: themeCatalog.getTheme('solarized-light'),
    dark: themeCatalog.getTheme('solarized-dark'),
  });
  assert.match(css, /\.theme-light .*\.aof-ln\s*\{[^}]*color:\s*#[0-9A-F]{6}/);
  assert.match(css, /\.theme-dark .*pre\.aof-ln-on::before\s*\{[^}]*color:\s*#[0-9A-F]{6}/);
  for (const id of ['solarized-light', 'solarized-dark', 'github-light-default', 'tokyo-night-night']) {
    const theme = themeCatalog.getTheme(id);
    const color = lineNumberColor(theme);
    assert.match(color, /^#[0-9A-F]{6}$/, `${id} produced ${color}`);
    assert.notEqual(color.toUpperCase(), String(theme.foreground).toUpperCase(), `${id} reuses the code colour`);
    const ratio = contrastRatio(hexToRgb(color), hexToRgb(theme.background));
    assert.ok(ratio >= 2.9, `${id} gutter contrast ${ratio.toFixed(2)}`);
    const codeRatio = contrastRatio(hexToRgb(theme.foreground), hexToRgb(theme.background));
    assert.ok(ratio <= codeRatio + 0.01, `${id} gutter must stay quieter than the code`);
  }
});

test('line-number colour falls back safely when a theme has no background', () => {
  assert.equal(lineNumberColor(null), null);
  assert.equal(lineNumberColor({ foreground: '#657B83' }), null);
  assert.equal(lineNumberColor({ foreground: 'not-a-colour', background: '#FFFFFF' }), null);
  const css = buildLineNumberCss({ enabled: true, light: null, dark: null });
  assert.ok(!/\.theme-light .*\.aof-ln/.test(css));
  assert.match(css, /color:\s*var\(--text-faint\)/);
});

test('codeBlockTokens keeps indented code distinct from fences', () => {
  const tokens = codeBlockTokens('```js\na\n```\n\n    indented\n');
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0].fenced, true);
  assert.equal(tokens[1].fenced, false);
});
