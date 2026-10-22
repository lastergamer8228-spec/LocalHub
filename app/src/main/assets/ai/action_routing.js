/* action_routing.js - LocalHub Assistant Action Intelligence.
 *
 * Fixes the REAL routing bug: natural language like
 *   "Play the evil dead burn video"
 * was falling through to the knowledge/Mind engine and being answered as an
 * educational topic ("what is a video?") instead of being treated as a LocalHub
 * media ACTION.
 *
 * This layer is a thin, deterministic intent-to-capability router on top of the
 * EXISTING Assistant/Commands/Capabilities/Context/MediaBridge/FS systems. It
 * does NOT add a Brain, does NOT add a memory engine, does NOT invent
 * capabilities — it routes to capabilities that already exist.
 *
 *   INTENT CLASSIFY -> ACTION-FIRST -> CAPABILITY -> ENTITY EXTRACT ->
 *   FUZZY MATCH -> PERMISSION/RISK -> EXECUTE -> VERIFY -> RESPOND
 *
 * Fully offline, deterministic. No fake intelligence. Never claims an action
 * succeeded without the underlying capability reporting success.
 */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  function FS() { return global.LH_AI.FS; }
  function MB() { return global.LH_AI.MediaBridge; }
  function Ctx() { return global.LH_AI.Context; }
  function PB() { return global.LH_AI.Cognitive && global.LH_AI.Cognitive.PersonalBrain; }

  var VIDEO_EXT = /\.(mp4|mkv|avi|webm|mov|m4v|wmv|flv|3gp)$/i;
  var AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i;
  var MEDIA_EXT = /\.(mp4|mkv|avi|webm|mov|m4v|wmv|flv|3gp|mp3|wav|ogg|m4a|flac|aac|opus)$/i;

  // ==== 1. INTENT CLASSIFICATION ====
  // ACTION | QUERY | INFORMATION | CONVERSATION | MIXED
  var ACTION_VERBS = /^\s*(please\s+|can you\s+|could you\s+|would you\s+|hey\s+)?(play|open|show|find|search|start|stop|pause|resume|continue|scan|list|connect|restart|run|launch|put on|turn on|delete|move|copy|rename)\b/i;

  // Phrases that are INFORMATION, even if they contain action verbs.
  var INFO_PHRASES = [
    /\bwhat is (a |an |the )?(video|movie|file|media|mp4|audio)\b/i,
    /\bwhat are (videos|movies)\b/i,
    /\bwhat does (video|media|mp4) (mean|do)\b/i,
    /\bdefine (video|media|movie|audio)\b/i,
    /\bexplain (video|media|movie|audio)\b/i,
    /\btell me about the (movie|video|media)\b/i,
    /\bwhat is a video\b/i,
    /\babout (the )?(film|movie)\s+(?!on|in|localhub)/i
  ];

  // "play" + a title that is clearly a media reference (title words), vs the
  // word "video" being a generic topic.
  function isMediaActionVerb(text) {
    return /\b(play|watch|start|put on|launch|open)\b/i.test(text) && /\b(video|movie|film|clip|episode|song|track|audio|music)\b/i.test(text);
  }

  function classifyIntent(text) {
    var t = String(text || "").trim();
    if (!t) return { type: "CONVERSATION", reason: "empty" };
    var lower = t.toLowerCase();
    // Explicit info questions always win.
    for (var i = 0; i < INFO_PHRASES.length; i++) {
      if (INFO_PHRASES[i].test(t)) return { type: "INFORMATION", reason: "info-phrase" };
    }
    // "tell me about X" that references a specific title = information
    if (/^(tell me about|what is|about)\b/i.test(t)) return { type: "INFORMATION", reason: "about" };

    var action = ACTION_VERBS.test(t);
    var hasQuestion = /\?\s*$/.test(t) || /\b(what|which|who|how|why)\b/i.test(t);

    if (action && hasQuestion && !/play\b/.test(lower)) return { type: "QUERY", reason: "action+question" };
    if (action && hasQuestion) return { type: "MIXED", reason: "action+question" };
    if (action) return { type: "ACTION", reason: "action-verb" };
    if (hasQuestion) return { type: "QUERY", reason: "question" };
    if (/^(hi|hey|hello|thanks|ok|okay|goodbye|bye)\b/i.test(t)) return { type: "CONVERSATION", reason: "greeting" };
    return { type: "QUERY", reason: "default" };
  }

  // ==== 2. CAPABILITY DISCOVERY (authoritative from what EXISTS) ====
  // A capability is a label + a router to an EXISTING LocalHub handler.
  var CAPABILITIES = [
    { name: "MEDIA_PLAY",  description: "Play a video/audio file", action: "media-play", risk: "low" },
    { name: "MEDIA_PAUSE", description: "Pause current media", action: "media-pause", risk: "low" },
    { name: "MEDIA_RESUME",description: "Resume current media", action: "media-resume", risk: "low" },
    { name: "MEDIA_STOP",  description: "Stop current media", action: "media-stop", risk: "low" },
    { name: "MEDIA_TOGGLE",description: "Play/pause toggle", action: "media-toggle", risk: "low" },
    { name: "MEDIA_SEARCH",description: "Search media by title", action: "media-search", risk: "low" },
    { name: "MEDIA_LIST",  description: "List media by type", action: "media-list", risk: "low" },
    { name: "MEDIA_METADATA", description: "Get media metadata", action: "media-metadata", risk: "low" },
    { name: "FILE_SEARCH", description: "Search files", action: "file-search", risk: "low" },
    { name: "FILE_OPEN",   description: "Open a file", action: "file-open", risk: "low" },
    { name: "FILE_MOVE",   description: "Move a file", action: "file-move", risk: "medium", permission: "admin" },
    { name: "FILE_DELETE", description: "Delete a file", action: "file-delete", risk: "high", permission: "admin", confirm: true },
    { name: "SERVER_STATUS", description: "Server status", action: "server-status", risk: "low" },
    { name: "CLIENT_LIST", description: "Connected clients", action: "client-list", risk: "low" }
  ];
  function listCapabilities() { return CAPABILITIES.map(function (c) { return c; }); }
  function capabilityFor(action) {
    var a = String(action || "");
    // accept either the capability NAME ("MEDIA_PLAY") or its action ("media-play")
    return CAPABILITIES.find(function (c) { return c.name === a || c.action === a; }) || null;
  }

  // ==== 3. NATURAL LANGUAGE -> CAPABILITY ====
  // Returns { capability, params } or null if not a localhub action.
  function mapToCapability(text) {
    var t = String(text || "").trim();
    var lower = t.toLowerCase();

    // Media transport (uses current media in context when no title)
    if (/\bpause\b/i.test(t)) return { capability: "MEDIA_PAUSE", params: {} };
    if (/\b(resume|continue|unpause)\b/i.test(t)) return { capability: "MEDIA_RESUME", params: {} };
    if (/\bstop\s+(the\s+)?(video|movie|media|music|song|audio|playback)\b/i.test(t) || /^stop\b/i.test(t)) return { capability: "MEDIA_STOP", params: {} };
    if (/\btoggle\s*(play|pause)?\b/i.test(t)) return { capability: "MEDIA_TOGGLE", params: {} };

    // List / show media by type
    if (/\bshow\s+(my\s+)?(videos|movies|music|audio|media|songs)\b/i.test(t) || /\blist\s+(my\s+)?(videos|movies|music|audio|media|songs)\b/i.test(t)) {
      var lt = /\bmusic\b|\baudio\b|\bsongs\b/i.test(t) ? "audio" : /\b(movies|videos)\b/i.test(t) ? "video" : "media";
      return { capability: "MEDIA_LIST", params: { type: lt } };
    }

    // Play / watch / open + title (video or audio)
    if (/\b(play|watch|start|put on|launch|open|continue|resume)\b/i.test(t)) {
      var isVideo = /\b(video|movie|film|clip|episode|series)\b/i.test(t) || !/\b(music|song|track|audio)\b/i.test(t);
      var isAudio = /\b(music|song|track|audio|album)\b/i.test(t);
      return { capability: "MEDIA_PLAY", params: { type: isAudio ? "audio" : "video", text: t } };
    }

    // Find / search. Default to MEDIA_SEARCH (titles are usually media); only use
    // FILE_SEARCH when the user explicitly says "file(s)" or a non-media term.
    if (/\b(find|search|look for)\b/i.test(t)) {
      var isFileSearch = /\b(file|files|document|docs?|folder|dir|apk|zip)\b/i.test(t);
      var isAudio = /music|audio|song|track/i.test(t);
      return { capability: isFileSearch ? "FILE_SEARCH" : "MEDIA_SEARCH", params: { type: isAudio ? "audio" : "video", text: t } };
    }

    // Mixed: "play X and tell me its filename"
    if (/play\b/i.test(t) && /\b(and|also)\b/i.test(t)) {
      return { capability: "MEDIA_PLAY", params: { type: "video", text: t, mixed: true } };
    }
    return null;
  }

  // ==== 4. ENTITY EXTRACTION ====
  // Pull the media title query and type out of a command. Does NOT send the
  // whole sentence to the media engine.
  function extractEntities(text) {
    var t = String(text || "").trim();
    var type = /(music|song|track|audio|album)/i.test(t) ? "audio" : "video";
    // Remove leading action words + filler to isolate the title.
    var q = t
      .replace(/^(please\s+|can you\s+|could you\s+|would you\s+|hey\s+)?(play|watch|start|put on|launch|open|find|search|look for|continue|resume|show|list|show me|find me)\s*/i, "")
      .replace(/\s+(the\s+)?(video|movie|film|clip|episode|song|track|audio|music|media)(\s+please|\s*$|\s+about.*)?/i, " ")
      .replace(/\s+(on\s+(youtube|localhub))?\s*$/i, "")
      .replace(/\b(and|also)\b.*$/i, "")
      .replace(/["'`]/g, "")
      .trim();
    if (!q) q = null;
    return { query: q, type: type, mediaKeyword: /\b(video|movie|film|music|song|track|audio)\b/i.test(t) };
  }

  // ==== 5. FUZZY MEDIA MATCHING ====
  // Score candidate file names against the query using normalized token match.
  function normalizeName(s) {
    return String(s || "").toLowerCase()
      .replace(/[^\w\s]/g, " ")          // punctuation -> space
      .replace(/\b(the|a|an)\b/g, " ")   // drop articles
      .replace(/\s+/g, " ").trim();
  }
  function tokenOverlap(query, name) {
    var q = normalizeName(query).split(" ").filter(function (w) { return w.length > 1; });
    var n = normalizeName(name).split(" ").filter(function (w) { return w.length > 1; });
    if (!q.length || !n.length) return 0;
    var hits = 0;
    q.forEach(function (w) { if (n.indexOf(w) >= 0) hits++; });
    return hits / q.length;   // recall of query tokens in the filename
  }
  function scoreMatch(query, name) {
    var q = String(query || "").toLowerCase().trim();
    var n = String(name || "").toLowerCase().trim();
    if (!q) return 0;
    if (n === q) return 1;
    var ov = tokenOverlap(q, n);
    var partial = n.indexOf(q) >= 0 || q.indexOf(n) >= 0 ? 0.5 : 0;
    return Math.max(ov, partial);
  }
  function pickBestMatch(query, items, threshold) {
    threshold = threshold == null ? 0.35 : threshold;
    var scored = (items || []).map(function (it) {
      return { item: it, score: scoreMatch(query, it.name || it) };
    }).filter(function (s) { return s.score >= threshold; })
      .sort(function (a, b) { return b.score - a.score; });
    return scored;
  }

  // ==== 6. SEARCH MEDIA (via existing FS.search) ====
  // First tries the full query (substring). If that yields no media matches, it
  // falls back to searching each significant title token separately and unions
  // the results, so "the evil dead burn" still finds "The Evil Dead - Burn.mp4".
  var STOPWORDS = { the: 1, a: 1, an: 1, and: 1, or: 1, video: 1, movie: 1, film: 1,
    song: 1, track: 1, audio: 1, music: 1, media: 1, my: 1, for: 1, please: 1, about: 1 };
  function filterMedia(matches, type) {
    return (matches || []).filter(function (m) {
      var name = m && (m.name || m.path || "");
      if (type === "video") return VIDEO_EXT.test(name);
      if (type === "audio") return AUDIO_EXT.test(name);
      return MEDIA_EXT.test(name);
    });
  }
  function searchMedia(query, type, opts) {
    opts = opts || {};
    var fs = FS();
    if (!fs || !fs.search) return Promise.resolve({ ok: false, reason: "fs-search-unavailable", matches: [] });
    var dir = opts.dir || "/storage/emulated/0";
    var q = String(query || "").trim();
    var first = fs.search(q, dir);
    return Promise.resolve(first).then(function (r) {
      var filtered = filterMedia((r && r.matches) || [], type);
      if (filtered.length) return { ok: true, matches: filtered };
      // Token-based fallback: search each significant token, union, dedupe.
      var tokens = q.toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 1 && !STOPWORDS[w]; });
      var chain = Promise.resolve([]);
      var seen = {};
      tokens.forEach(function (tok) {
        chain = chain.then(function (acc) {
          return fs.search(tok, dir).then(function (rr) {
            var f2 = filterMedia((rr && rr.matches) || [], type);
            (f2 || []).forEach(function (m) {
              var key = m.path || m.name || "";
              if (!seen[key]) { seen[key] = 1; acc.push(m); }
            });
            return acc;
          }).catch(function () { return acc; });
        });
      });
      return chain.then(function (unioned) { return { ok: true, matches: unioned }; });
    }).catch(function () { return { ok: false, reason: "search-failed", matches: [] }; });
  }

  // ==== 7. EXECUTE A CAPABILITY ====
  // Routes to the EXISTING capability (open player / MediaBridge / FS).
  // Opens the existing player page with the resolved file. Playback is REQUESTED
  // (we also send a MediaBridge "play"), but actual audio/video playing state is
  // owned by the player tab. We report an honest intermediate status rather than
  // claiming verified "Playing" we cannot observe from the assistant page.
  function openPlayer(path, label) {
    return {
      ok: true,
      status: "PLAYBACK_REQUESTED",
      message: "▶️ Starting " + (label || path) + " in the player…",
      openFM: "/player?file=" + encodeURIComponent(path),
      action: "open-player",
      played: true,
      verification: "REQUESTED"   // not yet confirmed by the player
    };
  }

  // ==== INLINE PLAYBACK (genuine, same-page) ====
  // Plays the resolved media directly on the assistant page via an inline
  // <video> element. Because the user just typed/said the command, we are inside
  // a user-gesture context, so the browser's autoplay policy ALLOWS play(). This
  // is the fix for "Starting… in the player" with no actual playback.
  function playInline(path, label) {
    var el = global.document && global.document.getElementById && global.document.getElementById("inline-video");
    var box = global.document && global.document.getElementById && global.document.getElementById("inline-player");
    var title = global.document && global.document.getElementById && global.document.getElementById("inline-title");
    var stopBtn = global.document && global.document.getElementById && global.document.getElementById("inline-stop");
    if (!el || !box) {
      // No inline element (e.g. headless / other page) -> fall back to navigation.
      return openPlayer(path, label);
    }
    return Promise.resolve().then(function () {
      var url = "/api/fs/content?path=" + encodeURIComponent(path);
      // set media + show the inline player
      el.src = url;
      if (title) title.textContent = label || String(path).split("/").pop();
      box.style.display = "block";
      if (stopBtn) {
        stopBtn.onclick = function () {
          try { el.pause(); el.src = ""; el.removeAttribute("src"); el.load(); } catch (e) {}
          box.style.display = "none";
        };
      }
      // save to context so "pause it"/"resume" / currentMedia work
      if (Ctx && Ctx.setMedia) Ctx.setMedia(path, "video");
      // attempt real playback inside the user-gesture context
      var p = el.play();
      if (p && p.catch) {
        return p.then(function () {
          return { ok: true, status: "PLAYBACK_VERIFIED", message: "▶️ Playing " + (label || path) + ".", action: "media-play", played: true, verification: "VERIFIED", inline: true };
        }).catch(function (err) {
          return { ok: false, status: "PLAYBACK_ERROR", message: "I found the video, but playback failed (" + ((err && err.name) || "error") + ").", action: "media-play", played: false, verification: "FAILED", error: (err && err.name) || String(err) };
        });
      }
      // play() returned undefined (unusual) — report honest unknown state
      return { ok: true, status: "PLAYBACK_REQUESTED", message: "Opened the video in the inline player. If it doesn't start, tap ▶.", action: "media-play", played: false, verification: "UNKNOWN", inline: true };
    });
  }

  // ==== PLAY IN A NEW TAB (preferred for "play a specific video") ====
  // Opens the existing full player page (/player?file=...) in a SEPARATE TAB so
  // the user gets the dedicated player UI. If the browser blocks the popup
  // (returns null from window.open), we fall back to inline playback on the
  // assistant page. Honest status either way.
  function playInNewTab(path, label) {
    var w = global.window;
    var playerUrl = "/player?file=" + encodeURIComponent(path);
    // save to context so pause/resume/currentMedia work
    if (Ctx && Ctx.setMedia) Ctx.setMedia(path, "video");
    if (MB() && MB().send) { MB().send("play", {}); }
    if (w && typeof w.open === "function") {
      var opened;
      try { opened = w.open(playerUrl, "_blank"); } catch (e) { opened = null; }
      if (opened) {
        return Promise.resolve({
          ok: true, status: "PLAYBACK_REQUESTED", message: "▶️ Opening " + (label || String(path).split("/").pop()) + " in a new tab…",
          openFM: playerUrl, action: "open-player-new-tab", played: true, verification: "REQUESTED", newTab: true
        });
      }
    }
    // Popup blocked / no window.open -> fall back to inline playback.
    return playInline(path, label);
  }

  function executeCapability(cap, params, opts) {
    opts = opts || {};
    var action = cap && cap.action;
    if (action === "media-play") {
      // params.resolve is set by route() after matching.
      var hit = params.bestMatch;
      if (hit) {
        var path = hit.item && (hit.item.path || hit.item);
        // remember as current media + open player
        if (Ctx && Ctx.setMedia) Ctx.setMedia(path, hit.item.type || params.type || "video");
        // "play a specific video" -> open the dedicated player in a NEW TAB so the
        // user gets the full player UI. If the popup is blocked, falls back to
        // inline playback on the assistant page (gesture context).
        return playInNewTab(path, hit.item && hit.item.name);
      }
      return Promise.resolve({ ok: false, message: "No matching media found to play.", action: "media-play", played: false });
    }
    if (action === "media-pause") { if (MB() && MB().send) { MB().send("pause", {}); } return Promise.resolve({ ok: true, message: "Paused.", action: "media-pause" }); }
    if (action === "media-resume") { if (MB() && MB().send) { MB().send("resume", {}); } return Promise.resolve({ ok: true, message: "Resumed.", action: "media-resume" }); }
    if (action === "media-stop") { if (MB() && MB().send) { MB().send("stop", {}); } return Promise.resolve({ ok: true, message: "Stopped.", action: "media-stop" }); }
    if (action === "media-toggle") { if (MB() && MB().send) { MB().send("toggle", {}); } return Promise.resolve({ ok: true, message: "Toggled.", action: "media-toggle" }); }
    if (action === "media-search") {
      var q = params.query;
      if (!q) return Promise.resolve({ ok: false, message: "What should I search for?", action: "media-search" });
      return searchMedia(q, params.type).then(function (res) {
        if (!res.ok) return { ok: false, message: "Media search unavailable.", action: "media-search" };
        var ranked = pickBestMatch(q, res.matches);
        return { ok: true, message: ranked.length ? "Found " + ranked.length + ":\n" + ranked.map(function (s) { return "· " + (s.item.name || s.item.path) + " (" + Math.round(s.score * 100) + "%)"; }).join("\n") : "No matching " + (params.type || "media") + " found.", action: "media-search", matches: res.matches, ranked: ranked };
      });
    }
    if (action === "media-list") {
      // open the file manager category view (existing capability)
      var cat = params.type === "audio" ? "audio" : params.type === "video" ? "video" : "video";
      return Promise.resolve({ ok: true, message: "Showing " + (params.type || "media") + " — opening the File Manager.", openFM: "/files?category=" + encodeURIComponent(cat), action: "media-list" });
    }
    if (action === "media-metadata") {
      var metaPath = params.bestMatch ? (params.bestMatch.item && (params.bestMatch.item.path || params.bestMatch.item)) : (Ctx && Ctx.get ? Ctx.get("media") : null);
      var metaName = metaPath ? String(metaPath).split("/").pop() : null;
      return Promise.resolve({ ok: true, message: metaName ? ("Filename: " + metaName) : "No current media.", action: "media-metadata" });
    }
    if (action === "file-search") {
      var fq = params.query;
      if (!fq) return Promise.resolve({ ok: false, message: "What should I search for?", action: "file-search" });
      return FS().search(fq).then(function (r) {
        var hits = (r.matches || []).slice(0, 15);
        return { ok: true, message: hits.length ? "Found " + hits.length + ":\n" + hits.map(function (h) { return h.path || h.name; }).join("\n") : "No matches for '" + fq + "'", action: "file-search", matches: hits };
      }).catch(function () { return { ok: false, message: "File search unavailable.", action: "file-search" }; });
    }
    // Fallthrough to existing Commands/Assistant handlers by returning null so
    // the caller can fall back to the normal pipeline.
    return null;
  }

  // ==== 8. CONVERSATIONAL CONTEXT ====
  // "pause it", "resume", "play the second one", "play it again".
  function currentMedia() {
    if (Ctx && Ctx.get) {
      var m = Ctx.get("media");
      if (m) return m;
    }
    return null;
  }
  function resolveOrdinalSelection(text, searchResults) {
    var m = text.match(/\b(the\s+)?(first|second|third|fourth|fifth|last|next|previous|one|two|three)\b/i);
    if (!m || !searchResults || !searchResults.length) return null;
    var idx;
    var w = (m[2] || "").toLowerCase();
    if (w === "last") idx = searchResults.length - 1;
    else if (w === "next") idx = 0;
    else if (w === "previous") idx = searchResults.length - 1;
    else { var map = { first: 0, one: 0, second: 1, two: 1, third: 2, three: 2, fourth: 3, fifth: 4 }; idx = map[w]; }
    if (idx == null || idx >= searchResults.length) return null;
    return searchResults[idx];
  }

  // ==== 9. MAIN ROUTE ====
  // Returns { ok, message, intent, capability, query, match, ... } or null when
  // the text is not a localhub action (so the normal pipeline continues).
  var lastRoute = null;
  function route(text, opts) {
    opts = opts || {};
    var t = String(text || "").trim();
    var intent = classifyIntent(t);

    // Explicitly NOT an action (information/conversation) -> let normal pipeline handle.
    if (intent.type === "INFORMATION" || intent.type === "CONVERSATION") {
      return Promise.resolve(null);
    }

    // Try to map to a capability.
    var cap = mapToCapability(t);
    if (!cap) return Promise.resolve(null);

    // Explicit info questions were already filtered; ACTION/MIXED/QUERY proceed.
    var capObj = capabilityFor(cap.capability);

    // Entity extraction.
    var ent = extractEntities(t);

    // Route per capability.
    if (cap.capability === "MEDIA_PLAY") {
      // If it's a pure info query about media, don't play.
      if (intent.type === "INFORMATION") return Promise.resolve(null);
      // "pause it"/"resume"/"stop" already mapped to their own caps above.
      // For play: resolve the title via search.
      var query = ent.query;
      // ordinal selection ("play the second one") uses previous search results.
      var ctxSearch = opts.previousMatches || null;
      var ordinal = resolveOrdinalSelection(t, ctxSearch);
      if (ordinal) {
        return Promise.resolve({
          ok: true, intent: intent.type, capability: "MEDIA_PLAY", query: query, match: ordinal,
          result: { ok: true, message: "Playing selection…", openFM: "/player?file=" + encodeURIComponent(ordinal.path || ordinal) },
          played: true, usedOrdinal: true
        });
      }
      // "play it again" -> current media
      if (/again\b/.test(t) && currentMedia()) {
        var cur = currentMedia();
        return Promise.resolve({ ok: true, intent: intent.type, capability: "MEDIA_PLAY", query: query, match: cur, result: openPlayer(cur.path || cur, cur.name || cur.path), played: true, usedContext: true });
      }
      if (!query) {
        // No title given: if we have current media, resume it; else ask.
        if (currentMedia()) {
          var cur2 = currentMedia();
          return Promise.resolve({ ok: true, intent: intent.type, capability: "MEDIA_RESUME", query: null, match: cur2, result: { ok: true, message: "Resuming current media…", openFM: "/player?file=" + encodeURIComponent(cur2.path || cur2) }, played: true, usedContext: true });
        }
        return Promise.resolve({ ok: false, intent: intent.type, capability: "MEDIA_PLAY", query: null, match: null, result: { ok: false, message: "What would you like to play?" }, played: false });
      }
      // Search media for the title.
      return searchMedia(query, ent.type).then(function (res) {
        if (!res.ok) {
          return { ok: false, intent: intent.type, capability: "MEDIA_PLAY", query: query, match: null, result: { ok: false, message: "Media search is unavailable right now.", played: false } };
        }
        var ranked = pickBestMatch(query, res.matches);
        if (!ranked.length) {
          return { ok: false, intent: intent.type, capability: "MEDIA_PLAY", query: query, match: null, result: { ok: false, message: "I couldn't find a matching " + (ent.type || "video") + " in your LocalHub media." }, played: false };
        }
        // If several match but the best is clearly better than the rest, prefer it.
        var clear = ranked.length === 1 || (ranked.length > 1 && (ranked[0].score - ranked[1].score) >= 0.2);
        if (!clear) {
          // Ambiguity: ask, don't randomly choose.
          lastRoute = { ok: true, intent: intent.type, capability: "MEDIA_PLAY", query: query, ambiguous: true, matches: ranked, result: null };
          return {
            ok: true, ambiguous: true, intent: intent.type, capability: "MEDIA_PLAY", query: query,
            matches: ranked,
            result: { ok: true, message: "I found " + ranked.length + " matching videos. Which one do you want?\n" + ranked.map(function (s, i) { return "· " + (i + 1) + ". " + (s.item.name || s.item.path); }).join("\n"), ambiguous: true, choices: ranked }
          };
        }
        var best = ranked[0];
        lastRoute = { ok: true, intent: intent.type, capability: "MEDIA_PLAY", query: query, match: best.item, matchScore: best.score };
        var execRes = executeCapability(capObj, { bestMatch: best }, opts);
        var result;
        if (execRes && execRes.then) result = execRes;
        else result = Promise.resolve(execRes);
        return result.then(function (r) {
          return { ok: !!(r && r.ok !== false), intent: intent.type, capability: "MEDIA_PLAY", query: query, match: best.item, matchScore: best.score, played: !!(r && r.played), result: r };
        });
      });
    }

    if (cap.capability === "MEDIA_SEARCH") {
      if (!ent.query) return Promise.resolve({ ok: false, intent: "QUERY", capability: "MEDIA_SEARCH", result: { ok: false, message: "What should I search for?" } });
      return executeCapability(capObj, { query: ent.query, type: ent.type }).then(function (r) {
        return { ok: !!(r && r.ok), intent: intent.type, capability: "MEDIA_SEARCH", query: ent.query, result: r, matches: r && r.matches };
      });
    }

    if (cap.capability === "FILE_SEARCH") {
      if (!ent.query) return Promise.resolve({ ok: false, intent: "QUERY", capability: "FILE_SEARCH", result: { ok: false, message: "What should I search for?" } });
      return executeCapability(capObj, { query: ent.query }).then(function (r) {
        return { ok: !!(r && r.ok), intent: intent.type, capability: "FILE_SEARCH", query: ent.query, result: r };
      });
    }

    // Simple transport + list caps.
    var execRes2 = executeCapability(capObj, paramsFromText(t, cap.capability));
    var result2 = execRes2 && execRes2.then ? execRes2 : Promise.resolve(execRes2);
    return result2.then(function (r) {
      if (r === null) return null;   // no existing handler -> let pipeline continue
      return { ok: !!(r && r.ok !== false), intent: intent.type, capability: cap.capability, query: ent.query, result: r };
    });
  }

  function paramsFromText(text, capability) {
    var p = {};
    if (capability === "MEDIA_LIST") {
      p.type = /music|audio|songs/i.test(text) ? "audio" : /(movies|videos)/i.test(text) ? "video" : "media";
    }
    return p;
  }

  // ==== 10. DIAGNOSTICS (admin, structured, no chain-of-thought) ====
  function diagnostics() {
    return {
      lastRoute: lastRoute,
      capabilities: CAPABILITIES.length
    };
  }

  // ==== 11. MEDIA PLAYBACK VERIFICATION (real, honest) ====
  // Reads the player's actual reported state (written to localStorage by the
  // player page). The assistant NEVER claims playback verified unless this shows
  // PLAYING. Returns a structured, evidence-backed status.
  var MEDIA_STATUS_KEY = "lhmedia_status";
  function readPlaybackState() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(MEDIA_STATUS_KEY);
      if (!raw) return { available: false, state: null, reason: "NO_PLAYER_STATE" };
      return { available: true, state: JSON.parse(raw), reason: "ok" };
    } catch (e) { return { available: false, state: null, reason: "UNREADABLE" }; }
  }
  // Map a raw player state into the honest, single source of truth.
  function verifyPlayback() {
    var p = readPlaybackState();
    if (!p.available) return { status: "NOT_EXECUTED", message: "I don't have evidence of playback yet.", detail: p };
    var s = p.state;
    var file = s && s.name;
    var state = (s && s.state) || "UNKNOWN";
    if (state === "PLAYING") {
      return { status: "PLAYBACK_VERIFIED", message: "▶️ Playing " + file + ".", detail: p, verified: true };
    }
    if (state === "UNSUPPORTED_FORMAT") {
      return { status: "UNSUPPORTED_FORMAT", message: "I found the video, but this browser can't play its format/codec.", detail: p };
    }
    if (state === "AUTOPLAY_BLOCKED") {
      return { status: "AUTOPLAY_BLOCKED", message: "The browser blocked automatic playback. Tap ▶ Play in the player to start it.", detail: p };
    }
    if (state === "PLAYBACK_ERROR") {
      return { status: "PLAYBACK_ERROR", message: "I found the video, but playback failed (" + ((s && s.errorDetail) || "error") + ").", detail: p };
    }
    if (state === "PAUSED") {
      return { status: "PAUSED", message: "The video is loaded but paused.", detail: p };
    }
    if (state === "LOADING" || state === "LOADED") {
      return { status: "LOADING", message: "The player is loading the video…", detail: p };
    }
    return { status: "NOT_EXECUTED", message: "Playback state is unclear (" + state + ").", detail: p };
  }

  // ==== 12. "not playing" DIAGNOSTIC ====
  // When the user says "not playing" (or similar) right after a MEDIA_PLAY, we
  // read the real player state and respond honestly — NOT a generic explanation.
  function diagnoseNotPlaying(text) {
    var t = String(text || "").toLowerCase();
    var isComplaint = /not playing|didn'?t play|isn'?t playing|not starting|won'?t play|nothing (is )?playing|no sound|no video|not working|blank screen|black screen/i.test(t);
    if (!isComplaint) return null;
    var v = verifyPlayback();
    // Include the file/format reason when we have evidence.
    if (v.status === "UNSUPPORTED_FORMAT") return { ok: true, diagnostic: true, status: v.status, message: "Got it. I'll check why playback didn't start.\n\nThe file was found, but this browser can't decode its format/codec.", evidence: v.detail };
    if (v.status === "AUTOPLAY_BLOCKED") return { ok: true, diagnostic: true, status: v.status, message: "Got it. I'll check why playback didn't start.\n\nThe browser blocked automatic playback. Tap ▶ Play in the player.", evidence: v.detail };
    if (v.status === "PLAYBACK_ERROR") return { ok: true, diagnostic: true, status: v.status, message: "Got it. I'll check why playback didn't start.\n\nThe player reported an error loading/decoding the media.", evidence: v.detail };
    if (v.status === "PLAYBACK_VERIFIED") return { ok: true, diagnostic: true, status: v.status, message: "Actually, the player reports it is playing. If you still can't hear/see it, check volume or the browser.", evidence: v.detail };
    if (v.status === "PAUSED" || v.status === "LOADING" || v.status === "LOADED") {
      return { ok: true, diagnostic: true, status: v.status, message: "Got it. The player has loaded the video but hasn't started. Tap ▶ Play in the player to start it.", evidence: v.detail };
    }
    return { ok: true, diagnostic: true, status: "NOT_EXECUTED", message: "Got it. I'll check why playback didn't start — but I don't have playback evidence yet. Open the player and tap Play, or check that the file/codec is supported.", evidence: v.detail };
  }

  global.LH_AI.ActionRouting = {
    classifyIntent: classifyIntent,
    mapToCapability: mapToCapability,
    extractEntities: extractEntities,
    searchMedia: searchMedia,
    scoreMatch: scoreMatch,
    pickBestMatch: pickBestMatch,
    listCapabilities: listCapabilities,
    capabilityFor: capabilityFor,
    executeCapability: executeCapability,
    playInline: playInline,
    playInNewTab: playInNewTab,
    openPlayer: openPlayer,
    route: route,
    resolveOrdinalSelection: resolveOrdinalSelection,
    diagnostics: diagnostics,
    getLastRoute: function () { return lastRoute; },
    readPlaybackState: readPlaybackState,
    verifyPlayback: verifyPlayback,
    diagnoseNotPlaying: diagnoseNotPlaying,
    MEDIA_STATUS_KEY: MEDIA_STATUS_KEY
  };
})(window);
