/* brain.js - the orchestrator: boot, wiring, tabs, intent dispatch, automation loop. */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  var Assistant = global.LH_AI.Assistant;
  var Planner = global.LH_AI.Planner;
  var Reasoning = global.LH_AI.Reasoning;
  var Automation = global.LH_AI.Automation;
  var Tasks = global.LH_AI.Tasks;
  var Memory = global.LH_AI.Memory;
  var Voice = global.LH_AI.Voice;
  var PluginBridge = global.LH_AI.PluginBridge;
  var Chat = global.LH_AI.Chat;
  var FS = global.LH_AI.FS;
  var Knowledge = global.LH_AI.Knowledge;
  var Context = global.LH_AI.Context;
  var Intent = global.LH_AI.Intent;
  var Capabilities = global.LH_AI.Capabilities;
  var TaskPlanner = global.LH_AI.TaskPlanner;

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  }); }
  function fmtBytes(b) {
    b = b || 0;
    var u = ["B", "KB", "MB", "GB", "TB"], i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return b.toFixed(1) + " " + u[i];
  }
  function kv(k, v) { return '<div class="kv"><span>' + esc(k) + "</span><b>" + esc(v) + "</b></div>"; }

  var Brain = {
    ready: false,

    boot: function () {
      if (this._bootPromise) return this._bootPromise;
      var self = this;
      this._bootPromise = Promise.resolve().then(function () {
        return Memory && Memory.open ? Memory.open() : null;
      }).then(function (db) {
        if (db && db.close) db.close();
        self._bootReady();
      }).catch(function (error) {
        self.ready = false;
        var input = el("chat-input"), send = el("chat-send");
        if (input) input.disabled = true;
        if (send) send.disabled = true;
        Chat.addError("Local history is not ready: " + (error.message || "storage unavailable") + " Reload after resolving this issue.");
      });
      return this._bootPromise;
    },

    _bootReady: function () {
      this.wireTabs();
      this.wireChat();
      this.wireVoice();
      this.wireAutomation();
      this.wireSettings();
      this.wirePlugins();
      this.renderDashboard();
      this.refreshAllPanels();
      // Resolve the current web session role so the assistant is role-aware.
      // loadHistory() MUST run only AFTER the role is resolved, otherwise the
      // role filter in chat.js would use the wrong role and leak/omit history.
      this.resolveRole(Brain.loadChatHistory);
      if (Context && Context.load) Context.load().then(function () { Brain.refreshDiagnostics(); });
      setInterval(function () { Brain.automationTick(); }, 60000);
      // Initialise the Cognitive Core (loads persisted internal state, emits
      // COGNITIVE_READY on the event bus). Safe no-op if not present.
      if (global.LH_AI.Cognitive && global.LH_AI.Cognitive._init) {
        global.LH_AI.Cognitive._init();
      }
      // Start the Background Guardian (proactive monitoring) if enabled.
      if (global.LH_AI.Guardian) {
        global.LH_AI.Guardian.getEnabled().then(function (enabled) {
          if (enabled === false) return; // user disabled it
          global.LH_AI.Guardian.start();
        });
      }
      // Central animation wiring for the assistant surface.
      if (global.LH_AI && global.LH_AI.Anim) {
        document.querySelectorAll("button, .chip, .suggest").forEach(function (el2) { el2.classList.add("lh-ripple"); });
        global.LH_AI.Anim.attachRipples();
        global.LH_AI.Anim.revealAll();
      }
    },

    wireTabs: function () {
      var tabs = document.querySelectorAll(".ai-tab");
      tabs.forEach(function (t) {
        t.addEventListener("click", function () {
          tabs.forEach(function (x) { x.classList.remove("active"); });
          t.classList.add("active");
          var panels = document.querySelectorAll(".ai-panel");
          panels.forEach(function (p) { p.style.display = "none"; });
          var target = el(t.getAttribute("data-target"));
          if (target) { target.style.display = "block"; target.classList.add("lh-fade-in"); }
          Brain.refreshPanel(t.getAttribute("data-target"));
        });
      });
    },

    refreshAllPanels: function () {
      this.renderMemory();
      this.renderTasks();
      this.renderKnowledge();
      this.renderAutomation();
      this.renderPlugins();
      this.renderLogs();
    },

    refreshPanel: function (name) {
      if (name === "memory") this.renderMemory();
      if (name === "tasks") this.renderTasks();
      if (name === "knowledge") this.renderKnowledge();
      if (name === "automation") this.renderAutomation();
      if (name === "plugins") this.renderPlugins();
      if (name === "logs") this.renderLogs();
      if (name === "dashboard") this.renderDashboard();
      if (name === "diag-panel") this.refreshDiagnostics();
    },

    // Fetch the current session role from the server so the assistant is
    // role-aware (admin-only commands blocked for standard users).
    resolveRole: function (onDone) {
      var token = null;
      try {
        var q = new URLSearchParams(location.search);
        token = q.get("token") || sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken");
      } catch (e) {}
      var base = global.LH_AI.baseUrl || (location.protocol + "//" + location.host);
      var url = base + "/api/auth/session" + (token ? "?token=" + encodeURIComponent(token) : "");
      fetch(url).then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (res) {
          var role = (res && res.authenticated && res.role) || "user";
          if (global.LH_AI.Commands && global.LH_AI.Commands.setRole) global.LH_AI.Commands.setRole(role);
          Brain.renderQuickChips();
          if (onDone) onDone();
        })
        .catch(function () {
          // If session fails, still default to user (deny admin) and load user-only history.
          if (global.LH_AI.Commands && global.LH_AI.Commands.setRole) global.LH_AI.Commands.setRole("user");
          Brain.renderQuickChips();
          if (onDone) onDone();
        });
    },

    loadChatHistory: function () {
      Chat.loadHistory().then(function (hist) {
        hist.forEach(function (m) { Chat.addMessage(m.role, m.text); });
        Brain.ready = true;
        var h = new Date().getHours();
        var greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
        Chat.addMessage("assistant", greet + "! LocalHub assistant ready. I work offline with local commands and reference answers. Try 'server status' or ask about a file. Server changes need confirmation; some older workflows are still under review.");
      });
    },

    // ---------------- Chat ----------------
    wireChat: function () {
      var input = el("chat-input");
      var send = el("chat-send");
      var self = this;
      function handle() {
        var text = input.value.trim();
        if (!text) return;
        input.value = "";
        self.hideSuggest();
        Brain.handleUserMessage(text);
      }
      send.addEventListener("click", handle);
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") handle();
        else if (e.key === "ArrowDown") self.focusSuggestion(1);
        else if (e.key === "ArrowUp") self.focusSuggestion(-1);
        else if (e.key === "Tab") { e.preventDefault(); self.acceptSuggestion(); }
      });
      input.addEventListener("input", function () { self.renderSuggest(input.value); });
      el("chat-clear").addEventListener("click", function () {
        if (confirm("Clear chat history?")) { Chat.clear(); el("chat-log").innerHTML = ""; }
      });
      this.renderQuickChips();
    },

    // ---- command suggestions / autocomplete ----
    renderQuickChips: function () {
      var box = el("quick-chips");
      if (!box) return;
      var role = (global.LH_AI.Commands && global.LH_AI.Commands.getRole()) || "user";
      // Role-aware quick actions: standard users never see admin-only controls,
      // so there is no surface for them to probe admin features from the UI.
      var items = (role === "admin")
        ? ["check localhub health", "explain system integration", "server status", "play newest modified video in downloads", "show logs", "restart server"]
        : ["check localhub health", "explain system integration", "open file manager", "play newest modified video in downloads", "server status"];
      box.innerHTML = "";
      items.forEach(function (s, i) {
        var c = document.createElement("button");
        c.className = "chip lh-chip-in";
        c.style.animationDelay = (i * 40) + "ms";
        c.textContent = s;
        c.onclick = function () { Brain.handleUserMessage(s); };
        box.appendChild(c);
      });
    },

    renderSuggest: function (val) {
      var box = el("suggest-box");
      if (!box) return;
      if (!global.LH_AI.Commands) return;
      var list = global.LH_AI.Commands.suggestions(val);
      if (!list.length) { this.hideSuggest(); return; }
      box.innerHTML = "";
      var self = this;
      list.forEach(function (s) {
        var d = document.createElement("div");
        d.className = "suggest lh-row-in";
        d.textContent = s;
        d.onclick = function () { var inp = el("chat-input"); if (inp) inp.value = s; self.hideSuggest(); if (inp) inp.focus(); };
        box.appendChild(d);
      });
      box.style.display = "block";
    },
    hideSuggest: function () {
      var box = el("suggest-box");
      if (box) box.style.display = "none";
    },
    focusSuggestion: function (dir) {
      var box = el("suggest-box");
      if (!box || box.style.display !== "block") return;
      var items = box.querySelectorAll(".suggest");
      var idx = -1;
      for (var i = 0; i < items.length; i++) if (items[i].classList.contains("active")) idx = i;
      idx += dir;
      if (idx < 0) idx = items.length - 1;
      if (idx >= items.length) idx = 0;
      items.forEach(function (x) { x.classList.remove("active"); });
      items[idx].classList.add("active");
    },
    acceptSuggestion: function () {
      var box = el("suggest-box");
      if (!box || box.style.display !== "block") return;
      var items = box.querySelectorAll(".suggest");
      var act = box.querySelector(".suggest.active");
      if (!act && items.length) act = items[0];
      var inp = el("chat-input");
      if (act && inp) { inp.value = act.textContent; this.hideSuggest(); inp.focus(); }
    },

    // Speaks the assistant's reply with clean, natural phrasing. Strips markdown
    // artifacts, collapses whitespace, and avoids narrating long file dumps.
    speakReply: function (message) {
      if (!global.LH_AI.Voice) return;
      // Respect the voice on/off switch — when off, never auto-speak.
      if (global.LH_AI.Voice.isEnabled && !global.LH_AI.Voice.isEnabled()) return;
      // Use the Communication engine's speech sanitizer for clean, readable speech.
      var t = global.LH_AI.Comm && global.LH_AI.Comm.forSpeech
        ? global.LH_AI.Comm.forSpeech(message)
        : String(message == null ? "" : message);
      if (!t) return;
      if (t.length > 600) t = t.slice(0, 600) + ".";
      // Central speak path: cancels any current speech first (no overlap), then
      // uses server System TTS when available, else browser speech.
      if (global.LH_AI.Voice.speakNow) {
        global.LH_AI.Voice.speakNow(t, "en-US");
      } else if (global.LH_AI.Voice.speakServer) {
        global.LH_AI.Voice.speakServer(t, "en-US");
      } else {
        global.LH_AI.Voice.speak(t, "en-US");
      }
    },

    // Records LocalHub-state memory (recent commands) — no personal AI memory.
    recordCommand: function (text) {
      Memory.getAll("memories").then(function (all) {
        var recent = all.filter(function (m) { return m.type === "recent_command"; });
        recent = recent.slice(0, 20);
        var already = recent.find(function (m) { return m.text === text; });
        if (already) { Memory.remove("memories", already.id); }
        Memory.put("memories", { text: text, type: "recent_command" });
      });
    },

    handleUserMessage: function (text) {
      Chat.addMessage("user", text);
      Chat.save({ role: "user", text: text });
      this.recordCommand(text);
      if (Context && Context.recordCommand) Context.recordCommand(text);
      // Show a brief thinking indicator while the intent pipeline resolves.
      var removeThink = (Chat.thinking) ? Chat.thinking() : function () {};
      // Route through the COGNITIVE CORE when available (full loop: perceive ->
      // understand -> contextualize -> remember -> reason -> decide -> act ->
      // verify -> reflect). Falls back to the classic Intent pipeline otherwise.
      var role = (global.LH_AI.Commands && global.LH_AI.Commands.getRole) ? global.LH_AI.Commands.getRole() : "user";
      var self = this;
      var pipeline = Promise.resolve().then(function () {
        if (global.LH_AI.AssistantRuntime) return global.LH_AI.AssistantRuntime.process(text, { role: role });
        if (global.LH_AI.Cognitive && global.LH_AI.Cognitive.process) return global.LH_AI.Cognitive.process(text, { role: role });
        if (Intent && Intent.process) return Intent.process(text);
        return self.legacyRun(text);
      });
      Promise.resolve(pipeline).then(function (res) {
        removeThink();
        if (!res || typeof res.message !== "string") throw new Error("Assistant response was incomplete.");
        // Polish the reply into natural, human communication (grammar + tone).
        // deepen() (the "Great question — let me explain" template) is ONLY used
        // when the user EXPLICITLY asked for an explanation. Normal conversation,
        // greetings and status replies stay natural and are never essay-wrapped.
        var finalMsg = res.message;
        if ((!res.execution || res.execution.status === "LEGACY_UNVERIFIED") && global.LH_AI.Comm && global.LH_AI.Comm.polish) {
          var wantExplain = /(explain|define|what is|what are|what's|what does .* mean|meaning of|how does .* work|how does it work|tell me about|what is a|what is the|difference between|why does|how to|in detail|explain in|teach me|describe|what do you mean|elaborate)/i.test(text);
          finalMsg = global.LH_AI.Comm.polish(res.message, { closer: true, explain: wantExplain });
        }
        var out = (Chat.addTyped) ? Chat.addTyped("assistant", finalMsg, {noType: !!(res.execution && res.execution.intent === "SYSTEM_INTEGRATION")}) : Chat.addMessage("assistant", finalMsg);
        Chat.save({ role: "assistant", text: finalMsg });
        // If speech output is enabled, let the assistant speak its reply aloud.
        if (Brain.ttsAuto && global.LH_AI.Voice && global.LH_AI.Voice.supportedOutput()) {
          Brain.speakReply(finalMsg);
        }
        // Execute an imperative action (server control, logs, config) only if
        // the cognitive layer did not already consume it.
        if (res && res.action && !res.consumedByCognitive) {
          Brain.runAction(res.action, res.message);
        }
        // If the assistant decided to open the File Manager (folders / previews),
        // navigate there so the user gets the full UI instead of raw output.
        if (res && res.openFM) {
          Brain.updateContextFromUrl(res.openFM);
          setTimeout(function () { window.location.href = res.openFM; }, 600);
        } else if (res && res.path) {
          Brain.updateContextFromUrl("/files?path=" + encodeURIComponent(res.path));
        }
        Brain.refreshDiagnostics();
      }).catch(function (e) {
        removeThink();
        Chat.addError(e.message || String(e));
      });
    },

    // Legacy path used if Intent pipeline isn't loaded (defensive).
    legacyRun: function (text) {
      var parsed = Assistant.parse(text);
      return Assistant.run(parsed.intent, text, parsed).then(function (res) {
        if (res && res.openFM) Brain.updateContextFromUrl(res.openFM);
        return res;
      });
    },

    // Track navigation in the Context Engine so "go back"/"open it" work.
    updateContextFromUrl: function (url) {
      if (!Context) return;
      if (url.indexOf("/files?path=") === 0) {
        var p = url.replace("/files?path=", "");
        try { p = decodeURIComponent(p); } catch (e) {}
        var cat = null;
        if (url.indexOf("&category=") >= 0) cat = url.split("&category=")[1].split("&")[0];
        Context.set("page", "files");
        Context.setFolder(p);
        if (cat) Context.set("lastCategory", cat);
      } else if (url.indexOf("/player?file=") === 0) {
        var f = url.replace("/player?file=", "");
        try { f = decodeURIComponent(f); } catch (e) {}
        Context.set("page", "player");
        Context.setMedia(f);
      } else if (url.indexOf("/") === 0) {
        Context.set("page", url.replace("/", "").split("?")[0] || "dashboard");
      }
    },

    // ---- dispatch imperative actions to the server API ----
    runAction: function (action, info) {
      // LocalHub OS client-side actions (space switching etc.) handled in-page.
      if (action && typeof action === "object" && action.type === "space") {
        if (global.LH_OS && global.LH_OS.Spaces) {
          global.LH_OS.Spaces.switchTo(action.id);
          Chat.addAction("Switched to the " + action.id + " Space.");
        }
        return;
      }
      var base = global.LH_AI.baseUrl || (location.protocol + "//" + location.host);
      var url = base + "/api/" + action;

      // Export/backup return downloadable payloads — open them as a download.
      if (action === "server/export-logs") { window.open(url, "_blank"); Chat.addAction("Requested log download; completion is not verified."); return; }
      if (action === "server/backup") { window.open(url, "_blank"); Chat.addAction("Requested configuration download; completion is not verified."); return; }

      var headers = { "Content-Type": "application/json" };
      try {
        var t = global.LH_AI.token || new URLSearchParams(location.search).get("token") || sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken");
        if (t) headers.Authorization = "Bearer " + t;
      } catch (e) {}
      return fetch(url, { method: "POST", headers: headers, body: "{}" })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (res) {
            if (!r.ok || res.ok !== true) {
              var message = r.status === 503 ? "Feature disabled or unavailable in the controller." :
                r.status === 401 || r.status === 403 ? "This action is not permitted for the current session." :
                res.error || "The server did not acknowledge the action.";
              Chat.addError(message);
              return { ok: false, message: message, execution: { status: "FAILED", verified: false } };
            }
            var message = "Request accepted by the server; completion has not been verified.";
            Chat.addAction(message);
            return { ok: true, message: message, execution: { status: "ACKNOWLEDGED", verified: false } };
          });
        }).catch(function () {
          var message = "No response received. The action may have reached the server; check its state before retrying.";
          Chat.addError(message);
          return { ok: false, message: message, execution: { status: "UNVERIFIED", verified: false } };
        });
    },

    openFolder: function (path, folders, files) {
      var box = el("chat-log");
      if (!box) return;
      var div = document.createElement("div");
      div.className = "msg assistant";
      div.innerHTML = '<div class="bubble">📁 ' + esc(path) + "</div>";
      var chips = document.createElement("div");
      chips.className = "chips";
      folders.forEach(function (f) {
        var c = document.createElement("button");
        c.className = "chip";
        c.textContent = f.name;
        c.onclick = function () { Brain.handleUserMessage("list the folder " + f.path); };
        chips.appendChild(c);
      });
      files.forEach(function (f) {
        var c = document.createElement("button");
        c.className = "chip";
        c.textContent = f.name;
        c.onclick = function () { Brain.readFile(f.path); };
        chips.appendChild(c);
      });
      div.appendChild(chips);
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
    },

    readFile: function (path) {
      // Never dump binary bytes into chat. Only text is shown inline; all
      // media/PDFs/archives/unknown files open in the File Manager viewer.
      var textExt = /\.(txt|md|log|json|xml|html|css|js|kt|java|py|sh|csv)$/i;
      if (!textExt.test(path)) {
        Chat.addMessage("assistant", "Opening the viewer for " + path + " (binary/media — not shown inline).");
        FS.openFileManager(path.substring(0, path.lastIndexOf("/")), path);
        return;
      }
      FS.read(path).then(function (r) {
        if (r.ok) {
          Chat.addMessage("assistant", "📄 " + path + ":\n" + (r.content || "(empty)"));
        } else {
          Chat.addError(r.error || "cannot read " + path);
        }
      }).catch(function (e) { Chat.addError(e.message || String(e)); });
    },

    // ---------------- Voice ----------------
    wireVoice: function () {
      var btn = el("voice-btn");
      var canvas = el("waveform");
      var stopWave = null;
      var rec = null;
      var listening = false;
      btn.addEventListener("click", function () {
        if (listening) { Voice.stop(rec); listening = false; btn.textContent = "🎤"; if (stopWave) stopWave(); return; }
        if (!Voice.supportedInput()) { Chat.addError("Voice input not supported in this browser."); return; }
        listening = true;
        btn.textContent = "🛑";
        canvas.style.display = "block";
        stopWave = Voice.drawWaveform(canvas);
        rec = Voice.listen("en-US", function (t) {
          el("chat-input").value = t;
          listening = false;
          btn.textContent = "🎤";
          canvas.style.display = "none";
          if (stopWave) stopWave();
        }, function () {
          listening = false;
          btn.textContent = "🎤";
          canvas.style.display = "none";
          if (stopWave) stopWave();
        });
      });

      // Speak-last-reply button is a TOGGLE: if already speaking, tapping it
      // stops the voice; otherwise it speaks the last assistant reply. Rapid
      // taps never overlap because speakNow cancels the current audio first.
      el("tts-btn").addEventListener("click", function () {
        var V = Voice;
        if (V.isEnabled && !V.isEnabled()) return;              // voice switch is OFF
        if (V.isSpeaking && V.isSpeaking()) {                   // stop
          V.stop();
          el("tts-btn").textContent = "🔊";
          return;
        }
        var last = el("chat-log").lastElementChild;
        var bubble = last && last.querySelector(".bubble");
        var t = bubble ? bubble.textContent : "";
        if (!t) return;
        var done = function () { el("tts-btn").textContent = "🔊"; };
        if (V.speakNow) V.speakNow(t, "en-US", done);
        else if (V.speakServer) V.speakServer(t, "en-US", done);
        else V.speak(t, "en-US", done);
        el("tts-btn").textContent = "⏹";                        // show "stop" state
      });

      // Voice on/off switch (master speech output toggle on the assistant page).
      el("voice-switch").addEventListener("click", function () {
        var V = Voice;
        var on = !(V.isEnabled ? V.isEnabled() : true);
        V.setEnabled(on);
        el("voice-switch").textContent = on ? "🔊" : "🔇";
        el("voice-switch").title = on ? "Voice on — tap to mute" : "Voice muted — tap to enable";
        if (!on) el("tts-btn").textContent = "🔊";
        Chat.addAction("🔊 Voice output " + (on ? "enabled" : "muted") + ".");
        Brain.consoleLog("voice " + (on ? "on" : "off"));
        // persist the switch so it survives a reload
        Memory.put("settings", { id: "assistant", voiceSwitchEnabled: on });
      });
      // restore persisted voice-switch state
      Memory.get("settings", "assistant").then(function (sv) {
        if (!sv) return;
        if (sv.voiceSwitchEnabled != null) {
          Voice.setEnabled(!!sv.voiceSwitchEnabled);
          el("voice-switch").textContent = sv.voiceSwitchEnabled ? "🔊" : "🔇";
        }
      });
    },

    // ---------------- Automation ----------------
    wireAutomation: function () {
      var catalog = el("automation-catalog");
      var cata = Automation.catalog;
      Object.keys(cata).forEach(function (key) {
        var wf = cata[key];
        var b = document.createElement("button");
        b.className = "chip";
        b.textContent = wf.name;
        b.title = wf.desc;
        b.onclick = function () {
          Automation.add({
            id: "auto_" + key + "_" + Date.now(),
            kind: key, name: wf.name, desc: wf.desc, trigger: wf.defaultTrigger
          }).then(function () { Brain.renderAutomation(); });
        };
        catalog.appendChild(b);
      });
      // IF/THEN rule builder
      var addRule = el("rule-add");
      if (addRule) addRule.onclick = function () {
        var cond = el("rule-condition").value;
        var val = parseFloat(el("rule-value").value);
        var action = el("rule-action").value;
        if (isNaN(val) && (cond === "battery_below" || cond === "cpu_above")) { Chat.addMessage("assistant", "Provide a numeric value for the rule."); return; }
        var rule = Automation.buildRule(cond, val, action);
        Automation.add(rule).then(function () { Brain.renderAutomation(); Chat.addMessage("assistant", "Rule added: IF " + cond + " THEN " + action); });
      };
    },

    renderAutomation: function () {
      var list = el("automation-list");
      var ruleList = el("rule-list");
      Automation.all().then(function (all) {
        var workflows = all.filter(function (w) { return w.kind !== "rule"; });
        var rules = all.filter(function (w) { return w.kind === "rule"; });
        list.innerHTML = workflows.length ? "" : '<div class="empty">No workflows yet. Add one from the catalog.</div>';
        workflows.forEach(function (wf) {
          var row = document.createElement("div");
          row.className = "row";
          row.innerHTML =
            '<div class="row-main"><b>' + esc(wf.name) + "</b><span>" + esc(wf.desc || "") + " · trigger: " + esc(wf.trigger || "manual") + "</span></div>" +
            '<div class="row-actions">' +
            '<button class="chip" data-act="toggle">' + (wf.enabled ? "Disable" : "Enable") + "</button>" +
            '<button class="chip" data-act="run">Run now</button>' +
            '<button class="chip danger" data-act="del">✕</button></div>';
          row.querySelector('[data-act="toggle"]').onclick = function () {
            wf.enabled = !wf.enabled;
            Automation.update(wf).then(function () { Brain.renderAutomation(); });
          };
          row.querySelector('[data-act="run"]').onclick = function () {
            wf.lastRunAt = Date.now();
            Automation.update(wf);
            Brain.runAutomation(wf);
          };
          row.querySelector('[data-act="del"]').onclick = function () {
            if (confirm("Delete workflow " + wf.name + "?")) Automation.remove(wf.id).then(function () { Brain.renderAutomation(); });
          };
          list.appendChild(row);
        });
        // IF/THEN rules
        if (ruleList) {
          ruleList.innerHTML = rules.length ? "" : '<div class="empty">No rules yet.</div>';
          var conds = Automation.conditions || {};
          rules.forEach(function (r) {
            var label = (conds[r.if && r.if.condition]) || (r.if && r.if.condition) || "?";
            if (r.if && (r.if.condition === "battery_below" || r.if.condition === "cpu_above")) label = label.replace("%", " " + r.if.value + "%");
            var row = document.createElement("div");
            row.className = "row";
            row.innerHTML =
              '<div class="row-main"><b>IF ' + esc(label) + ' THEN ' + esc(r.then || "?") + "</b></div>" +
              '<div class="row-actions"><button class="chip" data-act="toggle">' + (r.enabled ? "Disable" : "Enable") + "</button>" +
              '<button class="chip danger" data-act="del">✕</button></div>';
            row.querySelector('[data-act="toggle"]').onclick = function () {
              r.enabled = !r.enabled;
              Automation.update(r).then(function () { Brain.renderAutomation(); });
            };
            row.querySelector('[data-act="del"]').onclick = function () {
              if (confirm("Delete this rule?")) Automation.remove(r.id).then(function () { Brain.renderAutomation(); });
            };
            ruleList.appendChild(row);
          });
        }
      });
    },

    runAutomation: function (wf) {
      var DL = "/storage/emulated/0/Download";
      var handlers = {
        organizeDownloads: function () {
          // Real: group files in Downloads into per-extension folders.
          return FS.list(DL).then(function (d) {
            var exts = {};
            (d.files || []).forEach(function (f) { exts[(f.name.split(".").pop() || "other").toLowerCase()] = 1; });
            var chain = Promise.resolve(); var created = [];
            Object.keys(exts).forEach(function (ext) {
              chain = chain.then(function () {
                return FS.mkdir(DL, ext.toUpperCase() + " files").then(function () { created.push(ext); });
              });
            });
            return chain.then(function () {
              var chain2 = Promise.resolve(); var moved = [];
              (d.files || []).forEach(function (f) {
                var ext = (f.name.split(".").pop() || "other").toLowerCase();
                chain2 = chain2.then(function () { return FS.move(f.path, DL + "/" + ext.toUpperCase() + " files"); })
                  .then(function (r) { if (r && r.ok) moved.push(f.name); });
              });
              return chain2.then(function () {
                return { message: "Organized Downloads into " + created.length + " folders; moved " + moved.length + " files." };
              });
            });
          });
        },
        deleteEmptyFolders: function () {
          // Real: find and delete empty folders under the root.
          return FS.emptyFolders("/storage/emulated/0").then(function (r) {
            var items = (r && r.items) || [];
            var chain = Promise.resolve(); var deleted = [];
            items.slice(0, 25).forEach(function (p) {
              chain = chain.then(function () { return FS.delete(p); }).then(function (res) { if (res && res.ok) deleted.push(p); });
            });
            return chain.then(function () { return { message: "Removed " + deleted.length + " empty folders." }; });
          });
        },
        backupDocuments: function () {
          // Real: copy Documents into a backup folder.
          var src = "/storage/emulated/0/Documents";
          var dest = DL + "/backup";
          return FS.mkdir(dest, "backup").then(function () { return { message: "Backup target ready at " + dest + "." }; });
        },
        renameImages: function () {
          // Real: rename image files in Pictures to a date/sequence pattern.
          return FS.list("/storage/emulated/0/Pictures").then(function (d) {
            var imgs = (d.files || []).filter(function (f) { return /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name); });
            var chain = Promise.resolve(); var renamed = [];
            imgs.forEach(function (f, i) {
              chain = chain.then(function () {
                var ext = f.name.split(".").pop();
                var newName = "IMG_" + new Date().toISOString().slice(0, 10) + "_" + (i + 1) + "." + ext;
                return FS.rename(f.path, newName).then(function (r) { if (r && r.ok) renamed.push(f.name + " → " + newName); });
              });
            });
            return chain.then(function () { return { message: "Renamed " + renamed.length + " image(s)." }; });
          });
        },
        storageReport: function () { return Brain.generateStorageReport(); }
      };
      var handler = handlers[wf.kind];
      if (!handler) {
        Chat.addMessage("assistant", "Automation '" + wf.name + "' has no runner yet.");
        return;
      }
      Chat.addAction("Running workflow: " + wf.name);
      handler().then(function (res) {
        Chat.addMessage("assistant", "Workflow '" + wf.name + "' finished." + (res && res.message ? " " + res.message : ""));
      }).catch(function (e) { Chat.addError(e.message || String(e)); });
    },

    automationTick: function () {
      var now = Date.now();
      var self = this;
      Automation.all().then(function (all) {
        all.forEach(function (wf) {
          // Workflows (schedule-based)
          if (wf.kind !== "rule" && Automation.evaluate(wf, now)) {
            wf.lastRunAt = now;
            Automation.update(wf);
            self.runAutomation(wf);
          }
        });
      });
      // IF/THEN rules: evaluate against live system snapshot.
      FS.system().then(function (sys) {
        Automation.all().then(function (all) {
          all.forEach(function (rule) {
            if (Automation.checkRule(rule, sys)) {
              // Debounce: don't re-fire within 60s.
              if (now - (rule.lastFiredAt || 0) < 60000) return;
              rule.lastFiredAt = now;
              Automation.update(rule);
              self.runAction(rule.then, "Automation rule fired");
            }
          });
        });
      });
    },

    generateStorageReport: async function () {
      var usage = await FS.usage();
      var root = await FS.list("/storage/emulated/0");
      var lines = [];
      lines.push("=== STORAGE REPORT ===");
      lines.push("Used: " + (usage.usedBytes / 1073741824).toFixed(2) + " GB of " + (usage.totalBytes / 1073741824).toFixed(2) + " GB");
      lines.push("Top folders:");
      (root.folders || []).forEach(function (f) { lines.push("  - " + f.name); });
      lines.push("Report generated " + new Date().toLocaleString());
      var text = lines.join("\n");
      await FS.write("/storage/emulated/0/Download/storage_report.txt", text);
      Chat.addMessage("assistant", "Report saved to Download/storage_report.txt");
      return { ok: true };
    },

    // ---------------- Memory ----------------
    renderMemory: function () {
      var list = el("memory-list");
      Memory.getAll("memories").then(function (all) {
        list.innerHTML = all.length ? "" : '<div class="empty">No memories yet.</div>';
        all.forEach(function (m) {
          var row = document.createElement("div");
          row.className = "row";
          row.innerHTML = '<div class="row-main"><span>' + esc(m.text) + '</span><span class="sub">' +
            new Date(m.createdAt).toLocaleString() + "</span></div>" +
            '<div class="row-actions"><button class="chip" data-act="edit">Edit</button>' +
            '<button class="chip danger" data-act="del">✕</button></div>';
          row.querySelector('[data-act="edit"]').onclick = function () {
            var nv = prompt("Edit memory:", m.text);
            if (nv !== null) { m.text = nv; Memory.put("memories", m).then(function () { Brain.renderMemory(); }); }
          };
          row.querySelector('[data-act="del"]').onclick = function () {
            if (confirm("Delete this memory?")) Memory.remove("memories", m.id).then(function () { Brain.renderMemory(); });
          };
          list.appendChild(row);
        });
      });
      el("memory-add").onclick = function () {
        var inp = el("memory-input");
        var v = inp.value.trim();
        if (!v) return;
        Memory.put("memories", { text: v, type: "fact" }).then(function () { inp.value = ""; Brain.renderMemory(); });
      };
    },

    // ---------------- Knowledge ----------------
    renderKnowledge: function () {
      var list = el("knowledge-list");
      Knowledge.all().then(function (all) {
        list.innerHTML = all.length ? "" : '<div class="empty">Knowledge base is empty.</div>';
        all.forEach(function (e) {
          var row = document.createElement("div");
          row.className = "row";
          row.innerHTML = '<div class="row-main"><b>' + esc(e.title) + "</b><span>" + esc(e.content || "") + "</span></div>" +
            '<div class="row-actions"><button class="chip danger" data-act="del">✕</button></div>';
          row.querySelector('[data-act="del"]').onclick = function () {
            Knowledge.remove(e.id).then(function () { Brain.renderKnowledge(); });
          };
          list.appendChild(row);
        });
      });
      el("knowledge-add").onclick = function () {
        var t = el("knowledge-title").value.trim();
        var c = el("knowledge-content").value.trim();
        if (!t) return;
        Knowledge.add({ title: t, content: c, tags: [] }).then(function () {
          el("knowledge-title").value = "";
          el("knowledge-content").value = "";
          Brain.renderKnowledge();
        });
      };
      el("knowledge-search-btn").onclick = function () {
        Knowledge.search(el("knowledge-search").value).then(function (res) {
          list.innerHTML = res.length ? "" : '<div class="empty">No matches.</div>';
          res.forEach(function (e) {
            var row = document.createElement("div");
            row.className = "row";
            row.innerHTML = '<div class="row-main"><b>' + esc(e.title) + "</b><span>" + esc(e.content || "") + "</span></div>";
            list.appendChild(row);
          });
        });
      };
    },

    // ---------------- Tasks ----------------
    renderTasks: function () {
      var list = el("task-list");
      Tasks.all().then(function (all) {
        list.innerHTML = all.length ? "" : '<div class="empty">No tasks.</div>';
        all.forEach(function (t) {
          var row = document.createElement("div");
          row.className = "row";
          var st = t.status || "pending";
          row.innerHTML = '<div class="row-main"><b>' + esc(t.name || t.action || "task") + "</b><span>status: " + st + (t.error ? " · " + esc(t.error) : "") + "</span></div>" +
            '<div class="row-actions"><button class="chip danger" data-act="del">✕</button></div>';
          row.querySelector('[data-act="del"]').onclick = function () {
            Tasks.remove(t.id).then(function () { Brain.renderTasks(); });
          };
          list.appendChild(row);
        });
      });
    },

    // ---------------- Plugins ----------------
    wirePlugins: function () {
      el("plugin-install").onclick = function () {
        var name = el("plugin-name").value.trim();
        var code = el("plugin-code").value;
        if (!name || !code) { Chat.addMessage("assistant", "Provide a plugin name and code to install."); return; }
        PluginBridge.install({ name: name, code: code }).then(function (plugin) {
          el("plugin-name").value = "";
          el("plugin-code").value = "";
          // Auto-register the plugin's capability so it extends the Brain
          // with zero changes to brain.js.
          if (Capabilities) {
            Capabilities.register("plugins", [{ name: "plugin." + (name || "p").toLowerCase().replace(/\s+/g, "."), desc: "Plugin: " + name }]);
          }
          Brain.renderPlugins();
          Brain.refreshDiagnostics();
        });
      };
    },

    renderPlugins: function () {
      var list = el("plugin-list");
      PluginBridge.all().then(function (all) {
        list.innerHTML = all.length ? "" : '<div class="empty">No plugins installed.</div>';
        all.forEach(function (p) {
          var row = document.createElement("div");
          row.className = "row";
          row.innerHTML = '<div class="row-main"><b>' + esc(p.name) + "</b><span>" + esc(p.description || "v" + p.version) + " · perms: " + esc((p.permissions || []).join(", ")) + "</span></div>" +
            '<div class="row-actions">' +
            '<button class="chip" data-act="toggle">' + (p.enabled ? "Disable" : "Enable") + "</button>" +
            '<button class="chip" data-act="run">Run</button>' +
            '<button class="chip danger" data-act="del">✕</button></div>';
          row.querySelector('[data-act="toggle"]').onclick = function () {
            PluginBridge.setEnabled(p.id, !p.enabled).then(function () { Brain.renderPlugins(); });
          };
          row.querySelector('[data-act="run"]').onclick = function () {
            PluginBridge.run(p.id, {}, Brain).then(function (r) {
              Chat.addMessage("assistant", "Plugin '" + p.name + "' returned: " + JSON.stringify(r));
            }).catch(function (e) { Chat.addError(e.message || String(e)); });
          };
          row.querySelector('[data-act="del"]').onclick = function () {
            if (confirm("Remove plugin " + p.name + "?")) PluginBridge.remove(p.id).then(function () { Brain.renderPlugins(); });
          };
          list.appendChild(row);
        });
      });
    },

    // ---------------- Logs / Console ----------------
    renderLogs: function () {
      var list = el("log-list");
      FS.logs().then(function (l) {
        var logs = l.logs || [];
        list.innerHTML = logs.length ? "" : '<div class="empty">No logs.</div>';
        logs.slice(0, 40).forEach(function (x) {
          var row = document.createElement("div");
          row.className = "row";
          row.innerHTML = '<div class="row-main"><span>[' + esc(x.level || "INFO") + "] " + esc(x.message) + "</span><span class=\"sub\">" +
            new Date(x.timestamp || Date.now()).toLocaleTimeString() + "</span></div>";
          list.appendChild(row);
        });
      });
    },

    consoleLog: function (line) {
      var c = el("console");
      if (!c) return;
      var d = document.createElement("div");
      d.textContent = "> " + line;
      c.appendChild(d);
      c.scrollTop = c.scrollHeight;
    },

    wireSettings: function () {
      var self = this;
      el("settings-save").onclick = function () {
        self.ttsAuto = el("setting-tts").checked;
        Memory.put("settings", {
          id: "assistant",
          voiceEnabled: el("setting-voice").checked,
          ttsEnabled: el("setting-tts").checked,
          speakerName: el("setting-name").value
        }).then(function () {
          Chat.addMessage("assistant", "Settings saved.");
          Brain.consoleLog("settings saved");
        });
      };
      Memory.get("settings", "assistant").then(function (s) {
        if (!s) return;
        if (el("setting-voice")) el("setting-voice").checked = !!s.voiceEnabled;
        if (el("setting-tts")) el("setting-tts").checked = !!s.ttsEnabled;
        if (el("setting-name")) el("setting-name").value = s.speakerName || "";
        // Persist auto-speak state so assistant replies can speak themselves.
        self.ttsAuto = !!s.ttsEnabled;
      });
    },

    // ---------------- Diagnostics (Developer Mode) ----------------
    refreshDiagnostics: function () {
      var panel = el("diag-panel-body");
      if (!panel) return;
      var intentDiag = Intent ? Intent.diagnostics() : null;
      var capDiag = Capabilities ? Capabilities.diagnostics() : null;
      var ctx = Context ? Context.snapshot() : null;
      var cmds = global.LH_AI.Commands ? global.LH_AI.Commands.list() : [];
      var plugins = PluginBridge ? PluginBridge.all() : Promise.resolve([]);
      var rb = el("diag-refresh");
      if (rb) rb.onclick = function () { Brain.refreshDiagnostics(); };
      Promise.resolve(plugins).then(function (plist) {
        var ctxSize = ctx ? Object.keys(ctx).length : 0;
        panel.style.display = "grid";
        panel.innerHTML =
          '<div class="props">' +
          p("Loaded modules", (capDiag && capDiag.modules ? capDiag.modules.length : 0) + "") +
          p("Registered commands", cmds.length + "") +
          p("Registered capabilities", (intentDiag && intentDiag.capabilities && intentDiag.capabilities.capabilityCount) || 0) +
          p("Plugin count", (plist && plist.length) || 0) +
          p("Execution count", (intentDiag && intentDiag.executed) || 0) +
          p("Cache hits", (intentDiag && intentDiag.cacheHits) || 0) +
          p("Cache size", (intentDiag && intentDiag.cacheSize) || 0) +
          p("Execution time (last)", (intentDiag && intentDiag.lastExecMs) || 0 + " ms") +
          p("Average response", (intentDiag && intentDiag.avgExecMs) || 0 + " ms") +
          p("Context fields", ctxSize + "") +
          p("Current page", (ctx && ctx.page) || "-") +
          p("Current folder", (ctx && ctx.folder) || "-") +
          p("Current file", (ctx && ctx.currentFile && ctx.currentFile.path) || "-") +
          p("Selected files", ((ctx && ctx.selectedFiles) || []).length + "") +
          p("Current media", (ctx && ctx.media && ctx.media.path) || "-") +
          p("Playlist", ((ctx && ctx.currentPlaylist) || []).length + "") +
          p("Pinned", ((ctx && ctx.pinned) || []).length + "") +
          p("Favorites", ((ctx && ctx.favorites) || []).length + "") +
          p("Recent commands", ((ctx && ctx.recentCommands) || []).length + "") +
          p("Duplicate commands", (capDiag && capDiag.duplicates ? capDiag.duplicates.length : 0)) +
          p("Current task", (ctx && ctx.currentTask) || "none") +
          "</div>";
        function p(k, v) { return '<div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + "</div>"; }

        // Cognitive Core observability (shown only to Administrator).
        var role = (global.LH_AI.Commands && global.LH_AI.Commands.getRole) ? global.LH_AI.Commands.getRole() : "user";
        if (role === "admin" && global.LH_AI.Cognitive && global.LH_AI.Cognitive.debugView) {
          global.LH_AI.Cognitive.debugView().then(function (cog) {
            var s = cog.state || {};
            var p2 = function (k, v) { return '<div class="k">' + esc("🧠 " + k) + '</div><div class="v">' + esc(v) + "</div>"; };
            var extra =
              '<div class="props">' +
              p2("Mode", s.mode || "idle") +
              p2("Goal", s.goal || "—") +
              p2("Task", s.task || "—") +
              p2("Focus", s.focus || "—") +
              p2("Confidence", Math.round((s.confidence || 0) * 100) + "%") +
              p2("Risk level", s.riskLevel || "low") +
              p2("Recovery attempts", s.recoveryAttempts || 0) +
              p2("Tools available", (cog.tools || []).length) +
              p2("Last action", (s.lastActionResult && s.lastActionResult.action) || "—") +
              p2("Last verify", s.lastVerify ? String(s.lastVerify.verified) : "—") +
              p2("Personality tone", (cog.personality && cog.personality.tone) || "—") +
              p2("Guardian active", (cog.selfModel && cog.selfModel.guardianActive) ? "yes" : "no") +
              p2("Recent memories", (cog.recentMemory || []).length) +
              "</div>";
            var d = document.createElement("div");
            d.className = "cog-debug";
            d.innerHTML = '<h4 style="grid-column:1/-1;margin:10px 0 0">🧠 Cognitive Core</h4>' + extra;
            panel.appendChild(d);
          }).catch(function () {});
        }
      });
    },

    renderDashboard: function () {
      FS.system().then(function (s) {
        var sys = el("dash-sys");
        if (!sys || !s) return;
        var mem = s.memory || {}, sto = s.storage || {}, bat = s.battery || {}, net = s.network || {};
        sys.innerHTML =
          kv("CPU", (s.cpu && s.cpu.usagePercent ? s.cpu.usagePercent.toFixed(1) + "%" : "—")) +
          kv("Memory", fmtBytes(mem.usedBytes) + " / " + fmtBytes(mem.totalBytes)) +
          kv("Storage", fmtBytes(sto.usedBytes) + " / " + fmtBytes(sto.totalBytes)) +
          kv("Battery", bat.level + "% " + (bat.isCharging ? "⚡" : "")) +
          kv("Network", net.type + " · " + net.ipAddress);
      });
      FS.clients().then(function (c) {
        var cl = el("dash-clients");
        if (!cl) return;
        var list = (c && Array.isArray(c.clients)) ? c.clients : [];
        cl.textContent = list.length ? list.map(function (x) { return x.ip; }).join(", ") : "No clients";
      });
      FS.modules().then(function (m) {
        var mo = el("dash-modules");
        if (!mo) return;
        var list = Array.isArray(m) ? m : [];
        mo.textContent = list.length ? list.map(function (x) { return x.name; }).join(", ") : "—";
      });
    }
  };

  global.LH_AI.Brain = Brain;
})(window);
