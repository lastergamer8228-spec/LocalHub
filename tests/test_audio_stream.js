'use strict';
const fs=require('fs'), vm=require('vm'), assert=require('assert');
class Element {
 constructor(){this.style={};this.listeners={};this.children=[];this.dataset={};this.classList={add(){},remove(){}};this.value='0';this.textContent='';}
 addEventListener(n,f){(this.listeners[n] ||= []).push(f);}
 emit(n){for(const f of this.listeners[n]||[]) f(); const h=this['on'+n];if(h)h();}
 appendChild(e){this.children.push(e);return e;}
 setAttribute(){} removeAttribute(n){this[n]='';} querySelector(s){return this.parts?.[s]||null;}
}
class Media extends Element {
 constructor(){super();this.paused=true;this.muted=false;this.currentTime=5;this.duration=145;this.readyState=2;this.volume=.8;this.playbackRate=1;this.src='ORIGINAL_VIDEO';}
 pause(){if(!this.paused){this.paused=true;this.emit('pause');}}
 play(){if(this === audio && blockPlay) return Promise.reject(new DOMException('Gesture required','NotAllowedError'));if(this.paused){this.paused=false;this.emit('play');}return Promise.resolve();}
 load(){if(this.src)queueMicrotask(()=>{this.readyState=2;this.emit('loadedmetadata');this.emit('canplay');});}
}
const video=new Media(), wrap=new Element(), menu=new Element(), audioMenu=new Element();
video.readyState=4; video.paused=false;
let blockPlay=!!process.env.TEST_BLOCK;
let panel,audio,tick;const calls=[];let count=0;
const doc={
 getElementById(id){return {'media':video,'video-wrap':wrap,'audio-menu':audioMenu,'settings-pop':new Element()}[id];},
 querySelector(s){return s==='#audio-menu'?audioMenu:menu;},querySelectorAll(){return [];},
 createElement(tag){if(tag==='audio'){audio=new Media();return audio;}
  const el=new Element();if(tag==='div'){panel=el;panel.parts={};for(const c of ['.status','select','.mclose','.enable','.retry','.original','.detect','.technical'])panel.parts[c]=new Element();}return el;}
};
const ctx={document:doc,window:{addEventListener(){}},location:{search:'?file=%2Fstorage%2Fmovie.mkv'},sessionStorage:{getItem(){return 'TOKEN';}},localStorage:{getItem(){return null;},setItem(){}},
 setTimeout,clearTimeout,URLSearchParams,Map,Number,Math,isFinite,Promise,Error,DOMException,AbortController,MutationObserver:class{observe(){}},
 setInterval(f){tick=f;return 1;},clearInterval(){},URL:{createObjectURL(){return 'blob:'+ ++count;},revokeObjectURL(){}},
 fetch(url){calls.push(url);return Promise.resolve({ok:!process.env.TEST_DENIED,status:401,text:()=>Promise.resolve('401 Unauthorized'),blob:()=>Promise.resolve({}),json:()=>Promise.resolve({tracks:[{track:0,codec:process.env.TEST_CODEC || 'ac3',language:'hin',channels:6}]})});}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../app/src/main/assets/dashboard/compatible-audio.js'),'utf8'),ctx);
const flush=()=>new Promise(r=>setTimeout(r,15));
(async()=>{
 await flush();
 assert(calls.some(u=>u.includes('audio-tracks')));
 if(process.env.TEST_DENIED) { assert(!ctx.window.LH_AUDIO.active); assert(!calls.some(u=>u.includes('audio-chunk')));assert.equal(video.src,'ORIGINAL_VIDEO');console.log('PASS: denied track access leaves original video untouched; no chunk requests.');return; }
 assert(panel.parts.select.children.some(o=>o.textContent==='Hindi'));
 if(process.env.TEST_BLOCK) { assert(video.paused);assert(panel.parts['.status'].textContent.includes('Tap to play'));blockPlay=false;panel.parts['.retry'].onclick();await flush(); }
 if(process.env.TEST_CODEC === 'aac') { assert(!ctx.window.LH_AUDIO.active);assert(!calls.some(u=>u.includes('audio-chunk')));console.log('PASS: supported AAC uses original playback automatically, friendly Hindi language label.');return; }
 assert(ctx.window.LH_AUDIO.active);assert.equal(video.src,'ORIGINAL_VIDEO');assert(video.muted);assert.equal(audio.currentTime,5);assert(!audio.paused);assert(!video.paused);
 assert(calls.some(u=>u.includes('start=0')));assert(calls.some(u=>u.includes('start=60')));
 ctx.window.LH_AUDIO.settings(.4,true);assert.equal(audio.volume,.4);assert(audio.muted);
 ctx.window.LH_AUDIO.settings(.4,false);assert(!audio.muted);assert(video.muted);
 video.pause();assert(audio.paused);
 video.currentTime=125;video.emit('seeked');await flush();
 assert(calls.some(u=>u.includes('start=120')));assert.equal(audio.currentTime,5);assert(video.paused);
 panel.parts['.retry'].onclick();await flush();assert(!video.paused);assert(!audio.paused);
 video.currentTime=128;audio.currentTime=5;tick();assert.equal(audio.currentTime,8);
 panel.parts['.original'].onclick();assert(!ctx.window.LH_AUDIO.active);assert(!video.muted);assert(audio.paused);assert.equal(video.src,'ORIGINAL_VIDEO');
 assert(calls.every(u=>!u.includes('audio-prepare')));
 console.log('PASS: automatic AC-3 adaptation without clicking Detect/Start, language names, mocked start/prefetch, original video unchanged, mute/volume, pause, seek, retry, drift correction, restore and no full-file conversion.');
})().catch(e=>{console.error(e);process.exitCode=1;});
