/* os/os.js - LocalHub OS shell orchestrator.
 * Wires the five flagship features: Universal Search, Activity Timeline,
 * Dynamic Home, Visual Automation Builder, and Spaces. Also injects the
 * global Universal Search overlay (triggerable with "/" or the top search).
 */
(function (global) {
  "use strict";
  global.LH_OS = global.LH_OS || {};
  var Store = global.LH_OS.Store;
  var Timeline = global.LH_OS.Timeline;
  var Search = global.LH_OS.Search;
  var Home = global.LH_OS.Home;
  var Spaces = global.LH_OS.Spaces;
  var AutoBuilder = global.LH_OS.AutoBuilder;

  function $(id) { return global.document.getElementById(id); }
  function fmt(b) { b = b || 0; var u = ["B", "KB", "MB", "GB", "TB"], i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return (b / Math.pow(1024, i)).toFixed(1) + " " + u[i]; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // ---- auth / role ----
  var authToken = null, role = "user";
  try { var q = new URLSearchParams(global.location.search); authToken = q.get("token") || sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken"); } catch (e) {}
  function authFetch(url, opts) { opts = opts || {}; opts.headers = opts.headers || {}; if (authToken) opts.headers["Authorization"] = "Bearer " + authToken; return fetch(url, opts); }
  function resolveRole() {
    if (!authToken) { global.location.href = "/login.html"; return; }
    authFetch("/api/auth/session").then(function (r) { return r.json(); }).then(function (res) {
      role = (res && res.authenticated && res.role) || "user";
      var badge = $("os-role"); if (badge) badge.textContent = role === "admin" ? "Administrator" : "Web User";
    }).catch(function () {});
  }

  // ---- view switching ----
  function switchView(name) {
    document.querySelectorAll(".os-view").forEach(function (v) { v.style.display = v.getAttribute("data-view") === name ? "block" : "none"; });
    document.querySelectorAll(".os-tab").forEach(function (t) { t.classList.toggle("active", t.getAttribute("data-view") === name); });
    if (name === "home") Home.widgets($("os-home-widgets"), Spaces.active());
    if (name === "spaces") Spaces.renderPicker();
    if (name === "timeline") renderTimeline();
    if (name === "automation") AutoBuilder.render();
    if (name === "search") $("os-search-input").focus();
    if (name === "security") refreshTotpState();
  }

  // ---- timeline render wrapper ----
  function renderTimeline(opts) {
    opts = opts || {};
    var q = $("os-tl-search") ? $("os-tl-search").value : "";
    var f = $("os-tl-filter") ? $("os-tl-filter").value : "all";
    Timeline.render($("os-timeline"), { q: q, filter: f, bookmarkOnly: opts.bookmarkOnly });
  }

  // ---- universal search overlay ----
  var ovInput, ovResults, activeIdx = -1, ovGroups = [];
  function openOverlay() { ovInput = $("os-search-ov"); ovResults = $("os-search-ov-results"); $("os-search-overlay").classList.add("open"); activeIdx = -1; if (ovInput) { ovInput.value = ""; ovResults.innerHTML = ""; setTimeout(function(){ ovInput.focus(); }, 50); } }
  function closeOverlay() { $("os-search-overlay").classList.remove("open"); }
  function runOverlay(q) {
    q = (q || "").trim();
    if (!q) { ovResults.innerHTML = '<div class="os-empty">Type to search everything…</div>'; return; }
    Search.run(q).then(function (groups) {
      ovGroups = groups; activeIdx = -1;
      var html = "";
      var flat = [];
      groups.forEach(function (g) { g.items.forEach(function (it) { it._g = g.group; flat.push(it); }); });
      var idx = 0;
      groups.forEach(function (g) {
        html += '<div class="os-search-group"><div class="os-sg-title">' + esc(g.group) + "</div>";
        g.items.forEach(function (it) {
          html += '<div class="os-sr" data-i="' + idx + '"><span class="os-sr-ic">' + (it.icon || "🔍") + "</span>" +
            '<div class="os-sr-body"><div class="os-sr-lb">' + Search.highlight(it.label, q) + "</div>" +
            '<div class="os-sr-sub">' + Search.highlight(it.sub || "", q) + "</div></div></div>";
          idx++;
        });
        html += "</div>";
      });
      ovResults.innerHTML = html || '<div class="os-empty">No results.</div>';
      ovResults.querySelectorAll(".os-sr").forEach(function (el) {
        el.onclick = function () { Search.openResult(flat[parseInt(el.getAttribute("data-i"), 10)]); };
        el.onmousemove = function () { setActive(parseInt(el.getAttribute("data-i"), 10)); };
      });
    });
  }
  function setActive(i) {
    activeIdx = i;
    ovResults.querySelectorAll(".os-sr").forEach(function (el) { el.classList.toggle("active", parseInt(el.getAttribute("data-i"), 10) === i); });
    var el = ovResults.querySelector('.os-sr[data-i="' + i + '"]');
    if (el) el.scrollIntoView({ block: "nearest" });
  }
  function flatIndex() { var n = 0; ovGroups.forEach(function (g) { n += g.items.length; }); return n; }
  function flatItem(i) { var n = 0; for (var g = 0; g < ovGroups.length; g++) { for (var it = 0; it < ovGroups[g].items.length; it++) { if (n === i) return ovGroups[g].items[it]; n++; } } return null; }

  function wireSearchOverlay() {
    ovInput = $("os-search-ov");
    ovResults = $("os-search-ov-results");
    $("os-search-overlay").addEventListener("click", function (e) { if (e.target === this) closeOverlay(); });
    ovInput.addEventListener("input", function () { runOverlay(ovInput.value); });
    ovInput.addEventListener("keydown", function (e) {
      var total = flatIndex();
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(total - 1, activeIdx + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(0, activeIdx - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); if (activeIdx >= 0) Search.openResult(flatItem(activeIdx)); else if (ovInput.value.trim()) { Search.openResult({ action: { type: "search", q: ovInput.value.trim() } }); } }
      else if (e.key === "Escape") { closeOverlay(); }
    });
    global.document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && $("os-search-overlay").classList.contains("open")) closeOverlay();
    });
  }

  // ---- top search opens overlay ----
  function wireTopSearch() {
    var top = $("os-top-search");
    top.addEventListener("focus", function () { openOverlay(); setTimeout(function () { ovInput.value = top.value; runOverlay(top.value); }, 60); });
    // "/" key opens search from anywhere on this page
    global.document.addEventListener("keydown", function (e) {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && document.activeElement && document.activeElement.tagName !== "INPUT") { e.preventDefault(); openOverlay(); }
    });
  }

  // ---- spaces page ----
  function wireSpaces() {
    $("os-space-add").onclick = function () { Spaces.openEditor({ name: "", icon: "🪐", theme: "dark", quick: [] }); };
    $("os-space-edit").onclick = function () { Spaces.openEditor(Spaces.active()); };
    $("os-space-export").onclick = Spaces.exportSpaces;
    $("os-editor-cancel").onclick = Spaces.closeEditor;
  }

  // ---- timeline page ----
  function wireTimeline() {
    $("os-tl-search").addEventListener("input", function () { renderTimeline(); });
    $("os-tl-filter").addEventListener("change", function () { renderTimeline(); });
    var bm = false;
    $("os-tl-bookmarks").onclick = function () { bm = !bm; renderTimeline({ bookmarkOnly: bm }); this.textContent = bm ? "☆ All" : "★ Bookmarks"; };
    $("os-tl-export").onclick = function () { Timeline.download("localhub-timeline.txt", Timeline.exportText()); };
    $("os-tl-clear").onclick = function () { if (confirm("Clear the entire activity timeline?")) { Store.clearTimeline(); renderTimeline(); } };
  }

  // ---- automation builder page ----
  function wireAutomation() {
    AutoBuilder.init();
  }

  // ---- home page ----
  function wireHome() {
    Home.widgets($("os-home-widgets"), Spaces.active());
  }

  // ---- global activity recorder (server + client events) ----
  function startRecording() {
    // record server status on load
    authFetch("/api/status").then(function (r) { return r.json(); }).then(function (st) {
      if (st && st.running) Timeline.push("server started", "LocalHub server running on port " + (st.port || ""));
    }).catch(function () {});
    // hook assistant commands if present
    var origRecord = global.LH_AI && global.LH_AI.Context && global.LH_AI.Context.recordCommand;
    if (origRecord) {
      global.LH_AI.Context.recordCommand = function (text) {
        Timeline.push("assistant command", text);
        origRecord(text);
      };
    }
    // poll clients to record connects/disconnects
    setInterval(function () {
      authFetch("/api/clients").then(function (r) { return r.json(); }).then(function (res) {
        var list = (res && res.clients) || [];
        if (list.length) {
          var known = Store.read ? null : null;
        }
      }).catch(function () {});
    }, 15000);
  }

  // ---- Security & Backup view ----
  function wireSecurity() {
    // TOTP state
    refreshTotpState();
    $("os-totp-enroll").onclick = function () {
      authFetch("/api/auth/totp-enroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then(function (r) { return r.json(); }).then(function (res) {
          if (res && res.secret) {
            $("os-totp-qr").style.display = "block";
            // Show the secret as a QR via the existing /api/qr endpoint.
            var label = "otpauth://totp/LocalHub:admin?secret=" + res.secret + "&issuer=LocalHub";
            $("os-totp-qr-img").innerHTML = '<img src="/api/qr?text=' + encodeURIComponent(label) + '" width="180" height="180" style="background:#fff;border-radius:8px;padding:6px" />';
            $("os-totp-state").textContent = "Enrolled — enter the code below to enable.";
          }
        });
    };
    $("os-totp-verify").onclick = function () {
      var code = $("os-totp-code").value.trim();
      authFetch("/api/auth/totp-verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code }) })
        .then(function (r) { return r.json(); }).then(function (res) {
          if (res && res.ok) { $("os-totp-qr").style.display = "none"; refreshTotpState(); toastSec("2FA enabled ✔"); }
          else { toastSec((res && res.error) || "Invalid code"); }
        });
    };

    // LAN shares
    $("os-share-create").onclick = function () {
      var path = $("os-share-path").value.trim();
      if (!path) return;
      authFetch("/api/share/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: path }) })
        .then(function (r) { return r.json(); }).then(function (res) {
          if (res && res.ok) { renderShares(); toastSec("Share created"); }
          else { toastSec((res && res.error) || "Share failed"); }
        });
    };
    renderShares();

    // Storage cleanup
    $("os-clean-scan").onclick = function () {
      var path = $("os-clean-path").value.trim() || "/storage/emulated/0";
      var catEl = $("os-clean-cats"), dupEl = $("os-clean-dups");
      catEl.innerHTML = '<div class="hint">Scanning…</div>'; dupEl.innerHTML = "";
      authFetch("/api/fs/categories?path=" + encodeURIComponent(path)).then(function (r) { return r.json(); }).then(function (res) {
        if (res && res.ok && res.categories) {
          var cats = res.categories, counts = res.counts || {};
          var names = { video: "🎬 Video", audio: "🎵 Audio", image: "🖼 Image", document: "📄 Document", archive: "🗜 Archive", binary: "📦 Other" };
          var rows = Object.keys(cats).map(function (k) {
            return '<div class="row"><div class="row-main"><b>' + (names[k] || k) + '</b>' +
              '<span class="sub">' + (counts[k] || 0) + ' files</span></div>' + fmt(cats[k]) + "</div>";
          }).join("");
          catEl.innerHTML = rows || '<div class="hint">No files found.</div>';
        }
      }).catch(function () { catEl.innerHTML = '<div class="hint">Scan failed.</div>'; });
      authFetch("/api/fs/duplicates?path=" + encodeURIComponent(path)).then(function (r) { return r.json(); }).then(function (res) {
        var groups = (res && res.groups) || [];
        if (!groups.length) { dupEl.innerHTML = '<div class="hint">No duplicates found (size+name heuristic).</div>'; return; }
        dupEl.innerHTML = "<h4 style='margin:10px 0 4px'>Possible duplicates</h4>" + groups.slice(0, 6).map(function (g) {
          return '<div class="row"><div class="row-main"><b>' + esc(g[0].name) + '</b>' +
            '<span class="sub">' + g.length + ' copies · ' + g.map(function (x) { return x.path; }).join(", ") + "</span></div></div>";
        }).join("");
      }).catch(function () {});
    };

    // Backup
    $("os-backup-download").onclick = function () { Store.downloadBackup(); toastSec("Backup downloaded"); };
    $("os-backup-file").onchange = function () {
      var f = $("os-backup-file").files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var res = Store.importBackup(JSON.parse(reader.result));
        $("os-backup-status").textContent = (res && res.ok) ? "✓ " + res.message : (res && res.error);
        if (res && res.ok) toastSec("Backup restored");
      };
      reader.readAsText(f);
    };
  }

  function refreshTotpState() {
    authFetch("/api/auth/totp-status").then(function (r) { return r.json(); }).then(function (res) {
      var el = $("os-totp-state");
      if (el) el.textContent = res && res.enabled ? "Enabled" : "Disabled";
    }).catch(function () {});
  }

  function renderShares() {
    var box = $("os-share-list"); if (!box) return;
    authFetch("/api/share/list").then(function (r) { return r.json(); }).then(function (res) {
      var shares = (res && res.shares) || [];
      if (!shares.length) { box.innerHTML = '<div class="hint">No active shares.</div>'; return; }
      box.innerHTML = shares.map(function (s) {
        return '<div class="row"><div class="row-main"><b>' + esc(s.path) + '</b>' +
          '<span class="sub">' + s.url + " · expires " + new Date(s.expiresAt).toLocaleTimeString() + "</span></div>" +
          '<button class="chip danger" data-token="' + esc(s.token) + '">Revoke</button></div>';
      }).join("");
      box.querySelectorAll("[data-token]").forEach(function (b) {
        b.onclick = function () {
          authFetch("/api/share/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: b.getAttribute("data-token") }) })
            .then(function () { renderShares(); });
        };
      });
    }).catch(function () {});
  }

  function toastSec(msg) {
    var t = global.document.getElementById("os-toast");
    if (!t) { t = global.document.createElement("div"); t.id = "os-toast"; t.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0f1a2e;border:1px solid var(--border);color:#fff;border-radius:8px;padding:9px 16px;z-index:999;font-size:13px"; global.document.body.appendChild(t); }
    t.textContent = msg; t.style.display = "block";
    clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = "none"; }, 2600);
  }

  function boot() {
    resolveRole();
    wireSearchOverlay();
    wireTopSearch();
    wireSpaces();
    wireTimeline();
    wireAutomation();
    wireSecurity();
    wireHome();
    startRecording();
    // nav wiring
    document.querySelectorAll(".os-tab").forEach(function (t) {
      t.onclick = function () { switchView(t.getAttribute("data-view")); };
    });
    // hash routing (#home, #spaces, #timeline, #automation, #search, #security)
    var initial = (global.location.hash || "").replace("#", "") || "home";
    switchView(["home", "spaces", "timeline", "automation", "search", "security"].indexOf(initial) >= 0 ? initial : "home");
    if (global.LH_AI && global.LH_AI.Anim) { global.LH_AI.Anim.attachRipples(); }
  }

  global.LH_OS.boot = boot;
  global.LH_OS.switchView = switchView;
  global.LH_OS.openSearch = openOverlay;
  global.LH_OS.closeSearch = closeOverlay;
})(window);

// boot
if (window.LH_OS && window.LH_OS.boot) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { window.LH_OS.boot(); });
  else window.LH_OS.boot();
}
