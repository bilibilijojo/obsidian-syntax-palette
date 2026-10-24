#!/usr/bin/env node
'use strict';

// Real Obsidian 1.14.4 acceptance harness for v0.3.0. It talks to an isolated
// Obsidian instance through the Chrome DevTools Protocol. The instance, vault
// and profile are disposable /tmp copies; the user's vault, plugin install and
// Obsidian settings are never modified.
//
// Prerequisites:
//   - /tmp/aof-v030-test is a vault containing the note below.
//   - The built 0.3.0 plugin is installed in that vault.
//   - Obsidian is running with --remote-debugging-port=9333 and
//     --user-data-dir=/tmp/aof-v030-profile.
// See evidence/v0.3.0/README.md for the exact reproduction steps.
//
// Usage:
//   AOF_CDP_PORT=9333 AOF_TEST_VAULT=/tmp/aof-v030-test \
//     node tools/obsidian-v0.3.0-test.cjs [--phase=lifecycle]
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const themeCatalog = require('../plugin-src/themes.cjs');
const { codeBlockTokens, allFencedBlocks } = require('../plugin-src/fences.cjs');
const expectations = require('../plugin-src/tests/fixtures/theme-expectations.json');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.AOF_CDP_PORT || 9333);
const VAULT = process.env.AOF_TEST_VAULT || '/tmp/aof-v030-test';
const PROFILE = process.env.AOF_OBSIDIAN_PROFILE || '/tmp/aof-v030-profile';
const OBSIDIAN_BIN = process.env.AOF_OBSIDIAN_BIN || '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const EVIDENCE = path.join(ROOT, 'evidence/v0.3.0');
const NOTE = 'AOF v0.3 DOM Probe.md';
const NOTE_PATH = path.join(VAULT, NOTE);
const PLUGIN_ID = 'atom-one-fenced-syntax';
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
};
const NATIVE_OFF = {
  light: 'github-light-default',
  dark: 'catppuccin-mocha',
  coloredBrackets: false,
  codeBlockBackground: false,
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
      }, 240000);
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

  close() {
    try { this.ws?.close(); } catch (error) { /* ignore */ }
  }
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      backgroundCss: plugin.backgroundStyle?.textContent || '',
      backgroundStyles: document.querySelectorAll('style#atom-one-fenced-syntax-background').length,
      highlightStyles: document.querySelectorAll('style#atom-one-fenced-syntax-highlight').length,
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
  const logFd = fs.openSync('/tmp/aof-v030-obsidian.log', 'a');
  const child = require('node:child_process').spawn(OBSIDIAN_BIN, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--disable-software-rasterizer',
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
        if (ready) return candidate;
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
      await fetch(`http://127.0.0.1:${PORT}/json`);
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

async function pageStateSnapshot(args) {
  const { note, pluginId } = args;
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
    backgroundStyles: document.querySelectorAll('style#atom-one-fenced-syntax-background').length,
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
        backgroundStyles: document.querySelectorAll('style#atom-one-fenced-syntax-background').length,
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
      backgroundStyles: document.querySelectorAll('style#atom-one-fenced-syntax-background').length,
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
      backgroundStyles: document.querySelectorAll('style#atom-one-fenced-syntax-background').length,
      highlightStyles: document.querySelectorAll('style#atom-one-fenced-syntax-highlight').length,
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
  const leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) throw new Error('Note not open: ' + note);
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
    const style = getComputedStyle(element);
    return Object.fromEntries(PROPS.map((name) => [name, style.getPropertyValue(name)]));
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
      code: { props: props(commentLine), rect: rect(commentLine), bg: getComputedStyle(commentLine).backgroundColor, fenced: commentLine.classList.contains('aof-fenced-line') },
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
      code: compareExceptBackground(liveOff.code, liveOn.code),
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
  const plugin = app.plugins.plugins['atom-one-fenced-syntax'];
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
      let code = [...view.contentEl.querySelectorAll('pre > code.language-python')]
        .find((item) => item.textContent.includes('# python comment'));
      for (let i = 0; i < 50 && !code; i++) {
        view.contentEl.querySelector('.markdown-preview-view').scrollTop += 500;
        await wait(100);
        code = [...view.contentEl.querySelectorAll('pre > code.language-python')]
          .find((item) => item.textContent.includes('# python comment'));
      }
      if (!code) throw new Error('Reading block missing after restart');
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
    out.backgroundStylesBeforeDisable = document.querySelectorAll('style#atom-one-fenced-syntax-background').length;
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
      backgroundStyles: document.querySelectorAll('style#atom-one-fenced-syntax-background').length,
      highlightStyles: document.querySelectorAll('style#atom-one-fenced-syntax-highlight').length,
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
    maxBackgroundStyleNodes = Math.max(maxBackgroundStyleNodes, document.querySelectorAll('style#atom-one-fenced-syntax-background').length);
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
      document.querySelectorAll('style#atom-one-fenced-syntax-background').length === 1,
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
    backgroundStyleNodes: document.querySelectorAll('style#atom-one-fenced-syntax-background').length,
    highlightStyleNodes: document.querySelectorAll('style#atom-one-fenced-syntax-highlight').length,
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
    pass: data.pluginVersion === '0.3.0' && data.pluginReady &&
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
  const firstPass = first.version === '0.3.0' &&
    first.settings.light === 'atom-one-light' &&
    first.settings.dark === 'atom-one-dark' &&
    first.settings.coloredBrackets === true &&
    first.settings.codeBlockBackground === false &&
    first.backgroundCss === '' &&
    first.decoratedLines === 0 &&
    first.fencedBlocks === 0 &&
    first.backgroundStyles === 1;
  const upgradePass = upgrade.version === '0.3.0' &&
    upgrade.settings.light === oldSettings.light &&
    upgrade.settings.dark === oldSettings.dark &&
    upgrade.settings.coloredBrackets === false &&
    upgrade.settings.codeBlockBackground === false &&
    upgrade.backgroundCss === '' &&
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

  const pass = initial.selectCount === 3 &&
    initial.optionCounts[0] === 16 && initial.optionCounts[1] === 12 && initial.optionCounts[2] === 27 &&
    initial.toggleNames.length === 2 &&
    initial.toggleNames.some((name) => name.includes('代码块背景')) &&
    initial.toggleNames.some((name) => name.includes('彩色括号')) &&
    initial.previewBlocks === 2 && initial.previewSpans > 0 &&
    initial.preview[0].label.includes('主题背景 #FFFFFF') &&
    initial.preview[1].label.includes('主题背景 #24283B') &&
    initial.preview[0].background === 'rgb(255, 255, 255)' &&
    initial.preview[1].background === 'rgb(36, 40, 59)' &&
    initial.status.includes('使用所选主题背景') &&
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
    snapshot.toggleCount === 2 && snapshot.toggleValues[0] === true &&
    snapshot.status.includes('代码块背景：使用所选主题背景') &&
    snapshot.buttons.includes('应用') && closed &&
    state.settings.codeBlockBackground === true &&
    state.settings.light === DESIRED.light && state.settings.dark === DESIRED.dark &&
    commands.length === 2;
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
    savedAfter.light === DESIRED.light &&
    savedAfter.dark === DESIRED.dark &&
    savedAfter.coloredBrackets === DESIRED.coloredBrackets &&
    savedAfter.codeBlockBackground === true &&
    prepared.pluginVersion === '0.3.0' &&
    prepared.settings.codeBlockBackground === true &&
    verified.pass;
  return { pass, desired: DESIRED, savedBefore, beforeState, prepared, verified, savedAfter, screenshot: path.relative(ROOT, postRestartScreenshot) };
}

