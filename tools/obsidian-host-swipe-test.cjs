/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { wait } = require('./obsidian-v0.4.0-test.cjs');

// Read the installed host's recognizer at test time. Do not vendor its source.
// This enables its mobile-only registration in a disposable desktop fixture;
// it is not a test of the iOS application's native navigation layer.
function hostRecognizer() {
  const archive = fs.readFileSync(process.env.AOF_OBSIDIAN_ASAR || '/Applications/Obsidian.app/Contents/Resources/obsidian.asar');
  const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
  const entry = header.files['app.js'];
  const offset = 8 + archive.readUInt32LE(4) + Number(entry.offset);
  const source = archive.subarray(offset, offset + entry.size).toString();
  const marker = source.indexOf('dataset.ignoreSwipe');
  assert.ok(marker >= 0, 'host swipe opt-out not found; inspect installed host');
  const start = source.lastIndexOf('function ', marker);
  const end = source.indexOf('}var ', marker) + 1;
  const fn = source.slice(start, end);
  const mobile = /if\(!([\w$]+)\.isMobile\)return/.exec(fn)?.[1];
  const selection = /if\(([\w$]+)\([\w$]+\.win\)\)/.exec(fn)?.[1];
  assert.ok(mobile && selection && fn.includes('window.addEventListener("touchmove"'), 'host recognizer layout changed; inspect before testing');
  return `(()=>{const ${mobile}={isMobile:true};const ${selection}=()=>false;return (${fn})})()`;
}
async function runHostSwipe(page) {
  await page.eval(`(()=>{
    const cm=__isoCM;const surface=cm.dom.parentElement;
    window.__hostSurface=surface;window.__hostMoves=0;
    window.__hostStartListener=null;
    const original=surface.addEventListener;
    surface.addEventListener=function(type,fn,...options){if(type==='touchstart')__hostStartListener=fn;return original.call(this,type,fn,...options)};
    try{(${hostRecognizer()})(surface,gesture=>{
      if(gesture.direction!=='x')return;
      gesture.registerCallback({move:x=>{__hostMoves++;surface.style.transform='translateX('+(x-gesture.startX)+'px)'},finish:()=>{surface.style.transform=''},cancel:()=>{surface.style.transform=''}});
    })}finally{surface.addEventListener=original}
    window.__hostSnapshot=()=>{const body=cm.contentDOM.querySelector('.cm-line');return {codeOffset:cm.plugins.map(p=>p.value?.fenceScroll).find(Boolean).groups.get(__touchKey)?.offset,moves:__hostMoves,bodyLeft:body.getBoundingClientRect().left,bodyTop:body.getBoundingClientRect().top,left:cm.scrollDOM.scrollLeft,top:cm.scrollDOM.scrollTop,transform:surface.style.transform}};
  })()`);
  const swipe = async (enabled, dx, dy, startOffset = 200) => {
    const before = await page.eval(`(()=>{
      const cm=__isoCM,c=cm.plugins.map(p=>p.value?.fenceScroll).find(Boolean);c.stopMomentum();
      for(const row of [...c.rows.keys(),...c.scrollports.keys()]){if(${enabled})row.dataset.ignoreSwipe='true';else row.removeAttribute('data-ignore-swipe')}
      // Negative control also removes native scroll ownership, matching the old clipped path.
      for(const port of c.scrollports.keys()){if(${enabled})port.style.removeProperty('overflow');else port.style.overflow='clip'}
      __hostMoves=0;cm.scrollDOM.scrollTop=0;
      const row=cm.contentDOM.querySelector('.cm-line[data-aof-n="10"]');const box=row.getBoundingClientRect(),viewport=(row.closest('.aof-native-scroll')||row).getBoundingClientRect();
      c.move(c.rows.get(row),${startOffset});
      return {x:viewport.left+Math.min(300,viewport.width-30),y:box.top+8,page:__hostSnapshot()};
    })()`);
    await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:before.x,y:before.y,id:1}]});
    for(let i=1;i<=6;i++){
      await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:before.x+dx*i/6,y:before.y+dy*i/6,id:1}]});await wait(18);
    }
    const during=await page.eval('__hostSnapshot()');
    await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(150);
    return {before,during,after:await page.eval('__hostSnapshot()')};
  };
  try {
    const negative = await swipe(false,96,1,0);
    assert.ok(negative.during.moves>0,'negative control did not activate host page swipe');
    assert.ok(Math.abs(negative.during.bodyLeft-negative.before.page.bodyLeft)>30,'negative control did not move page');
    const fixed = await swipe(true,-96,1);
    assert.equal(fixed.during.moves,0,'host still handles code horizontal swipe');
    assert.ok(fixed.during.codeOffset>fixed.before.page.codeOffset+60,'code stopped moving with host swipe opt-out');
    for(const stage of [fixed.during,fixed.after]){
      for(const key of ['bodyLeft','bodyTop','left','top'])assert.ok(Math.abs(stage[key]-fixed.before.page[key])<1,`outer page ${key} changed`);
    }
    const edge=await swipe(true,96,1,0);
    assert.equal(edge.during.moves,0,'edge drag activated page navigation');
    assert.ok(Math.abs(edge.during.bodyLeft-edge.before.page.bodyLeft)<1,'edge drag moved page');
    const vertical=await swipe(true,1,-120);
    assert.ok(vertical.during.top>vertical.before.page.top+30,'native vertical page scrolling blocked');
    return {negative,fixed,edge,vertical,pass:true};
  } finally {
    await page.eval(`(()=>{__hostSurface.removeEventListener('touchstart',__hostStartListener);__hostSurface.style.transform='';const c=__isoCM.plugins.map(p=>p.value?.fenceScroll).find(Boolean);c.stopMomentum();for(const port of c.scrollports.keys())port.style.removeProperty('overflow');for(const row of [...c.rows.keys(),...c.scrollports.keys()])row.dataset.ignoreSwipe='true';__isoCM.scrollDOM.scrollTop=0})()`);
  }
}
module.exports = { runHostSwipe };
