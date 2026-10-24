#!/usr/bin/env node
/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

// Rebuild plugin-src/assets/themes.json and sources/theme-provenance.json from
// the checked-in, official theme snapshots. Run with --check in CI/tests to
// verify that generated assets are current without writing files.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const catalogPath = path.join(root, 'sources/themes/sources.json');
const outThemes = path.join(root, 'plugin-src/assets/themes.json');
const outProvenance = path.join(root, 'sources/theme-provenance.json');
const check = process.argv.includes('--check');

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// VS Code accepts JSONC for color themes. Several official snapshots use line
// comments and trailing commas, so keep the upstream bytes intact and parse
// them with a small JSONC reader instead of rewriting the source files.
function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      if (i < text.length) out += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n';
        i++;
      }
      i++;
      continue;
    }
    out += char;
  }
  return out;
}

function stripTrailingCommas(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === ',') {
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      if (text[next] === '}' || text[next] === ']') continue;
    }
    out += char;
  }
  return out;
}

function parseJsonc(text) {
  return JSON.parse(stripTrailingCommas(stripJsonComments(text)).replace(/^\uFEFF/, ''));
}

function firstDefaultTokenForeground(tokenColors) {
  for (const rule of tokenColors) {
    if (!rule || typeof rule !== 'object' || !rule.settings) continue;
    if (rule.scope !== undefined && !(Array.isArray(rule.scope) && rule.scope.length === 0)) continue;
    const foreground = parseHex(rule.settings.foreground);
    if (foreground) return foreground;
  }
  return null;
}

function parseHex(color) {
  if (typeof color !== 'string') return null;
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map(ch => ch + ch).join('');
  return '#' + hex.toUpperCase();
}

function normalizeHex(color, where) {
  const hex = parseHex(color);
  if (!hex) fail(`${where}: invalid hex color ${JSON.stringify(color)}`);
  return hex;
}

