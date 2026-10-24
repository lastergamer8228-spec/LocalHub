'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
class E {constructor(){this.style={};this.listeners={};this.children=[];this.paused=false;}setAttribute(){}appendChild(e){this.children.push(e);}addEventListener(n,f){this.listeners[n]=f;}pause(){this.paused=true;}}
const media=new E(),wrap=new E();let interval,status=200,networkFail=false;
const ctx={document:{getElementById(id){return id==='media'?media:wrap;},createElement(){return new E();}},window:{addEventListener(){}},location:{search:''},sessionStorage:{getItem(){return 't';}},localStorage:{getItem(){return null;}},URLSearchParams,
 fetch(){return networkFail?Promise.reject(new Error('offline')):Promise.resolve({status,ok:status===200,text:()=>Promise.resolve('Module disabled: core.media')});},setInterval(f){interval=f;return 1;},clearInterval(){}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/src/main/assets/dashboard/module-access.js'),'utf8'),ctx);
const flush=()=>new Promise(r=>setTimeout(r,5));
(async()=>{await flush();assert(!media.paused);
 status=503;interval();await flush();assert(media.paused);assert.equal(wrap.children[0].style.display,'flex');
 media.paused=false;media.listeners.play();assert(media.paused);
 status=200;interval();await flush();assert.equal(wrap.children[0].style.display,'none');assert(media.paused);
 media.paused=false;networkFail=true;interval();await flush();assert(!media.paused);
 networkFail=false;status=401;interval();await flush();assert(media.paused);assert.equal(wrap.children[0].style.display,'flex');
 console.log('PASS: already-open player pauses on module OFF/denied session; re-enable does not auto-play; transient network failure is not treated as OFF.');
})().catch(e=>{console.error(e);process.exitCode=1;});
