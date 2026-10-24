(function () {
  "use strict";

  var port = location.port || "8080";
  var host = location.hostname;
  var apiBase = location.protocol + "//" + location.host;
  var wsUrl = "ws://" + host + ":" + port + "/ws";

  // ---- Authentication token (from ?token= or storage) ----
  var authToken = null;
  var currentRole = null;
  try {
    var q = new URLSearchParams(location.search);
    authToken = q.get("token") || sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken");
  } catch (e) { authToken = null; }

  function authFetch(url, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (authToken) opts.headers["Authorization"] = "Bearer " + authToken;
    return fetch(url, opts);
  }

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
    setText(id + "-s", sub || "");
    var b = $(id + "-b");
    if (b) b.style.width = pct(progress) + "%";
    var el = $(id + "-v");
    if (!el) return;
    // Animate numeric values counting up smoothly; fall back to plain text.
    var m = String(value).match(/^(-?[\d.]+)(.*)$/);
    if (m && window.LH_ANIM && window.LH_ANIM.countUp) {
      var suffix = m[2] || "";
      var target = parseFloat(m[1]);
      window.LH_ANIM.countUp(el, target, { format: function (v) { return (Math.round(v * 10) / 10) + suffix; } });
    } else {
      el.textContent = value;
    }
  }

  // Central animation bootstrap for the dashboard page: decorates cards,
  // buttons and bars with the shared animation language (see animations.css/js).
  function animInit() {
    if (!window.LH_ANIM) return;
    document.querySelectorAll(".card").forEach(function (el, i) {
      if (!el.classList.contains("lh-card")) { el.classList.add("lh-card"); }
      if (!el.classList.contains("lh-card-enter")) {
        el.classList.add("lh-card-enter");
        el.style.animationDelay = Math.min(i * 45, 360) + "ms";
      }
    });
    document.querySelectorAll("button, .chip").forEach(function (el) {
      el.classList.add("lh-ripple");
    });
    document.querySelectorAll(".bar-fill").forEach(function (el) { el.classList.add("lh-bar-fill"); });
    window.LH_ANIM.attachRipples();
    window.LH_ANIM.revealAll();
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
    return authFetch(apiBase + path)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  // Admin device-management controls: block / read-only / deny-files / full.
  function wireDeviceControls() {
    var dev = $("devices");
    if (!dev) return;
    dev.querySelectorAll("[data-dev-block]").forEach(function (b) {
      b.onclick = function () {
        authFetch(apiBase + "/api/devices/block", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ip: b.getAttribute("data-dev-block") }) })
          .then(function (r) { return r.json(); }).then(function (res) { refreshClients(); if (window.LH_OS && window.LH_OS.Store) window.LH_OS.Store.pushEvent("device blocked", b.getAttribute("data-dev-block")); });
      };
    });
    dev.querySelectorAll("[data-dev-ro]").forEach(function (b) {
      b.onclick = function () {
        authFetch(apiBase + "/api/devices/restrict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ip: b.getAttribute("data-dev-ro"), mode: "RO" }) })
          .then(function (r) { return r.json(); }).then(function () { refreshClients(); });
      };
    });
    dev.querySelectorAll("[data-dev-deny]").forEach(function (b) {
      b.onclick = function () {
        authFetch(apiBase + "/api/devices/restrict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ip: b.getAttribute("data-dev-deny"), mode: "deny" }) })
          .then(function (r) { return r.json(); }).then(function () { refreshClients(); });
      };
    });
    dev.querySelectorAll("[data-dev-none]").forEach(function (b) {
      b.onclick = function () {
        authFetch(apiBase + "/api/devices/restrict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ip: b.getAttribute("data-dev-none"), mode: "none" }) })
          .then(function (r) { return r.json(); }).then(function () { refreshClients(); });
      };
    });
  }

  // ---- USER dashboard: user-centric content (files, media, quick actions) ----
  function populateUserDashboard() {
    var q = $("user-quick");
    if (q) {
      q.innerHTML = "";
      ["Open File Manager", "Play Media", "Search Files"].forEach(function (a) {
        var b = document.createElement("button");
        b.className = "chip";
        b.textContent = a;
        b.onclick = function () {
          if (a.indexOf("File") >= 0) location.href = "/files";
          else if (a.indexOf("Play") >= 0) location.href = "/player";
          else location.href = "/files";
        };
        q.appendChild(b);
      });
    }
    try {
      if (window.LH_AI && window.LH_AI.Context) {
        var media = window.LH_AI.Context.get("mediaHistory") || [];
        var mediaEl = $("user-media");
        if (mediaEl) {
          mediaEl.innerHTML = media.slice(0, 6).map(function (m) {
            return '<a class="drow lh-row-in" style="text-decoration:none;color:var(--text)" href="/player?file=' + encodeURIComponent(m.path) + '"><div class="dmain"><b>' + escapeHtml(m.name) + '</b><span>' + (m.type || "media") + "</span></div></a>";
          }).join("") || '<div class="hint">Recently played media will appear here.</div>';
        }
        var files = window.LH_AI.Context.get("recentCommands") || [];
        var fileEl = $("user-files");
        if (fileEl) {
          fileEl.innerHTML = files.slice(0, 6).map(function (f) {
            return '<div class="drow"><div class="dmain"><span>' + escapeHtml(String(f)) + "</span></div></div>";
          }).join("") || '<div class="hint">Your recent activity will appear here.</div>';
        }
      }
    } catch (e) {}
  }

  // ---- Session bootstrap: verify token + determine role ----
  function initAuth() {
    // Never run the auth bootstrap (or redirect) on the login page itself,
    // otherwise it would redirect to /login.html repeatedly → refresh loop.
    if (location.pathname.indexOf("login") >= 0) return;

    if (!authToken) {
      window.location.href = "/login.html";
      return;
    }
    authFetch(apiBase + "/api/auth/session").then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (res) {
        if (res && res.authenticated) {
          currentRole = res.role || "user";
          applyRole(currentRole);
          refreshStatic();
          refreshClients();
          refreshDashboard();
        } else {
          window.location.href = "/login.html";
        }
      })
      .catch(function () { window.location.href = "/login.html"; });
  }

  // Sign out: clear stored tokens, revoke the session, and go to the login page.
  function logout() {
    try {
      authFetch(apiBase + "/api/auth/logout", { method: "POST" });
      sessionStorage.removeItem("lhtoken");
      localStorage.removeItem("lhtoken");
    } catch (e) {}
    window.location.href = "/login.html";
  }

  // Show/hide admin-only UI elements based on the caller's role.
  function applyRole(role) {
    var isAdmin = role === "admin";
    // Make the role visible to the AI assistant pages so they become role-aware.
    try { window.LH_AI = window.LH_AI || {}; window.LH_AI.role = role; } catch (e) {}
    document.querySelectorAll(".admin-only").forEach(function (el) {
      el.style.display = isAdmin ? "" : "none";
    });
    // Standard users see user-only sections; admins see the full management view.
    document.querySelectorAll(".user-only").forEach(function (el) {
      el.style.display = isAdmin ? "none" : "";
    });
    if (!isAdmin) populateUserDashboard();
    var ctl = $("server-control-card");
    if (ctl) ctl.style.display = isAdmin ? "" : "none";
    var ctrl = $("ctrl-row");
    if (ctrl) ctrl.style.display = isAdmin ? "" : "none";
    // Access Logs: render/display ONLY for Administrators. Standard users must
    // never see the section at all.
    var logsCard = $("logs-card");
    if (logsCard) logsCard.style.display = isAdmin ? "" : "none";
    // Wire the admin-only log toolbar (filters/export/clear/download) only when admin.
    wireLogToolbar();
    // Role badge + logout button.
    var badge = $("role-badge");
    if (badge) badge.textContent = isAdmin ? "Administrator" : "Web User";
    var lo = $("logout-btn");
    if (lo) lo.onclick = logout;
  }

  // Guarded system updater: every value is optional-chained with a fallback so
  // a missing or partial /api/system payload never crashes the dashboard.
  function updateSystem(s) {
    if (!s) return;
    var cpu = s.cpu || {};
    var mem = s.memory || {};
    var sto = s.storage || {};
    var bat = s.battery || {};
    var net = s.network || {};

    var cpuPct = (typeof cpu.usagePercent === "number") ? cpu.usagePercent : 0;
    setMetric("cpu",
      (cpu.available === false ? "Unavailable" : (cpu.usagePercent != null ? cpu.usagePercent.toFixed(1) : "0.0") + "%"),
      (cpu.cores || 1) + " cores",
      cpuPct / 100);

    setMetric("mem",
      fmtBytes(mem.usedBytes || 0),
      "of " + fmtBytes(mem.totalBytes || 0),
      usagePct(mem.usedBytes || 0, mem.totalBytes || 0) / 100);

    setMetric("sto",
      fmtBytes(sto.usedBytes || 0),
      "of " + fmtBytes(sto.totalBytes || 0),
      usagePct(sto.usedBytes || 0, sto.totalBytes || 0) / 100);

    setMetric("bat",
      (bat.level != null ? bat.level : 0) + "%",
      bat.isCharging ? "Charging" : "Discharging",
      (bat.level != null ? bat.level : 0) / 100);

    setMetric("net",
      net.type || "—",
      (net.ipAddress || "") + (net.ssid ? " • " + net.ssid : ""),
      0);

    setText("server-url", "http://" + (net.ipAddress || "127.0.0.1") + ":" + (location.port || "8080"));

    var sSummary = $("storage-summary");
    var sBar = $("storage-bar");
    if (sSummary && sto.totalBytes) {
      var sPct = usagePct(sto.usedBytes, sto.totalBytes);
      sSummary.textContent = fmtBytes(sto.usedBytes) + " / " + fmtBytes(sto.totalBytes) + " (" + Math.round(100 - sPct) + "% free)";
      if (sBar) sBar.style.width = sPct.toFixed(1) + "%";
    }

    var bSummary = $("battery-summary");
    var bBar = $("battery-bar");
    if (bSummary && bat.level != null) {
      bSummary.textContent = bat.level + "%" + (bat.isCharging ? " (Charging)" : "");
      if (bBar) bBar.style.width = bat.level + "%";
    }

    // WOW: push live data into the glowing sparkline charts.
    if (window.LH_VIS) {
      window.LH_VIS.push("cpu-chart", (cpu.usagePercent != null ? cpu.usagePercent : 0) / 100,
        (cpu.available === false ? "Unavailable" : (cpu.usagePercent != null ? cpu.usagePercent.toFixed(0) : "0") + "%"));
      window.LH_VIS.push("mem-chart", usagePct(mem.usedBytes || 0, mem.totalBytes || 0) / 100,
        Math.round(usagePct(mem.usedBytes || 0, mem.totalBytes || 0)) + "%");
      window.LH_VIS.push("sto-chart", usagePct(sto.usedBytes || 0, sto.totalBytes || 0) / 100,
        Math.round(usagePct(sto.usedBytes || 0, sto.totalBytes || 0)) + "%");
      window.LH_VIS.push("bat-chart", (bat.level != null ? bat.level : 0) / 100,
        (bat.level != null ? bat.level : 0) + "%");
      if (net.ipAddress) window.LH_VIS.push("net-chart", 0.5, net.type || "NET");
    }

    updateDetail(s, lastStatus);
  }
  var lastStatus = null;

  function updateDevice(d) {
    var el = $("device");
    if (!el || !d) return;
    d = d || {};
    el.innerHTML =
      kv("Model", d.model || "—") +
      kv("Manufacturer", d.manufacturer || "—") +
      kv("Android", (d.androidVersion || "—") + (d.sdkInt != null ? " (API " + d.sdkInt + ")" : "")) +
      kv("Board", d.board || "—") +
      kv("Hardware", d.hardware || "—");
  }

  function kv(k, v) {
    return '<div class="kv"><span>' + escapeHtml(k) + "</span><b>" + escapeHtml(v) + "</b></div>";
  }

  var MODULE_URLS = {
    dashboard: "/",
    files: "/files",
    ai: "/ai"
  };
  var MODULE_ICONS = {
    dashboard: "🏠",
    files: "🗂",
    ai: "🧠"
  };

  function updateModules(mods) {
    var el = $("modules");
    if (!el) return;
    if (!mods || !mods.length) { el.innerHTML = "No modules."; return; }
    el.innerHTML = mods.map(function (m) {
      var url = MODULE_URLS[m.id];
      var icon = MODULE_ICONS[m.id] || "🧩";
      var inner = '<div class="kv"><span>' + icon + " " + escapeHtml(m.name) + "</span><b>" +
        (m.enabled ? "on" : "off") + " • v" + m.version + "</b></div>";
      if (url) {
        return '<a href="' + url + '" style="text-decoration:none;color:inherit;display:block">' + inner + "</a>";
      }
      return inner;
    }).join("");
  }

  var logFilter = "all";
  var allLogs = [];

  function matchesFilter(l) {
    if (logFilter === "all") return true;
    var msg = (l.message || "").toLowerCase();
    var level = (l.level || "").toLowerCase();
    if (logFilter === "error") return level === "error" || level === "warning";
    if (logFilter === "GET") return /(get |get\s+\/|\bget\b)/i.test(msg);
    if (logFilter === "POST") return /post/i.test(msg);
    if (logFilter === "download") return /download|fs[\\/]download/.test(msg);
    if (logFilter === "media") return /player|video|audio|stream|fs[\\/]content/.test(msg);
    return true;
  }

  function renderLogs(logs) {
    var el = $("logs");
    if (!el) return;
    if (logs) allLogs = logs;
    var filtered = allLogs.filter(matchesFilter);
    if (!filtered.length) { el.innerHTML = '<div class="log"><span class="lm">No matching logs.</span></div>'; return; }
    el.innerHTML = filtered.slice(0, 80).map(function (l) {
      return '<div class="lh-row-in">' + logRow(l) + "</div>";
    }).join("");
    // smooth auto-scroll to the newest log
    if (window.LH_ANIM && window.LH_ANIM.scrollToBottom) window.LH_ANIM.scrollToBottom(el);
  }

  function wireLogToolbar() {
    // Access logs are Administrator-only. For standard users the section is not
    // rendered and no handlers are wired.
    if (currentRole !== "admin") return;

    document.querySelectorAll(".lf").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".lf").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        logFilter = btn.getAttribute("data-filter");
        renderLogs(null);
      });
    });
    var exp = $("export-logs");
    if (exp) exp.onclick = function () {
      var blob = new Blob([allLogs.map(function (l) {
        return new Date(l.timestamp || Date.now()).toISOString() + " [" + (l.level || "INFO") + "] " + l.message;
      }).join("\n")], { type: "text/plain" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "localhub-logs.txt";
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
    };
    var clr = $("clear-logs");
    if (clr) clr.onclick = function () {
      fetch(apiBase + "/api/log", { method: "POST", body: "clear" });
      allLogs = [];
      renderLogs(null);
    };
    // Download Logs (server-side full export) — admin only.
    var dl = $("download-logs");
    if (dl) dl.onclick = function () {
      window.open(apiBase + "/api/server/export-logs", "_blank");
    };
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
    // WOW: push a live ticker entry for real-time activity.
    if (window.LH_VIS && l) {
      var lvl = (l.level || "").toLowerCase();
      window.LH_VIS.ticker((l.message || "").slice(0, 90), (lvl === "error" || lvl === "warning") ? "err" : "");
    }
  }

  // ---- server status banner + uptime ----
  var serverStartedAt = 0;

  function renderStatus(st) {
    if (!st) return;
    lastStatus = st;
    serverStartedAt = st.startedAt || 0;
    setText("sb-name", st.name || "—");
    setText("sb-ip", st.host || "—");
    setText("sb-port", st.port != null ? st.port : "—");
    setText("sb-version", st.version || "—");
    setText("sb-restarts", (st.restartCount != null ? st.restartCount : 0) + "");
    var on = !!st.running;
    var dot = $("online-dot");
    if (dot) dot.className = "dot " + (on ? "on" : "off");
    setText("online-text", on ? "Online" : "Offline");
    updateUptime();
  }

  function updateUptime() {
    if (!serverStartedAt) { setText("sb-uptime", "—"); return; }
    var ms = Date.now() - serverStartedAt;
    setText("sb-uptime", fmtDuration(ms));
  }

  function fmtDuration(ms) {
    if (!ms || ms < 0) return "—";
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    var parts = [];
    if (d) parts.push(d + "d");
    if (h) parts.push(h + "h");
    if (m) parts.push(m + "m");
    parts.push(s + "s");
    return parts.join(" ");
  }

  // ---- system / network / uptime detail cards ----
  function updateDetail(s, st) {
    if (s) {
      var mem = s.memory || {}, sto = s.storage || {}, bat = s.battery || {}, net = s.network || {};
      var sysBody = $("system-body");
      if (sysBody) {
        sysBody.innerHTML =
          kv("CPU", (s.cpu && s.cpu.usagePercent != null ? s.cpu.usagePercent.toFixed(1) : "0") + "% (" + (s.cpu && s.cpu.cores || 1) + " cores)") +
          kv("RAM used", fmtBytes(mem.usedBytes || 0) + " / " + fmtBytes(mem.totalBytes || 0)) +
          kv("RAM available", fmtBytes(mem.availableBytes || 0)) +
          kv("Storage used", fmtBytes(sto.usedBytes || 0)) +
          kv("Storage free", fmtBytes(sto.availableBytes || 0)) +
          kv("Battery", (bat.level != null ? bat.level : 0) + "%") +
          kv("Battery state", bat.isCharging ? "Charging" : "Discharging") +
          kv("Battery temp", (bat.temperatureCelsius != null ? bat.temperatureCelsius : 0).toFixed(1) + "°C");
      }
      var netBody = $("network-body");
      if (netBody) {
        var stPort = (st && st.port != null) ? st.port : (location.port || "8080");
        var stHost = (st && st.hostname) || "localhub.local";
        netBody.innerHTML =
          kv("IP", net.ipAddress || "—") +
          kv("Port", stPort) +
          kv("Hostname", stHost) +
          kv("SSID", net.ssid || "—") +
          kv("Type", net.type || "—") +
          kv("Link speed", (net.linkSpeedMbps || 0) + " Mbps");
      }
    }
    var upBody = $("uptime-body");
    if (upBody) {
      var stAt = (st && st.startedAt) ? new Date(st.startedAt).toLocaleString() : "—";
      upBody.innerHTML =
        kv("Server started", stAt) +
        kv("Uptime", fmtDuration(serverStartedAt ? Date.now() - serverStartedAt : 0)) +
        kv("Restart count", (st && st.restartCount != null ? st.restartCount : 0));
    }
  }

  // ---- connected devices (UA -> browser / OS) ----
  function parseBrowser(ua) {
    ua = ua || "";
    var m;
    if ((m = ua.match(/Edg\/([\d.]+)/))) return "Edge " + m[1];
    if ((m = ua.match(/OPR\/([\d.]+)/)) || (m = ua.match(/Opera\/([\d.]+)/))) return "Opera " + m[1];
    if ((m = ua.match(/Firefox\/([\d.]+)/))) return "Firefox " + m[1];
    if ((m = ua.match(/Chrome\/([\d.]+)/))) return "Chrome " + m[1];
    if ((m = ua.match(/Safari\/([\d.]+)/))) return "Safari " + m[1];
    return "Unknown";
  }
  function parseOS(ua) {
    ua = ua || "";
    if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
    if (/Android/.test(ua)) return "Android";
    if (/Windows NT 10/.test(ua)) return "Windows 10/11";
    if (/Windows/.test(ua)) return "Windows";
    if (/Mac OS X/.test(ua)) return "macOS";
    if (/Linux/.test(ua)) return "Linux";
    return "Unknown";
  }
  function deviceName(c) {
    var os = parseOS(c.userAgent);
    var ip = c.ip || "?";
    if (c.protocol === "WebSocket") return os + " (" + ip + ")";
    return os + " client · " + ip;
  }

  function renderDevices(list) {
    var el = $("devices");
    setText("sb-clients", String((list && list.length) || 0));
    if (!el) return;
    if (!list || !list.length) { el.innerHTML = '<div class="empty" style="padding:10px;color:var(--muted)">No devices connected.</div>'; return; }
    el.innerHTML = list.map(function (c) {
      var since = c.connectedAt ? new Date(c.connectedAt).toLocaleTimeString() : "—";
      var last = c.lastActivity ? new Date(c.lastActivity).toLocaleTimeString() : "—";
      var ip = escapeHtml(c.ip || "?");
      var controls = currentRole === "admin" ?
        '<div class="dmeta" style="margin-top:6px">' +
          '<button class="btn btn-danger" data-dev-block="' + ip + '">Block</button> ' +
          '<button class="btn" data-dev-ro="' + ip + '">Read-only</button> ' +
          '<button class="btn btn-danger" data-dev-deny="' + ip + '">Deny files</button> ' +
          '<button class="chip" data-dev-none="' + ip + '">✓ Full</button>' +
        "</div>" : "";
      var row =
        '<div class="drow lh-row-in">' +
        '<div class="dmain"><b>' + escapeHtml(deviceName(c)) + "</b><span>" +
          escapeHtml(parseBrowser(c.userAgent)) + " · " + escapeHtml(parseOS(c.userAgent)) + " · " + escapeHtml(c.protocol || "HTTP") + "</span></div>" +
        '<div class="dmeta"><span>IP ' + ip + "</span>" +
          "<span>Since " + since + "</span><span>Active " + last + "</span></div>" +
        controls +
        "</div>";
      return row;
    }).join("");
    wireDeviceControls();
  }

  // ---- friendly hostname / QR ----
  function renderConnect(st) {
    var body = $("connect-body");
    if (!body || !st) return;
    var ipUrl = st.url || ("http://" + (st.host || "127.0.0.1") + ":" + (st.port || "8080"));
    var nameUrl = st.hostnameUrl || ipUrl;
    var activeUrl = nameUrl; // friendly hostname is primary
    var current = location.hostname || "";

    // If we already loaded the page via the IP (location.hostname is not .local),
    // treat the IP as the confirmed-reachable URL for the QR so scanning always works.
    if (current && current.indexOf(".local") < 0) {
      activeUrl = ipUrl;
    }

    body.innerHTML =
      '<div class="connect-wrap">' +
      '<div class="connect-qr"><img src="' + apiBase + "/api/qr?text=" + encodeURIComponent(activeUrl) + '" alt="QR" /></div>' +
      '<div class="connect-info">' +
      '<div class="kv"><span>Server name</span><b>' + escapeHtml(st.name || "") + "</b></div>" +
      '<div class="kv"><span>Hostname</span><b class="mono">' + escapeHtml(nameUrl) + "</b></div>" +
      '<div class="kv"><span>IP address</span><b class="mono">' + escapeHtml(ipUrl) + "</b></div>" +
      (current.indexOf(".local") >= 0
        ? '<div class="hint ok">✓ Connected via friendly hostname</div>'
        : '<div class="hint">Tip: on mDNS-capable networks use <b class="mono">' + escapeHtml(nameUrl) + "</b>; otherwise use the IP link above.</div>") +
      '</div></div>' +
      '<div class="btn-row">' +
      '<button class="btn btn-primary" data-copy-url="' + escapeHtml(activeUrl) + '" type="button">📋 Copy Wi-Fi Link</button>' +
      '<a class="btn ghost" href="' + escapeHtml(nameUrl) + '" target="_blank">Open hostname</a>' +
      '<a class="btn ghost" href="' + escapeHtml(ipUrl) + '" target="_blank">Open IP</a></div>';

    var copyBtn = body.querySelector("[data-copy-url]");
    if (copyBtn) {
      copyBtn.onclick = function () {
        var urlToCopy = copyBtn.getAttribute("data-copy-url");
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(urlToCopy).then(function () {
            copyBtn.textContent = "Copied! ✓";
            setTimeout(function () { copyBtn.textContent = "📋 Copy Wi-Fi Link"; }, 2000);
          }).catch(function () {
            copyBtn.textContent = "Copied! ✓";
            setTimeout(function () { copyBtn.textContent = "📋 Copy Wi-Fi Link"; }, 2000);
          });
        }
      };
    }
  }

  // Clients are tracked server-side; expose a lightweight fetch.
  function refreshClients() {
    getJson("/api/clients").then(function (r) {
      renderDevices((r && r.clients) || []);
    });
  }

  // ---- WebSocket realtime ----
  var ws;
  function connect() {
    // Attach the session token so the (now authenticated) WebSocket is accepted.
    var wsToken = authToken || "";
    var url = wsUrl + (wsToken ? "?token=" + encodeURIComponent(wsToken) : "");
    try { ws = new WebSocket(url); } catch (e) { return; }
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

  // ---- transfer monitor (speeds computed client-side via deltas) ----
  var prevTraffic = null;
  var prevTrafficTime = 0;
  var dlSpeeds = [], ulSpeeds = [];

  function fmtSpeed(bps) { return fmtBytes(bps) + "/s"; }

  function renderTraffic(t) {
    if (!t) return;
    var now = Date.now();
    var dlRate = 0, ulRate = 0;
    if (prevTraffic && prevTrafficTime) {
      var dt = (now - prevTrafficTime) / 1000;
      if (dt > 0) {
        dlRate = Math.max(0, (t.downloadBytes - prevTraffic.downloadBytes) / dt);
        ulRate = Math.max(0, (t.uploadBytes - prevTraffic.uploadBytes) / dt);
      }
    }
    dlSpeeds.push(dlRate); if (dlSpeeds.length > 20) dlSpeeds.shift();
    ulSpeeds.push(ulRate); if (ulSpeeds.length > 20) ulSpeeds.shift();
    var avgDl = dlSpeeds.reduce(function (a, b) { return a + b; }, 0) / dlSpeeds.length;
    var avgUl = ulSpeeds.reduce(function (a, b) { return a + b; }, 0) / ulSpeeds.length;
    var peakDl = Math.max.apply(null, dlSpeeds);
    var peakUl = Math.max.apply(null, ulSpeeds);

    setText("tm-dl", fmtSpeed(dlRate));
    setText("tm-ul", fmtSpeed(ulRate));
    setText("tm-totdl", fmtBytes(t.downloadBytes || 0));
    setText("tm-totul", fmtBytes(t.uploadBytes || 0));
    setText("tm-active", (t.activeTransfers || 0) + "");
    setText("tm-peak", (t.peakConcurrent || 0) + "");

    // store avg/peak on a detail element for the transfer section
    var m = $("tm-avgdl");
    if (m) m.textContent = fmtSpeed(avgDl);
    prevTraffic = t;
    prevTrafficTime = now;
  }

  // ---- activity ----
  function renderActivity(s, t, st) {
    var el = $("activity-body");
    if (!el) return;
    if (!t) { el.innerHTML = '<div class="empty">No activity yet.</div>'; return; }
    el.innerHTML =
      act("⬇ Downloads today", t.downloadsToday || 0) +
      act("⬆ Uploads today", t.uploadsToday || 0) +
      act("Media streams", t.mediaStreams || 0) +
      act("📂 Files opened", t.filesOpened || 0) +
      act("👥 Connected", (s && s.length) || 0) +
      act("🔝 Peak connections", t.peakConcurrent || 0);
    function act(k, v) { return '<div class="kv"><span>' + k + '</span><b>' + v + '</b></div>'; }
  }

  // ---- server control ----
  function wireServerControl() {
    document.querySelectorAll(".ctl[data-cmd]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var cmd = btn.getAttribute("data-cmd");
        var status = $("ctrl-status");
        if (cmd === "restart" || cmd === "stop") {
          if (!confirm((cmd === "stop" ? "Stop" : "Restart") + " the LocalHub server? " +
            (cmd === "stop" ? "After stopping you must restart from the LocalHub Android app." : "The page may briefly disconnect."))) return;
        }
        status.textContent = "Running: " + cmd + "…";
        var url = apiBase + "/api/server/" + cmd;
        var method = (cmd === "restart" || cmd === "stop" || cmd === "clear-cache" || cmd === "clear-logs" || cmd === "restore") ? "POST" : "GET";
        fetch(url, { method: method }).then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (res) {
            status.textContent = (res && res.message) || "Done.";
            // After a restart the server comes back on the same URL; reconnect.
            if (cmd === "restart") {
              status.textContent = "Restarting… reconnect in a moment.";
              setTimeout(function () {
                window.location.reload();
              }, 2500);
            } else {
              setTimeout(function () { status.textContent = ""; }, 2500);
            }
          })
          .catch(function () {
            // Server may be down (e.g. stopped) — guide the user.
            if (cmd === "stop") status.textContent = "Stopped. Restart from the LocalHub Android app.";
            else status.textContent = "Server unreachable — it may still be restarting.";
          });
      });
    });
  }

  // ---- developer mode (tap version 7 times) ----
  var devTaps = 0, devTimer = null;
  function wireDevMode() {
    var v = $("sb-version");
    if (!v) return;
    v.style.cursor = "pointer";
    v.title = "Developer Mode";
    v.addEventListener("click", function () {
      devTaps++;
      if (devTimer) clearTimeout(devTimer);
      devTimer = setTimeout(function () { devTaps = 0; }, 1200);
      if (devTaps >= 7) {
        devTaps = 0;
        document.querySelectorAll(".dev-only").forEach(function (el) { el.style.display = "block"; });
        loadEndpoints();
        var m = $("ctrl-status");
        if (m) m.textContent = "Developer Mode enabled.";
      }
    });
    var hide = $("dev-hide");
    if (hide) hide.onclick = function () {
      document.querySelectorAll(".dev-only").forEach(function (el) { el.style.display = "none"; });
    };
    var ref = $("dev-refresh-endpoints");
    if (ref) ref.onclick = loadEndpoints;
  }

  // ---- API explorer ----
  function loadEndpoints() {
    getJson("/api/endpoints").then(function (list) {
      var el = $("endpoints");
      if (!el || !list) return;
      el.innerHTML = list.map(function (e) {
        var full = apiBase + e.path;
        return '<div class="drow">' +
          '<div class="dmain"><b>' + escapeHtml(e.method) + " " + escapeHtml(e.path) + "</b>" +
          "<span>" + escapeHtml(e.desc) + "</span></div>" +
          '<div class="dmeta">' +
          '<button class="chip" data-open="' + escapeHtml(full) + '">Open</button> ' +
          '<button class="chip" data-copy="' + escapeHtml(full) + '">Copy</button> ' +
          '<button class="chip" data-test="' + escapeHtml(full) + '">Test</button></div></div>';
      }).join("");
      el.querySelectorAll("[data-open]").forEach(function (b) { b.onclick = function () { window.open(b.getAttribute("data-open"), "_blank"); }; });
      el.querySelectorAll("[data-copy]").forEach(function (b) { b.onclick = function () {
        navigator.clipboard.writeText(b.getAttribute("data-copy")); toast("Copied URL");
      }; });
      el.querySelectorAll("[data-test]").forEach(function (b) { b.onclick = function () { testEndpoint(b.getAttribute("data-test")); }; });
    });
  }
  function testEndpoint(url) {
    fetch(url).then(function (r) { return r.text(); }).then(function (txt) {
      alert("HTTP " + url + "\n\n" + txt.slice(0, 1200));
    }).catch(function (e) { alert("Request failed: " + e.message); });
  }
  function toast(msg) {
    var t = document.createElement("div");
    t.style.cssText = "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#0f1a2e;border:1px solid var(--accent);color:var(--text);border-radius:8px;padding:10px 16px;font-size:13px;z-index:999;";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2000);
  }

  // ---- aggregate dashboard refresh ----
  function refreshDashboard() {
    getJson("/api/dashboard").then(function (d) {
      if (!d) return;
      if (d.system) updateSystem(d.system);
      if (d.status) { renderConnect(d.status); renderStatus(d.status); updateDetail(d.system, d.status); }
      if (d.traffic) renderTraffic(d.traffic);
      renderActivity(d.clients, d.traffic, d.status);
      if (d.modules) updateModules(d.modules);
    });
  }

  function refreshStatic() {
    getJson("/api/system").then(updateSystem);
    getJson("/api/device").then(updateDevice);
    getJson("/api/modules").then(updateModules);
    // Access logs are Administrator-only — never fetched for standard users.
    if (currentRole === "admin") {
      getJson("/api/logs").then(function (r) { if (r && r.logs) renderLogs(r.logs); });
    }
    getJson("/api/status").then(function (st) { renderConnect(st); renderStatus(st); updateDetail(null, st); });
  }

  // ---- Wireless Quick Drop (AirDrop for local Wi-Fi) ----
  function wireQuickDrop() {
    var input = $("quickdrop-input");
    var zone = $("quickdrop-zone");
    var prog = $("quickdrop-progress");
    var bar = $("quickdrop-bar");
    var status = $("quickdrop-status");
    var pctText = $("quickdrop-pct");
    if (!input || !zone || !prog || !bar || !status || !pctText) return;

    zone.onclick = function () { input.click(); };

    function uploadBatch(files) {
      if (!files || !files.length) return;
      var file = files[0];
      prog.style.display = "block";
      status.textContent = "Sending " + file.name + " (" + fmtBytes(file.size) + ")…";
      bar.style.width = "0%";
      pctText.textContent = "0%";

      var xhr = new XMLHttpRequest();
      var fd = new FormData();
      fd.append("file", file);
      var uploadUrl = apiBase + "/api/fs/upload?dir=" + encodeURIComponent("/storage/emulated/0/Download") + "&overwrite=true";

      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) {
          var p = Math.round((e.loaded / e.total) * 100);
          bar.style.width = p + "%";
          pctText.textContent = p + "%";
        }
      };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          status.textContent = "✓ " + file.name + " saved to phone Downloads!";
          bar.style.width = "100%";
          pctText.textContent = "100%";
          setTimeout(function () { prog.style.display = "none"; }, 3500);
          if (files.length > 1) {
            uploadBatch(Array.prototype.slice.call(files, 1));
          }
        } else {
          status.textContent = "Upload failed: " + xhr.statusText;
        }
      };
      xhr.onerror = function () {
        status.textContent = "Network error while uploading.";
      };
      xhr.open("POST", uploadUrl);
      if (authToken) xhr.setRequestHeader("Authorization", "Bearer " + authToken);
      xhr.send(fd);
    }

    input.onchange = function () {
      if (input.files && input.files.length) uploadBatch(input.files);
    };

    zone.ondragover = function (e) { e.preventDefault(); zone.classList.add("dragover"); };
    zone.ondragleave = function () { zone.classList.remove("dragover"); };
    zone.ondrop = function (e) {
      e.preventDefault();
      zone.classList.remove("dragover");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        uploadBatch(e.dataTransfer.files);
      }
    };
  }

  // ---- Remote Phone Hardware Controls (Torch, Find, Volume, Mirror) ----
  function wirePhoneControls() {
    var torchBtn = $("btn-torch");
    var torchState = false;
    if (torchBtn) {
      torchBtn.onclick = function () {
        torchState = !torchState;
        authFetch(apiBase + "/api/device/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "torch", state: torchState })
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (res && res.ok) {
            torchBtn.textContent = "🔦 Flashlight: " + (torchState ? "ON" : "OFF");
            torchBtn.classList.toggle("btn-primary", torchState);
          }
        });
      };
    }

    var vibBtn = $("btn-vibrate");
    if (vibBtn) {
      vibBtn.onclick = function () {
        vibBtn.disabled = true;
        vibBtn.textContent = "📳 Buzzing phone…";
        authFetch(apiBase + "/api/device/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "vibrate", value: 1500 })
        }).then(function () {
          setTimeout(function () {
            vibBtn.disabled = false;
            vibBtn.textContent = "📳 Vibrate Phone (Find)";
          }, 1600);
        });
      };
    }

    var volUp = $("btn-volume-up");
    if (volUp) {
      volUp.onclick = function () {
        authFetch(apiBase + "/api/device/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "volume_up" })
        });
      };
    }

    var volDown = $("btn-volume-down");
    if (volDown) {
      volDown.onclick = function () {
        authFetch(apiBase + "/api/device/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "volume_down" })
        });
      };
    }

    var mirrorBtn = $("btn-mirror");
    if (mirrorBtn) {
      mirrorBtn.onclick = function () {
        authFetch(apiBase + "/api/mirror/start", { method: "POST" })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            var st = $("remote-action-status");
            if (st) st.textContent = (res && res.message) || (res && res.error) || "Mirror requested on phone.";
          });
      };
    }
  }

  setInterval(updateUptime, 1000);
  wireServerControl();
  wireDevMode();
  wireQuickDrop();
  wirePhoneControls();
  connect();
  animInit();
  // WOW: cinematic boot splash + live charts.
  if (window.LH_VIS) window.LH_VIS.boot();
  // Start the authenticated bootstrap (verifies session, sets role, loads data).
  initAuth();
})();
