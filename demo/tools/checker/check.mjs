#!/usr/bin/env node
// Great Vote content checker CLI: reads the content directory, runs the pure checks in core.mjs,
// prints the summary and writes the HTML report. See README.md and demo/SPEC.md.
import fs from 'node:fs';
import path from 'node:path';
import { checkContent, formatDiag, DIMS, NCELLS, BUDGET, cellIndex, cellLabel, FREE_TURNS } from './core.mjs';

export { DIALOGUE_COLUMNS, EVENT_COLUMNS, NEWS_COLUMNS, formatDiag, checkContent } from './core.mjs';

// ---------------------------------------------------------------- report
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SPEC_COLORS = ['#d9d4c7', '#cfe3e1', '#a7cdc9', '#7db4ae', '#539a93', '#2f7e77', '#155f59'];

function renderHtml(result) {
  const css = `
  body{font:13px/1.45 -apple-system,system-ui,"IBM Plex Sans",sans-serif;color:#1F1D1A;background:#F4F1EA;margin:0;padding:24px 24px 64px}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:18px;margin:36px 0 8px;border-top:1px solid #d6cfbf;padding-top:20px} h3{font-size:14px;margin:16px 0 6px}
  .muted{color:#5D574D} table{border-collapse:collapse} .sum td,.sum th{padding:4px 10px;border-bottom:1px solid #ddd5c4;text-align:left} .sum th{font-weight:600}
  .bad{color:#a1281e;font-weight:600} .warn{color:#8a5a00} .ok{color:#1F6F6B;font-weight:600}
  .scroll{overflow-x:auto;max-width:100%} .grid td{width:13px;height:18px;padding:0;border:1px solid #F4F1EA}
  .grid th{font-weight:500;font-size:10px;padding:1px 2px;color:#5D574D;white-space:nowrap;border:1px solid #F4F1EA;background:#ebe5d8}
  .grid td.unr{opacity:.28} .grid td.tie{background:#c0392b!important;outline:1px solid #7a1c12} .grid td.none{background:#1F1D1A!important}
  .grid th.rh{text-align:right;padding-right:6px}
  .legend span{display:inline-block;width:14px;height:12px;vertical-align:middle;margin:0 3px 0 10px;border:1px solid #bbb}
  ul.diag{padding-left:18px;margin:4px 0} ul.diag li{margin:2px 0} code{font-family:ui-monospace,Menlo,monospace;font-size:12px}
  .wit li{font-family:ui-monospace,Menlo,monospace;font-size:12px}`;
  const sev = (d) => d.severity === 'error' ? 'bad' : d.severity === 'warning' ? 'warn' : 'muted';
  const diagList = (ds) => ds.length ? `<ul class="diag">${ds.map(d => `<li class="${sev(d)}">${esc(formatDiag(d))}</li>`).join('')}</ul>` : '<p class="muted">None.</p>';
  let h = `<title>Great Vote checker report</title><style>${css}</style>`;
  h += `<h1>Great Vote content checker</h1><p class="muted">Content: <code>${esc(result.content)}</code> · generated ${esc(result.generated)} · budget ${BUDGET} actions · ${NCELLS} cells per NPC per scene · at most ${esc(result.maxTalks)} conversation(s) per NPC per day</p>`;
  h += `<p>${result.ok ? '<span class="ok">PASS</span>' : '<span class="bad">FAIL</span>'} — ${result.counts.error} error(s), ${result.counts.warning} warning(s)</p>`;
  h += `<div class="scroll"><table class="sum"><tr><th>NPC</th><th>Rows</th><th>Coverage</th><th>Ties</th><th>Never win</th><th>Unreachable</th><th>Limit-unreachable</th><th>Over budget</th><th>Reachable states</th><th>Errors</th><th>Warnings</th></tr>`;
  for (const n of result.npcs) {
    h += `<tr><td><a href="#npc-${esc(n.id)}">${esc(n.id)}</a></td>`;
    if (!n.sheet) { h += `<td colspan="10" class="${n.sheetRequired ? 'bad' : 'muted'}">no dialogue sheet</td></tr>`; continue; }
    h += `<td>${n.rowCount}</td><td>${(n.coverage * 100).toFixed(1)}%</td><td class="${n.ties.length ? 'bad' : ''}">${n.ties.length}</td><td class="${n.neverWins.length ? 'warn' : ''}">${n.neverWins.length}</td><td class="${n.unreachable.length ? 'bad' : ''}">${n.unreachable.length}</td><td class="${n.limitUnreachable?.length ? 'bad' : ''}">${n.limitUnreachable?.length ?? 0}</td><td class="${n.overBudget.length ? 'warn' : ''}">${n.overBudget.length}</td><td>${n.reachableStates}/24</td><td class="${n.errors ? 'bad' : ''}">${n.errors}</td><td class="${n.warnings ? 'warn' : ''}">${n.warnings}</td></tr>`;
  }
  h += `</table></div>`;
  const global = result.diagnostics.filter(d => !d.file.startsWith('dialogue/'));
  h += `<h2>Global (scenes, npcs, events, news)</h2>${diagList(global)}`;
  h += `<p class="legend muted">Cell colour = specificity of the winning row:${SPEC_COLORS.map((c, i) => `<span style="background:${c}"></span>${i}${i === 0 ? ' (fallback)' : ''}`).join('')}<span style="background:#c0392b"></span>tie<span style="background:#1F1D1A"></span>no row · faded = NPC state unreachable</p>`;
  for (const n of result.npcs) {
    h += `<h2 id="npc-${esc(n.id)}">${esc(n.id)} <span class="muted">${esc(n.name || '')}</span></h2>`;
    if (!n.sheet) { h += `<p class="muted">No dialogue sheet.</p>`; continue; }
    h += `<p class="muted">Coverage ${(n.coverage * 100).toFixed(1)}% in its weakest talk scene (${n.served}/${NCELLS} cells served by a non-fallback row) · fallback <code>${esc(n.fallback || '—')}</code></p>`;
    h += `<table class="sum"><tr><th>Scene</th><th>Coverage</th><th>No row</th><th>Ties</th><th>Rows only here</th><th>Talk here</th></tr>${(n.scenes || []).map(sc => `<tr><td>${esc(sc.scene ?? '(anywhere: no appearances)')}</td><td>${(sc.coverage * 100).toFixed(1)}%</td><td class="${sc.noMatch ? 'bad' : ''}">${sc.noMatch}</td><td class="${sc.ties.length ? 'bad' : ''}">${sc.ties.length}</td><td>${esc(sc.located.join(', ') || '—')}</td><td>${sc.scene == null ? '—' : (n.talkScenes || []).includes(sc.scene) ? 'yes' : 'events only'}</td></tr>`).join('')}</table>`;
    const grids = n.sceneCells ? Object.entries(n.sceneCells) : [[null, n.cells]];
    for (const [scName, gridCells] of grids) {
    if (scName != null) h += `<h3>Scene ${esc(scName)}</h3>`;
    // header rows: lastValence x nationalLeader x playerLean x dayPhase
    const span = [18, 9, 3, 1];
    h += `<div class="scroll"><table class="grid">`;
    for (let lvl = 0; lvl < 4; lvl++) {
      const dim = DIMS[2 + lvl];
      h += `<tr><th class="rh">${esc(dim.key)}</th>`;
      const reps = 54 / (span[lvl] * dim.values.length);
      for (let r = 0; r < reps; r++) for (const v of dim.values) h += `<th colspan="${span[lvl]}" title="${esc(dim.key + '=' + v)}">${esc(lvl === 3 ? v[0] : lvl === 2 ? ({ 'us-leaning': 'us', balanced: 'bal', 'home-leaning': 'home' })[v] : lvl === 1 ? v.slice(0, 3) : v)}</th>`;
      h += `</tr>`;
    }
    for (let met = 0; met < 2; met++) for (let rap = 0; rap < 4; rap++) {
      h += `<tr><th class="rh">met ${DIMS[0].values[met]} · rapport ${rap}</th>`;
      for (let col = 0; col < 54; col++) {
        const lv = Math.floor(col / 18), nl = Math.floor(col / 9) % 2, pl = Math.floor(col / 3) % 3, dp = col % 3;
        const c = cellIndex([met, rap, lv, nl, pl, dp]);
        const cell = gridCells[c];
        const cls = [cell.row == null ? 'none' : '', cell.tie ? 'tie' : '', cell.cost == null ? 'unr' : ''].filter(Boolean).join(' ');
        const title = `${cellLabel(c)}\n` + (cell.row == null ? 'NO ROW MATCHES' : `${cell.tie ? 'TIE: ' + cell.tie.join(', ') + '\n' : ''}row ${cell.row} (specificity ${cell.spec}, priority ${cell.prio})\n“${cell.line}”`) + `\n${cell.cost == null ? 'unreachable' : 'min actions to reach: ' + cell.cost}`;
        h += `<td class="${cls}" style="background:${cell.row == null ? '' : SPEC_COLORS[cell.spec]}" title="${esc(title)}"></td>`;
      }
      h += `</tr>`;
    }
    h += `</table></div>`;
    }
    const mine = result.diagnostics.filter(d => d.file === n.sheet);
    h += `<h3>Errors</h3>${diagList(mine.filter(d => d.severity === 'error'))}`;
    h += `<h3>Warnings</h3>${diagList(mine.filter(d => d.severity !== 'error'))}`;
    h += `<h3>Witness paths</h3><ul class="diag wit">${Object.entries(n.rows).map(([id, r]) => `<li>${esc(id)}${r.depth != null ? ` <span class="muted">(runs up to ${esc(r.depth)}${r.depth > FREE_TURNS ? '+ turns, can reach the paid turn' : ' turns'})</span>` : ''}: ${r.witness ? `${esc(r.cost)} action(s) — ${esc(r.witness)}` : r.witnessNoLimit ? `<span class="bad">unreachable under the conversation limit</span> (without it: ${esc(r.costNoLimit)} — ${esc(r.witnessNoLimit)})` : '<span class="bad">unreachable</span>'}</li>`).join('')}</ul>`;
  }
  return h;
}

