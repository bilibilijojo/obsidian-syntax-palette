#!/usr/bin/env node
'use strict';

// Real Obsidian 1.14.4 acceptance harness for v0.2.0. It talks to an isolated
// Obsidian instance through the Chrome DevTools Protocol. The instance and vault
// are disposable copies; the user's installed plugin and vault are never touched.
//
// Usage:
//   AOF_CDP_PORT=9222 AOF_TEST_VAULT=/tmp/aof-obsidian-test \
//     node tools/obsidian-v0.2.0-test.cjs [--phase=accuracy|matrix|boundary|...]
const fs = require('node:fs');
const path = require('node:path');
const themeCatalog = require('../plugin-src/themes.cjs');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.AOF_CDP_PORT || 9222);
const VAULT = process.env.AOF_TEST_VAULT || '/tmp/aof-obsidian-test';
const EVIDENCE = path.join(ROOT, 'evidence/v0.2.0');
const NOTE = 'AOF v0.2.0 Matrix.md';
const PLUGIN_ID = 'atom-one-fenced-syntax';
const phaseArg = process.argv.find((arg) => arg.startsWith('--phase='));
const ONLY_PHASE = phaseArg ? phaseArg.slice('--phase='.length) : null;

fs.mkdirSync(EVIDENCE, { recursive: true });

const expectedThemeColors = {
  'atom-one-light': { comment: '#A0A1A7', keyword: '#A626A4', string: '#50A14F', number: '#986801' },
  'atom-one-dark': { comment: '#5C6370', keyword: '#C678DD', string: '#98C379', number: '#D19A66' },
  'github-light-default': { comment: '#6E7781', keyword: '#CF222E', string: '#0A3069', number: '#0550AE' },
  'github-dark-default': { comment: '#8B949E', keyword: '#FF7B72', string: '#A5D6FF', number: '#79C0FF' },
  'github-dark-dimmed': { comment: '#768390', keyword: '#F47067', string: '#96D0FF', number: '#6CB6FF' },
  'ayu-light': { comment: '#ADAEB1', keyword: '#FA8532', string: '#86B300', number: '#A37ACC' },
  'ayu-dark': { comment: '#5A6673', keyword: '#FF8F40', string: '#AAD94C', number: '#D2A6FF' },
  'ayu-mirage': { comment: '#6E7C8F', keyword: '#FFA659', string: '#D5FF80', number: '#DFBFFF' },
  'vscode-light-plus': { comment: '#008000', keyword: '#0000FF', string: '#A31515', number: '#098658' },
  'vscode-dark-plus': { comment: '#6A9955', keyword: '#569CD6', string: '#CE9178', number: '#B5CEA8' },
  'vscode-light-modern': { comment: '#008000', keyword: '#0000FF', string: '#A31515', number: '#098658' },
  'vscode-dark-modern': { comment: '#6A9955', keyword: '#569CD6', string: '#CE9178', number: '#B5CEA8' },
  'catppuccin-latte': { comment: '#7C7F93', keyword: '#8839EF', string: '#40A02B', number: '#FE640B' },
  'catppuccin-frappe': { comment: '#949CBB', keyword: '#CA9EE6', string: '#A6D189', number: '#EF9F76' },
  'catppuccin-macchiato': { comment: '#939AB7', keyword: '#C6A0F6', string: '#A6DA95', number: '#F5A97F' },
  'catppuccin-mocha': { comment: '#9399B2', keyword: '#CBA6F7', string: '#A6E3A1', number: '#FAB387' },
  'dracula-official': { comment: '#6272A4', keyword: '#FF79C6', string: '#F1FA8C', number: '#BD93F9' },
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
      }, 180000);
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
  const pages = await listPages();
  const target = pages.find((page) => page.url.includes('index.html'));
  if (!target) throw new Error('Obsidian main page not found');
  const page = new CdpPage(target);
  await page.connect();
  return page;
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

