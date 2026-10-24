/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

// Does WebKit repaint a custom highlight when the Highlight object registered
// under the same name is *replaced*?
//
// `refreshDecorations()` (the path that runs when the line-number switch is
// flipped) does exactly this for every block: it deletes every range, drops the
// palette from `CSS.highlights`, then re-registers a brand-new `Highlight`
// object under the same name. If WebKit caches the registration by name and
// never repaints the new object, the theme colours vanish on iOS until the app
// is restarted — which is what the field report describes.
//
// The page keeps four rows, each with its own highlight name:
//   control   – plain register, no further churn
//   replaced  – delete(name) then set(name, new Highlight())   ← what the plugin does
//   mutated   – highlight.clear() + highlight.add(range)       ← what it could do instead
//   setOver   – set(name, new Highlight()) without a delete
// A colourless row next to a coloured control is the regression.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'evidence/v0.4.4');

const BG = '#FFFFFF';
const NATIVE = '#24292F';
const COLOR = '#A626A4';

function rgb(hex) {
  const value = hex.replace('#', '');
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function distance(a, b) {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

const { selectorsFor } = require('../plugin-src/highlight-style.cjs');

function rule(name) {
  return `${selectorsFor('light', name).join(',\n')} { color: ${COLOR}; }`;
}

const NAMES = {
  control: 'aof-replace-control',
  replaced: 'aof-replace-replaced',
  mutated: 'aof-replace-mutated',
  setover: 'aof-replace-setover',
};

function buildPage() {
  const css = Object.values(NAMES).map(rule).join('\n');
  const row = (id, label) =>
    `<pre><code><span class="token keyword" id="${id}">def</span> ${label}</code></pre>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; }
  body { font: 15px/24px Menlo, monospace; }
  .theme-light { background: ${BG}; color: ${NATIVE}; padding: 12px; }
  pre { margin: 0 0 10px; }
  code { font: inherit; color: inherit; }
${css}
</style>
</head>
<body>
<div class="theme-light">
  <div class="markdown-rendered">
${row('row-control', 'control')}
${row('row-replaced', 'replaced')}
${row('row-mutated', 'mutated')}
${row('row-setover', 'setover')}
  </div>
</div>
<script>
(function () {
  try {
  function textNode(id) {
    var host = document.getElementById(id);
    var walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    return walker.nextNode();
  }
  function rangeFor(node) {
    return new StaticRange({ startContainer: node, startOffset: 0, endContainer: node, endOffset: node.length });
  }
  function rectOf(node) {
    var dom = document.createRange();
    dom.setStart(node, 0);
    dom.setEnd(node, node.length);
    return dom.getBoundingClientRect();
  }

  var plan = ${JSON.stringify(NAMES)};
  var nodes = {};
  Object.keys(plan).forEach(function (key) { nodes[key] = textNode('row-' + key); });

  // 1. Everything starts out registered, exactly like the plugin after render.
  Object.keys(plan).forEach(function (key) {
    var highlight = new Highlight();
    highlight.add(rangeFor(nodes[key]));
    CSS.highlights.set(plan[key], highlight);
  });

  // 2. control: leave it alone.

  // 3. replaced: what refreshDecorations() does today.
  CSS.highlights.delete(plan.replaced);
  var fresh = new Highlight();
  fresh.add(rangeFor(nodes.replaced));
  CSS.highlights.set(plan.replaced, fresh);

  // 4. mutated: clear + add on the same Highlight object.
  var existing = CSS.highlights.get(plan.mutated);
  if (existing) { existing.clear(); existing.add(rangeFor(nodes.mutated)); }

  // 5. setOver: set() a new Highlight without deleting first.
  var over = new Highlight();
  over.add(rangeFor(nodes.setover));
  CSS.highlights.set(plan.setover, over);

  window.__probes = Object.keys(plan).map(function (key) {
    var rect = rectOf(nodes[key]);
    return {
      id: key,
      target: 'row-' + key,
      expected: ${JSON.stringify(COLOR)},
      background: ${JSON.stringify(BG)},
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      text: nodes[key].nodeValue
    };
  });
  window.__registry = {
    keys: Array.from(CSS.highlights.keys()),
    sizes: Array.from(CSS.highlights.values()).map(function (v) { return v.size; })
  };
  } catch (error) {
    window.__meta = { error: String(error && error.message || error), stack: String(error && error.stack || '') };
    window.__probes = [];
  }
})();
</script>
</body>
</html>`;
}

function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aof-replace-'));
  const pagePath = path.join(tmp, 'page.html');
  const shotPath = path.join(tmp, 'page.png');
  fs.writeFileSync(pagePath, buildPage());

  const swift = spawnSync('swift', [path.join(__dirname, 'webkit-highlight-probe.swift'), pagePath, shotPath], {
    encoding: 'utf8',
    timeout: 180000,
  });
  if (swift.error) {
    console.error('webkit probe could not run: ' + swift.error.message);
    return 2;
  }
  const line = (swift.stdout || '').split('\n').find((item) => item.startsWith('RESULT '));
  if (!line) {
    console.error(swift.stdout || '');
    console.error(swift.stderr || '');
    return 2;
  }
  const result = JSON.parse(line.slice('RESULT '.length));
  if (result.meta) console.log('meta', JSON.stringify(result.meta));
  if (result.registry) console.log('registry', JSON.stringify(result.registry));
  if (result.error) {
    console.error('webkit probe error: ' + result.error);
    return 2;
  }
  if (!(result.probes || []).length) {
    console.error('no probes published');
    return 2;
  }

  fs.mkdirSync(EVIDENCE, { recursive: true });
  if (fs.existsSync(shotPath)) fs.copyFileSync(shotPath, path.join(EVIDENCE, 'webkit-replace-highlight.png'));

  const failures = [];
  const rows = [];
  for (const probe of result.probes || []) {
    const actual = probe.ink?.hex || null;
    const expected = probe.expected;
    const delta = actual ? distance(actual, expected) : 999;
    const ok = Boolean(actual) && delta <= 60;
    rows.push({ id: probe.id, expected, actual, delta: Number(delta.toFixed(1)), samples: probe.ink?.samples ?? 0, pass: ok });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${probe.id.padEnd(10)} expected ${expected} actual ${actual || 'no ink'} d=${delta.toFixed(1)} samples=${probe.ink?.samples ?? 0}`);
    if (!ok) failures.push(probe.id);
  }
  const summary = {
    at: new Date().toISOString(),
    purpose: 'Does WebKit repaint a custom highlight when the Highlight object under the same name is replaced?',
    rows,
    failures,
    pass: failures.length === 0,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'webkit-replace-highlight.json'), JSON.stringify(summary, null, 2) + '\n');
  if (failures.length) {
    console.log('WEBKIT HIGHLIGHT-REPLACE: ' + failures.join(', ') + ' lost their colour');
    return 1;
  }
  console.log('WEBKIT HIGHLIGHT-REPLACE PASSED');
  return 0;
}

process.exit(run());
