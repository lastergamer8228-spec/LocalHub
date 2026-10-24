/* Reviewed sequential plans. Unreviewed legacy templates remain quarantined.
 * No automatic step retries. A navigation request is not completed playback.
 */
(function (global) {
  'use strict';
  var AI=global.LH_AI=global.LH_AI||{};
  var templates=Object.create(null),contracts=Object.create(null);
  var SUCCESS={read:['OBSERVED','VERIFIED'],prepare:['PREPARED'],navigate:[]};
  var HALT=['FAILED','DENIED','UNAVAILABLE','MODULE_DISABLED','NOT_FOUND','CLARIFICATION_REQUIRED','ACKNOWLEDGED','UNVERIFIED','CANCELLED','TIMED_OUT','UNSUPPORTED'];
  function register(name,create,contract) {
    if(typeof name!=='string' || !name || typeof create!=='function')throw new TypeError('A plan needs a name and template function.');
    templates[name]=create;contracts[name]={reviewed:!!(contract&&contract.reviewed)};
  }
  function detect(text) {
    var t=String(text||'').toLowerCase();
    if(/^play (?:the )?(newest|latest) modified (video|movie)(?: in downloads)?[.!?]*$/.test(t))return 'playNewestModifiedVideo';
    if(/play\s+my\s+last\s+(downloaded\s+)?(movie|video|film)/.test(t))return 'playLastDownloadedMedia';
    if(/(restart|reboot)\s+server\s+then\s+(show|open)\s+logs/.test(t))return 'restartThenLogs';
    if(/(download|get)\s+and\s+open/.test(t))return 'downloadAndOpen';
    if(/organize\s+downloads/.test(t))return 'organizeDownloads';
    return null;
  }
  function planFor(text) {
    var name=detect(text);if(!name || !templates[name])return null;
    return {name:name,reviewed:contracts[name].reviewed===true,steps:templates[name]()};
  }
  function boundedStep(run,ms) {
    var timer;
    return Promise.race([Promise.resolve().then(run),new Promise(function(resolve,reject){
      timer=setTimeout(function(){var error=new Error('Workflow step timed out. No next step was dispatched.');error.code='STEP_TIMEOUT';reject(error);},ms);
    })]).finally(function(){clearTimeout(timer);});
  }
  async function execute(plan,runStep,options) {
    options=options||{};
    var results=[];
    function outcome(ok,status,message,step) {return {ok:ok,status:status,message:message,completed:ok && status==='COMPLETED',failedStep:step,results:results};}
    if(!plan || plan.reviewed!==true || !contracts[plan.name] || contracts[plan.name].reviewed!==true)return outcome(false,'UNREVIEWED','This workflow has not passed its execution review. No steps were run.');
    if(!Array.isArray(plan.steps) || !plan.steps.length || plan.steps.length>20 || typeof runStep!=='function' ||
      plan.steps.some(function(s){return !s || s.reviewed!==true || typeof s.action!=='string' || ['read','prepare','navigate'].indexOf(s.effect)<0;})) {
      return outcome(false,'INVALID_PLAN','The plan contains unknown, unreviewed or mutating steps. No steps were run.');
    }
    var canonical=templates[plan.name](),steps;
    try { steps=JSON.parse(JSON.stringify(plan.steps)); } catch(error) { return outcome(false,'INVALID_PLAN','Plan is not serializable. No steps were run.'); }
    if(JSON.stringify(steps)!==JSON.stringify(canonical))return outcome(false,'INVALID_PLAN','The reviewed plan was changed. No steps were run.');
    steps.forEach(Object.freeze);Object.freeze(steps);
    for(var i=0;i<steps.length;i++) {
      if(options.signal && options.signal.aborted)return outcome(false,'CANCELLED','Workflow cancelled before the next step.',i);
      var step=steps[i],value;
      try { value=await boundedStep(function(){return runStep(step,{index:i,results:results.slice()});},Math.max(10,Math.min(options.stepTimeoutMs||20000,30000))); }
      catch(error) {
        if((options.signal && options.signal.aborted)||error.code==='PLAN_CANCELLED')return outcome(false,'CANCELLED','Workflow cancelled. No further step was dispatched.',i);
        return outcome(false,error.httpStatus===401||error.httpStatus===403||error.code==='SESSION_CHANGED'?'DENIED':error.httpStatus===503?'MODULE_DISABLED':error.code==='STEP_TIMEOUT'?'TIMED_OUT':'FAILED',error.message||'Workflow step failed.',i);
      }
      results.push({step:step,result:value});
      if(options.signal && options.signal.aborted)return outcome(false,'CANCELLED','Workflow cancelled; no next step was dispatched.',i);
      if(!value || value.ok!==true || typeof value.status!=='string')return outcome(false,value&&HALT.indexOf(value.status)>=0?value.status:'INVALID_RESULT',value&&value.message||'Step returned no valid evidence.',i);
      if(value.status==='NAVIGATION_REQUESTED' && step.effect==='navigate') {
        // Never dispatch a dependent step on the assumption that a page opened.
        return outcome(true,'REQUESTED_UNVERIFIED',value.message||'Navigation requested; playback is not confirmed.');
      }
      var compatible=SUCCESS[step.effect];
      if(compatible.indexOf(value.status)<0)return outcome(false,HALT.indexOf(value.status)>=0?value.status:'INVALID_RESULT',value.message||'Step outcome is not verified.',i);
    }
    return outcome(true,'COMPLETED','All reviewed read/preparation steps returned their required results.');
  }
  register('playNewestModifiedVideo',function(){return [
    {action:'listDownloads',effect:'read',reviewed:true},
    {action:'selectNewestModified',effect:'prepare',reviewed:true},
    {action:'checkSelectedFile',effect:'read',reviewed:true},
    {action:'requestPlayer',effect:'navigate',reviewed:true}
  ];},{reviewed:true});
  ['playLastDownloadedMedia','restartThenLogs','downloadAndOpen','organizeDownloads'].forEach(function(name){register(name,function(){return [];},{reviewed:false});});
  AI.TaskPlanner={register:register,detect:detect,planFor:planFor,execute:execute,templates:templates};
})(window);
