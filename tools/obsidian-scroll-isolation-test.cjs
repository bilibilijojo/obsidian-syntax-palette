#!/usr/bin/env node
'use strict';
// Requires the disposable /tmp/aof-v040-test Obsidian at CDP 9333.
// Real Chromium input events plus text geometry/visible character checks.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { connectMain, wait } = require('./obsidian-v0.4.0-test.cjs');
let OUT = path.resolve(process.env.AOF_EVIDENCE || 'evidence/v0.5.1');
fs.mkdirSync(OUT, { recursive: true });
const results = { environment: 'macOS Obsidian desktop, isolated vault; CDP wheel/key/IME input', cases: [], pass: false };
async function setup(source, numbers, background) {
  const note = ['正文位置固定 BODY ANCHOR', '', String.fromCharCode(96).repeat(3)+'javascript', 'const first = "' + Array.from({length:100},(_,i)=>`A${String(i).padStart(3,'0')}_`).join('') + '";', 'shortFirst();', String.fromCharCode(96).repeat(3), '', '中间正文 MIDDLE ANCHOR', '', String.fromCharCode(96).repeat(3)+'javascript', 'const second = "' + Array.from({length:110},(_,i)=>`B${String(i).padStart(3,'0')}_`).join('') + '";', 'shortSecond();', String.fromCharCode(96).repeat(3), '', '末尾正文 END ANCHOR'].join('\n');
  return `(async()=>{
    const plugin=app.plugins.plugins['syntax-palette'];
    await plugin.updateSettings({wrapCodeBlocks:true,lineNumbers:${numbers},codeBlockBackground:${background}});
    let file=app.vault.getAbstractFileByPath('AOF v0.5.1 Isolation.md');
    if(!file)file=await app.vault.create('AOF v0.5.1 Isolation.md',${JSON.stringify(note)});else await app.vault.modify(file,${JSON.stringify(note)});
    const leaf=app.workspace.getLeaf(false);await leaf.openFile(file);await app.workspace.revealLeaf(leaf);
    window.__isoView=leaf.view;await __isoView.setState({...__isoView.getState(),mode:'source',source:${source}},{});
    await new Promise(r=>setTimeout(r,700));window.__isoCM=__isoView.editor.cm;
    __isoCM.dispatch({selection:{anchor:0}});
    await plugin.updateSettings({wrapCodeBlocks:false});await new Promise(r=>setTimeout(r,350));
    __isoCM.scrollDOM.scrollTop=0;__isoCM.scrollDOM.scrollLeft=0;
    window.__isoOriginal=__isoCM.state.doc.toString();return {state:__isoView.getState(),ua:navigator.userAgent};
  })()`;
}
const SNAP = `(()=>{
 const cm=__isoCM;const lines=[...cm.contentDOM.querySelectorAll('.cm-line')];
 const line=(prefix)=>lines.find(l=>l.textContent.startsWith(prefix));
 const snap=(l)=>{if(!l)return null;const b=l.getBoundingClientRect();let r=document.createRange();r.selectNodeContents(l);const rect=r.getBoundingClientRect();
 let visible='';const w=document.createTreeWalker(l,NodeFilter.SHOW_TEXT);let n;
 outer:while(n=w.nextNode()){for(let i=0;i<n.length;i++){r.setStart(n,i);r.setEnd(n,i+1);const c=r.getBoundingClientRect();if(c.left>=b.left+2&&c.right<=b.right-2){visible=n.textContent.slice(i,i+24);break outer}}}
 return {left:b.left,right:b.right,top:b.top,height:b.height,textLeft:rect.left,visible,scrollLeft:l.scrollLeft,scrollWidth:l.scrollWidth,clientWidth:l.clientWidth,number:l.dataset.aofN||null,background:getComputedStyle(l).backgroundColor,pseudo:getComputedStyle(l,'::before').content};};
 return {body:snap(line('正文')),middle:snap(line('中间')),first:snap(line('const first')),shortFirst:snap(line('shortFirst')),second:snap(line('const second')),shortSecond:snap(line('shortSecond')),scroller:{left:cm.scrollDOM.scrollLeft,width:cm.scrollDOM.clientWidth,scrollWidth:cm.scrollDOM.scrollWidth},numbers:lines.filter(l=>l.dataset.aofN).map(l=>l.dataset.aofN),docUnchanged:cm.state.doc.toString()===__isoOriginal};
})()`;
function stable(a,b,name){assert.ok(Math.abs(a.left-b.left)<1,`${name} box moved`);assert.ok(Math.abs(a.textLeft-b.textLeft)<1,`${name} text moved`);assert.equal(a.visible,b.visible,`${name} visible content changed`)}
async function wheel(page, target, delta) {
 const snap=await page.eval(SNAP);const box=snap[target];
 await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:(box.left+box.right)/2,y:box.top+8,deltaX:delta,deltaY:0});await wait(250);
 return page.eval(SNAP);
}
async function key(page,key,code,vk,commands,modifiers=0){await page.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key,code,windowsVirtualKeyCode:vk,modifiers,...(commands?{commands}: {})});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk,modifiers});await wait(150)}
async function runScrollIsolation(page, output = OUT) {
 const previousOutput = OUT;
 OUT = output; fs.mkdirSync(OUT, {recursive:true});
 results.cases=[]; results.pass=false;
 try {
 await page.send('Page.bringToFront');await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
 for(const source of [false,true])for(const numbers of [false,true])for(const background of [false,true]){
   const environment=await page.eval(await setup(source,numbers,background));const before=await page.eval(SNAP);
   assert.ok(before.first&&before.second&&before.body,'fixture not rendered');
   if(source&&numbers&&background)await page.screenshot(path.join(OUT,'isolation-01-before.png'));
   const first=await wheel(page,'first',260);
   if(source&&numbers&&background)await page.screenshot(path.join(OUT,'isolation-02-first-only.png'));
   assert.ok(first.first.textLeft<before.first.textLeft-200,'first code text did not move');
   assert.notEqual(first.first.visible,before.first.visible,'first visible content unchanged');
   stable(before.body,first.body,'body');stable(before.middle,first.middle,'middle');stable(before.second,first.second,'second');
   assert.ok(Math.abs(first.shortFirst.scrollLeft-first.first.scrollLeft)<1,'short row not synchronized');
   const second=await wheel(page,'second',330);
   stable(first.first,second.first,'first after second wheel');stable(first.body,second.body,'body after second wheel');
   assert.ok(second.second.textLeft<first.second.textLeft-250,'second code text did not move');assert.notEqual(second.second.visible,first.second.visible);
   assert.ok(Math.abs(second.shortSecond.scrollLeft-second.second.scrollLeft)<1,'second short row not synchronized');
   assert.equal(second.scroller.left,0);assert.ok(second.scroller.scrollWidth<=second.scroller.width+1,'editor overflow');
   assert.deepEqual(second.numbers,numbers?['1','2','1','2']:[]);
   assert.equal(second.first.background,before.first.background,'first background changed during scroll');
   assert.equal(second.second.background,before.second.background,'second background changed during scroll');
   if(numbers){assert.equal(second.first.pseudo,'"1"');assert.equal(second.second.pseudo,'"1"')}
   if(source&&numbers&&background)await page.screenshot(path.join(OUT,'isolation-03-both-independent.png'));
   assert.ok(second.docUnchanged,'scroll changed Markdown');
   await page.screenshot(path.join(OUT,`isolation-${source?'source':'live'}-ln${+numbers}-bg${+background}.png`));
   const end=await wheel(page,'first',100000);
   const tail=await page.eval(`(()=>{const cm=__isoCM,c=cm.coordsAtPos(cm.state.doc.line(4).to);return {left:c.left,right:c.right}})()`);
   assert.ok(tail.left>=end.first.left&&tail.right<=end.first.right+1,'end of code is not reachable through local scrolling');
   stable(second.second,end.second,'second while first reaches end');stable(second.body,end.body,'body while first reaches end');

   await page.eval(`app.plugins.plugins['syntax-palette'].updateSettings({wrapCodeBlocks:true})`);await wait(500);
   const wrapped=await page.eval(SNAP);assert.ok(wrapped.first.height>before.first.height*2,'wrap did not render');assert.equal(wrapped.first.scrollLeft,0);assert.deepEqual(wrapped.numbers,second.numbers);stable(before.body,wrapped.body,'body after wrap');
   await page.eval(`app.plugins.plugins['syntax-palette'].updateSettings({wrapCodeBlocks:false})`);await wait(500);
   const reset=await page.eval(SNAP);assert.ok(reset.first.height<wrapped.first.height/2);
   const again=await wheel(page,'first',180);assert.ok(again.first.textLeft<reset.first.textLeft-140);stable(reset.second,again.second,'second after wrap toggle');
   results.cases.push({source,numbers,background,environment,before,first,second,end,tail,wrapped,again,pass:true});
 }
 // Edit while scrolled: end-of-long-line caret must be visible, click maps to
 // actual document position, CDP input enters the real editor undo history.
 results.editing=[];
 for(const source of [false,true]){
 await page.eval(await setup(source,true,true));await wheel(page,'first',260);
 // Click a visible character after horizontal scrolling. The hit-test must
 // resolve to the original document offset, not the unscrolled column.
 const hit=await page.eval(`(()=>{const cm=__isoCM,pos=cm.state.doc.line(4).from+65,c=cm.coordsAtPos(pos);return {pos,x:c.left,y:(c.top+c.bottom)/2}})()`);
 await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:hit.x,y:hit.y});
 await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:hit.x,y:hit.y});await wait(150);
 assert.ok(await page.eval(`Math.abs(__isoCM.state.selection.main.head-${hit.pos})<=1`),'click mapped to wrong column');
 await wheel(page,'first',-10000);
 const drag=await page.eval(`(()=>{const cm=__isoCM,a=cm.state.doc.line(4).from+10,b=cm.state.doc.line(5).from+5;const x=cm.coordsAtPos(a),y=cm.coordsAtPos(b);return {a,b,x1:x.left,y1:(x.top+x.bottom)/2,x2:y.left,y2:(y.top+y.bottom)/2}})()`);
 await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,x:drag.x1,y:drag.y1});
 await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:drag.x2,y:drag.y2});
 await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:drag.x2,y:drag.y2});await wait(200);
 assert.ok(await page.eval(`Math.abs(__isoCM.state.selection.main.from-${drag.a})<=1&&Math.abs(__isoCM.state.selection.main.to-${drag.b})<=1`),'multi-line pointer selection mapped incorrectly');
 await page.eval(`(()=>{const cm=__isoCM;const l=cm.state.doc.line(4);cm.dispatch({selection:{anchor:l.to}});cm.focus()})()`);await wait(350);
 const caret=await page.eval(`(()=>{const cm=__isoCM;const c=cm.coordsAtPos(cm.state.selection.main.head);const l=[...cm.contentDOM.querySelectorAll('.cm-line')].find(l=>l.textContent.startsWith('const first'));const b=l.getBoundingClientRect();return {caret:{left:c.left,right:c.right,top:c.top,bottom:c.bottom},box:{left:b.left,right:b.right},scrollLeft:l.scrollLeft,editorLeft:cm.scrollDOM.scrollLeft}})()`);
 assert.ok(caret.caret.left>=caret.box.left&&caret.caret.right<=caret.box.right,'end caret is clipped');assert.equal(caret.editorLeft,0);
 await page.send('Input.insertText',{text:' // EDIT安全'});await wait(200);
 assert.ok(await page.eval(`__isoCM.state.doc.line(4).text.endsWith(' // EDIT安全')`));
 await key(page,'z','KeyZ',90,['undo'],4);assert.ok(await page.eval(`__isoCM.state.doc.toString()===__isoOriginal`),'undo failed');
 await key(page,'z','KeyZ',90,['redo'],12);assert.ok(await page.eval(`__isoCM.state.doc.line(4).text.endsWith(' // EDIT安全')`),'redo failed');
 await key(page,'z','KeyZ',90,['undo'],4);
 // IME protocol composition exercises Electron/CM composition handlers; it
 // is explicitly not a physical Chinese input method / phone keyboard test.
 await page.send('Input.imeSetComposition',{text:'中文',selectionStart:2,selectionEnd:2});await wait(100);
 await page.send('Input.insertText',{text:'中文'});await wait(200);
 assert.ok(await page.eval(`__isoCM.state.doc.line(4).text.includes('中文')`),'IME commit failed');
 await key(page,'z','KeyZ',90,['undo'],4);assert.ok(await page.eval(`__isoCM.state.doc.toString()===__isoOriginal`),'IME undo failed');
 const selected=await page.eval(`(()=>{const cm=__isoCM;const from=cm.state.doc.line(4).from,to=cm.state.doc.line(5).to;cm.dispatch({selection:{anchor:from,head:to}});cm.focus();return cm.state.sliceDoc(from,to)})()`);
 await page.send('Browser.grantPermissions',{origin:'app://obsidian.md',permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
 await key(page,'c','KeyC',67,['copy'],4);const copied=await page.eval('navigator.clipboard.readText()');assert.equal(copied,selected,'clipboard includes numbers/spacer or loses text');
 await key(page,'v','KeyV',86,['paste'],4);await wait(200);assert.ok(await page.eval(`__isoCM.state.doc.toString()===__isoOriginal`),'paste altered text');
 // Delete selected code, undo it, and verify document byte equality.
 await page.eval(`(()=>{const cm=__isoCM;cm.dispatch({selection:{anchor:cm.state.doc.line(4).from,head:cm.state.doc.line(5).to}});cm.focus()})()`);
 await key(page,'Backspace','Backspace',8);assert.ok(await page.eval(`__isoCM.state.doc.toString()!==__isoOriginal`));await key(page,'z','KeyZ',90,['undo'],4);assert.ok(await page.eval(`__isoCM.state.doc.toString()===__isoOriginal`));
 results.editing.push({source,caret,clickHitTest:true,pointerMultiLineSelection:true,copiedEqualsSelected:true,nativePaste:true,typingUndoRedo:true,protocolIME:true,deleteUndo:true,pass:true});
 }
 // Virtualization: long fence loses/recreates its DOM rows as the viewport
 // travels. Scroll offsets must survive remounting, with vertical wheel free.
 await page.eval(await setup(true,true,true));
 await page.eval(`(()=>{const cm=__isoCM;const line='const row = "'+ 'virtual_'.repeat(100)+'";';cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:['正文 VIRTUAL BODY','',String.fromCharCode(96).repeat(3)+'javascript',...Array.from({length:260},(_,i)=>line+' // '+i),String.fromCharCode(96).repeat(3),'','尾部正文'].join('\\n')},selection:{anchor:0}})})()`);await wait(500);
 const virtBefore=await page.eval(`(()=>{const cm=__isoCM;const row=cm.contentDOM.querySelector('.cm-line[data-aof-n="1"]');const b=row.getBoundingClientRect();return {x:b.left+100,y:b.top+8,first:row.textContent}})()`);
 await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:virtBefore.x,y:virtBefore.y,deltaX:270,deltaY:0});await wait(200);
 const offsetBefore=await page.eval(`__isoCM.contentDOM.querySelector('.cm-line[data-aof-n="1"]').scrollLeft`);assert.ok(offsetBefore>200);
 await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:virtBefore.x,y:virtBefore.y,deltaX:0,deltaY:1400});await wait(350);
 const away=await page.eval(`({top:__isoCM.scrollDOM.scrollTop,firstMounted:!!__isoCM.contentDOM.querySelector('.cm-line[data-aof-n="1"]'),offsets:[...__isoCM.contentDOM.querySelectorAll('.cm-line[data-aof-n]')].map(l=>l.scrollLeft)})`);
 assert.ok(away.top>500,'vertical wheel trapped by code row');assert.equal(away.firstMounted,false,'fixture did not exercise virtualization');
 assert.ok(away.offsets.length>0&&away.offsets.every(x=>Math.abs(x-offsetBefore)<1),'newly mounted rows lost block offset');
 await page.eval('__isoCM.scrollDOM.scrollTop=0');await wait(400);
 const restored=await page.eval(`__isoCM.contentDOM.querySelector('.cm-line[data-aof-n="1"]').scrollLeft`);assert.ok(Math.abs(restored-offsetBefore)<1,'remounted first row lost offset');
 results.virtualization={offsetBefore,away,restored,pass:true};
 results.controllerCost=await page.eval(`(async()=>{
   const cm=__isoCM;const controller=cm.plugins.map(p=>p.value?.fenceScroll).find(Boolean);
   if(!controller)throw new Error('scroll controller not found for profiling');
   const originals={},samples={measure:[],apply:[],move:[]};
   for(const name of Object.keys(samples)){originals[name]=controller[name];controller[name]=function(...args){const t=performance.now();try{return originals[name].apply(this,args)}finally{samples[name].push(performance.now()-t)}}}
   try{
     await new Promise(resolve=>{let frame=0;const tick=()=>{cm.scrollDOM.scrollTop+=35;const row=cm.contentDOM.querySelector('.cm-line[data-aof-n]');if(row)row.scrollLeft+=7;if(++frame<40)requestAnimationFrame(tick);else resolve()};requestAnimationFrame(tick)});
     await new Promise(r=>setTimeout(r,300));const settled=samples.measure.length;await new Promise(r=>setTimeout(r,300));
     return {frames:40,idleMeasures:samples.measure.length-settled,methods:Object.fromEntries(Object.entries(samples).map(([name,values])=>{values.sort((a,b)=>a-b);return [name,{calls:values.length,totalMs:+values.reduce((a,b)=>a+b,0).toFixed(3),p95Ms:+(values[Math.floor(values.length*.95)]||0).toFixed(3),maxMs:+(values.at(-1)||0).toFixed(3)}]}))};
   }finally{for(const [name,fn]of Object.entries(originals))controller[name]=fn}
 })()`);
 assert.equal(results.controllerCost.idleMeasures,0,'scroll controller keeps measuring at idle');
 assert.ok(results.controllerCost.methods.measure.calls<=120,'scroll controller measurement storm');
 // A stall guard for this fixed desktop fixture, not a general FPS benchmark.
 assert.ok(results.controllerCost.methods.move.maxMs<50,'one synchronized scroll blocked the desktop for >=50ms');

 results.narrowViewport=[];
 for(const [width,height] of [[390,844],[844,390]]){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await wait(250);
   await page.eval(await setup(true,true,true));const before=await page.eval(SNAP);const after=await wheel(page,'first',150);
   assert.ok(after.first.textLeft<before.first.textLeft-100,'narrow/rotated layout did not scroll code');stable(before.body,after.body,'narrow body');stable(before.second,after.second,'narrow second block');
   assert.ok(after.scroller.scrollWidth<=after.scroller.width+1,'narrow editor overflows');
   results.narrowViewport.push({width,height,before,after,desktopViewport:true,pass:true});
 }
 await page.send('Emulation.clearDeviceMetricsOverride');await wait(300);
 await page.eval(await setup(true,true,true));
 await page.eval(`app.plugins.disablePlugin('syntax-palette')`);await wait(500);
 results.disabled=await page.eval(`({rows:document.querySelectorAll('.aof-nowrap,[data-aof-scroll]').length,styles:document.querySelectorAll('[style*="--aof-scroll-extent"]').length,wrapStyle:document.getElementById('syntax-palette-wrap')?.textContent||'',blockWidths:__isoCM.contentDOM.style.cssText.includes('--aof-block-width'),docUnchanged:__isoCM.state.doc.toString()===__isoOriginal,scrollWidth:__isoCM.scrollDOM.scrollWidth,width:__isoCM.scrollDOM.clientWidth})`);
 assert.equal(results.disabled.rows,0);assert.equal(results.disabled.styles,0);assert.equal(results.disabled.blockWidths,false);assert.equal(results.disabled.wrapStyle,'');assert.ok(results.disabled.docUnchanged);
 await page.eval(`app.plugins.enablePlugin('syntax-palette')`);
 results.pass=true;console.log('PASS: 8 real Obsidian mode/number/background combinations + CDP editing, clipboard, undo/redo, composition, disable');
 return results;
 } catch(e) {results.error=e.stack;throw e;} finally{fs.writeFileSync(path.join(OUT,'scroll-isolation-results.json'),JSON.stringify(results,null,2)+'\n'); OUT=previousOutput;}
}
module.exports={runScrollIsolation};
if(require.main===module)(async()=>{const page=await connectMain();try{await runScrollIsolation(page)}finally{page.close()}})().catch(e=>{console.error(e);process.exitCode=1});
