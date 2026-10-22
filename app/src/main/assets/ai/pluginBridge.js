/* pluginBridge.js - install/enable/disable/remove AI skill plugins. */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  var Memory = global.LH_AI.Memory;
  var STORE = "plugins";

  function genId() { return "plugin_" + Date.now() + "_" + Math.random().toString(36).slice(2); }

  var defaultPermissions = ["read", "list", "status"];

  var PluginBridge = {
    all: function () { return Memory.getAll(STORE); },
    install: function (spec) {
      var plugin = {
        id: genId(),
        name: spec.name || "Plugin",
        version: spec.version || "1.0",
        description: spec.description || "",
        enabled: spec.enabled !== false,
        permissions: spec.permissions || defaultPermissions.slice(),
        code: spec.code || "",
        installedAt: Date.now()
      };
      return Memory.put(STORE, plugin);
    },
    remove: function (id) { return Memory.remove(STORE, id); },
    setEnabled: function (id, enabled) {
      return Memory.get(STORE, id).then(function (p) {
        if (!p) return;
        p.enabled = enabled;
        return Memory.put(STORE, p);
      });
    },
    setPermissions: function (id, perms) {
      return Memory.get(STORE, id).then(function (p) {
        if (!p) return;
        p.permissions = perms;
        return Memory.put(STORE, p);
      });
    },
    run: function (id, args, brain) {
      return Memory.get(STORE, id).then(function (p) {
        if (!p) throw new Error("plugin not found");
        if (!p.enabled) throw new Error("plugin disabled");
        if (!p.code) throw new Error("plugin has no code");
        var fn = new Function("brain", "args", "FS", "Memory", p.code);
        return fn(brain, args || {}, global.LH_AI.FS, Memory);
      });
    }
  };

  global.LH_AI.PluginBridge = PluginBridge;
})(window);
