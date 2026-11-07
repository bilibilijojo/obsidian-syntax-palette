/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EditorFenceScroll}=require('../editor-scroll.cjs');
function fixture(){
 const handlers=new Map();const pending=[];
 const view={contentDOM:{addEventListener:(n,f)=>handlers.set(n,f),removeEventListener:(n)=>handlers.delete(n)},requestMeasure:p=>pending.push(p),defaultCharacterWidth:8};
 const controller=new EditorFenceScroll(view,()=>true);
 const row=()=>({clientWidth:200,scrollLeft:0,style:{removeProperty(){}},matches:()=>true});
 const a={offset:0,width:1000,viewportWidth:200,rows:[row(),row()]};const b={offset:0,width:1200,viewportWidth:200,rows:[row()]};
 for(const r of a.rows)controller.rows.set(r,a);for(const r of b.rows)controller.rows.set(r,b);
 return {controller,a,b,handlers,pending};
}
test('horizontal movement synchronizes one fence including short rows and isolates another',()=>{
 const {controller:c,a,b}=fixture();c.move(a,260);assert.deepEqual(a.rows.map(r=>r.scrollLeft),[260,260]);assert.equal(b.rows[0].scrollLeft,0);
 c.move(b,330);assert.deepEqual(a.rows.map(r=>r.scrollLeft),[260,260]);assert.equal(b.rows[0].scrollLeft,330);
});
test('horizontal wheel is clamped and consumed even at a fence edge',()=>{
 const {controller:c,a,handlers}=fixture();let prevented=0;const e={target:{closest:()=>a.rows[0]},deltaX:9000,deltaY:0,deltaMode:0,preventDefault:()=>prevented++};
 handlers.get('wheel')(e);assert.equal(a.offset,800);handlers.get('wheel')(e);assert.equal(a.offset,800);assert.equal(prevented,2);
 c.move(a,-100);assert.equal(a.offset,0);
});
test('vertical gestures and control-wheel zoom retain host handling',()=>{
 const {a,handlers}=fixture();let prevented=0;for(const e of [{deltaX:2,deltaY:90},{deltaX:90,deltaY:0,ctrlKey:true}])handlers.get('wheel')({...e,target:{closest:()=>a.rows[0]},preventDefault:()=>prevented++});
 assert.equal(prevented,0);assert.equal(a.offset,0);
});
test('native line scroll propagates within a fence and does not schedule an echo loop',()=>{
 const {a,handlers,pending}=fixture();a.rows[0].scrollLeft=123;handlers.get('scroll')({target:a.rows[0]});assert.equal(a.rows[1].scrollLeft,123);
 const n=pending.length;handlers.get('scroll')({target:a.rows[1]});assert.equal(pending.length,n);
});
test('native overscroll is not overwritten while other rows stay within the block extent',()=>{
 const {controller:c,a,b,handlers}=fixture();const [source,peer]=a.rows;
 source.scrollLeft=-25;handlers.get('scroll')({target:source});
 assert.equal(source.scrollLeft,-25,'do not fight native bounce at the start');
 assert.equal(peer.scrollLeft,0);assert.equal(a.offset,0);assert.equal(b.offset,0);
 source.scrollLeft=860;handlers.get('scroll')({target:source});
 assert.equal(source.scrollLeft,860,'do not fight native bounce at the end');
 assert.equal(peer.scrollLeft,800);assert.equal(a.offset,800);assert.equal(b.offset,0);
 c.move(a,800);assert.equal(source.scrollLeft,860,'a later synchronization must not cancel the bounce');
 source.scrollLeft=700;handlers.get('scroll')({target:source});
 assert.equal(peer.scrollLeft,700,'synchronization resumes when the native scroll returns in range');
});
test('destroy removes event handlers and clears scroll and generated extent state',()=>{
 const {controller:c,a,handlers}=fixture();c.move(a,200);c.destroy();assert.equal(handlers.size,0);assert.equal(c.rows.size,0);assert.equal(c.groups.size,0);assert.deepEqual(a.rows.map(r=>r.scrollLeft),[0,0]);assert.equal(c.measure(),null);
});
test('synchronization uses cached widths and never interleaves layout reads with writes',()=>{
 const {controller:c}=fixture();let writes=0;
 const rows=Array.from({length:50},()=>({get clientWidth(){throw new Error('layout read in write phase')},get scrollLeft(){throw new Error('scroll read after write')},set scrollLeft(value){assert.equal(value,260);writes++}}));
 c.move({offset:0,width:1000,viewportWidth:200,rows},260);assert.equal(writes,50);
});
test('wrapping skips scroll measurements but a mode switch still schedules cleanup',()=>{
 let enabled=false;const pending=[];
 const view={contentDOM:{addEventListener(){},removeEventListener(){}},requestMeasure:request=>pending.push(request)};
 const c=new EditorFenceScroll(view,()=>enabled);
 assert.equal(pending.length,0,'wrapping should not schedule an initial scroll measurement');
 c.update({docChanged:false,selectionSet:true,viewportChanged:true,geometryChanged:true,transactions:[]},[]);
 assert.equal(pending.length,0,'wrapping should not schedule measurements during editor updates');
 assert.equal(c.ensureCaret,false);
 enabled=true;c.schedule();assert.equal(pending.length,1);
 c.groups.set('0',{offset:100,width:500,rows:[]});
 enabled=false;c.schedule();assert.equal(pending.length,2,'remaining scroll state needs a cleanup pass');
});

