/* visuals.js - LocalHub "WOW" layer.
 * Cinematic boot splash, live glowing sparkline charts driven by WebSocket stats,
 * an animated aurora background, and a live activity ticker. Purely presentational,
 * 60fps (canvas + transform only), respects prefers-reduced-motion.
 */
(function (global) {
  "use strict";
  var reduced = false;
  try { reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  var LH_VIS = {
    ready: false,

    /* ============ Cinematic boot splash ============ */
    boot: function () {
      var existing = document.getElementById("lh-boot");
      if (existing) return;
      var wrap = document.createElement("div");
      wrap.id = "lh-boot";
      wrap.innerHTML =
        '<div class="lh-aurora"><span class="a1"></span><span class="a2"></span><span class="a3"></span></div>' +
        '<div class="lh-boot-center">' +
        '  <div class="lh-boot-logo">&#9672;</div>' +
        '  <div class="lh-boot-rings"><i></i><i></i><i></i></div>' +
        '  <div class="lh-boot-title">LOCALHUB</div>' +
        '  <div class="lh-boot-sub">your phone · your local server</div>' +
        '  <div class="lh-boot-bar"><span></span></div>' +
        '</div>';
      document.body.appendChild(wrap);
      // after the fill bar animates, fade the splash out
      var bar = wrap.querySelector(".lh-boot-bar span");
      var logo = wrap.querySelector(".lh-boot-logo");
      setTimeout(function () { bar.style.width = "100%"; }, 60);
      var done = function () {
        if (reduced) { wrap.style.opacity = "0"; wrap.style.pointerEvents = "none"; }
        wrap.classList.add("lh-boot-done");
        setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 700);
        document.body.classList.add("lh-booted");
        LH_VIS.ready = true;
        if (global.LH_ANIM && global.LH_ANIM.revealAll) global.LH_ANIM.revealAll();
      };
      setTimeout(done, reduced ? 150 : 1450);
      // ensure every metric chart canvas exists so pushes render
      ["cpu-chart", "mem-chart", "sto-chart", "bat-chart", "net-chart"].forEach(function (c) {
        LH_VIS.ensureChart(c);
      });
    },

    /* ============ Live sparkline charts ============ */
    charts: {},
    ensureChart: function (id) {
      var el = document.getElementById(id);
      if (!el || this.charts[id]) return;
      var cv = document.createElement("canvas");
      cv.width = 180; cv.height = 44;
      el.appendChild(cv);
      var ctx = cv.getContext("2d");
      this.charts[id] = { ctx: ctx, data: [], color: "rgba(34,211,166,", color2: "rgba(56,189,248,", w: cv.width, h: cv.height };
    },
    /** Push a 0..1 value into a chart and redraw. */
    push: function (id, value, label) {
      var c = this.charts[id];
      if (!c) return;
      c.data.push(value);
      if (c.data.length > 40) c.data.shift();
      var labelEl = document.getElementById(id + "-lbl");
      if (labelEl && label != null) labelEl.textContent = label;
      this._draw(c);
    },
    _draw: function (c) {
      var ctx = c.ctx, data = c.data, w = c.w, h = c.h;
      ctx.clearRect(0, 0, w, h);
      if (data.length < 2) return;
      var step = w / (40 - 1);
      var base = h - 6;
      // grid line
      ctx.strokeStyle = "rgba(120,140,180,.15)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, base); ctx.lineTo(w, base); ctx.stroke();
      // area fill
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (var i = 0; i < data.length; i++) {
        var x = i * step, y = base - data[i] * (h - 16);
        ctx.lineTo(x, y);
      }
      ctx.lineTo((data.length - 1) * step, h);
      ctx.closePath();
      var grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "rgba(34,211,166,.30)");
      grad.addColorStop(1, "rgba(34,211,166,0)");
      ctx.fillStyle = grad; ctx.fill();
      // glowing line
      ctx.beginPath();
      for (var j = 0; j < data.length; j++) {
        var px = j * step, py = base - data[j] * (h - 16);
        if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8; ctx.shadowColor = "rgba(34,211,166,.8)";
      ctx.strokeStyle = "#22d3a6"; ctx.stroke();
      ctx.shadowBlur = 0;
    },

    /* ============ Live activity ticker ============ */
    ticker: function (text, cls) {
      var el = document.getElementById("lh-ticker");
      if (!el) return;
      var d = document.createElement("div");
      d.className = "lh-tick" + (cls ? " " + cls : "");
      d.textContent = text;
      el.appendChild(d);
      while (el.children.length > 8) el.removeChild(el.firstChild);
      // animate in
      requestAnimationFrame(function () { d.style.opacity = "1"; d.style.transform = "none"; });
    }
  };

  // expose
  global.LH_VIS = LH_VIS;
})(window);
