/* cognitive.js - LocalHub Cognitive Core.
 *
 * The central, single operating brain of the LocalHub Assistant. It does NOT
 * replace or duplicate brain.js / intent.js / reasoning.js — it UNIFIES them
 * into one coherent cognitive loop:
 *
 *   PERCEIVE -> UNDERSTAND -> CONTEXTUALIZE -> REMEMBER -> REASON -> DECIDE ->
 *   PLAN -> CHECK POLICY -> ACT -> OBSERVE -> VERIFY -> REFLECT -> LEARN ->
 *   UPDATE MEMORY
 *
 * It reuses the existing LocalHub modules (Memory, Context, FS, Commands,
 * Guardian, Mind, Capabilities, Intent, Reasoning) rather than reinventing them.
 *
 * Fully offline, deterministic, and private. No cloud, no telemetry.
 */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  // Lazy references to existing modules so the core degrades gracefully.
  function Mem() { return global.LH_AI.Memory; }
  function Ctx() { return global.LH_AI.Context; }
  function FS() { return global.LH_AI.FS; }
  function Cmd() { return global.LH_AI.Commands; }

  // =====================================================================
  // 1. EVENT BUS
  // =====================================================================
  var listeners = {};

  function on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
  function off(type, fn) {
    if (!listeners[type]) return;
    listeners[type] = listeners[type].filter(function (f) { return f !== fn; });
  }
  function emit(type, data, opts) {
    opts = opts || {};
    var evt = normalizeEvent(type, data, opts);
    (listeners[type] || []).forEach(function (fn) {
      try { fn(evt); } catch (e) {}
    });
    // Also fan out to catch-all listeners (e.g. the core's own observer).
    (listeners["*"] || []).forEach(function (fn) {
      try { fn(evt); } catch (e) {}
    });
    return evt;
  }

  // =====================================================================
  // 2. PERCEPTION - normalize any raw event into a standard event envelope
  // =====================================================================
  function normalizeEvent(type, data, opts) {
    data = data || {};
    var importance = opts.importance != null ? opts.importance : 1;
    var source = opts.source || "internal";
    var confidence = opts.confidence != null ? opts.confidence : 1;
    return {
      ts: Date.now(),
      type: type,
      source: source,
      data: data,
      importance: importance,
      confidence: confidence
    };
  }

  // Convenience: ingest a raw external signal (server event, file event, etc.).
  function perceive(type, data, opts) {
    return emit(type, data, opts);
  }

  // =====================================================================
  // 3. INTERNAL STATE MODEL (persistent via Memory, inspectable for admin)
  // =====================================================================
  var STATE_KEY = "cognitive_state";
  var state = {
    identity: { name: "LocalHub Assistant", kind: "offline-local-cognitive-core", version: "2.0" },
    mode: "idle",               // idle | thinking | planning | executing | verifying | reflecting
    goal: null,                 // current high-level goal
    task: null,                 // current task label
    plan: null,                 // current plan (list of steps)
    stepIndex: -1,
    focus: null,                // what the user is currently doing
    confidence: 0,              // 0..1 confidence in current understanding
    riskLevel: "low",           // low | medium | high | critical (of latest action)
    lastActionResult: null,     // { ok, action, message }
    lastVerify: null,           // { action, verified, ok }
    recoveryAttempts: 0,
    observations: [],           // ring buffer of recent observations
    errors: [],                 // ring buffer of recent errors
    startedAt: Date.now()
  };
  var MAX_OBS = 12;

  function setState(key, value) { state[key] = value; }
  function getState(key) { return key ? state[key] : state; }
  function snapshotState(admin) {
    var s = JSON.parse(JSON.stringify(state));
    if (!admin) {
      // Hide internal plan/observations/errors from normal users.
      delete s.observations; delete s.errors; delete s.plan; delete s.stepIndex;
    }
    return s;
  }
  function observe(label, detail) {
    state.observations.push({ ts: Date.now(), label: label, detail: detail });
    if (state.observations.length > MAX_OBS) state.observations.shift();
  }
  function recordError(err) {
    state.errors.push({ ts: Date.now(), err: String(err) });
    if (state.errors.length > MAX_OBS) state.errors.shift();
    // Emit an error event for the Guardian / debug view.
    emit("COGNITIVE_ERROR", { err: String(err) }, { importance: 3 });
  }
  function persistState() {
    var m = Mem();
    if (m && m.put) m.put(STATE_KEY, state).catch(function () {});
  }
  function loadState() {
    var m = Mem();
    if (!m || !m.get) return Promise.resolve();
    return m.get(STATE_KEY, STATE_KEY).then(function (s) {
      if (s) Object.assign(state, s);
      state.startedAt = Date.now();
      persistState();
    }).catch(function () {});
  }
  function resetState() {
    var m = Mem();
    if (m && m.remove) m.remove(STATE_KEY, STATE_KEY).catch(function () {});
    state.mode = "idle"; state.goal = null; state.task = null; state.plan = null;
    state.stepIndex = -1; state.focus = null; state.confidence = 0;
    state.lastActionResult = null; state.lastVerify = null; state.recoveryAttempts = 0;
    state.observations = []; state.errors = [];
  }

  // =====================================================================
  // 4. MEMORY LAYERS (built on existing memory.js, not a duplicate store)
  //   - working   : ephemeral, current-task (in-memory)
  //   - episodic  : important past events (persisted store "episodes")
  //   - semantic  : stable facts (existing "knowledge" store)
  //   - procedural: learned workflows (persisted store "procedures")
  // =====================================================================
  var working = {}; // working memory: key -> value (current task only)

  function setWorking(key, value) { working[key] = value; }
  function getWorking(key) { return key ? working[key] : working; }
  function clearWorking() { working = {}; }

  // Importance-scored memory write. Store: "episodes" | "procedures" | "facts".
  function remember(store, entry, importance) {
    var m = Mem();
    if (!m || !m.put) return Promise.resolve(null);
    entry.importance = importance != null ? importance : (entry.importance || 1);
    entry.ts = entry.ts || Date.now();
    entry.confidence = entry.confidence != null ? entry.confidence : 0.8;
    // Dedup: if a near-identical entry exists, update it instead of duplicating.
    return m.getAll(store).then(function (all) {
      var dup = all.find(function (x) {
        return x.kind === entry.kind && x.text === entry.text;
      });
      if (dup) {
        dup.ts = Date.now(); dup.importance = Math.max(dup.importance || 1, importance || 1);
        return m.put(store, dup);
      }
      return m.put(store, entry);
    });
  }

  // Retrieve memories for a query, scoring by relevance to the query words.
  function recall(store, query, limit) {
    var m = Mem();
    limit = limit || 5;
    if (!m || !m.getAll) return Promise.resolve([]);
    return m.getAll(store).then(function (all) {
      var q = String(query || "").toLowerCase().split(/\s+/).filter(function (w) { return w.length > 2; });
      var scored = all.map(function (e) {
        var hay = ((e.text || "") + " " + (e.kind || "")).toLowerCase();
        var score = 0;
        q.forEach(function (w) { if (hay.indexOf(w) >= 0) score += 1; });
        score += (e.importance || 1) * 0.5;
        // Recency bonus.
        var ageDays = (Date.now() - (e.ts || 0)) / 86400000;
        score += Math.max(0, 1 - ageDays / 30) * 0.5;
        return { e: e, score: score };
      });
      scored.sort(function (a, b) { return b.score - a.score; });
      return scored.slice(0, limit).map(function (s) { return s.e; });
    });
  }

  // Decay: lower importance of old, low-use memories and drop expired ones.
  function decay(store, maxAgeDays) {
    var m = Mem();
    maxAgeDays = maxAgeDays || 60;
    if (!m || !m.getAll || !m.remove) return Promise.resolve();
    return m.getAll(store).then(function (all) {
      all.forEach(function (e) {
        var ageDays = (Date.now() - (e.ts || 0)) / 86400000;
        if (ageDays > maxAgeDays && (e.importance || 1) < 3) m.remove(store, e.id);
      });
    });
  }

  // Forget a single memory / clear a whole layer.
  function forget(store, id) {
    var m = Mem();
    if (!m) return Promise.resolve();
    if (id) return m.remove(store, id);
    return m.clear(store);
  }
  function forgetAllMemory() {
    var m = Mem();
    if (!m) return Promise.resolve();
    ["episodes", "procedures"].forEach(function (s) { m.clear(s).catch(function () {}); });
    clearWorking();
    return Promise.resolve();
  }

  // =====================================================================
  // 4b. MEMORY CORRECTION + EXPLICIT RANKING
  // =====================================================================
  // Memory correction: update a stored memory's fact/importance in place.
  function correctMemory(store, id, updates) {
    var m = Mem();
    if (!m || !m.get || !m.put) return Promise.resolve(null);
    return m.get(store, id).then(function (entry) {
      if (!entry) return null;
      if (updates) Object.assign(entry, updates, { updatedAt: Date.now(), corrected: true });
      return m.put(store, entry);
    });
  }

  // Explicit memory ranking: score all memories for a query and return a ranked
  // list of {entry, score} — the same scoring used internally by recall().
  function rank(store, query, limit) {
    var m = Mem();
    limit = limit || 5;
    if (!m || !m.getAll) return Promise.resolve([]);
    return m.getAll(store).then(function (all) {
      var q = String(query || "").toLowerCase().split(/\s+/).filter(function (w) { return w.length > 2; });
      var scored = all.map(function (e) {
        var hay = ((e.text || "") + " " + (e.kind || "") + " " + (e.name || "")).toLowerCase();
        var score = 0;
        q.forEach(function (w) { if (hay.indexOf(w) >= 0) score += 1; });
        score += (e.importance || 1) * 0.5;
        var ageDays = (Date.now() - (e.ts || 0)) / 86400000;
        score += Math.max(0, 1 - ageDays / 30) * 0.5;
        return { entry: e, score: score };
      });
      scored.sort(function (a, b) { return b.score - a.score; });
      return scored.slice(0, limit);
    });
  }

  // =====================================================================
  // 4c. PERSONAL MODEL (persistent, non-sensitive preference learning)
  // =====================================================================
  // Learns NON-sensitive preferences only (preferred workflows, tone, frequency
  // of capabilities used, repeated task patterns). Stored locally. It never
  // stores sensitive personal attributes.
  var personalModel = { prefs: {}, freq: {}, lastSeen: {} };
  var PM_KEY = "personal_model";
  function loadPersonalModel() {
    var m = Mem();
    if (!m || !m.get) return Promise.resolve();
    return m.get(PM_KEY, PM_KEY).then(function (p) { if (p) personalModel = p; }).catch(function () {});
  }
  function savePersonalModel() {
    var m = Mem();
    if (m && m.put) m.put(PM_KEY, personalModel).catch(function () {});
  }
  function updatePreference(key, value) {
    personalModel.prefs[key] = value;
    personalModel.lastSeen[key] = Date.now();
    savePersonalModel();
  }
  function noteCapabilityUse(capability) {
    var c = String(capability || "");
    if (!c) return;
    personalModel.freq[c] = (personalModel.freq[c] || 0) + 1;
    savePersonalModel();
  }
  function getPersonalModel(admin) {
    var out = JSON.parse(JSON.stringify(personalModel));
    if (!admin) {
      // Present a safe summary to non-admins.
      return {
        preferredCapabilities: Object.keys(out.freq || {}).slice(0, 8),
        communicationStyle: out.prefs && out.prefs.communicationStyle || "default"
      };
    }
    return out;
  }

  // =====================================================================
  // 5. CAPABILITY / TOOL REGISTRY (risk + reversible + permission)
  // =====================================================================
  // Each tool: { id, name, risk, reversible, needsConfirm, permission, run(args) }
  var tools = {};
  function registerTool(tool) {
    tools[tool.id] = tool;
    // Also expose it through the existing capability registry if available.
    if (global.LH_AI.Capabilities && global.LH_AI.Capabilities.register) {
      global.LH_AI.Capabilities.register("cognitive", [{
        name: "tool." + tool.id,
        desc: tool.name + (tool.needsConfirm ? " (confirm)" : ""),
        permission: tool.permission || "public"
      }]);
    }
  }
  function getTool(id) { return tools[id]; }
  function listTools() {
    return Object.keys(tools).map(function (k) {
      var t = tools[k];
      return { id: t.id, name: t.name, risk: t.risk, reversible: t.reversible,
               needsConfirm: t.needsConfirm, permission: t.permission };
    });
  }

  function riskOf(riskStr) { return { low: 1, medium: 2, high: 3, critical: 4 }[riskStr] || 1; }

  // Register the core LocalHub tools (thin wrappers over existing FS / actions).
  registerTool({ id: "fs.list", name: "List folder", risk: "low", reversible: true, needsConfirm: false, permission: "public",
    run: function (p) { return FS().list(p.path); } });
  registerTool({ id: "fs.read", name: "Read file", risk: "low", reversible: true, needsConfirm: false, permission: "public",
    run: function (p) { return FS().read(p.path); } });
  registerTool({ id: "fs.mkdir", name: "Create folder", risk: "low", reversible: true, needsConfirm: false, permission: "admin",
    run: function (p) { return FS().mkdir(p.parent, p.name); } });
  registerTool({ id: "fs.write", name: "Write file", risk: "medium", reversible: true, needsConfirm: false, permission: "admin",
    run: function (p) { return FS().write(p.path, p.content); } });
  registerTool({ id: "fs.delete", name: "Delete", risk: "high", reversible: false, needsConfirm: true, permission: "admin",
    run: function (p) { return FS().delete(p.path, true); } });
  registerTool({ id: "fs.rename", name: "Rename", risk: "medium", reversible: false, needsConfirm: false, permission: "admin",
    run: function (p) { return FS().rename(p.path, p.name); } });
  registerTool({ id: "fs.copy", name: "Copy", risk: "low", reversible: true, needsConfirm: false, permission: "admin",
    run: function (p) { return FS().copy(p.path, p.dest); } });
  registerTool({ id: "fs.move", name: "Move", risk: "medium", reversible: false, needsConfirm: false, permission: "admin",
    run: function (p) { return FS().move(p.path, p.dest); } });
  registerTool({ id: "fs.zip", name: "Compress", risk: "medium", reversible: true, needsConfirm: false, permission: "admin",
    run: function (p) { return FS().zip(p.paths, p.dest); } });
  registerTool({ id: "fs.unzip", name: "Extract", risk: "medium", reversible: false, needsConfirm: false, permission: "admin",
    run: function (p) { return FS().unzip(p.path, p.dest); } });
  registerTool({ id: "fs.search", name: "Search files", risk: "low", reversible: true, needsConfirm: false, permission: "public",
    run: function (p) { return FS().search(p.q, p.dir); } });
  registerTool({ id: "fs.usage", name: "Storage usage", risk: "low", reversible: true, needsConfirm: false, permission: "public",
    run: function () { return FS().usage(); } });
  registerTool({ id: "system", name: "System snapshot", risk: "low", reversible: true, needsConfirm: false, permission: "public",
    run: function () { return FS().system(); } });
  registerTool({ id: "clients", name: "Connected clients", risk: "low", reversible: true, needsConfirm: false, permission: "public",
    run: function () { return FS().clients(); } });
  registerTool({ id: "logs", name: "View logs", risk: "low", reversible: true, needsConfirm: false, permission: "admin",
    run: function () { return FS().logs(); } });
  registerTool({ id: "server.action", name: "Server control", risk: "high", reversible: false, needsConfirm: true, permission: "admin",
    run: function (p) {
      if (global.LH_AI.Brain && global.LH_AI.Brain.runAction) { global.LH_AI.Brain.runAction(p.action, p.label); return Promise.resolve({ ok: true }); }
      return FS().post("/api/" + p.action);
    } });
  registerTool({ id: "tts.speak", name: "Speak (TTS)", risk: "low", reversible: true, needsConfirm: false, permission: "public",
    run: function (p) { if (global.LH_AI.Voice && global.LH_AI.Voice.speakServer) { global.LH_AI.Voice.speakServer(p.text); return Promise.resolve({ ok: true }); } return Promise.resolve({ ok: false }); } });
  registerTool({ id: "guardian.health", name: "Health check", risk: "low", reversible: true, needsConfirm: false, permission: "admin",
    run: function () { if (global.LH_AI.Guardian && global.LH_AI.Guardian.runHealthCheck) return global.LH_AI.Guardian.runHealthCheck(); return Promise.resolve({ ok: false }); } });

  // =====================================================================
  // 6. DECISION / WILL LAYER
  // =====================================================================
  // Classify an action's risk and decide whether confirmation is required.
  function decide(action, tool, role) {
    role = role || "user";
    // Permission: admin tools require admin.
    if (tool && tool.permission === "admin" && role !== "admin") {
      return { allowed: false, reason: "permission", message: "This action is available only to Administrator accounts." };
    }
    if (!tool) return { allowed: true, risk: "unknown", riskScore: 0, confirm: false };
    var risk = tool.risk || "low";
    var riskScore = riskOf(risk);
    var args = {};
    try { args = typeof tool === "object" && tool._lastArgs ? tool._lastArgs : {}; } catch (e) {}
    // Enrich risk from the action context (path scope).
    var pathStr = String((args && (args.path || (args.parent && ("/" + args.name)))) || "");
    var SH = global.LH_AI.SelfHeal;
    var pathCheck = (SH && SH.FileEngine && SH.FileEngine.inAllowedRoot) ? SH.FileEngine.inAllowedRoot(pathStr) : true;
    if (pathStr && !pathCheck && (tool.id === "fs.write" || tool.id === "fs.delete")) {
      riskScore = Math.max(riskScore, 3);
      risk = "high";
    }
    var confirm = tool.needsConfirm === true || risk === "high" || risk === "critical";
    return { allowed: true, risk: risk, riskScore: riskScore, confirm: confirm, reversible: tool.reversible !== false };
  }

  // =====================================================================
  // 7. ACTION EXECUTOR: ACT -> OBSERVE -> VERIFY -> RECOVER
  // =====================================================================
  function executeAction(action, args, role, confirmGranted) {
    var tool = tools[action];
    if (!tool) return Promise.resolve({ ok: false, error: "Unknown tool: " + action });
    var decision = decide(action, tool, role);
    if (!decision.allowed) return Promise.resolve({ ok: false, error: decision.message, reason: decision.reason });
    if (decision.confirm && !confirmGranted) {
      return Promise.resolve({ ok: false, needsConfirm: true, risk: decision.risk, message: "This is a " + decision.risk + "-risk action. Shall I proceed?" });
    }
    setState("mode", "executing"); setState("riskLevel", decision.risk); setState("task", tool.name);
    observe("ACT", action + " " + JSON.stringify(args || {}));
    var attempt = 0;
    function tryRun() {
      return Promise.resolve().then(function () { return tool.run(args || {}); }).then(function (res) {
        setState("lastActionResult", { ok: !!(res && res.ok !== false), action: action, message: (res && res.message) || "done" });
        // VERIFY where possible.
        return verifyAction(action, args, res).then(function (verifyRes) {
          setState("lastVerify", { action: action, verified: verifyRes.ok, ok: !!(res && res.ok !== false) });
          observe("VERIFY", action + " verified=" + verifyRes.ok);
          if (verifyRes.ok) {
            setState("mode", "idle");
            emit("ASSISTANT_TASK_COMPLETED", { action: action }, { importance: 2 });
            return { ok: true, message: verifyRes.message || (res && res.message) || "Done.", data: res };
          }
          return recover(action, args, role, attempt, res);
        });
      }).catch(function (e) {
        recordError(e);
        return recover(action, args, role, attempt, { error: e && e.message || String(e) });
      });
    }
    function recover(act, a, r, n, lastRes) {
      if (n >= 2) { // retry limit
        setState("mode", "idle");
        return { ok: false, error: "Action failed after retries: " + ((lastRes && lastRes.error) || "unknown"), recovered: false };
      }
      attempt = n + 1;
      setState("recoveryAttempts", attempt);
      observe("RECOVER", act + " attempt " + attempt);
      emit("ACTION_FAILED", { action: act, attempt: attempt, error: lastRes && lastRes.error }, { importance: 3 });
      // Safe retry (delay small backoff), unless the failure is a confirm/permission block.
      if (lastRes && (lastRes.needsConfirm || lastRes.reason === "permission")) return { ok: false, error: lastRes.message };
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(tryRun()); }, 400 * attempt);
      });
    }
    return tryRun();
  }

  // A lightweight verifier: for known actions, check the observable result.
  function verifyAction(action, args, res) {
    var ok = !!(res && res.ok !== false);
    // For file creates, try to confirm existence when the tool returns a path.
    var path = res && (res.path || (args && args.path));
    if (ok && path && FS() && FS().info) {
      return FS().info(path).then(function (info) {
        return { ok: !!(info && info.ok), message: "Verified: " + (info && info.ok ? "exists" : "not found") };
      }).catch(function () { return { ok: ok, message: "Could not verify on-device; relying on tool result." }; });
    }
    return Promise.resolve({ ok: ok, message: ok ? "Done." : ((res && res.error) || "failed") });
  }

  // =====================================================================
  // 8. REFLECTION + BOUNDED LEARNING
  // =====================================================================
  // After a meaningful task, record an episodic memory of the outcome and
  // optionally a learned procedure. Bounded: only when importance/outcome merit.
  function reflect(result, label) {
    if (!result) return Promise.resolve();
    var ok = !!(result.ok || result.verified);
    if (ok) {
      return remember("episodes", { kind: "outcome", text: (label || "Task") + " succeeded.", ok: true, confidence: 0.9 }, 2);
    } else {
      return remember("episodes", { kind: "outcome", text: (label || "Task") + " failed: " + (result.error || ""), ok: false, confidence: 0.9 }, 4);
    }
  }

  // Learn a simple procedure from a repeated successful action (bounded, reversible).
  function learnProcedure(name, steps, importance) {
    return remember("procedures", { kind: "procedure", name: name, steps: steps, confidence: 0.7 }, importance || 1);
  }

  // =====================================================================
  // 9. PERSONALITY (separate from intelligence; configurable)
  // =====================================================================
  var personality = {
    identity: "LocalHub Assistant",
    tone: "warm",
    style: "concise",
    values: ["offline-first", "private", "honest", "helpful", "safe"],
    openers: ["Sure", "Happy to help", "Got it"]
  };
  function setPersonality(p) { if (p) Object.assign(personality, p); }
  function getPersonality() { return JSON.parse(JSON.stringify(personality)); }

  // =====================================================================
  // 10. COGNITIVE LOOP - orchestrate a user input through the full cycle
  // =====================================================================
  // This is the entry point the Brain calls. It reuses Intent + Reasoning +
  // Mind, then routes verified actions through the tool layer.
  function process(input, opts) {
    opts = opts || {};
    // Conversational continuity: keep the previous focus in working memory.
    if (state.focus) setWorking("previousFocus", state.focus);
    setState("mode", "thinking"); setState("focus", input);
    emit("ASSISTANT_TASK_STARTED", { input: input }, { importance: 1 });

    var text = String(input || "").trim();
    if (!text) return Promise.resolve({ ok: true, message: "What would you like me to do?" });

    // Track capability usage for the (non-sensitive) personal model.
    noteCapabilityUse("assistant:" + (String(input).slice(0, 40)));

    // Self-healing intents: "why did X crash/fail" and "fix it".
    var shChat = selfHealChat(text, opts.role);
    if (shChat) {
      return Promise.resolve(shChat).then(function (res) { setState("mode", "idle"); return res; });
    }

    // CONTEXTUALIZE + UNDERSTAND: hand to the existing intent pipeline.
    var intent = global.LH_AI.Intent && global.LH_AI.Intent.process
      ? global.LH_AI.Intent.process(text)
      : (global.LH_AI.Mind ? global.LH_AI.Mind.process(text) : fallback(text));

    return Promise.resolve(intent).then(function (res) {
      // Store the current exchange in working memory for continuity.
      setWorking("lastInput", text);
      setWorking("lastResponse", (res && res.message) || "");
      // REMEMBER: store this as a recent command / episode signal.
      if (opts.remember !== false) {
        var m = Mem();
        if (m && m.put) m.put("chats", { role: "assistant", text: (res && res.message) || "", _sr: opts.role || "user" }).catch(function () {});
      }
      // If the response carries an imperative action, run it through the
      // decision + action executor instead of blindly trusting it.
      if (res && res.action) {
        var role = opts.role || "user";
        var parts = String(res.action).split("?")[0].replace("/api/", "");
        var toolId = "server." + parts.replace(/\//g, ".");
        var runTool = tools[toolId] || tools["server.action"];
        if (runTool) {
          return executeAction("server.action", { action: res.action.replace("/api/", ""), label: res.message }, role, false)
            .then(function (ar) {
              var out = { ok: true, message: ar.ok ? (ar.message || res.message) : (ar.error || res.message), action: ar.ok ? res.action : null };
              // Mark as consumed so the Brain doesn't run it a second time.
              if (ar.ok) out.consumedByCognitive = true;
              reflect(ar, res.message);
              setState("mode", "idle");
              return out;
            });
        }
      }
      setState("mode", "idle");
      return res;
    });
  }

  function fallback(text) {
    return Promise.resolve({ ok: true, message: "I'm the LocalHub OS assistant. I can help manage files, media, server, and more. Try 'help'." });
  }

  // =====================================================================
  // 11. PROACTIVE BEHAVIOUR (cooldown + dedup, driven by Guardian)
  // =====================================================================
  var lastNotified = {};
  function notify(importance, message, key) {
    // Suppress duplicates within a cooldown window per key.
    var now = Date.now();
    if (key && lastNotified[key] && (now - lastNotified[key]) < 120000) return;
    if (key) lastNotified[key] = now;
    if (global.LH_AI.Chat && global.LH_AI.Chat.addError) global.LH_AI.Chat.addError(message);
  }

  // =====================================================================
  // 11b. SELF-MODEL / SELF-AWARENESS (what it can/cannot do)
  // =====================================================================
  function selfModel() {
    var toolsCount = Object.keys(tools).length;
    var guardianOn = !!(global.LH_AI.Guardian && global.LH_AI.Guardian.isRunning && global.LH_AI.Guardian.isRunning());
    return {
      canDo: "LocalHub management (files, media, server, devices), reasoning, knowledge, math, TTS, Guardian monitoring, " + toolsCount + " tools.",
      cannotDo: "Browse the live internet, feel emotions, execute arbitrary system changes without permission, access data outside LocalHub.",
      toolsAvailable: listTools().length,
      serverOnline: true,
      guardianActive: guardianOn,
      offline: true,
      memoryEnabled: !!(Mem() && Mem().get)
    };
  }

  // =====================================================================
  // 12. ADMIN COGNITIVE DEBUG VIEW DATA
  // =====================================================================
  function debugView() {
    var recentMemoriesP = recall("episodes", "", 5);
    return Promise.resolve(recentMemoriesP).then(function (mem) {
      return {
        state: snapshotState(true),
        tools: listTools(),
        personality: personality,
        selfModel: selfModel(),
        recentMemory: mem
      };
    });
  }

  function restoreState(saved) {
    if (saved && typeof saved === "object") {
      ["mode","goal","task","focus","confidence","riskLevel","lastActionResult","lastVerify","recoveryAttempts"].forEach(function(k){
        if (saved[k] !== undefined) state[k]=saved[k];
      });
      persistState();
      return Promise.resolve({ ok: true, message: "Cognitive state restored." });
    }
    return Promise.resolve({ ok: false, message: "No state to restore." });
  }

  // =====================================================================
  // EXPORT
  // =====================================================================
  // =====================================================================
  // GOALS (persistent, separated intent->goal->task->subtask->plan)
  // =====================================================================
  var GOAL_KEY = "active_goal";
  var activeGoal = null; // {id, label, state, plan[], stepIndex, createdAt, updatedAt}

  function setGoal(label, plan) {
    activeGoal = {
      id: "goal_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      label: label, state: "active",
      plan: plan || [], stepIndex: -1,
      createdAt: Date.now(), updatedAt: Date.now()
    };
    setState("goal", label); setState("plan", plan || []); setState("stepIndex", -1);
    persistGoal();
    return activeGoal;
  }
  function getGoal() { return activeGoal; }
  function updateGoalState(s) { if (activeGoal) { activeGoal.state = s; activeGoal.updatedAt = Date.now(); persistGoal(); } }
  function completeGoal() { if (activeGoal) { updateGoalState("completed"); activeGoal = null; setState("goal", null); setState("plan", null); } }
  function cancelGoal() { if (activeGoal) { updateGoalState("cancelled"); activeGoal = null; setState("goal", null); setState("plan", null); } }
  function persistGoal() {
    var m = Mem();
    if (m && m.put && activeGoal) m.put(GOAL_KEY, activeGoal).catch(function () {});
  }
  function loadGoal() {
    var m = Mem();
    if (!m || !m.get) return Promise.resolve();
    return m.get(GOAL_KEY, GOAL_KEY).then(function (g) {
      if (g && g.state === "active") { activeGoal = g; setState("goal", g.label); setState("plan", g.plan || []); }
    }).catch(function () {});
  }
  function continueGoal() {
    // Resume an unfinished goal.
    if (!activeGoal) return Promise.resolve({ ok: true, message: "No active goal to continue." });
    var plan = activeGoal.plan || [];
    if (activeGoal.stepIndex + 1 >= plan.length) return Promise.resolve({ ok: true, message: "Goal '" + activeGoal.label + "' is already complete." });
    activeGoal.stepIndex += 1;
    var step = plan[activeGoal.stepIndex];
    setState("task", step); setState("stepIndex", activeGoal.stepIndex);
    persistGoal();
    emit("ASSISTANT_TASK_STARTED", { goal: activeGoal.label, step: step }, { importance: 1 });
    return Promise.resolve({ ok: true, message: "Continuing goal '" + activeGoal.label + "': next step — " + step + "." });
  }

  // Dynamic planning (Phase 2 / C11): given a high-level goal label, generate a
  // step plan. Uses the local model provider's plan() when available; otherwise
  // a deterministic plan generator. This makes goal planning automatic rather
  // than requiring a user-supplied plan array.
  function planGoal(label) {
    var SH = global.LH_AI.SelfHeal;
    // Use a real local model's planner only when an actual model is attached.
    // When only the deterministic fallback exists, use the core's higher-quality
    // template planner instead of the (deliberately weak) model fallback.
    var modelPlanner = (SH && SH.modelProvider && SH.modelProvider.available && SH.modelProvider.plan)
      ? SH.modelProvider.plan : null;
    return Promise.resolve().then(function () {
      if (modelPlanner) {
        return Promise.resolve(modelPlanner({ label: label })).then(function (r) {
          if (r && r.ok && r.steps && r.steps.length) return r.steps;
          return deterministicPlan(label);
        }).catch(function () { return deterministicPlan(label); });
      }
      return deterministicPlan(label);
    }).then(function (steps) {
      var g = setGoal(label, steps);
      return { ok: true, goal: g, plan: steps, source: modelPlanner ? "local-model" : "deterministic" };
    });
  }

  // Deterministic plan generator: turns a high-level goal into ordered steps.
  function deterministicPlan(label) {
    var l = String(label || "").toLowerCase();
    if (/organize|organise|clean|tidy/.test(l)) {
      return ["Scan the target folder", "Group files by type/date", "Move files into subfolders", "Report what changed"];
    }
    if (/download|fetch|get/.test(l)) {
      return ["Confirm the source", "Fetch the item", "Save to the target folder", "Verify the file is intact"];
    }
    if (/diagnos|investigat|fix|repair|self.?heal/.test(l)) {
      return ["Collect evidence and logs", "Run root-cause analysis", "Propose a fix (await approval if risky)", "Apply + verify the fix", "Record a regression test"];
    }
    if (/backup/.test(l)) {
      return ["Choose what to back up", "Create a snapshot", "Verify the snapshot", "Report the backup location"];
    }
    if (/play|media|listen|watch/.test(l)) {
      return ["Locate the media", "Open it in the player", "Play and confirm playback"];
    }
    return ["Investigate '" + label + "'", "Gather evidence", "Execute the plan", "Verify the outcome"];
  }

  // =====================================================================
  // FAST PATH / DEEP PATH
  // =====================================================================
  // Simple commands use the deterministic intent path (fast). Complex/deep
  // goals (diagnostic / self-healing / multi-step) route to the deep path.
  function isDeepRequest(text) {
    var t = String(text || "").toLowerCase();
    return /(why|diagnos|investigate|root cause|keep fail|keeps fail|fix|repair|self[ -]?heal|incident|reproduce|patch|backup|scan for|analyze)/.test(t);
  }

  // =====================================================================
  // SELF-HEALING INTEGRATION
  // =====================================================================
  function selfHeal(detection) {
    if (global.LH_AI.SelfHeal && global.LH_AI.SelfHeal.handleDetection) {
      return global.LH_AI.SelfHeal.handleDetection(detection);
    }
    return Promise.resolve({ ok: true, message: "Self-healing engine not loaded." });
  }

  // =====================================================================
  // SELF-HEALING INTENTS (Phase 13) - the Brain understands incidents
  // =====================================================================
  // "Why did LocalHub crash?"  -> retrieve incident + evidence + RCA + status.
  // "Fix it."                  -> check risk + authorization, create a repair
  //                               plan (goal), execute the appropriate
  //                               SelfHeal level, verify, report.
  // Returns null when the message is not a self-healing intent (let the normal
  // intent pipeline handle it). Self-healing repair respects admin role.
  function selfHealChat(text, role) {
    var t = String(text || "").toLowerCase();
    var SH = global.LH_AI.SelfHeal;
    if (!SH) return null;

    // EXPLAIN: why did X crash/fail/error/down
    if (/(why|what happened|explain).*(crash|fail|error|down|stop|broken)/.test(t) ||
        /why did (it|localhub|the app|the server|the assistant)/.test(t)) {
      return SH.listIncidents().then(function (list) {
        var open = list.filter(function (i) { return i.state !== "resolved"; });
        var inc = open[open.length - 1] || list[list.length - 1];
        if (!inc) return { ok: true, message: "I have no recorded incidents to explain yet. Run 'diagnose' or 'scan for problems' to investigate." };
        var conf = (inc.rootCause && inc.rootCause.confidence != null) ? Math.round(inc.rootCause.confidence * 100) : 0;
        var D = SH.Debug;
        var mapping = D ? D.mapError(inc) : null;
        var patternP = D ? D.matchKnownPattern({ error: inc.error, component: inc.component, incidentId: inc.incidentId }) : Promise.resolve({ pattern: null });
        return Promise.resolve(patternP).then(function (pat) {
          return SH.explainRCA(inc).then(function (exp) {
            var lines = ["🧠 Here's what I found:\n", exp.text];
            if (mapping && mapping.mapped) {
              lines.push("\nAffected module: " + mapping.module + (mapping.file ? (" (" + mapping.file + ")") : "") +
                (mapping.callChain && mapping.callChain.length ? "\nCall chain: " + mapping.callChain.slice(0, 3).join(" → ") : ""));
            }
            lines.push("\nAffected component: " + inc.component);
            if (pat && pat.pattern) lines.push("Pattern: " + pat.pattern + (pat.similarity ? (" (similarity " + pat.similarity.toFixed(2) + ")") : ""));
            lines.push("Confidence: " + conf + "%");
            lines.push("Repair status: " + inc.state);
            lines.push("\nSay 'fix it' to have me prepare a safe repair (admin).");
            return { ok: true, message: lines.join("\n") };
          });
        });
      });
    }

    // FIX / REPAIR (specific to the self-healing context; does not capture
    // generic "fix the wifi" style requests)
    if (/(fix|repair|heal|resolve)\b.*(it|this|the (problem|issue|crash|error|bug|incident))/.test(t)) {
      role = role || "user";
      if (role !== "admin") {
        return Promise.resolve({ ok: true, message: "🔒 Repair actions require Administrator authorization. I can diagnose and prepare a plan, but I won't change any files without your approval." });
      }
      return SH.listIncidents().then(function (list) {
        var open = list.filter(function (i) { return i.state !== "resolved"; });
        var inc = open[open.length - 1] || list[list.length - 1];
        if (!inc) return { ok: true, message: "No open incident to fix. Run 'diagnose' first." };
        // Re-route through the engine at the appropriate level, then attempt a
        // real device deploy (build + install + verify). If the toolchain or a
        // device is unavailable, report that honestly (never claim success).
        return SH.handleDetection({ component: inc.component, error: inc.error, severity: inc.severity, frequency: Math.max(inc.frequency || 1, 3), autonomyLevel: inc.autonomyLevel })
          .then(function (r) {
            var level = (r.incident && r.incident.autonomyLevel != null) ? r.incident.autonomyLevel : 1;
            setGoal("Repair " + inc.component, ["Investigate evidence and RCA", "Apply safe repair at level " + level, "Build the repaired app", "Install + verify on device", "Run regression checks"]);
            setState("task", "Repair " + inc.component);
            // Attempt the device deploy lifecycle (build -> APK -> install -> verify).
            var D = SH.Device;
            if (!D) return { ok: true, message: (r.message || "Repair initiated.") + "\n\n🧭 Repair plan created: " + inc.component + " (level " + level + "). No device deploy adapter is loaded." };
            return D.runDeviceDeployPipeline({ projectRoot: (global.LH_AI.projectRoot) || "/home/user/LocalHub", authorizeInstall: true }).then(function (dp) {
              if (dp.ok && dp.status === "DEVICE_VERIFIED") {
                return { ok: true, message: "Fixed and verified. The failure was caused by " + ((inc.rootCause && inc.rootCause.causes && inc.rootCause.causes[0]) || inc.component) + ". I built the patched version, installed it, ran the required checks, and the device is healthy." };
              }
              return { ok: true, message: "I could not safely deploy the repair to the device yet (" + dp.status + "). The previous version stays intact. Repair plan: " + inc.component + " (level " + level + "). Connect a device and retry." };
            });
          });
      });
    }

    return null;
  }

  global.LH_AI.Cognitive = {
    // event bus
    on: on, off: off, emit: emit, perceive: perceive,
    // state
    setState: setState, getState: getState, snapshotState: snapshotState,
    observe: observe, recordError: recordError, persistState: persistState,
    loadState: loadState, resetState: resetState, restoreState: restoreState,
    // memory
    setWorking: setWorking, getWorking: getWorking, clearWorking: clearWorking,
    remember: remember, recall: recall, rank: rank, decay: decay, forget: forget,
    correctMemory: correctMemory, forgetAllMemory: forgetAllMemory,
    // personal model (non-sensitive preference learning)
    updatePreference: updatePreference, noteCapabilityUse: noteCapabilityUse,
    getPersonalModel: getPersonalModel,
    // tools
    registerTool: registerTool, getTool: getTool, listTools: listTools,
    // decision + action
    decide: decide, executeAction: executeAction, verifyAction: verifyAction,
    // reflection + learning
    reflect: reflect, learnProcedure: learnProcedure,
    // personality
    setPersonality: setPersonality, getPersonality: getPersonality,
    // loop
    process: process,
    // goals + dynamic planning
    setGoal: setGoal, getGoal: getGoal, updateGoalState: updateGoalState,
    completeGoal: completeGoal, cancelGoal: cancelGoal, continueGoal: continueGoal,
    loadGoal: loadGoal, planGoal: planGoal,
    // fast/deep
    isDeepRequest: isDeepRequest,
    // self-healing
    selfHeal: selfHeal, selfHealChat: selfHealChat,
    // proactive + self-model + debug
    notify: notify, selfModel: selfModel, debugView: debugView,
    // internals for tests
    _normalizeEvent: normalizeEvent,
    _init: function () {
      // Load persisted state + goal + personal model on boot; emit system-health
      // events to the bus.
      return loadState().then(function () {
        return loadGoal(); }).then(function () {
        return loadPersonalModel(); }).then(function () {
        emit("COGNITIVE_READY", { identity: state.identity }, { importance: 1 });
        return global.LH_AI.Cognitive;
      });
    }
  };
})(window);

