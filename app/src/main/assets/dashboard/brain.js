/* brain.js - Personal Brain Console renderer (admin). Evidence summaries only. */
(function () {
  "use strict";
  var apiBase = (window.LH_AI && window.LH_AI.baseUrl) || "";
  var token = null;
  try { token = sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken"); } catch (e) {}
  if (window.LH_AI) window.LH_AI.token = token;
  function authFetch(url) { var o = { headers: {} }; if (token) o.headers["Authorization"] = "Bearer " + token; return fetch(apiBase + url, o); }
  var $ = function (id) { return document.getElementById(id); };
  var Cog = function () { return window.LH_AI && window.LH_AI.Cognitive; };
  var PB = function () { return Cog() && Cog().PersonalBrain; };

  var BUI = {
    esc: function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); },
    bootstrap: function () {
      authFetch("/api/auth/session").then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (res) {
        if (res.role === "admin") { $("gate").classList.add("hide"); $("main").classList.remove("hide"); BUI.refresh(); }
        else { $("gate").classList.remove("hide"); $("main").classList.add("hide"); }
      }).catch(function () { $("gate").classList.remove("hide"); $("main").classList.add("hide"); });
    },
    refresh: function () {
      BUI.renderState(); BUI.renderTimeline(); BUI.renderSuggest();
    },
    renderState: function () {
      Cog().brainState().then(function (s) {
        $("state").innerHTML =
          "<b>Focus:</b> " + BUI.esc(s.currentFocus || "—") + "<br>" +
          "<b>Goal:</b> " + BUI.esc(s.currentGoal ? s.currentGoal.label + " [" + s.currentGoal.status + " " + (s.currentGoal.progress || 0) + "%]" : "—") + "<br>" +
          "<b>Active routines:</b> " + (s.activeRoutines || []).map(function (r) { return BUI.esc(r.name) + " (" + Math.round((r.confidence || 0) * 100) + "%)"; }).join(", ") + "<br>" +
          "<b>Habits:</b> " + (s.habits || []).slice(0, 3).map(function (h) { return BUI.esc(h.action) + " x" + h.count; }).join(", ") + "<br>" +
          "<b>Capabilities:</b> " + (s.capabilities || []).join(", ") + "<br>" +
          "<b>Memory:</b> " + (s.memoryEnabled ? "enabled" : "disabled") + " · <b>Heuristic score (not calibrated):</b> " + BUI.esc(s.confidence) + "<br>" +
          "<b>Limitation:</b> " + BUI.esc(s.limitation);
      });
    },
    renderTimeline: function () {
      Cog().getBrainTimeline(20).then(function (tl) {
        $("timeline").textContent = (tl || []).map(function (e) {
          var d = new Date(e.ts); var hm = d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
          return hm + "  [" + e.type + "]  " + e.detail;
        }).join("\n") || "No important brain events yet.";
      });
    },
    renderSuggest: function () {
      PB().suggestNow({}).then(function (su) {
        $("suggest").textContent = (su || []).length ? su.map(function (s) { return "• [" + s.type + "] " + s.message + " (conf " + Math.round((s.confidence || 0) * 100) + "%)\n   reason: " + s.reason; }).join("\n") : "No suggestions right now (quiet intelligence).";
      });
    },
    searchMem: function () {
      var q = prompt("Search memory for:");
      if (q == null) return;
      PB().recall(q, { limit: 8 }).then(function (r) {
        $("memout").textContent = r.length ? r.map(function (x) { return "• [" + x.confidenceLabel + "] " + x.content; }).join("\n") : "No matching memories.";
      });
    },
    exportMem: function () { PB().exportMemory().then(function (r) { $("memout").textContent = "Exported " + r.count + " memories locally (no cloud)."; }); },
    clearMem: function () { if (confirm("Clear all personal memories?")) PB().clearMemory().then(function () { $("memout").textContent = "Cleared."; }); },
    toggleMem: function () {
      PB().memoryEnabled().then(function (en) { return PB().setMemoryEnabled(!en); }).then(function (r) { $("memout").textContent = "Memory " + (r.enabled ? "enabled" : "disabled"); BUI.renderState(); });
    },
    listRoutines: function () {
      PB().listRoutines().then(function (rs) {
        $("routineout").textContent = rs.length ? rs.map(function (r) { return "• " + r.name + " [" + r.status + "] " + r.steps.map(function (s) { return s.action; }).join(" → ") + " (conf " + Math.round((r.confidence || 0) * 100) + "%)"; }).join("\n") : "No routines.";
      });
    },
    runRoutine: function () {
      PB().listRoutines({ status: "ACTIVE" }).then(function (rs) {
        if (!rs.length) { $("routineout").textContent = "No active routine to run."; return; }
        PB().executeRoutine(rs[rs.length - 1].id, {}, { approved: true }).then(function (r) {
          $("routineout").textContent = "Ran: " + (r.ok ? "OK" : r.reason) + "\n" + (r.results || []).map(function (x) { return x.action + " " + (x.ok ? "✓" : "✗"); }).join("\n");
        });
      });
    }
  };
  window.BUI = BUI;
  document.addEventListener("DOMContentLoaded", function () { BUI.bootstrap(); });
})();
