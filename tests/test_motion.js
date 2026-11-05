'use strict';
/* Motion tests.
 *
 * The point of these is not that a class name was added. It is that the
 * accessibility contract holds: when the user asks the system to stop moving
 * things, nothing in this library may move them anyway. That is the one
 * behaviour that is easy to break by accident and impossible to notice by
 * reading.
 *
 * Run:  node tests/test_motion.js
 */
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');

const MOTION = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'dashboard', 'motion.js');

// ---- minimal DOM ---------------------------------------------------------
class El {
  constructor(tag) {
    this.tag = tag || 'div';
    this.classes = new Set();
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.textContent = '';
  }
  get classList() {
    const self = this;
    return {
      add(c) { self.classes.add(c); },
      remove(c) { self.classes.delete(c); },
      contains(c) { return self.classes.has(c); },
      toggle(c, on) { if (on) self.classes.add(c); else self.classes.delete(c); }
    };
  }
  get className() { return Array.from(this.classes).join(' '); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  // Motion reads offsetWidth to force a reflow; a getter is enough here.
  get offsetWidth() { return 100; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c; }
  querySelector(sel) {
    // Supports ".class" and "tag" - motion.js looks up the bar's <i> fill.
    if (sel.charAt(0) === '.') {
      const want = sel.slice(1);
      return this.children.find(c => c.classes.has(want)) || null;
    }
    return this.children.find(c => c.tag === sel) || null;
  }
  addEventListener() {}
}

function attached(root, el) {
  // Depth-first search: the toast is nested inside its host element.
  if (root.children.indexOf(el) >= 0) return true;
  return root.children.some(c => attached(c, el));
}

function makeCtx(reduced) {
  const body = new El('body');
  const doc = {
    body,
    getElementById(id) { return doc._byId[id] || null; },
    createElement(t) { return new El(t); },
    _byId: {}
  };
  const timers = [];
  const ctx = {
    console, Promise, setTimeout: (fn, ms) => { timers.push(fn); return timers.length; },
    document: doc,
    matchMedia: q => ({ matches: !!reduced && /reduced-motion/.test(q), addEventListener() {}, addListener() {} })
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(MOTION, 'utf8'), ctx, { filename: 'motion.js' });
  return ctx;
}

// ---- normal motion -------------------------------------------------------
{
  const ctx = makeCtx(false);
  const M = ctx.LH.Motion;
  assert.strictEqual(M.reduced, false, 'motion should be enabled by default');

  const el = new El();
  M.play(el, 'mt-enter', 400);
  assert.ok(el.classList.contains('mt-enter'), 'play() should add the class');

  const dot = new El();
  M.serverStart(new El(), dot);
  assert.ok(dot.classList.contains('mt-power-ring'), 'server start should ring the dot');

  const pane = new El();
  M.tabIn(pane);
  assert.ok(pane.classList.contains('mt-tab-in'), 'tabIn() should animate the pane');

  const container = new El();
  M.stagger(container);
  assert.ok(container.classList.contains('mt-stagger'), 'stagger() should mark the container');

  // progress bar
  const bar = M.bar();
  M.progress(bar, 40);
  assert.strictEqual(bar.getAttribute('data-value'), '40');
  assert.strictEqual(bar.children[0].style.width, '40%');
  M.progress(bar, 140);
  assert.strictEqual(bar.children[0].style.width, '100%', 'progress must clamp to 100');
  M.progress(bar, null);
  assert.strictEqual(bar.getAttribute('data-value'), undefined, 'null should reset to indeterminate');

  // toast: created inside a host element that is itself attached to <body>
  const toast = M.toast('Saved', 'ok');
  assert.strictEqual(toast.getAttribute('data-kind'), 'ok');
  assert.strictEqual(toast.getAttribute('role'), 'status', 'toasts must be announced');
  assert.ok(attached(ctx.document.body, toast), 'toast should be reachable from <body>');
}

// ---- reduced motion: nothing may animate --------------------------------
{
  const ctx = makeCtx(true);
  const M = ctx.LH.Motion;
  assert.strictEqual(M.reduced, true, 'reduced preference must be detected');

  const el = new El();
  M.play(el, 'mt-enter');
  assert.ok(!el.classList.contains('mt-enter'), 'play() must be a no-op');

  const card = new El(), dot = new El();
  M.serverStart(card, dot);
  assert.ok(!dot.classList.contains('mt-power-ring'), 'server start must not animate');
  assert.ok(!card.classList.contains('mt-power'), 'the sweep must not run');
  M.serverStop(card, dot);
  assert.ok(!card.classList.contains('mt-power-down'));

  const pane = new El();
  M.tabIn(pane);
  M.stagger(pane);
  assert.ok(!pane.classList.contains('mt-tab-in'));
  assert.ok(!pane.classList.contains('mt-stagger'));

  const bad = new El();
  M.error(bad);
  M.success(bad);
  M.settle(bad);
  M.tick(bad);
  assert.ok(!bad.classList.contains('mt-error'));
  assert.ok(!bad.classList.contains('mt-success'));

  // A toast is still created - it is information, not decoration - but it is
  // still announced and still disappears.
  const toast = M.toast('Still important', 'bad');
  assert.strictEqual(toast.getAttribute('role'), 'status');
  assert.ok(attached(ctx.document.body, toast), 'toast is information - it must still appear');
}

console.log('PASS: motion - task animations fire normally; under prefers-reduced-motion every');
console.log('      animation is a no-op while toasts (information) are still shown and announced.');
