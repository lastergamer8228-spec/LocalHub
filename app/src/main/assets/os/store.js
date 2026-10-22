/* os/store.js - LocalHub OS shared data layer.
 * Persists activity timeline, spaces, search history, pins and widgets in
 * localStorage (offline, deterministic, no server round-trip for user prefs).
 * Exposed as LH_OS.Store.
 */
(function (global) {
  "use strict";
  global.LH_OS = global.LH_OS || {};

  var PREFIX = "lh.os.";

  function read(key, def) {
    try { var v = localStorage.getItem(PREFIX + key); return v == null ? def : JSON.parse(v); }
    catch (e) { return def; }
  }
  function write(key, val) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch (e) {}
  }

  // ---- activity timeline ----
  function timeline() { return read("timeline", []); }
  function pushEvent(ev, detail, extra) {
    // Accept both call styles: pushEvent(obj) and pushEvent(type, detail, extra).
    if (typeof ev === "string") {
      ev = Object.assign({ type: ev, detail: detail || "" }, extra || {});
    }
    var list = timeline();
    ev = Object.assign({ ts: Date.now(), id: "ev_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) }, ev);
    list.unshift(ev);
    if (list.length > 500) list.length = 500;
    write("timeline", list);
    return ev;
  }
  function clearTimeline() { write("timeline", []); }
  function removeEvent(id) {
    write("timeline", timeline().filter(function (e) { return e.id !== id; }));
  }
  function saveTimeline(list) { write("timeline", list); }

  // ---- spaces ----
  var DEFAULT_SPACES = [
    { id: "home", name: "Home", icon: "🏠", theme: "dark", pinned: [], favorites: [], quick: ["open downloads", "show server status", "open media space"] },
    { id: "media", name: "Media", icon: "🎬", theme: "dark", pinned: [], favorites: [], quick: ["play last video", "resume playback", "open media player"] },
    { id: "downloads", name: "Downloads", icon: "⬇️", theme: "dark", pinned: [], favorites: [], quick: ["open downloads", "show recent uploads", "organize downloads"] },
    { id: "development", name: "Development", icon: "💻", theme: "dark", pinned: [], favorites: [], quick: ["open documents", "show logs", "restart server"] },
    { id: "office", name: "Office", icon: "💼", theme: "dark", pinned: [], favorites: [], quick: ["open documents", "backup documents"] },
    { id: "family", name: "Family", icon: "👨‍👩‍👧", theme: "dark", pinned: [], favorites: [], quick: ["open pictures", "open music"] }
  ];
  function spaces() { return read("spaces", null) || DEFAULT_SPACES; }
  function activeSpaceId() { return read("space.active", "home"); }
  function setActiveSpace(id) { write("space.active", id); }
  function saveSpaces(list) { write("spaces", list); }
  function getSpace(id) {
    return spaces().find(function (s) { return s.id === id; }) || spaces()[0];
  }
  function upsertSpace(sp) {
    var list = spaces();
    var i = list.findIndex(function (s) { return s.id === sp.id; });
    if (i >= 0) list[i] = sp; else list.push(sp);
    write("spaces", list);
  }
  function addSpace(sp) {
    sp.id = "space_" + Date.now().toString(36);
    upsertSpace(sp);
    return sp.id;
  }
  function removeSpace(id) { write("spaces", spaces().filter(function (s) { return s.id !== id; })); }

  // ---- universal search ----
  function searchHistory() { return read("search.history", []); }
  function pushSearch(q) {
    var h = searchHistory().filter(function (x) { return x.q !== q; });
    h.unshift({ q: q, ts: Date.now() });
    if (h.length > 40) h.length = 40;
    write("search.history", h);
  }
  function pinnedSearches() { return read("search.pinned", []); }
  function togglePinSearch(q) {
    var p = pinnedSearches();
    var i = p.indexOf(q);
    if (i >= 0) p.splice(i, 1); else p.unshift(q);
    write("search.pinned", p);
    return p;
  }
  function clearSearchHistory() { write("search.history", []); }

  // ---- dynamic home ----
  function homeWidgets() { return read("home.widgets", []); }
  function saveHomeWidgets(w) { write("home.widgets", w); }

  // ---- usage / counts (for adaptive home) ----
  function usage() { return read("usage", {}); }
  function bumpUsage(key) {
    var u = usage();
    u[key] = (u[key] || 0) + 1;
    write("usage", u);
  }
  function setUsage(u) { write("usage", u); }

  // ---- full backup / restore (client-side OS data) ----
  function exportBackup() {
    return {
      app: "LocalHub",
      type: "localhub-os-backup",
      version: 1,
      exportedAt: Date.now(),
      timeline: timeline(),
      spaces: spaces(),
      activeSpace: activeSpaceId(),
      searchHistory: searchHistory(),
      pinnedSearches: pinnedSearches(),
      homeWidgets: homeWidgets(),
      usage: usage()
    };
  }
  function importBackup(data) {
    if (!data || data.type !== "localhub-os-backup") return { ok: false, error: "Not a valid LocalHub OS backup." };
    if (data.timeline) write("timeline", data.timeline);
    if (data.spaces) write("spaces", data.spaces);
    if (data.activeSpace) write("space.active", data.activeSpace);
    if (data.searchHistory) write("search.history", data.searchHistory);
    if (data.pinnedSearches) write("search.pinned", data.pinnedSearches);
    if (data.homeWidgets) write("home.widgets", data.homeWidgets);
    if (data.usage) write("usage", data.usage);
    return { ok: true, message: "Backup restored." };
  }
  function downloadBackup() {
    var blob = new Blob([JSON.stringify(exportBackup(), null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "localhub-backup.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 100);
  }

  global.LH_OS.Store = {
    timeline: timeline,
    pushEvent: pushEvent,
    clearTimeline: clearTimeline,
    removeEvent: removeEvent,
    saveTimeline: saveTimeline,
    spaces: spaces,
    activeSpaceId: activeSpaceId,
    setActiveSpace: setActiveSpace,
    saveSpaces: saveSpaces,
    getSpace: getSpace,
    upsertSpace: upsertSpace,
    addSpace: addSpace,
    removeSpace: removeSpace,
    searchHistory: searchHistory,
    pushSearch: pushSearch,
    pinnedSearches: pinnedSearches,
    togglePinSearch: togglePinSearch,
    clearSearchHistory: clearSearchHistory,
    homeWidgets: homeWidgets,
    saveHomeWidgets: saveHomeWidgets,
    usage: usage,
    bumpUsage: bumpUsage,
    setUsage: setUsage,
    exportBackup: exportBackup,
    importBackup: importBackup,
    downloadBackup: downloadBackup
  };
})(window);
