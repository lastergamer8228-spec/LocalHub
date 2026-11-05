/* components.js — behaviour for the design system's components.
 *
 * components.css decides how things look; this file decides how they behave.
 * Kept deliberately small: it exists so that the states the CSS defines
 * (loading, open, announced) are actually reachable without every page
 * reinventing them.
 *
 * No dependencies. Loaded after motion.js.
 */
(function (global) {
  "use strict";

  var LH = global.LH = global.LH || {};

  var UI = {

    /* ---------------------------------------------------------- loading ---
     * A loading button must keep its width: the spinner replaces the label
     * rather than joining it, so the layout does not jump mid-action.
     */
    setLoading: function (el, on) {
      if (!el) return;
      on = on !== false;
      if (on) {
        el.classList.add("is-loading");
        el.setAttribute("aria-busy", "true");
        // aria-disabled keeps it focusable for screen-reader users, unlike
        // the disabled attribute which removes it from the tab order.
        el.setAttribute("aria-disabled", "true");
      } else {
        el.classList.remove("is-loading");
        el.removeAttribute("aria-busy");
        el.removeAttribute("aria-disabled");
      }
    },

    /** Wraps a promise: button shows a spinner until it settles. */
    withLoading: function (el, promise) {
      UI.setLoading(el, true);
      var done = function (v) { UI.setLoading(el, false); return v; };
      return Promise.resolve(promise).then(done, function (e) { done(); throw e; });
    },

    /* ----------------------------------------------------------- dialog ---
     * Native <dialog> gives focus trap, Esc, backdrop and focus return for
     * free. We only have to open it the right way.
     */
    openDialog: function (id) {
      var d = typeof id === "string" ? document.getElementById(id) : id;
      if (!d) return null;
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");      // very old browsers
      return d;
    },

    closeDialog: function (id) {
      var d = typeof id === "string" ? document.getElementById(id) : id;
      if (!d) return;
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    },

    /* ------------------------------------------------------------ toast --- */
    toast: function (message, kind, ms) {
      if (LH.Motion && LH.Motion.toast) return LH.Motion.toast(message, kind, ms);
      // Last resort if motion.js did not load.
      var el = document.createElement("div");
      el.className = "mt-toast";
      el.setAttribute("data-kind", kind || "info");
      el.setAttribute("role", "status");
      el.textContent = String(message || "");
      document.body.appendChild(el);
      global.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms || 3200);
      return el;
    },

    /* ------------------------------------------------------- empty/empty --- */
    /** Builds the standard empty state. Every list should have one. */
    empty: function (icon, title, body, actionLabel, actionHref) {
      var wrap = document.createElement("div");
      wrap.className = "empty";
      var ico = document.createElement("div");
      ico.className = "empty-ico";
      ico.textContent = icon || "∅";
      wrap.appendChild(ico);
      if (title) {
        var t = document.createElement("div");
        t.className = "empty-title";
        t.textContent = title;
        wrap.appendChild(t);
      }
      if (body) {
        var b = document.createElement("div");
        b.className = "empty-body";
        b.textContent = body;
        wrap.appendChild(b);
      }
      if (actionLabel && actionHref) {
        var a = document.createElement("a");
        a.className = "btn btn-secondary";
        a.href = actionHref;
        a.textContent = actionLabel;
        a.style.marginTop = "var(--sp-2)";
        wrap.appendChild(a);
      }
      return wrap;
    },

    /** Replaces a container's contents with a skeleton of n rows. */
    skeletonRows: function (container, n, heightPx) {
      if (!container) return;
      container.innerHTML = "";
      for (var i = 0; i < (n || 3); i++) {
        var s = document.createElement("div");
        s.className = "skeleton";
        s.style.height = (heightPx || 16) + "px";
        s.style.marginBottom = "var(--sp-2)";
        container.appendChild(s);
      }
    },

    /* ------------------------------------------------------- auto-wiring -- */
    /** [data-dialog-open="id"] and [data-dialog-close] on any element. */
    wire: function () {
      document.querySelectorAll("[data-dialog-open]").forEach(function (el) {
        if (el.__dialogWired) return;
        el.__dialogWired = true;
        el.addEventListener("click", function (e) {
          e.preventDefault();
          UI.openDialog(el.getAttribute("data-dialog-open"));
        });
      });
      document.querySelectorAll("[data-dialog-close]").forEach(function (el) {
        if (el.__dialogWired) return;
        el.__dialogWired = true;
        el.addEventListener("click", function (e) {
          e.preventDefault();
          var d = el.closest("dialog");
          if (d) UI.closeDialog(d);
          else UI.closeDialog(el.getAttribute("data-dialog-close"));
        });
      });
    }
  };

  LH.UI = UI;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { UI.wire(); });
  } else {
    UI.wire();
  }
})(window);
