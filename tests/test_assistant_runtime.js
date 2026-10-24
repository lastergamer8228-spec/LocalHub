/* Reviewed assistant/brain boundary tests; downstream engines and HTTP are mocks.
 * These are not end-to-end Android execution or proof of general intelligence. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/ai/assistant_runtime.js'),'utf8');
let passed=0;
function fixture() {
  const f={now:1000000,role:'admin',token:'session-a',requests:[],delegated:[],sent:[],storage:{},focused:null};
  class Clock extends Date {static now(){return f.now;}}
  const context={Date:Clock,URLSearchParams,AbortController,setTimeout,clearTimeout,Number,Promise,Error,Object,
    location:{search:''},sessionStorage:{getItem(){return f.token;}},localStorage:{getItem(k){return f.storage[k]||null;}},
    LH_AI:{Commands:{getRole(){return f.role;}},Context:{get(){return f.focused;}},
      MediaBridge:{send(cmd,params){f.sent.push({cmd,params});}},
      Cognitive:{process(text,opts){f.delegated.push(text);f.delegateOptions=opts;return Promise.resolve(f.legacy || {ok:true,message:'Existing reply'});}}},
    fetch(url,opts){f.requests.push({url,opts});if(f.failure)return Promise.reject(new Error('network lost'));
      const status=f.status||200;const data=f.data || (opts.method==='POST'||url.includes('/media-status')?{ok:true}:{running:true,port:8080});
      if(f.onRequest)f.onRequest();return Promise.resolve({ok:status>=200&&status<300,status,text:()=>Promise.resolve(typeof data==='string'?data:JSON.stringify(data))});}};
  context.window=context;vm.createContext(context);vm.runInContext(source,context);f.context=context;f.runtime=context.LH_AI.AssistantRuntime;return f;
}
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
(async()=>{
  for(const text of ['How do I restart server?','what happens if I stop server','explain delete files','can you explain how to stop server','is it safe to restart server?','can I restart server?','say restart server','server restart kaise kare','please can you explain restart server','how to clear logs','show me how to restart server','how do I stop video','how to pause music','explain open media player','how to resume playback','why would I play this video']) {
    await test('no action for explanation: '+text,async()=>{const f=fixture(),r=await f.runtime.process(text);assert.equal(r.execution.status,'INFORMATION');assert.equal(f.requests.length,0);assert.equal(f.delegated.length,0);});
  }
  for(const text of ["don't restart server",'do not delete files','please do not stop video','server restart mat karo']) {
    await test('negation: '+text,async()=>{const f=fixture(),r=await f.runtime.process(text);assert.equal(r.execution.status,'NO_ACTION');assert.equal(f.requests.length,0);assert.equal(f.delegated.length,0);});
  }
  for(const text of ['stop','stop it','open that','play','delete it','move this','isko band karo']) {
    await test('ambiguous target: '+text,async()=>{const f=fixture(),r=await f.runtime.process(text);assert.equal(r.execution.status,'CLARIFICATION_REQUIRED');assert.equal(f.requests.length,0);assert.equal(f.sent.length,0);assert.equal(f.delegated.length,0);});
  }
  for(const text of ['restart server and show logs','organize downloads','download and open','play my last downloaded movie']) {
    await test('unreviewed workflow quarantined: '+text,async()=>{const f=fixture(),r=await f.runtime.process(text);assert.equal(r.execution.status,'CLARIFICATION_REQUIRED');assert.equal(f.requests.length,0);assert.equal(f.delegated.length,0);});
  }
  for(const text of ['restart server','stop server','start server','clear logs','clear cache','please can you restart server please','server band karo','server chalu karo','server restart karo','turn off the server']) {
    await test('confirm then one acknowledged request: '+text,async()=>{const f=fixture();const p=await f.runtime.process(text);assert.equal(p.execution.status,'CONFIRMATION_REQUIRED');assert.equal(f.requests.length,0);
      const r=await f.runtime.process('confirm');assert.equal(r.execution.status,'ACKNOWLEDGED');assert.equal(r.execution.verified,false);assert.equal(f.requests.filter(x=>x.opts.method==='POST').length,1);assert.equal(f.requests.find(x=>x.opts.method==='POST').opts.headers.Authorization,'Bearer session-a');
      await f.runtime.process('confirm');assert.equal(f.requests.filter(x=>x.opts.method==='POST').length,1);});
  }
  for(const kind of ['expiry','cancel','unrelated','role-change','session-change']) {
    await test('confirmation invalidation: '+kind,async()=>{const f=fixture();await f.runtime.process('stop server');
      if(kind==='expiry')f.now+=61000;
      if(kind==='cancel')await f.runtime.process('cancel');
      if(kind==='unrelated')await f.runtime.process('hello');
      if(kind==='role-change')f.role='user';
      if(kind==='session-change')f.token='session-b';
      await f.runtime.process('yes');assert.equal(f.requests.filter(x=>x.opts.method==='POST').length,0);});
  }
  await test('cancel after dispatch never claims undo',async()=>{const f=fixture();await f.runtime.process('restart server');await f.runtime.process('confirm');const r=await f.runtime.process('cancel');assert.equal(r.execution.status,'NO_ACTION');assert(/cannot be undone/.test(r.message));assert.equal(f.requests.filter(x=>x.opts.method==='POST').length,1);});
  await test('confirmation requires a current session identity',async()=>{const f=fixture();f.token='';const r=await f.runtime.process('restart server');assert.equal(r.execution.status,'DENIED');assert.equal(f.requests.length,0);});
  await test('opts.role cannot elevate a standard account',async()=>{const f=fixture();f.role='user';const r=await f.runtime.process('restart server',{role:'admin'});assert.equal(r.execution.status,'DENIED');assert.equal(f.requests.length,0);});
  for(const status of [401,403,503]) {
    await test('server HTTP failure is not success: '+status,async()=>{const f=fixture();f.status=status;await f.runtime.process('restart server');const r=await f.runtime.process('confirm');assert.equal(r.ok,false);assert.equal(r.execution.verified,false);assert.equal(f.requests.filter(x=>x.opts.method==='POST').length,1);});
  }
  await test('missing server acknowledgement is rejected',async()=>{const f=fixture();f.data={};await f.runtime.process('restart server');const r=await f.runtime.process('confirm');assert.equal(r.execution.status,'FAILED');});
  await test('lost mutation response is uncertain and never auto-retried',async()=>{const f=fixture();f.failure=true;await f.runtime.process('restart server');const r=await f.runtime.process('yes');assert.equal(r.execution.status,'UNVERIFIED');assert.equal(f.requests.filter(x=>x.opts.method==='POST').length,1);assert(/may or may not/.test(r.message));});
  await test('server status observed from current response',async()=>{const f=fixture();const r=await f.runtime.process('server status');assert.equal(r.execution.status,'OBSERVED');assert(r.execution.verified);assert.equal(f.requests.length,1);assert.equal(f.requests[0].opts.method,'GET');});
  await test('malformed status is not verified',async()=>{const f=fixture();f.data={ok:true};const r=await f.runtime.process('server status');assert.equal(r.execution.status,'FAILED');});
  for(const mode of ['missing','stale','future','mismatch']) {
    await test('media context check: '+mode,async()=>{const f=fixture();if(mode!=='missing')f.storage.lhmedia_status=JSON.stringify({file:'/storage/a.mp4',ts:f.now+(mode==='future'?1:mode==='stale'?-16000:0)});
      if(mode==='mismatch')f.focused={path:'/storage/b.mp4'};const r=await f.runtime.process('pause');assert.equal(r.execution.status,'CLARIFICATION_REQUIRED');assert.equal(f.sent.length,0);});
  }
  await test('fresh media targets one file, not verified playback',async()=>{const f=fixture();f.storage.lhmedia_status=JSON.stringify({file:'/storage/a.mp4',ts:f.now});const r=await f.runtime.process('pause');assert.equal(r.execution.status,'REQUESTED_UNVERIFIED');assert.equal(f.sent[0].params.targetFile,'/storage/a.mp4');assert.equal(r.execution.verified,false);assert.equal(f.delegated.length,0);});
  await test('undelivered storage command is not called sent',async()=>{const f=fixture();f.storage.lhmedia_status=JSON.stringify({file:'/storage/a.mp4',ts:f.now});f.context.LH_AI.MediaBridge.send=()=>({dispatched:false});const r=await f.runtime.process('pause');assert.equal(r.execution.status,'FAILED');assert.equal(r.execution.verified,false);});
  await test('module OFF blocks bridge dispatch',async()=>{const f=fixture();f.status=503;f.storage.lhmedia_status=JSON.stringify({file:'/storage/a.mp4',ts:f.now});const r=await f.runtime.process('resume');assert.equal(r.execution.status,'MODULE_DISABLED');assert.equal(f.sent.length,0);});
  await test('session switch during media check does not send command',async()=>{const f=fixture();f.storage.lhmedia_status=JSON.stringify({file:'/storage/a.mp4',ts:f.now});f.onRequest=()=>{f.token='session-b';};const r=await f.runtime.process('pause');assert.equal(r.execution.status,'DENIED');assert.equal(f.sent.length,0);});
  for(const r of ['user','admin']) await test('file mutation not delegated during review: '+r,async()=>{const f=fixture();f.role=r;await f.runtime.process('delete /storage/a.txt');assert.equal(f.delegated.length,0);assert.equal(f.requests.length,0);});
  await test('media module disabled blocks opening/search delegate',async()=>{const f=fixture();f.status=503;const r=await f.runtime.process('play movie title');assert.equal(r.execution.status,'MODULE_DISABLED');assert.equal(f.delegated.length,0);});
  await test('malformed media availability cannot dispatch transport',async()=>{const f=fixture();f.data={};f.storage.lhmedia_status=JSON.stringify({file:'/storage/a.mp4',ts:f.now});const r=await f.runtime.process('pause');assert.equal(r.execution.status,'FAILED');assert.equal(f.sent.length,0);});
  for(const text of ["play 'Stop and Restart' movie",'play stop and restart','tell me about the movie \"Restart Server\"']) await test('title is not a server action: '+text,async()=>{const f=fixture();const r=await f.runtime.process(text);assert.equal(f.delegated.length,1);assert.equal(f.requests.filter(x=>x.opts.method==='POST').length,0);});
  await test('ordinary conversation preserves existing engine',async()=>{const f=fixture();const r=await f.runtime.process('hello');assert.equal(f.delegated.length,1);assert.equal(f.delegateOptions.remember,false);assert.equal(r.execution.status,'LEGACY_UNVERIFIED');});
  await test('player navigation is requested, not playing',async()=>{const f=fixture();f.legacy={ok:true,message:'Playing!',openFM:'/player?file=movie'};const r=await f.runtime.process('play movie title');assert.equal(r.execution.status,'NAVIGATION_REQUESTED');assert(/not yet/.test(r.message));});
  await test('invalid legacy result cannot claim completion',async()=>{const f=fixture();f.legacy={ok:true};const r=await f.runtime.process('hello');assert.equal(r.execution.status,'FAILED');});
  console.log('\n'+passed+' assistant-runtime scenarios passed. HTTP/brain dependencies are mocked.');
})().catch(error=>{console.error(error);process.exitCode=1;});