function record(results, name, data) {
  results.phases[name] = { at: new Date().toISOString(), ...data };
  fs.writeFileSync(path.join(EVIDENCE, 'real-obsidian-results.json'), JSON.stringify(results, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Page-side functions (serialized and executed inside Obsidian)
// ---------------------------------------------------------------------------
async function pagePrepare(args) {
  const { note, pluginId } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  if (!app.plugins.isEnabled()) await app.plugins.setEnable(true);
  if (!app.plugins.plugins[pluginId]) {
    await app.plugins.loadManifests();
    await app.plugins.enablePlugin(pluginId);
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
  await wait(800);
  const view = leaf.view;
  return {
    pluginVersion: app.plugins.manifests[pluginId]?.version,
    title: document.title,
    userAgent: navigator.userAgent,
    file: view.file?.path,
    mode: view.getState().mode,
    source: view.getState().source,
    cssTheme: app.customCss?.theme,
    bodyClass: document.body.className,
  };
}

async function pageThemeAccuracy(args) {
  const { note, pluginId, expected, appearances } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  const leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) throw new Error('Note not open: ' + note);
  const view = leaf.view;
  const cm = view.editor.cm;
  const initialBody = document.body.className;
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
  const blockLines = lines.slice(python.contentStart, python.contentEnd);
  const blockText = blockLines.join('\n');
  const lineStart = view.editor.posToOffset({ line: python.contentStart, ch: 0 });
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
    return Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1 && Math.abs(a[2] - b[2]) <= 1 && Math.abs(a[3] - b[3]) <= 0.01;
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
  const themes = Object.keys(expected);
  const cases = [];
  try {
    for (const themeId of themes) {
      const appearance = appearances[themeId];
      const light = appearance === 'light' ? themeId : 'atom-one-light';
      const dark = appearance === 'dark' ? themeId : 'atom-one-dark';
      await plugin.updateSettings({ light, dark, coloredBrackets: false });
      await wait(220);
      document.body.classList.remove('theme-light', 'theme-dark');
      document.body.classList.add('theme-' + appearance);
      await wait(80);
      view.editor.scrollIntoView({ from: { line: python.start + 1, ch: 0 }, to: { line: python.end - 1, ch: 0 } }, true);
      cm.measure();
      await wait(220);
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
          pass: sameColor(actual, expected[themeId][kind]) && entry.palette[appearance].toUpperCase() === expected[themeId][kind],
          actual,
          expected: expected[themeId][kind],
          palette: entry.palette[appearance],
          text: entry.range.toString(),
        };
      }
      cases.push({ themeId, appearance, checks, pass: Object.values(checks).every((check) => check.pass) });
    }
  } finally {
    await plugin.updateSettings({ light: 'atom-one-light', dark: 'atom-one-dark', coloredBrackets: true });
    document.body.className = initialBody;
    await wait(200);
  }
  return { cases, pass: cases.every((item) => item.pass), total: cases.length };
}

async function pageModeMatrix(args) {
  const { note, pluginId, pairs, languages, modes } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  const leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) throw new Error('Note not open: ' + note);
  const view = leaf.view;
  const initialBody = document.body.className;
  const initialMode = view.getState();
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
    return Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1 && Math.abs(a[2] - b[2]) <= 1 && Math.abs(a[3] - b[3]) <= 0.01;
  }
  function rangeText(range) {
    const dynamic = document.createRange();
    dynamic.setStart(range.startContainer, range.startOffset);
    dynamic.setEnd(range.endContainer, range.endOffset);
    return dynamic.toString();
  }
  function setMode(mode) {
    return view.setState({ ...view.getState(), mode: mode === 'reading' ? 'preview' : 'source', source: mode === 'source' }, {});
  }
  async function openBlock(language, mode) {
    const block = blocks.find((item) => item.language === language);
    if (!block) throw new Error('Missing block ' + language);
    if (mode !== 'reading') {
      view.editor.scrollIntoView({ from: { line: block.start + 1, ch: 0 }, to: { line: block.end - 1, ch: 0 } }, true);
      view.editor.cm.measure();
      await wait(250);
      return block;
    }
    let code = view.contentEl.querySelector('pre > code.language-' + language);
    if (!code) {
      const scroller = view.contentEl.querySelector('.markdown-preview-view');
      for (let i = 0; i < 40 && !code; i++) {
        scroller.scrollTop += Math.max(400, scroller.clientHeight * 0.7);
        await wait(120);
        code = view.contentEl.querySelector('pre > code.language-' + language);
      }
    }
    if (!code) throw new Error('Reading code not found ' + language);
    code.scrollIntoView({ block: 'center' });
    if (view.previewMode?.renderer?.onRender) view.previewMode.renderer.onRender();
    await wait(350);
    return block;
  }
  const cases = [];
  try {
    for (const pair of pairs) {
      await plugin.updateSettings({ light: pair.light, dark: pair.dark, coloredBrackets: true });
      await wait(250);
      for (const appearance of ['light', 'dark']) {
        document.body.classList.remove('theme-light', 'theme-dark');
        document.body.classList.add('theme-' + appearance);
        await wait(100);
        for (const mode of modes) {
          await setMode(mode);
          await wait(500);
          for (const language of languages) {
            try {
              const block = await openBlock(language, mode);
              const caseResult = { pair: pair.name, appearance, mode, language, errors: [], ranges: 0, samples: [] };
              if (mode === 'reading') {
                const code = view.contentEl.querySelector('pre > code.language-' + language);
                if (!code) throw new Error('Missing reading code');
                const ranges = plugin.readingOriginals.get(code) || [];
                caseResult.ranges = ranges.length;
                for (const item of ranges) {
                  const value = rangeText(item.range);
                  if (!value) { caseResult.errors.push('empty range'); continue; }
                  if (!code.contains(item.range.startContainer) || !code.contains(item.range.endContainer)) caseResult.errors.push('range escaped code');
                  const actual = getComputedStyle(code, '::highlight(' + item.name + ')').color;
                  const expected = item.palette[appearance];
                  if (!sameColor(actual, expected)) caseResult.errors.push('color mismatch: ' + actual + ' != ' + expected);
                  if (caseResult.samples.length < 3) caseResult.samples.push({ text: value.slice(0, 40), actual, expected });
                }
                if (!code.isConnected) caseResult.errors.push('code detached');
              } else {
                const start = view.editor.posToOffset({ line: block.contentStart, ch: 0 });
                const lastLine = view.editor.getLine(block.contentEnd - 1);
                const end = view.editor.posToOffset({ line: block.contentEnd - 1, ch: lastLine.length });
                const cm = view.editor.cm;
                const ranges = (plugin.editorRanges.get(cm) || []).filter((entry) => {
                  try {
                    const from = cm.posAtDOM(entry.range.startContainer, entry.range.startOffset);
                    const to = cm.posAtDOM(entry.range.endContainer, entry.range.endOffset);
                    return from >= start && to <= end;
                  } catch (error) {
                    return false;
                  }
                });
                caseResult.ranges = ranges.length;
                for (const item of ranges) {
                  const value = item.range.toString();
                  if (!value) { caseResult.errors.push('empty range'); continue; }
                  const lineElement = item.range.startContainer.parentElement.closest('.cm-line');
                  const actual = getComputedStyle(lineElement, '::highlight(' + item.name + ')').color;
                  const expected = item.palette[appearance];
                  if (!sameColor(actual, expected)) caseResult.errors.push('color mismatch: ' + actual + ' != ' + expected);
                  if (caseResult.samples.length < 3) caseResult.samples.push({ text: value.slice(0, 40), actual, expected });
                }
              }
              if (!caseResult.ranges) caseResult.errors.push('no ranges');
              cases.push(caseResult);
            } catch (error) {
              cases.push({ pair: pair.name, appearance, mode, language, errors: [error.message || String(error)], ranges: 0 });
            }
          }
        }
      }
    }
  } finally {
    await plugin.updateSettings({ light: 'atom-one-light', dark: 'atom-one-dark', coloredBrackets: true });
    document.body.className = initialBody;
    await view.setState(initialMode, {});
    await wait(200);
  }
  const failures = cases.filter((item) => item.errors.length);
  return {
    pass: failures.length === 0,
    total: cases.length,
    failures,
    byMode: modes.map((mode) => ({ mode, cases: cases.filter((item) => item.mode === mode).length })),
  };
}

