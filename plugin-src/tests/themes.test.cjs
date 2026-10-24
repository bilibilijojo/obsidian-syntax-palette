/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const catalog = require('../themes.cjs');
const settings = require('../settings.cjs');
const { buildHighlightCss, highlightName } = require('../highlight-style.cjs');
const { backgroundSelectors, buildBackgroundCss } = require('../background-style.cjs');

const root = path.resolve(__dirname, '../..');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const expectedBackgrounds = {
  'atom-one-light': '#FAFAFA',
  'atom-one-dark': '#282C34',
  'github-light-default': '#FFFFFF',
  'github-dark-default': '#0D1117',
  'github-dark-dimmed': '#22272E',
  'ayu-light': '#FCFCFC',
  'ayu-dark': '#10141C',
  'ayu-mirage': '#242936',
  'vscode-light-plus': '#FFFFFF',
  'vscode-dark-plus': '#1E1E1E',
  'vscode-light-modern': '#FFFFFF',
  'vscode-dark-modern': '#1F1F1F',
  'catppuccin-latte': '#EFF1F5',
  'catppuccin-frappe': '#303446',
  'catppuccin-macchiato': '#24273A',
  'catppuccin-mocha': '#1E1E2E',
  'dracula-official': '#282A36',
  'tokyo-night-light': '#E6E7ED',
  'tokyo-night-night': '#1A1B26',
  'tokyo-night-storm': '#24283B',
  'one-dark-pro': '#282C34',
  'one-dark-pro-darker': '#23272E',
  'one-dark-pro-flat': '#282C34',
  'night-owl-light': '#FBFBFB',
  'night-owl-night': '#011627',
  nord: '#2E3440',
  'solarized-light': '#FDF6E3',
  'solarized-dark': '#002B36',
  'kanagawa-lotus': '#F2ECBC',
  'kanagawa-wave': '#1F1F28',
  'kanagawa-dragon': '#181616',
  'material-default': '#263238',
  'material-darker': '#212121',
  'material-palenight': '#292D3E',
  'material-ocean': '#0F111A',
  'material-lighter': '#FAFAFA',
  monokai: '#272822',
  'min-light': '#FFFFFF',
  'min-dark': '#1F1F1F',
};

const expectedLightIds = [
  'atom-one-light', 'github-light-default', 'ayu-light', 'vscode-light-plus',
  'vscode-light-modern', 'catppuccin-latte', 'tokyo-night-light', 'night-owl-light',
  'solarized-light', 'kanagawa-lotus', 'material-lighter', 'min-light',
];

test('Generated theme assets are current', () => {
  execFileSync(process.execPath, [path.join(root, 'tools/prepare-theme-assets.cjs'), '--check'], {
    cwd: root,
    stdio: 'pipe',
  });
});

