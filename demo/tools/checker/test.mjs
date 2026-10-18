// Runs the checker on both fixtures and asserts the expected findings.
// usage: node tools/checker/test.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(new URL(import.meta.url).pathname);
const run = (fixture) => {
  const report = fs.mkdtempSync(path.join(os.tmpdir(), `gv-check-${fixture}-`));
  const p = spawnSync(process.execPath, [path.join(here, 'check.mjs'), '--content', path.join(here, 'fixtures', fixture), '--report', report, '--json'], { encoding: 'utf8' });
  assert.ok(fs.existsSync(path.join(report, 'index.html')), `${fixture}: index.html written`);
  assert.ok(fs.existsSync(path.join(report, 'results.json')), `${fixture}: results.json written`);
  return { code: p.status, result: JSON.parse(p.stdout), stderr: p.stderr };
};
let failures = 0;
const t = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}\n     ${e.message}`); } };

const good = run('good');
t('good: exit 0', () => assert.equal(good.code, 0, good.stderr));
t('good: no errors or warnings', () => assert.deepEqual(good.result.diagnostics.filter(d => d.severity !== 'info'), []));
t('good: both NPCs analysed with coverage > 0', () => {
  assert.deepEqual(good.result.npcs.map(n => n.id), ['alice', 'bob']);
  for (const n of good.result.npcs) assert.ok(n.coverage > 0 && n.coverage < 1, `${n.id} coverage ${n.coverage}`);
});
t('good: every row has a witness within budget', () => {
  for (const n of good.result.npcs) for (const [id, r] of Object.entries(n.rows)) assert.ok(r.witness && r.cost <= 40, `${n.id}/${id}`);
});
t('good: follow-up row A2 reached via next, invite row A4 reached', () => {
  const a = good.result.npcs.find(n => n.id === 'alice');
  assert.match(a.rows.A2.witness, /A1\/choice1 → A2/);
  assert.match(a.rows.A4.witness, /→ A4/);
});

const bad = run('bad');
const find = (code, file, row) => bad.result.diagnostics.filter(d => d.code === code && d.file === file && (row == null || d.row === row));
t('bad: exit 1', () => assert.equal(bad.code, 1));
t('bad: tie between C2 and C3', () => { const d = find('TIE', 'dialogue/carol.csv', 'C2,C3'); assert.equal(d.length, 1); assert.equal(d[0].severity, 'error'); assert.equal(d[0].cells, 9); });
t('bad: C4 shadowed (never wins, warning)', () => { const d = find('NEVER_WINS', 'dialogue/carol.csv', 'C4'); assert.equal(d.length, 1); assert.equal(d[0].severity, 'warning'); assert.match(d[0].message, /C5/); });
t('bad: C6 unreachable', () => { const d = find('UNREACHABLE', 'dialogue/carol.csv', 'C6'); assert.equal(d.length, 1); assert.equal(d[0].severity, 'error'); });
t('bad: dangling next on C1 next2', () => { const d = find('DANGLING_NEXT', 'dialogue/carol.csv', 'C1'); assert.equal(d.length, 1); assert.equal(d[0].column, 'next2'); assert.equal(d[0].line, 3); assert.match(d[0].message, /C99/); });
t('bad: unknown effect token on C3 effect1', () => { const d = find('UNKNOWN_EFFECT', 'dialogue/carol.csv', 'C3'); assert.equal(d.length, 1); assert.equal(d[0].column, 'effect1'); assert.match(d[0].message, /trust \+1/); });
t('bad: dave has no fallback', () => assert.equal(find('MISSING_FALLBACK', 'dialogue/dave.csv').length, 1));
t('bad: nothing else is reported', () => {
  const codes = bad.result.diagnostics.filter(d => d.severity !== 'info').map(d => d.code).sort();
  assert.deepEqual(codes, ['DANGLING_NEXT', 'MISSING_FALLBACK', 'NEVER_WINS', 'TIE', 'UNKNOWN_EFFECT', 'UNREACHABLE']);
});
t('bad: C3 (tie partner) is still reachable via C5/choice1', () => {
  const c = bad.result.npcs.find(n => n.id === 'carol');
  assert.ok(c.rows.C3.witness.includes('C5/choice1'), c.rows.C3.witness);
});

console.log(failures ? `\n${failures} test(s) failed` : '\nall tests passed');
process.exit(failures ? 1 : 0);
