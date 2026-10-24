/* Native controller -> already-open player access state. Server enforcement is
 * authoritative; this poll also pauses content already buffered by the browser. */
(function(){
  'use strict';
  var media=document.getElementById('media'), wrap=document.getElementById('video-wrap');
  if(!media || !wrap) return;
  var blocked=false, busy=false, timer;
  var cover=document.createElement('div');
  cover.setAttribute('role','alert');
  cover.style.cssText='position:absolute;inset:0;z-index:46;background:rgba(4,8,14,.95);color:white;display:none;align-items:center;justify-content:center;text-align:center;padding:24px';
  var text=document.createElement('p');text.style.cssText='max-width:440px;line-height:1.7';cover.appendChild(text);wrap.appendChild(cover);
  function show(message){blocked=true;media.pause();text.textContent=message;cover.style.display='flex';}
  function check(){
    if(busy)return;busy=true;
    var token='';try{token=new URLSearchParams(location.search).get('token')||sessionStorage.getItem('lhtoken')||localStorage.getItem('lhtoken')||'';}catch(e){}
    fetch('/api/fs/media-status',{headers:token?{Authorization:'Bearer '+token}:{},cache:'no-store'})
      .then(function(r){
        if(r.status===503)return r.text().then(function(message){show('Playback is disabled by the host controller. Enable File Manager and Media Player in Modules to continue. '+message);});
        if(r.status===401||r.status===403){show('Playback access is no longer available. Sign in again or ask the host to restore file access.');return;}
        if(r.ok && blocked){blocked=false;cover.style.display='none';} // never auto-resume after a disable
      }).catch(function(){/* A temporary network failure is not a module OFF signal. */})
      .finally(function(){busy=false;});
  }
  media.addEventListener('play',function(){if(blocked)media.pause();});
  check();timer=setInterval(check,4000);
  window.addEventListener('pagehide',function(){clearInterval(timer);});
})();