test('Catalog contains 15 families and 39 verified variants', () => {
  assert.equal(catalog.FAMILIES.length, 15);
  assert.deepEqual(catalog.FAMILIES.map((family) => family.id), [
    'atom-one', 'github', 'ayu', 'vscode', 'catppuccin', 'dracula',
    'tokyo-night', 'one-dark-pro', 'night-owl', 'nord', 'solarized',
    'kanagawa', 'material', 'monokai', 'min',
  ]);
  assert.equal(catalog.THEME_LIST.length, 39);
  assert.equal(catalog.listByAppearance('light').length, 12);
  assert.equal(catalog.listByAppearance('dark').length, 27);
  assert.deepEqual(catalog.listByAppearance('light').map((theme) => theme.id), expectedLightIds);
  const ids = new Set();
  for (const theme of catalog.THEME_LIST) {
    assert(!ids.has(theme.id), theme.id);
    ids.add(theme.id);
    assert(['light', 'dark'].includes(theme.appearance), theme.id);
    assert(catalog.getFamily(theme.family), theme.id);
    assert.match(theme.foreground, /^#[0-9A-F]{6}(?:[0-9A-F]{2})?$/, theme.id);
    assert.equal(theme.background, expectedBackgrounds[theme.id], `${theme.id} background`);
    assert.match(theme.background, /^#[0-9A-F]{6}(?:[0-9A-F]{2})?$/, theme.id);
    assert(Array.isArray(theme.tokenColors) && theme.tokenColors.length > 0, theme.id);
    for (const rule of theme.tokenColors) {
      assert.match(rule.foreground, /^#[0-9A-F]{6}(?:[0-9A-F]{2})?$/, theme.id);
      if (rule.scope !== undefined) assert(Array.isArray(rule.scope) || typeof rule.scope === 'string', theme.id);
    }
  }
  assert.deepEqual(Object.keys(expectedBackgrounds).sort(), Object.keys(catalog.THEMES).sort());
});

test('Every family preset is valid, no fake light variants were invented', () => {
  for (const family of catalog.FAMILIES) {
    assert(family.presets.dark, family.id);
    for (const side of ['light', 'dark']) {
      if (!family.presets[side]) continue;
      const theme = catalog.getTheme(family.presets[side]);
      assert(theme, `${family.id}/${side}`);
      assert.equal(theme.family, family.id, `${family.id}/${side}`);
      assert.equal(theme.appearance, side, `${family.id}/${side}`);
    }
  }
  for (const family of ['dracula', 'one-dark-pro', 'nord', 'monokai']) {
    assert.equal(catalog.getFamily(family).presets.light, undefined, family);
  }
  assert.equal(catalog.getFamily('tokyo-night').presets.light, 'tokyo-night-light');
  assert.equal(catalog.getFamily('kanagawa').presets.light, 'kanagawa-lotus');
  assert.equal(catalog.getFamily('material').presets.light, 'material-lighter');
  assert.equal(catalog.getFamily('min').presets.light, 'min-light');
  assert.equal(catalog.DEFAULT_LIGHT, 'atom-one-light');
  assert.equal(catalog.DEFAULT_DARK, 'atom-one-dark');
});

test('Only the explicitly requested One Dark Pro UI variants share plugin-visible colors', () => {
  // One Dark Pro Flat differs from One Dark Pro only in VS Code workbench
  // chrome; its token palette and editor background are identical. It is kept
  // because the v0.3.0 request names it explicitly, and this identity is
  // documented rather than hidden. No other duplicate family was introduced.
  const groups = new Map();
  for (const theme of catalog.THEME_LIST) {
    const key = sha256(JSON.stringify({
      appearance: theme.appearance,
      foreground: theme.foreground,
      background: theme.background,
      tokenColors: theme.tokenColors,
    }));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(theme.id);
  }
  const duplicates = [...groups.values()].filter((ids) => ids.length > 1).map((ids) => ids.sort());
  assert.deepEqual(duplicates, [['one-dark-pro', 'one-dark-pro-flat']]);
});

test('Theme provenance hashes every source file, license and normalized asset', () => {
  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'sources/theme-provenance.json'), 'utf8'));
  const asset = JSON.parse(fs.readFileSync(path.join(root, 'plugin-src/assets/themes.json'), 'utf8'));
  assert.equal(provenance.themeCount, 39);
  assert.equal(provenance.familyCount, 15);
  assert.equal(provenance.themes.length, 39);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'sources/themes/sources.json'), 'utf8'));
  const manifestIds = manifest.themes.map((theme) => theme.id);
  assert.deepEqual(provenance.themes.map((theme) => theme.id), manifestIds);
  for (const item of provenance.themes) {
    assert(item.source && typeof item.source === 'object', item.id);
    assert(item.source.version || item.source.vscodeVersion, item.id);
    assert(item.source.url || item.source.marketplaceUrl, item.id);
    assert(['MIT', 'Apache-2.0'].includes(item.license.spdx), item.id);
    const licensePath = path.join(root, item.license.file);
    assert(fs.existsSync(licensePath), item.license.file);
    assert.equal(sha256(fs.readFileSync(licensePath)), item.license.sha256, item.license.file);
    if (item.license.spdx === 'Apache-2.0') {
      assert.match(fs.readFileSync(licensePath, 'utf8'), /Apache License/);
    }
    assert(item.sourceFiles.length > 0, item.id);
    for (const sourceFile of item.sourceFiles) {
      const sourcePath = path.join(root, sourceFile.path);
      assert(fs.existsSync(sourcePath), sourceFile.path);
      assert.equal(sha256(fs.readFileSync(sourcePath)), sourceFile.sha256, sourceFile.path);
    }
    assert.equal(sha256(JSON.stringify(asset.themes[item.id])), item.normalizedSha256, item.id);
    assert.equal(item.editorBackground, expectedBackgrounds[item.id], item.id);
    assert.equal(item.backgroundSource, 'editor.background', item.id);
    assert.equal(item.foregroundRules, asset.themes[item.id].tokenColors.length, item.id);
  }
});

