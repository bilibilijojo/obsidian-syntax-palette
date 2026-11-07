/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

// A narrow macOS WKWebView layout fixture, not a mobile Obsidian test.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const css = fs.readFileSync(path.join(__dirname, '../plugin-src/styles.css'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syntax-palette-settings-'));
try {
  const page = path.join(tmp, 'page.html');
  const screenshot = path.join(tmp, 'settings.png');
  fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>
    :root { --font-monospace: monospace; --font-ui-small: 14px; --font-ui-smaller: 12px; }
    ${css}
  </style><body><script>
    const results = [];
    for (const width of [180, 240, 320]) {
      const root = document.createElement('div');
      root.className = 'aof-settings';
      root.style.width = width + 'px';
      root.innerHTML = '<div class="aof-preview"><div class="aof-preview-block"><pre class="aof-preview-code">a_long_code_line_that_needs_to_wrap_on_a_narrow_screen</pre></div><div class="aof-preview-block"><pre class="aof-preview-code">second preview</pre></div></div><textarea class="aof-diagnostics-output"></textarea>';
      document.body.appendChild(root);
      const grid = root.querySelector('.aof-preview');
      const textarea = root.querySelector('textarea');
      const overflow = Math.max(root.scrollWidth - root.clientWidth, grid.scrollWidth - grid.clientWidth, textarea.getBoundingClientRect().right - root.getBoundingClientRect().right);
      results.push({width, overflow, pass: overflow <= 1});
      root.remove();
    }
    window.__meta = {results, pass: results.every(result => result.pass)};
    window.__probes = [];
  </script>`);
  const result = spawnSync('swift', [path.join(__dirname, 'webkit-highlight-probe.swift'), page, screenshot], { encoding: 'utf8', timeout: 180000 });
  const line = (result.stdout || '').split('\n').find((item) => item.startsWith('RESULT '));
  if (!line) throw new Error(result.stderr || result.error || 'WebKit probe returned no result');
  const data = JSON.parse(line.slice(7));
  if (!data.meta?.pass || data.error) throw new Error(JSON.stringify(data));
  console.log('PASS: macOS WebKit settings preview and diagnostics fit widths 180, 240 and 320 CSS px');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
