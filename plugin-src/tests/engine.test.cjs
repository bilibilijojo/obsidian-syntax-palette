const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {SyntaxEngine}=require('../engine.cjs');
const {fencedBlocks,allFencedBlocks,codeBlockTokens}=require('../fences.cjs');
const themeCatalog=require('../themes.cjs');
const {buildHighlightCss}=require('../highlight-style.cjs');
let engine;
before(async()=>{engine=new SyntaxEngine();await engine.initialize(fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')));});
after(()=>engine.dispose());
function colorAt(language,text,needle,appearance='light',offset=0) {
  const position=text.indexOf(needle);assert(position>=0,needle);
  const row=text.slice(0,position+offset).split('\n');
  const column=row[row.length-1].length;
  const segment=engine.highlight(language,text)[row.length-1].find(s=>s.from<=column && s.to>column);
  assert(segment,needle);return segment[appearance].toUpperCase();
}
test('Python screenshot: constants, magic variables, parameters, exceptions and placeholders',()=>{
  const source=[
    'import logging',
    'logger = logging.getLogger(__name__)',
    'connection = manager.connect(**device, hostkey_verify = True)',
    'if connection is None:',
    '    raise RuntimeError("missing")',
    'result = connection.get_config(source="running", filter=("subtree", filter_xml))',
    'logger.warning("%s 接口已禁用", name.text)',
    'print(connection)',
  ].join('\n');
  for(const needle of ['True','None','hostkey_verify','source=','filter=','%s']) assert.equal(colorAt('python',source,needle),'#986801',needle);
  assert.equal(colorAt('python',source,'__name__'),'#E45649');
  for(const needle of ['RuntimeError','print']) assert.equal(colorAt('python',source,needle),'#0184BC');
  for(const needle of ['getLogger','get_config','warning','text)']) assert.equal(colorAt('python',source,needle),'#383A42');
  assert.equal(colorAt('python',source,'running'),'#50A14F');
  assert.equal(colorAt('python',source,'True','dark'),'#D19A66');
  assert.equal(colorAt('python',source,'__name__','dark'),'#E06C75');
});
test('Bracket pairs use VS Code defaults, excluding strings and comments',()=>{
  const source='f((1), "(text)") # []';
  assert.equal(colorAt('python',source,'f(', 'light',1),'#0431FA');
  assert.equal(colorAt('python',source,'(1)'),'#319331');
  assert.equal(colorAt('python',source,'(text)'),'#50A14F');
  assert.equal(colorAt('python',source,'[]'),'#A0A1A7');
});
test('Six required language grammars load, including embedded HTML style/script',()=>{
  const cases={python:'x = "hello"',javascript:'const x = "hello";',json:'{"name":"hello"}',
    bash:'name="hello"',html:'<div title="hello"><style>.x { color:red; }</style></div>',css:'.x { content: "hello"; }'};
  for(const [language,source]of Object.entries(cases)){
    const rows=engine.highlight(language,source);assert(rows[0].length,language);
    assert.equal(colorAt(language,source,'hello'),'#50A14F',language);
    for(const row of rows)for(const segment of row)for(const mode of ['light','dark'])assert.match(segment[mode],/^#[0-9a-f]{6}$/i);
  }
});
test('Token segmentation preserves every Unicode character and whitespace',()=>{
  const source='变量 = "中文😀"\n\tprint(变量)\n\n';
  const rows=engine.highlight('python',source);
  const reconstructed=rows.map((row,i)=>row.map(t=>source.split('\n')[i].slice(t.from,t.to)).join('')).join('\n');
  assert.equal(reconstructed,source);
});
test('Fence extraction excludes inline, indented, unknown-language and frontmatter code',()=>{
  const text='---\nexample: |\n  ```python\n  no = True\n  ```\n---\n`inline`\n\n    indented\n\n```unknown\nuntouched\n```\n\n```python\nx = True\n```\n';
  const blocks=fencedBlocks(text);assert.equal(blocks.length,1);assert.equal(blocks[0].text,'x = True');
  assert.equal(text.split('\n')[blocks[0].positions[0].line],'x = True');
});
test('Nested quotes/list fences and tilde fences map to the original text positions',()=>{
  const text='> ```python\n> x = True\n> ```\n\n- item\n\n  ~~~js\n  const x = 1;\n  ~~~\n';
  const blocks=fencedBlocks(text);assert.equal(blocks.length,2);
  for(const block of blocks)block.text.split('\n').forEach((line,i)=>{
    const pos=block.positions[i];assert.equal(text.split('\n')[pos.line].slice(pos.column),line);
  });
});
test('Runtime highlight CSS only changes color inside scoped code highlights',()=>{
  const css=buildHighlightCss(new Map([
    ['aof-reading-123456-abcdef',{light:'#123456',dark:'#ABCDEF'}],
    ['aof-reading-12345678-abcdef12',{light:'#12345678',dark:'#ABCDEF12'}],
  ]));
  const declarations=[...css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)];
  assert(declarations.length>0);
  for(const declaration of declarations)assert.equal(declaration[1],'color');
  assert.doesNotMatch(css,/!important/i);
  assert.doesNotMatch(css,/background|font-|border|padding|margin|box-shadow|border-radius|line-height|letter-spacing/i);
  for(const match of css.matchAll(/([^{}]+)\{/g)){
    const selector=match[1].trim();
    assert.match(selector,/\.theme-(light|dark) /);
    assert.match(selector,/::highlight\(aof-reading-[0-9a-f-]+\)/);
    assert.match(selector,/pre > code|\.cm-line\.HyperMD-codeblock/);
  }
});

// WebKit regression 0.4.3: WebKit paints the highlight colour over the whole text
// content of every element the selector matches, not just the registered range.
// With a bare `*::highlight()` the editor line number took the colour of the
// first token (a lone ")" turned number 13 blue). The widget must never be in
// the match set of a highlight selector.
test('Custom highlight selectors never match the editor line-number widget',()=>{
  const css=buildHighlightCss(new Map([['aof-reading-123456-abcdef',{light:'#123456',dark:'#ABCDEF'}]]));
  assert.doesNotMatch(css,/\*::highlight/);
  const selectors=[...css.matchAll(/([^{}]+)\{/g)].flatMap((match)=>match[1].split(',').map((value)=>value.trim()));
  // Two hosts (reading <code>, editor .cm-line) x two forms x two appearances.
  assert.equal(selectors.length,8);
  const descendant=selectors.filter((selector)=>/ :not\(\.aof-ln\)::highlight/.test(selector));
  assert.equal(descendant.length,4);
  for(const selector of descendant){
    assert.match(selector,/\.aof-ln/);
    assert.match(selector,/pre > code|\.cm-line\.HyperMD-codeblock/);
  }
  // Every highlight selector names the code host, so it can never reach prose.
  for(const selector of selectors)assert.match(selector,/pre > code|\.cm-line\.HyperMD-codeblock/);
});

test('Static stylesheet stays inside plugin settings and never targets note code',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../styles.css'),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
  assert.doesNotMatch(css,/::highlight/i);
  assert.doesNotMatch(css,/pre\s*>\s*code/i);
  assert.doesNotMatch(css,/\.HyperMD-codeblock/);
  for(const declaration of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)){
    assert.doesNotMatch(declaration[1],/^(background|box-shadow)/);
  }
  for(const match of css.matchAll(/([^{}]+)\{/g)){
    for(const selector of match[1].split(',').map(value=>value.trim()).filter(Boolean))assert.match(selector,/^\.aof-/);
  }
});

test('Obsidian comments exclude fences but percent signs inside code stay literal',()=>{
 const text='%%\n```python\ncommented = True\n```\n%%\n\n```python\nvalue = "%%"\n```\n';
 const blocks=fencedBlocks(text);assert.equal(blocks.length,1);assert.equal(blocks[0].text,'value = "%%"');
});

test('Background fence discovery includes unlabeled and unsupported fences',()=>{
 const text='```\nplain\n```\n\n```unknown\nmystery\n```\n\n```python\nknown = True\n```\n\n    indented\n';
 const all=allFencedBlocks(text);
 assert.deepEqual(all.map(block=>[block.start,block.language,block.text]),[
   [0,null,'plain'],[4,null,'mystery'],[8,'python','known = True'],
 ]);
 assert.deepEqual(fencedBlocks(text).map(block=>block.language),['python']);
 const tokens=codeBlockTokens(text);
 assert.deepEqual(tokens.map(token=>[token.type,token.fenced,token.text]),[
   ['fence',true,'plain'],['fence',true,'mystery'],['fence',true,'known = True'],['code_block',false,'indented'],
 ]);
});

test('Fenced block discovery keeps list/quote positions and excludes commented fences',()=>{
 const text='- item\n\n  ```js\n  const x = 1;\n  ```\n\n> ```python\n> y = 2\n> ```\n\n%%\n```python\nno = True\n```\n%%\n';
 const all=allFencedBlocks(text);
 assert.deepEqual(all.map(block=>block.language),['javascript','python']);
 assert.equal(all[0].positions[0].column,2);
 assert.equal(all[1].positions[0].column,2);
 assert.deepEqual(codeBlockTokens(text).map(token=>token.language),['javascript','python']);
});


// Representative official foregrounds for "# hash comment", "def", the string
// "hello" and the number 42 in the Python fixture. Values are taken from the
// checked-in official theme snapshots, not from this plugin's generated asset.
const expectedThemeColors = {
  'atom-one-light': {comment:'#A0A1A7',keyword:'#A626A4',string:'#50A14F',number:'#986801'},
  'atom-one-dark': {comment:'#5C6370',keyword:'#C678DD',string:'#98C379',number:'#D19A66'},
  'github-light-default': {comment:'#6E7781',keyword:'#CF222E',string:'#0A3069',number:'#0550AE'},
  'github-dark-default': {comment:'#8B949E',keyword:'#FF7B72',string:'#A5D6FF',number:'#79C0FF'},
  'github-dark-dimmed': {comment:'#768390',keyword:'#F47067',string:'#96D0FF',number:'#6CB6FF'},
  'ayu-light': {comment:'#ADAEB1',keyword:'#FA8532',string:'#86B300',number:'#A37ACC'},
  'ayu-dark': {comment:'#5A6673',keyword:'#FF8F40',string:'#AAD94C',number:'#D2A6FF'},
  'ayu-mirage': {comment:'#6E7C8F',keyword:'#FFA659',string:'#D5FF80',number:'#DFBFFF'},
  'vscode-light-plus': {comment:'#008000',keyword:'#0000FF',string:'#A31515',number:'#098658'},
  'vscode-dark-plus': {comment:'#6A9955',keyword:'#569CD6',string:'#CE9178',number:'#B5CEA8'},
  'vscode-light-modern': {comment:'#008000',keyword:'#0000FF',string:'#A31515',number:'#098658'},
  'vscode-dark-modern': {comment:'#6A9955',keyword:'#569CD6',string:'#CE9178',number:'#B5CEA8'},
  'catppuccin-latte': {comment:'#7C7F93',keyword:'#8839EF',string:'#40A02B',number:'#FE640B'},
  'catppuccin-frappe': {comment:'#949CBB',keyword:'#CA9EE6',string:'#A6D189',number:'#EF9F76'},
  'catppuccin-macchiato': {comment:'#939AB7',keyword:'#C6A0F6',string:'#A6DA95',number:'#F5A97F'},
  'catppuccin-mocha': {comment:'#9399B2',keyword:'#CBA6F7',string:'#A6E3A1',number:'#FAB387'},
  'dracula-official': {comment:'#6272A4',keyword:'#FF79C6',string:'#F1FA8C',number:'#BD93F9'},
  'tokyo-night-light': {comment:'#888B94',keyword:'#65359D',string:'#385F0D',number:'#965027'},
  'tokyo-night-night': {comment:'#51597D',keyword:'#BB9AF7',string:'#9ECE6A',number:'#FF9E64'},
  'tokyo-night-storm': {comment:'#5F6996',keyword:'#BB9AF7',string:'#9ECE6A',number:'#FF9E64'},
  'one-dark-pro': {comment:'#7F848E',keyword:'#C678DD',string:'#98C379',number:'#D19A66'},
  'one-dark-pro-darker': {comment:'#7F848E',keyword:'#C678DD',string:'#98C379',number:'#D19A66'},
  'one-dark-pro-flat': {comment:'#7F848E',keyword:'#C678DD',string:'#98C379',number:'#D19A66'},
  'night-owl-light': {comment:'#989FB1',keyword:'#994CC3',string:'#C96765',number:'#AA0982'},
  'night-owl-night': {comment:'#637777',keyword:'#C792EA',string:'#ECC48D',number:'#F78C6C'},
  'nord': {comment:'#616E88',keyword:'#81A1C1',string:'#A3BE8C',number:'#B48EAD'},
  'solarized-light': {comment:'#586E75',keyword:'#93A1A1',string:'#2AA198',number:'#D33682'},
  'solarized-dark': {comment:'#586E75',keyword:'#859900',string:'#2AA198',number:'#2AA198'},
  'kanagawa-lotus': {comment:'#716E61',keyword:'#624C83',string:'#6F894E',number:'#B35B79'},
  'kanagawa-wave': {comment:'#727169',keyword:'#957FB8',string:'#98BB6C',number:'#D27E99'},
  'kanagawa-dragon': {comment:'#737C73',keyword:'#8992A7',string:'#8A9A7B',number:'#A292A3'},
  'material-default': {comment:'#546E7A',keyword:'#C792EA',string:'#C3E88D',number:'#F78C6C'},
  'material-darker': {comment:'#545454',keyword:'#C792EA',string:'#C3E88D',number:'#F78C6C'},
  'material-palenight': {comment:'#676E95',keyword:'#C792EA',string:'#C3E88D',number:'#F78C6C'},
  'material-ocean': {comment:'#464B5D',keyword:'#C792EA',string:'#C3E88D',number:'#F78C6C'},
  'material-lighter': {comment:'#90A4AE',keyword:'#9C3EDA',string:'#91B859',number:'#F76D47'},
  'monokai': {comment:'#88846F',keyword:'#66D9EF',string:'#E6DB74',number:'#AE81FF'},
  'min-light': {comment:'#C2C3C5',keyword:'#D32F2F',string:'#22863A',number:'#1976D2'},
  'min-dark': {comment:'#6B737C',keyword:'#F97583',string:'#FFAB70',number:'#F8F8F8'},
};
const themeSample='# hash comment\ndef greet(name):\n    return "hello" + 42\n';
function segmentAt(rows,text,needle,offset=0){
  const position=text.indexOf(needle);assert(position>=0,needle);
  const before=text.slice(0,position+offset).split('\n');
  const line=before.length-1,column=before[line].length;
  return rows[line].find(segment=>segment.from<=column&&segment.to>column);
}
test('All 39 theme variants load with their official foreground colors',async()=>{
  assert.equal(themeCatalog.THEME_LIST.length,39);
  for(const theme of themeCatalog.THEME_LIST){
    const light=theme.appearance==='light'?theme.id:'atom-one-light';
    const dark=theme.appearance==='dark'?theme.id:'atom-one-dark';
    const applied=await engine.setThemes(light,dark,{coloredBrackets:false});
    assert.equal(applied.light,light,theme.id);
    assert.equal(applied.dark,dark,theme.id);
    const rows=engine.highlight('python',themeSample);
    assert(rows,theme.id);
    for(const row of rows)for(const segment of row){
      for(const mode of ['light','dark'])assert.match(segment[mode],/^#[0-9A-F]{6}(?:[0-9A-F]{2})?$/,theme.id+' '+mode);
    }
    const expected=expectedThemeColors[theme.id];
    assert(expected,theme.id);
    const checks=[['# hash comment','comment'],['def','keyword'],['hello','string'],['42','number']];
    for(const [needle,key]of checks){
      const segment=segmentAt(rows,themeSample,needle);
      assert(segment,theme.id+' '+needle);
      assert.equal(segment[theme.appearance],expected[key],theme.id+' '+key);
    }
  }
  await engine.setThemes('atom-one-light','atom-one-dark',{coloredBrackets:true});
});
test('Light and dark selections are independent within one highlight result',async()=>{
  await engine.setThemes('github-light-default','catppuccin-mocha',{coloredBrackets:false});
  const rows=engine.highlight('python',themeSample);
  assert.equal(segmentAt(rows,themeSample,'# hash comment').light,'#6E7781');
  assert.equal(segmentAt(rows,themeSample,'# hash comment').dark,'#9399B2');
  assert.equal(segmentAt(rows,themeSample,'hello').light,'#0A3069');
  assert.equal(segmentAt(rows,themeSample,'hello').dark,'#A6E3A1');
  assert.equal(segmentAt(rows,themeSample,'42').light,'#0550AE');
  assert.equal(segmentAt(rows,themeSample,'42').dark,'#FAB387');
});
test('Colored brackets can be disabled without affecting token colors',async()=>{
  const source='f((1), "(text)") # []';
  await engine.setThemes('atom-one-light','atom-one-dark',{coloredBrackets:true});
  assert.equal(colorAt('python',source,'f(', 'light',1),'#0431FA');
  const withBrackets=segmentAt(engine.highlight('python',source),source,'f(',1);
  await engine.setThemes('atom-one-light','atom-one-dark',{coloredBrackets:false});
  const withoutBrackets=segmentAt(engine.highlight('python',source),source,'f(',1);
  assert.notEqual(withoutBrackets.light,'#0431FA');
  assert.equal(withoutBrackets.light,'#383A42');
  await engine.setThemes('atom-one-light','atom-one-dark',{coloredBrackets:true});
  assert.equal(withBrackets.light,'#0431FA');
});
test('Changing themes invalidates cached highlight results',async()=>{
  await engine.setThemes('atom-one-light','atom-one-dark',{coloredBrackets:false});
  const before=segmentAt(engine.highlight('python',themeSample),themeSample,'hello');
  assert.equal(before.light,'#50A14F');
  await engine.setThemes('github-light-default','catppuccin-mocha',{coloredBrackets:false});
  const after=segmentAt(engine.highlight('python',themeSample),themeSample,'hello');
  assert.equal(after.light,'#0A3069');
  assert.equal(after.dark,'#A6E3A1');
  assert.notEqual(before.light,after.light);
});
test('A broken theme falls back to Atom One and still highlights safely',async()=>{
  const broken={
    ...themeCatalog,
    getTheme(id){
      if(id==='github-light-default')return {id,family:'broken',appearance:'light',name:'Broken',foreground:'not-a-color',tokenColors:[]};
      return themeCatalog.getTheme(id);
    },
  };
  const local=new SyntaxEngine({catalog:broken});
  await local.initialize(fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')),{
    light:'github-light-default',dark:'atom-one-dark',coloredBrackets:false,
  });
  const state=local.getState();
  assert.equal(state.light,'atom-one-light');
  assert.equal(state.dark,'atom-one-dark');
  assert.equal(state.warnings.length,1);
  assert.equal(state.warnings[0].requested,'github-light-default');
  assert.equal(state.warnings[0].effective,'atom-one-light');
  const rows=local.highlight('python',themeSample);
  assert(rows);
  assert.equal(segmentAt(rows,themeSample,'hello').light,'#50A14F');
  local.dispose();
});
test('Oversized and unknown inputs return null without throwing',async()=>{
  assert.equal(engine.highlight('unknown','x=1'),null);
  assert.equal(engine.highlight('python','x'.repeat(200001)),null);
  assert.equal(engine.highlight('python','x=1'),engine.highlight('python','x=1'));
});

test('Theme registry cache reuses the previous side when toggling back',async()=>{
  await engine.setThemes('atom-one-light','atom-one-dark',{coloredBrackets:false});
  const originalLight=engine.registries.light;
  await engine.setThemes('github-light-default','atom-one-dark',{coloredBrackets:false});
  assert.equal(engine.registryCache.light.has('atom-one-light'),true);
  assert.notEqual(engine.registries.light,originalLight);
  await engine.setThemes('atom-one-light','atom-one-dark',{coloredBrackets:false});
  assert.equal(engine.registries.light,originalLight);
  assert.equal(engine.registryCache.light.has('github-light-default'),true);
  await engine.setThemes('atom-one-light','atom-one-dark',{coloredBrackets:true});
});
