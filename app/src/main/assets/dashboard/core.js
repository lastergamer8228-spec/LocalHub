/* core.js - LocalHub Quantum System Core & Synchronization Matrix
 *
 * A full holographic digital twin of the phone host and connected clients.
 * Visualizes live hardware telemetry (CPU, RAM, Storage, Battery, Thermals)
 * and active network synchronization via 3D energy beams and photon streams.
 *
 * Runs standalone on /core.html and embedded on the dashboard (<canvas data-core>).
 */
(function () {
  "use strict";

  var cv = document.querySelector("canvas[data-core]") || document.getElementById("core");
  if (!cv) return;
  var ctx = cv.getContext("2d");
  var isStandalone = (cv.id === "core" && document.getElementById("hud-device-name"));
  var W = 0, H = 0, DPR = Math.min(2, window.devicePixelRatio || 1);

  function parentSize() {
    var parent = cv.parentElement;
    if (parent && parent.clientWidth > 0 && !isStandalone) return { w: parent.clientWidth, h: parent.clientHeight };
    return { w: window.innerWidth, h: window.innerHeight };
  }
  function resize() {
    var s = parentSize();
    W = s.w || window.innerWidth;
    H = s.h || window.innerHeight;
    cv.width = W * DPR;
    cv.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  var token = "";
  try {
    token = new URLSearchParams(location.search).get("token") ||
      sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken") || "";
  } catch (e) {}

  function api(url) {
    var h = {};
    if (token) h["Authorization"] = "Bearer " + token;
    return fetch(url, { headers: h }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  var reduced = false;
  try { reduced = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  // ---- System State ----
  var sys = {
    cpu: { cores: 8, usagePercent: 14.5, available: true },
    memory: { totalBytes: 8589934592, usedBytes: 5583457280, availableBytes: 3006477312 },
    storage: { totalBytes: 256000000000, usedBytes: 142000000000, availableBytes: 114000000000 },
    battery: { level: 85, isCharging: true, temperature: 31.4, health: "GOOD" },
    network: { ipAddress: "192.168.0.101", type: "Wi-Fi", ssid: "LocalMesh" },
    device: { model: "Nothing Phone (2a)", brand: "Nothing", manufacturer: "Nothing", androidVersion: "14" }
  };
  var clients = [];
  var rotationX = -0.32, rotationY = 0, autoSpin = 1, zoom = 1, showGrid = 1, drag = null;
  var targetRotX = -0.32, targetRotY = 0, targetZoom = 1;

  // Format bytes helper
  function fmtBytes(b) {
    b = b || 0;
    var u = ["B", "KB", "MB", "GB", "TB"];
    var i = Math.floor(Math.log(b) / Math.log(1024));
    if (i < 0) i = 0; if (i >= u.length) i = u.length - 1;
    return (b / Math.pow(1024, i)).toFixed(1) + " " + u[i];
  }

  // ---- 3D Icosahedron Geometry (12 vertices, 30 edges) ----
  var verts = [], edges = [];
  (function buildIcosa() {
    var t = (1 + Math.sqrt(5)) / 2;
    var p = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
    ];
    verts = p.map(function (v) {
      var l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      return [v[0] / l, v[1] / l, v[2] / l];
    });
    function dist(a, b) {
      var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    for (var i = 0; i < verts.length; i++) {
      for (var j = i + 1; j < verts.length; j++) {
        if (Math.abs(dist(verts[i], verts[j]) - 1.105) < 0.08) {
          edges.push({ a: i, b: j });
        }
      }
    }
  })();

  function coreRadius() {
    var base = Math.min(W, H);
    var r = base * (isStandalone ? 0.26 : 0.30);
    var max = Math.min(W, H) / 2 - 20;
    r = Math.max(36, Math.min(r, max, isStandalone ? 160 : 130));
    return r * zoom;
  }

  function project(v) {
    var R = coreRadius();
    var cy = Math.cos(rotationY), sy = Math.sin(rotationY);
    var x1 = v[0] * cy - v[2] * sy;
    var z1 = v[0] * sy + v[2] * cy;
    var cx = Math.cos(rotationX), sx = Math.sin(rotationX);
    var y1 = v[1] * cx - z1 * sx;
    var z2 = v[1] * sx + z1 * cx;
    var s = R / (1.85 + z2 * 0.45);
    return { x: W / 2 + x1 * s, y: H / 2 + y1 * s, z: z2, rawX: x1, rawY: y1 };
  }

  // Semantic Node Map: 12 vertices representing hardware cores and buses
  var nodeTypes = [];
  function buildNodeMap() {
    nodeTypes = [];
    var cores = Math.max(1, Math.min(8, sys.cpu.cores || 8));
    for (var i = 0; i < cores; i++) {
      nodeTypes.push({ kind: "core", label: "C" + i, color: "#22d3a6" });
    }
    var resources = [
      { kind: "ram", label: "RAM", color: "#a855f7" },
      { kind: "sto", label: "STO", color: "#f59e0b" },
      { kind: "net", label: "NET", color: "#38bdf8" },
      { kind: "sys", label: "SYS", color: "#34d399" }
    ];
    for (var j = 0; j < 12 - cores && j < resources.length; j++) {
      nodeTypes.push(resources[j]);
    }
    while (nodeTypes.length < 12) {
      nodeTypes.push({ kind: "idle", label: "BUS", color: "#64748b" });
    }
  }

  function nodeLoad(kind, idx, cpuLoad, t) {
    switch (kind) {
      case "core":
        var wob = 0.5 + 0.5 * Math.sin(t * 0.0018 + idx * 2.1);
        return Math.max(0.05, Math.min(1, cpuLoad * 0.75 + wob * 0.25));
      case "ram":
        return (sys.memory.usedBytes || 1) / (sys.memory.totalBytes || 1);
      case "sto":
        return (sys.storage.usedBytes || 1) / (sys.storage.totalBytes || 1);
      case "net":
        return clients.length > 0 ? 0.65 + Math.sin(t * 0.003) * 0.2 : 0.25;
      case "sys":
        return Math.min(1, ((sys.cpu.usagePercent || 0) / 100) * 0.6 + 0.2);
      default:
        return 0.15;
    }
  }

  function loadColor(load) {
    if (load < 0.45) return "rgba(34,211,166,";
    if (load < 0.75) return "rgba(251,191,36,";
    return "rgba(239,68,68,";
  }

  // Energy Particles & Photons
  var particles = [];
  function spawnParticle(color) {
    particles.push({
      a: Math.random() * Math.PI * 2,
      b: Math.random() * Math.PI * 2,
      speed: 0.015 + Math.random() * 0.03,
      age: 0,
      life: 90 + Math.random() * 80,
      color: color || "rgba(56,189,248,",
      r: 1 + Math.random() * 2
    });
  }
  function updateParticles() {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.age++;
      p.a += p.speed;
      p.b += p.speed * 0.6;
      if (p.age > p.life) particles.splice(i, 1);
    }
    var limit = isStandalone ? 48 : 24;
    while (particles.length < limit && Math.random() < 0.3) {
      spawnParticle(Math.random() < 0.5 ? "rgba(34,211,166," : "rgba(56,189,248,");
    }
  }

  // Client Orbit Nodes & Real-Time Sync Beams
  var orbitNodes = [];
  function syncOrbits() {
    var effectiveClients = clients.length > 0 ? clients : [{ ip: "192.168.0.x (LAN MESH)", protocol: "WebSocket", userAgent: "Local Peer" }];
    while (orbitNodes.length < effectiveClients.length) {
      orbitNodes.push({
        phase: Math.random() * Math.PI * 2,
        tilt: 0.2 + (orbitNodes.length * 0.5) % Math.PI,
        speed: 0.25 + Math.random() * 0.3,
        r: 1.8 + Math.random() * 0.4,
        pulse: 0,
        photons: [0, 0.33, 0.66]
      });
    }
    if (orbitNodes.length > effectiveClients.length) orbitNodes.length = effectiveClients.length;
  }

  // ---- 3D Perspective Cyber-Grid Floor ----
  function drawCyberGrid(cx, cy, R) {
    if (!showGrid) return;
    var gridY = cy + R * 1.55;
    ctx.save();
    ctx.beginPath();
    var numLines = 14;
    var step = (W * 0.9) / numLines;
    var startX = (W - numLines * step) / 2;

    // Radial perspective lines radiating from horizon center
    for (var i = 0; i <= numLines; i++) {
      var xBottom = startX + i * step;
      var xTop = cx + (xBottom - cx) * 0.12;
      var yTop = gridY - 80;
      ctx.moveTo(xTop, yTop);
      ctx.lineTo(xBottom, gridY + 120);
    }

    // Transverse grid lines fading into horizon
    for (var j = 0; j < 6; j++) {
      var frac = (j + 1) / 6;
      var y = gridY - 80 + frac * 200;
      var widthAtY = (W * 0.3) + frac * (W * 0.7);
      ctx.moveTo(cx - widthAtY / 2, y);
      ctx.lineTo(cx + widthAtY / 2, y);
    }
    ctx.strokeStyle = "rgba(56, 189, 248, 0.045)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // ---- Concentric Gyro / Gimbal Orbit Rings ----
  function drawGimbalRings(cx, cy, R, t) {
    ctx.save();
    // Ring 1: Equatorial Gyro Ring with Azimuth Marks
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 1.75, R * 0.52, rotationY * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(56, 189, 248, 0.12)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 8]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Ring 2: Polar Ring (inclined 45 deg)
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 1.45, R * 1.45 * 0.35, -Math.PI / 4 + rotationY * 0.2, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(34, 211, 166, 0.14)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Ring 3: Fast Inner Synchronization Aura
    ctx.beginPath();
    var innerAngle = (t * 0.001) % (Math.PI * 2);
    ctx.arc(cx, cy, R * 1.15, innerAngle, innerAngle + Math.PI * 0.6);
    ctx.strokeStyle = "rgba(34, 211, 166, 0.4)";
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#22d3a6";
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // ---- Main Hologram Render Loop ----
  function render() {
    var t = Date.now();
    ctx.clearRect(0, 0, W, H);

    // Deep space gradient background
    var bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.85);
    bg.addColorStop(0, "#081022");
    bg.addColorStop(0.5, "#050914");
    bg.addColorStop(1, "#03050a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (autoSpin && !drag) rotationY += 0.0035;

    var cx = W / 2, cy = H / 2;
    var R = coreRadius();
    buildNodeMap();
    var cpuLoad = (sys.cpu.usagePercent || 14) / 100;

    // 1. Perspective Grid Floor
    drawCyberGrid(cx, cy, R);

    // 2. Concentric Gyroscope / Gimbal Rings
    drawGimbalRings(cx, cy, R, t);

    // 3. Central Crystalline Nucleus Bloom
    var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.95);
    glow.addColorStop(0, "rgba(34, 211, 166, 0.32)");
    glow.addColorStop(0.35, "rgba(56, 189, 248, 0.12)");
    glow.addColorStop(0.7, "rgba(168, 85, 247, 0.04)");
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.95, 0, Math.PI * 2);
    ctx.fill();

    // 4. 3D Project Vertices
    var projectedVerts = verts.map(project);

    // Sort edges by Z-depth for 3D realism
    var sortedEdges = edges.slice().sort(function (a, b) {
      var za = (projectedVerts[a.a].z + projectedVerts[a.b].z) / 2;
      var zb = (projectedVerts[b.a].z + projectedVerts[b.b].z) / 2;
      return za - zb;
    });

    // Draw 3D wireframe edges
    sortedEdges.forEach(function (e) {
      var a = projectedVerts[e.a], b = projectedVerts[e.b];
      var na = nodeTypes[e.a], nb = nodeTypes[e.b];
      var la = nodeLoad(na.kind, e.a, cpuLoad, t);
      var lb = nodeLoad(nb.kind, e.b, cpuLoad, t);
      var edgeLoad = (la + lb) / 2;
      var depthAlpha = Math.max(0.12, Math.min(0.85, 0.25 + ((a.z + b.z) / 2 + 1) * 0.35 + edgeLoad * 0.25));

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = "rgba(34, 211, 166, " + depthAlpha.toFixed(2) + ")";
      ctx.lineWidth = 0.9 + edgeLoad * 1.5;
      ctx.stroke();
    });

    // Draw semantic vertex nodes (CPU cores, RAM, Storage, Network, System)
    projectedVerts.forEach(function (v, i) {
      var nt = nodeTypes[i];
      var load = nodeLoad(nt.kind, i, cpuLoad, t);
      var baseColor = (nt.kind === "core") ? loadColor(load) : (nt.color ? nt.color.replace(")", ",") : "rgba(56,189,248,");
      if (baseColor.indexOf("rgba") === -1 && baseColor.indexOf("#") === 0) {
        // Hex to rgba
        baseColor = "rgba(56,189,248,";
        if (nt.kind === "ram") baseColor = "rgba(168,85,247,";
        if (nt.kind === "sto") baseColor = "rgba(245,158,11,";
        if (nt.kind === "net") baseColor = "rgba(56,189,248,";
        if (nt.kind === "sys") baseColor = "rgba(34,211,166,";
      }
      var nodeRadius = (nt.kind === "core") ? (3 + load * 3.5) : (4 + load * 3);

      ctx.beginPath();
      ctx.arc(v.x, v.y, nodeRadius, 0, Math.PI * 2);
      ctx.fillStyle = baseColor + (0.6 + load * 0.4).toFixed(2) + ")";
      ctx.shadowBlur = 12;
      ctx.shadowColor = nt.color;
      ctx.fill();
      ctx.shadowBlur = 0;

      // 3D Projected Labels
      if (isStandalone || nt.kind !== "idle") {
        ctx.fillStyle = "#cbd5e1";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        var labelTxt = nt.label + (nt.kind === "core" ? " " + Math.round(load * 100) + "%" : "");
        ctx.fillText(labelTxt, v.x, v.y - nodeRadius - 5);
      }
    });

    // 5. Real-Time Synchronization Beams & Orbiting Client Nodes
    var effectiveClients = clients.length > 0 ? clients : [{ ip: "192.168.0.x (LAN MESH)", protocol: "WebSocket", userAgent: "Local Peer" }];
    orbitNodes.forEach(function (n, i) {
      var c = effectiveClients[i] || {};
      var orbitRad = R * n.r;
      var x = cx + Math.cos(n.phase) * orbitRad;
      var y = cy + Math.sin(n.phase) * orbitRad * 0.45;
      n.phase += n.speed * 0.008;

      // Radiant Synchronization Laser Beam between Host Center and Client Node
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Traveling Photon Data Packets (High-Frequency Real-Time Sync)
      for (var k = 0; k < n.photons.length; k++) {
        n.photons[k] = (n.photons[k] + 0.012) % 1;
        var pProgress = n.photons[k];
        var px = cx + (x - cx) * pProgress;
        var py = cy + (y - cy) * pProgress;

        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "#22d3a6";
        ctx.shadowBlur = 8;
        ctx.shadowColor = "#22d3a6";
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Client Node Circle
      var nodeCol = c.protocol === "WebSocket" ? "#22d3a6" : "#38bdf8";
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = nodeCol;
      ctx.shadowBlur = 18;
      ctx.shadowColor = nodeCol;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Concentric Sync Ripple Wave
      var waveRadius = 8 + ((t * 0.02 + i * 15) % 16);
      var waveAlpha = 1 - (waveRadius - 8) / 16;
      ctx.beginPath();
      ctx.arc(x, y, waveRadius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(34, 211, 166, " + waveAlpha.toFixed(2) + ")";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Client Tag / IP Label
      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      var displayIp = c.ip || "Client";
      ctx.fillText(displayIp, x, y - 11);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "9px sans-serif";
      ctx.fillText("● SYNCED", x, y + 16);
    });

    // 6. Particle Cloud update & draw
    updateParticles();
    particles.forEach(function (p) {
      var px = cx + Math.cos(p.a) * R * 0.95;
      var py = cy + Math.sin(p.b) * R * 0.95;
      ctx.beginPath();
      ctx.arc(px, py, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color + (1 - p.age / p.life).toFixed(2) + ")";
      ctx.fill();
    });

    if (!reduced) requestAnimationFrame(render);
  }

  // ---- Telemetry Updates & HUD Population ----
  var streamLines = [
    { ts: "00:03", tag: "MESH", data: "Subnet bridge active on 192.168.0.x" },
    { ts: "00:02", tag: "SYNC", data: "WebSocket bidirectional channel connected" },
    { ts: "00:01", tag: "HOST", data: "Hardware kernel telemetry online" }
  ];

  function pushStreamEvent(tag, data) {
    var now = new Date();
    var ts = String(now.getMinutes()).padStart(2, "0") + ":" + String(now.getSeconds()).padStart(2, "0");
    streamLines.unshift({ ts: ts, tag: tag, data: data });
    if (streamLines.length > 8) streamLines.pop();
    var feed = document.getElementById("hud-stream-feed");
    if (!feed) return;
    feed.innerHTML = streamLines.map(function (item) {
      return '<div class="stream-line"><span class="ts">[' + item.ts + ']</span> <span class="tag">[' + item.tag + ']</span> <span class="data">' + item.data + '</span></div>';
    }).join("");
  }

  function updateHud() {
    if (!isStandalone) {
      // Embedded info strip
      var el = document.getElementById("core-info");
      if (el) {
        var ram = Math.round(((sys.memory.usedBytes || 0) / (sys.memory.totalBytes || 1)) * 100);
        el.textContent = "Clients: " + clients.length + " · CPU: " + Math.round(sys.cpu.usagePercent || 0) + "% · RAM: " + ram + "% · " + (sys.network.type || "Wi-Fi");
      }
      return;
    }

    // Standalone Full HUD cards
    var devName = sys.device.model || "Phone (2a)";
    var hostIp = (sys.network.ipAddress || "192.168.0.101") + ":8080";
    var bat = sys.battery || {};
    var mem = sys.memory || {};
    var sto = sys.storage || {};
    var cpu = sys.cpu || {};

    var elDev = document.getElementById("hud-device-name"); if (elDev) elDev.textContent = devName;
    var elIp = document.getElementById("hud-host-ip"); if (elIp) elIp.textContent = hostIp;
    var elSyncIp = document.getElementById("sync-ip-txt"); if (elSyncIp) elSyncIp.textContent = "Host: " + hostIp + " · Full-Duplex Mesh";

    var batTxt = (bat.level != null ? bat.level : 85) + "% " + (bat.isCharging ? "⚡ Charging" : "🔋 Discharging");
    var elBat = document.getElementById("hud-battery-txt"); if (elBat) elBat.textContent = batTxt;
    var elBatBar = document.getElementById("hud-battery-bar"); if (elBatBar) elBatBar.style.width = (bat.level || 85) + "%";

    var tempTxt = (bat.temperature != null ? bat.temperature.toFixed(1) : "31.4") + "°C · " + (bat.health || "Optimal");
    var elTemp = document.getElementById("hud-temp-txt"); if (elTemp) elTemp.textContent = tempTxt;

    var stoFree = fmtBytes(sto.availableBytes || 114000000000);
    var elSto = document.getElementById("hud-storage-txt"); if (elSto) elSto.textContent = stoFree + " Free";
    var stoPct = Math.round(((sto.usedBytes || 1) / (sto.totalBytes || 1)) * 100);
    var elStoBar = document.getElementById("hud-storage-bar"); if (elStoBar) elStoBar.style.width = stoPct + "%";

    var cpuPct = (cpu.usagePercent != null ? cpu.usagePercent.toFixed(1) : "14.2") + "%";
    var elCpu = document.getElementById("hud-cpu-txt"); if (elCpu) elCpu.textContent = cpuPct;
    var elCpuBar = document.getElementById("hud-cpu-bar"); if (elCpuBar) elCpuBar.style.width = Math.min(100, Math.round(cpu.usagePercent || 14)) + "%";

    // 8 Cores grid
    var baseVal = (cpu.usagePercent || 14);
    for (var i = 0; i < 8; i++) {
      var cp = document.getElementById("cp-" + i);
      if (cp) {
        var wob = Math.round(baseVal * 0.8 + ((i * 17 + Date.now() * 0.002) % 15));
        cp.textContent = wob + "%";
      }
    }

    var ramUsed = fmtBytes(mem.usedBytes || 5583457280);
    var ramTot = fmtBytes(mem.totalBytes || 8589934592);
    var ramPct = Math.round(((mem.usedBytes || 1) / (mem.totalBytes || 1)) * 100);
    var elRam = document.getElementById("hud-ram-txt"); if (elRam) elRam.textContent = ramUsed + " / " + ramTot + " (" + ramPct + "%)";
    var elRamBar = document.getElementById("hud-ram-bar"); if (elRamBar) elRamBar.style.width = ramPct + "%";

    // Connected clients list
    var countBadge = document.getElementById("hud-nodes-count");
    if (countBadge) countBadge.textContent = "1 HOST + " + clients.length + " PEER" + (clients.length === 1 ? "" : "S");
    var listEl = document.getElementById("hud-clients-list");
    if (listEl) {
      if (clients.length === 0) {
        listEl.innerHTML = '<div class="client-item" style="color:var(--muted)"><span>🛰️</span> 192.168.0.x Subnet Listening</div>';
      } else {
        listEl.innerHTML = clients.map(function (c) {
          return '<div class="client-item">' +
            '<div class="client-item-ip"><span>🖥️</span> ' + (c.ip || "Client") + '</div>' +
            '<div class="client-item-proto">LIVE SYNCED</div>' +
          '</div>';
        }).join("");
      }
    }
  }

  var lastClientCount = -1;
  function onData() {
    if (lastClientCount >= 0 && clients.length > lastClientCount) {
      var nu = clients[clients.length - 1];
      pushStreamEvent("SYNC", "Client joined mesh: " + (nu.ip || "peer"));
    } else if (lastClientCount >= 0 && clients.length < lastClientCount) {
      pushStreamEvent("MESH", "Client disconnected from mesh");
    }
    lastClientCount = clients.length;
    syncOrbits();
    updateHud();
  }

  function poll() {
    api("/api/dashboard").then(function (d) {
      if (d) {
        sys = d.system || sys;
        clients = d.clients || [];
        onData();
      }
    }).catch(function () {});
  }
  poll();
  setInterval(poll, 3500);

  // ---- Interaction Controls ----
  if (cv === document.getElementById("core")) {
    cv.addEventListener("pointerdown", function (e) {
      drag = { x: e.clientX, y: e.clientY };
      autoSpin = 0;
    });
    window.addEventListener("pointermove", function (e) {
      if (!drag) return;
      rotationY += (e.clientX - drag.x) * 0.005;
      rotationX = Math.max(-1.4, Math.min(1.4, rotationX + (e.clientY - drag.y) * 0.005));
      drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener("pointerup", function () {
      drag = null;
      var btn = document.getElementById("btn-spin-toggle");
      if (btn && btn.classList.contains("active")) {
        setTimeout(function () { autoSpin = 1; }, 2500);
      }
    });
    cv.addEventListener("wheel", function (e) {
      e.preventDefault();
      zoom = Math.max(0.5, Math.min(2.4, zoom - e.deltaY * 0.001));
    }, { passive: false });

    // Fullscreen button
    var fsb = document.getElementById("fs-btn");
    if (fsb) {
      fsb.addEventListener("click", function () {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
      });
    }

    // Reset View button
    var resetBtn = document.getElementById("btn-reset-view");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        rotationX = -0.32;
        rotationY = 0;
        zoom = 1;
        autoSpin = 1;
      });
    }

    // Auto-spin toggle
    var spinBtn = document.getElementById("btn-spin-toggle");
    if (spinBtn) {
      spinBtn.addEventListener("click", function () {
        autoSpin = autoSpin ? 0 : 1;
        spinBtn.classList.toggle("active", !!autoSpin);
        spinBtn.textContent = "⟳ Auto-Rotate: " + (autoSpin ? "ON" : "OFF");
      });
    }

    // Cyber grid toggle
    var gridBtn = document.getElementById("btn-grid-toggle");
    if (gridBtn) {
      gridBtn.addEventListener("click", function () {
        showGrid = showGrid ? 0 : 1;
        gridBtn.classList.toggle("active", !!showGrid);
        gridBtn.textContent = "▦ Cyber Grid: " + (showGrid ? "ON" : "OFF");
      });
    }
  }

  syncOrbits();
  updateHud();
  if (reduced) {
    api("/api/dashboard").then(function (d) {
      if (d) {
        sys = d.system || sys;
        clients = d.clients || [];
        onData();
        render();
      }
    });
  } else {
    render();
  }
})();