async function pageBoundary(args) {
  const { note, pluginId, pairA, pairB } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const getPlugin = () => app.plugins.plugins[pluginId];
  const leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) throw new Error('Note not open: ' + note);
  const view = leaf.view;
  const initialBody = document.body.className;
  const initialMode = view.getState();
  const noteBefore = await app.vault.read(view.file);
  const properties = ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'background-color', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-radius', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'box-shadow', 'white-space', 'color', 'text-decoration-line'];
  function props(element) {
    const style = getComputedStyle(element);
    return Object.fromEntries(properties.map((name) => [name, style.getPropertyValue(name)]));
  }
  function samples(scope, withRects = true) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const result = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent || !node.parentElement) continue;
      const style = props(node.parentElement);
      for (let i = 0; i < node.textContent.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        result.push({
          char: node.textContent[i],
          style,
          ...(withRects ? { rect: [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 100) / 100) } : {}),
        });
      }
    }
    return result;
  }
  function activeScope() {
    const preview = view.getState().mode === 'preview';
    return preview
      ? view.contentEl.querySelector('.markdown-preview-view')
      : view.contentEl.querySelector('.markdown-source-view');
  }
  function codeSamples() {
    const scope = activeScope();
    if (!scope) return [];
    const wanted = ['# python comment', 'def greet(name):', 'answer = 42', 'return "hello", name'];
    const lines = [...scope.querySelectorAll('.cm-line')].filter((line) => wanted.some((text) => line.textContent.includes(text)));
    return lines.flatMap((line) => samples(line));
  }
  function surrounding() {
    const scope = activeScope();
    if (!scope) return [];
    return [...scope.querySelectorAll('h1,h2,p,blockquote,code:not(pre>code),a')]
      .filter((element) => !element.closest('.cm-line.HyperMD-codeblock') && !element.closest('pre'))
      .map((element) => ({ tag: element.tagName, text: element.textContent.slice(0, 80), style: props(element) }));
  }
  function codeElement(language) {
    return view.contentEl.querySelector('pre > code.language-' + language);
  }
  function highlightKeys() {
    return [...CSS.highlights.keys()].filter((key) => key.startsWith('aof-reading-'));
  }
  function rangeText(range) {
    const dynamic = document.createRange();
    dynamic.setStart(range.startContainer, range.startOffset);
    dynamic.setEnd(range.endContainer, range.endOffset);
    return dynamic.toString();
  }
  function intersectsSurrounding(ranges) {
    const scope = activeScope();
    if (!scope) return 0;
    const targets = [...scope.querySelectorAll('h1,h2,p,blockquote,code:not(pre>code),a')]
      .filter((element) => !element.closest('.cm-line.HyperMD-codeblock') && !element.closest('pre'));
    return ranges.filter((entry) => targets.some((element) => {
      try { return entry.range.intersectsNode(element); } catch (error) { return false; }
    })).length;
  }
  function fenceCrossings(plugin) {
    const fences = [...view.contentEl.querySelectorAll('.cm-line.HyperMD-codeblock-begin, .cm-line.HyperMD-codeblock-end')];
    const ranges = plugin ? (plugin.editorRanges.get(view.editor.cm) || []) : [];
    return ranges.filter((entry) => fences.some((line) => {
      try { return entry.range.intersectsNode(line); } catch (error) { return false; }
    })).length;
  }
  function dynamicCssAudit(plugin) {
    if (!plugin?.readingStyle?.sheet) return { rules: 0, properties: [], invalid: 0 };
    const rules = [...plugin.readingStyle.sheet.cssRules];
    const properties = [...new Set(rules.flatMap((rule) => Array.from({ length: rule.style.length }, (_, index) => rule.style[index])))];
    return {
      rules: rules.length,
      properties,
      invalid: rules.filter((rule) => rule.style.length !== 1 || rule.style[0] !== 'color').length,
      selectors: rules.slice(0, 2).map((rule) => rule.selectorText),
    };
  }
  async function scrollEditorToPython() {
    const text = view.editor.getValue();
    const line = text.split('\n').findIndex((value) => value.includes('# python comment'));
    view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line: line + 4, ch: 0 } }, true);
    view.editor.cm.measure();
    await wait(350);
  }
  async function captureEditorSurrounding() {
    view.editor.scrollIntoView({ from: { line: 0, ch: 0 }, to: { line: 5, ch: 0 } }, true);
    view.editor.cm.measure();
    await wait(320);
    return surrounding();
  }
  async function scrollReadingToPython() {
    let code = codeElement('python');
    if (!code) {
      const scroller = view.contentEl.querySelector('.markdown-preview-view');
      for (let i = 0; i < 40 && !code; i++) {
        scroller.scrollTop += Math.max(400, scroller.clientHeight * 0.7);
        await wait(120);
        code = codeElement('python');
      }
    }
    if (!code) throw new Error('Reading python block not found');
    code.scrollIntoView({ block: 'center' });
    if (view.previewMode?.renderer?.onRender) view.previewMode.renderer.onRender();
    await wait(500);
    return code;
  }
  function surroundingDiff(base, next) {
    const result = [];
    for (let i = 0; i < Math.max(base.length, next.length); i++) {
      if (JSON.stringify(base[i]) !== JSON.stringify(next[i])) result.push({ index: i, before: base[i], after: next[i] });
    }
    return result.slice(0, 6);
  }
  function sampleDiff(base, next) {
    for (let i = 0; i < Math.max(base.length, next.length); i++) {
      if (JSON.stringify(base[i]) !== JSON.stringify(next[i])) {
        return { index: i, before: base[i] || null, after: next[i] || null };
      }
    }
    return null;
  }
  function compare(base, next, withRects = true) {
    const strip = (item) => withRects ? item : { char: item.char, style: item.style };
    return {
      length: base.length === next.length,
      text: base.map((item) => item.char).join('') === next.map((item) => item.char).join(''),
      styles: JSON.stringify(base.map(strip)) === JSON.stringify(next.map(strip)),
      geometry: withRects ? JSON.stringify(base.map((item) => item.rect)) === JSON.stringify(next.map((item) => item.rect)) : null,
    };
  }
  const out = { live: {}, reading: {}, noteUnchanged: false, dynamicCss: {} };
  try {
    await view.setState({ ...initialMode, mode: 'source', source: false }, {});
    await wait(500);
    await getPlugin().updateSettings(pairA);
    await wait(350);
    document.body.classList.remove('theme-dark');
    document.body.classList.add('theme-light');
    await scrollEditorToPython();
    const liveBase = { samples: codeSamples(), surrounding: await captureEditorSurrounding(), fenceCrossings: fenceCrossings(getPlugin()), highlights: highlightKeys().length };
    await getPlugin().updateSettings(pairB);
    await wait(450);
    await scrollEditorToPython();
    const liveSwitched = { samples: codeSamples(), surrounding: await captureEditorSurrounding(), fenceCrossings: fenceCrossings(getPlugin()), highlights: highlightKeys().length };
    out.live.themeSwitch = {
      ...compare(liveBase.samples, liveSwitched.samples),
      surrounding: JSON.stringify(liveBase.surrounding) === JSON.stringify(liveSwitched.surrounding),
      fenceCrossings: liveSwitched.fenceCrossings,
      highlights: liveSwitched.highlights,
    };
    await app.plugins.disablePlugin(pluginId);
    await wait(700);
    await scrollEditorToPython();
    const liveDisabled = { samples: codeSamples(), surrounding: await captureEditorSurrounding(), highlights: highlightKeys().length, spans: document.querySelectorAll('span.atom-one-fenced-token').length };
    out.live.disable = {
      ...compare(liveBase.samples, liveDisabled.samples),
      surrounding: JSON.stringify(liveBase.surrounding) === JSON.stringify(liveDisabled.surrounding),
      surroundingDiff: surroundingDiff(liveBase.surrounding, liveDisabled.surrounding),
      sampleDiff: sampleDiff(liveBase.samples, liveDisabled.samples),
      highlights: liveDisabled.highlights,
      spans: liveDisabled.spans,
    };
    await app.plugins.enablePlugin(pluginId);
    await wait(1000);
    await getPlugin().updateSettings(pairA);
    await wait(350);
    // Obsidian 1.14.4 drops live-preview Markdown widgets when any plugin's
    // postprocessor is unregistered. A reading round-trip re-creates the native
    // widgets; a postprocessor-only control plugin reproduces the same behavior.
    await view.setState({ ...view.getState(), mode: 'preview', source: false }, {});
    await wait(700);
    await view.setState({ ...view.getState(), mode: 'source', source: false }, {});
    await wait(800);
    await scrollEditorToPython();
    const liveRestored = { samples: codeSamples(), surrounding: await captureEditorSurrounding(), highlights: highlightKeys().length, fenceCrossings: fenceCrossings(getPlugin()) };
    out.live.restore = {
      ...compare(liveBase.samples, liveRestored.samples),
      surrounding: JSON.stringify(liveBase.surrounding) === JSON.stringify(liveRestored.surrounding),
      surroundingDiff: surroundingDiff(liveBase.surrounding, liveRestored.surrounding),
      highlights: liveRestored.highlights,
      fenceCrossings: liveRestored.fenceCrossings,
    };

    await view.setState({ ...view.getState(), mode: 'preview', source: false }, {});
    await wait(1000);
    await getPlugin().updateSettings(pairA);
    await wait(350);
    await scrollReadingToPython();
    const readingCode = codeElement('python');
    const readingBase = { code: props(readingCode), pre: props(readingCode.parentElement), samples: samples(readingCode), surrounding: surrounding(), html: readingCode.innerHTML, text: readingCode.textContent, highlights: highlightKeys().length, ranges: (getPlugin().readingOriginals.get(readingCode) || []).length, crossing: intersectsSurrounding(getPlugin().readingOriginals.get(readingCode) || []) };
    await getPlugin().updateSettings(pairB);
    await wait(450);
    await scrollReadingToPython();
    const readingSwitchedCode = codeElement('python');
    const readingSwitched = { code: props(readingSwitchedCode), pre: props(readingSwitchedCode.parentElement), samples: samples(readingSwitchedCode), surrounding: surrounding(), html: readingSwitchedCode.innerHTML, text: readingSwitchedCode.textContent, highlights: highlightKeys().length, ranges: (getPlugin().readingOriginals.get(readingSwitchedCode) || []).length, crossing: intersectsSurrounding(getPlugin().readingOriginals.get(readingSwitchedCode) || []) };
    out.reading.themeSwitch = {
      ...compare(readingBase.samples, readingSwitched.samples),
      codeStyle: JSON.stringify(readingBase.code) === JSON.stringify(readingSwitched.code),
      preStyle: JSON.stringify(readingBase.pre) === JSON.stringify(readingSwitched.pre),
      surrounding: JSON.stringify(readingBase.surrounding) === JSON.stringify(readingSwitched.surrounding),
      html: readingBase.html === readingSwitched.html,
      text: readingBase.text === readingSwitched.text,
      ranges: readingSwitched.ranges,
      crossing: readingSwitched.crossing,
      highlights: readingSwitched.highlights,
    };
    out.dynamicCss = dynamicCssAudit(getPlugin());
    await app.plugins.disablePlugin(pluginId);
    await wait(800);
    const readingDisabledCode = codeElement('python');
    const readingDisabled = { code: props(readingDisabledCode), pre: props(readingDisabledCode.parentElement), samples: samples(readingDisabledCode, false), text: readingDisabledCode.textContent, highlights: highlightKeys().length, spans: document.querySelectorAll('span.atom-one-fenced-token').length };
    out.reading.disable = {
      ...compare(readingBase.samples, readingDisabled.samples, false),
      codeStyle: JSON.stringify(readingBase.code) === JSON.stringify(readingDisabled.code),
      preStyle: JSON.stringify(readingBase.pre) === JSON.stringify(readingDisabled.pre),
      text: readingBase.text === readingDisabled.text,
      highlights: readingDisabled.highlights,
      spans: readingDisabled.spans,
    };
    await app.plugins.enablePlugin(pluginId);
    await wait(1100);
    await getPlugin().updateSettings(pairA);
    await wait(400);
    await view.setState({ ...view.getState(), mode: 'preview', source: false }, {});
    await wait(700);
    const readingRestoredCode = codeElement('python');
    const readingRestored = { code: props(readingRestoredCode), pre: props(readingRestoredCode.parentElement), samples: samples(readingRestoredCode, false), text: readingRestoredCode.textContent, highlights: highlightKeys().length, ranges: (getPlugin().readingOriginals.get(readingRestoredCode) || []).length };
    out.reading.restore = {
      ...compare(readingBase.samples, readingRestored.samples, false),
      codeStyle: JSON.stringify(readingBase.code) === JSON.stringify(readingRestored.code),
      preStyle: JSON.stringify(readingBase.pre) === JSON.stringify(readingRestored.pre),
      text: readingBase.text === readingRestored.text,
      highlights: readingRestored.highlights,
      ranges: readingRestored.ranges,
    };
    out.noteUnchanged = (await app.vault.read(view.file)) === noteBefore;
    out.hostWidgetRemoval = !out.live.disable.surrounding;
    out.hostNote = 'Obsidian 1.14.4 removes native live-preview Markdown widgets after any plugin postprocessor is unregistered; a control plugin with only an empty postprocessor reproduces it. Plugin highlights are fully removed, and note text/code styles/geometry remain unchanged. A reading-mode refresh restores the native widgets.';
    out.pass = Boolean(
      out.live.themeSwitch.text && out.live.themeSwitch.styles && out.live.themeSwitch.geometry && out.live.themeSwitch.surrounding && out.live.themeSwitch.fenceCrossings === 0 &&
      out.live.disable.text && out.live.disable.styles && out.live.disable.geometry && out.live.disable.highlights === 0 && out.live.disable.spans === 0 &&
      out.live.restore.text && out.live.restore.styles && out.live.restore.geometry && out.live.restore.surrounding && out.live.restore.highlights > 0 && out.live.restore.fenceCrossings === 0 &&
      out.reading.themeSwitch.text && out.reading.themeSwitch.styles && out.reading.themeSwitch.geometry && out.reading.themeSwitch.codeStyle && out.reading.themeSwitch.preStyle && out.reading.themeSwitch.surrounding && out.reading.themeSwitch.html && out.reading.themeSwitch.ranges > 0 && out.reading.themeSwitch.crossing === 0 &&
      out.reading.disable.text && out.reading.disable.styles && out.reading.disable.codeStyle && out.reading.disable.preStyle && out.reading.disable.highlights === 0 && out.reading.disable.spans === 0 &&
      out.reading.restore.text && out.reading.restore.styles && out.reading.restore.codeStyle && out.reading.restore.preStyle && out.reading.restore.highlights > 0 && out.reading.restore.ranges > 0 &&
      out.dynamicCss.invalid === 0 && out.noteUnchanged
    );
  } finally {
    if (!app.plugins.plugins[pluginId]) {
      await app.plugins.enablePlugin(pluginId);
      await wait(900);
    }
    if (app.plugins.plugins[pluginId]) await app.plugins.plugins[pluginId].updateSettings({ light: 'atom-one-light', dark: 'atom-one-dark', coloredBrackets: true });
    document.body.className = initialBody;
    await view.setState(initialMode, {});
    await wait(300);
  }
  return out;
}

