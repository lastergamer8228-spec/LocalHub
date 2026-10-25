/* Web shell wiring: the shared top nav and the Pro Console theme.
 *
 * Mocked DOM (no browser): proves nav.js builds the bar, marks the active page,
 * keeps the element IDs app.js depends on, and that every page links the theme
 * and the nav. It does NOT verify how anything LOOKS - that needs a real browser.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const DASH = path.join(__dirname, '../app/src/main/assets/dashboard');
const AI = path.join(__dirname, '../app/src/main/assets/ai');
const NAV_SRC = fs.readFileSync(path.join(DASH, 'nav.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(DASH, 'index.html'), 'utf8');

let passed = 0;
let failed = 0;
const queue = [];

function it(name, fn) {
  queue.push(
    Promise.resolve()
      .then(fn)
      .then(
        () => { passed++; console.log('PASS', name); },
        (err) => { failed++; process.exitCode = 1; console.error('FAIL', name, '\n ', err.message); }
      )
  );
}

/* ---------- tiny fake DOM -------------------------------------------------- */
function fakeNode(tag) {
  const node = {
    tagName: (tag || 'div').toUpperCase(),
    className: '',
    id: '',
    style: {},
    attrs: {},
    children: [],
    parentNode: null,
    textContent: '',
    _html: '',
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(type, fn) { (this._listeners = this._listeners || {})[type] = fn; },
    replaceChild(nu, old) {
      const parent = old.parentNode;
      if (!parent) return;
      parent.children = parent.children.map((c) => (c === old ? nu : c));
      nu.parentNode = parent;
    },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; }
  };
  return node;
}

