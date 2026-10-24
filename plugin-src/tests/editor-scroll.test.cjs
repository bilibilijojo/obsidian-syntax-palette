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
test('destroy removes event handlers and clears scroll and generated extent state',()=>{
 const {controller:c,a,handlers}=fixture();c.move(a,200);c.destroy();assert.equal(handlers.size,0);assert.equal(c.rows.size,0);assert.equal(c.groups.size,0);assert.deepEqual(a.rows.map(r=>r.scrollLeft),[0,0]);assert.equal(c.measure(),null);
});
test('synchronization uses cached widths and never interleaves layout reads with writes',()=>{
 const {controller:c}=fixture();let writes=0;
 const rows=Array.from({length:50},()=>({get clientWidth(){throw new Error('layout read in write phase')},get scrollLeft(){throw new Error('scroll read after write')},set scrollLeft(value){assert.equal(value,260);writes++}}));
 c.move({offset:0,width:1000,viewportWidth:200,rows},260);assert.equal(writes,50);
});
