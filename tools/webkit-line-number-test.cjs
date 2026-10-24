'use strict';

// WebKit line-number regression test.
//
// Why this exists: on iOS the numbers followed the code indentation, stuck to
// the text and blinked while scrolling, and in reading mode they were painted
// in a fixed grey that disappeared into the theme background. Those are exactly
// the two things a Chromium-only test cannot see: WebKit lays out the inline
// widget identically but repaints it while the compositor scrolls, and the
// reading gutter used to depend on Obsidian's `--text-faint`.
//
// This page renders the real CSS emitted by `plugin-src/line-number-style.cjs`
// inside WKWebView (the engine iOS uses), at a 390px phone width, and measures:
//   * the rasterised colour of the reading gutter and of the code beside it;
//   * the rasterised colour of the editor gutter and of the code beside it;
//   * that hiding the editor number does not move the code by a single pixel;
//   * that a soft-wrapped row starts at the text column, not under the number.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { buildLineNumberCss, lineNumberColor, contrastRatio } = require('../plugin-src/line-number-style.cjs');
const { buildHighlightCss } = require('../plugin-src/highlight-style.cjs');
const themeCatalog = require('../plugin-src/themes.cjs');

const ROOT = path.join(__dirname, '..');
const EVIDENCE = process.env.AOF_EVIDENCE
  ? path.resolve(process.env.AOF_EVIDENCE)
  : path.join(ROOT, 'evidence', 'v' + require('../package.json').version);

const LIGHT = themeCatalog.getTheme('solarized-light');
const DARK = themeCatalog.getTheme('solarized-dark');

// A colour pair that is unmistakable against both appearances, so a number that
// picks it up cannot be mistaken for the gutter grey.
const HIGHLIGHT = { name: 'aof-reading-a626a4-c678dd', palette: { light: '#A626A4', dark: '#C678DD' } };

function rgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
}

