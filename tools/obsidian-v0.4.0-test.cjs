#!/usr/bin/env node
'use strict';

// Real Obsidian desktop acceptance harness, originally introduced in v0.4.0
// and extended through the current package version. It talks to an isolated
// Obsidian instance through the Chrome DevTools Protocol. The vault and profile
// are disposable copies; the user's vault, plugin install and settings are not
// modified.
//
// The v0.3.0 phases are kept intact and run first as a regression gate: 0.4.0
// must not change theme colors, backgrounds, brackets, editing scope, settings
// UI behavior or persistence. The v0.4.0 phases then cover line numbers, a
// narrow desktop-viewport regression and a cleanup/disable check.
//
// Prerequisites:
//   - /tmp/aof-v040-test is a vault containing the notes below.
//   - The built 0.4.0 plugin is installed in that vault.
//   - Obsidian is running with --remote-debugging-port=9333 and
//     --user-data-dir=/tmp/aof-v040-profile.
// See evidence/v0.4.0/README.md for the exact reproduction steps.
//
// Usage:
//   AOF_CDP_PORT=9333 AOF_TEST_VAULT=/tmp/aof-v040-test \
//     node tools/obsidian-v0.4.0-test.cjs [--phase=lineNumbersReading]
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const themeCatalog = require('../plugin-src/themes.cjs');
const { codeBlockTokens, allFencedBlocks } = require('../plugin-src/fences.cjs');
const { readingNumbering, blockNumberRows } = require('../plugin-src/line-numbers.cjs');
const expectations = require('../plugin-src/tests/fixtures/theme-expectations.json');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.AOF_CDP_PORT || 9333);
const VAULT = process.env.AOF_TEST_VAULT || '/tmp/aof-v040-test';
const PROFILE = process.env.AOF_OBSIDIAN_PROFILE || '/tmp/aof-v040-profile';
const OBSIDIAN_BIN = process.env.AOF_OBSIDIAN_BIN || '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const OBSIDIAN_VERSION = process.env.AOF_OBSIDIAN_VERSION || '1.14.5';
const EXPECTED_VERSION = require('../package.json').version;
const EVIDENCE = process.env.AOF_EVIDENCE
  ? path.resolve(ROOT, process.env.AOF_EVIDENCE)
  : path.join(ROOT, 'evidence', `v${EXPECTED_VERSION}`);
const NOTE = 'AOF v0.4 DOM Probe.md';
const NOTE_PATH = path.join(VAULT, NOTE);
const NUMBER_NOTE = 'AOF v0.4 Line Numbers.md';
const NUMBER_NOTE_PATH = path.join(VAULT, NUMBER_NOTE);
const STABILITY_NOTE = 'AOF v0.4 Highlight Stability.md';
const PLUGIN_ID = 'syntax-palette';
const DATA_PATH = path.join(VAULT, '.obsidian/plugins', PLUGIN_ID, 'data.json');
const phaseArg = process.argv.find((arg) => arg.startsWith('--phase='));
const ONLY_PHASE = phaseArg ? phaseArg.slice('--phase='.length) : null;

fs.mkdirSync(EVIDENCE, { recursive: true });

const backgrounds = Object.fromEntries(
  Object.entries(expectations.themes).map(([id, value]) => [id, value.background]),
);
const DESIRED = {
  light: 'github-light-default',
  dark: 'tokyo-night-storm',
  coloredBrackets: true,
  codeBlockBackground: true,
  lineNumbers: false,
  wrapCodeBlocks: false,
};
const NATIVE_OFF = {
  light: 'github-light-default',
  dark: 'catppuccin-mocha',
  coloredBrackets: false,
  codeBlockBackground: false,
  lineNumbers: false,
  wrapCodeBlocks: false,
};

class CdpPage {
  constructor(target) {
    this.target = target;
    this.ws = null;
    this.nextId = 0;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 10000);
      this.ws.onopen = () => { clearTimeout(timer); resolve(); };
      this.ws.onerror = (error) => { clearTimeout(timer); reject(error); };
    });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    };
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP timeout: ' + method));
      }, 300000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(description);
    }
    return result.result?.value;
  }

  async screenshot(file) {
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  }

  async screenshotBuffer() {
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(result.data, 'base64');
  }

  // Set a constrained desktop window size for responsive-layout regression.
  async setViewport(metrics) {
    return this.send('Emulation.setDeviceMetricsOverride', metrics);
  }

  async clearEmulation() {
    return this.send('Emulation.clearDeviceMetricsOverride');
  }

  close() {
    try { this.ws?.close(); } catch (error) { /* ignore */ }
  }
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Minimal PNG reader for Chromium screenshots (8-bit, non-interlaced). Pixel
// sampling is the only way to prove a token is painted in the theme colour:
// getComputedStyle(::highlight()) reports the declared rule, not the pixels.
function decodePng(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error('not a png');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const chunks = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      chunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!channels || bitDepth !== 8 || interlace !== 0) {
    throw new Error(`unsupported png: depth=${bitDepth} color=${colorType} interlace=${interlace}`);
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 255;
      else if (filter === 2) line[x] = (line[x] + b) & 255;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      } else if (filter !== 0) {
        throw new Error(`bad png filter ${filter}`);
      }
    }
    line.copy(out, y * stride);
    previous = line;
  }
  return { width, height, channels, data: out };
}

function parseRgb(value) {
  if (typeof value !== 'string') return null;
  const hex = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(value.trim());
  if (hex) {
    const raw = hex[1];
    return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(value.trim());
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

// Count pixels inside a CSS-pixel rect that sit within `tolerance` of the
// expected colour. Anti-aliased glyph edges are ignored on purpose: a painted
// token always contains solid core pixels.
function countColorInImage(image, expected, tolerance = 48) {
  let hits = 0;
  for (let index = 0; index < image.data.length; index += image.channels) {
    if (Math.abs(image.data[index] - expected[0]) <= tolerance &&
        Math.abs(image.data[index + 1] - expected[1]) <= tolerance &&
        Math.abs(image.data[index + 2] - expected[2]) <= tolerance) hits += 1;
  }
  return hits;
}

function countColorPixels(image, rect, expected, scale, tolerance = 48) {
  const x0 = Math.max(0, Math.floor(rect.left * scale));
  const y0 = Math.max(0, Math.floor(rect.top * scale));
  const x1 = Math.min(image.width, Math.ceil((rect.left + Math.max(rect.width, 1)) * scale));
  const y1 = Math.min(image.height, Math.ceil((rect.top + Math.max(rect.height, 1)) * scale));
  let hits = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const index = (y * image.width + x) * image.channels;
      const r = image.data[index];
      const g = image.data[index + 1];
      const b = image.data[index + 2];
      total += 1;
      if (Math.abs(r - expected[0]) <= tolerance && Math.abs(g - expected[1]) <= tolerance && Math.abs(b - expected[2]) <= tolerance) {
        hits += 1;
      }
    }
  }
  return { hits, total, x0, y0, x1, y1 };
}

