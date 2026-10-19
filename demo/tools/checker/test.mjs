// Runs the checker on both fixtures and asserts the expected findings.
// usage: node tools/checker/test.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { optionCharge, parseEffects } from './core.mjs';

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
t('good: leads: B12 (usLead anti) wins cells only in anti rooms, is reachable, and ties with nobody (SPEC "Leads")', () => {
  const b = good.result.npcs.find(n => n.id === 'bob');
  assert.ok(b.winCount.B12 > 0, `B12 wins ${b.winCount.B12}`);
  assert.ok(b.rows.B12.cost != null, 'B12 reachable');
  assert.equal(good.full.npcs.find(n => n.id === 'bob').cells.filter(c => c.row === 'B12').length, 0, 'baseline (pro/pro) grid never shows B12');
  assert.equal(good.result.diagnostics.filter(d => d.code === 'TIE').length, 0);
});
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
t('good: pay when you stay: starting and turns 1-3 free, the edge into turn 4 costs 1 once (engine optionCharge rule)', () => {
  const a = good.result.npcs.find(n => n.id === 'alice'), b = good.result.npcs.find(n => n.id === 'bob');
  assert.equal(a.rows.A2.cost, 0, a.rows.A2.witness); // A1 -> A2: turn 2, free
  assert.equal(b.rows.B3.depth, 4); // B3 -> B4 -> B5 -> B6 -> B7 (capped at 4: can reach the paid turn)
  assert.equal(b.rows.B3.cost, 1, b.rows.B3.witness); // B1 free, B2 free + actions -1; opening B3 is free
  // one conversation per day (default limit): B2 is a late-phase row, so the path waits for day 4
  assert.match(b.rows.B3.witness, /B1\/choice1 \(\+0\) → day 4 → B2\/choice1 \(\+1\) → day 5 → B3/);
  assert.equal(b.rows.B4.cost, 1, b.rows.B4.witness); // turn 2: free
  assert.equal(b.rows.B5.cost, 1, b.rows.B5.witness); // turn 3: free
  assert.match(b.rows.B5.witness, /B3\/choice1 \(\+0\) → B4\/choice1 \(\+0\) → B5/);
  assert.equal(b.rows.B6.cost, 2, b.rows.B6.witness); // turn 4: the stay charge
  assert.match(b.rows.B6.witness, /B5\/choice2 \(\+1\) → B6/);
  assert.equal(b.rows.B7.cost, 2, b.rows.B7.witness); // turn 5: already paid, free
  assert.match(b.rows.B7.witness, /B6\/choice1 \(\+0\) → B7/);
});
t('good: explicit `cost N` on an option; max(explicit, stay) when both apply, and the stay then counts as paid', () => {
  const b = good.result.npcs.find(n => n.id === 'bob');
  assert.equal(b.rows.B11.cost, 2, b.rows.B11.witness); // B4/choice2 `cost 1` on turn 2 -> 3
  assert.match(b.rows.B11.witness, /B4\/choice2 \(\+1\) → B11/);
  assert.equal(b.rows.B9.cost, 3, b.rows.B9.witness); // B5/choice3 `cost 2` into turn 4: max(2, 1) = 2, not 3
  assert.match(b.rows.B9.witness, /B5\/choice3 \(\+2\) → B9/);
  assert.equal(b.rows.B10.cost, 3, b.rows.B10.witness); // turn 5 after the explicit charge: no stay charge on top
  // the mirror itself: (ops, leadsOn, turn of the row the option is on)
  const c = (e, leads, turn) => optionCharge(parseEffects(e).ops, leads, turn);
  assert.deepEqual([1, 2, 3, 4, 5].map(t => c('', true, t)), [0, 0, 1, 0, 0]);
  assert.equal(c('', false, 3), 0); // leaving on turn 3 is free
  assert.equal(c('cost 2', true, 1), 2); assert.equal(c('cost 2; rapport +1', true, 3), 2); assert.equal(c('cost 1', true, 3), 1);
  assert.equal(c('cost 2', false, 2), 2); // an explicit ask is charged even when it ends the conversation
  assert.deepEqual(parseEffects('cost x').errors.map(e => e.slice(0, 9)), ['BAD_VALUE']);
});