/* =====================================================================
 * v2.20 — PERSONAL DIGITAL MIND (extend the SAME Cognitive Core)
 * =====================================================================
 * Deepens the existing Cognitive Core into a persistent personal brain.
 * It reuses the same Memory layer (working/episodic/semantic/procedural) with
 * dedicated stores, adds relationships, importance scoring, consolidation,
 * contradiction handling, a non-sensitive personal profile, current-life
 * context (with expiry), an attention system, focus, rich goal memory, habit
 * detection, predictive assistance, personalization, confidence, privacy
 * controls, continuity across restart, contextual references, an attention
 * loop, and proactive (non-spammy) assistance.
 *
 * HARD BOUNDS (no fake human behaviour):
 * - Local / private / offline-first / persistent / explainable / non-sentient.
 * - No cloud sync, no telemetry, no silent transmission.
 * - The local model only assists (summarize/extract); deterministic systems
 *   stay authoritative for permissions, memory deletion, security, actions,
 *   risk, SelfHeal, deployment.
 * - No fake consciousness/emotions/sentience; these are computational
 *   constructs (state, attention, memory, goals, preferences, confidence).
 */
(function (global) {
  "use strict";
  var Cog = global.LH_AI.Cognitive;
  if (!Cog) return;
  function Mem() { return global.LH_AI.Memory; }
  function now() { return Date.now(); }
  var DAY = 86400000;

  // stores (dedicated, avoid clashing with SelfHeal/legacy layers)
  var S_MEM = "personal_memories";
  var S_PROF = "personal_profile";
  var S_CTX = "personal_context";
  var S_GOALS = "personal_goals";
  var S_STATE = "personal_state";       // continuity snapshot
  var S_HABITS = "personal_habits";

  var enabled = true;
  var prefKey = "memory_enabled";
  function setMemoryEnabled(on, admin) {
    enabled = !!on;
    var m = Mem();
    if (m && m.put) m.put("settings", { id: prefKey, enabled: enabled });
    return { ok: true, enabled: enabled };
  }
  function memoryEnabled() {
    var m = Mem();
    if (!m || !m.get) return enabled;
    return m.get("settings", prefKey).then(function (s) { if (s) enabled = !!s.enabled; return enabled; });
  }

  // ---- memory entry factory ----
  function makeEntry(type, content, opts) {
    opts = opts || {};
    var imp = computeImportance(content, type, opts);
    var e = {
      id: "pm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      type: type,                       // episodic | semantic | procedural | preference
      content: String(content || ""),
      source: opts.source || "user",
      createdAt: now(), lastAccessed: now(),
      importance: imp, confidence: opts.confidence != null ? opts.confidence : 0.8,
      relevance: 0, tags: opts.tags || [], status: "active",
      expiresAt: opts.expiresAt || null,
      relationships: opts.relationships || [],   // [{relation, targetId, evidence}]
      category: opts.category || null,
      key: opts.key || null,
      value: opts.value
    };
    if (opts.expiresIn != null) e.expiresAt = now() + opts.expiresIn;
    return e;
  }

  // ---- importance scoring ----
  // explicit user statement > repetition > task relevance > future usefulness >
  // frequency > recency. Explicit phrases boost importance heavily.
  function computeImportance(content, type, opts) {
    opts = opts || {};
    var c = String(content || "").toLowerCase();
    var score = 1;
    if (/\b(always|never|always keep|always use|i (want|need|prefer)|remember|important|favorite|prefer)\b/.test(c)) score += 3;
    if (/\b(prefer|preference|usual|normally|typically|usually)\b/.test(c)) score += 2;
    if (type === "procedural") score += 1;
    if (type === "semantic") score += 1;
    score += (opts.importance || 0);
    if (opts.explicit === true) score += 2;
    return Math.min(10, score);
  }

  // ---- remember ----
  function remember(type, content, opts) {
    return memoryEnabled().then(function (on) {
      if (!on) return { ok: false, reason: "memory-disabled", entry: null };
      var e = makeEntry(type, content, opts);
      var m = Mem();
      if (!m || !m.put) return { ok: false, reason: "memory-unavailable", entry: e };
      // contradiction handling: if a preference for same (category,key) exists
      // with a DIFFERENT value, supersede it.
      if (e.category && e.key != null) {
        return m.getAll(S_MEM).then(function (all) {
          var prev = (all || []).find(function (x) {
            return x.type === e.type && x.category === e.category && x.key === e.key && x.id !== e.id && x.status === "active" && String(x.value) !== String(e.value);
          });
          if (prev) {
            prev.status = "superseded"; prev.supersededBy = e.id; prev.updatedAt = now();
            return m.put(S_MEM, prev).then(function () { return m.put(S_MEM, e).then(function () { return { ok: true, entry: e, superseded: prev.id }; }); });
          }
          return m.put(S_MEM, e).then(function () { return { ok: true, entry: e, superseded: null }; });
        });
      }
      return m.put(S_MEM, e).then(function () { return { ok: true, entry: e }; });
    });
  }

  // ---- recall (ranked, confidence-labelled) ----
  function confidenceLabel(conf) {
    if (conf >= 0.75) return "KNOWN";
    if (conf >= 0.5) return "LIKELY";
    return "UNCERTAIN";
  }
  function recall(query, opts) {
    opts = opts || {};
    return memoryEnabled().then(function (on) {
      if (!on) return [];
      var m = Mem();
      if (!m || !m.getAll) return [];
      return m.getAll(S_MEM).then(function (all) {
        var q = String(query || "").toLowerCase().split(/\s+/).filter(function (w) { return w.length > 2; });
        var nowt = now();
        var scored = (all || []).map(function (e) {
          if (e.status === "superseded" || e.status === "deleted") return null;
          if (e.expiresAt && nowt > e.expiresAt) { e.status = "expired"; return null; }
          var hay = (e.content + " " + (e.tags || []).join(" ") + " " + (e.category || "") + " " + (e.key || "")).toLowerCase();
          var relevance = 0;
          q.forEach(function (w) { if (hay.indexOf(w) >= 0) relevance += 2; });
          var ageDays = (nowt - (e.createdAt || nowt)) / DAY;
          var recency = Math.max(0, 1 - ageDays / 30);
          var score = relevance + (e.importance || 1) * 0.6 + recency * 0.4 + (e.confidence || 0) * 0.3;
          e.relevance = relevance;
          return { e: e, score: score };
        }).filter(Boolean);
        scored.sort(function (a, b) { return b.score - a.score; });
        return scored.slice(0, opts.limit || 8).map(function (s) {
          var e = s.e;
          return { id: e.id, type: e.type, content: e.content, source: e.source, importance: e.importance, confidence: e.confidence, confidenceLabel: confidenceLabel(e.confidence), relevance: e.relevance, tags: e.tags, createdAt: e.createdAt, lastAccessed: e.lastAccessed, category: e.category, key: e.key, relationships: e.relationships || [], status: e.status };
        });
      });
    });
  }

  // ---- direct get by id ----
  function get(id) {
    var m = Mem();
    if (!m || !m.getAll) return Promise.resolve(null);
    return m.getAll(S_MEM).then(function (all) { return (all || []).find(function (x) { return x.id === id; }) || null; });
  }

  // ---- relationships ----
  function link(aId, bId, relation, evidence) {
    var m = Mem();
    if (!m || !m.getAll || !m.put) return Promise.resolve({ ok: false });
    return m.getAll(S_MEM).then(function (all) {
      var a = (all || []).find(function (x) { return x.id === aId; });
      var b = (all || []).find(function (x) { return x.id === bId; });
      if (!a || !b) return { ok: false, reason: "memory-not-found" };
      var rels = a.relationships || [];
      if (!rels.some(function (r) { return r.targetId === bId && r.relation === relation; })) {
        rels.push({ relation: relation, targetId: bId, evidence: evidence || "user-explicit" });
        a.relationships = rels; a.updatedAt = now();
        return m.put(S_MEM, a).then(function () { return { ok: true }; });
      }
      return { ok: true };
    });
  }
  function getRelations(id) {
    return get(id).then(function (e) { return (e && e.relationships) || []; });
  }
  function related(id) {
    var m = Mem();
    if (!m || !m.getAll) return Promise.resolve([]);
    return m.getAll(S_MEM).then(function (all) {
      var me = (all || []).find(function (x) { return x.id === id; });
      if (!me) return [];
      var rels = me.relationships || [];
      var out = [];
      rels.forEach(function (r) {
        var target = (all || []).find(function (x) { return x.id === r.targetId; });
        if (target) out.push({ memory: target, relation: r.relation });
      });
      // inverse
      (all || []).forEach(function (x) {
        (x.relationships || []).forEach(function (r) { if (r.targetId === id) out.push({ memory: x, relation: r.relation, inverse: true }); });
      });
      return out;
    });
  }

  // ---- correct / forget ----
  function correct(id, updates) {
    var m = Mem();
    if (!m || !m.getAll || !m.put) return Promise.resolve({ ok: false });
    return m.getAll(S_MEM).then(function (all) {
      var e = (all || []).find(function (x) { return x.id === id; });
      if (!e) return { ok: false, reason: "not-found" };
      if (updates) Object.assign(e, updates, { updatedAt: now(), corrected: true });
      return m.put(S_MEM, e).then(function () { return { ok: true, entry: e }; });
    });
  }
  function forget(id) {
    var m = Mem();
    if (!m || !m.getAll || !m.put) return Promise.resolve({ ok: false });
    return m.getAll(S_MEM).then(function (all) {
      var e = (all || []).find(function (x) { return x.id === id; });
      if (!e) return { ok: false, reason: "not-found" };
      e.status = "deleted"; e.deletedAt = now();
      return m.put(S_MEM, e).then(function () { return { ok: true }; });
    });
  }
  function forgetAll() {
    var m = Mem();
    if (!m || !m.getAll || !m.put) return Promise.resolve({ ok: false });
    return m.getAll(S_MEM).then(function (all) {
      (all || []).forEach(function (e) { e.status = "deleted"; });
      return Promise.all((all || []).map(function (e) { return m.put(S_MEM, e); })).then(function () { return { ok: true }; });
    });
  }

  // ---- consolidation: episodes -> semantic/procedural on threshold ----
  function consolidate(opts) {
    opts = opts || {};
    var threshold = opts.threshold || 3;
    var m = Mem();
    if (!m || !m.getAll) return Promise.resolve({ ok: false, created: [] });
    return m.getAll(S_MEM).then(function (all) {
      var eps = (all || []).filter(function (x) { return x.type === "episodic" && x.status === "active"; });
      var buckets = {};
      eps.forEach(function (e) {
        var pat = (e.content || "").replace(/\b\w*?\d+\w*\b/g, "N").toLowerCase();
        (buckets[pat] = buckets[pat] || []).push(e);
      });
      var created = [];
      Object.keys(buckets).forEach(function (pat) {
        var group = buckets[pat];
        if (group.length >= threshold) {
          var conf = Math.min(0.9, 0.5 + group.length * 0.1);
          var sample = group[0].content;
          var type = /compress|share|backup|organiz|move|convert/i.test(sample) ? "procedural" : "semantic";
          var summary = type === "procedural"
            ? "User commonly " + sample.replace(/^(user )?/, "").replace(/\.$/, "").toLowerCase() + " (pattern observed " + group.length + " times)."
            : "Recurring: " + sample.slice(0, 120);
          var entry = makeEntry(type, summary, { source: "consolidation", confidence: conf, importance: Math.min(8, 2 + group.length) });
          m.put(S_MEM, entry);
          // mark episodes consolidated
          group.forEach(function (e) { e.status = "consolidated"; e.consolidatedInto = entry.id; m.put(S_MEM, e); });
          created.push(entry);
        }
      });
      return { ok: true, created: created };
    });
  }

  // ---- contradiction / supersede ----
  function supersede(oldId, newId, reason) {
    var m = Mem();
    if (!m || !m.getAll || !m.put) return Promise.resolve({ ok: false });
    return m.getAll(S_MEM).then(function (all) {
      var old = (all || []).find(function (x) { return x.id === oldId; });
      if (!old) return { ok: false, reason: "not-found" };
      old.status = "superseded"; old.supersededBy = newId; old.supersededReason = reason || "preference-updated";
      return m.put(S_MEM, old).then(function () { return { ok: true }; });
    });
  }

  // ---- personal profile (non-sensitive) ----
  var PROFILE_CATEGORIES = ["communication", "ui", "media", "workflow", "device", "automation", "capabilities"];
  function setProfile(category, key, value) {
    if (PROFILE_CATEGORIES.indexOf(category) < 0) return Promise.resolve({ ok: false, reason: "unknown-category" });
    return remember("preference", String(value), { category: category, key: key, value: value, source: "profile", explicit: true });
  }
  function getProfile() {
    var m = Mem();
    if (!m || !m.getAll) return Promise.resolve({});
    return m.getAll(S_MEM).then(function (all) {
      var out = {};
      PROFILE_CATEGORIES.forEach(function (c) { out[c] = {}; });
      (all || []).forEach(function (e) {
        if (e.type !== "preference" || e.status !== "active") return;
        if (e.category && out[e.category]) out[e.category][e.key] = { value: e.value, confidence: e.confidence, source: e.source, updatedAt: e.createdAt };
      });
      return out;
    });
  }
  function supersededPreferences() {
    var m = Mem();
    if (!m || !m.getAll) return Promise.resolve([]);
    return m.getAll(S_MEM).then(function (all) {
      return (all || []).filter(function (x) { return x.type === "preference" && x.status === "superseded"; }).map(function (x) { return { id: x.id, category: x.category, key: x.key, oldValue: x.value, supersededBy: x.supersededBy, reason: x.supersededReason }; });
    });
  }

  // ---- current-life context (with expiry) ----
  function updateContext(patch) {
    var m = Mem();
    if (!m || !m.put) return Promise.resolve({ ok: false });
    return m.get(S_CTX, S_CTX).then(function (c) {
      c = c || { id: S_CTX };
      Object.keys(patch || {}).forEach(function (k) { c[k] = { value: patch[k], ts: now() }; });
      c.updatedAt = now();
      return m.put(S_CTX, c).then(function () { return { ok: true, context: c }; });
    });
  }
  function getContext() {
    var m = Mem();
    if (!m || !m.get) return Promise.resolve({});
    return m.get(S_CTX, S_CTX).then(function (c) { return c || {}; });
  }
  // expire stale context entries (default 2h)
  function expireContext(maxAgeMs) {
    maxAgeMs = maxAgeMs || 2 * 3600 * 1000;
    var m = Mem();
    if (!m || !m.get || !m.put) return Promise.resolve({ ok: false });
    return m.get(S_CTX, S_CTX).then(function (c) {
      if (!c) return { ok: true, removed: 0 };
      var removed = 0;
      Object.keys(c).forEach(function (k) {
        if (k === "updatedAt") return;
        if (c[k] && c[k].ts && (now() - c[k].ts) > maxAgeMs) { delete c[k]; removed++; }
      });
      return m.put(S_CTX, c).then(function () { return { ok: true, removed: removed }; });
    });
  }

  // ---- attention ----
  var ATTENTION = { LOW: "LOW", NORMAL: "NORMAL", IMPORTANT: "IMPORTANT", URGENT: "URGENT" };
  function classifyAttention(event) {
    var s = String(event && (event.type || event.data && event.data && event) || "").toLowerCase() + " " + String(event && event.error || "").toLowerCase();
    var full = String(event && event.type || "") + " " + String(event && (event.data && event.data.message || "") || "");
    full = full.toLowerCase().replace(/[_-]/g, " ");
    if (/(storage|battery|disk)\s*(critically|low|full)|urgent|critical|out of space|no space/i.test(full)) return ATTENTION.URGENT;
    if (/\b(failed|fails|fail|error|exception|crash)\b/.test(full) && /(backup|repeat|repeated|server|auth|database)/i.test(full)) return ATTENTION.IMPORTANT;
    if (/(goal\s*(completed|progress)|device\s*(connected|disconnected)|security|warn|repeated)/i.test(full)) return ATTENTION.IMPORTANT;
    if (/(file|opened|media|list|listed)/i.test(full)) return ATTENTION.LOW;
    if (/(started|finished|completed|normal|opened)/i.test(full)) return ATTENTION.NORMAL;
    return ATTENTION.NORMAL;
  }

  // ---- focus ----
  var focus = null;
  function setFocus(f) { focus = f; return focus; }
  function getFocus() { return focus; }

  // ---- attention loop ----
  // EVENT -> IMPORTANCE -> FOCUS -> RELEVANCE -> DECISION (IGNORE/REMEMBER/ACT/NOTIFY)
  function attentionLoop(event) {
    var att = classifyAttention(event);
    var decision = "IGNORE";
    if (att === ATTENTION.URGENT) decision = "NOTIFY";
    else if (att === ATTENTION.IMPORTANT) decision = "REMEMBER";
    else if (att === ATTENTION.NORMAL) decision = "REMEMBER";
    else decision = "IGNORE";
    // focus relevance: if event type matches focus, elevate decision
    var focusTag = focus && focus.toLowerCase();
    var evType = String(event && event.type || "").toLowerCase();
    if (focusTag && focusTag.split(/\s+/).some(function (w) { return w.length > 3 && evType.indexOf(w) >= 0; })) {
      if (att === ATTENTION.LOW) decision = "REMEMBER";
    }
    return { attention: att, decision: decision, focus: focus };
  }

  // ---- goals (rich) ----
  var GOAL_KEY = "active_personal_goal";
  function setGoal(label, opts) {
    opts = opts || {};
    var goal = {
      id: GOAL_KEY,
      goalId: "pgoal_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      label: label, priority: opts.priority || "normal", status: "IN_PROGRESS",
      progress: opts.progress != null ? opts.progress : 0,
      tasks: opts.tasks || [], blockedReason: null, lastAction: null, nextAction: opts.nextAction || null,
      createdAt: now(), updatedAt: now()
    };
    var m = Mem();
    if (m && m.put) m.put(GOAL_KEY, goal);
    return goal;
  }
  function getGoal() {
    var m = Mem();
    if (!m || !m.get) return Promise.resolve(null);
    return m.get(GOAL_KEY, GOAL_KEY).then(function (g) { return g || null; });
  }
  function updateGoal(patch) {
    var m = Mem();
    if (!m || !m.get || !m.put) return Promise.resolve(null);
    return m.get(GOAL_KEY, GOAL_KEY).then(function (g) {
      if (!g) return null;
      Object.assign(g, patch || {}, { updatedAt: now() });
      return m.put(GOAL_KEY, g).then(function () { return g; });
    });
  }
  function completeGoal() { return updateGoal({ status: "COMPLETED", progress: 100 }); }
  function cancelGoal(reason) { return updateGoal({ status: "CANCELLED", blockedReason: reason || "user-cancelled" }); }
  function listGoals() {
    var m = Mem();
    if (!m || !m.getAll) return Promise.resolve([]);
    return m.getAll("personal_goals_history").then(function (a) { return a || []; }).catch(function () { return []; });
  }

  // ---- habit detection ----
  // Track (action + context) occurrence; a habit requires >=3 repeats within a
  // window with reasonable confidence. One-off events never become habits.
  var HABIT_WINDOW = 14 * DAY;
  function recordEvent(action, context) {
    var key = String(action || "").toLowerCase() + "::" + String(context || "").toLowerCase();
    var m = Mem();
    if (!m || !m.getAll || !m.put) return Promise.resolve({ habit: false });
    return m.getAll(S_HABITS).then(function (all) {
      var h = (all || []).find(function (x) { return x.key === key; });
      if (!h) {
        h = { key: key, action: action, context: context || null, times: [], count: 0, createdAt: now() };
      }
      h.times.push(now());
      // keep only recent window
      h.times = h.times.filter(function (t) { return (now() - t) < HABIT_WINDOW; });
      h.count = h.times.length;
      h.updatedAt = now();
      return m.put(S_HABITS, h).then(function () {
        var habit = h.count >= 3;
        return { habit: habit, count: h.count, key: key, confidence: Math.min(0.9, 0.4 + h.count * 0.15) };
      });
    });
  }
  function detectHabits() {
    var m = Mem();
    if (!m || !m.getAll) return Promise.resolve([]);
    return m.getAll(S_HABITS).then(function (all) {
      return (all || []).filter(function (h) { return (h.count || 0) >= 3; }).map(function (h) { return { action: h.action, context: h.context, count: h.count, confidence: Math.min(0.9, 0.4 + h.count * 0.15) }; });
    });
  }

  // ---- predictive assistance (high confidence only) ----
  // pattern: after (action A in context C), user next usually does B.
  var transitions = {};
  function learnTransition(fromAction, nextAction, context) {
    var key = String(fromAction || "").toLowerCase() + "@" + String(context || "").toLowerCase();
    var st = transitions[key] || { from: fromAction, next: {}, context: context };
    st.next[nextAction] = (st.next[nextAction] || 0) + 1;
    transitions[key] = st;
    return st;
  }
  function predictNext(fromAction, context) {
    var key = String(fromAction || "").toLowerCase() + "@" + String(context || "").toLowerCase();
    var st = transitions[key];
    if (!st) return { suggest: false };
    var total = 0, best = null, bestN = 0;
    Object.keys(st.next).forEach(function (k) { total += st.next[k]; if (st.next[k] > bestN) { bestN = st.next[k]; best = k; } });
    var conf = total ? bestN / total : 0;
    if (conf >= 0.7 && bestN >= 2) return { suggest: true, action: best, confidence: conf, message: "You usually do this next. Want me to prepare it?" };
    return { suggest: false };
  }

  // ---- personalization ----
  function personalize(text, opts) {
    opts = opts || {};
    // adapt length/style from established communication preference (non-fake)
    var m = Mem();
    var style = (m && m.get) ? null : "default";
    // read from profile (communication/response)
    return getProfile().then(function (prof) {
      var comm = (prof.communication && prof.communication.style) || {};
      var styleVal = comm.value || "default";
      var t = String(text || "");
      if (styleVal === "short" && t.length > 160) t = t.slice(0, 150) + "…";
      if (styleVal === "detailed") t = t; // keep as-is
      return { text: t, style: styleVal };
    });
  }

  // ---- privacy ----
  function exportMemory() {
    var m = Mem();
    if (!m || !m.getAll) return Promise.resolve({ ok: false });
    return m.getAll(S_MEM).then(function (all) {
      return { ok: true, count: (all || []).length, data: (all || []).filter(function (x) { return x.status === "active" || x.status === "superseded"; }) };
    });
  }
  function clearMemory() { return forgetAll(); }

  // ---- continuity (restart persistence) ----
  function saveContinuity() {
    var m = Mem();
    if (!m || !m.put) return Promise.resolve({ ok: false });
    var snap = { id: S_STATE, focus: focus, savedAt: now() };
    return getGoal().then(function (goal) {
      snap.goal = goal;
      return m.put(S_STATE, snap).then(function () { return { ok: true, snapshot: snap }; });
    });
  }
  function restoreContinuity() {
    var m = Mem();
    if (!m || !m.get) return Promise.resolve({ ok: false });
    return m.get(S_STATE, S_STATE).then(function (snap) {
      if (!snap) return { ok: false };
      if (snap.focus) focus = snap.focus;
      return { ok: true, snapshot: snap };
    });
  }

  // ---- self model (from actual internal state) ----
  function selfModel() {
    return getContext().then(function (ctx) {
      return getGoal().then(function (goal) {
        return {
          state: "active",
          goal: goal ? { label: goal.label, status: goal.status, progress: goal.progress } : null,
          focus: focus,
          memoryEnabled: enabled,
          hasProfile: true,
          capabilities: ["files", "media", "automation", "reasoning", "personalization", "assistant"],
          limitation: "offline, local, non-sentient; no cloud, no live internet"
        };
      });
    });
  }

  // ---- contextual reference resolution ----
  function resolveReference(term, opts) {
    opts = opts || {};
    var t = String(term || "").toLowerCase();
    var m = Mem();
    var recent = opts.recentActions || [];
    if (/(that|it|this|same one|the previous one)/.test(t)) {
      var last = recent[recent.length - 1];
      return Promise.resolve({ resolved: true, target: last, source: "recent-action", ambiguous: false });
    }
    if (/again|do the same|same thing/.test(t)) {
      // retrieve most recent episodic/procedural memory
      return recall("", { limit: 1 }).then(function (r) {
        if (!r.length) return { resolved: false, ambiguous: true, source: "none" };
        return { resolved: true, target: r[0], source: "memory", ambiguous: false };
      });
    }
    if (/yesterday/.test(t)) {
      return recall("", { limit: 20 }).then(function (r) {
        var y = r.filter(function (x) { return (now() - (x.createdAt || 0)) < 2 * DAY; });
        if (!y.length) return { resolved: false, ambiguous: true, source: "none" };
        return { resolved: true, target: y[0], source: "episodic", ambiguous: false };
      });
    }
    return Promise.resolve({ resolved: false, ambiguous: true, source: "unresolved" });
  }

  // ---- proactive personal assistance ----
  var lastProactive = {};
  function proactiveSuggestion(opts) {
    opts = opts || {};
    var nowt = now();
    // cooldown per key
    function cooled(key, ms) { if (lastProactive[key] && (nowt - lastProactive[key]) < (ms || 30 * 60 * 1000)) return true; lastProactive[key] = nowt; return false; }
    return detectHabits().then(function (habits) {
      var out = [];
      if (habits.length) {
        var top = habits[habits.length - 1];
        if (top.confidence >= 0.6 && !cooled("habit:" + top.action)) {
          out.push({ type: "routine", message: "You perform this sequence frequently (" + top.count + "x). Would you like me to make it a routine?", confidence: top.confidence });
        }
      }
      return { ok: true, suggestions: out, quietHours: opts.quietHours };
    });
  }

  // ---- local model assistance (optional, deterministic fallback) ----
  function summarizeWithModel(text) {
    var sh = global.LH_AI.SelfHeal;
    if (sh && sh.modelProvider && sh.modelProvider.available && sh.modelProvider.summarize) {
      return Promise.resolve(sh.modelProvider.summarize(text)).then(function (r) { return r && r.text ? r.text : text; });
    }
    // deterministic fallback: first sentence summary
    return Promise.resolve(String(text || "").split(/[.!?]/)[0]);
  }

  // ---- export ----
  global.LH_AI.Cognitive.PersonalBrain = {
    ATTENTION: ATTENTION,
    remember: remember, recall: recall, get: get,
    link: link, getRelations: getRelations, related: related,
    correct: correct, forget: forget, forgetAll: forgetAll,
    consolidate: consolidate, supersede: supersede,
    setProfile: setProfile, getProfile: getProfile, supersededPreferences: supersededPreferences, PROFILE_CATEGORIES: PROFILE_CATEGORIES,
    updateContext: updateContext, getContext: getContext, expireContext: expireContext,
    classifyAttention: classifyAttention, attentionLoop: attentionLoop,
    setFocus: setFocus, getFocus: getFocus,
    setGoal: setGoal, getGoal: getGoal, updateGoal: updateGoal, completeGoal: completeGoal, cancelGoal: cancelGoal, listGoals: listGoals,
    recordEvent: recordEvent, detectHabits: detectHabits,
    learnTransition: learnTransition, predictNext: predictNext,
    personalize: personalize,
    confidenceLabel: confidenceLabel,
    setMemoryEnabled: setMemoryEnabled, memoryEnabled: memoryEnabled, exportMemory: exportMemory, clearMemory: clearMemory,
    saveContinuity: saveContinuity, restoreContinuity: restoreContinuity,
    selfModel: selfModel,
    resolveReference: resolveReference,
    proactiveSuggestion: proactiveSuggestion,
    summarizeWithModel: summarizeWithModel
  };
})(window);