async function listPages() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json`);
  return (await response.json()).filter((target) => target.type === 'page');
}

async function connectMain() {
  for (const target of await listPages()) {
    if (!target.url.includes('index.html')) continue;
    const page = new CdpPage(target);
    try {
      await page.connect();
      const isMain = await page.eval('Boolean(window.app?.workspace?.layoutReady && !document.querySelector(".aof-settings") && !document.querySelector(".aof-theme-modal"))');
      if (isMain) return page;
      page.close();
    } catch (error) {
      page.close();
    }
  }
  throw new Error('Obsidian main page not found');
}

async function findSettingsPage(timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const target of await listPages()) {
      const page = new CdpPage(target);
      try {
        await page.connect();
        const found = await page.eval('!!document.querySelector(".aof-settings")');
        if (found) return page;
        page.close();
      } catch (error) {
        page.close();
      }
    }
    await wait(300);
  }
  throw new Error('Plugin settings page not found');
}

async function findPageWith(expression, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const target of await listPages()) {
      const page = new CdpPage(target);
      try {
        await page.connect();
        if (await page.eval(expression)) return page;
        page.close();
      } catch (error) {
        page.close();
      }
    }
    await wait(300);
  }
  throw new Error('No page matched ' + expression);
}

function record(results, name, data) {
  results.phases[name] = { at: new Date().toISOString(), ...data };
  fs.writeFileSync(path.join(EVIDENCE, 'real-obsidian-results.json'), JSON.stringify(results, null, 2) + '\n');
}

async function setSettings(main, patch) {
  return main.eval(`(async () => {
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    if (!plugin) throw new Error('plugin missing');
    await plugin.updateSettings(${JSON.stringify(patch)});
    await new Promise((resolve) => setTimeout(resolve, 450));
    return plugin.settings;
  })()`);
}

async function readPluginState(main) {
  return main.eval(`(() => {
    const id = ${JSON.stringify(PLUGIN_ID)};
    const plugin = app.plugins.plugins[id];
    if (!plugin) return null;
    return {
      settings: plugin.settings,
      engine: plugin.engine.getState(),
      engineReady: plugin.engineReady,
      wasmSource: plugin.wasmSource,
      highlightSupported: plugin.highlightSupported,
      backgroundCss: plugin.backgroundStyle?.textContent || '',
      backgroundStyles: document.querySelectorAll('style#syntax-palette-background').length,
      lineNumberCss: plugin.lineNumberStyle?.textContent || '',
      lineNumberStyles: document.querySelectorAll('style#syntax-palette-line-numbers').length,
      wrapCss: plugin.wrapStyle?.textContent || '',
      wrapStyles: document.querySelectorAll('style#syntax-palette-wrap').length,
      readingNumberElements: plugin.readingNumberElements.size,
      highlightStyles: document.querySelectorAll('style#syntax-palette-highlight').length,
      editorViews: plugin.editorRanges.size,
      readingCodeBlocks: plugin.readingOriginals.size,
      readingBackgroundElements: plugin.readingBackgroundElements.size,
      highlightKeys: [...CSS.highlights.keys()].filter((key) => key.startsWith('aof-reading-')).length,
      bodyClass: document.body.className,
    };
  })()`);
}

async function setAppearance(main, appearance) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await main.eval(`document.body.classList.contains('theme-dark') ? 'dark' : 'light'`);
    if (current === appearance) return;
    await main.eval(`app.commands.executeCommandById('theme:toggle-light-dark');true`);
    await wait(650);
  }
  const actual = await main.eval(`document.body.classList.contains('theme-dark') ? 'dark' : 'light'`);
  if (actual !== appearance) throw new Error(`Could not switch Obsidian to ${appearance}`);
}

async function openSettings(main) {
  await main.eval(`(() => {
    if (app.setting?.open && app.setting?.openTabById) {
      app.setting.open();
      app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
      return true;
    }
    throw new Error('setting API missing');
  })()`);
  await wait(900);
  return findSettingsPage(10000);
}

async function closeSettings(main) {
  try {
    await main.eval(`(() => { app.setting?.close?.(); return true; })()`);
  } catch (error) { /* ignore */ }
  await wait(500);
}

async function launchIsolatedObsidian() {
  const logFd = fs.openSync('/tmp/aof-v040-obsidian.log', 'a');
  const child = require('node:child_process').spawn(OBSIDIAN_BIN, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--disable-software-rasterizer',
    // Keep deterministic test timers even when another native probe window
    // temporarily occludes this disposable Obsidian instance.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ], { detached: true, stdio: ['ignore', logFd, logFd] });
  child.unref();
  fs.closeSync(logFd);
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    try {
      const pages = await listPages();
      const target = pages.find((item) => item.url.includes('index.html'));
      if (target) {
        const candidate = new CdpPage(target);
        await candidate.connect();
        const ready = await candidate.eval('Boolean(window.app && window.app.workspace && window.app.workspace.layoutReady)');
        if (ready) {
          await candidate.send('Page.bringToFront');
          await candidate.send('Emulation.setFocusEmulationEnabled', {enabled:true});
          return candidate;
        }
        candidate.close();
      }
    } catch (error) {
      // wait for the new process to expose CDP
    }
    await wait(500);
  }
  throw new Error('Obsidian did not start with CDP');
}

async function killIsolatedObsidian() {
  let pids = [];
  try {
    pids = execFileSync('pgrep', ['-f', PROFILE], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number);
  } catch (error) {
    pids = [];
  }
  for (const pid of pids) {
    if (pid === process.pid) continue;
    try { process.kill(pid, 'SIGTERM'); } catch (error) { /* already gone */ }
  }
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      // Without a timeout a half-dead Obsidian can leave this fetch pending
      // forever, which wedges the whole run (observed: 44 minutes).
      await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(2000) });
      await wait(250);
    } catch (error) {
      return;
    }
  }
  for (const pid of pids) {
    try { process.kill(pid, 'SIGKILL'); } catch (error) { /* already gone */ }
  }
  await wait(1000);
}

// ---------------------------------------------------------------------------
// Page-side functions. These are serialized into the Obsidian renderer.
// ---------------------------------------------------------------------------

async function pagePrepare(args) {
  const { note, pluginId } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  if (!app.plugins.isEnabled()) await app.plugins.setEnable(true);
  await app.plugins.loadManifests();
  if (!app.plugins.plugins[pluginId]) await app.plugins.enablePlugin(pluginId);
  if (app.customCss?.setTheme && app.customCss.theme !== 'Minimal') {
    await app.customCss.setTheme('Minimal');
  }
  const file = app.vault.getAbstractFileByPath(note);
  if (!file) throw new Error('Test note not found: ' + note);
  let leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) {
    leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
  } else {
    await app.workspace.revealLeaf(leaf);
  }
  await wait(900);
  const view = leaf.view;
  const plugin = app.plugins.plugins[pluginId];
  return {
    pluginVersion: app.plugins.manifests[pluginId]?.version,
    appVersion: (() => {
      try {
        return app.appVersion || window.electron?.app?.getVersion?.() || null;
      } catch (error) {
        return null;
      }
    })(),
    documentTitle: document.title,
    electronVersion: (() => {
      const match = /Electron\/([\d.]+)/.exec(navigator.userAgent);
      return match ? match[1] : null;
    })(),
    pluginReady: Boolean(plugin?.engineReady),
    themeCount: Object.keys(plugin?.engine?.catalog?.THEMES || {}).length,
    familyCount: plugin?.engine?.catalog?.FAMILIES?.length,
    settings: plugin?.settings,
    file: view.file?.path,
    mode: view.getState().mode,
    source: view.getState().source,
    cssTheme: app.customCss?.theme,
    bodyClass: document.body.className,
    userAgent: navigator.userAgent,
    noteLength: view.editor?.getValue().length,
  };
}

async function pageSetPluginEnabled(args) {
  const { pluginId, enabled } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  if (enabled) {
    if (!app.plugins.isEnabled()) await app.plugins.setEnable(true);
    await app.plugins.loadManifests();
    if (!app.plugins.plugins[pluginId]) await app.plugins.enablePlugin(pluginId);
  } else if (app.plugins.plugins[pluginId]) {
    await app.plugins.disablePlugin(pluginId);
  }
  await wait(900);
  return Boolean(app.plugins.plugins[pluginId]);
}

// After a restart: did the saved line-number setting come back, and does the
// reading gutter still render from the vault adapter resources?
async function pageVerifyAfterRestart(args) {
  const { note, pluginId } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  if (!plugin) throw new Error('plugin missing after restart');
  const file = app.vault.getAbstractFileByPath(note);
  if (!file) throw new Error('note missing after restart: ' + note);
  let leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) {
    leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
  } else {
    await app.workspace.revealLeaf(leaf);
  }
  await wait(900);
  const view = leaf.view;
  await view.setState({ ...view.getState(), mode: 'preview', source: false }, {});
  await wait(1300);
  const root = view.contentEl.querySelector('.markdown-preview-view') || view.contentEl;
  const pres = [...root.querySelectorAll('pre.aof-ln-on')];
  return {
    settings: plugin.settings,
    engineReady: plugin.engineReady,
    wasmSource: plugin.wasmSource,
    highlightSupported: plugin.highlightSupported,
    numberedPres: pres.length,
    pres: root.querySelectorAll('pre').length,
    firstGutter: pres[0]?.getAttribute('data-aof-ln') || '',
    lineNumberCss: plugin.lineNumberStyle?.textContent.length || 0,
  };
}

async function pageStateSnapshot(args) {  const { note, pluginId } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  const leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) throw new Error('note not open');
  const view = leaf.view;
  await view.setState({ ...view.getState(), mode: 'source', source: false }, {});
  await wait(650);
  return {
    version: app.plugins.manifests[pluginId]?.version,
    settings: plugin?.settings || null,
    engine: plugin?.engine?.getState() || null,
    backgroundCss: plugin?.backgroundStyle?.textContent || '',
    backgroundStyles: document.querySelectorAll('style#syntax-palette-background').length,
    lineNumberCss: plugin?.lineNumberStyle?.textContent || '',
    lineNumberStyles: document.querySelectorAll('style#syntax-palette-line-numbers').length,
    lineNumberSpans: view.contentEl.querySelectorAll('.aof-ln, .cm-line[data-aof-n]').length,
    decoratedLines: view.contentEl.querySelectorAll('.aof-fenced-line').length,
    fencedBlocks: view.contentEl.querySelectorAll('.aof-fenced-block').length,
    cssHighlights: [...CSS.highlights.keys()].filter((key) => key.startsWith('aof-reading-')).length,
    bodyClass: document.body.className,
  };
}

async function pageThemeAccuracy(args) {
  const { note, pluginId, themes } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  const leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) throw new Error('Note not open: ' + note);
  const view = leaf.view;
  const cm = view.editor.cm;
  const initialSettings = { ...plugin.settings };
  const initialMode = view.getState();
  const initialAppearance = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
  await view.setState({ ...view.getState(), mode: 'source', source: false }, {});
  await wait(500);
  const text = view.editor.getValue();
  const lines = text.split('\n');
  const blocks = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const match = /^```(\S*)\s*$/.exec(lines[i]);
    if (!open && match) { open = { language: match[1] || '', start: i }; continue; }
    if (open && /^```\s*$/.test(lines[i])) {
      blocks.push({ ...open, end: i, contentStart: open.start + 1, contentEnd: i });
      open = null;
    }
  }
  const python = blocks.find((block) => block.language === 'python');
  if (!python) throw new Error('Python block not found');
  const blockText = lines.slice(python.contentStart, python.contentEnd).join('\n');
  function positionOf(needle) {
    const index = blockText.indexOf(needle);
    if (index < 0) throw new Error('Token not found: ' + needle);
    const before = blockText.slice(0, index).split('\n');
    const line = python.contentStart + before.length - 1;
    const ch = before[before.length - 1].length;
    return view.editor.posToOffset({ line, ch });
  }
  const probes = {
    comment: positionOf('# python comment'),
    keyword: positionOf('def'),
    string: positionOf('hello'),
    number: positionOf('42'),
  };
  function parseHex(hex) {
    const value = hex.replace('#', '');
    const alpha = value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1;
    return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16), alpha];
  }
  function parseComputed(value) {
    const match = /^rgba?\(([^)]+)\)$/.exec(value);
    if (!match) return null;
    const parts = match[1].split(',').map((part) => Number(part.trim()));
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  function sameColor(actual, expectedHex) {
    const a = parseComputed(actual);
    const b = parseHex(expectedHex);
    if (!a) return false;
    return Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1 &&
      Math.abs(a[2] - b[2]) <= 1 && Math.abs(a[3] - b[3]) <= 0.01;
  }
  function findEntry(position) {
    return (plugin.editorRanges.get(cm) || []).find((entry) => {
      try {
        const from = cm.posAtDOM(entry.range.startContainer, entry.range.startOffset);
        const to = cm.posAtDOM(entry.range.endContainer, entry.range.endOffset);
        return from <= position && to > position;
      } catch (error) {
        return false;
      }
    });
  }
  async function ensureAppearance(appearance) {
    const current = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
    if (current !== appearance) {
      app.commands.executeCommandById('theme:toggle-light-dark');
      await wait(550);
    }
    return document.body.classList.contains('theme-dark') ? 'dark' : 'light';
  }
  async function scrollPython() {
    view.editor.scrollIntoView({ from: { line: python.start + 1, ch: 0 }, to: { line: python.end - 1, ch: 0 } }, true);
    cm.measure();
    await wait(300);
  }
  const cases = [];
  try {
    for (const appearance of ['light', 'dark']) {
      const actualAppearance = await ensureAppearance(appearance);
      const ids = Object.keys(themes).filter((id) => themes[id].appearance === appearance);
      for (const themeId of ids) {
        const expected = themes[themeId];
        const light = appearance === 'light' ? themeId : 'atom-one-light';
        const dark = appearance === 'dark' ? themeId : 'atom-one-dark';
        await plugin.updateSettings({ light, dark, coloredBrackets: false, codeBlockBackground: true });
        await wait(260);
        await scrollPython();
        const checks = {};
        for (const [kind, position] of Object.entries(probes)) {
          const entry = findEntry(position);
          if (!entry) {
            checks[kind] = { pass: false, error: 'no range' };
            continue;
          }
          const lineElement = entry.range.startContainer.parentElement.closest('.cm-line');
          const actual = getComputedStyle(lineElement, '::highlight(' + entry.name + ')').color;
          checks[kind] = {
            pass: sameColor(actual, expected[kind]) && entry.palette[appearance].toUpperCase() === expected[kind].toUpperCase(),
            actual,
            expected: expected[kind],
            palette: entry.palette[appearance],
          };
        }
        const codeLine = [...view.contentEl.querySelectorAll('.cm-line.HyperMD-codeblock')]
          .find((line) => line.textContent.includes('# python comment'));
        const background = codeLine ? getComputedStyle(codeLine).backgroundColor : null;
        const backgroundPass = sameColor(background, expected.background);
        cases.push({
          themeId,
          appearance,
          actualAppearance,
          checks,
          background: { actual: background, expected: expected.background, pass: backgroundPass },
          engine: { light: plugin.engine.getState().light, dark: plugin.engine.getState().dark },
          pass: Object.values(checks).every((check) => check.pass) && backgroundPass,
        });
      }
    }
  } finally {
    await plugin.updateSettings(initialSettings);
    await ensureAppearance(initialAppearance);
    await view.setState(initialMode, {});
    await wait(300);
  }
  const failures = cases.filter((item) => !item.pass);
  return { pass: failures.length === 0, total: cases.length, failures, cases };
}

async function pageLifecycle(args) {
  const { note, pluginId, backgrounds } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let plugin = app.plugins.plugins[pluginId];
  const leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) throw new Error('Note not open: ' + note);
  const view = leaf.view;
  const text = view.editor.getValue();
  const lines = text.split('\n');
  const python = (() => {
    let open = null;
    for (let i = 0; i < lines.length; i++) {
      const match = /^```(\S*)\s*$/.exec(lines[i]);
      if (!open && match) { open = { language: match[1] || '', start: i }; continue; }
      if (open && /^```\s*$/.test(lines[i])) {
        if (open.language === 'python') return { ...open, end: i };
        open = null;
      }
    }
    return null;
  })();
  if (!python) throw new Error('Python block not found');

  function parseComputed(value) {
    const match = /^rgba?\(([^)]+)\)$/.exec(value);
    if (!match) return null;
    const parts = match[1].split(',').map((part) => Number(part.trim()));
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  function parseHex(hex) {
    const value = hex.replace('#', '');
    return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16), 1];
  }
  function sameColor(actual, expected) {
    const a = parseComputed(actual);
    const b = parseHex(expected);
    if (!a) return false;
    return Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1 && Math.abs(a[2] - b[2]) <= 1;
  }
  async function ensureAppearance(appearance) {
    const current = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
    if (current !== appearance) {
      app.commands.executeCommandById('theme:toggle-light-dark');
      await wait(600);
    }
    return document.body.classList.contains('theme-dark') ? 'dark' : 'light';
  }
  async function setMode(mode) {
    await view.setState({
      ...view.getState(),
      mode: mode === 'reading' ? 'preview' : 'source',
      source: mode === 'source',
    }, {});
    await wait(550);
  }
  async function revealPython() {
    if (view.getState().mode === 'preview') {
      let code = [...view.contentEl.querySelectorAll('pre > code.language-python')]
        .find((item) => item.textContent.includes('# python comment'));
      if (!code) {
        const scroller = view.contentEl.querySelector('.markdown-preview-view');
        for (let i = 0; i < 50 && !code; i++) {
          scroller.scrollTop += Math.max(400, scroller.clientHeight * 0.7);
          await wait(100);
          code = [...view.contentEl.querySelectorAll('pre > code.language-python')]
            .find((item) => item.textContent.includes('# python comment'));
        }
      }
      if (!code) throw new Error('Reading Python block not found');
      code.closest('pre').scrollIntoView({ block: 'center' });
      if (view.previewMode?.renderer?.onRender) view.previewMode.renderer.onRender();
      await wait(500);
      return code.closest('pre');
    }
    view.editor.scrollIntoView({ from: { line: python.start + 1, ch: 0 }, to: { line: python.end - 1, ch: 0 } }, true);
    view.editor.cm.measure();
    await wait(450);
    return null;
  }
  async function capture(mode) {
    await setMode(mode);
    const readingPre = await revealPython();
    if (mode === 'reading') {
      const code = readingPre.querySelector('code');
      const inline = [...view.contentEl.querySelectorAll('code:not(pre > code)')]
        .find((item) => item.textContent.includes('answer = 42'));
      const indented = [...view.contentEl.querySelectorAll('.markdown-preview-view pre')]
        .find((pre) => pre.textContent.includes('indented code block'));
      return {
        mode,
        appearance: document.body.classList.contains('theme-dark') ? 'dark' : 'light',
        pythonBackground: getComputedStyle(readingPre).backgroundColor,
        codeBackground: getComputedStyle(code).backgroundColor,
        inlineBackground: inline ? getComputedStyle(inline).backgroundColor : null,
        indentedBackground: indented ? getComputedStyle(indented).backgroundColor : null,
        fenced: readingPre.classList.contains('aof-fenced-block'),
        indentedFenced: indented ? indented.classList.contains('aof-fenced-block') : null,
        fencedClasses: view.contentEl.querySelectorAll('pre.aof-fenced-block').length,
        backgroundStyles: document.querySelectorAll('style#syntax-palette-background').length,
        backgroundCss: app.plugins.plugins[pluginId]?.backgroundStyle?.textContent || '',
      };
    }
    const commentLine = [...view.contentEl.querySelectorAll('.cm-line.HyperMD-codeblock')]
      .find((line) => line.textContent.includes('# python comment'));
    const returnLine = [...view.contentEl.querySelectorAll('.cm-line.HyperMD-codeblock')]
      .find((line) => line.textContent.includes('return "hello'));
    let emptyLine = returnLine?.nextElementSibling;
    if (emptyLine && !emptyLine.classList.contains('HyperMD-codeblock')) emptyLine = null;
    return {
      mode,
      appearance: document.body.classList.contains('theme-dark') ? 'dark' : 'light',
      pythonBackground: commentLine ? getComputedStyle(commentLine).backgroundColor : null,
      emptyLineBackground: emptyLine ? getComputedStyle(emptyLine).backgroundColor : null,
      fencedLine: Boolean(commentLine?.classList.contains('aof-fenced-line')),
      decoratedLines: view.contentEl.querySelectorAll('.aof-fenced-line').length,
      backgroundStyles: document.querySelectorAll('style#syntax-palette-background').length,
      backgroundCss: app.plugins.plugins[pluginId]?.backgroundStyle?.textContent || '',
    };
  }
  async function captureModes(label) {
    const out = { label, modes: {} };
    for (const mode of ['live', 'source', 'reading']) out.modes[mode] = await capture(mode);
    return out;
  }

  const pair = { light: 'github-light-default', dark: 'tokyo-night-storm' };
  const out = { sequence: {}, checks: {} };
  const initialMode = view.getState();
  try {
    await ensureAppearance('light');
    await plugin.updateSettings({ ...pair, coloredBrackets: true, codeBlockBackground: false });
    await wait(500);
    out.sequence.offLight = await captureModes('light/off');
    await plugin.updateSettings({ codeBlockBackground: true });
    await wait(500);
    out.sequence.onLight = await captureModes('light/on');

    await ensureAppearance('dark');
    out.sequence.onDark = await captureModes('dark/on');
    await plugin.updateSettings({ dark: 'kanagawa-dragon' });
    await wait(500);
    out.sequence.newDark = await captureModes('dark/changed');

    await ensureAppearance('light');
    out.sequence.backLight = await captureModes('light/back');
    await plugin.updateSettings({ light: 'solarized-light' });
    await wait(500);
    out.sequence.newLight = await captureModes('light/changed');

    await plugin.updateSettings({ codeBlockBackground: false });
    await wait(500);
    out.sequence.offAgain = await captureModes('light/off-again');

    await plugin.updateSettings({ ...pair, codeBlockBackground: true });
    await wait(500);
    await app.plugins.disablePlugin(pluginId);
    await wait(800);
    out.sequence.disabled = await captureModes('light/disabled');
    out.checks.disabledStyles = {
      backgroundStyles: document.querySelectorAll('style#syntax-palette-background').length,
      highlightStyles: document.querySelectorAll('style#syntax-palette-highlight').length,
      fencedClasses: view.contentEl.querySelectorAll('.aof-fenced-block').length,
      decoratedLines: view.contentEl.querySelectorAll('.aof-fenced-line').length,
      highlights: [...CSS.highlights.keys()].filter((key) => key.startsWith('aof-reading-')).length,
    };
    await app.plugins.enablePlugin(pluginId);
    await wait(1400);
    plugin = app.plugins.plugins[pluginId];
    if (!plugin) throw new Error('Plugin did not re-enable');
    await ensureAppearance('light');
    out.sequence.reenabled = await captureModes('light/reenabled');
  } finally {
    if (!app.plugins.plugins[pluginId]) {
      try { await app.plugins.enablePlugin(pluginId); } catch (error) { /* ignore */ }
      await wait(1000);
    }
    const current = app.plugins.plugins[pluginId];
    if (current) await current.updateSettings({ ...pair, coloredBrackets: true, codeBlockBackground: true });
    await ensureAppearance('light');
    if (view.getState().mode !== initialMode.mode || view.getState().source !== initialMode.source) {
      await view.setState(initialMode, {});
    }
    await wait(300);
  }

  const bgLight = backgrounds[pair.light];
  const bgDark = backgrounds[pair.dark];
  const bgDragon = backgrounds['kanagawa-dragon'];
  const bgSolarized = backgrounds['solarized-light'];
  const nativeLight = {
    live: out.sequence.offLight.modes.live.pythonBackground,
    source: out.sequence.offLight.modes.source.pythonBackground,
    reading: out.sequence.offLight.modes.reading.pythonBackground,
  };
  function expectedFor(step, mode) {
    if (step === 'offLight' || step === 'offAgain' || step === 'disabled') return nativeLight[mode];
    if (step === 'onLight' || step === 'backLight' || step === 'reenabled') return bgLight;
    if (step === 'onDark') return bgDark;
    if (step === 'newDark') return bgDragon;
    if (step === 'newLight') return bgSolarized;
    return null;
  }
  const offSteps = new Set(['offLight', 'offAgain', 'disabled']);
  for (const [step, value] of Object.entries(out.sequence)) {
    for (const [mode, item] of Object.entries(value.modes)) {
      const expected = expectedFor(step, mode);
      const pass = step === 'disabled'
        ? item.backgroundStyles === 0
        : offSteps.has(step)
          ? item.pythonBackground === expected
          : sameColor(item.pythonBackground, expected);
      out.checks[`${step}:${mode}`] = {
        expected,
        actual: item.pythonBackground,
        pass,
      };
    }
  }
  const indentedOff = out.sequence.offLight.modes.reading.indentedBackground;
  const indentedOn = out.sequence.onLight.modes.reading.indentedBackground;
  const indentedFenced = out.sequence.onLight.modes.reading.indentedFenced;
  out.checks.inlineIndented = {
    offLightInline: out.sequence.offLight.modes.reading.inlineBackground,
    onLightInline: out.sequence.onLight.modes.reading.inlineBackground,
    offLightIndented: indentedOff,
    onLightIndented: indentedOn,
    indentedFenced,
    pass: out.sequence.offLight.modes.reading.inlineBackground === out.sequence.onLight.modes.reading.inlineBackground &&
      (indentedOff === null || (indentedOff === indentedOn && indentedFenced === false)),
  };
  out.checks.disabledRestored = {
    ...out.checks.disabledStyles,
    pass: out.checks.disabledStyles.backgroundStyles === 0 &&
      out.checks.disabledStyles.highlightStyles === 0 &&
      out.checks.disabledStyles.fencedClasses === 0 &&
      out.checks.disabledStyles.decoratedLines === 0 &&
      out.checks.disabledStyles.highlights === 0,
  };
  out.checks.reenabledRestored = {
    light: out.sequence.reenabled.modes.live.pythonBackground,
    reading: out.sequence.reenabled.modes.reading.pythonBackground,
    fencedClasses: out.sequence.reenabled.modes.reading.fencedClasses,
    pass: sameColor(out.sequence.reenabled.modes.live.pythonBackground, bgLight) &&
      sameColor(out.sequence.reenabled.modes.reading.pythonBackground, bgLight) &&
      out.sequence.reenabled.modes.reading.fencedClasses > 0,
  };
  out.checks.stepBackgrounds = Object.entries(out.checks)
    .filter(([key]) => key.includes(':') && !key.startsWith('disabled:'))
    .every(([, value]) => value.pass);
  out.pass = out.checks.stepBackgrounds && out.checks.inlineIndented.pass &&
    out.checks.disabledRestored.pass && out.checks.reenabledRestored.pass;
  return out;
}

async function pageScopeIntegrity(args) {
  const { note, pluginId, backgrounds, expectedFencedBlocks, restoreSettings } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  let leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) {
    const file = app.vault.getAbstractFileByPath(note);
    if (!file) throw new Error('Note missing: ' + note);
    leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    await app.workspace.revealLeaf(leaf);
    await wait(500);
  }
  const view = leaf.view;
  const noteBefore = await app.vault.read(view.file);
  const initialMode = view.getState();
  const pair = { light: 'github-light-default', dark: 'tokyo-night-storm' };
  const bg = backgrounds[pair.light];
  const PROPS = [
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
    'background-image', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-top-color', 'border-radius', 'padding-top', 'padding-right', 'padding-bottom',
    'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'box-shadow', 'white-space',
    'color', 'text-decoration-line', 'display', 'overflow-x', 'overflow-y',
  ];
  function props(element) {
    // Resolve layout before sampling used auto margins. CM may have just
    // resized its content container; mixing pre-layout style values with a
    // subsequently measured rect produces an internally inconsistent sample.
    element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return Object.fromEntries(PROPS.map((name) => {
      // Chromium can report 0px or the used centering distance for the same
      // authored `auto` margin on these native scrollports. Pin the computed
      // CSS value with Typed OM and separately require identical physical
      // rects below; do not discard margin assertions or geometry checks.
      const computed = name.startsWith('margin-') ? element.computedStyleMap?.().get(name)?.toString() : null;
      return [name, computed === 'auto' ? 'auto' : style.getPropertyValue(name)];
    }));
  }
  function rect(element) {
    const value = element.getBoundingClientRect();
    return [value.x, value.y, value.width, value.height].map((n) => Math.round(n * 100) / 100);
  }
  function parseComputed(value) {
    const match = /^rgba?\(([^)]+)\)$/.exec(value);
    if (!match) return null;
    const parts = match[1].split(',').map((part) => Number(part.trim()));
    return parts.slice(0, 3).join(',');
  }
  function parseHex(hex) {
    const value = hex.replace('#', '');
    return `${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(value.slice(4, 6), 16)}`;
  }
  async function ensureAppearance(appearance) {
    const current = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
    if (current !== appearance) {
      app.commands.executeCommandById('theme:toggle-light-dark');
      await wait(600);
    }
  }
  async function setMode(mode) {
    await view.setState({
      ...view.getState(),
      mode: mode === 'reading' ? 'preview' : 'source',
      source: mode === 'source',
    }, {});
    await wait(550);
  }
  async function revealPython() {
    if (view.getState().mode === 'preview') {
      let code = [...view.contentEl.querySelectorAll('pre > code.language-python')]
        .find((item) => item.textContent.includes('# python comment'));
      if (!code) {
        const scroller = view.contentEl.querySelector('.markdown-preview-view');
        for (let i = 0; i < 50 && !code; i++) {
          scroller.scrollTop += Math.max(400, scroller.clientHeight * 0.7);
          await wait(100);
          code = [...view.contentEl.querySelectorAll('pre > code.language-python')]
            .find((item) => item.textContent.includes('# python comment'));
        }
      }
      if (!code) throw new Error('Reading Python block not found');
      code.closest('pre').scrollIntoView({ block: 'center' });
      if (view.previewMode?.renderer?.onRender) view.previewMode.renderer.onRender();
      await wait(500);
    } else {
      const text = view.editor.getValue();
      const line = text.split('\n').findIndex((value) => value.includes('# python comment'));
      view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line: line + 5, ch: 0 } }, true);
      view.editor.cm.measure();
      await wait(450);
    }
  }
  async function liveSnapshot() {
    await setMode('live');
    await revealPython();
    const commentLine = [...view.contentEl.querySelectorAll('.cm-line.HyperMD-codeblock')]
      .find((line) => line.textContent.includes('# python comment'));
    if (!commentLine) throw new Error('Live code line missing');
    const returnLine = [...view.contentEl.querySelectorAll('.cm-line.HyperMD-codeblock')]
      .find((line) => line.textContent.includes('return "hello'));
    let emptyLine = returnLine?.nextElementSibling;
    if (emptyLine && !emptyLine.classList.contains('HyperMD-codeblock')) emptyLine = null;
    const inlineLine = [...view.contentEl.querySelectorAll('.cm-line')]
      .find((line) => line.textContent.includes('Inline code'));
    const paragraph = [...view.contentEl.querySelectorAll('.cm-line')]
      .find((line) => line.textContent.includes('Paragraph before'));
    return {
      code: { props: props(commentLine), rect: rect(commentLine), bg: getComputedStyle(commentLine).backgroundColor, fenced: commentLine.classList.contains('aof-fenced-line'), diagnostics: {classes:commentLine.className,style:commentLine.getAttribute('style'),parent:commentLine.parentElement.className,wrap:plugin.settings.wrapCodeBlocks,numbers:plugin.settings.lineNumbers,position:getComputedStyle(commentLine).position,resolvedMarginLeft:getComputedStyle(commentLine).marginLeft,computedMarginLeft:commentLine.computedStyleMap?.().get('margin-left')?.toString()} },
      empty: emptyLine ? { props: props(emptyLine), rect: rect(emptyLine), bg: getComputedStyle(emptyLine).backgroundColor, fenced: emptyLine.classList.contains('aof-fenced-line') } : null,
      inlineParent: inlineLine ? { props: props(inlineLine), rect: rect(inlineLine), bg: getComputedStyle(inlineLine).backgroundColor, fenced: inlineLine.classList.contains('aof-fenced-line') } : null,
      paragraph: paragraph ? { props: props(paragraph), rect: rect(paragraph), bg: getComputedStyle(paragraph).backgroundColor, fenced: paragraph.classList.contains('aof-fenced-line') } : null,
      decoratedLines: view.contentEl.querySelectorAll('.aof-fenced-line').length,
      html: view.contentEl.querySelector('.markdown-source-view').innerHTML.length,
      noteText: view.editor.getValue(),
    };
  }
  async function readingSnapshot() {
    await setMode('reading');
    await revealPython();
    let code = [...view.contentEl.querySelectorAll('pre > code.language-python')]
      .find((item) => item.textContent.includes('# python comment'));
    if (!code) throw new Error('Reading code missing');
    const pre = code.closest('pre');
    const inline = [...view.contentEl.querySelectorAll('code:not(pre > code)')]
      .find((item) => item.textContent.includes('answer = 42'));
    const indentedPre = [...view.contentEl.querySelectorAll('.markdown-preview-view pre')]
      .find((item) => item.textContent.includes('indented code block'));
    const prose = [...view.contentEl.querySelectorAll('.markdown-preview-view p')]
      .find((item) => item.textContent.includes('Paragraph before'));
    const pres = [...view.contentEl.querySelectorAll('.markdown-preview-view pre')];
    return {
      pre: { props: props(pre), rect: rect(pre), bg: getComputedStyle(pre).backgroundColor, fenced: pre.classList.contains('aof-fenced-block') },
      code: { props: props(code), bg: getComputedStyle(code).backgroundColor },
      inline: inline ? { props: props(inline), bg: getComputedStyle(inline).backgroundColor } : null,
      indented: indentedPre ? { props: props(indentedPre), bg: getComputedStyle(indentedPre).backgroundColor, fenced: indentedPre.classList.contains('aof-fenced-block') } : null,
      prose: prose ? { props: props(prose), bg: getComputedStyle(prose).backgroundColor } : null,
      fencedPres: pres.filter((item) => item.classList.contains('aof-fenced-block')).length,
      totalPres: pres.length,
      classes: plugin.readingBackgroundElements.size,
      cssRules: plugin.backgroundStyle?.sheet ? [...plugin.backgroundStyle.sheet.cssRules].map((rule) => ({
        selector: rule.selectorText,
        properties: Array.from({ length: rule.style.length }, (_, i) => rule.style[i]),
        value: rule.style.getPropertyValue('background-color'),
        important: rule.style.getPropertyPriority('background-color'),
      })) : [],
    };
  }
  async function readingBottomSnapshot() {
    await setMode('reading');
    const scroller = view.contentEl.querySelector('.markdown-preview-view');
    if (!scroller) throw new Error('Reading scroller missing');
    scroller.scrollTop = scroller.scrollHeight;
    if (view.previewMode?.renderer?.onRender) view.previewMode.renderer.onRender();
    await wait(900);
    const pres = [...view.contentEl.querySelectorAll('.markdown-preview-view pre')];
    const indentedPre = pres.find((item) => item.textContent.includes('indented code block'));
    const longPre = pres.find((item) => item.textContent.includes('// long block end'));
    return {
      renderedPres: pres.length,
      indented: indentedPre ? {
        props: props(indentedPre),
        bg: getComputedStyle(indentedPre).backgroundColor,
        fenced: indentedPre.classList.contains('aof-fenced-block'),
      } : null,
      long: longPre ? {
        bg: getComputedStyle(longPre).backgroundColor,
        fenced: longPre.classList.contains('aof-fenced-block'),
        codeBg: getComputedStyle(longPre.querySelector('code')).backgroundColor,
      } : null,
    };
  }

  function diffProps(a, b) {
    const differences = [];
    for (const key of Object.keys(a)) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) differences.push({ key, before: a[key], after: b[key] });
    }
    return differences;
  }
  function compareExceptBackground(before, after) {
    const result = { styleDiffs: [], geometry: true, backgroundChanged: before.bg !== after.bg };
    const beforeProps = { ...before.props };
    const afterProps = { ...after.props };
    delete beforeProps['background-color'];
    delete afterProps['background-color'];
    result.styleDiffs = diffProps(beforeProps, afterProps);
    result.geometry = JSON.stringify(before.rect) === JSON.stringify(after.rect);
    return result;
  }
  const out = { pass: false };
  try {
    await ensureAppearance('light');
    await plugin.updateSettings({ ...pair, coloredBrackets: true, codeBlockBackground: false });
    await wait(450);
    const liveOff = await liveSnapshot();
    const readingOff = await readingSnapshot();
    const readingBottomOff = await readingBottomSnapshot();
    await plugin.updateSettings({ codeBlockBackground: true });
    await wait(550);
    const liveOn = await liveSnapshot();
    const readingOn = await readingSnapshot();
    const readingBottomOn = await readingBottomSnapshot();
    out.live = {
      code: {...compareExceptBackground(liveOff.code, liveOn.code), snapshots:{off:liveOff.code,on:liveOn.code}},
      empty: liveOff.empty && liveOn.empty ? compareExceptBackground(liveOff.empty, liveOn.empty) : null,
      inlineParent: liveOff.inlineParent && liveOn.inlineParent ? compareExceptBackground(liveOff.inlineParent, liveOn.inlineParent) : null,
      paragraph: liveOff.paragraph && liveOn.paragraph ? compareExceptBackground(liveOff.paragraph, liveOn.paragraph) : null,
      fenced: { off: liveOff.code.fenced, on: liveOn.code.fenced },
      emptyFenced: { off: liveOff.empty?.fenced, on: liveOn.empty?.fenced },
      inlineUntouched: liveOff.inlineParent?.bg === liveOn.inlineParent?.bg && liveOn.inlineParent?.fenced === false,
      paragraphUntouched: liveOff.paragraph?.bg === liveOn.paragraph?.bg && liveOn.paragraph?.fenced === false,
      backgrounds: { off: liveOff.code.bg, on: liveOn.code.bg },
      emptyBackgrounds: { off: liveOff.empty?.bg, on: liveOn.empty?.bg },
      noteUnchanged: liveOff.noteText === noteBefore,
      expected: bg,
    };
    out.reading = {
      pre: compareExceptBackground(readingOff.pre, readingOn.pre),
      code: {
        styleDiffs: diffProps({ ...readingOff.code.props }, { ...readingOn.code.props }),
      },
      inline: readingOff.inline && readingOn.inline ? {
        styleDiffs: diffProps(readingOff.inline.props, readingOn.inline.props),
        beforeBg: readingOff.inline.bg,
        afterBg: readingOn.inline.bg,
        unchanged: readingOff.inline.bg === readingOn.inline.bg && JSON.stringify(readingOff.inline.props) === JSON.stringify(readingOn.inline.props),
      } : null,
      indented: readingOff.indented && readingOn.indented ? {
        styleDiffs: diffProps(readingOff.indented.props, readingOn.indented.props),
        beforeBg: readingOff.indented.bg,
        afterBg: readingOn.indented.bg,
        fenced: readingOn.indented.fenced,
        unchanged: readingOff.indented.bg === readingOn.indented.bg && JSON.stringify(readingOff.indented.props) === JSON.stringify(readingOn.indented.props),
      } : null,
      prose: readingOff.prose && readingOn.prose ? {
        styleDiffs: diffProps(readingOff.prose.props, readingOn.prose.props),
        beforeBg: readingOff.prose.bg,
        afterBg: readingOn.prose.bg,
        unchanged: readingOff.prose.bg === readingOn.prose.bg && JSON.stringify(readingOff.prose.props) === JSON.stringify(readingOn.prose.props),
      } : null,
      backgrounds: { off: readingOff.pre.bg, on: readingOn.pre.bg, expected: bg },
      codeBackgrounds: { off: readingOff.code.bg, on: readingOn.code.bg },
      fencedClasses: { off: readingOff.fencedPres, on: readingOn.fencedPres, expected: expectedFencedBlocks, totalPres: readingOn.totalPres },
      indentedClass: readingOn.indented?.fenced,
      cssRules: readingOn.cssRules,
      bottom: {
        off: readingBottomOff,
        on: readingBottomOn,
        indentedUnchanged: Boolean(readingBottomOff.indented && readingBottomOn.indented &&
          readingBottomOff.indented.bg === readingBottomOn.indented.bg &&
          readingBottomOff.indented.fenced === false && readingBottomOn.indented.fenced === false &&
          JSON.stringify(readingBottomOff.indented.props) === JSON.stringify(readingBottomOn.indented.props)),
        longFenced: readingBottomOn.long?.fenced === true,
        longBackground: readingBottomOn.long?.bg || null,
      },
      noteUnchanged: noteBefore === await app.vault.read(view.file),
    };
    const backgroundRulesOkay = readingOn.cssRules.length > 0 && readingOn.cssRules.every((rule) => (
      rule.properties.length === 1 && rule.properties[0] === 'background-color'
    ));
    out.pass = Boolean(out.live.code.styleDiffs.length === 0 && out.live.code.geometry &&
      out.live.empty && out.live.empty.styleDiffs.length === 0 && out.live.empty.geometry &&
      out.live.inlineParent && out.live.inlineParent.styleDiffs.length === 0 &&
      out.live.paragraph && out.live.paragraph.styleDiffs.length === 0 &&
      out.live.fenced.off === false && out.live.fenced.on === true &&
      out.live.emptyFenced.off === false && out.live.emptyFenced.on === true &&
      out.live.inlineUntouched && out.live.paragraphUntouched &&
      parseComputed(out.live.backgrounds.on) === parseHex(bg) &&
      parseComputed(out.live.emptyBackgrounds.on) === parseHex(bg) &&
      out.reading.pre.styleDiffs.length === 0 && out.reading.pre.geometry &&
      out.reading.code.styleDiffs.length === 0 &&
      out.reading.inline?.unchanged && out.reading.prose?.unchanged &&
      out.reading.fencedClasses.on === out.reading.fencedClasses.expected &&
      parseComputed(out.reading.backgrounds.on) === parseHex(bg) &&
      parseComputed(out.reading.codeBackgrounds.on) === parseHex(bg) &&
      out.reading.bottom.indentedUnchanged && out.reading.bottom.longFenced &&
      parseComputed(out.reading.bottom.longBackground) === parseHex(bg) &&
      backgroundRulesOkay && out.live.noteUnchanged && out.reading.noteUnchanged);
  } finally {
    if (app.plugins.plugins[pluginId]) {
      await app.plugins.plugins[pluginId].updateSettings({ ...restoreSettings });
    }
    await ensureAppearance('light');
    await view.setState(initialMode, {});
    await wait(300);
  }
  return out;
}

async function pagePrepareScreenshot(args) {
  const { note, mode, appearance } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins['syntax-palette'];
  const leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) throw new Error('note leaf missing');
  await app.workspace.revealLeaf(leaf);
  const view = leaf.view;
  await view.setState({
    ...view.getState(),
    mode: mode === 'reading' ? 'preview' : 'source',
    source: mode === 'source',
  }, {});
  await wait(650);
  const current = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
  if (current !== appearance) {
    app.commands.executeCommandById('theme:toggle-light-dark');
    await wait(650);
  }
  if (mode === 'reading') {
    let code = [...view.contentEl.querySelectorAll('pre > code.language-python')]
      .find((item) => item.textContent.includes('# python comment'));
    if (!code) {
      const scroller = view.contentEl.querySelector('.markdown-preview-view');
      for (let i = 0; i < 50 && !code; i++) {
        scroller.scrollTop += Math.max(400, scroller.clientHeight * 0.7);
        await wait(110);
        code = [...view.contentEl.querySelectorAll('pre > code.language-python')]
          .find((item) => item.textContent.includes('# python comment'));
      }
    }
    if (!code) throw new Error('Reading Python block not found');
    code.closest('pre').scrollIntoView({ block: 'center' });
    if (view.previewMode?.renderer?.onRender) view.previewMode.renderer.onRender();
  } else {
    const text = view.editor.getValue();
    const line = text.split('\n').findIndex((value) => value.includes('# python comment'));
    view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line: line + 5, ch: 0 } }, true);
    view.editor.cm.measure();
  }
  await wait(600);
  return {
    mode,
    appearance: document.body.classList.contains('theme-dark') ? 'dark' : 'light',
    background: plugin?.backgroundStyle?.textContent || '',
  };
}

async function pageAfterRestart(args) {
  const { note, pluginId, backgrounds, settings } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !app.plugins.plugins[pluginId]) await wait(300);
  if (!app.plugins.plugins[pluginId]) throw new Error('Plugin did not load after restart');
  const plugin = app.plugins.plugins[pluginId];
  const file = app.vault.getAbstractFileByPath(note);
  if (!file) throw new Error('Note missing after restart');
  if (app.customCss?.setTheme && app.customCss.theme !== 'Minimal') await app.customCss.setTheme('Minimal');
  let leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) {
    leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
  } else {
    await app.workspace.revealLeaf(leaf);
  }
  await wait(900);
  const view = leaf.view;
  const initialMode = view.getState();
  const current = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
  if (current !== 'light') {
    app.commands.executeCommandById('theme:toggle-light-dark');
    await wait(650);
  }
  async function setMode(mode) {
    await view.setState({
      ...view.getState(),
      mode: mode === 'reading' ? 'preview' : 'source',
      source: mode === 'source',
    }, {});
    await wait(550);
  }
  async function capture(mode) {
    await setMode(mode);
    if (mode === 'reading') {
      const findCode = () => [...view.contentEl.querySelectorAll('pre > code.language-python')]
        .find((item) => item.textContent.includes('# python comment'));
      let code = findCode();
      for (let i = 0; i < 60 && !code; i++) {
        if (i === 12 || i === 36) {
          // The preview pane can still be empty this early after a restart, and
          // scrolling an empty pane finds nothing. Re-ask for a render instead
          // of failing on a timing race (the full-run flake).
          await setMode('reading');
          if (view.previewMode?.renderer?.onRender) view.previewMode.renderer.onRender();
          await wait(400);
        }
        const scroller = view.contentEl.querySelector('.markdown-preview-view');
        if (scroller) scroller.scrollTop += 500;
        await wait(100);
        code = findCode();
      }
      if (!code) {
        throw new Error('Reading block missing after restart: ' + JSON.stringify({
          mode: view.getState().mode,
          previewPanes: view.contentEl.querySelectorAll('.markdown-preview-view').length,
          preCount: view.contentEl.querySelectorAll('pre').length,
          bodyClass: document.body.className,
        }));
      }
      code.closest('pre').scrollIntoView({ block: 'center' });
      if (view.previewMode?.renderer?.onRender) view.previewMode.renderer.onRender();
      await wait(500);
      const pre = code.closest('pre');
      return {
        background: getComputedStyle(pre).backgroundColor,
        codeBackground: getComputedStyle(code).backgroundColor,
        fenced: pre.classList.contains('aof-fenced-block'),
        fencedPres: view.contentEl.querySelectorAll('pre.aof-fenced-block').length,
      };
    }
    const text = view.editor.getValue();
    const line = text.split('\n').findIndex((value) => value.includes('# python comment'));
    view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line: line + 5, ch: 0 } }, true);
    view.editor.cm.measure();
    await wait(500);
    const codeLine = [...view.contentEl.querySelectorAll('.cm-line.HyperMD-codeblock')]
      .find((item) => item.textContent.includes('# python comment'));
    return {
      background: codeLine ? getComputedStyle(codeLine).backgroundColor : null,
      fenced: Boolean(codeLine?.classList.contains('aof-fenced-line')),
      decorated: view.contentEl.querySelectorAll('.aof-fenced-line').length,
    };
  }
  function parseComputed(value) {
    const match = /^rgba?\(([^)]+)\)$/.exec(value || '');
    if (!match) return null;
    const parts = match[1].split(',').map((part) => Number(part.trim()));
    return parts.slice(0, 3).join(',');
  }
  function parseHex(hex) {
    const value = hex.replace('#', '');
    return `${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(value.slice(4, 6), 16)}`;
  }
  const out = { settings: plugin.settings, engineReady: plugin.engineReady, light: {}, dark: {} };
  try {
    out.light.live = await capture('live');
    out.light.reading = await capture('reading');
    out.light.pass = parseComputed(out.light.live.background) === parseHex(backgrounds[settings.light]) &&
      parseComputed(out.light.reading.background) === parseHex(backgrounds[settings.light]) &&
      out.light.reading.fenced;
    app.commands.executeCommandById('theme:toggle-light-dark');
    await wait(700);
    out.dark.live = await capture('live');
    out.dark.reading = await capture('reading');
    out.dark.pass = parseComputed(out.dark.live.background) === parseHex(backgrounds[settings.dark]) &&
      parseComputed(out.dark.reading.background) === parseHex(backgrounds[settings.dark]) &&
      out.dark.reading.fenced;
    out.backgroundStylesBeforeDisable = document.querySelectorAll('style#syntax-palette-background').length;
    await app.plugins.disablePlugin(pluginId);
    await wait(800);
    await setMode('live');
    const text = view.editor.getValue();
    const line = text.split('\n').findIndex((value) => value.includes('# python comment'));
    view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line: line + 4, ch: 0 } }, true);
    view.editor.cm.measure();
    await wait(400);
    const disabledLine = [...view.contentEl.querySelectorAll('.cm-line.HyperMD-codeblock')]
      .find((item) => item.textContent.includes('# python comment'));
    out.disabled = {
      background: disabledLine ? getComputedStyle(disabledLine).backgroundColor : null,
      classes: view.contentEl.querySelectorAll('.aof-fenced-block, .aof-fenced-line').length,
      backgroundStyles: document.querySelectorAll('style#syntax-palette-background').length,
      highlightStyles: document.querySelectorAll('style#syntax-palette-highlight').length,
      highlights: [...CSS.highlights.keys()].filter((key) => key.startsWith('aof-reading-')).length,
    };
    out.disabled.pass = out.disabled.backgroundStyles === 0 && out.disabled.highlightStyles === 0 &&
      out.disabled.classes === 0 && out.disabled.highlights === 0;
    await app.plugins.enablePlugin(pluginId);
    await wait(1400);
    await setMode('live');
    view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line: line + 4, ch: 0 } }, true);
    view.editor.cm.measure();
    await wait(500);
    const restoredLine = [...view.contentEl.querySelectorAll('.cm-line.HyperMD-codeblock')]
      .find((item) => item.textContent.includes('# python comment'));
    const refreshed = app.plugins.plugins[pluginId];
    out.reenabledSettings = refreshed ? { ...refreshed.settings, engineReady: refreshed.engineReady } : null;
    out.reenabled = {
      background: restoredLine ? getComputedStyle(restoredLine).backgroundColor : null,
      decorated: view.contentEl.querySelectorAll('.aof-fenced-line').length,
    };
    out.reenabled.pass = parseComputed(out.reenabled.background) === parseHex(backgrounds[settings.dark]) &&
      out.reenabled.decorated > 0;
    out.pass = Boolean(refreshed &&
      refreshed.settings.light === settings.light &&
      refreshed.settings.dark === settings.dark &&
      refreshed.settings.codeBlockBackground === true &&
      refreshed.settings.coloredBrackets === settings.coloredBrackets &&
      refreshed.engineReady &&
      out.light.pass && out.dark.pass && out.disabled.pass && out.reenabled.pass);
  } finally {
    if (!app.plugins.plugins[pluginId]) {
      try { await app.plugins.enablePlugin(pluginId); } catch (error) { /* ignore */ }
      await wait(1000);
    }
    await view.setState(initialMode, {});
    await wait(300);
  }
  return out;
}

async function pagePerformance(args) {
  const { note, pluginId, pairs, legacyPairs, iterations } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  let leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) {
    const file = app.vault.getAbstractFileByPath(note);
    leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }
  await app.workspace.revealLeaf(leaf);
  const view = leaf.view;
  await view.setState({ ...view.getState(), mode: 'source', source: false }, {});
  await wait(500);
  const start = performance.now();
  let maxPalettes = 0;
  let maxHighlights = 0;
  let maxStyles = 0;
  let maxBackgroundStyleNodes = 0;
  for (let i = 0; i < iterations; i++) {
    const pair = pairs[i % pairs.length];
    await plugin.updateSettings({ ...pair, codeBlockBackground: i % 2 === 0 });
    await wait(70);
    maxPalettes = Math.max(maxPalettes, plugin.readingPalettes.size);
    maxHighlights = Math.max(maxHighlights, [...CSS.highlights.keys()].filter((key) => key.startsWith('aof-reading-')).length);
    maxStyles = Math.max(maxStyles, (plugin.backgroundStyle?.sheet?.cssRules?.length || 0) + (plugin.readingStyle?.sheet?.cssRules?.length || 0));
    maxBackgroundStyleNodes = Math.max(maxBackgroundStyleNodes, document.querySelectorAll('style#syntax-palette-background').length);
  }
  const themeElapsed = performance.now() - start;
  const appearanceStart = performance.now();
  for (let i = 0; i < 8; i++) {
    app.commands.executeCommandById('theme:toggle-light-dark');
    await wait(90);
  }
  const appearanceElapsed = performance.now() - appearanceStart;
  const toggleStart = performance.now();
  for (let i = 0; i < 20; i++) {
    await plugin.updateSettings({ codeBlockBackground: i % 2 === 0 });
    await wait(25);
  }
  const toggleElapsed = performance.now() - toggleStart;
  await plugin.updateSettings({ ...legacyPairs[0], codeBlockBackground: false, coloredBrackets: true });
  await wait(300);
  const legacyStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    await plugin.updateSettings({ ...legacyPairs[i % legacyPairs.length], codeBlockBackground: false });
    await wait(50);
  }
  const legacySwitchElapsed = performance.now() - legacyStart;
  await plugin.updateSettings({ ...pairs[0], codeBlockBackground: true, coloredBrackets: true });
  await wait(500);
  const state = plugin.engine.getState();
  return {
    pass: state.cacheEntries <= 96 && state.cacheSize <= 2000000 &&
      maxPalettes < 400 && maxHighlights < 400 && maxStyles < 800 && maxBackgroundStyleNodes === 1 &&
      document.querySelectorAll('style#syntax-palette-background').length === 1,
    themeElapsed,
    appearanceElapsed,
    toggleElapsed,
    legacySwitchElapsed,
    legacySwitchIterations: iterations,
    iterations,
    maxPalettes,
    maxHighlights,
    maxStyles,
    maxBackgroundStyleNodes,
    state,
    decoratedLines: view.contentEl.querySelectorAll('.aof-fenced-line').length,
    backgroundStyleNodes: document.querySelectorAll('style#syntax-palette-background').length,
    highlightStyleNodes: document.querySelectorAll('style#syntax-palette-highlight').length,
    spans: document.querySelectorAll('span.atom-one-fenced-token').length,
    memory: performance.memory ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
    } : null,
  };
}

// ---------------------------------------------------------------------------
// Node-side phase drivers
// ---------------------------------------------------------------------------

async function phasePrepare(context) {
  const data = await context.main.eval(`(${pagePrepare})(${JSON.stringify({ note: NOTE, pluginId: PLUGIN_ID })})`);
  return {
    ...data,
    pass: data.pluginVersion === EXPECTED_VERSION && data.pluginReady &&
      data.themeCount === 39 && data.familyCount === 15 &&
      data.file === NOTE && data.cssTheme === 'Minimal',
  };
}

async function phaseInstallUpgrade(context) {
  await closeSettings(context.main);
  await context.main.eval(`(${pageSetPluginEnabled})(${JSON.stringify({ pluginId: PLUGIN_ID, enabled: false })})`);
  await wait(700);
  fs.rmSync(DATA_PATH, { force: true });
  await context.main.eval(`(${pageSetPluginEnabled})(${JSON.stringify({ pluginId: PLUGIN_ID, enabled: true })})`);
  await wait(1400);
  const first = await context.main.eval(`(${pageStateSnapshot})(${JSON.stringify({ note: NOTE, pluginId: PLUGIN_ID })})`);

  await context.main.eval(`(${pageSetPluginEnabled})(${JSON.stringify({ pluginId: PLUGIN_ID, enabled: false })})`);
  await wait(700);
  const oldSettings = {
    light: 'github-light-default',
    dark: 'catppuccin-mocha',
    coloredBrackets: false,
  };
  fs.writeFileSync(DATA_PATH, JSON.stringify(oldSettings, null, 2) + '\n');
  await context.main.eval(`(${pageSetPluginEnabled})(${JSON.stringify({ pluginId: PLUGIN_ID, enabled: true })})`);
  await wait(1400);
  const upgrade = await context.main.eval(`(${pageStateSnapshot})(${JSON.stringify({ note: NOTE, pluginId: PLUGIN_ID })})`);
  const firstPass = first.version === EXPECTED_VERSION &&
    first.settings.light === 'atom-one-light' &&
    first.settings.dark === 'atom-one-dark' &&
    first.settings.coloredBrackets === true &&
    first.settings.codeBlockBackground === false &&
    first.settings.lineNumbers === false &&
    first.backgroundCss === '' &&
    first.lineNumberCss === '' &&
    first.decoratedLines === 0 &&
    first.fencedBlocks === 0 &&
    first.backgroundStyles === 1;
  const upgradePass = upgrade.version === EXPECTED_VERSION &&
    upgrade.settings.light === oldSettings.light &&
    upgrade.settings.dark === oldSettings.dark &&
    upgrade.settings.coloredBrackets === false &&
    upgrade.settings.codeBlockBackground === false &&
    upgrade.settings.lineNumbers === false &&
    upgrade.backgroundCss === '' &&
    upgrade.lineNumberCss === '' &&
    upgrade.decoratedLines === 0 &&
    upgrade.fencedBlocks === 0;
  return { pass: firstPass && upgradePass, first, upgrade, oldSettings, firstPass, upgradePass };
}

async function phaseAccuracy(context) {
  return context.main.eval(`(${pageThemeAccuracy})(${JSON.stringify({
    note: NOTE,
    pluginId: PLUGIN_ID,
    themes: expectations.themes,
  })})`);
}

// Pixel-level proof that the theme colour reaches the screen. A rule in a
// <style> node or a populated CSS.highlights registry is not evidence by
// itself: WebKit happily accepts a range and then paints nothing.
async function phaseSyntaxPixels(context) {
  const failures = [];
  const cases = [];
  const plan = [
    ['preview', 'light', DESIRED.light],
    ['preview', 'dark', DESIRED.dark],
    ['source', 'light', DESIRED.light],
    ['source', 'dark', DESIRED.dark],
  ];
  const required = ['comment', 'keyword', 'string', 'number'];
  for (const [mode, appearance, themeId] of plan) {
    const data = await context.main.eval(`(${pagePixelSamples})(${JSON.stringify({
      note: NOTE,
      pluginId: PLUGIN_ID,
      mode,
      appearance,
      themeId,
    })})`);
    if (!data.engineReady) failures.push(`${mode}/${appearance}: engine not ready`);
    if (data.appearance !== appearance) failures.push(`${mode}/${appearance}: rendered in ${data.appearance}`);
    if (data.highlightMode !== 'custom') failures.push(`${mode}/${appearance}: highlight mode is ${data.highlightMode}`);
    // Reading tokens are nested Prism spans; editor samples come from CodeMirror
    // coordinates. Asserting the source of the sample stops the two "modes" from
    // silently collapsing into the same view.
    const parent = String(data.samples?.comment?.nodeParent || '');
    if (mode === 'preview' && !/token/.test(parent)) {
      failures.push(`preview/${appearance}: sample is not inside a nested token span (${parent || 'none'})`);
    }
    if (mode === 'source' && parent !== '') {
      failures.push(`source/${appearance}: sample unexpectedly came from the reading DOM (${parent})`);
    }
    const shot = await context.main.screenshotBuffer();
    fs.writeFileSync(path.join(EVIDENCE, `pixels-${mode}-${appearance}.png`), shot);
    const image = decodePng(shot);
    const checks = {};
    for (const kind of required) {
      const sample = data.samples?.[kind];
      if (!sample) {
        failures.push(`${mode}/${appearance}: no sample for ${kind}`);
        continue;
      }
      const expectedHex = expectations.themes[themeId][kind];
      const counts = countColorPixels(image, sample, parseRgb(expectedHex), data.viewport.dpr);
      checks[kind] = {
        expected: expectedHex,
        text: sample.text,
        rect: sample,
        hits: counts.hits,
        globalHits: countColorInImage(image, parseRgb(expectedHex)),
        total: counts.total,
        pass: counts.hits >= 6,
      };
      if (!checks[kind].pass) {
        failures.push(`${mode}/${appearance}/${kind}: ${counts.hits} pixels match ${expectedHex} (of ${counts.total})`);
      }
    }
    cases.push({
      mode,
      appearance,
      themeId,
      highlightMode: data.highlightMode,
      fallbackSpans: data.fallbackSpans,
      checks,
    });
  }
  return { pass: failures.length === 0, failures, cases };
}

// Reproduces the missing-capability path: a runtime where CSS.highlights is absent.
// The compatibility renderer must paint the same colours and must be removed
// again when the API comes back.
async function phaseHighlightFallback(context) {
  const failures = [];
  const hidden = await context.main.eval(`(${pageToggleHighlightApi})(${JSON.stringify({
    pluginId: PLUGIN_ID,
    available: false,
  })})`);
  if (hidden.apiAvailable) failures.push('CSS.highlights still visible after hiding');
  if (hidden.mode !== 'fallback') failures.push(`highlight mode is ${hidden.mode}, expected fallback`);
  if (!hidden.ready) failures.push(`engine not ready in fallback mode: ${hidden.error || 'unknown'}`);

  const cases = [];
  const required = ['comment', 'keyword', 'string', 'number'];
  const plan = [
    ['preview', 'light', DESIRED.light],
    ['preview', 'dark', DESIRED.dark],
    ['source', 'light', DESIRED.light],
    ['source', 'dark', DESIRED.dark],
  ];
  for (const [mode, appearance, themeId] of plan) {
    const data = await context.main.eval(`(${pagePixelSamples})(${JSON.stringify({
      note: NOTE,
      pluginId: PLUGIN_ID,
      mode,
      appearance,
      themeId,
    })})`);
    const shot = await context.main.screenshotBuffer();
    fs.writeFileSync(path.join(EVIDENCE, `pixels-fallback-${mode}-${appearance}.png`), shot);
    const image = decodePng(shot);
    const checks = {};
    for (const kind of required) {
      const sample = data.samples?.[kind];
      if (!sample) {
        failures.push(`fallback ${mode}/${appearance}: no sample for ${kind}`);
        continue;
      }
      const expectedHex = expectations.themes[themeId][kind];
      const counts = countColorPixels(image, sample, parseRgb(expectedHex), data.viewport.dpr);
      checks[kind] = { expected: expectedHex, hits: counts.hits, pass: counts.hits >= 6 };
      if (!checks[kind].pass) {
        failures.push(`fallback ${mode}/${appearance}/${kind}: ${counts.hits} pixels match ${expectedHex}`);
      }
    }
    if (!data.fallbackSpans) failures.push(`fallback ${mode}/${appearance}: no compatibility spans rendered`);
    cases.push({ mode, appearance, themeId, fallbackSpans: data.fallbackSpans, checks });
  }

  const restored = await context.main.eval(`(${pageToggleHighlightApi})(${JSON.stringify({
    pluginId: PLUGIN_ID,
    available: true,
  })})`);
  if (!restored.supported) failures.push('CSS Custom Highlight path was not restored');
  if (restored.mode !== 'custom') failures.push(`restored mode is ${restored.mode}, expected custom`);

  const after = await context.main.eval(`(${pagePixelSamples})(${JSON.stringify({
    note: NOTE,
    pluginId: PLUGIN_ID,
    mode: 'preview',
    appearance: 'light',
    themeId: DESIRED.light,
  })})`);
  const afterShot = await context.main.screenshotBuffer();
  fs.writeFileSync(path.join(EVIDENCE, 'pixels-restored-preview-light.png'), afterShot);
  const afterImage = decodePng(afterShot);
  for (const kind of required) {
    const sample = after.samples?.[kind];
    if (!sample) {
      failures.push(`restored: no sample for ${kind}`);
      continue;
    }
    const expectedHex = expectations.themes[DESIRED.light][kind];
    const counts = countColorPixels(afterImage, sample, parseRgb(expectedHex), after.viewport.dpr);
    if (counts.hits < 6) failures.push(`restored/${kind}: ${counts.hits} pixels match ${expectedHex}`);
  }
  if (after.fallbackSpans) failures.push(`restored: ${after.fallbackSpans} compatibility spans still in the DOM`);

  return { pass: failures.length === 0, failures, hidden, cases, restored };
}

async function phaseLifecycle(context) {
  return context.main.eval(`(${pageLifecycle})(${JSON.stringify({
    note: NOTE,
    pluginId: PLUGIN_ID,
    backgrounds,
  })})`);
}

async function phaseScopeIntegrity(context) {
  const noteText = fs.readFileSync(NOTE_PATH, 'utf8');
  const allFences = allFencedBlocks(noteText);
  const blocks = codeBlockTokens(noteText);
  return context.main.eval(`(${pageScopeIntegrity})(${JSON.stringify({
    note: NOTE,
    pluginId: PLUGIN_ID,
    backgrounds,
    expectedFencedBlocks: allFences.length,
    restoreSettings: DESIRED,
  })})`).then((data) => ({
    ...data,
    expected: {
      fences: allFences.length,
      fencesWithLanguage: allFences.filter((block) => block.language).length,
      codeBlocks: blocks.length,
      indented: blocks.filter((block) => !block.fenced).length,
    },
  }));
}

async function settingsSnapshot(settingsPage) {
  return settingsPage.eval(`(() => {
    const root = document.querySelector('.aof-settings');
    if (!root) throw new Error('settings root missing');
    const selects = [...root.querySelectorAll('select:not(.is-measuring)')];
    const items = [...root.querySelectorAll('.setting-item')];
    const toggleItems = items.filter((item) => item.querySelector('input[type=checkbox]'));
    return {
      selectCount: selects.length,
      values: selects.map((select) => select.value),
      optionCounts: selects.map((select) => select.options.length),
      presetOptions: [...selects[0].options].map((option) => option.value),
      lightOptions: [...selects[1].options].map((option) => option.value),
      darkOptions: [...selects[2].options].map((option) => option.value),
      toggleNames: toggleItems.map((item) => item.querySelector('.setting-item-name')?.textContent),
      toggleValues: toggleItems.map((item) => {
        const input = item.querySelector('input[type=checkbox]');
        return Boolean(input.checked || input.closest('.checkbox-container')?.classList.contains('is-enabled'));
      }),
      status: root.querySelector('.aof-status')?.innerText,
      previewBlocks: root.querySelectorAll('.aof-preview-block').length,
      previewSpans: root.querySelectorAll('.aof-preview-code span').length,
      preview: [...root.querySelectorAll('.aof-preview-block')].map((block) => ({
        label: block.querySelector('.aof-preview-label')?.textContent,
        background: getComputedStyle(block.querySelector('pre')).backgroundColor,
      })),
    };
  })()`);
}

async function setSettingsSelect(settingsPage, index, value) {
  return settingsPage.eval(`(() => {
    const selects = [...document.querySelectorAll('.aof-settings select:not(.is-measuring)')];
    if (!selects[${index}]) throw new Error('select ${index} missing');
    selects[${index}].value = ${JSON.stringify(value)};
    selects[${index}].dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

async function clickSettingsToggle(settingsPage, namePart) {
  return settingsPage.eval(`(() => {
    const item = [...document.querySelectorAll('.aof-settings .setting-item')]
      .find((element) => element.querySelector('.setting-item-name')?.textContent.includes(${JSON.stringify(namePart)}));
    if (!item) throw new Error('toggle item missing: ' + ${JSON.stringify(namePart)});
    const input = item.querySelector('input[type=checkbox]');
    if (!input) throw new Error('checkbox missing');
    input.click();
    return true;
  })()`);
}

async function setSettingsPageBody(settingsPage, appearance) {
  await settingsPage.eval(`(() => {
    document.body.classList.remove('theme-light', 'theme-dark');
    document.body.classList.add('theme-${appearance}');
    return document.body.className;
  })()`);
  await wait(250);
}

async function phaseSettingsUI(context) {
  await closeSettings(context.main);
  await setAppearance(context.main, 'light');
  await setSettings(context.main, DESIRED);
  await wait(700);
  const settingsPage = await openSettings(context.main);
  context.settingsPage = settingsPage;
  // Settings open in a separate desktop window, so constrain that renderer
  // independently when checking the narrow-window layout.
  try {
    await settingsPage.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
  } catch (error) {
    // Emulation is best effort; the measurement below records the real width.
  }
  await wait(900);
  await setSettingsPageBody(settingsPage, 'light');
  const initial = await settingsSnapshot(settingsPage);
  await settingsPage.screenshot(path.join(EVIDENCE, 'settings-light.png'));
  await setSettingsPageBody(settingsPage, 'dark');
  await settingsPage.screenshot(path.join(EVIDENCE, 'settings-dark.png'));
  await setSettingsPageBody(settingsPage, 'light');

  const before = await readPluginState(context.main);
  await clickSettingsToggle(settingsPage, '代码块背景');
  await wait(1300);
  const backgroundOff = await readPluginState(context.main);
  const offUi = await settingsSnapshot(settingsPage);
  await clickSettingsToggle(settingsPage, '代码块背景');
  await wait(1300);
  const backgroundOn = await readPluginState(context.main);
  const onUi = await settingsSnapshot(settingsPage);

  await setSettingsSelect(settingsPage, 1, 'solarized-light');
  await wait(1100);
  await setSettingsSelect(settingsPage, 2, 'kanagawa-dragon');
  await wait(1100);
  const changed = await readPluginState(context.main);
  const changedUi = await settingsSnapshot(settingsPage);

  await setSettingsSelect(settingsPage, 0, 'tokyo-night');
  await wait(1400);
  const preset = await readPluginState(context.main);
  const presetUi = await settingsSnapshot(settingsPage);

  const bracketBefore = (await readPluginState(context.main)).settings.coloredBrackets;
  await clickSettingsToggle(settingsPage, '彩色括号');
  await wait(1000);
  const bracketAfter = (await readPluginState(context.main)).settings.coloredBrackets;
  await clickSettingsToggle(settingsPage, '彩色括号');
  await wait(1000);
  const bracketRestored = (await readPluginState(context.main)).settings.coloredBrackets;

  await setSettings(context.main, DESIRED);
  await wait(1000);
  const finalUi = await settingsSnapshot(settingsPage);
  await setSettingsPageBody(settingsPage, 'light');
  await settingsPage.eval(`(() => { document.querySelector('.aof-preview-section')?.scrollIntoView({ block: 'center' }); return true; })()`);
  await wait(400);
  await settingsPage.screenshot(path.join(EVIDENCE, 'settings-preview-light.png'));
  await setSettingsPageBody(settingsPage, 'dark');
  await wait(300);
  await settingsPage.screenshot(path.join(EVIDENCE, 'settings-preview-dark.png'));
  await setSettingsPageBody(settingsPage, 'light');
  await closeSettings(context.main);

  const initialStatus = (initial.status || '').replace(/\s+/g, '');
  const pass = initial.selectCount === 3 &&
    initial.optionCounts[0] === 16 && initial.optionCounts[1] === 12 && initial.optionCounts[2] === 27 &&
    initial.toggleNames.length === 4 &&
    initial.toggleNames.some((name) => name.includes('代码块背景')) &&
    initial.toggleNames.some((name) => name.includes('显示代码块行号')) &&
    initial.toggleNames.some((name) => name.includes('编辑视图代码块自动换行')) &&
    initial.toggleNames.some((name) => name.includes('彩色括号')) &&
    initial.toggleValues[1] === false &&
    initial.toggleValues[2] === false &&
    initialStatus.includes('代码行号：关闭') &&
    initialStatus.includes('渲染方式：CSSCustomHighlight') &&
    initialStatus.includes('引擎资源：vault内读取') &&
    initial.previewBlocks === 2 && initial.previewSpans > 0 &&
    initial.preview[0].label.includes('主题背景 #FFFFFF') &&
    initial.preview[1].label.includes('主题背景 #24283B') &&
    initial.preview[0].background === 'rgb(255, 255, 255)' &&
    initial.preview[1].background === 'rgb(36, 40, 59)' &&
    initialStatus.includes('使用所选主题背景') &&
    backgroundOff.settings.codeBlockBackground === false &&
    backgroundOff.backgroundCss === '' &&
    offUi.preview.every((item) => item.label.includes('Obsidian 原生背景')) &&
    offUi.preview.every((item) => item.background === 'rgba(0, 0, 0, 0)') &&
    backgroundOn.settings.codeBlockBackground === true &&
    backgroundOn.backgroundCss.includes('#FFFFFF') && backgroundOn.backgroundCss.includes('#24283B') &&
    onUi.preview[0].label.includes('主题背景 #FFFFFF') &&
    onUi.preview[1].label.includes('主题背景 #24283B') &&
    changed.settings.light === 'solarized-light' &&
    changed.settings.dark === 'kanagawa-dragon' &&
    changed.backgroundCss.includes('#FDF6E3') && changed.backgroundCss.includes('#181616') &&
    changedUi.preview[0].label.includes('#FDF6E3') && changedUi.preview[1].label.includes('#181616') &&
    preset.settings.light === 'tokyo-night-light' &&
    preset.settings.dark === 'tokyo-night-night' &&
    preset.backgroundCss.includes('#E6E7ED') && preset.backgroundCss.includes('#1A1B26') &&
    bracketBefore === true && bracketAfter === false && bracketRestored === true &&
    finalUi.selectCount === 3;
  return { pass, initial, before, backgroundOff, offUi, backgroundOn, onUi, changed, changedUi, preset, presetUi, bracketBefore, bracketAfter, bracketRestored, finalUi };
}

async function commandModalSnapshot(context) {
  await context.main.eval(`app.commands.executeCommandById(${JSON.stringify(PLUGIN_ID + ':choose-syntax-theme')});true`);
  await wait(700);
  const page = await findPageWith('!!document.querySelector(".aof-theme-modal")', 7000);
  const snapshot = await page.eval(`(() => {
    const modal = document.querySelector('.aof-theme-modal');
    const selects = [...modal.querySelectorAll('select:not(.is-measuring)')];
    const toggles = [...modal.querySelectorAll('input[type=checkbox]')];
    return {
      exists: !!modal,
      selectCount: selects.length,
      optionCounts: selects.map((select) => select.options.length),
      toggleCount: toggles.length,
      toggleValues: toggles.map((input) => Boolean(input.checked || input.closest('.checkbox-container')?.classList.contains('is-enabled'))),
      status: modal.querySelector('.aof-status')?.innerText,
      buttons: [...modal.querySelectorAll('button')].map((button) => button.textContent),
    };
  })()`);
  return { page, snapshot };
}

async function phaseCommandModal(context) {
  await closeSettings(context.main);
  await setSettings(context.main, DESIRED);
  await setAppearance(context.main, 'light');
  const { page, snapshot } = await commandModalSnapshot(context);
  await page.screenshot(path.join(EVIDENCE, 'command-modal.png'));
  await page.eval(`(() => {
    const modal = document.querySelector('.aof-theme-modal');
    const cancel = [...modal.querySelectorAll('button')].find((button) => button.textContent === '取消');
    if (!cancel) throw new Error('cancel missing');
    cancel.click();
    return true;
  })()`);
  await wait(600);
  const closed = await page.eval('!document.querySelector(".aof-theme-modal")');
  const state = await readPluginState(context.main);
  const commands = await context.main.eval(`Object.keys(app.commands.commands).filter((id) => id.startsWith(${JSON.stringify(PLUGIN_ID + ':')}))`);
  page.close();
  const pass = snapshot.exists && snapshot.selectCount === 3 &&
    snapshot.optionCounts[0] === 16 && snapshot.optionCounts[1] === 12 && snapshot.optionCounts[2] === 27 &&
    snapshot.toggleCount === 4 && snapshot.toggleValues[0] === true && snapshot.toggleValues[1] === false &&
    snapshot.toggleValues[2] === false &&
    snapshot.status.includes('代码块背景：使用所选主题背景') &&
    snapshot.status.includes('代码行号：关闭') &&
    snapshot.status.includes('编辑视图换行：不换行（横向滚动）') &&
    snapshot.buttons.includes('应用') && closed &&
    state.settings.codeBlockBackground === true &&
    state.settings.light === DESIRED.light && state.settings.dark === DESIRED.dark &&
    commands.length === 3 &&
    commands.includes(PLUGIN_ID + ':diagnose-syntax-highlight');
  return { pass, snapshot, closed, state, commands };
}

async function phaseVisualEvidence(context) {
  await closeSettings(context.main);
  await setSettings(context.main, DESIRED);
  const files = [];
  for (const appearance of ['light', 'dark']) {
    await setAppearance(context.main, appearance);
    for (const mode of ['live', 'source', 'reading']) {
      const state = await context.main.eval(`(${pagePrepareScreenshot})(${JSON.stringify({ note: NOTE, mode, appearance })})`);
      const file = path.join(EVIDENCE, `note-${mode}-${appearance}.png`);
      await context.main.screenshot(file);
      files.push({ file: path.relative(ROOT, file), state, bytes: fs.statSync(file).size });
    }
  }
  await setSettings(context.main, { ...DESIRED, codeBlockBackground: false });
  await setAppearance(context.main, 'light');
  await context.main.eval(`(${pagePrepareScreenshot})(${JSON.stringify({ note: NOTE, mode: 'live', appearance: 'light' })})`);
  const nativeFile = path.join(EVIDENCE, 'note-live-light-native.png');
  await context.main.screenshot(nativeFile);
  files.push({ file: path.relative(ROOT, nativeFile), bytes: fs.statSync(nativeFile).size, native: true });
  await setSettings(context.main, DESIRED);
  const pass = files.length === 7 && files.every((item) => item.bytes > 10000);
  return { pass, files };
}

async function phasePerformance(context) {
  await closeSettings(context.main);
  await setAppearance(context.main, 'light');
  const data = await context.main.eval(`(${pagePerformance})(${JSON.stringify({
    note: NOTE,
    pluginId: PLUGIN_ID,
    pairs: [
      { light: 'github-light-default', dark: 'tokyo-night-storm' },
      { light: 'material-lighter', dark: 'kanagawa-dragon' },
      { light: 'solarized-light', dark: 'one-dark-pro' },
      { light: 'night-owl-light', dark: 'monokai' },
    ],
    legacyPairs: [
      { light: 'github-light-default', dark: 'catppuccin-mocha' },
      { light: 'ayu-light', dark: 'vscode-dark-modern' },
    ],
    iterations: 12,
  })})`);
  await setSettings(context.main, DESIRED);
  return data;
}

async function phaseFallback(context) {
  await closeSettings(context.main);
  const before = await readPluginState(context.main);
  await context.main.eval(`(${pageSetPluginEnabled})(${JSON.stringify({ pluginId: PLUGIN_ID, enabled: false })})`);
  await wait(700);
  fs.writeFileSync(DATA_PATH, JSON.stringify({
    light: 'missing-light', dark: 'missing-dark', coloredBrackets: false, codeBlockBackground: true,
  }, null, 2) + '\n');
  await context.main.eval(`(${pageSetPluginEnabled})(${JSON.stringify({ pluginId: PLUGIN_ID, enabled: true })})`);
  await wait(1400);
  await setAppearance(context.main, 'light');
  const loaded = await context.main.eval(`(${pageStateSnapshot})(${JSON.stringify({ note: NOTE, pluginId: PLUGIN_ID })})`);
  await setSettings(context.main, before.settings);
  await wait(700);
  const restored = await readPluginState(context.main);
  const pass = loaded.settings.light === 'atom-one-light' &&
    loaded.settings.dark === 'atom-one-dark' &&
    loaded.settings.coloredBrackets === false &&
    loaded.settings.codeBlockBackground === true &&
    loaded.backgroundCss.includes('#FAFAFA') && loaded.backgroundCss.includes('#282C34') &&
    restored.settings.light === before.settings.light &&
    restored.settings.dark === before.settings.dark &&
    restored.settings.codeBlockBackground === before.settings.codeBlockBackground;
  return { pass, before, loaded, restored };
}

async function phasePersistence(context) {
  await closeSettings(context.main);
  await setAppearance(context.main, 'light');
  await setSettings(context.main, DESIRED);
  await wait(900);
  const savedBefore = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const beforeState = await readPluginState(context.main);
  await killIsolatedObsidian();
  context.main.close();
  context.main = await launchIsolatedObsidian();
  const prepared = await context.main.eval(`(${pagePrepare})(${JSON.stringify({ note: NOTE, pluginId: PLUGIN_ID })})`);
  const verified = await context.main.eval(`(${pageAfterRestart})(${JSON.stringify({
    note: NOTE,
    pluginId: PLUGIN_ID,
    backgrounds,
    settings: DESIRED,
  })})`);
  const savedAfter = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const postRestartScreenshot = path.join(EVIDENCE, 'note-post-restart.png');
  await context.main.screenshot(postRestartScreenshot);
  const pass = savedBefore.light === DESIRED.light &&
    savedBefore.dark === DESIRED.dark &&
    savedBefore.coloredBrackets === DESIRED.coloredBrackets &&
    savedBefore.codeBlockBackground === true &&
    savedBefore.lineNumbers === false &&
    savedAfter.light === DESIRED.light &&
    savedAfter.dark === DESIRED.dark &&
    savedAfter.coloredBrackets === DESIRED.coloredBrackets &&
    savedAfter.codeBlockBackground === true &&
    savedAfter.lineNumbers === false &&
    prepared.pluginVersion === EXPECTED_VERSION &&
    prepared.settings.codeBlockBackground === true &&
    verified.pass;
  return { pass, desired: DESIRED, savedBefore, beforeState, prepared, verified, savedAfter, screenshot: path.relative(ROOT, postRestartScreenshot) };
}

// ---------------------------------------------------------------------------
// v0.4.0 page-side functions: line numbers, narrow viewport, cleanup.
// ---------------------------------------------------------------------------

// Reading mode: one <pre> per fence. The gutter is generated content, so the
// code text itself must stay byte-identical and the numbers must line up with
// the real text rows. Geometry is measured from the rendered text, not from the
// CSS values the plugin wrote, so a wrong line-height shows up as a failure.
async function pageReadingNumbers(args) {
  const { note, pluginId, plan, offSettings, onSettings } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  let leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) {
    // After a restart the workspace may restore only the first note; open the
    // numbered note on demand instead of failing the phase.
    const file = app.vault.getAbstractFileByPath(note);
    if (!file) throw new Error('note missing: ' + note);
    leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    await wait(900);
  }
  const view = leaf.view;

  await view.setState({ ...view.getState(), mode: 'preview', source: false }, {});
  await wait(900);

  // Switching appearance immediately before this phase can leave the preview
  // pane empty for a few frames; measuring then reports zero blocks. Poll for
  // rendered fences instead of trusting the fixed delay.
  const previewWithContent = async (limit = 6000) => {
    const deadline = Date.now() + limit;
    while (Date.now() < deadline) {
      const pane = view.contentEl.querySelector('.markdown-preview-view');
      if (pane && pane.querySelectorAll('pre').length > 0) return pane;
      await wait(200);
    }
    return null;
  };
  const root = (await previewWithContent()) || view.contentEl.querySelector('.markdown-preview-view') || view.contentEl;
  const pres = () => [...root.querySelectorAll('pre')]
    .filter((pre) => !pre.closest('.frontmatter') && !pre.classList.contains('frontmatter'));

  function codeText(pre) {
    const code = pre.querySelector('code');
    const text = code ? code.textContent : '';
    return text.endsWith('\n') ? text.slice(0, -1) : text;
  }

  // One rect per logical line, taken from a Range over the first character so
  // the measurement reflects the text box, not the <pre> strut.
  function lineRects(pre) {
    const code = pre.querySelector('code');
    if (!code) return [];
    const entries = [];
    let offset = 0;
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      entries.push({ node, from: offset, text: node.nodeValue || '' });
      offset += (node.nodeValue || '').length;
    }
    const raw = entries.map((entry) => entry.text).join('');
    const total = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
    const lines = total.split('\n');
    const starts = [];
    let index = 0;
    for (const line of lines) {
      starts.push(index);
      index += line.length + 1;
    }
    const preRect = pre.getBoundingClientRect();
    const out = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      if (!lines[lineIndex].trim()) {
        out.push(null);
        continue;
      }
      const target = starts[lineIndex];
      let placed = null;
      for (const entry of entries) {
        const end = entry.from + entry.text.length;
        if (target >= entry.from && target < end) {
          const range = document.createRange();
          const start = target - entry.from;
          range.setStart(entry.node, start);
          range.setEnd(entry.node, Math.min(start + 1, entry.text.length));
          const rect = range.getBoundingClientRect();
          placed = {
            top: rect.top - preRect.top,
            left: rect.left - preRect.left,
            height: rect.height,
          };
          break;
        }
      }
      out.push(placed);
    }
    return out;
  }

  // Width of one code character in the block's own font: the reading gutter is
  // `digits * 1ch` wide, so this is the same unit the stylesheet uses.
  function measureCharacter(code) {
    if (!code) return 8;
    const probe = document.createElement('span');
    probe.textContent = '0000000000';
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;';
    probe.style.font = getComputedStyle(code).font;
    document.body.appendChild(probe);
    const width = probe.getBoundingClientRect().width / 10;
    probe.remove();
    return Number(width.toFixed(3));
  }

  function snapshot() {
    const list = pres();
    const blocks = [];
    for (let index = 0; index < list.length; index++) {
      const pre = list[index];
      const code = pre.querySelector('code');
      const preStyle = getComputedStyle(pre);
      const numbersOn = pre.classList.contains('aof-ln-on');
      const gutter = pre.getAttribute('data-aof-ln') || '';
      const count = Number(pre.getAttribute('data-aof-ln-count')) || 0;
      const gutterTop = parseFloat(pre.style.getPropertyValue('--aof-ln-top'));
      const pitch = parseFloat(pre.style.getPropertyValue('--aof-ln-lh'));
      // The reading gutter width is CSS-only now: inset + digits*1ch + gap,
      // with the digit count written by the plugin. Nothing horizontal is
      // measured at runtime, so the check recomputes that same expression from
      // the live font metrics and compares it with the padding the browser
      // actually resolved. Text position is not used: a horizontally scrolled
      // code block would move it without changing the gutter.
      const digits = Number(pre.style.getPropertyValue('--aof-ln-digits')) || 0;
      const chWidth = measureCharacter(code);
      const codePaddingLeft = code ? parseFloat(getComputedStyle(code).paddingLeft) : NaN;
      const expectedPadding = 4 + digits * chWidth + 10;
      const rects = numbersOn ? lineRects(pre) : [];
      const deltas = [];
      const gaps = [];
      for (let lineIndex = 0; lineIndex < rects.length; lineIndex++) {
        const rect = rects[lineIndex];
        if (!rect) continue;
        // Compare line-box centers: the glyph box is centered inside the CSS
        // line box, so this removes the font half-leading from the measurement.
        const center = rect.top + rect.height / 2;
        deltas.push(Number((center - (gutterTop + lineIndex * pitch + pitch / 2)).toFixed(2)));
      }
      if (numbersOn && Number.isFinite(codePaddingLeft)) {
        gaps.push(Number((codePaddingLeft - expectedPadding).toFixed(2)));
      }
      blocks.push({
        index,
        text: codeText(pre),
        classList: [...pre.classList],
        numbersOn,
        gutter,
        count,
        paddingLeft: preStyle.paddingLeft,
        codePaddingLeft,
        expectedPadding: Number(expectedPadding.toFixed(2)),
        codeDisplay: code ? getComputedStyle(code).display : null,
        codeWhiteSpace: code ? getComputedStyle(code).whiteSpace : null,
        gutterTop,
        pitch,
        digits,
        chWidth,
        deltas,
        gaps,
        maxDelta: deltas.length ? Math.max(...deltas.map((value) => Math.abs(value))) : null,
        minGap: gaps.length ? Math.min(...gaps) : null,
        measuredLines: rects.filter(Boolean).length,
        blankLines: rects.filter((rect) => !rect).length,
      });
    }
    const firstTextPre = [...root.querySelectorAll('pre.aof-fenced-block')].find((item) => codeText(item));
    return {
      blocks,
      styleText: document.querySelector('style#syntax-palette-line-numbers')?.textContent || '',
      numberedPres: root.querySelectorAll('pre.aof-ln-on').length,
      fencedPres: root.querySelectorAll('pre.aof-fenced-block').length,
      backgroundStyleText: document.querySelector('style#syntax-palette-background')?.textContent || '',
      appearance: document.body.classList.contains('theme-dark') ? 'dark' : 'light',
      sampleBackground: firstTextPre ? getComputedStyle(firstTextPre).backgroundColor : null,
    };
  }

  await plugin.updateSettings(offSettings);
  await wait(800);
  const off = snapshot();

  await plugin.updateSettings(onSettings);
  await wait(1100);
  const on = snapshot();

  await plugin.updateSettings(offSettings);
  await wait(900);
  const restored = snapshot();

  await plugin.updateSettings(onSettings);
  await wait(1100);

  // Map rendered <pre> elements onto source tokens. The plugin maps by index;
  // the test prefers an exact text match so a rendering difference shows up as
  // a mismatch instead of silently shifting every later block.
  let cursor = 0;
  const mapped = [];
  for (const block of on.blocks) {
    let tokenIndex = -1;
    for (let probe = cursor; probe < Math.min(cursor + 3, plan.tokens.length); probe++) {
      if (plan.tokens[probe].sourceText === block.text) {
        tokenIndex = probe;
        break;
      }
    }
    if (tokenIndex < 0) tokenIndex = cursor < plan.tokens.length ? cursor : -1;
    const token = tokenIndex >= 0 ? plan.tokens[tokenIndex] : null;
    if (tokenIndex >= 0) cursor = tokenIndex + 1;
    mapped.push({ block, token });
  }

  const failures = [];
  for (const { block, token } of mapped) {
    if (!token) {
      failures.push(`pre ${block.index}: no source token`);
      continue;
    }
    if (!block.text) {
      // An empty fence has nothing to number; it must stay visually native.
      if (block.numbersOn) failures.push(`pre ${block.index}: empty fence was numbered`);
      continue;
    }
    if (token.fenced !== block.classList.includes('aof-fenced-block')) {
      failures.push(`pre ${block.index}: fenced class ${block.classList.includes('aof-fenced-block')} != ${token.fenced}`);
    }
    if (block.text !== token.sourceText) {
      failures.push(`pre ${block.index}: code text changed`);
    }
    if (!token.numbered) {
      if (block.numbersOn) failures.push(`pre ${block.index}: unnumbered block has a gutter`);
      if (block.gutter) failures.push(`pre ${block.index}: unnumbered block has gutter text`);
      continue;
    }
    if (!block.numbersOn) failures.push(`pre ${block.index}: missing aof-ln-on`);
    if (block.gutter !== token.gutter) failures.push(`pre ${block.index}: gutter ${JSON.stringify(block.gutter)} != expected`);
    if (block.count !== token.count) failures.push(`pre ${block.index}: count ${block.count} != ${token.count}`);
    if (!(block.pitch > 0)) failures.push(`pre ${block.index}: pitch not set`);
    if (block.maxDelta === null || block.maxDelta > 1.5) {
      failures.push(`pre ${block.index}: vertical misalignment ${block.maxDelta}`);
    }
    // The code's padding-left must equal the gutter the stylesheet promises:
    // inset (4px) + digits * 1ch + gap (10px). A drift means the number column
    // and the text column disagree, which is what "the text jumps" looked like.
    if (block.minGap === null || Math.abs(block.minGap) > 0.5) {
      failures.push(`pre ${block.index}: gutter padding differs from digits*1ch (${block.minGap}px)`);
    }
    if (block.measuredLines + block.blankLines !== token.count) {
      failures.push(`pre ${block.index}: ${block.measuredLines}+${block.blankLines} lines != ${token.count}`);
    }
  }

  const offPass = off.blocks.every((block) => !block.numbersOn && !block.gutter);
  if (!offPass) failures.push('numbers visible while the setting is off');
  if (off.styleText !== '') failures.push('line-number CSS present while off');
  if (on.styleText === '') failures.push('line-number CSS missing while on');

  const restoredText = restored.blocks.map((block) => block.paddingLeft);
  const offText = off.blocks.map((block) => block.paddingLeft);
  if (JSON.stringify(restoredText) !== JSON.stringify(offText)) {
    failures.push('padding was not restored after turning numbers off');
  }
  if (restored.blocks.some((block) => block.numbersOn || block.gutter)) {
    failures.push('numbers survived turning the setting off');
  }
  if (restored.styleText !== '') failures.push('line-number CSS survived turning the setting off');

  return {
    pass: failures.length === 0,
    failures,
    off: { blocks: off.blocks.map(({ index, numbersOn, gutter, paddingLeft }) => ({ index, numbersOn, gutter, paddingLeft })), styleText: off.styleText },
    on,
    restored: { blocks: restored.blocks.map(({ index, numbersOn, gutter, paddingLeft }) => ({ index, numbersOn, gutter, paddingLeft })), styleText: restored.styleText },
    mapped: mapped.map(({ block, token }) => ({
      index: block.index,
      language: token ? token.language : null,
      count: block.count,
      expectedCount: token ? token.count : null,
      gutter: block.gutter,
      maxDelta: block.maxDelta,
      minGap: block.minGap,
      measuredLines: block.measuredLines,
      paddingLeft: block.paddingLeft,
    })),
  };
}

// Editor: numbers are zero-length widgets inside the code line. Verify one
// widget per content line, the fence markers stay clean, and the widget sits
// left of the first code character without touching the text.
async function pageEditorNumbers(args) {
  const { note, pluginId, targets, mode, onSettings, emptyStarts } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  let leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) {
    // After a restart the workspace may restore only the first note; open the
    // numbered note on demand instead of failing the phase.
    const file = app.vault.getAbstractFileByPath(note);
    if (!file) throw new Error('note missing: ' + note);
    leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    await wait(900);
  }
  const view = leaf.view;
  await view.setState({ ...view.getState(), mode: 'source', source: mode === 'source' }, {});
  await wait(850);
  await plugin.updateSettings(onSettings);
  await wait(900);
  const cm = view.editor.cm;

  function lineElement(lineNumber) {
    if (lineNumber < 1 || lineNumber > cm.state.doc.lines) return null;
    const line = cm.state.doc.line(lineNumber);
    const dom = cm.domAtPos(line.from);
    let node = dom.node;
    if (node && node.nodeType !== 1) node = node.parentElement;
    return node ? node.closest('.cm-line') : null;
  }

  // Number geometry for one code line. A top-level fence paints its number as
  // CSS `::before` content driven by the line's `data-aof-n` attribute (no DOM
  // node to measure directly — the used box comes from getComputedStyle), while
  // a quoted/list fence keeps an inline widget span. Both fold into one box so
  // the assertions below do not care which form produced the number.
  function numberBoxOf(el) {
    const inline = el.querySelector('.aof-ln');
    if (inline) {
      const rect = inline.getBoundingClientRect();
      return {
        count: el.querySelectorAll('.aof-ln').length,
        value: inline.textContent,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    }
    if (!el.hasAttribute('data-aof-n')) return null;
    const pseudo = getComputedStyle(el, '::before');
    const rect = el.getBoundingClientRect();
    const left = parseFloat(pseudo.left);
    const width = parseFloat(pseudo.width);
    const top = parseFloat(pseudo.top);
    const height = parseFloat(pseudo.height);
    if (!Number.isFinite(left) || !Number.isFinite(width)) {
      throw new Error('line number ::before box did not resolve to pixels');
    }
    const boxTop = rect.top + (Number.isFinite(top) ? top : 0);
    return {
      count: 1,
      value: el.getAttribute('data-aof-n'),
      left: rect.left + left,
      right: rect.left + left + width,
      top: boxTop,
      bottom: boxTop + (Number.isFinite(height) ? height : 0),
    };
  }

  // First visible code character that follows the number widget. Leading
  // indentation and list/quote markers come before the widget and must not be
  // mistaken for the code text when measuring the gap.
  function firstTextLeft(element, span) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const anchor = span ? span.getBoundingClientRect() : null;
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue) continue;
      if (span) {
        const position = span.compareDocumentPosition(node);
        if (!(position & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      }
      if (node.parentElement?.closest('.aof-ln')) continue;
      const match = /\S/.exec(node.nodeValue);
      if (!match) continue;
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + 1);
      const rect = range.getBoundingClientRect();
      // A wrapped line has more than one visual row; only text on the widget's
      // own row can be compared horizontally.
      if (anchor && !(rect.bottom > anchor.top + 1 && rect.top < anchor.bottom - 1)) continue;
      return rect.left;
    }
    return null;
  }

  async function inspect(target) {
    const scrollLine = target.sampleFromEnd
      ? Math.min(target.start + target.count, cm.state.doc.lines - 1)
      : Math.min(target.start + 1, cm.state.doc.lines - 1);
    view.editor.scrollIntoView({
      from: { line: scrollLine, ch: 0 },
      to: { line: Math.min(scrollLine + Math.min(target.count, 30), cm.state.doc.lines - 1), ch: 0 },
    }, true);
    cm.measure();
    await wait(380);

    const report = {
      start: target.start,
      count: target.count,
      mode,
      lines: [],
      fenceMarkerNumbers: 0,
      ok: true,
    };
    const limit = Math.min(target.limit || target.count, target.count);
    const offset = target.sampleFromEnd ? Math.max(0, target.count - limit) : 0;
    for (let i = 0; i < limit; i++) {
      const contentIndex = offset + i;
      const el = lineElement(target.start + 2 + contentIndex);
      if (!el) {
        report.lines.push({ contentIndex, rendered: false });
        continue;
      }
      const numberBox = numberBoxOf(el);
      const span = el.querySelector('.aof-ln');
      const lineRect = el.getBoundingClientRect();
      let horizontalGap = null;
      let verticalOffset = null;
      let foldGap = null;
      let indentGap = null;
      if (numberBox) {
        const textLeft = firstTextLeft(el, span);
        if (textLeft !== null) horizontalGap = Number((textLeft - numberBox.right).toFixed(2));
        verticalOffset = Number((numberBox.top - lineRect.top).toFixed(2));
        // Obsidian draws the fold chevron 15px wide, anchored at the text edge,
        // and the first indent guide at the text column. Both land inside the
        // gutter, so the number has to keep clear of them (0.4.3 regression:
        // the chevron was painted on top of the last digit).
        const foldIcon = el.querySelector('.cm-fold-indicator .collapse-indicator')
          || el.querySelector('.collapse-indicator');
        if (foldIcon) {
          foldGap = Number((foldIcon.getBoundingClientRect().left - numberBox.right).toFixed(2));
        }
        const indent = el.querySelector('.cm-indent');
        if (indent) {
          indentGap = Number((indent.getBoundingClientRect().left - numberBox.right).toFixed(2));
        }
      }
      report.lines.push({
        contentIndex,
        rendered: true,
        spans: numberBox ? numberBox.count : 0,
        value: numberBox ? numberBox.value : null,
        expected: contentIndex + 1,
        horizontalGap,
        verticalOffset,
        foldGap,
        indentGap,
        lineHeight: Number(lineRect.height.toFixed(2)),
        wrapped: lineRect.height > (parseFloat(getComputedStyle(el).lineHeight) || 20) * 1.6,
        textLength: el.textContent.length,
      });
    }
    // Opener and closing fence lines must never be numbered.
    for (const lineNumber of [target.start + 1, target.start + target.count + 2]) {
      const el = lineElement(lineNumber);
      if (el && (el.querySelector('.aof-ln') || el.hasAttribute('data-aof-n'))) report.fenceMarkerNumbers += 1;
    }
    return report;
  }

  const reports = [];
  for (const target of targets) reports.push(await inspect(target));

  const failures = [];
  const foldChecks = [];
  for (const report of reports) {
    if (report.fenceMarkerNumbers) {
      failures.push(`block@${report.start}: fence marker was numbered`);
    }
    for (const line of report.lines) {
      if (!line.rendered || line.expected === undefined) continue;
      if (line.spans !== 1) failures.push(`block@${report.start} line ${line.expected}: ${line.spans} numbers`);
      if (line.value !== String(line.expected)) {
        failures.push(`block@${report.start} line ${line.expected}: number ${line.value}`);
      }
      if (line.horizontalGap !== null && line.horizontalGap < 0) {
        failures.push(`block@${report.start} line ${line.expected}: number overlaps code`);
      }
      if (line.foldGap !== null) {
        foldChecks.push({ line: line.expected, gap: line.foldGap });
        if (line.foldGap < 2) {
          failures.push(`block@${report.start} line ${line.expected}: fold chevron is ${line.foldGap}px from the number`);
        }
      }
      if (line.indentGap !== null) {
        foldChecks.push({ line: line.expected, indent: line.indentGap });
        if (line.indentGap < 12) {
          failures.push(`block@${report.start} line ${line.expected}: indent guide is ${line.indentGap}px from the number`);
        }
      }
    }
  }

  const documentText = view.editor.getValue();
  const flatten = reports.flatMap((report) => report.lines.filter((line) => line.rendered && line.value).map((line) => line.value));
  const totalNumbered = flatten.length;

  // An empty fence has no code line, so it must show no number in the editor
  // either (reading mode has no gutter for it).
  const emptyFences = [];
  for (const start of emptyStarts || []) {
    const el = lineElement(start + 2);
    const spans = el
      ? el.querySelectorAll('.aof-ln').length + (el.hasAttribute('data-aof-n') ? 1 : 0)
      : null;
    emptyFences.push({ start, rendered: Boolean(el), spans });
    if (spans) failures.push(`empty fence @${start} was numbered`);
  }

  // v0.4.2 regression: the report was "numbers stick to the text and
  // blink while scrolling". Both came from the number being inline content: it
  // re-flowed the code line whenever CodeMirror mounted it. A top-level fence
  // now reserves its gutter in CSS, so hiding the number must not move the
  // code by a single pixel.
  const textLeftOf = (line) => {
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      if (node.parentElement?.closest('.aof-ln')) continue;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 1);
      return range.getBoundingClientRect().left;
    }
    return null;
  };
  const probeLine = [...view.contentEl.querySelectorAll('.cm-line.aof-ln-line')]
    .find((line) => (line.querySelector('.aof-ln') || line.hasAttribute('data-aof-n'))
      && line.getBoundingClientRect().height > 0);
  let gutterShift = null;
  if (probeLine) {
    const before = textLeftOf(probeLine);
    const hideStyle = document.createElement('style');
    hideStyle.textContent = '.aof-ln{display:none !important} .aof-ln-line::before{content:none !important}';
    document.head.appendChild(hideStyle);
    await wait(140);
    const after = textLeftOf(probeLine);
    hideStyle.remove();
    await wait(140);
    if (before !== null && after !== null) gutterShift = Number((after - before).toFixed(2));
  }
  if (gutterShift !== null && Math.abs(gutterShift) > 0.5) {
    failures.push(`code moved ${gutterShift}px when the number mounted`);
  }

  // A fence inside a blockquote shares its line with the ">" marker, so it must
  // keep the inline number; an absolute one would sit on top of the marker.
  const quoteSpan = [...view.contentEl.querySelectorAll('.cm-line.HyperMD-codeblock .aof-ln')]
    .find((span) => (span.closest('.cm-line')?.textContent || '').trimStart().startsWith('>'));
  const quoteInline = quoteSpan
    ? { position: getComputedStyle(quoteSpan).position, display: getComputedStyle(quoteSpan).display }
    : null;
  if (quoteInline && quoteInline.position !== 'static') {
    failures.push(`quoted fence number is ${quoteInline.position}, not inline`);
  }

  // The indented block in the fixture must produce at least one fold chevron and
  // one indent guide, otherwise the clearance assertions above prove nothing.
  const measuredFolds = foldChecks.filter((check) => check.gap !== undefined).length;
  const measuredIndents = foldChecks.filter((check) => check.indent !== undefined).length;
  if (!measuredFolds) failures.push('no fold chevron was measured, the clearance check did not run');
  if (!measuredIndents) failures.push('no indent guide was measured, the clearance check did not run');

  return {
    pass: failures.length === 0,
    failures,
    mode,
    reports,
    emptyFences,
    totalNumbered,
    gutterShift,
    quoteInline,
    foldChecks,
    documentLength: documentText.length,
    documentHasLineNumbers: /(^|\n)\s*\d+\s{2,}\S/.test(documentText),
  };
}

