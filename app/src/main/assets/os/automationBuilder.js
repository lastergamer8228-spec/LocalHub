/* os/automationBuilder.js - LocalHub Visual Automation Builder.
 * Block-based, no-code workflow builder. IF/THEN blocks with triggers,
 * actions, drag & drop, undo/redo, templates, validation, import/export.
 * Exposed as LH_OS.AutoBuilder.
 */
(function (global) {
  "use strict";
  global.LH_OS = global.LH_OS || {};
  var Store = global.LH_OS.Store;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var TRIGGERS = {
    client_connected: "Client Connected", client_disconnected: "Client Disconnected",
    upload_finished: "Upload Finished", download_finished: "Download Finished",
    media_finished: "Media Finished", server_started: "Server Started",
    server_stopped: "Server Stopped", time: "Time", day: "Day of week",
    battery: "Battery", storage: "Storage", network: "Network"
  };
  var ACTIONS = {
    notify: "Send Notification", start_backup: "Start Backup", move_file: "Move File",
    delete_temp: "Delete Temp Files", play_sound: "Play Sound", run_command: "Run Assistant Command",
    execute_plugin: "Execute Plugin", organize: "Organize Downloads"
  };
  var TEMPLATES = {
    backup_on_connect: { name: "Backup on Client Connect", triggers: [{ t: "client_connected" }], actions: [{ a: "start_backup" }] },
    storage_alert: { name: "Storage > 90% Alert", triggers: [{ t: "storage", v: 90 }], actions: [{ a: "notify" }] },
    organize_on_upload: { name: "Organize after Upload", triggers: [{ t: "upload_finished" }], actions: [{ a: "organize" }] },
    clear_temp_weekly: { name: "Weekly Temp Cleanup", triggers: [{ t: "day", v: "monday" }], actions: [{ a: "delete_temp" }] }
  };

  // ---- builder state ----
  var state = { triggers: [], actions: [], name: "" };
  var history = [];
  var historyIdx = -1;
  var historyMax = 50;

  function snapshot() { return JSON.parse(JSON.stringify(state)); }
  function pushHistory() {
    history = history.slice(0, historyIdx + 1);
    history.push(snapshot());
    if (history.length > historyMax) history.shift();
    historyIdx = history.length - 1;
    updateUndo();
  }
  function undo() { if (historyIdx > 0) { historyIdx--; state = JSON.parse(JSON.stringify(history[historyIdx])); render(); } }
  function redo() { if (historyIdx < history.length - 1) { historyIdx++; state = JSON.parse(JSON.stringify(history[historyIdx])); render(); } }
  function updateUndo() {
    var u = global.document.getElementById("os-ab-undo"), r = global.document.getElementById("os-ab-redo");
    if (u) u.disabled = historyIdx <= 0;
    if (r) r.disabled = historyIdx >= history.length - 1;
  }

  // ---- validation ----
  function validate() {
    var errs = [];
    if (!state.triggers.length) errs.push("Add at least one trigger (IF).");
    if (!state.actions.length) errs.push("Add at least one action (THEN).");
    var last = state.triggers[state.triggers.length - 1];
    if (last && (last.t === "storage") && (last.v == null || last.v > 100)) errs.push("Storage threshold must be 0-100.");
    return errs;
  }

  // ---- render ----
  function render() {
    var wrap = global.document.getElementById("os-ab-canvas");
    if (!wrap) return;
    var tHtml = state.triggers.map(function (t, i) {
      return blockHtml("trigger", i, TRIGGERS[t.t] || t.t, t);
    }).join("");
    var aHtml = state.actions.map(function (a, i) {
      return blockHtml("action", i, ACTIONS[a.a] || a.a, a);
    }).join("");
    wrap.innerHTML =
      '<div class="os-ab-sec"><div class="os-ab-label">IF</div><div class="os-ab-blocks" data-kind="trigger">' +
      (tHtml || '<div class="os-ab-empty">No trigger</div>') + "</div></div>" +
      '<div class="os-ab-sec"><div class="os-ab-label">THEN</div><div class="os-ab-blocks" data-kind="action">' +
      (aHtml || '<div class="os-ab-empty">No action</div>') + "</div></div>";
    wire();
  }

  function blockHtml(kind, i, label, data) {
    var extra = "";
    if (data.t === "storage" || data.t === "battery") extra = ' <input type="number" class="os-ab-val" data-idx="' + i + '" data-kind="' + kind + '" value="' + esc(data.v != null ? data.v : "") + '" placeholder="%" />';
    if (data.t === "time") extra = ' <input type="text" class="os-ab-val" data-idx="' + i + '" data-kind="' + kind + '" value="' + esc(data.v != null ? data.v : "") + '" placeholder="HH:MM" />';
    if (data.t === "day") extra = ' <input type="text" class="os-ab-val" data-idx="' + i + '" data-kind="' + kind + '" value="' + esc(data.v != null ? data.v : "") + '" placeholder="e.g. monday" />';
    if (data.a === "move_file") extra = ' <input type="text" class="os-ab-val" data-idx="' + i + '" data-kind="' + kind + '" value="' + esc(data.v != null ? data.v : "") + '" placeholder="dest path" />';
    if (data.a === "run_command") extra = ' <input type="text" class="os-ab-val" data-idx="' + i + '" data-kind="' + kind + '" value="' + esc(data.v != null ? data.v : "") + '" placeholder="assistant command" />';
    return '<div class="os-block" draggable="true" data-kind="' + kind + '" data-idx="' + i + '">' +
      '<span class="os-block-ic">' + (kind === "trigger" ? "🔎" : "⚙") + "</span>" +
      '<span class="os-block-lb">' + esc(label) + "</span>" + extra +
      '<button class="os-block-up" data-up="' + i + '" data-kind="' + kind + '">▲</button>' +
      '<button class="os-block-down" data-down="' + i + '" data-kind="' + kind + '">▼</button>' +
      '<button class="os-block-del" data-del="' + i + '" data-kind="' + kind + '">✕</button></div>';
  }

  function wire() {
    var wrap = global.document.getElementById("os-ab-canvas");
    wrap.querySelectorAll("[data-up]").forEach(function (b) { b.onclick = function () { move(b.getAttribute("data-kind"), parseInt(b.getAttribute("data-up"), 10), -1); }; });
    wrap.querySelectorAll("[data-down]").forEach(function (b) { b.onclick = function () { move(b.getAttribute("data-kind"), parseInt(b.getAttribute("data-down"), 10), 1); }; });
    wrap.querySelectorAll("[data-del]").forEach(function (b) { b.onclick = function () { remove(b.getAttribute("data-kind"), parseInt(b.getAttribute("data-del"), 10)); }; });
    wrap.querySelectorAll(".os-ab-val").forEach(function (inp) {
      inp.onchange = function () {
        var kind = inp.getAttribute("data-kind"), idx = parseInt(inp.getAttribute("data-idx"), 10);
        var list = state[kind === "trigger" ? "triggers" : "actions"];
        if (list[idx]) list[idx].v = inp.value;
        pushHistory();
      };
    });
    // drag & drop between sections
    wrap.querySelectorAll(".os-block").forEach(function (blk) {
      blk.addEventListener("dragstart", function (e) {
        e.dataTransfer.setData("text/plain", blk.getAttribute("data-kind") + ":" + blk.getAttribute("data-idx"));
        blk.classList.add("dragging");
      });
      blk.addEventListener("dragend", function () { blk.classList.remove("dragging"); });
      blk.addEventListener("dragover", function (e) { e.preventDefault(); });
      blk.addEventListener("drop", function (e) {
        e.preventDefault();
        var d = e.dataTransfer.getData("text/plain").split(":");
        var srcKind = d[0], srcIdx = parseInt(d[1], 10), dstKind = blk.getAttribute("data-kind"), dstIdx = parseInt(blk.getAttribute("data-idx"), 10);
        if (srcKind === dstKind && srcIdx !== dstIdx) { swap(srcKind, srcIdx, dstIdx); }
      });
    });
  }

  function move(kind, idx, dir) {
    var list = state[kind === "trigger" ? "triggers" : "actions"];
    var ni = idx + dir;
    if (ni < 0 || ni >= list.length) return;
    var t = list[idx]; list[idx] = list[ni]; list[ni] = t;
    pushHistory(); render();
  }
  function swap(kind, a, b) { var list = state[kind === "trigger" ? "triggers" : "actions"]; var t = list[a]; list[a] = list[b]; list[b] = t; pushHistory(); render(); }
  function remove(kind, idx) {
    state[kind === "trigger" ? "triggers" : "actions"].splice(idx, 1);
    pushHistory(); render();
  }

  // ---- palettes ----
  function renderPalettes() {
    var tt = global.document.getElementById("os-ab-triggers"), aa = global.document.getElementById("os-ab-actions");
    if (tt) {
      tt.innerHTML = '<option value="">+ Trigger</option>' + Object.keys(TRIGGERS).map(function (k) {
        return '<option value="' + k + '">' + esc(TRIGGERS[k]) + "</option>";
      }).join("");
      tt.onchange = function () { if (tt.value) { state.triggers.push({ t: tt.value }); pushHistory(); render(); tt.value = ""; } };
    }
    if (aa) {
      aa.innerHTML = '<option value="">+ Action</option>' + Object.keys(ACTIONS).map(function (k) {
        return '<option value="' + k + '">' + esc(ACTIONS[k]) + "</option>";
      }).join("");
      aa.onchange = function () { if (aa.value) { state.actions.push({ a: aa.value }); pushHistory(); render(); aa.value = ""; } };
    }
  }

  function renderTemplates() {
    var el = global.document.getElementById("os-ab-templates");
    if (!el) return;
    el.innerHTML = '<option value="">Use a template…</option>' + Object.keys(TEMPLATES).map(function (k) {
      return '<option value="' + k + '">' + esc(TEMPLATES[k].name) + "</option>";
    }).join("");
    el.onchange = function () {
      var t = TEMPLATES[el.value];
      if (t) { state = { name: t.name, triggers: JSON.parse(JSON.stringify(t.triggers)), actions: JSON.parse(JSON.stringify(t.actions)) }; history = [snapshot()]; historyIdx = 0; render(); updateUndo(); }
      el.value = "";
    };
  }

  // ---- save / run ----
  function save() {
    var errs = validate();
    var errEl = global.document.getElementById("os-ab-errors");
    if (errEl) errEl.textContent = errs.join(" · ");
    if (errs.length) { errEl.style.color = "var(--danger)"; return; }
    var wf = { id: "wf_" + Date.now(), kind: "workflow", name: state.name || "My Automation", enabled: true, triggers: state.triggers, actions: state.actions, createdAt: Date.now() };
    return global.LH_AI.Automation.add(wf).then(function () {
      Store.pushEvent("automation created", "Created automation: " + wf.name, { icon: "⚙️" });
      if (errEl) { errEl.textContent = "✓ Saved"; errEl.style.color = "var(--success)"; }
      return wf;
    });
  }

  function exportJson() {
    var a = global.document.createElement("a");
    a.href = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ name: state.name, triggers: state.triggers, actions: state.actions }, null, 2));
    a.download = "automation.json";
    global.document.body.appendChild(a); a.click(); a.remove();
  }
  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var d = JSON.parse(reader.result);
        if (d.triggers && d.actions) { state = { name: d.name || "Imported", triggers: d.triggers, actions: d.actions }; history = [snapshot()]; historyIdx = 0; render(); updateUndo(); }
      } catch (e) {}
    };
    reader.readAsText(file);
  }

  function init() {
    history = [snapshot()]; historyIdx = 0;
    renderPalettes(); renderTemplates(); render(); updateUndo();
    var undo = global.document.getElementById("os-ab-undo"), redo = global.document.getElementById("os-ab-redo");
    if (undo) undo.onclick = undo; if (redo) redo.onclick = redo;
    var saveBtn = global.document.getElementById("os-ab-save"); if (saveBtn) saveBtn.onclick = save;
    var exp = global.document.getElementById("os-ab-export"); if (exp) exp.onclick = exportJson;
    var imp = global.document.getElementById("os-ab-import"); if (imp) imp.onchange = function () { if (imp.files[0]) importJson(imp.files[0]); };
    var name = global.document.getElementById("os-ab-name"); if (name) name.oninput = function () { state.name = name.value; };
  }

  global.LH_OS.AutoBuilder = { init: init, render: render, undo: undo, redo: redo, save: save, TRIGGERS: TRIGGERS, ACTIONS: ACTIONS };
})(window);
