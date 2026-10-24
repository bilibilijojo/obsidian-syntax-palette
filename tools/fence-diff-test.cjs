/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

// Differential test for the fence scanner in plugin-src/fences.cjs.
//
//   node tools/fence-diff-test.cjs capture-ref # record golden output from markdown-it
//   node tools/fence-diff-test.cjs check       # compare scanner against golden
//
// The golden file is produced from the markdown-it based implementation the
// scanner replaced (rebuilt below on the shared pipeline helpers), so `check`
// proves the two implementations agree on the whole corpus. `capture` (from
// the scanner itself) exists only for local debugging and must not be used to
// refresh the golden.

const fs = require('node:fs');
const path = require('node:path');
const MarkdownIt = require('markdown-it');
const { cases } = require('../plugin-src/tests/fixtures/fence-corpus.cjs');
const { fencedBlocks, allFencedBlocks, codeBlockTokens, sourceLines, filterCommentedFences } = require('../plugin-src/fences.cjs');
const { canonical } = require('../plugin-src/engine.cjs');

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });

// The markdown-it implementation the scanner replaced: the same front-matter
// blanking and %% comment filter (shared helpers) wrapped around markdown-it's
// own block parser.
function referenceParse(text) {
  const { lines, parsedLines } = sourceLines(text);
  const tokens = markdown.parse(parsedLines.join('\n'), {});
  const fences = filterCommentedFences(tokens.filter((t) => t.type === 'fence'), parsedLines);
  return { lines, tokens, fences };
}

const referenceImpl = {
  fencedBlocks: (text) => referenceImpl.allFencedBlocks(text).filter((block) => block.language),
  allFencedBlocks: (text) => {
    const { lines, fences } = referenceParse(text);
    return fences.map((token) => {
      const content = token.content.endsWith('\n') ? token.content.slice(0, -1) : token.content;
      const codeLines = content.split('\n');
      const positions = [];
      for (let i = 0; i < codeLines.length; i++) {
        const index = token.map[0] + 1 + i;
        const raw = lines[index];
        if (raw === undefined || !raw.endsWith(codeLines[i])) return null;
        positions.push({ line: index, column: raw.length - codeLines[i].length });
      }
      return {
        language: canonical(token.info.trim().split(/\s+/)[0]),
        text: content,
        start: token.map[0],
        end: token.map[1],
        positions,
      };
    }).filter(Boolean);
  },
  codeBlockTokens: (text) => {
    const { tokens, fences } = referenceParse(text);
    const allowed = new Set(fences.map((t) => t.map[0]));
    return tokens
      .filter((t) => (t.type === 'fence' ? allowed.has(t.map[0]) : t.type === 'code_block'))
      .map((token) => ({
        type: token.type,
        fenced: token.type === 'fence',
        language: token.type === 'fence' ? canonical(token.info.trim().split(/\s+/)[0]) : null,
        text: token.content.endsWith('\n') ? token.content.slice(0, -1) : token.content,
        start: token.map[0],
        end: token.map[1],
      }));
  },
};

const goldenPath = path.join(__dirname, '..', 'plugin-src', 'tests', 'fixtures', 'fence-golden.json');
const mode = process.argv[2] || 'check';

function runCase(item, impl) {
  const record = (fn) => {
    try {
      return { ok: true, value: fn() };
    } catch (error) {
      return { ok: false, error: String(error && error.message) };
    }
  };
  return {
    name: item.name,
    fencedBlocks: record(() => impl.fencedBlocks(item.text)),
    allFencedBlocks: record(() => impl.allFencedBlocks(item.text)),
    codeBlockTokens: record(() => impl.codeBlockTokens(item.text)),
  };
}

const scannerImpl = { fencedBlocks, allFencedBlocks, codeBlockTokens };

if (mode === 'capture-ref') {
  const golden = cases.map((item) => runCase(item, referenceImpl));
  fs.writeFileSync(goldenPath, JSON.stringify(golden, null, 2) + '\n');
  console.log(`Captured golden output for ${golden.length} corpus cases from markdown-it -> ${path.relative(process.cwd(), goldenPath)}`);
  process.exit(0);
}

if (mode === 'capture') {
  // debugging aid only: records the scanner's own output
  const golden = cases.map((item) => runCase(item, scannerImpl));
  fs.writeFileSync(goldenPath, JSON.stringify(golden, null, 2) + '\n');
  console.log(`Captured scanner output for ${golden.length} corpus cases (NOT the markdown-it reference) -> ${path.relative(process.cwd(), goldenPath)}`);
  process.exit(0);
}

const actual = cases.map((item) => runCase(item, scannerImpl));

if (!fs.existsSync(goldenPath)) {
  console.error('No golden file. Run: node tools/fence-diff-test.cjs capture-ref');
  process.exit(1);
}
const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
if (golden.length !== actual.length) {
  console.error(`Corpus size changed: golden ${golden.length} vs current ${actual.length}. Re-capture with capture-ref.`);
  process.exit(1);
}

let failures = 0;
for (let i = 0; i < actual.length; i++) {
  for (const fn of ['fencedBlocks', 'allFencedBlocks', 'codeBlockTokens']) {
    const expected = JSON.stringify(golden[i][fn]);
    const got = JSON.stringify(actual[i][fn]);
    if (expected !== got) {
      failures++;
      console.error(`\nDIFF [${actual[i].name}] ${fn}`);
      console.error('  golden: ' + expected);
      console.error('  actual: ' + got);
    }
  }
}
if (failures) {
  console.error(`\n${failures} difference(s) across ${actual.length} cases.`);
  process.exit(1);
}
console.log(`Fence scanner matches golden output on all ${actual.length} corpus cases.`);
