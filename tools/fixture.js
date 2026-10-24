/* Controlled harness: real bundled tokenizers, reconstructed CM6 line structure.
 * It does not claim to exercise real CM6 views or the installed Snippet loader. */
const examples = {
  python: '# comment\nclass Greeter:\n    def greet(self, name="World"):\n        count = 42\n        if count > 0:\n            print(f"Hello {name}")\n        return True',
  javascript: '// comment\nclass Greeter {\n  greet(name = "World") {\n    const count = 42;\n    console.log(`Hello ${name}`);\n    return count > 0 && true;\n  }\n}',
  json: '{\n  "name": "World",\n  "count": 42,\n  "enabled": true,\n  "empty": null\n}',
  bash: '#!/bin/bash\n# comment\nname="World"\nif [ "$name" != "" ]; then\n  echo "Hello $name"\n  printf "%s\\n" 42\nfi',
  html: '<!-- comment -->\n<!DOCTYPE html>\n<div class="card" id="main">\n  <a href="https://example.com">Hello</a>\n  <style>.card { color: red; }</style>\n</div>',
  css: '/* comment */\n.card, #main {\n  color: red;\n  padding: 12px;\n  content: "Hello";\n  --accent: #4078f2;\n}\n@media (width > 600px) { .card { display: flex; } }'
};
const mime = { python: 'text/x-python', javascript: 'text/javascript', json: 'application/json', bash: 'text/x-sh', html: 'text/html', css: 'text/css' };
// Regression sample from the user's VS Code / Obsidian comparison.
examples.python += '\n\n' + [
  'import logging',
  'import xml.etree.ElementTree as ET',
  'logger = logging.getLogger(__name__)',
  'result = connection.get_config(source="running", filter=("subtree", filter_xml))',
  'root = ET.fromstring(result.data_xml)',
  'interfaces = root.findall(".//if:interface", ns)',
  'for interface in interfaces:',
  '    name = interface.find("if:name", ns)',
  '    enabled = interface.find("if:enabled", ns)',
  '    if name is None or enabled is None:',
  '        logger.warning("接口数据缺少必要字段")',
  '        continue',
  '    if enabled.text == "false":',
  '        logger.warning("%s 接口已禁用", name.text)',
  '    elif enabled.text == "true":',
  '        logger.info("%s 接口已启用", name.text)',
].join('\n');
function editor(lang, source, live) {
  const wrap = document.createElement('div');
  wrap.className = 'markdown-source-view mod-cm6 cm-s-obsidian' + (live ? ' is-live-preview' : '');
  wrap.dataset.mode = live ? 'live-preview' : 'source';
  wrap.dataset.language = lang;
  const content = wrap.appendChild(document.createElement('div'));
  content.className = 'cm-content editor-fixture';
  const cm = CodeMirror.getMode({ indentUnit: 4 }, mime[lang]);
  const state = CodeMirror.startState(cm);
  const line = (text, kind) => {
    const el = content.appendChild(document.createElement('div'));
    el.className = 'cm-line HyperMD-codeblock' + (kind ? ' HyperMD-codeblock-' + kind : '');
    return el;
  };
  for (const [text, kind] of [['```' + lang, 'begin'], ['```', 'end']]) {
    if (kind === 'end') continue;
    const el = line(text, kind); el.innerHTML = '<span class="cm-hmd-codeblock cm-formatting-code-block"></span>'; el.firstChild.textContent = text;
  }
  for (const text of source.split('\n')) {
    const el = line(text);
    const stream = new CodeMirror.StringStream(text);
    if (!text && cm.blankLine) cm.blankLine(state);
    let stalled = 0;
    while (!stream.eol()) {
      stream.start = stream.pos;
      const style = cm.token(stream, state) || '';
      if (stream.pos <= stream.start) {
        if (++stalled > 10) throw Error('Tokenizer made no progress: ' + lang);
        continue; // Native CM modes can change state without consuming input.
      }
      stalled = 0;
      const span = el.appendChild(document.createElement('span'));
      span.className = 'cm-hmd-codeblock ' + style.split(' ').filter(Boolean).map(x => 'cm-' + x).join(' ');
      span.textContent = stream.current();
    }
  }
  const end = line('```', 'end'); end.innerHTML = '<span class="cm-hmd-codeblock cm-formatting-code-block">```</span>';
  return wrap;
}
for (const [lang, source] of Object.entries(examples)) {
  const title = document.querySelector('#samples').appendChild(document.createElement('h2')); title.textContent = lang;
  const row = document.querySelector('#samples').appendChild(document.createElement('article'));
  for (const live of [true, false]) {
    const section = row.appendChild(document.createElement('section'));
    const h = section.appendChild(document.createElement('h3')); h.textContent = live ? 'Live Preview fixture' : 'Source fixture';
    section.appendChild(editor(lang, source, live));
  }
  const section = row.appendChild(document.createElement('section')); section.className = 'markdown-rendered'; section.dataset.mode = 'reading'; section.dataset.language = lang;
  section.innerHTML = '<h3>Reading / Prism</h3><div class="el-pre"><pre><code></code></pre></div>';
  const code = section.querySelector('code'); code.className = 'language-' + lang;
  code.innerHTML = Prism.highlight(source, Prism.languages[lang], lang);
}
const nodes = [...document.querySelectorAll('main, main *')];
function snapshot() {
  return nodes.map(el => {
    const s = getComputedStyle(el);
    const result = {};
    for (const name of s) if (!name.startsWith('--')) result[name] = s.getPropertyValue(name);
    result.rect = JSON.stringify(el.getBoundingClientRect().toJSON());
    return result;
  });
}
function compare(before, after, allowColor) {
  const errors = [];
  after.forEach((props, i) => {
    for (const [key, value] of Object.entries(props)) {
      if (before[i][key] === value) continue;
      // Vendor text fill follows color automatically; its change is text color.
      if (allowColor && ['color', '-webkit-text-fill-color', '-webkit-text-stroke-color', 'text-emphasis-color', 'row-rule-color', 'caret-color', 'text-decoration-color', 'border-block-end-color', 'border-block-start-color', 'border-bottom-color', 'border-inline-end-color', 'border-inline-start-color', 'border-left-color', 'border-right-color', 'border-top-color', 'outline-color', 'column-rule-color'].includes(key)) {
        if (nodes[i].closest('#controls, #excluded') || nodes[i].closest('.HyperMD-codeblock-begin, .HyperMD-codeblock-end')) errors.push({ node: nodes[i].outerHTML.slice(0,180), key, before: before[i][key], after: value });
        continue;
      }
      errors.push({ node: nodes[i].outerHTML.slice(0,180), key, before: before[i][key], after: value });
    }
  });
  return errors;
}
async function run() {
  const css = await (await fetch('/snippet.css')).text();
  const results = { evidence: 'Real bundled tokenizers + reconstructed editor DOM; not real CM6 view integration', modes: [] };
  for (const mode of ['light', 'dark']) {
    document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add('theme-' + mode);
    const before = snapshot();
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    const after = snapshot();
    const records = [...document.querySelectorAll('[data-mode]')].map(container => ({
      mode: container.dataset.mode, language: container.dataset.language,
      tokens: [...container.querySelectorAll('.token, .cm-hmd-codeblock')].map(el => ({ text: el.textContent, classes: el.className, color: getComputedStyle(el).color }))
    }));
    const changes = after.reduce((n, p, i) => n + (p.color !== before[i].color ? 1 : 0), 0);
    style.remove();
    results.modes.push({ mode, changes, nonColorErrors: compare(before, after, true), restoreErrors: compare(before, snapshot(), false), records });
  }
  window.fixtureResults = results;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  document.body.classList.replace('theme-dark', 'theme-light');
  document.querySelector('#status').textContent = results.modes.every(x => !x.nonColorErrors.length && !x.restoreErrors.length) ? 'PASS: color-only scope and disable/restore in light + dark' : 'FAIL: inspect evidence';
  await fetch('/result', { method: 'POST', body: JSON.stringify(results, null, 2) });
}
run().catch(e => { document.querySelector('#status').textContent = e.stack; });