// Typing, deleting, undo, selection and copy on a numbered block. The document
// text is the source of truth: it must never contain a number.
async function pageEditNumbers(args) {
  const { note, pluginId, target, onSettings } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  let leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) {
    // After a restart the workspace may restore only the first note; open the
    // numbered note on demand instead of failing the phase.
    const file = app.vault.getAbstractFileByPath(note);
    if (!file) throw new Error('note missing: ' + note);
    leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    await wait(900);
  }
  const view = leaf.view;
  await view.setState({ ...view.getState(), mode: 'source', source: false }, {});
  await wait(850);
  await plugin.updateSettings(onSettings);
  await wait(900);
  const cm = view.editor.cm;
  view.editor.scrollIntoView({
    from: { line: target.start + 1, ch: 0 },
    to: { line: target.start + target.count + 1, ch: 0 },
  }, true);
  cm.measure();
  await wait(400);

  function lineElement(lineNumber) {
    if (lineNumber < 1 || lineNumber > cm.state.doc.lines) return null;
    const dom = cm.domAtPos(cm.state.doc.line(lineNumber).from);
    let node = dom.node;
    if (node && node.nodeType !== 1) node = node.parentElement;
    return node ? node.closest('.cm-line') : null;
  }

  function numbersIn(startLine, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const el = lineElement(startLine + 2 + i);
      if (!el) {
        out.push(null);
        continue;
      }
      const attr = el.getAttribute('data-aof-n');
      const spans = [...el.querySelectorAll('.aof-ln')];
      out.push(attr !== null
        ? attr
        : (spans.length ? spans.map((span) => span.textContent).join('|') : null));
    }
    return out;
  }

  const originalText = view.editor.getValue();
  const baseline = numbersIn(target.start, target.count);
  const result = { start: target.start, count: target.count, mode: 'live' };

  // 1. Insert a new first content line: the whole block renumbers from 1.
  view.editor.replaceRange('inserted_line = 0\n', { line: target.start + 1, ch: 0 });
  await wait(650);
  result.afterInsert = numbersIn(target.start, target.count + 1);
  result.insertDocLine = view.editor.getLine(target.start + 1);

  // 2. Undo restores both the text and the numbering.
  view.editor.undo();
  await wait(700);
  result.afterUndo = numbersIn(target.start, target.count);
  result.textAfterUndo = view.editor.getValue() === originalText;

  // 3. Compose-style input (CJK) must not disturb the gutter or the cursor.
  const cjkLine = target.start + 2;
  const cjkCh = view.editor.getLine(cjkLine).length;
  view.editor.replaceRange(' # 中文注释', { line: cjkLine, ch: cjkCh });
  await wait(600);
  result.afterCjk = numbersIn(target.start, target.count);
  result.cjkLineText = view.editor.getLine(cjkLine);
  view.editor.undo();
  await wait(600);

  // 4. Copy must never include the numbers. The phase presses Cmd+C through
  // CDP input events and reads the system clipboard, which exercises the same
  // path as a user copy.
  const firstLine = target.start + 1;
  const lastLine = target.start + 1 + target.count - 1;
  view.editor.setSelection(
    { line: firstLine, ch: 0 },
    { line: lastLine, ch: view.editor.getLine(lastLine).length },
  );
  await wait(250);
  result.selected = view.editor.getSelection();
  view.editor.focus();
  await wait(200);

  view.editor.setCursor({ line: target.start + 2, ch: 0 });
  await wait(200);
  result.cursor = view.editor.getCursor();

  // 5. Turning the feature off removes every widget and leaves the text alone.
  await plugin.updateSettings({ lineNumbers: false });
  await wait(900);
  result.off = {
    spans: view.contentEl.querySelectorAll('.aof-ln, .cm-line[data-aof-n]').length,
    styleText: document.querySelector('style#syntax-palette-line-numbers')?.textContent || '',
    textUnchanged: view.editor.getValue() === originalText,
  };
  await plugin.updateSettings({ lineNumbers: true });
  await wait(900);
  result.onAgain = numbersIn(target.start, target.count);

  const failures = [];
  const expectedBaseline = baseline.map((_, index) => String(index + 1));
  if (JSON.stringify(baseline) !== JSON.stringify(expectedBaseline)) {
    failures.push(`baseline numbering ${JSON.stringify(baseline)}`);
  }
  if (!result.afterInsert || result.afterInsert[0] !== '1' || result.afterInsert[1] !== '2') {
    failures.push(`insert did not renumber: ${JSON.stringify(result.afterInsert)}`);
  }
  if (!result.insertDocLine.includes('inserted_line')) failures.push('inserted text missing');
  if (JSON.stringify(result.afterUndo) !== JSON.stringify(expectedBaseline)) {
    failures.push(`undo did not restore numbering: ${JSON.stringify(result.afterUndo)}`);
  }
  if (!result.textAfterUndo) failures.push('undo did not restore the document');
  if (JSON.stringify(result.afterCjk) !== JSON.stringify(expectedBaseline)) {
    failures.push(`CJK input changed numbering: ${JSON.stringify(result.afterCjk)}`);
  }
  if (!result.cjkLineText.includes('中文注释')) failures.push('CJK input missing');
  if (!result.selected || !result.selected.includes('=')) failures.push('selection does not cover code');
  if (result.cursor?.line !== target.start + 2 || result.cursor?.ch !== 0) {
    failures.push(`cursor moved unexpectedly: ${JSON.stringify(result.cursor)}`);
  }
  if (result.off.spans !== 0) failures.push('widgets survived turning numbers off');
  if (result.off.styleText !== '') failures.push('CSS survived turning numbers off');
  if (!result.off.textUnchanged) failures.push('document changed while toggling');
  if (JSON.stringify(result.onAgain) !== JSON.stringify(expectedBaseline)) {
    failures.push(`re-enabling did not restore numbering: ${JSON.stringify(result.onAgain)}`);
  }

  return { pass: failures.length === 0, failures, ...result };
}

