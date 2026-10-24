/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

// Differential corpus for the fence scanner. Every document exercises the
// block-level structure that decides whether a ``` / ~~~ run is a fenced code
// block and whether an indented run is an indented code block: containers
// (blockquotes, list items), HTML blocks, tabs, front matter, Obsidian %%
// comments, unclosed fences and realistic notes. The scanner in fences.cjs
// must reproduce the markdown-it tokenization for all of these.

const cases = [];
function add(name, text) {
  cases.push({ name, text });
}

add('plain fence', '```js\nconst a = 1;\n```\n');
add('tilde fence', '~~~python\nx = True\n~~~\n');
add('fence longer closing', '````js\nconst a = 1;\n`````\n````\n');
add('closing fence too short stays open', '```js\nconst a = 1;\n``\nstill code\n```\n');
add('info string with attributes', '```js {1-3, 5} title="x"\nconst a = 1;\n```\n');
add('backtick info forbidden', '``` a`b\ncode\n```\n');
add('tilde info may contain backticks', '~~~ a`b\ncode\n~~~\n');
add('indented fence 1-3 spaces', '   ```js\n   const a = 1;\n   ```\n');
add('4-space indent is code not fence', '    ```js\n    const a = 1;\n    ```\n');
add('unclosed fence to EOF', '```js\nconst a = 1;\nconst b = 2;\n');
add('empty fence', '```\n```\n');
add('fence interrupts paragraph', 'text\n```js\nconst a = 1;\n```\n');
add('fence cannot interrupt with 4 spaces', 'text\n    ```js\n    const a = 1;\n    ```\n');
add('two fences back to back', '```js\na\n```\n```py\nb\n```\n');
add('fence inside blockquote', '> ```js\n> const a = 1;\n> ```\n');
add('fence inside blockquote lazy', '> ```js\nconst a = 1;\n> ```\n');
add('blockquote no space', '>```js\n>const a = 1;\n>```\n');
add('nested blockquote fence', '> > ```js\n> > const a = 1;\n> > ```\n');
add('fence in list item', '- item\n\n  ```js\n  const a = 1;\n  ```\n');
add('fence in list item no blank', '- ```js\n  const a = 1;\n  ```\n');
add('ordered list fence', '1. item\n\n   ```js\n   const a = 1;\n   ```\n');
add('ordered list wide marker fence', '10. item\n\n    ```js\n    const a = 1;\n    ```\n');
add('nested list fence', '- outer\n  - inner\n\n    ```js\n    const a = 1;\n    ```\n');
add('list fence unclosed', '- item\n\n  ```js\n  const a = 1;\n');
add('indented code after blank', 'para\n\n    code line 1\n    code line 2\n');
add('indented code cannot interrupt paragraph', 'para\n    code line\n');
add('indented code in list', '- item\n\n      code in list\n');
add('indented code with blank inside', '    code 1\n\n    code 2\n');
add('indented code ends at fence', '    code\n```js\nfence\n```\n');
add('fence then indented code', '```js\nfence\n```\n\n    indented\n');
add('html block with fence inside', '<div>\n```js\nnot a fence\n```\n</div>\n');
add('html comment with fence inside', '<!--\n```js\nnot a fence\n```\n-->\n');
add('script block with fence', '<script>\n```js\nnot a fence\n```\n</script>\n');
add('html block type 7 fence', '<p>\n```js\nfence after html\n```\n');
add('setext heading then fence', 'Title\n=====\n```js\ncode\n```\n');
add('thematic break then fence', '***\n```js\ncode\n```\n');
add('front matter with fence', '---\ntitle: x\n---\n```js\ncode\n```\n');
add('front matter tilde end', '---\ntitle: x\n...\n```js\ncode\n```\n');
add('front matter unclosed', '---\ntitle: x\n```js\ncode\n```\n');
add('obsidian comment hides fence', '%%\n```js\nhidden\n```\n%%\n```js\nshown\n```\n');
add('percent signs inside code', '```js\nvalue = "%%"\n```\n');
add('percent pair on one line', 'text %% ```js\nhidden\n``` %% more\n```js\nshown\n```\n');
add('escaped percent', '```js\nvalue = "\\%%"\n```\n');
add('table then fence', '| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\ncode\n```\n');
add('reference definition then fence', '[ref]: https://example.com\n\n```js\ncode\n```\n');
add('fence with tabs in indent', '\t```js\n\tconst a = 1;\n\t```\n');
add('fence content with blank lines', '```js\nline 1\n\nline 3\n```\n');
add('fence content with trailing spaces', '```js\nline 1   \n```   \n');
add('crlf line endings', '```js\r\nconst a = 1;\r\n```\r\n');
add('bom then fence', '\uFEFF```js\nconst a = 1;\n```\n');
add('nested fences different chars', '````markdown\n```js\ninner\n```\n````\n');
add('tilde inside backtick fence', '```\n~~~\nstill outer\n```\n');
add('backtick inside tilde fence', '~~~\n```\nstill outer\n~~~\n');
add('fence info only spaces', '```   \ncode\n```\n');
add('unknown language fence', '```brainfuck\n++++++++++.\n```\n');
add('empty document', '');
add('only front matter', '---\na: 1\n---\n');
add('fence at eof no newline', '```js\ncode');
add('blockquote fence then paragraph', '> ```js\n> code\n> ```\n> paragraph\n');
add('list fence then next item', '- ```js\n  code\n  ```\n- second\n');
add('deeply nested list fence', '- a\n  - b\n    - c\n\n      ```js\n      code\n      ```\n');
add('blockquote indented fence', '>    ```js\n>    code\n>    ```\n');
add('paragraph with dashes then fence', 'paragraph\n---\n```js\ncode\n```\n');
add('multiple front matter dashes', '---\na: 1\n---\ntext\n---\nb: 2\n---\n```js\ncode\n```\n');
add('realistic note', [
  '---',
  'title: Demo',
  'tags: [a, b]',
  '---',
  '',
  '# Heading',
  '',
  'Some prose with `inline code` and a [link](https://example.com).',
  '',
  '## Code',
  '',
  '```python',
  'def f(x):',
  '    return x + 1',
  '```',
  '',
  '> Quote with code:',
  '>',
  '> ```js',
  '> const a = 1;',
  '> ```',
  '',
  '- list item',
  '',
  '  ~~~bash',
  '  echo hi',
  '  ~~~',
  '',
  '%%',
  '```python',
  '# hidden',
  '```',
  '%%',
  '',
  'Final paragraph.',
  '',
].join('\n'));
add('line-number matrix fixture', [
  '---',
  'title: AOF v0.4.0 line number matrix',
  'example: |',
  '  ```python',
  '  hidden = True',
  '  ```',
  '---',
  '',
  '# AOF v0.4.0 line number matrix',
  '',
  'Paragraph before with inline code `const x = 1;` that must never be numbered.',
  '',
  '## Five lines with a blank line',
  '',
  '```python',
  'alpha = 1',
  'beta = 2',
  '',
  'delta = 4',
  'epsilon = 5',
  '```',
  '',
  '## Consecutive blocks restart at 1',
  '',
  '```',
  'unlabeled one',
  'unlabeled two',
  'unlabeled three',
  '```',
  '',
].join('\n'));

