/* config.js - LocalHub global bootstrap. Must be loaded FIRST, before any
 * other AI / File Manager module, so the application object and baseUrl always
 * exist. This removes the hidden dependency where the LH_AI namespace was only
 * created as a side-effect of memory.js loading.
 */
(function (global) {
  "use strict";

  // Legacy extension blocks reference Node's `global` outside their IIFEs.
  // Keep frozen engine sources unchanged while giving browser pages the same
  // binding as the headless harness. Load this bootstrap before those scripts.
  if (typeof global.global === "undefined") global.global = global;

  // --- Main application object (always defined) ---
  global.LocalHub = global.LocalHub || {};

  // --- Configuration (baseUrl always present) ---
  // baseUrl is the same-origin prefix used by every API call. Default to the
  // page origin so relative paths like "/api/files" resolve correctly.
  global.LocalHub.config = global.LocalHub.config || {};
  if (!global.LocalHub.config.baseUrl) {
    global.LocalHub.config.baseUrl = (global.location && global.location.protocol)
      ? global.location.protocol + "//" + global.location.host
      : "";
  }

  // --- AI namespace (back-compat with the LH_AI* modules) ---
  global.LH_AI = global.LH_AI || {};
  if (!global.LH_AI.baseUrl) {
    global.LH_AI.baseUrl = global.LocalHub.config.baseUrl;
  }

  // --- Namespace holders for modules that register later ---
  global.LocalHub.modules = global.LocalHub.modules || {};
  global.LH_AI.modules = global.LH_AI.modules || {};
})(window);
