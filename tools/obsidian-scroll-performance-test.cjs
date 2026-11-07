/* SPDX-License-Identifier: Apache-2.0 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {wait}=require('./obsidian-v0.4.0-test.cjs');
async function runScrollPerformance(page,out){
 const result={environment:'macOS Obsidian CPU/render metrics; GPU disabled by harness; not iPhone FPS',cases:[],pass:false};
 try{
 await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
 await page.eval(`(async()=>{await app.plugins.disablePlugin('syntax-palette');await app.plugins.enablePlugin('syntax-palette');await app.plugins.plugins['syntax-palette'].updateSettings({wrapCodeBlocks:false,lineNumbers:true,codeBlockBackground:true});app.workspace.leftSplit?.collapse?.();app.workspace.rightSplit?.collapse?.()})()`);
 await page.send('Performance.enable');
 for(const count of [24,46,120]){
 const fence='`'.repeat(3),line='const result = values.filter((item, index) => item.enabled && index % 2 === 0).map(item => ({ name: item.name, value: item.value + 10 })); // '+ 'tail_'.repeat(20);
 const note=['BODY','',fence+'js',...Array.from({length:count},(_,i)=>line+' // '+i),fence,'','END'].join('\n');
 await page.eval(`(async()=>{let f=app.vault.getAbstractFileByPath('AOF Scroll Performance.md');if(!f)f=await app.vault.create('AOF Scroll Performance.md',${JSON.stringify(note)});else await app.vault.modify(f,${JSON.stringify(note)});const leaf=app.workspace.getLeaf(false);await leaf.openFile(f);await leaf.view.setState({...leaf.view.getState(),mode:'source',source:true},{});window.__perfCM=leaf.view.editor.cm;__perfCM.dispatch({selection:{anchor:0}});__perfCM.scrollDOM.scrollTop=0})()`);
 await wait(1200);
 const getMetrics=async()=>Object.fromEntries((await page.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 const before=await getMetrics();
 const samples=await page.eval(`(async()=>{const cm=__perfCM,c=cm.plugins.map(p=>p.value?.fenceScroll).find(Boolean);const g=[...c.groups.values()].find(g=>g.rows.length);if(!g)throw Error('scroll group not measured');const frames=[];let previous=performance.now();for(let i=0;i<60;i++){await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-previous);previous=now;c.move(g,80+(i%30)*8)}await new Promise(requestAnimationFrame);return {pluginVersion:app.plugins.plugins['syntax-palette'].manifest.version,nativeBlocks:c.nativeBlocks,mountedRows:g.rows.length,fragments:cm.contentDOM.querySelectorAll('.aof-scroll-content').length,wrappers:cm.contentDOM.querySelectorAll('.aof-native-scroll').length,domNodes:cm.contentDOM.querySelectorAll('*').length,frames,offset:g.offset,docUnchanged:cm.state.doc.toString()===${JSON.stringify(note)}}})()`);
 const after=await getMetrics(),delta={};for(const key of ['RecalcStyleCount','RecalcStyleDuration','LayoutCount','LayoutDuration','ScriptDuration','TaskDuration'])delta[key]=after[key]-before[key];
 assert.ok(samples.docUnchanged);result.cases.push({lines:count,...samples,metrics:delta});
 }
 result.pass=true;return result;
 }finally{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'scroll-performance-results.json'),JSON.stringify(result,null,2)+'\n');}
}
module.exports={runScrollPerformance};