async function pageEditingScrolling(args) {
  const { note, pluginId } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  const leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
  if (!leaf) throw new Error('Note not open: ' + note);
  const view = leaf.view;
  const initialMode = view.getState();
  const before = view.editor.getValue();
  const lines = before.split('\n');
  const blocks = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const match = /^```(\S*)\s*$/.exec(lines[i]);
    if (!open && match) { open = { language: match[1] || '', start: i }; continue; }
    if (open && /^```\s*$/.test(lines[i])) { blocks.push({ ...open, end: i, contentStart: open.start + 1, contentEnd: i }); open = null; }
  }
  const out = { live: {}, source: {}, restored: false, errors: [] };
  function entriesForLanguage(language) {
    const block = blocks.find((item) => item.language === language);
    if (!block) return [];
    const start = view.editor.posToOffset({ line: block.contentStart, ch: 0 });
    const last = view.editor.getLine(block.contentEnd - 1);
    const end = view.editor.posToOffset({ line: block.contentEnd - 1, ch: last.length });
    const cm = view.editor.cm;
    return (plugin.editorRanges.get(cm) || []).filter((entry) => {
      try {
        const from = cm.posAtDOM(entry.range.startContainer, entry.range.startOffset);
        const to = cm.posAtDOM(entry.range.endContainer, entry.range.endOffset);
        return from >= start && to <= end;
      } catch (error) { return false; }
    });
  }
  async function checkScrolling(mode) {
    await view.setState({ ...view.getState(), mode: 'source', source: mode === 'source' }, {});
    await wait(500);
    const result = {};
    const supported = ['python', 'javascript', 'json', 'bash', 'html', 'css'];
    for (const block of blocks) {
      if (!supported.includes(block.language)) continue;
      let count = 0;
      for (let attempt = 0; attempt < 3 && count === 0; attempt++) {
        view.editor.scrollIntoView({ from: { line: block.start + 1, ch: 0 }, to: { line: block.end - 1, ch: 0 } }, true);
        await wait(260);
        view.editor.cm.measure();
        await wait(280);
        count = entriesForLanguage(block.language).length;
      }
      result[block.language] = count;
    }
    return result;
  }
  try {
    await plugin.updateSettings({ light: 'github-light-default', dark: 'catppuccin-mocha', coloredBrackets: true });
    out.live.scroll = await checkScrolling('live');
    const text = view.editor.getValue();
    const python = blocks.find((item) => item.language === 'python');
    const start = view.editor.posToOffset({ line: python.contentStart, ch: 0 });
    const end = view.editor.posToOffset({ line: python.contentEnd - 1, ch: view.editor.getLine(python.contentEnd - 1).length });
    const blockText = text.slice(start, end);
    const offset = blockText.indexOf('42');
    const from = start + offset;
    const to = from + 2;
    view.editor.replaceRange('41', view.editor.offsetToPos(from), view.editor.offsetToPos(to));
    await wait(500);
    view.editor.cm.measure();
    await wait(300);
    const edited = entriesForLanguage('python').find((entry) => entry.range.toString() === '41');
    out.live.edited = Boolean(edited);
    out.live.editedColor = edited ? getComputedStyle(edited.range.startContainer.parentElement.closest('.cm-line'), '::highlight(' + edited.name + ')').color : null;
    view.editor.replaceRange('42', view.editor.offsetToPos(from), view.editor.offsetToPos(from + 2));
    await wait(500);
    view.editor.cm.measure();
    await wait(300);
    out.live.restoredToken = entriesForLanguage('python').some((entry) => entry.range.toString() === '42');
    out.live.finalText = view.editor.getValue() === before;
    out.source.scroll = await checkScrolling('source');
    out.source.restoredToken = entriesForLanguage('python').some((entry) => entry.range.toString() === '42');
    out.restored = view.editor.getValue() === before;
    if (view.editor.getValue() === before) {
      await view.save();
    }
  } finally {
    if (view.editor.getValue() !== before) {
      view.editor.setValue(before);
      await view.save();
    }
    await view.setState(initialMode, {});
    await wait(300);
  }
  out.pass = out.live.finalText && out.restored && out.live.edited && out.live.restoredToken && out.source.restoredToken && Object.values(out.live.scroll).every((count) => count > 0) && Object.values(out.source.scroll).every((count) => count > 0);
  return out;
}

