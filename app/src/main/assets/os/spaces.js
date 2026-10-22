/* os/spaces.js - LocalHub Spaces.
 * A Space is a personalized environment with its own dashboard, quick actions,
 * favorites, pinned items, theme, search history and assistant context.
 * Exposed as LH_OS.Spaces.
 */
(function (global) {
  "use strict";
  global.LH_OS = global.LH_OS || {};
  var Store = global.LH_OS.Store;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ctx() { return global.LH_AI && global.LH_AI.Context; }

  // ---- active space + persistence of per-space context ----
  function active() { return Store.getSpace(Store.activeSpaceId()); }

  function switchTo(id) {
    Store.setActiveSpace(id);
    // Assistant context becomes space-aware.
    if (ctx() && ctx().set) {
      ctx().set("space", { id: id, name: Store.getSpace(id).name });
      ctx().set("spaceQuick", Store.getSpace(id).quick || []);
    }
    Store.pushEvent("space switched", "Switched to " + Store.getSpace(id).name + " Space", { icon: "🪐" });
    if (global.LH_OS && global.LH_OS.Home) global.LH_OS.Home.widgets(global.document.getElementById("os-home-widgets"), Store.getSpace(id));
    if (global.LH_OS && global.LH_OS.Search) {}
    renderPicker();
    // broadcast so the assistant page can react
    try { localStorage.setItem("lh.os.space", Store.activeSpaceId()); } catch (e) {}
  }

  function renderPicker() {
    var el = global.document.getElementById("os-space-picker");
    if (!el) return;
    var list = Store.spaces();
    var cur = Store.activeSpaceId();
    el.innerHTML = list.map(function (sp) {
      return '<button class="os-space ' + (sp.id === cur ? "active" : "") + '" data-space="' + esc(sp.id) + '">' +
        "<span>" + (sp.icon || "🪐") + "</span><b>" + esc(sp.name) + "</b></button>";
    }).join("");
    el.querySelectorAll("[data-space]").forEach(function (b) {
      b.onclick = function () { switchTo(b.getAttribute("data-space")); };
    });
  }

  // ---- editor modal ----
  function openEditor(sp) {
    sp = sp || { id: "", name: "", icon: "🪐", theme: "dark", quick: [] };
    var overlay = global.document.getElementById("os-space-editor");
    if (!overlay) return;
    var q = (sp.quick || []).join("\n");
    overlay.querySelector(".os-editor-name").value = sp.name;
    overlay.querySelector(".os-editor-icon").value = sp.icon;
    overlay.querySelector(".os-editor-theme").value = sp.theme;
    overlay.querySelector(".os-editor-quick").value = q;
    overlay.querySelector(".os-editor-save").onclick = function () {
      var name = overlay.querySelector(".os-editor-name").value.trim();
      if (!name) return;
      sp.name = name;
      sp.icon = overlay.querySelector(".os-editor-icon").value || "🪐";
      sp.theme = overlay.querySelector(".os-editor-theme").value;
      sp.quick = overlay.querySelector(".os-editor-quick").value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
      if (sp.id) Store.upsertSpace(sp); else { Store.addSpace(sp); }
      closeEditor();
      renderPicker();
      if (active() && sp.id === active().id) switchTo(sp.id);
    };
    overlay.style.display = "flex";
  }
  function closeEditor() {
    var o = global.document.getElementById("os-space-editor");
    if (o) o.style.display = "none";
  }

  // ---- export / import ----
  function exportSpaces() {
    var a = global.document.createElement("a");
    a.href = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(Store.spaces(), null, 2));
    a.download = "localhub-spaces.json";
    global.document.body.appendChild(a); a.click(); a.remove();
  }

  global.LH_OS.Spaces = { active: active, switchTo: switchTo, renderPicker: renderPicker, openEditor: openEditor, closeEditor: closeEditor, exportSpaces: exportSpaces };
})(window);
