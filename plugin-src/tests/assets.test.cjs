/*
 * SPDX-License-Identifier: Apache-2.0
 */
const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const tm=require('vscode-textmate');
const onig=require('vscode-oniguruma');
const rawGrammars=require('../assets/grammars.json');

// Mirrors plugin-src/engine.cjs: one root scope per supported language, plus
// the grammars those statically include, plus the JS documentation injection.
// Anything else in the bundle is never requested at runtime, so it only
// inflates main.js. (Empirically verified with a loadGrammar probe that also
// tokenizes every language: the reachable set is exactly these scopes.)
const ROOT_SCOPES=['source.python','source.js','source.json','source.json.comments','source.shell','text.html.derivative','source.css','source.ts','source.tsx'];
const INJECTIONS={'source.js':['documentation.injection.js.jsx']};

function staticIncludes(scope){
  const asset=rawGrammars[scope];
  assert(asset,`engine scope ${scope} is missing from grammars.json`);
  const found=new Set();
  for(const match of asset.source.matchAll(/"include"\s*:\s*"([^"#]+)(?:#[^"]*)?"/g)){
    if(rawGrammars[match[1]])found.add(match[1]);
  }
  return found;
}

test('Bundled grammars are exactly the scopes the engine can reach',()=>{
  const reachable=new Set();
  const queue=[...ROOT_SCOPES];
  while(queue.length){
    const scope=queue.pop();
    if(reachable.has(scope))continue;
    reachable.add(scope);
    for(const next of staticIncludes(scope))queue.push(next);
    for(const injection of INJECTIONS[scope]||[])queue.push(injection);
  }
  assert.deepEqual(Object.keys(rawGrammars).sort(),[...reachable].sort());
});

// Runtime guard: a strict registry that refuses any grammar outside the
// bundle. If a kept grammar ever gains an include of a dropped scope (or the
// engine starts requesting a scope that is not shipped), loading the nine root
// grammars throws instead of silently losing highlighting.
let onigLib;
before(async()=>{
  await onig.loadWASM(fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')));
  onigLib=Promise.resolve({
    createOnigScanner:(patterns)=>new onig.OnigScanner(patterns),
    createOnigString:(value)=>new onig.OnigString(value),
  });
});

test('Loading every engine root grammar never requests an unbundled scope',async()=>{
  const requested=new Set();
  const registry=new tm.Registry({
    theme:{name:'probe',settings:[{settings:{foreground:'#000000'}}]},
    onigLib,
    loadGrammar:async(scope)=>{
      requested.add(scope);
      const asset=rawGrammars[scope];
      assert(asset,`runtime requested unbundled grammar scope: ${scope}`);
      return asset?tm.parseRawGrammar(asset.source,asset.filename):null;
    },
    getInjections:(scope)=>INJECTIONS[scope]||[],
  });
  try{
    for(const scope of ROOT_SCOPES){
      const grammar=await registry.loadGrammar(scope);
      assert(grammar,`grammar unavailable for ${scope}`);
    }
  }finally{
    registry.dispose();
  }
  assert.deepEqual([...requested].sort(),Object.keys(rawGrammars).sort());
});