async function pagePerformance(args) {
  const { pluginId, pairA, pairB, iterations } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plugin = app.plugins.plugins[pluginId];
  const leaf = app.workspace.getLeavesOfType('markdown')[0];
  if (leaf) await app.workspace.revealLeaf(leaf);
  await wait(400);
  let maxPalettes = 0;
  let maxHighlights = 0;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await plugin.updateSettings(i % 2 === 0 ? pairA : pairB);
    await wait(60);
    maxPalettes = Math.max(maxPalettes, plugin.readingPalettes.size);
    maxHighlights = Math.max(maxHighlights, [...CSS.highlights.keys()].filter((key) => key.startsWith('aof-reading-')).length);
  }
  await plugin.updateSettings(pairA);
  await wait(300);
  const elapsed = performance.now() - start;
  const state = plugin.engine.getState();
  return {
    pass: state.cacheEntries <= 96 && state.cacheSize <= 2000000 && state.light === pairA.light && state.dark === pairA.dark && maxPalettes < 400 && maxHighlights < 400,
    elapsed,
    iterations,
    maxPalettes,
    maxHighlights,
    state,
    spans: document.querySelectorAll('span.atom-one-fenced-token').length,
  };
}

async function pageVerifyPersisted(args) {
  const { note, pluginId, pair, expectedToken } = args;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !app.plugins.plugins[pluginId]) await wait(300);
  if (!app.plugins.plugins[pluginId]) throw new Error('Plugin did not load after restart');
  const plugin = app.plugins.plugins[pluginId];
  const file = app.vault.getAbstractFileByPath(note);
  if (!file) throw new Error('Note missing after restart');
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  await wait(900);
  const view = leaf.view;
  await view.setState({ ...view.getState(), mode: 'source', source: false }, {});
  await wait(500);
  document.body.classList.remove('theme-dark');
  document.body.classList.add('theme-light');
  const text = view.editor.getValue();
  const line = text.split('\n').findIndex((value) => value.includes('# python comment'));
  view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line: line + 4, ch: 0 } }, true);
  view.editor.cm.measure();
  await wait(400);
  const entry = (plugin.editorRanges.get(view.editor.cm) || []).find((item) => item.range.toString() === '42');
  return {
    pass: plugin.settings.light === pair.light && plugin.settings.dark === pair.dark && plugin.engineReady && Boolean(entry),
    settings: plugin.settings,
    engineReady: plugin.engineReady,
    tokenColor: entry ? getComputedStyle(entry.range.startContainer.parentElement.closest('.cm-line'), '::highlight(' + entry.name + ')').color : null,
    expectedToken,
    ranges: (plugin.editorRanges.get(view.editor.cm) || []).length,
  };
}

