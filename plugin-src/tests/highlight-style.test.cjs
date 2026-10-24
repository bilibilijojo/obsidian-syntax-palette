'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  highlightName,
  highlightClass,
  buildHighlightCss,
  buildFallbackCss,
  selectorsFor,
  fallbackSelectorsFor,
} = require('../highlight-style.cjs');

const palette = new Map([
  ['aof-reading-aabbcc-112233', { light: '#AABBCC', dark: '#112233' }],
]);

test('highlight names and classes are stable and normalised', () => {
  assert.equal(highlightName('#aabbcc', '#112233'), 'aof-reading-aabbcc-112233');
  assert.equal(highlightClass('#aabbcc', '#112233'), 'aof-token-aabbcc-112233');
  assert.equal(highlightClass('#AABBCC', '#11223344'), 'aof-token-aabbcc-11223344');
  assert.throws(() => highlightClass('red', '#112233'));
  assert.throws(() => highlightClass('#112233', '#11223'));
});

// Regression guard for WebKit's custom-highlight behavior: it paints on
// the element that directly owns the text node. Obsidian wraps every token in
// a nested <span>, so the host-only selector produced no colour at all on
// iPhone while Chromium looked fine.
//
// The descendant form must be guarded: WebKit also paints the *entire* text of
// any element the selector matches, whether or not that text is inside the
// registered range, so a bare `*` tinted the editor line number with the colour
// of the first token on its line.
test('every custom highlight selector also has a guarded descendant form', () => {
  const css = buildHighlightCss(palette);
  const blocks = [...css.matchAll(/([^{}]+)\{/g)].map((match) => match[1]);
  assert.equal(blocks.length, 2);
  for (const block of blocks) {
    const selectors = block.split(',').map((value) => value.trim()).filter(Boolean);
    const hostOnly = selectors.filter((selector) => !/\s:not\(\.aof-ln\)::highlight\(/.test(selector));
    const nested = selectors.filter((selector) => /\s:not\(\.aof-ln\)::highlight\(/.test(selector));
    assert.equal(nested.length, hostOnly.length, block);
    assert.equal(nested.length, 2, block);
    for (const selector of hostOnly) {
      assert.match(selector, /pre > code::highlight\(aof-reading-aabbcc-112233\)|\.cm-line\.HyperMD-codeblock[^ ]*::highlight\(aof-reading-aabbcc-112233\)/);
    }
    for (const selector of nested) {
      assert.match(selector, /pre > code :not\(\.aof-ln\)::highlight\(aof-reading-aabbcc-112233\)|\.cm-line\.HyperMD-codeblock[^ ]* :not\(\.aof-ln\)::highlight\(aof-reading-aabbcc-112233\)/);
    }
    assert.doesNotMatch(block, /\*::highlight/, block);
    assert.doesNotMatch(block, /\s::highlight/, block);
  }
});

test('scoped selectors keep the theme and code-block boundary', () => {
  const light = selectorsFor('light', 'aof-reading-aabbcc-112233');
  const dark = selectorsFor('dark', 'aof-reading-aabbcc-112233');
  assert.equal(light.length, 4);
  assert.equal(dark.length, 4);
  for (const selector of light) {
    assert.ok(selector.startsWith('.theme-light '), selector);
    assert.match(selector, /\.markdown-rendered pre > code|\.markdown-source-view\.mod-cm6 \.cm-line\.HyperMD-codeblock/);
  }
  for (const selector of dark) assert.ok(selector.startsWith('.theme-dark '), selector);
});

test('custom highlight CSS only declares foreground colour', () => {
  const css = buildHighlightCss(palette);
  const declarations = [...css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)];
  assert(declarations.length > 0);
  for (const declaration of declarations) assert.equal(declaration[1], 'color');
  assert.doesNotMatch(css, /!important/i);
  assert.doesNotMatch(css, /background|font-|border|padding|margin|box-shadow|border-radius|line-height|letter-spacing/i);
});

test('empty palettes produce no stylesheet', () => {
  assert.equal(buildHighlightCss(new Map()), '');
  assert.equal(buildFallbackCss(new Map()), '');
});

// Compatibility renderer used when the runtime has no CSS Custom Highlight API
// older WebKit builds without CSS Custom Highlight. It must stay inside note code blocks and, like the
// primary path, only ever set `color`.
test('fallback CSS is scoped, class based and colour only', () => {
  const css = buildFallbackCss(new Map([
    ['aof-token-aabbcc-112233', { light: '#AABBCC', dark: '#112233' }],
  ]));
  assert.ok(css.includes('.theme-light .markdown-rendered pre > code .aof-token-aabbcc-112233'), css);
  assert.ok(css.includes('.theme-dark .markdown-rendered pre > code .aof-token-aabbcc-112233'), css);
  assert.ok(css.includes('.theme-light .markdown-source-view.mod-cm6 .cm-line.HyperMD-codeblock'), css);
  assert.match(css, /\.aof-token-aabbcc-112233 \{ color: #AABBCC; \}/);
  assert.match(css, /\.aof-token-aabbcc-112233 \{ color: #112233; \}/);
  assert.doesNotMatch(css, /::highlight/);
  assert.doesNotMatch(css, /!important/i);
  const declarations = [...css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)];
  assert(declarations.length > 0);
  for (const declaration of declarations) assert.equal(declaration[1], 'color');
  assert.doesNotMatch(css, /background|font-|border|padding|margin|box-shadow|border-radius|line-height|letter-spacing/i);
  for (const match of css.matchAll(/([^{}]+)\{/g)) {
    for (const selector of match[1].split(',').map((value) => value.trim()).filter(Boolean)) {
      assert.match(selector, /^\.theme-(light|dark) /);
      assert.match(selector, /\.aof-token-[0-9a-f-]+$/);
      assert.match(selector, /pre > code|\.cm-line\.HyperMD-codeblock/);
    }
  }
});

test('fallback selectors never touch inline code or prose', () => {
  const selectors = fallbackSelectorsFor('light', 'aof-token-aabbcc-112233');
  assert.equal(selectors.length, 2);
  for (const selector of selectors) {
    assert.doesNotMatch(selector, /\.markdown-rendered code(?!\s)/);
    assert.match(selector, /pre > code|\.cm-line\.HyperMD-codeblock/);
    assert.ok(selector.endsWith('.aof-token-aabbcc-112233'), selector);
  }
});