/* =====================================================================
 * v2.21 — CONTEXT-AWARE PROACTIVE INTELLIGENCE + ROUTINE ENGINE
 * =====================================================================
 * Extends the SAME Cognitive.PersonalBrain (no PersonalBrain2, no new engine).
 * Self-Healing remains FROZEN. Adds:
 *   - Routine discovery (a HABIT is observed; a ROUTINE is an APPROVED workflow)
 *   - A structured routine model with states CANDIDATE/SUGGESTED/APPROVED/ACTIVE/
 *     PAUSED/DISABLED/EXPIRED
 *   - Sequence detection (frequency/ordering/context confidence; never from one
 *     occurrence)
 *   - Contextual routines (trigger + context + permission + risk + cooldown)
 *   - Explicit approval before ANY automation (no silent execution)
 *   - Safe execution with verification, bounded retry, cooldown, failure handling
 *   - Routine learning from results + user feedback
 *   - Proactive decision layer (IGNORE/REMEMBER/SUGGEST/NOTIFY/PREPARE/ACT)
 *   - Suggestion memory with dedup + rejected-suggestion suppression (not spam)
 *   - Conflict detection, priority, prediction explanation, local-model assist.
 * Every proactive action must have evidence. No fabricated habits/patterns/
 * confidence/routines/relationships.
 */
