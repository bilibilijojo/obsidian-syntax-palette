/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';
// Chromium touch protocol + real CM DOM. Not a physical iPhone gesture test.
const assert = require('node:assert/strict');
const { wait } = require('./obsidian-v0.4.0-test.cjs');
async function runTouchScroll(page) {
  const fence = '`'.repeat(3);
  const note = ['BODY', '', fence+'js', ...Array.from({length:24},(_,i)=>`const row${i} = "${'content_'.repeat(45)}";`), fence, '', 'BODY END'].join('\n');
  await page.eval(`(()=>{const cm=__isoCM;cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:${JSON.stringify(note)}},selection:{anchor:0}});cm.scrollDOM.scrollTop=0;cm.focus()})()`);
  await wait(650);
  const before = await page.eval(`(()=>{
    const cm=__isoCM,c=cm.plugins.map(p=>p.value?.fenceScroll).find(Boolean);
    const row=cm.contentDOM.querySelector('.cm-line[data-aof-n="10"]');
    const box=row.getBoundingClientRect();window.__touchKey=row.dataset.aofScroll;
    window.__touchSnapshot=()=>{
      const group=c.groups.get(__touchKey);
      return {offset:group.offset,width:group.width,rows:group.rows.filter(row=>row.textContent).map(row=>{const range=document.createRange();range.selectNodeContents(row);return {text:row.textContent,x:range.getBoundingClientRect().left,native:row.scrollLeft}}),doc:cm.state.doc.toString()};
    };
    window.__rowScrollEvents=0;window.__countRowScroll=e=>{if(c.rows.has(e.target))__rowScrollEvents++};cm.contentDOM.addEventListener('scroll',__countRowScroll,true);
    return {snapshot:__touchSnapshot(),x:box.left+Math.min(300,box.width-30),y:box.top+8};
  })()`);
  await page.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:before.x,y:before.y,id:1}]});
  for(let i=1;i<=8;i++){
    await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:before.x-i*16,y:before.y+1,id:1}]});
    await wait(18);
  }
  const during = await page.eval('__touchSnapshot()');
  await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(120);
  const after = await page.eval('__touchSnapshot()');
  assert.ok(during.rows.length>1,'touch geometry did not cover multiple rows');
  assert.ok(during.offset>80,'touch on row 10 did not move fence');
  const check = snapshot => {
    assert.equal(snapshot.doc,before.snapshot.doc,'touch altered Markdown');
    for(const row of snapshot.rows){
      const original=before.snapshot.rows.find(other=>other.text===row.text);
      assert.ok(original,'unexpected virtual row during fixed viewport gesture');
      assert.ok(Math.abs((original.x-row.x)-(snapshot.offset-before.snapshot.offset))<1,'row moved by a different distance');
      assert.equal(row.native,0,'native per-row scroll escaped clipping');
    }
  };
  check(during);check(after);
  const scrollEvents=await page.eval(`(()=>{__isoCM.contentDOM.removeEventListener('scroll',__countRowScroll,true);return __rowScrollEvents})()`);
  assert.equal(scrollEvents,0,'touch generated native row scroll events');
  // Repeated measurements must not inflate the extent because the host's
  // unshifted syntax spans surround the shifted mark fragments.
  const widths=await page.eval(`(()=>{const c=__isoCM.plugins.map(p=>p.value?.fenceScroll).find(Boolean);c.stopMomentum();const widths=[];for(let i=0;i<8;i++){c.apply(c.measure());widths.push(c.groups.get(__touchKey).width)}return widths})()`);
  assert.ok(widths.every(width=>width===widths[0]),'extent grows on repeated measurement');
  const hostSwipe = await require('./obsidian-host-swipe-test.cjs').runHostSwipe(page);
  const nested=['BODY', '', '> '+fence+'js', '> const quoted = "'+'quoted_'.repeat(60)+'";', '> short();', '> '+fence, '', '- item', '  '+fence+'js', '  const listed = "'+'listed_'.repeat(60)+'";', '  short();', '  '+fence, '', fence+'js', '', 'const plain = "'+'plain_'.repeat(60)+'";', fence].join('\n');
  await page.eval(`(()=>{const cm=__isoCM;cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:${JSON.stringify(nested)}},selection:{anchor:0}});cm.scrollDOM.scrollTop=0})()`);await wait(600);
  const nestedResult = await page.eval(`(()=>{
    const cm=__isoCM,c=cm.plugins.map(p=>p.value?.fenceScroll).find(Boolean),out=[];
    for(const [key,group]of c.groups){
      const numbers=group.rows.flatMap(row=>[...row.querySelectorAll('.aof-ln-inline')]);
      const before=numbers.map(n=>n.getBoundingClientRect().left);
      c.move(group,180);
      const after=numbers.map(n=>n.getBoundingClientRect().left);
      out.push({key,offset:group.offset,before,after});
    }
    return {groups:out,doc:cm.state.doc.toString(),native:[...c.rows.keys()].map(row=>row.scrollLeft)};
  })()`);
  assert.equal(nestedResult.doc,nested);assert.equal(nestedResult.groups.length,3);
  assert.ok(nestedResult.groups.reduce((n,g)=>n+g.before.length,0)>=4,'nested line-number widgets not exercised');
  for(const group of nestedResult.groups)for(let i=0;i<group.before.length;i++)assert.ok(Math.abs(group.before[i]-group.after[i]-group.offset)<1,'inline number out of sync');
  assert.ok(nestedResult.native.every(x=>x===0));
  const emptyCaret=await page.eval(`(()=>{const cm=__isoCM;cm.dispatch({selection:{anchor:cm.state.doc.line(15).from}});return cm.state.doc.line(15).text})()`);
  assert.equal(emptyCaret,'');await wait(150);
  await page.send('Input.insertText',{text:'空行输入'});await wait(100);
  assert.equal(await page.eval('__isoCM.state.doc.line(15).text'),'空行输入');
  return {environment:'macOS Obsidian + Chromium touch protocol, not iPhone',before,during,after,scrollEvents,widths,hostSwipe,nestedResult,blankLineInput:true,pass:true};
}
module.exports = { runTouchScroll };
