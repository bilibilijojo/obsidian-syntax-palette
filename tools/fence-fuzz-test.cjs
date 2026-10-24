'use strict';

// Randomized differential fuzzer for the fence scanner.
//
//   node tools/fence-fuzz-test.cjs [iterations] [seed]
//
// Generates random Markdown documents from a grammar of interesting line
// shapes (fences, quotes, lists, indents, tabs, blanks, front matter, %%
// comments, tables, headings, HTML-ish lines) and asserts that the custom
// scanner in plugin-src/fences.cjs produces exactly the same fencedBlocks /
// allFencedBlocks / codeBlockTokens output as the markdown-it implementation
// the scanner replaced. markdown-it is a dev-only reference here; it is not
// part of the shipped bundle.

const MarkdownIt = require('markdown-it');
const { codeBlockTokens, sourceLines, filterCommentedFences } = require('../plugin-src/fences.cjs');
const { canonical } = require('../plugin-src/engine.cjs');

const iterations = Number(process.argv[2] || 2000);
let seed = Number(process.argv[3] || 0x5f3759df);
function random() {
  // xorshift32 for reproducible runs
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return ((seed >>> 0) % 1000000) / 1000000;
}
function pick(items) {
  return items[Math.floor(random() * items.length)];
}
function chance(p) {
  return random() < p;
}

const LINE_SHAPES = [
  () => '```' + pick(['', 'js', 'python', 'js {1,3}', 'a`b', '  ']),
  () => '~~~' + pick(['', 'bash', 'ts', ' ']),
  () => '````' + pick(['', 'md']),
  () => '``',
  () => '> ' + pick(['```js', 'text', '> ```', '```', '~~~bash', '- item', '    code', '']),
  () => '>' + pick(['```js', ' text', '']),
  () => '>',
  () => '- ' + pick(['item', '```js', '', '~~~py', '    code', '> quote']),
  () => '-',
  () => '1. ' + pick(['item', '```js', '']),
  () => '10) ' + pick(['item', '```js']),
  () => '  ' + pick(['```js', 'code', '~~~', '- item', '> quote', '```']),
  () => '   ' + pick(['```js', 'code']),
  () => '    ' + pick(['code', '```js', '```', 'text']),
  () => '\t' + pick(['code', '```js', '```']),
  () => '  \t' + pick(['code', '```js']),
  () => '-\t' + pick(['```js', 'code']),
  () => pick(['text line', 'another paragraph', 'variable = 1', 'x', 'lazy continuation']),
  () => pick(['', '', '', '   ', '\t']),
  () => '# ' + pick(['Heading', 'h2']),
  () => pick(['***', '---', '___']),
  () => '| ' + pick(['a | b', '- | -', '1 | 2', ':-:|:-:']) + ' |',
  () => '<div>' + pick(['', ' class="x"']),
  () => '</div>',
  () => '<!-- comment -->',
  () => '%%',
  () => 'value = "%%"',
  () => 'const x = 1; // comment',
  () => pick(['[ref]: https://example.com', '[a]:', '[a]: /url', "[a]: /url 'title'", '[a]: <url> (title)', '[a]: /url (title)', '[a\\]]: /url', '[a]: javascript:alert(1)', '[a]: /url "unclosed', '[ ]: /url', '[a]: /u(1)']),
  () => '===' ,
  () => 'Setext',
];

function randomDocument() {
  const lines = [];
  const count = 1 + Math.floor(random() * 14);
  if (chance(0.15)) {
    lines.push('---', pick(['title: x', 'a: 1']), pick(['---', '...']));
  }
  for (let i = 0; i < count; i++) lines.push(pick(LINE_SHAPES)());
  if (chance(0.2)) lines.push('');
  return lines.join('\n');
}

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });

// Replicates the plugin pipeline (front matter blanking + %% comment filter)
// around markdown-it, so only the block-rule port is under test. The pipeline
// helpers themselves are shared with fences.cjs.
function referenceOutput(text) {
  const { parsedLines } = sourceLines(text);
  const raw = markdown.parse(parsedLines.join('\n'), {});
  const allowedFences = new Set(filterCommentedFences(raw.filter((t) => t.type === 'fence'), parsedLines).map((t) => t.map[0]));
  return raw
    .filter((t) => (t.type === 'fence' ? allowedFences.has(t.map[0]) : t.type === 'code_block'))
    .map((t) => ({
      type: t.type,
      fenced: t.type === 'fence',
      language: t.type === 'fence' ? canonical(t.info.trim().split(/\s+/)[0]) : null,
      text: t.content.endsWith('\n') ? t.content.slice(0, -1) : t.content,
      start: t.map[0],
      end: t.map[1],
    }));
}

function actualOutput(text) {
  return codeBlockTokens(text).map((t) => ({
    type: t.type, fenced: t.fenced, language: t.language, text: t.text, start: t.start, end: t.end,
  }));
}

let failures = 0;
for (let i = 0; i < iterations; i++) {
  const text = randomDocument();
  let expected;
  let actual;
  try {
    expected = referenceOutput(text);
  } catch (error) {
    console.error(`markdown-it threw on iteration ${i}: ${error.message}\n---\n${JSON.stringify(text)}\n---`);
    failures++;
    continue;
  }
  try {
    actual = actualOutput(text);
  } catch (error) {
    console.error(`scanner threw on iteration ${i}: ${error.message}\n---\n${JSON.stringify(text)}\n---`);
    failures++;
    continue;
  }
  const a = JSON.stringify(expected);
  const b = JSON.stringify(actual);
  if (a !== b) {
    failures++;
    console.error(`\nDIVERGENCE iteration ${i}:\n${JSON.stringify(text)}\n  markdown-it: ${a}\n  scanner:     ${b}`);
    if (failures >= 10) break;
  }
}

if (failures) {
  console.error(`\n${failures} divergence(s) in ${iterations} random documents (seed ${seed}).`);
  process.exit(1);
}
console.log(`Fence scanner matches markdown-it on ${iterations} random documents.`);