function runNav(route) {
  const host = fakeNode('div');
  host.id = 'lh-nav';
  const body = fakeNode('body');
  body.appendChild(host);

  const document = {
    readyState: 'complete',
    createElement: (t) => fakeNode(t),
    getElementById: (id) => (id === 'lh-nav' ? host : null),
    addEventListener() {}
  };
  const win = { document, location: { pathname: route }, window: null };
  win.window = win;
  const ctx = { window: win, document, navigator: { userAgent: 'node' } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(NAV_SRC, ctx);
  // nav.js replaces the mount node in place, so read the bar back from the parent.
  return { nav: body.children[0] || host, document, win };
}

function flatten(node, out) {
  out = out || [];
  node.children.forEach((c) => { out.push(c); flatten(c, out); });
  return out;
}

const find = (nodes, pred) => nodes.find(pred);

/* ---------- tests ---------------------------------------------------------- */

it('nav.js renders a bar with brand, links, status and sign out', () => {
  const { nav } = runNav('/');
  assert.ok(nav, 'nav host must be replaced in place');
  assert.strictEqual(nav.id, 'lh-nav');
  const nodes = flatten(nav);
  const links = nodes.filter((n) => n.attrs['data-nav']);
  assert.strictEqual(links.length, 6, 'expected 6 nav links, got ' + links.length);
  const labels = nodes.map((n) => n.textContent).filter(Boolean);
  assert.ok(labels.includes('LocalHub'), 'brand missing');
  assert.ok(labels.includes('Dashboard') && labels.includes('Files'), 'core links missing');
  assert.ok(labels.includes('Sign out'), 'sign out missing');
});

it('the current page is marked active', () => {
  const files = runNav('/files').nav;
  const active = flatten(files).filter((n) => (n.className || '').includes('lh-nav-link active'));
  assert.strictEqual(active.length, 1, 'exactly one active link expected');
  assert.strictEqual(active[0].attrs['data-nav'], '/files');

  const ai = runNav('/ai/index.html').nav;
  const aiActive = flatten(ai).filter((n) => (n.className || '').includes('active'));
  assert.strictEqual(aiActive[0].attrs['data-nav'], '/ai/', '/ai/ must stay active on /ai/index.html');
});

it('admin-only links carry the class app.js toggles', () => {
  const { nav } = runNav('/');
  const core = flatten(nav).find((n) => n.attrs['data-nav'] === '/core');
  const health = flatten(nav).find((n) => n.attrs['data-nav'] === '/selfheal.html');
  const files = flatten(nav).find((n) => n.attrs['data-nav'] === '/files');
  assert.ok((core.className || '').includes('admin-only'), 'Core must be admin-only');
  assert.ok((health.className || '').includes('admin-only'), 'Health must be admin-only');
  assert.ok(!(files.className || '').includes('admin-only'), 'Files is for everyone');
});

it('keeps the element IDs app.js writes to (ws-status, role-badge, logout-btn)', () => {
  const { nav } = runNav('/');
  const nodes = flatten(nav);
  assert.ok(find(nodes, (n) => n.id === 'ws-status'), '#ws-status is written on every socket open/close');
  assert.ok(find(nodes, (n) => n.id === 'role-badge'), '#role-badge missing');
  const out = find(nodes, (n) => n.id === 'logout-btn');
  assert.ok(out, '#logout-btn missing');
  // app.js assigns .onclick; the nav must not double-handle it
  out.onclick = function () {};
  assert.ok(find(nodes, (n) => n.id === 'logout-btn'), 'logout button must survive onclick binding');
});

it('every dashboard page loads the shared theme; login has no nav', () => {
  const pages = ['index.html', 'files.html', 'login.html'];
  pages.forEach((f) => {
    const html = fs.readFileSync(path.join(DASH, f), 'utf8');
    assert.ok(html.includes('theme-pro.css'), f + ' is missing theme-pro.css');
  });
  ['index.html', 'files.html'].forEach((f) => {
    const html = fs.readFileSync(path.join(DASH, f), 'utf8');
    assert.ok(html.includes('/nav.js'), f + ' is missing nav.js');
    assert.ok(html.includes('id="lh-nav"'), f + ' is missing the nav mount point');
    // The mount point must sit inside <body>: an earlier injection put it
    // between </head> and <body>, which broke the DOM of every page that got it.
    assert.ok(
      html.indexOf('<body') < html.indexOf('id="lh-nav"'),
      f + ': nav mount point is outside <body>'
    );
  });
  const login = fs.readFileSync(path.join(DASH, 'login.html'), 'utf8');
  assert.ok(!login.includes('/nav.js'), 'the login page must not show the nav');
});

it('/player and /ai stay standalone (injecting the nav broke them)', () => {
  // Both are full-screen views with their own top bar. The shared nav mount
  // used to be injected into them outside <body>, which broke their DOM - the
  // assistant stopped working and the player controls became unhittable.
  [path.join(DASH, 'player.html'), path.join(AI, 'index.html')].forEach((file) => {
    const html = fs.readFileSync(file, 'utf8');
    assert.ok(!html.includes('theme-pro.css'), path.basename(file) + ' should not load the dashboard theme');
    assert.ok(!html.includes('/nav.js'), path.basename(file) + ' should not load the shared nav');
    assert.ok(!html.includes('id="lh-nav"'), path.basename(file) + ' should not have a nav mount point');
  });
});

it('nav.js loads before app.js on the dashboard', () => {
  const navAt = INDEX.indexOf('/nav.js');
  const appAt = INDEX.indexOf('/app.js');
  assert.ok(navAt > 0 && appAt > navAt, 'nav must exist before app.js applies roles');
});

it('the dashboard keeps every element id app.js touches', () => {
  const js = fs.readFileSync(path.join(DASH, 'app.js'), 'utf8');
  const ids = new Set([
    ...[...js.matchAll(/\$\("([a-zA-Z0-9_-]+)"\)/g)].map((m) => m[1]),
    ...[...js.matchAll(/setText\("([a-zA-Z0-9_-]+)"/g)].map((m) => m[1])
  ]);
  // supplied at runtime by nav.js
  ['ws-status', 'role-badge', 'logout-btn'].forEach((id) => ids.delete(id));
  // never existed in markup (optional sections) - pre-existing, guarded by JS
  ['network-body', 'system-body', 'tm-avgdl', 'uptime-body'].forEach((id) => ids.delete(id));
  const missing = [...ids].filter((id) => !INDEX.includes('id="' + id + '"'));
  assert.deepStrictEqual(missing, [], 'dashboard is missing ids app.js needs: ' + missing.join(', '));
});

it('the dashboard no longer ships the decorative noise', () => {
  assert.ok(!INDEX.includes('lh-aurora'), 'aurora background should be gone');
  assert.ok(!INDEX.includes('lh-ticker'), 'live ticker removed (visuals.js guards for it)');
  assert.ok(INDEX.includes('status-banner'), 'metric strip must stay');
  assert.ok(INDEX.includes('id="core-card"'), 'System Core must stay (collapsed)');
});

Promise.all(queue).then(() => {
  console.log(`\n${passed} web-shell scenarios passed, ${failed} failed. DOM is mocked; visual appearance is NOT verified.`);
});
