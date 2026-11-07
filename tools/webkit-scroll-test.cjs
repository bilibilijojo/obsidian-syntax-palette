/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';
// Supplemental macOS WebKit DOM fixture, not iOS or a CodeMirror host.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { buildWrapCss } = require('../plugin-src/wrap-style.cjs');
const sharedTouch = process.env.AOF_SHARED_TOUCH === '1';
const out = path.resolve(process.env.AOF_EVIDENCE || 'evidence/v0.5.7');
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aof-webkit-scroll-'));
const controller = fs.readFileSync(path.join(__dirname, '../plugin-src/editor-scroll.cjs'), 'utf8')
  .replace('module.exports = { EditorFenceScroll, usesSharedTouchScroll };', 'window.EditorFenceScroll = EditorFenceScroll;');
const row = (id, key, text) => `<div class="cm-line aof-nowrap" data-aof-scroll="${key}" style="--aof-scroll-extent:var(--aof-block-width-${key},0px);--aof-scroll-offset:var(--aof-block-offset-${key},0px)" id="${id}">${sharedTouch ? `<span class="aof-scroll-content">${text}</span>` : text}</div>`;
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:20px;font:16px monospace}#editor{width:500px;height:500px;overflow:auto}.cm-line{height:24px;line-height:24px;box-sizing:border-box;padding:0 12px;width:500px}${buildWrapCss({wrap:false})}
</style><div class="markdown-source-view mod-cm6"><div id="editor"><div id="content">
<div class="cm-line" id="body">BODY stays still</div>
${row('a','0','A0123456789_'.repeat(80))}${row('short','0','short()')}
${Array.from({length:30},(_,i)=>row('peer'+i,'0','peer_'+i+'_'+'token_'.repeat(30))).join('')}
${row('b','1','B9876543210_'.repeat(80))}
</div></div></div><script>${controller}
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms)),frame=()=>new Promise(requestAnimationFrame);
const shared=${sharedTouch};
const nativeMatchMedia=window.matchMedia.bind(window);
if(shared)window.matchMedia=q=>q==='(pointer: coarse)'?{matches:true}:nativeMatchMedia(q);
let enabled=true;
const content=document.getElementById('content'),editor=document.getElementById('editor');
const view={contentDOM:content,defaultCharacterWidth:10,defaultLineHeight:24,requestMeasure(request){if(request)requestAnimationFrame(()=>request.write(request.read()))}};
const c=new EditorFenceScroll(view,()=>enabled);
const a=document.getElementById('a'),b=document.getElementById('b'),body=document.getElementById('body'),short=document.getElementById('short');
const rect=e=>{const r=document.createRange();r.selectNodeContents(e);return {box:e.getBoundingClientRect().left,text:r.getBoundingClientRect().left,nativeScroll:e.scrollLeft,offset:shared?-(parseFloat(getComputedStyle(e).getPropertyValue('--aof-scroll-offset'))||0):e.scrollLeft}};
const snap=()=>({a:rect(a),b:rect(b),body:rect(body),short:rect(short),editorScroll:editor.scrollLeft,editorWidth:editor.clientWidth,editorExtent:editor.scrollWidth});
const check=(condition,message)=>{if(!condition)throw Error(message)};
c.apply(c.measure());await frame();check(c.groups.size===2,'groups not ready');check(c.touchMode===shared,'wrong controller mode');
const before=snap();
const move=(row,x)=>{if(shared)c.move(c.rows.get(row),x);else row.scrollLeft=x};
move(a,240);await frame();await frame();const first=snap();
check(Math.abs(first.a.text-before.a.text+240)<1,'long row position');check(Math.abs(first.short.text-before.short.text+240)<1,'short row position');
check(first.body.text===before.body.text&&first.b.text===before.b.text,'fence isolation');
move(b,310);await frame();await frame();const second=snap();check(second.a.text===first.a.text,'other block moved');
move(a,100000);await frame();await frame();const end=snap();check(end.a.offset>240&&Math.abs(end.short.offset-end.a.offset)<1,'end alignment');
move(a,0);await frame();await frame();const start=snap();check(start.a.offset===0&&start.short.offset===0,'return from edge');
let touch=null;
if(shared){
 const fire=(type,x,y)=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:[{identifier:1,clientX:x,clientY:y}]});short.dispatchEvent(e);return e.defaultPrevented};
 let moves=0;const original=c.move;c.move=function(...args){moves++;return original.apply(this,args)};
 fire('touchstart',160,80);fire('touchmove',120,81);check(fire('touchmove',80,82),'horizontal gesture not consumed');await frame();
 touch=snap();check(moves===1&&touch.a.offset===80&&touch.short.offset===80,'touch updates not coalesced');
 a.scrollLeft=999;short.scrollLeft=333;a.dispatchEvent(new Event('scroll'));short.dispatchEvent(new Event('scroll'));await frame();
 check(a.scrollLeft===0&&short.scrollLeft===0&&c.groups.get('0').offset===80,'a row escaped shared movement');
 fire('touchcancel',80,82);c.move=original;
}
// Count actual browser scroll event fan-out across 12 displayed updates. This
// measures the eliminated mechanism; these are not iPhone frame-rate numbers.
let scrollEvents=0;const count=e=>{if(c.rows.has(e.target))scrollEvents++};content.addEventListener('scroll',count,true);
for(let i=1;i<=12;i++){c.move(c.groups.get('0'),100+i*9);await frame();await frame()}
content.removeEventListener('scroll',count,true);
if(shared)check(scrollEvents===0,'shared movement emitted row scroll events');
const final=snap();check(final.editorScroll===0&&final.editorExtent===final.editorWidth,'whole editor overflow');
enabled=false;c.schedule();await frame();await frame();const cleared=snap();c.destroy();
check(cleared.a.nativeScroll===0&&cleared.b.nativeScroll===0&&!content.style.cssText.includes('--aof-block-offset')&&!content.classList.contains('aof-touch-scroll'),'cleanup');
window.__meta={pass:true,sharedTouch:shared,before,first,second,end,start,touch,scrollEvents,measuredFrames:12,mountedRows:32,cleared};window.__probes=[];
})().catch(e=>{window.__meta={pass:false,error:String(e)};window.__probes=[]});</script>`;
const page = path.join(tmp, 'page.html'), shot = path.join(out, 'webkit-scroll.png');
fs.writeFileSync(page, html);fs.writeFileSync(path.join(out, 'webkit-scroll-page.html'), html);
const result = spawnSync('swift', [path.join(__dirname, 'webkit-highlight-probe.swift'), page, shot], { encoding: 'utf8', timeout: 180000 });
const line = (result.stdout || '').split('\n').find(l => l.startsWith('RESULT '));
if (!line) { console.error(result.stderr || result.error || result.stdout);process.exit(2); }
const data = JSON.parse(line.slice(7));
data.environment = 'macOS WKWebView DOM fixture, not mobile or Obsidian';data.pass = data.meta?.pass === true && !data.error;
fs.writeFileSync(path.join(out, 'webkit-scroll-results.json'), JSON.stringify(data, null, 2) + '\n');
console.log(data.pass ? `PASS: WebKit ${sharedTouch ? 'shared touch' : 'native desktop'} geometry, isolation, edges and cleanup; ${data.meta.scrollEvents} row scroll events / 12 updates` : JSON.stringify(data));
if (!data.pass) process.exitCode = 1;
