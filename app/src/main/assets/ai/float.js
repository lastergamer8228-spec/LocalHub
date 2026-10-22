/* float.js - floating AI assistant button injected into LocalHub pages. */
(function () {
  "use strict";
  if (document.getElementById("ai-float-btn")) return;

  var btn = document.createElement("button");
  btn.id = "ai-float-btn";
  btn.title = "Open AI Assistant";
  btn.setAttribute("aria-label", "Open AI Assistant");
  btn.innerHTML = "🧠";

  var style = document.createElement("style");
  style.textContent = [
    "#ai-float-btn{position:fixed;right:18px;bottom:18px;z-index:9999;width:56px;height:56px;",
    "border-radius:50%;border:none;background:linear-gradient(135deg,#22d3a6,#38bdf8);",
    "color:#062a21;font-size:26px;cursor:pointer;box-shadow:0 8px 24px rgba(34,211,166,.45);",
    "transition:transform .15s ease;}",
    "#ai-float-btn:hover{transform:scale(1.08);}",
    "#ai-float-btn:active{transform:scale(.95);}"
  ].join("");

  document.addEventListener("DOMContentLoaded", function () {
    (document.head || document.documentElement).appendChild(style);
    document.body.appendChild(btn);
    btn.addEventListener("click", function () {
      window.location.href = "/ai";
    });
  });
})();