// Select a whole fenced block and focus the editor so a real Cmd+C lands in
// CodeMirror rather than in the page body.
async function pageSelectAndFocus(args) {
  const { note, pluginId, target } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) {
    // After a restart the workspace may restore only the first note; open the
    // numbered note on demand instead of failing the phase.
    const file = app.vault.getAbstractFileByPath(note);
    if (!file) throw new Error('note missing: ' + note);
    leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    await wait(900);
  }
  const view = leaf.view;
  await view.setState({ ...view.getState(), mode: 'source', source: false }, {});
  await wait(700);
  const first = target.start + 1;
  const last = target.start + target.count;
  view.editor.setSelection({ line: first, ch: 0 }, { line: last, ch: view.editor.getLine(last).length });
  view.editor.focus();
  await wait(250);
  return { selected: view.editor.getSelection(), hasFocus: document.hasFocus() };
}

async function pageClipboardText() {
  try {
    return await navigator.clipboard.readText();
  } catch (error) {
    return 'ERROR: ' + (error?.message || error);
  }
}

// Capture what CodeMirror writes into the copy event, independently of whether
// the OS clipboard is readable from the test harness.
async function pageArmCopyProbe() {
  window.__aofCopy = null;
  if (!window.__aofCopyProbe) {
    window.__aofCopyProbe = true;
    document.addEventListener('copy', (event) => {
      const data = event.clipboardData;
      if (!data) return;
      setTimeout(() => { window.__aofCopy = data.getData('text/plain'); }, 0);
    }, true);
  }
  return true;
}

