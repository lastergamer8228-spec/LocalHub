/* capabilities.js - LocalHub OS Capability Registry.
 *
 * Every LocalHub module registers its capabilities here. The Brain discovers
 * them automatically, so future modules (and plugins) extend the assistant
 * with ZERO changes to brain.js.
 *
 * A capability is: { module, name, desc, params[], permission }
 */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};
  global.LH_AI.modules = global.LH_AI.modules || {};

  var capabilities = [];
  var modules = {}; // module name -> { capabilities: [...] }

  // Deterministic permission model. "public" = allowed for any user; future
  // roles could add "admin"/"owner" here.
  var role = "owner";

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
    // All capabilities are "public" in the current owner-only model.
    return cap && (cap.permission === "public" || cap.permission === role);
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
      { name: "logs.show", desc: "Show logs", params: [], permission: "public" },
      { name: "logs.clear", desc: "Clear logs", params: [], permission: "public" },
      { name: "logs.export", desc: "Export logs", params: [], permission: "public" }
    ]);
    register("clients", [
      { name: "clients.show", desc: "Show connected clients", params: [], permission: "public" }
    ]);
    register("server", [
      { name: "server.restart", desc: "Restart server", params: [], permission: "public" },
      { name: "server.stop", desc: "Stop server", params: [], permission: "public" },
      { name: "server.start", desc: "Start server", params: [], permission: "public" },
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
      { name: "automation.rules", desc: "Automation rules", params: [], permission: "public" },
      { name: "automation.builder", desc: "Visual automation builder", params: [], permission: "public" }
    ]);
    register("os", [
      { name: "os.search", desc: "Universal search", params: ["query"], permission: "public" },
      { name: "os.timeline", desc: "Activity timeline", params: [], permission: "public" },
      { name: "os.spaces", desc: "Switch LocalHub spaces", params: ["id"], permission: "public" },
      { name: "os.recent", desc: "Recent uploads/downloads", params: [], permission: "public" }
    ]);
    register("plugins", [
      { name: "plugins.install", desc: "Install plugin", params: ["name", "code"], permission: "public" }
    ]);
  }

  registerDefaults();

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
