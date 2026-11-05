/* sentinel.js - Sentinel administrative console.
 *
 * Renders /api/sentinel/report and drives approvals.
 *
 * The layout follows the report's own shape, deliberately:
 *   severity -> cause -> evidence chain -> what can be done about it
 * A console that lists red badges without the "why" is the monitoring tool
 * this replaced.
 */
(function () {
  "use strict";

  var token = null;
  try { token = sessionStorage.getItem("lhtoken") || localStorage.getItem("lhtoken"); } catch (e) {}

  function api(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (token) opts.headers["Authorization"] = "Bearer " + token;
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; });
    });
  }

  function post(path, params) {
    var body = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) { body.append(k, params[k]); });
    return api(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
  }

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function badge(sev) {
    var cls = "b-grey";
    if (sev === "CRITICAL") cls = "b-red";
    else if (sev === "HIGH") cls = "b-orange";
    else if (sev === "MEDIUM") cls = "b-yellow";
    else if (sev === "OK") cls = "b-green";
    return '<span class="badge ' + cls + '">' + esc(sev) + "</span>";
  }

  function riskBadge(risk) {
    if (risk === "SAFE") return '<span class="badge b-green">auto · safe</span>';
    if (risk === "CONFIRM") return '<span class="badge b-yellow">needs approval</span>';
    return '<span class="badge b-blue">you must do this</span>';
  }

  function timeAgo(ms) {
    var s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    return Math.round(s / 3600) + " h ago";
  }

  // ------------------------------------------------------------------ render

  function renderOverview(r) {
    var healthy = r.healthy;
    $("overview-card").innerHTML =
      '<h2 style="margin-bottom:14px">System state ' +
      (healthy ? '<span class="badge b-green">HEALTHY</span>'
               : '<span class="badge b-red">NEEDS ATTENTION</span>') + "</h2>" +
      '<div style="font-size:13.5px;color:#94a3b8;line-height:1.6">' +
      (healthy
        ? "No critical or high severity fault was found, and no high severity security threat is open."
        : r.diagnoses.length + " fault(s) and " + r.security.threats.length +
          " security finding(s) are open. The most severe is listed first.") +
      "<br>Measured " + esc(timeAgo(r.generatedAt)) + " · " + r.probes.length +
      " measurements in " + r.durationMs + " ms." +
      "</div>";
  }

  function renderSecurity(r) {
    var s = r.security;
    var colour = s.score >= 90 ? "#4ade80" : s.score >= 60 ? "#facc15" : "#f87171";
    var html =
      '<div style="display:flex;align-items:baseline;gap:14px;margin-bottom:14px">' +
      '<span class="score" style="color:' + colour + '">' + s.score + '</span>' +
      '<span style="color:#94a3b8;font-size:13px">/100 &nbsp;·&nbsp; grade <b style="color:' +
      colour + '">' + esc(s.grade) + "</b></span></div>";

    if (s.findings.length) {
      html += '<div style="font-size:12.5px;color:#94a3b8;margin-bottom:10px">' +
        s.findings.map(function (f) { return "• " + esc(f); }).join("<br>") + "</div>";
    }

    if (!s.threats.length) {
      html += '<div class="empty">No threats detected.</div>';
    } else {
      html += s.threats.map(function (t) {
        return renderThreat(t);
      }).join("");
    }
    $("security-body").innerHTML = html;
    wireActions($("security-body"));
  }

  function renderThreat(t) {
    return '<div class="fault ' + esc(t.severity) + '">' +
      '<div class="fault-head"><div>' +
      '<div class="fault-title">' + esc(t.kind.replace(/_/g, " ")) +
      (t.source ? ' <span style="color:#64748b;font-size:12px">· ' + esc(t.source) + "</span>" : "") +
      "</div></div>" + badge(t.severity) + "</div>" +
      '<div class="cause">' + esc(t.detail) + "</div>" +
      renderRemedies(t.remedies) +
      "</div>";
  }

  function renderRemedies(list) {
    if (!list || !list.length) return "";
    return '<div class="remedies">' + list.map(function (rm) {
      var btn = "";
      if (rm.risk === "CONFIRM") {
        btn = '<button type="button" class="danger" data-action="' + esc(rm.action) +
          '" data-args="' + esc(JSON.stringify(rm.args || {})) + '">Approve · ' +
          esc(rm.title) + "</button>";
      } else if (rm.risk === "SAFE") {
        btn = '<button type="button" data-action="' + esc(rm.action) +
          '" data-args="' + esc(JSON.stringify(rm.args || {})) + '">Run now · ' +
          esc(rm.title) + "</button>";
      }
      return '<div class="remedy"><div class="remedy-text">' +
        '<div class="remedy-title">' + esc(rm.title) + " " + riskBadge(rm.risk) + "</div>" +
        '<div class="remedy-detail">' + esc(rm.detail) + "</div>" +
        "</div><div>" + btn + "</div></div>";
    }).join("") + "</div>";
  }

  function renderFaults(r) {
    $("fault-count").textContent = r.diagnoses.length
      ? "(" + r.diagnoses.length + ")"
      : "";
    if (!r.diagnoses.length) {
      $("faults-body").innerHTML =
        '<div class="empty">Nothing to explain — every measurement came back clean.</div>';
      return;
    }
    $("faults-body").innerHTML = r.diagnoses.map(function (d) {
      var why = d.why && d.why.length
        ? '<div class="why"><div class="why-title">Why Sentinel concluded this</div><ol>' +
          d.why.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") +
          "</ol></div>"
        : "";
      return '<div class="fault ' + esc(d.severity) + '">' +
        '<div class="fault-head"><div class="fault-title">' + esc(d.title) + "</div>" +
        "<div>" + badge(d.severity) +
        '<span class="badge b-grey" style="margin-left:6px">' +
        Math.round(d.confidence * 100) + "% confidence</span></div></div>" +
        '<div class="cause"><b>Root cause:</b> ' + esc(d.cause) + "</div>" +
        why +
        renderRemedies(d.remedies) +
        "</div>";
    }).join("");
    wireActions($("faults-body"));
  }

  function renderApplied(r) {
    if (!r.autoApplied || !r.autoApplied.length) {
      $("applied-body").innerHTML =
        '<div class="empty">Nothing needed an automatic repair on this pass.</div>';
      return;
    }
    $("applied-body").innerHTML = r.autoApplied.map(function (a) {
      var mark = a.ok
        ? (a.verified
          ? '<span class="badge b-green">✓ fixed &amp; verified</span>'
          : '<span class="badge b-yellow">ran · still faulty</span>')
        : '<span class="badge b-red">✗ failed</span>';
      return '<div style="padding:9px 0;border-bottom:1px solid rgba(148,163,184,.1)">' +
        '<div style="font-size:13px;color:#e2e8f0">' + esc(a.remedyId) + " " + mark + "</div>" +
        '<div style="font-size:12.5px;color:#94a3b8;margin-top:3px">' + esc(a.message) + "</div>" +
        "</div>";
    }).join("");
  }

  function renderPending(r) {
    if (!r.pending || !r.pending.length) {
      $("pending-body").innerHTML =
        '<div class="empty">Nothing is waiting on you.</div>';
      return;
    }
    var seen = {};
    var html = r.pending.filter(function (p) {
      if (seen[p.action + JSON.stringify(p.args || {})]) return false;
      seen[p.action + JSON.stringify(p.args || {})] = true;
      return true;
    }).map(function (p) {
      return '<div class="remedy"><div class="remedy-text">' +
        '<div class="remedy-title">' + esc(p.title) + "</div>" +
        '<div class="remedy-detail">' + esc(p.detail) + "</div>" +
        '</div><div><button type="button" class="danger" data-action="' + esc(p.action) +
        '" data-args="' + esc(JSON.stringify(p.args || {})) + '">Approve</button></div></div>';
    }).join("");
    $("pending-body").innerHTML = html;
    wireActions($("pending-body"));
  }

  function renderProbes(r) {
    $("probes-body").innerHTML =
      '<table class="probes"><thead><tr><th>Measurement</th><th>Result</th><th>Severity</th><th>ms</th></tr></thead><tbody>' +
      r.probes.map(function (p) {
        return "<tr><td class=\"mono\">" + esc(p.id) + "</td><td>" +
          (p.ok ? '<span style="color:#4ade80">✓</span> ' : '<span style="color:#f87171">✗</span> ') +
          esc(p.summary) + "</td><td>" + badge(p.severity) + "</td><td class=\"mono\">" +
          esc(p.durationMs) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  // ------------------------------------------------------------------ actions

  function wireActions(root) {
    var btns = root.querySelectorAll("button[data-action]");
    Array.prototype.forEach.call(btns, function (btn) {
      btn.onclick = function () {
        var action = btn.getAttribute("data-action");
        var args = {};
        try { args = JSON.parse(btn.getAttribute("data-args") || "{}"); } catch (e) { args = {}; }
        var riskNeedsApproval = btn.classList.contains("danger");
        if (riskNeedsApproval && !window.confirm(
          "Approve this action?\n\n" + action + (args.ip ? " " + args.ip : "") +
          "\n\nIt will be applied on the phone and written to the audit log."
        )) return;
        btn.disabled = true;
        var label = btn.textContent;
        btn.textContent = "Working…";
        var payload = { action: action, approved: "true" };
        Object.keys(args).forEach(function (k) { payload[k] = args[k]; });
        post("/api/sentinel/act", payload).then(function (res) {
          btn.textContent = res.ok ? "Done ✓" : ("Failed: " + (res.message || res.error || ""));
          setTimeout(run, 900);
        });
        setTimeout(function () { btn.disabled = false; btn.textContent = label; }, 4000);
      };
    });
  }

  // -------------------------------------------------------------------- boot

  function run() {
    var btn = $("btn-run");
    if (btn) { btn.disabled = true; btn.textContent = "Measuring…"; }
    api("/api/sentinel/report").then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = "⟳ Run a pass"; }
      if (!res || !res.ok || !res.report) {
        $("main").style.display = "";
        $("gate").style.display = "none";
        $("overview-card").innerHTML =
          '<div class="empty">Sentinel is not available in this build (' +
          esc((res && res.error) || "unknown error") + ").</div>";
        return;
      }
      var r = res.report;
      renderOverview(r);
      renderSecurity(r);
      renderFaults(r);
      renderApplied(r);
      renderPending(r);
      renderProbes(r);
      var main = $("main");
      main.style.display = "";
      main.classList.remove("flash");
      void main.offsetWidth;
      main.classList.add("flash");
    });
  }

  function boot() {
    api("/api/auth/session").then(function (res) {
      var role = (res && res.role) || "user";
      if (role === "admin") {
        $("gate").style.display = "none";
        $("main").style.display = "";
        run();
      } else {
        $("gate").style.display = "";
        $("main").style.display = "none";
      }
    });
    var btn = $("btn-run");
    if (btn) btn.onclick = run;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