test('New theme snapshots and special source classifications are recorded accurately', () => {
  const expected = {
    'sources/themes/tokyo-night/light.json': '80273128d232d645cbdf8b5bb8c7c7dfddb9f8825588117cdf84c3a98724b050',
    'sources/themes/tokyo-night/night.json': 'e08d77c898ead9ed129dc18ff4f841e2353477e69ccd6fa7d0610561c31da4d8',
    'sources/themes/tokyo-night/storm.json': 'd190b57f2fa662233adc5c8f6e7aeac15330452a0569a2086b979b92b7ce6cea',
    'sources/themes/one-dark-pro/pro.json': '4e6e0d19f8e886e1ff013b1c1b7588c67f1c31cb030cb5999228e2c63de5e43a',
    'sources/themes/one-dark-pro/darker.json': '09d20126b645956665b77da23c8f02dcecf3d60b90202e5b1e4ead4a3d28a54d',
    'sources/themes/one-dark-pro/flat.json': 'dd6bd7c7209e31f81ebd67029675f073fa55fb273408eb5907097e9fb814567e',
    'sources/themes/night-owl/light-owl.json': '366bafde28045d2e6f0287ac2ff9b35e5d056ae61865af762cc5bd9565476360',
    'sources/themes/night-owl/night-owl.json': '5f7a6aebcb28e803f30b54dc4d401a8c5f9ca42d83a31d1fadcb2494fe1dc78b',
    'sources/themes/nord/nord.json': '7e307e98bc3a90785a2630bdb8c2c94352e22f744c6629cdbf3e82329e04a236',
    'sources/themes/solarized/dark.json': 'e9526b405bbfe13f8efed2f8f9e97cffb435169553e7566ca07e838ac50c3841',
    'sources/themes/solarized/light.json': '4f57c1aaf23d188b5956f08e7aa50b381f22a353b88be3795e7824e34b253d42',
    'sources/themes/kanagawa/dragon.json': 'd1657717fa6f24da32d69e57a0d868a685cc7c554f12218cbb5353b7a577bdae',
    'sources/themes/kanagawa/lotus.json': '1fcb340d05d778cb0bd5760cdf8d3d52955cb0e69248df4c8258bf54a9971b7b',
    'sources/themes/kanagawa/wave.json': '41d3f2c40b75e2dbf147db16ec581249f14213e5680ca71a138b2fd4b20977ed',
    'sources/themes/material/default.json': '4666ea5560a01e9d3d4b601169d9b69bcb6c46d3e861ded1e90caf5648183a76',
    'sources/themes/material/darker.json': '63b9ea1f44ab0785a10d8b8921a622948c2aaf5e89de36b836ee6055357d1476',
    'sources/themes/material/palenight.json': 'e54792f1273d510acdbafedd08f57ffc6a056b748649085aa5ad1dbf447c7146',
    'sources/themes/material/ocean.json': 'b994cc91689f2d4b06ae5fefcf791f680af3bb7f85ba7647358b552bda559bcc',
    'sources/themes/material/lighter.json': 'e401d34416f9efc834e63f147f5a8a8339562a5e16bcbcf9f9618fd70a58a4e5',
    'sources/themes/min/light.json': '3ad0981e561b4096d026f218252f77f732d68605f4d2c9f4820052fd5fa0ea88',
    'sources/themes/min/dark.json': '617a7949326293695e7cd1d0ad169ddb96ebf34929e8bb88bf3f79b40e2992c5',
    'sources/themes/vscode/monokai.json': '78be641baf2fecf7e6c2ff52e834fc8325fbf54a3257e64759a12866b0700efd',
  };
  for (const [file, hash] of Object.entries(expected)) {
    assert.equal(sha256(fs.readFileSync(path.join(root, file))), hash, file);
  }

  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'sources/theme-provenance.json'), 'utf8'));
  const byId = Object.fromEntries(provenance.themes.map((item) => [item.id, item]));
  assert.equal(byId['material-default'].source.version, '34.5.0');
  assert.equal(byId['material-default'].license.spdx, 'Apache-2.0');
  assert.match(byId['material-default'].source.licenseNote, /34\.7\.x/);
  assert.equal(byId['kanagawa-wave'].source.port, true);
  assert.match(byId['kanagawa-wave'].source.portOf, /rebelot/);
  assert.equal(byId['solarized-light'].source.port, true);
  assert.equal(byId['solarized-light'].appearance, 'light');
  assert.equal(byId['tokyo-night-light'].appearance, 'light');
  assert.match(byId['tokyo-night-light'].source.appearanceNote, /uiTheme "vs"/);
  assert.equal(byId['monokai'].source.kind, 'vscode-builtin');
  assert.equal(byId['min-dark'].foregroundSource, 'tokenColors.default');
  const newFamilies = new Set(['tokyo-night', 'one-dark-pro', 'night-owl', 'nord', 'solarized', 'kanagawa', 'material', 'min']);
  for (const item of provenance.themes.filter((entry) => newFamilies.has(entry.family))) {
    assert.match(item.source.vsixSha256, /^[0-9a-f]{64}$/, item.id);
    assert.match(item.source.downloadUrl, /marketplace\.visualstudio\.com/, item.id);
  }
});

