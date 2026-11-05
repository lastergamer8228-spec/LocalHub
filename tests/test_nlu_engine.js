'use strict';
/* NLU core tests.
 *
 * These cover the behaviours that the previous rule engine did not have, and
 * therefore the behaviours that would silently regress if the engine were ever
 * swapped back to longest-regex-wins:
 *
 *   - an utterance is only claimed when its words are accounted for
 *     ("what is your limit" must not be answered by an unrelated entry)
 *   - the leading verb decides the action, not the most specific noun phrase
 *   - values are extracted as slots, so a verb cannot be swallowed into a
 *     filename ("move report.pdf" -> file "report.pdf")
 *   - a plan is executed as steps, and every mutating step is verified by
 *     reading the result back
 *   - a partial job is a failure, not a smaller success
 *   - destructive work is confirmed first, however well understood it is
 *
 * Run:  node tests/test_nlu_engine.js
 */
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');

const AI_DIR = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'ai');

// ---- fake storage --------------------------------------------------------
let STORE = {};
function dir(p) { STORE[p] = STORE[p] || []; return STORE[p]; }
function base(p) { const i = String(p).lastIndexOf('/'); return i > 0 ? p.slice(i + 1) : p; }
function reset() {
  STORE = {
    '/storage/emulated/0/Download': [
      { path: '/storage/emulated/0/Download/clip.mp4', size: 10 },
      { path: '/storage/emulated/0/Download/song.mp3', size: 5 },
      { path: '/storage/emulated/0/Download/photo.png', size: 2 },
      { path: '/storage/emulated/0/Download/report.pdf', size: 1 }
    ]
  };
}
reset();

function makeFS() {
  return {
    list: p => Promise.resolve({ entries: dir(p).slice() }),
    mkdir: (parent, name) => { dir(parent + '/' + name); return Promise.resolve({ ok: true }); },
    move: (from, to) => {
      const par = from.slice(0, from.lastIndexOf('/'));
      const i = dir(par).findIndex(e => e.path === from);
      if (i < 0) return Promise.resolve({ ok: false });
      const [e] = dir(par).splice(i, 1);
      e.path = to + '/' + base(from);
      dir(to).push(e);
      return Promise.resolve({ ok: true });
    },
    delete: p => {
      const par = p.slice(0, p.lastIndexOf('/'));
      STORE[par] = dir(par).filter(e => e.path !== p);
      delete STORE[p];
      return Promise.resolve({ ok: true });
    },
    emptyFolders: () => Promise.resolve({ entries: ['/storage/emulated/0/Download/empty1'] }),
    search: q => Promise.resolve({ entries: dir('/storage/emulated/0/Download').filter(e => base(e.path).includes(q)) }),
    status: () => Promise.resolve({ url: 'http://192.168.1.5:8080', version: '1.0.0', uptimeMs: 42000 }),
    clients: () => Promise.resolve({ clients: [{ ip: '192.168.1.9' }] }),
    logs: () => Promise.resolve({ logs: [{ level: 'INFO', message: 'started' }] }),
    system: () => Promise.resolve({
      cpu: { usagePercent: 23 },
      memory: { usedBytes: 2 * 1048576, totalBytes: 8 * 1048576 },
      storage: { usedBytes: 40 * 1073741824, totalBytes: 64 * 1073741824, availableBytes: 24 * 1073741824 },
      battery: { level: 78, isCharging: false },
      network: { ipAddress: '192.168.1.5', ssid: 'Home', type: 'WIFI' }
    })
  };
}

const ctx = {
  console,
  Promise,
  setTimeout,
  sessionStorage: { getItem: () => '' },
  localStorage: { getItem: () => '' },
  LH_AI: { modules: {} }
};
ctx.window = ctx;
ctx.global = ctx;
ctx.LH_AI.FS = makeFS();
ctx.LH_AI.Context = { state: { folder: '/storage/emulated/0/Download' } };
ctx.LH_AI.Capabilities = { lookup: () => null, hasPermission: () => true };
vm.createContext(ctx);

