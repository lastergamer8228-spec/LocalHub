/* features_guardian.js - LocalHub Background Guardian.
 *
 * A proactive security-guard system that monitors LocalHub ON ITS OWN, without
 * waiting for a command. It periodically checks system health and raises alerts:
 *
 *   - Storage nearly full
 *   - Battery low
 *   - High CPU / low memory
 *   - New ERROR / WARNING entries in the server log
 *   - Unusual number of connected clients
 *   - The server itself is not reachable
 *
 * It also exposes self-diagnosis commands ("run health check", "scan for
 * problems", "check server health") that do an on-demand audit.
 *
 * Fully offline & deterministic.
 */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  var FS = global.LH_AI.FS;
  var Chat = global.LH_AI.Chat;
  var Memory = global.LH_AI.Memory;

  var Guardian = {
    // Thresholds
    storageAlertPct: 85,    // warn when used % >= this
    batteryAlertPct: 15,    // warn when battery % <= this
    cpuAlertPct: 90,        // warn when cpu % >= this
    memAlertPct: 90,        // warn when memory used % >= this
    logErrorThreshold: 5,   // alert if this many recent ERROR entries
    clientsThreshold: 8,    // alert if connected clients >= this

    // Internal state to avoid spamming the same alert repeatedly.
    _lastState: {
      storageWarned: false,
      batteryWarned: false,
      cpuWarned: false,
      memWarned: false,
      logErrorCount: 0,
      lastAlertTs: 0,
      alertCooldownMs: 120000, // don't spam the same alert within 2 min
      lastSaw: {}
    },

    _running: false,
    _intervalId: null,

    // Turn proactive monitoring on/off.
    start: function () {
      if (this._running) return;
      this._running = true;
      var self = this;
      // First pass immediately, then every interval.
      this.check();
      this._intervalId = setInterval(function () { self.check(); }, 30000); // 30s
      if (Chat && Chat.addAction) Chat.addAction("🛡 Background Guardian is now watching LocalHub.");
    },

    stop: function () {
      this._running = false;
      if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
      if (Chat && Chat.addAction) Chat.addAction("🛡 Background Guardian stopped.");
    },

    isRunning: function () { return this._running; },

    // ---- on-demand full health check ----
    runHealthCheck: function () {
      var self = this;
      return FS.system().then(function (sys) {
        var problems = self.audit(sys);
        var lines = ["🛡 LocalHub Health Check", ""];
        if (problems && problems.length) {
          lines.push("Found " + problems.length + " issue(s):");
          problems.forEach(function (p) { lines.push("  • " + p); });
          lines.push("");
          lines.push("Nothing harmful — but I'd suggest fixing these soon. Want me to help with any of them?");
        } else {
          lines.push("All systems look healthy. No issues detected. ✅");
        }
        return { ok: true, message: lines.join("\n"), problems: problems };
      }).catch(function (e) {
        return { ok: false, message: "Health check failed: " + (e.message || e) };
      });
    },

    // Audit a system snapshot, return a list of problem strings.
    audit: function (sys) {
      var problems = [];
      sys = sys || {};
      var cpu = sys.cpu || {}, mem = sys.memory || {}, sto = sys.storage || {},
          bat = sys.battery || {}, net = sys.network || {};

      // Storage
      var usedPct = sto.totalBytes ? (sto.usedBytes / sto.totalBytes) * 100 : 0;
      if (usedPct >= this.storageAlertPct) {
        problems.push("Storage is " + usedPct.toFixed(0) + "% full — free some space soon.");
      }
      // Battery
      if (bat.level != null && bat.level <= this.batteryAlertPct) {
        problems.push("Battery is low (" + bat.level + "%). Plug in if you can.");
      }
      // CPU
      if (cpu.usagePercent != null && cpu.usagePercent >= this.cpuAlertPct) {
        problems.push("CPU is very high (" + cpu.usagePercent.toFixed(0) + "%).");
      }
      // Memory
      if (mem.totalBytes) {
        var memPct = (mem.usedBytes / mem.totalBytes) * 100;
        if (memPct >= this.memAlertPct) problems.push("Memory is nearly full (" + memPct.toFixed(0) + "%).");
      }
      return problems;
    },

    // ---- background periodic check ----
    check: function () {
      var self = this;
      if (!FS || !FS.system) return;
      FS.system().then(function (sys) {
        var problems = self.audit(sys);
        var now = Date.now();
        // Build a signature of current problems to avoid repeat spam.
        var sig = problems.slice().sort().join("|");

        // Only alert if something new, and past the cooldown.
        var changed = sig !== self._lastState.lastSaw.sig;
        if (changed) {
          self._lastState.lastSaw.sig = sig;
        }

        if (problems.length && changed && (now - self._lastState.lastAlertTs) >= self._lastState.alertCooldownMs) {
          self._lastState.lastAlertTs = now;
          self.report(problems);
          // Make the Cognitive Core aware of the health degradation (Phase 15).
          if (global.LH_AI.Cognitive && global.LH_AI.Cognitive.emit) {
            global.LH_AI.Cognitive.emit("GUARDIAN_HEALTH", { problems: problems }, { importance: 3 });
          }
          // Feed resource exhaustion into the self-healing engine (thresholded).
          if (problems.some(function (p) { return /CPU|Memory|Storage/i.test(p); })) {
            self.ingest("resource_exhaustion", problems.join(" "), { component: "system" });
          }
          // Self-heal: fix what we can, advise on the rest.
          self.heal(problems, sys);
        }

        // Independently check logs for errors.
        self._checkLogs(now);
        self._checkClients(now, sys);
      }).catch(function (e) {
        // If system endpoint fails, the server may be having issues. Feed it as a
        // server failure (thresholded) and alert the user.
        var now = Date.now();
        if ((now - self._lastState.lastAlertTs) >= self._lastState.alertCooldownMs) {
          self._lastState.lastAlertTs = now;
          self.ingest("server_failure", "system endpoint unreachable: " + (e && e.message || e), { component: "system" });
          if (Chat && Chat.addError) Chat.addError("🛡 Guardian: couldn't reach the LocalHub system status. The server may be restarting or having issues.");
        }
      });
    },

    _checkLogs: function (now) {
      var self = this;
      if (!FS || !FS.logs) return;
      FS.logs().then(function (l) {
        var logs = (l && l.logs) || [];
        // Broader detection: classify logs into failure kinds and feed the brain.
        self._scanLogsForFailures(logs.slice(0, 40));
        var recent = logs.slice(0, 20);
        var errs = recent.filter(function (x) { return /error/i.test(x.level || ""); }).length;
        if (errs >= 2 && errs !== self._lastState.logErrorCount && (now - self._lastState.lastAlertTs) >= self._lastState.alertCooldownMs) {
          self._lastState.logErrorCount = errs;
          self._lastState.lastAlertTs = now;
          if (Chat && Chat.addError) Chat.addError("🛡 Guardian: I spotted " + errs + " recent error(s) in the LocalHub logs. Say 'how to fix an api 500 error' or 'show logs' to investigate.");
        }
      }).catch(function(){});
    },

    _checkClients: function (now, sys) {
      var self = this;
      if (!FS || !FS.clients) return;
      FS.clients().then(function (c) {
        var list = (c && c.clients) || [];
        if (list.length >= self.clientsThreshold && (now - self._lastState.lastAlertTs) >= self._lastState.alertCooldownMs) {
          self._lastState.lastAlertTs = now;
          if (Chat && Chat.addAction) Chat.addAction("🛡 Guardian: " + list.length + " devices are connected right now. Want to see who? Say 'show connected clients'.");
        }
      }).catch(function(){});
    },

    // Show a proactive alert in the chat.
    report: function (problems) {
      if (!Chat) return;
      var msg = "🛡 Guardian alert: " + problems.join(" ");
      if (Chat.addError) Chat.addError(msg);
    },

    // Persist whether guardian is enabled.
    setEnabled: function (on) {
      return Memory.put("settings", { id: "guardian", enabled: !!on });
    },
    getEnabled: function () {
      return Memory.get("settings", "guardian").then(function (s) { return !!(s && s.enabled); });
    },

    // ---- feed failures into the Cognitive Core + Self-Healing engine ----
    // Unified detection entry point for any observed failure type. Classifies
    // severity/frequency, emits a Cognitive event, and (if significant) forwards
    // to the self-healing engine. Never fabricates action.
    ingest: function (kind, error, meta) {
      var SH = global.LH_AI.SelfHeal;
      var Cog = global.LH_AI.Cognitive;
      // Always make the brain aware (proactive intelligence).
      if (Cog && Cog.emit) Cog.emit("GUARDIAN_EVENT", { kind: kind, error: error || "", meta: meta || {} }, { importance: 2 });
      if (SH && SH.ingestDetection) {
        return SH.ingestDetection(kind, error, meta);
      }
      return Promise.resolve({ ok: true, action: "observed_only", significant: false });
    },

    // -------- Guard: Guardian DETECTS, SelfHeal DECIDES, policy AUTHORIZES ----
    // Guardian is strictly detection/reporting. It NEVER modifies source code
    // or configuration directly. Any repair decision (including the autonomy
    // level and whether to act at all) is delegated to SelfHeal, which applies
    // the L0-L5 gates and admin approval. This method documents that boundary
    // and returns SelfHeal's decision for observability.
    decide: function (detection) {
      var SH = global.LH_AI.SelfHeal;
      if (!SH) return { ok: false, message: "SelfHeal not loaded." };
      var component = (detection && detection.component) || "unknown";
      return {
        ok: true,
        autonomyLevel: (SH.guessAutonomyLevel ? SH.guessAutonomyLevel(detection, component) : 1),
        critical: SH.isCritical ? SH.isCritical(component) : false,
        canAutoRepair: SH.canAutoRepair ? SH.canAutoRepair(component, SH.guessAutonomyLevel ? SH.guessAutonomyLevel(detection, component) : 1) : false,
        note: "Guardian only detects; SelfHeal decides the repair level and authorizes actions.",
        sourceModified: false
      };
    },

    // ---- broader detection scope (Phase 5) ----
    // Classify a single log line into a failure kind if it matches one.
    _classifyLogLine: function (text) {
      var t = String(text || "");
      if (/crashe|fatal|abort|panic|native crash/i.test(t)) return "crash";
      if (/sql|sqlite|room|database|db error|foreign key|constraint/i.test(t) && /error|exception|fail/i.test(t)) return "database_error";
      if (/websocket|ws error|socket error|connection reset|disconnect/i.test(t) && /error|fail|reset/i.test(t)) return "websocket_failure";
      if (/automation|workflow|task scheduler|background task/i.test(t) && /fail|error/i.test(t)) return "automation_failure";
      if (/out of memory|oom|no space|resource exhaustion|too many|quota/i.test(t)) return "resource_exhaustion";
      if (/api|endpoint|route|server error|http [45][0-9]{2}/i.test(t) && /error|fail|50[0-9]|404/i.test(t)) return "server_failure";
      if (/exception|unhandled|stack trace|thrown/i.test(t)) return "exception";
      return null;
    },

    // Classify log lines, bucket by kind, and feed significant buckets into the
    // Cognitive Core + self-healing engine. Respects severity/frequency gates.
    _scanLogsForFailures: function (logs) {
      var self = this;
      var buckets = {};
      (logs || []).forEach(function (l) {
        var msg = (l && (l.message || l.msg || "")) || "";
        var level = (l && l.level) || "";
        if (!/error|warn|exception|fatal|crash/i.test(String(level) + " " + msg)) return;
        var kind = self._classifyLogLine(msg);
        if (!kind) kind = /error/i.test(level) ? "exception" : null;
        if (!kind) return;
        buckets[kind] = buckets[kind] || { count: 0, samples: [] };
        buckets[kind].count++;
        if (buckets[kind].samples.length < 2) buckets[kind].samples.push(msg.slice(0, 140));
      });
      var self2 = self;
      Object.keys(buckets).forEach(function (kind) {
        var b = buckets[kind];
        // Feed each distinct failure class (aggregated, thresholded by the engine).
        if (b.count >= 1) {
          self2.ingest(kind, b.samples[0] || kind, { component: kind, stackTrace: b.samples.join("\n") });
        }
      });
    },

    // ============================================================
    // SELF-HEALING & SELF-IMPROVEMENT
    // ============================================================

    // Map a detected problem to a concrete fix action. Returns the action string
    // (server endpoint) or a JS function to run, or null if no auto-fix.
    autoHeal: false,          // set true to fix automatically; false = suggest only

    // Perform a fix action. If it's a server endpoint, POST it. If it's a
    // function, call it. Returns a promise.
    applyFix: function (action, label) {
      var base = global.LH_AI.baseUrl || (location.protocol + "//" + location.host);
      if (typeof action === "function") {
        return Promise.resolve().then(function () { return action(); }).then(function () {
          if (Chat) Chat.addAction("🛡 Guardian: " + (label || "applied a fix") + ".");
          return true;
        });
      }
      // server endpoint (e.g. "server/clear-cache")
      return fetch(base + "/api/" + action, { method: "POST" })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (res) {
          if (Chat) Chat.addAction("🛡 Guardian: " + (label || ("ran " + action)) + " → " + ((res && res.message) || "done"));
          return true;
        })
        .catch(function () { if (Chat) Chat.addError("🛡 Guardian: failed to run " + action); return false; });
    },

    // Decide what to do for each detected problem. Returns a list of
    // {problem, action, label} where action may be null (no auto-fix, just advise).
    healPlan: function (problems, sys) {
      var plan = [];
      sys = sys || {};
      var sto = sys.storage || {};
      // Storage full -> clear cache (safe, server temp files).
      if (problems.some(function (p) { return /storage/i.test(p); })) {
        plan.push({ problem: "Storage", action: "server/clear-cache", label: "cleared the server temp cache to free space" });
      }
      // High memory/CPU -> suggest, no safe auto action; give advice.
      if (problems.some(function (p) { return /CPU/i.test(p) || /Memory/i.test(p); })) {
        plan.push({ problem: "High CPU/Memory", action: null, label: "Consider closing unused apps. I can't safely kill processes on your behalf, but I can advise." });
      }
      // Low battery -> advice only.
      if (problems.some(function (p) { return /battery/i.test(p); })) {
        plan.push({ problem: "Battery", action: null, label: "Battery is low — plug in to keep the server running reliably." });
      }
      return plan;
    },

    // Heal: for each problem, if autoHeal is on apply the fix, otherwise suggest.
    heal: function (problems, sys) {
      var self = this;
      var plan = self.healPlan(problems, sys);
      var applied = [];
      plan.forEach(function (item) {
        if (item.action && self.autoHeal) {
          self.applyFix(item.action, item.label);
          applied.push(item.problem);
        } else if (!item.action) {
          // advice-only problem
          if (Chat) Chat.addAction("🛡 Guardian advice: " + item.label);
        }
      });
      return applied;
    },

    // A summary of optimizations / improvements that could make LocalHub better.
    suggestImprovements: function (sys) {
      var tips = [];
      sys = sys || {};
      var sto = sys.storage || {}, bat = sys.battery || {};
      if (sto.totalBytes && (sto.usedBytes / sto.totalBytes) > 0.8) {
        tips.push("Storage is getting tight — run 'show largest files' and clear big old files.");
      }
      tips.push("Enable HTTPS and 2FA in Settings > Security to keep LocalHub safer over the network.");
      tips.push("Set up Automation workflows (e.g. 'organize downloads') to keep things tidy automatically.");
      tips.push("Keep the LocalHub app updated and on the foreground for the most reliable server uptime.");
      return tips;
    }
  };

  global.LH_AI.Guardian = Guardian;
})(window);