const PROFILE = process.env.AOF_OBSIDIAN_PROFILE || '/tmp/aof-obsidian-profile';
const OBSIDIAN_BIN = process.env.AOF_OBSIDIAN_BIN || '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const DATA_PATH = path.join(VAULT, '.obsidian/plugins', PLUGIN_ID, 'data.json');

async function findPageWith(expression, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const target of await listPages()) {
      const page = new CdpPage(target);
      try {
        await page.connect();
        const found = await page.eval(expression);
        if (found) return page;
        page.close();
      } catch (error) {
        page.close();
      }
    }
    await wait(300);
  }
  throw new Error('No page matched ' + expression);
}

async function setBodyClass(page, appearance) {
  await page.eval(`document.body.classList.remove('theme-light','theme-dark');document.body.classList.add('theme-${appearance}');true`);
  await wait(250);
}

async function readPluginState(main) {
  return main.eval(`(() => {
    const id = ${JSON.stringify(PLUGIN_ID)};
    const plugin = app.plugins.plugins[id];
    return plugin ? {
      settings: plugin.settings,
      engine: plugin.engine.getState(),
      engineReady: plugin.engineReady,
      ranges: plugin.editorRanges.size,
      reading: plugin.readingOriginals.size,
      highlightKeys: [...CSS.highlights.keys()].filter((key) => key.startsWith('aof-reading-')).length,
      bodyClass: document.body.className,
    } : null;
  })()`);
}

async function setSettings(main, patch) {
  return main.eval(`(async () => {
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    await plugin.updateSettings(${JSON.stringify(patch)});
    await new Promise((resolve) => setTimeout(resolve, 350));
    return plugin.settings;
  })()`);
}

async function openSettings(main) {
  await main.eval(`(async () => {
    app.setting.open();
    app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
    return true;
  })()`);
  await wait(900);
  return findSettingsPage(10000);
}

