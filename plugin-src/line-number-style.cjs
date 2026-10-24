'use strict';

// Line-number presentation CSS. Disabled means the generated style element is
// completely empty, so no selector, box or reserved space survives the switch.
//
// Editing: the number is CSS `::before` content of the code line itself,
// generated from the line's `data-aof-n` attribute. Taking it out of the text
// flow matters in narrow panes: an inline number re-flows the code line whenever it
// appears during a scroll (the text visibly jumps by the gutter width and the
// number sits flush against the code), and a line soft-wrapped by a narrow
// screen puts the continuation text right underneath the number. With an
// absolute gutter the text column is fixed by CSS, never moves, and wrapped
// rows stay aligned. Generated content (rather than a CodeMirror widget) also
// means there is nothing for CodeMirror to measure or mount while scrolling:
// a widget costs a measure pass per line that scrolls in and paints one frame
// late, which is the "number flashes next to the text" hitch. The only widget
// left is the inline one for code inside a blockquote/list marker, where the
// number must be inserted after the marker inside the line's text.
//
// The gutter also has to hold what Obsidian itself draws at the start of a
// line. Every foldable line gets a `.cm-fold-indicator`: a zero-width inline
// box at the text edge whose 15px chevron is absolutely positioned at
// `left: -15px`, i.e. *inside* whatever left padding precedes the text. With a
// 1.2ch gap the chevron landed on the last digit(s) of the number; the gap is
// therefore `GUTTER_GAP` em wide, which clears the chevron at every font size.
//
// Reading: Obsidian renders one <pre><code> for the whole fence, so a single
// gutter is positioned in the <pre> padding area. `white-space: pre` plus a
// dedicated scroll container on <code> keep one logical line per visual row,
// which is what makes a stacked number column align exactly.

const EDITOR_PREFIX = '.markdown-source-view.mod-cm6 .aof-ln';
const EDITOR_LINE_PREFIX = '.markdown-source-view.mod-cm6 .cm-line.aof-ln-line';
const READING_PREFIX = '.markdown-rendered pre.aof-ln-on';

// Digits are right aligned in a column that is exactly as wide as the block's
// largest number, and the code starts one gap further right. The column width
// uses `ch` (the code font's digit advance), so it is derived from the same font
// as the code and cannot drift from it. The gap is in `em` because it has to
// clear Obsidian's fold chevron: a 15px icon anchored at the text edge, inside
// whatever left padding precedes the text. 1.3em is 18px at the default 14px
// code size, which leaves ~3px between the number and the chevron box; the 20px
// floor keeps that clearance when a theme or a zoom level shrinks the code font
// below 15px, where 1.3em would be narrower than the icon itself.
const GUTTER_GAP = 1.3;
const GUTTER_GAP_FLOOR_PX = 20;
const EDITOR_GUTTER_INSET_CSS = 'var(--size-4-3, 12px)';
const EDITOR_GUTTER_GAP_CSS = `max(${GUTTER_GAP}em, ${GUTTER_GAP_FLOOR_PX}px)`;

// Reading numbers must never move the text. Everything horizontal is expressed
// in CSS and driven by `--aof-ln-digits`, which is known synchronously from the
// number of lines in the fence; only vertical metrics are measured. Before
// 0.4.3 the column width was a measured pixel value with a `2.4ch` fallback, so
// the first frame of every (re)rendered block reserved a different width than
// the measured one: a 1-digit block shifted its code sideways by 12px when the
// measurement landed, and any width reflow during a render made the text jump
// back and forth.