(function (global) {
  "use strict";
  var Cog = global.LH_AI.Cognitive;
  var PB = Cog && Cog.PersonalBrain;
  if (!Cog || !PB) return;
  function Mem() { return global.LH_AI.Memory; }
  function now() { return Date.now(); }
  var DAY = 86400000;

  var S_ROUTINES = "personal_routines";
  var S_SEQS = "personal_sequences";
  var S_HIST = "routine_history";
  var S_SUGG = "suggestion_memory";

  // ---- risk classification ----
  var RISK = { SAFE: "SAFE", LOW_RISK: "LOW_RISK", HIGH_RISK: "HIGH_RISK", CRITICAL: "CRITICAL" };
  function classifyAction(action) {
    var a = String(action || "").toLowerCase();
    if (/delete|remove|purge|wipe|destroy|erase|unlink/.test(a)) return RISK.CRITICAL;
    if (/move|rename|write|overwrite|replace|convert|compress|unzip/.test(a)) return RISK.HIGH_RISK;
    if (/start|stop|restart|server|deploy|install|backup|transfer|sync/.test(a)) return RISK.LOW_RISK;
    return RISK.SAFE;   // open, list, scan, check, prepare, view
  }
  function riskIsSafe(r) { return r === RISK.SAFE || r === RISK.LOW_RISK; }

  // ---- sequence observations ----
  function seqKey(steps, context) { return (steps || []).join("->") + "@" + String(context || "").toLowerCase(); }
  function observeSequence(steps, context) {
    var m = Mem();
    if (!m || !m.getAll || !m.put) return Promise.resolve({ count: 0 });
    var key = seqKey(steps, context);
    return m.getAll(S_SEQS).then(function (all) {
      var rec = (all || []).find(function (x) { return x.key === key; });
      if (!rec) { rec = { key: key, steps: (steps || []).slice(), context: context || null, times: [], count: 0, createdAt: now() }; }
      rec.times.push(now());
      rec.times = rec.times.filter(function (t) { return (now() - t) < 30 * DAY; });
      rec.count = rec.times.length;
      rec.updatedAt = now();
      return m.put(S_SEQS, rec).then(function () {
        return { count: rec.count, key: key };
      });
    });
  }

  // ---- routine candidates (confidence-gated) ----
  function detectRoutineCandidates(opts) {
    opts = opts || {};
    var threshold = opts.threshold || 3;
    var m = Mem();
    if (!m || !m.getAll) return Promise.resolve([]);
    return m.getAll(S_SEQS).then(function (all) {
      var out = [];
      (all || []).forEach(function (rec) {
        if ((rec.count || 0) >= threshold) {
          out.push({
            id: "rc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
            steps: rec.steps.slice(), context: rec.context || null,
            confidence: Math.min(0.92, 0.5 + rec.count * 0.1),
            frequency: rec.count, timesObserved: rec.count,
            orderingConsistency: Math.min(1, 0.6 + rec.count * 0.05),
            type: "ROUTINE_CANDIDATE"
          });
        }
      });
      return out;
    });
  }

  // ---- routine model + CRUD ----
  function newRoutine(def) {
    var steps = (def.steps || []).map(function (s) { return typeof s === "string" ? { action: s, risk: classifyAction(s) } : s; });
    return {
      id: "routine_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      name: def.name || "Routine",
      description: def.description || "",
      steps: steps,
      triggerConditions: def.triggerConditions || [],
      contextConditions: def.contextConditions || {},
      confidence: def.confidence != null ? def.confidence : 0.6,
      frequency: def.frequency || 0, lastObserved: def.lastObserved || null, timesObserved: def.timesObserved || 0,
      status: def.status || "CANDIDATE",
      approvalState: def.approvalState || "PENDING",
      lastRun: null, cooldownMs: def.cooldownMs != null ? def.cooldownMs : 30 * 60 * 1000, maxRuns: def.maxRuns != null ? def.maxRuns : 20, dailyLimit: def.dailyLimit != null ? def.dailyLimit : 10,
      failureCount: 0, successCount: 0,
      createdAt: now(), updatedAt: now()
    };
  }
  function persist(r) { var m = Mem(); if (!m || !m.put) return Promise.resolve(r); return m.put(S_ROUTINES, r).then(function () { return r; }); }
  function getRoutine(id) { var m = Mem(); if (!m || !m.getAll) return Promise.resolve(null); return m.getAll(S_ROUTINES).then(function (all) { return (all || []).find(function (x) { return x.id === id; }) || null; }); }
  function listRoutines(opts) {
    opts = opts || {};
    var m = Mem();
    if (!m || !m.getAll) return Promise.resolve([]);
    return m.getAll(S_ROUTINES).then(function (all) { return (all || []).filter(function (x) { return !opts.status || x.status === opts.status; }); });
  }
  function createRoutine(def) { var r = newRoutine(def); return persist(r).then(function () { return { ok: true, routine: r }; }); }

  function updateRoutine(id, patch) {
    return getRoutine(id).then(function (r) {
      if (!r) return { ok: false, reason: "not-found" };
      Object.assign(r, patch || {}, { updatedAt: now() });
      return persist(r).then(function () { return { ok: true, routine: r }; });
    });
  }
  function approveRoutine(id, admin) {
    if (!admin) return Promise.resolve({ ok: false, reason: "APPROVAL_ADMIN_REQUIRED" });
    return updateRoutine(id, { status: "ACTIVE", approvalState: "APPROVED" });
  }
  function rejectRoutine(id, feedback) {
    return updateRoutine(id, { status: "DISABLED", approvalState: "REJECTED" }).then(function (res) {
      if (res.ok) {
        // record rejection in suggestion memory so we stop suggesting it
        PB.recordSuggestionResponse && PB.recordSuggestionResponse(id, "rejected", feedback || "user-rejected");
      }
      return res;
    });
  }
  function pauseRoutine(id) { return updateRoutine(id, { status: "PAUSED" }); }
  function resumeRoutine(id) { return updateRoutine(id, { status: "ACTIVE" }); }
  function disableRoutine(id) { return updateRoutine(id, { status: "DISABLED" }); }
  function enableRoutine(id) { return updateRoutine(id, { status: "ACTIVE" }); }
  function editRoutine(id, patch) {
    // normalize steps if provided
    if (patch && Array.isArray(patch.steps)) patch.steps = patch.steps.map(function (s) { return typeof s === "string" ? { action: s, risk: classifyAction(s) } : s; });
    return updateRoutine(id, patch);
  }

  // ---- conflict detection ----
  function detectConflict(a, b) {
    if (!a || !b || a.id === b.id) return { conflict: false };
    var sameTrigger = JSON.stringify(a.triggerConditions || []) === JSON.stringify(b.triggerConditions || []);
    if (!sameTrigger) return { conflict: false };
    // opposite intent on the same target => conflict
    function intent(r) { return String((r.steps || []).map(function (s) { return s.action; }).join(" ")).toLowerCase(); }
    var ai = intent(a), bi = intent(b);
    if ((/open/.test(ai) && /close/.test(bi)) || (/close/.test(ai) && /open/.test(bi))) {
      return { conflict: true, type: "OPPOSING_INTENT", a: a.id, b: b.id, message: "Routines conflict (one opens, one closes the same target) — do not execute both blindly." };
    }
    return { conflict: false };
  }

  // ---- cooldown ----
  function checkCooldown(routine) {
    if (!routine) return { blocked: false };
    if (routine.status !== "ACTIVE") return { blocked: true, reason: "NOT_ACTIVE" };
    if (routine.lastRun && (now() - routine.lastRun) < (routine.cooldownMs || 0)) return { blocked: true, reason: "COOLDOWN" };
    if ((routine.successCount || 0) >= (routine.maxRuns || 20)) return { blocked: true, reason: "MAX_RUNS" };
    return { blocked: false };
  }

  // ---- contextual evaluation ----
  function evaluateRoutine(routine, context) {
    context = context || {};
    if (!routine) return { match: false, reason: "no-routine" };
    if (routine.status !== "ACTIVE") return { match: false, reason: "not-active" };
    var cc = routine.contextConditions || {};
    // time window
    if (cc.timeWindow) {
      var h = new Date().getHours();
      if (h < cc.timeWindow[0] || h >= cc.timeWindow[1]) return { match: false, reason: "outside-time-window" };
    }
    // space / device / goal
    if (cc.space && String(context.space || "").toLowerCase() !== String(cc.space).toLowerCase()) return { match: false, reason: "space-mismatch" };
    if (cc.device && String(context.device || "").toLowerCase() !== String(cc.device).toLowerCase()) return { match: false, reason: "device-mismatch" };
    if (cc.goal && String(context.goal || "").toLowerCase() !== String(cc.goal).toLowerCase()) return { match: false, reason: "goal-mismatch" };
    // trigger conditions: any trigger may fire it (OR)
    var triggers = routine.triggerConditions || [];
    if (triggers.length && context.event) {
      var ev = String(context.event || "").toLowerCase();
      if (!triggers.some(function (t) { return ev.indexOf(String(t).toLowerCase()) >= 0; })) return { match: false, reason: "trigger-not-met" };
    }
    return { match: true };
  }

  // ---- permissions + risk gate ----
  function canExecute(routine, context, opts) {
    opts = opts || {};
    var cd = checkCooldown(routine);
    if (cd.blocked) return { allowed: false, reason: cd.reason };
    var ev = evaluateRoutine(routine, context);
    if (!ev.match) return { allowed: false, reason: "context-mismatch" };
    // risk gate: HIGH_RISK / CRITICAL steps require explicit approval at execution
    var risky = (routine.steps || []).some(function (s) { return !riskIsSafe(s.risk || classifyAction(s.action)); });
    if (risky && !opts.approved) return { allowed: false, reason: "HIGH_RISK_REQUIRES_APPROVAL" };
    return { allowed: true };
  }

  // ---- execute ----
  function executeRoutine(id, context, opts) {
    opts = opts || {};
    return getRoutine(id).then(function (r) {
      if (!r) return { ok: false, reason: "not-found" };
      var gate = canExecute(r, context, opts);
      if (!gate.allowed) return { ok: false, reason: gate.reason, routine: r };
      // execute steps with bounded retry
      var results = [];
      var idx = 0;
      var stepRunner = opts.stepRunner || PB.executeStep || function (action) { return Promise.resolve({ ok: true }); };
      function runStep() {
        if (idx >= r.steps.length) return Promise.resolve(true);
        var step = r.steps[idx];
        var attempts = 0;
        function attempt() {
          attempts++;
          return Promise.resolve().then(function () { return stepRunner(step.action, r, context); }).then(function (res) {
            results.push({ action: step.action, ok: !!(res && res.ok !== false), attempts: attempts });
            if (res && res.ok === false && attempts < (opts.maxRetries || 2)) return attempt();
            idx++;
            return runStep();
          });
        }
        return attempt();
      }
      var t0 = now();
      return runStep().then(function () {
        var allOk = results.every(function (x) { return x.ok; });
        var dur = now() - t0;
        r.lastRun = now();
        if (allOk) { r.successCount = (r.successCount || 0) + 1; }
        else { r.failureCount = (r.failureCount || 0) + 1; }
        // confidence learning: success raises a little, failure lowers
        var confDelta = allOk ? 0.02 : -0.05;
        r.confidence = Math.max(0, Math.min(0.98, (r.confidence || 0.5) + confDelta));
        r.updatedAt = now();
        // pause on repeated failure
        if (r.failureCount >= (opts.pauseAfter || 3)) r.status = "PAUSED";
        return persist(r).then(function () {
          var hist = { routineId: r.id, name: r.name, context: context || {}, steps: results, durationMs: dur, success: allOk, ts: now() };
          var m = Mem();
          if (m && m.put) m.put(S_HIST, hist);
          return { ok: allOk, routine: r, results: results, durationMs: dur, paused: r.status === "PAUSED" };
        });
      });
    });
  }

  // ---- routine history + feedback ----
  function routineHistory() { var m = Mem(); if (!m || !m.getAll) return Promise.resolve([]); return m.getAll(S_HIST).then(function (a) { return (a || []); }); }
  function routineFeedback(id, outcome) {
    // user feedback adjusts confidence
    return getRoutine(id).then(function (r) {
      if (!r) return { ok: false };
      r.confidence = Math.max(0, Math.min(0.98, (r.confidence || 0.5) + (outcome === "positive" ? 0.03 : outcome === "negative" ? -0.06 : 0)));
      return persist(r).then(function () { return { ok: true, routine: r }; });
    });
  }

  // ---- suggestion memory (dedup / rejection suppression) ----
  function recordSuggestionResponse(key, response, feedback) {
    var m = Mem();
    if (!m || !m.put) return Promise.resolve();
    return m.put(S_SUGG, { id: "sug_" + String(key) + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6), key: String(key), type: "ROUTINE", reason: feedback || "", context: "", timestamp: now(), userResponse: response, accepted: response === "accepted", rejected: response === "rejected", ignored: response === "ignored" });
  }
  function suggestionStatus(key) {
    var m = Mem();
    if (!m || !m.getAll) return Promise.resolve({ suppressed: false, rejected: 0, accepted: 0 });
    return m.getAll(S_SUGG).then(function (all) {
      var recs = (all || []).filter(function (x) { return x.key === String(key); });
      var rejected = recs.filter(function (x) { return x.rejected; }).length;
      var accepted = recs.filter(function (x) { return x.accepted; }).length;
      var suppressed = rejected >= 3 || accepted >= 1;
      return { suppressed: suppressed, rejected: rejected, accepted: accepted, total: recs.length };
    });
  }

  // =====================================================================
  // PROACTIVE DECISION ENGINE
  // =====================================================================
  function decide(event, context, opts) {
    opts = opts || {};
    var att = (event && event.attention) || PB.classifyAttention(event || {});
    var focus = PB.getFocus && PB.getFocus();
    // PREPARE for high-confidence, safe prediction
    var pred = (opts.prediction) || { suggest: false };
    var decision = "IGNORE";
    if (att === PB.ATTENTION.URGENT) decision = "NOTIFY";
    else if (att === PB.ATTENTION.IMPORTANT) decision = "REMEMBER";
    else if (att === PB.ATTENTION.NORMAL) decision = "REMEMBER";
    else if (pred.suggest) decision = "PREPARE";
    return { decision: decision, attention: att, focus: focus };
  }

  // Suggest proactive help (context-aware, non-spam)
  function suggestNow(context, opts) {
    opts = opts || {};
    context = context || {};
    var out = [];
    return listRoutines({ status: "CANDIDATE" }).then(function (candidates) {
      // routine suggestions for candidates not yet acted on
      var chain = Promise.resolve();
      candidates.forEach(function (r) {
        chain = chain.then(function () {
          return suggestionStatus(r.id).then(function (st) {
            if (st.suppressed) return;
            if (r.confidence >= (opts.minConfidence || 0.6)) {
              out.push({ suggestionId: r.id, type: "ROUTINE", confidence: r.confidence, reason: "I noticed you perform '" + r.name + "' " + (r.timesObserved || 0) + " times in this context.", message: "Want me to make it a routine?", steps: r.steps.map(function (s) { return s.action; }) });
            }
          });
        });
      });
      return chain.then(function () { return out; });
    });
  }

  // Prioritize suggestions by importance/confidence/urgency/focus/recency
  function prioritize(items) {
    return (items || []).slice().sort(function (a, b) { return (b.confidence || 0) - (a.confidence || 0); });
  }

  // Explain a suggestion (evidence summary, not chain-of-thought)
  function explain(suggestion) {
    if (!suggestion) return Promise.resolve({ ok: false, message: "No suggestion to explain." });
    return Promise.resolve({ ok: true, message: "I suggested this because '" + (suggestion.reason || "a recurring pattern") + "' (confidence " + Math.round((suggestion.confidence || 0) * 100) + "%)." });
  }

  // Safe preparation (never high-risk)
  function prepare(action, opts) {
    opts = opts || {};
    var risk = classifyAction(action);
    if (!riskIsSafe(risk)) return Promise.resolve({ ok: false, reason: "PREPARE_REFUSED_HIGH_RISK", message: "Preparation is only allowed for safe/low-risk actions." });
    // mark context as "prepared" (no side effect performed)
    return PB.updateContext({ prepared: action }).then(function (r) {
      return { ok: true, prepared: action, message: "Prepared context for '" + action + "' (no action performed)." };
    });
  }

  // =====================================================================
  // EXPORT — attach to PersonalBrain (no new engine)
  // =====================================================================
  PB.RISK = RISK;
  PB.classifyAction = classifyAction;
  PB.observeSequence = observeSequence;
  PB.detectRoutineCandidates = detectRoutineCandidates;
  PB.createRoutine = createRoutine;
  PB.getRoutine = getRoutine;
  PB.listRoutines = listRoutines;
  PB.approveRoutine = approveRoutine;
  PB.rejectRoutine = rejectRoutine;
  PB.pauseRoutine = pauseRoutine;
  PB.resumeRoutine = resumeRoutine;
  PB.disableRoutine = disableRoutine;
  PB.enableRoutine = enableRoutine;
  PB.editRoutine = editRoutine;
  PB.detectConflict = detectConflict;
  PB.checkCooldown = checkCooldown;
  PB.evaluateRoutine = evaluateRoutine;
  PB.canExecute = canExecute;
  PB.executeRoutine = executeRoutine;
  PB.routineHistory = routineHistory;
  PB.routineFeedback = routineFeedback;
  PB.recordSuggestionResponse = recordSuggestionResponse;
  PB.suggestionStatus = suggestionStatus;
  PB.proactiveDecide = decide;
  PB.suggestNow = suggestNow;
  PB.prioritize = prioritize;
  PB.explainSuggestion = explain;
  PB.prepare = prepare;
})(window);