// Disable / enable must leave no DOM or CSS behind, and re-enabling must not
// destroy the reading view (the regression seen during development).
async function pageCleanup(args) {
  const { note, pluginId, onSettings } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let plugin = app.plugins.plugins[pluginId];
  if (!plugin) {
    // A previous run may have left the plugin disabled; that state is stored
    // in the vault, so restore it before testing the disable path again.
    await app.plugins.enablePlugin(pluginId);
    await wait(1400);
    plugin = app.plugins.plugins[pluginId];
  }
  if (!plugin) throw new Error('plugin unavailable');
  let leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) {
    // After a restart the workspace may restore only the first note; open the
    // numbered note on demand instead of failing the phase.
    const file = app.vault.getAbstractFileByPath(note);
    if (!file) throw new Error('note missing: ' + note);
    leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    await wait(900);
  }
  const view = leaf.view;
  await view.setState({ ...view.getState(), mode: 'preview', source: false }, {});
  await wait(900);
  await plugin.updateSettings(onSettings);
  await wait(1100);

  // Disabling a plugin can make Obsidian rebuild the leaf's view instance, so
  // every sample re-resolves the live view instead of trusting a stale one.
  const liveView = () => app.workspace.getLeavesOfType('markdown')
    .find((item) => item.view.file?.path === note)?.view || view;
  const countPres = () => liveView().contentEl.querySelectorAll('pre').length;
  const before = {
    spans: view.contentEl.querySelectorAll('.aof-ln, .cm-line[data-aof-n]').length,
    numberedPres: view.contentEl.querySelectorAll('pre.aof-ln-on').length,
    pres: countPres(),
    fenced: view.contentEl.querySelectorAll('.aof-fenced-block').length,
    mode: view.getState().mode,
    hasPreview: Boolean(view.contentEl.querySelector('.markdown-preview-view')),
  };

  await app.plugins.disablePlugin(pluginId);
  await wait(2200);
  const afterDisable = {
    spans: document.querySelectorAll('.aof-ln, .cm-line[data-aof-n]').length,
    numberedPres: document.querySelectorAll('pre.aof-ln-on').length,
    pres: countPres(),
    fenced: document.querySelectorAll('.aof-fenced-block').length,
    mode: liveView().getState().mode,
    hasPreview: Boolean(liveView().contentEl.querySelector('.markdown-preview-view')),
    viewRebuilt: liveView() !== view,
    fencedLines: document.querySelectorAll('.aof-fenced-line').length,
    lnStyle: document.querySelectorAll('style#syntax-palette-line-numbers').length,
    lnStyleText: document.querySelector('style#syntax-palette-line-numbers')?.textContent || '',
    bgStyleText: document.querySelector('style#syntax-palette-background')?.textContent || '',
    highlightStyleText: document.querySelector('style#syntax-palette-highlight')?.textContent || '',
    readings: [...CSS.highlights.keys()].filter((key) => key.startsWith('aof-reading-')).length,
    bodyHasLineClass: document.body.classList.contains('aof-ln-on'),
  };

  await app.plugins.enablePlugin(pluginId);
  await wait(1800);
  const current = liveView();
  await current.setState({ ...current.getState(), mode: 'preview', source: false }, {});
  await wait(900);
  current.previewMode?.rerender(true);
  await wait(1800);
  const pluginAfter = app.plugins.plugins[pluginId];
  const afterEnable = {
    pres: countPres(),
    numberedPres: liveView().contentEl.querySelectorAll('pre.aof-ln-on').length,
    spans: liveView().contentEl.querySelectorAll('.aof-ln, .cm-line[data-aof-n]').length,
    editorSpans: liveView().contentEl.querySelectorAll('.cm-content .aof-ln, .cm-content .cm-line[data-aof-n]').length,
    mode: liveView().getState().mode,
    hasPreview: Boolean(liveView().contentEl.querySelector('.markdown-preview-view')),
    viewRebuilt: liveView() !== view,
    engineReady: Boolean(pluginAfter?.engineReady),
    lnStyles: document.querySelectorAll('style#syntax-palette-line-numbers').length,
    lnStyleText: pluginAfter?.lineNumberStyle?.textContent || '',
    numberedElements: pluginAfter?.readingNumberElements?.size ?? -1,
  };

  const failures = [];
  if (!before.numberedPres) failures.push('numbers were not visible before disabling');
  if (afterDisable.spans !== 0) failures.push('line number widgets remained after disable');
  if (afterDisable.numberedPres !== 0) failures.push('numbered <pre> remained after disable');
  if (afterDisable.fenced !== 0) failures.push('fenced background classes remained after disable');
  if (afterDisable.fencedLines !== 0) failures.push('fenced line classes remained after disable');
  if (afterDisable.lnStyle !== 0) failures.push('line-number style element remained after disable');
  if (afterDisable.lnStyleText !== '') failures.push('line-number CSS remained after disable');
  if (afterDisable.bgStyleText !== '') failures.push('background CSS remained after disable');
  if (afterDisable.highlightStyleText !== '') failures.push('highlight CSS remained after disable');
  if (afterDisable.readings !== 0) failures.push('CSS highlights remained after disable');
  if (afterDisable.pres === 0) failures.push('reading view lost its code blocks after disable');
  if (!afterEnable.engineReady) failures.push('engine did not start after re-enable');
  if (afterEnable.pres === 0) failures.push('reading view lost its code blocks after re-enable');
  if (!afterEnable.numberedPres) failures.push('numbers did not return after re-enable');
  if (afterEnable.pres < before.pres) failures.push(`reading blocks shrank from ${before.pres} to ${afterEnable.pres}`);
  if (afterEnable.lnStyles !== 1) failures.push(`expected one line-number style element, found ${afterEnable.lnStyles}`);
  if (!afterEnable.lnStyleText) failures.push('line-number CSS missing after re-enable');

  return { pass: failures.length === 0, failures, before, afterDisable, afterEnable };
}

