/* Behavioural fingerprints captured from the pre-refactor command libraries.
 * Protect ordering, metadata, regex sources/flags, static results and executable
 * handler source. Does not establish that every stored answer is factually good.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');
const baseline = require('./library-baseline.json');
for (const expected of baseline) {
  const specs = [];
  const context = { window: { LH_AI: { Commands: { register(spec) { specs.push(spec); } }, FS: {} } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/src/main/assets/ai', expected.file), 'utf8'), context);
  assert.equal(specs.length, expected.commands);
  const staticRows = new Set(expected.staticRows);
  const rows = specs.map((spec, index) => {
    const meta = {};
    for (const key of Object.keys(spec).sort()) {
      if (key !== 'run') meta[key] = key === 'match' ? Array.from(spec.match, r => [r.source, r.flags]) : spec[key];
    }
    if (staticRows.has(index)) assert.notStrictEqual(spec.run(''), spec.run(''), 'Reply must be a fresh object');
    return { meta, handler: staticRows.has(index) ? spec.run('') : String(spec.run) };
  });
  const actual = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  assert.equal(actual, expected.sha256, expected.file + ' registration/handler behaviour changed');
  console.log('PASS', expected.file, specs.length, 'registrations match baseline');
}
