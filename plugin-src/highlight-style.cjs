'use strict';

const PREFIX = 'aof-reading-';
const CLASS_PREFIX = 'aof-token-';
// Class of the line-number widget in the editor gutter.
const NUMBER_CLASS = '.aof-ln';
const COLOR_RE = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;

function assertColor(color, where) {
  if (typeof color !== 'string' || !COLOR_RE.test(color)) {
    throw new Error(`${where}: invalid highlight color ${JSON.stringify(color)}`);
  }
  return color.toUpperCase();
}

function tokenSuffix(light, dark) {
  return assertColor(light, 'light').slice(1).toLowerCase() + '-' + assertColor(dark, 'dark').slice(1).toLowerCase();
}

function highlightName(light, dark) {
  return PREFIX + tokenSuffix(light, dark);
}

// Fallback path: a plain class applied to a wrapper element. Used only when the
// runtime has no CSS Custom Highlight API at all (older WebKit and other WebViews).
function highlightClass(light, dark) {
  return CLASS_PREFIX + tokenSuffix(light, dark);
}

function codeHosts(mode) {
  return [
    `.theme-${mode} .markdown-rendered pre > code`,
    `.theme-${mode} .markdown-source-view.mod-cm6 .cm-line.HyperMD-codeblock:not(.HyperMD-codeblock-begin):not(.HyperMD-codeblock-end)`,
  ];
}

// WebKit paints a custom highlight only where the element matched by
// `::highlight()` directly owns the highlighted text nodes. Obsidian's Prism
// output wraps every token in a nested <span>, so a selector that targets only
// the `<code>` / `.cm-line` host leaves the whole block uncoloured in WebKit
// even though `CSS.highlights` is populated correctly. Adding the
// descendant form paints nested token spans as well; Chromium already covers
// them, and re-painting the same name with the same colour is a no-op.
//
// The descendant form must skip the line-number widget. WebKit applies the
// highlight colour to the whole text content of every element the selector
// matches, without intersecting it with the registered range: with a bare `*`
// the number inherited the colour of the first token on its line, so a lone
// ")" painted the number blue and `import` painted it purple, while empty lines
// kept the plugin's grey. `:not(.aof-ln)` keeps the widget out of the match set;
// Chromium is unaffected because it only paints text inside the ranges.
function selectorsFor(mode, name) {
  const selectors = [];
  for (const host of codeHosts(mode)) {
    selectors.push(`${host}::highlight(${name})`);
    selectors.push(`${host} :not(${NUMBER_CLASS})::highlight(${name})`);
  }
  return selectors;
}

// The only property this plugin may apply to a note is foreground `color`.
// Keeping the generator isolated makes that visual boundary directly testable.
function buildHighlightCss(palettes) {
  const entries = palettes instanceof Map ? [...palettes.entries()] : [...palettes];
  return entries
    .map(([name, palette]) => ({ name, light: assertColor(palette.light, name), dark: assertColor(palette.dark, name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, light, dark }) => [
      `${selectorsFor('light', name).join(',\n')} { color: ${light}; }`,
      `${selectorsFor('dark', name).join(',\n')} { color: ${dark}; }`,
    ].join('\n'))
    .join('\n');
}

function fallbackSelectorsFor(mode, className) {
  return [
    `.theme-${mode} .markdown-rendered pre > code .${className}`,
    `.theme-${mode} .markdown-source-view.mod-cm6 .cm-line.HyperMD-codeblock:not(.HyperMD-codeblock-begin):not(.HyperMD-codeblock-end) .${className}`,
  ];
}

function buildFallbackCss(classes) {
  const entries = classes instanceof Map ? [...classes.entries()] : [...classes];
  return entries
    .map(([className, palette]) => ({ className, light: assertColor(palette.light, className), dark: assertColor(palette.dark, className) }))
    .sort((a, b) => a.className.localeCompare(b.className))
    .map(({ className, light, dark }) => [
      `${fallbackSelectorsFor('light', className).join(',\n')} { color: ${light}; }`,
      `${fallbackSelectorsFor('dark', className).join(',\n')} { color: ${dark}; }`,
    ].join('\n'))
    .join('\n');
}

module.exports = {
  PREFIX,
  CLASS_PREFIX,
  NUMBER_CLASS,
  highlightName,
  highlightClass,
  buildHighlightCss,
  buildFallbackCss,
  selectorsFor,
  fallbackSelectorsFor,
};
