/* Reviewed read-only workflow adapters. No legacy mutation/default-success path. */
(function(global){
  'use strict';
  var AI=global.LH_AI=global.LH_AI||{};
  var DOWNLOADS='/storage/emulated/0/Download';
  async function run(plan,tools) {
    if(!AI.TaskPlanner || !AI.ActionEvidence || !tools || typeof tools.request!=='function' || typeof tools.owner!=='function')return {ok:false,message:'The reviewed workflow is unavailable.',execution:{status:'UNAVAILABLE',verified:false}};
    if(!plan || plan.name!=='playNewestModifiedVideo')return {ok:false,message:'That workflow is still under execution review. No steps were run.',execution:{status:'UNREVIEWED',verified:false}};
    var identity=tools.owner(),listing,selected;
    function current(){if(tools.signal && tools.signal.aborted){var cancelled=new Error('Workflow cancelled.');cancelled.code='PLAN_CANCELLED';throw cancelled;}if(identity!==tools.owner()){var error=new Error('The session changed. Please request the workflow again.');error.code='SESSION_CHANGED';throw error;}}
    var out=await AI.TaskPlanner.execute(plan,async function(step){
      current();
      if(step.action==='listDownloads') {
        var availability=await tools.request('/api/fs/media-status');current();
        if(availability.ok!==true)return {ok:false,status:'FAILED',message:'Media availability was not confirmed.'};
        listing=await tools.request('/api/fs/list?path='+encodeURIComponent(DOWNLOADS));current();
        if(!listing || listing.path!==DOWNLOADS || !Array.isArray(listing.files))return {ok:false,status:'FAILED',message:'Downloads listing was incomplete.'};
        return {ok:true,status:'OBSERVED'};
      }
      if(step.action==='selectNewestModified') {
        var choice=AI.ActionEvidence.latestVideo(listing,DOWNLOADS,Date.now());
        if(choice.ok)selected=choice.file;
        return choice;
      }
      if(step.action==='checkSelectedFile') {
        var observed=await tools.request('/api/fs/info?path='+encodeURIComponent(selected.path));current();
        if(!AI.ActionEvidence.sameFile(selected,observed))return {ok:false,status:'UNVERIFIED',message:'The selected file changed or could not be verified. Please choose it again in File Manager.'};
        return {ok:true,status:'OBSERVED'};
      }
      if(step.action==='requestPlayer') {
        var enabled=await tools.request('/api/fs/media-status');current();
        if(enabled.ok!==true)return {ok:false,status:'FAILED',message:'Media access is no longer confirmed.'};
        return {ok:true,status:'NAVIGATION_REQUESTED',openFM:'/player?file='+encodeURIComponent(selected.path),
          message:'Selected '+selected.name+' by newest modification time in Downloads. Opening the player; playback has not yet been confirmed.'};
      }
      return {ok:false,status:'UNSUPPORTED',message:'No reviewed handler exists for this workflow step.'};
    },{signal:tools.signal});
    var response={ok:out.ok,message:out.message,execution:{status:out.status,intent:'LATEST_MODIFIED_MEDIA',verified:false},
      steps:out.results.map(function(item){return {action:item.step.action,status:item.result&&item.result.status||'FAILED'};})};
    if(out.ok && out.status==='REQUESTED_UNVERIFIED')response.openFM=out.results[out.results.length-1].result.openFM;
    return response;
  }
  AI.ReviewedWorkflows={run:run};
})(window);
