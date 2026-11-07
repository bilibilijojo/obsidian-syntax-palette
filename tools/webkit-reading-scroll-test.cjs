/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

// Pixel regression for code scrolling underneath fixed reading-mode numbers.
// macOS WKWebView is useful evidence, but is not an iPhone Obsidian test.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildLineNumberCss } = require('../plugin-src/line-number-style.cjs');

const out = path.resolve(process.env.AOF_EVIDENCE || 'evidence/v' + require('../package.json').version);
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syntax-palette-gutter-'));
try {
  const css = buildLineNumberCss({ enabled: true });
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 20px; font: 24px/32px monospace; background: white; }
    .markdown-rendered pre { margin: 0 0 24px; padding: 0; width: 300px; background: white; color: #df0000; font: inherit; }
    .markdown-rendered code { font: inherit; color: inherit; }
    :root { --text-faint: #777777; }
    ${css}
    /* Negative control reproduces the old scrollable padding. */
    .legacy.markdown-rendered pre.aof-ln-on > code { margin-left: 0; padding-left: calc(4px + 2ch + 10px); }
  </style>
  <div class="markdown-rendered legacy"><pre class="aof-ln-on" id="legacy" data-aof-ln="11" style="--aof-ln-digits:2;--aof-ln-top:0px;--aof-ln-lh:32px;--aof-ln-size:24px;--aof-ln-font:monospace"><code>${'M'.repeat(120)}</code></pre></div>
  <div class="markdown-rendered"><pre class="aof-ln-on" id="fixed" data-aof-ln="11" style="--aof-ln-digits:2;--aof-ln-top:0px;--aof-ln-lh:32px;--aof-ln-size:24px;--aof-ln-font:monospace"><code>${'M'.repeat(120)}</code></pre></div>
  <script>
    const probes = [], meta = {};
    for (const id of ['legacy', 'fixed']) {
      const pre = document.getElementById(id), code = pre.querySelector('code');
      code.scrollLeft = 48;
      const p = pre.getBoundingClientRect(), box = code.getBoundingClientRect();
      const width = parseFloat(getComputedStyle(pre, '::before').width);
      probes.push({id, left:p.left+4, top:p.top, width, height:32, background:'#FFFFFF'});
      meta[id] = {scroll:code.scrollLeft, codeLeft:box.left, gutterRight:p.left+4+width};
    }
    meta.pass = meta.legacy.scroll > 0 && meta.fixed.scroll > 0 && meta.fixed.codeLeft >= meta.fixed.gutterRight;
    window.__meta = meta; window.__probes = probes;
  </script>`;
  const page = path.join(tmp, 'page.html');
  fs.writeFileSync(page, html);
  const result = spawnSync('swift', [path.join(__dirname, 'webkit-highlight-probe.swift'), page, path.join(out, 'reading-scroll.png')], { encoding: 'utf8', timeout: 180000 });
  const line = (result.stdout || '').split('\n').find(item => item.startsWith('RESULT '));
  if (!line) throw new Error(result.stderr || result.error || 'WebKit probe returned no result');
  const data = JSON.parse(line.slice(7));
  fs.writeFileSync(path.join(out, 'reading-scroll-results.json'), JSON.stringify(data, null, 2) + '\n');
  const redExcess = (id) => {
    const hex = data.probes?.find(probe => probe.id === id)?.ink?.hex;
    if (!hex) return null;
    return parseInt(hex.slice(1, 3), 16) - parseInt(hex.slice(3, 5), 16);
  };
  const legacy = redExcess('legacy'), fixed = redExcess('fixed');
  if (!data.meta?.pass || legacy === null || fixed === null || legacy < 40 || fixed > 20) {
    throw new Error(`Gutter pixel check failed: legacy red excess ${legacy}, fixed ${fixed}; ${JSON.stringify(data.meta)}`);
  }
  console.log(`PASS: WebKit scrolled code stays outside the gutter (legacy red excess ${legacy}, fixed ${fixed})`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