/* -- Guardian commands -- */
(function(){
  var C = global.LH_AI.Commands;
  if (!C) return;
  var G = global.LH_AI.Guardian;
  C.register({module:"guardian",category:"guardian",name:"health-check",deep:true,
    match:[/\brun (a |the )?health check\b/i,/\bhealth check\b/i,/\bscan (the |for )?problems\b/i,/\bcheck (the )?server health\b/i,/\bcheck (the )?system health\b/i,/\bsystem health\b/i,/\bany (issues|problems|errors)\b/i,/\bhow is the (server|system) doing\b/i,/\bself[ -]?diagnos(is|tic)\b/i],
    admin:false, run:function(){ return G.runHealthCheck(); }});
  C.register({module:"guardian",category:"guardian",name:"guardian-start",deep:true,
    match:[/\b(start|enable|turn on|activate) (the )?(guardian|background monitoring|monitoring)\b/i,/\bwatch (the |my )?(system|server|localhub)\b/i],
    admin:false, run:function(){ G.start(); return {ok:true,message:"🛡 Background Guardian is now watching LocalHub and will alert me to any issue it finds."}; }});
  C.register({module:"guardian",category:"guardian",name:"guardian-stop",deep:true,
    match:[/\b(stop|disable|turn off|deactivate) (the )?(guardian|background monitoring)\b/i],
    admin:false, run:function(){ G.stop(); return {ok:true,message:"🛡 Background Guardian stopped. Ask me to 'run health check' any time."}; }});
  C.register({module:"guardian",category:"guardian",name:"guardian-status",deep:true,
    match:[/\b(guardian|monitoring) (status|running|active)\b/i,/\bis (the )?(guardian|monitoring) (on|running|active)\b/i],
    admin:false, run:function(){ return {ok:true,message:"🛡 Background Guardian is currently " + (G.isRunning() ? "active and watching LocalHub." : "off. Say 'start guardian' to enable it, or 'run health check' for a one-time scan.")}; }});

  C.register({module:"guardian",category:"guardian",name:"auto-heal-on",deep:true,
    match:[/\b(auto[- ]?heal|self[- ]?heal)\b/i,/\bfix (issues|problems) automatically\b/i],
    admin:false, run:function(){ G.autoHeal=true; return {ok:true,message:"🛡 Auto-heal enabled. I'll now fix what I safely can on my own (e.g. clear cache when storage is full) and advise on the rest."}; }});
  C.register({module:"guardian",category:"guardian",name:"auto-heal-off",deep:true,
    match:[/\b(stop|disable|turn off|deactivate) (auto[- ]?heal|self[- ]?heal)\b/i,/\b(auto[- ]?heal|self[- ]?heal) (off|false)\b/i],
    admin:false, run:function(){ G.autoHeal=false; return {ok:true,message:"🛡 Auto-heal disabled. I'll still alert you and suggest fixes, but I won't act on my own."}; }});
  C.register({module:"guardian",category:"guardian",name:"improve-localhub",deep:true,
    match:[/\b(improve|optimize|make better|enhance) (localhub|the app|the server|the system)\b/i,/how can i (make|improve) (localhub|the app|my server) better\b/i,/recommend improvements\b/i],
    admin:false, run:function(){ return G.runHealthCheck().then(function(hc){ var F2=(global.LH_AI&&global.LH_AI.FS)||{system:function(){return Promise.resolve({});}}; return F2.system().then(function(sys){ var tips=G.suggestImprovements(sys); var msg=(hc.message||"")+"\n\n💡 Improvement suggestions:\n" + tips.map(function(t,i){return "  "+(i+1)+". "+t;}).join("\n"); return {ok:true,message:msg}; }); }); }});
  C.register({module:"guardian",category:"guardian",name:"guardian-help",deep:true,
    match:[/\b(guardian|self[- ]?heal|auto[- ]?heal) (help|how to|commands)\b/i,/\bwhat does (the )?guardian do\b/i,/\bwhat is (the )?guardian\b/i,/\btell me about (the )?guardian\b/i],
    admin:false, run:function(){ return {ok:true,message:"🛡 Guardian watches LocalHub and can: alert me to problems (storage, battery, CPU, memory, logs), run health checks, apply safe auto-fixes (with 'auto-heal on'), and suggest improvements ('improve localhub'). Commands: 'run health check', 'start/stop guardian', 'auto-heal on/off', 'improve localhub'."}; }});
})();