function resolveThemeFile(file, seen = new Set()) {
  const absolute = path.resolve(file);
  if (seen.has(absolute)) fail(`Theme include cycle at ${absolute}`);
  if (!fs.existsSync(absolute)) fail(`Missing theme source file ${absolute}`);
  const rawText = fs.readFileSync(absolute, 'utf8');
  let raw;
  try {
    raw = parseJsonc(rawText);
  } catch (error) {
    fail(`Cannot parse ${absolute}: ${error.message}`);
  }
  if (!raw || typeof raw !== 'object') fail(`Theme source is not an object: ${absolute}`);
  const nextSeen = new Set(seen).add(absolute);
  let base = { colors: {}, tokenColors: [], chain: [] };
  if (raw.include) {
    if (typeof raw.include !== 'string') fail(`${absolute}: include must be a string`);
    base = resolveThemeFile(path.resolve(path.dirname(absolute), raw.include), nextSeen);
  }
  return {
    colors: { ...base.colors, ...(raw.colors || {}) },
    tokenColors: [...base.tokenColors, ...(raw.tokenColors || [])],
    chain: [...base.chain, absolute],
    sourceThemeName: raw.name || base.sourceThemeName || null,
    sourceType: raw.type || base.sourceType || null,
    rawText,
  };
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  if (catalog.formatVersion !== 1) fail('Unsupported sources.json formatVersion');
  if (!Array.isArray(catalog.themes) || catalog.themes.length === 0) fail('No themes in sources.json');
  if (!Array.isArray(catalog.families) || catalog.families.length === 0) fail('No families in sources.json');

  const familyIds = new Set();
  const familyById = new Map();
  for (const family of catalog.families) {
    if (!family.id || familyIds.has(family.id)) fail(`Invalid or duplicate family id ${family.id}`);
    if (!family.name) fail(`Family ${family.id} needs a name`);
    familyIds.add(family.id);
    familyById.set(family.id, family);
  }

  const themeIds = new Set();
  const themes = {};
  const provenanceThemes = [];
  for (const entry of catalog.themes) {
    if (!entry.id || themeIds.has(entry.id)) fail(`Invalid or duplicate theme id ${entry.id}`);
    if (!familyById.has(entry.family)) fail(`${entry.id}: unknown family ${entry.family}`);
    if (entry.appearance !== 'light' && entry.appearance !== 'dark') {
      fail(`${entry.id}: appearance must be light or dark`);
    }
    if (!entry.name) fail(`${entry.id}: missing name`);
    if (!entry.license?.file || !entry.license?.spdx) fail(`${entry.id}: incomplete license metadata`);
    const licensePath = path.join(root, entry.license.file);
    if (!fs.existsSync(licensePath)) fail(`${entry.id}: missing license ${entry.license.file}`);
    const licenseText = fs.readFileSync(licensePath);
    const absoluteSource = path.join(root, entry.sourceFile);
    const resolved = resolveThemeFile(absoluteSource);
    const where = entry.id;
    // editor.foreground is optional in VS Code themes. Prefer it, then the
    // official default token rule, then the theme-wide UI foreground.
    let foreground;
    let foregroundSource;
    if (parseHex(resolved.colors['editor.foreground'])) {
      foreground = normalizeHex(resolved.colors['editor.foreground'], `${where} editor.foreground`);
      foregroundSource = 'editor.foreground';
    } else if (firstDefaultTokenForeground(resolved.tokenColors)) {
      foreground = firstDefaultTokenForeground(resolved.tokenColors);
      foregroundSource = 'tokenColors.default';
    } else if (parseHex(resolved.colors.foreground)) {
      foreground = normalizeHex(resolved.colors.foreground, `${where} colors.foreground`);
      foregroundSource = 'colors.foreground';
    } else {
      fail(`${where}: no valid default editor foreground`);
    }
    // The background is optional. If an official theme has no usable
    // editor.background, the runtime safely falls back to Obsidian's own
    // background rather than inventing or borrowing a color.
    const rawBackground = resolved.colors['editor.background'];
    const background = parseHex(rawBackground);
    const backgroundSource = background ? 'editor.background' : rawBackground === undefined ? 'missing' : 'invalid';
    const tokenColors = [];
    let skippedInvalid = 0;
    for (const rule of resolved.tokenColors) {
      if (!rule || typeof rule !== 'object' || !rule.settings || rule.settings.foreground === undefined) continue;
      const scope = rule.scope;
      if (Array.isArray(scope) && scope.length === 0) continue;
      // vscode-textmate ignores token foregrounds that are not hex colors
      // (for example Atom One's named "white" and "inherit" values).
      const tokenForeground = parseHex(rule.settings.foreground);
      if (!tokenForeground) {
        skippedInvalid += 1;
        continue;
      }
      tokenColors.push({
        ...(scope === undefined ? {} : { scope }),
        foreground: tokenForeground,
      });
    }
    if (tokenColors.length === 0) fail(`${entry.id}: no foreground token rules found`);
    const theme = {
      id: entry.id,
      family: entry.family,
      name: entry.name,
      appearance: entry.appearance,
      foreground,
      background,
      tokenColors,
    };
    themes[entry.id] = theme;
    themeIds.add(entry.id);

    const sourceFiles = [...new Set(resolved.chain)].map((absolute) => ({
      path: path.relative(root, absolute).split(path.sep).join('/'),
      sha256: sha256(fs.readFileSync(absolute)),
    }));
    provenanceThemes.push({
      id: entry.id,
      name: entry.name,
      family: entry.family,
      appearance: entry.appearance,
      source: entry.source,
      sourceFile: path.relative(root, absoluteSource).split(path.sep).join('/'),
      sourceFiles,
      sourceThemeName: resolved.sourceThemeName,
      sourceType: resolved.sourceType,
      editorForeground: foreground,
      foregroundSource,
      editorBackground: background,
      backgroundSource,
      foregroundRules: tokenColors.length,
      skippedNonHexTokenColors: skippedInvalid,
      normalizedSha256: sha256(JSON.stringify(theme)),
      license: { ...entry.license, sha256: sha256(licenseText) },
    });
  }

  const defaults = catalog.defaults || {};
  if (!themeIds.has(defaults.light) || themes[defaults.light].appearance !== 'light') {
    fail('Default light theme is missing or has the wrong appearance');
  }
  if (!themeIds.has(defaults.dark) || themes[defaults.dark].appearance !== 'dark') {
    fail('Default dark theme is missing or has the wrong appearance');
  }
  for (const family of catalog.families) {
    const presets = family.presets || {};
    for (const side of ['light', 'dark']) {
      if (presets[side] === undefined) continue;
      const theme = themes[presets[side]];
      if (!theme) fail(`Family ${family.id} preset ${side} references unknown theme ${presets[side]}`);
      if (theme.appearance !== side) fail(`Family ${family.id} preset ${side} uses a ${theme.appearance} theme`);
      if (theme.family !== family.id) fail(`Family ${family.id} preset ${side} uses theme from ${theme.family}`);
    }
    if (!presets.dark) fail(`Family ${family.id} needs a dark preset`);
  }

  const generatedThemes = {
    formatVersion: 1,
    defaults: { light: defaults.light, dark: defaults.dark },
    families: catalog.families.map((family) => ({
      id: family.id,
      name: family.name,
      presets: { ...family.presets },
    })),
    themes,
  };
  const generatedProvenance = {
    formatVersion: 1,
    generatedBy: 'tools/prepare-theme-assets.cjs',
    note: 'Theme JSON/JSONC snapshots are checked in under sources/. Only foreground token colors, editor.foreground (or its official fallback), and editor.background are normalized. Font styles, other UI colors and semantic token colors are intentionally not bundled.',
    defaults: { light: defaults.light, dark: defaults.dark },
    families: catalog.families.map((family) => ({ id: family.id, name: family.name, presets: { ...family.presets } })),
    themeCount: provenanceThemes.length,
    familyCount: catalog.families.length,
    themes: provenanceThemes,
  };
  // The asset is machine-read only (require()d into the bundle), so it is
  // written minified: 39 themes of token colours cost ~724 KiB pretty-printed
  // but only ~447 KiB compact, and that difference lands directly in main.js.
  const themeText = JSON.stringify(generatedThemes) + '\n';
  const provenanceText = JSON.stringify(generatedProvenance, null, 2) + '\n';

  if (check) {
    let stale = false;
    for (const [file, expected] of [[outThemes, themeText], [outProvenance, provenanceText]]) {
      const actual = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (actual !== expected) {
        stale = true;
        console.error(`STALE: ${path.relative(root, file)} (run npm run prepare-themes)`);
      }
    }
    if (stale) process.exitCode = 1;
    else console.log(`Theme assets are current: ${provenanceThemes.length} variants in ${catalog.families.length} families.`);
    return;
  }

  fs.mkdirSync(path.dirname(outThemes), { recursive: true });
  fs.writeFileSync(outThemes, themeText);
  fs.writeFileSync(outProvenance, provenanceText);
  console.log(`Wrote ${path.relative(root, outThemes)} and ${path.relative(root, outProvenance)}: ${provenanceThemes.length} variants in ${catalog.families.length} families.`);
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
