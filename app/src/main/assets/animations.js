/* ============================================================================
   LocalHub — Central Animation JS
   ----------------------------------------------------------------------------
   Micro-interactions shared across every page. Keep everything lightweight and
   safe: no hardcoded timings inline (use the constants below), no layout
   thrash, graceful fallback when an API is unavailable, and automatic
   respect for prefers-reduced-motion.
   ========================================================================== */
(function (global) {
  "use strict";

  var reduced = false;
  try {
    reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) { reduced = false; }

  var LH_ANIM = {
    FAST: 120,
    NORMAL: 220,
    SLOW: 380,
    SPRING: 520,

    /** True when the OS requests reduced motion. */
    reducedMotion: function () { return reduced; },

    /* ---- ripple ---- */
    /** Material-style ripple at the pointer position. */
    ripple: function (el, ev) {
      if (reduced || !el) return;
      var rect = el.getBoundingClientRect();
      var x = ev ? (ev.clientX - rect.left) : rect.width / 2;
      var y = ev ? (ev.clientY - rect.top) : rect.height / 2;
      var size = Math.max(rect.width, rect.height);
      var ink = global.document.createElement("span");
      ink.className = "lh-ink";
      ink.style.width = ink.style.height = size + "px";
      ink.style.left = (x - size / 2) + "px";
      ink.style.top = (y - size / 2) + "px";
      el.appendChild(ink);
      ink.addEventListener("animationend", function () { el.removeChild(ink); });
    },

    /** Wire ripple to all .lh-ripple elements within root. */
    attachRipples: function (root) {
      if (reduced) return;
      root = root || global.document;
      var els = root.querySelectorAll(".lh-ripple");
      for (var i = 0; i < els.length; i++) (function (el) {
        el.addEventListener("pointerdown", function (ev) { LH_ANIM.ripple(el, ev); });
      })(els[i]);
    },

    /* ---- number count-up ---- */
    /** Animate el from its current text to target. */
    countUp: function (el, target, opts) {
      opts = opts || {};
      var dur = opts.duration || LH_ANIM.NORMAL;
      if (!el || reduced) { el && (el.textContent = opts.format ? opts.format(target) : target); return; }
      var from = parseFloat((el.textContent || "0").replace(/[^0-9.\-]/g, "")) || 0;
      var start = null;
      function step(ts) {
        if (!start) start = ts;
        var p = Math.min(1, (ts - start) / dur);
        var eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
        var val = from + (target - from) * eased;
        el.textContent = opts.format ? opts.format(val) : Math.round(val);
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    },

    /* ---- typing indicator ---- */
    typeText: function (el, text, opts) {
      opts = opts || {};
      var speed = opts.speed || 12; // ms per char
      return new Promise(function (resolve) {
        if (reduced) { el.textContent = text; resolve(); return; }
        var i = 0;
        el.textContent = "";
        el.classList.add("lh-caret");
        (function tick() {
          i++;
          el.textContent = text.slice(0, i);
          if (i < text.length) { setTimeout(tick, speed); }
          else { el.classList.remove("lh-caret"); resolve(); }
        })();
      });
    },

    /* ---- reveal on scroll ---- */
    revealAll: function (root) {
      root = root || global.document;
      var els = root.querySelectorAll(".lh-reveal");
      if (!("IntersectionObserver" in global) || reduced) {
        for (var i = 0; i < els.length; i++) els[i].classList.add("in");
        return;
      }
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
        });
      }, { threshold: 0.12 });
      for (var j = 0; j < els.length; j++) io.observe(els[j]);
    },

    /* ---- smooth auto-scroll ---- */
    scrollToBottom: function (el) {
      if (!el) return;
      if (reduced) { el.scrollTop = el.scrollHeight; return; }
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    },

    /* ---- success / error feedback on a control ---- */
    success: function (el) {
      if (!el) return;
      el.classList.remove("lh-success-flash"); void el.offsetWidth; el.classList.add("lh-success-flash");
    },
    error: function (el) {
      if (!el) return;
      el.classList.remove("lh-error-flash"); void el.offsetWidth; el.classList.add("lh-error-flash");
    },

    /* ---- skeleton loading (skeletonElement(el) then populate it) ---- */
    skeletonOn: function (el) { if (el) el.classList.add("lh-skeleton"); },
    skeletonOff: function (el) { if (el) el.classList.remove("lh-skeleton"); },

    /* ---- page-transition helper (View Transitions API where available) ---- */
    navigate: function (url) {
      if (global.document && global.document.startViewTransition) {
        global.document.startViewTransition(function () { global.location.href = url; });
      } else {
        global.location.href = url;
      }
    }
  };

  /* auto-init once the DOM is ready */
  function init() {
    LH_ANIM.attachRipples();
    LH_ANIM.revealAll();
  }
  if (global.document) {
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  global.LH_ANIM = LH_ANIM;
  global.LH_AI = global.LH_AI || {};
  global.LH_AI.Anim = LH_ANIM;
})(window);
