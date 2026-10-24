/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

// WebKit `::highlight()` rendering regression test.
//
// Why this exists: on iOS and iPadOS every code block stayed in Obsidian's
// native colours even though the plugin registered its ranges, loaded the wasm
// engine and painted line numbers correctly. The cause was not a missing API or
// a failed engine — WebKit only paints a custom highlight where the element
// matched by `::highlight()` directly owns the highlighted text nodes, while
// Obsidian wraps every token in a nested <span>. Chromium covers nested spans,
// so no desktop test could see the difference. This harness renders the real
// selector output of `plugin-src/highlight-style.cjs` in WKWebView — the same
// engine iOS uses — and measures the rasterised colour of each token.
//
// The page also contains a control that uses the old host-only selector, so the
// test fails loudly if WebKit ever starts painting it or if the fix regresses.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { selectorsFor } = require('../plugin-src/highlight-style.cjs');

const ROOT = path.join(__dirname, '..');
const EVIDENCE = process.env.AOF_EVIDENCE
  ? path.resolve(process.env.AOF_EVIDENCE)
  : path.join(ROOT, 'evidence', 'v' + require('../package.json').version);

const NATIVE_LIGHT = '#24292F';
const NATIVE_DARK = '#C9D1D9';
const LIGHT_BG = '#FFFFFF';
const DARK_BG = '#0D1117';

const KEYWORD_LIGHT = '#0550AE';
const STRING_LIGHT = '#0A3069';
const KEYWORD_DARK = '#FF7B72';
const STRING_DARK = '#A5D6FF';