// Narrow desktop-window layout checks. Emulation changes the renderer viewport
// only; Obsidian remains a desktop app throughout this acceptance phase.
async function pageNarrowViewport(args) {
  const { note, pluginId, scrollStart } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) {
    // After a restart the workspace may restore only the first note; open the
    // numbered note on demand instead of failing the phase.
    const file = app.vault.getAbstractFileByPath(note);
    if (!file) throw new Error('note missing: ' + note);
    leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    await wait(900);
  }
  const view = leaf.view;
  // Let the last settings change finish its postprocessor/rescan pass before
  // sampling the DOM.
  await wait(1600);
  const root = view.contentEl.querySelector('.markdown-preview-view') || view.contentEl;
  const numbered = [...root.querySelectorAll('pre.aof-ln-on')];
  const longBlock = numbered.find((pre) => {
    const code = pre.querySelector('code');
    return code && code.clientWidth > 0 && code.scrollWidth > code.clientWidth + 2;
  }) || null;
  const result = {
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      dpr: window.devicePixelRatio,
      visualWidth: window.visualViewport?.width ?? null,
    },
    documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
    viewOverflow: view.contentEl.scrollWidth - view.contentEl.clientWidth,
    paneWidth: Math.round(view.contentEl.getBoundingClientRect().width),
    numberedPres: numbered.length,
    longBlock: null,
  };
  if (longBlock) {
    const code = longBlock.querySelector('code');
    const preStyle = getComputedStyle(longBlock);
    result.longBlock = {
      codeScrollWidth: code.scrollWidth,
      codeClientWidth: code.clientWidth,
      preClientWidth: longBlock.clientWidth,
      preScrollWidth: longBlock.scrollWidth,
      preOverflowX: preStyle.overflowX,
      numberWidth: parseFloat(longBlock.style.getPropertyValue('--aof-ln-numw')),
      gutterGap: parseFloat(longBlock.style.getPropertyValue('--aof-ln-inset')),
    };
  }
  // Gutter must not overlap text on a narrow screen, either.
  let minGap = null;
  for (const pre of numbered) {
    const code = pre.querySelector('code');
    if (!code) continue;
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.nodeValue.trim()) node = walker.nextNode();
    if (!node) continue;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 1);
    const textLeft = range.getBoundingClientRect().left - pre.getBoundingClientRect().left;
    const gutterRight = parseFloat(pre.style.getPropertyValue('--aof-ln-inset'))
      + parseFloat(pre.style.getPropertyValue('--aof-ln-numw'));
    const gap = Number((textLeft - gutterRight).toFixed(2));
    if (minGap === null || gap < minGap) minGap = gap;
  }
  result.minGap = minGap;

  // Editor under the same viewport. Scroll to the first fence so its widgets
  // are inside the rendered viewport.
  await view.setState({ ...view.getState(), mode: 'source', source: false }, {});
  await wait(1200);
  if (typeof scrollStart === 'number') {
    view.editor.scrollIntoView({ from: { line: scrollStart, ch: 0 }, to: { line: scrollStart + 6, ch: 0 } }, true);
    view.editor.cm.measure();
    await wait(600);
  }
  function numberBoxOf(el) {
    const inline = el.querySelector('.aof-ln');
    if (inline) {
      const rect = inline.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }
    if (!el.hasAttribute('data-aof-n')) return null;
    const pseudo = getComputedStyle(el, '::before');
    const rect = el.getBoundingClientRect();
    const left = parseFloat(pseudo.left);
    const width = parseFloat(pseudo.width);
    const top = parseFloat(pseudo.top);
    const height = parseFloat(pseudo.height);
    if (!Number.isFinite(left) || !Number.isFinite(width)) {
      throw new Error('line number ::before box did not resolve to pixels');
    }
    const boxTop = rect.top + (Number.isFinite(top) ? top : 0);
    return {
      left: rect.left + left,
      right: rect.left + left + width,
      top: boxTop,
      bottom: boxTop + (Number.isFinite(height) ? height : 0),
    };
  }
  const numberedLines = [...view.contentEl.querySelectorAll('.cm-line')]
    .map((line) => ({ line, box: numberBoxOf(line) }))
    .filter((item) => item.box && item.box.right - item.box.left > 0);
  const overflow = view.contentEl.scrollWidth - view.contentEl.clientWidth;
  const editorGaps = [];
  for (const item of numberedLines) {
    const line = item.line;
    const anchor = item.box;
    const inlineSpan = line.querySelector('.aof-ln');
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node;
    let left = null;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue) continue;
      if (inlineSpan && !(inlineSpan.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      if (node.parentElement?.closest('.aof-ln')) continue;
      const match = /\S/.exec(node.nodeValue);
      if (!match) continue;
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + 1);
      const rect = range.getBoundingClientRect();
      if (!(rect.bottom > anchor.top + 1 && rect.top < anchor.bottom - 1)) continue;
      left = rect.left;
      break;
    }
    if (left === null) continue;
    editorGaps.push(Number((left - anchor.right).toFixed(2)));
  }
  result.editor = {
    mode: view.getState().mode,
    spans: numberedLines.length,
    overflow,
    minGap: editorGaps.length ? Math.min(...editorGaps) : null,
    clip: view.contentEl.getBoundingClientRect().right <= window.innerWidth + 1,
  };

  const failures = [];
  if (result.documentOverflow > 1) failures.push(`document overflows horizontally by ${result.documentOverflow}px`);
  if (result.viewOverflow > 1) failures.push(`note view overflows horizontally by ${result.viewOverflow}px`);
  if (!result.numberedPres) failures.push('no numbered blocks at narrow width');
  if (result.minGap === null || result.minGap < 0.5) failures.push(`gutter overlaps text at narrow width (${result.minGap})`);
  if (result.longBlock && !(result.longBlock.codeScrollWidth > result.longBlock.codeClientWidth)) {
    failures.push('long line does not scroll inside the block');
  }
  if (result.editor.spans === 0) failures.push('no visible editor numbers at narrow width');
  if (result.editor.minGap === null) failures.push('editor number spacing could not be measured');
  if (result.editor.overflow > 1) failures.push(`editor overflows horizontally by ${result.editor.overflow}px`);
  if (result.editor.minGap !== null && result.editor.minGap < 0) failures.push('editor numbers overlap code');
  return { pass: failures.length === 0, failures, ...result };
}

// Returns viewport-relative rects for four token kinds. Node then screenshots
// the window and samples pixels, which is the only evidence that a token is
// actually painted in the theme colour.
async function pagePixelSamples(args) {
  const { note, pluginId, mode, appearance, themeId } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const file = app.vault.getAbstractFileByPath(note);
  if (!file) throw new Error('Test note not found: ' + note);
  let leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) {
    leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
  } else {
    await app.workspace.revealLeaf(leaf);
  }
  const view = leaf.view;
  const plugin = app.plugins.plugins[pluginId];
  if (!plugin) throw new Error('plugin not loaded');

  const currentAppearance = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
  if (currentAppearance !== appearance) {
    app.commands.executeCommandById('theme:toggle-light-dark');
    await wait(650);
  }
  const patch = { lineNumbers: false, coloredBrackets: false };
  if (appearance === 'light') patch.light = themeId;
  else patch.dark = themeId;
  await plugin.updateSettings(patch);
  await view.setState({ ...view.getState(), mode, source: mode === 'source' }, {});
  await wait(800);

  const text = view.editor.getValue();
  const lines = text.split('\n');
  const blocks = [];
  let openFence = null;
  for (let i = 0; i < lines.length; i++) {
    const match = /^```(\S*)\s*$/.exec(lines[i]);
    if (!openFence && match) {
      openFence = { language: match[1] || '', start: i };
      continue;
    }
    if (openFence && /^```\s*$/.test(lines[i])) {
      blocks.push({ ...openFence, end: i, contentStart: openFence.start + 1, contentEnd: i });
      openFence = null;
    }
  }
  const python = blocks.find((block) => block.language === 'python');
  if (!python) throw new Error('python block not found');
  const blockText = lines.slice(python.contentStart, python.contentEnd).join('\n');
  const needles = { comment: '# python comment', keyword: 'def', string: 'hello', number: '42' };
  const samples = {};

  if (mode === 'preview') {
    // The preview pane re-renders asynchronously and, on a vault that has just
    // been through several other phases (or a plugin reload), 800ms is not
    // always enough for the code block to exist. Poll, and re-issue the mode
    // switch if the pane never materialises, because a setState that lands
    // during a re-render can be swallowed.
    const findPre = () => [...document.querySelectorAll('.markdown-rendered pre')]
      .find((item) => item.textContent.includes('# python comment') && item.textContent.includes('def'));
    let pre = findPre();
    for (let attempt = 0; attempt < 30 && !pre; attempt++) {
      if (attempt === 10 || attempt === 20) {
        await view.setState({ ...view.getState(), mode, source: false }, {});
      }
      await wait(400);
      pre = findPre();
    }
    if (!pre) {
      const diagnostics = {
        requestedMode: mode,
        stateMode: view.getState?.().mode,
        previewPanes: document.querySelectorAll('.markdown-preview-view').length,
        preCount: document.querySelectorAll('.markdown-rendered pre').length,
        bodyClass: document.body.className,
      };
      throw new Error('python pre not found in reading view: ' + JSON.stringify(diagnostics));
    }
    pre.scrollIntoView({ block: 'center' });
    await wait(500);
    const code = pre.querySelector('code');
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let offset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      nodes.push({ node, from: offset, to: offset + node.length });
      offset += node.length;
    }
    const full = code.textContent;
    for (const [kind, needle] of Object.entries(needles)) {
      const index = full.indexOf(needle);
      if (index < 0) continue;
      const first = nodes.find((node) => node.from <= index && node.to > index);
      const last = nodes.find((node) => node.from < index + needle.length && node.to >= index + needle.length);
      if (!first || !last) continue;
      const range = document.createRange();
      range.setStart(first.node, index - first.from);
      range.setEnd(last.node, index + needle.length - last.from);
      const rect = range.getBoundingClientRect();
      samples[kind] = {
        left: rect.left, top: rect.top, width: rect.width, height: rect.height,
        text: range.toString(),
        nodeParent: last.node.parentElement?.className || '',
      };
    }
  } else {
    const cm = view.editor.cm;
    view.editor.scrollIntoView({ from: { line: python.start + 1, ch: 0 }, to: { line: python.end - 1, ch: 0 } }, true);
    cm.measure();
    await wait(450);
    const base = view.editor.posToOffset({ line: python.contentStart, ch: 0 });
    for (const [kind, needle] of Object.entries(needles)) {
      const index = blockText.indexOf(needle);
      if (index < 0) continue;
      const from = cm.coordsAtPos(base + index);
      const to = cm.coordsAtPos(base + index + needle.length);
      if (!from) continue;
      samples[kind] = {
        left: from.left,
        top: from.top,
        width: Math.max(1, (to?.left ?? from.right) - from.left),
        height: from.bottom - from.top,
        text: needle,
        nodeParent: '',
      };
    }
  }

  return {
    mode,
    appearance,
    themeId,
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    highlightMode: plugin.highlightMode,
    highlightSupported: plugin.highlightSupported,
    engineReady: Boolean(plugin.engineReady),
    fallbackSpans: document.querySelectorAll('span[class*="aof-token-"]').length,
    samples,
  };
}

// Simulates an older WebKit that has no CSS Custom Highlight API by hiding the
// registry, then reloads the plugin so it picks the compatibility renderer.
async function pageToggleHighlightApi(args) {
  const { pluginId, available } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  if (!('__aofHighlightsDescriptor' in window)) {
    window.__aofHighlightsDescriptor = Object.getOwnPropertyDescriptor(CSS, 'highlights') || null;
  }
  const descriptor = window.__aofHighlightsDescriptor;
  if (available) {
    if (descriptor) Object.defineProperty(CSS, 'highlights', descriptor);
    else delete CSS.highlights;
  } else {
    try {
      Object.defineProperty(CSS, 'highlights', { configurable: true, enumerable: true, get: () => undefined });
    } catch (error) {
      delete CSS.highlights;
    }
  }
  const before = app.plugins.plugins[pluginId];
  await app.plugins.disablePlugin(pluginId);
  await wait(900);
  const during = app.plugins.plugins[pluginId];
  await app.plugins.enablePlugin(pluginId);
  await wait(1800);
  const plugin = app.plugins.plugins[pluginId];
  return {
    apiAvailable: Boolean(CSS.highlights),
    mode: plugin?.highlightMode,
    supported: plugin?.highlightSupported,
    ready: Boolean(plugin?.engineReady),
    error: plugin?.engineError ? String(plugin.engineError.message || plugin.engineError) : null,
    reinstantiated: Boolean(before) && before !== plugin,
    unloaded: !during,
  };
}

async function pageNumberPerformance(args) {
  const { note, pluginId, iterations } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  let leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) {
    // After a restart the workspace may restore only the first note; open the
    // numbered note on demand instead of failing the phase.
    const file = app.vault.getAbstractFileByPath(note);
    if (!file) throw new Error('note missing: ' + note);
    leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    await wait(900);
  }
  const view = leaf.view;
  await view.setState({ ...view.getState(), mode: 'preview', source: false }, {});
  await wait(900);
  await plugin.updateSettings({ lineNumbers: false });
  await wait(800);

  const toggleOn = [];
  const toggleOff = [];
  for (let index = 0; index < iterations; index++) {
    let started = performance.now();
    await plugin.updateSettings({ lineNumbers: true });
    toggleOn.push(Number((performance.now() - started).toFixed(1)));
    started = performance.now();
    await plugin.updateSettings({ lineNumbers: false });
    toggleOff.push(Number((performance.now() - started).toFixed(1)));
  }
  await plugin.updateSettings({ lineNumbers: true });
  await wait(1200);

  const measure = [];
  for (let index = 0; index < iterations; index++) {
    plugin.resetReadingLineNumberGeometry();
    const started = performance.now();
    plugin.measureReadingLineNumbers();
    measure.push(Number((performance.now() - started).toFixed(1)));
  }

  const memory = performance.memory ? {
    used: performance.memory.usedJSHeapSize,
    total: performance.memory.totalJSHeapSize,
  } : null;
  const root = view.contentEl.querySelector('.markdown-preview-view') || view.contentEl;
  return {
    blocks: root.querySelectorAll('pre').length,
    numbered: root.querySelectorAll('pre.aof-ln-on').length,
    toggleOn,
    toggleOff,
    measure,
    memory,
    styleLength: plugin.lineNumberStyle?.textContent.length || 0,
  };
}

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

// Numbering plan derived from the fixture with the same parsers the plugin
// uses, so expectations are independent of the rendered DOM.
function readingPlan(text) {
  const blocks = allFencedBlocks(text);
  const tokens = codeBlockTokens(text);
  return {
    tokens: tokens.map((token) => {
      const block = token.fenced ? blocks.find((item) => item.start === token.start) : null;
      const numbering = token.fenced
        ? readingNumbering(block ? block.text : token.text)
        : { count: 0, text: '', widthClass: 'aof-ln-w1' };
      return {
        fenced: token.fenced,
        language: token.language,
        start: token.start,
        end: token.end,
        numbered: token.fenced && numbering.count > 0,
        count: numbering.count,
        gutter: numbering.text,
        widthClass: numbering.widthClass,
        sourceText: block ? block.text : token.text,
      };
    }),
  };
}

function editorTargets(text) {
  const blocks = allFencedBlocks(text).filter((block) => block.positions.length > 0);
  const targets = [];
  const seen = new Set();
  for (const block of blocks) {
    if (block.text === '') continue;
    if (block.positions.length <= 6) {
      targets.push({ start: block.start, count: block.positions.length });
      seen.add(block.start);
    }
  }
  const longest = blocks.reduce((best, block) => (
    !best || block.positions.length > best.positions.length ? block : best
  ), null);
  if (longest && longest.text !== '' && !seen.has(longest.start)) {
    targets.push({ start: longest.start, count: longest.positions.length, sampleFromEnd: true, limit: 10 });
  }
  return targets;
}

function emptyFenceStarts(text) {
  return allFencedBlocks(text).filter((block) => block.text === '').map((block) => block.start);
}

async function phaseLineNumberReading(context) {
  const text = fs.readFileSync(NUMBER_NOTE_PATH, 'utf8');
  const plan = readingPlan(text);
  const args = {
    note: NUMBER_NOTE,
    pluginId: PLUGIN_ID,
    plan,
    offSettings: { lineNumbers: false },
    onSettings: { lineNumbers: true, codeBlockBackground: true },
  };
  await setAppearance(context.main, 'light');
  await wait(700);
  const light = await context.main.eval(`(${pageReadingNumbers})(${JSON.stringify(args)})`);
  await context.main.eval(`(() => {
    const leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === ${JSON.stringify(NUMBER_NOTE)});
    leaf?.view.contentEl.querySelector('.markdown-preview-view')?.scrollTo({ top: 0 });
    return true;
  })()`);
  await wait(400);
  await context.main.screenshot(path.join(EVIDENCE, 'line-numbers-reading-light.png'));

  await setAppearance(context.main, 'dark');
  await wait(900);
  const dark = await context.main.eval(`(${pageReadingNumbers})(${JSON.stringify(args)})`);
  await context.main.screenshot(path.join(EVIDENCE, 'line-numbers-reading-dark.png'));
  await setAppearance(context.main, 'light');
  await wait(500);

  await setSettings(context.main, { ...DESIRED, lineNumbers: false });
  await wait(700);

  const lightTheme = themeCatalog.getTheme('github-light-default');
  const darkTheme = themeCatalog.getTheme('tokyo-night-storm');
  const failures = [...light.failures, ...dark.failures];
  const rgb = (hex) => {
    const value = hex.replace('#', '');
    return `rgb(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)})`;
  };
  if (light.on.appearance !== 'light') failures.push(`light run rendered in ${light.on.appearance} appearance`);
  if (dark.on.appearance !== 'dark') failures.push(`dark run rendered in ${dark.on.appearance} appearance`);
  if (light.on.sampleBackground !== rgb(lightTheme.background)) {
    failures.push(`light block background ${light.on.sampleBackground} != ${rgb(lightTheme.background)}`);
  }
  if (dark.on.sampleBackground !== rgb(darkTheme.background)) {
    failures.push(`dark block background ${dark.on.sampleBackground} != ${rgb(darkTheme.background)}`);
  }
  const crypto = require('node:crypto');
  const hashOf = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (hashOf(path.join(EVIDENCE, 'line-numbers-reading-light.png')) === hashOf(path.join(EVIDENCE, 'line-numbers-reading-dark.png'))) {
    failures.push('light and dark screenshots are identical');
  }
  if (!light.on.backgroundStyleText.includes(lightTheme.background.toUpperCase())) {
    failures.push('light background CSS does not use the selected light theme');
  }
  if (!dark.on.backgroundStyleText.includes(darkTheme.background.toUpperCase())) {
    failures.push('dark background CSS does not use the selected dark theme');
  }
  return {
    pass: failures.length === 0,
    failures,
    blocks: light.mapped,
    light: { failures: light.failures, styleLength: light.on.styleText.length, numberedPres: light.on.numberedPres, fencedPres: light.on.fencedPres },
    dark: { failures: dark.failures, styleLength: dark.on.styleText.length, numberedPres: dark.on.numberedPres, fencedPres: dark.on.fencedPres },
    expected: { lightBackground: lightTheme.background, darkBackground: darkTheme.background },
  };
}

async function phaseLineNumberEditor(context) {
  const text = fs.readFileSync(NUMBER_NOTE_PATH, 'utf8');
  const targets = editorTargets(text);
  const result = { pass: true, failures: [], targets: targets.map((target) => [target.start, target.count]), modes: {} };
  await setAppearance(context.main, 'light');
  await wait(600);
  result.appearance = await context.main.eval(`document.body.classList.contains('theme-dark') ? 'dark' : 'light'`);
  if (result.appearance !== 'light') {
    result.pass = false;
    result.failures.push(`editor phase rendered in ${result.appearance} appearance`);
  }
  for (const mode of ['live', 'source']) {
    const data = await context.main.eval(`(${pageEditorNumbers})(${JSON.stringify({
      note: NUMBER_NOTE,
      pluginId: PLUGIN_ID,
      targets,
      mode,
      onSettings: { lineNumbers: true },
      emptyStarts: emptyFenceStarts(text),
    })})`);
    result.modes[mode] = data;
    if (!data.pass) {
      result.pass = false;
      result.failures.push(...data.failures.map((failure) => `${mode}: ${failure}`));
    }
  }
  await context.main.screenshot(path.join(EVIDENCE, 'line-numbers-editor-live.png'));
  await setSettings(context.main, { ...DESIRED, lineNumbers: false });
  await wait(700);
  return result;
}

async function phaseLineNumberEditing(context) {
  const text = fs.readFileSync(NUMBER_NOTE_PATH, 'utf8');
  const block = allFencedBlocks(text)[0];
  const target = { start: block.start, count: block.positions.length };
  const data = await context.main.eval(`(${pageEditNumbers})(${JSON.stringify({
    note: NUMBER_NOTE,
    pluginId: PLUGIN_ID,
    target,
    onSettings: { lineNumbers: true },
  })})`);

  // Real clipboard copy: focus the editor, select the block, press Cmd+C via
  // the DevTools input domain and read the system clipboard back.
  const selected = await context.main.eval(`(${pageSelectAndFocus})(${JSON.stringify({
    note: NUMBER_NOTE,
    pluginId: PLUGIN_ID,
    target,
  })})`);
  let clipboard = null;
  try {
    await context.main.send('Browser.grantPermissions', {
      origin: 'app://obsidian.md',
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    });
  } catch (error) {
    clipboard = 'GRANT-FAILED: ' + error.message;
  }
  await context.main.send('Page.bringToFront').catch(() => {});
  await context.main.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await context.main.eval(`(${pageArmCopyProbe})()`);
  const key = { key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 8, modifiers: 4 };
  await context.main.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key, commands: ['copy'] });
  await context.main.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  await wait(700);
  const clipboardEventText = await context.main.eval('window.__aofCopy');
  clipboard = await context.main.eval(`(${pageClipboardText})()`);
  if (clipboardEventText && clipboard !== clipboardEventText) clipboard = clipboardEventText;

  const copyPass = typeof clipboard === 'string' &&
    clipboard.trimEnd() === selected.selected.trimEnd() &&
    !/(^|\n)\s*\d+\s{2,}\S/.test(clipboard);
  await context.main.screenshot(path.join(EVIDENCE, 'line-numbers-editing.png'));
  await setSettings(context.main, { ...DESIRED, lineNumbers: false });
  await wait(700);
  return {
    ...data,
    pass: data.pass && copyPass,
    failures: copyPass ? data.failures : [...data.failures, 'clipboard copy includes numbers or differs from the selection'],
    clipboard,
    clipboardSelected: selected.selected,
    clipboardVerified: copyPass,
  };
}

async function phaseLineNumberSettings(context) {
  await closeSettings(context.main);
  await setAppearance(context.main, 'light');
  await setSettings(context.main, { ...DESIRED, lineNumbers: false });
  await wait(700);
  const settingsPage = await openSettings(context.main);
  context.settingsPage = settingsPage;
  // Settings open in a separate desktop window, so constrain that renderer
  // independently when checking the narrow-window layout.
  try {
    await settingsPage.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
  } catch (error) {
    // Emulation is best effort; the measurement below records the real width.
  }
  await wait(900);
  await setSettingsPageBody(settingsPage, 'light');
  const initial = await settingsSnapshot(settingsPage);

  await clickSettingsToggle(settingsPage, '显示代码块行号');
  await wait(1400);
  const on = await readPluginState(context.main);
  const onUi = await settingsSnapshot(settingsPage);
  await settingsPage.screenshot(path.join(EVIDENCE, 'line-numbers-settings-on.png'));

  await clickSettingsToggle(settingsPage, '显示代码块行号');
  await wait(1400);
  const off = await readPluginState(context.main);
  const offUi = await settingsSnapshot(settingsPage);
  await closeSettings(context.main);

  const again = await setSettings(context.main, { ...DESIRED, lineNumbers: true });
  await wait(900);
  const modal = await commandModalSnapshot(context);
  await modal.page.screenshot(path.join(EVIDENCE, 'line-numbers-command-modal.png'));
  const modalOn = modal.snapshot.toggleValues[1];
  await modal.page.eval(`(() => {
    const modal = document.querySelector('.aof-theme-modal');
    const cancel = [...modal.querySelectorAll('button')].find((button) => button.textContent === '取消');
    cancel?.click();
    return true;
  })()`);
  await wait(500);
  modal.page.close();
  const afterModal = await readPluginState(context.main);
  await setSettings(context.main, { ...DESIRED, lineNumbers: false });
  await wait(700);

  const failures = [];
  const initialStatus = (initial.status || '').replace(/\s+/g, '');
  const onStatus = (onUi.status || '').replace(/\s+/g, '');
  if (initial.toggleNames.length !== 4) failures.push(`expected 4 toggles, found ${initial.toggleNames.length}`);
  if (!initial.toggleNames.some((name) => name.includes('显示代码块行号'))) failures.push('line number toggle missing');
  if (!initial.toggleNames.some((name) => name.includes('编辑视图代码块自动换行'))) failures.push('wrap toggle missing');
  if (initial.toggleValues[1] !== false) failures.push('line number toggle should default to off');
  if (initial.toggleValues[2] !== false) failures.push('wrap toggle should default to off');
  if (!initialStatus.includes('代码行号：关闭')) failures.push('status does not report line numbers off');
  if (!initialStatus.includes('编辑视图换行：不换行（横向滚动）')) failures.push('status does not report wrapping off');
  if (on.settings.lineNumbers !== true) failures.push('toggle did not enable the setting');
  if (!on.lineNumberCss) failures.push('toggle did not inject CSS');
  if (onUi.toggleValues[1] !== true) failures.push('toggle did not reflect the new value');
  if (!onStatus.includes('代码行号：开启')) failures.push('status did not update');
  if (off.settings.lineNumbers !== false) failures.push('toggle did not disable the setting');
  if (off.lineNumberCss !== '') failures.push('CSS was not removed when disabled');
  if (offUi.toggleValues[1] !== false) failures.push('toggle did not return to off');
  if (!again?.lineNumbers) failures.push('setting did not persist');
  if (!afterModal?.settings?.lineNumbers) failures.push('setting lost after closing the theme modal');
  if (modalOn !== true) failures.push('command modal did not reflect the saved value');

  // The wrap switch must behave the same way through the real settings UI:
  // ON removes the no-wrap rules (stock Obsidian wrapping), OFF restores them,
  // and the reading view never carries a wrap rule of its own.
  const wrapOn = await setSettings(context.main, { wrapCodeBlocks: true });
  await wait(800);
  const wrapOnState = await readPluginState(context.main);
  const wrapOff = await setSettings(context.main, { wrapCodeBlocks: false });
  await wait(800);
  const wrapOffState = await readPluginState(context.main);
  if (wrapOn.wrapCodeBlocks !== true) failures.push('wrap setting did not enable');
  if (wrapOnState.wrapCss !== '') failures.push('wrap CSS was not emptied when wrapping is enabled');
  if (wrapOff.wrapCodeBlocks !== false) failures.push('wrap setting did not disable');
  if (!wrapOffState.wrapCss.includes('white-space: pre')) failures.push('wrap CSS missing the no-wrap rule');
  if (!wrapOffState.wrapCss.includes('overflow-x: auto')) failures.push('wrap CSS missing the horizontal scroller');
  if (wrapOffState.wrapStyles !== 1) failures.push(`expected one wrap style node, found ${wrapOffState.wrapStyles}`);
  if (/markdown-preview-view/.test(wrapOffState.wrapCss)) failures.push('wrap CSS targets the reading view');

  return {
    pass: failures.length === 0,
    failures,
    initial,
    on,
    off,
    onUi,
    offUi,
    modalOn,
    saved: again || null,
    afterModal: afterModal?.settings || null,
    wrap: {
      on: wrapOnState?.settings?.wrapCodeBlocks,
      onCssLength: wrapOnState?.wrapCss?.length ?? null,
      off: wrapOffState?.settings?.wrapCodeBlocks,
      offCssLength: wrapOffState?.wrapCss?.length ?? null,
      styleNodes: wrapOffState?.wrapStyles ?? null,
    },
  };
}

