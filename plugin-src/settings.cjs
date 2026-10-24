'use strict';

const {
  DEFAULT_LIGHT,
  DEFAULT_DARK,
  FAMILIES,
  getFamily,
  resolveSelection,
  listByAppearance,
} = require('./themes.cjs');

const DEFAULT_SETTINGS = Object.freeze({
  light: DEFAULT_LIGHT,
  dark: DEFAULT_DARK,
  coloredBrackets: true,
  // Opt-in only. In particular, data.json files written by 0.2.0 (which have
  // no such key) must keep the native Obsidian code block background.
  codeBlockBackground: false,
  // Opt-in only. Files written by 0.3.0 have no lineNumbers key, so upgrading
  // users keep the exact code block layout they had before.
  lineNumbers: false,
  // Editing-view code-block soft wrap, added in 0.5.0. `false` (the default,
  // including missing keys in older data.json files) means fenced code lines
  // do NOT soft-wrap: long lines stay on one visual row and each fenced block gains
  // its own horizontal scrollbar, like the reading view. `true` restores Obsidian's
  // native soft wrapping for code blocks. Ordinary markdown text and the
  // reading view are never affected by this switch.
  wrapCodeBlocks: false,
});

function normalizeSettings(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const selection = resolveSelection(value.light ?? value.lightTheme, value.dark ?? value.darkTheme);
  return {
    light: selection.light,
    dark: selection.dark,
    coloredBrackets: typeof value.coloredBrackets === 'boolean' ? value.coloredBrackets : true,
    codeBlockBackground: value.codeBlockBackground === true,
    lineNumbers: value.lineNumbers === true,
    wrapCodeBlocks: value.wrapCodeBlocks === true,
  };
}

function patchSettings(settings, patch) {
  return normalizeSettings({ ...normalizeSettings(settings), ...(patch || {}) });
}

function applyPreset(settings, familyId) {
  const current = normalizeSettings(settings);
  const family = getFamily(familyId);
  if (!family) return current;
  // A family preset may intentionally define only one side (Dracula has no
  // light variant); the other side keeps the user's independent selection.
  return normalizeSettings({ ...current, ...family.presets });
}

function sameSettings(a, b) {
  return a.light === b.light && a.dark === b.dark &&
    a.coloredBrackets === b.coloredBrackets && a.codeBlockBackground === b.codeBlockBackground &&
    a.lineNumbers === b.lineNumbers && a.wrapCodeBlocks === b.wrapCodeBlocks;
}

function themeOptions(appearance) {
  return listByAppearance(appearance).map((theme) => {
    const family = getFamily(theme.family);
    // Prefixing each option with its family keeps the 39-theme native select
    // usable without adding a separate theme browser/search UI.
    return { value: theme.id, label: family ? `${family.name} · ${theme.name}` : theme.name };
  });
}

function familyOptions() {
  return FAMILIES.map((family) => ({ value: family.id, label: family.name }));
}

module.exports = {
  DEFAULT_SETTINGS,
  normalizeSettings,
  patchSettings,
  applyPreset,
  sameSettings,
  themeOptions,
  familyOptions,
};