const bad = run('bad');
const find = (code, file, row) => bad.result.diagnostics.filter(d => d.code === code && d.file === file && (row == null || d.row === row));
t('bad: exit 1', () => assert.equal(bad.code, 1));
t('bad: tie between C2 and C3', () => { const d = find('TIE', 'dialogue/carol.csv', 'C2,C3'); assert.equal(d.length, 1); assert.equal(d[0].severity, 'error'); assert.equal(d[0].cells, 9); });
t('bad: C4 shadowed (never wins, warning)', () => { const d = find('NEVER_WINS', 'dialogue/carol.csv', 'C4'); assert.equal(d.length, 1); assert.equal(d[0].severity, 'warning'); assert.match(d[0].message, /C5/); });
t('bad: C6 unreachable', () => { const d = find('UNREACHABLE', 'dialogue/carol.csv', 'C6'); assert.equal(d.length, 1); assert.equal(d[0].severity, 'error'); });
t('bad: dangling next on C1 next2', () => { const d = find('DANGLING_NEXT', 'dialogue/carol.csv', 'C1'); assert.equal(d.length, 1); assert.equal(d[0].column, 'next2'); assert.equal(d[0].line, 3); assert.match(d[0].message, /C99/); });
t('bad: unknown effect token on C3 effect1', () => { const d = find('UNKNOWN_EFFECT', 'dialogue/carol.csv', 'C3'); assert.equal(d.length, 1); assert.equal(d[0].column, 'effect1'); assert.match(d[0].message, /trust \+1/); });
t('bad: malformed `cost -1` on C2 effect1 is BAD_VALUE', () => { const d = find('BAD_VALUE', 'dialogue/carol.csv', 'C2'); assert.equal(d.length, 1); assert.equal(d[0].column, 'effect1'); assert.match(d[0].message, /cost -1/); });
t('bad: C4 beats: unknown [angry] tag and an empty beat are BAD_VALUE, five beats a BEATS warning', () => {
  const d = find('BAD_VALUE', 'dialogue/carol.csv', 'C4'); assert.equal(d.length, 2); assert.ok(d.every(x => x.column === 'line'));
  assert.ok(d.some(x => /\[angry\]/.test(x.message)) && d.some(x => /empty beat/.test(x.message)), d.map(x => x.message).join(' | '));
  const w = find('BEATS', 'dialogue/carol.csv', 'C4'); assert.equal(w.length, 1); assert.equal(w[0].severity, 'warning'); assert.match(w[0].message, /5 beats/);
});
t('bad: dave has no fallback', () => assert.equal(find('MISSING_FALLBACK', 'dialogue/dave.csv').length, 1));
t('bad: nothing else is reported', () => {
  const codes = bad.result.diagnostics.filter(d => d.severity !== 'info').map(d => d.code).sort();
  assert.deepEqual(codes, ['BAD_VALUE', 'BAD_VALUE', 'BAD_VALUE', 'BAD_VALUE', 'BAD_VALUE', 'BEATS', 'DANGLING_NEXT', 'MISSING_FALLBACK', 'NEVER_WINS', 'TIE', 'UNKNOWN_EFFECT', 'UNREACHABLE']);
});
t('bad: leads: usLead "maybe" on D1 and day "9" on E1 are BAD_VALUE (SPEC "Leads")', () => {
  const d = find('BAD_VALUE', 'dialogue/dave.csv', 'D1'); assert.equal(d.length, 1); assert.equal(d[0].column, 'usLead');
  const e = find('BAD_VALUE', 'events.csv', 'E1'); assert.equal(e.length, 1); assert.equal(e[0].column, 'day');
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

// SPEC events.csv `medium`: a prop shown on the right panel instead of a bust (a radio). A known prop passes,
// a prop not generated yet is an info note (PLACEHOLDER on screen), a non-prop id is an error.
const medRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-check-medium-')), medDir = path.join(medRoot, 'content');
fs.cpSync(path.join(here, 'fixtures', 'good'), medDir, { recursive: true });
const medEv = fs.readFileSync(path.join(medDir, 'events.csv'), 'utf8').trimEnd().split('\n');
fs.writeFileSync(path.join(medDir, 'events.csv'), [medEv[0] + ',medium', medEv[1] + ',prop_radio', medEv[2] + ',ch_bob',
  'E_TV,us,home,neutral,distal,day_start,,,,,,1,,,On the radio.,,,,,prop_tv'].join('\n') + '\n');
fs.mkdirSync(path.join(medRoot, 'assets'));
fs.writeFileSync(path.join(medRoot, 'assets', 'manifest.json'), JSON.stringify({ backgrounds: {}, portraits: {}, figures: {}, props: { prop_tv: { file: 'prop/prop_tv.png', w: 600, h: 600 } }, tv: {} }));
const medRep = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-check-medium-report-'));
const med = JSON.parse(spawnSync(process.execPath, [path.join(here, 'check.mjs'), '--content', medDir, '--report', medRep, '--json'], { encoding: 'utf8' }).stdout);
t('medium: known prop passes, pending prop is an info note, non-prop id is an error', () => {
  const d = med.diagnostics.filter(x => x.column === 'medium').map(x => `${x.severity}:${x.code}:${x.row}`).sort();
  assert.deepEqual(d, ['error:BAD_VALUE:E_OVER', 'info:PENDING_ASSET:E_INV']);
  assert.equal(med.diagnostics.filter(x => x.file === 'events.csv' && x.code === 'SCHEMA').length, 0);
});

// SPEC "Content schemas" Prop quad / byBackground: the place fixture's projected chessboard passes; a short quad, a
// byBackground key that is not one of the scene's backgrounds and a short byBackground quad are errors.
t('prop quad: the place fixture prop quad and byBackground pass', () => assert.equal(place.result.diagnostics.filter(d => /props\[/.test(d.path || '')).length, 0));
const pqDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-check-propquad-'));
fs.cpSync(path.join(here, 'fixtures', 'place'), pqDir, { recursive: true });
fs.writeFileSync(path.join(pqDir, 'scenes.yaml'), fs.readFileSync(path.join(pqDir, 'scenes.yaml'), 'utf8')
  .replace(/quad: \[\[0\.20, 0\.536\].*\n/, 'quad: [[0.2, 0.5], [0.3, 0.5], [0.3, 1.9]]\n')
  .replace(/byBackground: \{ bg_park_eve: .*\n/, 'byBackground: { bg_home_day: [[0.2,0.5],[0.3,0.5],[0.3,0.6],[0.2,0.6]], bg_park_eve: [[0.2,0.5],[0.3,0.5]] }\n'));
const pqRep = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-check-propquad-report-'));
const pq = JSON.parse(spawnSync(process.execPath, [path.join(here, 'check.mjs'), '--content', pqDir, '--report', pqRep, '--json'], { encoding: 'utf8' }).stdout);
t('prop quad: bad quad, foreign background key and bad byBackground quad are errors', () => {
  const d = pq.diagnostics.filter(x => /props\[/.test(x.path || '')).map(x => `${x.severity}:${x.code}:${x.path}`).sort();
  assert.deepEqual(d, [
    'error:BAD_VALUE:scenes[1].props[0].byBackground.bg_home_day',
    'error:BAD_VALUE:scenes[1].props[0].byBackground.bg_park_eve',
    'error:BAD_VALUE:scenes[1].props[0].quad',
  ]);
});

// SPEC "How many people at once": SLOT_OCCLUSION for slots two different NPCs can hold together, the nearer hiding the
// further one's head band; a slot nobody appears on, or two slots only one NPC uses, are not reported
const occDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-check-occ-'));
fs.cpSync(path.join(here, 'fixtures', 'good'), occDir, { recursive: true });
fs.writeFileSync(path.join(occDir, 'scenes.yaml'), fs.readFileSync(path.join(here, 'fixtures', 'good', 'scenes.yaml'), 'utf8')
  .replace('{ id: left, x: 0.25, y: 0.90, scale: 0.5 }', '{ id: left, x: 0.25, y: 0.90, scale: 0.7 }')
  .replace('      - { id: right, x: 0.70, y: 0.90, scale: 0.5 }\n', '      - { id: right, x: 0.70, y: 0.90, scale: 0.5 }\n      - { id: back, x: 0.36, y: 0.60, scale: 0.3 }\n      - { id: spare, x: 0.25, y: 0.62, scale: 0.3 }\n      - { id: solo, x: 0.72, y: 0.60, scale: 0.3 }\n'));
fs.writeFileSync(path.join(occDir, 'npcs.yaml'), fs.readFileSync(path.join(here, 'fixtures', 'good', 'npcs.yaml'), 'utf8')
  .replace('      - { scene: home, slot: right, chance: 0.5 }\n', '      - { scene: home, slot: right, chance: 0.5 }\n      - { scene: home, slot: back, chance: 0.5 }\n      - { scene: home, slot: solo, chance: 0.5 }\n'));
const occ = JSON.parse(spawnSync(process.execPath, [path.join(here, 'check.mjs'), '--content', occDir, '--report', fs.mkdtempSync(path.join(os.tmpdir(), 'gv-check-occ-report-')), '--json'], { encoding: 'utf8' }).stdout);
t('occlusion: SLOT_OCCLUSION names near slot "left" covering "back"; unused and single-NPC pairs are quiet', () => {
  assert.deepEqual(nonInfo(occ), []);
  const occs = occ.diagnostics.filter(x => x.code === 'SLOT_OCCLUSION');
  assert.deepEqual(occs.map(x => `${x.severity}:${x.loc?.path ?? x.path}`), ['info:scenes.home.slots.back']);
  const d = occs[0];
  assert.match(d.message, /"left" \(nearer\) would cover 44% of the head band and 44% of a figure on "back"/);
});

// SPEC "Content schemas" byPack / textByPack: per-pack background variants and look texts. A variant missing from the
// manifest is an info PENDING_ASSET (the base background is drawn meanwhile); a bad pack key is an error in both.
const bpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-check-bypack-')), bpDir = path.join(bpRoot, 'content');
fs.cpSync(path.join(here, 'fixtures', 'good'), bpDir, { recursive: true });
fs.writeFileSync(path.join(bpDir, 'scenes.yaml'), fs.readFileSync(path.join(bpDir, 'scenes.yaml'), 'utf8')
  .replace('    lighting: warm_indoor\n    description: "A small test room."\n',
    '    lighting: warm_indoor\n    description: "A small test room."\n' +
    '    byPack:\n      cn: { background: bg_home_cn_day, evening: bg_home_cn_eve }\n      mx: { background: bg_home_mx_day }\n      xx: { background: bg_home_day }\n')
  .replace('        action: { type: end_day }\n',
    '        action: { type: end_day }\n      - id: shelf\n        label: "Shelf"\n        zone: { x: 0.10, y: 0.10, w: 0.10, h: 0.30 }\n' +
    '        action: { type: look, text: "Books.", textByPack: { cn: "Books and a red knot.", mx: "", zz: "Nope." } }\n'));
fs.mkdirSync(path.join(bpRoot, 'assets'));
fs.writeFileSync(path.join(bpRoot, 'assets', 'manifest.json'), JSON.stringify({ backgrounds: { bg_home_day: { file: 'bg/bg_home_day.jpg' }, bg_home_cn_day: { file: 'bg/bg_home_cn_day.jpg' } }, portraits: {}, figures: {}, props: {}, tv: {} }));
const bp = JSON.parse(spawnSync(process.execPath, [path.join(here, 'check.mjs'), '--content', bpDir, '--report', fs.mkdtempSync(path.join(os.tmpdir(), 'gv-check-bypack-report-')), '--json'], { encoding: 'utf8' }).stdout);
t('byPack: pending variants are info, bad pack keys and empty texts are errors', () => {
  const d = bp.diagnostics.filter(x => /[bB]yPack/.test(x.path || x.loc?.path || '')).map(x => `${x.severity}:${x.code}:${x.path ?? x.loc?.path}`).sort();
  assert.deepEqual(d, [
    'error:BAD_VALUE:scenes[0].byPack.xx',
    'error:BAD_VALUE:scenes[0].hotspots[1].action.textByPack.mx',
    'error:BAD_VALUE:scenes[0].hotspots[1].action.textByPack.zz',
    'info:PENDING_ASSET:scenes[0].byPack.cn.evening',
    'info:PENDING_ASSET:scenes[0].byPack.mx.background',
  ]);
});

// SPEC "Culture packs": the events/news `pack` column (BAD_VALUE, PACK_GAP, PACK_MISMATCH), per-pack strings
// (pack.<pack>.<name> -> {name}, PACK_GAP when a pack lacks one, UNKNOWN_VAR) and the PACK_LEAK lint (pack_terms.yaml).
const pkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-check-packs-'));
fs.cpSync(path.join(here, 'fixtures', 'good'), pkDir, { recursive: true });
fs.writeFileSync(path.join(pkDir, 'events.csv'), [
  'id,source,target,valence,proximity,trigger,scene,npc,minRapport,playerLean,nationalLeader,chance,cost,emotion,text,choice1,effect1,choice2,effect2,pack',
  "E_INV,us,home,positive,proximal,invite,home,alice,2,,,1,1,warm,Alice's dinner.,Go,rapport +1; lastValence positive,Decline,lastValence negative,",
  'E_OVER,home,us,negative,distal,enter,home,bob,,,,0.3,,worried,Bob mutters about the news. Long lines at the clinic.,,,,,',
  // the leak the player found: a shared morning message naming one pack's food
  'E_MOM,home,bicultural,positive,distal,day_start,,,,,,0.25,0,neutral,"Your mom is making zongzi, and Mandarin lessons start Monday.",Call her.,,,,',
  // gated variants: cn and mx but no in and no blank fallback
  'E_NEWS,us,home,positive,distal,day_start,,,,,,0.3,0,neutral,A phone interpreter line for Cantonese.,,,,,cn',
  'E_NEWS_mx,us,home,positive,distal,day_start,,,,,,0.3,0,neutral,A phone interpreter line for Spanish and Cantonese.,,,,,mx',
  // a cn-only row naming an mx food; an unknown pack; a pack that contradicts the npc's
  'E_CROSS,us,home,positive,distal,day_start,,,,,,0.3,0,neutral,Tamales at the potluck.,,,,,cn',
  'E_ODD,us,home,positive,distal,day_start,,,,,,0.3,0,neutral,A quiet morning.,,,,,xx',
  'E_MIS,home,us,negative,distal,enter,home,bob,,,,0.3,,worried,Bob waves.,,,,,mx',
  // a placeholder no strings define, and a per-pack one
  'E_VAR,us,home,positive,distal,day_start,,,,,,0.3,0,neutral,You pass {homeCenter} and {nope}.,,,,,',
].join('\n') + '\n');
fs.writeFileSync(path.join(pkDir, 'news.csv'), 'id,channel,nationalLeader,dayMin,valence,headline,body,pack\nN1,tv,,1,positive,Test headline,Test body.,\nN2,print,,1,positive,Cricket club opens,Nets on Sunday.,in\n');
fs.writeFileSync(path.join(pkDir, 'strings.en.json'), JSON.stringify({ 'culture.cn': 'Chinese', 'pack.cn.homeCenter': 'the center on Grand', 'pack.mx.homeCenter': 'the parish hall' }));
fs.writeFileSync(path.join(pkDir, 'pack_terms.yaml'), 'cn: [zongzi, mandarin, cantonese, lin, center on grand]\nmx: [tamale, spanish]\nin: [cricket]\nallow:\n  - { file: events.csv, row: E_NEWS_mx, term: cantonese, why: "test: a deliberate cross-pack mention" }\n');
const pk = JSON.parse(spawnSync(process.execPath, [path.join(here, 'check.mjs'), '--content', pkDir, '--report', fs.mkdtempSync(path.join(os.tmpdir(), 'gv-check-packs-report-')), '--json'], { encoding: 'utf8' }).stdout);
const pkd = (code) => pk.diagnostics.filter(d => d.code === code);
t('packs: PACK_LEAK flags a shared event naming cn terms (whole words; "lines" is not "lin")', () => {
  const l = pkd('PACK_LEAK');
  const mom = l.filter(d => d.row === 'E_MOM');
  assert.equal(mom.length, 1, JSON.stringify(l));
  assert.equal(mom[0].severity, 'warning');
  assert.match(mom[0].message, /"zongzi", "mandarin" \(pack cn terms/);
  assert.ok(!l.some(d => d.row === 'E_OVER'), 'Bob is cn; and "lines" must not match "lin"');
  assert.ok(!l.some(d => d.row === 'E_NEWS' || d.row === 'E_NEWS_mx'), 'own-pack terms and allow entries are fine');
  assert.ok(!l.some(d => d.file === 'pack_terms.yaml'), 'the allow entry is used');
  assert.ok(l.some(d => d.row === 'E_CROSS' && /"tamales" \(pack mx/.test(d.message)), 'a cn row naming an mx term');
  assert.ok(!l.some(d => d.row === 'E_VAR'), '{placeholders} are skipped');
  assert.ok(!l.some(d => d.row === 'N2'), 'an in story may say cricket');
});
t('packs: pack column values, gaps and mismatches', () => {
  assert.ok(pkd('BAD_VALUE').some(d => d.row === 'E_ODD' && d.column === 'pack'));
  const gap = pkd('PACK_GAP').map(d => d.row || d.path);
  assert.ok(gap.includes('E_NEWS'), JSON.stringify(gap)); // cn + mx, no in, no blank fallback
  assert.ok(gap.includes('pack.*.homeCenter'), JSON.stringify(gap)); // no pack.in.homeCenter
  assert.ok(gap.includes('N2'), JSON.stringify(gap)); // a lone in story without a fallback
  assert.ok(pkd('PACK_MISMATCH').some(d => d.row === 'E_MIS'), 'pack mx on a cn npc');
  const v = pkd('UNKNOWN_VAR');
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.match(v[0].message, /\{nope\}/);
});

console.log(failures ? `\n${failures} test(s) failed` : '\nall tests passed');
process.exit(failures ? 1 : 0);