function distance(a, b) {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

function buildPage() {
  const css = buildLineNumberCss({ enabled: true, light: LIGHT, dark: DARK });
  const gutterLight = lineNumberColor(LIGHT);
  const gutterDark = lineNumberColor(DARK);

  // A token highlight is registered over the code next to the number. On iOS
  // (WebKit) a highlight whose selector also matches the number painted the
  // digit in the token colour; the number must keep the gutter colour.
  const highlightCss = buildHighlightCss(new Map([[HIGHLIGHT.name, HIGHLIGHT.palette]]));

  const block = (mode, theme) => `
  <div class="theme-${mode}" id="${mode}">
    <div class="markdown-rendered">
      <pre class="aof-ln-on aof-fenced-block" id="pre-${mode}" style="background:${theme.background};color:${theme.foreground};--aof-ln-inset:4px;--aof-ln-gap:10px;--aof-ln-digits:1;--aof-ln-top:12px;--aof-ln-lh:21px;--aof-ln-size:14px;--aof-ln-font:Menlo,monospace;--aof-ln-maxh:63px"><code>alpha = 1
beta = 2
gamma = 3</code></pre>
    </div>
    <div class="markdown-source-view mod-cm6" style="background:${theme.background};color:${theme.foreground}">
      <div class="cm-line HyperMD-codeblock aof-ln-line aof-lng-1" data-aof-n="1" id="line-${mode}"><span id="text-${mode}">alpha = 1</span></div>
      <div class="cm-line HyperMD-codeblock aof-ln-line aof-lng-1" data-aof-n="2" id="wrap-${mode}"><span id="wraptext-${mode}">segment-segment-segment-segment-segment-segment-segment-segment-segment-segment-segment-end</span></div>
      <div class="cm-line HyperMD-codeblock aof-ln-line aof-lng-2" data-aof-n="13" id="hl-${mode}"><img class="cm-widgetBuffer" aria-hidden="true"><span class="cm-hmd-codeblock cm-keyword" id="hltok-${mode}">import</span></div>
    </div>
  </div>`;

  const probes = [
    { id: 'reading-gutter-light', target: 'gutter-reading-light', expected: gutterLight, background: LIGHT.background },
    { id: 'reading-code-light', target: 'code-reading-light', expected: LIGHT.foreground, background: LIGHT.background },
    { id: 'editor-gutter-light', target: 'gutter-editor-light', expected: gutterLight, background: LIGHT.background },
    { id: 'editor-code-light', target: 'code-editor-light', expected: LIGHT.foreground, background: LIGHT.background },
    { id: 'reading-gutter-dark', target: 'gutter-reading-dark', expected: gutterDark, background: DARK.background },
    { id: 'reading-code-dark', target: 'code-reading-dark', expected: DARK.foreground, background: DARK.background },
    { id: 'editor-gutter-dark', target: 'gutter-editor-dark', expected: gutterDark, background: DARK.background },
    { id: 'editor-code-dark', target: 'code-editor-dark', expected: DARK.foreground, background: DARK.background },
    { id: 'wrapped-row-dark', target: 'wrap-row-dark', expected: DARK.foreground, background: DARK.background },
    { id: 'highlighted-number-light', target: 'gutter-highlight-light', expected: gutterLight, background: LIGHT.background },
    { id: 'highlighted-number-dark', target: 'gutter-highlight-dark', expected: gutterDark, background: DARK.background },
    { id: 'highlighted-token-light', target: 'token-highlight-light', expected: HIGHLIGHT.palette.light, background: LIGHT.background },
    { id: 'highlighted-token-dark', target: 'token-highlight-dark', expected: HIGHLIGHT.palette.dark, background: DARK.background },
  ];

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { --size-4-4: 16px; --text-faint: #b3b3b3; --font-monospace: Menlo, monospace; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body { font: 14px/21px Menlo, monospace; }
  .phone { width: 390px; }
  .theme-light, .theme-dark { padding: 8px; }
  .theme-light { background: ${LIGHT.background}; }
  .theme-dark { background: #111111; }
  .markdown-rendered pre { margin: 0 0 10px; padding: 12px 16px; font: 14px/21px Menlo, monospace; }
  .markdown-rendered pre code { font: inherit; }
  .markdown-source-view { padding: 0 0 10px; font: 14px/21px Menlo, monospace; }
  .cm-line { display: block; white-space: break-spaces; margin-left: 265px; width: 300px; }
  #wrap-light, #wrap-dark { width: 300px; }
${css}
${highlightCss}
</style>
</head>
<body>
<div class="phone">
${block('light', LIGHT)}
${block('dark', DARK)}
</div>
<script>
(function () {
  var plan = ${JSON.stringify(probes)};
  var gutterHex = ${JSON.stringify({ light: gutterLight, dark: gutterDark })};
  var meta = {};

  ['light', 'dark'].forEach(function (mode) {
    var pre = document.getElementById('pre-' + mode);
    pre.setAttribute('data-aof-ln', '1\\n2\\n3');
  });

  // Register a real custom highlight over the token that follows number 13.
  // Both appearances go into one Highlight: CSS.highlights.set replaces any
  // previous entry with the same name.
  if (window.CSS && CSS.highlights && window.Highlight) {
    var hlRanges = ['light', 'dark'].map(function (mode) {
      var token = document.getElementById('hltok-' + mode);
      var range = document.createRange();
      range.setStart(token.firstChild, 0);
      range.setEnd(token.firstChild, 6);
      return range;
    });
    CSS.highlights.set(${JSON.stringify(HIGHLIGHT.name)}, new Highlight(hlRanges[0], hlRanges[1]));
    meta.highlightRegistered = true;
  } else {
    meta.highlightRegistered = false;
  }

  function charRect(node, index) {
    var range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    return range.getBoundingClientRect();
  }

  function firstText(node) {
    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    var current;
    while ((current = walker.nextNode())) {
      if (current.nodeValue && current.nodeValue.trim()) return current;
    }
    return null;
  }

  function rectOf(id, left, top, width, height) {
    return { id: id, left: left, top: top, width: width, height: height };
  }

  var boxes = [];
  ['light', 'dark'].forEach(function (mode) {
    var pre = document.getElementById('pre-' + mode);
    var preRect = pre.getBoundingClientRect();
    var code = pre.querySelector('code');
    var textNode = firstText(code);
    var textRect = charRect(textNode, textNode.nodeValue.indexOf('a'));

    // Gutter column: inset 4px, one digit wide, three rows of 21px. The width is
    // read from the real rule instead of being hard-coded.
    var gutterWidth = parseFloat(getComputedStyle(pre, '::before').width) || 9;
    boxes.push(rectOf('gutter-reading-' + mode, preRect.left + 4, preRect.top + 12, gutterWidth, 63));
    boxes.push(rectOf('code-reading-' + mode, textRect.left, textRect.top, textRect.width, textRect.height));
    meta['readingGap-' + mode] = Number((textRect.left - (preRect.left + 4 + gutterWidth)).toFixed(2));

    // Drift: dropping every measured property must not move the code text. This
    // is the "text jumps while scrolling" bug: the reset used to fall back to a
    // different gutter width for one frame. Only the digit count survives,
    // because it is known synchronously and is the single source of truth for
    // the column width.
    var savedStyle = pre.getAttribute('style');
    var driftBefore = charRect(textNode, textNode.nodeValue.indexOf('a')).left;
    pre.style.cssText = '--aof-ln-digits:1';
    var driftAfter = charRect(textNode, textNode.nodeValue.indexOf('a')).left;
    pre.setAttribute('style', savedStyle);
    meta['readingDrift-' + mode] = Number((driftAfter - driftBefore).toFixed(2));

    var line = document.getElementById('line-' + mode);
    var lineRect = line.getBoundingClientRect();
    // The editor number is ::before content of the line (data-aof-n), not a
    // DOM node. getComputedStyle resolves the pseudo box to used pixels, which
    // is what the pixel probes need.
    var beforeStyle = getComputedStyle(line, '::before');
    var spanRect = {
      left: lineRect.left + parseFloat(beforeStyle.left),
      top: lineRect.top + parseFloat(beforeStyle.top || '0'),
      width: parseFloat(beforeStyle.width),
      height: parseFloat(beforeStyle.height || '0'),
    };
    spanRect.right = spanRect.left + spanRect.width;
    if (!Number.isFinite(spanRect.left) || !Number.isFinite(spanRect.width)) {
      throw new Error('line number ::before box did not resolve');
    }
    var lineText = document.getElementById('text-' + mode);
    var lineTextRect = charRect(lineText.firstChild, 0);
    boxes.push(rectOf('gutter-editor-' + mode, spanRect.left, spanRect.top, spanRect.width, spanRect.height));
    boxes.push(rectOf('code-editor-' + mode, lineTextRect.left, lineTextRect.top, lineTextRect.width, lineTextRect.height));
    meta['editorGap-' + mode] = Number((lineTextRect.left - spanRect.right).toFixed(2));
    meta['editorLineWidth-' + mode] = Number(lineRect.width.toFixed(2));

    // Reproduce Obsidian's fold chevron: a zero-width inline box at the text
    // edge whose 15px icon is absolutely positioned at left:-15px. If the gutter
    // gap is narrower than the icon, the chevron is painted on the number.
    var fold = document.createElement('span');
    fold.style.cssText = 'position:relative;display:inline-block;width:0;height:1px;';
    var foldIcon = document.createElement('span');
    foldIcon.style.cssText = 'position:absolute;left:-15px;top:0;width:15px;height:14px;';
    fold.appendChild(foldIcon);
    line.insertBefore(fold, lineText);
    meta['foldGap-' + mode] = Number((foldIcon.getBoundingClientRect().left - spanRect.right).toFixed(2));

    // Soft-wrapped row: the second visual row must start at the text column,
    // not under the number.
    var wrap = document.getElementById('wrap-' + mode);
    wrap.style.marginLeft = '0px';
    wrap.style.width = '200px';
    var wrapText = document.getElementById('wraptext-' + mode);
    var wrapRange = document.createRange();
    wrapRange.selectNodeContents(wrapText);
    var rows = [...wrapRange.getClientRects()].filter(function (rect) { return rect.width > 1; });
    meta['wrapRowLeft-' + mode] = rows[1] ? Number(rows[1].left.toFixed(2)) : null;
    meta['wrapTextLeft-' + mode] = rows[0] ? Number(rows[0].left.toFixed(2)) : null;
    meta['wrapRows-' + mode] = rows.length;
    if (rows[1]) boxes.push(rectOf('wrap-row-' + mode, rows[1].left, rows[1].top, 6, rows[1].height));

    // Does hiding the number move the code? It must not.
    var hide = document.createElement('style');
    hide.textContent = '.aof-ln{display:none !important} .aof-ln-line::before{content:none !important}';
    document.head.appendChild(hide);
    var hiddenRect = charRect(lineText.firstChild, 0);
    hide.remove();
    var restoredRect = charRect(lineText.firstChild, 0);
    meta['editorShift-' + mode] = Number((hiddenRect.left - restoredRect.left).toFixed(2));

    // Number 13 sits next to a token that carries a registered custom
    // highlight. If the highlight selector also matches the number, WebKit
    // paints the digits in the token colour instead of the gutter colour.
    // Measured last, so the final layout (after the wrapped row was narrowed)
    // is the one the snapshot shows.
    var hlLine = document.getElementById('hl-' + mode);
    var hlLineRect = hlLine.getBoundingClientRect();
    var hlBefore = getComputedStyle(hlLine, '::before');
    var hlNumberRect = {
      left: hlLineRect.left + parseFloat(hlBefore.left),
      top: hlLineRect.top + parseFloat(hlBefore.top || '0'),
      width: parseFloat(hlBefore.width),
      height: parseFloat(hlBefore.height || '0'),
    };
    hlNumberRect.right = hlNumberRect.left + hlNumberRect.width;
    boxes.push(rectOf('gutter-highlight-' + mode, hlNumberRect.left, hlNumberRect.top, hlNumberRect.width, hlNumberRect.height));
    var hlToken = document.getElementById('hltok-' + mode);
    var hlTokenRect = charRect(hlToken.firstChild, 0);
    boxes.push(rectOf('token-highlight-' + mode, hlTokenRect.left, hlTokenRect.top, hlTokenRect.width, hlTokenRect.height));
    meta['highlightNumberGap-' + mode] = Number((hlTokenRect.left - hlNumberRect.right).toFixed(2));
  });

  window.__meta = meta;
  window.__probes = plan.map(function (item) {
    var box = boxes.find(function (candidate) { return candidate.id === item.target; });
    return {
      id: item.id,
      target: item.target,
      expected: item.expected,
      background: item.background,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height
    };
  });
})();
</script>
</body>
</html>`;
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aof-webkit-ln-'));
  const pagePath = path.join(tmp, 'page.html');
  const shotPath = path.join(tmp, 'page.png');
  fs.writeFileSync(pagePath, buildPage());

  const swift = spawnSync('swift', [path.join(__dirname, 'webkit-highlight-probe.swift'), pagePath, shotPath], {
    encoding: 'utf8',
    timeout: 180000,
  });
  if (swift.error) {
    console.error(`webkit probe could not run: ${swift.error.message}`);
    return 2;
  }
  const line = (swift.stdout || '').split('\n').find((item) => item.startsWith('RESULT '));
  if (!line) {
    console.error(swift.stdout || '');
    console.error(swift.stderr || '');
    return 2;
  }
  const result = JSON.parse(line.slice('RESULT '.length));
  if (result.error) {
    console.error(`webkit probe error: ${result.error}`);
    return 2;
  }

  fs.mkdirSync(EVIDENCE, { recursive: true });
  if (fs.existsSync(shotPath)) fs.copyFileSync(shotPath, path.join(EVIDENCE, 'webkit-line-numbers.png'));

  const meta = result.meta || {};
  const failures = [];
  const rows = [];
  for (const probe of result.probes || []) {
    const actual = probe.ink?.hex || null;
    const delta = actual ? distance(actual, probe.expected) : 999;
    const pass = Boolean(actual) && delta <= 60;
    if (!pass) failures.push(`${probe.id}: rendered ${actual || 'no ink'} expected ${probe.expected} (distance ${delta.toFixed(1)})`);
    rows.push({ id: probe.id, expected: probe.expected, actual, distance: Number(delta.toFixed(1)), pass, rect: probe.rect });
  }

  for (const mode of ['light', 'dark']) {
    const readingGap = meta[`readingGap-${mode}`];
    const editorGap = meta[`editorGap-${mode}`];
    const shift = meta[`editorShift-${mode}`];
    const wrapRow = meta[`wrapRowLeft-${mode}`];
    const wrapText = meta[`wrapTextLeft-${mode}`];
    const drift = meta[`readingDrift-${mode}`];
    const foldGap = meta[`foldGap-${mode}`];
    if (!(readingGap >= 6)) failures.push(`${mode}: reading gutter overlaps the code (gap ${readingGap})`);
    if (!(editorGap >= 16)) failures.push(`${mode}: editor number is too close to the code (gap ${editorGap})`);
    if (!(foldGap >= 1)) failures.push(`${mode}: fold chevron overlaps the number by ${(-foldGap).toFixed(1)}px`);
    if (Math.abs(shift) > 0.5) failures.push(`${mode}: code moves ${shift}px when the number mounts`);
    if (Math.abs(wrapRow - wrapText) > 0.5) failures.push(`${mode}: wrapped row starts at ${wrapRow}, text column is ${wrapText}`);
    if (Math.abs(drift) > 0.1) failures.push(`${mode}: dropping measured geometry moves the code by ${drift}px`);
  }

  // The gutter must be visibly quieter than the code on both appearances.
  for (const [mode, theme] of [['light', LIGHT], ['dark', DARK]]) {
    const gutter = lineNumberColor(theme);
    const ratio = contrastRatio(rgb(gutter), rgb(theme.background));
    if (ratio < 2.9) failures.push(`${mode}: gutter contrast ${ratio.toFixed(2)} is too low`);
    const codeRatio = contrastRatio(rgb(theme.foreground), rgb(theme.background));
    if (ratio > codeRatio) failures.push(`${mode}: gutter is louder than the code`);
  }

  const summary = {
    engine: result.userAgent,
    platform: 'WKWebView (same engine as iOS/iPadOS)',
    width: 390,
    meta,
    probes: rows,
    pass: failures.length === 0,
    failures,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'webkit-line-numbers.json'), JSON.stringify(summary, null, 2));

  for (const row of rows) {
    console.log(`${row.pass ? 'ok  ' : 'FAIL'} ${row.id.padEnd(24)} expected ${row.expected} actual ${row.actual || '-'} d=${row.distance}`);
  }
  console.log(`gap reading ${meta['readingGap-dark']}px / editor ${meta['editorGap-dark']}px, shift ${meta['editorShift-dark']}px, wrapped row ${meta['wrapRowLeft-dark']} vs text ${meta['wrapTextLeft-dark']}`);
  if (failures.length) {
    console.error(failures.join('\n'));
    return 1;
  }
  console.log('WEBKIT LINE NUMBER CHECKS PASSED');
  return 0;
}

process.exit(main());
