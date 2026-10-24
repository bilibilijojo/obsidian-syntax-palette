/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

const { Plugin, PluginSettingTab, Setting, Modal, Notice, MarkdownRenderChild, editorInfoField } = require('obsidian');
const { ViewPlugin, Decoration, WidgetType } = require('@codemirror/view');
const { StateEffect, RangeSetBuilder } = require('@codemirror/state');
const { syntaxTree, tokenClassNodeProp } = require('@codemirror/language');
const { SyntaxEngine, canonical } = require('./engine.cjs');
const { fencedBlocks, allFencedBlocks, codeBlockTokens } = require('./fences.cjs');
const {
  normalizeSettings,
  patchSettings,
  applyPreset,
  sameSettings,
  themeOptions,
  familyOptions,
} = require('./settings.cjs');
const themeCatalog = require('./themes.cjs');
const { buildHighlightCss, buildFallbackCss, highlightName, highlightClass } = require('./highlight-style.cjs');
const { buildBackgroundCss } = require('./background-style.cjs');
const { buildLineNumberCss } = require('./line-number-style.cjs');
const { buildWrapCss } = require('./wrap-style.cjs');
const { EditorFenceScroll } = require('./editor-scroll.cjs');
const { blockNumberRows, digitsFor, readingNumbering, READING_STYLE_PROPERTIES } = require('./line-numbers.cjs');
// tools/build-plugin.cjs replaces this compile-time value with the locked WASM payload.
const embeddedOnigWasmBase64 = __SYNTAX_PALETTE_ONIG_WASM_BASE64__;

const PLUGIN_ID = 'syntax-palette';
const refreshEffect = StateEffect.define();
const PREVIEW_SAMPLE = 'const answer = 42; // themed comment\nfunction greet(name) { return "hello, " + name; }';
const FENCED_LINE_CLASS = 'aof-fenced-line';
const FENCED_BLOCK_CLASS = 'aof-fenced-block';
const LINE_NUMBER_CLASS = 'aof-ln-on';
const LINE_NUMBER_LINE_CLASS = 'aof-ln-line';
// Attached to every line of a fenced block while the editor wrap setting is
// OFF (the default). The class never appears outside fenced code, so ordinary
// markdown text keeps Obsidian's native soft wrapping.
const NOWRAP_LINE_CLASS = 'aof-nowrap';
const LINE_NUMBER_ATTR = 'data-aof-ln';
const LINE_NUMBER_COUNT_ATTR = 'data-aof-ln-count';
const LINE_NUMBER_BASE_PAD_ATTR = 'data-aof-ln-base-pad';
// One cached line decoration per flag combination (background / no-wrap).
// Class-only decorations are idempotent, so sharing the instances keeps the
// per-keystroke allocation bounded.
const fenceLineDecorations = new Map();
// One cached line decoration per (gutter width, background, wrap) pair. The
// class reserves the gutter in CSS, which is what keeps the code column fixed
// while CodeMirror mounts the absolute number widget during scrolling.
const gutterLineDecorations = new Map();
// Fenced code is only a small part of a note, so a plain cache keyed by the
// exact widget keeps per-keystroke allocation bounded.
const editorNumberWidgets = new Map();
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

function isWasmModule(bytes) {
  return Boolean(bytes && bytes.length >= 8 && WASM_MAGIC.every((value, index) => bytes[index] === value));
}

