/* os/search.js - LocalHub Universal Search (Spotlight-like).
 * Aggregates results across every module: files, folders, media, clients,
 * modules, logs, settings, automations, plugins, assistant history, timeline.
 * Deterministic, offline, incremental. Exposed as LH_OS.Search.
 */
(function (global) {
  "use strict";
  global.LH_OS = global.LH_OS || {};
  var Store = global.LH_OS.Store;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function highlight(text, q) {
    if (!q) return esc(text);
    var rx = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
    return esc(String(text)).replace(rx, "<mark>$1</mark>");
  }

  function score(item, q, weight) {
    var t = String(item).toLowerCase();
    var i = t.indexOf(q);
    if (i < 0) return -1;
    return (weight || 1) * (1 - i / Math.max(1, t.length));
  }

  /**
   * Runs a universal search across all local sources.
   * q: query string. Returns a Promise resolving to [{group, items:[{label, sub, icon, href, action}]}]
   */
  function run(q) {
    q = (q || "").trim().toLowerCase();
    var groups = [];
    if (!q) return Promise.resolve(groups);

    var filesP = searchFiles(q);
    var localP = Promise.resolve(localGroups(q));

    return Promise.all([filesP, localP]).then(function (res) {
      var files = res[0];
      if (files.items.length) groups.push(files);
      res[1].forEach(function (g) { if (g.items.length) groups.push(g); });
      return groups;
    });
  }

  // ---- file + folder search via the REST API ----
  function searchFiles(q) {
    var found = { group: "Files & Media", items: [] };
    var fetchJson = global.fetchJson;
    if (!fetchJson) {
      // Build a tiny fetch wrapper using the same auth token the page uses.
      var token = "";
      try {
        token = (global.location && new URLSearchParams(global.location.search).get("token")) ||
          sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken");
      } catch (e) {}
      fetchJson = function (url) {
        var h = {}; if (token) h["Authorization"] = "Bearer " + token;
        return fetch(url, { headers: h }).then(function (r) { return r.ok ? r.json() : null; });
      };
    }
    return fetchJson("/api/fs/search?q=" + encodeURIComponent(q) + "&dir=")
      .then(function (res) {
        var matches = (res && res.matches) || [];
        matches.slice(0, 30).forEach(function (m) {
          var isDir = !!m.isDir;
          var ext = (m.name || "").split(".").pop().toLowerCase();
          var icon = isDir ? "📁" : (/^(mp4|mkv|webm|avi|mov)$/.test(ext) ? "🎬" : (/^(mp3|wav|ogg|flac|m4a)$/.test(ext) ? "🎵" : (/^(jpg|jpeg|png|gif|webp)$/.test(ext) ? "🖼" : (/^(pdf|doc|docx|txt|md)$/.test(ext) ? "📄" : "📄"))));
          found.items.push({
            label: m.name, sub: (isDir ? "Folder · " : "File · ") + m.path,
            icon: icon, href: isDir ? ("/files?path=" + encodeURIComponent(m.path)) : ("/files?path=" + encodeURIComponent(m.path.split("/").slice(0, -1).join("/")) + "&preview=" + encodeURIComponent(m.path))
          });
        });
        return found;
      })
      .catch(function () { return found; });
  }

  // ---- local (client-side) sources ----
  function localGroups(q) {
    var groups = [];
    var s = Store;

    // Connected clients (from page context if available)
    var clients = global.LH_AI && global.LH_AI.Context ? global.LH_AI.Context.get("clientHistory") || [] : [];
    var clientItems = clients.filter(function (c) {
      return (c.ip || "").toLowerCase().indexOf(q) >= 0 || String(c.userAgent || "").toLowerCase().indexOf(q) >= 0;
    }).slice(0, 10).map(function (c) {
      return { label: c.ip || "client", sub: "Client · " + (c.protocol || "HTTP") + " · " + (c.userAgent || "").slice(0, 30), icon: "💻" };
    });
    if (clientItems.length) groups.push({ group: "Connected Clients", items: clientItems });

    // Assistant history / recent commands
    var cmds = global.LH_AI && global.LH_AI.Context ? global.LH_AI.Context.get("recentCommands") || [] : [];
    var cmdItems = cmds.filter(function (c) { return String(c).toLowerCase().indexOf(q) >= 0; })
      .slice(0, 10).map(function (c) {
        return { label: c, sub: "Assistant command", icon: "🧠", action: { type: "assistant", text: c } };
      });
    if (cmdItems.length) groups.push({ group: "Assistant History", items: cmdItems });

    // Activity timeline
    var tl = (s.timeline() || []).filter(function (e) {
      return String(e.type || "").toLowerCase().indexOf(q) >= 0 || String(e.detail || "").toLowerCase().indexOf(q) >= 0;
    }).slice(0, 12).map(function (e) {
      return { label: e.type, sub: "Timeline · " + new Date(e.ts).toLocaleString(), icon: e.icon || "🕒", action: { type: "timeline", id: e.id } };
    });
    if (tl.length) groups.push({ group: "Activity Timeline", items: tl });

    // Search history
    var hist = (s.searchHistory() || []).filter(function (x) { return x.q.indexOf(q) >= 0; })
      .slice(0, 8).map(function (x) { return { label: x.q, sub: "Recent search", icon: "🔍", action: { type: "search", q: x.q } }; });
    if (hist.length) groups.push({ group: "Recent Searches", items: hist });

    // Settings entries (static map of the settings screen)
    var settingsItems = [
      { k: "Server port", route: "server" }, { k: "Server name", route: "server" }, { k: "Theme", route: "appearance" },
      { k: "Autostart on boot", route: "server" }, { k: "Administrator credentials", route: "security" },
      { k: "Web User credentials", route: "security" }, { k: "Server start / stop", route: "server" }
    ].filter(function (x) { return x.k.toLowerCase().indexOf(q) >= 0; }).map(function (x) {
      return { label: x.k, sub: "Settings", icon: "⚙", action: { type: "settings", route: x.route } };
    });
    if (settingsItems.length) groups.push({ group: "Settings", items: settingsItems });

    // Automations
    var autos = global.LH_AI && global.LH_AI.Automation ? global.LH_AI.Automation.catalog : {};
    var autoItems = Object.keys(autos).filter(function (k) {
      return (autos[k].name || "").toLowerCase().indexOf(q) >= 0 || (autos[k].desc || "").toLowerCase().indexOf(q) >= 0;
    }).slice(0, 8).map(function (k) {
      return { label: autos[k].name, sub: "Automation · " + (autos[k].desc || ""), icon: "⚙", action: { type: "automation", key: k } };
    });
    if (autoItems.length) groups.push({ group: "Automations", items: autoItems });

    // Spaces
    var spaceItems = (s.spaces() || []).filter(function (sp) {
      return sp.name.toLowerCase().indexOf(q) >= 0;
    }).slice(0, 6).map(function (sp) {
      return { label: sp.name, sub: "Space", icon: sp.icon || "🪐", action: { type: "space", id: sp.id } };
    });
    if (spaceItems.length) groups.push({ group: "Spaces", items: spaceItems });

    // Quick actions (from active space)
    var active = s.getSpace(s.activeSpaceId());
    var quickItems = (active && active.quick || []).filter(function (x) { return x.toLowerCase().indexOf(q) >= 0; })
      .slice(0, 6).map(function (x) { return { label: x, sub: "Quick action · " + active.name, icon: "⚡", action: { type: "assistant", text: x } }; });
    if (quickItems.length) groups.push({ group: "Quick Actions", items: quickItems });

    // Media library (recent media history)
    var media = global.LH_AI && global.LH_AI.Context ? global.LH_AI.Context.get("mediaHistory") || [] : [];
    var mediaItems = media.filter(function (m) { return String(m.name || "").toLowerCase().indexOf(q) >= 0; })
      .slice(0, 10).map(function (m) {
        return { label: m.name, sub: "Media · " + (m.type || ""), icon: m.type === "video" ? "🎬" : "🎵", href: "/player?file=" + encodeURIComponent(m.path) };
      });
    if (mediaItems.length) groups.push({ group: "Media Library", items: mediaItems });

    return groups;
  }

  // ---- keyboard navigation + rendering ----
  function openResult(item) {
    if (!item) return;
    var a = item.action;
    if (item.href) { global.location.href = item.href; return; }
    if (!a) return;
    if (a.type === "assistant") {
      if (global.LH_AI && global.LH_AI.Brain) global.LH_AI.Brain.handleUserMessage(a.text);
      else global.location.href = "/ai";
    } else if (a.type === "search") {
      var input = global.document.getElementById("os-search-input");
      if (input) { input.value = a.q; input.dispatchEvent(new Event("input")); }
    } else if (a.type === "space") {
      if (global.LH_OS && global.LH_OS.Spaces) global.LH_OS.Spaces.switchTo(a.id);
    } else if (a.type === "automation") {
      global.location.href = "/os#automation";
    } else if (a.type === "settings") {
      global.location.href = "/os#spaces";
    } else if (a.type === "timeline") {
      global.location.href = "/os#timeline";
    }
  }

  global.LH_OS.Search = { run: run, openResult: openResult, highlight: highlight };
})(window);
