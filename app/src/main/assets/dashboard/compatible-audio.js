/* AAC streaming v2: audio-only 60s chunks, at most current+next in memory.
 * Video URL is never replaced. No full-movie cache or video remux. */
(function () {
  'use strict';
  var media = document.getElementById('media'), wrap = document.getElementById('video-wrap');
  if (!media || !wrap) return;
  var file = new URLSearchParams(location.search).get('file');
  if (!file) return;
  var token = new URLSearchParams(location.search).get('token') || '';
  try { token = token || sessionStorage.getItem('lhtoken') || localStorage.getItem('lhtoken') || ''; } catch(e) {}
  var active = false, generation = 0, track = 0, segment = -1, cache = new Map();
  var audio = document.createElement('audio'); audio.preload = 'auto'; wrap.appendChild(audio);
  var wanted = false, loading = false, resumeVideo = false, pausedForBuffer = false;
  var muted = media.muted, interval = null;
  var tracks = [], defaultTrack = 0, probePromise = null;
  var banner = document.createElement('button');
  banner.type = 'button'; banner.hidden = true;
  banner.style.cssText = 'position:absolute;top:14px;left:14px;right:14px;z-index:35;padding:10px 14px;border-radius:10px;background:rgba(10,18,30,.88);color:white;border:1px solid rgba(255,255,255,.2);text-align:center;cursor:pointer';
  wrap.appendChild(banner);
  var panel = document.createElement('div'); panel.className = 'modal-back';
  panel.innerHTML = '<div class="modal"><div class="mhead"><h3>Audio language</h3><button class="mclose" aria-label="Close">✕</button></div><div class="mbody">' +
    '<p>Choose your language. LocalHub handles sound compatibility automatically.</p>' +
    '<label>Language <select aria-label="Audio language"><option value="0">Loading languages…</option></select></label>' +
    '<p class="status" role="status" aria-live="polite">Checking available languages…</p>' +
    '<div class="btn-group"><button class="chip retry">Play with sound</button></div>' +
    '<details style="margin-top:16px"><summary>Advanced / sound troubleshooting</summary><p class="technical"></p>' +
    '<div class="btn-group"><button class="chip detect">Refresh languages</button><button class="chip enable">Fix missing sound</button><button class="chip original">Use original audio</button></div>' +
    '<p>Sound adaptation uses small audio chunks and may briefly buffer. Stereo output; extra boost/delay are unavailable while adapted sound is active. This cannot fix unsupported video formats.</p></details></div></div>';
  wrap.appendChild(panel);
  var status = panel.querySelector('.status'), select = panel.querySelector('select');
  var bannerTimer;
  function say(message, show, persistent) {
    status.textContent = message;
    if(show) {
      clearTimeout(bannerTimer); banner.hidden = false; banner.textContent = message;
      if(!persistent) bannerTimer = setTimeout(function(){ banner.hidden=true; }, 3500);
    }
  }
  function languageName(code) {
    var names = {hin:'Hindi',hi:'Hindi',eng:'English',en:'English',tam:'Tamil',ta:'Tamil',tel:'Telugu',te:'Telugu',mal:'Malayalam',ml:'Malayalam',kan:'Kannada',kn:'Kannada',mar:'Marathi',mr:'Marathi',ben:'Bengali',bn:'Bengali',jpn:'Japanese',ja:'Japanese',kor:'Korean',ko:'Korean',fra:'French',fre:'French',fr:'French',spa:'Spanish',es:'Spanish',deu:'German',ger:'German',de:'German'};
    return names[String(code || '').toLowerCase()] || ((code && code !== 'und') ? code : 'Audio');
  }
  function label(t) {
    var name = languageName(t.language);
    var same = tracks.filter(function(other){return languageName(other.language) === name;});
    return name + (same.length>1 || name === 'Audio' ? ' · '+(t.title || 'Track '+(t.track+1)) : '');
  }
  function endpoint(name, start) {
    return '/api/fs/' + name + '?path=' + encodeURIComponent(file) + '&track=' + track +
      (start == null ? '' : '&start=' + start) + (token ? '&token=' + encodeURIComponent(token) : '');
  }
  function checked(r) {
    if (r.ok) return r;
    return r.text().then(function(t) { throw new Error(r.status === 401 || r.status === 403 ?
      'Please sign in to play this file, or ask the owner for file access.' : (t || 'HTTP ' + r.status)); });
  }
  function open() {
    document.querySelectorAll('.pop.open').forEach(function(p){ p.classList.remove('open'); });
    panel.classList.add('open');
  }
  var languageButton = document.getElementById('btn-audio');
  if(languageButton) { languageButton.onclick = open; languageButton.title = 'Audio language'; languageButton.setAttribute('aria-label', 'Audio language'); }
  ['#settings-pop .menu', '#audio-menu'].forEach(function(selector) {
    var menu = document.querySelector(selector); if (!menu) return;
    var item = document.createElement('li'); item.textContent = '♫ Audio language';
    if(selector === '#audio-menu') item.dataset.compatibleAudio = 'true';
    item.tabIndex = 0; item.setAttribute('role', 'button'); item.onclick = open;
    item.onkeydown = function(e){ if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    menu.appendChild(item);
  });
  // The original player rebuilds its audio list. Re-add our entry after each rebuild.
  var audioMenu = document.getElementById('audio-menu');
  if (audioMenu) new MutationObserver(function() {
    if (audioMenu.querySelector('[data-compatible-audio]')) return;
    var item = document.createElement('li'); item.dataset.compatibleAudio = 'true';
    item.textContent = '♫ Audio language'; item.onclick = open; audioMenu.appendChild(item);
  }).observe(audioMenu, {childList:true});
  panel.querySelector('.mclose').onclick = function(){ panel.classList.remove('open'); };
  panel.onclick = function(e){ if(e.target === panel) panel.classList.remove('open'); };
  function clearCache() {
    cache.forEach(function(entry){ entry.abort.abort(); if(entry.url) URL.revokeObjectURL(entry.url); }); cache.clear();
  }
  function stop() {
    active = false; generation++; loading = false; segment = -1;
    clearInterval(interval); audio.pause(); audio.removeAttribute('src'); audio.load();
    clearCache(); media.muted = muted; pausedForBuffer = false;
  }
  function fail(e) {
    if (e.name === 'AbortError') return;
    wanted = false; audio.pause(); media.pause();
    panel.querySelector('.technical').textContent = e.message;
    say(e.name === 'NotAllowedError' ? 'Tap to play with sound' : 'Sound needs attention — tap to retry or choose another language', true, true);
  }
  function fetchChunk(start) {
    if (cache.has(start)) return cache.get(start).promise;
    var entry = {abort:new AbortController(), url:null};
    var gen = generation;
    entry.promise = fetch(endpoint('audio-chunk', start), {signal:entry.abort.signal}).then(checked)
      .then(function(r){ return r.blob(); }).then(function(blob){
        if(gen !== generation) throw new DOMException('Stopped', 'AbortError');
        entry.url = URL.createObjectURL(blob); return entry.url;
      }).catch(function(e){ if(cache.get(start) === entry) cache.delete(start); throw e; });
    cache.set(start, entry); return entry.promise;
  }
  function trim(start) {
    cache.forEach(function(entry, key){ if(key !== start && key !== start+60) {
      entry.abort.abort(); if(entry.url) URL.revokeObjectURL(entry.url); cache.delete(key);
    } });
  }
  function prefetch() {
    var next = segment + 60;
    if(isFinite(media.duration) && next >= media.duration) return;
    fetchChunk(next).catch(function(){ /* retry on demand, never unhandled */ });
  }
  function playAudio() {
    audio.volume = media.volume; audio.muted = muted;
    audio.playbackRate = media.playbackRate;
    return audio.play();
  }
  function bufferAtCurrent() {
    if(!active || loading) return;
    var gen = generation, start = Math.floor((media.currentTime || 0) / 60)*60;
    loading = true; pausedForBuffer = !media.paused;
    resumeVideo = wanted || pausedForBuffer;
    media.pause(); audio.pause(); say('Preparing sound…', true, true);
    trim(start);
    fetchChunk(start).then(function(url){
      if(gen !== generation || !active) return;
      segment = start;
      audio.onloadedmetadata = function(){
        if(gen !== generation || !active) return;
        audio.currentTime = Math.max(0, (media.currentTime || 0)-segment);
      };
      audio.oncanplay = function(){
        if(gen !== generation || !active || !loading) return;
        loading = false; pausedForBuffer = false;
        say('Sound ready · '+(tracks.find(function(t){return t.track===track;}) ? label(tracks.find(function(t){return t.track===track;})) : 'Selected language'), true, false);
        if(resumeVideo) {
          wanted = true;
          playAudio().then(function(){ return media.play(); }).catch(fail);
        }
        prefetch();
      };
      audio.src = url; audio.load();
    }).catch(function(e){ if(gen === generation) { loading = false; pausedForBuffer = false; fail(e); } });
  }
  function tick() {
    if(!active || loading || media.seeking || media.ended) return;
    var t = media.currentTime || 0;
    if(t < segment || t >= segment+60) { bufferAtCurrent(); return; }
    if(media.readyState < 3) { audio.pause(); return; }
    if(!media.paused && audio.readyState >= 2) {
      var delta = t - (segment+audio.currentTime);
      if(Math.abs(delta)>0.4) { try { audio.currentTime = t-segment; } catch(e) {} }
      audio.playbackRate = media.playbackRate;
      if(audio.paused && wanted) playAudio().catch(fail);
    }
  }
  function start(shouldPlay) {
    var wasMuted = active ? muted : media.muted;
    stop(); muted = wasMuted; track = Number(select.value); active = true; wanted = shouldPlay !== false;
    media.muted = true; interval = setInterval(tick, 200); bufferAtCurrent();
  }
  window.LH_AUDIO = {
    get active(){ return active; },
    settings: function(volume, mute) {
      if(!active) return;
      muted = !!mute || volume === 0; audio.volume = volume; audio.muted = muted; media.muted = true;
    }
  };
  panel.querySelector('.enable').onclick = function(){ start(true); };
  panel.querySelector('.retry').onclick = function(){
    if(!active) { start(); return; }
    wanted = true;
    if(loading) return;
    if(segment >= 0 && audio.readyState>=2 && Math.floor(media.currentTime/60)*60 === segment) {
      playAudio().then(function(){ return media.play(); }).catch(fail);
    } else bufferAtCurrent();
  };
  banner.onclick = function(){
    if(!active) { open(); return; }
    panel.querySelector('.retry').onclick();
  };
  panel.querySelector('.original').onclick = function(){ stop(); say('Original audio selected.', true, false); };
  function needsAdaptation(t) {
    var codec = String(t.codec || '').toLowerCase();
    return t.track !== defaultTrack || /^(ac3|eac3|dts|truehd|mlp)$/.test(codec);
  }
  function applyLanguage(remember) {
    var chosen = tracks.find(function(t){return t.track===Number(select.value);});
    if(!chosen) return;
    var play = !media.paused || wanted;
    track = chosen.track;
    if(remember) { try { localStorage.setItem('lhplayer.audioLanguage', chosen.language); } catch(e) {} }
    if(needsAdaptation(chosen)) start(play);
    else { stop(); say('Sound · '+label(chosen), true, false); }
  }
  select.onchange = function(){ applyLanguage(true); };
  function detect() {
    if(probePromise) return probePromise;
    say('Checking languages…');
    probePromise = fetch(endpoint('audio-tracks')).then(checked).then(function(r){return r.json();}).then(function(result){
      if(!result.tracks || !result.tracks.length) { say('No audio language tracks found.'); return; }
      tracks = result.tracks;
      var nativeDefault = tracks.find(function(t){return t.isDefault;});
      defaultTrack = nativeDefault ? nativeDefault.track : tracks[0].track;
      var preferred = '';
      try { preferred = localStorage.getItem('lhplayer.audioLanguage') || ''; } catch(e) {}
      var chosen = tracks.find(function(t){return preferred && languageName(t.language)===languageName(preferred);}) || nativeDefault || tracks[0];
      select.innerHTML='';
      tracks.forEach(function(t){
        var o = document.createElement('option'); o.value = t.track; o.textContent = label(t); select.appendChild(o);
      });
      select.value = String(chosen.track);
      panel.querySelector('.technical').textContent = tracks.map(function(t){return label(t)+': '+t.codec+' / '+t.channels+' channels';}).join(' · ');
      applyLanguage(false);
    }).catch(function(e){
      panel.querySelector('.technical').textContent=e.message;
      say('Automatic sound check unavailable. Open Audio language to retry.', true, false);
    }).finally(function(){probePromise=null;});
    return probePromise;
  }
  panel.querySelector('.detect').onclick = detect;
  // No codec/configuration steps for normal playback. Supported original sound
  // stays untouched; known incompatible codecs and alternate languages adapt.
  detect();
  media.addEventListener('play', function(){
    if(!active) return; wanted = true;
    if(loading) { pausedForBuffer = true; resumeVideo = true; media.pause(); }
    else if(segment < 0) bufferAtCurrent();
    else { tick(); if(!loading) playAudio().catch(fail); }
  });
  media.addEventListener('pause', function(){
    if(!active) return; audio.pause();
    if(!loading && !pausedForBuffer) wanted = false;
  });
  media.addEventListener('seeking', function(){ if(active) audio.pause(); });
  media.addEventListener('seeked', function(){
    if(!active) return;
    if(loading) { var keepWanted = wanted || resumeVideo; generation++; loading=false; clearCache(); segment=-1; wanted=keepWanted; }
    if(Math.floor(media.currentTime/60)*60 !== segment) bufferAtCurrent();
    else { audio.currentTime = media.currentTime-segment; if(!media.paused) playAudio().catch(fail); }
  });
  media.addEventListener('waiting', function(){ if(active) audio.pause(); });
  media.addEventListener('playing', function(){ if(active && !loading) { tick(); if(!loading) playAudio().catch(fail); } });
  media.addEventListener('ratechange', function(){ audio.playbackRate=media.playbackRate; });
  media.addEventListener('ended', function(){ if(active) { wanted=false; audio.pause(); } });
  audio.addEventListener('error', function(){ if(active) { loading=false; fail(new Error('Browser could not load the AAC audio chunk.')); } });
  window.addEventListener('pagehide', function(){ clearTimeout(bannerTimer); stop(); });
})();