// markdown-it semantics probes: these pin down container/lazy-continuation
// behaviour that the custom scanner must reproduce exactly.
add('lazy fence interrupts blockquote paragraph', '> paragraph\n```js\ncode\n```\n');
add('lazy paragraph inside blockquote', '> paragraph\nlazy line\n\n```js\ncode\n```\n');
add('fence interrupts list item paragraph', '- item\n  ```js\n  code\n  ```\n');
add('fence after paragraph in list item', '- item\n\n  text\n  ```js\n  code\n  ```\n');
add('list inside blockquote with fence', '> - ```js\n>   code\n>   ```\n');
add('fence after wide list marker', '-   item\n\n    ```js\n    code\n    ```\n');
add('paren ordered list fence', '1) item\n\n   ```js\n   code\n   ```\n');
add('indented code after list paragraph', '- code\n\n      indented continuation\n');
add('tab indent fence in list', '- item\n\t```js\n\tcode\n\t```\n');
add('blockquote indented code', '>     code\n');
add('gt inside fence content is literal', '```js\n> not a quote\n```\n');
add('list marker then fence with 4 space content', '-    ```js\n     code\n     ```\n');
add('empty list item then fence', '-\n\n  ```js\n  code\n  ```\n');
add('nested blockquote list fence', '> - item\n>\n>   ```js\n>   code\n>   ```\n');
add('setext dashes inside fence content', '```js\n---\n```\n');
add('tilde fence closed by backticks', '~~~js\n```\n~~~\n');
add('paragraph list fence interleaved', 'text\n- item\n\n```js\ncode\n```\n');
add('hr star between fences', '```js\na\n```\n\n***\n\n```js\nb\n```\n');
add('fence in deeply nested blockquote', '> > > ```js\n> > > code\n> > > ```\n');
add('blank lines inside blockquote fence', '> ```js\n>\n> code\n> ```\n');
add('list continuation blank then fence', '- item\n\n\n  ```js\n  code\n  ```\n');
add('under-indented fence content in list', '- ```js\ncode\n```\n');
add('indented code trailing blanks', '    a\n\n\n');
add('indented code blank between', '    a\n\n    b\n');
add('blockquote fence lazy then more quotes', '> ```js\n> code\nlazy\n> ```\n');
add('fence in list unindented middle line', '- item\n\n  ```js\n  code\nunindented\n  ```\n');
add('paragraph then indented code block', 'text\n\n    code\n\n    more\n');
add('fence in list after loose item text', '- first\n- second\n\n  ```js\n  code\n  ```\n');
add('blockquote fence closing too short', '> ```js\n> code\n> ``\n> ```\n');
add('tab after list marker content', '-\t```js\n\tcode\n\t```\n');
add('space tab mixed indent fence', '  \t```js\n\tcode\n\t```\n');
add('blank line closes blockquote fence', '> ```js\n\n> code\n> ```\n');
add('indented code ends at fence', '    code\n```js\nfence\n```\n');
add('reference interrupts paragraph', 'text\n[ref]: https://example.com\n    code\n');
add('reference then fence no blank', '[ref]: https://example.com\n```js\ncode\n```\n');
add('heading interrupts paragraph then code', 'text\n# heading\n    code\n');
add('table rows then indented code', '| a | b |\n| - | - |\n| 1 | 2 |\n    code\n');
add('setext underline then fence', 'paragraph\n===\n```js\ncode\n```\n');