function parseColor(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let match = /^#([0-9a-f]{6})$/i.exec(text);
  if (match) {
    const hex = match[1];
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  match = /^#([0-9a-f]{3})$/i.exec(text);
  if (match) {
    return match[1].split('').map((digit) => parseInt(digit + digit, 16));
  }
  return null;
}

function toHex(rgb) {
  return `#${rgb.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  return (light + 0.05) / (dark + 0.05);
}

// A line number must read as "quieter than the code" while staying legible on
// the block background. The colour is therefore the theme's own foreground
// blended towards the theme's background as far as a 3:1 contrast floor allows
// (WCAG's non-text minimum; the old fixed grey sat at 2.1:1 on Solarized and
// effectively disappeared on a phone). Being theme derived, it can never
// coincide with the code colour either.
function lineNumberColor(theme) {
  const foreground = parseColor(theme && theme.foreground);
  const background = parseColor(theme && theme.background);
  if (!foreground || !background) return null;
  for (const alpha of [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9]) {
    const blended = foreground.map((channel, index) => channel * alpha + background[index] * (1 - alpha));
    if (contrastRatio(blended, background) >= 3) return toHex(blended);
  }
  return toHex(foreground.map((channel, index) => channel * 0.92 + background[index] * 0.08));
}

function editorRules() {
  return [
    `${EDITOR_PREFIX} {
  position: absolute;
  top: 0;
  left: ${EDITOR_GUTTER_INSET_CSS};
  display: block;
  margin: 0;
  padding: 0;
  width: 1ch;
  color: var(--text-faint);
  font-family: inherit;
  font-size: inherit;
  font-style: normal;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  line-height: inherit;
  text-align: right;
  user-select: none;
  -webkit-user-select: none;
  pointer-events: none;
}`,
    ...[1, 2, 3, 4, 5, 6].map((width) => (
      `${EDITOR_PREFIX}.aof-ln-w${width} { width: ${width}ch; }`
    )),
    // Fenced code inside a blockquote or list item shares its line with the
    // marker, so it keeps the inline widget (after the marker) instead of a
    // gutter the line cannot reserve without shifting the marker. The trailing
    // space clears the same fold chevron.
    `${EDITOR_PREFIX}.aof-ln-inline {
  position: static;
  display: inline-block;
  width: auto;
  vertical-align: baseline;
  padding-inline-end: ${EDITOR_GUTTER_GAP_CSS};
}`,
    ...[1, 2, 3, 4, 5, 6].map((width) => (
      `${EDITOR_PREFIX}.aof-ln-inline.aof-ln-w${width} { min-width: ${width}ch; }`
    )),
    // The line reserves the gutter itself, so the code text has one stable left
    // edge: with the number present or hidden, and on soft-wrapped rows. The
    // number is generated content of this very line, so it appears in the same
    // frame as the line — nothing to mount.
    `${EDITOR_LINE_PREFIX} { position: relative; }`,
    `${EDITOR_LINE_PREFIX}::before {
  content: attr(data-aof-n);
  position: absolute;
  top: 0;
  left: ${EDITOR_GUTTER_INSET_CSS};
  display: block;
  margin: 0;
  padding: 0;
  color: var(--text-faint);
  font-family: inherit;
  font-size: inherit;
  font-style: normal;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  line-height: inherit;
  text-align: right;
  user-select: none;
  -webkit-user-select: none;
  pointer-events: none;
}`,
    ...[1, 2, 3, 4, 5, 6].map((width) => (
      `${EDITOR_LINE_PREFIX}.aof-lng-${width} { padding-left: calc(${EDITOR_GUTTER_INSET_CSS} + ${width}ch + ${EDITOR_GUTTER_GAP_CSS}); }`
    )),
    ...[1, 2, 3, 4, 5, 6].map((width) => (
      `${EDITOR_LINE_PREFIX}.aof-lng-${width}::before { width: ${width}ch; }`
    )),
  ];
}

function readingRules() {
  return [
    `${READING_PREFIX} { position: relative; }`,
    `${READING_PREFIX} > code {
  display: block;
  white-space: pre;
  overflow-x: auto;
  overflow-y: hidden;
  /* The gutter is reserved on the scroll container itself and depends only on
     the number of digits, which is written to the element as soon as the block
     is numbered. A re-measure can therefore never change this width: the text
     keeps its column through scrolls, resizes and theme switches. */
  padding-left: calc(var(--aof-ln-inset, 4px) + var(--aof-ln-digits, 2) * 1ch + var(--aof-ln-gap, 10px));
}`,
    `${READING_PREFIX}::before {
  content: attr(data-aof-ln);
  position: absolute;
  top: var(--aof-ln-top, 0.8em);
  left: var(--aof-ln-inset, 4px);
  width: calc(var(--aof-ln-digits, 2) * 1ch);
  max-height: var(--aof-ln-maxh, none);
  overflow: hidden;
  white-space: pre;
  text-align: right;
  font-family: var(--aof-ln-font, var(--font-monospace));
  font-size: var(--aof-ln-size, 1em);
  font-style: normal;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  line-height: var(--aof-ln-lh, 1.5);
  color: var(--text-faint);
  user-select: none;
  -webkit-user-select: none;
  pointer-events: none;
}`,
  ];
}

function colorRules(options) {
  const rules = [];
  for (const mode of ['light', 'dark']) {
    const color = lineNumberColor(options[mode]);
    if (!color) continue;
    rules.push(`.theme-${mode} .markdown-source-view.mod-cm6 .aof-ln { color: ${color}; }`);
    rules.push(`.theme-${mode} .markdown-source-view.mod-cm6 .cm-line.aof-ln-line::before { color: ${color}; }`);
    rules.push(`.theme-${mode} .markdown-rendered pre.aof-ln-on::before { color: ${color}; }`);
  }
  return rules;
}

function buildLineNumberCss(options = {}) {
  if (!options.enabled) return '';
  return [...editorRules(), ...readingRules(), ...colorRules(options)].join('\n\n');
}

module.exports = {
  EDITOR_PREFIX,
  EDITOR_LINE_PREFIX,
  READING_PREFIX,
  GUTTER_GAP,
  editorRules,
  readingRules,
  lineNumberColor,
  contrastRatio,
  buildLineNumberCss,
};
