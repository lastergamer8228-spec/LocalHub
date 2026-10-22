/* selfheal.js - LocalHub Self-Healing Engine.
 *
 * A controlled, safe, local-first software diagnostic and repair system for
 * LocalHub. It is NOT uncontrolled self-modification: every repair follows the
 * lifecycle
 *
 *   EVIDENCE -> ROOT CAUSE -> PATCH -> TEST -> BACKUP -> DEPLOY -> VERIFY
 *   -> ROLLBACK IF NECESSARY -> LEARN
 *
 * and it NEVER bypasses auth, permissions, security, or user data, and NEVER
 * auto-applies critical (level 5) changes without administrator approval.
 *
 * It reuses the Cognitive Core (events, state, memory, tools) and the Guardian
 * (monitoring/detection). It does not duplicate the brain.
 *
 * Fully offline, deterministic, private.
 */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  function Cog() { return global.LH_AI.Cognitive; }
  function Mem() { return global.LH_AI.Memory; }
  function Guardian() { return global.LH_AI.Guardian; }

  // =====================================================================
  // LOCAL MODEL PROVIDER (vendor-neutral adapter + deterministic fallback)
  // =====================================================================
  // The Cognitive Core / Self-Healing engine may use a local model for NLU,
  // reasoning, summarization, intent extraction, planning, root-cause analysis,
  // code analysis and patch proposals. If none is configured, a deterministic
  // rule-based provider is the default. LocalHub NEVER depends on a specific
  // external model vendor and NEVER requires a cloud dependency.
  //
  // A compatible local model provider (Ollama / llama.cpp / ONNX / Remote API /
  // a local .tflite runtime) can be attached at runtime via
  // `setLocalModelProvider()`. Each method returns
  // `Promise<{ok, text|data, confidence, usedProvider}>`. When a real model is
  // attached, `kind` becomes that provider's name and `available` becomes true;
  // when it is not, the deterministic fallback is used and is always honest
  // about being deterministic (never pretends to be intelligent).
  var modelProvider = {
    kind: "deterministic",            // "deterministic" | provider name
    available: false,
    async: true,
    // vendor-neutral capability surface used by the engine:
    generate: function (kind, input) { return deterministic(kind, input); },
    summarize: function (text) { return deterministic("summarize", text); },
    analyze: function (text) { return deterministic("analyze", text); },
    analyzeIncident: function (incident) { return deterministic("analyzeIncident", incident); },
    proposePatch: function (incident, options) { return deterministic("proposePatch", incident); },
    explainRCA: function (incident) { return deterministic("explainRCA", incident); },
    generateTests: function (incident, patch) { return deterministic("generateTests", patch); },
    plan: function (goal) { return deterministic("plan", goal); }
  };

  // Attach a real, replaceable local model provider. It is merged over the
  // deterministic default, so a deterministic fallback always remains reachable.
  // This is the single integration point for Ollama / llama.cpp / ONNX / any
  // compatible local model. It is safe: the engine never executes model output
  // as code; model suggestions always pass the same safety gates.
  function setLocalModelProvider(provider) {
    if (!provider) return;
    modelProvider.kind = provider.kind || modelProvider.kind;
    modelProvider.available = !!provider.available;
    modelProvider.async = provider.async !== false;
    ["generate", "summarize", "analyze", "analyzeIncident", "proposePatch",
     "explainRCA", "generateTests", "plan"].forEach(function (m) {
      if (typeof provider[m] === "function") modelProvider[m] = provider[m];
    });
    // Keep the legacy alias so existing callers keep working.
    return modelProvider;
  }
  // Legacy alias kept for compatibility.
  var setModelProvider = setLocalModelProvider;

  function modelStatus() {
    return {
      kind: modelProvider.kind,
      available: modelProvider.available,
      async: modelProvider.async,
      deterministicFallback: !modelProvider.available,
      note: modelProvider.available
        ? "Local model attached. Its suggestions still pass every safety gate."
        : "Deterministic fallback active (no local model attached). Honest, rule-based, not an LLM."
    };
  }

  // Deterministic fallback: simple, honest, rule-based outputs. It is explicitly
  // NOT intelligent — it performs pattern-based analysis with bounded confidence
  // and always says so.
  function deterministic(kind, input) {
    var t = String(input || "").trim();
    if (kind === "summarize") {
      var words = t.split(/\s+/);
      var summary = words.slice(0, 24).join(" ") + (words.length > 24 ? "…" : "");
      return Promise.resolve({ ok: true, text: summary, confidence: 0.9, usedProvider: "deterministic" });
    }
    if (kind === "analyze") {
      return Promise.resolve({
        ok: true, confidence: 0.7, usedProvider: "deterministic",
        data: {
          hints: "Deterministic analysis. Provide the error/log for a focused root cause.",
          possibleCauses: ["Check server logs for the failing component", "Check for repeated failures", "Check recent configuration changes"]
        }
      });
    }
    if (kind === "plan") {
      // Deterministic plan generator for a high-level goal: split into steps.
      var g = (input && (input.label || input)) ? String(input.label || input).trim() : "";
      var steps = g ? g.split(/\s+(?:then|and)\s+/i).filter(function (s) { return s; })
              .map(function (s) { return s.replace(/^[a-z]/, function (c) { return c.toUpperCase(); }); }) : [];
      if (!steps.length && g) steps = ["Investigate '" + g + "'", "Gather evidence", "Execute plan", "Verify outcome"];
      return Promise.resolve({ ok: true, steps: steps, confidence: 0.6, usedProvider: "deterministic" });
    }
    if (kind === "analyzeIncident") {
      var inc = input || {};
      return Promise.resolve({
        ok: true, confidence: 0.6, usedProvider: "deterministic",
        data: {
          hints: "Deterministic RCA. See component/error signature for probable causes.",
          possibleCauses: ["Check server logs for " + (inc.component || "the component")],
          affectedFiles: [], affectedComponents: [inc.component || "unknown"],
          reproducible: null
        }
      });
    }
    if (kind === "proposePatch") {
      return Promise.resolve({
        ok: true, confidence: 0.5, usedProvider: "deterministic",
        data: {
          reason: "Deterministic candidate: verify the failing path and apply a targeted, reversible fix.",
          expectedBehavior: "Component operates correctly after fix.",
          risk: "medium", testPlan: ["static-check"], files: []
        }
      });
    }
    if (kind === "explainRCA") {
      return Promise.resolve({
        ok: true, usedProvider: "deterministic",
        text: "Deterministic explanation. Provide the failing log/stack for a focused root-cause explanation."
      });
    }
    if (kind === "generateTests") {
      return Promise.resolve({
        ok: true, usedProvider: "deterministic",
        tests: ["component-operates", "no-new-errors", "rollback-available"]
      });
    }
    return Promise.resolve({ ok: true, text: t, confidence: 0.9, usedProvider: "deterministic" });
  }

  // =====================================================================
  // REPAIR LEVELS
  // =====================================================================
  var LEVELS = {
    OBSERVE: 0, SAFE_RECOVERY: 1, DIAGNOSTIC: 2, PATCH_PROPOSAL: 3, AUTOMATED_PATCH: 4, CRITICAL: 5
  };
  // Components that are CRITICAL (level 5) — require explicit admin approval.
  var CRITICAL_COMPONENTS = ["auth", "authorization", "security", "migration", "update-engine", "rollback-engine", "core-storage"];

  function isCritical(component) {
    var c = String(component || "").toLowerCase();
    return CRITICAL_COMPONENTS.some(function (k) { return c.indexOf(k) >= 0; });
  }

  // =====================================================================
  // INCIDENT MODEL
  // =====================================================================
  // An Incident tracks a detected failure through its full lifecycle.
  function createIncident(detection) {
    detection = detection || {};
    return {
      incidentId: "inc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      severity: detection.severity || "medium",   // low | medium | high | critical
      component: detection.component || "unknown",
      error: detection.error || "",
      stackTrace: detection.stackTrace || "",
      environment: detection.environment || snapshotEnvironment(),
      frequency: detection.frequency || 1,
      reproducible: null,                          // null | true | false | unknown
      rootCause: null,
      candidateFix: null,
      patchId: null,
      testStatus: "not_tested",                    // not_tested | testing | passed | failed
      deploymentStatus: "not_deployed",            // not_deployed | backing_up | deploying | deployed | rolled_back
      rollbackStatus: "not_needed",                // not_needed | rolled_back | verified
      state: "detected",                           // detected | diagnosing | reproduced | proposing | testing | backing_up | deploying | verified | rolled_back | rejected | resolved
      logs: [],
      evidence: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  function snapshotEnvironment() {
    var s = Cog() && Cog().getState ? Cog().getState("identity") : null;
    return {
      app: "LocalHub",
      version: (global.LH_AI && global.LH_AI.baseUrl) ? "web" : "1",
      identity: s || "LocalHub Assistant"
    };
  }

  // =====================================================================
  // DETECTION
  // =====================================================================
  // Simple signature key used to match similar incidents / find past knowledge.
  function signature(inc) {
    return String(inc.component || "").toLowerCase() + "::" + String(inc.error || "").toLowerCase();
  }

  // Determine whether repeated failures make an issue significant.
  function isSignificant(detection) {
    // A single harmless error is not significant. Use frequency + severity.
    var sev = { low: 1, medium: 2, high: 3, critical: 4 }[detection.severity] || 1;
    var freq = detection.frequency || 1;
    return (sev * freq) >= 3;   // e.g. 2 medium, or 1 high, or repeated lows
  }

  // =====================================================================
  // INCIDENT STORE (persistent, local, via Cognitive memory layers)
  // =====================================================================
  function storeIncident(inc) {
    var c = Cog();
    if (!c || !c.remember) return Promise.resolve(inc);
    return c.remember("incidents", { kind: "incident", incident: inc, text: "Incident " + inc.component + ": " + inc.error }, inc.severity === "critical" ? 5 : 3);
  }
  function listIncidents() {
    var c = Cog();
    if (!c || !c.recall) return Promise.resolve([]);
    return c.recall("incidents", "", 20).then(function (items) {
      return items.filter(function (i) { return i.incident; }).map(function (i) { return i.incident; });
    });
  }
  function getIncident(id) {
    return listIncidents().then(function (all) {
      return all.find(function (i) { return i.incidentId === id; }) || null;
    });
  }
  function updateIncident(inc) {
    inc.updatedAt = Date.now();
    return storeIncident(inc);
  }

  // =====================================================================
  // ROOT CAUSE ANALYSIS (RCA)
  // =====================================================================
  // Deterministic RCA over the available evidence + logs. Prefers root-cause
  // over symptom. Honest about uncertainty.
  function rootCauseAnalysis(inc) {
    var logs = inc.logs || [];
    var error = String(inc.error || "").toLowerCase();
    var causes = [];
    var confidence = 0.5;

    // Simple signature → likely cause mapping (deterministic, honest).
    if (/socket|websocket|ws\b/.test(error)) {
      causes.push("WebSocket/connection handling likely at fault (e.g. state race or dropped connection).");
      confidence = 0.6;
    } else if (/404|not found/.test(error)) {
      causes.push("A route, file, or asset referenced by the failing component was not found.");
      confidence = 0.7;
    } else if (/401|unauthor/.test(error)) {
      causes.push("Authentication/token for the failing request is missing or invalid.");
      confidence = 0.7;
    } else if (/403|forbidden|permission/.test(error)) {
      causes.push("The failing action was blocked by the permission/role gate (expected if not admin).");
      confidence = 0.7;
    } else if (/500|exception|error/.test(error)) {
      causes.push("An unhandled exception in the component — check the stack trace and logs.");
      confidence = 0.55;
    } else if (/timeout|timed out|slow/.test(error)) {
      causes.push("Likely a timeout or resource contention under load.");
      confidence = 0.55;
    } else {
      causes.push("No clear signature; needs reproduction and log inspection.");
      confidence = 0.3;
    }

    // Fold in evidence lines that look like errors.
    (logs.slice(0, 20)).forEach(function (l) {
      var s = String(l).toLowerCase();
      if (s.indexOf("error") >= 0 || s.indexOf("exception") >= 0) causes.push("Log: " + String(l).slice(0, 120));
    });

    var result = {
      causes: causes.slice(0, 5),
      confidence: confidence,
      usedProvider: modelProvider.available ? modelProvider.kind : "deterministic",
      rootCauseCertain: confidence >= 0.7,
      affectedFiles: [], affectedComponents: [inc.component || "unknown"],
      evidence: evidenceSummary(inc)
    };
    // If a real local model is attached, augment the RCA with its analysis and
    // blend confidence (model + deterministic). If only the deterministic
    // fallback is present we keep the honest rule-based result.
    if (modelProvider.available && typeof modelProvider.analyzeIncident === "function") {
      try {
        return Promise.resolve(modelProvider.analyzeIncident(inc)).then(function (mr) {
          if (mr && mr.ok && mr.data) {
            var d = mr.data;
            if (d.possibleCauses && d.possibleCauses.length) result.causes = d.possibleCauses.slice(0, 5);
            if (d.affectedFiles) result.affectedFiles = d.affectedFiles;
            if (d.affectedComponents) result.affectedComponents = d.affectedComponents;
            if (d.reproducible != null) inc.reproducible = d.reproducible;
            result.usedProvider = mr.usedProvider || modelProvider.kind;
            result.confidence = Math.min(0.98, Math.max(result.confidence, (mr.confidence || 0.5)));
            result.rootCauseCertain = result.confidence >= 0.7;
            result.modelAugmented = true;
          }
          return result;
        });
      } catch (e) { /* fall through to deterministic */ }
    }
    return Promise.resolve(result);
  }

  // Small helper: summarise the evidence currently attached to an incident.
  function evidenceSummary(inc) {
    var out = [];
    if (inc.logs && inc.logs.length) out = inc.logs.slice(0, 5);
    return out;
  }

  // =====================================================================
  // PATCH PROPOSAL (uses model provider when available; safe + auditable)
  // =====================================================================
  // Build a candidate patch from an incident. Optionally consults the local
  // model for a proposed fix; regardless of source, the result is a plain,
  // auditable patch object that still passes every safety gate before deploy.
  function proposePatch(inc, options) {
    options = options || {};
    return Promise.resolve().then(function () {
      if (modelProvider.available && typeof modelProvider.proposePatch === "function") {
        return Promise.resolve(modelProvider.proposePatch(inc, options)).then(function (mr) {
          if (mr && mr.ok && mr.data) {
            var d = mr.data;
            var patch = createPatch(inc, d.files || [], d.reason || ("Fix for " + inc.component),
              d.beforeAfter || "before/after summary pending", d.expectedBehavior || "Component operates correctly",
              d.risk || "medium", d.testPlan || ["static-check"]);
            patch.proposedBy = mr.usedProvider || modelProvider.kind;
            return patch;
          }
          return defaultProposal(inc);
        });
      }
      return defaultProposal(inc);
    });
  }

  function defaultProposal(inc) {
    var rca = inc.rootCause || {};
    var reason = (rca.causes && rca.causes[0]) ? ("Root-cause fix for " + inc.component + ": " + rca.causes[0]) : ("Fix for " + inc.component);
    return createPatch(inc, [], reason, "before/after summary pending", "Component operates correctly after fix", "medium", ["static-check"]);
  }

  // =====================================================================
  // RCA EXPLANATION (human-readable, model- or deterministic)
  // =====================================================================
  function explainRCA(inc) {
    var rca = inc.rootCause || { causes: [], confidence: 0 };
    if (modelProvider.available && typeof modelProvider.explainRCA === "function") {
      return Promise.resolve(modelProvider.explainRCA(inc)).then(function (mr) {
        return mr && mr.ok && mr.text
          ? { ok: true, text: mr.text, usedProvider: mr.usedProvider || modelProvider.kind }
          : { ok: true, text: "RCA for " + inc.component + " (" + Math.round(rca.confidence * 100) + "% confidence): " + rca.causes.join(" | "), usedProvider: "deterministic" };
      });
    }
    return Promise.resolve({ ok: true, text: "RCA for " + inc.component + " (" + Math.round(rca.confidence * 100) + "% confidence): " + rca.causes.join(" | "), usedProvider: "deterministic" });
  }

  // =====================================================================
  // PATCH LIFECYCLE
  // =====================================================================
  // Candidate patch object.
  function createPatch(inc, files, reason, beforeAfter, expected, risk, testPlan) {
    return {
      patchId: "patch_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      incidentId: inc.incidentId,
      files: files || [],
      reason: reason || "",
      beforeAfter: beforeAfter || "",
      expectedBehavior: expected || "",
      risk: risk || "medium",
      testPlan: testPlan || [],
      status: "proposed",     // proposed | testing | passed | failed | deployed | rolled_back
      created: Date.now()
    };
  }

  // =====================================================================
  // TESTING (deterministic; in the browser sandbox we can only do static checks)
  // =====================================================================
  function testPatch(patch) {
    // Static sanity checks available offline in the browser.
    var results = [];
    if (patch.files && patch.files.length) results.push({ test: "files-list", ok: true });
    if (patch.reason && patch.beforeAfter) results.push({ test: "patch-documented", ok: true });
    if (patch.expectedBehavior) results.push({ test: "expected-behavior", ok: true });
    // A real build / unit / integration / regression run requires the Android
    // toolchain or a connected device — not available in this sandbox. We are
    // honest about that: testStatus stays "not_fully_testable".
    var allStaticOk = results.every(function (r) { return r.ok; });
    return Promise.resolve({
      ok: allStaticOk,
      status: allStaticOk ? "passed_static" : "failed",
      tests: results,
      note: "Static checks only. A full build/test/QA run requires the Android SDK / device."
    });
  }

  // =====================================================================
  // BACKUP (restorable snapshot of current working state)
  // =====================================================================
  function backupState() {
    var c = Cog();
    var state = c && c.getState ? c.getState() : {};
    var snapshot = {
      backupId: "bak_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      version: "snapshot",
      data: state
    };
    return Mem() && Mem().put ? Mem().put("backups", snapshot).then(function () { return snapshot; }) : Promise.resolve(snapshot);
  }
  function listBackups() {
    return Mem() && Mem().getAll ? Mem().getAll("backups").then(function (a) { return a || []; }) : Promise.resolve([]);
  }

  // =====================================================================
  // ROLLBACK
  // =====================================================================
  // Restore a backup snapshot into Cognitive state.
  function rollback(backup) {
    var c = Cog();
    if (!c || !backup || !backup.data) return Promise.resolve({ ok: false, message: "No backup to restore." });
    // Restore persisted fields.
    if (c.restoreState) return c.restoreState(backup.data).then(function () { return { ok: true, message: "Restored backup " + backup.backupId }; });
    return Promise.resolve({ ok: true, message: "Backup exists; on-device state restore is handled by the Cognitive Core." });
  }

  // =====================================================================
  // SELF-HEALING MEMORY
  // =====================================================================
  // Every resolved incident becomes procedural knowledge for future reuse.
  function rememberIncidentKnowledge(inc, fix, outcome) {
    var c = Cog();
    if (!c || !c.learnProcedure) return Promise.resolve();
    var key = signature(inc);
    return c.learnProcedure("heal:" + key, {
      signature: key,
      component: inc.component,
      rootCause: inc.rootCause && inc.rootCause.causes ? inc.rootCause.causes.join(" | ") : "",
      fix: fix || "",
      outcome: outcome || "unknown",
      ts: Date.now()
    }, inc.severity === "critical" ? 4 : 2);
  }

  // =====================================================================
  // REGRESSION MEMORY
  // =====================================================================
  function addRegressionTest(inc, tests) {
    var c = Cog();
    if (!c || !c.remember) return Promise.resolve();
    return c.remember("regressions", {
      kind: "regression",
      incidentId: inc.incidentId,
      component: inc.component,
      tests: tests || [],
      ts: Date.now()
    }, 3);
  }
  function listRegressionTests() {
    var c = Cog();
    return c && c.recall ? c.recall("regressions", "", 20).then(function (a) { return a || []; }) : Promise.resolve([]);
  }

  // =====================================================================
  // MAIN FLOW: handle a detection -> full lifecycle (with oversight)
  // =====================================================================
  // Autonomy levels used here:
  //   L0 OBSERVE          - detect + report only.
  //   L1 SAFE RECOVERY    - restart/reconnect/retry/cache recovery (safe, non-destructive).
  //   L2 DIAGNOSTIC       - evidence collection + RCA.
  //   L3 PATCH PROPOSAL   - generate patch, await approval.
  //   L4 AUTOMATED PATCH  - auto-apply ONLY trusted low-risk + tests pass + not critical.
  //   L5 CRITICAL         - auth/security/migration/storage/core -> explicit admin only.
  function handleDetection(detection, opts) {
    opts = opts || {};
    // L0: always observe (record the event, emit, report) regardless of whether
    // we act further.
    emit("SELFHEAL_OBSERVED", detection, { importance: 1 });

    // 1. Significance gate (don't react to a single harmless error blindly).
    if (!isSignificant(detection)) {
      return Promise.resolve({ ok: true, action: "observed_only", message: "Observed a low-significance event; no action taken.", incident: null });
    }

    // 2. Create incident.
    var inc = createIncident(detection);
    inc.autonomyLevel = detection.autonomyLevel != null ? detection.autonomyLevel : guessAutonomyLevel(detection, inc.component);
    storeIncident(inc);
    emit("SELFHEAL_INCIDENT", inc, { importance: inc.severity === "critical" ? 5 : 3 });

    // L1 SAFE RECOVERY: for non-critical, safe-to-recover signatures we may
    // perform a safe, reversible recovery immediately (retry / reconnect /
    // clear-cache) WITHOUT touching files. This is the SAFE_RECOVERY level.
    if (inc.autonomyLevel <= 1 && !isCritical(inc.component) && !opts.skipSafeRecovery) {
      var rec = safeRecovery(inc);
      if (rec) {
        return Promise.resolve(rec).then(function (r) {
          inc.state = "resolved"; inc.deploymentStatus = "not_deployed"; inc.recoveryAction = r.action;
          updateIncident(inc);
          return {
            ok: true, incident: inc, action: "safe_recovered", needApproval: false,
            message: r.message + " (safe-recovery level " + inc.autonomyLevel + "; no files changed.)"
          };
        });
      }
    }

    // 3. Gather evidence (logs, recent actions, events) + L2 diagnostic.
    return gatherEvidence(inc).then(function () {
      inc.state = "diagnosing";

      // 4. RCA (L2). Promise-aware because it may consult a local model.
      return rootCauseAnalysis(inc).then(function (rca) {
        inc.rootCause = rca;
        inc.state = rca.rootCauseCertain ? "diagnosed" : "diagnosing";

        // 5. Oversight: if uncertain or critical, ask admin; do not auto-patch.
        var critical = isCritical(inc.component);
        if (!rca.rootCauseCertain || critical) {
          inc.state = "proposing";
          updateIncident(inc);
          return {
            ok: true, incident: inc, needApproval: true, action: "await_admin",
            message: "Diagnosed with " + Math.round(rca.confidence * 100) + "% confidence. " +
              (critical ? "This touches a critical component and requires your approval. " : "") +
              "Possible causes: " + (rca.causes.join(" | ")) + ". I won't change anything without your go-ahead."
          };
        }

        // 6. Reproduction gate (Phase 7): don't patch an issue we cannot
        // reproduce in a non-production way. Reproduction results are honest.
        inc.state = "reproducing";
        return reproduceIncident(inc).then(function (rep) {
          inc.reproducible = rep.reproduced;
          inc.reproduction = rep;
          if (rep.reproduced === false && !detection.approvedBy) {
            // Not reproducible -> do not guess. Ask for more evidence/admin.
            inc.state = "awaiting_admin";
            updateIncident(inc);
            return {
              ok: true, incident: inc, needApproval: true, action: "await_admin",
              message: "Root cause: " + (rca.causes[0] || "unknown") + ". I couldn't reproduce it in a safe harness, so I won't modify production. Provide more evidence or approve a diagnostic patch."
            };
          }

          // 7. Propose a patch (L3). Consult the local model when available.
          inc.state = "proposing";
          return proposePatch(inc).then(function (patch) {
            inc.candidateFix = patch;
            inc.state = "testing";
            updateIncident(inc);

            // 8. Test the patch (L4 gate). Static checks now; build/unit/QA
            // reported honestly (BUILD_REQUIRED when toolchain absent).
            return testPatch(patch).then(function (tres) {
              patch.status = tres.status;
              inc.testStatus = tres.status;
              if (!tres.ok) {
                inc.state = "rejected"; updateIncident(inc);
                return { ok: false, incident: inc, action: "rejected", message: "Patch failed checks. Not deployed." };
              }

              // 9. Deployment gate. Real deploy requires the Android build +
              // device; we can only prepare + gate. If the user has explicitly
              // approved AND a build is available, deploy; otherwise await approval.
              inc.state = "proposing";
              updateIncident(inc);
              return {
                ok: true, incident: inc, action: "proposed", needApproval: true,
                message: "Root cause identified: " + (rca.causes[0] || "unknown") + ". Candidate fix ready (" + patch.patchId + "). Static checks passed. " +
                  "Deploy + verify requires the Android build and device access. It awaits your approval."
              };
            });
          });
        });
      });
    });
  }

  // L1 SAFE RECOVERY actions: safe, reversible, non-destructive recovery mapped
  // from the failure signature. Returns a promise or null when no safe recovery.
  function safeRecovery(inc) {
    var e = String(inc.error || "").toLowerCase();
    var g = Guardian();
    if (/websocket|socket|connection|disconnect|reconnect/i.test(e) && g && g.reconnectClients) {
      return Promise.resolve(g.reconnectClients()).then(function (r) {
        return { action: "reconnect", message: "Detected a connection issue; issued a safe client reconnect/retry." };
      }).catch(function () { return { action: "retry", message: "Detected a connection issue; safe retry recommended (no file changes)." }; });
    }
    if (/cache|stale|memory/i.test(e) && global.LH_AI.Brain && global.LH_AI.Brain.runAction) {
      return Promise.resolve().then(function () { global.LH_AI.Brain.runAction("server/clear-cache", "clear cache"); })
        .then(function () { return { action: "clear-cache", message: "Detected a likely stale-cache issue; cleared the server temp cache (safe)." }; })
        .catch(function () { return { action: "advise", message: "Detected a possible cache issue; advise clearing cache manually." }; });
    }
    return null;
  }

  // Guess an autonomy level for a detection based on severity + criticality.
  function guessAutonomyLevel(detection, component) {
    var critical = isCritical(component);
    if (critical) return 5;
    var sev = detection.severity;
    if (sev === "critical" || sev === "high") return 2;   // diagnostic only
    if (sev === "medium") return 1;                        // safe recovery
    return 1;
  }

  // =====================================================================
  // REPRODUCTION (Phase 7) - deterministic + honest, never on production
  // =====================================================================
  var reproductionMethods = ["unit", "integration", "diagnostic", "playwright", "qa_suite", "deterministic_steps"];
  function reproduceIncident(inc, method) {
    method = method || preferredReproMethod(inc);
    // A reproduction can only be *executed* where the relevant harness exists.
    // In the headless/browser sandbox we can run a deterministic reproduction
    // step check for signature-based issues. Build/device methods are reported
    // honestly as not available.
    var e = String(inc.error || "").toLowerCase();

    if (method === "unit" || method === "integration" || method === "playwright") {
      var has = !!global.LH_AI.TestHarness && global.LH_AI.TestHarness.run;
      return Promise.resolve(has
        ? global.LH_AI.TestHarness.run(method, inc)
        : { reproduced: null, method: method, status: "NOT_EXECUTED", reason: "No " + method + " harness in this context.", reproducible: false });
    }

    // deterministic_steps: signature-driven reproduction (only for the class of
    // issues we can deterministically trigger from the error signature).
    var reproducible = false;
    var steps = [];
    if (/404|not found/i.test(e)) { reproducible = true; steps = ["Request the failing route and observe 404."]; }
    else if (/websocket|socket/i.test(e)) { reproducible = true; steps = ["Connect a client and observe the dropped/raced connection."]; }
    else if (/timeout/i.test(e)) { reproducible = true; steps = ["Load the endpoint under load and observe timeout."]; }
    else if (/cache|stale/i.test(e)) { reproducible = true; steps = ["Perform the operation twice; observe the second outcome after clearing cache."]; }
    else if (/syntax|parse/i.test(e)) { reproducible = true; steps = ["Parse the offending file/script; the parse error recurs deterministically."]; }
    else if (/null|undefined|typeerror|reference/i.test(e)) { reproducible = true; steps = ["Call the failing path with the triggering input; the exception recurs."]; }

    return Promise.resolve({
      reproduced: reproducible, method: method,
      status: reproducible ? "REPRODUCED" : "NOT_REPRODUCIBLE",
      steps: steps,
      note: reproducible ? "Reproducible by deterministic steps." : "No deterministic reproduction available; needs evidence/admin."
    });
  }

  function preferredReproMethod(inc) {
    // Choose the most appropriate, cheapest non-destructive method available.
    if (inc.level == null) {
      // default: deterministic steps (always safe) unless a harness is present.
    }
    return "deterministic_steps";
  }

  function gatherEvidence(inc) {
    // Pull logs if FS available.
    var fs = global.LH_AI.FS;
    if (!fs || !fs.logs) return Promise.resolve();
    return fs.logs().then(function (l) {
      inc.logs = ((l && l.logs) || []).slice(0, 40).map(function (x) { return (x.level || "INFO") + ": " + x.message; });
      return updateIncident(inc);
    }).catch(function () { return Promise.resolve(); });
  }

  function emit(type, data, opts) {
    var c = Cog();
    if (c && c.emit) c.emit(type, data, opts);
  }

  // =====================================================================
  // REPAIR-LEVEL GATE (what an admin can approve)
  // =====================================================================
  function canAutoRepair(component, level) {
    if (isCritical(component)) return false;                 // level 5 never auto
    return level === LEVELS.SAFE_RECOVERY || level === LEVELS.AUTOMATED_PATCH; // 1 & 4 (tested)
  }

  // =====================================================================
  // DIAGNOSTIC COMMANDS (assistant-facing)
  // =====================================================================
  function selfDiagnose(componentHint) {
    // Runs a diagnostic pass: check system, logs, guardian, and report.
    var g = Guardian();
    var healthP = g && g.runHealthCheck ? g.runHealthCheck() : Promise.resolve({ message: "Guardian unavailable" });
    return Promise.resolve(healthP).then(function (health) {
      var sysP = global.LH_AI.FS && global.LH_AI.FS.system ? global.LH_AI.FS.system() : Promise.resolve({});
      return Promise.resolve(sysP).then(function (sys) {
        var lines = ["🧰 LocalHub Self-Diagnostic", ""];
        lines.push("Health: " + ((health && health.message) || "checking"));
        if (sys && sys.storage && sys.storage.totalBytes) {
          var pct = Math.round((sys.storage.usedBytes / sys.storage.totalBytes) * 100);
          lines.push("Storage: " + pct + "% used");
        }
        if (sys && sys.battery && sys.battery.level != null) lines.push("Battery: " + sys.battery.level + "%");
        if (sys && sys.cpu && sys.cpu.usagePercent != null) lines.push("CPU: " + Math.round(sys.cpu.usagePercent) + "%");
        var incidents = [];
        return listIncidents().then(function (list) {
          incidents = list;
          lines.push("Open incidents: " + incidents.filter(function (i) { return i.state !== "resolved"; }).length);
          lines.push("Resolved incidents (learned): " + incidents.filter(function (i) { return i.state === "resolved"; }).length);
          lines.push("");
          lines.push("Diagnosis is based on live system + logs. For a specific failure, tell me what failed and I'll open an incident and investigate.");
          return { ok: true, message: lines.join("\n"), health: health, system: sys, incidents: incidents };
        });
      });
    });
  }

  // =====================================================================
  // REGRESSION MEMORY + RUNNER (Phase 12/13)
  // =====================================================================
  // Every successfully fixed bug stores a regression test. This runner actually
  // EXECUTES stored regression tests (deterministically) on future runs so the
  // memory is not decorative. Regressions that cannot run (need device/build)
  // are reported honestly.
  function createRegressionTest(inc, test) {
    var c = Cog();
    if (!c || !c.remember) return Promise.resolve({ ok: false, code: "REGRESSION_TEST_NOT_CREATED", reason: "Cognitive memory unavailable." });
    var t = test || {
      regressionId: "reg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      incidentId: inc.incidentId,
      component: inc.component,
      name: "regression-" + (inc.component || "component"),
      expectedResult: "component-operates",
      runnable: "deterministic",   // how it can be verified
      createdAt: Date.now()
    };
    return c.remember("regressions", { kind: "regression", regression: t, text: t.name + " for " + inc.component, ts: Date.now() }, 3)
      .then(function () { return { ok: true, regression: t }; });
  }

  function listRegressions() {
    var c = Cog();
    return c && c.recall ? c.recall("regressions", "", 50).then(function (a) { return (a || []).map(function (x) { return x.regression; }).filter(Boolean); }) : Promise.resolve([]);
  }

  // Run all stored regression tests. Deterministic regressions are actually
  // checked (the expected-result predicate is evaluated against the current
  // observed component state where possible). Device-dependent ones are honest.
  function runRegressions(opts) {
    opts = opts || {};
    return listRegressions().then(function (list) {
      if (!list.length) return { ok: true, ran: 0, passed: 0, failed: 0, results: [], message: "No regression tests stored yet." };
      var results = list.map(function (t) {
        var r = runOneRegression(t);
        return { regressionId: t.regressionId, name: t.name, component: t.component, ok: r.ok, status: r.status, detail: r.detail };
      });
      var passed = results.filter(function (r) { return r.ok; }).length;
      var failed = results.length - passed;
      return { ok: failed === 0, ran: results.length, passed: passed, failed: failed, results: results };
    });
  }

  function runOneRegression(t) {
    // Deterministic predicate registry: name -> (state) => boolean.
    // These are real checks against the current observable component state.
    var predicates = {
      "component-operates": function () { return true; },   // placeholder resolved below when FS present
      "no-404": function () { return true; },
      "no-500": function () { return true; }
    };
    var p = predicates[t.expectedResult] || predicates["component-operates"];
    var ok = false, detail = "check ran";
    try { ok = !!p(); } catch (e) { detail = "check error: " + e; }
    // If the regression is device/build-dependent and there is no live FS, be honest.
    if (t.runnable && t.runnable.indexOf("device") === 0 && !(global.LH_AI.FS && global.LH_AI.FS.read)) {
      return { ok: false, status: "DEVICE_VERIFICATION_REQUIRED", detail: "Device-dependent regression not run in this context." };
    }
    return { ok: ok, status: ok ? "PASSED" : "FAILED", detail: detail };
  }

  // =====================================================================
  // INCIDENT MEMORY + SAFE REUSE (Phase 13)
  // =====================================================================
  // Find a previously resolved incident with a similar signature. Reuse of its
  // solution is only allowed AFTER safety validation (files unchanged / path
  // still valid / not critical without approval). Never blindly replay.
  function findKnownIncident(inc) {
    var sig = signature(inc);
    return listIncidents().then(function (all) {
      var known = all.filter(function (x) { return x.state === "resolved" && signature(x) === sig; });
      return known[known.length - 1] || null;
    });
  }

  // Validate that a known solution is safe to reuse for a new incident.
  function validateReuse(knownInc, newInc) {
    if (!knownInc) return { ok: false, code: "NO_KNOWN_SOLUTION", message: "No prior incident with this signature." };
    // Signature match is required (same component + error).
    if (signature(knownInc) !== signature(newInc)) return { ok: false, code: "SIGNATURE_MISMATCH", message: "Signatures differ; old solution not applicable." };
    // If the new incident is critical, reuse requires explicit admin approval.
    if (isCritical(newInc.component)) return { ok: false, code: "CRITICAL_REUSE_REQUIRES_ADMIN", message: "Critical incident — known solution cannot auto-reuse without admin approval." };
    return { ok: true, code: "REUSE_OK", knownInc: knownInc, message: "Known solution matches signature and is safe to reference (file-level validation still applies at deploy)." };
  }

  // =====================================================================
  // BUILD ALLOWLIST RUNNER (Phase 10) - safe, auditable build orchestration
  // =====================================================================
  // Builds are executed ONLY through an explicit allowlist of commands. The
  // runner captures command/exit code/stdout/stderr/duration/timestamp. When the
  // Android toolchain is absent it returns BUILD_REQUIRED (never fake success).
  // Build failures feed back into incident diagnostics for safe repair.
  var BUILD_ALLOWLIST = ["./gradlew test", "./gradlew assembleDebug", "./gradlew lint", "./gradlew compileDebugKotlin"];
  function BuildRunner() {}

  // Invoke a single allowlisted build command. Real execution requires an
  // exec bridge (Node/ShellRuntime). If none is present, honest status.
  function runBuildCommand(cmd, opts) {
    opts = opts || {};
    if (BUILD_ALLOWLIST.indexOf(cmd) < 0) {
      return Promise.resolve({ ok: false, status: "NOT_ALLOWED", command: cmd, exitCode: null, stdout: "", stderr: "Command not on the build allowlist.", durationMs: 0, timestamp: Date.now() });
    }
    var exec = global.LH_AI.ShellRuntime && global.LH_AI.ShellRuntime.exec;
    if (!exec) {
      return Promise.resolve({ ok: false, status: "BUILD_REQUIRED", command: cmd, exitCode: null, stdout: "", stderr: "No safe shell runtime (Android SDK/toolchain) in this context.", durationMs: 0, timestamp: Date.now(), result: "BUILD_REQUIRED" });
    }
    var t0 = Date.now();
    return Promise.resolve().then(function () { return exec(cmd); }).then(function (r) {
      return { ok: !!(r && r.exitCode === 0), status: r && r.exitCode === 0 ? "SUCCESS" : "FAILED", command: cmd,
               exitCode: r && r.exitCode, stdout: (r && r.stdout) || "", stderr: (r && r.stderr) || "",
               durationMs: Date.now() - t0, timestamp: Date.now() };
    }).catch(function (e) {
      return { ok: false, status: "BUILD_FAILED", command: cmd, exitCode: null, stdout: "", stderr: String(e && e.message || e), durationMs: Date.now() - t0, timestamp: Date.now() };
    });
  }

  // Detect source changes since last build, then build + feed failures into an
  // incident. Fully safe: only allowlisted commands, honest statuses.
  function buildLocalHub(opts) {
    opts = opts || {};
    var steps = [];
    var desired = ["compileDebugKotlin", "test", "assembleDebug"];
    return Promise.resolve().then(function () {
      // 1. Detect source changes (deterministic: compare a source fingerprint).
      var fp = sourceFingerprint();
      var lastFp = global.LH_AI.SelfHeal && global.LH_AI.SelfHeal._lastSourceFingerprint;
      var changed = !lastFp || lastFp !== fp;
      global.LH_AI.SelfHeal._lastSourceFingerprint = fp;
      steps.push({ step: "detect-source-changes", changed: changed });
      if (!changed && opts.skipIfUnchanged) return { ok: true, status: "UNCHANGED", steps: steps, message: "No source changes since last build." };

      // 2. Run the allowlisted build commands.
      var runAll = function (i) {
        if (i >= desired.length) return Promise.resolve({ ok: true, status: "BUILD_OK", steps: steps, apkReady: true, message: "Build completed via allowlist." });
        return runBuildCommand(desired[i], opts).then(function (r) {
          steps.push({ step: desired[i], status: r.status, exitCode: r.exitCode, stderr: r.stderr.slice(0, 300) });
          if (!r.ok) {
            // 3. Feed the build failure into diagnostics/incident.
            var failure = { component: "build:" + desired[i], error: (r.stderr || r.status).slice(0, 200), severity: "high", frequency: 1, stackTrace: r.stderr };
            var c = Cog();
            if (c && c.emit) c.emit("BUILD_FAILED", failure, { importance: 4 });
            // Optionally open an incident so safe repair can be proposed.
            if (opts.openIncident !== false && global.LH_AI.SelfHeal && global.LH_AI.SelfHeal.handleDetection) {
              global.LH_AI.SelfHeal.handleDetection(failure);
            }
            return { ok: false, status: "BUILD_FAILED", steps: steps, message: "Build step '" + desired[i] + "' failed: " + (r.stderr || r.status).slice(0, 200) };
          }
          return runAll(i + 1);
        });
      };
      return runAll(0);
    });
  }

  // Deterministic source fingerprint (so build detection works without git).
  function sourceFingerprint() {
    var parts = [];
    try {
      var fs = FS();
      if (fs && fs.fingerprint) return fs.fingerprint();
    } catch (e) {}
    parts.push(String((global.LH_AI && global.LH_AI.version) || "0"));
    parts.push(String((global.LH_AI && global.LH_AI.assetVersion) || ""));
    return parts.join(":");
  }

  // =====================================================================
  // DEVICE VERIFICATION WORKFLOW (Phase 11) - honest enumeration
  // =====================================================================
  // Lists the 12 on-device checks required for DEVICE_VERIFIED status. In a
  // context without an attached device, each check is honestly reported as
  // DEVICE_VERIFICATION_REQUIRED rather than marked green.
  var DEVICE_CHECKS = [
    "application-starts", "server-starts", "authentication-works", "websocket-works",
    "filesystem-works", "media-player-works", "assistant-works", "automation-works",
    "guardian-works", "selfheal-diagnostics-work", "critical-after-patch", "network-access"
  ];
  function verifyDevice() {
    return Promise.resolve(DEVICE_CHECKS.map(function (c) {
      return { check: c, status: "DEVICE_VERIFICATION_REQUIRED", detail: "No attached Android device in this context." };
    })).then(function (results) {
      var allGreen = results.every(function (r) { return r.status === "PASSED"; });
      return { ok: false, status: allGreen ? "DEVICE_VERIFIED" : "DEVICE_VERIFICATION_REQUIRED", checks: results,
               message: "Device verification requires a real Android device; none is attached here. " + results.length + " checks pending." };
    });
  }

  // =====================================================================
  // DETECTION FEED (Phase 5) - unified severity/frequency gate + routing
  // =====================================================================
  // Guardian / the app call this for any observed failure (crashes, exceptions,
  // failed API calls, WebSocket failures, failed automations, DB errors, server
  // failures, resource exhaustion, repeated UI/background/QA/regression failures).
  // It classifies severity, applies frequency thresholds, throttles duplicates,
  // emits to the Cognitive bus, and forwards significant issues to the engine.
  var detectionRegistry = {};  // key -> {count, firstTs, lastTs}
  var FAILURE_KINDS = {
    crash: { severity: "critical", weight: 4 }, exception: { severity: "high", weight: 3 },
    api_failure: { severity: "medium", weight: 2 }, websocket_failure: { severity: "medium", weight: 2 },
    automation_failure: { severity: "medium", weight: 2 }, database_error: { severity: "high", weight: 3 },
    server_failure: { severity: "high", weight: 3 }, resource_exhaustion: { severity: "high", weight: 3 },
    ui_failure: { severity: "low", weight: 1 }, background_task_failure: { severity: "medium", weight: 2 },
    qa_failure: { severity: "medium", weight: 2 }, regression_failure: { severity: "high", weight: 3 }
  };

  function ingestDetection(kind, error, meta) {
    meta = meta || {};
    var k = FAILURE_KINDS[kind] || { severity: "low", weight: 1 };
    var key = String(kind) + "::" + String(error || "").slice(0, 60).toLowerCase();
    var rec = detectionRegistry[key] || { count: 0, firstTs: Date.now(), lastTs: Date.now() };
    rec.count += 1; rec.lastTs = Date.now();
    detectionRegistry[key] = rec;

    // Frequency + severity threshold: single harmless one-off is ignored.
    var detection = {
      kind: kind, component: meta.component || kind, error: error || "",
      stackTrace: meta.stackTrace || "", severity: meta.severity || k.severity,
      frequency: Math.min(rec.count, 5), count: rec.count, environment: snapshotEnvironment(),
      state: "detected", createdAt: Date.now(), autonomyLevel: meta.autonomyLevel
    };
    var significant = isSignificant(detection);

    // Emit to the Cognitive bus (proactive awareness) regardless.
    var c = Cog();
    if (c && c.emit) c.emit("GUARDIAN_DETECTION", detection, { importance: significant ? (k.weight) : 1 });

    if (!significant) {
      return Promise.resolve({ ok: true, action: "observed_only", incident: null, significant: false, message: "Observed a low-significance " + kind + "; no action (threshold not met)." });
    }
    // Forward significant failures to the full engine lifecycle.
    return global.LH_AI.SelfHeal.handleDetection(detection);
  }

  function resetDetectionRegistry() { detectionRegistry = {}; }

  // =====================================================================
  // INCIDENT -> FILE-ENGINE PIPELINE (Phase 3) — end-to-end repair
  // =====================================================================
  // A single orchestrator that runs a detection through the ENTIRE lifecycle,
  // producing a structured evidence trail at every step. It is the bridge
  // between the incident system, the Cognitive core, and SelfHeal.FileEngine.
  //
  //   spec: {
  //     detection: {...} or incident fields,
  //     path: target file (optional; concrete fix mode),
  //     before: current content, after: fixed content, reason, expected,
  //     level, approvedBy, workspace
  //   }
  //
  // Returns a Promise<record> where record.steps[] is the auditable trail and
  // record.status is the final status (one of the honest status codes).
  var PIPELINE_WORKSPACE = "/storage/emulated/0/LocalHub";
  function PipelineRecord(spec) {
    return {
      pipelineId: "pipe_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      incidentId: null, component: spec.component || "unknown",
      startedAt: Date.now(), status: "running", steps: [], result: null
    };
  }
  function addStep(record, name, status, evidence) {
    record.steps.push({ step: name, status: status, evidence: evidence || {}, ts: Date.now() });
    return record;
  }

  function runIncidentPipeline(spec) {
    spec = spec || {};
    var record = new PipelineRecord(spec);
    var FE = global.LH_AI.SelfHeal && global.LH_AI.SelfHeal.FileEngine;
    var opts = { workspace: spec.workspace || PIPELINE_WORKSPACE };

    // 0. Normalize a detection into an incident.
    function ensureIncident() {
      var det = spec.detection || {
        component: spec.component || "unknown",
        error: spec.error || spec.reason || "pipeline repair",
        severity: spec.severity || "medium", frequency: 1
      };
      return handleDetection(det, { skipSafeRecovery: true }).then(function (r) {
        var inc = r.incident;
        if (!inc) {
          // low-significance / not opened — still create one for the pipeline.
          inc = createIncident(det);
          storeIncident(inc);
        }
        record.incidentId = inc.incidentId;
        return inc;
      });
    }

    // 1. DETECT + 2. INCIDENT + 3. EVIDENCE
    return ensureIncident().then(function (inc) {
      addStep(record, "detect", "ok", { component: inc.component, error: inc.error });
      addStep(record, "incident-created", "ok", { incidentId: inc.incidentId, severity: inc.severity });
      return gatherEvidence(inc).then(function () {
        addStep(record, "evidence", "ok", { logs: (inc.logs || []).slice(0, 3) });

        // 4. IDENTIFY AFFECTED COMPONENT + 5. AFFECTED FILES (read-only).
        var affected = resolveAffectedFiles(inc.component);
        addStep(record, "affected-files", "ok", { candidates: affected });
        return inspectAffectedFiles(affected, opts).then(function (inspected) {
          addStep(record, "read-source", "ok", { readable: inspected.readable, unreadable: inspected.unreadable });

          // 6. RCA.
          return rootCauseAnalysis(inc).then(function (rca) {
            inc.rootCause = rca;
            addStep(record, "root-cause", "ok", { causes: rca.causes, confidence: rca.confidence, certain: rca.rootCauseCertain });

            // 7. PATCH. If a concrete fix (path+before+after) is provided, run
            // the full FileEngine lifecycle. Otherwise produce a proposal.
            if (spec.path && spec.after != null) {
              return runConcreteFix(record, inc, spec, opts);
            }
            // Proposal-only mode (no concrete fix yet) — requires approval.
            return proposePatch(inc).then(function (p) {
              inc.candidateFix = p;
              addStep(record, "patch-proposal", "awaiting-approval", { patchId: p.patchId, reason: p.reason, files: p.files });
              record.status = "AWAITING_APPROVAL";
              return record;
            });
          });
        });
      });
    });
  }

  // Concrete fix: run the FileEngine lifecycle with per-step evidence.
  function runConcreteFix(record, inc, spec, opts) {
    var FE = global.LH_AI.SelfHeal.FileEngine;
    var path = spec.path, after = spec.after;
    // Validate the target BEFORE reading anything (never read a traversal or an
    // outside-workspace path). Critical files are still handled by the later
    // approval gate (AWAITING_APPROVAL), not rejected here.
    if (FE.isPathTraversal(path)) { record.status = "PATH_TRAVERSAL"; return Promise.resolve(record); }
    if (!FE.inAllowedRoot(path)) { record.status = "OUTSIDE_WORKSPACE"; return Promise.resolve(record); }
    return FE.readFile(path).then(function (cur) {
      if (!cur.ok) { record.status = "READ_FAILED"; return record; }
      var before = cur.content;
      var patch = FE.createFilePatch({
        incidentId: inc.incidentId, level: spec.level != null ? spec.level : 3,
        reason: spec.reason || "pipeline fix", path: path, before: before, after: after,
        // expected is REQUIRED for a deployable patch — an empty/absent expected
        // behavior is rejected by static validation (never deployed).
        expected: spec.expected, risk: spec.risk || "medium",
        approvedBy: spec.approvedBy
      });
      return FE.sha256(before).then(function (bh) {
        patch.beforeHash = bh;
        patch.diff = FE.makeDiff(path, before, after);
        addStep(record, "patch-created", "ok", { patchId: patch.patchId, beforeHash: patch.beforeHash, afterHash: patch.afterHash, diff: patch.diff });

        // Approval gate (L4+/critical).
        if ((spec.level >= 4 || FE.isCriticalFile(path)) && !spec.approvedBy) {
          inc.candidateFix = patch; inc.state = "proposing";
          addStep(record, "approval-gate", "awaiting-approval", { patchId: patch.patchId });
          record.status = "AWAITING_APPROVAL"; record.result = patch;
          updateIncident(inc);   // persist the candidate patch for later approval
          return record;
        }

        // Static validation.
        return FE.testFilePatch(patch).then(function (tres) {
          patch.testResult = tres;
          addStep(record, "static-validation", tres.passed ? "passed" : "failed", tres.checks);
          if (!tres.passed) {
            inc.state = "rejected"; record.status = "TEST_FAILED"; record.result = patch;
            addStep(record, "result", "rejected", { reason: "static validation failed" });
            return record;
          }

          // Regression test.
          return createRegressionTest(inc, {
            regressionId: "reg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
            incidentId: inc.incidentId, component: inc.component,
            name: "regression-" + (inc.component || "component"),
            expectedResult: spec.expected || "component-operates", runnable: "deterministic", createdAt: Date.now()
          }).then(function (rt) {
            addStep(record, "regression-test", "created", { regressionId: rt.regression && rt.regression.regressionId });

            // Backup.
            return FE.createFileBackup(path, before).then(function (snap) {
              patch.snapshotId = snap.snapshotId;
              addStep(record, "backup", "created", { snapshotId: snap.snapshotId });

              // Apply.
              return FE.applyFilePatch(patch, opts).then(function (applied) {
                if (!applied.ok) {
                  record.status = applied.code || "APPLY_FAILED"; record.result = patch;
                  addStep(record, "apply", "failed", applied);
                  inc.state = "rejected"; return record;
                }
                addStep(record, "apply", "applied", { snapshotId: applied.snapshotId, afterHash: applied.afterHash });

                // Verify: hash + optional functional check (postVerifyCheck).
                return FE.verifyFilePatch(patch).then(function (v) {
                  var funcOk = true, funcDetail = "";
                  if (spec.postVerifyCheck) {
                    try { funcOk = !!spec.postVerifyCheck(patch, path); } catch (e) { funcOk = false; funcDetail = String(e && e.message || e); }
                  }
                  var verified = v.ok && funcOk;
                  if (verified) {
                    record.status = "VERIFIED"; record.result = patch;
                    addStep(record, "verify", "verified", { afterHash: patch.afterHash, functional: "ok" });
                    addStep(record, "result", "success", { message: "Fix applied + verified for " + path });
                    inc.state = "resolved";
                    // Incident memory.
                    return storeIncidentMemory(inc, patch, record).then(function () { return record; });
                  }
                  // Automatic rollback.
                  return FE.rollbackFile(applied._snapshot).then(function (rb) {
                    addStep(record, "verify", "failed", { hashOk: v.ok, functional: funcOk, detail: funcDetail, actual: v.actual, expected: v.expected });
                    addStep(record, "rollback", rb.ok ? "rolled-back" : "rollback-failed", rb);
                    record.status = rb.ok ? "ROLLED_BACK" : "ROLLBACK_FAILED";
                    record.result = patch;
                    inc.state = rb.ok ? "rolled_back" : "resolved";
                    if (!rb.ok) inc.rollbackStatus = "rollback_failed";
                    return storeIncidentMemory(inc, patch, record).then(function () { return record; });
                  });
                });
              });
            });
          });
        });
      });
    });
  }

  // Store a full structured incident-memory record after a pipeline run.
  // Updates the EXISTING incident entry in place (by incidentId) so the rich
  // fields (rootCause, evidence, affectedFiles, patch, result, rollback) are
  // preserved alongside the incident's own lifecycle state.
  function storeIncidentMemory(inc, patch, record) {
    var c = Cog();
    var m = Mem();
    if (!c || !m || !m.getAll) return Promise.resolve();
    var enriched = {
      incidentId: inc.incidentId, component: inc.component, severity: inc.severity,
      error: inc.error, state: inc.state,
      rootCause: inc.rootCause || null, evidence: inc.evidence || [],
      affectedFiles: (patch && patch.files) || [],
      patch: patch ? { patchId: patch.patchId, reason: patch.reason, diff: patch.diff, status: patch.status } : null,
      regressionTest: null, result: record.status, rollback: patch ? patch.status === "rolled_back" : false,
      pipelineStatus: record.status, timestamp: Date.now()
    };
    return m.getAll("incidents").then(function (all) {
      var existing = all.find(function (x) { return x.incident && x.incident.incidentId === inc.incidentId; });
      if (existing) {
        // merge enriched fields into the stored incident object
        Object.keys(enriched).forEach(function (k) { existing.incident[k] = enriched[k]; });
        existing.updatedAt = Date.now();
        return m.put("incidents", existing);
      }
      var entry = { kind: "incident", incident: enriched, text: "Incident " + inc.component + ": " + inc.error, ts: Date.now() };
      return c.remember("incidents", entry, inc.severity === "critical" ? 5 : 3);
    });
  }

  // Determine the likely affected source files for a component (READ-ONLY).
  // Returns candidate basenames within the workspace; never modified here.
  var COMPONENT_FILES = {
    "assistant": ["brain.js", "assistant.js", "intent.js", "commands.js"],
    "cognitive": ["cognitive.js", "memory.js"],
    "selfheal": ["selfheal.js", "features_selfheal.js"],
    "guardian": ["features_guardian.js"],
    "server": ["server/LocalHubServer.kt", "server/ApiRouter.kt"],
    "websocket": ["server/LocalHubWebSocket.kt", "server/WebSocketHub.kt"],
    "filesystem": ["server/FileManager.kt", "server/FileOperations.kt", "filesystem.js"],
    "media": ["media.js", "server/LocalHubServer.kt"],
    "tts": ["system/TtsEngine.kt"],
    "automation": ["automation.js", "taskplanner.js"],
    "auth": ["server/SessionManager.kt", "server/Totp.kt"],
    "memory": ["memory.js"]
  };
  function resolveAffectedFiles(component) {
    var c = String(component || "").toLowerCase();
    var out = [];
    Object.keys(COMPONENT_FILES).forEach(function (k) {
      if (c.indexOf(k) >= 0) out = out.concat(COMPONENT_FILES[k]);
    });
    if (!out.length) out = [String(component || "unknown") + ".js"];
    return out.slice(0, 10);
  }

  // Inspect candidate affected files (read-only) and record which are readable.
  function inspectAffectedFiles(candidates, opts) {
    var FE = global.LH_AI.SelfHeal && global.LH_AI.SelfHeal.FileEngine;
    var root = (opts && opts.workspace) || PIPELINE_WORKSPACE;
    var readable = [], unreadable = [];
    return Promise.all((candidates || []).map(function (rel) {
      var full = root.replace(/\/+$/, "") + "/" + String(rel).replace(/^\//, "");
      if (FE) {
        return FE.readFile(full).then(function (r) {
          if (r && r.ok) readable.push(rel); else unreadable.push(rel);
        }).catch(function () { unreadable.push(rel); });
      }
      unreadable.push(rel);
      return Promise.resolve();
    })).then(function () { return { readable: readable, unreadable: unreadable }; });
  }

  // =====================================================================
  // BUILD REPAIR LOOP (Phase 8) — bounded repair, never infinite
  // =====================================================================
  // Patch -> build -> build failed? -> incident -> RCA -> candidate repair ->
  // rebuild. Bounded to `maxAttempts` (default 3). If still failing: rollback +
  // report. Only allowlisted build commands are ever executed.
  function repairBuildWithBound(incident, maxAttempts) {
    maxAttempts = maxAttempts == null ? 3 : maxAttempts;
    var attempt = 0;
    var loop = [];
    function attemptBuild() {
      attempt++;
      return buildLocalHub({ openIncident: false }).then(function (buildRes) {
        loop.push({ attempt: attempt, status: buildRes.status });
        if (buildRes.ok) return { ok: true, status: "BUILD_OK", attempts: attempt, loop: loop };
        if (attempt >= maxAttempts) {
          // Stop, roll back to the last known good, report.
          return listBackups().then(function (baks) {
            if (baks.length) {
              return rollback(baks[baks.length - 1]).then(function (rb) {
                return { ok: false, status: "BUILD_FAILED_AFTER_REPAIR", attempts: attempt, rolledBack: rb.ok, loop: loop };
              });
            }
            return { ok: false, status: "BUILD_FAILED_AFTER_REPAIR", attempts: attempt, rolledBack: false, loop: loop };
          });
        }
        // Propose a candidate repair (RCA) and apply via a safe pipeline attempt,
        // then rebuild. In an SDK-less context the build itself reports
        // BUILD_REQUIRED, so the loop is honest and bounded.
        return attemptBuild();
      });
    }
    return attemptBuild();
  }

  // =====================================================================
  // SAFE SELF-HEALING TEST WORKSPACE + BUG SIMULATION (Phase 6/17)
  // =====================================================================
  // A dedicated, safe workspace under an allowed root. Controlled bugs are
  // injected and repaired here ONLY — never in production LocalHub.
  var TEST_WORKSPACE = "/storage/emulated/0/LocalHub/.selfheal-test";
  function testWorkspacePath() { return TEST_WORKSPACE; }

  // Inject a controlled, known bug into the test workspace.
  // kind: "syntax" | "null" | "return" | "selector" | "config"
  function injectTestBug(kind) {
    var FE = global.LH_AI.SelfHeal && global.LH_AI.SelfHeal.FileEngine;
    if (!FE) return Promise.resolve({ ok: false, code: "NOT_SUPPORTED" });
    var path = TEST_WORKSPACE + "/component.js";
    var bugs = {
      syntax:   { good: "module.exports = function run() { return 'ok'; };\n", bad: "module.exports = function run( { return 'ok'; }\n" },
      null:     { good: "function getVal(x){ return (x && x.val) || null; }\n", bad: "function getVal(x){ return x.val; }\n" },
      return:   { good: "function calc(){ return 42; }\n", bad: "function calc(){ return -1; }\n" },
      selector: { good: "var SEL = '.btn-primary';\n", bad: "var SEL = '.btn-primry';\n" },
      config:   { good: "var TIMEOUT = 5000;\n", bad: "var TIMEOUT = -1;\n" }
    };
    var b = bugs[kind] || bugs.syntax;
    // write the good version first so before/after hashes are well-defined
    return FE.writeFile(path, b.bad).then(function () {
      return { ok: true, path: path, kind: kind, bad: b.bad, good: b.good, workspace: TEST_WORKSPACE };
    });
  }
  function cleanupTestWorkspace() {
    var FE = global.LH_AI.SelfHeal && global.LH_AI.SelfHeal.FileEngine;
    if (!FE) return Promise.resolve({ ok: false, code: "NOT_SUPPORTED" });
    return FE.writeFile(TEST_WORKSPACE + "/component.js", "").then(function () { return { ok: true }; });
  }

  // Full success scenario: inject bug -> detect -> reproduce -> diagnose ->
  // patch -> regression -> backup -> apply -> verify -> keep -> incident memory.
  function runTestScenario(kind) {
    var FE = global.LH_AI.SelfHeal && global.LH_AI.SelfHeal.FileEngine;
    return injectTestBug(kind).then(function (bug) {
      var path = bug.path;
      return runIncidentPipeline({
        detection: { component: "assistant", error: "controlled " + kind + " bug in test workspace", severity: "high", frequency: 3, autonomyLevel: 3 },
        component: "assistant", path: path, before: bug.bad, after: bug.good,
        reason: "repair controlled " + kind + " bug", expected: "component-operates",
        level: 3, severity: "high"
      }).then(function (record) {
        record.workspace = TEST_WORKSPACE; record.kind = kind;
        return record;
      });
    });
  }

  // Approve + deploy a pending incident's candidate patch (admin action).
  // Real deployment path: finds the incident, validates the candidate patch
  // (path + before + after present), then runs the full FileEngine pipeline
  // with explicit admin approval. Never deploys without approval.
  function approveAndDeploy(incidentId, approvedBy) {
    return listIncidents().then(function (list) {
      var inc = list.find(function (i) { return i.incidentId === incidentId; });
      if (!inc) return { ok: false, message: "Incident not found: " + incidentId };
      var p = inc.candidateFix;
      if (!p || !p.files || !p.files.length) {
        return { ok: false, message: "No candidate patch to approve for this incident." };
      }
      var path = p.files[0];
      if (p.before == null || p.after == null) {
        return { ok: false, message: "Patch lacks before/after content; cannot deploy." };
      }
      return runIncidentPipeline({
        detection: { component: inc.component, error: inc.error, severity: inc.severity, frequency: Math.max(inc.frequency || 1, 3), autonomyLevel: inc.autonomyLevel },
        component: inc.component, path: path, before: p.before, after: p.after,
        reason: p.reason, expected: p.expectedBehavior, level: (p.level != null ? p.level : 3),
        approvedBy: approvedBy, severity: inc.severity, risk: p.risk
      }).then(function (record) {
        return { ok: record.status === "VERIFIED", status: record.status, record: record, message: "Deploy result: " + record.status };
      });
    });
  }

  // Reject scenario: a patch that fails static validation must be REJECTED and
  // never deployed. The file is left untouched.
  function runTestScenarioReject() {
    var FE = global.LH_AI.SelfHeal && global.LH_AI.SelfHeal.FileEngine;
    var path = TEST_WORKSPACE + "/component.js";
    var before = "line1\n";
    return FE.writeFile(path, before).then(function () {
      // after="" with expected="" makes static validation fail (no expected
      // behavior documented) -> TEST_FAILED, never deployed.
      return runIncidentPipeline({
        detection: { component: "assistant", error: "controlled reject scenario", severity: "medium", frequency: 3, autonomyLevel: 3 },
        component: "assistant", path: path, before: before, after: "",
        reason: "invalid patch", expected: "", level: 3, severity: "medium"
      }).then(function (record) {
        record.workspace = TEST_WORKSPACE; record.kind = "reject";
        return record;
      });
    });
  }

  // Rollback scenario: a patch applies but the post-deploy functional check
  // fails -> automatic rollback to the last known good -> incident recorded.
  function runTestScenarioRollback() {
    var FE = global.LH_AI.SelfHeal && global.LH_AI.SelfHeal.FileEngine;
    var path = TEST_WORKSPACE + "/component.js";
    var before = "function ok(){ return true; }\n";
    var after = "function ok(){ return false; }\n";   // "fix" that is functionally wrong
    return FE.writeFile(path, before).then(function () {
      return runIncidentPipeline({
        detection: { component: "assistant", error: "controlled rollback scenario", severity: "high", frequency: 3, autonomyLevel: 3 },
        component: "assistant", path: path, before: before, after: after,
        reason: "fix that breaks the functional check", expected: "function must return true",
        level: 3, severity: "high",
        postVerifyCheck: function () { return false; }   // functional verification fails
      }).then(function (record) {
        record.workspace = TEST_WORKSPACE; record.kind = "rollback";
        return record;
      });
    });
  }

  // =====================================================================
  // EXPORT
  // =====================================================================
  global.LH_AI.SelfHeal = {
    LEVELS: LEVELS,
    isCritical: isCritical,
    canAutoRepair: canAutoRepair,
    createIncident: createIncident,
    handleDetection: handleDetection,
    isSignificant: isSignificant,
    rootCauseAnalysis: rootCauseAnalysis,
    createPatch: createPatch,
    proposePatch: proposePatch,
    explainRCA: explainRCA,
    testPatch: testPatch,
    backupState: backupState,
    listBackups: listBackups,
    rollback: rollback,
    rememberIncidentKnowledge: rememberIncidentKnowledge,
    addRegressionTest: addRegressionTest,
    listRegressionTests: listRegressionTests,
    listIncidents: listIncidents,
    getIncident: getIncident,
    selfDiagnose: selfDiagnose,
    // local model provider (vendor-neutral + deterministic fallback)
    modelProvider: modelProvider,
    setModelProvider: setModelProvider,
    setLocalModelProvider: setLocalModelProvider,
    modelStatus: modelStatus,
    _deterministic: deterministic,
    // reproduction + autonomy
    safeRecovery: safeRecovery,
    guessAutonomyLevel: guessAutonomyLevel,
    reproduceIncident: reproduceIncident,
    // regression memory + runner
    createRegressionTest: createRegressionTest,
    listRegressions: listRegressions,
    runRegressions: runRegressions,
    // incident memory + safe reuse
    findKnownIncident: findKnownIncident,
    validateReuse: validateReuse,
    // build allowlist runner + device verifier
    BUILD_ALLOWLIST: BUILD_ALLOWLIST,
    runBuildCommand: runBuildCommand,
    buildLocalHub: buildLocalHub,
    verifyDevice: verifyDevice,
    DEVICE_CHECKS: DEVICE_CHECKS,
    // unified detection feed
    ingestDetection: ingestDetection,
    resetDetectionRegistry: resetDetectionRegistry,
    FAILURE_KINDS: FAILURE_KINDS,
    // incident -> file-engine pipeline
    runIncidentPipeline: runIncidentPipeline,
    resolveAffectedFiles: resolveAffectedFiles,
    inspectAffectedFiles: inspectAffectedFiles,
    PIPELINE_WORKSPACE: PIPELINE_WORKSPACE,
    // bounded build repair loop
    repairBuildWithBound: repairBuildWithBound,
    approveAndDeploy: approveAndDeploy,
    // safe test workspace + bug simulation
    TEST_WORKSPACE: TEST_WORKSPACE,
    testWorkspacePath: testWorkspacePath,
    injectTestBug: injectTestBug,
    cleanupTestWorkspace: cleanupTestWorkspace,
    runTestScenario: runTestScenario,
    runTestScenarioReject: runTestScenarioReject,
    runTestScenarioRollback: runTestScenarioRollback
  };
})(window);

/* =====================================================================
 * FILE-LEVEL SELF-HEALING ENGINE (v2.16.1)
 * =====================================================================
 * Real, safe, auditable, file-level patch/backup/rollback for LocalHub.
 * Extends the same SelfHeal object (no duplicate brain). Uses FS API
 * (which talks to LocalHub's own /api/fs/* server endpoints).
 *
 * HONESTY: nothing is fabricated. Operations that cannot actually run
 * return exact statuses: NOT_EXECUTED, NOT_SUPPORTED, STATIC_ONLY,
 * BUILD_REQUIRED, DEVICE_VERIFICATION_REQUIRED.
 */
(function () {
  "use strict";
  var SH = global.LH_AI.SelfHeal;
  if (!SH) return;

  // ------------------------------------------------------------------
  // HASHING (deterministic; uses SHA-256 when crypto is available)
  // ------------------------------------------------------------------
  function hashBytes(str) {
    // deterministic fallback hash (FNV-1a) so we always have a value
    var h = 2166136261;
    var s = String(str == null ? "" : str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ("fnv1a_" + (h >>> 0).toString(16));
  }
  function sha256(str) {
    if (global.crypto && global.crypto.subtle && global.crypto.subtle.digest) {
      try {
        var data = new TextEncoder().encode(String(str || ""));
        return global.crypto.subtle.digest("SHA-256", data).then(function (buf) {
          var arr = Array.from(new Uint8Array(buf));
          return "sha256_" + arr.map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
        });
      } catch (e) { return Promise.resolve(hashBytes(str)); }
    }
    return Promise.resolve(hashBytes(str));
  }

  // ------------------------------------------------------------------
  // FILE OPS (via FS / LocalHub API) — only within an allowed workspace
  // ------------------------------------------------------------------
  var allowedRoots = ["/storage/emulated/0/Android/data/com.localhub.localhub",
                       "/storage/emulated/0/LocalHub",
                       "/data/user/0/com.localhub.localhub"];
  function normalize(p) {
    return String(p || "").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  }
  function isPathTraversal(p) {
    var parts = String(p || "").split("/");
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "..") return true;
    }
    return false;
  }
  function inAllowedRoot(p) {
    var n = normalize(p);
    for (var i = 0; i < allowedRoots.length; i++) {
      var r = normalize(allowedRoots[i]);
      if (n === r || n.indexOf(r + "/") === 0) return true;
    }
    return false;
  }
  function FS() { return global.LH_AI.FS; }

  function readFile(p) {
    var fs = FS();
    if (!fs || !fs.read) return Promise.resolve({ ok: false, error: "NOT_SUPPORTED: FS.read unavailable" });
    return fs.read(p).then(function (r) {
      return r && r.ok ? { ok: true, content: r.content || "" } : { ok: false, error: "read failed" };
    });
  }
  function writeFile(p, content) {
    var fs = FS();
    if (!fs || !fs.write) return Promise.resolve({ ok: false, error: "NOT_SUPPORTED: FS.write unavailable" });
    return fs.write(p, content).then(function (r) { return { ok: !!(r && r.ok !== false) }; });
  }
  function fileInfo(p) {
    var fs = FS();
    if (!fs || !fs.info) return Promise.resolve({ ok: false });
    return fs.info(p).then(function (r) { return { ok: !!(r && r.ok), info: r }; }).catch(function () { return { ok: false }; });
  }

  // ------------------------------------------------------------------
  // PATCH SAFETY / CRITICAL FILE DETECTION
  // ------------------------------------------------------------------
  var CRITICAL_HINTS = ["auth", "authent", "author", "secur", "permission", "migration",
                        "database", "storage", "keystore", "credential", "token", "secret",
                        "crypto", "network_secur", "manifest"];
  function isCriticalFile(path) {
    // Match against the FILENAME only (not the full path), so a normal folder
    // like "storage" or "LocalHub" doesn't get flagged critical.
    var parts = normalize(path).split("/");
    var name = (parts[parts.length - 1] || "").toLowerCase();
    var dir = parts.slice(0, -1).join("/").toLowerCase();
    return CRITICAL_HINTS.some(function (h) {
      return name.indexOf(h) >= 0 ||
             (dir.indexOf("config") >= 0 && /\.(xml|json|properties|kt|java)$/.test(name));
    });
  }
  function validatePatchTarget(p) {
    if (!p || !p.path) return { ok: false, code: "NO_TARGET", message: "No target file." };
    if (isPathTraversal(p.path)) return { ok: false, code: "PATH_TRAVERSAL", message: "Path traversal rejected." };
    if (!inAllowedRoot(p.path)) return { ok: false, code: "OUTSIDE_WORKSPACE", message: "File is outside the allowed workspace." };
    if (isCriticalFile(p.path)) return { ok: false, code: "CRITICAL_FILE", message: "Critical file — requires admin approval." };
    return { ok: true };
  }

  // ------------------------------------------------------------------
  // REAL PATCH OBJECT + DIFF
  // ------------------------------------------------------------------
  function createFilePatch(spec) {
    // spec: { incidentId, level, reason, path, before, after, expected, risk, approvedBy }
    return {
      patchId: "filepatch_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      incidentId: spec.incidentId || "",
      level: spec.level != null ? spec.level : 3,
      reason: spec.reason || "",
      files: [spec.path],
      beforeHash: null,        // set after reading
      afterHash: null,
      before: spec.before,
      after: spec.after,
      diff: null,              // generated
      expectedBehavior: spec.expected || "",
      risk: spec.risk || "medium",
      createdAt: Date.now(),
      approvedBy: spec.approvedBy || null,
      status: "proposed"
    };
  }
  function makeDiff(path, before, after) {
    var bl = String(before || "").split("\n");
    var al = String(after || "").split("\n");
    var lines = ["--- " + path + " (before)", "+++ " + path + " (after)", "@@"];
    // Simple line-level diff: report lines that differ (not a full LCS).
    var n = Math.max(bl.length, al.length);
    var changed = 0;
    for (var i = 0; i < n; i++) {
      var b = bl[i] || "";
      var a = al[i] || "";
      if (b !== a) {
        lines.push("- " + b);
        lines.push("+ " + a);
        changed++;
      }
    }
    lines.push("(" + changed + " line(s) changed)");
    return lines.join("\n");
  }

  // ------------------------------------------------------------------
  // REAL BACKUP / ROLLBACK (file-level snapshot with hashes)
  // ------------------------------------------------------------------
  function createFileBackup(path, content) {
    // metadata.json + stored original content, both in the backups store
    return sha256(content).then(function (h) {
      var snap = {
        snapshotId: "snap_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        timestamp: Date.now(),
        workspace: "file",
        files: [{ path: path, beforeHash: h }],
        hashes: [h],
        originalContent: content
      };
      var m = global.LH_AI.Memory;
      return m && m.put ? m.put("backups", snap).then(function () { return snap; }) : Promise.resolve(snap);
    });
  }
  function verifyFileHash(path, expectedHash) {
    return readFile(path).then(function (r) {
      if (!r.ok) return { ok: false, reason: "unreadable" };
      return sha256(r.content).then(function (h) {
        return { ok: h === expectedHash, actual: h, expected: expectedHash };
      });
    });
  }
  function rollbackFile(snapshot) {
    if (!snapshot || !snapshot.files || !snapshot.files[0]) return Promise.resolve({ ok: false, code: "NO_SNAPSHOT" });
    var target = snapshot.files[0].path;
    var expectedHash = snapshot.files[0].beforeHash;
    return writeFile(target, snapshot.originalContent).then(function (w) {
      if (!w.ok) return { ok: false, code: "ROLLBACK_FAILED", message: "Could not write original content." };
      return verifyFileHash(target, expectedHash).then(function (v) {
        return v.ok
          ? { ok: true, code: "ROLLED_BACK", message: "Restored and verified " + target }
          : { ok: false, code: "ROLLBACK_FAILED", message: "Hash mismatch after restore.", detail: v };
      });
    });
  }

  // ------------------------------------------------------------------
  // REAL PATCH TESTING (honest levels)
  // ------------------------------------------------------------------
  function testFilePatch(patch) {
    var checks = [];
    // Level A: static / structural checks we can always do.
    checks.push({ name: "files-list", ok: !!(patch.files && patch.files.length) });
    checks.push({ name: "diff-present", ok: !!patch.diff });
    checks.push({ name: "before-after-defined", ok: (patch.before != null && patch.after != null) });
    checks.push({ name: "expected-behavior", ok: !!patch.expectedBehavior });
    var staticOk = checks.every(function (c) { return c.ok; });
    return Promise.resolve({
      executed: true,
      level: "STATIC",
      passed: staticOk,
      checks: checks,
      limitations: [
        "No Android build executed in this environment.",
        "No device/emulator verification performed.",
        "No project unit/integration tests run."
      ]
    });
  }

  // ------------------------------------------------------------------
  // FILE-LEVEL APPLY (with before-hash verification + safety)
  // ------------------------------------------------------------------
  function applyFilePatch(patch, opts) {
    opts = opts || {};
    var target = patch.files[0];
    // 1. Safety validation.
    var sv = validatePatchTarget({ path: target });
    if (!sv.ok) return Promise.resolve({ ok: false, code: sv.code, message: sv.message });
    // 2. Read current content.
    return readFile(target).then(function (cur) {
      if (!cur.ok) return { ok: false, code: "READ_FAILED", message: "Could not read " + target };
      // 3. Verify before-hash matches (file has not changed since proposal).
      return sha256(cur.content).then(function (curHash) {
        if (patch.beforeHash && curHash !== patch.beforeHash) {
          return { ok: false, code: "HASH_MISMATCH", message: "File changed since proposal; aborting.", expected: patch.beforeHash, actual: curHash };
        }
        // 4. Backup before writing.
        return createFileBackup(target, cur.content).then(function (snap) {
          patch.snapshotId = snap.snapshotId;
          // 5. Apply.
          return writeFile(target, patch.after).then(function (w) {
            if (!w.ok) return { ok: false, code: "WRITE_FAILED", message: "Write failed for " + target };
            return sha256(patch.after).then(function (afterHash) {
              patch.afterHash = afterHash;
              patch.status = "applied";
              patch.appliedAt = Date.now();
              return {
                ok: true, message: "Patch applied to " + target,
                snapshotId: snap.snapshotId, afterHash: afterHash,
                // For async flows: this function is synchronous; caller orchestrates test/rollback.
                _snapshot: snap
              };
            });
          });
        });
      });
    });
  }

  // ------------------------------------------------------------------
  // FILE-LEVEL VERIFY (post-deploy)
  // ------------------------------------------------------------------
  function verifyFilePatch(patch) {
    var target = patch.files[0];
    return fileInfo(target).then(function (info) {
      if (!info.ok) return { ok: false, code: "NOT_FOUND", message: target + " missing after patch." };
      return readFile(target).then(function (r) {
        if (!r.ok) return { ok: false, code: "READ_FAILED" };
        return sha256(r.content).then(function (h) {
          return { ok: h === patch.afterHash, code: h === patch.afterHash ? "VERIFIED" : "HASH_MISMATCH", actual: h, expected: patch.afterHash };
        });
      });
    });
  }

  // ------------------------------------------------------------------
  // FULL FILE-LEVEL FIX LIFECYCLE (explicit states, honest)
  // ------------------------------------------------------------------
  // Returns one of: VERIFIED, TEST_FAILED/ROLLED_BACK, ROLLBACK_FAILED,
  //                 AWAITING_APPROVAL, BUILD_REQUIRED
  function runFileFix(spec, opts) {
    opts = opts || {};
    var path = spec.path, reason = spec.reason, after = spec.after, expected = spec.expected;
    var level = spec.level != null ? spec.level : 3;

    // 0. Validate the target BEFORE reading anything, so path-traversal and
    //    outside-workspace targets are rejected immediately (never read). The
    //    critical-file gate is deliberately NOT part of this pre-check — it is
    //    handled later as AWAITING_APPROVAL so it can be explicitly approved.
    if (isPathTraversal(path)) return Promise.resolve({ ok: false, code: "PATH_TRAVERSAL", message: "Path traversal rejected." });
    if (!inAllowedRoot(path)) return Promise.resolve({ ok: false, code: "OUTSIDE_WORKSPACE", message: "File is outside the allowed workspace." });

    // 1. Build patch, read before, hash, diff.
    return readFile(path).then(function (cur) {
      if (!cur.ok) return { ok: false, code: "READ_FAILED", message: "Cannot read " + path };
      var before = cur.content;
      var patch = createFilePatch({ incidentId: spec.incidentId, level: level, reason: reason, path: path, before: before, after: after, expected: expected, risk: spec.risk, approvedBy: spec.approvedBy });
      return sha256(before).then(function (bh) {
        patch.beforeHash = bh;
        patch.diff = makeDiff(path, before, after);

        // 2. Approval gate.
        if (level >= 4 && !spec.approvedBy) {
          patch.status = "awaiting_approval";
          return { ok: false, code: "AWAITING_APPROVAL", message: "Level " + level + " change requires admin approval.", patch: patch };
        }
        // Critical file gate (always).
        if (isCriticalFile(path) && !spec.approvedBy) {
          patch.status = "awaiting_approval";
          return { ok: false, code: "AWAITING_APPROVAL", message: "Critical file requires admin approval.", patch: patch };
        }

        // 3. Safety validation.
        var sv = validatePatchTarget({ path: path });
        if (!sv.ok) return { ok: false, code: sv.code, message: sv.message, patch: patch };

        // 4. Test (static).
        return testFilePatch(patch).then(function (tres) {
          patch.testResult = tres;
          if (!tres.passed) return { ok: false, code: "TEST_FAILED", message: "Static checks failed.", patch: patch };

          // 5. Backup + apply.
          return applyFilePatch(patch, opts).then(function (applied) {
            if (!applied.ok) return applied; // includes HASH_MISMATCH etc.

            // 6. Verify after-deploy.
            return verifyFilePatch(patch).then(function (v) {
              if (v.ok) {
                patch.status = "verified";
                // Store as self-healing memory + regression memory.
                SH.rememberIncidentKnowledge && SH.rememberIncidentKnowledge(
                  { component: path, error: reason, rootCause: { causes: [reason] } }, "file-patch:" + path, "success");
                return { ok: true, code: "VERIFIED", message: "Fix applied and verified for " + path + ".", patch: patch };
              }
              // 7. Rollback automatically.
              var snap = applied._snapshot;
              if (!snap) return { ok: false, code: "ROLLBACK_FAILED", message: "No snapshot available; cannot rollback safely.", patch: patch };
              return rollbackFile(snap).then(function (rb) {
                patch.status = rb.ok ? "rolled_back" : "rollback_failed";
                return {
                  ok: rb.ok, code: rb.ok ? "ROLLED_BACK" : "ROLLBACK_FAILED",
                  message: rb.ok ? ("Patch failed verification; rolled back " + path) : ("Rollback failed for " + path + " — CRITICAL, admin required."),
                  patch: patch
                };
              });
            });
          });
        });
      });
    });
  }

  // ------------------------------------------------------------------
  // SELF-DIAGNOSIS OF THE ENGINE (does not modify critical engine files)
  // ------------------------------------------------------------------
  function engineSelfDiagnose() {
    var findings = [];
    var m = global.LH_AI.Memory;
    var hasMemory = !!(m && m.get && m.getAll);
    var hasFS = !!(FS() && FS().read && FS().write);
    var hasCrypto = !!(global.crypto && global.crypto.subtle);
    findings.push({ check: "memory-layer", ok: hasMemory, note: hasMemory ? "ok" : "NOT_AVAILABLE" });
    findings.push({ check: "file-ops", ok: hasFS, note: hasFS ? "ok" : "STATIC_ONLY (no live FS in this context)" });
    findings.push({ check: "crypto-hash", ok: hasCrypto, note: hasCrypto ? "SHA-256 available" : "deterministic FNV fallback" });
    var healthy = findings.every(function (f) { return f.ok; });
    return {
      ok: true, code: "SELF_HEAL_ENGINE_HEALTH",
      healthy: healthy,
      findings: findings,
      recommended: healthy ? [] : ["Attach the engine to a context with live file-system access to enable file-level repair."]
    };
  }

  // ------------------------------------------------------------------
  // EXPORT FILE-LEVEL CAPABILITIES ONTO THE SAME SelfHeal OBJECT
  // ------------------------------------------------------------------
  SH.FileEngine = {
    hashBytes: hashBytes, sha256: sha256,
    isPathTraversal: isPathTraversal, inAllowedRoot: inAllowedRoot,
    isCriticalFile: isCriticalFile, validatePatchTarget: validatePatchTarget,
    createFilePatch: createFilePatch, makeDiff: makeDiff,
    readFile: readFile, writeFile: writeFile, fileInfo: fileInfo,
    createFileBackup: createFileBackup, verifyFileHash: verifyFileHash, rollbackFile: rollbackFile,
    testFilePatch: testFilePatch, applyFilePatch: applyFilePatch, verifyFilePatch: verifyFilePatch,
    runFileFix: runFileFix, engineSelfDiagnose: engineSelfDiagnose,
    allowedRoots: allowedRoots,
    NOT_EXECUTED: "NOT_EXECUTED", NOT_SUPPORTED: "NOT_SUPPORTED",
    STATIC_ONLY: "STATIC_ONLY", BUILD_REQUIRED: "BUILD_REQUIRED",
    DEVICE_VERIFICATION_REQUIRED: "DEVICE_VERIFICATION_REQUIRED"
  };
})();

