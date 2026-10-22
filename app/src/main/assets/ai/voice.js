/* voice.js - optional speech input/output with waveform animation. */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  var Voice = {
    enabled: true,            // master speech-output switch (voice on/off)
    _curAudio: null,          // current server-TTS <audio> element
    _curServerToken: 0,       // monotonically increasing token to drop stale plays

    setEnabled: function (on) {
      Voice.enabled = !!on;
      if (!Voice.enabled) Voice.stop();   // turning off stops whatever is speaking
      return Voice.enabled;
    },
    isEnabled: function () { return Voice.enabled; },

    // Is anything currently speaking (server audio or browser speechSynthesis)?
    isSpeaking: function () {
      try {
        if (Voice._curAudio && !Voice._curAudio.paused && !Voice._curAudio.ended && !Voice._curAudio.error) return true;
        if (("speechSynthesis" in window) && window.speechSynthesis.speaking) return true;
      } catch (e) {}
      return false;
    },

    // Stop ANY active speech (server audio + browser speech) immediately.
    stop: function () {
      Voice._curServerToken++;               // invalidate any in-flight play
      try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); } catch (e) {}
      try { if (Voice._curAudio) { Voice._curAudio.pause(); Voice._curAudio = null; } } catch (e) {}
    },

    // Central speak entry point: respects the master switch, cancels any current
    // speech first (prevents overlap from rapid/multiple taps), then dispatches
    // to server TTS when available, else browser speech.
    speakNow: function (text, lang, onEnd) {
      if (!Voice.enabled) { onEnd && onEnd(); return null; }
      Voice.stop();                            // never speak over current speech
      if (Voice.speakServer) return Voice.speakServer(text, lang, onEnd);
      return Voice.speak(text, lang, onEnd);
    },

    supportedInput: function () {
      return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    },
    supportedOutput: function () {
      return "speechSynthesis" in window;
    },

    listen: function (lang, onResult, onEnd) {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { onEnd("not supported"); return null; }
      var rec = new SR();
      rec.lang = lang || "en-US";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = function (e) { onResult(e.results[0][0].transcript); };
      rec.onend = function () { onEnd && onEnd("done"); };
      rec.onerror = function (e) { onEnd && onEnd("error:" + (e.error || "")); };
      rec.start();
      return rec;
    },

    stop: function (rec) { try { rec && rec.stop(); } catch (e) {} },

    // Picks the best available English voice instead of relying on the browser
    // default. Prefers neural/natural/high-quality voices when installed.
    pickVoice: function (lang) {
      try {
        var voices = window.speechSynthesis.getVoices() || [];
        if (!voices.length) return null;
        var base = (lang || "en-US").split("-")[0].toLowerCase();
        var en = voices.filter(function (v) {
          return (v.lang || "").toLowerCase().indexOf(base) === 0;
        });
        if (!en.length) return null;
        // Preference list — first match wins (natural/neural voices sound best).
        var prefs = [
          "google us english", "google uk english", "microsoft aria",
          "microsoft jenny", "microsoft guy", "natural", "neural", "samantha",
          "alex", "en-us", "en-gb"
        ];
        for (var i = 0; i < prefs.length; i++) {
          var p = prefs[i];
          for (var j = 0; j < en.length; j++) {
            if ((en[j].name || "").toLowerCase().indexOf(p) !== -1) return en[j];
          }
        }
        return en[0];
      } catch (e) { return null; }
    },

    stopSpeak: function () {
      try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); } catch (e) {}
    },

    // Resolves the auth token used to call LocalHub APIs.
    token: function () {
      var q = new URLSearchParams(window.location.search);
      return q.get("token") || sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken") || "";
    },
    baseUrl: function () {
      return (global.LH_AI && global.LH_AI.baseUrl) || (window.location.protocol + "//" + window.location.host);
    },

    // Speaks using LocalHub's SERVER System TTS engine (the phone's natural
    // built-in voice), synthesised to a WAV and played in the browser. This is
    // the assistant's preferred voice path — better than browser speechSynthesis.
    speakServer: function (text, lang, onEnd) {
      text = String(text == null ? "" : text).trim();
      if (!text) { onEnd && onEnd(); return null; }
      // cancel any previous server audio so multiple taps never overlap
      try { if (Voice._curAudio) { Voice._curAudio.pause(); Voice._curAudio = null; } } catch (e) {}
      var myToken = ++Voice._curServerToken;   // this play is the latest
      var t = Voice.token();
      var url = Voice.baseUrl() + "/api/tts/synthesize" + (t ? "?token=" + encodeURIComponent(t) : "");
      var audio = new Audio();
      Voice._curAudio = audio;
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text, speed: 1.0, lang: lang || "en-US" })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          if (Voice._curServerToken !== myToken) { onEnd && onEnd(); return; }  // superseded by newer tap/stop
          if (res && res.ok && res.url) {
            audio.src = Voice.baseUrl() + res.url;
            audio.onended = function () { if (Voice._curServerToken === myToken) Voice._curAudio = null; onEnd && onEnd(); };
            audio.onerror = function () { if (Voice._curServerToken === myToken) Voice._curAudio = null; onEnd && onEnd(); };
            audio.play().catch(function () { if (Voice._curServerToken === myToken) Voice._curAudio = null; onEnd && onEnd(); });
          } else {
            if (Voice._curServerToken === myToken) Voice._curAudio = null;
            onEnd && onEnd();
          }
        })
        .catch(function () { if (Voice._curServerToken === myToken) Voice._curAudio = null; onEnd && onEnd(); });
      return audio;
    },
    stopServerSpeak: function () { Voice.stop(); },

    speak: function (text, lang, onEnd) {
      if (!("speechSynthesis" in window)) { onEnd && onEnd(); return null; }
      try { speechSynthesis.cancel(); } catch (e) {}
      Voice._curServerToken++;
      var u = new SpeechSynthesisUtterance(String(text == null ? "" : text));
      u.lang = lang || "en-US";
      var v = Voice.pickVoice(u.lang);
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = 1.0;
      u.pitch = 1.0;
      if (onEnd) u.onend = function () { onEnd(); };
      speechSynthesis.speak(u);
      // Work around Chrome's ~15 second speech cutoff: keep the utterance alive
      // with a pause/resume heartbeat. Only needed for long replies.
      var keepAlive = null;
      if (u.text.length > 120) {
        keepAlive = setInterval(function () {
          try {
            if (speechSynthesis.speaking && !speechSynthesis.paused) {
              speechSynthesis.pause();
              speechSynthesis.resume();
            } else if (!speechSynthesis.speaking) {
              clearInterval(keepAlive);
            }
          } catch (e) { clearInterval(keepAlive); }
        }, 10000);
      }
      return u;
    },

    // Draws an animated fake waveform onto a canvas while speaking/listening.
    drawWaveform: function (canvas) {
      if (!canvas) return;
      var ctx = canvas.getContext("2d");
      var w = canvas.width, h = canvas.height, running = true;
      function frame() {
        if (!running) return;
        ctx.clearRect(0, 0, w, h);
        var bars = 28;
        for (var i = 0; i < bars; i++) {
          var amp = 0.2 + 0.8 * Math.abs(Math.sin(Date.now() / 120 + i * 0.6));
          var bh = (h * 0.8) * amp;
          ctx.fillStyle = "#22d3a6";
          ctx.fillRect((w / bars) * i + 2, (h - bh) / 2, (w / bars) - 4, bh);
        }
        requestAnimationFrame(frame);
      }
      frame();
      return function () { running = false; ctx.clearRect(0, 0, w, h); };
    }
  };

  global.LH_AI.Voice = Voice;
})(window);
