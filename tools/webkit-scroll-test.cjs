'use strict';
// Supplemental macOS WebKit DOM fixture. This is neither mobile Obsidian nor
// a substitute for the real Obsidian acceptance suite.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {buildWrapCss}=require('../plugin-src/wrap-style.cjs');
const out=path.resolve(process.env.AOF_EVIDENCE||'evidence/v0.5.1');
fs.mkdirSync(out,{recursive:true});
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'aof-webkit-scroll-'));
const controller=fs.readFileSync(path.join(__dirname,'../plugin-src/editor-scroll.cjs'),'utf8').replace('module.exports = { EditorFenceScroll };','window.EditorFenceScroll = EditorFenceScroll;');
const html=`<!doctype html><meta charset="utf-8"><style>
body {margin:20px;font:16px monospace} #editor{width:500px;height:500px;overflow:auto}.cm-line{height:24px;line-height:24px;box-sizing:border-box;padding:0 12px;width:500px} ${buildWrapCss({wrap:false})}
</style><div class="markdown-source-view mod-cm6"><div id="editor"><div id="content">
<div class="cm-line" id="body">BODY stays still</div>
<div class="cm-line aof-nowrap" data-aof-scroll="0" style="--aof-scroll-extent: var(--aof-block-width-0, 0px)" id="a">${'A0123456789_'.repeat(80)}</div>
<div class="cm-line aof-nowrap" data-aof-scroll="0" style="--aof-scroll-extent: var(--aof-block-width-0, 0px)" data-aof-scroll-end id="short">short()</div>
<div class="cm-line">MIDDLE stays still</div>
<div class="cm-line aof-nowrap" data-aof-scroll="1" style="--aof-scroll-extent: var(--aof-block-width-1, 0px)" id="b">${'B9876543210_'.repeat(80)}</div>
</div></div></div><script>${controller}
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));let enabled=true;
const content=document.getElementById('content'),editor=document.getElementById('editor');
const view={contentDOM:content,defaultCharacterWidth:10,defaultLineHeight:24,requestMeasure(request){if(request)requestAnimationFrame(()=>request.write(request.read()))}};
const c=new EditorFenceScroll(view,()=>enabled);
const a=document.getElementById('a'),b=document.getElementById('b'),body=document.getElementById('body'),short=document.getElementById('short');
const snap=()=>{const rect=e=>{const r=document.createRange();r.selectNodeContents(e);return {box:e.getBoundingClientRect().left,text:r.getBoundingClientRect().left,scroll:e.scrollLeft,extent:e.scrollWidth,after:getComputedStyle(e,'::after').left,variable:getComputedStyle(e).getPropertyValue('--aof-scroll-extent')}};return {a:rect(a),b:rect(b),body:rect(body),short:rect(short),editorScroll:editor.scrollLeft,editorWidth:editor.clientWidth,editorExtent:editor.scrollWidth}};
const started=performance.now();
while((c.extents.size!==2||parseFloat(getComputedStyle(short,'::after').left)<500)&&performance.now()-started<3000)await wait(20);
const ready=c.extents.size===2&&parseFloat(getComputedStyle(short,'::after').left)>500;
const before=snap();a.scrollLeft=240;await wait(100);const first=snap();b.scrollLeft=310;await wait(100);const second=snap();
enabled=false;c.schedule();await wait(100);const cleared=snap();c.destroy();
window.__meta={ready,before,first,second,cleared,pass:ready&&first.a.text<before.a.text-200&&first.body.text===before.body.text&&first.b.text===before.b.text&&second.a.text===first.a.text&&second.b.text<first.b.text-250&&first.short.scroll===first.a.scroll&&second.editorScroll===0&&second.editorExtent===second.editorWidth&&cleared.a.scroll===0&&cleared.b.scroll===0};
window.__probes=[];
})().catch(e=>{window.__meta={pass:false,error:String(e)};window.__probes=[]});</script>`;
const page=path.join(tmp,'page.html'),shot=path.join(out,'webkit-scroll.png');fs.writeFileSync(page,html);fs.writeFileSync(path.join(out,'webkit-scroll-page.html'),html);
const result=spawnSync('swift',[path.join(__dirname,'webkit-highlight-probe.swift'),page,shot],{encoding:'utf8',timeout:180000});
const line=(result.stdout||'').split('\n').find(l=>l.startsWith('RESULT '));
if(!line){console.error(result.stderr||result.error||result.stdout);process.exit(2)}
const data=JSON.parse(line.slice(7));data.environment='macOS WKWebView DOM fixture, not mobile or Obsidian';data.pass=data.meta?.pass===true&&!data.error;
fs.writeFileSync(path.join(out,'webkit-scroll-results.json'),JSON.stringify(data,null,2)+'\n');
console.log(data.pass?'PASS: WebKit real DOM text movement, body/other-fence isolation, short-row sync and cleanup':JSON.stringify(data));if(!data.pass)process.exitCode=1;
