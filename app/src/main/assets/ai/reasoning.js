/* reasoning.js - breaks complex goals into steps, tracks progress, explains decisions. */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  var Reasoning = {
    plan: function (goal, steps) {
      return {
        goal: goal,
        steps: steps.map(function (s, i) {
          return {
            index: i,
            action: s.action || s,
            params: s.params || {},
            status: "pending",
            note: s.note || ""
          };
        }),
        startedAt: Date.now(),
        current: -1
      };
    },

    execute: async function (plan, executor) {
      var results = [];
      for (var i = 0; i < plan.steps.length; i++) {
        var step = plan.steps[i];
        step.status = "running";
        plan.current = i;
        try {
          var r = await executor(step);
          step.status = "done";
          step.result = r;
          results.push({ step: step, ok: true, result: r });
        } catch (e) {
          step.status = "error";
          step.error = e.message || String(e);
          results.push({ step: step, ok: false, error: step.error });
          // Error recovery: stop the plan and report the failing step.
          return { plan: plan, results: results, ok: false, failedAt: i, reason: step.error };
        }
      }
      return { plan: plan, results: results, ok: true };
    },

    explain: function (plan) {
      var lines = ["Goal: " + plan.goal];
      plan.steps.forEach(function (s) {
        var icon = s.status === "done" ? "✓" : s.status === "error" ? "✗" : s.status === "running" ? "→" : "·";
        lines.push(icon + " " + s.action + (s.note ? " — " + s.note : ""));
      });
      return lines.join("\n");
    }
  };

  global.LH_AI.Reasoning = Reasoning;
})(window);
