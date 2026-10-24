'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const assets=path.join(__dirname,'../app/src/main/assets/ai');
function setup() {
  const f={messages:[],errors:[],actions:[],removed:0,runtimeCalls:0,cognitiveCalls:0,status:200,data:{ok:true}};
  const chat={addMessage(){},save(){return Promise.resolve();},addTyped(role,text){f.messages.push(text);return Promise.resolve();},
    addError(text){f.errors.push(text);},addAction(text){f.actions.push(text);},thinking(){return ()=>{f.removed++;};}};
  const context={console,URLSearchParams,Promise,location:{search:'',protocol:'http:',host:'local.test'},sessionStorage:{getItem(){return 'token-a';}},localStorage:{getItem(){return null;}},
    document:{getElementById(){return null;}},
    LH_AI:{Chat:chat,Commands:{getRole(){return 'admin';}},Memory:{},Context:{recordCommand(){}},
      AssistantRuntime:{process(){f.runtimeCalls++;if(f.throwRuntime)throw new Error('sync engine failure');return f.response || {ok:true,message:'Request acknowledged, not completed.',execution:{status:'ACKNOWLEDGED'}};}},
      Cognitive:{process(){f.cognitiveCalls++;return Promise.resolve({ok:true,message:'legacy'});}}},
    fetch(url,opts){f.lastRequest={url,opts};if(f.networkFail)return Promise.reject(new Error('offline'));
      return Promise.resolve({ok:f.status===200,status:f.status,json:()=>Promise.resolve(f.data)});}};
  context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(assets,'brain.js'),'utf8'),context);
  f.brain=context.LH_AI.Brain;f.brain.recordCommand=()=>{};f.brain.refreshDiagnostics=()=>{};f.context=context;return f;
}
const flush=()=>new Promise(r=>setTimeout(r,5));
(async()=>{
  let f=setup();f.brain.handleUserMessage('restart server');await flush();assert.equal(f.runtimeCalls,1);assert.equal(f.cognitiveCalls,0);assert.equal(f.messages.length,1);assert.equal(f.removed,1);
  f=setup();f.throwRuntime=true;f.brain.handleUserMessage('hello');await flush();assert.equal(f.errors[0],'sync engine failure');assert(f.removed>=1);
  for(const status of [401,403,503]) {f=setup();f.status=status;f.data={ok:false};let r=await f.brain.runAction('server/clear-logs');assert.equal(r.ok,false);assert.equal(f.actions.length,0);assert.equal(f.lastRequest.opts.headers.Authorization,'Bearer token-a');}
  f=setup();f.data={ok:false,error:'failed'};assert.equal((await f.brain.runAction('server/clear-logs')).ok,false);
  f=setup();f.data={};assert.equal((await f.brain.runAction('server/clear-logs')).ok,false);
  f=setup();let r=await f.brain.runAction('server/clear-logs');assert.equal(r.execution.status,'ACKNOWLEDGED');assert.equal(r.execution.verified,false);assert(!f.actions.some(x=>/done\./i.test(x)));
  f=setup();f.networkFail=true;r=await f.brain.runAction('server/restart');assert.equal(r.execution.status,'UNVERIFIED');
  // Load actual capability metadata, not a permission stub.
  f=setup();vm.runInContext(fs.readFileSync(path.join(assets,'capabilities.js'),'utf8'),f.context);
  const caps=f.context.LH_AI.Capabilities;
  f.context.LH_AI.Commands.getRole=()=> 'user';assert(!caps.hasPermission(caps.lookup('server.restart')));assert(!caps.hasPermission(caps.lookup('logs.show')));assert(caps.hasPermission(caps.lookup('media.play')));
  f.context.LH_AI.Commands.getRole=()=> 'admin';assert(caps.hasPermission(caps.lookup('server.restart')));
  f.context.LH_AI.Commands.getRole=()=> null;assert(!caps.hasPermission(caps.lookup('logs.clear')));assert(!caps.hasPermission(caps.lookup('media.play')));assert(caps.hasPermission(caps.lookup('server.status')));
  // Media commands from a prior page/session must not replay forever on boot.
  let stored;const c={LH_AI:{},localStorage:{getItem(){return stored;},setItem(k,v){if(k==='lhmc')stored=v;}}};c.window=c;vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(assets,'media.js'),'utf8'),c);
  c.LH_AI.MediaBridge.send('pause',{targetFile:'/a.mp4'});assert.equal(c.LH_AI.MediaBridge.read().params.targetFile,'/a.mp4');
  c.localStorage.setItem=()=>{throw new Error('storage denied');};assert.equal(c.LH_AI.MediaBridge.send('pause').dispatched,false);
  stored=JSON.stringify({cmd:'pause',ts:Date.now()-16000});assert.equal(c.LH_AI.MediaBridge.read(),null);
  stored=JSON.stringify({cmd:'pause',ts:Date.now()+10000});assert.equal(c.LH_AI.MediaBridge.read(),null);
  console.log('PASS actual Brain entry, sync-failure cleanup, authenticated status-aware legacy transport, role metadata and bridge command freshness. Dependencies are mocked.');
})().catch(error=>{console.error(error);process.exitCode=1;});
