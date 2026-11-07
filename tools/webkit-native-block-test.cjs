/* SPDX-License-Identifier: Apache-2.0 */
'use strict';
// macOS WebKit geometry only, not iPhone compositor/gesture performance.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {buildWrapCss}=require('../plugin-src/wrap-style.cjs');
const {buildLineNumberCss}=require('../plugin-src/line-number-style.cjs');
const out=path.resolve(process.env.AOF_EVIDENCE||'evidence/v0.5.9/webkit');fs.mkdirSync(out,{recursive:true});
const controller=fs.readFileSync(path.join(__dirname,'../plugin-src/editor-scroll.cjs'),'utf8').replace('module.exports = { EditorFenceScroll, usesSharedTouchScroll };','window.EditorFenceScroll=EditorFenceScroll;');
const row=(key,i)=>`<div class="cm-line aof-nowrap aof-ln-line aof-lng-2" data-aof-scroll="${key}" data-aof-n="${i}" style="--aof-scroll-extent:var(--aof-block-width-${key},0px)"><span>const</span> row${i} = <span>"${'long_text_'.repeat(i===2?90:25)}";</span></div>`;
const html=`<!doctype html><meta charset="utf-8"><style>body{margin:20px;font:16px monospace}#editor{width:390px;height:500px;overflow:auto}.cm-line{line-height:24px;padding:0 12px;box-sizing:border-box}${buildLineNumberCss({enabled:true})}${buildWrapCss({wrap:false})}</style><div class="markdown-source-view mod-cm6"><div id="editor"><div id="content"><div id="body" class="cm-line">BODY</div><div class="aof-native-scroll" id="a">${Array.from({length:46},(_,i)=>row('0',i+1)).join('')}</div><div class="cm-line">MIDDLE</div><div class="aof-native-scroll" id="b">${row('1',1)}</div></div></div></div><script>window.__stage="loading-controller";window.addEventListener("error",e=>{window.__meta={pass:false,error:e.message,stage:window.__stage};window.__probes=[]});</script><script>${controller}
(async()=>{
// Layout-only fixture: WKWebView can suspend rAF in an inactive desktop
// window. Use task boundaries and explicit scroll notifications; trusted
// gesture/event delivery is tested separately in the real CM host.
const settle=()=>new Promise(resolve=>setTimeout(resolve,30)),check=(value,message)=>{if(!value)throw Error(message)};
const content=document.getElementById('content'),editor=document.getElementById('editor'),body=document.getElementById('body');let enabled=true;
const view={contentDOM:content,defaultCharacterWidth:10,defaultLineHeight:24,requestMeasure:r=>{if(r)requestAnimationFrame(()=>r.write(r.read()))}};
window.__stage="construct";const c=new EditorFenceScroll(view,()=>enabled,true,true);c.apply(c.measure());window.__stage="initial-layout";await settle();window.__stage="scroll";
let a=document.getElementById('a');const b=document.getElementById('b');
const snap=()=>({rows:[...a.children].map(row=>{const range=document.createRange();range.selectNodeContents(row);return {left:range.getBoundingClientRect().left,scroll:row.scrollLeft}}),a:a.scrollLeft,b:b.scrollLeft,body:body.getBoundingClientRect().left,page:editor.scrollLeft});
const before=snap();let events=0;const count=e=>{if(e.target===a)events++};content.addEventListener('scroll',count,true);
a.scrollLeft=240;a.dispatchEvent(new Event('scroll'));window.__stage='scroll-layout';await settle();await settle();window.__stage='geometry';const after=snap();
check(after.a===240&&after.b===0&&after.body===before.body&&after.page===0,'block isolation');
check(after.rows.length===46&&after.rows.every((row,i)=>Math.abs(before.rows[i].left-row.left-240)<1&&row.scroll===0),'46 rows not moving together');
const widths=[];for(let i=0;i<5;i++){c.apply(c.measure());widths.push(c.groups.get('0').width)}check(widths.every(w=>w===widths[0]),'extent inflation');
const clone=a.cloneNode(true);a.replaceWith(clone);a=clone;c.apply(c.measure());window.__stage='remount-frame';await settle();check(a.scrollLeft===240,'remounted wrapper lost position');
a.scrollLeft=100000;a.dispatchEvent(new Event('scroll'));await settle();await settle();const end=a.scrollLeft;check(end>240,'tail unreachable');
a.scrollLeft=0;a.dispatchEvent(new Event('scroll'));await settle();await settle();check(a.scrollLeft===0,'edge return');
check(editor.scrollWidth===editor.clientWidth,'outer page overflow');
content.removeEventListener('scroll',count,true);enabled=false;c.apply(c.measure());await settle();await settle();c.destroy();
check(!content.classList.contains('aof-native-blocks')&&!content.style.cssText.includes('--aof-block-width'),'cleanup');
window.__meta={pass:true,before,after,scrollNotifications:events,widths,end,explicitScrollNotifications:true,environment:'macOS WKWebView; not iPhone'};window.__probes=[];
})().catch(e=>{window.__meta={pass:false,error:String(e)};window.__probes=[]});</script>`;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'aof-native-block-')),page=path.join(tmp,'page.html');fs.writeFileSync(page,html);fs.writeFileSync(path.join(out,'native-block-page.html'),html);
const r=spawnSync('swift',[path.join(__dirname,'webkit-highlight-probe.swift'),page,path.join(out,'native-block.png'),'--wait-ready'],{encoding:'utf8',timeout:180000});
const line=(r.stdout||'').split('\n').find(l=>l.startsWith('RESULT '));if(!line)throw Error(r.stderr||r.stdout);
const data=JSON.parse(line.slice(7));fs.writeFileSync(path.join(out,'native-block-results.json'),JSON.stringify(data,null,2)+'\n');
if(!data.meta?.pass){console.error(data);process.exitCode=1}else console.log('PASS: WebKit 46-row native block geometry, isolation, remount, edges, stable extent and cleanup');
