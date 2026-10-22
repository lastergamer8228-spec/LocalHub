/* chat.js - renders the chat conversation UI and persists chat history.
 * Uses the shared animation system (LH_ANIM) for smooth message entrances,
 * auto-scroll, and a typing/thinking indicator. */
(function (global) {
  "use strict";
  global.LH_AI = global.LH_AI || {};

  var Memory = global.LH_AI.Memory;
  var Anim = global.LH_AI && global.LH_AI.Anim;

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  }); }
  function scrollBox(box) {
    if (Anim && Anim.scrollToBottom) Anim.scrollToBottom(box);
    else if (box) box.scrollTop = box.scrollHeight;
  }

  var Chat = {
    addMessage: function (role, text) {
      var box = el("chat-log");
      if (!box) return;
      var wrap = document.createElement("div");
      wrap.className = "msg " + role + " lh-msg-in";
      var time = new Date().toLocaleTimeString();
      var formatted = String(text || "").replace(/\n/g, "<br>");
      var avatar = role === "user" ? "👤" : "🧠";
      var inner = '<div class="avatar">' + avatar + '</div>' +
        '<div class="msg-body"><div class="bubble">' + esc(formatted) + '</div>' +
        '<div class="meta">' + time + "</div></div>";
      wrap.innerHTML = inner;
      box.appendChild(wrap);
      scrollBox(box);
      return wrap;
    },

    addAction: function (text) {
      var box = el("chat-log");
      if (!box) return;
      var wrap = document.createElement("div");
      wrap.className = "msg action lh-msg-in";
      wrap.innerHTML = '<div class="msg-body"><div class="bubble">⚙ ' + esc(text) + "</div></div>";
      box.appendChild(wrap);
      scrollBox(box);
    },

    addError: function (text) {
      var box = el("chat-log");
      if (!box) return;
      var wrap = document.createElement("div");
      wrap.className = "msg error lh-msg-in";
      wrap.innerHTML = '<div class="msg-body"><div class="bubble">⚠ ' + esc(text) + "</div></div>";
      box.appendChild(wrap);
      scrollBox(box);
      if (Anim && Anim.error && wrap.querySelector(".bubble")) Anim.error(wrap.querySelector(".bubble"));
    },

    /** Adds a typing/thinking indicator bubble; returns a function to remove it. */
    thinking: function () {
      var box = el("chat-log");
      if (!box) return function () {};
      var wrap = document.createElement("div");
      wrap.className = "msg assistant lh-msg-in";
      wrap.innerHTML = '<div class="bubble"><span class="lh-typing"><i></i><i></i><i></i></span></div>';
      box.appendChild(wrap);
      scrollBox(box);
      return function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };
    },

    /** Renders a message then animates its text in with a caret (streaming feel).
     *  opts.tag = a short hologram module-path tag shown under the bubble (e.g.
     *  "MEDIA → FILES → PLAYER") to tie the reply back to the Brain Hologram. */
    addTyped: function (role, text, opts) {
      opts = opts || {};
      var box = el("chat-log");
      if (!box) return Promise.resolve();
      var wrap = document.createElement("div");
      wrap.className = "msg " + role + " lh-msg-in";
      var avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.textContent = role === "user" ? "👤" : "🧠";
      var body = document.createElement("div");
      body.className = "msg-body";
      var bubble = document.createElement("div");
      bubble.className = "bubble";
      var meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = new Date().toLocaleTimeString();
      body.appendChild(bubble);
      body.appendChild(meta);
      if (opts.tag) {
        var tag = document.createElement("div");
        tag.className = "holo-tag";
        tag.textContent = opts.tag;
        body.appendChild(tag);
      }
      wrap.appendChild(avatar);
      wrap.appendChild(body);
      box.appendChild(wrap);
      scrollBox(box);
      if (Anim && Anim.typeText && !(opts.noType)) {
        return Anim.typeText(bubble, String(text || ""), opts).then(function () { scrollBox(box); });
      }
      bubble.textContent = text || "";
      scrollBox(box);
      return Promise.resolve();
    },

    save: function (message) {
      // Tag each message with the session role so a standard user can NEVER see
      // an admin's chat history (which may contain access logs / device IPs).
      // Role comes from the server session (Commands.getRole()), not user input.
      try {
        message._sr = (global.LH_AI.Commands && global.LH_AI.Commands.getRole()) || "user";
      } catch (e) {
        message._sr = "user";
      }
      return Memory.put("chats", message);
    },

    loadHistory: function () {
      // Only load chat messages belonging to the current session role. This is
      // the security boundary: admin chat (with logs/device details) is never
      // shown to a standard web user, even on the same browser/device.
      var role = "user";
      try { role = (global.LH_AI.Commands && global.LH_AI.Commands.getRole()) || "user"; } catch (e) {}
      return Memory.getAll("chats").then(function (all) {
        return all
          .filter(function (m) { return (m._sr || "user") === role; })
          .sort(function (a, b) { return a.createdAt - b.createdAt; })
          .slice(-50);
      });
    },

    clear: function () {
      var box = el("chat-log");
      if (box) box.innerHTML = "";
      return Memory.clear("chats");
    }
  };

  global.LH_AI.Chat = Chat;
})(window);
