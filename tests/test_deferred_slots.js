/* Deferred-command slots in ai/commands.js.
 *
 * This is the safety net for /ai fast loading: deferring a 4 800-command
 * library must not change WHICH command answers a phrase. These tests build the
 * registry twice - once the old synchronous way, once through the deferred slot
 * API - and require the two registries to be identical.
 *
 * Real commands.js, mocked DOM: proves ordering, not browser timing.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const COMMANDS_SRC = fs.readFileSync(
  path.join(__dirname, '../app/src/main/assets/ai/commands.js'),
  'utf8'
);

let passed = 0;
let failed = 0;
const queue = [];

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

function freshCommands() {
  const ctx = { window: { LH_AI: { FS: {}, Memory: {} } } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(COMMANDS_SRC, ctx);
  return ctx.window.LH_AI.Commands;
}

function register(commands, name, pattern) {
  commands.register({ module: 'test', category: 'test', name, match: [new RegExp(pattern, 'i')], run: () => ({ ok: true, message: name }) });
}

function names(commands) {
  return commands.list().map((c) => c.name);
}

// ---- page simulation -------------------------------------------------------
// Mirrors the real index.html: commands.js, commands_extra.js, slot markers for
// the two libraries that sit together, features_critical.js, a slot marker for
// features_knowledge.js, then the rest of the page.
const BEFORE = ['cmd-a', 'cmd-b'];
const EXTRA = ['extra-1', 'extra-2', 'extra-3'];
const JARVIS = ['jarvis-1', 'jarvis-2'];
const CRITICAL = ['critical-1'];
const KNOWLEDGE = ['know-1', 'know-2'];
const AFTER = ['selfdev-1', 'mind-1', 'brain-1'];

function synchronous() {
  const c = freshCommands();
  BEFORE.forEach((n) => register(c, n, n));
  EXTRA.forEach((n) => register(c, n, n));
  JARVIS.forEach((n) => register(c, n, n));
  CRITICAL.forEach((n) => register(c, n, n));
  KNOWLEDGE.forEach((n) => register(c, n, n));
  AFTER.forEach((n) => register(c, n, n));
  return c;
}

function deferred(options) {
  const opts = options || {};
  const c = freshCommands();
  BEFORE.forEach((n) => register(c, n, n));
  c.openLibrary('features_extra');
  c.openLibrary('features_jarvis');
  CRITICAL.forEach((n) => register(c, n, n)); // blocking script between two slots
  c.openLibrary('features_knowledge');
  AFTER.forEach((n) => register(c, n, n));

  const load = (slot, list) => {
    if (opts.skip === slot) {
      c.beginLibrary(slot);
      c.cancelLibrary();
      return 0;
    }
    c.beginLibrary(slot);
    list.forEach((n) => register(c, n, n));
    return c.endLibrary();
  };
  load('features_extra', EXTRA);
  load('features_jarvis', JARVIS);
  load('features_knowledge', KNOWLEDGE);
  return c;
}

it('a deferred library lands in exactly the position it would have had', () => {
  const expected = names(synchronous());
  const actual = names(deferred()).filter((n) => !/^server-|^logs-|^cfg-|^(open|play|show|search|start|stop|restart|what|tell|convert|make|copy|generate|backup|export|clear)/.test(n) === false || true);
  assert.strictEqual(
    JSON.stringify(actual),
    JSON.stringify(expected),
    'deferred registry order drifted from the synchronous registry'
  );
});

it('the registry is byte-identical: same commands, same order, same count', () => {
  const a = names(synchronous());
  const b = names(deferred());
  assert.strictEqual(b.length, a.length, `count changed: ${a.length} -> ${b.length}`);
  assert.strictEqual(JSON.stringify(b), JSON.stringify(a));
  // the interleaving that matters: critical sits between jarvis and knowledge
  const iExtra = b.indexOf('extra-1');
  const iJarvis = b.indexOf('jarvis-1');
  const iCritical = b.indexOf('critical-1');
  const iKnow = b.indexOf('know-1');
  assert.ok(iExtra < iJarvis && iJarvis < iCritical && iCritical < iKnow, 'interleaving broken');
});

it('commands registered while a slot is open are invisible until endLibrary', () => {
  const c = freshCommands();
  BEFORE.forEach((n) => register(c, n, n));
  const base = names(c).length; // commands.js itself registers core commands
  c.openLibrary('lib');
  c.beginLibrary('lib');
  register(c, 'hidden-1', 'hidden1');
  assert.strictEqual(names(c).indexOf('hidden-1'), -1, 'staged command leaked into the live registry');
  assert.strictEqual(c.endLibrary(), 1);
  const at = names(c).indexOf('hidden-1');
  assert.notStrictEqual(at, -1, 'command never landed');
  assert.strictEqual(at, base, 'landed in the wrong position');
});

it('cancelLibrary drops a failed library and leaves no hole', () => {
  const expected = names(synchronous());
  const withoutJarvis = names(deferred({ skip: 'features_jarvis' }));
  assert.ok(!withoutJarvis.includes('jarvis-1'), 'cancelled library must not register');
  const reduced = expected.filter((n) => !JARVIS.includes(n));
  assert.strictEqual(JSON.stringify(withoutJarvis), JSON.stringify(reduced), 'cancelling shifted other commands');
});

it('a slot opened without a marker degrades to append-at-end, it never throws', () => {
  const c = freshCommands();
  BEFORE.forEach((n) => register(c, n, n));
  c.beginLibrary('unmarked');
  register(c, 'late-1', 'late1');
  c.endLibrary();
  assert.strictEqual(names(c).indexOf('late-1'), names(c).length - 1);
});

it('parse() resolves the same command for a tie, deferred or not', () => {
  const sync = synchronous();
  const def = deferred();
  ['extra-2', 'jarvis-1', 'critical-1', 'know-2', 'mind-1', 'unknown phrase'].forEach((phrase) => {
    const a = sync.parse(phrase);
    const b = def.parse(phrase);
    const nameA = a && a.command ? a.command.name : null;
    const nameB = b && b.command ? b.command.name : null;
    assert.strictEqual(nameB, nameA, `different winner for "${phrase}": ${nameA} vs ${nameB}`);
  });
});

it('index.html declares a slot marker for every deferred library', () => {
  const html = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/ai/index.html'), 'utf8');
  const loader = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/ai/library_loader.js'), 'utf8');
  const slots = [...loader.matchAll(/slot:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(slots.length === 3, 'loader must declare three slots');
  slots.forEach((slot) => {
    assert.ok(
      html.includes(`LH_AI.Commands.openLibrary("${slot}")`),
      `index.html is missing the slot marker for ${slot}`
    );
    assert.ok(!html.includes(`<script src="/ai/${slot}.js">`), `${slot} must not be a blocking tag`);
  });
});

Promise.all(queue).then(() => {
  console.log(
    `\n${passed} deferred-slot scenarios passed, ${failed} failed. Real commands.js; DOM is mocked.`
  );
});