function touchFixture(){
 const handlers=new Map(),frames=new Map();let nextFrame=0,selected=false,enabled=true;
 const styles=new Map();
 const win={CSS:{supports:()=>true},matchMedia:()=>({matches:true}),requestAnimationFrame:fn=>{const id=++nextFrame;frames.set(id,fn);return id},cancelAnimationFrame:id=>frames.delete(id)};
 const doc={defaultView:win,getSelection:()=>({isCollapsed:!selected})};
 const view={contentDOM:{ownerDocument:doc,classList:{add(){},toggle(){},remove(){}},style:{setProperty:(k,v)=>styles.set(k,v),removeProperty:k=>styles.delete(k)},addEventListener:(n,f)=>handlers.set(n,f),removeEventListener:n=>handlers.delete(n)},requestMeasure(){}};
 const c=new EditorFenceScroll(view,()=>enabled);
 frames.clear();c.measureFrame=null;
 const row=()=>({nodeType:1,scrollLeft:0,closest(){return this},getAttribute:()=> '0',matches:()=>true});
 const a={key:'0',offset:200,width:1000,viewportWidth:200,rows:[row(),row(),row()]};
 const b={offset:0,width:1000,viewportWidth:200,rows:[row()]};
 c.groups.set('0',a);for(const r of a.rows){c.rows.set(r,a);c.rowOffsets.set(r,0)}
 c.move(a,200);
 for(const r of b.rows)c.rows.set(r,b);
 let prevented=0;
 const event=(x,y,time,options={})=>({target:a.rows[1],touches:options.end?[]:[{identifier:1,clientX:x,clientY:y}],timeStamp:time,cancelable:options.cancelable!==false,preventDefault(){prevented++}});
 return {c,a,b,handlers,frames,styles,event,prevented:()=>prevented,select:()=>{selected=true},disable:()=>{enabled=false},frame(time){const [id,fn]=frames.entries().next().value;frames.delete(id);fn(time)}};
}
test('horizontal touch drives every row together without moving other fences',()=>{
 const f=touchFixture(),{a,b,handlers,event}=f;
 handlers.get('touchstart')(event(150,50,0));
 handlers.get('touchmove')(event(120,52,20));
 handlers.get('touchmove')(event(90,53,40));
 assert.equal(f.prevented(),2);assert.equal(f.frames.size,1,'several touch events should share one frame');
 assert.deepEqual(a.rows.map(r=>r.scrollLeft),[0,0,0]);f.frame(41);
 assert.deepEqual(a.rows.map(r=>r.scrollLeft),[0,0,0]);assert.equal(f.styles.get('--aof-block-offset-0'),'-260px');
 for(const row of a.rows)handlers.get('scroll')({target:row});
 assert.equal(a.offset,260,'programmatic scroll events must not feed back');
 handlers.get('touchend')(event(90,53,45,{end:true}));
 assert.equal(f.frames.size,1);f.frame(50);f.frame(66);
 assert.ok(a.offset>260,'a quick swipe continues with shared momentum');
 assert.equal(f.styles.get('--aof-block-offset-0'),`${-a.offset}px`);assert.ok(a.rows.every(row=>row.scrollLeft===0));assert.equal(b.rows[0].scrollLeft,0);
 handlers.get('touchstart')(event(150,50,70));assert.equal(f.frames.size,0,'a new touch cancels momentum');
});
test('a pending touch update is discarded when a second finger interrupts',()=>{
 const f=touchFixture(),{a,handlers,event}=f;
 handlers.get('touchstart')(event(150,50,0));handlers.get('touchmove')(event(110,50,20));
 assert.equal(f.frames.size,1);
 const multi=event(100,50,25);multi.touches.push({identifier:2,clientX:50,clientY:50});
 handlers.get('touchmove')(multi);
 assert.equal(f.frames.size,0);assert.deepEqual(a.rows.map(r=>r.scrollLeft),[0,0,0]);
});
test('vertical gestures, long press, selected text, multi-touch and cancelled events stay with the host',()=>{
 for(const kind of ['vertical','long','selection','multi','noncancelable']){
  const f=touchFixture(),{handlers,event,a}=f;
  if(kind==='selection')f.select();
  handlers.get('touchstart')(event(150,50,0));
  const move=event(kind==='vertical'?145:100,kind==='vertical'?90:50,kind==='long'?400:20,{cancelable:kind!=='noncancelable'});
  if(kind==='multi')move.touches.push({identifier:2,clientX:100,clientY:50});
  handlers.get('touchmove')(move);
  assert.equal(f.prevented(),0,kind);assert.deepEqual(a.rows.map(r=>r.scrollLeft),[0,0,0],kind);
 }
});
test('touch gesture and momentum are stopped by cancellation, setting changes and destroy',()=>{
 const f=touchFixture(),{c,handlers,event,frames}=f;
 handlers.get('touchstart')(event(150,50,0));handlers.get('touchmove')(event(110,50,20));
 handlers.get('touchend')(event(110,50,25,{end:true}));assert.equal(frames.size,1);
 handlers.get('touchcancel')();assert.equal(frames.size,0);
 handlers.get('touchstart')(event(150,50,30));handlers.get('touchmove')(event(110,50,50));
 f.disable();c.update({docChanged:false,selectionSet:false,viewportChanged:false,geometryChanged:false,transactions:[{effects:[1]}]},[]);
 assert.equal(c.touch,null);assert.equal(c.touchFrame,null);assert.equal(c.momentumFrame,null);c.destroy();assert.equal(frames.size,0);assert.equal(handlers.size,0);
});

