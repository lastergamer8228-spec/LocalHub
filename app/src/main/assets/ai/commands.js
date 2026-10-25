/* commands.js - LocalHub operating-system command engine.
 *
 * The assistant is NOT a chatbot. It is a deterministic, rule-based command
 * interface for controlling LocalHub. Every LocalHub module registers its own
 * commands here (plugin registry), so future modules extend the assistant
 * automatically without rewriting existing code.
 *
 * Design:
 *  - Commands are grouped by module and category.
 *  - Each command declares synonym patterns (regex) so many phrasings trigger
 *    the same action ("open downloads", "go to downloads", "downloads").
 *  - A single parser walks all commands and returns the first match.
 *  - Non-LocalHub questions are answered with a polite "I am the OS assistant".
 */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};
  global.LH_AI.modules = global.LH_AI.modules || {};

  var FS = global.LH_AI.FS;
  var Memory = global.LH_AI.Memory;
  var ROOT = "/storage/emulated/0";

  // ---- helpers -------------------------------------------------------------
  function baseName(p) { return String(p || "").split("/").pop() || p; }
  function dirOf(p) { var i = String(p || "").lastIndexOf("/"); return i > 0 ? p.substring(0, i) : ROOT; }
  function extOf(name) { var i = name.lastIndexOf('.'); return i < 0 ? "" : name.substring(i + 1).toLowerCase(); }
  function fmtSize(b) {
    b = b || 0; var u = ["B", "KB", "MB", "GB", "TB"], i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return b.toFixed(b >= 10 || i === 0 ? 0 : 1) + " " + u[i];
  }

  // Command registry: array of { module, category, name, match: RegExp[], run, admin }
  var commands = [];

  // Current web session role ("admin" | "user" | null). Populated by the browser
  // via setRole() after login. Defaults to null (unauthenticated → deny admin).
  var currentRole = null;

  function setRole(role) { currentRole = role; }
  function getRole() { return currentRole; }

  function registerCommand(spec) {
    commands.push({
      module: spec.module || "core",
      category: spec.category || "general",
      name: spec.name,
      match: spec.match || [],
      admin: !!spec.admin, // true = only Administrator may run
      deep: !!spec.deep,   // true = a more detailed/adult-level explanation
      run: spec.run
    });
  }

  // ---- navigation helper (opens File Manager / page) ----
  function open(page, label) {
    return { ok: true, message: "Opening " + (label || "LocalHub page") + "…", openFM: page };
  }

  // ---- target resolution: finds a path from user text or current context ----
  function pathFromText(text) {
    var m = text.match(/(\/[\w\s\-\.]+)+(?:\/[\w\s\-\.]+)?/g);
    return m ? m[m.length - 1].replace(/\.$/, "").trim() : null;
  }
  function nameFromText(text) {
    var m = text.match(/[\w\s\-\.]+\.(?:pdf|png|jpe?g|gif|webp|mp4|mkv|avi|webm|mp3|wav|ogg|m4a|flac|txt|md|json|zip|apk)/i);
    return m ? m[1] : null;
  }
  // Resolves "it"/"this" or an explicit path/filename to a concrete path.
  async function resolvePath(text) {
    var abs = pathFromText(text);
    if (abs) return abs;
    var name = nameFromText(text);
    var ctx = global.LH_AI.Context;
    var baseDir = (ctx && ctx.get) ? (ctx.get("folder") || ROOT) : ROOT;
    if (/(^|\s)(it|this|that|the file|the folder)\s*($|,)/.test(text) && ctx && ctx.get) {
      var cur = ctx.get("currentFile") || ctx.get("media");
      if (cur && cur.path) return cur.path;
    }
    if (name) {
      var res = await FS.search(name, baseDir);
      var hit = (res.matches || []).find(function (h) { return h.name === name; });
      if (hit) return hit.path;
      // Also allow direct construction for create-like ops handled by caller.
      return null;
    }
    return null;
  }
  // Returns a "this/current" path from context (for "rename it", "delete it", etc.).
  function contextPath() {
    var ctx = global.LH_AI.Context;
    if (!ctx || !ctx.get) return null;
    var cur = ctx.get("currentFile") || ctx.get("media") || ctx.get("clipboard");
    if (cur) return cur.path || cur;
    return null;
  }
  function isAdminRole() { return currentRole === "admin"; }

  // Resolves a destination phrase like "Downloads", "Pictures", or a path.
  function resolveDest(phrase) {
    var t = String(phrase || "").trim().replace(/\/$/, "");
    var map = { downloads: ROOT + "/Download", download: ROOT + "/Download",
      pictures: ROOT + "/Pictures", picture: ROOT + "/Pictures",
      dcim: ROOT + "/DCIM", documents: ROOT + "/Documents", document: ROOT + "/Documents",
      movies: ROOT + "/Movies", movie: ROOT + "/Movies", music: ROOT + "/Music", root: ROOT };
    var key = t.toLowerCase();
    if (map[key]) return map[key];
    if (t.startsWith("/")) return t;
    return ROOT + "/" + t;
  }


  // Lazy media-bridge accessor (media.js loads after this module).
  function sendMedia(cmd, params) {
    var mb = global.LH_AI && global.LH_AI.MediaBridge;
    if (mb) mb.send(cmd, params || {});
  }

  // Auth-aware REST helpers (attach the session token like filesystem.js).
  function baseUrl() {
    return (global.LocalHub && global.LocalHub.config && global.LocalHub.config.baseUrl) ||
      (global.LH_AI && global.LH_AI.baseUrl) ||
      ((global.location && global.location.protocol) ? global.location.protocol + "//" + global.location.host : "");
  }
  function authToken() {
    var t = (global.LH_AI && global.LH_AI.token) || null;
    try {
      if (!t && global.location && global.location.search) {
        var q = new URLSearchParams(global.location.search);
        t = q.get("token") || sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken");
      } else if (!t) {
        t = sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken");
      }
    } catch (e) {}
    return t;
  }
  function get(path) {
    var h = {}; var t = authToken(); if (t) h["Authorization"] = "Bearer " + t;
    return fetch(baseUrl() + path, { method: "GET", headers: h }).then(function (r) { return r.json(); }).catch(function () { return {}; });
  }
  function post(path, body) {
    var h = { "Content-Type": "application/json" }; var t = authToken(); if (t) h["Authorization"] = "Bearer " + t;
    return fetch(baseUrl() + path, { method: "POST", headers: h, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json(); }).catch(function () { return {}; });
  }


  // ---- OS command definitions (one register per command) ----
  function defineCoreCommands() {
    // ---- Device management (ADMIN ONLY) ----
    registerCommand({
      module: "devices", category: "manage", name: "dev-policy", admin: true,
      match: [/\b(show|view)\s+(device|devices|access)\s+policy\b/i, /\bwho\s+is\s+blocked\b/i, /\bdevice\s+restrictions\b/i],
      run: function () {
        return get("/api/devices/policy").then(function (r) {
          var blocked = (r && r.blocked) || [];
          var restrictions = (r && r.restrictions) || {};
          var lines = ["Blocked: " + (blocked.length ? blocked.join(", ") : "none"),
                       "Restrictions: " + (Object.keys(restrictions).length ? Object.keys(restrictions).map(function (ip) { return ip + "=" + restrictions[ip]; }).join(", ") : "none")];
          return { ok: true, message: "Device policy:\n" + lines.join("\n") };
        });
      }
    });
    registerCommand({
      module: "devices", category: "actions", name: "da-status", admin: true,
      match: [/\b(show|check|what)\s+(are|is)?\s*(the\s+)?device\s+(actions|capabilities|controls)\b/i, /\bdevice\s+controls\b/i],
      run: function () {
        return get("/api/device/status").then(function (r) {
          var lines = ["Device actions status:",
            "· Flashlight: " + (r && r.hasTorch ? "available" : "unavailable"),
            "· Vibrate: " + (r && r.hasVibrator ? "available" : "unavailable"),
            "· Write settings: " + (r && r.canWriteSettings ? "granted" : "needs permission"),
            "· DND: " + (r && r.canNotificationPolicy ? "granted" : "needs notification access")];
          return { ok: true, message: lines.join("\n") };
        });
      }
    });
    registerCommand({
      module: "devices", category: "manage", name: "dev-list",
      match: [/\b(show|list|display)\s+(the\s+)?(connected\s+)?devices?\b/i, /\bwho\s+is\s+connected\b/i, /\bdevice\s+list\b/i],
      run: function () {
        return FS.clients().then(function (c) {
          var list = (c && c.clients) || [];
          return { ok: true, message: list.length ? "Connected devices:\n" + list.map(function (x) { return "· " + x.ip + " (" + (x.protocol || "HTTP") + ")"; }).join("\n") : "No devices connected." };
        });
      }
    });
    registerCommand({
      module: "devices", category: "manage", name: "dev-block", admin: true,
      match: [/\bblock\s+(device|client|ip)\s+([\d\.]+)\b/i, /\bblock\s+(the\s+)?ip\s+([\d\.]+)\b/i, /\bblock\s+(the\s+)?client\s+([\d\.]+)\b/i],
      run: function (text) {
        var m = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
        var ip = m ? m[1] : "";
        if (!ip) return { ok: false, message: "Which device IP should I block?" };
        return post("/api/devices/block", { ip: ip }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Device " + ip + " blocked. It can no longer access LocalHub." : "Failed to block device." };
        });
      }
    });
    registerCommand({
      module: "devices", category: "manage", name: "dev-unblock", admin: true,
      match: [/\bunblock\s+(device|client|ip)\s+([\d\.]+)\b/i, /\bunblock\s+(the\s+)?ip\s+([\d\.]+)\b/i],
      run: function (text) {
        var m = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
        var ip = m ? m[1] : "";
        if (!ip) return { ok: false, message: "Which device IP should I unblock?" };
        return post("/api/devices/unblock", { ip: ip }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Device " + ip + " unblocked." : "Failed to unblock device." };
        });
      }
    });
    registerCommand({
      module: "devices", category: "manage", name: "dev-readonly", admin: true,
      match: [/\b(make|set|put)\s+(device|client|ip)\s+([\d\.]+)\s+read[- ]?only\b/i, /\bread[- ]?only\s+(device|client|ip)\s+([\d\.]+)\b/i],
      run: function (text) {
        var m = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
        var ip = m ? m[1] : "";
        if (!ip) return { ok: false, message: "Which device IP should I make read-only?" };
        return post("/api/devices/restrict", { ip: ip, mode: "RO" }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Device " + ip + " is now read-only (no file changes allowed)." : "Failed to restrict device." };
        });
      }
    });
    registerCommand({
      module: "devices", category: "manage", name: "dev-deny-files", admin: true,
      match: [/\b(deny|block)\s+(file|files|file\s+access)\s+(to|for)\s+(device|client|ip)?\s*([\d\.]+)\b/i, /\bdeny\s+file\s+access\s+(to\s+)?([\d\.]+)\b/i],
      run: function (text) {
        var m = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
        var ip = m ? m[1] : "";
        if (!ip) return { ok: false, message: "Which device IP should I deny file access to?" };
        return post("/api/devices/restrict", { ip: ip, mode: "deny" }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Device " + ip + " denied all file access." : "Failed to update device." };
        });
      }
    });
    registerCommand({
      module: "devices", category: "manage", name: "dev-full-access", admin: true,
      match: [/\b(give|restore|allow)\s+full\s+access\s+(to|for)\s+(device|client|ip)\s+([\d\.]+)\b/i, /\bremove\s+restriction\s+([\d\.]+)\b/i],
      run: function (text) {
        var m = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
        var ip = m ? m[1] : "";
        if (!ip) return { ok: false, message: "Which device IP should I restore full access to?" };
        return post("/api/devices/restrict", { ip: ip, mode: "none" }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Device " + ip + " restored to full access." : "Failed to update device." };
        });
      }
    });

    // ---- Device ACTIONS (admin): control the phone's hardware ----
    registerCommand({
      module: "devices", category: "actions", name: "da-torch", admin: true,
      match: [/\b(turn|switch)\s+(the\s+)?(flashlight|flash|torch|light)\s+(on|off)\b/i, /\b(turn|switch)\s+(on|off)\s+(the\s+)?(flashlight|flash|torch|light)\b/i, /\bflashlight\s+(on|off)\b/i, /\btorch\s+(on|off)\b/i],
      run: function (text) {
        var on = /\bon\b/.test(text);
        return post("/api/device/action", { action: "torch", state: on ? "true" : "false" }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Flashlight " + (on ? "on" : "off") + "." : ((r && r.error) || "Flashlight failed.") };
        });
      }
    });
    registerCommand({
      module: "devices", category: "actions", name: "da-mute", admin: true,
      match: [/\b(set|put|turn)\s+(phone|device|media|audio)?\s*(on)?\s+(silent|mute)\b/i, /\bmute\s+(the\s+)?(phone|device)\b/i, /\bsilent\s+mode\b/i],
      run: function () {
        return post("/api/device/action", { action: "ringer", value: "silent" }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Phone set to silent." : ((r && r.error) || "Failed.") };
        });
      }
    });
    registerCommand({
      module: "devices", category: "actions", name: "da-vibrate-mode", admin: true,
      match: [/\bset\s+(phone|device)\s+to\s+vibrate\b/i, /\bvibrate\s+mode\b/i, /\bphone\s+vibrate\b/i],
      run: function () {
        return post("/api/device/action", { action: "ringer", value: "vibrate" }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Phone set to vibrate." : ((r && r.error) || "Failed.") };
        });
      }
    });
    registerCommand({
      module: "devices", category: "actions", name: "da-sound", admin: true,
      match: [/\b(set|turn)\s+(phone|device)?\s*(back\s+)?to\s+(normal|sound|ring)\b/i, /\bnormal\s+mode\b/i, /\bunmute\s+(phone|device)\b/i],
      run: function () {
        return post("/api/device/action", { action: "ringer", value: "normal" }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Phone set to normal." : ((r && r.error) || "Failed.") };
        });
      }
    });
    registerCommand({
      module: "devices", category: "actions", name: "da-brightness", admin: true,
      match: [/\b(set|change)\s+(the\s+)?(screen\s+)?brightness\s+to\s+(\d{1,3})\b/i, /\bbrightness\s+(\d{1,3})\b/i],
      run: function (text) {
        var m = text.match(/(\d{1,3})/);
        var v = m ? parseInt(m[1], 10) : 128;
        return post("/api/device/action", { action: "brightness", value: v }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Brightness set to " + v + "." : ((r && r.error) || "Brightness failed.") };
        });
      }
    });
    registerCommand({
      module: "devices", category: "actions", name: "da-volume", admin: true,
      match: [/\b(set\s+(the\s+)?(media\s+)?volume\s+to\s+(\d{1,3}))\b/i, /\bvolume\s+(\d{1,3})\s*(percent|%)?\b/i],
      run: function (text) {
        var m = text.match(/(\d{1,3})/);
        var v = m ? parseInt(m[1], 10) : 50;
        return post("/api/device/action", { action: "volume", value: v }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Media volume set to " + v + "%." : ((r && r.error) || "Volume failed.") };
        });
      }
    });
    registerCommand({
      module: "devices", category: "actions", name: "da-rotate", admin: true,
      match: [/\b(turn|switch)\s+(auto[- ]?rotate|rotation|screen\s+rotation)\s+(on|off)\b/i, /\b(auto[- ]?rotate)\s+(on|off)\b/i],
      run: function (text) {
        var on = /\bon\b/.test(text);
        return post("/api/device/action", { action: "rotate", state: on ? "true" : "false" }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Auto-rotate " + (on ? "on" : "off") + "." : ((r && r.error) || "Failed.") };
        });
      }
    });
    registerCommand({
      module: "devices", category: "actions", name: "da-vibrate", admin: true,
      match: [/\bvibrate\s+(the\s+)?(phone|device)\b/i, /\bdo\s+a\s+vibration\b/i],
      run: function () {
        return post("/api/device/action", { action: "vibrate", value: 500 }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Vibrated the phone." : ((r && r.error) || "Vibration failed.") };
        });
      }
    });
    registerCommand({
      module: "devices", category: "actions", name: "da-open", admin: true,
      match: [/\bopen\s+(the\s+)?(app|website|url)\s+([\w\.:\/]+)\b/i, /\blaunch\s+(app|website|url)\s+([\w\.:\/]+)\b/i],
      run: function (text) {
        var m = text.match(/((?:https?:\/\/)?[\w\.\-]+(?:\.[a-z]{2,})+[^\s]*)/i);
        var target = m ? m[1] : "";
        if (!target) return { ok: false, message: "What should I open? (URL or app name)" };
        if (!/^https?:\/\//i.test(target)) target = "https://" + target;
        return post("/api/device/action", { action: "open", value: target }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Opened " + target + "." : ((r && r.error) || "Open failed.") };
        });
      }
    });
    registerCommand({
      module: "devices", category: "actions", name: "da-screenshot", admin: true,
      match: [/\b(screenshot|screen\s+capture|take\s+a\s+screenshot)\s+of\s+(the\s+)?(phone|device|screen)\b/i],
      run: function () {
        return post("/api/device/action", { action: "screenshot" }).then(function (r) {
          if (r && r.needsActivity) return { ok: false, message: "Screenshot needs MediaProjection consent — grant it in the Android app first." };
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Screenshot taken." : ((r && r.error) || "Screenshot failed.") };
        });
      }
    });

    // ---- Screen Mirror + Remote Control (bina root) ----
    registerCommand({
      module: "mirror", category: "mirror", name: "mirror-start", admin: true,
      match: [/\b(start|turn\s?on|begin)\s+(screen\s+)?(mirror|mirroring|screen\s+capture)\b/i, /\bstart\s+mirror\b/i, /\bmirror\s+(the\s+)?(phone|screen)\b/i],
      run: function () {
        return post("/api/mirror/start", {}).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.message) || "Starting screen mirror — grant the prompt on the phone.", openFM: "/mirror" };
        });
      }
    });
    registerCommand({
      module: "mirror", category: "mirror", name: "mirror-stop", admin: true,
      match: [/\b(stop|turn\s?off|end)\s+(screen\s+)?(mirror|mirroring|screen\s+capture)\b/i, /\bstop\s+mirror\b/i],
      run: function () {
        return post("/api/mirror/stop", {}).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.message) || "Screen mirror stopped." };
        });
      }
    });
    registerCommand({
      module: "mirror", category: "mirror", name: "mirror-status", admin: true,
      match: [/\b(mirror|screen\s+mirror|remote\s+screen)\s+(status|state)\b/i, /\bis\s+(the\s+)?(mirror|screen)\s+(on|running|active)\b/i],
      run: function () {
        return get("/api/mirror/status").then(function (r) {
          var lines = ["Screen mirror: " + (r && r.running ? "ON" : "OFF"),
                       "Remote access (accessibility): " + (r && r.accessibility ? "ON" : "OFF")];
          return { ok: true, message: lines.join("\n") };
        });
      }
    });
    registerCommand({
      module: "mirror", category: "remote", name: "mirror-click", admin: true,
      match: [/\bclick\s+([\w\s]+?)\s+on\s+the\s+phone\b/i, /\btap\s+([\w\s]+?)\s+on\s+the\s+phone\b/i],
      run: function (text) {
        var m = text.match(/(?:click|tap)\s+(?:the\s+)?(?:button|element|link)?\s*(?:named|with\s+text|saying)?\s+([\w\s]+?)\s+on\s+the\s+phone/i);
        var t = m ? m[1].trim() : "";
        if (!t) return { ok: false, message: "What should I click on the phone?" };
        return post("/api/mirror/click", { kind: "click", text: t }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.message) || "Click sent." };
        });
      }
    });
    registerCommand({
      module: "mirror", category: "remote", name: "mirror-back", admin: true,
      match: [/\bpress\s+(the\s+)?back\s+(button)?\s+on\s+the\s+phone\b/i, /\bphone\s+back\b/i],
      run: function () {
        return post("/api/mirror/nav", { action: "back" }).then(function (r) {
          return { ok: !!(r && r.ok), message: "Pressed back on the phone." };
        });
      }
    });

    // ---- YouTube / media via remote control ----
    registerCommand({
      module: "youtube", category: "youtube", name: "yt-play", admin: true,
      match: [/\b(play|open)\s+(?:the\s+)?video\s+([\w\s\-]+)\s+on\s+youtube\b/i, /\bplay\s+([\w\s\-]+)\s+on\s+youtube\b/i],
      run: function (text) {
        var m = text.match(/(?:play|open)\s+(?:the\s+)?video\s+([\w\s\-]+)\s+on\s+youtube/i) ||
                text.match(/\bplay\s+([\w\s\-]+?)\s+on\s+youtube/i);
        var q = m ? m[1].trim() : "";
        if (!q) return { ok: false, message: "What should I play on YouTube?" };
        // Open a YouTube search so the video starts; uses the phone's remote access.
        return post("/api/device/action", { action: "open", value: "https://www.youtube.com/results?search_query=" + encodeURIComponent(q) }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Opened YouTube for \"" + q + "\" on the phone." : "Could not open YouTube." };
        });
      }
    });
    registerCommand({
      module: "youtube", category: "youtube", name: "yt-search", admin: true,
      match: [/\bsearch\s+youtube\s+for\s+([\w\s\-]+)\b/i, /\b(?:search|find)\s+([\w\s\-]+)\s+on\s+youtube\b/i],
      run: function (text) {
        var m = text.match(/(?:search\s+youtube\s+for|search|find)\s+([\w\s\-]+?)(?:\s+on\s+youtube)?/i);
        var q = m ? m[1].trim() : "";
        if (!q) return { ok: false, message: "What should I search on YouTube?" };
        return post("/api/device/action", { action: "open", value: "https://www.youtube.com/results?search_query=" + encodeURIComponent(q) }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Searched YouTube for \"" + q + "\"." : "Could not open YouTube." };
        });
      }
    });
    registerCommand({
      module: "youtube", category: "youtube", name: "yt-open-id", admin: true,
      match: [/\bopen\s+youtube\s+video\s+([\w\-]{8,})\b/i, /\bwatch\s+youtube\s+id\s+([\w\-]{8,})\b/i],
      run: function (text) {
        var m = text.match(/([\w\-]{11})/);
        var id = m ? m[1] : "";
        if (!id) return { ok: false, message: "Which YouTube video ID?" };
        return post("/api/device/action", { action: "open", value: "https://www.youtube.com/watch?v=" + id }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.ok) ? "Opened YouTube video " + id + "." : "Could not open YouTube." };
        });
      }
    });
    registerCommand({
      module: "youtube", category: "youtube", name: "yt-pause", admin: true,
      match: [/\b(pause|resume)\s+(youtube|video|playback)\s+on\s+the\s+phone\b/i, /\b(youtube|video)\s+(pause|resume)\b/i],
      run: function (text) {
        // Best-effort: open the phone back to YouTube then rely on remote access.
        return { ok: true, message: "Use the phone's Remote Screen (mirror) to tap play/pause, or press the volume buttons. Full transport control needs the MediaSession controller (see roadmap)." };
      }
    });

    // ---- Extended remote control (type, swipe, long press, dump) ----
    registerCommand({
      module: "mirror", category: "remote", name: "mirror-type", admin: true,
      match: [/\btype\s+(.+?)\s+(on|into)\s+(the\s+)?(phone|device|field)\b/i, /\btype\s+([\w\s@.\/#\-]+)\s+on\s+the\s+phone\b/i],
      run: function (text) {
        var m = text.match(/\btype\s+([\s\S]+?)\s+(?:on|into)\s+(?:the\s+)?(?:phone|device|field)\b/i);
        var t = m ? m[1].trim() : "";
        if (!t) return { ok: false, message: "What should I type on the phone?" };
        return post("/api/mirror/type", { text: t }).then(function (r) {
          return { ok: !!(r && r.ok), message: (r && r.message) || "Typed on the phone." };
        });
      }
    });
    registerCommand({
      module: "mirror", category: "remote", name: "mirror-swipe", admin: true,
      match: [/\bswipe\s+(left|right|up|down)\s+on\s+the\s+phone\b/i, /\bswipe\s+(left|right|up|down)\b/i],
      run: function (text) {
        var m = text.match(/\b(left|right|up|down)\b/i);
        var d = m ? m[1].toLowerCase() : "up";
        return post("/api/mirror/swipe", { direction: d }).then(function (r) {
          return { ok: !!(r && r.ok), message: "Swiped " + d + " on the phone." };
        });
      }
    });
    registerCommand({
      module: "mirror", category: "remote", name: "mirror-longpress", admin: true,
      match: [/\blong[- ]?press\s+([\w\s]+?)\s+on\s+the\s+phone\b/i, /\bhold\s+([\w\s]+?)\s+on\s+the\s+phone\b/i],
      run: function (text) {
        var m = text.match(/\blong[- ]?press\s+([\w\s]+?)\s+on\s+the\s+phone\b/i);
        var t = m ? m[1].trim() : "";
        if (!t) return { ok: false, message: "What should I long-press on the phone?" };
        return post("/api/mirror/click", { kind: "longpress", text: t }).then(function (r) {
          return { ok: !!(r && r.ok), message: "Long-pressed " + t + "." };
        });
      }
    });
    registerCommand({
      module: "mirror", category: "remote", name: "mirror-dump", admin: true,
      match: [/\bwhat\s+is\s+on\s+(the\s+)?(phone|screen)\b/i, /\b(screen|phone)\s+(content|text)\b/i, /\bdump\s+screen\b/i],
      run: function () {
        return post("/api/mirror/dump", {}).then(function (r) {
          var s = (r && r.screen) || "no content";
          return { ok: true, message: "On screen:\n" + s.slice(0, 600) };
        });
      }
    });
    registerCommand({
      module: "mirror", category: "remote", name: "mirror-scroll", admin: true,
      match: [/\bscroll\s+(up|down)\s+on\s+the\s+phone\b/i, /\bphone\s+scroll\s+(up|down)\b/i],
      run: function (text) {
        var m = text.match(/\b(up|down)\b/i);
        var d = m ? m[1].toLowerCase() : "down";
        return post("/api/mirror/click", { kind: "scroll", text: d }).then(function (r) {
          return { ok: !!(r && r.ok), message: "Scrolled " + d + " on the phone." };
        });
      }
    });

    // --- LocalHub OS: Universal Search, Timeline, Spaces, Automation Builder ---
    registerCommand({
      module: "os", category: "search", name: "os-search",
      match: [/\b(search|find|look for|open\s+search)\s+(everything|files|something|for)\b/i,
              /\buniversal\s+search\b/i, /\bsearch\s+(the\s+)?os\b/i],
      run: function (text) {
        var m = text.match(/(?:search|find|look for)\s+(?:for\s+)?(.+)/i);
        var q = m ? m[1].trim() : "";
        if (q) {
          // Record + open the OS search page with the query.
          try { if (global.LH_OS && global.LH_OS.Store) global.LH_OS.Store.pushSearch(q); } catch (e) {}
        }
        return { ok: true, message: "Opening Universal Search" + (q ? " for '" + q + "'" : "") + "…", openFM: "/os#search" };
      }
    });
    registerCommand({
      module: "os", category: "timeline", name: "os-timeline",
      match: [/\b(show|open|view)\s+(the\s+)?(activity\s+)?timeline\b/i, /\bshow\s+(today|yesterday)'?s?\s+activity\b/i,
              /\bactivity\s+history\b/i, /\b(show|view)\s+timeline\b/i],
      run: function (text) {
        var m = text.match(/(today|yesterday)/i);
        var scope = m ? m[1].toLowerCase() : "";
        var msg = scope === "yesterday" ? "Showing yesterday's activity in the Timeline." : "Opening the Activity Timeline…";
        return { ok: true, message: msg, openFM: "/os#timeline" };
      }
    });
    registerCommand({
      module: "os", category: "spaces", name: "os-space",
      match: [/\b(open|switch\s+to|go\s+to|enter)\s+(the\s+)?([a-z]+)\s+space\b/i, /\bswitch\s+space\b/i,
              /\bopen\s+media\s+space\b/i, /\b(media|downloads|development|office|family|home)\s+space\b/i],
      run: function (text) {
        var t = text.toLowerCase();
        var map = { media: "media", downloads: "downloads", development: "development", office: "office", family: "family", home: "home" };
        var id = null;
        Object.keys(map).forEach(function (k) { if (t.indexOf(k + " space") >= 0 || t.indexOf("space " + k) >= 0) id = map[k]; });
        if (!id && t.indexOf("media") >= 0) id = "media";
        return { ok: true, message: (id ? "Switching to the " + id + " Space." : "Opening Spaces…"),
                 openFM: "/os#spaces", action: id ? { type: "space", id: id } : null };
      }
    });
    registerCommand({
      module: "os", category: "automation", name: "os-automation-builder",
      match: [/\b(create|build|make|open|show)\s+(a\s+|an\s+)?automation\b/i, /\bautomation\s+builder\b/i,
              /\bvisual\s+automation\b/i, /\bcreate\s+(a\s+)?workflow\b/i],
      run: function () { return { ok: true, message: "Opening the Visual Automation Builder…", openFM: "/os#automation" }; }
    });
    registerCommand({
      module: "os", category: "activity", name: "os-recent-uploads",
      match: [/\b(show|my|recent)\s+(recent\s+)?(uploads|downloads)\b/i, /\bmy\s+recent\s+(uploads|downloads)\b/i],
      run: function () {
        var tl = (global.LH_OS && global.LH_OS.Store) ? global.LH_OS.Store.timeline() : [];
        var up = tl.filter(function (e) { return e.type && e.type.indexOf("upload") >= 0; }).slice(0, 8);
        var msg = up.length ? "Recent uploads:\n" + up.map(function (e) { return "· " + (e.detail || "") + "  (" + new Date(e.ts).toLocaleTimeString() + ")"; }).join("\n") : "No recent uploads found.";
        return { ok: true, message: msg };
      }
    });
    registerCommand({
      module: "os", category: "activity", name: "os-pin-search",
      match: [/\bpin\s+(this\s+)?search\b/i, /\bsave\s+this\s+search\b/i],
      run: function (text) {
        var q = (global.LH_AI && global.LH_AI.Context) ? global.LH_AI.Context.get("search") : null;
        if (!q) return { ok: true, message: "No active search to pin." };
        if (global.LH_OS && global.LH_OS.Store) global.LH_OS.Store.togglePinSearch(q);
        return { ok: true, message: "Pinned search: '" + q + "'." };
      }
    });

    // ---- User-centric assistant commands (available to everyone) ----
    registerCommand({
      module: "user", category: "me", name: "user-recent",
      match: [/\b(show|what|list)\s+(are\s+)?(my\s+)?recent\s+(media|files|activity)\b/i, /\bmy\s+(media|files)\b/i, /\bwhat\s+did\s+i\s+(watch|open|play)\b/i],
      run: function (text) {
        var ctx = global.LH_AI && global.LH_AI.Context;
        if (!ctx) return { ok: true, message: "No recent activity available." };
        var media = ctx.get("mediaHistory") || [];
        var line = "Your recent media:\n" + (media.slice(0, 5).map(function (m) { return "· " + m.name; }).join("\n") || "none yet.");
        return { ok: true, message: line };
      }
    });
    registerCommand({
      module: "user", category: "me", name: "user-help",
      match: [/\b(what|show)\s+(can\s+i\s+do|my\s+options|available\s+actions)\b/i, /\bmy\s+controls\b/i],
      run: function () {
        var role = currentRole || "user";
        var base = "Here's what you can do as a " + role + ":\n" +
          "· Open File Manager, search files, play media\n" +
          "· Check your recent media and activity\n" +
          "· Ask about system status, storage, network\n";
        if (role === "admin") base += "· Manage devices (block/unblock/restrict), server control, logs\n";
        return { ok: true, message: base };
      }
    });



    // --- Server control ---
    registerCommand({
      module: "server", category: "control", name: "server-restart",
      match: [/\b(restart|reboot|reload)\s+(the\s+)?server\b/i, /\brestart\s+localhub\b/i, /\b(reboot|restart)\s+localhub\b/i],
      run: function () { return { ok: true, action: "server/restart", message: "Restarting LocalHub server…" }; }
    });
    registerCommand({
      module: "server", category: "control", name: "server-stop",
      match: [/\b(stop|shut\s?down|halt|power\s?off)\s+(the\s+)?server\b/i, /\bstop\s+localhub\b/i],
      run: function () { return { ok: true, action: "server/stop", message: "Stopping LocalHub server…" }; }
    });
    registerCommand({
      module: "server", category: "control", name: "server-start",
      match: [/\b(start|launch|turn\s?on|boot)\s+(the\s+)?server\b/i, /\bstart\s+localhub\b/i],
      run: function () { return { ok: true, action: "server/start", message: "Starting LocalHub server…" }; }
    });
    registerCommand({
      module: "server", category: "control", name: "server-status",
      match: [/\b(server|localhub)\s+status\b/i, /\bshow\s+status\b/i, /\bstatus\b/i, /\bserver\s+health\b/i, /\bhealth\b/i],
      run: function () { return FS.status().then(function (st) {
        return { ok: true, message: "🟢 Online · " + (st.url || "") + " · v" + (st.version || "?") + "\nUptime: " + fmtUptime(st.uptimeMs) + " · Restarts: " + (st.restartCount || 0), data: st };
      }); }
    });
    registerCommand({
      module: "server", category: "control", name: "server-connections",
      match: [/\b(connected\s+clients|current\s+connections|connections)\b/i, /\bshow\s+connections\b/i],
      run: function () { return FS.clients().then(function (c) {
        var list = (c && c.clients) || [];
        return { ok: true, message: "Connected clients: " + list.length + (list.length ? "\n" + list.map(function (x) { return x.ip + " (" + (x.protocol || "HTTP") + ")"; }).join("\n") : ""), data: list };
      }); }
    });

    // --- System / telemetry ---
    registerCommand({
      module: "system", category: "telemetry", name: "sys-cpu",
      match: [/\bcpu\s+(usage|load|percent)\b/i, /\bshow\s+cpu\b/i, /\bcpu\s+usage\b/i],
      run: function () { return FS.system().then(function (s) {
        var c = s && s.cpu || {}; return { ok: true, message: "CPU: " + (c.usagePercent != null ? c.usagePercent.toFixed(1) : "0") + "% · " + (c.cores || 1) + " cores" };
      }); }
    });
    registerCommand({
      module: "system", category: "telemetry", name: "sys-ram",
      match: [/\bram\s+(usage|used)\b/i, /\bmemory\s+(usage|used)\b/i, /\bshow\s+ram\b/i, /\bshow\s+memory\b/i],
      run: function () { return FS.system().then(function (s) {
        var m = s && s.memory || {}; return { ok: true, message: "RAM: " + fmtSize(m.usedBytes) + " / " + fmtSize(m.totalBytes) + " (" + (m.usagePercent != null ? m.usagePercent.toFixed(0) : 0) + "%)" };
      }); }
    });
    registerCommand({
      module: "system", category: "telemetry", name: "sys-storage",
      match: [/\bstorage\s+(usage|used|free)\b/i, /\bdisk\s+(usage|space)\b/i, /\bshow\s+storage\b/i, /\bshow\s+disk\b/i, /\bdisk\s+usage\b/i],
      run: function () { return FS.usage().then(function (u) {
        return { ok: true, message: "Storage: " + fmtSize(u.usedBytes) + " used · " + fmtSize(u.availableBytes) + " free · of " + fmtSize(u.totalBytes) };
      }); }
    });
    registerCommand({
      module: "system", category: "telemetry", name: "sys-battery",
      match: [/\bbattery\b/i, /\bshow\s+battery\b/i, /\bbattery\s+(level|percent)\b/i],
      run: function () { return FS.system().then(function (s) {
        var b = s && s.battery || {};
        return { ok: true, message: "Battery: " + (b.level != null ? b.level : 0) + "% · " + (b.isCharging ? "Charging" : "Discharging") + " · " + (b.temperatureCelsius != null ? b.temperatureCelsius : 0) + "°C" };
      }); }
    });
    registerCommand({
      module: "system", category: "telemetry", name: "sys-temp",
      match: [/\btemperature\b/i, /\bcpu\s+temp\b/i, /\bbattery\s+temp\b/i, /\bheat\b/i],
      run: function () { return FS.system().then(function (s) {
        var b = s && s.battery || {};
        return { ok: true, message: "Battery temperature: " + (b.temperatureCelsius != null ? b.temperatureCelsius : 0) + "°C" };
      }); }
    });
    registerCommand({
      module: "system", category: "telemetry", name: "sys-network-speed",
      match: [/\bnetwork\s+speed\b/i, /\bspeed\s+test\b/i, /\bbandwidth\b/i],
      run: function () { return FS.system().then(function (s) {
        var n = s && s.network || {};
        return { ok: true, message: "Network: " + (n.type || "—") + " · link " + (n.linkSpeedMbps || 0) + " Mbps" };
      }); }
    });
    registerCommand({
      module: "system", category: "telemetry", name: "sys-uptime",
      match: [/\buptime\b/i, /\bshow\s+uptime\b/i, /\brunning\s+since\b/i],
      run: function () { return FS.status().then(function (st) {
        return { ok: true, message: "Server uptime: " + fmtUptime(st.uptimeMs) + (st.startedAt ? "\nStarted: " + new Date(st.startedAt).toLocaleString() : "") };
      }); }
    });
    registerCommand({
      module: "system", category: "device", name: "sys-device",
      match: [/\b(android|device|phone|model)\s*(version|model)?\b/i, /\bshow\s+device\b/i, /\babout\s+device\b/i],
      run: function () { return FS.system().then(function (s) {
        var d = s && s.device || {};
        return { ok: true, message: "Device: " + (d.manufacturer || "?") + " " + (d.model || "?") + "\nAndroid: " + (d.androidVersion || "?") + " (API " + (d.sdkInt || "?") + ")\nArch: " + (d.board || "?") };
      }); }
    });

    // --- Network / address ---
    registerCommand({
      module: "network", category: "info", name: "net-ip",
      match: [/\b(show|get|my|current)?\s*ip\s*(address)?\b/i, /\bwhat('s| is)? my ip\b/i],
      run: function () { return FS.system().then(function (s) {
        return { ok: true, message: "IP: " + ((s && s.network && s.network.ipAddress) || "?") };
      }); }
    });
    registerCommand({
      module: "network", category: "info", name: "net-hostname",
      match: [/\bhostname\b/i, /\baddress\s+of\s+server\b/i],
      run: function () { return FS.status().then(function (st) {
        return { ok: true, message: "Hostname: " + (st.hostname || "localhub.local") + " · URL: " + (st.hostnameUrl || "") };
      }); }
    });
    registerCommand({
      module: "network", category: "info", name: "net-ssid",
      match: [/\bssid\b/i, /\bwifi\s+name\b/i, /\bwhich\s+wifi\b/i],
      run: function () { return FS.system().then(function (s) {
        var n = s && s.network || {};
        return { ok: true, message: "SSID: " + (n.ssid || "—") + " · Type: " + (n.type || "—") };
      }); }
    });
    registerCommand({
      module: "network", category: "info", name: "net-port",
      match: [/\bport\b/i, /\bshow\s+port\b/i],
      run: function () { return FS.status().then(function (st) {
        return { ok: true, message: "Port: " + (st.port || "?") };
      }); }
    });

    // --- Navigation (open pages) ---
    registerCommand({
      module: "nav", category: "open", name: "nav-dashboard",
      match: [/\b(open|go to|show)\s+(the\s+)?dashboard\b/i, /\b(dashboard|home page)\b/i],
      run: function () { return open("/"); }
    });
    registerCommand({
      module: "nav", category: "open", name: "nav-files",
      match: [/\b(open|go to|show|launch)\s+(the\s+)?file\s?manager\b/i, /\bfile\s?manager\b/i],
      run: function () { return open("/files"); }
    });
    registerCommand({
      module: "nav", category: "open", name: "nav-settings",
      match: [/\b(open|go to|show)\s+(the\s+)?settings\b/i, /\bsettings\b/i, /\bopen\s+localhub\s+settings\b/i],
      run: function () { return { ok: true, message: "Settings live in the Android app. On the phone open LocalHub → Settings." }; }
    });
    registerCommand({
      module: "nav", category: "open", name: "nav-media",
      match: [/\b(open|go to|show|launch)\s+(the\s+)?media\s?player\b/i, /\bopen\s+player\b/i],
      run: function () { return open("/player"); }
    });

    // --- File Manager control ---
    registerCommand({
      module: "files", category: "navigate", name: "fm-open-folder",
      match: [/\b(open|go to|take me to|show|list|browse)\s+(the\s+)?(downloads?|pictures?|dcim|camera|documents?|movies?|music)\s*(folder|dir)?\b/i,
              /\b(go\s+to|open|show)\s+downloads\b/i, /^(downloads|pictures|dcim|camera|documents|movies|music)\s*$/i],
      run: function (text) {
        var m = text.toLowerCase().match(/(downloads?|pictures?|dcim|camera|documents?|movies?|music)/);
        var map = { downloads: "/storage/emulated/0/Download", download: "/storage/emulated/0/Download",
          pictures: "/storage/emulated/0/Pictures", picture: "/storage/emulated/0/Pictures",
          dcim: "/storage/emulated/0/DCIM", camera: "/storage/emulated/0/DCIM/Camera",
          documents: "/storage/emulated/0/Documents", document: "/storage/emulated/0/Documents",
          movies: "/storage/emulated/0/Movies", movie: "/storage/emulated/0/Movies",
          music: "/storage/emulated/0/Music" };
        var p = map[m && m[1]] || ROOT;
        return open("/files?path=" + encodeURIComponent(p));
      }
    });
    registerCommand({
      module: "files", category: "navigate", name: "fm-home",
      match: [/\b(go|back)\s+to\s+home\b/i, /\b(go|open)\s+root\b/i, /\bfm\s+home\b/i, /\bstorage\s+root\b/i],
      run: function () { return open("/files?path=" + encodeURIComponent(ROOT)); }
    });
    registerCommand({
      module: "files", category: "navigate", name: "fm-back",
      match: [/\bgo\s+back\b/i, /\bprevious\s+folder\b/i, /\bup\s+one\s+(folder|level)\b/i],
      run: function () {
        // Use the Context Engine's folder stack so "go back" returns to the
        // previously viewed folder rather than always root.
        if (global.LH_AI.Context) {
          var prev = global.LH_AI.Context.goBackFolder();
          if (prev) return open("/files?path=" + encodeURIComponent(prev), "previous folder");
        }
        return open("/files", "file manager");
      }
    });
    registerCommand({
      module: "files", category: "search", name: "fm-search",
      match: [/\b(search|find)\s+(for\s+)?(files?\s+)?named\s+/i, /\b(search|find)\s+(movie|video|apk|file|image)\s+/i],
      run: function (text) {
        var q = text.replace(/^(search|find|look for)\s+(for\s+)?(files?\s+)?named\s+/i, "")
                    .replace(/^(search|find)\s+(movie|video|apk|file|image)\s+for\s+/i, "")
                    .replace(/["']/g, "").trim();
        if (!q) return { ok: false, message: "What should I search for?" };
        return FS.search(q, ROOT).then(function (r) {
          var hits = (r.matches || []).slice(0, 20);
          return { ok: true, message: hits.length ? "Found " + hits.length + ":\n" + hits.map(function (h) { return h.path; }).join("\n") : "No matches for '" + q + "'", data: hits };
        });
      }
    });
    registerCommand({
      module: "files", category: "search", name: "fm-show-category",
      match: [/\bshow\s+(images|photos|videos|audio|music|documents|apk|movies)\b/i, /\b(list|show)\s+all\s+(images|videos|audio|documents)\b/i],
      run: function (text) {
        var m = text.toLowerCase().match(/(images|photos|videos|audio|music|documents|apk|movies)/);
        var ext = { images: "image", photos: "image", videos: "video", audio: "audio", music: "audio",
                    documents: "text", movies: "video" };
        var cat = ext[m && m[1]] || (m && m[1] === "apk" ? "apk" : "image");
        return { ok: true, message: "Showing " + (m ? m[1] : "media") + " — opening the File Manager.", openFM: "/files?category=" + encodeURIComponent(cat) };
      }
    });
    registerCommand({
      module: "files", category: "analysis", name: "fm-largest",
      match: [/\b(largest|biggest|big)\s+files?\b/i, /\btop\s+(largest|biggest)\s+files\b/i],
      run: function () { return FS.largest(ROOT, 15).then(function (r) {
        return { ok: true, message: "Largest files:\n" + (r.items || []).map(function (x) { return fmtSize(x.size) + "  " + x.path; }).join("\n"), data: r };
      }); }
    });
    registerCommand({
      module: "files", category: "analysis", name: "fm-recent",
      match: [/\brecent\s+files?\b/i, /\bnewest\s+files\b/i, /\bjust\s+(opened|added)\b/i],
      run: function () { return FS.largest(ROOT, 15).then(function (r) {
        return { ok: true, message: "Recent activity: latest files by size below.\n" + (r.items || []).map(function (x) { return x.path; }).join("\n") };
      }); }
    });
    registerCommand({
      module: "files", category: "analysis", name: "fm-empty",
      match: [/\bempty\s+folders?\b/i, /\bfolders?\s+that\s+are\s+empty\b/i],
      run: function () { return FS.emptyFolders(ROOT).then(function (r) {
        return { ok: true, message: (r.items || []).length ? "Empty folders:\n" + r.items.slice(0, 25).join("\n") : "No empty folders found." };
      }); }
    });

    // --- File operations (real execution) ---
    registerCommand({
      module: "files", category: "operations", name: "fm-rename", admin: true,
      match: [/\brename\s+(this\s+|the\s+)?(file|folder)?\s*([\w\s\-\.]+)?\s+(to|as)\s+([\w\s\-\.]+)/i,
              /\brename\s+(it|this|that|the file|the folder)\s+(to|as)\s+([\w\s\-\.]+)/i],
      run: async function (text) {
        var ctx = global.LH_AI.Context;
        var target = contextPath() || (await resolvePath(text));
        var m = text.match(/(?:to|as)\s+([\w\s\-\.]+)\s*$/i);
        var newName = m ? m[1].trim() : null;
        if (!target) return { ok: false, message: "Which file should I rename? Provide a name or path." };
        if (!newName) return { ok: false, message: "What should the new name be? Try 'rename it to Resume.pdf'." };
        var r = await FS.rename(target, newName);
        return { ok: r.ok, message: r.ok ? "Renamed to " + (r.path || newName) + "." : (r.error || "rename failed"), data: r };
      }
    });
    registerCommand({
      module: "files", category: "operations", name: "fm-move", admin: true,
      match: [/\bmove\s+(this\s+|the\s+)?(file|folder)?\s*([\w\s\-\.]+)?\s+to\s+([\w\s\/\-\.]+)/i,
              /\bmove\s+(it|this|that)\s+to\s+([\w\s\/\-\.]+)/i],
      run: async function (text) {
        var target = contextPath() || (await resolvePath(text));
        var m = text.match(/(?:to)\s+(\/[\w\s\/\-\.]+|[\w\s]+\/)/i);
        var dest = m ? m[1].trim() : null;
        if (!target) return { ok: false, message: "Which file or folder should I move?" };
        if (!dest) return { ok: false, message: "Where should I move it to? Give a destination folder path." };
        dest = resolveDest(dest);
        var r = await FS.move(target, dest);
        return { ok: r.ok, message: r.ok ? "Moved to " + (r.path || dest) + "." : (r.error || "move failed"), data: r };
      }
    });
    registerCommand({
      module: "files", category: "operations", name: "fm-copy", admin: true,
      match: [/\bcopy\s+(this\s+|the\s+)?(file|folder)?\s*([\w\s\-\.]+)?\s+to\s+([\w\s\/\-\.]+)/i,
              /\bcopy\s+(it|this|that)\s+to\s+([\w\s\/\-\.]+)/i],
      run: async function (text) {
        var target = contextPath() || (await resolvePath(text));
        var m = text.match(/(?:to)\s+(\/[\w\s\/\-\.]+|[\w\s]+\/)/i);
        var dest = m ? m[1].trim() : null;
        if (!target) return { ok: false, message: "Which file or folder should I copy?" };
        if (!dest) return { ok: false, message: "Where should I copy it to? Give a destination folder path." };
        dest = resolveDest(dest);
        var r = await FS.copy(target, dest);
        return { ok: r.ok, message: r.ok ? "Copied to " + (r.path || dest) + "." : (r.error || "copy failed"), data: r };
      }
    });
    registerCommand({
      module: "files", category: "operations", name: "fm-delete", admin: true,
      match: [/\b(delete|remove|trash)\s+(this\s+|the\s+)?(file|folder)\b/i,
              /\bdelete\s+(it|this|that|the file|the folder)\b/i,
              /\bdelete\s+([\w\s\-\.]+\.[\w]+)\b/i],
      run: async function (text) {
        var target = contextPath() || (await resolvePath(text));
        if (!target) return { ok: false, message: "What should I delete? Give a file or folder." };
        var r = await FS.delete(target);
        return { ok: r.ok, message: r.ok ? "Deleted " + baseName(target) + "." : (r.error || "delete failed"), data: r };
      }
    });
    registerCommand({
      module: "files", category: "operations", name: "fm-mkdir", admin: true,
      match: [/\b(create|make|new)\s+(a\s+)?folder\s+(?:called|named)?\s*([\w\s\-]+)/i,
              /\b(create|make|new)\s+folder\s+(it|here)\b/i],
      run: async function (text) {
        var ctx = global.LH_AI.Context;
        var parent = (ctx && ctx.get) ? (ctx.get("folder") || ROOT) : ROOT;
        var m = text.match(/\b(?:called|named)\s+[\"']?([\w\s\-]+?)[\"']?\s*$/i) || text.match(/(?:folder)\s+[\"']?([\w\s\-]+?)[\"']?$/i);
        var name = m ? m[1].trim() : "NewFolder";
        var r = await FS.mkdir(parent, name);
        return { ok: r.ok, message: r.ok ? "Created folder " + (r.path || parent + "/" + name) + "." : (r.error || "create failed"), data: r };
      }
    });
    registerCommand({
      module: "files", category: "operations", name: "fm-create-file", admin: true,
      match: [/\bcreate\s+(a\s+)?file\s+(?:called|named)?\s*([\w\s\-\.]+)/i],
      run: async function (text) {
        var ctx = global.LH_AI.Context;
        var dir = (ctx && ctx.get) ? (ctx.get("folder") || ROOT) : ROOT;
        var m = text.match(/(?:called|named)?\s*[\"']?([\w\s\-\.]+)[\"']?$/i);
        var name = m ? m[1].trim() : "newfile.txt";
        var r = await FS.write(dir + "/" + name, "");
        return { ok: r.ok, message: r.ok ? "Created file " + (r.path || name) + "." : (r.error || "create failed"), data: r };
      }
    });
    registerCommand({
      module: "files", category: "operations", name: "fm-compress", admin: true,
      match: [/\b(compress|zip|archive)\s+(this\s+|the\s+)?(folder|file)?\b/i,
              /\bcompress\s+it\b/i],
      run: async function (text) {
        var target = contextPath() || (await resolvePath(text));
        if (!target) return { ok: false, message: "What should I compress?" };
        var ctx = global.LH_AI.Context;
        var dir = (ctx && ctx.get) ? (ctx.get("folder") || ROOT) : ROOT;
        var dest = dir + "/" + baseName(target) + ".zip";
        var r = await FS.zip([target], dest);
        return { ok: r.ok, message: r.ok ? "Compressed to " + (r.path || dest) + "." : (r.error || "zip failed"), data: r };
      }
    });
    registerCommand({
      module: "files", category: "operations", name: "fm-extract", admin: true,
      match: [/\b(extract|unzip|decompress)\s+(this\s+|the\s+)?zip\b/i,
              /\bextract\s+it\b/i],
      run: async function (text) {
        var target = contextPath() || (await resolvePath(text));
        if (!target) return { ok: false, message: "Which ZIP should I extract?" };
        var ctx = global.LH_AI.Context;
        var dir = (ctx && ctx.get) ? (ctx.get("folder") || ROOT) : ROOT;
        var dest = dir + "/" + baseName(target).replace(/\.zip$/i, "");
        var r = await FS.unzip(target, dest);
        return { ok: r.ok, message: r.ok ? "Extracted " + (r.count || "files") + " to " + (r.path || dest) + "." : (r.error || "extract failed"), data: r };
      }
    });
    registerCommand({
      module: "files", category: "operations", name: "fm-duplicate", admin: true,
      match: [/\bduplicate\s+(this\s+|the\s+)?(file|folder)?\s*([\w\s\-\.]+)?\b/i,
              /\b(duplicate|clone)\s+it\b/i],
      run: async function (text) {
        var target = contextPath() || (await resolvePath(text));
        if (!target) return { ok: false, message: "What should I duplicate?" };
        var dir = dirOf(target);
        var base = baseName(target);
        var dot = base.lastIndexOf(".");
        var stem = dot > 0 ? base.substring(0, dot) : base;
        var ext = dot > 0 ? base.substring(dot) : "";
        var copyName = stem + " (copy)" + ext;
        var r = await FS.copy(target, dir);
        // copy() writes to dest dir with same name; then rename to " (copy)"
        await FS.rename(r.path || (dir + "/" + base), copyName);
        return { ok: true, message: "Duplicated " + base + " as " + copyName + "." };
      }
    });
    registerCommand({
      module: "files", category: "operations", name: "fm-share",
      match: [/\bshare\s+(this\s+|the\s+)?(file|folder)?\s*([\w\s\-\.]+)?\b/i, /\bshare\s+it\b/i],
      run: async function (text) {
        var target = contextPath() || (await resolvePath(text));
        if (!target) return { ok: false, message: "What should I share?" };
        var url = FS.contentUrl(target);
        if (global.navigator && global.navigator.share) {
          try { await global.navigator.share({ title: baseName(target), url: url }); return { ok: true, message: "Shared " + baseName(target) + "." }; }
          catch (e) { return { ok: false, message: "Share cancelled." }; }
        }
        return { ok: true, message: "Copy this link: " + url, data: { url: url } };
      }
    });
    registerCommand({
      module: "files", category: "operations", name: "fm-open",
      match: [/\bopen\s+(this\s+|the\s+)?(file|media|video|image|pdf|audio)?\s*([\w\s\-\.]+)?\b/i, /\bopen\s+it\b/i],
      run: async function (text) {
        var target = contextPath() || (await resolvePath(text));
        if (!target) return { ok: false, message: "What should I open?" };
        var cat = categoryOfPath(target);
        if (cat === "video" || cat === "audio") return open("/player?file=" + encodeURIComponent(target), "media");
        if (cat === "image" || cat === "pdf") return open("/files?path=" + encodeURIComponent(dirOf(target)) + "&preview=" + encodeURIComponent(target), "file");
        return open("/files?path=" + encodeURIComponent(dirOf(target)) + "&preview=" + encodeURIComponent(target), "file");
      }
    });
    registerCommand({
      module: "files", category: "operations", name: "fm-preview",
      match: [/\bpreview\s+(this\s+|the\s+)?(file|image|pdf|video|audio)?\s*([\w\s\-\.]+)?\b/i, /\bpreview\s+it\b/i],
      run: async function (text) {
        var target = contextPath() || (await resolvePath(text));
        if (!target) return { ok: false, message: "What should I preview?" };
        return open("/files?path=" + encodeURIComponent(dirOf(target)) + "&preview=" + encodeURIComponent(target), "file");
      }
    });
    registerCommand({
      module: "files", category: "operations", name: "fm-properties",
      match: [/\b(properties|details|info)\s+(of\s+|about\s+|for\s+)?(this\s+|the\s+)?(file|folder)?\s*([\w\s\-\.]+)?\b/i,
              /\bshow\s+(details|properties)\s+of\s+it\b/i],
      run: async function (text) {
        var target = contextPath() || (await resolvePath(text));
        if (!target) return { ok: false, message: "Which file's properties?" };
        var info = await FS.info(target);
        if (!info || !info.ok) return { ok: false, message: "Cannot read properties." };
        var gb = 1073741824;
        var lines = [
          "Name: " + (info.name || baseName(target)),
          "Path: " + (info.path || target),
          "Type: " + (info.isDir ? "Folder" : (info.mime || "—")),
          "Size: " + (info.isDir ? "—" : fmtSize(info.size)),
          "Modified: " + (info.modified ? new Date(info.modified).toLocaleString() : "—"),
          "Category: " + (info.category || "—")
        ];
        return { ok: true, message: lines.join("\n"), data: info };
      }
    });
    function categoryOfPath(path) {
      var e = (path.split(".").pop() || "").toLowerCase();
      if (/^(mp4|mkv|webm|avi|mov)$/.test(e)) return "video";
      if (/^(mp3|wav|ogg|m4a|flac)$/.test(e)) return "audio";
      if (/^(jpg|jpeg|png|gif|webp|bmp|svg)$/.test(e)) return "image";
      if (e === "pdf") return "pdf";
      return "file";
    }

    // --- Media control (real control via MediaBridge) ---
    registerCommand({
      module: "media", category: "control", name: "media-play",
      match: [/\bplay\s+(movie|video|audio|music|song|file|media)\b/i, /\bopen\s+(video|movie|music|audio)\s+(named\s+)?/i, /\b(play|open)\s+media\b/i],
      run: function (text) {
        var m = text.match(/play\s+([\w\s\-\.]+?\.(?:mp4|mkv|webm|avi|mp3|wav|ogg|flac))/i);
        var file = m ? m[1].trim() : null;
        return { ok: true, message: "Playing media…", openFM: file ? "/player?file=" + encodeURIComponent(file) : "/player" };
      }
    });
    registerCommand({
      module: "media", category: "control", name: "media-resume",
      match: [/\bresume\s+(last\s+)?video\b/i, /\bresume\s+playback\b/i, /\bcontinue\s+watching\b/i, /\bcontinue\s+where\s+i\s+stopped\b/i],
      run: function () { sendMedia("resume"); return { ok: true, message: "Resuming playback.", openFM: "/player" }; }
    });
    registerCommand({
      module: "media", category: "control", name: "media-pause",
      match: [/\bpause\s+(media|video|playback)\b/i, /\bpause\s+video\b/i, /\bpause\s+it\b/i],
      run: function () { sendMedia("pause"); return { ok: true, message: "Paused." }; }
    });
    registerCommand({
      module: "media", category: "control", name: "media-stop",
      match: [/\bstop\s+(media|video|playback|music)\b/i, /\bstop\s+it\b/i],
      run: function () { sendMedia("stop"); return { ok: true, message: "Stopped." }; }
    });
    registerCommand({
      module: "media", category: "control", name: "media-next",
      match: [/\bnext\s+(video|track|media|song)\b/i, /\bskip\s+next\b/i],
      run: function () { sendMedia("next"); return { ok: true, message: "Next." }; }
    });
    registerCommand({
      module: "media", category: "control", name: "media-prev",
      match: [/\bprevious\s+(video|track|media|song)\b/i],
      run: function () { sendMedia("previous"); return { ok: true, message: "Previous." }; }
    });
    registerCommand({
      module: "media", category: "control", name: "media-seek-fwd",
      match: [/\b(seek|skip|jump|forward)\s+forward\b/i, /\bfast\s+forward\b/i, /\bforward\s+(10|15|30|5)\s*(seconds|secs)?\b/i],
      run: function (text) { var m = text.match(/(\d+)/); sendMedia("seekForward", { seconds: m ? parseInt(m[1],10) : 10 }); return { ok: true, message: "Skipped forward." }; }
    });
    registerCommand({
      module: "media", category: "control", name: "media-seek-back",
      match: [/\b(seek|skip|jump|back)\s+back(ward)?\b/i, /\brewind\b/i],
      run: function (text) { var m = text.match(/(\d+)/); sendMedia("seekBack", { seconds: m ? parseInt(m[1],10) : 10 }); return { ok: true, message: "Skipped back." }; }
    });
    registerCommand({
      module: "media", category: "control", name: "media-jump",
      match: [/\bjump\s+to\s+(\d+)\s*(seconds|secs|min|minutes)?\b/i],
      run: function (text) {
        var m = text.match(/(\d+)\s*(seconds|secs|min|minutes)?/i);
        var n = m ? parseInt(m[1],10) : 0;
        var t = m && m[2] && /min/.test(m[2]) ? n*60 : n;
        sendMedia("jumpTo", { time: t });
        return { ok: true, message: "Jumped to " + t + "s." };
      }
    });
    registerCommand({
      module: "media", category: "control", name: "media-volume-up",
      match: [/\b(increase|raise|turn\s?up)\s+(the\s+)?volume\b/i, /\bvolume\s+up\b/i, /\bturn\s+it\s+up\b/i],
      run: function () { sendMedia("volumeUp"); return { ok: true, message: "Volume up." }; }
    });
    registerCommand({
      module: "media", category: "control", name: "media-volume-down",
      match: [/\b(decrease|lower|turn\s?down)\s+(the\s+)?volume\b/i],
      run: function () { sendMedia("volumeDown"); return { ok: true, message: "Volume down." }; }
    });
    registerCommand({
      module: "media", category: "control", name: "media-mute",
      match: [/\bmute\s+(media|audio|it)?\b/i, /\bmute\b/i],
      run: function () { sendMedia("toggleMute"); return { ok: true, message: "Mute toggled." }; }
    });
    registerCommand({
      module: "media", category: "control", name: "media-fullscreen",
      match: [/\bfullscreen\b/i, /\bfull\s+screen\b/i],
      run: function () { sendMedia("fullscreen"); return { ok: true, message: "Fullscreen requested." }; }
    });
    registerCommand({
      module: "media", category: "control", name: "media-speed",
      match: [/\b(?:playback\s*)?speed\s+(up|down|to\s+)?\s*(0\.\d+|\d+(?:\.\d+)?)\s*x?\b/i],
      run: function (text) {
        var m = text.match(/(0\.\d+|\d+(?:\.\d+)?)\s*x?/i);
        var rate = m ? parseFloat(m[1]) : 1;
        if (text.toLowerCase().indexOf("up") >= 0) rate = Math.min(3, rate + 0.25);
        if (text.toLowerCase().indexOf("down") >= 0) rate = Math.max(0.25, rate - 0.25);
        sendMedia("speed", { rate: rate });
        return { ok: true, message: "Playback speed " + rate + "x." };
      }
    });
    registerCommand({
      module: "media", category: "control", name: "media-playlist",
      match: [/\bopen\s+(a\s+)?playlist\b/i, /\bplaylist\b/i],
      run: function () { return { ok: true, message: "Playlist control is available in the Media Player." }; }
    });
    registerCommand({
      module: "media", category: "subtitle", name: "media-subtitle-next",
      match: [/\b(next|switch)\s+(to\s+the\s+)?(next\s+)?subtitle\b/i, /\bsubtitle\s+next\b/i],
      run: function () { sendMedia("subtitleNext"); return { ok: true, message: "Next subtitle track." }; }
    });
    registerCommand({
      module: "media", category: "subtitle", name: "media-subtitle-prev",
      match: [/\bprevious\s+subtitle\b/i, /\bsubtitle\s+previous\b/i, /\bsubtitle\s+back\b/i],
      run: function () { sendMedia("subtitlePrev"); return { ok: true, message: "Previous subtitle track." }; }
    });
    registerCommand({
      module: "media", category: "subtitle", name: "media-subtitle-off",
      match: [/\b(hide|turn\s?off|disable|off)\s+(the\s+)?subtitles?\b/i, /\bsubtitles?\s+off\b/i, /\bno\s+subtitles\b/i],
      run: function () { sendMedia("subtitleHide"); return { ok: true, message: "Subtitles hidden." }; }
    });
    registerCommand({
      module: "media", category: "subtitle", name: "media-subtitle-enable",
      match: [/\b(show|turn\s?on|enable)\s+(the\s+)?subtitles?\b/i, /\bsubtitles?\s+on\b/i, /\bsubtitle\s+enable\b/i],
      run: function () { sendMedia("subtitleEnable"); return { ok: true, message: "Subtitles enabled." }; }
    });
    registerCommand({
      module: "media", category: "subtitle", name: "media-subtitle-size",
      match: [/\b(increase|enlarge|make\s+bigger)\s+(the\s+)?subtitle\s+(size|font|text)\b/i,
              /\b(decrease|reduce|make\s+smaller)\s+(the\s+)?subtitle\s+(size|font|text)\b/i,
              /\bsubtitle\s+size\b/i],
      run: function (text) {
        var delta = /decrease|reduce|smaller/.test(text.toLowerCase()) ? -2 : 2;
        sendMedia("subtitleSize", { delta: delta });
        return { ok: true, message: (delta > 0 ? "Increased" : "Decreased") + " subtitle size." };
      }
    });
    registerCommand({
      module: "media", category: "subtitle", name: "media-subtitle-lang",
      match: [/\bsubtitle(?:s)?\s+(?:in|to|language)\s+([a-z]+)\b/i, /\b(?:switch\s+)?subtitles?\s+to\s+([a-z]+)\b/i],
      run: function (text) {
        var m = text.match(/(?:in|to|language)\s+([a-z]+)/i);
        var lang = m ? m[1].toLowerCase() : "";
        sendMedia("subtitleSet", { lang: lang });
        return { ok: true, message: "Switching subtitle to " + (lang || "selected") + "." };
      }
    });
    registerCommand({
      module: "media", category: "audio", name: "media-audio-lang",
      match: [/\b(?:switch|change|set)\s+(?:the\s+)?audio\s+(?:to\s+|in\s+)?([a-z]+)\b/i,
              /\b(?:english|hindi|japanese|spanish|french|tamil|telugu)\s+audio\b/i],
      run: function (text) {
        var langs = ["english","hindi","japanese","spanish","french","tamil","telugu"];
        var hit = null;
        langs.forEach(function (l) { if (text.toLowerCase().indexOf(l) >= 0) hit = l; });
        var code = { english:"en", hindi:"hi", japanese:"ja", spanish:"es", french:"fr", tamil:"ta", telugu:"te" }[hit] || (hit || "");
        sendMedia("audioSet", { lang: code });
        return { ok: true, message: "Switching audio to " + (hit || "selected") + "." };
      }
    });
    registerCommand({
      module: "media", category: "audio", name: "media-audio-next",
      match: [/\bnext\s+(audio|track|language)\b/i, /\bswitch\s+(the\s+)?audio\s+track\b/i, /\baudio\s+next\b/i],
      run: function () { sendMedia("audioNext"); return { ok: true, message: "Next audio track." }; }
    });
    registerCommand({
      module: "media", category: "audio", name: "media-audio-prev",
      match: [/\bprevious\s+(audio|track|language)\b/i, /\baudio\s+previous\b/i, /\baudio\s+back\b/i],
      run: function () { sendMedia("audioPrev"); return { ok: true, message: "Previous audio track." }; }
    });
    registerCommand({
      module: "media", category: "capture", name: "media-screenshot",
      match: [/\b(take|capture|grab)\s+(a\s+)?screenshot\b/i, /\bscreenshot\b/i, /\bcapture\s+frame\b/i],
      run: function () { sendMedia("screenshot"); return { ok: true, message: "Captured a screenshot of the current frame." }; }
    });

    // --- Logs ---
    registerCommand({
      module: "logs", category: "view", name: "logs-show",
      match: [/\b(show|view|open|display)\s+(access\s+)?logs?\b/i, /\baccess\s+logs?\b/i,
              /\btail\s+logs?\b/i, /\bview\s+server\s+requests?\b/i, /\brecent\s+requests?\b/i],
      run: function () { return FS.logs().then(function (l) {
        var logs = (l && l.logs) || [];
        return { ok: true, message: "Recent logs:\n" + logs.slice(0, 12).map(function (x) { return "[" + (x.level || "INFO") + "] " + x.message; }).join("\n") };
      }); }
    });
    registerCommand({
      module: "logs", category: "view", name: "logs-errors",
      match: [/\bshow\s+(the\s+)?errors?\b/i, /\blog\s+errors\b/i, /\berrors?\s+only\b/i],
      run: function () { return FS.logs().then(function (l) {
        var logs = ((l && l.logs) || []).filter(function (x) { return /error|warning/i.test(x.level || ""); });
        return { ok: true, message: logs.length ? "Errors/Warnings:\n" + logs.slice(0, 12).map(function (x) { return "[" + x.level + "] " + x.message; }).join("\n") : "No errors logged." };
      }); }
    });
    registerCommand({
      module: "logs", category: "manage", name: "logs-clear",
      match: [/\bclear\s+(the\s+)?logs?\b/i, /\bclear\s+log\b/i],
      run: function () { return { ok: true, action: "server/clear-logs", message: "Clearing logs…" }; }
    });
    registerCommand({
      module: "logs", category: "manage", name: "logs-export",
      match: [/\bexport\s+(the\s+)?logs?\b/i, /\bdownload\s+logs\b/i],
      run: function () { return { ok: true, action: "server/export-logs", message: "Exporting logs…" }; }
    });

    // --- Config / maintenance ---
    registerCommand({
      module: "config", category: "backup", name: "cfg-backup",
      match: [/\bbackup\s+(the\s+)?configuration\b/i, /\bbackup\s+config\b/i, /\bsave\s+config\b/i],
      run: function () { return { ok: true, action: "server/backup", message: "Backing up configuration…" }; }
    });
    registerCommand({
      module: "config", category: "backup", name: "cfg-restore",
      match: [/\brestore\s+(the\s+)?configuration\b/i, /\brestore\s+config\b/i, /\bload\s+config\b/i],
      run: function () { return { ok: true, action: "server/restore", message: "Restoring configuration…" }; }
    });
    registerCommand({
      module: "config", category: "maintenance", name: "cfg-clear-cache",
      match: [/\bclear\s+(the\s+)?cache\b/i, /\bclear\s+temp\b/i],
      run: function () { return { ok: true, action: "server/clear-cache", message: "Clearing cache…" }; }
    });
    registerCommand({
      module: "config", category: "maintenance", name: "cfg-restart-media",
      match: [/\brestart\s+media\s+(service|server)\b/i, /\brestart\s+media\b/i, /\bmedia\s+service\b/i],
      run: function () { return { ok: true, action: "server/restart", message: "Restarting media service…" }; }
    });
    registerCommand({
      module: "config", category: "maintenance", name: "cfg-restart-assets",
      match: [/\brestart\s+(the\s+)?asset\s+server\b/i, /\brestart\s+assets\b/i, /\basset\s+server\b/i],
      run: function () { return { ok: true, action: "server/restart", message: "Restarting asset server…" }; }
    });

    // --- Client management ---
    registerCommand({
      module: "clients", category: "manage", name: "client-disconnect",
      match: [/\bdisconnect\s+(client|device)\b/i, /\bkill\s+(client|connection)\b/i, /\bremove\s+client\b/i],
      run: function () { return { ok: true, message: "Use the Connected Devices list on the dashboard to disconnect a client." }; }
    });
    registerCommand({
      module: "clients", category: "manage", name: "client-rename",
      match: [/\brename\s+(client|device)\b/i],
      run: function () { return { ok: true, message: "Rename clients from the Connected Devices list." }; }
    });
    registerCommand({
      module: "clients", category: "manage", name: "client-info",
      match: [/\bclient\s+information\b/i, /\babout\s+(the\s+)?client\b/i, /\bclient\s+info\b/i],
      run: function () { return FS.clients().then(function (c) {
        var list = (c && c.clients) || [];
        return { ok: true, message: list.length ? "Clients:\n" + list.map(function (x) { return x.ip + " · " + (x.protocol || "HTTP") + " · last " + new Date(x.lastActivity).toLocaleTimeString(); }).join("\n") : "No clients." };
      }); }
    });

    // --- Non-LocalHub (NOT a chatbot) ---
    // Narrow guard: only catches clearly off-topic / general-knowledge requests
    // that the assistant's own command library doesn't handle. It deliberately
    // lets through math, unit conversions, jokes and "what is <term>" so the
    // expanded command set (commands_extra.js) can answer those itself.
    registerCommand({
      module: "core", category: "guard", name: "no-chatbot",
      match: [/\b(tell me about|who is the|poem|weather|news|elon|musk|current events|latest news|explain to me)\b/i],
      run: function () {
        return { ok: true, message: "I am the LocalHub operating system assistant. I control and manage LocalHub (files, media, server, network, logs, devices). I'm not a general chatbot — ask me about LocalHub." };
      }
    });

    // --- Automation (IF/THEN rules) ---
    registerCommand({
      module: "automation", category: "rules", name: "automation-list",
      match: [/\bautomation\s+rules?\b/i, /\bif\s+then\s+rules?\b/i, /\bshow\s+automation\b/i],
      run: function () { return { ok: true, message: "Automation: open the Automation tab to create IF/THEN rules." }; }
    });

    // --- Natural-language expansions ---
    registerCommand({
      module: "files", category: "search", name: "fm-larger-than",
      match: [/\bshow\s+files\s+(larger|bigger|greater)\s+than\s+(\d+)\s*(mb|gb|kb)?\b/i],
      run: function (text) {
        var m = text.match(/(\d+)\s*(mb|gb|kb)?/i);
        var n = m ? parseFloat(m[1]) : 0;
        var unit = m && m[2] ? m[2].toLowerCase() : "mb";
        var bytes = unit === "gb" ? n * 1073741824 : unit === "kb" ? n * 1024 : n * 1048576;
        return FS.largest(ROOT, 200).then(function (r) {
          var hits = ((r && r.items) || []).filter(function (x) { return (x.size || 0) >= bytes; }).slice(0, 20);
          return { ok: true, message: hits.length ? "Files larger than " + n + " " + unit + ":\n" + hits.map(function (x) { return fmtSize(x.size) + "  " + x.path; }).join("\n") : "No files larger than " + n + " " + unit + ".", data: hits };
        });
      }
    });
    registerCommand({
      module: "files", category: "search", name: "fm-yesterday",
      match: [/\bopen\s+(yesterday('s|day)?\s+)?photos?\b/i, /\b(yesterday's|last\s+day)\s+pictures\b/i],
      run: function () { return open("/files?path=" + encodeURIComponent(ROOT + "/Pictures"), "Pictures"); }
    });
    registerCommand({
      module: "files", category: "search", name: "fm-last-screenshot",
      match: [/\bdelete\s+the\s+last\s+screenshot\b/i, /\b(show|open)\s+last\s+screenshot\b/i],
      run: async function (text) {
        var dirs = [ROOT + "/Pictures/Screenshots", ROOT + "/DCIM/Screenshots", ROOT + "/Pictures"];
        var found = null;
        for (var i = 0; i < dirs.length; i++) {
          var res = await FS.search(".png", dirs[i]).catch(function(){ return { matches: [] }; });
          var screens = ((res && res.matches) || []).filter(function (h) { return /screenshot|screen/i.test(h.name); });
          if (screens.length) { found = screens[0].path; break; }
        }
        if (!found) return { ok: false, message: "No screenshots found." };
        if (text.toLowerCase().indexOf("delete") === 0) {
          var r = await FS.delete(found);
          return { ok: r.ok, message: r.ok ? "Deleted " + baseName(found) + "." : (r.error || "delete failed"), data: r };
        }
        return open("/files?path=" + encodeURIComponent(dirOf(found)) + "&preview=" + encodeURIComponent(found), "screenshot");
      }
    });
    registerCommand({
      module: "files", category: "search", name: "fm-search-pdf",
      match: [/\bsearch\s+pdf\s+containing\s+([\w\s]+)/i, /\bfind\s+pdf\s+with\s+([\w\s]+)/i],
      run: function (text) {
        var m = text.match(/(?:containing|with)\s+([\w\s]+)/i);
        var q = m ? m[1].trim() : "";
        return FS.search(".pdf", ROOT).then(function (r) {
          var hits = ((r && r.matches) || []).slice(0, 20);
          return { ok: true, message: hits.length ? "PDF files:\n" + hits.map(function (h) { return h.path; }).join("\n") : "No PDFs found.", data: hits };
        });
      }
    });
  }

  // ---- parser ---------------------------------------------------------------
  // Returns the first command whose any pattern matches the text.
  function parse(text) {
    var t = String(text || "").trim();
    // Prefer the MOST SPECIFIC match: among all commands whose pattern matches,
    // pick the one with the longest (most detailed) regex. This prevents short,
    // generic knowledge patterns (e.g. a single letter) from shadowing rich,
    // multi-word commands (calculators, critical-thinking, etc.). Ties fall back
    // to registration order.
    var best = null, bestLen = -1;
    for (var i = 0; i < commands.length; i++) {
      var cmd = commands[i];
      for (var j = 0; j < cmd.match.length; j++) {
        var flags = cmd.match[j].flags.indexOf("i") >= 0 ? cmd.match[j].flags : cmd.match[j].flags + "i";
        var re = new RegExp(cmd.match[j].source, flags);
        if (re.test(t)) {
          var m = re.exec(t);
          var len = m && m[0] ? m[0].length : 0;
          // Ignore very short matches (single letters / 2-char terms like "c",
          // "on", "os") so they don't shadow meaningful multi-word commands.
          // This is the key to real comprehension: "what is your limit" must not
          // match the knowledge entry for the letter "c".
          if (len < 3 && !/^(what|who|how|why|define|explain|tell|about)$/i.test(String(m && m[0]||""))) continue;
          // Prefer the longer concrete match. On a tie, prefer a "deep" command
          // (a more detailed/adult-level explanation) over a shallow one.
          var isDeep = !!(cmd && cmd.deep);
          if (len > bestLen || (len === bestLen && isDeep && best && !best.deep)) {
            bestLen = len;
            best = { command: cmd, text: t, deep: isDeep };
          }
        }
      }
    }
    return best;
  }

  // Executes a parsed command; returns a Promise resolving to { ok, message, action?, openFM?, data? }.
  function execute(parsed) {
    if (!parsed || !parsed.command) {
      return Promise.resolve({
        ok: true,
        message: "I am the LocalHub OS assistant. Commands include: open downloads, show cpu, show battery, search files, restart server, open file manager, show logs. Try one of those."
      });
    }
    // Role enforcement: admin-only commands are blocked for standard users.
    if (parsed.command.admin && currentRole !== "admin") {
      return Promise.resolve({
        ok: false,
        message: "This feature is available only for Administrator accounts."
      });
    }
    var result;
    try { result = parsed.command.run(parsed.text); }
    catch (e) { result = Promise.resolve({ ok: false, message: "Command error: " + e.message }); }
    return Promise.resolve(result);
  }

  // ---- plugin registry for future modules -----------------------------------
  function registerModule(moduleName, moduleCommands) {
    (moduleCommands || []).forEach(function (c) {
      c.module = c.module || moduleName;
      registerCommand(c);
    });
    return true;
  }

  function listCommands() {
    return commands.map(function (c) {
      return { module: c.module, category: c.category, name: c.name };
    });
  }

  function fmtUptime(ms) {
    if (!ms || ms < 0) return "—";
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400); s %= 86400;
    var h = Math.floor(s / 3600); s %= 3600; var m = Math.floor(s / 60); s %= 60;
    var parts = [];
    if (d) parts.push(d + "d"); if (h) parts.push(h + "h"); if (m) parts.push(m + "m"); parts.push(s + "s");
    return parts.join(" ");
  }

  // ---- suggestions ------------------------------------------------------------
  function suggestions(prefix) {
    prefix = String(prefix || "").toLowerCase();
    var all = [
      "open downloads", "open pictures", "open dcim", "open movies", "open music",
      "open documents", "open file manager", "open dashboard", "open media player",
      "show server status", "restart server", "stop server", "start server",
      "show connected clients", "show access logs", "show cpu usage", "show ram usage",
      "show storage usage", "show battery", "show temperature", "show uptime",
      "show current ip", "copy server address", "generate qr code",
      "backup configuration", "export logs", "clear logs", "clear cache",
      "search files named resume", "show largest files", "show empty folders",
      "show images", "show videos", "show audio", "play movie",
      "search apk", "show network speed", "show ssid",
      "what is 10 km in miles", "what is 12 times 8", "what is 25 celsius in fahrenheit",
      "what time is it", "tell me a joke", "what is a nas", "how do i play music",
      "convert 100 dollars", "make the assistant talk", "show my ip"
    ];
    if (!prefix) return all.slice(0, 12);
    return all.filter(function (s) { return s.indexOf(prefix) >= 0; }).slice(0, 12);
  }

  defineCoreCommands();

  // Mark administrator-only commands (server control, config, log management).
  var ADMIN_COMMANDS = {
    "server-restart": 1, "server-stop": 1, "server-start": 1,
    "logs-show": 1, "logs-errors": 1, "logs-clear": 1, "logs-export": 1,
    "cfg-backup": 1, "cfg-restore": 1, "cfg-clear-cache": 1,
    "cfg-restart-media": 1, "cfg-restart-assets": 1,
    "client-disconnect": 1, "client-rename": 1
  };
  commands.forEach(function (c) { if (ADMIN_COMMANDS[c.name]) c.admin = true; });

  // Export
  global.LH_AI.Commands = {
    parse: parse,
    execute: execute,
    register: registerCommand,
    registerModule: registerModule,
    list: listCommands,
    suggestions: suggestions,
    setRole: setRole,
    getRole: getRole
  };
})(window);
