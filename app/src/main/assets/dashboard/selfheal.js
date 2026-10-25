/* selfheal.js - Admin Self-Healing Console renderer (dashboard).
 * Loads after the AI engine scripts and drives SelfHeal / Guardian / Cognitive.
 * Admin-only: a normal user sees only the access gate, never engine internals.
 */
(function () {
  "use strict";
  var apiBase = (window.LH_AI && window.LH_AI.baseUrl) || "";
  var token = null;
  try { token = sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken"); } catch (e) {}
  if (window.LH_AI) window.LH_AI.token = token;

  function authFetch(url, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (token) opts.headers["Authorization"] = "Bearer " + token;
    return fetch(apiBase + url, opts);
  }

  var $ = function (id) { return document.getElementById(id); };

  var SHUI = {
    log: function (s) {
      var el = $("log");
      if (!el) return;
      el.textContent += (el.textContent ? "\n" : "") + "[" + new Date().toLocaleTimeString() + "] " + s;
      el.scrollTop = el.scrollHeight;
    },
    esc: function (s) {
      return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    },

    // ---- role gate ----
    bootstrap: function () {
      authFetch("/api/auth/session").then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (res) {
          var role = res.role || "user";
          var badge = $("role-badge");
          if (badge) badge.textContent = role === "admin" ? "Administrator" : "Web User";
          var ws = $("ws-status");
          if (ws) ws.innerHTML = '<span class="dot on"></span><span> live</span>';
          if (role === "admin") {
            $("gate").classList.add("hide");
            $("main").classList.remove("hide");
            SHUI.log("Admin session verified. Self-healing engine online.");
            return SHUI.initEngine();
          }
          $("gate").classList.remove("hide");
          $("main").classList.add("hide");
        })
        .catch(function () { $("gate").classList.remove("hide"); $("main").classList.add("hide"); });
    },

    initEngine: function () {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      if (SH && SH.engineSelfDiagnose) {
        var h = SH.engineSelfDiagnose();
        $("engine").innerHTML =
          "Engine healthy: <b>" + (h.healthy ? "yes" : "no") + "</b><br>" +
          h.findings.map(function (f) { return "• " + SHUI.esc(f.check) + ": " + SHUI.esc(f.note); }).join("<br>");
      }
      return SHUI.refresh();
    },

    refresh: function () {
      SHUI.renderHealth();
      SHUI.renderIncidents();
      return Promise.resolve();
    },

    renderHealth: function () {
      var g = window.LH_AI && window.LH_AI.Guardian;
      var p = (g && g.runHealthCheck) ? g.runHealthCheck() : Promise.resolve({ message: "Guardian unavailable" });
      return Promise.resolve(p).then(function (hc) {
        $("health").innerHTML = SHUI.esc(hc.message || "No data");
      }).catch(function (e) { $("health").textContent = "Health check failed: " + (e.message || e); });
    },

    statusBadge: function (inc) {
      var sev = (inc.severity || "low").toLowerCase();
      var cls = sev === "critical" ? "b-red" : sev === "high" ? "b-red" : sev === "medium" ? "b-yellow" : "b-grey";
      return '<span class="badge ' + cls + '">' + SHUI.esc(sev) + "</span>";
    },

    renderIncidents: function () {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      if (!SH) return;
      SH.listIncidents().then(function (list) {
        var active = list.filter(function (i) { return i.state !== "resolved" && i.state !== "rejected"; });
        var history = list.filter(function (i) { return i.state === "resolved" || i.state === "rejected"; });
        $("incidents").innerHTML = active.length
          ? active.map(function (i) { return SHUI.incidentCard(i); }).join("")
          : '<div class="sub">No active incidents. The engine is idle.</div>';
        $("history").innerHTML = history.length
          ? history.map(function (i) { return SHUI.incidentCard(i, true); }).join("")
          : '<div class="sub">No resolved incidents yet.</div>';
      });
    },

    incidentCard: function (inc, history) {
      var rca = inc.rootCause || {};
      var conf = rca.confidence != null ? Math.round(rca.confidence * 100) : 0;
      var cls = history ? "resolved" : (inc.severity === "critical" || inc.severity === "high" ? "high" : "");
      var patch = inc.candidateFix || {};
      var p = patch;
      var level = inc.autonomyLevel != null ? inc.autonomyLevel : (p.level != null ? p.level : "—");
      var affectedFiles = (p.files || []).join(", ") || (inc.affectedFiles || []).join(", ") || "—";
      return '<div class="incident ' + SHUI.esc(cls) + '">' +
        "<div><b>" + SHUI.esc(inc.incidentId) + "</b> &nbsp; " + SHUI.statusBadge(inc) +
        ' <span class="badge b-blue">' + SHUI.esc(inc.state) + "</span>" +
        ' <span class="badge b-grey">L' + SHUI.esc(level) + "</span></div>" +
        "<div><b>Component:</b> " + SHUI.esc(inc.component) + "</div>" +
        "<div><b>Error:</b> " + SHUI.esc(String(inc.error).slice(0, 120)) + "</div>" +
        "<div><b>Root cause:</b> " + SHUI.esc(((rca.causes || []).join(" | ") || "—")) + "</div>" +
        "<div><b>Confidence:</b> " + conf + "% &nbsp; <b>Affected files:</b> " + SHUI.esc(affectedFiles) + "</div>" +
        '<div class="kv" style="grid-template-columns:110px 1fr;margin-top:6px">' +
        "<b>Patch:</b> " + SHUI.esc(p.status || "—") + "</div>" +
        "<b>Test:</b> " + SHUI.esc(inc.testStatus || p.testResult ? (p.testResult && p.testResult.passed ? "passed" : (inc.testStatus || "—")) : "—") + "</div>" +
        "<b>Backup:</b> " + SHUI.esc((p.snapshotId ? "created" : (inc.deploymentStatus || "—"))) + "</div>" +
        "<b>Deploy:</b> " + SHUI.esc(inc.deploymentStatus || "—") + "</div>" +
        "<b>Verify:</b> " + SHUI.esc(p.status === "verified" ? "verified" : "—") + "</div>" +
        "<b>Rollback:</b> " + SHUI.esc(inc.rollbackStatus || "—") + "</div></div>" +
        (history ? "" :
          '<div style="margin-top:6px">' +
          '<button onclick="SHUI.diff(\'' + inc.incidentId + '\')">View Diff</button>' +
          '<button onclick="SHUI.evidence(\'' + inc.incidentId + '\')">View Evidence</button>' +
          '<button class="primary" onclick="SHUI.approve(\'' + inc.incidentId + '\')">Approve Patch</button>' +
          '<button class="danger" onclick="SHUI.reject(\'' + inc.incidentId + '\')">Reject</button>' +
          '<button onclick="SHUI.rollback(\'' + inc.incidentId + '\')">Rollback</button>' +
          '<button onclick="SHUI.retry(\'' + inc.incidentId + '\')">Retry</button>' +
          "</div>") +
        "</div>";
    },

    diff: function (id) {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      SH.listIncidents().then(function (l) {
        var inc = l.find(function (i) { return i.incidentId === id; });
        var p = inc && inc.candidateFix;
        SHUI.log("Diff for " + id + ":\n" + (p && p.diff ? p.diff : "no diff available"));
      });
    },
    evidence: function (id) {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      SH.listIncidents().then(function (l) {
        var inc = l.find(function (i) { return i.incidentId === id; });
        var ev = ((inc && (inc.logs || inc.evidence)) || []).slice(0, 8).join("\n");
        SHUI.log("Evidence for " + id + ":\n" + (ev || "no evidence recorded"));
      });
    },
    approve: function (id) {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      SHUI.log("Approving patch for " + id + " …");
      SH.approveAndDeploy(id, "admin").then(function (r) {
        SHUI.log("Approve result: " + (r.status || r.message));
        SHUI.refresh();
      }).catch(function (e) { SHUI.log("Approve failed: " + (e.message || e)); });
    },
    reject: function (id) {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      SH.listIncidents().then(function (l) {
        var inc = l.find(function (i) { return i.incidentId === id; });
        if (inc) { inc.state = "rejected"; SHUI.log("Rejected " + id + ". No files changed."); SHUI.refresh(); }
      });
    },
    rollback: function (id) {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      SH.listBackups().then(function (baks) {
        if (!baks.length) return SHUI.log("No backups to restore.");
        var latest = baks[baks.length - 1];
        return SH.rollback(latest).then(function (r) { SHUI.log("Rollback: " + r.message); SHUI.refresh(); });
      });
    },
    retry: function (id) {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      SH.listIncidents().then(function (l) {
        var inc = l.find(function (i) { return i.incidentId === id; });
        if (!inc) return SHUI.log("Incident not found.");
        SHUI.log("Retrying investigation of " + id + " …");
        return SH.handleDetection({ component: inc.component, error: inc.error, severity: inc.severity, frequency: 3 })
          .then(function () { SHUI.refresh(); });
      });
    },
    scan: function () {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      if (!SH) return;
      SHUI.log("Running diagnostic scan …");
      SH.selfDiagnose().then(function (r) { SHUI.log(r.message); SHUI.renderHealth(); });
    },
    regressions: function () {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      SH.runRegressions().then(function (r) {
        SHUI.log("Regression suite: ran=" + r.ran + " passed=" + r.passed + " failed=" + r.failed);
      });
    },
    build: function () {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      SHUI.log("Running build (allowlist) …");
      SH.buildLocalHub().then(function (r) {
        SHUI.log("Build status: " + (r.status || "") + "\n" + (r.steps || []).map(function (s) { return "• " + s.step + ": " + (s.status || s.changed); }).join("\n"));
      });
    },
    device: function () {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      SH.verifyDevice().then(function (r) {
        SHUI.log("Device verification: " + r.status);
      });
    },
    model: function () {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      var s = SH.modelStatus();
      SHUI.log("Model: kind=" + s.kind + " available=" + s.available + " fallback=" + (s.deterministicFallback ? "deterministic" : "local model"));
    },

    // ---- Device & Build console (Phase 12/13) ----
    _devOut: function (label, obj) {
      var el = $("deviceLog");
      if (!el) return;
      el.classList.remove("hide");
      el.textContent = label + ":\n" + JSON.stringify(obj, null, 2);
    },
    _projRoot: function () {
      return (window.LH_AI && window.LH_AI.projectRoot) || "/home/user/LocalHub";
    },
    preflight: function () {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      if (!SH || !SH.Device) return SHUI.log("Device integration not loaded.");
      SH.Device.preflightBuild({ projectRoot: SHUI._projRoot() }).then(function (r) {
        SHUI._devOut("Preflight", r);
        $("buildStatus").textContent = r.status;
        SHUI.log("Preflight: " + r.status);
      });
    },
    buildDev: function () {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      if (!SH || !SH.Device) return SHUI.log("Device integration not loaded.");
      SHUI.log("Running allowlisted build with self-heal (bounded) …");
      SH.Device.buildWithSelfHeal({ projectRoot: SHUI._projRoot() }).then(function (r) {
        SHUI._devOut("Build result", r);
        $("buildStatus").textContent = r.status;
        SHUI.log("Build: " + r.status + " (repairs=" + (r.repairIterations || 0) + ")");
      });
    },
    apk: function () {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      if (!SH || !SH.Device) return SHUI.log("Device integration not loaded.");
      SH.Device.discoverApk({ apkPath: SHUI._projRoot() + "/app/build/outputs/apk/debug/app-debug.apk", packageId: "com.localhub.localhub" }).then(function (r) {
        SHUI._devOut("APK", r);
        $("apkInfo").textContent = r.status + (r.record ? (" " + (r.record.apkHash || "")) : "");
        SHUI.log("APK: " + r.status);
      });
    },
    device: function () {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      if (!SH || !SH.Device) return SHUI.log("Device integration not loaded.");
      SH.Device.detectDevice().then(function (d) {
        SHUI._devOut("Device", d);
        $("deviceInfo").textContent = d.status + (d.primary ? (" " + d.primary) : "");
        SHUI.log("Device: " + d.status);
      });
    },
    install: function () {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      if (!SH || !SH.Device) return SHUI.log("Device integration not loaded.");
      var apkPath = SHUI._projRoot() + "/app/build/outputs/apk/debug/app-debug.apk";
      // Explicit authorization: this is the admin's action on the console.
      SH.Device.installApk({ apkPath: apkPath, packageId: "com.localhub.localhub" }, true).then(function (r) {
        SHUI._devOut("Install", r);
        $("installStatus").textContent = r.status;
        SHUI.log("Install: " + r.status + (r.ok ? "" : " — " + (r.message || "failed")));
      });
    },
    runtime: function () {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      if (!SH || !SH.Device) return SHUI.log("Device integration not loaded.");
      SH.Device.verifyRuntime({}).then(function (vr) {
        SHUI._devOut("Runtime verification", { status: vr.status, checks: vr.checks });
        $("runtimeInfo").textContent = vr.status;
        SHUI.log("Runtime: " + vr.status);
      });
    },
    deploy: function () {
      var SH = window.LH_AI && window.LH_AI.SelfHeal;
      if (!SH || !SH.Device) return SHUI.log("Device integration not loaded.");
      SHUI.log("Running full device deploy pipeline …");
      SH.Device.runDeviceDeployPipeline({ projectRoot: SHUI._projRoot(), authorizeInstall: true }).then(function (r) {
        SHUI._devOut("Deploy pipeline", r);
        SHUI.log("Deploy: " + r.status);
      });
    }
  };

  window.SHUI = SHUI;
  document.addEventListener("DOMContentLoaded", function () { SHUI.bootstrap(); });
})();
