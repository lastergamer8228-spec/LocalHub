/* Read-only integration/health bridge. Frozen repair engines are not invoked.
 * Recovery here means a bounded recheck of a transient read, never mutation.
 */
(function(global){
  'use strict';
  var AI=global.LH_AI=global.LH_AI||{};
  var IDS=['dashboard','files','ai','core.media','core.mirror','core.device','core.shares','core.monitor','core.tts','core.os','core.server','core.security'];
  var READS=['/api/integration','/api/system','/api/fs/media-status','/api/mirror/status','/api/tts/status'];
  var last=null,lastOwner=null;
  function valid(host){
    return host && host.schemaVersion===1 && host.source==='android-host-read-only' &&
      Number.isSafeInteger(host.sampledAt) && host.sampledAt>0 && host.server && host.server.running===true &&
      Number.isInteger(host.server.port) && host.server.port>=1024 && host.server.port<=65535 &&
      ['http','https'].indexOf(host.server.protocol)>=0 && host.access && ['admin','user'].indexOf(host.access.role)>=0 &&
      Array.isArray(host.features) && host.features.length===IDS.length && IDS.every(function(id){return host.features.filter(function(f){return f.id===id && typeof f.enabled==='boolean' && typeof f.name==='string' && f.name.length<=64 && ((id!=='core.server'&&id!=='core.security') || f.enabled===true);}).length===1;}) &&
      host.permissions && host.lifecycle && host.chatRecoveryPolicy && host.chatRecoveryPolicy.mode==='bounded-read-recovery';
  }
  function state(host,id){var feature=host.features.find(function(f){return f.id===id;});return feature && feature.enabled;}
  function usable(id,value){
    if(!value || typeof value!=='object')return false;
    if(id==='core.monitor')return Number.isSafeInteger(value.timestamp) && value.timestamp>0 && value.cpu && value.memory && value.storage;
    if(id==='core.media')return value.ok===true;
    if(id==='core.mirror')return value.ok===true && typeof value.running==='boolean';
    if(id==='core.tts')return value.ok===true && typeof value.available==='boolean';
    return false;
  }
  function receipt(id,status,message){return {id:id,state:status,message:message};}
  function output(status,message,checks,extras){return Object.assign({ok:status!=='DENIED' && status!=='UNAVAILABLE',message:message,
    execution:{status:status,intent:'SYSTEM_INTEGRATION',verified:false},checks:checks||[]},extras||{});}
  function architecture(){return 'The Android foreground service owns the HTTP server, device permissions and module gates. I run in a browser page and request those APIs. Guardian/browser checks are not a native background repair daemon. I cannot patch the installed APK, grant Android permissions or bypass capture consent. Frozen legacy repair controls remain separate from this reviewed chat integration.';}
  function recent(owner){return last && lastOwner===owner && Date.now()-last.at>=0 && Date.now()-last.at<60000 ? JSON.parse(JSON.stringify(last)) : null;}
  function recalled(tools){
    var report=recent(tools.owner());
    if(!report)return output('CLARIFICATION_REQUIRED','There is no recent health snapshot for this session. Say “check localhub health” first.');
    return output('REPORT_RECALLED','Last health snapshot (not a new check):\n'+report.message,report.checks);
  }
  async function run(mode,tools){
    if(!tools || typeof tools.owner!=='function' || typeof tools.request!=='function')return output('UNAVAILABLE','Host integration tools are unavailable.');
    var identity=tools.owner(),calls=0,started=Date.now(),recovered=0;
    function current(){
      if(tools.signal && tools.signal.aborted){var cancelled=new Error('Health check cancelled.');cancelled.code='CANCELLED';throw cancelled;}
      if(identity!==tools.owner()){var changed=new Error('Session changed.');changed.code='SESSION_CHANGED';throw changed;}
    }
    async function read(path){
      current();
      if(READS.indexOf(path)<0)throw new Error('Unreviewed diagnostic endpoint');
      if(calls>=12){var budget=new Error('Read budget exhausted.');budget.code='BUDGET';throw budget;}
      calls++;
      var value=await tools.request(path);current();return value;
    }
    try {
      var host=await read('/api/integration');
      if(!valid(host))return output('UNAVAILABLE','The host integration descriptor is missing or incompatible. Update the host app; no repair was attempted.');
      if(mode==='report')return recalled(tools);
      if(mode==='explain') {
        var features=host.features.filter(function(f){return IDS.indexOf(f.id)>=0;}).map(function(f){var dependency=(f.id==='core.media'||f.id==='core.shares')&&!state(host,'files')?' · File Manager dependency is OFF':'';return f.name+': '+(f.enabled?'ON':'OFF (configuration, not a fault)')+dependency;});
        var permissionStates=['GRANTED','MISSING','UNKNOWN','ACTIVE','INACTIVE'];
        var grants=['storage','camera','notifications','writeSettings','notificationPolicy','accessibility','screenCapture'].map(function(key){return key+': '+(permissionStates.indexOf(host.permissions[key])>=0?host.permissions[key]:'UNKNOWN');});
        var build=host.app && typeof host.app.versionName==='string' ? host.app.versionName : 'not reported';
        return output('INTEGRATION_OBSERVED',architecture()+'\n\nLive host: '+host.server.protocol.toUpperCase()+' listener on port '+host.server.port+'; role '+host.access.role+'; build '+build+'.\n'+features.join('\n')+'\n\nHost grants/consent (not automatic repair targets):\n'+grants.join(' · ')+'\n\nEnabled states are configuration, not proof that every hardware action works. Automatic recovery in this chat is limited to transient-read rechecks. Restart/file/configuration changes require the reviewed admin flow; disabled features are never silently enabled.');
      }
      var checks=[receipt('listener','OBSERVED','Host listener responded on port '+host.server.port+'.')];
      host.features.filter(function(f){return !f.enabled;}).forEach(function(f){checks.push(receipt(f.id,'DISABLED',f.name+' is OFF by configuration; it will not be enabled automatically.'));});
      if(state(host,'core.media') && !state(host,'files'))checks.push(receipt('media-dependency','DISABLED_DEPENDENCY','Media Player is ON but its File Manager dependency is OFF; this is configuration, not a repair target.'));
      if(state(host,'files') && host.permissions.storage==='MISSING')checks.push(receipt('storage-permission','NEEDS_USER_ACTION','Storage permission is missing. Grant access on the phone if you want file/media features; no permission was changed.'));
      else if(state(host,'files') && host.permissions.storage!=='GRANTED')checks.push(receipt('storage-permission','UNKNOWN','Storage permission could not be determined.'));
      if(host.permissions.notifications==='MISSING')checks.push(receipt('notifications','NEEDS_USER_ACTION','App notifications are not allowed/enabled; the listener response alone does not prove reliable background operation.'));
      if(['GRANTED','MISSING'].indexOf(host.permissions.notifications)<0)checks.push(receipt('notifications','UNKNOWN','App notification state was not determined.'));
      var details=[];
      async function probe(id,path){
        try { return {value:await read(path)}; }
        catch(error){
          current();
          if(error.httpStatus===401 || error.httpStatus===403)return {error:receipt(id,'DENIED','Access to '+id+' was denied; sign in/review device restrictions. No retry or permission bypass.')};
          var transient=!error.httpStatus || error.httpStatus>=500;
          if(mode==='recover' && transient && error.code!=='BUDGET') {
            // Refresh configuration before retrying: OFF is a choice, not damage.
            var fresh;
            try {fresh=await read('/api/integration');} catch(configError){current();if(configError.httpStatus===401||configError.httpStatus===403)throw configError;return {error:receipt(id,'UNKNOWN','Recovery configuration could not be rechecked within the read budget. No repair was attempted.')};}
            if(valid(fresh) && fresh.access.role!==host.access.role){var changed=new Error('Host role changed.');changed.code='SESSION_CHANGED';throw changed;}
            if(!valid(fresh))return {error:receipt(id,'UNKNOWN','Configuration recheck was incomplete; no repair decision was made.')};
            var enabled=state(fresh,id) && (id!=='core.media' || state(fresh,'files'));
            if(!enabled)return {error:receipt(id,'DISABLED','Feature was turned OFF during the check. Recovery respected that change.')};
            try { var value=await read(path);if(!usable(id,value))return {error:receipt(id,'UNKNOWN','The rechecked API responded with incomplete data; recovery is not being claimed.')};recovered++;details.push(receipt(id+'-recheck','READ_RECOVERED','A transient '+id+' API read recovered on one recheck. This does not prove the whole feature is fixed.'));return {value:value}; }
            catch(retryError){current();if(retryError.code==='BUDGET')return {error:receipt(id,'UNKNOWN','The bounded read budget ended before another recheck. No repair is being claimed.')};if(retryError.httpStatus===401||retryError.httpStatus===403)return {error:receipt(id,'DENIED','The recheck was denied. No permission bypass or further retry was attempted.')};return {error:receipt(id,'UNAVAILABLE','The '+id+' API still did not provide a usable response. No restart, file edit or repeated retry was performed.')};}
          }
          return {error:receipt(id,error.code==='BUDGET'?'UNKNOWN':'UNAVAILABLE','Could not observe '+id+'. Missing data is not proof of a root cause or successful repair.')};
        }
      }
      var jobs=[];
      if(state(host,'core.monitor'))jobs.push((async function(){
        var observed=await probe('core.monitor','/api/system');if(observed.error)return [observed.error];
        var data=observed.value,hostNow=host.sampledAt+(Date.now()-started);
        if(!data || !Number.isSafeInteger(data.timestamp) || hostNow-data.timestamp>15000 || data.timestamp-hostNow>5000)return [receipt('resources','UNKNOWN','Resource telemetry is incomplete/stale; no CPU/memory repair was inferred.')];
        var found=[];
        if(data.cpu && data.cpu.available===true && Number.isFinite(data.cpu.usagePercent) && data.cpu.usagePercent>=0 && data.cpu.usagePercent<=100)
          found.push(receipt('cpu','OBSERVED','CPU reports '+data.cpu.usagePercent.toFixed(1)+'% in this sample; one sample does not establish a fault.'));
        else found.push(receipt('cpu','UNKNOWN','CPU load is unavailable; it was not estimated or treated as zero.'));
        if(data.memory && Number.isFinite(data.memory.totalBytes) && data.memory.totalBytes>0 && Number.isFinite(data.memory.usedBytes) && data.memory.usedBytes>=0 && data.memory.usedBytes<=data.memory.totalBytes) {
          var usage=data.memory.usedBytes/data.memory.totalBytes*100;
          found.push(receipt('memory',data.memory.lowMemory===true || usage>=95?'WARNING':'OBSERVED','RAM reports '+usage.toFixed(1)+'% used. No apps were killed or memory cleared.'));
        } else found.push(receipt('memory','UNKNOWN','Memory telemetry is incomplete.'));
        if(data.storage && Number.isFinite(data.storage.availableBytes) && data.storage.availableBytes>=0 && Number.isFinite(data.storage.totalBytes) && data.storage.totalBytes>0 && data.storage.availableBytes<=data.storage.totalBytes) {
          var low=data.storage.availableBytes<128*1024*1024 || data.storage.availableBytes/data.storage.totalBytes<0.02;
          found.push(receipt('storage',low?'WARNING':'OBSERVED','Free storage reports '+(data.storage.availableBytes/1024/1024).toFixed(0)+' MB.'+(low?' Review files manually; nothing was deleted.':'')));
        } else found.push(receipt('storage','UNKNOWN','Storage telemetry is incomplete.'));
        if(data.battery && Number.isFinite(data.battery.temperatureCelsius))found.push(receipt('battery',data.battery.temperatureCelsius>=45?'WARNING':'OBSERVED','Battery temperature reports '+data.battery.temperatureCelsius+'°C. No hardware/root intervention was attempted.'));
        return found;
      })());
      if(state(host,'core.media') && state(host,'files'))jobs.push((async function(){var r=await probe('core.media','/api/fs/media-status');return [r.error || receipt('media-access',r.value&&r.value.ok===true?'OBSERVED':'UNKNOWN','Media route access was '+(r.value&&r.value.ok===true?'acknowledged; this is not a codec/playback test.':'not confirmed.'))];})());
      if(state(host,'core.mirror'))jobs.push((async function(){var r=await probe('core.mirror','/api/mirror/status');if(r.error)return [r.error];if(!r.value || typeof r.value.running!=='boolean')return [receipt('mirror','UNKNOWN','Mirror status is incomplete.')];if(r.value.error)return [receipt('mirror','WARNING','The host reports a saved screen-capture error. This does not establish a current fault; review the phone consent/session. No bypass was attempted.')];return [receipt('mirror',r.value.running?'OBSERVED':'INACTIVE_EXPECTED',r.value.running?'Capture reports active; visible frame/control quality was not tested.':'Screen capture is not active. Fresh phone consent is required to start it; inactivity alone is not a fault.')];})());
      if(state(host,'core.tts'))jobs.push((async function(){var r=await probe('core.tts','/api/tts/status');if(r.error)return [r.error];return [receipt('tts',r.value&&r.value.available===true?'OBSERVED':'UNKNOWN',r.value&&r.value.available===true?'System TTS reports available; audible speech was not tested.':'TTS availability is not confirmed. Check the installed voice engine; no model/voice pack was installed.')];})());
      var batches=await Promise.all(jobs);current();batches.forEach(function(batch){checks=checks.concat(batch);});checks=checks.concat(details);
      var issues=checks.filter(function(check){return ['WARNING','NEEDS_USER_ACTION','UNAVAILABLE','DENIED','UNKNOWN'].indexOf(check.state)>=0;});
      var message='Health snapshot · host role '+host.access.role+'\n'+checks.map(function(check){return '• '+check.message;}).join('\n')+'\n\n'+
        (mode==='recover' ? recovered+' transient read(s) recovered on bounded recheck. No host configuration or user-file changes were made.' : 'Diagnosis only; no repair was executed.')+
        (issues.length?' Some checks need attention or remain unknown.':' No issue was observed in the checks that completed; this is not full device verification.')+
        '\nA stopped/unreachable host must be started from the phone controller. Android grants/consent cannot be supplied by this browser. Legacy repair-engine internals/build/deploy were not tested; these current checks cannot establish the cause of a past crash.';
      var restartReview=issues.some(function(check){return check.state==='UNAVAILABLE';}) && host.access.role==='admin';
      if(restartReview)message+='\nIf you choose a server restart for investigation, request “restart server” and review the confirmation. It is not a proven fix for the issue.';
      var response=output(recovered?'READ_RECOVERY_OBSERVED':'HEALTH_OBSERVED',message,checks,{recoveredReads:recovered,requests:calls,
        advice:restartReview?['Review the affected check. If you choose a server restart, use “restart server” and review its confirmation. Restart is not a proven fix for every issue.']:[]});
      last={at:Date.now(),message:message,checks:checks};lastOwner=identity;return response;
    } catch(error){
      if(error.code==='CANCELLED' || (tools.signal&&tools.signal.aborted))return output('CANCELLED','Health check cancelled. No further diagnostic/recheck request will be dispatched.');
      if(error.code==='SESSION_CHANGED' || error.httpStatus===401 || error.httpStatus===403)return output('DENIED','The session changed or access was denied. Sign in again; no repair was performed.');
      return output('UNAVAILABLE',(mode==='explain'?architecture()+' Current host state is unknown. ':'')+'The host could not be observed. I cannot repair or start a stopped/unreachable Android server from this browser. Check native Settings and connectivity; no change was performed.');
    }
  }
  AI.SystemIntegration={run:run,hasRecentReport:function(tools){return !!recent(tools.owner());},version:1};
})(window);