async function phaseNarrowViewport(context) {
  const text = fs.readFileSync(NUMBER_NOTE_PATH, 'utf8');
  const plan = readingPlan(text);
  await closeSettings(context.main);
  await setAppearance(context.main, 'light');
  await setSettings(context.main, { ...DESIRED, lineNumbers: true, codeBlockBackground: true });
  await wait(800);

  // Collapse both sidebars before constraining the desktop viewport so this
  // remains a useful narrow-window layout regression instead of testing pane
  // widths consumed by the workspace chrome.
  await context.main.eval(`(() => {
    app.workspace.leftSplit?.collapse?.();
    app.workspace.rightSplit?.collapse?.();
    return true;
  })()`);
  await context.main.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 390,
    screenHeight: 844,
  });
  await wait(1400);

  const reading = await context.main.eval(`(${pageReadingNumbers})(${JSON.stringify({
    note: NUMBER_NOTE,
    pluginId: PLUGIN_ID,
    plan,
    offSettings: { lineNumbers: false },
    onSettings: { lineNumbers: true, codeBlockBackground: true },
  })})`);
  const firstFence = allFencedBlocks(text).find((block) => block.positions.length > 0);
  const layout = await context.main.eval(`(${pageNarrowViewport})(${JSON.stringify({
    note: NUMBER_NOTE,
    pluginId: PLUGIN_ID,
    scrollStart: firstFence ? firstFence.start + 1 : 0,
  })})`);
  await context.main.screenshot(path.join(EVIDENCE, 'narrow-viewport-editor.png'));

  const settingsPage = await openSettings(context.main);
  context.settingsPage = settingsPage;
  // Settings open in a separate desktop window, so constrain that renderer
  // independently when checking the narrow-window layout.
  try {
    await settingsPage.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
  } catch (error) {
    // Emulation is best effort; the measurement below records the real width.
  }
  await wait(900);
  await setSettingsPageBody(settingsPage, 'light');
  const settingsLayout = await settingsPage.eval(`(() => {
    const root = document.querySelector('.aof-settings');
    const items = [...root.querySelectorAll('.setting-item')];
    const toggles = items
      .filter((item) => item.querySelector('input[type=checkbox]'))
      .map((item) => {
        const box = item.querySelector('.checkbox-container');
        const rect = box.getBoundingClientRect();
        return {
          name: item.querySelector('.setting-item-name')?.textContent,
          width: Number(rect.width.toFixed(1)),
          height: Number(rect.height.toFixed(1)),
          right: Number(rect.right.toFixed(1)),
        };
      });
    return {
      viewport: window.innerWidth,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      rootWidth: Number(root.getBoundingClientRect().width.toFixed(1)),
      itemOverflow: Number(Math.max(...items.map((item) => item.getBoundingClientRect().right - window.innerWidth)).toFixed(1)),
      toggles,
      selectWidths: [...root.querySelectorAll('select:not(.is-measuring)')].map((select) => Number(select.getBoundingClientRect().width.toFixed(1))),
    };
  })()`);
  await settingsPage.screenshot(path.join(EVIDENCE, 'narrow-viewport-settings.png'));
  await closeSettings(context.main);

  // Rapid light/dark switching while numbers are visible.
  const sweep = await context.main.eval(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === ${JSON.stringify(NUMBER_NOTE)});
    const view = leaf.view;
    await view.setState({ ...view.getState(), mode: 'preview', source: false }, {});
    await wait(900);
    const resolve = (name) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(' + name + ')';
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };
    const out = [];
    for (let round = 0; round < 4; round++) {
      const wasDark = document.body.classList.contains('theme-dark');
      app.commands.executeCommandById('theme:toggle-light-dark');
      await wait(900);
      if (document.body.classList.contains('theme-dark') === wasDark) {
        app.commands.executeCommandById('theme:toggle-light-dark');
        await wait(700);
      }
      plugin.resetReadingLineNumberGeometry();
      await wait(400);
      const pres = [...view.contentEl.querySelectorAll('pre.aof-ln-on')];
      let maxDelta = 0;
      let gutterColor = null;
      let textColor = null;
      for (const pre of pres) {
        gutterColor = getComputedStyle(pre, '::before').color;
        const code = pre.querySelector('code');
        if (code) textColor = getComputedStyle(code).color;
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node && !node.nodeValue.trim()) node = walker.nextNode();
        if (!node) continue;
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 1);
        const preRect = pre.getBoundingClientRect();
        const top = range.getBoundingClientRect().top - preRect.top;
        const gutterTop = parseFloat(pre.style.getPropertyValue('--aof-ln-top'));
        const delta = Math.abs(top - gutterTop);
        if (delta > maxDelta) maxDelta = delta;
      }
      out.push({
        round,
        dark: document.body.classList.contains('theme-dark'),
        numbered: pres.length,
        maxDelta: Number(maxDelta.toFixed(2)),
        gutterColor,
        textColor,
        faint: resolve('--text-faint'),
      });
    }
    return out;
  })()`);
  await context.main.screenshot(path.join(EVIDENCE, 'narrow-viewport-reading.png'));

  await context.main.clearEmulation();
  await setAppearance(context.main, 'light');
  await setSettings(context.main, { ...DESIRED, lineNumbers: false });
  await wait(700);

  const failures = [];
  const paneWidth = layout.paneWidth;
  if (paneWidth < 300) failures.push(`note pane too narrow for this layout fixture (${paneWidth}px)`);
  failures.push(...reading.failures.map((failure) => `reading: ${failure}`));
  failures.push(...layout.failures.map((failure) => `layout: ${failure}`));
  if (settingsLayout.overflow > 1) failures.push(`settings overflow by ${settingsLayout.overflow}px`);
  if (settingsLayout.itemOverflow > 1) failures.push(`settings rows overflow by ${settingsLayout.itemOverflow}px`);
  if (settingsLayout.rootWidth > settingsLayout.viewport) failures.push('settings panel wider than the viewport');
  for (const toggle of settingsLayout.toggles) {
    // Obsidian's own checkbox is 20px tall; the plugin must not shrink it.
    if (toggle.height < 18) failures.push(`toggle ${toggle.name} too small (${toggle.height}px)`);
    if (toggle.width < 36) failures.push(`toggle ${toggle.name} too narrow (${toggle.width}px)`);
  }
  for (const round of sweep) {
    if (!round.numbered) failures.push('numbers vanished during light/dark switching');
    if (round.maxDelta > 3) failures.push(`numbers shifted ${round.maxDelta}px after theme switch`);
    // v0.4.2: the gutter is theme derived, so it must differ from the code
    // colour instead of being pinned to a fixed grey that vanishes on themes
    // such as Solarized.
    if (round.gutterColor === round.textColor) failures.push(`gutter color ${round.gutterColor} equals the code colour`);
    if (!round.gutterColor || round.gutterColor === 'rgba(0, 0, 0, 0)') failures.push('gutter has no colour');
  }
  const lightRounds = sweep.filter((round) => !round.dark);
  const darkRounds = sweep.filter((round) => round.dark);
  if (lightRounds.length && darkRounds.length) {
    const lightColor = lightRounds[0].gutterColor;
    const darkColor = darkRounds[0].gutterColor;
    if (lightColor === darkColor) failures.push('gutter colour did not follow the appearance');
  }

  return {
    pass: failures.length === 0,
    failures,
    readingPass: reading.pass,
    paneWidth,
    layout,
    settingsLayout,
    sweep,
    runtime: await readPluginState(context.main).then((state) => ({ wasmSource: state?.wasmSource, highlightSupported: state?.highlightSupported })),
    evidenceLevel: 'desktop-narrow-viewport',
  };
}

async function phaseLineNumberPerformance(context) {
  const data = await context.main.eval(`(${pageNumberPerformance})(${JSON.stringify({
    note: NUMBER_NOTE,
    pluginId: PLUGIN_ID,
    iterations: 6,
  })})`);
  await setSettings(context.main, { ...DESIRED, lineNumbers: false });
  await wait(700);
  const toggleOn = average(data.toggleOn);
  const toggleOff = average(data.toggleOff);
  const measure = average(data.measure);
  const pass = data.numbered > 0 &&
    data.styleLength > 0 &&
    toggleOn !== null && toggleOn < 900 &&
    toggleOff !== null && toggleOff < 900 &&
    measure !== null && measure < 120;
  return {
    pass,
    blocks: data.blocks,
    numbered: data.numbered,
    toggleOn,
    toggleOff,
    measure,
    samples: { toggleOn: data.toggleOn, toggleOff: data.toggleOff, measure: data.measure },
    memory: data.memory,
    styleLength: data.styleLength,
    thresholds: { toggleMs: 900, measureMs: 120 },
  };
}

async function phaseCleanup(context) {
  const data = await context.main.eval(`(${pageCleanup})(${JSON.stringify({
    note: NUMBER_NOTE,
    pluginId: PLUGIN_ID,
    onSettings: { lineNumbers: true },
  })})`);
  return data;
}

async function phaseLineNumberPersistence(context) {
  await setSettings(context.main, { ...DESIRED, lineNumbers: true });
  await wait(900);
  const saved = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  await killIsolatedObsidian();
  context.main.close();
  context.main = await launchIsolatedObsidian();
  const prepared = await context.main.eval(`(${pagePrepare})(${JSON.stringify({ note: NOTE, pluginId: PLUGIN_ID })})`);
  const after = await context.main.eval(`(${pageVerifyAfterRestart})(${JSON.stringify({ note: NUMBER_NOTE, pluginId: PLUGIN_ID })})`);
  await context.main.screenshot(path.join(EVIDENCE, 'line-numbers-after-restart.png'));
  await setSettings(context.main, { ...DESIRED, lineNumbers: false });
  await wait(700);

  const failures = [];
  if (saved.lineNumbers !== true) failures.push('lineNumbers was not written to data.json');
  if (prepared.pluginVersion !== EXPECTED_VERSION) failures.push('wrong plugin version after restart');
  if (!after.settings || after.settings.lineNumbers !== true) failures.push('lineNumbers did not survive a restart');
  if (!after.engineReady) failures.push('engine not ready after restart');
  if (!String(after.wasmSource || '').startsWith('adapter')) failures.push(`wasm loaded from ${after.wasmSource}`);
  if (!after.numberedPres) failures.push('numbers missing after restart');
  if (!after.firstGutter.startsWith('1')) failures.push('numbering does not restart at 1');
  if (!after.lineNumberCss) failures.push('CSS missing after restart');
  return { pass: failures.length === 0, failures, saved, prepared, after };
}


// v0.4.4 regressions.
// (1) Toggling line numbers used to clear every editor highlight range and
//     rebuild it through one asynchronous measure; when that measure was
//     swallowed the code stayed in Obsidian's native colours until a restart.
//     A layout-only switch must now leave the highlight registers untouched.
// (2) The scroll optimisation must not leave newly shown lines uncoloured:
//     every visible code line needs at least one live highlight range at any
//     scroll position inside a tall block.
async function pageHighlightStability(args) {
  const { note, pluginId } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  const failures = [];
  const lines = ['intro', '\`\`\`python'];
  for (let i = 1; i <= 160; i++) lines.push('value_' + i + ' = ' + i + ' + compute(' + i + ')');
  lines.push('\`\`\`', 'tail');
  const text = lines.join('\n');
  const existing = app.vault.getAbstractFileByPath(note);
  if (existing) await app.vault.modify(existing, text);
  else await app.vault.create(note, text);
  let leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) {
    leaf = app.workspace.getLeaf(false);
    await leaf.openFile(app.vault.getAbstractFileByPath(note));
  }
  await wait(900);
  const view = leaf.view;
  await view.setState({ ...view.getState(), mode: 'source', source: false }, {});
  await wait(700);
  const cm = view.editor.cm;

  const snapshot = () => {
    const entries = plugin.editorRanges.get(cm) || [];
    const style = plugin.readingStyle ? plugin.readingStyle.textContent : '';
    return {
      entries: entries.length,
      styleLength: style.length,
      styleRules: style ? style.split('}').filter((part) => part.trim()).length : 0,
      paletteKeys: [...CSS.highlights.keys()].filter((key) => key.startsWith('aof-')).length,
    };
  };

  await plugin.updateSettings({ lineNumbers: true });
  cm.scrollDOM.scrollTop = 0;
  cm.measure();
  await wait(900);
  const before = snapshot();
  if (!before.entries) failures.push('no highlight ranges before toggling');

  for (const enabled of [false, true, false, true]) {
    await plugin.updateSettings({ lineNumbers: enabled });
    await wait(750);
    const after = snapshot();
    if (!after.entries) failures.push('lineNumbers=' + enabled + ': every highlight range was dropped');
    if (after.styleLength !== before.styleLength) {
      failures.push('lineNumbers=' + enabled + ': highlight CSS length changed ' + before.styleLength + ' -> ' + after.styleLength);
    }
    if (after.styleRules !== before.styleRules) {
      failures.push('lineNumbers=' + enabled + ': highlight CSS rules changed ' + before.styleRules + ' -> ' + after.styleRules);
    }
    if (after.paletteKeys !== before.paletteKeys) {
      failures.push('lineNumbers=' + enabled + ': palette count changed ' + before.paletteKeys + ' -> ' + after.paletteKeys);
    }
  }

  const coverageAt = (label) => {
    const state = cm.state;
    const entries = plugin.editorRanges.get(cm) || [];
    const vp = cm.viewport;
    const rows = [];
    for (const el of cm.contentDOM.querySelectorAll('.cm-line')) {
      const isCode = el.className.includes('HyperMD-codeblock')
        && !el.className.includes('HyperMD-codeblock-begin')
        && !el.className.includes('HyperMD-codeblock-end');
      if (!isCode) continue;
      const pos = cm.posAtDOM(el, 0);
      const line = state.doc.lineAt(pos);
      if (line.from >= vp.to || line.to <= vp.from) continue;
      const text = el.textContent.replace(/\u200b/g, '');
      const hasRange = entries.some((entry) => {
        let node = entry.range && entry.range.startContainer;
        while (node && node !== el) node = node.parentNode;
        return node === el;
      });
      rows.push({ n: line.number, hasRange, len: text.length });
    }
    const missing = rows.filter((row) => !row.hasRange && row.len > 2);
    return { label, rows: rows.length, missing };
  };

  const coverage = [];
  for (const top of [0, 300, 700, 1200, 1800, 2600]) {
    cm.scrollDOM.scrollTop = top;
    cm.measure();
    await wait(400);
    const probe = coverageAt('top ' + top);
    coverage.push({ label: probe.label, codeLines: probe.rows, missing: probe.missing.length });
    if (probe.missing.length) {
      failures.push('coverage ' + probe.label + ': ' + probe.missing.length + '/' + probe.rows
        + ' code lines uncoloured ' + JSON.stringify(probe.missing.slice(0, 4)));
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    before,
    toggles: 'off->on->off->on',
    coverage,
  };
}

async function phaseHighlightStability(context) {
  await closeSettings(context.main);
  await setAppearance(context.main, 'light');
  const data = await context.main.eval(`(${pageHighlightStability})(${JSON.stringify({
    note: STABILITY_NOTE,
    pluginId: PLUGIN_ID,
  })})`);
  return data;
}

// ---------------------------------------------------------------------------
// v0.5.0: editor code-block wrapping × line numbers.
//
// The switch is inverted relative to the decoration: while wrapping is OFF
// (the default) every fenced editor line carries `aof-nowrap`, which pins it
// to a single visual row and turns the scroller into a horizontal scroller.
// The four combinations are checked against real geometry — the height of a
// 400-character line, the scroller's scrollWidth and the computed number
// gutter — not against the CSS text, because only the rendered box proves
// that wrapping actually changed.
const WRAP_NOTE = 'AOF v0.5 Wrap Matrix.md';
const WRAP_LONG_LINE = `const payload = ${'abcdefghij'.repeat(24)};`;
const WRAP_NOTE_TEXT = [
  '# wrap probe',
  '',
  `paragraph ${'word '.repeat(90)}`,
  '',
  '```javascript',
  WRAP_LONG_LINE,
  'short();',
  '```',
  '',
  '```',
  `no_language = ${'x'.repeat(320)}`,
  '```',
  '',
].join('\n');

function wrapPlan(text) {
  const blocks = allFencedBlocks(text);
  const numbers = [];
  for (const block of blocks) {
    for (const row of blockNumberRows(block)) numbers.push(String(row.number));
  }
  return {
    codeLineCount: blocks.reduce((sum, block) => sum + block.positions.length, 0),
    blockCount: blocks.length,
    numbers,
  };
}

async function pageWrapCombinations(args) {
  const { note, pluginId, text, plan } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  const failures = [];
  const existing = app.vault.getAbstractFileByPath(note);
  if (existing) await app.vault.modify(existing, text);
  else await app.vault.create(note, text);
  let leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) {
    leaf = app.workspace.getLeaf(false);
    await leaf.openFile(app.vault.getAbstractFileByPath(note));
  }
  const view = leaf.view;
  // A background leaf has no layout box, and the reading view only renders the
  // sections that can be measured — without revealing the leaf the preview
  // stays an empty sizer and every comparison would run on nothing.
  await app.workspace.revealLeaf(leaf);
  await view.setState({ ...view.getState(), mode: 'source', source: true }, {});
  await wait(900);
  const cm = view.editor.cm;
  const scroller = cm.scrollDOM;
  scroller.scrollTop = 0;
  await wait(300);

  const findLine = (prefix) => [...cm.contentDOM.querySelectorAll('.cm-line')]
    .find((line) => (line.textContent || '').trim().startsWith(prefix)) || null;

  const readEditor = () => {
    const long = findLine('const payload');
    const short = findLine('short();');
    const noLang = findLine('no_language');
    const para = findLine('paragraph word');
    if (!long || !short || !noLang || !para) {
      throw new Error('probe lines missing from the editor DOM');
    }
    const pitch = parseFloat(getComputedStyle(long).lineHeight) || 0;
    const numStyle = getComputedStyle(long, '::before');
    return {
      scrollWidth: long.scrollWidth,
      clientWidth: long.clientWidth,
      editorScrollWidth: scroller.scrollWidth,
      editorClientWidth: scroller.clientWidth,
      overflowX: getComputedStyle(scroller).overflowX,
      pitch,
      heights: {
        long: Math.round(long.getBoundingClientRect().height),
        short: Math.round(short.getBoundingClientRect().height),
        noLang: Math.round(noLang.getBoundingClientRect().height),
        para: Math.round(para.getBoundingClientRect().height),
      },
      whiteSpaces: {
        long: getComputedStyle(long).whiteSpace,
        para: getComputedStyle(para).whiteSpace,
      },
      nowrap: {
        long: long.classList.contains('aof-nowrap'),
        short: short.classList.contains('aof-nowrap'),
        noLang: noLang.classList.contains('aof-nowrap'),
        para: para.classList.contains('aof-nowrap'),
      },
      numbers: {
        long: long.getAttribute('data-aof-n'),
        short: short.getAttribute('data-aof-n'),
        noLang: noLang.getAttribute('data-aof-n'),
        all: [...cm.contentDOM.querySelectorAll('.cm-line[data-aof-n]')]
          .map((line) => line.getAttribute('data-aof-n')),
        content: numStyle.content,
        top: numStyle.top,
        lineHeight: numStyle.lineHeight,
        width: numStyle.width,
      },
      gutter: {
        long: getComputedStyle(long).paddingLeft,
        short: getComputedStyle(short).paddingLeft,
        noLang: getComputedStyle(noLang).paddingLeft,
      },
    };
  };

  const combos = [
    { lineNumbers: false, wrapCodeBlocks: false },
    { lineNumbers: true, wrapCodeBlocks: false },
    { lineNumbers: false, wrapCodeBlocks: true },
    { lineNumbers: true, wrapCodeBlocks: true },
  ];
  const samples = [];
  let gutter = null;
  for (const combo of combos) {
    await plugin.updateSettings({ lineNumbers: combo.lineNumbers, wrapCodeBlocks: combo.wrapCodeBlocks });
    await wait(800);
    scroller.scrollLeft = 0;
    await wait(120);
    const snap = readEditor();
    // Horizontal reachability: a single-row long line must be scrollable, a
    // wrapped line must not be.
    const localRow = [...cm.contentDOM.querySelectorAll('.cm-line')].find(line => line.textContent.startsWith('const payload'));
    localRow.scrollLeft = 600;
    await wait(150);
    snap.scrollLeftAfter = localRow.scrollLeft;
    snap.editorScrollLeftAfter = scroller.scrollLeft;
    localRow.scrollLeft = 0;
    await wait(100);
    snap.combo = combo;
    samples.push(snap);

    const label = `wrap=${combo.wrapCodeBlocks} numbers=${combo.lineNumbers}`;
    const wrapped = combo.wrapCodeBlocks;
    // (1) The long line's rendered height is the ground truth for wrapping.
    if (wrapped) {
      if (snap.heights.long < snap.pitch * 3) {
        failures.push(`${label}: long line did not wrap (${snap.heights.long}px vs ${snap.pitch}px row)`);
      }
      if (snap.nowrap.long || snap.nowrap.short || snap.nowrap.noLang) {
        failures.push(`${label}: no-wrap class survived while wrapping is enabled`);
      }
      if (snap.whiteSpaces.long === 'pre') {
        failures.push(`${label}: long line is still pinned to white-space: pre`);
      }
      if (snap.scrollWidth > snap.clientWidth + 2) {
        failures.push(`${label}: wrapped editor still overflows horizontally (${snap.scrollWidth} > ${snap.clientWidth})`);
      }
      if (snap.scrollLeftAfter > 0) {
        failures.push(`${label}: wrapped editor scrolled horizontally`);
      }
    } else {
      if (snap.heights.long > snap.pitch * 1.5) {
        failures.push(`${label}: long line wrapped while the switch is off (${snap.heights.long}px)`);
      }
      if (!snap.nowrap.long || !snap.nowrap.short || !snap.nowrap.noLang) {
        failures.push(`${label}: fenced lines are not marked for no-wrap`);
      }
      if (snap.whiteSpaces.long !== 'pre') {
        failures.push(`${label}: long line is not white-space: pre (${snap.whiteSpaces.long})`);
      }
      if (snap.scrollWidth <= snap.clientWidth + 100) {
        failures.push(`${label}: no horizontal overflow to scroll (${snap.scrollWidth} vs ${snap.clientWidth})`);
      }
      if (snap.scrollLeftAfter <= 0) {
        failures.push(`${label}: horizontal scrolling did not move the scroller`);
      }
      if (snap.heights.short > snap.pitch * 1.5) {
        failures.push(`${label}: short code line is not a single row`);
      }
    }
    // (2) Ordinary markdown must keep Obsidian's wrapping in every mode.
    if (snap.nowrap.para) failures.push(`${label}: paragraph got the no-wrap class`);
    if (snap.heights.para < snap.pitch * 2) failures.push(`${label}: paragraph stopped wrapping`);

    // (3) Line numbers: one per logical line, first block restarts at 1, the
    // number never duplicates on a wrapped row set and the gutter width is
    // independent of the wrap switch.
    if (combo.lineNumbers) {
      if (snap.numbers.all.join(',') !== plan.numbers.join(',')) {
        failures.push(`${label}: numbers ${snap.numbers.all.join(',')} != ${plan.numbers.join(',')}`);
      }
      if (snap.numbers.long !== '1' || snap.numbers.short !== '2' || snap.numbers.noLang !== '1') {
        failures.push(`${label}: per-block numbering is wrong`);
      }
      if (snap.numbers.content !== '"1"') {
        failures.push(`${label}: ::before content is ${snap.numbers.content}, expected "1"`);
      }
      // The number is absolutely positioned at the top of the line box, so it
      // sits on the first visual row even when that row set is several rows
      // tall. `top: 0` is what pins it there.
      if (snap.numbers.top !== '0px') {
        failures.push(`${label}: number is not pinned to the first visual row (top=${snap.numbers.top})`);
      }
      if (wrapped && snap.numbers.lineHeight !== `${snap.pitch}px`) {
        failures.push(`${label}: number line-height ${snap.numbers.lineHeight} != row pitch ${snap.pitch}px`);
      }
      if (gutter === null) gutter = snap.gutter;
      else if (gutter.long !== snap.gutter.long) {
        failures.push(`${label}: gutter moved with the wrap switch (${gutter.long} -> ${snap.gutter.long})`);
      }
    } else if (snap.numbers.all.length) {
      failures.push(`${label}: numbers are still in the DOM while the switch is off`);
    }
  }

  // (4) Reading view must be untouched by the wrap switch.
  await plugin.updateSettings({ lineNumbers: true, wrapCodeBlocks: false });
  await wait(700);
  await app.workspace.revealLeaf(leaf);
  await view.setState({ ...view.getState(), mode: 'preview', source: false }, {});
  // Switching mode right after an appearance/setting change can leave the
  // preview pane empty for a few frames; poll instead of trusting a fixed
  // delay, otherwise the comparison silently runs on two empty nodes.
  const previewRoot = async (limit = 6000) => {
    const started = Date.now();
    while (Date.now() - started < limit) {
      const root = view.contentEl.querySelector('.markdown-preview-view');
      if (root && root.querySelectorAll('pre').length) return root;
      await wait(120);
    }
    return null;
  };
  const previewDiag = async () => ({
    mode: typeof view.getMode === 'function' ? view.getMode() : null,
    state: view.getState(),
    contentClass: view.contentEl.className,
    hasPreview: Boolean(view.contentEl.querySelector('.markdown-preview-view')),
    hasEditor: Boolean(view.contentEl.querySelector('.cm-editor')),
    pres: view.contentEl.querySelectorAll('pre').length,
    sections: view.contentEl.querySelectorAll('.markdown-preview-section').length,
    fileLength: (await app.vault.read(app.vault.getAbstractFileByPath(note))).length,
    previewText: (view.contentEl.querySelector('.markdown-preview-view')?.textContent || '').slice(0, 160),
    previewHtml: (view.contentEl.querySelector('.markdown-preview-view')?.innerHTML || '').slice(0, 300),
  });
  const readPreview = (root) => {
    const pres = [...root.querySelectorAll('pre')];
    const ctx = plugin.readingContext;
    const details = pres.map((pre) => {
      const code = pre.querySelector('code');
      const style = code ? getComputedStyle(code) : null;
      const section = ctx?.getSectionInfo ? ctx.getSectionInfo(pre) : null;
      return {
        cls: pre.className,
        parent: pre.parentElement?.className || '',
        number: pre.getAttribute('data-aof-ln'),
        whiteSpace: style ? style.whiteSpace : null,
        display: style ? style.display : null,
        scrollWidth: code ? code.scrollWidth : 0,
        clientWidth: code ? code.clientWidth : 0,
        height: Math.round(pre.getBoundingClientRect().height),
        text: (pre.textContent || '').slice(0, 40),
        section: section ? {
          lineStart: section.lineStart,
          lineEnd: section.lineEnd,
          textLength: (section.text || '').length,
          head: (section.text || '').slice(0, 24),
        } : null,
      };
    });
    // Compare the numbered block: the reading gutter and its `pre` scroll
    // container only exist on that node, and the plain blocks would answer
    // with Obsidian's own CSS.
    const numberedPres = pres.filter((pre) => pre.classList.contains('aof-ln-on'));
    const reference = numberedPres[0] || pres[0];
    const code = reference?.querySelector('code');
    return {
      pres: pres.length,
      numbered: numberedPres.length,
      nowrap: root.querySelectorAll('.aof-nowrap').length,
      whiteSpace: code ? getComputedStyle(code).whiteSpace : null,
      scrollWidth: code ? code.scrollWidth : 0,
      clientWidth: code ? code.clientWidth : 0,
      numberText: reference?.getAttribute('data-aof-ln') || null,
      details,
    };
  };
  // The plugin classifies a freshly mounted block on the postprocessor pass and
  // retries inconclusive blocks on its delayed rescans, so a snapshot taken the
  // instant the sizer has children can catch one block still pending. Wait for
  // two identical reads before comparing.
  const readPreviewStable = async (root) => {
    let previous = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const snap = readPreview(root);
      if (previous && previous.pres === snap.pres && previous.numbered === snap.numbered &&
        previous.whiteSpace === snap.whiteSpace && previous.scrollWidth === snap.scrollWidth) {
        return snap;
      }
      previous = snap;
      await wait(150);
    }
    return previous;
  };

  const rootOff = await previewRoot();
  const previewOff = rootOff ? await readPreviewStable(rootOff) : { missing: true };
  // Diagnostic: is the block skipped because the memo already claims it is up
  // to date, or because no pass ever reached it?
  let memoProbe = null;
  if (rootOff) {
    const first = rootOff.querySelectorAll('pre')[0];
    if (first) {
      const memo = plugin.readingPreMemo.get(first);
      memoProbe = {
        memo: memo ? { ...memo } : null,
        settings: { lineNumbers: plugin.settings.lineNumbers, background: plugin.settings.codeBlockBackground },
        cls: first.className,
      };
    }
  }
  await plugin.updateSettings({ wrapCodeBlocks: true });
  await wait(700);
  const rootOn = await previewRoot();
  const previewOn = rootOn ? await readPreviewStable(rootOn) : { missing: true };
  if (!rootOff || !rootOn) {
    failures.push(`reading view rendered no fenced blocks (${JSON.stringify(await previewDiag())})`);
  } else {
    if (previewOn.pres !== previewOff.pres) failures.push('reading view block count changed with the wrap switch');
    if (previewOn.numbered !== previewOff.numbered) failures.push('reading view numbering changed with the wrap switch');
    if (previewOn.whiteSpace !== previewOff.whiteSpace) failures.push('reading view white-space changed with the wrap switch');
    if (previewOn.scrollWidth !== previewOff.scrollWidth) failures.push('reading view width changed with the wrap switch');
    if (previewOn.nowrap !== 0) failures.push('wrap class leaked into the reading view');
    // Every fenced block must be numbered, not just the last one mounted. A
    // stale per-block "already numbered" memo used to leave the first block of
    // a note unnumbered after line numbers were switched off and on again.
    if (previewOff.numbered !== previewOff.pres) {
      failures.push(`reading view numbered ${previewOff.numbered}/${previewOff.pres} blocks`);
    }
    if (!previewOff.numberText) failures.push('reading view gutter text missing');
  }

  await view.setState({ ...view.getState(), mode: 'source', source: true }, {});
  await plugin.updateSettings({ lineNumbers: false, wrapCodeBlocks: false });
  await wait(700);
  const cleared = readEditor();
  // Turning wrapping back off must re-apply the no-wrap class immediately; the
  // earlier samples proved the geometry, this proves the toggle is reversible
  // without a reload.
  if (!cleared.nowrap.long) failures.push('no-wrap class did not return after turning wrapping back off');
  if (cleared.whiteSpaces.long !== 'pre') failures.push('white-space: pre did not return after turning wrapping back off');

  return {
    pass: failures.length === 0,
    failures,
    plan,
    samples,
    preview: { off: previewOff, on: previewOn, memoProbe },
  };
}

