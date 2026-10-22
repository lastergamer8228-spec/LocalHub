/* os/home.js - LocalHub Dynamic Home Dashboard.
 * Adapts to usage: recent media, continue watching, frequently used folders,
 * quick actions, storage alerts, today's activity, connected devices.
 * Exposed as LH_OS.Home.
 */
(function (global) {
  "use strict";
  global.LH_OS = global.LH_OS || {};
  var Store = global.LH_OS.Store;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function ctx() { return global.LH_AI && global.LH_AI.Context; }
  function autos() { return global.LH_AI && global.LH_AI.Automation; }
  function anim() { return global.LH_AI && global.LH_AI.Anim; }

  // ---- widget catalog ----
  function widgets(el, space) {
    var parts = [];

    // Quick actions (space-specific)
    var quick = (space && space.quick) || [];
    if (quick.length) {
      parts.push({
        title: "⚡ Quick Actions", cls: "os-quick",
        body: quick.map(function (q) {
          return '<button class="os-chip" data-assist="' + esc(q) + '">' + esc(q) + "</button>";
        }).join("")
      });
    }

    // Recently played / continue watching
    var media = ctx() ? ctx().get("mediaHistory") || [] : [];
    if (media.length) {
      var cont = media.slice(0, 6).map(function (m) {
        return '<a class="os-item" href="/player?file=' + encodeURIComponent(m.path) + '">' +
          '<span class="os-item-ic">' + (m.type === "video" ? "🎬" : "🎵") + "</span>" +
          '<span class="os-item-nm">' + esc(m.name) + "</span>" +
          '<span class="os-item-sub">' + (m.type || "media") + "</span></a>";
      }).join("");
      parts.push({ title: "🎬 Recently Played", cls: "os-grid", body: cont });
    }

    // Frequently used folders (from usage)
    var usage = Store.usage();
    var folders = Object.keys(usage).filter(function (k) { return k.indexOf("folder:") === 0; })
      .sort(function (a, b) { return usage[b] - usage[a]; }).slice(0, 6);
    if (folders.length) {
      parts.push({ title: "📁 Frequent Folders", cls: "os-grid",
        body: folders.map(function (f) {
          var path = f.slice(7);
          return '<a class="os-item" href="/files?path=' + encodeURIComponent(path) + '">' +
            '<span class="os-item-ic">📁</span><span class="os-item-nm">' + esc(path.split("/").pop() || path) + "</span>" +
            '<span class="os-item-sub">' + esc(path) + "</span></a>";
        }).join("") });
    }

    // Storage alert (if available)
    parts.push({ title: "💾 Storage", cls: "os-status", id: "os-storage", body: '<div class="os-skel lh-skeleton">Loading…</div>' });

    // Today's activity
    var today = Store.timeline().filter(function (e) { return new Date(e.ts).toDateString() === new Date().toDateString(); }).length;
    parts.push({ title: "📈 Today's Activity", cls: "os-stat", body: '<b class="os-count">' + today + '</b> <span>events today</span>' });

    // Automation suggestions
    var cat = autos() ? autos().catalog : {};
    var sugg = Object.keys(cat).slice(0, 4).map(function (k) {
      return '<button class="os-chip" data-auto="' + esc(k) + '">' + esc(cat[k].name) + "</button>";
    }).join("");
    if (sugg) parts.push({ title: "⚙️ Suggested Automations", cls: "os-quick", body: sugg });

    el.innerHTML = parts.map(function (w, i) {
      return '<div class="os-widget lh-card-enter" style="animation-delay:' + (i * 60) + 'ms" id="' + esc(w.id || "") + '">' +
        '<h3>' + w.title + "</h3><div class='" + w.cls + "'>" + w.body + "</div></div>";
    }).join("");

    // wire interactions
    el.querySelectorAll("[data-assist]").forEach(function (b) {
      b.onclick = function () {
        if (global.LH_AI && global.LH_AI.Brain) global.LH_AI.Brain.handleUserMessage(b.getAttribute("data-assist"));
      };
    });
    el.querySelectorAll("[data-auto]").forEach(function (b) {
      b.onclick = function () {
        var k = b.getAttribute("data-auto");
        if (autos()) autos().add({ kind: k, name: cat[k].name, desc: cat[k].desc, trigger: cat[k].defaultTrigger })
          .then(function () { global.location.href = "/os#automation"; });
      };
    });

    // load storage widget via dashboard API
    loadStorage();
  }

  function loadStorage() {
    var token = "";
    try { token = new URLSearchParams(global.location.search).get("token") || sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken"); } catch (e) {}
    fetch("/api/storage", { headers: token ? { "Authorization": "Bearer " + token } : {} })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (s) {
        var el = global.document.getElementById("os-storage");
        if (!el || !s) return;
        var pct = s.totalBytes ? Math.round((s.usedBytes / s.totalBytes) * 100) : 0;
        var warn = pct > 85;
        el.innerHTML = '<div class="os-bar"><div class="os-bar-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="os-stat-row"><span>' + fmt(s.usedBytes) + " used of " + fmt(s.totalBytes) + "</span>" +
          '<b class="' + (warn ? "os-warn" : "") + '">' + pct + "%</b></div>" +
          (warn ? '<div class="os-alert">⚠ Storage nearly full</div>' : "");
      }).catch(function () {});
  }

  function fmt(b) { b = b || 0; var u = ["B", "KB", "MB", "GB", "TB"], i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return (b / Math.pow(1024, i)).toFixed(1) + " " + u[i]; }

  function recordFolderUsage(path) {
    Store.bumpUsage("folder:" + path);
  }

  global.LH_OS.Home = { widgets: widgets, recordFolderUsage: recordFolderUsage };
})(window);