// ---------------------------------------------------------------- main
// reads every file the core needs; dialogue sheets in directory-listing order
export function check(contentDir, opts = {}) {
  const content = path.resolve(contentDir);
  const files = {};
  const read = (rel) => { const f = path.join(content, rel); if (fs.existsSync(f)) files[rel] = fs.readFileSync(f, 'utf8'); };
  for (const rel of ['scenes.yaml', 'npcs.yaml', 'events.csv', 'news.csv', 'cast.yaml', 'pack_terms.yaml', 'strings.en.json', 'profile.yaml', 'questionnaire/eod.json']) read(rel);
  const dlgDir = path.join(content, 'dialogue');
  if (fs.existsSync(dlgDir)) for (const f of fs.readdirSync(dlgDir).filter(f => f.endsWith('.csv'))) read(`dialogue/${f}`);
  read('townhall.yaml');
  const thDir = path.join(content, 'townhall');
  if (fs.existsSync(thDir)) for (const f of fs.readdirSync(thDir).filter(f => f.endsWith('.csv'))) read(`townhall/${f}`);
  const mf = path.join(content, '..', 'assets', 'manifest.json');
  const manifest = fs.existsSync(mf) ? fs.readFileSync(mf, 'utf8') : null;
  return checkContent({ files, manifest, content, maxTalks: opts.maxTalks });
}