test('Normalized assets contain only documented foreground and background data', () => {
  const asset = JSON.parse(fs.readFileSync(path.join(root, 'plugin-src/assets/themes.json'), 'utf8'));
  for (const theme of Object.values(asset.themes)) {
    assert.deepEqual(Object.keys(theme).sort(), ['appearance', 'background', 'family', 'foreground', 'id', 'name', 'tokenColors']);
    for (const rule of theme.tokenColors) {
      assert.deepEqual(Object.keys(rule).sort(), rule.scope === undefined ? ['foreground'] : ['foreground', 'scope']);
    }
  }
});

test('Settings normalize invalid and legacy data with backgrounds, line numbers and wrapping off by default', () => {
  const defaults = {
    light: 'atom-one-light',
    dark: 'atom-one-dark',
    coloredBrackets: true,
    codeBlockBackground: false,
    lineNumbers: false,
    wrapCodeBlocks: false,
  };
  assert.deepEqual(settings.DEFAULT_SETTINGS, defaults);
  assert.deepEqual(settings.normalizeSettings(null), defaults);
  assert.deepEqual(settings.normalizeSettings([]), defaults);
  assert.deepEqual(settings.normalizeSettings({ light: 'missing', dark: 'also-missing' }), defaults);
  assert.deepEqual(settings.normalizeSettings({ light: 'github-dark-default', dark: 'github-light-default' }), defaults);
  // An untouched 0.2.0 data.json has no codeBlockBackground key.
  assert.deepEqual(settings.normalizeSettings({
    lightTheme: 'github-light-default', darkTheme: 'catppuccin-mocha', coloredBrackets: false,
  }), {
    light: 'github-light-default',
    dark: 'catppuccin-mocha',
    coloredBrackets: false,
    codeBlockBackground: false,
    lineNumbers: false,
    wrapCodeBlocks: false,
  });
  // A 0.3.0 data.json has a background key but no lineNumbers key: upgrading
  // must never switch line numbers on by itself.
  assert.deepEqual(settings.normalizeSettings({
    light: 'atom-one-light', dark: 'atom-one-dark',
    coloredBrackets: true, codeBlockBackground: true,
  }), {
    light: 'atom-one-light',
    dark: 'atom-one-dark',
    coloredBrackets: true,
    codeBlockBackground: true,
    lineNumbers: false,
    wrapCodeBlocks: false,
  });
  assert.equal(settings.normalizeSettings({ codeBlockBackground: true }).codeBlockBackground, true);
  assert.equal(settings.normalizeSettings({ codeBlockBackground: 'true' }).codeBlockBackground, false);
  assert.equal(settings.normalizeSettings({ codeBlockBackground: 1 }).codeBlockBackground, false);
  assert.equal(settings.normalizeSettings({ codeBlockBackground: false }).codeBlockBackground, false);
  assert.equal(settings.normalizeSettings({ lineNumbers: true }).lineNumbers, true);
  assert.equal(settings.normalizeSettings({ lineNumbers: false }).lineNumbers, false);
  assert.equal(settings.normalizeSettings({ lineNumbers: 'true' }).lineNumbers, false);
  assert.equal(settings.normalizeSettings({ lineNumbers: 1 }).lineNumbers, false);
  assert.equal(settings.normalizeSettings({ lineNumbers: null }).lineNumbers, false);
  // 0.5.0 adds wrapCodeBlocks. A 0.4.x data.json has no such key, and the
  // default must stay "no wrapping" (Obsidian's own editor wraps by default,
  // so the switch has to be explicit).
  assert.equal(settings.normalizeSettings({}).wrapCodeBlocks, false);
  assert.equal(settings.normalizeSettings({ wrapCodeBlocks: true }).wrapCodeBlocks, true);
  assert.equal(settings.normalizeSettings({ wrapCodeBlocks: false }).wrapCodeBlocks, false);
  assert.equal(settings.normalizeSettings({ wrapCodeBlocks: 'true' }).wrapCodeBlocks, false);
  assert.equal(settings.normalizeSettings({ wrapCodeBlocks: 1 }).wrapCodeBlocks, false);
  assert.equal(settings.normalizeSettings({ wrapCodeBlocks: null }).wrapCodeBlocks, false);
  // A stored selection round-trips: wrapping survives reload and is orthogonal
  // to the other three switches.
  const stored = settings.normalizeSettings({
    light: 'atom-one-light', dark: 'atom-one-dark',
    coloredBrackets: false, codeBlockBackground: true,
    lineNumbers: true, wrapCodeBlocks: true,
  });
  assert.deepEqual(stored, {
    light: 'atom-one-light', dark: 'atom-one-dark',
    coloredBrackets: false, codeBlockBackground: true,
    lineNumbers: true, wrapCodeBlocks: true,
  });
});

