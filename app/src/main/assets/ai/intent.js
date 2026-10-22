/* intent.js - LocalHub OS Intent Pipeline.
 *
 * Replaces simple parsing with a proper execution pipeline:
 *
 *   Command → Normalize → Intent Detection → Context Resolution →
 *   Permission Check → Capability Lookup → Execution Plan → Execute →
 *   Result → Natural Response
 *
 * Fully deterministic. No ML. Integrates the Context Engine, Capability
 * Registry, Task Planner, and Command Engine.
 */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  var Commands = global.LH_AI.Commands;
  var Context = global.LH_AI.Context;
  var Capabilities = global.LH_AI.Capabilities;
  var TaskPlanner = global.LH_AI.TaskPlanner;
  var Assistant = global.LH_AI.Assistant;

  // Execution timing / diagnostics.
  var stats = {
    executed: 0,
    totalTimeMs: 0,
    cacheHits: 0,
    lastExecMs: 0
  };

  // Real command cache: normalized text -> { result, ts }. Only idempotent,
  // read-only commands are cached, with a short TTL to keep data fresh.
  var cache = {};
  var CACHE_TTL = 8000; // ms

  function cacheKey(intent) {
    if (intent && intent.type === "command" && intent.command && intent.command.name) {
      return "cmd:" + intent.command.name;
    }
    return "intent:" + (intent && intent.text ? intent.text : "");
  }

  // Commands whose results are safe to cache (read-only telemetry/status).
  var CACHEABLE = {
    "server-status": 1, "server-connections": 1, "sys-cpu": 1, "sys-ram": 1,
    "sys-storage": 1, "sys-battery": 1, "sys-temp": 1, "sys-network-speed": 1,
    "sys-uptime": 1, "sys-device": 1, "net-ip": 1, "net-hostname": 1,
    "net-ssid": 1, "net-port": 1, "fm-largest": 1, "fm-empty": 1, "fm-recent": 1,
    "client-info": 1
  };

  function cacheGet(key) {
    var e = cache[key];
    if (e && (Date.now() - e.ts) < CACHE_TTL) {
      stats.cacheHits++;
      return e.result;
    }
    return undefined;
  }
  function cachePut(key, result) { cache[key] = { result: result, ts: Date.now() }; }

  // ---- 1. Normalize ----
  function normalize(text) {
    var t = String(text || "").trim().replace(/\s+/g, " ").toLowerCase();
    // Map common pronoun/helper prefixes to canonical command forms.
    t = t.replace(/^(please\s+)?(can you\s+)?(could you\s+)?/i, "");
    return t;
  }

  // ---- 2. Intent detection ----
  function detectIntent(norm) {
    var parsed = Commands && Commands.parse(norm);
    if (parsed) return { type: "command", command: parsed.command, text: norm };
    // Context referent commands (short forms).
    var ref = Context && Context.resolveReferent(norm);
    if (ref) return { type: "referent", referent: ref, text: norm };
    // Fall back to the existing assistant intents.
    if (Assistant) {
      var p = Assistant.parse(norm);
      if (p) return { type: "assistant", intent: p.intent, text: norm, parsed: p };
    }
    return { type: "unknown", text: norm };
  }

  // ---- 3. Capability lookup ----
  function capabilityFor(command) {
    if (!command) return null;
    return Capabilities.all().find(function (c) {
      return c.name.indexOf(command.name) === 0 || command.name.indexOf(c.name.replace(/\.[a-z]+$/, "")) === 0;
    });
  }

  // ---- 4. Permission check ----
  function checkPermission(cap) {
    return Capabilities.hasPermission(cap);
  }

  // ---- 5. Execution plan (multi-step tasks) ----
  function plan(norm) {
    var task = TaskPlanner.planFor(norm);
    return task;
  }

  // ---- 6. Execute ----
  function execute(intent) {
    if (intent.type === "command") {
      // Multi-step task planning: if a plan exists, run it step by step.
      var plan = TaskPlanner.planFor(intent.text);
      if (plan) return runPlan(plan);
      // Cache idempotent read-only commands.
      var key = cacheKey(intent);
      if (CACHEABLE[intent.command && intent.command.name]) {
        var hit = cacheGet(key);
        if (hit) return Promise.resolve(hit);
        var p = Commands.execute({ command: intent.command, text: intent.text });
        return Promise.resolve(p).then(function (res) {
          if (res && res.ok) cachePut(key, res);
          return res;
        });
      }
      return Commands.execute({ command: intent.command, text: intent.text });
    }
    if (intent.type === "referent") {
      return executeReferent(intent.referent);
    }
    if (intent.type === "assistant") {
      return Assistant.run(intent.intent, intent.text, intent.parsed);
    }
    // Unknown / free-form question: let the Mind engine think about it instead
    // of a flat "I didn't recognize" reply. It classifies the question, extracts
    // the topic, retrieves knowledge, and builds a structured reasoned answer.
    if (global.LH_AI.Mind && global.LH_AI.Mind.process) {
      return global.LH_AI.Mind.process(intent.text);
    }
    return Promise.resolve({
      ok: true,
      message: "I didn't recognize that LocalHub command. Try 'open downloads', 'show cpu usage', or 'restart server'."
    });
  }

  // Runs a planned multi-step task sequentially with real work per step.
  function runPlan(plan) {
    Context && Context.set("currentTask", plan.name);
    var collectedTarget = null;
    return TaskPlanner.execute(plan, function (step) {
      var a = step.action;
      var FS = global.LH_AI.FS;
      if (a === "openFolder") {
        Context.setFolder(step.params && step.params.path);
        return { openFM: "/files?path=" + encodeURIComponent(step.params.path || Context.ROOT), message: "Opened folder." };
      }
      if (a === "findLatestVideo" || a === "findLatestAudio") {
        var ext = a === "findLatestVideo" ? "mp4" : "mp3";
        var dir = (step.params && step.params.path) || "/storage/emulated/0/Download";
        return FS.search("." + ext, dir).then(function (r) {
          var hits = (r.matches || []);
          // newest by name suffix heuristic (no server mtime in search result)
          var latest = hits[0] || null;
          collectedTarget = latest ? latest.path : null;
          return { latest: latest, dir: dir };
        });
      }
      if (a === "openMediaPlayer" || a === "startPlayback") {
        var target = collectedTarget || (Context && Context.get && Context.get("lastPlanFile"));
        return { openFM: target ? "/player?file=" + encodeURIComponent(target) : "/player", message: "Opening media player." };
      }
      if (a === "restart") return { action: "server/restart", message: "Restarting server…" };
      if (a === "wait") {
        var ms = (step.params && step.params.ms) || 1000;
        return new Promise(function (resolve) { setTimeout(function () { resolve({ waited: ms }); }, ms); });
      }
      if (a === "showLogs") return FS.logs().then(function (l) {
        var logs = (l && l.logs) || [];
        return { message: "Recent logs:\n" + logs.slice(0, 8).map(function (x) { return "[" + (x.level || "INFO") + "] " + x.message; }).join("\n") };
      });
      if (a === "download") return { action: "server/export-logs", message: "Downloading…" };
      if (a === "open") return { openFM: "/", message: "Opened." };
      if (a === "list") return FS.list(step.params && step.params.path).then(function (d) { return { entries: (d && d.files) || [], folders: (d && d.folders) || [] }; });
      if (a === "sortByType") {
        // Group the listed files by extension and remember them for the next step.
        return FS.list("/storage/emulated/0/Download").then(function (d) {
          var groups = {};
          (d.files || []).forEach(function (f) {
            var ext = (f.name.split(".").pop() || "other").toLowerCase();
            (groups[ext] = groups[ext] || []).push(f.path);
          });
          return { groups: groups };
        });
      }
      if (a === "createFolders") {
        // Create category folders for extensions actually present.
        return FS.list("/storage/emulated/0/Download").then(function (d) {
          var made = [];
          var exts = {};
          (d.files || []).forEach(function (f) { exts[(f.name.split(".").pop() || "other").toLowerCase()] = 1; });
          var chain = Promise.resolve();
          Object.keys(exts).forEach(function (ext) {
            chain = chain.then(function () {
              return FS.mkdir("/storage/emulated/0/Download", ext.toUpperCase() + " files").then(function () { made.push(ext); });
            });
          });
          return chain.then(function () { return { created: made }; });
        });
      }
      if (a === "moveFiles") {
        // Move files into their extension folder.
        return FS.list("/storage/emulated/0/Download").then(function (d) {
          var chain = Promise.resolve(); var moved = [];
          (d.files || []).forEach(function (f) {
            var ext = (f.name.split(".").pop() || "other").toLowerCase();
            var dest = "/storage/emulated/0/Download/" + ext.toUpperCase() + " files";
            chain = chain.then(function () { return FS.move(f.path, dest); }).then(function () { moved.push(f.name); });
          });
          return chain.then(function () { return { moved: moved }; });
        });
      }
      return { ok: true };
    }).then(function (out) {
      // Collect the last openFM / action from the steps.
      var openFM = null, action = null, message = "Task complete.";
      for (var i = 0; i < (out.results || []).length; i++) {
        var r = out.results[i].result;
        if (r && r.openFM) openFM = r.openFM;
        if (r && r.action) action = r.action;
        if (r && r.message && r.message !== "Opened folder.") message = r.message;
      }
      var target = collectedTarget;
      if (target && openFM && openFM.indexOf("/player") === 0) {
        openFM = "/player?file=" + encodeURIComponent(target);
        Context && Context.setMedia(target, "video");
      }
      var result = { ok: true, message: message };
      if (openFM) result.openFM = openFM;
      if (action) result.action = action;
      Context && Context.set("currentTask", null);
      return result;
    });
  }

  function executeReferent(ref) {
    if (!ref) return Promise.resolve({ ok: false, message: "No context to act on. Specify a file or folder." });
    if (ref.type === "folder") {
      Context.setFolder(ref.path);
      return Promise.resolve({ ok: true, message: "Opened " + (ref.path || "root") + ".", openFM: "/files?path=" + encodeURIComponent(ref.path || Context.ROOT) });
    }
    if (ref.type === "media") {
      Context.setMedia(ref.path, ref.type);
      var folder = ref.path.substring(0, ref.path.lastIndexOf("/"));
      return Promise.resolve({ ok: true, message: "Playing " + ref.path.split("/").pop() + ".", openFM: "/player?file=" + encodeURIComponent(ref.path) });
    }
    if (ref.type === "search" && ref.query) {
      return Commands && Commands.parse("search files named " + ref.query)
        ? Commands.execute(Commands.parse("search files named " + ref.query))
        : Promise.resolve({ ok: true, message: "Repeating search for '" + ref.query + "'." });
    }
    return Promise.resolve({ ok: false, message: "No context to act on." });
  }

  // ---- 7. Natural response ----
  function respond(result) {
    // Keep responses short and professional.
    if (result && result.message) return result;
    return { ok: true, message: "Done." };
  }

  // ---- full pipeline ----
  // ---- conversational continuation resolution ----
  // Handles follow-ups that continue the current topic without repeating it:
  //   "and your memory?"   "what about that?"   "how does it learn?"
  //   "yes" / "ok" after a question, "no that's not what I meant" corrections.
  function resolveConversational(text, norm) {
    var Ctx = Context;
    if (!Ctx || !Ctx.getTopic) return null;
    var topic = Ctx.getTopic();
    var cur = topic.currentTopic || topic.lastSubject;
    var t = String(text || "").toLowerCase();

    // "no, that's not what I meant" / "I meant..." -> reinterpret; ask for clarity.
    if (/(that's not what i meant|you misunderstood|i meant|not that|no,? i (mean|meant))/.test(t)) {
      Ctx.setTopic(cur, text, "");
      return Promise.resolve({
        ok: true, message: "Got it — I misunderstood. Can you clarify what you meant, or repeat it a little differently?",
        type: "conversation", topic: cur
      });
    }

    // "and X" / "what about X" / "what about that" -> continue current topic.
    if (/^(and|what about|and what about|also)\b/.test(t) || /\bwhat about that\b/.test(t)) {
      if (!cur) return null;
      var q = t.replace(/^(and|what about|also|and what about)\s*/i, "").replace(/\bwhat about that\b/i, "").trim();
      // If there's a follow-up noun ("memory", "brain"), ask about that relative
      // to the current subject.
      var relQ = q;
      if (relQ) {
        // e.g. "and your memory?" -> "what is your memory" about the assistant
        if (/your/.test(relQ)) {
          return Promise.resolve().then(function () {
            var m = global.LH_AI.Mind;
            if (m && m.isSelfQuery(relQ) && m.answer(relQ)) {
              return m.answer(relQ).then(function (ans) {
                Ctx.setTopic("me:" + relQ, text, ans);
                return { ok: true, message: ans, type: "self", topic: "me:" + relQ };
              });
            }
            return null;
          });
        }
        // generic continuation: fold into the current topic
        Ctx.setTopic(cur, text, "");
        return { ok: true, message: "About " + (relQ || cur) + " — " + (topic.lastAnswer || "what would you like to know?"), type: "conversation", topic: cur };
      }
      // bare "and?" -> recall last answer
      if (topic.lastAnswer) return { ok: true, message: topic.lastAnswer, type: "conversation", topic: cur };
      return null;
    }

    // "what did we just talk about?" / "what was I asking?" -> recall conversation
    if (/(what did (we|i) (just )?(talk|say)|what (was|were) (we|i) talking|what did i ask|recall the conversation|what have we discussed)/.test(t)) {
      var hist = topic.history || [];
      if (hist.length) {
        var recent = hist.slice(-3).map(function (h) { return "• " + (h.subject || h.input || "…"); }).join("\n");
        Ctx.setTopic(cur, text, "");
        return { ok: true, message: "We were talking about:\n" + recent, type: "conversation", topic: cur };
      }
      return { ok: true, message: "We haven't discussed much yet. Ask me something and I'll keep track.", type: "conversation" };
    }

    return null;
  }

  function process(text) {
    var start = performance.now();
    var norm = normalize(text);

    // Conversational continuation first (contextual "and...", "what about...",
    // "no that's not what I meant", "what did we talk about?").
    var conv = resolveConversational(text, norm);
    if (conv) {
      return Promise.resolve(conv).then(function (r) {
        var ms = performance.now() - start;
        stats.executed++; stats.totalTimeMs += ms; stats.lastExecMs = ms;
        return respond(r);
      });
    }

    // SELF-AWARENESS FIRST: if the user is asking about the assistant itself
    // ("what is your goal/limit/name", "who are you", "what can you do"...),
    // route to the Mind engine BEFORE any command/keyword match. This prevents
    // "what is your goal" from being answered with the dictionary meaning of
    // "goal" instead of the assistant's own purpose.
    if (global.LH_AI.Mind && global.LH_AI.Mind.isSelfQuery && global.LH_AI.Mind.isSelfQuery(norm)) {
      var selfAns = global.LH_AI.Mind.answer(norm);
      if (selfAns) {
        return Promise.resolve(selfAns).then(function (m) {
          var ms = performance.now() - start;
          stats.executed++; stats.totalTimeMs += ms; stats.lastExecMs = ms;
          var msg = (m && m.message) || m;
          Context.setTopic("me", text, msg);
          return respond({ ok: true, message: msg, type: "self", topic: "me" });
        });
      }
    }

    // "not playing" DIAGNOSTIC: when the user reports playback failed right after
    // a media action, read the REAL player state and respond honestly (never a
    // generic educational explanation).
    var AR0 = global.LH_AI.ActionRouting;
    if (AR0 && AR0.diagnoseNotPlaying) {
      var diag = AR0.diagnoseNotPlaying(norm);
      if (diag) {
        var dms = performance.now() - start;
        stats.executed++; stats.totalTimeMs += dms; stats.lastExecMs = dms;
        Context.set("lastActionResult", diag);
        return respond({ ok: true, message: diag.message });
      }
    }

    // Multi-step task planning takes priority for complex commands.
    var plan = TaskPlanner.planFor(norm);
    if (plan) {
      return runPlan(plan).then(function (res) {
        var ms = performance.now() - start;
        stats.executed++; stats.totalTimeMs += ms; stats.lastExecMs = ms;
        return respond(res);
      });
    }

    // ACTION-FIRST routing (v2.22.x): if the user clearly asks LocalHub to DO
    // something (play/open/find/... a media item or file), route to the existing
    // LocalHub capability BEFORE falling back to the generic knowledge/Mind
    // answer. This fixes "Play the evil dead burn video" being answered as an
    // educational "what is a video?" topic.
    var AR = global.LH_AI.ActionRouting;
    if (AR && AR.route) {
      var routeRes = AR.route(norm, {
        previousMatches: Context && Context.get ? Context.get("lastMediaMatches") : null
      });
      if (routeRes && typeof routeRes.then === "function") {
        return routeRes.then(function (r) {
          var ms = performance.now() - start;
          stats.executed++; stats.totalTimeMs += ms; stats.lastExecMs = ms;
          if (r === null) {
            // Not a LocalHub action — fall through to the normal pipeline.
            return processFallthrough(norm, start);
          }
          Context.set("lastActionResult", r && r.result);
          // Remember media matches for ordinal follow-ups ("play the second one").
          if (r && r.matches && Context && Context.set) Context.set("lastMediaMatches", r.matches);
          return respond((r && r.result) || { ok: true, message: "Done." });
        });
      }
      // Non-promise result (ambiguous immediate).
      if (routeRes) {
        var ms2 = performance.now() - start;
        stats.executed++; stats.totalTimeMs += ms2; stats.lastExecMs = ms2;
        if (routeRes.result) {
          if (routeRes.matches && Context && Context.set) Context.set("lastMediaMatches", routeRes.matches);
          return respond(routeRes.result);
        }
      }
    }

    // Action-routing did not apply — continue with the normal pipeline.
    return processFallthrough(norm, start);
  }

  // The original (pre-action-routing) intent pipeline: command / referent /
  // assistant / unknown(Mind). Kept as one function so action-first routing can
  // fall through to it cleanly.
  function processFallthrough(norm, start) {
    var intent = detectIntent(norm);
    var resultPromise;

    // Permission gate (destructive ops require confirmation).
    var cap = capabilityFor(intent.command);
    if (intent.type === "command" && cap && !checkPermission(cap)) {
      resultPromise = Promise.resolve({ ok: false, message: "Permission denied for " + cap.name + "." });
    } else {
      resultPromise = execute(intent);
    }

    return resultPromise.then(function (res) {
      var ms = performance.now() - start;
      stats.executed++;
      stats.totalTimeMs += ms;
      stats.lastExecMs = ms;
      Context.set("lastActionResult", res);
      // Track the conversational subject so follow-ups continue the topic.
      var subject = extractSubject(norm);
      if (subject) Context.setTopic(subject, norm, (res && res.message) || "");
      return respond(res);
    }).catch(function (e) {
      return { ok: false, message: "Error: " + (e && e.message) };
    });
  }

  // Derive a lightweight conversational subject from a query (drops filler
  // words), used for topic continuity like "and your memory?".
  function extractSubject(norm) {
    var t = String(norm || "").toLowerCase();
    t = t.replace(/^(what|how|why|who|when|where|is|are|do|does|can|tell me about|explain|define|about)\s*/i, "")
         .replace(/\?+$/,"").trim();
    if (!t || t.length < 2) return null;
    // Use the last significant phrase
    var words = t.split(" ").filter(function (w) { return w.length > 2 && !/\b(the|and|for|with|your|you|that|what|how|why|which|where|when|then|about)\b/.test(w); });
    if (!words.length) return t.slice(0, 40);
    return words.slice(-4).join(" ").slice(0, 60);
  }

  function diagnostics() {
    return {
      executed: stats.executed,
      avgExecMs: stats.executed ? (stats.totalTimeMs / stats.executed).toFixed(1) : 0,
      lastExecMs: stats.lastExecMs.toFixed ? stats.lastExecMs.toFixed(1) : stats.lastExecMs,
      cacheHits: stats.cacheHits,
      cacheSize: Object.keys(cache).length,
      context: Context ? Context.snapshot() : null,
      capabilities: Capabilities ? Capabilities.diagnostics() : null
    };
  }

  global.LH_AI.Intent = {
    process: process,
    normalize: normalize,
    detectIntent: detectIntent,
    diagnostics: diagnostics
  };
})(window);