function parseArgs(argv) {
  const a = { content: 'public/content', report: 'tools/checker/report', json: false, talks: undefined };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === '--content') a.content = argv[++i];
    else if (f === '--report') a.report = argv[++i];
    else if (f === '--json') a.json = true;
    else if (f === '--talks') { a.talks = Number(argv[++i]); if (!(Number.isInteger(a.talks) && a.talks > 0)) { console.error('--talks needs a positive integer'); process.exit(2); } }
    else if (f === '-h' || f === '--help') { a.help = true; }
    else { console.error(`unknown argument ${f}`); process.exit(2); }
  }
  return a;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log('usage: node tools/checker/check.mjs [--content <dir>] [--report <dir>] [--talks N] [--json]'); process.exit(0); }
  if (!fs.existsSync(args.content)) { console.error(`content directory not found: ${args.content}`); process.exit(2); }
  const result = check(args.content, { maxTalks: args.talks });
  fs.mkdirSync(args.report, { recursive: true });
  fs.writeFileSync(path.join(args.report, 'results.json'), JSON.stringify(result, null, 1));
  fs.writeFileSync(path.join(args.report, 'index.html'), renderHtml(result));
  if (args.json) {
    const slim = { ...result, npcs: result.npcs.map(({ cells, sceneCells, ...rest }) => rest) };
    process.stdout.write(JSON.stringify(slim, null, 2) + '\n');
  } else {
    for (const d of result.diagnostics) if (d.severity !== 'info') console.log(formatDiag(d));
    console.log('');
    console.log(`NPC               rows  coverage  ties  never-win  unreachable  limit-unr.  over-budget   (coverage = weakest scene a conversation can start in; at most ${result.maxTalks} talk(s)/NPC/day)`);
    for (const n of result.npcs) {
      if (!n.sheet) { console.log(n.id.padEnd(18) + '(no dialogue sheet)'); continue; }
      console.log(n.id.padEnd(18) + String(n.rowCount).padEnd(6) + `${(n.coverage * 100).toFixed(1)}%`.padEnd(10) + String(n.ties.length).padEnd(6) + String(n.neverWins.length).padEnd(11) + String(n.unreachable.length).padEnd(13) + String(n.limitUnreachable?.length ?? 0).padEnd(12) + n.overBudget.length);
    }
    console.log('\nPer-scene completeness (432 cells each; served = won by a non-fallback row; * = met there through events only)');
    for (const n of result.npcs) {
      if (!n.sheet || !n.scenes) continue;
      const parts = n.scenes.map(sc => `${sc.scene ?? '(anywhere)'}${sc.scene != null && !(n.talkScenes || []).includes(sc.scene) ? '*' : ''} ${(sc.coverage * 100).toFixed(1)}%${sc.noMatch ? ` NO-ROW ${sc.noMatch}` : ''}${sc.ties.length ? ` TIES ${sc.ties.length}` : ''}${sc.located.length ? ` [${sc.located.length} located]` : ''}`);
      console.log('  ' + n.id.padEnd(16) + parts.join(' · '));
    }
    if (result.packs) {
      console.log('\nCulture packs (scenes open to a player of each home culture; SPEC "Packs")');
      for (const [c, v] of Object.entries(result.packs)) console.log(`  ${c}: plays ${v.pack}${v.fallback ? ' (fallback, banner)' : ''} · ${v.scenes.join(', ')}`);
    }
    console.log(`\n${result.ok ? 'PASS' : 'FAIL'}: ${result.counts.error} error(s), ${result.counts.warning} warning(s). Report: ${path.join(args.report, 'index.html')}`);
  }
  process.exit(result.ok ? 0 : 1);
}