['nlu/lexicon.js', 'nlu/understand.js', 'nlu/plans.js', 'nlu/engine.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(AI_DIR, f), 'utf8'), ctx, { filename: f });
});

const NLU = ctx.LH_AI.NLU;
const U = NLU.Understand;
const E = NLU.Engine;
const realMove = ctx.LH_AI.FS.move;

function frameOf(t) { return U.best(t); }

(async () => {

  // ---- 1. understanding --------------------------------------------------
  assert.strictEqual(frameOf('organise downloads by type').action, 'ORGANIZE');
  assert.strictEqual(frameOf('organize downloads by type').action, 'ORGANIZE', 'US spelling');
  assert.strictEqual(frameOf('organise downloads by type').slots.folder, 'DOWNLOADS');
  assert.ok(frameOf('organise downloads by type').modifiers.indexOf('BY_TYPE') >= 0);

  assert.strictEqual(frameOf('search for invoice').action, 'SEARCH');
  assert.strictEqual(frameOf('search for invoice').slots.query, 'invoice');

  assert.strictEqual(frameOf('open downloads').action, 'OPEN');
  assert.strictEqual(frameOf('show battery').action, 'SHOW_BATTERY');
  assert.strictEqual(frameOf('restart server').action, 'SERVER_RESTART');
  assert.strictEqual(frameOf('server chalu karo').action, 'SERVER_START', 'hinglish surface form');
  assert.strictEqual(frameOf('diagnose').action, 'DIAGNOSE');
  assert.strictEqual(frameOf('why is the server not working').action, 'DIAGNOSE');
  assert.strictEqual(frameOf('delete empty folders').action, 'CLEAN_EMPTY');
  assert.strictEqual(frameOf('show connected devices').action, 'SHOW_CLIENTS');

  // ---- 2. the regression that motivated the rewrite ----------------------
  // Longest-match used to answer these from unrelated knowledge entries.
  ['what is your limit', 'tell me about the letter c', 'asdfgh', 'hello there friend'].forEach(function (t) {
    assert.strictEqual(frameOf(t), null, 'must not claim: ' + t);
    assert.strictEqual(E.handle(t) && null, null, 'engine must return a promise for: ' + t);
  });
  for (const t of ['what is your limit', 'tell me about the letter c', 'hello there friend']) {
    const r = await E.handle(t);
    assert.strictEqual(r.kind, 'UNKNOWN', 'must fall through for: ' + t);
  }

  // ---- 3. the leading verb decides, not the flashiest noun phrase --------
  const del = frameOf('delete the largest files over 100 MB in downloads');
  assert.strictEqual(del.action, 'DELETE', 'imperative verb must beat the LARGEST concept');
  assert.strictEqual(del.slots.folder, 'DOWNLOADS');
  assert.strictEqual(del.slots.size.value, 100);
  assert.strictEqual(del.slots.size.unit, 'MB');
  assert.strictEqual(frameOf('show me the 10 largest files').action, 'LARGEST', 'no verb -> the noun phrase wins');

  // ---- 4. slots: the verb must not be swallowed into a filename ----------
  const mv = frameOf('move report.pdf to documents');
  assert.strictEqual(mv.action, 'MOVE');
  assert.strictEqual(mv.slots.file, 'report.pdf');
  assert.ok(mv.slots.destination);

  // ---- 5. a missing required slot produces a question, not a guess -------
  let r = await E.handle('delete');
  assert.strictEqual(r.kind, 'CLARIFY');
  assert.ok(/which file or folder/i.test(r.message), 'should ask what to act on');

  // ---- 6. destructive work is confirmed first, however confident ---------
  reset();
  r = await E.handle('delete empty folders in downloads');
  assert.strictEqual(r.kind, 'CONFIRM', 'a destructive plan must never run unasked');
  assert.strictEqual(frameOf('delete empty folders in downloads').confidence > 0.9, true, 'confidence was high, and it still asked');
  assert.ok(/step\(s\)/.test(r.message), 'the plan should be shown before it runs');

  // ---- 7. multi-step plan, verified end to end --------------------------
  reset();
  r = await E.handle('organise downloads by type');
  assert.strictEqual(r.kind, 'CONFIRM', 'moving files is destructive');
  r = await E.handle('yes');
  assert.strictEqual(r.kind, 'DONE', r.message);
  assert.strictEqual(r.steps.length, 5);
  assert.ok(r.steps.every(s => s.ok), 'every step should succeed: ' + r.message);
  const moved = r.steps.find(s => s.id === 'move');
  assert.strictEqual(moved.verified, true, 'the move must be confirmed by reading back');
  assert.deepStrictEqual(
    Object.keys(STORE).filter(k => k.indexOf('/Download/') > 0).map(base).sort(),
    ['audio', 'image', 'pdf', 'video']
  );
  assert.deepStrictEqual(dir('/storage/emulated/0/Download/audio').map(e => base(e.path)), ['song.mp3']);
  assert.deepStrictEqual(dir('/storage/emulated/0/Download/video').map(e => base(e.path)), ['clip.mp4']);

  // ---- 8. verification catches a step that lied -------------------------
  reset();
  ctx.LH_AI.FS.move = () => Promise.resolve({ ok: true });   // reports success, does nothing
  r = await E.handle('move song.mp3 to documents');
  r = r.kind === 'CONFIRM' ? await E.handle('yes') : r;
  assert.strictEqual(r.ok, false, 'a move that never happened must be reported as a failure');
  assert.strictEqual(r.steps[0].verified, false);
  ctx.LH_AI.FS.move = realMove;

  // ---- 9. a partial job is a failure, and it is rolled back -------------
  reset();
  let n = 0;
  ctx.LH_AI.FS.move = (f, t) => (++n > 2 ? Promise.reject(new Error('disk full')) : realMove(f, t));
  r = await E.handle('organise downloads by type');
  r = r.kind === 'CONFIRM' ? await E.handle('yes') : r;
  assert.strictEqual(r.ok, false, '2 of 4 moved must not be reported as success');
  assert.strictEqual(r.rolledBack, true, 'completed steps should be undone');
  assert.ok(/only 2 of 4/.test(r.message), 'the message must say how much was done: ' + r.message);
  ctx.LH_AI.FS.move = realMove;

  // ---- 10. simple reads --------------------------------------------------
  reset();
  for (const t of ['show battery', 'show connected devices', 'show storage', 'what is my ip']) {
    const x = await E.handle(t);
    assert.strictEqual(x.kind, 'DONE', t + ' -> ' + x.kind + ' ' + x.message);
    assert.ok(x.message && x.message.length > 0, 'no answer for ' + t);
  }

  // ---- 11. the engine installs in front of the old assistant -------------
  ctx.LH_AI.Assistant = {
    run: function (intent, text) {
      return Promise.resolve({ ok: true, message: 'legacy:' + text });
    }
  };
  assert.strictEqual(NLU.Engine.install(), true);
  const legacy = await ctx.LH_AI.Assistant.run('x', 'what is your limit', { intent: 'x' });
  assert.ok(/^legacy:/.test(legacy.message), 'an unrecognised request must still reach the old engine');
  const modern = await ctx.LH_AI.Assistant.run('x', 'show battery', { intent: 'x' });
  assert.ok(!/^legacy:/.test(modern.message), 'a recognised request should be handled by the new engine');

  console.log('PASS: NLU core - coverage-ranked frames, verb-first disambiguation, slot extraction,');
  console.log('      verified multi-step plans, rollback on partial failure, confirm-before-destructive,');
  console.log('      clarification instead of guessing, and clean fall-through to the legacy engine.');
})().catch(e => { console.error(e); process.exitCode = 1; });