async function phaseWrapCombinations(context) {
  await closeSettings(context.main);
  await setAppearance(context.main, 'light');
  const plan = wrapPlan(WRAP_NOTE_TEXT);
  const data = await context.main.eval(`(${pageWrapCombinations})(${JSON.stringify({
    note: WRAP_NOTE,
    pluginId: PLUGIN_ID,
    text: WRAP_NOTE_TEXT,
    plan,
  })})`);
  for (const sample of data.samples || []) {
    delete sample.combo;
  }
  await context.main.screenshot(path.join(EVIDENCE, 'wrap-combinations.png'));
  const savedOn = await setSettings(context.main, { lineNumbers: false, wrapCodeBlocks: true });
  await wait(800);
  const persistedOn = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')).wrapCodeBlocks;
  await context.main.screenshot(path.join(EVIDENCE, 'wrap-on.png'));
  await setSettings(context.main, { lineNumbers: false, wrapCodeBlocks: false });
  await wait(800);
  const persistedOff = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')).wrapCodeBlocks;
  await context.main.screenshot(path.join(EVIDENCE, 'wrap-off.png'));
  const failures = [...(data.failures || [])];
  if (savedOn.wrapCodeBlocks !== true) failures.push('setting did not apply in memory');
  if (persistedOn !== true) failures.push('wrapCodeBlocks=true was not written to data.json');
  if (persistedOff !== false) failures.push('wrapCodeBlocks=false was not written to data.json');
  return { ...data, pass: failures.length === 0, failures, persistedOn, persistedOff };
}

// Root-cause guard for the v0.5.0 scroll performance fix. On the v0.4.4 build
// a single reading-gesture in the constrained desktop viewport called
// measureReadingLineNumbers 12-15 times (each a synchronous layout pass) and
// rewrote the generated <style> node 16-21 times. The fixed build must serve
// the same gesture with a handful of coalesced passes and no style rewrites.
async function pageScrollCost(args) {
  const { note, pluginId, mode, frames, step } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  if (!app.plugins.plugins[pluginId]) throw new Error('plugin missing');
  const file = app.vault.getAbstractFileByPath(note);
  if (!file) throw new Error('note missing: ' + note);
  let leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) {
    leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    await wait(900);
  }
  const view = leaf.view;
  const state = view.getState();
  const want = mode === 'reading'
    ? { ...state, mode: 'preview', source: false }
    : { ...state, mode: 'source', source: true };
  if (state.mode !== want.mode || state.source !== want.source) {
    await view.setState(want, {});
    await wait(900);
  }
  await plugin.updateSettings({ lineNumbers: true });
  await wait(1000);

  const counts = {};
  const ms = {};
  const originals = {};
  const names = [
    'measureReadingLineNumbers',
    'resetReadingLineNumberGeometry',
    'scheduleReadingLineNumberGeometry',
    'queueReadingLineNumberGeometry',
    'requestReadingMeasurePass',
    'markReadingFences',
    'rescanReadingBackgrounds',
    'applyReadingLineNumbers',
    'rebuildStyle',
    'rebuildFenceDecorations',
  ];
  for (const name of names) {
    const fn = plugin[name];
    if (typeof fn !== 'function') continue;
    originals[name] = fn;
    counts[name] = 0;
    ms[name] = 0;
    plugin[name] = function instrumented(...rest) {
      const started = performance.now();
      try {
        return fn.apply(this, rest);
      } finally {
        counts[name] += 1;
        ms[name] += performance.now() - started;
      }
    };
  }
  // Style rewrites are the expensive part: replacing textContent invalidates
  // every rule in the node, so the count of characterData mutations on the
  // generated stylesheet is the metric that matters, not the call count.
  const styleNode = plugin.readingStyle;
  let styleWrites = 0;
  const styleObserver = new MutationObserver((records) => { styleWrites += records.length; });
  if (styleNode) styleObserver.observe(styleNode, { childList: true, characterData: true, subtree: true });

  const scroller = mode === 'reading'
    ? view.contentEl.querySelector('.markdown-preview-view')
    : view.editor.cm.scrollDOM;
  if (!scroller) throw new Error('no scroller for mode ' + mode);
  let direction = 1;
  scroller.scrollTop = 0;
  await wait(500);
  for (const key of Object.keys(counts)) {
    counts[key] = 0;
    ms[key] = 0;
  }
  styleWrites = 0;

  const gaps = [];
  const perGesture = [];
  const gestureRun = () => new Promise((resolve) => {
    let frame = 0;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      if (frame > 0) gaps.push(now - last);
      last = now;
      frame += 1;
      scroller.scrollTop += direction * step;
      if (frame < frames) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  let scrolled = 0;
  const started = performance.now();
  // Three gestures in a row (down, up, down) with the counters kept running:
  // a reader scrolls back and forth, and the per-gesture cost is where the
  // "it only hitches when it keeps coming back" complaint lives. A single
  // cold gesture would only measure the first mount of each section.
  for (const pass of [1, -1, 1]) {
    direction = pass;
    const before = { counts: { ...counts }, ms: { ...ms } };
    await gestureRun();
    await wait(400);
    const deltaCounts = {};
    const deltaMs = {};
    for (const name of Object.keys(counts)) {
      deltaCounts[name] = counts[name] - before.counts[name];
      deltaMs[name] = Number((ms[name] - before.ms[name]).toFixed(2));
    }
    perGesture.push({ direction: pass, counts: deltaCounts, ms: deltaMs, scrollTop: Math.round(scroller.scrollTop) });
    scrolled = scroller.scrollTop;
  }
  const gestureMs = performance.now() - started;
  await wait(700);
  styleObserver.disconnect();
  for (const [name, fn] of Object.entries(originals)) plugin[name] = fn;
  gaps.sort((a, b) => b - a);
  const roundedMs = {};
  let pluginMs = 0;
  for (const [name, value] of Object.entries(ms)) {
    roundedMs[name] = Number(value.toFixed(2));
    pluginMs += value;
  }
  return {
    mode,
    counts,
    ms: roundedMs,
    pluginMs: Number(pluginMs.toFixed(2)),
    perGesture,
    styleWrites,
    gestureMs: Math.round(gestureMs),
    scrolled: Math.round(scrolled),
    frames: frames * 3,
    worstGapMs: Math.round(gaps[0] || 0),
    gapsOver50: gaps.filter((gap) => gap > 50).length,
    gapsOver100: gaps.filter((gap) => gap > 100).length,
  };
}

async function phaseScrollCost(context) {
  await closeSettings(context.main);
  await setAppearance(context.main, 'light');
  // Use a narrow desktop viewport as a conservative scrolling stress fixture.
  // The number of sections that mount per gesture depends on viewport height;
  // the smaller height exercises more virtualization work in a repeatable way.
  await context.main.eval(`(() => {
    app.workspace.leftSplit?.collapse?.();
    app.workspace.rightSplit?.collapse?.();
    return true;
  })()`);
  await context.main.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 390,
    screenHeight: 844,
  });
  await wait(1400);
  const reading = await context.main.eval(`(${pageScrollCost})(${JSON.stringify({
    note: NUMBER_NOTE,
    pluginId: PLUGIN_ID,
    mode: 'reading',
    frames: 40,
    step: 180,
  })})`);
  const editor = await context.main.eval(`(${pageScrollCost})(${JSON.stringify({
    note: NUMBER_NOTE,
    pluginId: PLUGIN_ID,
    mode: 'editor',
    frames: 40,
    step: 180,
  })})`);
  await setSettings(context.main, { ...DESIRED, lineNumbers: false });
  await wait(600);
  try {
    await context.main.clearEmulation();
  } catch (error) {
    // Emulation is best effort.
  }
  await wait(600);
  const failures = [];
  // Three gestures run back-to-back, so the per-gesture counters are the ones
  // to read: the fix is not "fewer passes" (a section that mounts still needs
  // one) but "a pass no longer re-measures every block". The v0.4.4 build
  // spends ~15ms inside a single down-gesture's measurement; the fixed build
  // spends ~0.3ms because it only measures blocks without metrics.
  if (!(reading.scrolled > 1000)) failures.push('reading gesture did not scroll far enough to be meaningful');
  const readingWorstPass = Math.max(0, ...reading.perGesture.map((pass) => pass.counts.measureReadingLineNumbers));
  if (readingWorstPass > 3) {
    failures.push(`a reading gesture ran ${readingWorstPass} measure passes`);
  }
  const readingMsPerGesture = reading.pluginMs / Math.max(1, reading.perGesture.length);
  if (readingMsPerGesture > 6) {
    failures.push(`reading plugin time averaged ${readingMsPerGesture.toFixed(1)}ms per gesture`);
  }
  // A rescan / re-number is legitimate once per newly mounted section; it used
  // to run once per host update. 18 blocks over three gestures was the v0.4.4
  // baseline on the same fixture.
  if (reading.counts.applyReadingLineNumbers > 12) {
    failures.push(`reading re-numbered ${reading.counts.applyReadingLineNumbers} blocks over three gestures`);
  }
  if (reading.counts.rescanReadingBackgrounds > 8) {
    failures.push(`reading rescanned fences ${reading.counts.rescanReadingBackgrounds} times`);
  }
  if (reading.styleWrites > 1) failures.push(`reading gesture rewrote the stylesheet ${reading.styleWrites} times`);
  if (!(editor.scrolled > 1000)) failures.push('editor gesture did not scroll far enough to be meaningful');
  if (editor.counts.measureReadingLineNumbers > 0) {
    failures.push('editor scroll ran reading measurement passes');
  }
  if (editor.styleWrites > 1) failures.push(`editor gesture rewrote the stylesheet ${editor.styleWrites} times`);
  return {
    pass: failures.length === 0,
    failures,
    reading,
    editor,
    thresholds: { passesPerGesture: 3, averageMsPerGesture: 6, renumber: 12, rescans: 8, styleWrites: 1 },
  };
}

const PHASES = {
  prepare: phasePrepare,
  installUpgrade: phaseInstallUpgrade,
  accuracy: phaseAccuracy,
  syntaxPixels: phaseSyntaxPixels,
  highlightFallback: phaseHighlightFallback,
  lifecycle: phaseLifecycle,
  scopeIntegrity: phaseScopeIntegrity,
  editing: phaseEditing,
  settingsUI: phaseSettingsUI,
  commandModal: phaseCommandModal,
  visualEvidence: phaseVisualEvidence,
  performance: phasePerformance,
  fallback: phaseFallback,
  persistence: phasePersistence,
  lineNumbersReading: phaseLineNumberReading,
  lineNumbersEditor: phaseLineNumberEditor,
  lineNumbersEditing: phaseLineNumberEditing,
  lineNumbersSettings: phaseLineNumberSettings,
  highlightStability: phaseHighlightStability,
  narrowViewport: phaseNarrowViewport,
  lineNumbersPerformance: phaseLineNumberPerformance,
  cleanup: phaseCleanup,
  lineNumbersPersistence: phaseLineNumberPersistence,
  wrapCombinations: phaseWrapCombinations,
  scrollCost: phaseScrollCost,
  scrollIsolation: (context) => require('./obsidian-scroll-isolation-test.cjs').runScrollIsolation(context.main, EVIDENCE),
};

async function main() {
  const results = {
    formatVersion: 1,
    startedAt: new Date().toISOString(),
    vault: VAULT,
    profile: PROFILE,
    obsidian: OBSIDIAN_VERSION,
    note: NOTE,
    phases: {},
  };
  const context = { main: null, settingsPage: null, results };
  try {
    // A single phase may reuse a running instance, but a full run must start
    // from a clean profile: an interrupted earlier run can leave the plugin
    // disabled, settings mutated or a stale CDP target behind.
    if (ONLY_PHASE) {
      try {
        context.main = await connectMain();
      } catch (error) {
        context.main = await launchIsolatedObsidian();
      }
    } else {
      await killIsolatedObsidian();
      context.main = await launchIsolatedObsidian();
    }
    const phases = ONLY_PHASE ? [ONLY_PHASE] : Object.keys(PHASES);
    for (const phase of phases) {
      const fn = PHASES[phase];
      if (!fn) throw new Error('Unknown phase: ' + phase);
      process.stdout.write(`Phase ${phase} ... `);
      let data;
      try {
        data = await fn(context);
      } catch (error) {
        // Record the failure before rethrowing: a phase missing from the
        // results file says nothing about what went wrong.
        record(results, phase, { pass: false, error: String(error && error.message ? error.message : error), stack: String(error && error.stack || '') });
        throw error;
      }
      record(results, phase, data);
      if (phase === 'prepare') {
        // The isolated profile auto-updates its obsidian-<version>.asar, so the
        // bundle version can lag the effective app version. The window title is
        // rendered from the app's effective version and is authoritative here.
        const titleVersion = /Obsidian\s+([\d.]+)/.exec(data?.documentTitle || '');
        if (titleVersion) results.obsidian = titleVersion[1];
        results.bundleUserAgent = data?.userAgent || null;
        results.windowTitle = data?.documentTitle || null;
        results.electron = data?.electronVersion || null;
      }
      console.log(data?.pass === true ? 'ok' : 'FAIL');
      if (data?.pass !== true) console.log(JSON.stringify(data, null, 2).slice(0, 8000));
    }
    results.finishedAt = new Date().toISOString();
    results.pass = Object.values(results.phases).every((phase) => phase.pass === true);
    fs.writeFileSync(path.join(EVIDENCE, 'real-obsidian-results.json'), JSON.stringify(results, null, 2) + '\n');
    console.log(results.pass ? 'REAL OBSIDIAN PHASES PASSED' : 'REAL OBSIDIAN PHASES FAILED');
    if (!results.pass) process.exitCode = 1;
  } finally {
    context.main?.close();
    context.settingsPage?.close();
    await killIsolatedObsidian();
  }
}

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
  // Open handles (e.g. undici keep-alive sockets to the CDP port) can keep the
  // process alive indefinitely after the suite is done; exit explicitly.
  process.exit(1);
});

async function pageEditing(args) {
  const { note, pluginId, backgrounds, restoreSettings } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  const leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) throw new Error('Note not open: ' + note);
  const view = leaf.view;
  const initialMode = view.getState();
  const original = view.editor.getValue();
  const pair = { light: 'github-light-default', dark: 'tokyo-night-storm' };
  const themeBg = backgrounds[pair.light];
  function parseComputed(value) {
    const match = /^rgba?\(([^)]+)\)$/.exec(value || '');
    if (!match) return null;
    return match[1].split(',').map((part) => Number(part.trim())).slice(0, 3).join(',');
  }
  function parseHex(hex) {
    const value = hex.replace('#', '');
    return `${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(value.slice(4, 6), 16)}`;
  }
  async function ensureAppearance(appearance) {
    const current = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
    if (current !== appearance) {
      app.commands.executeCommandById('theme:toggle-light-dark');
      await wait(650);
    }
  }
  async function setMode(mode) {
    await view.setState({
      ...view.getState(),
      mode: mode === 'reading' ? 'preview' : 'source',
      source: mode === 'source',
    }, {});
    await wait(550);
  }
  async function revealPython() {
    const text = view.editor.getValue();
    const line = text.split('\n').findIndex((value) => value.includes('# python comment'));
    view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line: line + 5, ch: 0 } }, true);
    view.editor.cm.measure();
    await wait(500);
    return [...view.contentEl.querySelectorAll('.cm-line.HyperMD-codeblock')]
      .find((item) => item.textContent.includes('# python comment'));
  }
  async function readLine() {
    const commentLine = await revealPython();
    return {
      bg: commentLine ? getComputedStyle(commentLine).backgroundColor : null,
      fenced: Boolean(commentLine?.classList.contains('aof-fenced-line')),
      text: view.editor.getValue(),
    };
  }
  const out = { pair, modes: {}, pass: false };
  try {
    await ensureAppearance('light');
    await plugin.updateSettings({ ...pair, coloredBrackets: true, codeBlockBackground: true });
    await wait(500);
    for (const mode of ['live', 'source']) {
      const modeResult = { edits: [], toggles: [], errors: [] };
      await setMode(mode);
      let line = await revealPython();
      if (!line) throw new Error('Code line missing in ' + mode);
      // Off baseline first.
      await plugin.updateSettings({ codeBlockBackground: false });
      await wait(500);
      const off = await readLine();
      modeResult.nativeBackground = off.bg;
      const nativeBg = off.bg;
      await plugin.updateSettings({ codeBlockBackground: true });
      await wait(500);
      const on = await readLine();
      modeResult.themeBackground = on.bg;
      const themeOn = parseComputed(on.bg) === parseHex(themeBg) && on.fenced;
      // Edit 42 -> 41 and back, checking the same fenced line remains colored.
      const text = view.editor.getValue();
      const valueLine = text.split('\n').findIndex((value) => value.includes('value = 42'));
      const ch = view.editor.getLine(valueLine).indexOf('42');
      const from = view.editor.posToOffset({ line: valueLine, ch });
      view.editor.replaceRange('41', view.editor.offsetToPos(from), view.editor.offsetToPos(from + 2));
      view.editor.cm.measure();
      await wait(550);
      const edited = await readLine();
      modeResult.edits.push({
        phase: 'changed',
        background: edited.bg,
        fenced: edited.fenced,
        textChanged: edited.text.includes('value = 41'),
        pass: edited.fenced && parseComputed(edited.bg) === parseHex(themeBg) && edited.text.includes('value = 41'),
      });
      view.editor.replaceRange('42', view.editor.offsetToPos(from), view.editor.offsetToPos(from + 2));
      view.editor.cm.measure();
      await wait(550);
      const restored = await readLine();
      modeResult.edits.push({
        phase: 'restored',
        background: restored.bg,
        fenced: restored.fenced,
        textRestored: restored.text.includes('value = 42'),
        pass: restored.fenced && parseComputed(restored.bg) === parseHex(themeBg) && restored.text.includes('value = 42'),
      });
      // Repeated off/on cycles must each restore the correct background.
      for (let i = 0; i < 4; i++) {
        await plugin.updateSettings({ codeBlockBackground: false });
        await wait(300);
        const offNow = await readLine();
        await plugin.updateSettings({ codeBlockBackground: true });
        await wait(300);
        const onNow = await readLine();
        modeResult.toggles.push({
          cycle: i + 1,
          off: offNow.bg,
          offFenced: offNow.fenced,
          on: onNow.bg,
          onFenced: onNow.fenced,
          pass: offNow.bg === nativeBg && offNow.fenced === false &&
            parseComputed(onNow.bg) === parseHex(themeBg) && onNow.fenced === true,
        });
        line = await revealPython();
      }
      modeResult.pass = themeOn && off.bg === nativeBg && modeResult.edits.every((item) => item.pass) &&
        modeResult.toggles.every((item) => item.pass) && view.editor.getValue() === original;
      out.modes[mode] = modeResult;
    }
    out.noteRestored = view.editor.getValue() === original;
  } finally {
    if (view.editor.getValue() !== original) {
      view.editor.setValue(original);
      await view.save();
    }
    if (app.plugins.plugins[pluginId]) {
      await app.plugins.plugins[pluginId].updateSettings({ ...restoreSettings });
    }
    await view.setState(initialMode, {});
    await wait(300);
  }
  out.pass = Object.values(out.modes).every((item) => item.pass) && out.noteRestored;
  return out;
}

async function phaseEditing(context) {
  return context.main.eval(`(${pageEditing})(${JSON.stringify({
    note: NOTE,
    pluginId: PLUGIN_ID,
    backgrounds,
    restoreSettings: DESIRED,
  })})`);
}

module.exports = { CdpPage, connectMain, wait };
