// Runs the checker on both fixtures and asserts the expected findings.
// usage: node tools/checker/test.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(new URL(import.meta.url).pathname);
const run = (fixture, extra = []) => {
  const report = fs.mkdtempSync(path.join(os.tmpdir(), `gv-check-${fixture}-`));
  const p = spawnSync(process.execPath, [path.join(here, 'check.mjs'), '--content', path.join(here, 'fixtures', fixture), '--report', report, '--json', ...extra], { encoding: 'utf8' });
  assert.ok(fs.existsSync(path.join(report, 'index.html')), `${fixture}: index.html written`);
  assert.ok(fs.existsSync(path.join(report, 'results.json')), `${fixture}: results.json written`);
  return { code: p.status, result: JSON.parse(p.stdout), full: JSON.parse(fs.readFileSync(path.join(report, 'results.json'), 'utf8')), stderr: p.stderr };
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
  assert.match(a.rows.A2.witness, /A1\/choice1 \(\+0\) → A2/);
  assert.match(a.rows.A4.witness, /→ A4/);
});
t('good: short conversations are free, a depth-3 opening costs 1 (engine rowDepth rule)', () => {
  const a = good.result.npcs.find(n => n.id === 'alice'), b = good.result.npcs.find(n => n.id === 'bob');
  assert.equal(a.rows.A1.depth, 2); assert.equal(a.rows.A2.cost, 0, a.rows.A2.witness); // A1 -> A2 is depth 2: free
  assert.equal(b.rows.B3.depth, 3); // B3 -> B4 -> B5
  assert.equal(b.rows.B3.cost, 1, b.rows.B3.witness); // B1 free, B2 free + actions -1
  // one conversation per day (default limit): B2 is a late-phase row, so the path waits for day 4
  assert.match(b.rows.B3.witness, /B1\/choice1 \(\+0\) → day 4 → B2\/choice1 \(\+1\) → day 5 → B3/);
  assert.equal(b.rows.B4.cost, 2, b.rows.B4.witness); // opening B3 costs 1
  assert.match(b.rows.B5.witness, /B3\/choice1 \(\+1\) → B4\/choice1 \(\+0\) → B5/);
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

const place = run('place');
const pfind = (code, file, row) => place.result.diagnostics.filter(d => d.code === code && d.file === file && (row == null || d.row === row));
const erin = place.result.npcs.find(n => n.id === 'erin');
t('place: exit 1, exactly the expected findings', () => {
  assert.equal(place.code, 1);
  const codes = place.result.diagnostics.filter(d => d.severity !== 'info').map(d => `${d.code}:${d.row ?? ''}`).sort();
  assert.deepEqual(codes, ['LIMIT_UNREACHABLE:E6', 'SCENE_NOT_APPEARED:E5', 'SEATED_SLOT:', 'TIE:E8,E9', 'UNKNOWN_SCENE:E4']);
});
t('place: scene column accepted after dayPhase, no column errors', () => assert.equal(place.result.diagnostics.filter(d => /COLUMN/.test(d.code)).length, 0));
t('place: completeness per scene (erin: home, park; frank: park, work, home via event)', () => {
  assert.deepEqual(erin.scenes.map(s => s.scene), ['home', 'park']);
  const frank = place.result.npcs.find(n => n.id === 'frank');
  assert.deepEqual(frank.scenes.map(s => s.scene), ['park', 'work', 'home']);
  assert.deepEqual(frank.talkScenes, ['park', 'work']);
  for (const n of [erin, frank]) for (const s of n.scenes) assert.equal(s.noMatch, 0);
});
t('place: located row E2 wins in park, never at home (specificity +1 for scene)', () => {
  const cells = place.full.npcs.find(n => n.id === 'erin').sceneCells;
  const won = (sc) => cells[sc].filter(c => c.row === 'E2').length;
  assert.ok(won('park') > 0); assert.equal(won('home'), 0);
  assert.equal(cells.park.find(c => c.row === 'E2').spec, 2);
});
t('place: tie only in the scene where both rows match', () => {
  const d = pfind('TIE', 'dialogue/erin.csv', 'E8,E9'); assert.equal(d.length, 1); assert.deepEqual(d[0].scenes, ['park']);
});
t('place: SEATED_SLOT names the seated default figure on the standing slot, not the standing override', () => {
  const d = place.result.diagnostics.filter(x => x.code === 'SEATED_SLOT');
  assert.equal(d.length, 1); assert.match(d[0].message, /ch_frank_fig_sit.*"stand" in park/); assert.match(d[0].path, /appearances\[1\]/);
});
t('place: E6 (rapport 3 while early) unreachable with 1 talk/day, reachable without the limit', () => {
  assert.equal(erin.rows.E6.cost, null); assert.equal(erin.rows.E6.costNoLimit, 0); assert.deepEqual(erin.limitUnreachable, ['E6']);
});
const place2 = run('place', ['--talks', '2']);
t('place --talks 2: E6 becomes reachable (two conversations on day 1)', () => {
  const e = place2.result.npcs.find(n => n.id === 'erin');
  assert.equal(place2.result.maxTalks, 2);
  assert.ok(e.rows.E6.witness, 'witness'); assert.deepEqual(e.limitUnreachable, []);
  assert.equal(place2.result.diagnostics.filter(d => d.code === 'LIMIT_UNREACHABLE').length, 0);
});

// SPEC "Character profiles": the good fixture with profiles added (one valid, one with bad values and an unknown key)
const profDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-check-profile-'));
fs.cpSync(path.join(here, 'fixtures', 'good'), profDir, { recursive: true });
const npcsY = fs.readFileSync(path.join(profDir, 'npcs.yaml'), 'utf8')
  .replace('    portrait: ch_alice\n', '    profile:\n      integrationLean: 4\n      warmth: 8\n      talkative: 7\n      backstory: "Three sentences. Of backstory. Here."\n      motivation: "Wants the player to stay."\n      voice: "Short sentences."\n      topics: [lunch, school]\n      avoid: [money]\n    portrait: ch_alice\n')
  .replace('    portrait: ch_bob\n', '    profile:\n      warmth: 11\n      talkative: "lots"\n      topics: chess\n      voice: [a, b]\n      mood: grumpy\n    portrait: ch_bob\n');
fs.writeFileSync(path.join(profDir, 'npcs.yaml'), npcsY);
const profReport = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-check-profile-report-'));
const prof = JSON.parse(spawnSync(process.execPath, [path.join(here, 'check.mjs'), '--content', profDir, '--report', profReport, '--json'], { encoding: 'utf8' }).stdout);
t('profile: valid profile passes; bad ranges, types and unknown keys are reported', () => {
  const d = prof.diagnostics.filter(x => /profile/.test(x.path || '')).map(x => `${x.severity}:${x.code}:${x.path}`).sort();
  assert.deepEqual(d, [
    'error:BAD_VALUE:npcs[1].profile.talkative', 'error:BAD_VALUE:npcs[1].profile.topics', 'error:BAD_VALUE:npcs[1].profile.voice',
    'error:BAD_VALUE:npcs[1].profile.warmth', 'warning:PROFILE_KEY:npcs[1].profile.mood',
  ]);
});

// SPEC "Stances" and "Packs": the good fixture with an mx scene, an assimilation stance, a bad stance and a bad pack
const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-check-pack-'));
fs.cpSync(path.join(here, 'fixtures', 'good'), packDir, { recursive: true });
const centerMx = '  - id: center_mx\n    name: Center\n    community: home\n    pack: mx\n    background: none\n    description: "x"\n    exits: []\n    slots: []\n';
const centerCn = '  - id: center_cn\n    name: Center\n    community: home\n    pack: cn\n    background: none\n    description: "x"\n    exits: []\n    slots: []\n';
const runPack = (scenesExtra, npcsFn) => {
  fs.writeFileSync(path.join(packDir, 'scenes.yaml'), fs.readFileSync(path.join(here, 'fixtures', 'good', 'scenes.yaml'), 'utf8') + scenesExtra);
  fs.writeFileSync(path.join(packDir, 'npcs.yaml'), npcsFn(fs.readFileSync(path.join(here, 'fixtures', 'good', 'npcs.yaml'), 'utf8')));
  const rep = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-check-pack-report-'));
  return JSON.parse(spawnSync(process.execPath, [path.join(here, 'check.mjs'), '--content', packDir, '--report', rep, '--json'], { encoding: 'utf8' }).stdout);
};
const nonInfo = (r) => r.diagnostics.filter(d => d.severity !== 'info').map(d => `${d.severity}:${d.code}:${d.path ?? ''}`).sort();
// alice becomes an assimilationist (valid); an mx scene exists but nobody is mx yet
const pk1 = runPack(centerMx + centerCn, (y) => y.replace('    stance: none\n', '    stance: assimilation\n'));
t('pack: stance assimilation accepted; mx scene without mx NPCs warns and mx players fall back to cn', () => {
  assert.deepEqual(nonInfo(pk1), ['warning:PACK_INCOMPLETE:npcs']);
  assert.deepEqual(pk1.packs.mx, { culture: 'mx', pack: 'cn', fallback: true, scenes: ['home', 'center_cn'] });
  assert.deepEqual(pk1.packs.cn.scenes, ['home', 'center_cn']);
});
// bob moves to mx: mx is now playable; cn players no longer see center_mx; bad stance and bad pack are errors
const pk2 = runPack(centerMx + centerCn.replace('pack: cn', 'pack: xx'), (y) => y.replace('    pack: cn\n', '    pack: mx\n').replace(/(id: bob[\s\S]*?)stance: none/, '$1stance: marginalization'));
t('pack: mx playable once it has an NPC and a scene; shared + own-pack scenes only; bad stance / pack are errors', () => {
  assert.deepEqual(pk2.packs.mx, { culture: 'mx', pack: 'mx', fallback: false, scenes: ['home', 'center_mx'] });
  assert.deepEqual(pk2.packs.cn, { culture: 'cn', pack: 'cn', fallback: false, scenes: ['home'] });
  assert.deepEqual(pk2.packs.in.pack, 'cn');
  assert.deepEqual(nonInfo(pk2), ['error:BAD_VALUE:npcs[1].stance', 'error:BAD_VALUE:scenes[2].pack']);
});
// an mx NPC but no mx scene: warning, mx falls back
const pk3 = runPack('', (y) => y.replace('    pack: cn\n', '    pack: mx\n'));
t('pack: mx NPCs without an mx scene warn and fall back', () => {
  assert.deepEqual(nonInfo(pk3), ['warning:PACK_INCOMPLETE:scenes']);
  assert.equal(pk3.packs.mx.pack, 'cn');
});

console.log(failures ? `\n${failures} test(s) failed` : '\nall tests passed');
process.exit(failures ? 1 : 0);
