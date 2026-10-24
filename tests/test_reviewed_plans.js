/* Contract/planner/runtime integration with real JS modules and mocked HTTP.
 * No Android filesystem mutation, real restart or film playback is tested. */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const files=['action_evidence.js','taskplanner.js','reviewed_workflows.js','assistant_runtime.js'];
const DIR='/storage/emulated/0/Download';let passed=0;
function fixture(){
 const f={requests:[],role:'admin',token:'a',reads:0,files:[
  {name:'old.mp4',path:DIR+'/old.mp4',modified:100,size:20,isDir:false},
  {name:'new.mkv',path:DIR+'/new.mkv',modified:200,size:30,isDir:false}],before:{running:true,port:8080,startedAt:100},after:{running:true,port:8080,startedAt:200}};
 class Clock extends Date{static now(){return 1000000;}}
 const c={Date:Clock,console,Promise,Error,Object,Number,Math,JSON,URLSearchParams,AbortController,setTimeout,clearTimeout,
  location:{search:''},sessionStorage:{getItem(){return f.token;}},localStorage:{getItem(){return null;}},LH_AI:{Commands:{getRole(){return f.role;}}},
  fetch(url,opts){f.requests.push({url,opts});if(f.onRequest)f.onRequest(url,opts);
   let data={ok:true},status=200;
   if(url==='/api/status') {data=f.reads++===0?f.before:(typeof f.after==='function'?f.after(f.reads):f.after);if(f.reads>1&&f.healthFailure)return Promise.reject(new Error('unreachable'));}
   if(url.startsWith('/api/fs/list'))data=f.listing||{path:DIR,files:f.files};
   if(url.startsWith('/api/fs/info'))data=f.info||Object.assign({ok:true},f.files[1]);
   if(f.deniedPath && url.startsWith(f.deniedPath)){status=f.httpStatus||503;data={ok:false};}
   if(opts.method==='POST' && f.postFailure)return Promise.reject(new Error('lost response'));
   if(opts.method==='POST' && f.ack)data=f.ack;
   const response={status,ok:status===200,text:()=>Promise.resolve(JSON.stringify(data))};
   if(f.holdAt && url.startsWith(f.holdAt))return new Promise((resolve,reject)=>{f.release=()=>resolve(response);opts.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
   return Promise.resolve(response);}};
 c.window=c;vm.createContext(c);for(const name of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/src/main/assets/ai',name),'utf8'),c);
 f.c=c;f.ai=c.LH_AI;f.plan=()=>f.ai.TaskPlanner.planFor('play newest modified video in downloads');f.run=()=>f.ai.AssistantRuntime.process('play newest modified video in downloads');return f;
}
async function test(name,run){await run();passed++;console.log('PASS',name);}
(async()=>{
 for(const value of [null,undefined,{ok:false,status:'FAILED'}, {ok:true}, {ok:true,status:'ACKNOWLEDGED'}, {ok:true,status:'UNKNOWN'}, {ok:false,status:'COMPLETED'}, {ok:true,status:'COMPLETED'}, {ok:false,status:'OBSERVED'}]) {
  await test('step stops on invalid/unverified result '+JSON.stringify(value),async()=>{const f=fixture();let calls=0;const r=await f.ai.TaskPlanner.execute(f.plan(),()=>{calls++;return value;});assert.equal(calls,1);assert.equal(r.completed,false);assert.equal(r.ok,false);});
 }
 await test('synchronous throw stops without retry',async()=>{const f=fixture();let calls=0;const r=await f.ai.TaskPlanner.execute(f.plan(),()=>{calls++;throw Error('failed')});assert.equal(calls,1);assert.equal(r.status,'FAILED');});
 await test('rejected promise stops without retry',async()=>{const f=fixture();let calls=0;await f.ai.TaskPlanner.execute(f.plan(),()=>{calls++;return Promise.reject(Error('failed'))});assert.equal(calls,1);});
 await test('unknown/tampered step rejected before any callback',async()=>{const f=fixture();let calls=0;const p=f.plan();p.steps[1].action='deleteFiles';const r=await f.ai.TaskPlanner.execute(p,()=>{calls++});assert.equal(calls,0);assert.equal(r.status,'INVALID_PLAN');});
 await test('mutating step label rejected before dispatch',async()=>{const f=fixture();let calls=0;const p=f.plan();p.steps[1].effect='mutate';await f.ai.TaskPlanner.execute(p,()=>{calls++});assert.equal(calls,0);});
 await test('unreviewed legacy plans never execute',async()=>{const f=fixture();let calls=0;for(const text of ['organize downloads','download and open','restart server then show logs','play my last downloaded movie']){const p=f.ai.TaskPlanner.planFor(text);const r=await f.ai.TaskPlanner.execute(p,()=>{calls++});assert.equal(r.status,'UNREVIEWED');}assert.equal(calls,0);});
 await test('missing registered contract is not trusted',async()=>{const f=fixture();let calls=0;await f.ai.TaskPlanner.execute({name:'fake',reviewed:true,steps:[]},()=>{calls++});assert.equal(calls,0);});
 await test('bounded timeout halts dependent steps',async()=>{const f=fixture();let calls=0;const r=await f.ai.TaskPlanner.execute(f.plan(),()=>{calls++;return new Promise(()=>{})},{stepTimeoutMs:10});assert.equal(r.status,'TIMED_OUT');assert.equal(calls,1);});
 await test('cancel before and during a read blocks next dispatch',async()=>{const f=fixture();let calls=0;const signal={aborted:true};let r=await f.ai.TaskPlanner.execute(f.plan(),()=>{calls++},{signal});assert.equal(calls,0);signal.aborted=false;r=await f.ai.TaskPlanner.execute(f.plan(),()=>{calls++;signal.aborted=true;return {ok:true,status:'OBSERVED'}},{signal});assert.equal(calls,1);assert.equal(r.status,'CANCELLED');});
 await test('plan copy is immune to external edits mid-run',async()=>{const f=fixture();const p=f.plan();let seen=[];const r=await f.ai.TaskPlanner.execute(p,(step)=>{seen.push(step.action);p.steps[1].action='deleteFiles';return {ok:true,status:step.effect==='read'?'OBSERVED':step.effect==='prepare'?'PREPARED':'NAVIGATION_REQUESTED'};});assert(!seen.includes('deleteFiles'));assert.equal(r.status,'REQUESTED_UNVERIFIED');assert.equal(r.completed,false);});
 await test('latest selection sorts real modification time, not listing order',async()=>{const f=fixture();f.files.reverse();f.info=Object.assign({ok:true},f.files[0]);const r=await f.run();assert.equal(r.execution.status,'REQUESTED_UNVERIFIED');assert.equal(r.execution.verified,false);assert(r.openFM.includes('new.mkv'));assert(!r.message.includes('Playing'));assert.equal(f.requests.filter(x=>x.opts.method==='POST').length,0);});
 for(const scenario of ['tie','missing-time','future-time','outside-root','empty-file','name-mismatch','bad-listing','no-videos']) {
  await test('no arbitrary latest-file choice: '+scenario,async()=>{const f=fixture();
   if(scenario==='tie')f.files[0].modified=200;
   if(scenario==='missing-time')delete f.files[0].modified;
   if(scenario==='future-time')f.files[0].modified=1000001;
   if(scenario==='outside-root')f.files[0].path='/private/a.mp4';
   if(scenario==='empty-file')f.files[0].size=0;
   if(scenario==='name-mismatch')f.files[0].name='other.mp4';
   if(scenario==='bad-listing')f.listing={files:f.files};
   if(scenario==='no-videos')f.files=[];
   const r=await f.run();assert.equal(r.ok,false);assert(!r.openFM);assert(!f.requests.some(x=>x.url.startsWith('/api/fs/info')));});
 }
 for(const change of ['size','modified','path','missing']) {
  await test('changed/unverifiable selected file blocks navigation: '+change,async()=>{const f=fixture();f.info=Object.assign({ok:true},f.files[1]);if(change==='size')f.info.size++;if(change==='modified')f.info.modified++;if(change==='path')f.info.path=DIR+'/other.mkv';if(change==='missing')f.info={ok:false,error:'not found'};const r=await f.run();assert.equal(r.ok,false);assert(!r.openFM);});
 }
 await test('module OFF prevents listing workflow',async()=>{const f=fixture();f.deniedPath='/api/fs/media-status';const r=await f.run();assert.equal(r.execution.status,'MODULE_DISABLED');assert(!f.requests.some(x=>x.url.startsWith('/api/fs/list')));assert(!r.openFM);});
 await test('session change during listing prevents navigation',async()=>{const f=fixture();f.onRequest=url=>{if(url.startsWith('/api/fs/list'))f.token='b'};const r=await f.run();assert.equal(r.execution.status,'DENIED');assert(!r.openFM);});
 await test('download-order request asks about modification-time proxy',async()=>{const f=fixture();const r=await f.ai.AssistantRuntime.process('play my last downloaded movie');assert(/cannot prove download order/.test(r.message));assert.equal(f.requests.length,0);});
 await test('restart verified only after later start marker on same port',async()=>{const f=fixture();await f.ai.AssistantRuntime.process('restart server');const r=await f.ai.AssistantRuntime.process('confirm');assert.equal(r.execution.status,'VERIFIED');assert(r.execution.verified);assert.equal(f.requests.filter(x=>x.opts.method==='POST').length,1);assert.equal(r.evidence.afterStartedAt,200);});
 for(const mode of ['same-marker','earlier-marker','wrong-port','stopped','unreachable']) {
  await test('restart not falsely verified: '+mode,async()=>{const f=fixture();if(mode==='same-marker')f.after=f.before;if(mode==='earlier-marker')f.after={running:true,port:8080,startedAt:50};if(mode==='wrong-port')f.after={running:true,port:9090,startedAt:200};if(mode==='stopped')f.after={running:false,port:8080,startedAt:200};if(mode==='unreachable')f.healthFailure=true;await f.ai.AssistantRuntime.process('restart server');const r=await f.ai.AssistantRuntime.process('confirm');assert.equal(r.execution.status,'ACKNOWLEDGED');assert.equal(r.execution.verified,false);assert.equal(f.requests.filter(x=>x.opts.method==='POST').length,1);});
 }
 await test('lost mutation response never retries POST or claims success',async()=>{const f=fixture();f.postFailure=true;await f.ai.AssistantRuntime.process('restart server');const r=await f.ai.AssistantRuntime.process('confirm');assert.equal(r.execution.status,'UNVERIFIED');assert.equal(f.requests.filter(x=>x.opts.method==='POST').length,1);});
 await test('stop acknowledgement is never inferred from unreachable server',async()=>{const f=fixture();f.healthFailure=true;await f.ai.AssistantRuntime.process('stop server');const r=await f.ai.AssistantRuntime.process('confirm');assert.equal(r.execution.status,'ACKNOWLEDGED');assert.equal(f.reads,0);});
 await test('read steps cannot pass on PREPARED label',async()=>{const f=fixture();let calls=0;const r=await f.ai.TaskPlanner.execute(f.plan(),()=>{calls++;return {ok:true,status:'PREPARED'}});assert.equal(calls,1);assert.equal(r.ok,false);});
 await test('navigation ends plan instead of pretending dependent page work finished',async()=>{const f=fixture();f.ai.TaskPlanner.register('navTest',()=>[{action:'a',effect:'read',reviewed:true},{action:'b',effect:'navigate',reviewed:true},{action:'c',effect:'read',reviewed:true}],{reviewed:true});let calls=0;const plan={name:'navTest',reviewed:true,steps:f.ai.TaskPlanner.templates.navTest()};const out=await f.ai.TaskPlanner.execute(plan,s=>{calls++;return {ok:true,status:s.effect==='navigate'?'NAVIGATION_REQUESTED':'OBSERVED'}});assert.equal(calls,2);assert.equal(out.completed,false);});
 await test('direct Intent path cannot bypass legacy-plan quarantine',async()=>{const f=fixture();f.c.performance={now:()=>0};f.ai.Context={set(){},get(){return null;}};f.ai.Capabilities={all(){return[];},hasPermission(){return false;}};vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/src/main/assets/ai/intent.js'),'utf8'),f.c);const r=await f.ai.Intent.process('organize downloads');assert.equal(r.execution.status,'UNREVIEWED');assert.equal(f.requests.length,0);});
 await test('direct Intent uses the same reviewed latest adapter',async()=>{const f=fixture();f.c.performance={now:()=>0};let current='';f.ai.Context={set(k,v){if(k==='currentTask')current=v;},get(){return null;}};f.ai.Capabilities={all(){return[];}};vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/src/main/assets/ai/intent.js'),'utf8'),f.c);const r=await f.ai.Intent.process('play newest modified video in downloads');assert(r.openFM.includes('new.mkv'));assert.equal(r.execution.verified,false);assert.equal(current,null);});
 await test('invalid restart baseline never proves completion',async()=>{const f=fixture();f.before={running:true,port:8080};await f.ai.AssistantRuntime.process('restart server');const r=await f.ai.AssistantRuntime.process('confirm');assert.equal(r.execution.status,'ACKNOWLEDGED');assert.equal(f.reads,1);});
 await test('active reviewed workflow rejects overlapping chat action',async()=>{const f=fixture();f.holdAt='/api/fs/list';const first=f.run();await new Promise(r=>setTimeout(r,5));const other=await f.ai.AssistantRuntime.process('restart server');assert.equal(other.execution.status,'BUSY');assert.equal(f.requests.filter(x=>x.opts.method==='POST').length,0);f.release();const done=await first;assert(done.openFM);});
 await test('chat cancel aborts pending read and prevents player navigation',async()=>{const f=fixture();f.holdAt='/api/fs/list';const first=f.run();await new Promise(r=>setTimeout(r,5));const cancel=await f.ai.AssistantRuntime.process('cancel');assert.equal(cancel.execution.status,'CANCELLED');const stopped=await first;assert.equal(stopped.execution.status,'CANCELLED');assert(!stopped.openFM);assert(!f.requests.some(x=>x.url.startsWith('/api/fs/info')));const status=await f.ai.AssistantRuntime.process('server status');assert.equal(status.execution.status,'OBSERVED');});
 await test('session switch during restart verification does not claim proof',async()=>{const f=fixture();f.onRequest=url=>{if(url==='/api/status' && f.reads===1)f.token='b';};await f.ai.AssistantRuntime.process('restart server');const result=await f.ai.AssistantRuntime.process('confirm');assert.equal(result.execution.status,'ACKNOWLEDGED');assert.equal(result.execution.verified,false);assert.equal(f.requests.filter(x=>x.opts.method==='POST').length,1);});
 console.log('\n'+passed+' reviewed-planner/evidence scenarios passed. HTTP is mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
