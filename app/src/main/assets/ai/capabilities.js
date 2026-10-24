/* Capability metadata for discovery/UI, not a runtime executor.
 * Registration alone does not implement, enable or verify a feature. Reviewed
 * adapters and server-side permission/module checks remain authoritative.
 */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};
  global.LH_AI.modules = global.LH_AI.modules || {};

  var capabilities = [];
  var modules = {}; // module name -> { capabilities: [...] }

  // Display/discovery metadata mirrors role requirements; backend checks remain
  // authoritative. Never assume the browser is an owner account.
  function register(moduleName, list) {
    (list || []).forEach(function (cap) {
      cap.module = cap.module || moduleName;
      cap.permission = cap.permission || "public";
      capabilities.push(cap);
    });
    if (!modules[moduleName]) modules[moduleName] = { name: moduleName, capabilities: [] };
    modules[moduleName].capabilities = capabilities.filter(function (c) { return c.module === moduleName; });
  }

  function lookup(capabilityName) {
    for (var i = 0; i < capabilities.length; i++) {
      if (capabilities[i].name === capabilityName) return capabilities[i];
    }
    return null;
  }

  function hasPermission(cap) {
    if (!cap) return false;
    var role = global.LH_AI.Commands && global.LH_AI.Commands.getRole ? global.LH_AI.Commands.getRole() : null;
    // Legacy "public" means non-admin capability, not bypassing login.
    if (cap.permission === "public") return cap.name === "server.status" || role === "user" || role === "admin";
    return role === "admin" && (cap.permission === "admin" || cap.permission === "owner");
  }

  function listByModule() { return modules; }

  function all() { return capabilities.slice(); }

  function count() { return capabilities.length; }

  // ---- self-diagnostics ----
  function diagnostics() {
    var dup = [];
    var seen = {};
    capabilities.forEach(function (c) {
      if (seen[c.module + ":" + c.name]) dup.push(c.module + ":" + c.name);
      seen[c.module + ":" + c.name] = true;
    });
    var modNames = Object.keys(modules);
    return {
      modules: modNames,
      capabilityCount: capabilities.length,
      duplicates: dup,
      byModule: modules
    };
  }

  // Register the standard LocalHub modules.
  function registerDefaults() {
    register("files", [
      { name: "fm.open", desc: "Open a folder", params: ["path"], permission: "public" },
      { name: "fm.search", desc: "Search files", params: ["query"], permission: "public" },
      { name: "fm.largest", desc: "Largest files", params: [], permission: "public" },
      { name: "fm.empty", desc: "Empty folders", params: [], permission: "public" }
    ]);
    register("media", [
      { name: "media.latestModified", desc: "Request the newest modified video in Downloads (not verified download order)", params: [], permission: "public" },
      { name: "media.play", desc: "Play media", params: ["path"], permission: "public" },
      { name: "media.pause", desc: "Pause media", params: [], permission: "public" },
      { name: "media.next", desc: "Next media", params: [], permission: "public" },
      { name: "media.previous", desc: "Previous media", params: [], permission: "public" },
      { name: "media.seek", desc: "Seek to a time", params: ["time"], permission: "public" },
      { name: "media.speed", desc: "Set playback speed", params: ["rate"], permission: "public" },
      { name: "subtitle.next", desc: "Next subtitle track", params: [], permission: "public" },
      { name: "subtitle.previous", desc: "Previous subtitle track", params: [], permission: "public" },
      { name: "subtitle.set", desc: "Switch subtitle by language/index", params: ["lang"], permission: "public" },
      { name: "subtitle.enable", desc: "Enable subtitles", params: [], permission: "public" },
      { name: "subtitle.disable", desc: "Hide subtitles", params: [], permission: "public" },
      { name: "subtitle.size", desc: "Adjust subtitle size", params: ["delta"], permission: "public" },
      { name: "subtitle.delay", desc: "Adjust subtitle delay", params: ["seconds"], permission: "public" },
      { name: "audio.set", desc: "Switch audio track", params: ["lang"], permission: "public" },
      { name: "audio.next", desc: "Next audio track", params: [], permission: "public" },
      { name: "audio.previous", desc: "Previous audio track", params: [], permission: "public" },
      { name: "media.screenshot", desc: "Capture the current frame", params: [], permission: "public" },
      { name: "media.fullscreen", desc: "Toggle fullscreen", params: [], permission: "public" }
    ]);
    register("logs", [
      { name: "logs.show", desc: "Show logs", params: [], permission: "admin" },
      { name: "logs.clear", desc: "Clear logs", params: [], permission: "admin" },
      { name: "logs.export", desc: "Export logs", params: [], permission: "admin" }
    ]);
    register("clients", [
      { name: "clients.show", desc: "Show connected clients", params: [], permission: "public" }
    ]);
    register("server", [
      { name: "server.restart", desc: "Restart server", params: [], permission: "admin" },
      { name: "server.stop", desc: "Stop server", params: [], permission: "admin" },
      { name: "server.start", desc: "Start server", params: [], permission: "admin" },
      { name: "server.status", desc: "Server status", params: [], permission: "public" }
    ]);
    register("settings", [
      { name: "settings.open", desc: "Open settings", params: [], permission: "public" }
    ]);
    register("network", [
      { name: "network.info", desc: "Network info", params: [], permission: "public" }
    ]);
    register("storage", [
      { name: "storage.usage", desc: "Storage usage", params: [], permission: "public" }
    ]);
    register("automation", [
      { name: "automation.rules", desc: "Automation rules", params: [], permission: "admin" },
      { name: "automation.builder", desc: "Visual automation builder", params: [], permission: "admin" }
    ]);
    register("os", [
      { name: "os.search", desc: "Universal search", params: ["query"], permission: "public" },
      { name: "os.timeline", desc: "Activity timeline", params: [], permission: "public" },
      { name: "os.spaces", desc: "Switch LocalHub spaces", params: ["id"], permission: "public" },
      { name: "os.recent", desc: "Recent uploads/downloads", params: [], permission: "public" }
    ]);
    register("plugins", [
      { name: "plugins.install", desc: "Install plugin", params: ["name", "code"], permission: "admin" }
    ]);
  }

  registerDefaults();
  register("integration", [
    {name:"system.integration",desc:"Explain current native host/browser integration",params:[],permission:"public"},
    {name:"system.health",desc:"Observe bounded host/feature health checks",params:[],permission:"public"},
    {name:"system.readRecovery",desc:"Recheck transient reads once; no automatic system mutation",params:[],permission:"public"}
  ]);

  global.LH_AI.Capabilities = {
    register: register,
    lookup: lookup,
    hasPermission: hasPermission,
    listByModule: listByModule,
    all: all,
    count: count,
    diagnostics: diagnostics
  };
})(window);