test('touch movement uses one shared style write, zero row scroll writes, and ignores native scroll takeover',()=>{
 const f=touchFixture(),{c,a,handlers,event}=f;
 let styleWrites=0,measures=0;
 c.view.contentDOM.style.setProperty=(key,value)=>{styleWrites++;f.styles.set(key,value)};
 c.view.requestMeasure=()=>measures++;
 const touchRow=a.rows[1];
 a.rows=Array.from({length:260},()=>({get scrollLeft(){throw new Error('per-row read')},set scrollLeft(value){throw new Error('per-row write')}}));
 c.move(a,275);assert.equal(styleWrites,1);assert.equal(measures,1);
 c.move(a,275);assert.equal(styleWrites,1,'unchanged offset has no style work');
 const stale={scrollLeft:600};c.rows.set(stale,a);
 handlers.get('scroll')({target:stale});assert.equal(a.offset,275,'a delayed native event cannot move the whole block');
 handlers.get('touchstart')({...event(150,50,0),target:touchRow});handlers.get('touchmove')({...event(100,50,20),target:touchRow});f.frame(21);
 handlers.get('scroll')({target:stale});assert.equal(a.offset,325,'touch owns all rows');
 handlers.get('touchend')(event(100,50,25,{end:true}));f.frame(30);f.frame(46);
 const momentumOffset=a.offset;handlers.get('scroll')({target:stale});assert.equal(a.offset,momentumOffset,'momentum owns all rows');
});

test('geometry requests are coalesced outside the current CM measure loop and cancelled on destroy',()=>{
 const f=touchFixture();let requests=0;
 f.c.view.requestMeasure=()=>requests++;
 f.c.schedule();f.c.schedule();f.c.schedule();
 assert.equal(requests,0,'do not enqueue inside the active CM measure loop');
 assert.equal(f.frames.size,1);f.frame(16);assert.equal(requests,1);
 f.c.schedule();assert.equal(f.frames.size,1);f.c.destroy();assert.equal(f.frames.size,0);
});

test('native block mode moves one scrollport without touching rows or shared styles',()=>{
 const f=touchFixture(),{c,a,b,handlers,event}=f;
 c.nativeBlocks=true;
 let writes=0;
 a.scrollport={scrollLeft:200};b.scrollport={scrollLeft:0};
 c.scrollports.set(a.scrollport,a);c.scrollports.set(b.scrollport,b);
 c.view.contentDOM.style.setProperty=()=>{throw Error('native scrolling must not update inherited CSS variables')};
 a.rows=Array.from({length:46},()=>({set scrollLeft(value){throw Error('native scrolling must not move rows separately')}}));
 const port=a.scrollport;let offset=200;
 Object.defineProperty(port,'scrollLeft',{get:()=>offset,set:value=>{offset=value;writes++}});
 c.move(a,320);assert.equal(offset,320);assert.equal(writes,1);assert.equal(b.scrollport.scrollLeft,0);
 c.move(a,320);assert.equal(writes,1,'unchanged position needs no write');
 offset=450;handlers.get('scroll')({target:port});assert.equal(a.offset,450);assert.equal(writes,1,'native scroll notification does not write back');
 // A native block pan must not enter JS touch/animation handling.
 handlers.get('touchstart')(event(150,50,0));handlers.get('touchmove')(event(80,50,20));
 assert.equal(c.touch,null);assert.equal(f.prevented(),0);assert.equal(f.frames.size,0);
});
test('native block mode installs no scroll-blocking touch listeners',()=>{
 const listeners=new Map();
 const view={contentDOM:{classList:{add(){},remove(){}},addEventListener:(name,fn,options)=>listeners.set(name,options),removeEventListener:name=>listeners.delete(name)},requestMeasure(){}};
 const c=new EditorFenceScroll(view,()=>true,true,true);
 assert.ok(listeners.has('scroll'));assert.ok(listeners.has('wheel'));
 assert.ok(![...listeners.keys()].some(name=>name.startsWith('touch')));
 c.destroy();assert.equal(listeners.size,0);
});