function rgb(hex) {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function distance(a, b) {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

// Old behaviour: colour only the element that owns the fence. Kept in the page
// as a control so the test proves it discriminates.
function legacySelectors(mode, name) {
  return [
    `.theme-${mode} .markdown-rendered pre > code::highlight(${name})`,
    `.theme-${mode} .markdown-source-view.mod-cm6 .cm-line.HyperMD-codeblock:not(.HyperMD-codeblock-begin):not(.HyperMD-codeblock-end)::highlight(${name})`,
  ];
}

function rule(selectors, color) {
  return `${selectors.join(',\n')} { color: ${color}; }`;
}

function buildPage() {
  const lightKeyword = 'aof-reading-0550ae-ff7b72';
  const lightString = 'aof-reading-0a3069-a5d6ff';
  const legacyName = 'aof-reading-legacy-control';

  const css = [
    rule(selectorsFor('light', lightKeyword), KEYWORD_LIGHT),
    rule(selectorsFor('dark', lightKeyword), KEYWORD_DARK),
    rule(selectorsFor('light', lightString), STRING_LIGHT),
    rule(selectorsFor('dark', lightString), STRING_DARK),
    rule(legacySelectors('light', legacyName), '#B31D28'),
  ].join('\n');

  const probes = [
    { id: 'nested-span-light', name: lightKeyword, target: 'kw-light', expected: KEYWORD_LIGHT, background: LIGHT_BG },
    { id: 'direct-text-light', name: lightString, target: 'str-light', expected: STRING_LIGHT, background: LIGHT_BG },
    { id: 'inline-code-light', name: lightKeyword, target: 'inline-light', expected: NATIVE_LIGHT, background: LIGHT_BG },
    { id: 'prose-light', name: lightKeyword, target: 'prose-light', expected: NATIVE_LIGHT, background: LIGHT_BG },
    { id: 'legacy-host-only-control', name: legacyName, target: 'legacy-light', expected: NATIVE_LIGHT, background: LIGHT_BG },
    { id: 'nested-span-dark', name: lightKeyword, target: 'kw-dark', expected: KEYWORD_DARK, background: DARK_BG },
    { id: 'direct-text-dark', name: lightString, target: 'str-dark', expected: STRING_DARK, background: DARK_BG },
    // Editing mode uses a different host (`.cm-line.HyperMD-codeblock`), so the
    // same WebKit limitation has to be verified there too.
    { id: 'editor-line-light', name: lightKeyword, target: 'kw-editor-light', expected: KEYWORD_LIGHT, background: LIGHT_BG },
    { id: 'editor-line-dark', name: lightKeyword, target: 'kw-editor-dark', expected: KEYWORD_DARK, background: DARK_BG },
  ];

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; }
  body { font: 15px/24px Menlo, monospace; }
  .theme-light { background: ${LIGHT_BG}; color: ${NATIVE_LIGHT}; padding: 12px; }
  .theme-dark { background: ${DARK_BG}; color: ${NATIVE_DARK}; padding: 12px; }
  pre { margin: 0 0 8px; background: transparent; }
  code { font: inherit; color: inherit; background: transparent; }
  p { margin: 0 0 8px; }
  .cm-line { display: block; white-space: pre; font: inherit; }
${css}
</style>
</head>
<body>
<div class="theme-light">
  <div class="markdown-rendered">
    <pre><code><span class="token keyword" id="kw-light">def</span> hello()</code></pre>
    <pre><code id="str-light">plainstring</code></pre>
    <pre><code><span class="token keyword" id="legacy-light">def</span> legacy</code></pre>
    <p>Inline <code id="inline-light">inline_token</code> sample</p>
    <p id="prose-light">Prose sample</p>
  </div>
  <div class="markdown-source-view mod-cm6">
    <div class="cm-line HyperMD-codeblock"><span class="token keyword" id="kw-editor-light">def</span> hello()</div>
  </div>
</div>
<div class="theme-dark">
  <div class="markdown-rendered">
    <pre><code><span class="token keyword" id="kw-dark">def</span> hello()</code></pre>
    <pre><code id="str-dark">plainstring</code></pre>
  </div>
  <div class="markdown-source-view mod-cm6">
    <div class="cm-line HyperMD-codeblock"><span class="token keyword" id="kw-editor-dark">def</span> hello()</div>
  </div>
</div>
<script>
(function () {
  var plan = ${JSON.stringify(probes)};
  function register(name, node) {
    var range = new StaticRange({ startContainer: node, startOffset: 0, endContainer: node, endOffset: node.length });
    var highlight = CSS.highlights.get(name) || new Highlight();
    highlight.add(range);
    CSS.highlights.set(name, highlight);
    var dom = document.createRange();
    dom.setStart(node, 0);
    dom.setEnd(node, node.length);
    return dom.getBoundingClientRect();
  }
  window.__probes = plan.map(function (item) {
    var host = document.getElementById(item.target);
    var walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    var node = walker.nextNode();
    var rect = register(item.name, node);
    return {
      id: item.id,
      target: item.target,
      expected: item.expected,
      background: item.background,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      text: node.nodeValue
    };
  });
})();
</script>
</body>
</html>`;
}

function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aof-webkit-'));
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
    console.error('webkit probe produced no RESULT line');
    return 2;
  }

  const result = JSON.parse(line.slice('RESULT '.length));
  if (result.error) {
    console.error(`webkit probe error: ${result.error}`);
    return 2;
  }

  fs.mkdirSync(EVIDENCE, { recursive: true });
  if (fs.existsSync(shotPath)) fs.copyFileSync(shotPath, path.join(EVIDENCE, 'webkit-probe.png'));

  const plan = JSON.parse(JSON.stringify(result.probes || []));
  const failures = [];
  const rows = [];
  for (const probe of plan) {
    const actual = probe.ink?.hex || null;
    const expected = probe.expected;
    const delta = actual ? distance(actual, expected) : 999;
    const pass = Boolean(actual) && delta <= 60;
    if (!pass) {
      failures.push(`${probe.id}: rendered ${actual || 'no ink'} expected ${expected} (distance ${delta.toFixed(1)})`);
    }
    rows.push({ id: probe.id, expected, actual, delta: Number(delta.toFixed(1)), samples: probe.ink?.samples ?? 0, pass });
  }

  // `legacy-host-only-control` is part of `rows` and expects the native colour:
  // it passes only when the old host-only selector paints nothing, which is what
  // proves the measurement can see the difference this fix addresses.
  const report = {
    engine: 'WKWebView',
    userAgent: result.userAgent,
    scale: result.scale,
    size: result.size,
    pass: failures.length === 0,
    failures,
    checks: rows,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'webkit-highlight-results.json'), JSON.stringify(report, null, 2));
  fs.copyFileSync(pagePath, path.join(EVIDENCE, 'webkit-highlight-page.html'));

  for (const row of rows) {
    console.log(`${row.pass ? 'ok  ' : 'FAIL'} ${row.id.padEnd(26)} expected ${row.expected} actual ${row.actual} (d=${row.delta})`);
  }
  if (failures.length) {
    console.error(`\n${failures.length} failure(s)`);
    return 1;
  }
  console.log(`\nWebKit highlight rendering: ${rows.length}/${rows.length} checks passed`);
  return 0;
}

process.exit(run());
