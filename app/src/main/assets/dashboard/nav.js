/* nav.js — one shared top navigation for every LocalHub page.
 *
 * Injected synchronously into the element with id="lh-nav" so that app.js's
 * applyRole() (which runs later and toggles .admin-only / .user-only) also
 * governs the admin-only links in the bar.
 *
 * No framework, no dependencies, safe to load on any page.
 */
(function () {
  "use strict";

  var LINKS = [
    { href: "/", label: "Dashboard", icon: "▤", match: ["/", "/index.html"] },
    { href: "/files", label: "Files", icon: "▦", match: ["/files"] },
    { href: "/ai/", label: "Assistant", icon: "◈", match: ["/ai", "/ai/"] },
    { href: "/player", label: "Player", icon: "▶", match: ["/player"] },
    { href: "/core", label: "Core", icon: "◉", match: ["/core"], cls: "admin-only" },
    { href: "/selfheal.html", label: "Health", icon: "✚", match: ["/selfheal.html"], cls: "admin-only" }
  ];

  function currentPath() {
    var p = window.location.pathname || "/";
    if (p.length > 1 && p.charAt(p.length - 1) === "/") return p;
    return p;
  }

  function isActive(link) {
    var p = currentPath();
    for (var i = 0; i < link.match.length; i++) {
      var m = link.match[i];
      if (m === "/") { if (p === "/" || p === "/index.html") return true; continue; }
      if (p === m) return true;
      if (m.charAt(m.length - 1) === "/" && p.indexOf(m) === 0) return true;
    }
    return false;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function buildStatus() {
    // IDs are the contract app.js already expects (#ws-status is written to on
    // every WebSocket open/close, unguarded, so it must exist on the page).
    var wrap = el("span", "lh-nav-status");
    wrap.id = "ws-status";
    wrap.appendChild(el("span", "dot off"));
    wrap.appendChild(el("span", null, " connecting…"));
    return wrap;
  }

  function render() {
    var host = document.getElementById("lh-nav");
    if (!host) return;

    var nav = el("nav", "lh-nav");
    nav.setAttribute("data-test", "top-nav");

    var brand = el("a", "lh-nav-brand");
    brand.href = "/";
    var mark = el("span", "lh-nav-mark", "L");
    var name = el("span", "lh-nav-name", "LocalHub");
    brand.appendChild(mark);
    brand.appendChild(name);
    nav.appendChild(brand);

    var links = el("div", "lh-nav-links");
    LINKS.forEach(function (link) {
      var a = el("a", "lh-nav-link" + (isActive(link) ? " active" : ""));
      a.href = link.href;
      if (link.cls) a.className += " " + link.cls;
      a.setAttribute("data-nav", link.href);
      var ico = el("span", "ico", link.icon);
      var txt = el("span", null, link.label);
      a.appendChild(ico);
      a.appendChild(txt);
      links.appendChild(a);
    });
    nav.appendChild(links);

    var right = el("div", "lh-nav-right");
    right.appendChild(buildStatus());

    // Empty until a page fills it; CSS hides it via :empty.
    var role = el("span", "lh-nav-role", "");
    role.id = "role-badge";
    right.appendChild(role);

    var out = el("button", "lh-nav-btn", "Sign out");
    out.id = "logout-btn";
    out.type = "button";
    out.addEventListener("click", function () {
      // If the page bound its own logout (app.js sets .onclick), let it own it —
      // otherwise we would sign out twice.
      if (typeof out.onclick === "function") return;
      try {
        sessionStorage.removeItem("lhtoken");
        localStorage.removeItem("lhtoken");
      } catch (e) {}
      window.location.href = "/login.html";
    });
    right.appendChild(out);
    nav.appendChild(right);

    host.parentNode.replaceChild(nav, host);
    nav.id = "lh-nav";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
