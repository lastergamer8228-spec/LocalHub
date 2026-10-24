/* Evidence rules for reviewed read/navigation/restart flows. No mutations here.
 * These rules trust the supplied server response, not arbitrary UI claims.
 */
(function (global) {
  'use strict';
  var AI=global.LH_AI=global.LH_AI||{};
  function validStatus(value) {
    return !!value && typeof value.running==='boolean' && Number.isInteger(value.port) &&
      value.port>=1024 && value.port<=65535 && Number.isSafeInteger(value.startedAt) && value.startedAt>0;
  }
  function restarted(before,after) {
    return validStatus(before) && validStatus(after) && before.running && after.running &&
      before.port===after.port && after.startedAt>before.startedAt;
  }
  function childPath(path,folder) {
    if(typeof path!=='string' || path.indexOf(folder+'/')!==0)return false;
    var name=path.slice(folder.length+1);
    return !!name && name!=='.' && name!=='..' && !/[\/\\\u0000]/.test(name);
  }
  function latestVideo(list,folder,now) {
    if(!list || list.path!==folder || !Array.isArray(list.files))return {ok:false,status:'FAILED',message:'Downloads listing was incomplete; no video was selected.'};
    var videos=list.files.filter(function(file){return file && file.isDir===false && /\.(mp4|mkv|webm|mov|m4v|avi|3gp)$/i.test(file.name || '');});
    if(!videos.length)return {ok:false,status:'NOT_FOUND',message:'No video was found in Downloads.'};
    if(videos.some(function(file){return !childPath(file.path,folder) || file.path.slice(folder.length+1)!==file.name || !Number.isSafeInteger(file.modified) || file.modified<=0 || file.modified>now || !Number.isSafeInteger(file.size) || file.size<=0;})) {
      return {ok:false,status:'CLARIFICATION_REQUIRED',message:'Some video timestamps or file metadata are missing or invalid. Please select the exact video in File Manager.'};
    }
    videos=videos.slice().sort(function(a,b){return b.modified-a.modified;});
    var ties=videos.filter(function(file){return file.modified===videos[0].modified;});
    if(ties.length>1)return {ok:false,status:'CLARIFICATION_REQUIRED',message:'Several videos share the newest modification time. Please choose the exact file in File Manager.',choices:ties.map(function(file){return {name:file.name,path:file.path};})};
    return {ok:true,status:'PREPARED',file:videos[0]};
  }
  function sameFile(listed,observed) {
    return !!listed && !!observed && observed.ok===true && observed.isDir===false &&
      listed.path===observed.path && listed.name===observed.name && listed.modified===observed.modified && listed.size===observed.size;
  }
  AI.ActionEvidence={validStatus:validStatus,restarted:restarted,latestVideo:latestVideo,sameFile:sameFile};
})(window);
