/* os/timeline.js - LocalHub Activity Timeline.
 * Chronological history of every important event. Filtering, search, date
 * grouping, icons, export, bookmarks. Exposed as LH_OS.Timeline.
 */
(function (global) {
  "use strict";
  global.LH_OS = global.LH_OS || {};
  var Store = global.LH_OS.Store;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var ICONS = {
    "server started": "🟢", "server stopped": "🔴", "login": "🔑", "logout": "🚪",
    "failed login": "⚠️", "upload started": "⬆️", "upload finished": "✅",
    "download started": "⬇️", "download finished": "✅", "media played": "🎬",
    "subtitle changed": "💬", "audio track changed": "🔊", "plugin installed": "🧩",
    "plugin removed": "🧩", "automation executed": "⚙️", "assistant command": "🧠",
    "client connected": "🔗", "client disconnected": "🔌", "settings changed": "⚙️",
    "backup created": "💾", "restore completed": "↩️", "space switched": "🪐"
  };

  function push(type, detail, extra) {
    return Store.pushEvent(Object.assign({ type: type, detail: detail, icon: ICONS[type] || "🕒" }, extra || {}));
  }

  function fmtGroup(ts) {
    var d = new Date(ts), now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var diff = Math.round((today - that) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  // ---- render into a container ----
  function render(el, opts) {
    opts = opts || {};
    if (!el) return;
    var all = Store.timeline();
    var q = (opts.q || "").toLowerCase();
    var filter = opts.filter || "all";
    var bookmarkOnly = !!opts.bookmarkOnly;

    var list = all.filter(function (e) {
      if (bookmarkOnly && !e.bookmarked) return false;
      if (filter !== "all" && (e.type || "").toLowerCase().indexOf(filter) < 0) return false;
      if (q && String(e.detail || "").toLowerCase().indexOf(q) < 0 && String(e.type || "").toLowerCase().indexOf(q) < 0) return false;
      return true;
    });

    if (!list.length) { el.innerHTML = '<div class="os-empty lh-fade-in">No activity yet.</div>'; return; }

    // group by day
    var groups = {};
    list.forEach(function (e) { var g = fmtGroup(e.ts); (groups[g] = groups[g] || []).push(e); });
    var html = "";
    Object.keys(groups).forEach(function (g) {
      html += '<div class="os-tl-group lh-slide-up"><div class="os-tl-day">' + esc(g) + '</div>';
      groups[g].forEach(function (e) {
        var bookmark = e.bookmarked ? "★" : "☆";
        html += '<div class="os-tl-item lh-row-in" data-id="' + esc(e.id) + '">' +
          '<span class="os-tl-icon">' + (e.icon || "🕒") + '</span>' +
          '<div class="os-tl-body"><div class="os-tl-type">' + esc(e.type) + '</div>' +
          '<div class="os-tl-detail">' + esc(e.detail || "") + '</div></div>' +
          '<span class="os-tl-time">' + new Date(e.ts).toLocaleTimeString() + '</span>' +
          '<button class="os-tl-book" data-book="' + esc(e.id) + '" title="Bookmark">' + bookmark + '</button>' +
          '<button class="os-tl-del" data-del="' + esc(e.id) + '" title="Delete">✕</button></div>';
      });
      html += "</div>";
    });
    el.innerHTML = html;

    el.querySelectorAll("[data-del]").forEach(function (b) {
      b.onclick = function () { Store.removeEvent(b.getAttribute("data-del")); render(el, opts); };
    });
    el.querySelectorAll("[data-book]").forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute("data-book");
        var t = Store.timeline();
        var e = t.find(function (x) { return x.id === id; });
        if (e) { e.bookmarked = !e.bookmarked; Store.saveSpaces ? null : null; persistTimeline(t); }
        render(el, opts);
      };
    });
  }

  function persistTimeline(list) { Store.saveTimeline ? Store.saveTimeline(list) : writeTimeline(list); }
  function writeTimeline(list) {
    try { localStorage.setItem("lh.os.timeline", JSON.stringify(list)); } catch (e) {}
  }

  function exportText() {
    return Store.timeline().map(function (e) {
      return "[" + new Date(e.ts).toLocaleString() + "] " + e.type + (e.detail ? " — " + e.detail : "");
    }).join("\n");
  }
  function exportCsv() {
    var rows = [["time", "type", "detail"]];
    Store.timeline().forEach(function (e) {
      rows.push([new Date(e.ts).toISOString(), e.type, e.detail || ""]);
    });
    return rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
  }
  function download(filename, text) {
    var a = global.document.createElement("a");
    a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
    a.download = filename;
    global.document.body.appendChild(a); a.click(); a.remove();
  }

  global.LH_OS.Timeline = { push: push, render: render, exportText: exportText, exportCsv: exportCsv, download: download };
})(window);
