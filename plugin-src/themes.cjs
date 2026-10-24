'use strict';

// Normalized theme catalog. The JSON asset is generated from the official,
// checked-in theme snapshots by tools/prepare-theme-assets.cjs. It intentionally
// contains only editor.foreground and token foreground colors.
const data = require('./assets/themes.json');

if (!data || data.formatVersion !== 1 || !data.themes || !Array.isArray(data.families)) {
  throw new Error('Invalid normalized theme asset');
}

const THEMES = data.themes;
const THEME_LIST = Object.freeze(Object.values(THEMES));
const FAMILIES = Object.freeze(data.families.map((family) => Object.freeze({
  id: family.id,
  name: family.name,
  presets: Object.freeze({ ...family.presets }),
})));
const FAMILY_BY_ID = new Map(FAMILIES.map((family) => [family.id, family]));
const DEFAULT_LIGHT = data.defaults.light;
const DEFAULT_DARK = data.defaults.dark;

function getTheme(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(THEMES, id) ? THEMES[id] : null;
}

function getFamily(id) {
  return FAMILY_BY_ID.get(id) || null;
}

function isValidFor(id, appearance) {
  const theme = getTheme(id);
  return Boolean(theme && theme.appearance === appearance);
}

function listByAppearance(appearance) {
  return THEME_LIST.filter((theme) => theme.appearance === appearance);
}

function resolveSelection(lightId, darkId) {
  return {
    light: isValidFor(lightId, 'light') ? lightId : DEFAULT_LIGHT,
    dark: isValidFor(darkId, 'dark') ? darkId : DEFAULT_DARK,
  };
}

module.exports = {
  THEMES,
  THEME_LIST,
  FAMILIES,
  DEFAULT_LIGHT,
  DEFAULT_DARK,
  getTheme,
  getFamily,
  isValidFor,
  listByAppearance,
  resolveSelection,
};
