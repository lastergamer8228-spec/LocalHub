/* Staged assistant execution boundary. Deterministic rules, not an LLM.
 * Reviewed intents are handled here; remaining requests use the existing engine.
 * Client checks are UX guardrails. Server authentication/module policy remains
 * authoritative. No Personal Brain or Self-Healing internals are modified.
 */
(function (global) {
  'use strict';
  var AI = global.LH_AI = global.LH_AI || {};
  var pending = null, activePlan = null, healthFocus = null;
  var CONFIRM_MS = 60000;
  var MEDIA_CONTEXT_MS = 15000;

  function normalize(text) {
    return String(text || '').trim().replace(/\s+/g, ' ')
      .replace(/^(?:(?:please|can you|could you|would you)\s+)+/i, '')
      .replace(/\s+please[?!.]*$/i, '')
      .replace(/[?!.]+$/, '').toLowerCase();
  }
  function token() {
    try {
      return AI.token || new URLSearchParams(global.location.search).get('token') ||
        global.sessionStorage.getItem('lhtoken') || global.localStorage.getItem('lhtoken') || '';
    } catch (e) { return ''; }
  }
  function role() { return AI.Commands && AI.Commands.getRole ? AI.Commands.getRole() : null; }
  function owner() { return String(role() || 'guest') + ':' + token(); }
  function result(status, message, intent, extras) {
    var value = {ok: !/^(FAILED|DENIED|MODULE_DISABLED|UNAVAILABLE)$/.test(status), message: message,
      execution: {status: status, intent: intent || 'UNCLASSIFIED', verified: status === 'OBSERVED' || status === 'VERIFIED'}};
    return Object.assign(value, extras || {});
  }
  function inspect(text) {
    var t = normalize(text);
    if (!t) return {kind:'EMPTY', rule:'empty-input'};
    if (/^(cancel|never mind|nevermind|rehne do|cancel karo)$/.test(t)) return {kind:'CANCEL', rule:'explicit-cancel'};
    if (/^(yes|confirm|proceed|haan|ha|yes proceed)$/.test(t)) return {kind:'CONFIRM', rule:'explicit-confirmation'};
    if (/^(?:do not|don't|dont|never|mat)\b/.test(t) || /\bmat karo$/.test(t)) return {kind:'NO_ACTION', rule:'negation'};
    var semantic = t.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '[quoted]');
    if (/^(?:explain|describe|what|how|tell me)\b/.test(t) && /self[- ]?healing|system integration|connected.*system|system.*connected|repair capabilities|patch|deploy|rollback|(?:fix|repair|heal).*\b(?:system|localhub)\b|what.*(?:fix|repair)/.test(t) || /^(?:system integration|self[- ]?healing)(?: samjhao)?$/.test(t)) return {kind:'SYSTEM_MAP',rule:'host-backed-integration-explanation'};
    if (/^self[- ]?heal(?:ing)?(?: engine)? (?:status|health|check)$/.test(t)) return {kind:'SYSTEM_MAP',rule:'integration-policy-not-unverified-legacy-engine-claims'};
    if (/^(?:check (?:localhub|system)(?: health)?|(?:localhub|system) health|health check|diagnose(?: (?:localhub|system))?|scan for problems|check health)$/.test(t) || /^(?:why|explain|what happened).*(?:server|localhub).*(?:crash|fail|error|down|stopped)/.test(t)) return {kind:'HEALTH_SCAN',rule:'current-host-observations-not-guessed-root-cause'};
    if (/^(?:fix|repair|heal|recover) (?:the )?(?:localhub|system|server problems)(?: automatically)?$/.test(t) || /^(?:system|localhub)(?: ko)? (?:thik|fix) karo$/.test(t)) return {kind:'HEALTH_RECOVERY',rule:'bounded-read-recovery-only'};
    if (/^(?:fix|repair|heal|resolve)\b/.test(t) || /^isko thik karo$/.test(t)) return {kind:'HEALTH_FOLLOWUP',rule:'requires-recent-health-topic'};
    if (/^(?:(?:run|start) )?(?:self[- ]?healing|self[- ]?heal|auto repair)$/.test(t)) return {kind:'HEALTH_RECOVERY',rule:'reviewed-read-recovery-not-legacy-patching'};
    if (/^(enable|disable|turn on|turn off|set).*?(self[- ]?heal|guardian|autonomy|repair policy)/.test(t)) return {kind:'REPAIR_REVIEW',rule:'legacy-autonomy-policy-not-changed'};
    if ((/^(approve|deploy|apply|rollback|undo|restore|test|verify|build|assemble|install)\b/.test(t) && /fix|patch|repair|backup|device|apk|app|localhub|build|regression/.test(t)) || /^(continue|resume) (?:the )?(goal|task)$/.test(t)) return {kind:'REPAIR_REVIEW',rule:'legacy-mutation-repair-path-not-reviewed'};
    if (/^(?:why did (?:it|this)\b.*|what went wrong|explain (?:the )?(?:crash|error|failure))$/.test(t)) return {kind:'HEALTH_CAUSE_QUERY',rule:'no-arbitrary-historical-incident-or-guessed-cause'};
    if (/^(?:what did you find|health report|explain findings|show health report)$/.test(t)) return {kind:'HEALTH_REPORT',rule:'same-session-recent-observation-recall'};
    var operation = /\b(restart|reboot|stop|start|delete|remove|move|rename|organize|clear|play|pause|resume|open|copy|write|create)\b/.test(semantic);
    var explanatory = /^(what|why|how|explain|define|tell me|show me how|i want to know|if i|if you|is it|should i|can i|do i|say|repeat|translate|quote|meaning of)\b/.test(t) || /\b(kya hota|kaise|matlab)\b/.test(t);
    if (operation && explanatory) return {kind:'EXPLANATION', rule:'operation-question-not-execution'};
    if (/^(stop|restart|delete|remove|move|open|play|band karo)(?:\s+(it|that|this|the thing|isko|usse))?$/.test(t) ||
        /^(ise|isko|usse)\s+(band|delete|open|play)(?:\s+karo)?$/.test(t)) {
      return {kind:'CLARIFY', rule:'missing-or-ambiguous-target'};
    }
    if (/^play (?:the )?(newest|latest) modified (video|movie)(?: in downloads)?$/.test(t)) return {kind:'LATEST_MODIFIED',rule:'explicit-modification-time-criterion'};
    if ((/^(restart|stop|delete|move|organize|download|get)\b/.test(semantic) && /\b(and|then|also|aur|phir)\b/.test(semantic)) || /\b(and|then)\s+(restart|stop|start)\s+(?:the )?server\b/.test(semantic) || /^organize downloads$/.test(t) || /\bplay\s+my\s+last\s+(?:downloaded\s+)?(movie|video|film)\b/.test(t)) {
      return {kind:'WORKFLOW_REVIEW', rule:'multi-step-action-not-reviewed'};
    }
    var cleanup=t.match(/^(?:clear|delete) (?:the )?(logs|cache)$/);
    if(cleanup) return {kind:'SERVER_ACTION',action:'clear-'+cleanup[1],rule:'explicit-server-maintenance'};
    var serverAlias = /^(?:turn off (?:the )?server|server band karo)$/.test(t) ? 'stop' : /^(?:turn on (?:the )?server|server chalu karo)$/.test(t) ? 'start' : /^server restart karo$/.test(t) ? 'restart' : null;
    if(serverAlias) return {kind:'SERVER_ACTION',action:serverAlias,rule:'explicit-server-alias'};
    var server = t.match(/^(restart|reboot|stop|start)(?: the)? server(?: now)?$/) || t.match(/^server (restart|reboot|stop|start)$/);
    if (server) return {kind:'SERVER_ACTION', action:server[1] === 'reboot' ? 'restart' : server[1], rule:'explicit-server-target'};
    if (/^(?:show |get |check )?(?:the )?server status$/.test(t)) return {kind:'SERVER_STATUS', rule:'explicit-status-query'};
    if (/^(?:pause|pause (?:the )?(?:video|movie|audio|music|playback)|pause it|video pause karo)$/.test(t)) return {kind:'MEDIA_CONTROL', action:'pause', rule:'explicit-media-transport'};
    if (/^(?:resume|resume (?:the )?(?:video|movie|audio|music|playback)|resume it|unpause|continue playback)$/.test(t)) return {kind:'MEDIA_CONTROL', action:'resume', rule:'explicit-media-transport'};
    if (/^(?:stop (?:the )?(?:video|audio|music|playback)|video band karo)$/.test(t)) return {kind:'MEDIA_CONTROL', action:'stop', rule:'explicit-media-target'};
    if (/^(delete|remove|move|rename|organize|extract|unzip|compress|zip)\b/.test(t) || (/^(copy|write|create|make)\b/.test(t) && /\b(files?|folders?|directory)\b/.test(t))) return {kind:'FILE_ACTION', rule:'file-mutation-existing-pipeline'};
    if (/^(play|watch)\s+.+/.test(t) || /^open (?:the )?(media|video) player$/.test(t)) return {kind:'MEDIA_OPEN',rule:'media-open-requires-live-module-access'};
    return {kind:'DELEGATE', rule:'not-yet-reviewed-intent'};
  }
  function explanation(text) {
    if (/\b(video|movie|audio|music|playback|media)\b/i.test(text) && /\b(play|pause|resume|stop|open)\b/i.test(text)) return 'Use the player controls to play, pause or resume media. You can also request a specific video by name. This explanation has not changed playback.';
    if (/\b(restart|reboot)\b/i.test(text)) return 'Restarting the server closes and reopens its listener. Browsers may disconnect briefly. You can do this in native Settings; no restart was performed by this explanation.';
    if (/\bstop\b/i.test(text)) return 'Stopping the server disconnects its browser clients. Start it again from the phone controller. I have not stopped anything.';
    if (/\bclear\b/i.test(text)) return 'Clearing logs or cache removes stored server data. Review the maintenance action first. Nothing was cleared by this explanation.';
    if (/\b(delete|remove)\b/i.test(text)) return 'Deleting a file can be irreversible. Select the exact file and review the confirmation in File Manager. This explanation has not deleted anything.';
    return 'That is a file/server operation. Specify the exact target when you want to perform it; this question has not executed an action.';
  }
  function request(path, method, timeoutMs, externalSignal) {
    var abort = new AbortController();
    function cancelRequest(){abort.abort();}
    if(externalSignal) { if(externalSignal.aborted)cancelRequest();else externalSignal.addEventListener('abort',cancelRequest,{once:true}); }
    var timeout = setTimeout(function(){abort.abort();}, timeoutMs || 8000);
    var headers = {'Accept':'application/json'};
    var auth = token(); if (auth) headers.Authorization = 'Bearer ' + auth;
    if (method === 'POST') headers['Content-Type'] = 'application/json';
    return Promise.resolve().then(function(){
      return global.fetch((AI.baseUrl || '') + path, {method:method || 'GET', headers:headers,
        body:method === 'POST' ? '{}' : undefined, signal:abort.signal, cache:'no-store'});
    }).then(function(response){
      return response.text().then(function(text){
        var data; try { data = JSON.parse(text); } catch(e) { data = {}; }
        if(!data || typeof data!=='object' || Array.isArray(data))data={};
        if (!response.ok || data.ok === false) {
          var error = new Error(response.status === 401 ? 'Please sign in again before using this action.' :
            response.status === 403 ? 'Your account or device is not allowed to use this feature.' :
            response.status === 503 ? 'This feature is disabled or unavailable in the phone controller.' :
            (data.error || data.message || 'The server did not accept the request.'));
          error.httpStatus = response.status; throw error;
        }
        return data;
      });
    }).finally(function(){clearTimeout(timeout);if(externalSignal)externalSignal.removeEventListener('abort',cancelRequest);});
  }
  function failure(error, intent, mutation) {
    var status = error.httpStatus === 401 || error.httpStatus === 403 ? 'DENIED' :
      error.httpStatus === 503 ? 'MODULE_DISABLED' : mutation ? 'UNVERIFIED' : 'FAILED';
    return result(status, error.httpStatus ? error.message : mutation ?
      'The response was lost. The action may or may not have reached the server. Check the phone controller before trying again; I will not retry automatically.' :
      'I could not reach the server. No action was sent by this check.', intent);
  }
  async function executeServer(action) {
    if (role() !== 'admin') return result('DENIED','Server control requires an administrator account.','SERVER_ACTION');
    var identity=owner(),baseline=null;
    if(action==='restart') {
      try { baseline=await request('/api/status','GET',1000); } catch(error) { /* missing baseline cannot prove restart */ }
    }
    if(identity!==owner() || role()!=='admin')return result('DENIED','The session changed. Please state the server request again.','SERVER_ACTION');
    try {
      var data=await request('/api/server/'+action,'POST'); // exactly one mutation request
      if(data.ok!==true)return result('FAILED','The server did not return a valid acknowledgement. Completion is not being claimed.','SERVER_ACTION');
      if(action==='restart' && AI.ActionEvidence && AI.ActionEvidence.validStatus(baseline)) {
        for(var i=0;i<3;i++) {
          if(identity!==owner())break;
          await new Promise(function(resolve){setTimeout(resolve,200);});
          var observed=null;
          try { observed=await request('/api/status','GET',1000); } catch(error) { /* unreachable is not completion evidence */ }
          if(identity!==owner())break;
          if(AI.ActionEvidence.restarted(baseline,observed))return result('VERIFIED',
            'Observed a new server listener start on port '+observed.port+' after the restart request.','SERVER_ACTION',
            {accepted:true,evidence:{beforeStartedAt:baseline.startedAt,afterStartedAt:observed.startedAt,port:observed.port}});
        }
      }
      return result('ACKNOWLEDGED','The server accepted the '+action+' request. Completion is not yet verified; check the phone controller.','SERVER_ACTION',{accepted:true});
    } catch(error) { return failure(error,'SERVER_ACTION',true); }
  }
  function mediaControl(action) {
    var current;
    try { current = JSON.parse(global.localStorage.getItem('lhmedia_status') || 'null'); } catch(e) {}
    var age = current && (Date.now() - current.ts);
    var focused = AI.Context && AI.Context.get && AI.Context.get('media');
    if (focused && focused.path && current && current.file !== focused.path) return Promise.resolve(result('CLARIFICATION_REQUIRED','More than one media target is in context. Open the intended player and specify which file to control.','MEDIA_CONTROL'));
    if (!current || !current.file || !Number.isFinite(age) || age < 0 || age > MEDIA_CONTEXT_MS) {
      return Promise.resolve(result('CLARIFICATION_REQUIRED','Which player should I control? Open the intended player and try again; the last playback context is missing or stale.','MEDIA_CONTROL'));
    }
    var identity = owner();
    return request('/api/fs/media-status').then(function(data){
      if (data.ok !== true) return result('FAILED','The server did not confirm media availability. No player command was sent.','MEDIA_CONTROL');
      if (identity !== owner()) return result('DENIED','The session changed. Please state the playback request again.','MEDIA_CONTROL');
      if (!AI.MediaBridge || !AI.MediaBridge.send) return result('UNAVAILABLE','Player controls are not available in this page.','MEDIA_CONTROL');
      var receipt = AI.MediaBridge.send(action, {targetFile:current.file});
      if (receipt && receipt.dispatched === false) return result('FAILED','The browser could not deliver the player request. Open the player directly and check browser storage permissions.','MEDIA_CONTROL');
      return result('REQUESTED_UNVERIFIED', 'Requested ' + action + ' for the selected media. The player has not confirmed the change yet.', 'MEDIA_CONTROL');
    }).catch(function(error){return failure(error,'MEDIA_CONTROL',false);});
  }
  function delegate(text, options) {
    var engine = AI.Cognitive && AI.Cognitive.process ? AI.Cognitive : AI.Intent;
    if (!engine || !engine.process) return Promise.resolve(result('UNAVAILABLE','The assistant engine is unavailable. Please reload the assistant page.'));
    return Promise.resolve().then(function(){return engine.process(text,Object.assign({},options,{remember:false}));}).then(function(value){
      if (!value || typeof value.message !== 'string' || !value.message.trim()) return result('FAILED','The assistant returned an invalid response. No completion is being claimed.');
      var output = Object.assign({},value);
      output.execution = {status:'LEGACY_UNVERIFIED', intent:'DELEGATED', verified:false};
      if (typeof output.openFM === 'string' && output.openFM.indexOf('/player') === 0) {
        output.message = 'Opening the requested player. Playback has not yet been confirmed.';
        output.execution.status = 'NAVIGATION_REQUESTED';
      }
      return output;
    });
  }
  function runReviewedPlan(plan) {
    if(!AI.ReviewedWorkflows)return Promise.resolve(result('UNAVAILABLE','The reviewed workflow adapter is unavailable.'));
    if(activePlan)return Promise.resolve(result('BUSY','Another reviewed workflow is running. Wait for it or say “cancel”.'));
    var controller=new AbortController();activePlan=controller;
    return AI.ReviewedWorkflows.run(plan,{owner:owner,signal:controller.signal,
      request:function(path,method){return request(path,method,undefined,controller.signal);}
    }).finally(function(){if(activePlan===controller)activePlan=null;});
  }
  function runSystemIntegration(mode) {
    if(!AI.SystemIntegration)return Promise.resolve(result('UNAVAILABLE','The host integration bridge is unavailable. Please update/reload the assistant.'));
    var controller=new AbortController(),timedOut=false;activePlan=controller;
    var deadline=setTimeout(function(){timedOut=true;controller.abort();},10000);
    return AI.SystemIntegration.run(mode,{owner:owner,signal:controller.signal,
      request:function(path){return request(path,'GET',2000,controller.signal);}
    }).then(function(value){
      if(timedOut)return result('UNAVAILABLE','The health-check time budget expired. Results are incomplete; no system repair was performed.','SYSTEM_INTEGRATION');
      if(value.execution.status==='HEALTH_OBSERVED' || value.execution.status==='READ_RECOVERY_OBSERVED' || value.execution.status==='REPORT_RECALLED')healthFocus=owner();
      return value;
    }).finally(function(){clearTimeout(deadline);if(activePlan===controller)activePlan=null;});
  }
  function process(text, options) {
    options = options || {};
    var plan = inspect(text), now = Date.now();
    if (pending && (pending.expiresAt < now || pending.owner !== owner())) pending = null;
    if (plan.kind === 'CANCEL' && activePlan) {
      activePlan.abort();pending=null;healthFocus=null;
      return Promise.resolve(result('CANCELLED','Cancellation requested. No further workflow step will be dispatched; a request already sent cannot be recalled.'));
    }
    if (plan.kind === 'CANCEL') { healthFocus=null;var hadPending=!!pending;pending=null;return Promise.resolve(result(hadPending?'CANCELLED':'NO_ACTION',hadPending?'Cancelled before dispatch. No action was sent.':'There is no pending confirmation to cancel. An action already sent cannot be undone here.')); }
    if(activePlan)return Promise.resolve(result('BUSY','A reviewed workflow is running. Wait for it or say “cancel” before requesting another action.'));
    if (plan.kind === 'CONFIRM') {
      if (!pending) return Promise.resolve(result('CLARIFICATION_REQUIRED','There is no current action to confirm. Please state the request again.'));
      var action=pending.action; pending=null; // consume BEFORE sending; no duplicate replay/retry
      return executeServer(action);
    }
    // An unrelated turn invalidates the old confirmation instead of attaching
    // a later “yes” to the wrong action.
    pending=null;
    if(['SYSTEM_MAP','HEALTH_SCAN','HEALTH_RECOVERY','HEALTH_FOLLOWUP','HEALTH_REPORT','HEALTH_CAUSE_QUERY','REPAIR_REVIEW'].indexOf(plan.kind)<0)healthFocus=null;
    switch(plan.kind) {
      case 'REPAIR_REVIEW': return Promise.resolve(result('UNAVAILABLE','This integration-first chat cannot apply/deploy/rollback patches or change legacy autonomy policy/continue an unreviewed repair goal. I can inspect host state and recheck transient reads; file/build/device repair needs a separately reviewed admin workflow. No repair action was run.','SYSTEM_INTEGRATION'));
      case 'SYSTEM_MAP': return runSystemIntegration('explain');
      case 'HEALTH_SCAN': return runSystemIntegration('scan');
      case 'HEALTH_RECOVERY': return runSystemIntegration('recover');
      case 'HEALTH_FOLLOWUP':
        if(!AI.SystemIntegration || healthFocus!==owner() || !AI.SystemIntegration.hasRecentReport({owner:owner}))return Promise.resolve(result('CLARIFICATION_REQUIRED','Which system issue do you mean? Say “check localhub health” first. No repair was started.'));
        return runSystemIntegration('recover');
      case 'HEALTH_CAUSE_QUERY':
        if(healthFocus!==owner())return Promise.resolve(result('CLARIFICATION_REQUIRED','Which failure do you mean? For LocalHub, start with “check localhub health”. Current checks alone cannot prove the cause of a past crash.','SYSTEM_INTEGRATION'));
        return runSystemIntegration('scan');
      case 'HEALTH_REPORT': return runSystemIntegration('report');
      case 'EMPTY': return Promise.resolve(result('CLARIFICATION_REQUIRED','What would you like me to do?'));
      case 'NO_ACTION': return Promise.resolve(result('NO_ACTION','Understood. I have not sent an action.'));
      case 'EXPLANATION': return Promise.resolve(result('INFORMATION',explanation(text),'INFORMATION'));
      case 'CLARIFY': return Promise.resolve(result('CLARIFICATION_REQUIRED', /\b(delete|remove|move)\b/i.test(text) ? 'Which exact file or folder do you mean? I have not changed any files.' : /\b(open|play)\b/i.test(text) ? 'Which file or video should I open? Please give its name; I will not guess from old context.' : 'Please name the target—for example “stop video” or “stop server”. I will not guess.'));
      case 'LATEST_MODIFIED': return runReviewedPlan(AI.TaskPlanner && AI.TaskPlanner.planFor(normalize(text)));
      case 'WORKFLOW_REVIEW': return Promise.resolve(result('CLARIFICATION_REQUIRED',/\b(last|downloaded)\b/i.test(text) ? 'I cannot prove download order from file timestamps. If you want the newest modification time instead, say “play newest modified video in downloads”. No player was opened.' : 'That workflow is still under execution review. Please request one action at a time. No workflow was started.'));
      case 'SERVER_ACTION':
        if (!token()) return Promise.resolve(result('DENIED','Please sign in again before server control so the confirmation can be bound to the current session.','SERVER_ACTION'));
        if (role() !== 'admin') return Promise.resolve(result('DENIED','Server control requires an administrator account.','SERVER_ACTION'));
        pending={action:plan.action,owner:owner(),expiresAt:now+CONFIRM_MS};
        return Promise.resolve(result('CONFIRMATION_REQUIRED','Confirm '+plan.action.replace(/-/g,' ')+'? This can affect clients or server data. Reply “confirm” within 60 seconds, or “cancel”.','SERVER_ACTION'));
      case 'SERVER_STATUS':
        return request('/api/status').then(function(data){
          if (typeof data.running !== 'boolean' || !Number.isInteger(data.port)) return result('FAILED','The status response was incomplete. I cannot confirm server state.','SERVER_STATUS');
          return result('OBSERVED','Server reports '+(data.running?'online':'stopped')+' on port '+data.port+'.','SERVER_STATUS');
        }).catch(function(error){return failure(error,'SERVER_STATUS',false);});
      case 'MEDIA_CONTROL': return mediaControl(plan.action);
      case 'MEDIA_OPEN':
        return request('/api/fs/media-status').then(function(data){
          if (data.ok !== true) return result('FAILED','Media availability could not be confirmed. No playback request was sent.','MEDIA_OPEN');
          return delegate(text, options);
        }).catch(function(error){return failure(error,'MEDIA_OPEN',false);});
      case 'FILE_ACTION':
        if (role() !== 'admin') return Promise.resolve(result('DENIED','Changing or deleting files requires an administrator account.','FILE_ACTION'));
        return Promise.resolve(result('UNAVAILABLE','Please select the exact files and confirm these changes in File Manager. I have not changed any files from this chat request.','FILE_ACTION'));
      default: return delegate(text, options);
    }
  }
  AI.AssistantRuntime = {inspect:inspect,process:process,runReviewedPlan:runReviewedPlan,clearPending:function(){pending=null;},version:'stage-2.3-integration'};
})(window);
