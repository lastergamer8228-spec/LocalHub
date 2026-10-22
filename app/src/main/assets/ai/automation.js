/* automation.js - user workflows that run on a schedule or trigger. */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  var Memory = global.LH_AI.Memory;
  var STORE = "automations";

  var AUTOMATIONS = {
    organizeDownloads: {
      name: "Organize Downloads",
      desc: "Group the Download folder by file type every day.",
      defaultTrigger: "daily",
      needs: ["createFolders", "moveFiles"]
    },
    deleteEmptyFolders: {
      name: "Delete empty folders",
      desc: "Scan and remove empty folders (with confirmation).",
      defaultTrigger: "weekly",
      needs: ["scanEmpty", "confirmDelete"]
    },
    backupDocuments: {
      name: "Backup Documents",
      desc: "Copy Documents to a backup folder.",
      defaultTrigger: "daily",
      needs: ["copy"]
    },
    renameImages: {
      name: "Rename images automatically",
      desc: "Rename image files in Pictures by date/sequence.",
      defaultTrigger: "once",
      needs: ["list", "rename"]
    },
    storageReport: {
      name: "Generate storage report",
      desc: "Produce a disk-usage report.",
      defaultTrigger: "weekly",
      needs: ["usage", "report"]
    }
  };

  var Automation = {
    catalog: AUTOMATIONS,
    all: function () { return Memory.getAll(STORE); },
    add: function (wf) {
      wf.enabled = wf.enabled !== false;
      wf.kind = wf.kind || "workflow";
      wf.createdAt = wf.createdAt || Date.now();
      return Memory.put(STORE, wf);
    },
    update: function (wf) { return Memory.put(STORE, wf); },
    remove: function (id) { return Memory.remove(STORE, id); },
    evaluate: function (wf, now) {
      if (!wf.enabled) return false;
      if (wf.trigger === "manual") return true;
      var last = wf.lastRunAt || 0;
      var interval = 86400000; // 1 day
      if (wf.trigger === "weekly") interval = 604800000;
      if (wf.trigger === "hourly") interval = 3600000;
      return (now - last) >= interval;
    },

    // ---- deterministic IF/THEN rule engine (no ML) ----
    // A rule has: { if: {condition, value}, then: "server/stop" | "server/start" | ... }
    buildRule: function (condition, value, thenAction) {
      return {
        id: "rule_" + Date.now() + "_" + Math.random().toString(36).slice(2),
        kind: "rule",
        enabled: true,
        if: { condition: condition, value: value },
        then: thenAction,
        createdAt: Date.now()
      };
    },

    /**
     * Evaluates a rule against the current system snapshot. Returns true when
     * the condition is satisfied and the action should fire.
     */
    checkRule: function (rule, sys) {
      if (!rule || rule.kind !== "rule" || !rule.enabled) return false;
      var cond = rule.if || {};
      var c = cond.condition, v = cond.value;
      if (!sys) return false;
      if (c === "battery_below") {
        return (sys.battery && sys.battery.level != null) && sys.battery.level < v;
      }
      if (c === "wifi_connected") {
        return !!(sys.network && sys.network.type === "WIFI");
      }
      if (c === "wifi_disconnected") {
        return !!sys.network && sys.network.type !== "WIFI";
      }
      if (c === "cpu_above") {
        return !!(sys.cpu && sys.cpu.usagePercent != null && sys.cpu.usagePercent > v);
      }
      return false;
    },

    /** Known conditions exposed to the UI/parser. */
    conditions: {
      battery_below: "Battery below %",
      wifi_connected: "WiFi connected",
      wifi_disconnected: "WiFi disconnected",
      cpu_above: "CPU above %"
    }
  };

  global.LH_AI.Automation = Automation;
})(window);
