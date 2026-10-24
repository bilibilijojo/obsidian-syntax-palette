'use strict';

const tm = require('vscode-textmate');
const onig = require('vscode-oniguruma');
const rawGrammars = require('./assets/grammars.json');
const defaultCatalog = require('./themes.cjs');

const aliases = {
  python: 'python', py: 'python', javascript: 'javascript', js: 'javascript', jsx: 'javascript',
  json: 'json', jsonc: 'jsonc', bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash',
  html: 'html', htm: 'html', css: 'css', typescript: 'typescript', ts: 'typescript', tsx: 'tsx',
};
const scopes = {
  python: 'source.python', javascript: 'source.js', json: 'source.json', jsonc: 'source.json.comments',
  bash: 'source.shell', html: 'text.html.derivative', css: 'source.css', typescript: 'source.ts', tsx: 'source.tsx',
};
// VS Code's native bracket-pair foreground defaults. These are a plugin option,
// not colors imported from any theme JSON.
const brackets = { light: ['#0431FA', '#319331', '#7B3814'], dark: ['#FFD700', '#DA70D6', '#179FFF'] };

function canonical(language) {
  return aliases[String(language).toLowerCase()] || null;
}

function themeFor(theme) {
  if (!theme || typeof theme !== 'object') throw new Error('Missing theme');
  if (typeof theme.foreground !== 'string' || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(theme.foreground)) {
    throw new Error(`Theme ${theme.id || theme.name || '?'} has an invalid foreground`);
  }
  if (!Array.isArray(theme.tokenColors)) throw new Error(`Theme ${theme.id || theme.name || '?'} has no token colors`);
  return {
    name: theme.name || theme.id || 'theme',
    settings: [
      { settings: { foreground: theme.foreground } },
      ...theme.tokenColors.map((rule) => ({
        ...(rule.scope === undefined ? {} : { scope: rule.scope }),
        settings: { foreground: rule.foreground },
      })),
    ],
  };
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

class SyntaxEngine {
  constructor(options = {}) {
    this.catalog = options.catalog || defaultCatalog;
    this.defaultLight = this.catalog.DEFAULT_LIGHT || defaultCatalog.DEFAULT_LIGHT;
    this.defaultDark = this.catalog.DEFAULT_DARK || defaultCatalog.DEFAULT_DARK;
    this.registries = { light: null, dark: null };
    this.grammars = { light: null, dark: null };
    // Keep the previously used registry per side so toggling between two
    // themes does not rebuild nine TextMate grammars every time.
    this.registryCache = { light: new Map(), dark: new Map() };
    this.registryCacheLimit = 1;
    this.themeIds = { light: null, dark: null };
    this.coloredBrackets = true;
    this.lastWarnings = [];
    this.cache = new Map();
    this.cacheSize = 0;
    this.onigLib = null;
    this.initialized = false;
  }

  async initialize(wasm, options = {}) {
    if (this.initialized) throw new Error('SyntaxEngine is already initialized');
    const bytes = wasm && wasm.buffer
      ? wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)
      : wasm;
    await onig.loadWASM(bytes);
    this.onigLib = Promise.resolve({
      createOnigScanner: (patterns) => new onig.OnigScanner(patterns),
      createOnigString: (value) => new onig.OnigString(value),
    });
    this.initialized = true;
    return this.setThemes(
      options.light === undefined ? this.defaultLight : options.light,
      options.dark === undefined ? this.defaultDark : options.dark,
      { coloredBrackets: options.coloredBrackets === undefined ? true : Boolean(options.coloredBrackets) },
    );
  }

  async buildSide(side, requestedId, warnings) {
    const build = async (id) => {
      const theme = this.catalog.getTheme(id);
      if (!theme) throw new Error(`Unknown ${side} theme: ${id}`);
      if (theme.appearance !== side) throw new Error(`Theme ${id} is not a ${side} theme`);
      const registry = new tm.Registry({
        theme: themeFor(theme),
        onigLib: this.onigLib,
        loadGrammar: async (scope) => {
          const asset = rawGrammars[scope];
          return asset ? tm.parseRawGrammar(asset.source, asset.filename) : null;
        },
        getInjections: (scope) => (scope === 'source.js' ? ['documentation.injection.js.jsx'] : []),
      });
      const grammars = {};
      try {
        for (const [language, scope] of Object.entries(scopes)) {
          const grammar = await registry.loadGrammar(scope);
          if (!grammar) throw new Error(`Grammar unavailable for ${scope}`);
          grammars[language] = grammar;
        }
      } catch (error) {
        registry.dispose();
        throw error;
      }
      return { id, registry, grammars };
    };

    try {
      return await build(requestedId);
    } catch (error) {
      const fallbackId = side === 'light' ? this.defaultLight : this.defaultDark;
      if (requestedId === fallbackId) throw error;
      warnings.push({ side, requested: requestedId, effective: fallbackId, message: errorMessage(error) });
      try {
        return await build(fallbackId);
      } catch (fallbackError) {
        throw new Error(`${side} theme ${requestedId} failed (${errorMessage(error)}) and fallback ${fallbackId} failed (${errorMessage(fallbackError)})`);
      }
    }
  }

  async setThemes(lightId, darkId, options = {}) {
    if (!this.initialized) throw new Error('SyntaxEngine is not initialized');
    const resolved = this.catalog.resolveSelection(lightId, darkId);
    const sides = ['light', 'dark'].filter((side) => !this.registries[side] || this.themeIds[side] !== resolved[side]);
    const warnings = [];
    const built = {};
    try {
      for (const side of sides) {
        const cached = this.registryCache[side].get(resolved[side]);
        if (cached) {
          built[side] = { ...cached, fromCache: true };
        } else {
          built[side] = { ...(await this.buildSide(side, resolved[side], warnings)), fromCache: false };
        }
      }
    } catch (error) {
      for (const item of Object.values(built)) if (!item.fromCache) item.registry.dispose();
      throw error;
    }
    for (const side of sides) {
      const previous = this.registries[side];
      const previousGrammars = this.grammars[side];
      const previousId = this.themeIds[side];
      if (built[side].fromCache) this.registryCache[side].delete(built[side].id);
      this.registries[side] = built[side].registry;
      this.grammars[side] = built[side].grammars;
      this.themeIds[side] = built[side].id;
      if (previous) this.cacheRegistry(side, previousId, previous, previousGrammars);
    }
    if (options.coloredBrackets !== undefined) this.coloredBrackets = Boolean(options.coloredBrackets);
    this.lastWarnings = warnings;
    this.clearCache();
    return { light: this.themeIds.light, dark: this.themeIds.dark, warnings };
  }

  cacheRegistry(side, id, registry, grammars) {
    if (!id) {
      registry.dispose();
      return;
    }
    const cache = this.registryCache[side];
    if (cache.has(id)) {
      registry.dispose();
      return;
    }
    cache.set(id, { id, registry, grammars });
    while (cache.size > this.registryCacheLimit) {
      const oldestId = cache.keys().next().value;
      const oldest = cache.get(oldestId);
      cache.delete(oldestId);
      oldest.registry.dispose();
    }
  }

  clearCache() {
    this.cache.clear();
    this.cacheSize = 0;
  }

  highlight(language, text) {
    language = canonical(language);
    if (!language || typeof text !== 'string' || text.length > 200000) return null;
    if (!this.registries.light || !this.registries.dark) return null;
    const key = language + '\0' + text;
    if (this.cache.has(key)) {
      const result = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, result);
      return result;
    }
    const lines = text.split('\n');
    const colors = {};
    for (const appearance of ['light', 'dark']) {
      const grammar = this.grammars[appearance][language];
      if (!grammar) return null;
      const theme = this.catalog.getTheme(this.themeIds[appearance]);
      const fallback = theme ? theme.foreground : null;
      const colorMap = this.registries[appearance].getColorMap();
      let state = tm.INITIAL;
      colors[appearance] = lines.map((line) => {
        const tokenized = grammar.tokenizeLine2(line, state, 500);
        if (tokenized.stoppedEarly) return null;
        state = tokenized.ruleStack;
        const result = [];
        for (let i = 0; i < tokenized.tokens.length; i += 2) {
          const from = tokenized.tokens[i];
          const to = Math.min(line.length, tokenized.tokens[i + 2] ?? line.length);
          if (to > from) {
            result.push({ from, to, color: colorMap[(tokenized.tokens[i + 1] >>> 15) & 511] || fallback });
          }
        }
        return result;
      });
      if (colors[appearance].some((row) => row === null)) return null;
    }

    // Pair brackets only in source code, never in comments, strings or regexes.
    // Use TextMate scopes rather than a second hand-written language lexer.
    let bracketPositions;
    if (this.coloredBrackets) {
      let state = tm.INITIAL;
      const stack = [];
      const opening = '([{';
      const closing = ')]}';
      const grammar = this.grammars.light[language];
      bracketPositions = lines.map((line, index) => {
        const row = [];
        const parsed = grammar.tokenizeLine(line, state, 500);
        state = parsed.ruleStack;
        if (parsed.stoppedEarly) return row;
        for (const token of parsed.tokens) {
          if (token.scopes.some((scope) => /^(comment|string)(\.|$)/.test(scope))) continue;
          for (let pos = token.startIndex; pos < Math.min(token.endIndex, line.length); pos++) {
            const char = line[pos];
            const open = opening.indexOf(char);
            const close = closing.indexOf(char);
            if (open >= 0) {
              row.push({ from: pos, depth: stack.length });
              stack.push({ char, depth: stack.length });
            } else if (close >= 0 && stack.length && stack[stack.length - 1].char === opening[close]) {
              row.push({ from: pos, depth: stack.pop().depth });
            }
          }
        }
        return row;
      });
    } else {
      bracketPositions = lines.map(() => []);
    }

    const result = lines.map((line, index) => {
      const light = colors.light[index];
      const dark = colors.dark[index];
      const pairs = bracketPositions[index];
      const pairByFrom = new Map(pairs.map((pair) => [pair.from, pair]));
      const cuts = [...new Set([
        0,
        line.length,
        ...light.flatMap((token) => [token.from, token.to]),
        ...dark.flatMap((token) => [token.from, token.to]),
        ...pairs.flatMap((token) => [token.from, token.from + 1]),
      ])].sort((a, b) => a - b);
      let li = 0;
      let di = 0;
      const segments = [];
      for (let i = 0; i < cuts.length - 1; i++) {
        const from = cuts[i];
        const to = cuts[i + 1];
        if (to <= from) continue;
        while (light[li] && light[li].to <= from) li++;
        while (dark[di] && dark[di].to <= from) di++;
        const pair = pairByFrom.get(from) && to === from + 1 ? pairByFrom.get(from) : null;
        segments.push({
          from,
          to,
          light: pair ? brackets.light[pair.depth % 3] : light[li]?.color,
          dark: pair ? brackets.dark[pair.depth % 3] : dark[di]?.color,
        });
      }
      return segments;
    });
    this.cache.set(key, result);
    this.cacheSize += key.length;
    while (this.cache.size > 96 || this.cacheSize > 2000000) {
      const oldest = this.cache.keys().next().value;
      this.cacheSize -= oldest.length;
      this.cache.delete(oldest);
    }
    return result;
  }

  getState() {
    return {
      initialized: this.initialized,
      light: this.themeIds.light,
      dark: this.themeIds.dark,
      coloredBrackets: this.coloredBrackets,
      cacheEntries: this.cache.size,
      cacheSize: this.cacheSize,
      registryCache: {
        light: [...this.registryCache.light.keys()],
        dark: [...this.registryCache.dark.keys()],
      },
      warnings: this.lastWarnings,
    };
  }

  dispose() {
    for (const registry of Object.values(this.registries)) if (registry) registry.dispose();
    this.registries = { light: null, dark: null };
    this.grammars = { light: null, dark: null };
    // Keep the previously used registry per side so toggling between two
    // themes does not rebuild nine TextMate grammars every time.
    this.registryCache = { light: new Map(), dark: new Map() };
    this.registryCacheLimit = 1;
    this.themeIds = { light: null, dark: null };
    this.clearCache();
    this.initialized = false;
  }
}

module.exports = { SyntaxEngine, canonical, themeFor, brackets };
