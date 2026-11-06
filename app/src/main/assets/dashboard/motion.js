/* motion.js - orchestrates the animations declared in motion.css.
 *
 * The CSS owns *how* something moves; this file owns *when*. Keeping them apart
 * means a designer can retune a curve without touching logic, and the logic can
 * be unit-tested without a browser.
 *
 * Every entry point is a no-op when the user asked for reduced motion, so the
 * rest of the app can fire animations unconditionally and stay accessible.
 */
(function (global) {
  "use strict";

  var LH = global.LH = global.LH || {};

  function prefersReduced() {
    try {
      return global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) { return false; }
  }

  var Motion = {
    reduced: prefersReduced(),

    refresh: function () { Motion.reduced = prefersReduced(); return Motion.reduced; },

    /** Adds a class for the length of one animation, then removes it. */
    play: function (el, cls, ms) {
      if (!el || Motion.reduced) return;
      el.classList.remove(cls);
      // Force a reflow so re-adding the class restarts the animation.
      void el.offsetWidth;
      el.classList.add(cls);
      var done = function () { el.classList.remove(cls); };
      global.setTimeout(done, ms || 900);
      el.addEventListener("animationend", done, { once: true });
    },

    /** Retriggers the entrance animation on an element. */
    enter: function (el) { Motion.play(el, "mt-enter", 400); },

    /** Staggered entrance for a container's children. */
    stagger: function (container) {
      if (!container || Motion.reduced) return;
      container.classList.remove("mt-stagger");
      void container.offsetWidth;
      container.classList.add("mt-stagger");
    },

    tabIn: function (pane) { Motion.play(pane, "mt-tab-in", 400); },

    // ---- task-level feedback -------------------------------------------

    /** The server started: rings leave the status dot, a light sweeps the card. */
    serverStart: function (card, dot) {
      if (Motion.reduced) return;
      if (card) Motion.play(card, "mt-power", 900);
      if (dot) Motion.play(dot, "mt-power-ring", 900);
    },

    /** The server stopped: the same motion inverted and desaturated. */
    serverStop: function (card, dot) {
      if (Motion.reduced) return;
      if (dot) Motion.play(dot, "mt-power-down", 400);
      if (card) Motion.play(card, "mt-power-down", 400);
    },

    error: function (el) { Motion.play(el, "mt-error", 600); },

    success: function (el) { Motion.play(el, "mt-success", 600); },

    /** A value changed on screen - telemetry, counters, badges. */
    tick: function (el) { Motion.play(el, "mt-tick", 260); },

    /** Marks a row as finished (transfer complete, job done). */
    settle: function (el) { Motion.play(el, "mt-settle", 400); },

    /** Sets a determinate progress bar. 0-100, or null for indeterminate. */
    progress: function (bar, value) {
      if (!bar) return;
      var fill = bar.querySelector("i");
      if (!fill) return;
      if (value == null) {
        bar.removeAttribute("data-value");
        fill.style.width = "";
        return;
      }
      bar.setAttribute("data-value", String(value));
      fill.style.width = Math.max(0, Math.min(100, value)) + "%";
    },

    /** Builds a progress bar element ready to be dropped into a row. */
    bar: function () {
      var b = document.createElement("div");
      b.className = "mt-bar";
      b.appendChild(document.createElement("i"));
      return b;
    },

    // ---- toasts ---------------------------------------------------------

    toast: function (message, kind, ms) {
      var host = document.getElementById("mt-toast-host");
      if (!host) {
        host = document.createElement("div");
        host.id = "mt-toast-host";
        document.body.appendChild(host);
      }
      var el = document.createElement("div");
      el.className = "mt-toast";
      el.setAttribute("data-kind", kind || "info");
      el.setAttribute("role", "status");
      var icon = document.createElement("span");
      icon.textContent = kind === "bad" ? "✕" : kind === "warn" ? "!" : kind === "ok" ? "✓" : "•";
      var text = document.createElement("span");
      text.textContent = String(message || "");
      el.appendChild(icon);
      el.appendChild(text);
      host.appendChild(el);

      var life = ms || (kind === "bad" ? 5200 : 3200);
      global.setTimeout(function () {
        el.classList.add("is-leaving");
        global.setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, Motion.reduced ? 120 : 220);
      }, life);
      return el;
    }
  };

  LH.Motion = Motion;

  // Honour a change of preference without a reload.
  try {
    if (global.matchMedia) {
      var mq = global.matchMedia("(prefers-reduced-motion: reduce)");
      var handler = function () { Motion.refresh(); };
      if (mq.addEventListener) mq.addEventListener("change", handler);
      else if (mq.addListener) mq.addListener(handler);
    }
  } catch (e) { /* older browsers simply keep the initial value */ }

  // ---------------------------------------------------------------- entry ---
  // Every page gets a staged entrance for its primary surfaces. This had been
  // wired by hand on one page only, which is why eleven of twelve pages had no
  // motion at all despite the library being present.
  function playEntrance() {
    if (Motion.reduced) return;
    // Auto-initialisation must never be the reason a page breaks. If the host
    // document does not offer querySelectorAll, skip the entrance and carry on.
    if (typeof document.querySelectorAll !== 'function') return;
    var items = document.querySelectorAll(
      '.card, .panel, .status-banner, .lh-metrics, .reader-viewer-card'
    );
    var seen = 0;
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      // Do not re-animate something a container already staggered.
      if (el.parentNode && el.parentNode.classList.contains('mt-stagger')) continue;
      el.style.animationDelay = (seen * 70) + 'ms';
      el.classList.remove('mt-enter');
      void el.offsetWidth;
      el.classList.add('mt-enter');
      if (++seen > 12) break;   // cap: a long list should not crawl in
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      Motion.refresh();
      playEntrance();
    });
  } else {
    Motion.refresh();
    playEntrance();
  }

})(window);
