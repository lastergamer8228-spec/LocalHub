/* planner.js - turns intents into executable step plans using the reasoning engine. */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  var Reasoning = global.LH_AI.Reasoning;

  // Registry of planners: each maps a recognized intent to a plan skeleton.
  var planners = {
    organizeDownloads: function (params) {
      return Reasoning.plan("Organize Downloads", [
        { action: "list", params: { path: "/storage/emulated/0/Download" }, note: "Read the Download folder" },
        { action: "sortByType", params: {}, note: "Group files by extension" },
        { action: "createFolders", params: {}, note: "Create category folders" },
        { action: "moveFiles", params: {}, note: "Move files into their category" }
      ]);
    },
    backup: function (params) {
      return Reasoning.plan("Backup important folders", [
        { action: "list", params: { path: params.source || "/storage/emulated/0/Documents" }, note: "Scan source" },
        { action: "copy", params: { dest: params.dest || "/storage/emulated/0/Download/backup" }, note: "Copy to backup" }
      ]);
    },
    deleteEmptyFolders: function (params) {
      return Reasoning.plan("Delete empty folders", [
        { action: "scanEmpty", params: { path: params.path || "/storage/emulated/0" }, note: "Find empty folders" },
        { action: "confirmDelete", params: {}, note: "Ask before deleting" },
        { action: "delete", params: {}, note: "Remove confirmed folders" }
      ]);
    },
    storageReport: function (params) {
      return Reasoning.plan("Generate storage report", [
        { action: "usage", params: {}, note: "Read disk usage" },
        { action: "listFolders", params: { path: "/storage/emulated/0" }, note: "Scan top folders" },
        { action: "report", params: {}, note: "Compose report" }
      ]);
    }
  };

  var Planner = {
    register: function (name, fn) { planners[name] = fn; },
    get: function (name) { return planners[name]; },
    planFor: function (intent, params) {
      var fn = planners[intent];
      if (fn) return Promise.resolve(fn(params || {}));
      return Promise.resolve(Reasoning.plan(intent, [
        { action: "unknown", note: "No planner for '" + intent + "'" }
      ]));
    }
  };

  global.LH_AI.Planner = Planner;
})(window);