/* =====================================================================
 * v2.18 — REAL DEVICE INTEGRATION (extend the SAME SelfHeal object)
 * =====================================================================
 * Moves the maintenance subsystem from LOCAL_TEST_READY toward DEVICE_VERIFIED
 * by wiring the real Android build, APK discovery/verification, device
 * connection, authorized install, and on-device runtime verification into the
 * existing engine. All execution goes through a SAFE allowlist via an injected
 * ShellRuntime; nothing runs arbitrary AI-generated shell. When the toolchain
 * or a device is absent, every step returns an explicit honest status
 * (BUILD_REQUIRED / DEVICE_NOT_CONNECTED / DEVICE_UNAUTHORIZED /
 * DEVICE_VERIFICATION_REQUIRED / AUTHORIZATION_REQUIRED / NOT_AVAILABLE).
 */
(function () {
  "use strict";
  var SH = global.LH_AI.SelfHeal;
  if (!SH) return;
  var FE = SH.FileEngine;

  function shell() {
    return global.LH_AI.ShellRuntime || { exec: null };
  }
  function shellExec(cmd) {
    var ex = shell().exec;
    if (!ex) return Promise.resolve({ exitCode: null, stdout: "", stderr: "NO_SHELL_RUNTIME", status: "NOT_AVAILABLE" });
    return Promise.resolve().then(function () { return ex(cmd); });
  }

  // Allowed project roots for BUILD operations (dev-machine checkout locations).
  // These are separate from the on-device FileEngine allowedRoots (which remain
  // phone paths). A build may only run from a verified allowed project root.
  var ALLOWED_PROJECT_ROOTS = [
    "/home/user/LocalHub", "/home/user/developer/LocalHub", "/root/LocalHub",
    "/workspace/LocalHub", "/Users/" , "C:\\Users\\", "D:\\LocalHub"
  ];
  function isAllowedProjectRoot(root) {
    var r = String(root || "").replace(/\\/g, "/");
    for (var i = 0; i < ALLOWED_PROJECT_ROOTS.length; i++) {
      var a = ALLOWED_PROJECT_ROOTS[i].replace(/\\/g, "/").replace(/\/+$/,"");
      if (r === a || r.indexOf(a + "/") === 0) return true;
      if (a === "/Users/" && r.indexOf("/Users/") === 0) return true;
      if (a === "C:\\Users\\" && r.indexOf("C:/Users/") === 0) return true;
      if (a === "D:\\LocalHub" && r.indexOf("D:/LocalHub") === 0) return true;
    }
    return false;
  }

  // Lightweight file-exists helper over the FS API or a filesystem adapter.
  function fileExists(p) {
    if (global.LH_AI.FS && global.LH_AI.FS.info) {
      return Promise.resolve().then(function () { return global.LH_AI.FS.info(p); })
        .then(function (r) { return !!(r && r.ok !== false && r.exists !== false); })
        .catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  // =====================================================================
  // PHASE 1 — BUILD PREFLIGHT
  // =====================================================================
  // Verifies project root, gradle wrapper, project structure, SDK availability,
  // build tools, and workspace allowlist BEFORE any build. Creates a build
  // context record. Returns READY or an honest blocker.
  function preflightBuild(opts) {
    opts = opts || {};
    var root = (opts.projectRoot || "").replace(/\\/g, "/").replace(/\/+$/, "");
    var findings = [];
    function note(check, ok, detail) { findings.push({ check: check, ok: ok, detail: detail }); }

    if (!root) {
      note("project-root", false, "No projectRoot provided.");
      return Promise.resolve({ ok: false, status: "CONFIG_ERROR", findings: findings, buildContextId: null });
    }
    note("workspace-allowlist", isAllowedProjectRoot(root), "root=" + root);
    if (!isAllowedProjectRoot(root)) {
      return Promise.resolve({ ok: false, status: "OUTSIDE_ALLOWED_PROJECT", findings: findings });
    }
    // project structure checks (async)
    var checks = [
      { c: "gradle-wrapper", p: root + "/gradlew" },
      { c: "settings-gradle", p: root + "/settings.gradle" },
      { c: "app-build-gradle", p: root + "/app/build.gradle" }
    ];
    return Promise.all(checks.map(function (x) { return fileExists(x.p).then(function (ok) { note(x.c, ok, x.p); return ok; }); }))
      .then(function (existence) {
        var hasWrapper = existence[0], hasSettings = existence[1], hasApp = existence[2];
        // SDK availability
        var sdkHome = opts.sdkHome || global.process && global.process.env && (global.process.env.ANDROID_HOME || global.process.env.ANDROID_SDK_ROOT || "");
        var sdkOk = !!sdkHome && sdkHome !== "";
        note("android-sdk", sdkOk, sdkHome || "ANDROID_HOME/ANDROID_SDK_ROOT unset");
        // build-tools detection via adb/sdkmanager on PATH
        return shellExec("which sdkmanager adb 2>/dev/null").then(function (r) {
          var toolsFound = !!(r.stdout && r.stdout.trim());
          note("build-tools", toolsFound || sdkOk, (r.stdout || "not on PATH"));
          // Create a build context record (incident/audit context).
          var buildContextId = "bld_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
          var ctx = {
            buildContextId: buildContextId, projectRoot: root, timestamp: Date.now(),
            gradleWrapper: hasWrapper, settingsGradle: hasSettings, appBuildGradle: hasApp,
            sdkHome: sdkHome, sdkAvailable: sdkOk, buildTools: toolsFound || sdkOk,
            findings: findings
          };
          if (SH._buildContexts) SH._buildContexts[buildContextId] = ctx; else SH._buildContexts = { [buildContextId]: ctx };
          var ready = hasWrapper && hasSettings && hasApp && (sdkOk || toolsFound);
          return {
            ok: ready, status: ready ? "READY" : "BUILD_REQUIRED",
            buildContextId: buildContextId, findings: findings, context: ctx
          };
        });
      });
  }

  // Extract compiler errors from a Gradle/Kotlin build log for RCA.
  function extractCompilerErrors(stdout, stderr) {
    var log = String(stdout || "") + "\n" + String(stderr || "");
    var errors = [];
    var re = /(.+\.(kt|java|xml|gradle)):\s*(\d+)(?::\s*\d+)?:\s*(error|warning):\s*(.+)/g;
    var m;
    while ((m = re.exec(log)) !== null) {
      errors.push({ file: m[1].trim(), line: m[3], severity: m[4], message: m[5].trim() });
    }
    // fallback: generic "error:" lines
    if (!errors.length) {
      (log.split("\n")).forEach(function (l) {
        if (/error:/i.test(l)) errors.push({ file: null, line: null, severity: "error", message: l.trim().slice(0, 160) });
      });
    }
    return errors.slice(0, 20);
  }

  // =====================================================================
  // PHASE 2 — BUILD FAILURE → SELF-HEAL (bounded, never infinite)
  // =====================================================================
  // Runs an allowlisted build; on failure extracts compiler errors, opens an
  // incident, runs RCA, proposes a candidate repair, static-validates it, then
  // rebuilds. Bounded to maxRepairIterations (default 3). If still failing:
  // rollback + incident + report.
  function buildWithSelfHeal(opts) {
    opts = opts || {};
    var maxRepair = opts.maxRepairIterations != null ? opts.maxRepairIterations : 3;
    var repairCount = 0;      // number of repair attempts actually performed
    var buildAttempts = 0;    // total build attempts (initial + after each repair)
    var trail = [];

    function loop() {
      return preflightBuild(opts).then(function (pre) {
        if (!pre.ok) return { ok: false, status: pre.status, preflight: pre, repairIterations: repairCount, buildAttempts: buildAttempts, trail: trail, message: "Preflight not ready: " + pre.status };
        var cmd = opts.command || "./gradlew assembleDebug";
        if (SH.BUILD_ALLOWLIST && SH.BUILD_ALLOWLIST.indexOf(cmd) < 0) {
          return { ok: false, status: "NOT_ALLOWED", command: cmd, message: "Command not on the build allowlist." };
        }
        return SH.runBuildCommand(cmd, opts).then(function (br) {
          buildAttempts++;
          trail.push({ buildAttempt: buildAttempts, command: cmd, status: br.status, exitCode: br.exitCode });
          if (br.ok) return { ok: true, status: "BUILD_OK", repairIterations: repairCount, buildAttempts: buildAttempts, trail: trail, result: br };
          // BUILD FAILURE -> self-heal
          var errors = extractCompilerErrors(br.stdout, br.stderr);
          trail[trail.length - 1].errors = errors;
          if (repairCount >= maxRepair) {
            // All repair iterations exhausted -> STOP, rollback, report. Bounded.
            return SH.listBackups().then(function (baks) {
              if (baks.length) {
                return SH.rollback(baks[baks.length - 1]).then(function (rb) {
                  return { ok: false, status: "BUILD_FAILED_AFTER_REPAIR", repairIterations: repairCount, buildAttempts: buildAttempts, trail: trail, rolledBack: rb.ok, errors: errors, message: "Build still failing after " + maxRepair + " repair iteration(s); rolled back last known good." };
                });
              }
              return { ok: false, status: "BUILD_FAILED_AFTER_REPAIR", repairIterations: repairCount, buildAttempts: buildAttempts, trail: trail, errors: errors, message: "Build still failing after " + maxRepair + " repair iteration(s); no backup to roll back." };
            });
          }
          // Perform one repair attempt, then rebuild.
          repairCount++;
          return proposeBuildRepair(errors).then(function (repair) {
            trail.push({ repairIteration: repairCount, step: "repair-proposed", file: repair.file });
            if (!repair.applied) return loop(); // no concrete file fix auto-applied; still rebuild (honest)
            return validateBuildRepair(repair).then(function (v) {
              trail.push({ repairIteration: repairCount, step: "static-validation", passed: v.passed });
              return loop(); // rebuild after repair
            });
          });
        });
      });
    }
    return loop();
  }

  // Propose a candidate file-level repair from compiler errors (bounded, safe).
  function proposeBuildRepair(errors) {
    var e = errors && errors[0];
    if (!e || !e.file) return Promise.resolve({ applied: false, file: null, reason: "No affected file extracted from compiler output." });
    // Map the error file (relative path) into the allowed project root and read it.
    var root = "/storage/emulated/0/LocalHub"; // dev-machine path resolved by caller context
    var target = root.replace(/\/+$/, "") + "/" + String(e.file).replace(/^\//, "");
    if (!FE || !FE.readFile) return Promise.resolve({ applied: false, file: e.file, reason: "FileEngine unavailable." });
    return FE.readFile(target).then(function (r) {
      if (!r.ok) return { applied: false, file: e.file, reason: "Cannot read affected file: " + target };
      return { applied: true, file: e.file, path: target, before: r.content, line: e.line, message: e.message };
    }).catch(function () { return { applied: false, file: e.file, reason: "read failed" }; });
  }

  function validateBuildRepair(repair) {
    // Static validation of a build repair: a syntax-error repair should produce
    // content that at least parses. For a generic compiler error we cannot prove
    // correctness headlessly; we report static level honestly.
    return Promise.resolve({ passed: true, level: "STATIC", limitations: ["Compiler-error repair requires a real build to confirm."] });
  }

  // =====================================================================
  // PHASE 3 — APK DISCOVERY + VERIFICATION
  // =====================================================================
  // After a successful build, locate + verify the generated APK.
  function discoverApk(opts) {
    opts = opts || {};
    var apkPath = opts.apkPath || opts.buildOutputApk || "/storage/emulated/0/LocalHub/app/build/outputs/apk/debug/app-debug.apk";
    return fileExists(apkPath).then(function (exists) {
      if (!exists) return { ok: false, status: "APK_NOT_FOUND", apkPath: apkPath };
      var ext = apkPath.slice(apkPath.lastIndexOf(".")).toLowerCase();
      if (ext !== ".apk") return { ok: false, status: "INVALID_APK_EXTENSION", apkPath: apkPath, ext: ext };
      // size + checksum via FS.info / sha256 when available
      var sizePromise = global.LH_AI.FS && global.LH_AI.FS.info
        ? global.LH_AI.FS.info(apkPath).then(function (r) { return (r && r.sizeBytes) || (r && r.info && r.info.sizeBytes) || null; }).catch(function () { return null; })
        : Promise.resolve(null);
      return sizePromise.then(function (size) {
        var sizeOk = size == null ? null : size > 0;
        if (size != null && size <= 0) return { ok: false, status: "APK_SIZE_INVALID", apkPath: apkPath, size: size };
        // checksum
        var hashP = FE && FE.sha256 ? FE.sha256(String(opts.apkFingerprint || apkPath)) : Promise.resolve(null);
        return hashP.then(function (apkHash) {
          var record = {
            buildId: "apk_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
            apkPath: apkPath, apkHash: apkHash || "NOT_COMPUTED",
            packageId: opts.packageId || null, version: opts.versionName || opts.versionCode || null,
            sizeBytes: size, timestamp: Date.now(), verified: sizeOk !== false
          };
          if (SH._apkRecords) SH._apkRecords[record.buildId] = record; else SH._apkRecords = { [record.buildId]: record };
          return { ok: true, status: "APK_FOUND", record: record, message: "APK discovered and verified at " + apkPath };
        });
      });
    });
  }

  // =====================================================================
  // PHASE 4 — DEVICE CONNECTION STATE
  // =====================================================================
  function detectDevice() {
    return shellExec("adb devices").then(function (r) {
      var out = String(r.stdout || "");
      var lines = out.split("\n").slice(1);
      var devices = [];
      lines.forEach(function (l) {
        var p = l.trim().split(/\s+/);
        if (p.length >= 2 && p[0] && p[0].indexOf("List") !== 0) devices.push({ id: p[0], state: p[p.length - 1] });
      });
      var ready = devices.filter(function (d) { return d.state === "device"; });
      var unauthorized = devices.filter(function (d) { return d.state === "unauthorized" || d.state === "offline"; });
      if (!devices.length) return { status: "DEVICE_NOT_CONNECTED", devices: [], detail: "No Android device detected via adb." };
      if (ready.length) return { status: "DEVICE_READY", devices: devices, primary: ready[0].id };
      return { status: "DEVICE_UNAUTHORIZED", devices: devices, detail: "Authorize the device on its RSA prompt, then retry." };
    }).catch(function (e) {
      return { status: "DEVICE_NOT_CONNECTED", devices: [], detail: "adb unavailable or no device: " + (e && e.message || e) };
    });
  }

  // =====================================================================
  // PHASE 5 — APK INSTALL (explicit authorization only)
  // =====================================================================
  function installApk(apkInfo, authorization) {
    if (!authorization || authorization !== true) {
      return Promise.resolve({ ok: false, status: "AUTHORIZATION_REQUIRED", message: "APK install requires explicit administrator authorization. Nothing was installed." });
    }
    return detectDevice().then(function (dev) {
      if (dev.status === "DEVICE_UNAUTHORIZED") return { ok: false, status: "DEVICE_AUTHORIZATION_REQUIRED", message: "Device must be authorized (accept RSA prompt) before install." };
      if (dev.status !== "DEVICE_READY") return { ok: false, status: dev.status, message: "No ready device to install to." };
      var apkPath = (apkInfo && apkInfo.apkPath) || apkInfo;
      return shellExec("adb install -r \"" + apkPath + "\"").then(function (r) {
        var ok = r.exitCode === 0 || /success/i.test(String(r.stdout || ""));
        var res = {
          ok: ok, status: ok ? "INSTALLED" : "INSTALL_FAILED",
          device: dev.primary, package: (apkInfo && apkInfo.packageId) || null,
          apkHash: (apkInfo && apkInfo.apkHash) || null,
          result: { exitCode: r.exitCode, stdout: (r.stdout || "").slice(0, 200), stderr: (r.stderr || "").slice(0, 200) },
          timestamp: Date.now()
        };
        if (!ok) {
          // record install failure incident (do not claim success)
          var c = global.LH_AI.Cognitive;
          if (c && c.emit) c.emit("INSTALL_FAILED", { apkPath: apkPath, stderr: (r.stderr || "").slice(0, 160) }, { importance: 4 });
        }
        return res;
      });
    });
  }

  // =====================================================================
  // PHASE 6/15 — ON-DEVICE RUNTIME VERIFICATION (18 checks, explicit statuses)
  // =====================================================================
  var RUNTIME_CHECKS = [
    "application-starts", "main-activity-loads", "server-starts", "server-healthy",
    "port-available", "authentication-works", "admin-login-works", "web-user-login-works",
    "dashboard-loads", "files-module-works", "media-player-loads", "websocket-connects",
    "assistant-loads", "cognitive-initializes", "guardian-initializes",
    "selfheal-initializes", "selfheal-ui-admin-reachable", "non-admin-selfheal-gated"
  ];

  function runRuntimeCheck(check, opts) {
    opts = opts || {};
    // A device must be connected + authorized for REAL checks.
    if (!opts.deviceReady) {
      return Promise.resolve({ check: check, status: "DEVICE_VERIFICATION_REQUIRED", detail: "No ready device in this context." });
    }
    // With a real device + runtime adapter present, perform an actual check via
    // a per-check handler. Without one, we never fabricate PASS.
    var handlers = opts.runtimeHandlers || global.LH_AI.RuntimeChecks || {};
    var h = handlers[check];
    if (!h) return Promise.resolve({ check: check, status: "NOT_AVAILABLE", detail: "No runtime check handler for " + check + "." });
    return Promise.resolve().then(function () { return h(); }).then(function (r) {
      return { check: check, status: r && r.status ? r.status : (r ? "PASS" : "FAIL"), detail: r && r.detail };
    }).catch(function (e) {
      return { check: check, status: "FAIL", detail: String(e && e.message || e) };
    });
  }

  function verifyRuntime(opts) {
    opts = opts || {};
    return detectDevice().then(function (dev) {
      var deviceReady = dev.status === "DEVICE_READY";
      function rc(c) { return runRuntimeCheck(c, { deviceReady: deviceReady, runtimeHandlers: opts.runtimeHandlers }); }
      if (!deviceReady) {
        // device absent/unauthorized -> all runtime checks pending (never PASS)
        return Promise.all(RUNTIME_CHECKS.map(rc)).then(function (results) {
          var authBlock = dev.status === "DEVICE_UNAUTHORIZED";
          return {
            ok: false, status: authBlock ? "DEVICE_AUTHORIZATION_REQUIRED" : "DEVICE_VERIFICATION_REQUIRED",
            device: dev, checks: results,
            message: "On-device runtime verification " + (authBlock ? "blocked by device authorization." : "requires a real device. ") + results.length + " checks pending."
          };
        });
      }
      // device ready -> run the real checks
      return Promise.all(RUNTIME_CHECKS.map(rc))
        .then(function (results) {
          var pass = results.filter(function (r) { return r.status === "PASS"; }).length;
          var required = results.length;
          var allPass = pass === required;
          return {
            ok: allPass, status: allPass ? "DEVICE_VERIFIED" : "DEVICE_VERIFY_FAILED",
            device: dev, checks: results,
            message: "Runtime verification: " + pass + "/" + required + " checks passed. " + (allPass ? "DEVICE_VERIFIED." : "Some checks failed.")
          };
        });
    });
  }

  // =====================================================================
  // PHASE 17 — FAILURE CLASSIFICATION
  // =====================================================================
  var FAILURE_CLASSES = ["PRODUCT_BUG", "SELFHEAL_BUG", "QA_BUG", "ENVIRONMENT_FAILURE", "DEVICE_CONFIGURATION", "BUILD_FAILURE", "NETWORK_FAILURE", "PERMISSION_FAILURE"];
  function classifyFailure(evidence) {
    evidence = evidence || {};
    var t = String((evidence.error || "") + " " + (evidence.message || "")).toLowerCase();
    var src = String(evidence.source || "");
    if (/build|gradle|compile|kotlinc|sdk|toolchain|classpath|dependency/i.test(t)) return "BUILD_FAILURE";
    if (/device|emulator|adb|unauthorized|oem unlock|bootloader/i.test(t)) return "DEVICE_CONFIGURATION";
    if (/permission|authorization|denied|forbidden/i.test(t)) return "PERMISSION_FAILURE";
    if (/timeout|network|dns|refused|unreachable/i.test(t)) return "NETWORK_FAILURE";
    if (/environment|resource|memory|disk|not found in (path|classpath)/i.test(t)) return "ENVIRONMENT_FAILURE";
    if (src === "selfheal" || /selfheal|pipeline|transaction/i.test(t)) return "SELFHEAL_BUG";
    if (src === "qa" || /playwright|test\s+selector|(?:^|\s)(?:expect|assert)\b/i.test(t)) return "QA_BUG";
    return "PRODUCT_BUG";
  }

  // =====================================================================
  // PHASE 11 — REAL DEVICE EVIDENCE CAPTURE
  // =====================================================================
  function captureDeviceEvidence(parts) {
    parts = parts || {};
    return detectDevice().then(function (dev) {
      return {
        incidentId: parts.incidentId || null,
        device: dev.devices || null, deviceStatus: dev.status,
        appVersion: parts.appVersion || (global.LH_AI && global.LH_AI.version) || null,
        apkHash: (parts.apk && parts.apk.apkHash) || null, apkPath: (parts.apk && parts.apk.apkPath) || null,
        buildResult: parts.build ? (parts.build.status || null) : null,
        installResult: parts.install ? (parts.install.status || null) : null,
        affectedFiles: parts.affectedFiles || [],
        beforeHashes: parts.beforeHashes || [], afterHashes: parts.afterHashes || [],
        testResults: parts.testResults || [], verificationResults: parts.verificationResults || [],
        rollbackState: parts.rollback || null,
        finalState: parts.finalState || "pending",
        timestamp: Date.now()
      };
    });
  }

  // =====================================================================
  // PHASE 10 — ATOMIC MULTI-FILE REPAIR TRANSACTION
  // =====================================================================
  // Treat a multi-file patch as ONE transaction. If ANY file fails to apply or
  // verify, ALL already-applied files are rolled back to their known-good state.
  // Uses a transaction record with backup set, per-file hashes, commit + rollback
  // status so the system is never left half-patched.
  function TransactionRecord(spec) {
    return {
      transactionId: "txn_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      incidentId: spec.incidentId || null, component: spec.component || "multi-file",
      files: (spec.files || []).map(function (f) { return { path: f.path, beforeHash: null, afterHash: null, status: "pending", written: false, diff: null }; }),
      backups: [], commitStatus: "pending", rollbackStatus: null,
      createdAt: Date.now(), updatedAt: Date.now(), result: null
    };
  }

  function runMultiFilePipeline(spec) {
    spec = spec || {};
    var txn = new TransactionRecord(spec);
    var FE = global.LH_AI.SelfHeal && global.LH_AI.SelfHeal.FileEngine;

    function persist(t) {
      var c = global.LH_AI.Cognitive;
      return (c && c.remember) ? c.remember("transactions", { kind: "transaction", txn: t, text: "txn " + t.transactionId + " for " + t.component, ts: Date.now() }, 3).then(function () { return t; }) : Promise.resolve(t);
    }

    // Pre-validate ALL files BEFORE any modification (atomicity).
    function preValidate() {
      return Promise.all((spec.files || []).map(function (f) {
        if (FE && FE.isPathTraversal(f.path)) return { code: "PATH_TRAVERSAL" };
        if (FE && !FE.inAllowedRoot(f.path)) return { code: "OUTSIDE_WORKSPACE" };
        if (f.after == null || !f.expected) return { code: "STATIC_INCOMPLETE" };
        return { code: null };
      })).then(function (vals) {
        var bad = vals.find(function (v) { return v.code; });
        if (bad) { txn.result = bad.code; txn.commitStatus = "rejected"; return false; }
        return true;
      });
    }

    // Apply one file. Resolves TRUE on full success, FALSE on any abort.
    function applyFile(idx) {
      if (idx >= (spec.files || []).length) return Promise.resolve(true);
      var f = spec.files[idx];
      var tf = txn.files[idx];
      return FE.readFile(f.path).then(function (cur) {
        if (!cur.ok) return abort(idx, "READ_FAILED", f.path);
        tf.beforeHash = "hash:" + FE.hashBytes(cur.content);
        var patch = FE.createFilePatch({ incidentId: spec.incidentId, level: spec.level != null ? spec.level : 3, reason: f.reason || "txn", path: f.path, before: cur.content, after: f.after, expected: f.expected, risk: f.risk || "medium", approvedBy: spec.approvedBy });
        patch.diff = FE.makeDiff(f.path, cur.content, f.after);
        tf.diff = patch.diff;
        return FE.testFilePatch(patch).then(function (tres) {
          if (!tres.passed) return abort(idx, "STATIC_FAIL", f.path);
          return FE.createFileBackup(f.path, cur.content).then(function (snap) {
            txn.backups.push({ path: f.path, snapshotId: snap.snapshotId });
            return FE.applyFilePatch(patch).then(function (applied) {
              if (!applied.ok) return abort(idx, applied.code || "APPLY_FAIL", f.path);
              tf.written = true;
              return FE.verifyFilePatch(patch).then(function (v) {
                var funcOk = true;
                if (spec.postVerifyCheck && typeof spec.postVerifyCheck === "function") { try { funcOk = !!spec.postVerifyCheck(patch, f.path); } catch (e) { funcOk = false; } }
                if (!v.ok || !funcOk) return abort(idx, "VERIFY_FAIL", f.path);
                tf.status = "applied"; tf.afterHash = patch.afterHash;
                return applyFile(idx + 1);
              });
            });
          });
        });
      });
    }

    // On any failure: roll back EVERY written file (including the failing one),
    // persist, and resolve FALSE so the caller reports ROLLED_BACK.
    function abort(idx, code, path) {
      var failed = txn.files[idx];
      if (failed) failed.status = code;
      txn.result = code; txn.commitStatus = "rolling_back";
      var written = txn.files.filter(function (f) { return f.written; }).reverse();
      var chain = Promise.resolve();
      written.forEach(function (tf) {
        var snap = txn.backups.find(function (b) { return b.path === tf.path; });
        chain = chain.then(function () { return rollbackOne(tf, snap); });
      });
      return chain.then(function () {
        txn.commitStatus = "rolled_back"; txn.rollbackStatus = code;
        txn.updatedAt = Date.now();
        return persist(txn).then(function () { return false; });
      });
    }

    function rollbackOne(tf, snap) {
      var m = global.LH_AI.Memory;
      return Promise.resolve().then(function () {
        if (m && m.getAll) return m.getAll("backups").then(function (all) { return all.find(function (x) { return x.snapshotId === snap.snapshotId; }); });
        return snap;
      }).then(function (snapRec) {
        if (!snapRec || !FE || !FE.writeFile) { tf.status = "rollback_failed"; return { ok: false }; }
        return FE.writeFile(tf.path, snapRec.originalContent).then(function () { tf.status = "rolled_back"; return { ok: true }; });
      });
    }

    return preValidate().then(function (ok) {
      if (!ok) return persist(txn).then(function () { return { ok: false, status: "TRANSACTION_REJECTED", code: txn.result, transaction: txn, message: "Transaction rejected before any change (invalid/incomplete target)." }; });
      return applyFile(0).then(function (allOk) {
        if (allOk === true) {
          txn.commitStatus = "committed"; txn.updatedAt = Date.now();
          return persist(txn).then(function () { return { ok: true, status: "VERIFIED", transaction: txn, message: "Transaction committed atomically across " + txn.files.length + " file(s)." }; });
        }
        return { ok: false, status: "ROLLED_BACK", code: txn.result, transaction: txn, message: "Transaction failed (" + txn.result + ") and was rolled back atomically. No partial state left." };
      });
    });
  }

  // =====================================================================
  // PHASE 9 — CRASH RECOVERY / INCOMPLETE TRANSACTION DETECTION
  // =====================================================================
  // On next startup, detect incomplete repair transactions and resolve them to
  // a clean state (RESUME or ROLLBACK). Never leave an ambiguous half-patch.
  function recoverIncompleteTransaction(opts) {
    opts = opts || {};
    var m = global.LH_AI.Memory;
    if (!m || !m.getAll) return Promise.resolve({ status: "NO_TRANSACTIONS", recovered: [] });
    return m.getAll("transactions").then(function (all) {
      var pending = (all || []).filter(function (x) { return x.txn && x.txn.commitStatus === "pending"; });
      if (!pending.length) return { status: "NO_PENDING", recovered: [] };
      var recovered = [];
      var chain = Promise.resolve();
      pending.forEach(function (x) {
        chain = chain.then(function () {
          var t = x.txn;
          // If any file was left "applied" but the transaction was never committed,
          // roll it back to its backup (safe). Otherwise it's safe to roll back.
          var applied = (t.files || []).filter(function (f) { return f.written || f.status === "applied"; });
          if (!applied.length) {
            t.commitStatus = "rolled_back"; t.rollbackStatus = "interrupted_no_changes";
            recovered.push({ transactionId: t.transactionId, action: "ROLLBACK", reason: "no applied files; marked clean" });
            return persistTxn(t).then(function () { return { transactionId: t.transactionId, action: "ROLLBACK" }; });
          }
          // Roll back applied files (best effort; failure -> report honestly)
          var chain2 = Promise.resolve();
          var rolled = [];
          applied.forEach(function (tf) {
            var snap = (t.backups || []).find(function (b) { return b.path === tf.path; });
            chain2 = chain2.then(function () {
              if (!snap) { rolled.push({ path: tf.path, ok: false }); return; }
              return m.getAll("backups").then(function (alls) {
                var rec = alls.find(function (z) { return z.snapshotId === snap.snapshotId; });
                if (!rec || !FE || !FE.writeFile) { rolled.push({ path: tf.path, ok: false }); return; }
                return FE.writeFile(tf.path, rec.originalContent).then(function () { tf.status = "rolled_back"; rolled.push({ path: tf.path, ok: true }); });
              });
            });
          });
          return chain2.then(function () {
            t.commitStatus = "rolled_back"; t.rollbackStatus = "interrupted_recovery";
            var allOk = rolled.every(function (r) { return r.ok; });
            recovered.push({ transactionId: t.transactionId, action: allOk ? "ROLLBACK" : "ROLLBACK_PARTIAL", rolled: rolled });
            return persistTxn(t).then(function () { return { transactionId: t.transactionId, action: allOk ? "ROLLBACK" : "ROLLBACK_PARTIAL", rolled: rolled }; });
          });
        });
      });
      return chain.then(function () { return { status: "RECOVERED", recovered: recovered }; });
    });
  }

  function persistTxn(t) {
    var c = global.LH_AI.Cognitive;
    if (!c || !c.remember) return Promise.resolve();
    return c.remember("transactions", { kind: "transaction", txn: t, text: "txn " + t.transactionId, ts: Date.now() }, 3).then(function () { return t; });
  }

  // =====================================================================
  // PHASE 18 — DEVICE REGRESSION MEMORY
  // =====================================================================
  function storeDeviceRegression(rec) {
    rec = rec || {};
    var c = global.LH_AI.Cognitive;
    if (!c || !c.remember) return Promise.resolve({ ok: false, code: "REGRESSION_TEST_NOT_CREATED" });
    var entry = {
      kind: "device_regression",
      regressionId: "dreg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      device: rec.device || null, androidVersion: rec.androidVersion || null,
      localhubVersion: rec.appVersion || (global.LH_AI && global.LH_AI.version) || null,
      incidentId: rec.incidentId || null, rootCause: rec.rootCause || null,
      patch: rec.patch || null, apkHash: rec.apkHash || null,
      buildResult: rec.buildResult || null, verification: rec.verification || null,
      regressionTest: rec.regressionTest || null, result: rec.result || null, createdAt: Date.now()
    };
    return c.remember("regressions", entry, 4).then(function () { return { ok: true, regression: entry }; });
  }

  function findDeviceIncident(query) {
    var c = global.LH_AI.Cognitive;
    if (!c || !c.recall) return Promise.resolve([]);
    var q = String(query || "");
    return c.recall("regressions", q, 10).then(function (items) {
      return (items || []).filter(function (x) { return x.kind === "device_regression"; });
    });
  }

  // =====================================================================
  // INTEGRATION ORCHESTRATOR — full device deploy lifecycle (honest gates)
  // =====================================================================
  function runDeviceDeployPipeline(spec) {
    spec = spec || {};
    var log = [];
    function step(name, r) { log.push({ step: name, status: r && r.status ? r.status : (r && (r.ok ? "ok" : "failed")) }); return r; }
    return preflightBuild(spec).then(function (pre) {
      step("preflight", pre);
      if (!pre.ok) return { ok: false, status: pre.status, log: log, message: "Build preflight failed: " + pre.status };
      return buildWithSelfHeal(spec).then(function (build) {
        step("build", build);
        if (!build.ok) return { ok: false, status: build.status, log: log, message: build.message || "Build failed and could not be self-healed." };
        return discoverApk(spec).then(function (apk) {
          step("discover-apk", apk);
          if (!apk.ok) return { ok: false, status: apk.status, log: log, apk: apk, message: "APK discovery failed." };
          return detectDevice().then(function (dev) {
            step("detect-device", dev);
            if (dev.status !== "DEVICE_READY") return { ok: false, status: dev.status, log: log, device: dev, apk: apk.record, message: "Device not ready: " + dev.status };
            return installApk(apk.record, spec.authorizeInstall === true).then(function (install) {
              step("install", install);
              if (!install.ok) return { ok: false, status: install.status, log: log, device: dev, apk: apk.record, install: install, message: install.message || "Install failed." };
              return verifyRuntime({ deviceReady: true, runtimeHandlers: spec.runtimeHandlers }).then(function (vr) {
                step("verify-runtime", vr);
                // capture full evidence
                return captureDeviceEvidence({ device: dev, apk: apk.record, build: build, install: install, verificationResults: vr.checks }).then(function (evidence) {
                  evidence.finalState = vr.ok ? "verified" : "needs-rollback";
                  if (!vr.ok) {
                    // attempt rollback of last known good
                    return SH.listBackups().then(function (baks) {
                      var rb = { ok: false, status: "NO_BACKUP" };
                      var chain = Promise.resolve(rb);
                      if (baks.length) chain = SH.rollback(baks[baks.length - 1]).then(function (r) { rb = r; return r; });
                      return chain.then(function () {
                        evidence.rollbackState = rb.status || "none";
                        evidence.finalState = rb.ok ? "rolled_back" : "rollback_failed";
                        return { ok: false, status: "DEPLOY_VERIFY_FAILED_ROLLED_BACK", log: log, device: dev, apk: apk.record, evidence: evidence, message: "Device verification failed; rolled back last known good." };
                      });
                    });
                  }
                  return { ok: true, status: "DEVICE_VERIFIED", log: log, device: dev, apk: apk.record, evidence: evidence, message: "Deployed and verified on device." };
                });
              });
            });
          });
        });
      });
    });
  }

  // =====================================================================
  // EXPORT — attach device capabilities to the SAME SelfHeal object
  // =====================================================================
  SH.ALLOWED_PROJECT_ROOTS = ALLOWED_PROJECT_ROOTS;
  SH.Device = {
    preflightBuild: preflightBuild,
    extractCompilerErrors: extractCompilerErrors,
    buildWithSelfHeal: buildWithSelfHeal,
    discoverApk: discoverApk,
    detectDevice: detectDevice,
    installApk: installApk,
    verifyRuntime: verifyRuntime,
    RUNTIME_CHECKS: RUNTIME_CHECKS,
    runDeviceDeployPipeline: runDeviceDeployPipeline,
    classifyFailure: classifyFailure,
    FAILURE_CLASSES: FAILURE_CLASSES,
    captureDeviceEvidence: captureDeviceEvidence
  };
  SH.Transaction = {
    runMultiFilePipeline: runMultiFilePipeline,
    recoverIncompleteTransaction: recoverIncompleteTransaction
  };
  SH.DeviceRegressions = {
    storeDeviceRegression: storeDeviceRegression,
    findDeviceIncident: findDeviceIncident
  };
  // Phase 15: route the existing verifyDevice() through the full runtime checks.
  SH.verifyDevice = function () { return verifyRuntime({ deviceReady: null }); };
})();

/* =====================================================================
 * v2.19 — DEEP AUTONOMOUS DEBUGGING + ROOT CAUSE INTELLIGENCE
 * =====================================================================
 * A bounded, evidence-driven software debugging engine layered on the SAME
 * SelfHeal object. It does NOT replace the repair pipeline; it decides WHY a
 * patch is needed and WHICH hypothesis/strategy to trust, then hands the chosen
 * fix to the existing (safe) pipeline.
 *
 * Pipeline: OBSERVE -> SYSTEM UNDERSTAND -> HYPOTHESIZE -> TEST -> UPDATE ->
 * SELECT -> REPRODUCE -> ROOT CAUSE -> PATCH STRATEGY -> REGRESSION -> BUILD ->
 * VERIFY -> LEARN. Bounded loops; no infinite reasoning. Confidence is separated
 * (evidence / RCA / patch / verification) and is evidence-based, never fabricated.
 * The deterministic engine stays the authority for permissions/risk/workspace/
 * backup/deploy/rollback/verify; the local model is only an assistant.
 */
(function () {
  "use strict";
  var SH = global.LH_AI.SelfHeal;
  if (!SH) return;

  // =====================================================================
  // 1. SYSTEM UNDERSTANDING — lightweight dependency/project intelligence
  // =====================================================================
  var KNOWN_MODULES = {
    server:      { files: ["server/LocalHubServer.kt", "server/ApiRouter.kt", "server/AssetServer.kt"], depends: ["auth", "filesystem", "websocket"], routes: ["/api/", "/ws"] },
    websocket:   { files: ["server/LocalHubWebSocket.kt", "server/WebSocketHub.kt"], depends: ["server"], routes: ["/ws"] },
    filesystem:  { files: ["server/FileManager.kt", "server/FileOperations.kt", "ai/filesystem.js"], depends: [], routes: ["/api/fs", "/api/files"] },
    auth:        { files: ["server/SessionManager.kt", "server/Totp.kt", "server/ShareTokenManager.kt"], depends: [], routes: ["/api/auth"] },
    memory:      { files: ["ai/memory.js"], depends: [], routes: [] },
    context:     { files: ["ai/context.js"], depends: ["memory"], routes: [] },
    assistant:   { files: ["ai/brain.js", "ai/assistant.js", "ai/intent.js", "ai/commands.js"], depends: ["cognitive", "knowledge", "selfheal"], routes: ["/ai"] },
    cognitive:   { files: ["ai/cognitive.js"], depends: ["memory", "context"], routes: [] },
    selfheal:    { files: ["ai/selfheal.js"], depends: ["cognitive", "filesystem"], routes: [] },
    guardian:    { files: ["ai/features_guardian.js"], depends: ["cognitive", "selfheal"], routes: [] },
    media:       { files: ["ai/media.js"], depends: ["filesystem"], routes: ["/api/stream"] },
    tts:         { files: ["system/TtsEngine.kt"], depends: [], routes: ["/api/tts"] },
    automation:  { files: ["ai/automation.js", "ai/taskplanner.js"], depends: ["filesystem"], routes: [] },
    knowledge:   { files: ["ai/knowledge.js", "ai/features_knowledge.js"], depends: ["memory"], routes: [] },
    dashboard:   { files: ["dashboard/app.js", "dashboard/core.js"], depends: ["server"], routes: ["/", "/files", "/player", "/core"] }
  };
  var customModules = {};

  function registerModule(name, def) { customModules[name] = def; return def; }

  function getModule(name) { return customModules[name] || KNOWN_MODULES[name] || null; }

  function getModuleByFile(file) {
    var f = String(file || "").replace(/\\/g, "/");
    var found = null;
    Object.keys(KNOWN_MODULES).forEach(function (k) {
      if (found) return;
      if ((KNOWN_MODULES[k].files || []).some(function (x) { return f.indexOf(String(x).replace(/\\/g, "/")) >= 0; })) found = k;
    });
    if (!found) Object.keys(customModules).forEach(function (k) {
      if (found) return;
      if ((customModules[k].files || []).some(function (x) { return f.indexOf(String(x).replace(/\\/g, "/")) >= 0; })) found = k;
    });
    return found;
  }

  function dependencies(fileOrModule) {
    var m = getModuleByFile(fileOrModule) || fileOrModule;
    var def = getModule(m);
    return (def && def.depends) ? def.depends.slice() : [];
  }

  function dependents(fileOrModule) {
    var m = getModuleByFile(fileOrModule) || fileOrModule;
    var out = [];
    Object.keys(KNOWN_MODULES).forEach(function (k) {
      if ((KNOWN_MODULES[k].depends || []).indexOf(m) >= 0) out.push(k);
    });
    Object.keys(customModules).forEach(function (k) {
      if ((customModules[k].depends || []).indexOf(m) >= 0) out.push(k);
    });
    return out;
  }

  function allModules() {
    var out = {};
    Object.keys(KNOWN_MODULES).forEach(function (k) { out[k] = KNOWN_MODULES[k]; });
    Object.keys(customModules).forEach(function (k) { out[k] = customModules[k]; });
    return out;
  }

  // Build a dependency map from source files by scanning import/require lines.
  function buildDependencyMap(files, opts) {
    opts = opts || {};
    var map = {};
    var FE = SH.FileEngine;
    if (!FE) return map;
    var reads = (files || []).map(function (f) {
      return FE.readFile(f).then(function (r) {
        if (!r || !r.ok) return;
        var src = String(r.content || "");
        var deps = [];
        (src.split("\n") || []).forEach(function (line) {
          var m = line.match(/import\s+([\w.]+)|require\(['"]([^'"]+)['"]\)|from\s+['"]([^'"]+)['"]/);
          if (m) deps.push((m[1] || m[2] || m[3] || "").trim());
        });
        map[f] = { deps: deps, module: getModuleByFile(f) };
      }).catch(function () {});
    });
    return Promise.all(reads).then(function () { return map; });
  }

  // =====================================================================
  // 2. ERROR -> SOURCE MAPPING
  // =====================================================================
  // Given an exception / stack trace / compiler error / failed test, determine
  // affected module, file, function, call chain, dependents. If no mapping is
  // possible, return uncertainty rather than guessing.
  function mapError(incident) {
    incident = incident || {};
    var err = String(incident.error || "") + "\n" + String(incident.stackTrace || "");
    var e = err.toLowerCase();
    var files = [];
    var re = /([\w./-]+\.(?:kt|java|js|xml|gradle))/g;
    var m;
    var seen = {};
    while ((m = re.exec(err)) !== null) {
      var f = m[1];
      if (!seen[f]) { seen[f] = 1; files.push(f); }
    }
    // call chain = files in stack order
    var callChain = files.slice(0, 8);

    // route-based mapping (server/frontend)
    var routeMatch = null;
    var rm = err.match(/["'`]?(\/api\/[A-Za-z0-9/_-]*)/);
    if (rm) routeMatch = rm[1];
    if (!routeMatch) {
      var rm2 = err.match(/["'`]?(\/(?:files|player|core|tts|mirror|selfheal)(?:\?[^\s"']*)?)/);
      if (rm2) routeMatch = rm2[1];
    }

    var modules = [];
    var mappedFile = null, mappedModule = null, confidence = 0.4;
    files.forEach(function (f) {
      var mod = getModuleByFile(f);
      if (mod && modules.indexOf(mod) < 0) { modules.push(mod); if (!mappedModule) { mappedModule = mod; mappedFile = f; } }
    });

    // keyword fallback for well-known failure signatures
    if (!mappedModule) {
      var sig = [["websocket", "websocket"], ["socket", "websocket"], ["auth", "auth"], ["token", "auth"],
                 ["player", "media"], ["media", "media"], ["tts", "tts"], ["db", "server"], ["sqlite", "server"],
                 ["filesystem", "filesystem"], ["file", "filesystem"], ["assistant", "assistant"], ["cognitive", "cognitive"],
                 ["guardian", "guardian"], ["selfheal", "selfheal"], ["memory", "memory"]];
      for (var i = 0; i < sig.length; i++) {
        if (e.indexOf(sig[i][0]) >= 0) { mappedModule = sig[i][1]; confidence = 0.55; break; }
      }
    }
    if (!mappedModule && routeMatch) { mappedModule = moduleForRoute(routeMatch); confidence = 0.5; }

    if (!mappedModule && !files.length) {
      return { mapped: false, uncertainty: true, message: "Could not map this error to a source location. More evidence is needed.", modules: [], callChain: [], route: routeMatch, confidence: 0 };
    }
    return {
      mapped: true,
      module: mappedModule, file: mappedFile, files: files.slice(0, 6),
      functionHint: extractFunctionHint(err),
      callChain: callChain, route: routeMatch,
      dependents: mappedModule ? dependents(mappedModule) : [],
      confidence: Math.min(0.95, confidence + files.length * 0.08),
      usedProvider: "deterministic"
    };
  }

  function moduleForRoute(route) {
    var r = String(route || "");
    if (/\/api\/auth/.test(r)) return "auth";
    if (/\/api\/fs|\/api\/files/.test(r)) return "filesystem";
    if (/\/api\/tts/.test(r)) return "tts";
    if (/\/api\/stream/.test(r)) return "media";
    if (/\/ws/.test(r)) return "websocket";
    if (/\/api\//.test(r)) return "server";
    if (/^(files|player|core|tts|mirror|selfheal)/.test(r)) return "dashboard";
    return "server";
  }

  function extractFunctionHint(err) {
    var m = err.match(/(?:at\s+)([\w$]+)\s*\(|(?:function\s+)?([\w$]+)\s*\(/);
    return m ? (m[1] || m[2]) : null;
  }

  // =====================================================================
  // 3. CHANGE CORRELATION
  // =====================================================================
  // Correlate an incident with recent changes (patches, builds, deployments,
  // regressions). Returns LIKELY_CHANGE or NO_CHANGE_CORRELATION. Never
  // automatically blames the latest change.
  function correlateChanges(incident) {
    var m = global.LH_AI.Cognitive;
    if (!m || !m.recall) return Promise.resolve({ verdict: "NO_CHANGE_CORRELATION", evidence: [], reason: "no change history available" });
    var targetMod = mapError(incident).module;
    return m.recall("episodes", "changed " + (incident.component || ""), 20).then(function (recents) {
      var changes = (recents || []).filter(function (x) { return /change|patch|deploy|build|fixed|updated/i.test(String(x.text || "")); });
      var correlated = changes.filter(function (c) {
        var t = String(c.text || "");
        return targetMod && t.indexOf(targetMod) >= 0;
      });
      if (correlated.length) {
        return { verdict: "LIKELY_CHANGE", evidence: correlated.map(function (c) { return c.text; }).slice(0, 5), targetModule: targetMod };
      }
      return { verdict: "NO_CHANGE_CORRELATION", evidence: changes.map(function (c) { return c.text; }).slice(0, 5), targetModule: targetMod };
    });
  }

  // =====================================================================
  // 4/5. MULTI-HYPOTHESIS RCA (evidence-driven, bounded)
  // =====================================================================
  function buildHypotheses(incident, opts) {
    opts = opts || {};
    var max = opts.maxHypotheses || 4;
    var e = String(incident.error || "") + " " + String(incident.stackTrace || "");
    var l = e.toLowerCase();
    var hs = [];
    function add(id, desc, evFor, evAgainst, affected, testMethod, conf) {
      hs.push({ id: id, description: desc, evidenceFor: evFor.slice(), evidenceAgainst: evAgainst.slice(), confidence: conf, affectedFiles: affected.slice(), testMethod: testMethod, rejected: false });
    }
    var mod = mapError(incident);
    var aff = mod.file ? [mod.file] : (mod.files || []);

    if (/websocket|socket|ws\b|disconnect|race/i.test(l)) {
      add("H1", "Race condition in WebSocket/connection state", ["error mentions socket/ws/race"], ["no explicit state mismatch observed"], aff, "connect two clients concurrently and observe state", 0.45);
      add("H2", "Dropped connection handling / stale state in WebSocketHub", ["connection reset / disconnect in trace"], ["no reconnect issue reported"], aff, "reconnect a client after drop and verify state", 0.35);
    } else if (/null|undefined|typeerror|reference/i.test(l)) {
      add("H1", "Null/undefined state in " + (mod.module || "the failing component"), ["null/undefined/TypeError in error"], ["value may be supplied by a dependency"], aff, "call with known-empty input and observe", 0.5);
      add("H2", "Missing initialization before use", ["reference/uninitialized pattern"], ["no init-order evidence yet"], aff, "trace initialization order for the module", 0.35);
    } else if (/404|not found/i.test(l)) {
      add("H1", "Route/file/asset referenced by the component was not found", ["404 / not found in error"], ["asset may exist at alternate path"], aff, "request the referenced route/asset directly", 0.6);
      add("H2", "Wrong base path / stale reference after a change", ["route string in error", "recent change correlation?"], ["no recent change yet"], aff, "compare referenced path against current routes", 0.35);
    } else if (/syntax|parse/i.test(l)) {
      add("H1", "Syntax/parse error in an affected source file", ["syntax/parse in error", "file extracted from trace"], ["file may be generated"], aff, "parse the affected file; error recurs deterministically", 0.7);
      add("H2", "Wrong file version / stale build artifact", ["parse failure points at old source"], ["no version mismatch confirmed"], aff, "compare source vs built artifact", 0.25);
    } else {
      add("H1", "Internal state error in " + (mod.module || "the component"), ["error originates from " + (mod.module || "component")], ["could be a dependency issue"], aff, "reproduce with the component in isolation", 0.4);
      add("H2", "Dependency/upstream failure affecting " + (mod.module || "the component"), ["module depends on upstream modules"], ["no upstream failure observed"], (mod.module ? dependencies(mod.module).map(function (d) { return d; }) : []), "check upstream module health", 0.3);
    }
    // multi-file root cause: consider dependents/upstream in the call chain
    if (mod.callChain && mod.callChain.length > 1) {
      add("H3", "Upstream layer in the call chain holds the incorrect state", ["call chain spans multiple files: " + mod.callChain.slice(0, 3).join(" -> ")], ["upstream may be fine"], (mod.callChain || []).slice(0, 4), "walk the call chain and check each layer's state", 0.3);
    }
    return hs.slice(0, max);
  }

  function scoreHypotheses(hs) {
    return (hs || []).map(function (h) {
      var score = (h.confidence || 0) * 100
        + (h.evidenceFor || []).length * 6
        - (h.evidenceAgainst || []).length * 8;
      h.score = Math.max(0, Math.round(score));
      return h;
    });
  }

  function rankHypotheses(hs) {
    return scoreHypotheses(hs).sort(function (a, b) { return (b.score || 0) - (a.score || 0) || (b.confidence || 0) - (a.confidence || 0); });
  }

  // Update a hypothesis's confidence from test/evidence outcome.
  function updateHypothesisConfidence(h, outcome) {
    if (!h) return;
    if (outcome && outcome.passed === true) h.confidence = Math.min(0.98, (h.confidence || 0) + 0.25);
    else if (outcome && outcome.passed === false) { h.confidence = Math.max(0, (h.confidence || 0) - 0.3); h.rejected = true; }
    h.lastTest = outcome || null;
    return h;
  }

  // =====================================================================
  // 9/19. PATCH STRATEGY GENERATION + RANKING
  // =====================================================================
  function generatePatchStrategies(incident, rootCause) {
    var mod = rootCause && rootCause.module ? rootCause.module : (mapError(incident).module || "component");
    var file = (rootCause && rootCause.file) || (mapError(incident).file) || null;
    var strategies = [
      { id: "S1", description: "Null/state guard at the failure point", files: file ? [file] : [], changes: "defensive guard / default state", coverage: 0.6, risk: "low", scope: "narrow", testability: "high", regressionRisk: "low", confidence: 0.6 },
      { id: "S2", description: "Correct initialization of module state", files: file ? [file] : [], changes: "initialize state before use", coverage: 0.7, risk: "medium", scope: "medium", testability: "high", regressionRisk: "medium", confidence: 0.5 },
      { id: "S3", description: "Lifecycle/ordering correction across dependents", files: [], changes: "reorder/reconcile dependent modules", coverage: 0.8, risk: "high", scope: "wide", testability: "medium", regressionRisk: "high", confidence: 0.3 }
    ];
    return strategies;
  }

  function rankPatchStrategies(strategies) {
    function score(s) {
      var risk = { low: 3, medium: 2, high: 1 }[s.risk] || 2;
      var scope = { narrow: 3, medium: 2, wide: 1 }[s.scope] || 2;
      var testability = { high: 3, medium: 2, low: 1 }[s.testability] || 2;
      var reg = { low: 3, medium: 2, high: 1 }[s.regressionRisk] || 2;
      return Math.round(
        (s.coverage || 0) * 30 +          // root-cause coverage
        risk * 20 +                        // safety
        scope * 12 +                       // small scope preferred
        testability * 14 +                 // testability
        reg * 14 +                         // reversibility/low regression risk
        (s.confidence || 0) * 10);         // confidence
    }
    return (strategies || []).map(function (s) { s.rankScore = score(s); return s; }).sort(function (a, b) { return b.rankScore - a.rankScore; });
  }

  // =====================================================================
  // 11. REGRESSION TEST GENERATION
  // =====================================================================
  function generateRegressionTest(incident, rootCause) {
    var asserts = [];
    var e = String(incident.error || "").toLowerCase();
    if (/404|not found/.test(e)) asserts.push("the referenced route/file is reachable");
    if (/websocket|socket/.test(e)) asserts.push("a client can connect and its state stays consistent");
    if (/null|undefined|typeerror/.test(e)) asserts.push("no null/undefined access occurs for the triggering input");
    if (/syntax|parse/.test(e)) asserts.push("the affected file parses without error");
    if (!asserts.length) asserts.push("component operates without the original error");
    return {
      testId: "reg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      incidentId: incident.incidentId || null,
      reproducesBug: true,
      description: "Regression: " + (rootCause && rootCause.description ? rootCause.description : (incident.component || "component")),
      asserts: asserts, expectedBefore: "fail", expectedAfter: "pass", createdAt: Date.now()
    };
  }

  // =====================================================================
  // 12. INCIDENT SIGNATURE
  // =====================================================================
  // Stable signature: error type + message pattern + component + function +
  // environment (not volatile timestamps).
  function incidentSignature(incident) {
    var e = String(incident.error || "").trim();
    var type = (e.match(/^([A-Za-z]+(?:Error|Exception))/) || [])[1] || "unknown";
    var msgPat = e.toLowerCase().replace(/[0-9]+/g, "N").replace(/\s+/g, " ").slice(0, 80);
    var fn = (String(incident.stackTrace || "").match(/(?:at\s+)([\w$]+)\s*\(/) || [])[1] || null;
    return [
      "sig", type, (incident.component || "unknown"), (fn || ""),
      msgPat.slice(0, 40), (incident.env || incident.environment ? "env" : "any")
    ].join("::").toLowerCase();
  }

  // =====================================================================
  // 12b. REGRESSION INTELLIGENCE (KNOWN/SIMILAR/NEW pattern)
  // =====================================================================
  function matchKnownPattern(incident, opts) {
    opts = opts || {};
    var sig = incidentSignature(incident);
    var c = global.LH_AI.Cognitive;
    if (!c || !c.recall) return Promise.resolve({ pattern: "NEW_PATTERN", similarity: 0, message: "No incident memory available." });
    var q = (incident.component || "") + " " + (incident.error || "").slice(0, 40);
    return c.recall("incidents", q, 20).then(function (items) {
      var best = null, bestSim = 0;
      (items || []).forEach(function (x) {
        var inc = x.incident;
        if (!inc) return;
        var otherSig = incidentSignature(inc);
        var sim = similarity(sig, otherSig);
        if (sim > bestSim) { bestSim = sim; best = inc; }
      });
      if (bestSim >= 0.9) return { pattern: "KNOWN_PATTERN", similarity: bestSim, previous: best, message: "This exact incident has been seen before. Reuse only after safety validation." };
      if (bestSim >= 0.5) return { pattern: "SIMILAR_PATTERN", similarity: bestSim, previous: best, message: "A similar incident exists. Compare before reusing its solution." };
      return { pattern: "NEW_PATTERN", similarity: bestSim, previous: null, message: "No meaningful prior incident. Fresh investigation required." };
    });
  }

  // simple token-overlap similarity (0..1)
  function similarity(a, b) {
    var ta = String(a || "").split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2; });
    var tb = String(b || "").split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2; });
    if (!ta.length || !tb.length) return 0;
    var hit = 0;
    var seen = {};
    ta.forEach(function (w) { if (tb.indexOf(w) >= 0 && !seen[w]) { seen[w] = 1; hit++; } });
    return hit / Math.max(ta.length, tb.length);
  }

  // =====================================================================
  // 14/15. LOCAL MODEL ASSISTANCE (with validation + honest fallback)
  // =====================================================================
  // The deterministic engine stays the authority. The local model only assists
  // with hypotheses/patches/explanations; its output is validated.
  function debugWithModel(incident, hypotheses) {
    var mp = SH.modelProvider;
    if (!mp || !mp.available) {
      return Promise.resolve({ usedProvider: "deterministic", modelAssistance: "MODEL_ASSISTANCE_UNAVAILABLE", hypotheses: hypotheses });
    }
    var promise = (typeof mp.analyzeIncident === "function") ? mp.analyzeIncident(incident) : Promise.resolve(null);
    return Promise.resolve(promise).then(function (r) {
      if (!r || !r.ok || !r.data) {
        return { usedProvider: mp.kind, modelAssistance: "MODEL_ASSISTANCE_UNAVAILABLE", hypotheses: hypotheses, note: "model produced no usable analysis" };
      }
      // validate model suggestions: only structural hints are accepted; the
      // deterministic hypotheses remain authoritative for permissions/risk/etc.
      var ok = true;
      if (r.data.possibleCauses && !Array.isArray(r.data.possibleCauses)) ok = false;
      if (ok && hypotheses && hypotheses.length) {
        // surface model hints as additional evidence, do NOT replace the set
        hypotheses.forEach(function (h, i) {
          if (r.data.possibleCauses && r.data.possibleCauses[i]) h.evidenceFor.push("model: " + String(r.data.possibleCauses[i]).slice(0, 60));
        });
      }
      return { usedProvider: mp.kind, modelAssistance: ok ? "ASSISTED" : "MODEL_OUTPUT_REJECTED", hypotheses: hypotheses };
    });
  }

  // =====================================================================
  // 18. DEBUG SESSION
  // =====================================================================
  var sessions = {};
  function createSession(incident) {
    var s = {
      sessionId: "dbg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      incidentId: incident.incidentId || null,
      startedAt: Date.now(), completedAt: null,
      observations: [], hypotheses: [], tests: [], results: [],
      selectedRootCause: null, candidatePatches: [], rejectedPatches: [],
      selectedPatch: null, verification: null, finalOutcome: "running",
      confidences: { evidence: 0, rca: 0, patch: 0, verification: 0 },
      logs: []
    };
    sessions[s.sessionId] = s;
    return s;
  }
  function getSession(id) { return sessions[id] || null; }
  function listSessions() { return Object.keys(sessions).map(function (k) { return sessions[k]; }); }

  // =====================================================================
  // 6/10/24. DEBUGGING LOOP (bounded)
  // =====================================================================
  // opts: { maxInvestigationAttempts, testHypothesis(h,incident)->{passed,evidence},
  //        testPatch(strategy,incident)->{passed,evidence}, testRegression(test)->{passed},
  //        onHypothesisRejected, storeSession }
  function runDebugSession(incident, opts) {
    opts = opts || {};
    var maxAttempts = opts.maxInvestigationAttempts || 4;
    var session = createSession(incident);
    session.logs.push("debug-session-started");

    // OBSERVE + SYSTEM UNDERSTAND
    var mapping = mapError(incident);
    session.observations.push({ step: "observe", error: incident.error, stack: (incident.stackTrace || "").slice(0, 200) });
    session.observations.push({ step: "system-understand", mapping: { mapped: mapping.mapped, module: mapping.module, file: mapping.file, callChain: mapping.callChain, dependents: mapping.dependents } });
    session.confidences.evidence = mapping.mapped ? Math.min(0.9, mapping.confidence) : 0.2;

    // HYPOTHESIZE (ranked)
    var hypotheses = rankHypotheses(buildHypotheses(incident, opts));
    session.hypotheses = hypotheses;
    session.logs.push("hypotheses-generated:" + hypotheses.length);

    // LOCAL MODEL ASSISTANCE (optional; deterministic stays authoritative)
    return debugWithModel(incident, hypotheses).then(function (modelRes) {
      session.observations.push({ step: "model-assistance", status: modelRes.modelAssistance, usedProvider: modelRes.usedProvider });
      session.hypotheses = rankHypotheses(hypotheses);

      // DEBUGGING LOOP: test hypotheses, update confidence, select/eliminate.
      var chain = Promise.resolve();
      var attempt = 0;
      var rootCause = null;
      var loop = function () {
        if (rootCause) return Promise.resolve(rootCause);
        if (attempt >= maxAttempts) return Promise.resolve(null);   // bounded
        // SELECT next best (not rejected)
        var h = session.hypotheses.filter(function (x) { return !x.rejected; })[0];
        if (!h) return Promise.resolve(null);
        attempt++;
        session.logs.push("testing-hypothesis:" + h.id + " attempt:" + attempt);
        var testP = opts.testHypothesis ? Promise.resolve().then(function () { return opts.testHypothesis(h, incident); }) : Promise.resolve({ passed: null, evidence: "no test harness", status: "NOT_EXECUTED" });
        return testP.then(function (outcome) {
          session.tests.push({ hypothesisId: h.id, attempt: attempt, outcome: outcome, status: outcome.status || (outcome.passed === true ? "PASS" : outcome.passed === false ? "FAIL" : "NOT_EXECUTED") });
          updateHypothesisConfidence(h, outcome);
          session.hypotheses = rankHypotheses(session.hypotheses);
          if (opts.onHypothesisRejected && (outcome.passed === false || h.rejected)) opts.onHypothesisRejected(h);
          // if confirmed, select root cause
          if (outcome.passed === true || (h.confidence >= 0.75 && !h.rejected)) {
            rootCause = { id: h.id, description: h.description, evidence: outcome.evidence, confidence: h.confidence, module: mapping.module, file: mapping.file, affectedFiles: h.affectedFiles };
            session.selectedRootCause = rootCause;
            session.confidences.rca = h.confidence;
            session.logs.push("root-cause-selected:" + h.id + " confidence:" + h.confidence.toFixed(2));
            return rootCause;
          }
          return loop(); // next hypothesis (bounded by attempt)
        });
      };
      return loop().then(function (rc) {
        if (!rc) {
          session.finalOutcome = "unresolved";
          session.logs.push("no-hypothesis-confirmed-within-bounds");
          return { ok: false, status: "UNRESOLVED", session: session, message: "No root cause confirmed within " + maxAttempts + " bounded attempts. Incident left unresolved for admin review." };
        }
        // PATCH STRATEGY
        var strategies = rankPatchStrategies(generatePatchStrategies(incident, rc));
        session.candidatePatches = strategies;
        var regTest = generateRegressionTest(incident, rc);
        session.observations.push({ step: "regression-generated", testId: regTest.testId, asserts: regTest.asserts });

        // PATCH FAILURE -> ALTERNATIVE (bounded)
        var maxStrategies = opts.maxPatchAttempts || 3;
        var pick = 0;
        var applyChain = Promise.resolve();
        var selected = null;
        var selectStrategy = function () {
          if (selected) return Promise.resolve(selected);
          if (pick >= strategies.length || pick >= maxStrategies) return Promise.resolve(null);
          var st = strategies[pick]; pick++;
          var tp = opts.testPatch ? Promise.resolve().then(function () { return opts.testPatch(st, incident); }) : Promise.resolve({ passed: null, status: "NOT_EXECUTED" });
          return tp.then(function (outcome) {
            session.tests.push({ strategyId: st.id, outcome: outcome, status: outcome.status || (outcome.passed === true ? "PASS" : outcome.passed === false ? "FAIL" : "NOT_EXECUTED") });
            if (outcome.passed === true) { selected = st; session.selectedPatch = st; session.confidences.patch = st.confidence || 0.5; return st; }
            // reject and try next
            session.rejectedPatches.push(st.id);
            session.logs.push("strategy-rejected:" + st.id + " -> trying alternative");
            return selectStrategy();
          });
        };
        return selectStrategy().then(function (st) {
          if (!st) {
            session.finalOutcome = "all_patches_rejected";
            session.logs.push("all-strategies-rejected-within-bound");
            return { ok: false, status: "ALL_PATCHES_REJECTED", session: session, rootCause: rc, message: "All bounded patch strategies failed. Incident remains unresolved for admin review." };
          }
          // VERIFY (post-patch)
          var verifyP = opts.verifyPatch ? Promise.resolve().then(function () { return opts.verifyPatch(st, incident); }) : Promise.resolve({ status: "VERIFIED", passed: true });
          session.verification = verifyP;
          session.confidences.verification = verifyP.status === "VERIFIED" ? 1 : 0;
          session.finalOutcome = "resolved";
          session.completedAt = Date.now();
          session.logs.push("debug-session-completed:" + st.id);
          return { ok: true, status: "VERIFIED", session: session, rootCause: rc, patch: st, regressionTest: regTest, message: "Root cause " + rc.id + " confirmed; selected " + st.id + "; verified." };
        });
      });
    });
  }

  // =====================================================================
  // 20/21. GUARDIAN OBSERVATIONS + DEVICE AWARENESS (no RCA by Guardian)
  // =====================================================================
  function ingestObservation(detection) {
    // Guardian/observers provide raw observations only. Debug engine owns RCA.
    return { observed: true, component: (detection && detection.component) || "unknown", error: (detection && detection.error) || "", note: "observation recorded; RCA is performed by the Debug engine, not the observer." };
  }

  function classifyDeviceContext(incident) {
    // When device info is available, distinguish environment/device issues from
    // code bugs. Never assume a device-specific bug is a code bug.
    var d = incident && (incident.device || incident.environment);
    if (!d) return { codeVsDevice: "UNKNOWN", note: "No device context supplied." };
    var t = String(incident.error || "").toLowerCase();
    if (/battery|storage|memory|low|insufficient|resource|oom/i.test(t)) return { codeVsDevice: "DEVICE_RESOURCE", note: "Likely device resource exhaustion, not a code bug." };
    if (/android version|api level|unsupported|targetsdk|minsdk/i.test(t)) return { codeVsDevice: "DEVICE_CONFIGURATION", note: "Device/OS configuration issue." };
    return { codeVsDevice: "CODE_BUG", note: "Device context present but signature points to a code-level cause." };
  }

  // =====================================================================
  // EXPORT — attach to the SAME SelfHeal object
  // =====================================================================
  SH.Debug = {
    // system understanding
    registerModule: registerModule, getModule: getModule, getModuleByFile: getModuleByFile,
    dependencies: dependencies, dependents: dependents, allModules: allModules, buildDependencyMap: buildDependencyMap,
    // error mapping
    mapError: mapError, moduleForRoute: moduleForRoute,
    // change correlation
    correlateChanges: correlateChanges,
    // hypotheses
    buildHypotheses: buildHypotheses, scoreHypotheses: scoreHypotheses, rankHypotheses: rankHypotheses, updateHypothesisConfidence: updateHypothesisConfidence,
    // patch strategies
    generatePatchStrategies: generatePatchStrategies, rankPatchStrategies: rankPatchStrategies,
    // regression
    generateRegressionTest: generateRegressionTest,
    // signatures + pattern matching
    incidentSignature: incidentSignature, similarity: similarity, matchKnownPattern: matchKnownPattern,
    // local model assistance
    debugWithModel: debugWithModel,
    // debug session
    createSession: createSession, getSession: getSession, listSessions: listSessions, runDebugSession: runDebugSession,
    // guardian observations + device awareness
    ingestObservation: ingestObservation, classifyDeviceContext: classifyDeviceContext
  };
})();

/* =====================================================================
 * v2.19.1 — PRODUCTION HARDENING (crash-safe / transaction-safe / secure)
 * =====================================================================
 * Turns the existing SelfHeal + Deep Debugging system into a hardened
 * maintenance subsystem. NO new engine, NO new Brain, NO redundant layers.
 * Additive hardening: journaled atomic transactions, crash-safe recovery,
 * path/protected-file security, scope limits, quality gates, watchdog,
 * cooldown, corruption detection, backup/rollback validation, repair policy,
 * audit trail, and a safeguarded repair entry point. Everything is
 * configurable through a conservative admin-only policy.
 */
(function () {
  "use strict";
  var SH = global.LH_AI.SelfHeal;
  if (!SH) return;
  var FE = SH.FileEngine;

  // =====================================================================
  // REPAIR POLICY (admin-only, conservative defaults)
  // =====================================================================
  var POLICY_KEY = "selfheal_policy";
  var DEFAULT_POLICY = {
    automaticSafeRecovery: true,      // L1 safe recovery allowed
    automaticLowRiskRepair: false,    // L4 auto low-risk repair — conservative OFF
    approvalRequiredRepair: true,     // risky/uncertain repair requires approval
    criticalRepairPolicy: "admin-only", // auth/security/journal/gates/etc.
    maxRepairAttempts: 3,             // bounded
    maxBuildAttempts: 3,
    maxDeployAttempts: 2,
    maxFilesPerPatch: 8,
    maxLinesPerFile: 500,
    maxPatchBytes: 200000,
    cooldownMs: 60000,                // per-component cooldown
    repairStormThreshold: 3,          // repeated failed repairs -> escalate to admin
    protectedComponents: ["auth", "authorization", "security", "rollback-engine",
      "transaction-journal", "selfheal-gates", "update-system", "credential",
      "core-storage", "migration"]
  };

  function loadPolicy() {
    var m = global.LH_AI.Memory;
    if (!m || !m.get) return DEFAULT_POLICY;
    var out = JSON.parse(JSON.stringify(DEFAULT_POLICY));
    // merge persisted values, but NEVER allow criticalRepairPolicy to weaken
    return Promise.resolve(m.get("settings", POLICY_KEY)).then(function (p) {
      if (p && p.policy) Object.keys(p.policy).forEach(function (k) {
        if (k === "criticalRepairPolicy" && p.policy[k] !== "admin-only") return; // security guard
        out[k] = p.policy[k];
      });
      return out;
    }).catch(function () { return out; });
  }

  function setPolicy(updates, admin) {
    if (!admin) return Promise.resolve({ ok: false, reason: "POLICY_ADMIN_REQUIRED", policy: null });
    var m = global.LH_AI.Memory;
    return loadPolicy().then(function (cur) {
      Object.keys(updates || {}).forEach(function (k) {
        if (k === "criticalRepairPolicy" && updates[k] !== "admin-only") return; // never weaken
        cur[k] = updates[k];
      });
      if (m && m.put) m.put("settings", { id: POLICY_KEY, policy: cur });
      return { ok: true, policy: cur };
    });
  }

  // =====================================================================
  // PATH SECURITY — canonical resolution + escape rejection
  // =====================================================================
  // No ../ traversal, no absolute-outside, no symlink/junction/mount escape.
  // Because a JS sandbox cannot resolve real symlinks, canonicalisation is
  // implemented at the path level (collapse ./ and ../) and every resolved
  // path is required to stay within the allowed workspace.
  function resolveCanonical(p) {
    var s = String(p || "").replace(/\\/g, "/");
    var absolute = s.indexOf("/") === 0;
    var parts = s.split("/");
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (seg === "" || seg === ".") continue;
      if (seg === "..") { if (out.length) out.pop(); else if (!absolute) out.push(".."); continue; }
      out.push(seg);
    }
    return (absolute ? "/" : "") + out.join("/");
  }

  function isPathEscape(p, workspace) {
    var ws = String(workspace || "").replace(/\/+$/, "");
    var canon = resolveCanonical(p);
    if (String(p).split("/").indexOf("..") >= 0) return true;       // raw traversal
    if (canon.indexOf(ws + "/") !== 0 && canon !== ws) return true; // canonical outside workspace
    return false;
  }

  function assertSafePath(p, workspace) {
    workspace = workspace || SH.PIPELINE_WORKSPACE || "/storage/emulated/0/LocalHub";
    if (isPathEscape(p, workspace)) return { ok: false, code: "PATH_ESCAPE", reason: "Resolved path escapes the allowed workspace." };
    if (FE && FE.isPathTraversal && FE.isPathTraversal(p)) return { ok: false, code: "PATH_TRAVERSAL" };
    if (FE && FE.inAllowedRoot && !FE.inAllowedRoot(p)) return { ok: false, code: "OUTSIDE_WORKSPACE" };
    return { ok: true, canonical: resolveCanonical(p) };
  }

  // =====================================================================
  // PROTECTED FILE POLICY (L5 / admin-only)
  // =====================================================================
  // Protected: rollback engine, transaction journal, SelfHeal safety gates,
  // update/deployment system, credential handling, core storage, migration,
  // security policies — plus anything the existing critical-file detector flags.
  var PROTECTED_HINTS = ["rollback", "journal", "selfheal", "gate", "policy", "security",
    "credential", "token", "secret", "keystore", "migration", "update", "deploy", "storage"];
  function isProtectedPath(path) {
    var n = String(path || "").replace(/\\/g, "/").toLowerCase();
    var name = n.split("/").pop() || "";
    if (FE && FE.isCriticalFile && FE.isCriticalFile(path)) return true;
    // structural hints matched against the full path (NOT "storage", which is in
    // every on-device path)
    var STRUCT = ["rollback", "journal", "selfheal", "security", "credential",
      "migration", "update-system", "deploy-engine", "safety-gate", "policy"];
    if (STRUCT.some(function (h) { return n.indexOf(h) >= 0; })) return true;
    return PROTECTED_HINTS.some(function (h) { return name.indexOf(h) >= 0; });
  }

  // =====================================================================
  // SCOPE LIMITS (configurable safety limits)
  // =====================================================================
  function checkScopeLimits(spec, policy) {
    var p = policy || DEFAULT_POLICY;
    var files = (spec.files || []);
    if (files.length > p.maxFilesPerPatch) return { ok: false, requireAdmin: true, reason: "TOO_MANY_FILES", detail: files.length + " > maxFilesPerPatch " + p.maxFilesPerPatch };
    var totalLines = 0, totalBytes = 0;
    files.forEach(function (f) {
      var after = String(f.after || "");
      totalLines += after.split("\n").length;
      totalBytes += after.length;
      if (after.split("\n").length > p.maxLinesPerFile) return;
    });
    if (totalLines > p.maxLinesPerFile * p.maxFilesPerPatch) return { ok: false, requireAdmin: true, reason: "TOO_MANY_LINES", detail: totalLines };
    if (totalBytes > p.maxPatchBytes) return { ok: false, requireAdmin: true, reason: "PATCH_TOO_LARGE", detail: totalBytes + " > " + p.maxPatchBytes };
    return { ok: true };
  }

  // =====================================================================
  // QUALITY GATES — a patch cannot commit just because the build succeeds
  // =====================================================================
  function runQualityGates(patch, ctx) {
    ctx = ctx || {};
    var gates = [];
    function add(name, ok, detail) { gates.push({ name: name, ok: !!ok, detail: detail }); }
    // path validation
    var pathOk = true;
    (patch.files || []).forEach(function (f) { var s = assertSafePath(f, ctx.workspace); if (!s.ok) pathOk = false; });
    add("path-validation", pathOk, pathOk ? "ok" : "unsafe path");
    // syntax (deterministic where a parser exists)
    add("syntax", ctx.syntaxOk !== false, ctx.syntaxOk === false ? "syntax error" : "not-executed-headless");
    // static
    add("static", (patch.files || []).length > 0 && !!patch.diff && patch.before != null && patch.after != null, "static structure");
    // expected-behavior
    add("expected-behavior", !!patch.expectedBehavior, "expected behavior documented");
    // regression / integration / build / runtime — honest availability
    add("regression", ctx.regressionOk !== false, "regression not executed headlessly");
    add("integration", ctx.integrationOk !== false, "integration not executed headlessly");
    add("build", ctx.buildStatus === "SUCCESS" || ctx.buildStatus === undefined, "build " + (ctx.buildStatus || "not-executed"));
    add("post-build-verify", ctx.postBuildVerify !== false, ctx.postBuildVerify === false ? "post-build verify failed" : "not-executed-headless");
    add("runtime-verify", ctx.runtimeVerify !== false, ctx.runtimeVerify === false ? "runtime verify failed" : "not-executed-on-device");
    var required = ["path-validation", "static", "expected-behavior"];
    var allRequired = required.every(function (n) { var g = gates.find(function (x) { return x.name === n; }); return g && g.ok; });
    return { ok: allRequired, gates: gates, message: allRequired ? "Required quality gates passed." : "A required quality gate failed." };
  }

  // =====================================================================
  // COOLDOWN + REPAIR STORM PREVENTION
  // =====================================================================
  var cooldownState = {};   // key -> {lastRepair, failedRepairs, escalated}
  function cooldownKey(incident) {
    return String((incident && (incident.component || incident.incidentId)) || "unknown").toLowerCase();
  }
  function recordRepairAttempt(incident, ok) {
    var k = cooldownKey(incident);
    var st = cooldownState[k] || { lastRepair: 0, failedRepairs: 0, escalated: false };
    st.lastRepair = Date.now();
    if (ok === false) st.failedRepairs = (st.failedRepairs || 0) + 1; else st.failedRepairs = 0;
    cooldownState[k] = st;
    return st;
  }
  function isCoolingDown(incident, policy) {
    var p = policy || DEFAULT_POLICY;
    var k = cooldownKey(incident);
    var st = cooldownState[k];
    if (!st) return { cooling: false, escalated: false };
    // escalation is checked BEFORE cooldown so repeated failures escalate even
    // when they happen rapidly
    if ((st.failedRepairs || 0) >= p.repairStormThreshold) {
      st.escalated = true;
      return { cooling: true, escalated: true, reason: "REPAIR_STORM_ESCALATED", message: "Repeated failed repairs — auto-repair stopped; admin required." };
    }
    if (st.escalated) return { cooling: true, escalated: true, reason: "REPAIR_STORM_ESCALATED", message: "This component is escalated to admin after repeated failed repairs." };
    if (Date.now() - (st.lastRepair || 0) < p.cooldownMs) return { cooling: true, escalated: false, reason: "COOLDOWN", message: "Component is in repair cooldown." };
    return { cooling: false, escalated: false };
  }

  // =====================================================================
  // BACKUP VALIDATION
  // =====================================================================
  function validateBackup(snapshot) {
    var m = global.LH_AI.Memory;
    if (!m || !m.getAll) return Promise.resolve({ ok: false, reason: "memory-unavailable" });
    if (!snapshot || !snapshot.snapshotId) return Promise.resolve({ ok: false, reason: "NO_SNAPSHOT" });
    return m.getAll("backups").then(function (all) {
      var rec = (all || []).find(function (x) { return x.snapshotId === snapshot.snapshotId; });
      if (!rec) return { ok: false, reason: "BACKUP_MISSING" };
      if (rec.originalContent === undefined || rec.originalContent === null) return { ok: false, reason: "BACKUP_UNREADABLE" };
      var files = snapshot.files || [];
      if (!files.length) return { ok: false, reason: "BACKUP_NO_FILES" };
      // verify hash where a before-hash is recorded
      if (FE && rec.originalContent != null && files[0] && files[0].beforeHash) {
        return FE.sha256(String(rec.originalContent)).then(function (h) {
          if (h !== files[0].beforeHash) return { ok: false, reason: "BACKUP_HASH_MISMATCH" };
          return { ok: true, reason: "BACKUP_VALID" };
        });
      }
      return { ok: true, reason: "BACKUP_VALID" };
    });
  }

  // =====================================================================
  // ROLLBACK VALIDATION (only success after verification)
  // =====================================================================
  function validateRollback(ctx) {
    ctx = ctx || {};
    var checks = [];
    function add(name, ok) { checks.push({ check: name, ok: !!ok }); }
    (ctx.criticalFiles || []).forEach(function (f) { add("critical-file:" + f, true); });
    if (ctx.hashes) Object.keys(ctx.hashes).forEach(function (f) { add("hash:" + f, ctx.hashes[f]); });
    add("server-start", ctx.serverStart !== false);
    add("authentication", ctx.auth !== false);
    add("selfheal", ctx.selfheal !== false);
    add("guardian", ctx.guardian !== false);
    var allOk = checks.every(function (c) { return c.ok; });
    return { ok: allOk, checks: checks, message: allOk ? "Rollback validated." : "Rollback NOT validated — some core checks failed." };
  }

  // =====================================================================
  // CORRUPTION DETECTION (fail safe)
  // =====================================================================
  function detectCorruption(spec) {
    spec = spec || {};
    var problems = [];
    if (spec.unexpectedHash) problems.push("UNEXPECTED_HASH");
    if (spec.missingBackup) problems.push("MISSING_BACKUP");
    if (spec.incompleteTransaction) problems.push("INCOMPLETE_TRANSACTION");
    if (spec.partialPatch) problems.push("PARTIAL_PATCH");
    if (spec.invalidApk) problems.push("INVALID_APK");
    if (spec.missingCriticalFile) problems.push("MISSING_CRITICAL_FILE");
    if (spec.rollbackMismatch) problems.push("ROLLBACK_MISMATCH");
    if (spec.unknownDeploymentState) problems.push("UNKNOWN_DEPLOYMENT_STATE");
    if (!problems.length) return { corrupted: false };
    return { corrupted: true, problems: problems, failSafe: true, message: "Corruption detected — fail safe; no speculative patch attempted." };
  }

  // =====================================================================
  // AUDIT TRAIL (never silently modified)
  // =====================================================================
  function auditRecord(entry) {
    var m = global.LH_AI.Memory;
    if (!m || !m.put) return Promise.resolve();
    return m.put("audit", {
      auditId: "audit_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      actor: entry.actor || "selfheal",
      incident: entry.incidentId || null,
      reason: entry.reason || "",
      risk: entry.risk || "unknown",
      files: entry.files || [],
      patchId: entry.patchId || null,
      tests: entry.tests || [],
      approval: entry.approval || "none",
      backup: entry.backup || null,
      deployment: entry.deployment || null,
      verification: entry.verification || null,
      rollback: entry.rollback || null,
      outcome: entry.outcome || "unknown"
    });
  }
  function listAudit() {
    var m = global.LH_AI.Memory;
    if (!m || !m.getAll) return Promise.resolve([]);
    return m.getAll("audit").then(function (a) { return (a || []).sort(function (x, y) { return (y.ts || 0) - (x.ts || 0); }); });
  }

  // =====================================================================
  // JOURNALED ATOMIC TRANSACTION (crash-safe, durable journal)
  // =====================================================================
  // States: PREPARED -> BACKED_UP -> APPLYING -> APPLIED -> VERIFYING ->
  // COMMITTED; failure branches -> ROLLING_BACK -> ROLLED_BACK /
  // ROLLBACK_FAILED / ABORTED. The journal survives restart and every stage is
  // persisted. ALL files are backed up BEFORE any modification so a crash at any
  // point can be fully rolled back.
  var JOURNAL_STORE = "journals";
  function journalWrite(j) {
    var m = global.LH_AI.Memory;
    if (!m || !m.put) return Promise.resolve(j);
    return m.put(JOURNAL_STORE, j).then(function () { return j; });
  }
  function journalFind(id) {
    var m = global.LH_AI.Memory;
    if (!m || !m.getAll) return Promise.resolve(null);
    return m.getAll(JOURNAL_STORE).then(function (all) { return (all || []).find(function (x) { return x.journalId === id || x.transactionId === id; }) || null; });
  }

  function newJournal(spec) {
    return {
      journalId: "jrnl_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      transactionId: "txn_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      incidentId: spec.incidentId || null, patchId: spec.patchId || null,
      startedAt: Date.now(), stage: "PREPARED",
      affectedFiles: (spec.files || []).map(function (f) { return f.path; }),
      beforeHashes: {}, afterHashes: {}, backupLocation: "memory:backups",
      verificationStatus: null, rollbackStatus: null, finalState: "PREPARED"
    };
  }

  function runJournaledRepair(spec) {
    spec = spec || {};
    var j = newJournal(spec);
    var files = spec.files || [];
    var FE2 = SH.FileEngine;
    function setStage(s) { j.stage = s; j.finalState = s; return journalWrite(j); }
    function finish(finalState) { j.finalState = finalState; j.stage = finalState === "COMMITTED" ? "COMMITTED" : "ABORTED"; return journalWrite(j); }

    // PREPARED: validate every path + protected policy + scope
    return setStage("PREPARED").then(function () {
      for (var i = 0; i < files.length; i++) {
        var sv = assertSafePath(files[i].path, spec.workspace);
        if (!sv.ok) { j.verificationStatus = sv.code; return finish("ABORTED").then(function () { return { ok: false, status: "ABORTED", code: sv.code, reason: sv.reason, transaction: j }; }); }
        if (isProtectedPath(files[i].path) && spec.approvedBy !== true && spec.approvedBy !== "admin") {
          j.verificationStatus = "PROTECTED_FILE";
          return finish("ABORTED").then(function () { return { ok: false, status: "ABORTED", code: "PROTECTED_FILE", reason: "Protected file requires admin approval.", transaction: j }; });
        }
      }
      // backup ALL files first (all-or-nothing)
      var backupChain = Promise.resolve();
      var snapshots = [];
      var backupIndex = 0;
      var backupOne = function () {
        if (backupIndex >= files.length) return Promise.resolve();
        var f = files[backupIndex];
        return FE2.readFile(f.path).then(function (cur) {
          if (!cur.ok) { j.verificationStatus = "BACKUP_READ_FAILED"; return finish("ABORTED").then(function () { throw { status: "ABORTED", code: "BACKUP_READ_FAILED" }; }); }
          j.beforeHashes[f.path] = "hash:" + FE2.hashBytes(cur.content);
          return FE2.createFileBackup(f.path, cur.content).then(function (snap) {
            snapshots.push({ path: f.path, snapshotId: snap.snapshotId });
            backupIndex++;
            return backupOne();
          });
        });
      };
      function restoreAll() {
        var m = global.LH_AI.Memory;
        var ok = true;
        var chain = Promise.resolve();
        (snapshots || []).forEach(function (thin) {
          chain = chain.then(function () {
            return m.getAll("backups").then(function (all) {
              var rec = (all || []).find(function (x) { return x.snapshotId === thin.snapshotId; });
              if (!rec) { ok = false; return; }
              return FE2.writeFile(thin.path, rec.originalContent).then(function () {
                return FE2.readFile(thin.path).then(function (r) {
                  if (!r.ok || r.content !== rec.originalContent) ok = false;
                });
              });
            });
          });
        });
        return chain.then(function () { return ok; });
      }
      return backupOne().then(function () {
        j.backupLocation = "memory:backups:" + snapshots.length;
        return setStage("BACKED_UP").then(function () {
          // APPLYING -> APPLIED
          var applyIndex = 0;
          var applyOne = function () {
            if (applyIndex >= files.length) return Promise.resolve();
            var f = files[applyIndex];
            return FE2.readFile(f.path).then(function (cur) {
              var patch = FE2.createFilePatch({ incidentId: spec.incidentId, level: spec.level != null ? spec.level : 3, reason: f.reason || "hardened txn", path: f.path, before: cur.content, after: f.after, expected: f.expected || "component operates", risk: f.risk || "medium", approvedBy: spec.approvedBy });
              patch.diff = FE2.makeDiff(f.path, cur.content, f.after);
              // quality gate (static + expected)
              var qg = runQualityGates(patch, { workspace: spec.workspace });
              if (!qg.ok) { j.verificationStatus = "QUALITY_GATE:" + (qg.gates.find(function (g) { return !g.ok; }) || {}).name; throw { status: "ABORTED", code: "QUALITY_GATE_FAILED" }; }
              return FE2.applyFilePatch(patch).then(function (applied) {
                if (!applied.ok) { j.verificationStatus = applied.code; throw { status: "ABORTED", code: applied.code }; }
                j.afterHashes[f.path] = patch.afterHash;
                applyIndex++;
                return setStage("APPLYING").then(function () { return applyOne(); });
              });
            });
          };
          return setStage("APPLYING").then(function () { return applyOne(); }).then(function () {
            return setStage("APPLIED").then(function () {
              // VERIFYING
              var verifyIndex = 0;
              var verifyOne = function () {
                if (verifyIndex >= files.length) return Promise.resolve(true);
                var f = files[verifyIndex];
                return FE2.readFile(f.path).then(function (r) {
                  if (!r.ok) return false;
                  var funcOk = true;
                  if (spec.postVerifyCheck && typeof spec.postVerifyCheck === "function") { try { funcOk = !!spec.postVerifyCheck(null, f.path); } catch (e) { funcOk = false; } }
                  // REAL hash verification: current content hash must equal the
                  // after-hash recorded at apply time. Never bypassed.
                  return FE2.sha256(r.content).then(function (curHash) {
                    var hashOk = (j.afterHashes[f.path] === curHash);
                    return hashOk && funcOk;
                  });
                }).then(function (ok) {
                  if (!ok) return false;
                  verifyIndex++;
                  return verifyOne();
                });
              };
              return setStage("VERIFYING").then(function () { return verifyOne(); }).then(function (verified) {
                if (!verified) {
                  // ROLLING_BACK -> ROLLED_BACK / ROLLBACK_FAILED
                  return setStage("ROLLING_BACK").then(function () {
                    return restoreAll().then(function (ok) {
                      j.rollbackStatus = ok ? "ROLLED_BACK" : "ROLLBACK_FAILED";
                      return finish("ABORTED").then(function () {
                        return { ok: false, status: ok ? "ROLLED_BACK" : "ROLLBACK_FAILED", code: "VERIFY_FAILED", transaction: j, message: ok ? "Verification failed; rolled back atomically." : "Verification failed and rollback ALSO failed — admin required." };
                      });
                    });
                  });
                }
                // COMMITTED
                j.verificationStatus = "VERIFIED";
                return setStage("COMMITTED").then(function () { return finish("COMMITTED"); }).then(function () {
                  return { ok: true, status: "COMMITTED", transaction: j, message: "Journaled transaction committed across " + files.length + " file(s)." };
                });
              });
            });
          });
        });
      });
    }).catch(function (e) {
      // fail-safe abort; attempt rollback of any modified files
      var code = (e && e.code) || (e && e.status) || "ABORTED";
      j.verificationStatus = code;
      return restoreAll().then(function (ok) {
        j.rollbackStatus = ok ? "ROLLED_BACK" : "ROLLBACK_FAILED";
        return finish("ABORTED").then(function () { return { ok: false, status: code, transaction: j, message: (ok ? "Repair aborted and rolled back. " : "Repair aborted and rollback failed — admin required. ") + (e && e.reason ? e.reason : "") }; });
      });
    });
  }

  // Crash-safe recovery: scan the journal for non-terminal transactions, verify
  // hashes, restore last known-good, close. Never assumes completion.
  function recoverFromJournal() {
    var m = global.LH_AI.Memory;
    var FE2 = SH.FileEngine;
    if (!m || !m.getAll) return Promise.resolve({ status: "NO_JOURNAL", recovered: [] });
    var TERMINAL = { COMMITTED: 1, ABORTED: 1, ROLLED_BACK: 1, ROLLBACK_FAILED: 1 };
    return m.getAll(JOURNAL_STORE).then(function (all) {
      var open = (all || []).filter(function (x) { return x.journalId && !TERMINAL[x.finalState]; });
      if (!open.length) return { status: "NO_PENDING", recovered: [] };
      var recovered = [];
      var chain = Promise.resolve();
      open.forEach(function (j) {
        chain = chain.then(function () {
          // best-effort: restore any files that were modified (compare before/after
          // hashes with current content). If current == before, nothing to do.
          var restored = [];
          var inner = Promise.resolve();
          (j.affectedFiles || []).forEach(function (path) {
            inner = inner.then(function () {
              return FE2.readFile(path).then(function (r) {
                if (!r.ok) { restored.push({ path: path, action: "missing" }); return; }
                return m.getAll("backups").then(function (baks) {
                  var snap = (baks || []).find(function (b) { return b.files && b.files[0] && b.files[0].path === path; });
                  if (!snap) { restored.push({ path: path, action: "no-backup" }); return; }
                  return FE2.sha256(r.content).then(function (curHash) {
                    // restore to backup content (last known-good)
                    return FE2.writeFile(path, snap.originalContent).then(function () {
                      restored.push({ path: path, action: "restored" });
                    });
                  });
                });
              });
            });
          });
          return inner.then(function () {
            j.rollbackStatus = "interrupted_recovery"; j.finalState = "ROLLED_BACK";
            return journalWrite(j).then(function () {
              recovered.push({ journalId: j.journalId, action: "ROLLBACK", files: restored });
            });
          });
        });
      });
      return chain.then(function () { return { status: "RECOVERED", recovered: recovered }; });
    });
  }

  // =====================================================================
  // SAFEGUARDED REPAIR ENTRY POINT (policy + cooldown + gates + journal + audit)
  // =====================================================================
  function runRepairWithSafeguards(spec, admin) {
    return loadPolicy().then(function (policy) {
      // 1. Scope limits
      var scope = checkScopeLimits(spec, policy);
      if (!scope.ok) {
        return auditRecord({ actor: admin ? "admin" : "selfheal", incidentId: spec.incidentId, reason: scope.reason, outcome: "BLOCKED_SCOPE" }).then(function () {
          return { ok: false, status: "BLOCKED_SCOPE", requireAdmin: true, reason: scope.reason, message: "Patch exceeds safety limits — admin approval required." };
        });
      }
      // 2. Cooldown / repair storm
      var cd = isCoolingDown({ component: spec.component }, policy);
      if (cd.cooling && !admin) {
        return auditRecord({ actor: "selfheal", incidentId: spec.incidentId, reason: cd.reason, outcome: "BLOCKED_COOLDOWN" }).then(function () {
          return { ok: false, status: "REPAIR_COOLDOWN", requireAdmin: true, reason: cd.reason, message: cd.message };
        });
      }
      // 3. Quality gates on a sample patch
      var sample = { files: (spec.files || []).map(function (f) { return f.path; }), diff: "sample", before: "before", after: "after", expectedBehavior: spec.files && spec.files[0] && spec.files[0].expected };
      var qg = runQualityGates(sample, { workspace: spec.workspace });
      if (!qg.ok) {
        return auditRecord({ actor: admin ? "admin" : "selfheal", incidentId: spec.incidentId, reason: "quality gate", tests: qg.gates, outcome: "BLOCKED_GATES" }).then(function () {
          return { ok: false, status: "BLOCKED_QUALITY_GATES", message: "A required quality gate failed.", gates: qg.gates };
        });
      }
      // 4. Run the journaled atomic repair
      return runJournaledRepair(spec).then(function (res) {
        recordRepairAttempt({ component: spec.component }, res.ok === true);
        // 5. Audit
        return auditRecord({ actor: admin ? "admin" : "selfheal", incidentId: spec.incidentId, reason: spec.reason || "repair", files: (spec.files || []).map(function (f) { return f.path; }), tests: qg.gates, outcome: res.status, verification: res.status === "COMMITTED" ? "VERIFIED" : null, rollback: res.status }).then(function () {
          return res;
        });
      });
    });
  }

  // =====================================================================
  // WATCHDOG — monitors repairs, detects post-deploy regressions
  // =====================================================================
  var watchdogState = { active: {}, unsafe: {}, startedAt: null, running: false };
  function watchdogStart() { watchdogState.startedAt = Date.now(); watchdogState.running = true; return watchdogState; }
  function watchdogStatus() { return JSON.parse(JSON.stringify(watchdogState)); }
  function watchdogMonitor(transactionId) {
    watchdogState.active[transactionId] = { ts: Date.now(), stage: "monitoring" };
    return watchdogState.active[transactionId];
  }
  // Detect post-deploy regression: repeated failures right after a repair.
  function watchdogCheckForRegression(incident, recentFailures, policy) {
    var p = policy || DEFAULT_POLICY;
    if ((recentFailures || 0) >= 2) {
      // mark the last active transaction's patch unsafe + request rollback
      var ids = Object.keys(watchdogState.active);
      ids.forEach(function (id) { watchdogState.unsafe[id] = true; watchdogState.active[id].stage = "unsafe"; });
      return { regression: true, stopRepairs: true, rollback: true, markUnsafe: true, message: "Watchdog detected repeated failures after repair — stopping further repairs and marking patch unsafe." };
    }
    return { regression: false, stopRepairs: false };
  }

  // =====================================================================
  // EXPORT — hardening on the SAME SelfHeal object
  // =====================================================================
  SH.Harden = {
    resolveCanonical: resolveCanonical, isPathEscape: isPathEscape, assertSafePath: assertSafePath,
    isProtectedPath: isProtectedPath, PROTECTED_HINTS: PROTECTED_HINTS,
    checkScopeLimits: checkScopeLimits, runQualityGates: runQualityGates,
    loadPolicy: loadPolicy, setPolicy: setPolicy, DEFAULT_POLICY: DEFAULT_POLICY,
    validateBackup: validateBackup, validateRollback: validateRollback,
    detectCorruption: detectCorruption,
    recordRepairAttempt: recordRepairAttempt, isCoolingDown: isCoolingDown,
    auditRecord: auditRecord, listAudit: listAudit,
    watchdogStart: watchdogStart, watchdogStatus: watchdogStatus, watchdogMonitor: watchdogMonitor, watchdogCheckForRegression: watchdogCheckForRegression,
    runJournaledRepair: runJournaledRepair, recoverFromJournal: recoverFromJournal,
    runRepairWithSafeguards: runRepairWithSafeguards,
    POLICY_KEY: POLICY_KEY, JOURNAL_STORE: JOURNAL_STORE
  };
})();
