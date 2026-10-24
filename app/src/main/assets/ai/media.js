/* media.js - LocalHub Media Control Bridge.
 *
 * Lets the assistant control the Media Player page (even across browser tabs)
 * through a deterministic localStorage channel. The player page listens for
 * commands via the "storage" event and applies them to its <video>/<audio>.
 *
 * Offline, deterministic, no server round-trip required for transport control.
 */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  var CHANNEL = "lhmc";       // localStorage key for outbound commands
  var SEQ = "lhmc_seq";

  var MediaBridge = {
    /** Sends a transport command to any open player tab. */
    send: function (command, params) {
      var payload = { cmd: command, params: params || {}, ts: Date.now() };
      try {
        var seq = (parseInt(global.localStorage.getItem(SEQ) || "0", 10) || 0) + 1;
        global.localStorage.setItem(SEQ, String(seq));
        global.localStorage.setItem(CHANNEL, JSON.stringify(payload));
        payload.dispatched = true;
      } catch (e) { payload.dispatched = false; }
      return payload;
    },

    /**
     * Called by the player page on boot and on every "storage" event.
     * Returns an action object to apply to the media element, or null.
     */
    read: function () {
      try {
        var raw = global.localStorage.getItem(CHANNEL);
        if (!raw) return null;
        var p = JSON.parse(raw);
        if (!Number.isFinite(p.ts) || Date.now() - p.ts > 15000 || p.ts > Date.now()) return null;
        return { cmd: p.cmd, params: p.params || {}, ts: p.ts };
      } catch (e) { return null; }
    },

    /** Applies a bridge command to a media element (video/audio). */
    apply: function (media, action) {
      if (!media || !action) return false;
      var p = action.params || {};
      switch (action.cmd) {
        case "play": media.play && media.play(); return true;
        case "pause": media.pause && media.pause(); return true;
        case "toggle": if (media.paused) media.play && media.play(); else media.pause && media.pause(); return true;
        case "resume": media.play && media.play(); return true;
        case "stop": if (media.pause) media.pause(); if (media.currentTime != null) media.currentTime = 0; return true;
        case "seek": if (media.currentTime != null && p.time != null) media.currentTime = p.time; return true;
        case "seekForward": if (media.currentTime != null) media.currentTime += (p.seconds || 10); return true;
        case "seekBack": if (media.currentTime != null) media.currentTime -= (p.seconds || 10); return true;
        case "volume": if (media.volume != null && p.level != null) media.volume = Math.max(0, Math.min(1, p.level)); return true;
        case "volumeUp": if (media.volume != null) media.volume = Math.min(1, media.volume + 0.1); return true;
        case "volumeDown": if (media.volume != null) media.volume = Math.max(0, media.volume - 0.1); return true;
        case "mute": if (media.muted != null) media.muted = true; return true;
        case "unmute": if (media.muted != null) media.muted = false; return true;
        case "toggleMute": if (media.muted != null) media.muted = !media.muted; return true;
        case "speed": if (media.playbackRate != null && p.rate != null) media.playbackRate = p.rate; return true;
        case "fullscreen": return false; // handled by caller with element/container
        case "jumpTo": if (media.currentTime != null && p.time != null) media.currentTime = p.time; return true;
        case "next": case "previous": return false; // playlist handled by player
        default: return false;
      }
    }
  };

  global.LH_AI.MediaBridge = MediaBridge;
})(window);