const PHASES = {
  prepare: phasePrepare,
  installUpgrade: phaseInstallUpgrade,
  accuracy: phaseAccuracy,
  lifecycle: phaseLifecycle,
  scopeIntegrity: phaseScopeIntegrity,
  editing: phaseEditing,
  settingsUI: phaseSettingsUI,
  commandModal: phaseCommandModal,
  visualEvidence: phaseVisualEvidence,
  performance: phasePerformance,
  fallback: phaseFallback,
  persistence: phasePersistence,
};

async function main() {
  const results = {
    formatVersion: 1,
    startedAt: new Date().toISOString(),
    vault: VAULT,
    profile: PROFILE,
    obsidian: '1.14.4',
    note: NOTE,
    phases: {},
  };
  const context = { main: null, settingsPage: null, results };
  try {
    try {
      context.main = await connectMain();
    } catch (error) {
      context.main = await launchIsolatedObsidian();
    }
    const phases = ONLY_PHASE ? [ONLY_PHASE] : Object.keys(PHASES);
    for (const phase of phases) {
      const fn = PHASES[phase];
      if (!fn) throw new Error('Unknown phase: ' + phase);
      process.stdout.write(`Phase ${phase} ... `);
      const data = await fn(context);
      record(results, phase, data);
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

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
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
