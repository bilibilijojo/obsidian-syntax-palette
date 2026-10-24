/*
 * SPDX-License-Identifier: Apache-2.0
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const extensions = '/Applications/Visual Studio Code.app/Contents/Resources/app/extensions';
const names = ['python', 'javascript', 'typescript-basics', 'json', 'shellscript', 'html', 'css'];
// Only the grammars the engine can actually reach are bundled. The engine
// (plugin-src/engine.cjs) loads one root scope per supported language plus
// whatever those grammars statically include, plus the JS documentation
// injection. Everything else an extension happens to contribute (for example
// source.js.jsx, source.js.regexp, source.regexp.python and the 288 KiB
// source.json.comments.snippets grammar) is never requested at runtime and
// would only inflate main.js. Keep this list in sync with engine.cjs; the
// plugin-src/tests/assets.test.cjs reachability check fails if it drifts.
const bundledScopes = [
  'source.python', 'source.js', 'source.ts', 'source.tsx',
  'documentation.injection.js.jsx',
  'source.json', 'source.json.comments',
  'source.shell', 'text.html.basic', 'text.html.derivative', 'source.css',
];
const bundled = new Set(bundledScopes);
const grammars = {}, provenance = [];
for (const name of names) {
  const folder = path.join(extensions, name);
  const pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
  for (const item of pkg.contributes.grammars || []) {
    if (!bundled.has(item.scopeName)) continue;
    const filename = path.join(folder, item.path);
    const source = fs.readFileSync(filename, 'utf8');
    grammars[item.scopeName] = { source, filename: path.basename(filename) };
    provenance.push({ scope: item.scopeName, path: path.relative(path.dirname(extensions), filename), version: pkg.version,
      repository: pkg.repository, sha256: crypto.createHash('sha256').update(source).digest('hex') });
  }
}
for (const scope of bundledScopes) {
  if (!grammars[scope]) throw new Error(`Bundled grammar scope ${scope} not found in the local VS Code installation`);
}
fs.mkdirSync(path.join(root, 'plugin-src/assets'), { recursive: true });
fs.writeFileSync(path.join(root, 'plugin-src/assets/grammars.json'), JSON.stringify(grammars));
fs.writeFileSync(path.join(root, 'sources/plugin-grammar-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log('Prepared', provenance.length, 'VS Code grammar definitions.');