test('Independent selection, patching and presets compose correctly', () => {
  const custom = settings.patchSettings(settings.DEFAULT_SETTINGS, {
    light: 'github-light-default', dark: 'catppuccin-mocha', codeBlockBackground: true,
  });
  assert.equal(custom.light, 'github-light-default');
  assert.equal(custom.dark, 'catppuccin-mocha');
  assert.equal(custom.coloredBrackets, true);
  assert.equal(custom.codeBlockBackground, true);
  const github = settings.applyPreset(custom, 'github');
  assert.deepEqual(github, {
    light: 'github-light-default', dark: 'github-dark-default',
    coloredBrackets: true, codeBlockBackground: true, lineNumbers: false,
    wrapCodeBlocks: false,
  });
  const dracula = settings.applyPreset(github, 'dracula');
  assert.deepEqual(dracula, {
    light: 'github-light-default', dark: 'dracula-official',
    coloredBrackets: true, codeBlockBackground: true, lineNumbers: false,
    wrapCodeBlocks: false,
  });
  const oneDark = settings.applyPreset(github, 'one-dark-pro');
  assert.equal(oneDark.light, 'github-light-default');
  assert.equal(oneDark.dark, 'one-dark-pro');
  const material = settings.applyPreset(github, 'material');
  assert.equal(material.light, 'material-lighter');
  assert.equal(material.dark, 'material-default');
  assert.deepEqual(settings.applyPreset(github, 'not-a-family'), github);
  assert.equal(settings.sameSettings(github, { ...github }), true);
  assert.equal(settings.sameSettings(github, dracula), false);
  assert.equal(settings.sameSettings(github, { ...github, codeBlockBackground: false }), false);
  assert.equal(settings.sameSettings(github, { ...github, lineNumbers: true }), false);
  assert.equal(settings.sameSettings({ ...github, lineNumbers: true }, { ...github, lineNumbers: true }), true);
  // The wrap switch must be part of the equality check, otherwise toggling it
  // would be swallowed by the "nothing changed" fast path and never repaint.
  assert.equal(settings.sameSettings(github, { ...github, wrapCodeBlocks: true }), false);
  assert.equal(settings.sameSettings({ ...github, wrapCodeBlocks: true }, { ...github, wrapCodeBlocks: true }), true);
  assert.equal(settings.themeOptions('light').length, 12);
  assert.equal(settings.themeOptions('dark').length, 27);
  assert.equal(settings.familyOptions().length, 15);
  assert(settings.themeOptions('dark').find((option) => option.value === 'tokyo-night-storm').label.includes('Tokyo Night ·'));
  assert(settings.familyOptions().find((option) => option.value === 'material').label === 'Material Theme');
});