// Normalize the embedded base64 payload (and test-provided byte arrays) before
// handing it to vscode-oniguruma, so malformed bundles fail with a useful error.
function toWasmBytes(buffer) {
  if (!buffer) return null;
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (typeof buffer === 'string') {
    try {
      const binary = atob(buffer.trim());
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch (error) {
      return null;
    }
  }
  return null;
}

// The number is a zero-length CodeMirror widget placed at the first character
// of the code line. Being inline content, it shares the line box (one number
// per logical line, even when the line soft-wraps), it is not part of the
// document, and it sits inside the code block background even when the fence
// lives in a list or blockquote.
class LineNumberWidget extends WidgetType {
  constructor(number, widthClass, inline) {
    super();
    this.number = number;
    this.widthClass = widthClass;
    this.inline = inline;
  }

  eq(other) {
    return other.number === this.number && other.widthClass === this.widthClass && other.inline === this.inline;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = `aof-ln ${this.widthClass}${this.inline ? ' aof-ln-inline' : ''}`;
    span.setAttribute('aria-hidden', 'true');
    span.textContent = String(this.number);
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

function lineNumberWidget(number, widthClass, inline) {
  const key = `${number}|${widthClass}|${inline ? 'inline' : 'gutter'}`;
  let decoration = editorNumberWidgets.get(key);
  if (decoration) return decoration;
  decoration = Decoration.widget({
    widget: new LineNumberWidget(number, widthClass, inline),
    side: -1,
  });
  if (editorNumberWidgets.size > 4000) editorNumberWidgets.clear();
  editorNumberWidgets.set(key, decoration);
  return decoration;
}

function fenceLineDecoration(background, nowrap) {
  const key = `${background ? 'bg' : 'plain'}|${nowrap ? 'nw' : 'plain'}`;
  let decoration = fenceLineDecorations.get(key);
  if (decoration) return decoration;
  const classes = [];
  if (background) classes.push(FENCED_LINE_CLASS);
  if (nowrap) classes.push(NOWRAP_LINE_CLASS);
  decoration = Decoration.line({ class: classes.join(' ') });
  if (fenceLineDecorations.size > 64) fenceLineDecorations.clear();
  fenceLineDecorations.set(key, decoration);
  return decoration;
}

// The number is line *attribute* data rendered by CSS `::before`, never a
// CodeMirror widget. A widget is measured and mounted asynchronously, so on a
// phone each line that scrolls in costs a measure pass and its number pops in
// one frame late (the "flash" in the field report); generated content belongs
// to the line's own render and costs neither.
function gutterLineDecoration(number, widthClass, background, nowrap) {
  const key = `${number}|${widthClass}|${background ? 'bg' : 'plain'}|${nowrap ? 'nw' : 'plain'}`;
  let decoration = gutterLineDecorations.get(key);
  if (decoration) return decoration;
  const classes = [LINE_NUMBER_LINE_CLASS, widthClass.replace('aof-ln-w', 'aof-lng-')];
  if (background) classes.unshift(FENCED_LINE_CLASS);
  if (nowrap) classes.push(NOWRAP_LINE_CLASS);
  decoration = Decoration.line({
    class: classes.join(' '),
    attributes: { 'data-aof-n': String(number) },
  });
  if (gutterLineDecorations.size > 4000) gutterLineDecorations.clear();
  gutterLineDecorations.set(key, decoration);
  return decoration;
}

function themeName(id) {
  const theme = themeCatalog.getTheme(id);
  return theme ? theme.name : id;
}

function notifyDarkOnlyPreset(familyId) {
  const family = themeCatalog.getFamily(familyId);
  if (family && !family.presets.light) {
    new Notice(`${family.name} 仅提供深色版本，浅色选择保持不变。`);
  }
}

function comparableReadingText(value) {
  // Obsidian's reading renderer may append one or two trailing newlines to the
  // native code element. This normalization is only used to pair a <pre> with
  // its source block; it never changes the displayed text.
  return String(value).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

class SyntaxThemeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.lightDropdown = null;
    this.darkDropdown = null;
    this.presetDropdown = null;
    this.bracketToggle = null;
    this.backgroundToggle = null;
    this.lineNumberToggle = null;
    this.wrapToggle = null;
    this.statusEl = null;
    this.previewEl = null;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('aof-settings');
    this.lightDropdown = null;
    this.darkDropdown = null;
    this.presetDropdown = null;
    this.bracketToggle = null;
    this.backgroundToggle = null;
    this.lineNumberToggle = null;
    this.wrapToggle = null;

    containerEl.createEl('h2', { text: '语法配色' });
    containerEl.createEl('p', {
      cls: 'aof-intro',
      text: '仅改变 Markdown 围栏代码内部的语法文字颜色，并可选择使用所选主题的原生代码块背景、显示代码行号。代码块边框、字体、排版以及 Obsidian 主题外观保持不变。',
    });

    new Setting(containerEl)
      .setName('主题系列快速预设')
      .setDesc('一次设置一对浅色 / 深色配色；之后仍可分别调整任意一侧。')
      .addDropdown((dropdown) => {
        this.presetDropdown = dropdown;
        dropdown.addOption('', '选择主题系列…');
        for (const family of familyOptions()) dropdown.addOption(family.value, family.label);
        dropdown.setValue('');
        dropdown.onChange(async (familyId) => {
          if (!familyId) return;
          dropdown.setValue('');
          await this.plugin.applyFamilyPreset(familyId);
          this.syncControls();
          notifyDarkOnlyPreset(familyId);
        });
      });

    new Setting(containerEl)
      .setName('浅色模式配色')
      .setDesc('Obsidian 使用浅色外观时应用的语法配色。')
      .addDropdown((dropdown) => {
        this.lightDropdown = dropdown;
        for (const option of themeOptions('light')) dropdown.addOption(option.value, option.label);
        dropdown.setValue(this.plugin.settings.light);
        dropdown.onChange(async (value) => {
          await this.plugin.updateSettings({ light: value });
          this.syncControls();
        });
      });

    new Setting(containerEl)
      .setName('深色模式配色')
      .setDesc('Obsidian 使用深色外观时应用的语法配色。')
      .addDropdown((dropdown) => {
        this.darkDropdown = dropdown;
        for (const option of themeOptions('dark')) dropdown.addOption(option.value, option.label);
        dropdown.setValue(this.plugin.settings.dark);
        dropdown.onChange(async (value) => {
          await this.plugin.updateSettings({ dark: value });
          this.syncControls();
        });
      });

    new Setting(containerEl)
      .setName('使用所选主题的代码块背景')
      .setDesc('默认关闭。关闭时保留 Obsidian 当前主题的代码块背景；开启后仅把围栏代码块的背景替换为当前浅色或深色配色主题的原生编辑器背景。')
      .addToggle((toggle) => {
        this.backgroundToggle = toggle;
        toggle.setValue(this.plugin.settings.codeBlockBackground);
        toggle.onChange(async (value) => {
          await this.plugin.updateSettings({ codeBlockBackground: value });
          this.syncControls();
        });
      });

    new Setting(containerEl)
      .setName('显示代码块行号')
      .setDesc('默认关闭。开启后，每个 Markdown 围栏代码块从 1 开始独立编号；空行计数，软换行不额外编号，行号不会写入笔记，也不会被复制。')
      .addToggle((toggle) => {
        this.lineNumberToggle = toggle;
        toggle.setValue(this.plugin.settings.lineNumbers);
        toggle.onChange(async (value) => {
          await this.plugin.updateSettings({ lineNumbers: value });
          this.syncControls();
        });
      });

    new Setting(containerEl)
      .setName('编辑视图代码块自动换行')
      .setDesc('默认关闭。关闭时，编辑视图中的围栏代码块不随窗口宽度自动换行，超长行保持单行，可横向滚动查看（与阅读视图一致）；开启时恢复 Obsidian 原生自动换行。仅影响代码块内容，不影响普通文本，也不影响阅读视图。')
      .addToggle((toggle) => {
        this.wrapToggle = toggle;
        toggle.setValue(this.plugin.settings.wrapCodeBlocks === true);
        toggle.onChange(async (value) => {
          await this.plugin.updateSettings({ wrapCodeBlocks: value });
          this.syncControls();
        });
      });

    new Setting(containerEl)
      .setName('彩色括号')
      .setDesc('使用 VS Code 默认括号配色区分嵌套层级；关闭后括号使用当前主题自身颜色。')
      .addToggle((toggle) => {
        this.bracketToggle = toggle;
        toggle.setValue(this.plugin.settings.coloredBrackets);
        toggle.onChange(async (value) => {
          await this.plugin.updateSettings({ coloredBrackets: value });
          this.syncControls();
        });
      });

    this.statusEl = containerEl.createDiv({ cls: 'aof-status' });
    const previewSection = containerEl.createDiv({ cls: 'aof-preview-section' });
    previewSection.createEl('h3', { text: '语法配色预览' });
    this.previewEl = previewSection.createDiv({ cls: 'aof-preview' });
    containerEl.createEl('p', {
      cls: 'aof-note',
      text: '内置主题来自各项目官方 VS Code 扩展发布包或 Microsoft VS Code 内置主题；来源、版本及 MIT / Apache-2.0 许可证随插件附带于 THIRD-PARTY-NOTICES.txt。插件离线运行，不下载主题。',
    });
    this.syncControls();
  }

  syncControls() {
    if (!this.statusEl) return;
    const settings = this.plugin.settings;
    try {
      this.lightDropdown?.setValue(settings.light);
      this.darkDropdown?.setValue(settings.dark);
      this.bracketToggle?.setValue(settings.coloredBrackets);
      this.backgroundToggle?.setValue(settings.codeBlockBackground);
      this.lineNumberToggle?.setValue(settings.lineNumbers);
      this.wrapToggle?.setValue(settings.wrapCodeBlocks === true);
    } catch (error) {
      // Controls may have been rebuilt or removed while an async update was in flight.
    }
    this.statusEl.empty();
    const lightLine = this.statusEl.createDiv({ cls: 'aof-status-line' });
    lightLine.createSpan({ cls: 'aof-status-label', text: '浅色：' });
    lightLine.createSpan({ text: themeName(settings.light) });
    const darkLine = this.statusEl.createDiv({ cls: 'aof-status-line' });
    darkLine.createSpan({ cls: 'aof-status-label', text: '深色：' });
    darkLine.createSpan({ text: themeName(settings.dark) });
    const bracketLine = this.statusEl.createDiv({ cls: 'aof-status-line' });
    bracketLine.createSpan({ cls: 'aof-status-label', text: '彩色括号：' });
    bracketLine.createSpan({ text: settings.coloredBrackets ? '开启' : '关闭' });
    const backgroundLine = this.statusEl.createDiv({ cls: 'aof-status-line' });
    backgroundLine.createSpan({ cls: 'aof-status-label', text: '代码块背景：' });
    backgroundLine.createSpan({ text: settings.codeBlockBackground ? '使用所选主题背景' : 'Obsidian 原生背景' });
    const lineNumberLine = this.statusEl.createDiv({ cls: 'aof-status-line' });
    lineNumberLine.createSpan({ cls: 'aof-status-label', text: '代码行号：' });
    lineNumberLine.createSpan({ text: settings.lineNumbers ? '开启（每块从 1 开始）' : '关闭' });
    const wrapLine = this.statusEl.createDiv({ cls: 'aof-status-line' });
    wrapLine.createSpan({ cls: 'aof-status-label', text: '编辑视图换行：' });
    wrapLine.createSpan({ text: settings.wrapCodeBlocks === true ? '自动换行' : '不换行（横向滚动）' });
    // This distinguishes "the engine never started" from "the engine ran but
    // the current WebView could not paint the custom highlight".
    const renderLine = this.statusEl.createDiv({ cls: 'aof-status-line' });
    renderLine.createSpan({ cls: 'aof-status-label', text: '渲染方式：' });
    renderLine.createSpan({
      text: this.plugin.highlightMode === 'custom'
        ? 'CSS Custom Highlight（系统原生）'
        : this.plugin.highlightMode === 'fallback'
          ? '兼容渲染（不依赖系统高亮 API）'
          : '未启用',
    });
    const resourceLine = this.statusEl.createDiv({ cls: 'aof-status-line' });
    resourceLine.createSpan({ cls: 'aof-status-label', text: '引擎资源：' });
    resourceLine.createSpan({
      text: this.plugin.engineReady
        ? `${String(this.plugin.wasmSource || '').startsWith('adapter') ? 'vault 内读取' : '内置'} · ${Math.round((this.plugin.wasmBytes || 0) / 1024)} KB`
        : '未加载',
    });
    if (settings.codeBlockBackground) {
      const lightTheme = themeCatalog.getTheme(settings.light);
      const darkTheme = themeCatalog.getTheme(settings.dark);
      const missing = [];
      if (!lightTheme?.background) missing.push('浅色');
      if (!darkTheme?.background) missing.push('深色');
      if (missing.length) {
        this.statusEl.createDiv({
          cls: 'aof-status-warning',
          text: `${missing.join('、')}主题未提供有效编辑器背景，将安全回退到 Obsidian 原生背景。`,
        });
      }
    }
    if (this.plugin.highlightMode === 'fallback') {
      this.statusEl.createDiv({
        cls: 'aof-status-warning',
        text: '当前运行环境不支持 CSS Custom Highlight，已启用兼容渲染；配色、代码块背景与行号功能保持一致。',
      });
    }
    if (!this.plugin.engineReady) {
      this.statusEl.createDiv({
        cls: 'aof-status-warning',
        text: '配色引擎未加载，当前保留 Obsidian 原生高亮。',
      });
    } else if (this.plugin.engineWarnings.length) {
      const warnings = this.plugin.engineWarnings.map((warning) => (
        `${warning.side === 'light' ? '浅色' : '深色'}主题加载失败，已回退到 ${themeName(warning.effective)}`
      ));
      this.statusEl.createDiv({ cls: 'aof-status-warning', text: warnings.join('；') });
    }
    this.renderPreview();
  }

  renderPreview() {
    if (!this.previewEl) return;
    this.previewEl.empty();
    const preview = this.plugin.getPreview();
    if (!preview) {
      this.previewEl.createDiv({
        cls: 'aof-preview-unavailable',
        text: '配色引擎暂不可用，无法生成预览。',
      });
      return;
    }
    const settings = this.plugin.settings;
    for (const appearance of ['light', 'dark']) {
      const block = this.previewEl.createDiv({ cls: 'aof-preview-block' });
      const theme = themeCatalog.getTheme(appearance === 'light' ? settings.light : settings.dark);
      const background = theme?.background || null;
      const backgroundDescription = settings.codeBlockBackground
        ? background
          ? `主题背景 ${background}`
          : '主题无有效背景，回退原生'
        : 'Obsidian 原生背景';
      block.createDiv({
        cls: 'aof-preview-label',
        text: `${appearance === 'light' ? '浅色模式' : '深色模式'} · ${backgroundDescription}`,
      });
      const pre = block.createEl('pre', { cls: 'aof-preview-code' });
      if (settings.codeBlockBackground && background) {
        pre.addClass('aof-preview-code--themed');
        pre.style.backgroundColor = background;
      }
      const sampleLines = preview.sample.split('\n');
      preview.rows.forEach((row, index) => {
        if (index > 0) pre.appendChild(document.createTextNode('\n'));
        for (const segment of row) {
          if (!segment[appearance]) continue;
          const span = pre.createEl('span', {
            text: sampleLines[index].slice(segment.from, segment.to),
          });
          span.style.color = segment[appearance];
        }
      });
    }
  }
}

class SyntaxThemeModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.pending = { ...plugin.settings };
    this.lightDropdown = null;
    this.darkDropdown = null;
    this.presetDropdown = null;
    this.bracketToggle = null;
    this.backgroundToggle = null;
    this.lineNumberToggle = null;
    this.wrapToggle = null;
    this.statusEl = null;
  }

  onOpen() {
    this.modalEl.addClass('aof-theme-modal');
    this.titleEl.setText('选择语法配色');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('p', {
      cls: 'aof-intro',
      text: '浅色和深色可以独立选择，也可以先用主题系列预设再微调。',
    });

    new Setting(contentEl)
      .setName('主题系列快速预设')
      .addDropdown((dropdown) => {
        this.presetDropdown = dropdown;
        dropdown.addOption('', '选择主题系列…');
        for (const family of familyOptions()) dropdown.addOption(family.value, family.label);
        dropdown.setValue('');
        dropdown.onChange((familyId) => {
          if (!familyId) return;
          this.pending = applyPreset(this.pending, familyId);
          dropdown.setValue('');
          this.sync();
          notifyDarkOnlyPreset(familyId);
        });
      });

    new Setting(contentEl)
      .setName('浅色模式配色')
      .addDropdown((dropdown) => {
        this.lightDropdown = dropdown;
        for (const option of themeOptions('light')) dropdown.addOption(option.value, option.label);
        dropdown.setValue(this.pending.light);
        dropdown.onChange((value) => {
          this.pending = patchSettings(this.pending, { light: value });
          this.sync();
        });
      });

    new Setting(contentEl)
      .setName('深色模式配色')
      .addDropdown((dropdown) => {
        this.darkDropdown = dropdown;
        for (const option of themeOptions('dark')) dropdown.addOption(option.value, option.label);
        dropdown.setValue(this.pending.dark);
        dropdown.onChange((value) => {
          this.pending = patchSettings(this.pending, { dark: value });
          this.sync();
        });
      });

    new Setting(contentEl)
      .setName('使用所选主题的代码块背景')
      .addToggle((toggle) => {
        this.backgroundToggle = toggle;
        toggle.setValue(this.pending.codeBlockBackground);
        toggle.onChange((value) => {
          this.pending = patchSettings(this.pending, { codeBlockBackground: value });
          this.sync();
        });
      });

    new Setting(contentEl)
      .setName('显示代码块行号')
      .addToggle((toggle) => {
        this.lineNumberToggle = toggle;
        toggle.setValue(this.pending.lineNumbers);
        toggle.onChange((value) => {
          this.pending = patchSettings(this.pending, { lineNumbers: value });
          this.sync();
        });
      });

    new Setting(contentEl)
      .setName('编辑视图代码块自动换行')
      .addToggle((toggle) => {
        this.wrapToggle = toggle;
        toggle.setValue(this.pending.wrapCodeBlocks === true);
        toggle.onChange((value) => {
          this.pending = patchSettings(this.pending, { wrapCodeBlocks: value });
          this.sync();
        });
      });

    new Setting(contentEl)
      .setName('彩色括号')
      .addToggle((toggle) => {
        this.bracketToggle = toggle;
        toggle.setValue(this.pending.coloredBrackets);
        toggle.onChange((value) => {
          this.pending = patchSettings(this.pending, { coloredBrackets: value });
          this.sync();
        });
      });

    this.statusEl = contentEl.createDiv({ cls: 'aof-status' });
    new Setting(contentEl)
      .addButton((button) => button.setButtonText('取消').onClick(() => this.close()))
      .addButton((button) => button.setButtonText('应用').setCta().onClick(async () => {
        await this.plugin.updateSettings(this.pending);
        this.close();
      }));
    this.sync();
  }

  sync() {
    try {
      this.lightDropdown?.setValue(this.pending.light);
      this.darkDropdown?.setValue(this.pending.dark);
      this.bracketToggle?.setValue(this.pending.coloredBrackets);
      this.backgroundToggle?.setValue(this.pending.codeBlockBackground);
      this.lineNumberToggle?.setValue(this.pending.lineNumbers);
      this.wrapToggle?.setValue(this.pending.wrapCodeBlocks === true);
    } catch (error) {
      // Ignore stale components after the modal closes.
    }
    if (!this.statusEl) return;
    this.statusEl.empty();
    this.statusEl.createDiv({ text: `浅色：${themeName(this.pending.light)}` });
    this.statusEl.createDiv({ text: `深色：${themeName(this.pending.dark)}` });
    this.statusEl.createDiv({ text: `代码块背景：${this.pending.codeBlockBackground ? '使用所选主题背景' : 'Obsidian 原生背景'}` });
    this.statusEl.createDiv({ text: `代码行号：${this.pending.lineNumbers ? '开启（每块从 1 开始）' : '关闭'}` });
    this.statusEl.createDiv({ text: `编辑视图换行：${this.pending.wrapCodeBlocks === true ? '自动换行' : '不换行（横向滚动）'}` });
    this.statusEl.createDiv({ text: `彩色括号：${this.pending.coloredBrackets ? '开启' : '关闭'}` });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// A field diagnostic that answers the questions a screenshot cannot: is the
// API present, did the engine load, how many ranges were registered, and does
// the block's DOM contain nested token spans.
class DiagnosticsModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.report = null;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText('语法高亮诊断');
    this.summaryEl = contentEl.createDiv({ cls: 'aof-diagnostics-summary' });
    this.outputEl = contentEl.createEl('textarea', { cls: 'aof-diagnostics-output' });
    this.outputEl.readOnly = true;
    const actions = contentEl.createDiv({ cls: 'aof-diagnostics-actions' });
    new Setting(actions)
      .addButton((button) => button.setButtonText('重新检测').onClick(() => this.refresh()))
      .addButton((button) => button.setButtonText('复制报告').setCta().onClick(() => this.copy()));
    this.refresh();
  }

  refresh() {
    this.report = this.plugin.collectDiagnostics();
    this.outputEl.value = JSON.stringify(this.report, null, 2);
    this.summaryEl.empty();
    const report = this.report;
    const mode = report.capabilities.mode === 'custom' ? 'CSS Custom Highlight' : '兼容渲染（DOM 包裹 / 编辑器标记）';
    const lines = [
      `运行环境：${report.runtime.viewport} · DPR ${report.runtime.devicePixelRatio}`,
      `高亮方式：${mode} · API ${report.capabilities.cssHighlights ? '可用' : '不可用'} · 选择器 ${report.capabilities.selectorSupport === false ? '不支持' : '支持'}`,
      `配色引擎：${report.engine.ready ? `已加载（${report.engine.wasmBytes} 字节）` : `未加载（${report.engine.error || '未知原因'}）`}`,
      `阅读模式：${report.reading.found ? `${report.reading.registeredRanges ?? 0} 个范围 / ${report.reading.tokenSpans} 个兼容标记 / ${report.reading.tokenSpansInNested ?? 0} 个嵌套标记` : '未打开阅读视图'}`,
      `编辑模式：${report.editor.found ? `${report.editor.codeLines} 个代码行 / ${report.editor.tokenSpans} 个兼容标记` : '未打开编辑视图'}`,
    ];
    for (const line of lines) this.summaryEl.createDiv({ text: line });
  }

  async copy() {
    const text = JSON.stringify(this.report, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      new Notice('诊断报告已复制。');
      return;
    } catch (error) {
      // Some desktop WebViews reject async clipboard access without a gesture.
    }
    this.outputEl.focus();
    this.outputEl.select();
    try {
      document.execCommand('copy');
      new Notice('诊断报告已复制。');
    } catch (error) {
      new Notice('复制失败，请选中报告后按 Ctrl/Cmd+C。');
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

module.exports = class AtomOneFencedSyntax extends Plugin {
  async onload() {
    this.active = true;
    this.readingOriginals = new Map();
    this.readingObservers = new Map();
    this.readingPalettes = new Map();
    this.readingLanguages = new Map();
    this.readingBackgroundElements = new Set();
    this.readingTokenCache = null;
    this.readingContext = null;
    this.readingContainerObservers = new Map();
    this.readingRescanTimer = null;
    this.readingRescanLongTimer = null;
    this.readingNumberElements = new Set();
    this.readingNumberGeometryTimer = null;
    // Coalesces bursts of width/theme notifications into one relayout. The
    // flag bounds a resize burst to one measurement instead of one per event.
    this.readingNumberGeometryQueued = false;
    // Incremental reading-gutter measurement state. A block is measured once
    // when it mounts (or when its line count changes); steady blocks are never
    // re-measured by scroll-time passes. The passes themselves are coalesced
    // into one per animation frame, and the settling re-check runs on the next
    // idle slot, so a scroll gesture is never interrupted by a forced layout.
    this.readingRemeasureQueue = new Set();
    this.recentlyMeasuredPres = [];
    this.pendingReadingMeasureAll = false;
    this.readingMeasureFrame = null;
    this.readingMeasureGeneration = 0;
    this.readingMeasureRecheckScheduled = false;
    // Per-<pre> applied-state memo for reading rescans: a node already carrying
    // the state the current settings ask for is skipped entirely (no
    // getSectionInfo, no numbering recompute, no attribute writes). A host
    // re-render always produces a new <pre> node, so the memo can never hide a
    // real change; it only removes the per-rescan redundant work.
    this.readingPreMemo = new WeakMap();
    this.editorRanges = new Map();
    this.editorViews = new Set();
    // The highlight/fallback CSS only changes when the palette (or fallback
    // class) *set* changes, so the <style> rebuild is gated on this flag
    // instead of re-deriving the whole string on every scroll measure pass.
    this.styleDirty = true;
    this.updateQueue = Promise.resolve();
    this.engineReady = false;
    this.engineError = null;
    this.engineWarnings = [];
    this.wasmSource = null;
    this.highlightSupported = false;
    this.highlightSelectorSupported = null;
    this.highlightMode = 'off';
    this.fallbackClasses = new Map();
    this.domTokenSpans = new Set();
    this.fallbackStyleTimer = null;
    this.wasmBytes = 0;

    try {
      const win = window;
      const hasApi = Boolean(win.Highlight && win.StaticRange && win.CSS?.highlights);
      // A runtime may expose the API but not parse `::highlight()` (older
      // WebKit builds did exactly that). Treat an explicit negative only.
      let selectorOk = true;
      try {
        if (typeof win.CSS?.supports === 'function') {
          selectorOk = win.CSS.supports('selector(::highlight(aof-probe))') !== false;
        }
      } catch (error) {
        selectorOk = true;
      }
      this.highlightSelectorSupported = selectorOk;
      this.highlightSupported = hasApi && selectorOk;
      this.highlightMode = hasApi && selectorOk ? 'custom' : 'fallback';
    } catch (error) {
      this.highlightSupported = false;
      this.highlightMode = 'fallback';
    }

    try {
      this.settings = normalizeSettings(await this.loadData());
    } catch (error) {
      console.error(`[${PLUGIN_ID}] Failed to load settings`, error);
      this.settings = normalizeSettings(null);
    }

    this.readingStyle = document.createElement('style');
    this.readingStyle.id = 'syntax-palette-highlight';
    document.head.appendChild(this.readingStyle);
    this.register(() => this.readingStyle.remove());

    this.backgroundStyle = document.createElement('style');
    this.backgroundStyle.id = 'syntax-palette-background';
    document.head.appendChild(this.backgroundStyle);
    this.register(() => this.backgroundStyle.remove());
    this.rebuildBackgroundStyle();

    this.lineNumberStyle = document.createElement('style');
    this.lineNumberStyle.id = 'syntax-palette-line-numbers';
    document.head.appendChild(this.lineNumberStyle);
    this.register(() => this.lineNumberStyle.remove());
    this.rebuildLineNumberStyle();

    // Code-block wrap presentation for the editing view. Empty while the wrap
    // setting is on (the editor then behaves exactly like stock Obsidian).
    this.wrapStyle = document.createElement('style');
    this.wrapStyle.id = 'syntax-palette-wrap';
    document.head.appendChild(this.wrapStyle);
    this.register(() => this.wrapStyle.remove());
    this.rebuildWrapStyle();

    this.engine = new SyntaxEngine();
    try {
      const wasm = await this.loadWasmBytes();
      const result = await this.engine.initialize(wasm, this.settings);
      this.engineReady = true;
      this.engineWarnings = result.warnings || [];
      if (this.engineWarnings.length) {
        new Notice('部分配色加载失败，已回退到 Atom One 默认配色。', 6000);
      }
    } catch (error) {
      this.engineReady = false;
      this.engineError = error;
      this.engine.dispose();
      console.error(`[${PLUGIN_ID}] Failed to initialize syntax engine`, error);
      new Notice('语法配色引擎加载失败，已保留 Obsidian 原生高亮。', 7000);
    }
    if (!this.active) return;

    const plugin = this;
    const extension = ViewPlugin.fromClass(class {
      constructor(view) {
        this.document = null;
        this.blocks = [];
        this.allBlocks = [];
        this.blockForLine = new Map();
        // Per code line (0-based doc line number): how many highlight ranges
        // were registered for it the last time it was built. Rebuilds are
        // incremental — a line is only re-tokenised when it is new, remounted,
        // or invalidated by an edit/parse step — so a scroll gesture only pays
        // for the lines that just entered or left the viewport.
        this.builtLines = new Map();
        this.lineAttempts = new Map();
        this.view = view;
        plugin.editorViews.add(view);
        this.loadDocument(view.state);
        this.fenceDecorations = this.buildFenceDecorations(view.state, this.allBlocks);
        this.lastTree = syntaxTree(view.state);
        this.fenceScroll = new EditorFenceScroll(view, () => plugin.active && plugin.settings?.wrapCodeBlocks !== true);
        this.schedule();
      }

      update(update) {
        const refresh = update.transactions.some((transaction) => (
          transaction.effects.some((effect) => effect.is(refreshEffect))
        ));
        const docChanged = update.docChanged || this.document !== update.state.doc;
        if (docChanged) {
          this.loadDocument(update.state);
          this.fenceDecorations = this.buildFenceDecorations(update.state, this.allBlocks);
          // Line numbers shift with every edit, so per-line bookkeeping from
          // before the change cannot be trusted.
          this.builtLines.clear();
          this.lineAttempts.clear();
        } else if (refresh) {
          this.fenceDecorations = this.buildFenceDecorations(update.state, this.allBlocks);
        }
        // A refresh (settings toggle, theme change) rebuilds the highlight
        // palettes, so every cached range points at a stale palette and the
        // whole visible set has to be registered against the new ones.
        if (refresh) {
          this.builtLines.clear();
          this.lineAttempts.clear();
        }
        // A pure scroll fires dozens of updates per gesture. Rebuilding every
        // visible line on each one re-walked the DOM and re-registered
        // hundreds of Highlight ranges — the "stutter while scrolling" in the
        // field report. Only rebuild when a line actually needs work.
        if (docChanged || refresh || this.needsRangeRebuild(update.state)) this.schedule();
        this.fenceScroll.update(update, this.allBlocks);
      }

      // Doc line numbers (0-based) of the code rows that intersect the
      // viewport. The fence line -> block map answers in O(1) per *visible*
      // line, so a scroll through a document with thousands of code lines does
      // not re-walk every block position on every editor update — the old
      // full-document iteration was pure allocation + GC pressure on a phone
      // fling that fired dozens of updates per gesture.
      visibleCodeLines(state) {
        const rows = [];
        const visible = this.view.visibleRanges;
        for (let i = 0; i < visible.length; i++) {
          const range = visible[i];
          const first = state.doc.lineAt(range.from).number;
          const last = state.doc.lineAt(Math.max(range.from, range.to - 1)).number;
          for (let number = first; number <= last; number++) {
            if (this.blockForLine.has(number - 1)) rows.push(number - 1);
          }
        }
        return rows;
      }

      // True when some visible code line has no live highlight ranges, or a
      // registered range has been detached because CodeMirror unmounted its
      // line. Coverage is the criterion, not "did the viewport change": a slow
      // scroll inside one tall block must still colour every newly shown line.
      needsRangeRebuild(state) {
        if (!plugin.active || !plugin.engineReady) return false;
        if (syntaxTree(state) !== this.lastTree) return true;
        const wanted = this.visibleCodeLines(state);
        const entries = plugin.editorRanges.get(this.view) || [];
        if (!wanted.length) return entries.length > 0;
        const byLine = new Map();
        for (const entry of entries) {
          if (!entry) continue;
          const list = byLine.get(entry.line);
          if (list) list.push(entry); else byLine.set(entry.line, [entry]);
        }
        for (const lineNo of wanted) {
          const expected = this.builtLines.get(lineNo);
          if (expected === undefined) return true;
          const list = byLine.get(lineNo) || [];
          if (list.length !== expected) return true;
          for (const entry of list) {
            const range = entry.range;
            if (!range || !range.startContainer.isConnected || !range.endContainer.isConnected) return true;
          }
        }
        // Ranges of lines that scrolled away sit detached until they are
        // pruned; without this check they would linger forever.
        for (const entry of entries) {
          const range = entry && entry.range;
          if (!range || !range.startContainer.isConnected) return true;
        }
        return false;
      }

      // Parse the fence list once per document change and reuse it for both
      // syntax highlighting and the optional background/line-number line
      // decorations.
      loadDocument(state) {
        this.document = state.doc;
        if (state.doc.length > 2000000) {
          this.allBlocks = [];
          this.blocks = [];
          this.blockForLine = new Map();
          return;
        }
        this.allBlocks = allFencedBlocks(state.doc.toString());
        this.blocks = this.allBlocks.filter((block) => block.language);
        // code row -> owning block + row index, so a single line can be
        // highlighted without touching its neighbours.
        this.blockForLine = new Map();
        for (const block of this.blocks) {
          for (let row = 0; row < block.positions.length; row++) {
            const lineNo = block.positions[row].line;
            if (!this.blockForLine.has(lineNo)) this.blockForLine.set(lineNo, { block, row });
          }
        }
      }

      buildFenceDecorations(state, blocks) {
        const background = Boolean(plugin.settings?.codeBlockBackground);
        const numbers = Boolean(plugin.settings?.lineNumbers);
        // The wrap setting is inverted relative to the decoration: the class
        // exists while wrapping must be *suppressed*. A missing key (older
        // data.json) normalizes to false, i.e. no wrap, matching the default.
        const nowrap = plugin.settings ? plugin.settings.wrapCodeBlocks !== true : true;
        if (!plugin.active || (!background && !numbers && !nowrap)) return Decoration.none;
        const builder = new RangeSetBuilder();
        for (const block of blocks) {
          const first = Math.max(1, block.start + 1);
          const last = Math.min(state.doc.lines, block.end);
          const rows = numbers ? blockNumberRows(block) : null;
          let cursor = 0;
          for (let lineNumber = first; lineNumber <= last; lineNumber++) {
            const line = state.doc.line(lineNumber);
            if (nowrap) {
              const key = String(state.doc.line(first).from);
              const attributes = { 'data-aof-scroll': key, style: `--aof-scroll-extent: var(--aof-block-width-${key}, 0px)` };
              if (lineNumber === last) attributes['data-aof-scroll-end'] = '';
              builder.add(line.from, line.from, Decoration.line({ attributes }));
            }
            // rows only contains code content lines, so fence markers stay
            // unnumbered and numbering restarts at 1 for every block. The
            // number is an absolute widget at the line start, while the line
            // itself reserves the gutter: the code text therefore never moves
            // when CodeMirror mounts the widget mid-scroll, and a soft-wrapped
            // row starts under the text column instead of under the number.
            const row = rows && cursor < rows.length && rows[cursor].line + 1 === lineNumber
              ? rows[cursor]
              : null;
            if (row) {
              if (row.column > 0) {
                // Blockquotes and list items put a marker ("&gt; ", "- ") in the
                // same line, so there is no gutter to reserve: padding the line
                // would drag the marker out of alignment. The number stays
                // inline after the marker, exactly where the code starts.
                if (background || nowrap) builder.add(line.from, line.from, fenceLineDecoration(background, nowrap));
                const at = Math.min(line.to, line.from + row.column);
                builder.add(at, at, lineNumberWidget(row.number, row.widthClass, true));
              } else {
                // Top-level fence: a real gutter. The number is CSS
                // `::before` content on the line itself and the line reserves
                // the column, so scrolling never moves the code, soft-wrapped
                // rows start under the text (not under the number), and there
                // is no widget to mount while scrolling.
                builder.add(line.from, line.from, gutterLineDecoration(row.number, row.widthClass, background, nowrap));
              }
              cursor++;
            } else if (background || nowrap) {
              // Fence marker lines carry the background for visual continuity
              // and the no-wrap class. EditorFenceScroll synchronizes these
              // native row scrollports without moving the Markdown editor.
              builder.add(line.from, line.from, fenceLineDecoration(background, nowrap));
            }
          }
        }
        return builder.finish();
      }

      schedule() {
        this.view.requestMeasure({
          key: this,
          read: () => this.plan(),
          write: (measure) => this.applyPlan(measure),
        });
      }

      // Read phase: work out the smallest set of range registrations that
      // leaves every visible code line covered. Lines that are already covered
      // and still mounted are left completely alone — their Highlight ranges
      // are neither deleted nor re-added, which is what keeps scrolling smooth.
      plan() {
        const view = this.view;
        const state = view.state;
        const info = state.field(editorInfoField, false);
        const entries = plugin.editorRanges.get(view) || [];
        const empty = { drop: entries.slice(), add: [], rebuild: [], wanted: [], raw: new Map() };
        if (!plugin.engineReady || !info?.file || info.file.extension !== 'md' || !plugin.active || !window.Highlight || !window.CSS?.highlights || view.dom.ownerDocument !== document) return empty;
        if (this.document !== state.doc) this.loadDocument(state);
        const tree = syntaxTree(state);
        if (tree !== this.lastTree) {
          // Parsing progressed: the hmd-codeblock / hmd-comment filter may now
          // answer differently for a line, so no line stays "built".
          this.builtLines.clear();
          this.lineAttempts.clear();
          this.lastTree = tree;
        }

        const wanted = this.visibleCodeLines(state);
        const wantedSet = new Set(wanted);
        const byLine = new Map();
        for (const entry of entries) {
          if (!entry) continue;
          const list = byLine.get(entry.line);
          if (list) list.push(entry); else byLine.set(entry.line, [entry]);
        }
        const drop = [];
        const rebuild = [];
        for (const lineNo of wanted) {
          const list = byLine.get(lineNo) || [];
          const expected = this.builtLines.get(lineNo);
          const alive = list.filter((entry) => entry.range && entry.range.startContainer.isConnected && entry.range.endContainer.isConnected);
          if (expected !== undefined && alive.length === expected && alive.length === list.length) continue;
          for (const entry of list) drop.push(entry);
          rebuild.push(lineNo);
        }
        for (const [lineNo, list] of byLine) {
          if (wantedSet.has(lineNo)) continue;
          for (const entry of list) drop.push(entry);
        }
        const add = [];
        const raw = new Map();
        for (const lineNo of rebuild) {
          const built = this.buildLine(state, lineNo);
          raw.set(lineNo, built.raw);
          for (const item of built.items) add.push(item);
        }
        return { drop, add, rebuild, wanted, raw };
      }

      // Write phase: register only the new ranges and drop the dead ones.
      applyPlan(plan) {
        const p = plan && Array.isArray(plan.drop) ? plan : { drop: [], add: [], rebuild: [], wanted: [], raw: new Map() };
        plugin.clearRanges(p.drop);
        const dropped = new Set(p.drop);
        const entries = (plugin.editorRanges.get(this.view) || []).filter((entry) => entry && !dropped.has(entry));
        const addedCount = new Map();
        for (const item of p.add) {
          const added = plugin.addRange(item.range, item);
          if (added) {
            entries.push({ ...added, line: item.line, key: item.key });
            addedCount.set(item.line, (addedCount.get(item.line) || 0) + 1);
          }
        }
        plugin.editorRanges.set(this.view, entries);
        for (const lineNo of p.rebuild) {
          const count = addedCount.get(lineNo) || 0;
          const raw = p.raw.get(lineNo) || 0;
          if (count > 0 || raw === 0) {
            // Either the line now has its ranges, or the engine says the row
            // carries no tokens — both mean "covered".
            this.builtLines.set(lineNo, count);
            this.lineAttempts.delete(lineNo);
          } else {
            // Every segment failed the DOM mapping test. Leave the line
            // unbuilt so the next update retries, but give up eventually so one
            // pathological line cannot schedule measure passes forever.
            const attempts = (this.lineAttempts.get(lineNo) || 0) + 1;
            this.lineAttempts.set(lineNo, attempts);
            if (attempts >= 5) {
              this.builtLines.set(lineNo, 0);
              this.lineAttempts.delete(lineNo);
            }
          }
        }
        plugin.rebuildStyle();
      }

      // Highlight one code row. `raw` counts the segments the engine produced
      // for the row so the caller can tell "this line needs no tokens" apart
      // from "every DOM mapping failed".
      buildLine(state, lineNo) {
        const view = this.view;
        const items = [];
        let raw = 0;
        const where = this.blockForLine.get(lineNo);
        if (!where || !tokenClassNodeProp) return { items, raw };
        const { block, row } = where;
        const position = block.positions[row];
        if (!position || position.line >= state.doc.lines) return { items, raw };
        const highlighted = plugin.engine.highlight(block.language, block.text);
        const segments = highlighted && highlighted[row];
        if (!segments) return { items, raw };
        const line = state.doc.line(lineNo + 1);
        const base = line.from + position.column;
        const classes = syntaxTree(state).resolveInner(base, 1).type.prop(tokenClassNodeProp) || '';
        if (!classes.split(' ').includes('hmd-codeblock') || /hmd-comment/.test(classes)) return { items, raw };
        for (const segment of segments) {
          raw++;
          const from = base + segment.from;
          const to = base + segment.to;
          if (to <= from || to > line.to) continue;
          if (!view.visibleRanges.some((range) => from >= range.from && to <= range.to)) continue;
          const start = view.domAtPos(from, 1);
          const end = view.domAtPos(to, -1);
          const range = document.createRange();
          range.setStart(start.node, start.offset);
          range.setEnd(end.node, end.offset);
          if (range.toString() !== state.sliceDoc(from, to)) continue;
          items.push({ ...segment, range, line: lineNo, key: `${from}:${to}` });
        }
        return { items, raw };
      }

      destroy() {
        this.fenceScroll.destroy();
        plugin.clearRanges(plugin.editorRanges.get(this.view));
        plugin.editorRanges.delete(this.view);
        plugin.editorViews.delete(this.view);
        plugin.rebuildStyle();
      }
    }, {
      decorations: (value) => value.fenceDecorations,
    });
    this.registerEditorExtension(extension);

    // Compatibility renderer for runtimes without the CSS Custom Highlight
    // API. CodeMirror mark decorations are view-only: the document text,
    // selection, undo history and clipboard payload stay untouched.
    if (!this.highlightSupported) {
      const markCache = new Map();
      const tokenMark = (className) => {
        let mark = markCache.get(className);
        if (!mark) {
          mark = Decoration.mark({ class: className });
          markCache.set(className, mark);
        }
        return mark;
      };
      const tokenExtension = ViewPlugin.fromClass(class {
        constructor(view) {
          this.document = null;
          this.blocks = [];
          this.decorations = this.build(view.state, view);
        }

        update(update) {
          if (!plugin.active || !plugin.engineReady || plugin.highlightSupported) {
            this.decorations = Decoration.none;
            return;
          }
          if (update.docChanged || this.document !== update.state.doc || update.viewportChanged) {
            this.decorations = this.build(update.state, update.view);
          }
        }

        build(state, view) {
          const info = state.field(editorInfoField, false);
          if (!info?.file || info.file.extension !== 'md') return Decoration.none;
          if (this.document !== state.doc) {
            this.document = state.doc;
            this.blocks = state.doc.length > 2000000
              ? []
              : allFencedBlocks(state.doc.toString()).filter((block) => block.language);
          }
          const builder = new RangeSetBuilder();
          for (const block of this.blocks) {
            const first = state.doc.line(block.start + 1).from;
            const last = state.doc.line(Math.min(block.end, state.doc.lines)).to;
            if (!view.visibleRanges.some((range) => range.from <= last && range.to >= first)) continue;
            const highlighted = plugin.engine.highlight(block.language, block.text);
            if (!highlighted) continue;
            for (let i = 0; i < highlighted.length; i++) {
              const position = block.positions[i];
              if (!position || position.line >= state.doc.lines) continue;
              const line = state.doc.line(position.line + 1);
              const base = line.from + position.column;
              if (tokenClassNodeProp) {
                const classes = syntaxTree(state).resolveInner(base, 1).type.prop(tokenClassNodeProp) || '';
                if (!classes.split(' ').includes('hmd-codeblock') || /hmd-comment/.test(classes)) continue;
              }
              for (const segment of highlighted[i]) {
                if (!segment.light || !segment.dark) continue;
                const from = base + segment.from;
                const to = base + segment.to;
                if (to <= from || to > line.to) continue;
                if (!view.visibleRanges.some((range) => from >= range.from && to <= range.to)) continue;
                const className = highlightClass(segment.light, segment.dark);
                if (!plugin.fallbackClasses.has(className)) {
                  plugin.fallbackClasses.set(className, {
                    light: segment.light.toUpperCase(),
                    dark: segment.dark.toUpperCase(),
                  });
                  plugin.styleDirty = true;
                }
                builder.add(from, to, tokenMark(className));
              }
            }
          }
          plugin.scheduleFallbackStyle();
          return builder.finish();
        }
      }, {
        decorations: (value) => value.decorations,
      });
      this.registerEditorExtension(tokenExtension);
    }

    // Mark fenced blocks in reading mode independently of syntax support.
    // The background must also work for unlabeled/unknown fences, while
    // indented code blocks and inline code must remain untouched.
    this.registerMarkdownPostProcessor((el, ctx) => {
      if (!this.active) return;
      const pres = [...el.querySelectorAll('pre')].filter((pre) => !pre.closest('.frontmatter') && !pre.classList.contains('frontmatter'));
      if (!pres.length) return;
      this.readingContext = ctx;
      this.markReadingFences(pres, ctx);
      // Obsidian and Prism may replace or re-class code DOM briefly after the
      // postprocessor. Re-apply markup after the native render settles.
      this.observeReadingBackgroundContainers();
      this.scheduleReadingBackgroundRescan(120);
    }, 90);

    this.registerMarkdownPostProcessor((el, ctx) => {
      if (!this.engineReady) return;
      for (const code of el.querySelectorAll('pre > code[class*="language-"]')) {
        if (code.parentElement.classList.contains('frontmatter') || this.readingOriginals.has(code)) continue;
        const language = [...code.classList].find((name) => name.startsWith('language-'))?.slice(9);
        if (!canonical(language)) continue;
        const section = ctx.getSectionInfo(code);
        if (!section) continue;
        const fenced = fencedBlocks(section.text).some((block) => (
          block.language === canonical(language) && block.start >= section.lineStart && block.start <= section.lineEnd
        ));
        if (!fenced) continue;
        this.colorReading(code, language, el, ctx);
      }
    }, 100);

    // Font metrics, line height and code padding come from the active theme, so
    // measured reading gutters must be rebuilt when CSS or viewport width
    // changes (themes may switch code fonts at width breakpoints). Height-only
    // resizes do not change those metrics and should not trigger a full pass.
    this.lastRelayoutSignature = String(window.innerWidth);
    const relayoutLineNumbers = (reason) => {
      if (!this.active || !this.settings?.lineNumbers) return;
      const signature = String(window.innerWidth);
      if (reason !== 'theme' && signature === this.lastRelayoutSignature) return;
      this.lastRelayoutSignature = signature;
      this.queueReadingLineNumberGeometry();
    };
    this.registerEvent(this.app.workspace.on('css-change', () => relayoutLineNumbers('theme')));
    this.registerDomEvent(window, 'resize', () => relayoutLineNumbers('resize'));
    // Light/dark switches and theme snippets change body classes without always
    // emitting css-change. One observer keeps reading gutters aligned, but it
    // must ignore the classes the host toggles while scrolling.
    this.lastBodyClass = document.body.className;
    this.bodyClassObserver = new MutationObserver(() => {
      const next = document.body.className;
      const previous = this.lastBodyClass;
      this.lastBodyClass = next;
      const appearanceChanged = /(^|\s)theme-(light|dark)(\s|$)/.exec(previous)?.[2] !== /(^|\s)theme-(light|dark)(\s|$)/.exec(next)?.[2];
      if (appearanceChanged) relayoutLineNumbers('theme');
    });
    this.bodyClassObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    this.register(() => {
      this.bodyClassObserver?.disconnect();
      this.bodyClassObserver = null;
    });

    this.settingTab = new SyntaxThemeSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.addCommand({
      id: 'choose-syntax-theme',
      name: '选择语法配色',
      callback: () => this.openThemePicker(),
    });
    this.addCommand({
      id: 'open-syntax-theme-settings',
      name: '打开语法配色设置',
      callback: () => this.openSettings(),
    });
    this.addCommand({
      id: 'diagnose-syntax-highlight',
      name: '诊断语法高亮',
      callback: () => new DiagnosticsModal(this.app, this).open(),
    });

    // Existing reading views are rebuilt through the native renderer so their
    // postprocessors run with genuine section information.
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) leaf.view.previewMode?.rerender(true);
  }

  // The community installer only downloads main.js, manifest.json, and
  // optional styles.css. Keep Oniguruma inside main.js so runtime never
  // depends on a separately installed WASM file.
  async loadWasmBytes() {
    const bytes = toWasmBytes(embeddedOnigWasmBase64);
    if (!bytes || !bytes.byteLength) {
      throw new Error('The build does not contain the embedded Oniguruma runtime');
    }
    if (!isWasmModule(bytes)) {
      throw new Error('Embedded Oniguruma runtime is not a WebAssembly module (' + bytes.byteLength + ' bytes)');
    }
    this.wasmSource = 'embedded:main.js';
    this.wasmBytes = bytes.byteLength;
    return bytes;
  }

  openSettings() {
    const setting = this.app.setting;
    if (setting?.open && setting?.openTabById) {
      setting.open();
      setting.openTabById(this.manifest.id);
      return;
    }
    new Notice('请打开 设置 → 第三方插件 → Syntax Palette。');
  }

  openThemePicker() {
    new SyntaxThemeModal(this.app, this).open();
  }

  inspectReading() {
    const pre = [...document.querySelectorAll('.markdown-rendered pre')].find((item) => item.querySelector('code'));
    if (!pre) return { found: false };
    const code = pre.querySelector('code');
    const result = {
      found: true,
      language: [...code.classList].find((name) => name.startsWith('language-')) || null,
      textLength: code.textContent.length,
      childElements: code.querySelectorAll('*').length,
      directTextNodes: 0,
      nestedTextNodes: 0,
      tokenSpans: code.querySelectorAll('span[class*="aof-token-"]').length,
      tokenSpansNested: 0,
    };
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.parentNode === code) result.directTextNodes += 1;
      else result.nestedTextNodes += 1;
    }
    result.tokenSpansNested = [...code.querySelectorAll('span[class*="aof-token-"]')]
      .filter((span) => span.parentElement !== code).length;
    return result;
  }

  inspectEditor() {
    const host = document.querySelector('.markdown-source-view.mod-cm6');
    if (!host) return { found: false };
    const lines = host.querySelectorAll('.cm-line.HyperMD-codeblock');
    const first = lines[0] || null;
    return {
      found: true,
      codeLines: lines.length,
      firstLineChildElements: first ? first.querySelectorAll('*').length : 0,
      tokenSpans: host.querySelectorAll('span[class*="aof-token-"]').length,
      numberWidgets: host.querySelectorAll('.aof-ln').length,
    };
  }

  collectDiagnostics() {
    const win = window;
    const settings = { ...(this.settings || {}) };
    const rules = (style) => {
      try {
        return style?.sheet?.cssRules?.length ?? 0;
      } catch (error) {
        return -1;
      }
    };
    let engineState = null;
    try {
      engineState = this.engine?.getState?.() || null;
    } catch (error) {
      engineState = null;
    }
    return {
      plugin: { id: PLUGIN_ID, version: this.manifest?.version || null },
      generatedAt: new Date().toISOString(),
      runtime: {
        userAgent: navigator.userAgent,
        viewport: `${win.innerWidth}x${win.innerHeight}`,
        devicePixelRatio: win.devicePixelRatio,
      },
      capabilities: {
        highlight: typeof win.Highlight,
        staticRange: typeof win.StaticRange,
        cssHighlights: Boolean(win.CSS?.highlights),
        selectorSupport: this.highlightSelectorSupported,
        webAssembly: typeof win.WebAssembly,
        mode: this.highlightMode,
      },
      engine: {
        ready: Boolean(this.engineReady),
        error: this.engineError ? String(this.engineError.message || this.engineError) : null,
        wasmSource: this.wasmSource,
        wasmBytes: this.wasmBytes,
        warnings: [...(this.engineWarnings || [])],
        state: engineState,
      },
      settings,
      reading: this.inspectReading(),
      editor: this.inspectEditor(),
      styles: {
        highlightCssLength: this.readingStyle?.textContent?.length || 0,
        highlightRules: rules(this.readingStyle),
        backgroundCssLength: this.backgroundStyle?.textContent?.length || 0,
        lineNumberCssLength: this.lineNumberStyle?.textContent?.length || 0,
        wrapCssLength: this.wrapStyle?.textContent?.length || 0,
        registrySize: win.CSS?.highlights ? win.CSS.highlights.size : null,
        registryRanges: win.CSS?.highlights
          ? [...win.CSS.highlights.values()].reduce((sum, value) => sum + value.size, 0)
          : null,
      },
      lineNumbers: {
        enabled: Boolean(settings.lineNumbers),
        editorWidgets: document.querySelectorAll('.aof-ln').length,
        readingBlocks: document.querySelectorAll('pre.aof-ln-on').length,
      },
    };
  }

  async updateSettings(patch) {
    const run = async () => {
      const previous = this.settings;
      const next = patchSettings(this.settings, typeof patch === 'function' ? patch(this.settings) : patch);
      if (sameSettings(next, this.settings)) {
        this.settingTab?.syncControls();
        return;
      }
      // Only a real theme change may touch the highlight registry. Flipping the
      // line-number or background switch is a layout concern; running the full
      // clear + re-measure path for it threw away the editor's registered
      // ranges and there was no guarantee the asynchronous rebuild would put
      // them back, which is what left code blocks in Obsidian's native colours
      // until the app was restarted.
      const themeChanged = !previous ||
        previous.light !== next.light ||
        previous.dark !== next.dark ||
        previous.coloredBrackets !== next.coloredBrackets;
      if (themeChanged && this.engineReady) {
        try {
          const result = await this.engine.setThemes(next.light, next.dark, { coloredBrackets: next.coloredBrackets });
          this.engineWarnings = result.warnings || [];
          if (this.engineWarnings.length) {
            new Notice('部分配色加载失败，已回退到 Atom One 默认配色。', 6000);
          }
        } catch (error) {
          console.error(`[${PLUGIN_ID}] Failed to apply theme settings`, error);
          new Notice('配色应用失败，已保留当前配色。', 6000);
          return;
        }
      }
      this.settings = next;
      try {
        await this.saveData(this.settings);
      } catch (error) {
        console.error(`[${PLUGIN_ID}] Failed to save settings`, error);
        new Notice('配色设置保存失败，本次修改仅在当前会话生效。', 6000);
      }
      this.refreshDecorations({ rebuildHighlights: themeChanged });
      this.settingTab?.syncControls();
    };
    this.updateQueue = this.updateQueue.then(run, run);
    return this.updateQueue;
  }

  applyFamilyPreset(familyId) {
    return this.updateSettings((current) => applyPreset(current, familyId));
  }

  getPreview() {
    if (!this.engineReady) return null;
    const rows = this.engine.highlight('javascript', PREVIEW_SAMPLE);
    return rows ? { sample: PREVIEW_SAMPLE, rows } : null;
  }

  // `rebuildHighlights` must only be true when the theme itself changed. Line
  // numbers and the code-block background are pure layout: re-running the
  // highlight path for them drops every registered range and rebuilds the
  // whole <style> node, which on a phone shows up as a stutter and can leave
  // the editor uncoloured if the asynchronous measure pass is swallowed.
  refreshDecorations(options = {}) {
    if (!this.active) return;
    const rebuildHighlights = options.rebuildHighlights !== false;
    this.rebuildBackgroundStyle();
    this.rebuildLineNumberStyle();
    this.rebuildWrapStyle();
    if (this.settings?.lineNumbers) {
      this.scheduleReadingLineNumberGeometry(0);
    } else {
      this.clearAllReadingLineNumbers();
    }
    if (this.settings?.codeBlockBackground || this.settings?.lineNumbers) {
      this.scheduleReadingBackgroundRescan(0);
    }
    if (rebuildHighlights && this.engineReady) {
      // A theme change invalidates every registered colour, so the palettes
      // are dropped wholesale. Layout-only changes never reach this branch.
      this.resetPalettes();
      for (const [code, language] of [...this.readingLanguages]) {
        if (!code.isConnected) {
          this.restoreReading(code);
          continue;
        }
        this.applyReading(code, language);
      }
      this.rebuildStyle();
    }
    // Even when the syntax engine is unavailable, the optional background and
    // its fenced-line decorations must react immediately to setting changes.
    // Keep the CodeMirror views from our registered extension. Reaching into
    // The host's private CodeMirror reference is not needed to refresh the
    // views owned by this registered plugin extension.
    const views = new Set([...this.editorViews, ...this.editorRanges.keys()]);
    for (const view of views) {
      try {
        view.dispatch({ effects: refreshEffect.of(true) });
      } catch (error) {
        // The view was destroyed between the snapshot and this dispatch.
      }
    }
  }

  observeReadingBackgroundContainers() {
    for (const [root, observer] of [...this.readingContainerObservers]) {
      if (!root.isConnected) {
        observer.disconnect();
        this.readingContainerObservers.delete(root);
      }
    }
    for (const root of document.querySelectorAll('.markdown-preview-view')) {
      if (this.readingContainerObservers.has(root)) continue;
      const observer = new MutationObserver(() => this.scheduleReadingBackgroundRescan(60));
      // ChildList only: a host re-render swaps nodes, and that is when the set
      // of fenced blocks can change. Attribute (class) churn happens on every
      // scroll — image load states, section toggles — and used to schedule a
      // full rescan each time. Content edits are covered by the per-code
      // observer that colorReading() installs.
      observer.observe(root, {
        subtree: true,
        childList: true,
      });
      this.readingContainerObservers.set(root, observer);
    }
  }

  scheduleReadingBackgroundRescan(delay = 120) {
    if (!this.active || !this.readingContext) return;
    if (this.readingRescanTimer) clearTimeout(this.readingRescanTimer);
    this.readingRescanTimer = setTimeout(() => {
      this.readingRescanTimer = null;
      this.rescanReadingBackgrounds();
    }, Math.max(0, delay));
    if (!this.readingRescanLongTimer) {
      this.readingRescanLongTimer = setTimeout(() => {
        this.readingRescanLongTimer = null;
        this.rescanReadingBackgrounds();
      }, 900);
    }
  }

  rescanReadingBackgrounds() {
    if (!this.active || !this.readingContext) return;
    this.observeReadingBackgroundContainers();
    for (const root of document.querySelectorAll('.markdown-preview-view')) {
      const pres = [...root.querySelectorAll('pre')]
        .filter((pre) => !pre.classList.contains('frontmatter') && !pre.closest('.frontmatter'));
      if (pres.length) this.markReadingFences(pres, this.readingContext);
    }
    // Geometry is scheduled by applyReadingLineNumbers() only when a block has
    // no measurement yet, and by relayout on width/theme changes. Scheduling it
    // unconditionally here made every scroll-time rescan re-run
    // getComputedStyle for every code block — the reading-mode hitch that only
    // appeared with line numbers on.
  }

  readingTokensFor(text) {
    if (!this.readingTokenCache || this.readingTokenCache.text !== text) {
      this.readingTokenCache = { text, tokens: codeBlockTokens(text) };
    }
    return this.readingTokenCache.tokens;
  }

  markReadingFences(pres, ctx) {
    for (const pre of [...this.readingBackgroundElements]) {
      if (!pre.isConnected) {
        pre.classList.remove(FENCED_BLOCK_CLASS);
        this.readingBackgroundElements.delete(pre);
      }
    }
    for (const pre of [...this.readingNumberElements]) {
      if (!pre.isConnected) this.clearReadingLineNumbers(pre);
    }
    const numbers = Boolean(this.settings?.lineNumbers);
    const background = Boolean(this.settings?.codeBlockBackground);
    for (const pre of pres) {
      if (pre.classList.contains('frontmatter') || pre.closest('.frontmatter')) continue;
      // Steady-state fast path: this exact <pre> node already carries the
      // state the current settings ask for, so a scroll-time rescan must not
      // recompute its section mapping, re-split its numbering or re-write its
      // attributes. A host re-render always creates a *new* <pre> node (memo
      // miss), and an inconclusive classification is deliberately not memoized
      // so the delayed rescans can still retry it.
      //
      // The memo is validated against the DOM, not trusted blindly: clearing
      // the gutter out of band (`clearAllReadingLineNumbers`, i.e. switching
      // line numbers off) removes the class but cannot reach every memo entry,
      // so a memo-only check would skip this block forever and leave the first
      // code block of a note unnumbered after the switch was turned back on.
      const memo = this.readingPreMemo.get(pre);
      if (memo && memo.background === background && memo.numbers === numbers &&
        pre.classList.contains(FENCED_BLOCK_CLASS) === (memo.fenced === true && background) &&
        pre.classList.contains(LINE_NUMBER_CLASS) === numbers) continue;
      const section = ctx.getSectionInfo(pre) || ctx.getSectionInfo(pre.querySelector('code'));
      let token = null;
      if (section?.text && Number.isFinite(section.lineStart) && Number.isFinite(section.lineEnd)) {
        // Each reading <pre> receives a native section range for its own code
        // block. Use that range instead of relying on Prism text, which may
        // still be empty when the postprocessor first runs.
        const tokens = this.readingTokensFor(section.text);
        token = tokens.find((item) => (
          item.start >= section.lineStart && item.start <= section.lineEnd
        )) || null;
      }
      if (!token) {
        // Conservative text fallback for unusual host contexts without a
        // usable section range. Never mark an indented code_block.
        const code = pre.querySelector('code');
        if (!code) continue;
        const text = comparableReadingText(code.textContent);
        const blocks = section?.text ? this.readingTokensFor(section.text) : [];
        const matches = blocks.filter((item) => comparableReadingText(item.text) === text);
        if (matches.length === 1) token = matches[0];
      }
      const fenced = token ? token.fenced : null;
      if (fenced === true) {
        // The background class is only meaningful while the background switch
        // is on; leaving it off keeps the reading DOM identical to a stock
        // install. Line numbers are independent and may still be shown.
        if (background) {
          pre.classList.add(FENCED_BLOCK_CLASS);
          this.readingBackgroundElements.add(pre);
        } else {
          pre.classList.remove(FENCED_BLOCK_CLASS);
          this.readingBackgroundElements.delete(pre);
        }
        if (numbers) this.applyReadingLineNumbers(pre, token);
        else this.clearReadingLineNumbers(pre);
      } else if (fenced === false) {
        pre.classList.remove(FENCED_BLOCK_CLASS);
        this.readingBackgroundElements.delete(pre);
        this.clearReadingLineNumbers(pre);
      }
      if (fenced !== null) {
        this.readingPreMemo.set(pre, { fenced, background, numbers });
      }
    }
  }

  rebuildBackgroundStyle() {
    if (!this.backgroundStyle) return;
    const settings = this.settings || normalizeSettings(null);
    this.backgroundStyle.textContent = buildBackgroundCss({
      enabled: Boolean(settings.codeBlockBackground),
      light: themeCatalog.getTheme(settings.light),
      dark: themeCatalog.getTheme(settings.dark),
    });
  }

  rebuildLineNumberStyle() {
    if (!this.lineNumberStyle) return;
    this.lineNumberStyle.textContent = buildLineNumberCss({
      enabled: Boolean(this.settings?.lineNumbers),
      light: themeCatalog.getTheme(this.settings?.light),
      dark: themeCatalog.getTheme(this.settings?.dark),
    });
  }

  rebuildWrapStyle() {
    if (!this.wrapStyle) return;
    this.wrapStyle.textContent = buildWrapCss({ wrap: this.settings?.wrapCodeBlocks === true });
  }

  // Reading mode numbers live in one generated gutter per <pre>. Only the
  // number text and a few geometry custom properties are added; the code DOM,
  // its text nodes and Prism's markup are never touched.
  applyReadingLineNumbers(pre, token) {
    if (!this.active || !this.settings?.lineNumbers || !token || token.fenced !== true) {
      this.clearReadingLineNumbers(pre);
      return;
    }
    const numbering = readingNumbering(token.text);
    if (!numbering.count) {
      this.clearReadingLineNumbers(pre);
      return;
    }
    pre.classList.add(LINE_NUMBER_CLASS);
    this.readingNumberElements.add(pre);
    const text = numbering.text;
    if (pre.getAttribute(LINE_NUMBER_ATTR) !== text) {
      pre.setAttribute(LINE_NUMBER_ATTR, text);
      // The line count changed under an already measured gutter: its vertical
      // metrics may be stale. Queue a re-measure *without* clearing the old
      // values first, so the gutter never flashes back to the CSS fallbacks.
      if (pre.style.getPropertyValue('--aof-ln-top') !== '') {
        this.readingRemeasureQueue.add(pre);
        this.requestReadingMeasurePass();
      }
    }
    pre.setAttribute(LINE_NUMBER_COUNT_ATTR, String(numbering.count));
    // The gutter width is a pure function of the digit count, so it is set here
    // and never re-measured. Anything measured would be a second source of
    // truth for the same number, and the two would disagree for one frame on
    // every re-render (which is what made the code text jump while scrolling).
    pre.style.setProperty('--aof-ln-digits', String(digitsFor(numbering.count)));
    if (!pre.style.getPropertyValue('--aof-ln-top')) {
      this.scheduleReadingLineNumberGeometry(0);
    }
  }

  clearReadingLineNumbers(pre) {
    if (!pre) return;
    // Dropping the memo here keeps it from outliving the DOM state it
    // describes: every removal path funnels through this method, so a block
    // that lost its gutter can never be skipped as "already numbered".
    this.readingPreMemo?.delete(pre);
    if (!pre.classList.contains(LINE_NUMBER_CLASS) && !pre.hasAttribute(LINE_NUMBER_ATTR)) {
      this.readingNumberElements.delete(pre);
      return;
    }
    pre.classList.remove(LINE_NUMBER_CLASS);
    pre.removeAttribute(LINE_NUMBER_ATTR);
    pre.removeAttribute(LINE_NUMBER_COUNT_ATTR);
    pre.removeAttribute(LINE_NUMBER_BASE_PAD_ATTR);
    pre.style.removeProperty('padding-left');
    for (const name of READING_STYLE_PROPERTIES) pre.style.removeProperty(name);
    if (!pre.getAttribute('style')) pre.removeAttribute('style');
    this.readingNumberElements.delete(pre);
  }

  clearAllReadingLineNumbers() {
    for (const pre of [...this.readingNumberElements]) this.clearReadingLineNumbers(pre);
    for (const pre of document.querySelectorAll(`pre.${LINE_NUMBER_CLASS}`)) this.clearReadingLineNumbers(pre);
    if (this.readingNumberGeometryTimer) clearTimeout(this.readingNumberGeometryTimer);
    this.readingNumberGeometryTimer = null;
    // Invalidate any pending frame/recheck pass: the callbacks still run, but
    // the generation mismatch (and the active/settings guards) makes them
    // return without measuring anything.
    this.readingMeasureGeneration++;
    this.readingMeasureFrame = null;
    this.readingMeasureRecheckScheduled = false;
    this.pendingReadingMeasureAll = false;
    this.readingRemeasureQueue.clear();
    this.recentlyMeasuredPres = [];
  }

  // Re-measure after fonts, widths or CSS change under us. The measured values
  // are overwritten in place rather than cleared first: clearing them puts each
  // gutter back on the CSS fallback for one frame and makes the text flicker.
  resetReadingLineNumberGeometry() {
    if (!this.active || !this.settings?.lineNumbers) return;
    this.requestReadingMeasurePass({ remeasureAll: true });
  }

  scheduleReadingLineNumberGeometry(delay = 0) {
    if (!this.active || !this.settings?.lineNumbers) return;
    if (this.readingNumberGeometryTimer) clearTimeout(this.readingNumberGeometryTimer);
    this.readingNumberGeometryTimer = setTimeout(() => {
      this.readingNumberGeometryTimer = null;
      this.requestReadingMeasurePass();
    }, Math.max(0, delay));
  }

  // One measurement pass per animation frame at most. Several sections can
  // mount inside a single frame of a fling, and the previous design ran a
  // synchronous getComputedStyle/offsetTop pass right after each mount — 12-15
  // forced layouts per scroll gesture in the constrained viewport, each of
  // which can grow into a visible hitch. Deferring to the frame boundary
  // coalesces the whole burst into one layout flush and lets the host's own
  // rendering settle first.
  requestReadingMeasurePass(options = {}) {
    if (!this.active || !this.settings?.lineNumbers) return;
    if (options.remeasureAll) this.pendingReadingMeasureAll = true;
    if (options.remeasure) {
      for (const pre of options.remeasure) this.readingRemeasureQueue.add(pre);
    }
    if (this.readingMeasureFrame) return;
    const generation = this.readingMeasureGeneration;
    const run = () => {
      this.readingMeasureFrame = null;
      if (generation !== this.readingMeasureGeneration) return;
      const remeasureAll = this.pendingReadingMeasureAll;
      this.pendingReadingMeasureAll = false;
      this.measureReadingLineNumbers({ remeasureAll });
      // Theme CSS and font loading can settle one frame after the block is
      // mounted, which moves the code padding under an already measured
      // gutter. Re-check *only the blocks measured just now*, on the next idle
      // slot — never every block, and never in the middle of a gesture.
      //
      // A recheck pass must not arm another recheck: it re-measures the same
      // blocks, so re-arming turned the correction into a per-frame loop that
      // ran a forced layout for the whole scroll gesture (76 passes for a
      // 40-frame gesture — worse than the 12-15 it replaced).
      if (!options.recheck && this.recentlyMeasuredPres.length) this.scheduleReadingMeasureRecheck();
    };
    if (typeof requestAnimationFrame === 'function') {
      this.readingMeasureFrame = requestAnimationFrame(run);
    } else {
      this.readingMeasureFrame = setTimeout(run, 0);
    }
  }

  // Idle-time correction pass for blocks measured in the previous frame. The
  // old unconditional 220ms "re-measure everything" timer fired mid-gesture
  // and forced a second full layout for every newly mounted section; this
  // pass is scoped to the blocks that actually need the settling correction.
  scheduleReadingMeasureRecheck() {
    if (this.readingMeasureRecheckScheduled) return;
    this.readingMeasureRecheckScheduled = true;
    const run = () => {
      this.readingMeasureRecheckScheduled = false;
      if (!this.active || !this.settings?.lineNumbers) return;
      for (const pre of this.recentlyMeasuredPres) {
        if (pre.isConnected) this.readingRemeasureQueue.add(pre);
      }
      this.requestReadingMeasurePass({ recheck: true });
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 500 });
    } else {
      setTimeout(run, 220);
    }
  }

  // Coalesces bursts of resize/theme notifications into one measurement.
  queueReadingLineNumberGeometry() {
    if (this.readingNumberGeometryQueued) return;
    this.readingNumberGeometryQueued = true;
    const run = () => {
      this.readingNumberGeometryQueued = false;
      this.resetReadingLineNumberGeometry();
    };
    if (typeof window !== 'undefined' && window.requestAnimationFrame) {
      window.requestAnimationFrame(() => setTimeout(run, 60));
    } else {
      setTimeout(run, 60);
    }
  }

  // Batched read/write pass: measure first, then write, so a note with many
  // code blocks does not trigger one layout per block. Only vertical metrics
  // are measured; the horizontal column is CSS + `--aof-ln-digits`.
  //
  // Incremental by default: a block that already carries measured values and
  // is not in the re-measure queue is skipped without touching the DOM, so a
  // steady scroll performs no forced layout at all. `remeasureAll` is reserved
  // for width/theme relayouts, where every block's metrics genuinely changed.
  measureReadingLineNumbers(options = {}) {
    this.readingNumberGeometryTimer = null;
    if (!this.active || !this.settings?.lineNumbers) return;
    const remeasureAll = options.remeasureAll === true;
    const queue = this.readingRemeasureQueue;
    const pending = [];
    for (const pre of this.readingNumberElements) {
      if (!pre.isConnected) {
        this.clearReadingLineNumbers(pre);
        queue.delete(pre);
        continue;
      }
      if (!pre.classList.contains(LINE_NUMBER_CLASS)) {
        queue.delete(pre);
        continue;
      }
      const code = pre.querySelector('code');
      if (!code) {
        queue.delete(pre);
        continue;
      }
      if (remeasureAll || queue.has(pre) || pre.style.getPropertyValue('--aof-ln-top') === '') {
        pending.push({ pre, code });
        queue.delete(pre);
      }
    }
    this.recentlyMeasuredPres = [];
    if (!pending.length) return;
    const measured = [];
    for (const item of pending) {
      const codeStyle = getComputedStyle(item.code);
      const count = Number(item.pre.getAttribute(LINE_NUMBER_COUNT_ATTR)) || 0;
      const fontSize = parseFloat(codeStyle.fontSize) || 14;
      const fontFamily = codeStyle.fontFamily || 'monospace';
      // Keep the width in sync even if a host re-render drops the inline style.
      const digits = String(digitsFor(count));
      if (item.pre.style.getPropertyValue('--aof-ln-digits') !== digits) {
        item.pre.style.setProperty('--aof-ln-digits', digits);
      }
      // <code> becomes the scroll container, so its own line boxes (not the
      // <pre> strut) define the row pitch. Prefer the computed line-height and
      // fall back to the measured content height for `normal`.
      const padTop = parseFloat(codeStyle.paddingTop) || 0;
      const padBottom = parseFloat(codeStyle.paddingBottom) || 0;
      const available = Math.max(0, item.code.clientHeight - padTop - padBottom);
      const computedPitch = parseFloat(codeStyle.lineHeight);
      const pitch = Number.isFinite(computedPitch) && computedPitch > 0
        ? computedPitch
        : (count > 0 && available > 0 ? available / count : fontSize * 1.4);
      measured.push({
        ...item,
        pitch,
        fontSize,
        fontFamily,
        top: Math.max(0, item.code.offsetTop + padTop),
        height: available,
      });
    }
    for (const item of measured) {
      const pre = item.pre;
      // Only vertical metrics are written. The gutter width lives in CSS and
      // depends on the digit count alone, so a re-measure can never move the
      // code text sideways. Values are compared before writing: touching the
      // inline style invalidates the block even when nothing moved.
      const values = {
        '--aof-ln-top': `${item.top}px`,
        '--aof-ln-lh': `${item.pitch}px`,
        '--aof-ln-size': `${item.fontSize}px`,
        '--aof-ln-font': item.fontFamily,
        '--aof-ln-maxh': `${item.height}px`,
      };
      for (const [name, value] of Object.entries(values)) {
        if (pre.style.getPropertyValue(name) !== value) pre.style.setProperty(name, value);
      }
    }
    this.recentlyMeasuredPres = measured.map((item) => item.pre);
  }

  colorReading(code, language, el, ctx) {
    this.readingLanguages.set(code, language);
    this.applyReading(code, language);
    // Native Prism may finish asynchronously after the postprocessor. Rebuild
    // only these ranges if it changes this fenced code's text nodes.
    const observer = new MutationObserver(() => {
      if (!this.active) return;
      const currentLanguage = this.readingLanguages.get(code) || language;
      this.clearRanges(this.readingOriginals.get(code));
      this.readingOriginals.delete(code);
      this.applyReading(code, currentLanguage);
      this.rebuildStyle();
    });
    observer.observe(code, { subtree: true, childList: true, characterData: true });
    this.readingObservers.set(code, observer);
    const plugin = this;
    ctx.addChild(new class extends MarkdownRenderChild {
      onunload() {
        plugin.restoreReading(code);
      }
    }(el));
  }

  applyReading(code, language) {
    if (!this.active || !this.engineReady) return;
    // Prism may rewrite the block while we are inserting our own ranges or
    // wrappers. Ignore our own mutations, then resume watching for native
    // re-renders.
    const observer = this.readingObservers.get(code);
    observer?.disconnect();
    try {
      // Replace this block's ranges atomically: clearing here means a caller
      // can re-run applyReading without first having to remember to drop the
      // previous registration.
      this.clearRanges(this.readingOriginals.get(code));
      this.readingOriginals.delete(code);
      if (this.highlightSupported) this.applyReadingRanges(code, language);
      else this.applyReadingDom(code, language);
    } finally {
      if (observer && this.active) {
        observer.observe(code, { subtree: true, childList: true, characterData: true });
      }
    }
  }

  applyReadingRanges(code, language) {
    const text = code.textContent;
    const rows = this.engine.highlight(language, text);
    if (!rows) return;
    // CSS Custom Highlights color ranges without splitting or replacing text
    // nodes, so native font shaping, styles and layout remain unchanged.
    const win = code.ownerDocument.defaultView;
    if (!win.Highlight || !win.StaticRange || !win.CSS?.highlights) return;
    const walker = code.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let offset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      nodes.push({ node, from: offset, to: offset + node.length });
      offset += node.length;
    }
    const added = [];
    const lines = text.split('\n');
    offset = 0;
    rows.forEach((segments, index) => {
      for (const segment of segments) {
        if (!segment.light || !segment.dark) continue;
        const from = offset + segment.from;
        const to = offset + segment.to;
        const first = nodes.find((node) => node.from <= from && node.to > from);
        const last = nodes.find((node) => node.from < to && node.to >= to);
        if (!first || !last) continue;
        const range = new win.StaticRange({
          startContainer: first.node,
          startOffset: from - first.from,
          endContainer: last.node,
          endOffset: to - last.from,
        });
        added.push(this.addRange(range, segment));
      }
      // The engine returns one row per line; be defensive because a short row
      // list used to throw here and abort the whole rebuild.
      offset += (lines[index] ? lines[index].length : 0) + 1;
    });
    this.readingOriginals.set(code, added.filter(Boolean));
  }

  // Compatibility path for runtimes without the CSS Custom Highlight API
  // (older WebKit builds and other WebViews). Each token is wrapped in a
  // span carrying a themed class. Text content is never altered, so copying
  // and search still see the original code.
  applyReadingDom(code, language) {
    const text = code.textContent;
    const rows = this.engine.highlight(language, text);
    if (!rows) return;
    this.unwrapReading(code);
    const ranges = [];
    const lines = text.split('\n');
    let offset = 0;
    rows.forEach((segments, index) => {
      for (const segment of segments) {
        if (!segment.light || !segment.dark) continue;
        const className = highlightClass(segment.light, segment.dark);
        if (!this.fallbackClasses.has(className)) {
          this.fallbackClasses.set(className, {
            light: segment.light.toUpperCase(),
            dark: segment.dark.toUpperCase(),
          });
          this.styleDirty = true;
        }
        ranges.push({ from: offset + segment.from, to: offset + segment.to, className });
      }
      offset += lines[index].length + 1;
    });
    this.wrapReadingRanges(code, ranges);
  }

  wrapReadingRanges(code, ranges) {
    if (!ranges.length) return;
    const doc = code.ownerDocument;
    const nodes = [];
    const walker = doc.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    let offset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      nodes.push({ node, from: offset, to: offset + node.length });
      offset += node.length;
    }
    // Walk backwards so splitting a text node never invalidates an earlier
    // range that still has to be wrapped.
    for (let i = ranges.length - 1; i >= 0; i--) {
      const range = ranges[i];
      for (let j = nodes.length - 1; j >= 0; j--) {
        const item = nodes[j];
        const start = Math.max(range.from, item.from);
        const end = Math.min(range.to, item.to);
        if (end <= start) continue;
        const localStart = start - item.from;
        const localEnd = end - item.from;
        let target = item.node;
        if (localStart > 0) target = target.splitText(localStart);
        if (localEnd - localStart < target.length) target.splitText(localEnd - localStart);
        if (!target.parentNode) continue;
        const span = doc.createElement('span');
        span.className = range.className;
        target.parentNode.insertBefore(span, target);
        span.appendChild(target);
        this.domTokenSpans.add(span);
      }
    }
  }

  unwrapReading(code) {
    const spans = [...code.querySelectorAll('span[class*="aof-token-"]')];
    if (!spans.length) return;
    const touched = new Set();
    for (const span of spans) {
      const parent = span.parentNode;
      if (!parent) continue;
      touched.add(parent);
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      this.domTokenSpans.delete(span);
    }
    for (const parent of touched) {
      try {
        parent.normalize();
      } catch (error) {
        // Detached nodes need no normalization.
      }
    }
  }

  addRange(range, segment) {
    const win = range.startContainer.ownerDocument.defaultView;
    // The registry can disappear while the editor is still measuring (a WebView
    // that drops the API, a plugin reload, a pop-out teardown). Returning null
    // keeps the measure pass alive instead of throwing inside CodeMirror.
    if (!win?.Highlight || !win.CSS?.highlights) return null;
    const name = highlightName(segment.light, segment.dark);
    let palette = this.readingPalettes.get(name);
    if (!palette) {
      palette = {
        highlight: new win.Highlight(),
        light: segment.light.toUpperCase(),
        dark: segment.dark.toUpperCase(),
        win,
      };
      this.readingPalettes.set(name, palette);
      win.CSS.highlights.set(name, palette.highlight);
      this.styleDirty = true;
    }
    palette.highlight.add(range);
    return { palette, range, name };
  }

  // Removing a range must NOT unregister its palette. Deleting and re-creating
  // `CSS.highlights` entries on every measure pass is what made scrolling
  // stutter, and dropping the last range of a colour used to delete the CSS
  // rule with it — a view that was momentarily empty could take the theme with
  // it. Ranges are cleared; the palette lives until the theme changes.
  clearRanges(added) {
    for (const entry of added || []) {
      if (!entry) continue;
      const { palette, range } = entry;
      try {
        palette.highlight?.delete(range);
      } catch (error) {
        // A range whose nodes are already detached can fail to delete; the
        // palette itself is still usable and is dropped on the next theme
        // change or unload.
      }
    }
  }

  // Drops every palette and its registry entry. Only a real theme change (or
  // unload) may do this — the colours baked into the names no longer match.
  resetPalettes() {
    for (const [name, palette] of [...(this.readingPalettes || [])]) {
      try {
        palette.win?.CSS?.highlights?.delete?.(name);
      } catch (error) {
        // The registry can disappear if the host rebuilds the renderer context.
      }
    }
    this.readingPalettes?.clear();
    this.styleDirty = true;
  }

  rebuildStyle() {
    if (!this.readingStyle) return;
    // Palette/class membership is the only input to the generated CSS, so a
    // scroll measure pass that added or dropped *ranges* but no new palette
    // has nothing to rebuild. The old path re-derived and re-compared the
    // entire 10KB+ string on every pass (16-21 times per scroll gesture).
    if (!this.styleDirty) return;
    const next = this.highlightSupported
      ? buildHighlightCss(this.readingPalettes)
      : buildFallbackCss(this.fallbackClasses);
    this.styleDirty = false;
    // Rewriting a <style> node invalidates every rule in it and forces a full
    // style recalculation, which is a visible hitch while scrolling. Skip the
    // write when nothing changed.
    if (this.readingStyle.textContent === next) return;
    this.readingStyle.textContent = next;
  }

  // A CodeMirror update must not rewrite a <style> node synchronously, so the
  // fallback class list is flushed on the next task.
  scheduleFallbackStyle() {
    if (this.fallbackStyleTimer) return;
    this.fallbackStyleTimer = setTimeout(() => {
      this.fallbackStyleTimer = null;
      this.rebuildStyle();
    }, 0);
  }

  restoreReading(code) {
    this.readingObservers?.get(code)?.disconnect();
    this.readingObservers?.delete(code);
    this.clearRanges(this.readingOriginals.get(code));
    this.readingOriginals.delete(code);
    if (!this.highlightSupported) this.unwrapReading(code);
    this.readingLanguages?.delete(code);
    this.rebuildStyle();
  }

  onunload() {
    this.active = false;
    for (const code of [...(this.readingLanguages?.keys() || [])]) this.restoreReading(code);
    for (const ranges of [...(this.editorRanges?.values() || [])]) this.clearRanges(ranges);
    this.editorRanges?.clear();
    for (const [name, palette] of [...(this.readingPalettes || [])]) {
      try {
        palette.win.CSS.highlights.delete(name);
      } catch (error) {
        // The window may already be gone.
      }
    }
    this.readingPalettes?.clear();
    if (!this.highlightSupported) {
      // Safety net: unwrap any token span that outlived its reading child.
      for (const span of [...(this.domTokenSpans || [])]) {
        const parent = span.parentNode;
        if (!parent) continue;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
      }
      this.domTokenSpans?.clear();
      this.fallbackClasses?.clear();
    }
    this.clearAllReadingLineNumbers();
    for (const pre of [...(this.readingBackgroundElements || [])]) {
      pre.classList.remove(FENCED_BLOCK_CLASS);
    }
    this.readingBackgroundElements?.clear();
    for (const observer of this.readingContainerObservers?.values() || []) observer.disconnect();
    this.readingContainerObservers?.clear();
    if (this.readingRescanTimer) clearTimeout(this.readingRescanTimer);
    if (this.readingRescanLongTimer) clearTimeout(this.readingRescanLongTimer);
    if (this.readingNumberGeometryTimer) clearTimeout(this.readingNumberGeometryTimer);
    if (this.fallbackStyleTimer) clearTimeout(this.fallbackStyleTimer);
    this.readingRescanTimer = null;
    this.readingRescanLongTimer = null;
    this.readingNumberGeometryTimer = null;
    this.fallbackStyleTimer = null;
    this.readingContext = null;
    if (this.readingStyle) this.readingStyle.textContent = '';
    if (this.backgroundStyle) this.backgroundStyle.textContent = '';
    if (this.lineNumberStyle) this.lineNumberStyle.textContent = '';
    if (this.wrapStyle) this.wrapStyle.textContent = '';
    this.readingTokenCache = null;
    this.engine?.dispose();
  }
};