/* =====================================================================
 * v2.22 — BRAIN INTEGRATION (one coherent system) + FREEZE
 * =====================================================================
 * Integrates the existing PersonalBrain subsystems (memory, context,
 * attention, focus, goals, habits, routines, prediction, proactive) into a
 * single continuous Brain flow, and exposes it to real LocalHub events,
 * the Assistant, and a self-model UI. This is an INTEGRATION LAYER over the
 * existing Cognitive.PersonalBrain — NO new engine, NO PersonalBrain2, NO
 * duplicate subsystems.
 *
 *   USER -> LOCALHUB EVENT -> PERCEPTION -> CONTEXT UPDATE -> MEMORY ->
 *   ATTENTION -> GOAL/ROUTINE/HABIT -> DECISION -> SUGGEST/PREPARE/ACT ->
 *   EXPERIENCE -> RESULT -> VERIFICATION -> MEMORY UPDATE
 *
 * After this release the Personal Brain architecture is FROZEN.
 */
(function (global) {
  "use strict";
  var Cog = global.LH_AI.Cognitive;
  if (!Cog) return;
  var PB = Cog.PersonalBrain;
  function Mem() { return global.LH_AI.Memory; }
  function now() { return Date.now(); }

  // ---- context timeline (bounded, important events only) ----
  var S_TIMELINE = "brain_timeline";
  var MAX_TIMELINE = 50;
  function recordBrainEvent(type, detail) {
    var m = Mem();
    var ev = { ts: now(), type: type, detail: String(detail || "").slice(0, 200) };
    if (!m || !m.put) return ev;
    return m.put(S_TIMELINE, ev).then(function () {
      return m.getAll(S_TIMELINE).then(function (all) {
        var sorted = (all || []).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
        if (sorted.length > MAX_TIMELINE) {
          sorted.slice(MAX_TIMELINE).forEach(function (x) { if (m.remove) m.remove(S_TIMELINE, x.id); });
        }
        return ev;
      });
    });
  }
  function getBrainTimeline(limit) {
    var m = Mem();
    if (!m || !m.getAll) return Promise.resolve([]);
    return m.getAll(S_TIMELINE).then(function (all) {
      return (all || []).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).slice(0, limit || 20);
    });
  }

  // ---- REAL EVENT PERCEPTION ----
  // Every event passes IMPORTANCE + RELEVANCE + FOCUS before becoming memory or
  // proactive input. Not every event is stored permanently.
  function perceiveEvent(type, data, opts) {
    opts = opts || {};
    var event = { type: type, data: data || {} };
    var attention = PB.classifyAttention(event);
    // update current context from real state (device/space/page/media/goal)
    var ctxPatch = {};
    if (opts.space) ctxPatch.space = opts.space;
    if (opts.device) ctxPatch.device = opts.device;
    if (opts.page) ctxPatch.page = opts.page;
    if (opts.media) ctxPatch.media = opts.media;
    if (opts.goal) ctxPatch.goal = opts.goal;
    if (opts.task) ctxPatch.task = opts.task;
    var focus = PB.getFocus && PB.getFocus();
    var focusRelevant = focus && (String(type).toLowerCase().indexOf(focus.toLowerCase()) >= 0);

    var chain = (Object.keys(ctxPatch).length ? PB.updateContext(ctxPatch) : Promise.resolve({ ok: true }));
    return chain.then(function () {
      var decision = PB.proactiveDecide(event, {}, { prediction: opts.prediction }).decision;
      // only IMPORTANT/URGENT (or focus-relevant) events become memory candidates
      var shouldRemember = attention === PB.ATTENTION.IMPORTANT || attention === PB.ATTENTION.URGENT || focusRelevant;
      var remembered = false;
      if (shouldRemember && opts.remember !== false) {
        var detail = opts.detail || (data && (data.message || data.error)) || type;
        remembered = true;
        return PB.remember("episodic", String(type) + ": " + String(detail).slice(0, 120), { source: "event", importance: attention === PB.ATTENTION.URGENT ? 6 : attention === PB.ATTENTION.IMPORTANT ? 4 : 2, tags: ["event", String(type).toLowerCase()] }).then(function () {
          recordBrainEvent(type, detail);
          return { type: type, attention: attention, decision: decision, remembered: remembered, focusRelevant: focusRelevant, context: ctxPatch };
        });
      }
      recordBrainEvent(type, opts.detail || type);
      return { type: type, attention: attention, decision: decision, remembered: remembered, focusRelevant: focusRelevant, context: ctxPatch };
    });
  }

  // ---- BRAIN-ENRICHED ASSISTANT RESPONSE (uses real Brain state) ----
  // INPUT -> INTENT -> CURRENT CONTEXT -> RELEVANT MEMORY -> PERSONAL MODEL ->
  // GOAL -> ROUTINE -> REASONING -> ACTION/RESPONSE -> RESULT -> MEMORY
  function brainRespond(input, opts) {
    opts = opts || {};
    var text = String(input || "");
    // 1. update context from real state
    var ctxPatch = {};
    if (opts.space) ctxPatch.space = opts.space;
    if (opts.device) ctxPatch.device = opts.device;
    if (opts.page) ctxPatch.page = opts.page;
    if (opts.media) ctxPatch.media = opts.media;
    var ctxP = Object.keys(ctxPatch).length ? PB.updateContext(ctxPatch) : Promise.resolve({ ok: true });
    return ctxP.then(function () {
      // 2. resolve contextual references (that/it/again/yesterday/the previous one)
      var refP = /(that|it|there|same one|again|yesterday|the previous one|same thing|where we stopped)/i.test(text)
        ? PB.resolveReference(text, { recentActions: opts.recentActions || [] }).catch(function () { return { resolved: false }; })
        : Promise.resolve({ resolved: false });
      return refP.then(function (ref) {
        // media "continue/resume" resolves to the current media in context
        if (/continue|resume|keep (playing|watching)/i.test(text)) {
          return PB.getContext().then(function (ctx) {
            var med = (ctx && ctx.media && ctx.media.value) || ctxPatch.media || null;
            if (med) ref = { resolved: true, target: { content: med }, source: "media-context" };
            return ref;
          });
        }
        return ref;
      }).then(function (ref) {
        // 3. recall relevant memory
        var recallP = PB.recall(text, { limit: 4 }).catch(function () { return []; });
        return recallP.then(function (memories) {
          // 4. active goal + approved routine
          var goalP = PB.getGoal().catch(function () { return null; });
          return goalP.then(function (goal) {
            var routinesP = PB.listRoutines({ status: "ACTIVE" }).catch(function () { return []; });
            return routinesP.then(function (routines) {
              // 5. run the actual assistant pipeline for the response/action
              return Cog.process(text, { role: opts.role || "user" }).then(function (res) {
                var mention = "";
                if (memories.length) mention = "\n\n🧠 (I recall: " + memories.slice(0, 2).map(function (m) { return m.content; }).join(" · ") + ")";
                var out = { ok: res && res.ok !== false, message: (res && res.message || "") + mention, context: ctxPatch, relevantMemories: memories, activeGoal: goal, activeRoutines: routines.length, resolvedReference: ref.resolved ? ref : null, action: res && res.action };
                recordBrainEvent("assistant", text.slice(0, 80));
                return out;
              });
            });
          });
        });
      });
    });
  }

  // ---- GOAL -> ROUTINE -> ACTION -> VERIFICATION -> RESULT -> GOAL PROGRESS ----
  function goalRoutineAction(goalLabel, routineId, context, opts) {
    opts = opts || {};
    var routineP = routineId ? PB.getRoutine(routineId) : PB.listRoutines({ status: "ACTIVE" }).then(function (rs) { return rs[0] || null; });
    return routineP.then(function (routine) {
      if (!routine) return { ok: false, reason: "no-routine" };
      // ensure the goal is recorded
      var goalP = PB.getGoal().then(function (g) { if (!g && goalLabel) { var ng = PB.setGoal(goalLabel, { tasks: [] }); return ng; } return g; });
      return goalP.then(function (goal) {
        return PB.executeRoutine(routine.id, context, { approved: opts.approved === true, stepRunner: opts.stepRunner }).then(function (res) {
          // update goal progress on success
          if (res.ok && goal) {
            var prog = Math.min(100, (goal.progress || 0) + opts.progressDelta || 0);
            return PB.updateGoal({ progress: prog, lastAction: routine.name, status: prog >= 100 ? "COMPLETED" : "IN_PROGRESS" }).then(function (g) {
              recordBrainEvent("routine", routine.name + " executed (goal " + (goal.label || "") + " progress " + prog + "%)");
              return { ok: true, routine: routine, goal: g || goal, progress: prog, result: res };
            });
          }
          recordBrainEvent("routine", routine.name + " failed: " + (res.reason || "unknown"));
          return { ok: false, routine: routine, goal: goal, reason: res.reason || "failed" };
        });
      });
    });
  }

  // ---- BRAIN SELF-MODEL for Admin/Assistant diagnostic view ----
  function brainState() {
    var focus = PB.getFocus && PB.getFocus();
    return PB.getGoal().then(function (goal) {
      return PB.getContext().then(function (ctx) {
        return Promise.all([PB.listRoutines({ status: "ACTIVE" }), PB.detectHabits()]).then(function (both) {
          var routines = both[0], habits = both[1];
          return {
            currentFocus: focus,
            currentGoal: goal ? { label: goal.label, status: goal.status, progress: goal.progress, nextAction: goal.nextAction } : null,
            context: ctx,
            attention: "active",
            activeRoutines: routines.map(function (r) { return { name: r.name, status: r.status, confidence: r.confidence }; }),
            habits: habits.map(function (h) { return { action: h.action, count: h.count, confidence: h.confidence }; }),
            capabilities: ["files", "media", "automation", "reasoning", "memory", "routines", "proactive", "assistant"],
            memoryEnabled: true,
            confidence: "evidence-based",
            permissions: "deterministic / approval-gated",
            limitation: "offline, local, non-sentient; evidence summaries only (no chain-of-thought)"
          };
        });
      });
    });
  }

  // ---- contextual reference integration for the Assistant ----
  function resolveAssistantReference(text, opts) {
    opts = opts || {};
    return PB.resolveReference(text, { recentActions: opts.recentActions || [] });
  }

  // ---- graceful degradation: if Brain unavailable, core still works ----
  function brainAvailable() { return !!(PB && PB.remember); }

  // ---- export (integration layer on the SAME Cognitive object) ----
  Cog.recordBrainEvent = recordBrainEvent;
  Cog.getBrainTimeline = getBrainTimeline;
  Cog.perceiveEvent = perceiveEvent;
  Cog.brainRespond = brainRespond;
  Cog.goalRoutineAction = goalRoutineAction;
  Cog.brainState = brainState;
  Cog.resolveAssistantReference = resolveAssistantReference;
  Cog.brainAvailable = brainAvailable;
})(window);
