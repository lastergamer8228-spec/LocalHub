'use strict';
/* Regenerate the command-library regression baseline after intentional curation.
 * Format matches tests/library-baseline.json (file, commands, staticRows, sha256).
 *
 * Safety properties:
 *  - the VM context is byte-identical to tests/test_command_libraries.js, so a
 *    handler behaves exactly the same during generation and during verification;
 *  - every handler invocation is wrapped in try/catch, so a handler that needs a
 *    browser-era helper is simply fingerprinted by source text instead of result;
 *  - the generator is deterministic: re-running the library test must pass.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const DIR = path.join(__dirname, '../../app/src/main/assets/ai');
const OUT = path.join(__dirname, '../library-baseline.json');
const FILES = ['features_jarvis.js', 'features_extra.js', 'features_knowledge.js'];

function loadSpecs(text) {
  const specs = [];
  const context = { window: { LH_AI: { Commands: { register(spec) { specs.push(spec); } }, FS: {} } } };
  vm.createContext(context);
  vm.runInContext(text, context);
  return specs;
}

function call(spec, arg) {
  try {
    const out = spec.run(arg);
    return { ok: true, value: out };
  } catch (err) {
    return { ok: false, error: String(err && err.message) };
  }
}

const baseline = [];
let total = 0;
let dynamicCount = 0;
for (const file of FILES) {
  const specs = loadSpecs(fs.readFileSync(path.join(DIR, file), 'utf8'));
  total += specs.length;
  const staticRows = [];
  specs.forEach((spec, index) => {
    const a = call(spec, '');
    const b = call(spec, 'something else entirely 42');
    const same =
      a.ok &&
      b.ok &&
      a.value &&
      b.value &&
      typeof a.value === 'object' &&
      typeof b.value === 'object' &&
      a.value.ok === b.value.ok &&
      a.value.message === b.value.message &&
      JSON.stringify(a.value) === JSON.stringify(b.value);
    if (same) staticRows.push(index);
    else dynamicCount++;
  });
  const rows = specs.map((spec, index) => {
    const meta = {};
    for (const key of Object.keys(spec).sort()) {
      if (key === 'run') continue;
      meta[key] = key === 'match' ? Array.from(spec.match, (r) => [r.source, r.flags]) : spec[key];
    }
    return { meta, handler: staticRows.includes(index) ? call(spec, '').value : String(spec.run) };
  });
  const sha256 = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  baseline.push({ file, commands: specs.length, staticRows, sha256 });
  console.log(
    `${file}: commands=${specs.length} staticRows=${staticRows.length} dynamic=${specs.length - staticRows.length} sha256=${sha256.slice(0, 12)}`
  );
}

fs.writeFileSync(OUT, JSON.stringify(baseline));
console.log(
  `Baseline regenerated for ${baseline.length} libraries · total commands=${total} · dynamic handlers=${dynamicCount}`
);
