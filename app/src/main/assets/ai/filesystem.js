/* filesystem.js - bridges the AI / File Manager to LocalHub's internal file
 * APIs. Defensive: it creates the namespaces it needs, never assumes they were
 * already created by another script, and resolves baseUrl safely. */
(function (global) {
  "use strict";

  // --- Ensure namespaces exist before touching them (self-healing) ---
  global.LocalHub = global.LocalHub || {};
  global.LocalHub.config = global.LocalHub.config || {};
  global.LH_AI = global.LH_AI || {};
  global.LH_AI.modules = global.LH_AI.modules || {};

  // --- Resolve baseUrl: config -> LH_AI -> origin -> "" (safe optional access) ---
  var base =
    (global.LocalHub && global.LocalHub.config && global.LocalHub.config.baseUrl) ||
    (global.LH_AI && global.LH_AI.baseUrl) ||
    ((global.location && global.location.protocol)
      ? global.location.protocol + "//" + global.location.host
      : "");

  // Session token for authenticated API calls (from URL or storage).
  function authToken() {
    var t = null;
    try {
      t = (global.LH_AI && global.LH_AI.token) || null;
      if (!t && global.location && global.location.search) {
        var q = new URLSearchParams(global.location.search);
        t = q.get("token") || sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken");
      } else if (!t) {
        t = sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken");
      }
    } catch (e) { t = null; }
    return t;
  }

  function get(path) {
    var headers = {};
    var t = authToken();
    if (t) headers["Authorization"] = "Bearer " + t;
    return fetch(base + path, { method: "GET", headers: headers }).then(function (r) { return r.json(); });
  }
  function post(path, body) {
    var headers = { "Content-Type": "application/json" };
    var t = authToken();
    if (t) headers["Authorization"] = "Bearer " + t;
    return fetch(base + path, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); });
  }

  var FS = {
    list: function (path) {
      return get("/api/files?path=" + encodeURIComponent(path || "/storage/emulated/0"));
    },
    listFs: function (path) {
      return get("/api/fs/list?path=" + encodeURIComponent(path || "/storage/emulated/0"));
    },
    search: function (q, dir) {
      return get("/api/fs/search?q=" + encodeURIComponent(q) + "&dir=" + encodeURIComponent(dir || ""));
    },
    read: function (path) {
      return get("/api/fs/read?path=" + encodeURIComponent(path));
    },
    write: function (path, content) {
      return post("/api/fs/write", { path: path, content: content });
    },
    mkdir: function (parent, name) {
      return post("/api/fs/mkdir", { parent: parent, name: name });
    },
    rename: function (path, name) {
      return post("/api/fs/rename", { path: path, name: name });
    },
    move: function (path, dest) {
      return post("/api/fs/move", { path: path, dest: dest });
    },
    copy: function (path, dest) {
      return post("/api/fs/copy", { path: path, dest: dest });
    },
    delete: function (path) {
      return post("/api/fs/delete", { path: path, confirm: "true" });
    },
    info: function (path) {
      return get("/api/fs/info?path=" + encodeURIComponent(path));
    },
    largest: function (dir, limit) {
      return get("/api/fs/largest?path=" + encodeURIComponent(dir || "") + "&limit=" + (limit || 20));
    },
    emptyFolders: function (dir) {
      return get("/api/fs/empty?path=" + encodeURIComponent(dir || ""));
    },
    contentUrl: function (path) {
      var t = authToken();
      return base + "/api/fs/content?path=" + encodeURIComponent(path) + (t ? "&token=" + encodeURIComponent(t) : "");
    },
    /** Download URL for one or more paths (folders / multi = streamed zip). */
    downloadUrl: function (paths) {
      if (Array.isArray(paths)) paths = paths.join("|");
      var t = authToken();
      return base + "/api/fs/download?paths=" + encodeURIComponent(paths) + (t ? "&token=" + encodeURIComponent(t) : "");
    },
    download: function (paths) {
      var a = global.document.createElement("a");
      a.href = FS.downloadUrl(paths);
      a.download = "";
      global.document.body.appendChild(a);
      a.click();
      setTimeout(function () { global.document.body.removeChild(a); }, 100);
    },
    zip: function (paths, dest) {
      return post("/api/fs/zip", { paths: paths.join("|"), dest: dest });
    },
    unzip: function (path, dest) {
      return post("/api/fs/unzip", { path: path, dest: dest });
    },
    /** Opens the File Manager page, optionally previewing a specific file. */
    openFileManager: function (path, previewPath) {
      var url = "/files?path=" + encodeURIComponent(path || "/storage/emulated/0");
      if (previewPath) url += "&preview=" + encodeURIComponent(previewPath);
      global.location.href = url;
    },
    usage: function () {
      return get("/api/fs/usage");
    },
    status: function () { return get("/api/status"); },
    system: function () { return get("/api/system"); },
    clients: function () { return get("/api/clients"); },
    logs: function () { return get("/api/logs"); },
    modules: function () { return get("/api/modules"); },
    authSession: function (token) {
      var url = base + "/api/auth/session";
      if (token) url += "?token=" + encodeURIComponent(token);
      return get(url);
    }
  };

  // --- Register on both namespaces so any consumer finds it ---
  global.LH_AI.FS = FS;
  global.LH_AI.modules.filesystem = FS;
  global.LocalHub.FS = FS;
  global.LocalHub.filesystem = FS;
})(window);
