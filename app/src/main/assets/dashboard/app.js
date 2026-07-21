(function () {
  "use strict";

  var port = location.port || "8080";
  var host = location.hostname;
  var apiBase = location.protocol + "//" + location.host;
  var wsUrl = "ws://" + host + ":" + port + "/ws";

  function $(id) { return document.getElementById(id); }

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function pct(v) {
    v = v * 100;
    if (v < 0) v = 0;
    if (v > 100) v = 100;
    return v;
  }

  function setMetric(id, value, sub, progress) {
    setText(id + "-v", value);
    setText(id + "-s", sub || "");
    var b = $(id + "-b");
    if (b) b.style.width = pct(progress) + "%";
  }

  function fmtBytes(b) {
    b = b || 0;
    var u = ["B", "KB", "MB", "GB", "TB"];
    var i = Math.floor(Math.log(b) / Math.log(1024));
    if (i < 0) i = 0;
    if (i >= u.length) i = u.length - 1;
    return (b / Math.pow(1024, i)).toFixed(1) + " " + u[i];
  }

  // usagePercent is a derived Kotlin property and is not present in JSON,
  // so compute it from the raw used/total byte counters instead.
  function usagePct(used, total) {
    if (!total) return 0;
    var p = (used / total) * 100;
    if (p < 0) p = 0;
    if (p > 100) p = 100;
    return p;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function getJson(path) {
    return fetch(apiBase + path)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function updateSystem(s) {
    if (!s) return;
    setMetric("cpu", s.cpu.usagePercent.toFixed(1) + "%", s.cpu.cores + " cores", s.cpu.usagePercent / 100);
    setMetric("mem", fmtBytes(s.memory.usedBytes), "of " + fmtBytes(s.memory.totalBytes), usagePct(s.memory.usedBytes, s.memory.totalBytes) / 100);
    setMetric("sto", fmtBytes(s.storage.usedBytes), "of " + fmtBytes(s.storage.totalBytes), usagePct(s.storage.usedBytes, s.storage.totalBytes) / 100);
    setMetric("bat", s.battery.level + "%", s.battery.isCharging ? "Charging" : "Discharging", s.battery.level / 100);
    setMetric("net", s.network.type, s.network.ipAddress + (s.network.ssid ? " • " + s.network.ssid : ""), 0);
    setText("server-url", "http://" + s.network.ipAddress + ":" + (location.port || "8080"));
  }

  function updateDevice(d) {
    var el = $("device");
    if (!el || !d) return;
    el.innerHTML =
      kv("Model", d.model) +
      kv("Manufacturer", d.manufacturer) +
      kv("Android", d.androidVersion + " (API " + d.sdkInt + ")") +
      kv("Board", d.board) +
      kv("Hardware", d.hardware);
  }

  function kv(k, v) {
    return '<div class="kv"><span>' + escapeHtml(k) + "</span><b>" + escapeHtml(v) + "</b></div>";
  }

  function updateModules(mods) {
    var el = $("modules");
    if (!el) return;
    if (!mods || !mods.length) { el.innerHTML = "No modules."; return; }
    el.innerHTML = mods.map(function (m) {
      return kv(m.name, (m.enabled ? "on" : "off") + " • v" + m.version);
    }).join("");
  }

  function renderLogs(logs) {
    var el = $("logs");
    if (!el) return;
    if (!logs || !logs.length) { el.innerHTML = '<div class="log"><span class="lm">No logs yet.</span></div>'; return; }
    el.innerHTML = logs.slice(0, 60).map(function (l) {
      return logRow(l);
    }).join("");
  }

  function logRow(l) {
    var t = new Date(l.timestamp || Date.now()).toLocaleTimeString();
    var level = (l.level || "INFO").toLowerCase();
    return '<div class="log log-' + escapeHtml(level) + '">' +
      '<span class="lt">' + t + "</span>" +
      '<span class="ll">[' + escapeHtml(l.level || "INFO") + "]</span>" +
      '<span class="lm">' + escapeHtml(l.message) + "</span></div>";
  }

  function addLog(l) {
    var el = $("logs");
    if (!el) return;
    var div = document.createElement("div");
    div.innerHTML = logRow(l);
    el.insertBefore(div.firstChild, el.firstChild);
    while (el.childElementCount > 120) el.removeChild(el.lastChild);
  }

  function refreshStatic() {
    getJson("/api/system").then(updateSystem);
    getJson("/api/device").then(updateDevice);
    getJson("/api/modules").then(updateModules);
    getJson("/api/logs").then(function (r) { if (r && r.logs) renderLogs(r.logs); });
  }

  // Clients are tracked server-side; expose a lightweight fetch.
  function refreshClients() {
    getJson("/api/clients").then(function (r) {
      var el = $("clients");
      if (!el) return;
      var list = (r && r.clients) || [];
      if (!list.length) { el.innerHTML = "No clients connected."; return; }
      el.innerHTML = list.map(function (c) {
        return kv(c.ip + " • " + (c.protocol || "?"), new Date(c.lastActivity || Date.now()).toLocaleTimeString());
      }).join("");
    });
  }

  // ---- WebSocket realtime ----
  var ws;
  function connect() {
    try { ws = new WebSocket(wsUrl); } catch (e) { return; }
    ws.onopen = function () {
      var s = $("ws-status");
      s.innerHTML = '<span class="dot on"></span> live';
    };
    ws.onclose = function () {
      var s = $("ws-status");
      s.innerHTML = '<span class="dot off"></span> reconnecting…';
      setTimeout(connect, 2000);
    };
    ws.onerror = function () {};
    ws.onmessage = function (ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg.type === "stats" && msg.data) updateSystem(msg.data);
        else if (msg.type === "log" && msg.data) addLog(msg.data);
      } catch (e) {}
    };
  }

  refreshStatic();
  refreshClients();
  setInterval(refreshStatic, 5000);
  setInterval(refreshClients, 3000);
  connect();
})();
