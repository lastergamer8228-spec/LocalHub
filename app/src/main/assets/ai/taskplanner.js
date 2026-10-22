/* taskplanner.js - LocalHub OS Task Planner.
 *
 * Breaks complex commands into deterministic, ordered steps and executes them
 * sequentially. E.g. "play my last downloaded movie" becomes:
 *   open downloads -> find latest video -> open media player -> start playback.
 */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  var Planner = global.LH_AI.Planner;

  // Ordered list of task templates. Each has a name and a plan() that returns
  // an array of step objects { action, params }.
  var templates = {};

  function register(name, planFn) {
    templates[name] = planFn;
  }

  function detect(text) {
    var t = text.toLowerCase();
    if (/play\s+my\s+last\s+(downloaded\s+)?(movie|video|film)/.test(t)) return "playLastDownloadedMedia";
    if (/(restart|reboot)\s+server\s+then\s+(show|open)\s+logs/.test(t)) return "restartThenLogs";
    if (/(download|get)\s+and\s+open/.test(t)) return "downloadAndOpen";
    if (/organize\s+downloads/.test(t)) return "organizeDownloads";
    return null;
  }

  function planFor(text) {
    var name = detect(text);
    if (!name) return null;
    var plan = templates[name];
    if (!plan) return null;
    return { name: name, steps: plan() };
  }

  // Execute steps sequentially; each step is a function resolving to a result.
  function execute(plan, runStep) {
    var idx = 0;
    var results = [];
    function next() {
      if (idx >= plan.steps.length) return Promise.resolve({ ok: true, results: results });
      var step = plan.steps[idx++];
      return Promise.resolve(runStep(step)).then(function (r) {
        results.push({ step: step, result: r });
        return next();
      });
    }
    return next();
  }

  // ---- templates ----
  register("playLastDownloadedMedia", function () {
    return [
      { action: "openFolder", params: { path: "/storage/emulated/0/Download" }, note: "Open Downloads" },
      { action: "findLatestVideo", params: {}, note: "Find the newest video" },
      { action: "openMediaPlayer", params: {}, note: "Open the Media Player" },
      { action: "startPlayback", params: {}, note: "Start playback" }
    ];
  });

  register("restartThenLogs", function () {
    return [
      { action: "restart", params: {}, note: "Restart the server" },
      { action: "wait", params: { ms: 2000 }, note: "Wait for restart" },
      { action: "showLogs", params: {}, note: "Show logs" }
    ];
  });

  register("downloadAndOpen", function () {
    return [
      { action: "download", params: {}, note: "Download the file" },
      { action: "open", params: {}, note: "Open it" }
    ];
  });

  register("organizeDownloads", function () {
    return [
      { action: "list", params: { path: "/storage/emulated/0/Download" }, note: "Read Downloads" },
      { action: "sortByType", params: {}, note: "Group by extension" },
      { action: "createFolders", params: {}, note: "Create category folders" },
      { action: "moveFiles", params: {}, note: "Move files" }
    ];
  });

  global.LH_AI.TaskPlanner = {
    register: register,
    detect: detect,
    planFor: planFor,
    execute: execute,
    templates: templates
  };
})(window);