// Regression corpus for the rules found by tools/fence-fuzz-test.cjs:
// reference definitions gate list interruption, setext headings decide
// whether following indented lines are code blocks, and a final line that is
// entirely whitespace is invisible to markdown-it's line scanner.
add('reference gates ordered list interrupt', '[ref]: https://example.com\n10) ```js\n   ```js\n    text\n> ```\n\tcode\n   ```js\n<div>\n```js');
add('reference multiline title then list', '[ref]:\n/url\n"title"\n2) item\n\n   ```js\n   code\n   ```\n');
add('reference title on next line', "[a]: /url\n'title'\n```js\ncode\n```\n");
add('reference angle destination', '[a]: <https://example.com/a b>\n```js\ncode\n```\n');
add('reference paren destination', '[a]: /u(1)\n```js\ncode\n```\n');
add('reference javascript rejected', '[a]: javascript:alert(1)\n```js\ncode\n```\n');
add('reference unclosed title is not reference', "[a]: /url 'unclosed\n```js\ncode\n```\n");
add('reference empty label rejected', '[ ]: /url\n```js\ncode\n```\n');
add('reference inside paragraph stays paragraph', 'text\n[ref]: /url\nmore text\n');
add('setext dashes then indented code', 'Setext\n---\n    code\n');
add('setext equals then tab code', 'Setext\n===\n\tcode\n');
add('setext then list then fence', 'Setext\n===\n[a]: javascript:alert(1)\n-\n    ```js\n');
add('setext underline with trailing spaces', 'Setext\n===   \n    code\n');
add('setext dash is hr when alone', '---\n    code\n');
add('trailing whitespace line after fence', '```js\ncode\n```\n   ');
add('trailing tab line after fence', '```js\ncode\n```\n\t');
add('trailing whitespace line after indented code', '    code\n   ');
add('trailing whitespace only document', '   ');
add('trailing whitespace line in list', '- item\n\n  ```js\n  code\n  ```\n  ');
add('whitespace line then fence at eof', 'text\n\n```js\ncode\n   ');

module.exports = { cases };