test('Highlight CSS names and colors are validated', () => {
  assert.equal(highlightName('#AABBCC', '#11223344'), 'aof-reading-aabbcc-11223344');
  assert.throws(() => highlightName('red', '#112233'));
  assert.throws(() => highlightName('#112233', '#11223'));
  assert.throws(() => buildHighlightCss(new Map([['x', { light: 'red', dark: '#112233' }]])));
  const css = buildHighlightCss(new Map([['aof-reading-aabbcc-112233', { light: '#AABBCC', dark: '#112233' }]]));
  assert.match(css, /\.theme-light .*::highlight\(aof-reading-aabbcc-112233\) \{ color: #AABBCC; \}/);
  assert.match(css, /\.theme-dark .*::highlight\(aof-reading-aabbcc-112233\) \{ color: #112233; \}/);
});

test('Background CSS is opt-in, mode-matched and limited to background-color', () => {
  const light = { id: 'light', background: '#fdf6e3' };
  const dark = { id: 'dark', background: '#24283b' };
  assert.equal(buildBackgroundCss({ enabled: false, light, dark }), '');
  assert.equal(buildBackgroundCss({ enabled: false }), '');
  const css = buildBackgroundCss({ enabled: true, light, dark });
  const declarations = [...css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)];
  assert(declarations.length > 0);
  for (const declaration of declarations) assert.equal(declaration[1], 'background-color');
  assert.doesNotMatch(css, /(^|[^-])color\s*:/);
  assert.doesNotMatch(css, /font-|border|padding|margin|box-shadow|border-radius|line-height|letter-spacing|background-image|opacity/i);
  assert.match(css, new RegExp(`\\.theme-light [^{]+\\{ background-color: #FDF6E3; \\}`));
  assert.match(css, new RegExp(`\\.theme-dark [^{]+\\{ background-color: #24283B; \\}`));
  const lightRule = css.split('\n\n').find((rule) => rule.includes('.theme-light'));
  const darkRule = css.split('\n\n').find((rule) => rule.includes('.theme-dark'));
  assert(!lightRule.includes('#24283B'));
  assert(!darkRule.includes('#FDF6E3'));
  for (const rule of css.split('\n\n')) {
    assert(rule.includes('pre.aof-fenced-block') || rule.includes('.cm-line.aof-fenced-line'));
    assert(!/(body|\.cm-editor|\.markdown-source-view\s*\{|code:not)/.test(rule));
  }
  assert.deepEqual(backgroundSelectors('light'), [
    '.theme-light .markdown-rendered pre.aof-fenced-block',
    '.theme-light .markdown-rendered pre.aof-fenced-block > code',
    '.theme-light .markdown-source-view.mod-cm6 .cm-line.aof-fenced-line',
  ]);
});

test('Missing or malformed theme backgrounds safely produce no override', () => {
  assert.equal(buildBackgroundCss({
    enabled: true,
    light: { background: null },
    dark: { background: 'not-a-color' },
  }), '');
  const onlyDark = buildBackgroundCss({
    enabled: true,
    light: { background: '#FFFFFF' },
    dark: { background: undefined },
  });
  assert.match(onlyDark, /\.theme-light/);
  assert.doesNotMatch(onlyDark, /\.theme-dark/);
  const swapped = buildBackgroundCss({ enabled: true, light: { background: '#111111' }, dark: { background: '#EEEEEE' } });
  assert.match(swapped, /\.theme-light [^{]+\{ background-color: #111111; \}/);
  assert.match(swapped, /\.theme-dark [^{]+\{ background-color: #EEEEEE; \}/);
});
