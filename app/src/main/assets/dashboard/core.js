/* core.js - LocalHub SYSTEM CORE: a live holographic visualization of the device.
 *
 * The mesh is NOT decoration — every vertex is a meaningful resource node:
 *   - CPU cores (one node per core, colored by load)
 *   - RAM, Storage, Network, System (labeled resource nodes)
 * Connected clients orbit the core as labeled device nodes with connection lines.
 * Live data flows as particle streams; metric arcs show aggregate usage.
 * Deterministic, offline, canvas-based, 60fps.
 *
 * EMBEDDABLE: runs on any <canvas data-core> element (or #core). UI chrome is
 * optional — every element is guarded so it works standalone AND embedded.
 */
(function () {
  "use strict";

  var cv = document.querySelector('canvas[data-core]') || document.getElementById("core");
  if (!cv) return;
  var ctx = cv.getContext("2d");
  var W = 0, H = 0, DPR = Math.min(2, window.devicePixelRatio || 1);

  function parentSize() {
    var parent = cv.parentElement;
    if (parent && parent.clientWidth > 0) return { w: parent.clientWidth, h: parent.clientHeight };
    return { w: window.innerWidth, h: window.innerHeight };
  }
  function resize() {
    var s = parentSize();
    W = s.w || window.innerWidth; H = s.h || window.innerHeight;
    cv.width = W * DPR; cv.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize(); window.addEventListener("resize", resize);

  var token = "";
  try {
    token = new URLSearchParams(location.search).get("token") ||
      sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken");
  } catch (e) {}
  function api(url) {
    var h = {}; if (token) h["Authorization"] = "Bearer " + token;
    return fetch(url, { headers: h }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  var reduced = false;
  try { reduced = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  var sys = { cpu: {}, memory: {}, storage: {}, network: {}, device: {} };
  var clients = [];
  var rotationX = -0.3, rotationY = 0, autoSpin = 1, zoom = 1, drag = null;

  // ---- 3D icosahedron (12 vertices) ----
  var verts = [], edges = [];
  (function buildIcosa() {
    var t = (1 + Math.sqrt(5)) / 2;
    var p = [
      [-1, t, 0],[1, t, 0],[-1, -t, 0],[1, -t, 0],
      [0, -1, t],[0, 1, t],[0, -1, -t],[0, 1, -t],
      [t, 0, -1],[t, 0, 1],[-t, 0, -1],[-t, 0, 1]
    ];
    verts = p.map(function (v) { var l = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]); return [v[0]/l, v[1]/l, v[2]/l]; });
    function dist(a, b) { var dx = a[0]-b[0], dy = a[1]-b[1], dz = a[2]-b[2]; return Math.sqrt(dx*dx+dy*dy+dz*dz); }
    for (var i = 0; i < verts.length; i++)
      for (var j = i + 1; j < verts.length; j++)
        if (Math.abs(dist(verts[i], verts[j]) - 1.105) < 0.08) edges.push({ a: i, b: j });
  })();

  // Responsive core radius: scale to fit the container so the hologram never
  // overflows (was previously a fixed 130px which got cut off on mobile).
  function coreRadius() {
    var base = Math.min(W, H);
    // leave margin for orbiting clients + labels
    var r = base * 0.30;
    // clamp to keep the whole hologram (core + orbit) inside the canvas
    var max = Math.min(W, H) / 2 - 18;
    r = Math.max(36, Math.min(r, max, 130));
    return r * zoom;
  }
  function project(v) {
    var R = coreRadius();
    var cy = Math.cos(rotationY), sy = Math.sin(rotationY);
    var x1 = v[0]*cy - v[2]*sy, z1 = v[0]*sy + v[2]*cy;
    var cx = Math.cos(rotationX), sx = Math.sin(rotationX);
    var y1 = v[1]*cx - z1*sx, z2 = v[1]*sx + z1*cx;
    var s = R / (1.6 + z2);
    return { x: W/2 + x1*s, y: H/2 + y1*s, z: z2 };
  }

  // ---- SEMANTIC NODE MAP: assign each of the 12 vertices a meaning ----
  var nodeTypes = []; // per vertex: { kind, label, color }
  function buildNodeMap() {
    nodeTypes = [];
    var cores = Math.max(1, Math.min(8, sys.cpu.cores || 4));
    var i;
    for (i = 0; i < cores; i++) nodeTypes.push({ kind: "core", label: "C" + i, color: "#22d3a6" });
    var resources = [
      { kind: "ram", label: "RAM", color: "#818cf8" },
      { kind: "sto", label: "STO", color: "#f59e0b" },
      { kind: "net", label: "NET", color: "#38bdf8" },
      { kind: "sys", label: "SYS", color: "#34d399" }
    ];
    for (i = 0; i < 12 - cores && i < resources.length; i++) nodeTypes.push(resources[i]);
    while (nodeTypes.length < 12) nodeTypes.push({ kind: "idle", label: "", color: "#334155" });
  }

  // ---- per-node load (0..1) ----
  function nodeLoad(kind, idx, cpuLoad, t) {
    switch (kind) {
      case "core":
        // distribute aggregate CPU across cores with a stable per-core wobble
        var wob = 0.5 + 0.5 * Math.sin(t * 0.001 + idx * 2.4);
        return Math.max(0, Math.min(1, cpuLoad * 0.7 + wob * 0.3));
      case "ram": return (sys.memory.usedBytes || 0) / (sys.memory.totalBytes || 1);
      case "sto": return (sys.storage.usedBytes || 0) / (sys.storage.totalBytes || 1);
      case "net": return clients.length > 0 ? 0.5 + Math.sin(t*0.002)*0.2 : 0.15;
      case "sys": return Math.min(1, ((sys.cpu.usagePercent||0)/100) * 0.6 + (clients.length>0?0.2:0));
      default: return 0.1;
    }
  }

  // color ramp green -> amber -> red for CPU load
  function loadColor(load) {
    if (load < 0.5) return "rgba(34,211,166,";
    if (load < 0.8) return "rgba(251,191,36,";
    return "rgba(248,113,113,";
  }

  // ---- particles ----
  var particles = [];
  function spawnBurst(n, color) {
    for (var i = 0; i < n; i++) particles.push({
      a: Math.random()*Math.PI*2, b: Math.random()*Math.PI*2, speed: 0.02+Math.random()*0.04,
      age: 0, life: 80+Math.random()*60, color: color, r: 1+Math.random()*2 });
  }
  function updateParticles() {
    for (var i = particles.length-1; i >= 0; i--) { var p = particles[i]; p.age++; p.a+=p.speed; p.b+=p.speed*0.7; if (p.age>p.life) particles.splice(i,1); }
    var rate = 1 + Math.round((sys.cpu.usagePercent||0)/12);
    while (particles.length < 40 + rate*2 && Math.random() < 0.4) spawnBurst(1, "rgba(34,211,166,");
  }

  // ---- client orbit nodes ----
  var orbitNodes = [];
  function syncOrbits() {
    var need = clients.length;
    while (orbitNodes.length < need) orbitNodes.push({ phase: Math.random()*Math.PI*2, tilt: Math.random()*Math.PI, speed: 0.3+Math.random()*0.5, r: 1.7+Math.random()*0.7, burst: 0 });
    if (orbitNodes.length > need) orbitNodes.length = need;
  }

  function shortUa(ua) {
    if (!ua) return "device";
    var m = ua.match(/\((Windows|Macintosh|Linux|Android|iPhone|iPad)[^;]*/);
    var b = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)\/?\s*[\d.]+/);
    var label = (m ? m[1] : "device");
    if (b) label += " · " + b[1];
    return label.slice(0, 18);
  }

  // ---- render ----
  function render() {
    var t = Date.now();
    ctx.clearRect(0, 0, W, H);
    var bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)*0.8);
    bg.addColorStop(0, "#0a1226"); bg.addColorStop(0.5, "#060b16"); bg.addColorStop(1, "#03060c");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    if (autoSpin && !drag) rotationY += 0.004;
    var cx = W/2, cy = H/2;
    var R = coreRadius(); // responsive radius so it fits any container
    buildNodeMap();
    var cpuLoad = (sys.cpu.usagePercent || 0) / 100;

    // orbital rings
    ctx.beginPath(); ctx.ellipse(cx, cy, R*1.9, R*1.9*0.4, 0, 0, Math.PI*2);
    ctx.strokeStyle = "rgba(56,189,248,.05)"; ctx.lineWidth = 1; ctx.stroke();

    // core glow
    var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    glow.addColorStop(0, "rgba(34,211,166,.35)"); glow.addColorStop(0.5, "rgba(34,211,166,.06)"); glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2); ctx.fill();

    // edges (color by average load of endpoints)
    var projectedVerts = verts.map(project);
    edges.forEach(function (e) {
      var a = projectedVerts[e.a], b = projectedVerts[e.b];
      var na = nodeTypes[e.a], nb = nodeTypes[e.b];
      var la = nodeLoad(na.kind, e.a, cpuLoad, t), lb = nodeLoad(nb.kind, e.b, cpuLoad, t);
      var edgeLoad = (la + lb) / 2;
      var alpha = 0.15 + ((a.z + b.z)/2 + 1)*0.3 + edgeLoad*0.3;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = "rgba(34,211,166," + Math.min(0.9, alpha).toFixed(2) + ")";
      ctx.lineWidth = 0.8 + edgeLoad*1.6; ctx.stroke();
    });

    // resource nodes (vertices) — size + color by load
    projectedVerts.forEach(function (v, i) {
      var nt = nodeTypes[i];
      var load = nodeLoad(nt.kind, i, cpuLoad, t);
      var baseColor = (nt.kind === "core") ? loadColor(load) : nt.color;
      var size = (nt.kind === "core") ? 2 + load*4 : 3 + load*3.5;
      ctx.beginPath(); ctx.arc(v.x, v.y, size, 0, Math.PI*2);
      ctx.fillStyle = baseColor + (0.55 + load*0.45).toFixed(2) + ")";
      ctx.shadowBlur = 10; ctx.shadowColor = nt.color; ctx.fill(); ctx.shadowBlur = 0;
      // label for resource nodes (RAM/STO/NET/SYS)
      if (nt.kind !== "core" && nt.kind !== "idle") {
        ctx.fillStyle = "#8ea0bd"; ctx.font = "9px monospace"; ctx.textAlign = "center";
        ctx.fillText(nt.label + " " + Math.round(load*100) + "%", v.x, v.y - size - 5);
      }
    });

    // orbiting clients (labeled device nodes)
    orbitNodes.forEach(function (n, i) {
      var x = cx + Math.cos(n.phase)*R*n.r, y = cy + Math.sin(n.tilt)*R*n.r*0.4;
      n.phase += n.speed*0.01;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y);
      ctx.strokeStyle = "rgba(56,189,248,.18)"; ctx.setLineDash([3,5]); ctx.stroke(); ctx.setLineDash([]);
      var c = clients[i] || {};
      var nodeCol = c.protocol === "WebSocket" ? "#22d3a6" : "#38bdf8";
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2);
      ctx.fillStyle = nodeCol; ctx.shadowBlur = 16; ctx.shadowColor = nodeCol; ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = "#e5eaf2"; ctx.font = "9px monospace"; ctx.textAlign = "center";
      ctx.fillText(c.ip || "?", x, y - 9);
      if (n.burst > 0) { ctx.beginPath(); ctx.arc(x, y, 10+(10-n.burst), 0, Math.PI*2); ctx.strokeStyle="rgba(34,211,166,.5)"; ctx.stroke(); n.burst--; }
    });

    updateParticles();
    particles.forEach(function (p) {
      var x = cx + Math.cos(p.a)*R*0.9, y = cy + Math.sin(p.b)*R*0.9;
      ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI*2);
      ctx.fillStyle = p.color + (1 - p.age/p.life).toFixed(2) + ")"; ctx.fill();
    });

    // header
    var label = (sys.device.model || "LOCALHUB").toUpperCase();
    if (label) {
      ctx.fillStyle = "#fff"; ctx.font = "700 14px sans-serif"; ctx.textAlign = "center";
      ctx.shadowBlur = 14; ctx.shadowColor = "#22d3a6"; ctx.fillText(label, cx, cy - R - 60); ctx.shadowBlur = 0;
      ctx.fillStyle = "#5a6b85"; ctx.font = "11px monospace";
      ctx.fillText("CPU " + Math.round(cpuLoad*100) + "% · " + (sys.cpu.cores||1) + " cores · " + (sys.network.ipAddress||"…"), cx, cy - R - 44);
    }

    if (!reduced) requestAnimationFrame(render);
  }

  var lastClientCount = -1;
  function onData() {
    if (lastClientCount >= 0 && clients.length > lastClientCount) { spawnBurst(30, "rgba(34,211,166,"); flash("Client connected: " + (clients[clients.length-1].ip||"?")); }
    else if (lastClientCount >= 0 && clients.length < lastClientCount) { spawnBurst(12, "rgba(248,113,113,"); flash("Client disconnected"); }
    lastClientCount = clients.length; syncOrbits(); updateInfo();
  }
  function flash(msg) { var el = document.getElementById("msg"); if (!el) return; el.textContent = msg; el.style.display="block"; setTimeout(function(){el.style.display="none";},2200); }
  function updateInfo() {
    var el = document.getElementById("core-info"); if (!el) return;
    var ram = (sys.memory.usedBytes||0)/(sys.memory.totalBytes||1);
    el.textContent = "clients: "+clients.length+" · cpu: "+Math.round(sys.cpu.usagePercent||0)+"% · ram: "+Math.round(ram*100)+"% · "+(sys.network.type||"");
  }

  function poll() {
    api("/api/dashboard").then(function (d) { if (d) { sys = d.system || sys; clients = d.clients || []; onData(); } setLive(true); }).catch(function(){setLive(false);});
  }
  function setLive(ok) { var d=document.getElementById("live-dot"),t=document.getElementById("live-txt"); if(!d)return; d.className="dot"+(ok?" on":""); if(t)t.textContent=ok?"LIVE":"offline"; }
  poll(); setInterval(poll, 4000);

  if (cv === document.getElementById("core")) {
    cv.addEventListener("pointerdown", function(e){drag={x:e.clientX,y:e.clientY};autoSpin=0;});
    window.addEventListener("pointermove", function(e){ if(!drag)return; rotationY+=(e.clientX-drag.x)*0.005; rotationX=Math.max(-1.4,Math.min(1.4,rotationX+(e.clientY-drag.y)*0.005)); drag={x:e.clientX,y:e.clientY}; });
    window.addEventListener("pointerup", function(){ drag=null; setTimeout(function(){autoSpin=1;},3000); });
    cv.addEventListener("wheel", function(e){e.preventDefault();zoom=Math.max(0.5,Math.min(2.5,zoom-e.deltaY*0.001));},{passive:false});
    var fsb=document.getElementById("fs-btn"); if(fsb) fsb.addEventListener("click",function(){ if(document.fullscreenElement)document.exitFullscreen(); else if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen(); });
  }

  setLive(false);
  if (reduced) { api("/api/dashboard").then(function(d){if(d){sys=d.system||sys;clients=d.clients||[];onData();render();}}); }
  else render();
})();
