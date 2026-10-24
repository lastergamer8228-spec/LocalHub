/* library_loader.js - deferred loading of the large answer/command libraries.
 *
 * WHY
 *   features_extra.js + features_jarvis.js + features_knowledge.js register
 *   ~10 000 commands (~3 MB of JavaScript). Loading them as blocking <script>
 *   tags means the /ai page cannot paint until all of that has been downloaded,
 *   parsed and executed. On a mid-range phone that is the difference between
 *   "the page opens" and "the page hangs".
 *
 * HOW ORDER IS PRESERVED (the important bit)
 *   The command parser prefers the longest match and only falls back to
 *   registration order on a tie, so silently moving a 4 800-command library to
 *   the end of the registry could change which command answers a phrase.
 *   It cannot: index.html marks where each library *would* have been with
 *   `LH_AI.Commands.openLibrary(id)`, and this loader calls
 *   `beginLibrary(id)` before the file executes and `endLibrary()` after, so
 *   commands.js splices them back into the exact position. The final registry is
 *   therefore identical to the old synchronous <script> tags - including the
 *   fact that features_critical.js sits between features_jarvis.js and
 *   features_knowledge.js.
 *
 * FAILURE MODEL
 *   A library that fails to load is reported, never fatal, and never leaves a
 *   hole: the page keeps working with whatever registered successfully.
 *
 * This file contains no command data; it only moves existing files from
 * "blocking" to "after first paint".
 */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  // Order matters: it is the order the commands are spliced back in.
  var CHUNKS = [
    { src: "/ai/features_extra.js", slot: "features_extra" },
    { src: "/ai/features_jarvis.js", slot: "features_jarvis" },
    { src: "/ai/features_knowledge.js", slot: "features_knowledge" }
  ];

  var state = { started: false, done: false, loaded: [], failed: [], slots: null, chunks: CHUNKS.map(function (c) { return c.src; }) };
  var listeners = [];
  var promise = null;

  function status() {
    return {
      started: state.started,
      done: state.done,
      loaded: state.loaded.slice(),
      failed: state.failed.slice(),
      // null = not started yet; true = order-preserving slots in use;
      // false = running against an older commands.js (commands land at the end).
      slots: state.slots,
      total: CHUNKS.length
    };
  }

  function notify() {
    var snapshot = status();
    paint(snapshot);
    listeners.forEach(function (fn) {
      try { fn(snapshot); } catch (err) { /* a bad listener must not break boot */ }
    });
    if (global.document && typeof global.CustomEvent === "function") {
      global.document.dispatchEvent(new global.CustomEvent("lh:libraries", { detail: snapshot }));
    }
  }

  function onDone(fn) {
    if (typeof fn === "function") listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }

  // Small, non-destructive progress hint in the chat header.
  function paint(snapshot) {
    if (!global.document) return;
    var badge = global.document.getElementById("hd-status");
    if (!badge) return;
    if (snapshot.done) {
      if (badge.getAttribute("data-lh-original") != null) {
        badge.textContent = badge.getAttribute("data-lh-original");
        badge.removeAttribute("data-lh-original");
      }
      return;
    }
    if (badge.getAttribute("data-lh-original") == null) {
      badge.setAttribute("data-lh-original", badge.textContent);
    }
    var settled = snapshot.loaded.length + snapshot.failed.length;
    badge.textContent = settled >= snapshot.total ? "● LIVE" : "● LOADING " + settled + "/" + snapshot.total;
  }

  // Panels that report a command count refresh once the libraries land.
  function refreshPanels() {
    try {
      var Brain = global.LH_AI && global.LH_AI.Brain;
      if (Brain && typeof Brain.renderDashboard === "function") Brain.renderDashboard();
      if (Brain && typeof Brain.refreshDiagnostics === "function") Brain.refreshDiagnostics();
    } catch (err) { /* panel refresh is cosmetic */ }
  }

  function registry() {
    return (global.LH_AI && global.LH_AI.Commands) || null;
  }

  function start(options) {
    var opts = options || {};
    var doc = opts.document || (global.document || null);
    if (promise) return promise;
    state.started = true;

    if (!doc || typeof doc.createElement !== "function") {
      // No DOM (unit tests, non-browser host): report as skipped, never throw.
      state.done = true;
      state.failed = CHUNKS.map(function (c) { return c.src; });
      state.slots = false;
      notify();
      promise = Promise.resolve(status());
      return promise;
    }

    var commands = registry();
    var useSlots = !!(commands && typeof commands.beginLibrary === "function" && typeof commands.endLibrary === "function");
    state.slots = useSlots;

    promise = new Promise(function (resolve) {
      var index = 0;
      var head = doc.head || doc.documentElement || doc.body;

      function next() {
        if (index >= CHUNKS.length) {
          state.done = true;
          notify();
          refreshPanels();
          resolve(status());
          return;
        }
        var chunk = CHUNKS[index++];
        var tag = doc.createElement("script");
        tag.src = chunk.src;
        tag.async = false; // keep execution in insertion order if anything else races
        tag.setAttribute("data-lh-library", chunk.slot);
        if (useSlots) {
          commands.openLibrary(chunk.slot);
          commands.beginLibrary(chunk.slot);
        }
        tag.onload = function () {
          if (useSlots) commands.endLibrary();
          state.loaded.push(chunk.src);
          notify();
          next();
        };
        tag.onerror = function () {
          if (useSlots) commands.cancelLibrary();
          state.failed.push(chunk.src);
          notify();
          next();
        };
        head.appendChild(tag);
      }

      notify();
      next();
    });
    return promise;
  }

  global.LH_AI.LibraryLoader = {
    chunks: CHUNKS.map(function (c) { return c.src; }),
    start: start,
    status: status,
    onDone: onDone
  };
})((typeof window !== "undefined" ? window : globalThis));
