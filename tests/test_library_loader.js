/* Deferred-library loader behaviour (ai/library_loader.js).
 *
 * Mocked DOM and a mocked Commands registry: this proves the loader requests the
 * right files, in the right order, brackets each one with the slot calls that
 * pin its registry position, survives a failed chunk and is idempotent.
 * It does NOT prove real browser timing - that needs a device run.
 * The ordering guarantee itself is proven in test_deferred_slots.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/ai/library_loader.js'), 'utf8');
const EXPECTED = ['/ai/features_extra.js', '/ai/features_jarvis.js', '/ai/features_knowledge.js'];
const SLOTS = ['features_extra', 'features_jarvis', 'features_knowledge'];

let passed = 0;
let failed = 0;
const queue = [];

// cross-realm safe comparison (arrays created inside a vm have a foreign Array prototype)
function sameArray(actual, expected, message) {
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), message);
}

function it(name, fn) {
  queue.push(
    Promise.resolve()
      .then(fn)
      .then(
        () => {
          passed++;
          console.log('PASS', name);
        },
        (err) => {
          failed++;
          process.exitCode = 1;
          console.error('FAIL', name, '\n ', err.message);
        }
      )
  );
}

function makeRegistry(options) {
  const opts = options || {};
  const calls = [];
  const registry = {
    _calls: calls,
    openLibrary(id) { calls.push('open:' + id); },
    beginLibrary(id) { calls.push('begin:' + id); },
    endLibrary() { calls.push('end'); return 0; },
    cancelLibrary() { calls.push('cancel'); },
  };
  if (opts.noSlots) {
    // Simulates a stale cached commands.js without the slot API.
    delete registry.beginLibrary;
    delete registry.endLibrary;
    delete registry.cancelLibrary;
    delete registry.openLibrary;
  }
  return registry;
}

function load(options) {
  const opts = options || {};
  const tags = [];
  const badge = opts.badge
    ? {
        textContent: '● LIVE',
        attrs: {},
        getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
        setAttribute(k, v) { this.attrs[k] = v; },
        removeAttribute(k) { delete this.attrs[k]; },
      }
    : null;
  const doc = {
    head: { appendChild(tag) { tags.push(tag); } },
    createElement() {
      return { src: '', async: true, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    },
    getElementById(id) { return opts.badge && id === 'hd-status' ? badge : null; },
    dispatchEvent() {},
  };
  const registry = makeRegistry(opts);
  const win = { document: doc, LH_AI: { Commands: registry } };
  const ctx = { window: win, document: doc, CustomEvent: function () {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { loader: win.LH_AI.LibraryLoader, doc, tags, badge, registry, ctx };
}

/** Fire load/error for each chunk; the loader appends the next tag synchronously. */
function settle(env, failures) {
  const fail = failures || [];
  for (let i = 0; i < EXPECTED.length; i++) {
    const tag = env.tags[env.tags.length - 1];
    if (!tag) break;
    if (fail.includes(tag.src)) tag.onerror();
    else tag.onload();
  }
}

it('requests the three large libraries, one at a time, in the historical order', async () => {
  const env = load();
  const p = env.loader.start();
  assert.strictEqual(env.tags.length, 1, 'sequential: only one request in flight at a time');
  assert.strictEqual(env.tags[0].src, EXPECTED[0]);
  settle(env);
  const status = await p;
  sameArray(env.tags.map((t) => t.src), EXPECTED);
  sameArray(status.loaded, EXPECTED);
  sameArray(env.loader.chunks, EXPECTED);
});

it('brackets every chunk with the slot calls that pin its registry position', async () => {
  const env = load();
  const p = env.loader.start();
  settle(env);
  await p;
  const calls = env.registry._calls;
  const expected = [];
  SLOTS.forEach((slot) => expected.push('open:' + slot, 'begin:' + slot, 'end'));
  sameArray(calls, expected, 'slot calls out of order or missing');
});

it('a failed chunk is cancelled, reported and does not stop the others', async () => {
  const env = load();
  const p = env.loader.start();
  settle(env, ['/ai/features_jarvis.js']);
  const status = await p;
  assert.strictEqual(status.done, true, 'a failed library must not hang the loader');
  sameArray(status.failed, ['/ai/features_jarvis.js']);
  sameArray(status.loaded, ['/ai/features_extra.js', '/ai/features_knowledge.js']);
  const calls = env.registry._calls;
  assert.ok(calls.includes('cancel'), 'cancelLibrary must be called for the failed chunk');
  assert.strictEqual(
    calls.filter((c) => c === 'end').length,
    2,
    'only the two successful libraries may be spliced in'
  );
});

it('is idempotent: second start() reuses the same promise, no duplicate requests', () => {
  const env = load();
  const first = env.loader.start();
  const second = env.loader.start();
  assert.strictEqual(first, second);
  assert.strictEqual(env.tags.length, 1);
});

it('reports slots=true when the registry supports the API', () => {
  const env = load();
  env.loader.start();
  assert.strictEqual(env.loader.status().slots, true);
});

it('degrades to plain loading (slots=false) against a stale commands.js', async () => {
  const env = load({ noSlots: true });
  const p = env.loader.start();
  assert.strictEqual(env.loader.status().slots, false, 'must report the degraded mode');
  settle(env);
  const status = await p;
  assert.strictEqual(status.done, true);
  sameArray(status.loaded, EXPECTED, 'it must still load every library');
  sameArray(env.registry._calls, [], 'no slot calls when the API is missing');
});

it('notifies listeners and restores the header badge afterwards', async () => {
  const env = load({ badge: true });
  const seen = [];
  env.loader.onDone((s) => seen.push(s.done));
  const p = env.loader.start();
  assert.ok(/LOADING/.test(env.badge.textContent), 'badge should show progress, got ' + env.badge.textContent);
  settle(env);
  const status = await p;
  assert.strictEqual(status.done, true);
  assert.ok(seen.length >= 1, 'listeners notified');
  assert.strictEqual(seen[seen.length - 1], true);
  assert.strictEqual(env.badge.textContent, '● LIVE', 'badge must be restored');
});

it('without a DOM it resolves instead of throwing (non-browser host)', async () => {
  const win = { LH_AI: {} };
  const ctx = { window: win };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const status = await win.LH_AI.LibraryLoader.start();
  assert.strictEqual(status.done, true);
  sameArray(status.failed, EXPECTED);
  assert.strictEqual(status.slots, false);
});

it('the libraries really still exist at those paths', () => {
  EXPECTED.forEach((rel) => {
    const file = path.join(__dirname, '../app/src/main/assets', rel.replace(/^\//, ''));
    assert.ok(fs.existsSync(file), 'missing ' + rel);
  });
});

it('index.html no longer blocks on the three libraries but still loads the loader', () => {
  const html = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/ai/index.html'), 'utf8');
  EXPECTED.forEach((rel) => {
    assert.ok(!html.includes('<script src="' + rel + '">'), rel + ' must not be a blocking tag');
  });
  assert.ok(html.includes('/ai/library_loader.js'), 'loader must be included');
  assert.ok(html.includes('LibraryLoader.start()'), 'loader must be started');
  const loaderAt = html.indexOf('/ai/library_loader.js');
  const brainAt = html.indexOf('/ai/brain.js');
  assert.ok(loaderAt > 0 && brainAt > loaderAt, 'loader must load before brain.js so start() exists');
});

Promise.all(queue).then(() => {
  console.log(
    `\n${passed} deferred-loader scenarios passed, ${failed} failed. DOM and registry are mocked; real browser timing is not covered.`
  );
});