async function settingsUiSnapshot(settingsPage) {
  return settingsPage.eval(`(() => {
    const root = document.querySelector('.aof-settings');
    if (!root) throw new Error('settings root missing');
    const selects = [...root.querySelectorAll('select:not(.is-measuring)')];
    return {
      selectCount: selects.length,
      values: selects.map((select) => select.value),
      optionCounts: selects.map((select) => select.options.length),
      presetOptions: [...selects[0].options].map((option) => option.value),
      lightOptions: [...selects[1].options].map((option) => option.value),
      darkOptions: [...selects[2].options].map((option) => option.value),
      status: root.querySelector('.aof-status')?.innerText,
      previewBlocks: root.querySelectorAll('.aof-preview-block').length,
      previewSpans: root.querySelectorAll('.aof-preview-code span').length,
      previewColors: [...root.querySelectorAll('.aof-preview-code span')].slice(0, 12).map((span) => ({ text: span.textContent, color: span.style.color })),
      hasBracketToggle: !!root.querySelector('.setting-item.mod-toggle input[type=checkbox]'),
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

async function toggleBrackets(settingsPage) {
  return settingsPage.eval(`(() => {
    const item = [...document.querySelectorAll('.aof-settings .setting-item')].find((element) => element.querySelector('.setting-item-name')?.textContent.includes('彩色括号'));
    if (!item) throw new Error('bracket toggle missing');
    const input = item.querySelector('input[type=checkbox]');
    if (!input) throw new Error('bracket checkbox missing');
    input.click();
    return true;
  })()`);
}

async function commandModalSnapshot(context) {
  console.error('commandModalSnapshot: executing command');
  await context.main.eval(`app.commands.executeCommandById(${JSON.stringify(PLUGIN_ID + ':choose-syntax-theme')});true`);
  console.error('commandModalSnapshot: command executed');
  await wait(700);
  const page = await findPageWith('!!document.querySelector(".aof-theme-modal")', 6000);
  console.error('commandModalSnapshot: page found');
  const snapshot = await page.eval(`(() => {
    const modal = document.querySelector('.aof-theme-modal');
    const selects = [...modal.querySelectorAll('select:not(.is-measuring)')];
    return {
      exists: !!modal,
      selectCount: selects.length,
      values: selects.map((select) => select.value),
      status: modal.querySelector('.aof-status')?.innerText,
      buttons: [...modal.querySelectorAll('button')].map((button) => button.textContent),
    };
  })()`);
  return { page, snapshot };
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
  const deadline = Date.now() + 8000;
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

async function launchIsolatedObsidian() {
  const logFd = fs.openSync('/tmp/aof-obsidian.log', 'a');
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
  const deadline = Date.now() + 30000;
  let page = null;
  while (Date.now() < deadline && !page) {
    try {
      const pages = await listPages();
      const target = pages.find((item) => item.url.includes('index.html'));
      if (target) {
        const candidate = new CdpPage(target);
        await candidate.connect();
        const ready = await candidate.eval('Boolean(window.app && window.app.workspace && window.app.workspace.layoutReady)');
        if (ready) page = candidate;
        else candidate.close();
      }
    } catch (error) {
      // wait for the new process to expose CDP
    }
    if (!page) await wait(500);
  }
  if (!page) throw new Error('Obsidian did not restart with CDP');
  return page;
}

async function prepareNoteScreenshot(main, { mode, appearance }) {
  await main.eval(`(async () => {
    const note = ${JSON.stringify(NOTE)};
    const leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === note);
    if (!leaf) throw new Error('note leaf missing');
    await app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    const mode = ${JSON.stringify(mode)};
    await view.setState({ ...view.getState(), mode: mode === 'reading' ? 'preview' : 'source', source: mode === 'source' }, {});
    await new Promise((resolve) => setTimeout(resolve, 600));
    document.body.classList.remove('theme-light', 'theme-dark');
    document.body.classList.add('theme-${appearance}');
    if (mode === 'reading') {
      let code = view.contentEl.querySelector('pre > code.language-python');
      if (!code) {
        const scroller = view.contentEl.querySelector('.markdown-preview-view');
        for (let i = 0; i < 30 && !code; i++) {
          scroller.scrollTop += Math.max(400, scroller.clientHeight * 0.7);
          await new Promise((resolve) => setTimeout(resolve, 120));
          code = view.contentEl.querySelector('pre > code.language-python');
        }
      }
      if (code) code.scrollIntoView({ block: 'center' });
      if (view.previewMode?.renderer?.onRender) view.previewMode.renderer.onRender();
    } else {
      const text = view.editor.getValue();
      const line = text.split('\\n').findIndex((value) => value.includes('# python comment'));
      view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line: line + 5, ch: 0 } }, true);
      view.editor.cm.measure();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    return true;
  })()`);
  await wait(500);
}

const PHASES = {
  prepare: async (context) => {
    const data = await context.main.eval(`(${pagePrepare})(${JSON.stringify({ note: NOTE, pluginId: PLUGIN_ID })})`);
    record(context.results, 'prepare', data);
    return data;
  },
  accuracy: async (context) => {
    const data = await context.main.eval(`(${pageThemeAccuracy})(${JSON.stringify({
      note: NOTE,
      pluginId: PLUGIN_ID,
      expected: expectedThemeColors,
      appearances: Object.fromEntries(themeCatalog.THEME_LIST.map((theme) => [theme.id, theme.appearance])),
    })})`);
    record(context.results, 'accuracy', data);
    return data;
  },
  matrix: async (context) => {
    const data = await context.main.eval(`(${pageModeMatrix})(${JSON.stringify({
      note: NOTE,
      pluginId: PLUGIN_ID,
      pairs: [
        { name: 'atom-one', light: 'atom-one-light', dark: 'atom-one-dark' },
        { name: 'github+catppuccin', light: 'github-light-default', dark: 'catppuccin-mocha' },
        { name: 'ayu+vscode', light: 'ayu-light', dark: 'vscode-dark-modern' },
      ],
      languages: ['python', 'javascript', 'json', 'bash', 'html', 'css'],
      modes: ['live-preview', 'source', 'reading'],
    })})`);
    record(context.results, 'matrix', data);
    return data;
  },
  boundary: async (context) => {
    const data = await context.main.eval(`(${pageBoundary})(${JSON.stringify({
      note: NOTE,
      pluginId: PLUGIN_ID,
      pairA: { light: 'github-light-default', dark: 'catppuccin-mocha', coloredBrackets: true },
      pairB: { light: 'ayu-light', dark: 'vscode-dark-modern', coloredBrackets: false },
    })})`);
    record(context.results, 'boundary', data);
    return data;
  },
  editing: async (context) => {
    const data = await context.main.eval(`(${pageEditingScrolling})(${JSON.stringify({ note: NOTE, pluginId: PLUGIN_ID })})`);
    record(context.results, 'editing', data);
    return data;
  },
  settingsUI: async (context) => {
    const settingsPage = await openSettings(context.main);
    context.settingsPage = settingsPage;
    const initial = await settingsUiSnapshot(settingsPage);
    await setBodyClass(settingsPage, 'light');
    await settingsPage.screenshot(path.join(EVIDENCE, 'settings-light.png'));
    await setBodyClass(settingsPage, 'dark');
    await settingsPage.screenshot(path.join(EVIDENCE, 'settings-dark.png'));
    await setBodyClass(settingsPage, 'light');

    const before = await readPluginState(context.main);
    await setSettingsSelect(settingsPage, 1, 'github-light-default');
    await wait(1000);
    const lightChanged = await readPluginState(context.main);
    await setSettingsSelect(settingsPage, 2, 'catppuccin-mocha');
    await wait(1000);
    const darkChanged = await readPluginState(context.main);
    await setSettingsSelect(settingsPage, 0, 'ayu');
    await wait(1100);
    const presetAyu = await readPluginState(context.main);
    await setSettingsSelect(settingsPage, 0, 'dracula');
    await wait(1100);
    const presetDracula = await readPluginState(context.main);
    await toggleBrackets(settingsPage);
    await wait(1100);
    const bracketsOff = await readPluginState(context.main);
    await toggleBrackets(settingsPage);
    await wait(1100);
    const bracketsOn = await readPluginState(context.main);
    const finalUi = await settingsUiSnapshot(settingsPage);

    await setSettings(context.main, { light: 'github-light-default', dark: 'catppuccin-mocha', coloredBrackets: true });
    await prepareNoteScreenshot(context.main, { mode: 'live-preview', appearance: 'light' });
    await context.main.screenshot(path.join(EVIDENCE, 'note-light-github-catppuccin.png'));
    await prepareNoteScreenshot(context.main, { mode: 'live-preview', appearance: 'dark' });
    await context.main.screenshot(path.join(EVIDENCE, 'note-dark-github-catppuccin.png'));
    await setSettings(context.main, { light: 'ayu-light', dark: 'dracula-official', coloredBrackets: true });
    await prepareNoteScreenshot(context.main, { mode: 'reading', appearance: 'light' });
    await context.main.screenshot(path.join(EVIDENCE, 'reading-light-ayu-dracula.png'));
    await prepareNoteScreenshot(context.main, { mode: 'reading', appearance: 'dark' });
    await context.main.screenshot(path.join(EVIDENCE, 'reading-dark-ayu-dracula.png'));
    await setSettings(context.main, { light: 'github-light-default', dark: 'catppuccin-mocha', coloredBrackets: true });

    const pass = initial.selectCount === 3 &&
      initial.optionCounts[0] === 7 && initial.optionCounts[1] === 6 && initial.optionCounts[2] === 11 &&
      initial.previewBlocks === 2 && initial.previewSpans > 0 && initial.hasBracketToggle &&
      lightChanged.settings.light === 'github-light-default' &&
      darkChanged.settings.dark === 'catppuccin-mocha' &&
      presetAyu.settings.light === 'ayu-light' && presetAyu.settings.dark === 'ayu-dark' &&
      presetDracula.settings.light === 'ayu-light' && presetDracula.settings.dark === 'dracula-official' &&
      bracketsOff.settings.coloredBrackets === false && bracketsOn.settings.coloredBrackets === true &&
      finalUi.selectCount === 3;
    const data = { pass, initial, before, lightChanged, darkChanged, presetAyu, presetDracula, bracketsOff, bracketsOn, finalUi };
    record(context.results, 'settingsUI', data);
    return data;
  },
  commandModal: async (context) => {
    console.error('commandModal: finding settings page');
    const settingsPage = context.settingsPage || await findSettingsPage(10000);
    context.settingsPage = settingsPage;
    console.error('commandModal: settings page found');
    await setSettings(context.main, { light: 'github-light-default', dark: 'catppuccin-mocha', coloredBrackets: true });
    await setBodyClass(settingsPage, 'light');
    console.error('commandModal: opening command modal');
    const { page, snapshot } = await commandModalSnapshot(context);
    console.error('commandModal: modal found', page.target.title);
    await wait(400);
    await page.screenshot(path.join(EVIDENCE, 'command-modal.png'));
    console.error('commandModal: screenshot saved');
    await page.eval(`(() => { const modal = document.querySelector('.aof-theme-modal'); const cancel = [...modal.querySelectorAll('button')].find((button) => button.textContent === '取消'); if (!cancel) throw new Error('cancel missing'); cancel.click(); return true; })()`);
    await wait(500);
    const closed = await page.eval('!document.querySelector(".aof-theme-modal")');
    const commands = await context.main.eval(`Object.keys(app.commands.commands).filter((id) => id.startsWith(${JSON.stringify(PLUGIN_ID + ':')}))`);
    const data = { pass: snapshot.exists && snapshot.selectCount === 3 && snapshot.buttons.includes('应用') && closed && commands.length === 2, snapshot, closed, commands };
    record(context.results, 'commandModal', data);
    page.close();
    return data;
  },
  performance: async (context) => {
    const data = await context.main.eval(`(${pagePerformance})(${JSON.stringify({
      pluginId: PLUGIN_ID,
      pairA: { light: 'github-light-default', dark: 'catppuccin-mocha', coloredBrackets: true },
      pairB: { light: 'ayu-light', dark: 'vscode-dark-modern', coloredBrackets: true },
      iterations: 12,
    })})`);
    record(context.results, 'performance', data);
    return data;
  },
  fallback: async (context) => {
    const before = await readPluginState(context.main);
    await context.main.eval(`app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});true`);
    await wait(800);
    fs.writeFileSync(DATA_PATH, JSON.stringify({ light: 'missing-light', dark: 'missing-dark', coloredBrackets: false }, null, 2) + '\n');
    await context.main.eval(`(async () => { await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)}); return true; })()`);
    await wait(1300);
    const loaded = await readPluginState(context.main);
    await setSettings(context.main, before.settings);
    await wait(500);
    const restored = await readPluginState(context.main);
    const pass = Boolean(loaded && loaded.engineReady &&
      loaded.settings.light === 'atom-one-light' &&
      loaded.settings.dark === 'atom-one-dark' &&
      loaded.settings.coloredBrackets === false &&
      restored.settings.light === before.settings.light &&
      restored.settings.dark === before.settings.dark);
    const data = { pass, before, loaded, restored };
    record(context.results, 'fallback', data);
    return data;
  },
  persistence: async (context) => {
    const desired = { light: 'github-light-default', dark: 'catppuccin-mocha', coloredBrackets: false };
    await setSettings(context.main, desired);
    await wait(700);
    const savedBefore = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    const beforeState = await readPluginState(context.main);
    await killIsolatedObsidian();
    const restarted = await launchIsolatedObsidian();
    context.main.close();
    context.main = restarted;
    const prepared = await context.main.eval(`(${pagePrepare})(${JSON.stringify({ note: NOTE, pluginId: PLUGIN_ID })})`);
    const verified = await context.main.eval(`(${pageVerifyPersisted})(${JSON.stringify({ note: NOTE, pluginId: PLUGIN_ID, pair: desired, expectedToken: 'rgb(5, 80, 174)' })})`);
    const savedAfter = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    const pass = savedBefore.light === desired.light && savedBefore.dark === desired.dark &&
      savedBefore.coloredBrackets === false &&
      savedAfter.light === desired.light && savedAfter.dark === desired.dark &&
      verified.pass && verified.tokenColor === verified.expectedToken &&
      verified.settings.coloredBrackets === false;
    const data = { pass, desired, savedBefore, beforeState, prepared, verified, savedAfter };
    record(context.results, 'persistence', data);
    return data;
  },
};

async function main() {
  const results = { formatVersion: 1, startedAt: new Date().toISOString(), vault: VAULT, phases: {} };
  const context = { main: null, settingsPage: null, results };
  try {
    context.main = await connectMain();
    const phases = ONLY_PHASE ? [ONLY_PHASE] : Object.keys(PHASES);
    for (const phase of phases) {
      const fn = PHASES[phase];
      if (!fn) throw new Error('Unknown phase: ' + phase);
      process.stdout.write(`Phase ${phase} ... `);
      const data = await fn(context);
      console.log(data?.pass === false ? 'FAIL' : 'ok');
      if (data?.pass === false) console.log(JSON.stringify(data.failures?.slice(0, 5) || data, null, 2));
    }
    results.finishedAt = new Date().toISOString();
    results.pass = Object.values(results.phases).every((phase) => phase.pass !== false);
    fs.writeFileSync(path.join(EVIDENCE, 'real-obsidian-results.json'), JSON.stringify(results, null, 2) + '\n');
    console.log(results.pass ? 'REAL OBSIDIAN PHASES PASSED' : 'REAL OBSIDIAN PHASES FAILED');
    if (!results.pass) process.exitCode = 1;
  } finally {
    context.main?.close();
    context.settingsPage?.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
