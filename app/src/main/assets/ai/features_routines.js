/* features_routines.js - Routine engine + proactive commands (v2.21). */
(function (global) {
  "use strict";
  var C = global.LH_AI.Commands;
  if (!C) return;
  var PB = global.LH_AI.Cognitive && global.LH_AI.Cognitive.PersonalBrain;
  if (!PB) return;
  function pb(fn) { return Promise.resolve(fn()); }

  // show my routines
  C.register({ module: "routine", category: "routine", name: "list-routines", deep: false,
    match: [/\bshow (my )?routines\b/i, /\bwhat routines (do you know|exist)\b/i, /\blist routines\b/i],
    admin: false, run: function () {
      return pb(function () {
        return PB.listRoutines().then(function (rs) {
          if (!rs.length) return { ok: true, message: "No routines yet. I can suggest one when I spot a repeated pattern." };
          return { ok: true, message: "🔄 Routines:\n" + rs.map(function (r) { return "• " + r.name + " [" + r.status + "] conf " + Math.round((r.confidence || 0) * 100) + "% — " + r.steps.map(function (s) { return s.action; }).join(" → "); }).join("\n") };
        });
      });
    } });

  // yes make this a routine (approve latest candidate)
  C.register({ module: "routine", category: "routine", name: "approve-routine", deep: false,
    match: [/\b(yes|ok|sure|go ahead)[,.]?\s+(make (it|that) a routine|create (it as |that as )?a routine)\b/i, /\b(approve|activate) (this|the )?routine\b/i, /\bmake it a routine\b/i],
    admin: false, run: function () {
      return pb(function () {
        return PB.detectRoutineCandidates().then(function (cands) {
          if (!cands.length) return { ok: true, message: "No routine candidate to approve right now." };
          var cand = cands[cands.length - 1];
          return PB.createRoutine({ name: "Routine: " + cand.steps.join(" then "), steps: cand.steps, contextConditions: { space: cand.context }, confidence: cand.confidence, frequency: cand.frequency, timesObserved: cand.timesObserved }).then(function (res) {
            return PB.approveRoutine(res.routine.id, true).then(function () {
              return { ok: true, message: "✅ Routine approved + active: " + res.routine.name };
            });
          });
        });
      });
    } });

  // no / don't suggest again
  C.register({ module: "routine", category: "routine", name: "reject-routine", deep: false,
    match: [/\bno[,.]?\s+(don'?t|do not)\s+(suggest|make)\b/i, /\bdon'?t (suggest|make) (this|that) a routine\b/i, /\breject (this|that) (routine|suggestion)\b/i],
    admin: false, run: function () {
      return pb(function () {
        return PB.detectRoutineCandidates().then(function (cands) {
          if (!cands.length) return { ok: true, message: "Nothing to reject." };
          var cand = cands[cands.length - 1];
          return PB.recordSuggestionResponse(cand.id, "rejected", "user-rejected").then(function () {
            return { ok: true, message: "👍 Understood — I'll stop suggesting that." };
          });
        });
      });
    } });

  // pause/resume/disable/enable routine <name>
  C.register({ module: "routine", category: "routine", name: "routine-state", deep: false,
    match: [/\b(pause|resume|disable|enable|activate) (this |the )?routine\b/i, /\b(pause|resume|disable|enable) (my )?routine\b/i],
    admin: false, run: function (t) {
      return pb(function () {
        var verb = /pause/.test(t) ? "pause" : /resume/.test(t) ? "resume" : /disable/.test(t) ? "disable" : /(enable|activate)/.test(t) ? "enable" : null;
        if (!verb) return { ok: true, message: "Say 'pause/resume/disable/enable this routine'." };
        return PB.listRoutines().then(function (rs) {
          if (!rs.length) return { ok: true, message: "No routines to " + verb + "." };
          var r = rs[rs.length - 1];
          var fn = verb === "pause" ? PB.pauseRoutine : verb === "resume" ? PB.resumeRoutine : verb === "disable" ? PB.disableRoutine : PB.enableRoutine;
          return fn(r.id).then(function () { return { ok: true, message: "Routine '" + r.name + "' " + verb + "d." }; });
        });
      });
    } });

  // run this routine
  C.register({ module: "routine", category: "routine", name: "run-routine", deep: true,
    match: [/\brun (this |the )?routine\b/i, /\bexecute (this |the )?routine\b/i],
    admin: false, run: function () {
      return pb(function () {
        return PB.listRoutines({ status: "ACTIVE" }).then(function (rs) {
          if (!rs.length) return { ok: true, message: "No active routines to run." };
          var r = rs[rs.length - 1];
          return PB.executeRoutine(r.id, {}, { approved: true }).then(function (res) {
            return { ok: res.ok, message: res.ok ? ("✅ Ran '" + r.name + "': " + res.results.map(function (x) { return x.action + (x.ok ? "✓" : "✗"); }).join(" ")) : ("Routine failed/blocked: " + res.reason) };
          });
        });
      });
    } });

  // why did you suggest this
  C.register({ module: "routine", category: "routine", name: "why-suggest", deep: false,
    match: [/\bwhy did you (suggest|say)\b/i, /\bwhy (this|that) suggestion\b/i],
    admin: false, run: function () {
      return pb(function () {
        return PB.suggestNow({}).then(function (su) {
          if (!su.length) return { ok: true, message: "No active suggestion to explain." };
          return PB.explainSuggestion(su[0]).then(function (e) { return { ok: true, message: e.message }; });
        });
      });
    } });
})(window);
