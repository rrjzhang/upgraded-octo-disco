#!/usr/bin/env node
// Seeded random walker over the running game (SPEC "Fuzz walker"). Drives headless Chrome over CDP, no Playwright:
//   node tools/fuzz/walk.mjs --seeds 20 [--start 1] [--steps 400] [--base http://localhost:5173] [--out tools/fuzz/out/<stamp>]
//   node tools/fuzz/walk.mjs --seed 7            # one seed, for a repro
// Each seed is one playthrough: at every step the walker lists what a player could click (choices, figures, hotspots,
// exits, the phone, the module windows' buttons and radios) and picks one at random (seeded), until the demo ends or
// the step budget is spent. It checks invariants at every step and writes one readable transcript per seed plus a
// compact summary.md. The dev server must be running (npm run dev).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { const v = process.argv[i + 1]; if (v && !v.startsWith('--')) { args.set(a.slice(2), v); i++; } else args.set(a.slice(2), 'true'); } }
const BASE = args.get('base') ?? 'http://localhost:5173';
const SEEDS = args.has('seed') ? [+args.get('seed')] : Array.from({ length: +(args.get('seeds') ?? 10) }, (_, i) => +(args.get('start') ?? 1) + i);
const STEPS = +(args.get('steps') ?? 500);
// --mode random (default) | lead (always leads on in a conversation) | tour (visits every scene each day and talks to
// everyone there) | both. Tour modes top the actions up when they run out until the day's tour is done (--no-topup off).
const MODE = args.get('mode') ?? 'random';
if (!['random', 'lead', 'tour', 'both'].includes(MODE)) { console.error(`--mode ${MODE}? random | lead | tour | both`); process.exit(2); }
const LEAD = MODE === 'lead' || MODE === 'both', TOUR = MODE === 'tour' || MODE === 'both';
const TOPUP = TOUR && !args.has('no-topup');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = args.get('out') ?? path.join('tools', 'fuzz', 'out', STAMP);
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- chrome
function findChrome() {
  if (args.get('chrome')) return args.get('chrome');
  if (process.env.GV_CHROME) return process.env.GV_CHROME;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  if (fs.existsSync(cache)) {
    const dirs = fs.readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().reverse();
    for (const d of dirs) {
      const p = path.join(cache, d, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
      if (fs.existsSync(p)) return p;
      const q = path.join(cache, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(q)) return q;
    }
  }
  for (const p of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']) if (fs.existsSync(p)) return p;
  throw new Error('no Chrome found; pass --chrome <path> or set GV_CHROME');
}
const PORT = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(findChrome(), ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1440,900', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${path.join(OUT, 'profile')}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => chrome.kill());
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets?.length) break; } catch { /* starting */ } await sleep(250); }
if (!targets?.length) { console.error('Chrome did not start'); process.exit(2); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let msgId = 0; const pending = new Map(); let errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') errors.push({ kind: 'exception', text: msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text ?? '' });
  else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push({ kind: 'console.error', text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'warning') {
    const t = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (/^\[(dialogue|talk|move|pack|survey)\]/.test(t)) errors.push({ kind: 'warning', text: t }); // engine notes worth seeing; [content] art warnings are noise
  }
};
const send = (method, params = {}) => new Promise((r) => { const id = ++msgId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('page: ' + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text));
  return r.result?.result?.value;
};

// ---------------------------------------------------------------- in-page helpers (serialised into the page once per load)
const PAGE_LIB = `window.__fz = (() => {
  const vis = (el) => { if (!el || el.hidden) return false; const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.pointerEvents !== 'none'; };
  const enabled = (el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.value || el.className || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 80);
  const frameDoc = () => { const f = document.querySelector('iframe.win-frame'); try { return f && f.contentDocument && f.contentDocument.body && f.contentDocument.body.children.length ? f.contentDocument : null; } catch { return null; } };
  function candidates() {
    const out = [];
    const fd = frameDoc();
    if (fd) {
      // a module window is open: radios first (one per unanswered group), then its buttons
      const groups = new Map();
      for (const r of fd.querySelectorAll('input[type=radio]')) { if (!groups.has(r.name)) groups.set(r.name, []); groups.get(r.name).push(r); }
      const open = [...groups].filter(([, rs]) => !rs.some((r) => r.checked));
      if (open.length) out.push({ kind: 'radio', w: 8, sel: 'frame-all', idx: 0, label: 'answer ' + open.length + ' question(s)' });
      for (const ta of fd.querySelectorAll('textarea')) if (!ta.value) out.push({ kind: 'text', w: 3, sel: 'frame-ta', idx: [...fd.querySelectorAll('textarea')].indexOf(ta), label: 'write ' + (ta.name || ta.id || 'text') });
      const btns = [...fd.querySelectorAll('button')].filter((b) => vis(b) && enabled(b));
      btns.forEach((b, i) => out.push({ kind: 'frame-btn', w: b.id === 'next' ? 4 : b.id === 'later' ? 0.3 : b.className.includes('bin') ? 3 : 1.5, sel: 'frame-btn', idx: [...fd.querySelectorAll('button')].indexOf(b), label: 'window: ' + label(b) }));
      return out;
    }
    if (document.querySelector('.end-overlay')) return [{ kind: 'end', w: 1, sel: 'end', idx: 0, label: 'demo ended' }];
    const phone = document.querySelector('.phone'), phoneOpen = phone && !phone.hidden;
    const add = (sel, kind, w, filter) => { [...document.querySelectorAll(sel)].forEach((el, i) => { if (!vis(el) || !enabled(el) || (filter && !filter(el))) return; out.push({ kind, w, sel, idx: i, label: label(el), fk: el.dataset.fk || '' }); }); };
    if (phoneOpen) {
      // the phone pane: profile radios and Begin, tabs, journal save, the end-of-day call, close
      add('.phone input[type=radio]', 'radio', 6, (el) => !el.checked);
      add('.phone [data-fk="prof:begin"]', 'begin', 8);
      add('.phone .ph-tab', 'tab', 0.5);
      add('.phone .ph-pane .btn', 'phone-btn', 3);
      add('.phone .ph-close', 'close', 3);
      return out;
    }
    const row = window.gv && window.gv.game.panel && window.gv.game.panel.kind === 'dialogue' ? window.gv.game.panel.row : null;
    [...document.querySelectorAll('.right .choice')].forEach((el, i) => {
      if (!vis(el) || !enabled(el) || el.classList.contains('dev-back') || el.classList.contains('dev-edit-open')) return;
      const m = /^ch:(\d+)$/.exec(el.dataset.fk || ''), ch = row && m ? row.choices[+m[1]] : null;
      const next = el.classList.contains('next');
      out.push({ kind: 'choice', w: next ? 8 : ch ? (ch.next ? 6 : 2) : 4, sel: '.right .choice', idx: i, label: label(el), fk: el.dataset.fk || '', leads: next || !!(ch && ch.next), leave: !!(ch && !ch.next) });
    });
    add('.scene-box .figure', 'figure', 5);
    add('.scene-box .hotspot', 'hotspot', 0.5, (el) => !el.classList.contains('spent'));
    add('.strip .exit', 'exit', 1);
    add('.hub-exit', 'exit', 3);
    add('.strip .phone-btn', 'phone', document.querySelector('.phone-btn.ringing') ? 8 : 0.4);
    return out;
  }
  function act(c) {
    const fd = frameDoc();
    if (c.sel === 'frame-all') {
      const groups = new Map();
      for (const r of fd.querySelectorAll('input[type=radio]')) { if (!groups.has(r.name)) groups.set(r.name, []); groups.get(r.name).push(r); }
      for (const [, rs] of groups) if (!rs.some((r) => r.checked)) rs[Math.floor(Math.random() * rs.length)].click();
      return true;
    }
    if (c.sel === 'frame-ta') { const ta = fd.querySelectorAll('textarea')[c.idx]; ta.value = 'fine'; ta.dispatchEvent(new Event('input', { bubbles: true })); return true; }
    if (c.sel === 'frame-btn') { fd.querySelectorAll('button')[c.idx].click(); return true; }
    if (c.sel === 'end') return false;
    const el = document.querySelectorAll(c.sel)[c.idx];
    if (!el) return false;
    el.click(); return true;
  }
  function snapshot() {
    const g = window.gv, s = g && g.game && g.game.s;
    const textOf = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent).join(' ');
    const visibleText = textOf('.right .dialogue, .right .choices, .right .desc, .right .who, .phone .ph-pane, .topbar') ;
    const holes = [...visibleText.matchAll(/\\{(\\w+)\\}/g)].map((m) => m[0]);
    const fd = frameDoc();
    return {
      day: s && s.day, actions: s && s.actions, wallet: s && s.wallet, scene: s && s.scene, pack: s && s.player.pack, pending: !!(s && s.player.profilePending),
      panel: g && g.game.panel && g.game.panel.kind, convo: !!(s && s.convo), finished: !!(s && s.finished) || !!document.querySelector('.end-overlay'),
      module: fd ? (document.querySelector('iframe.win-frame').getAttribute('src') || '').replace(/.*\\//, '') : null,
      phoneOpen: !!(document.querySelector('.phone') && !document.querySelector('.phone').hidden),
      holes, pendingArt: document.querySelectorAll('.right .pending, .right .ph-mark').length,
      line: (document.querySelector('.right .line') || {}).textContent || '', status: (document.querySelector('.right .status') || {}).textContent || '',
      sceneBg: (document.querySelector('.scene-box img') || {}).getAttribute ? (document.querySelector('.scene-box img').getAttribute('src') || '') : '',
      // a scene that should show a photo but shows none, or a broken one (the 'park disappeared' report)
      // a labelled flat panel (PLACEHOLDER background, no art yet) is intended, not blank
      sceneBlank: (() => { const sc = g && g.game.scene; if (!sc || sc.background === 'none') return false; if (document.querySelector('.stage.swapping') || document.querySelector('.scene-box .bg-flat')) return false; const img = document.querySelector('.scene-box img'); return !img || (img.complete && img.naturalWidth === 0); })(),
      swapping: !!document.querySelector('.stage.swapping'),
    };
  }
  return { candidates, act, snapshot };
})(); 'ok'`;

// ---------------------------------------------------------------- rng
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pickWeighted = (rng, items) => { const tot = items.reduce((a, c) => a + c.w, 0); let x = rng() * tot; for (const c of items) { x -= c.w; if (x <= 0) return c; } return items[items.length - 1]; };

// ---------------------------------------------------------------- one seed
async function walk(seed) {
  const rng = mulberry32(seed);
  const cultures = ['cn', 'mx', 'in'];
  const culture = cultures[Math.floor(rng() * 3)];
  const viaProfile = rng() < 0.3;
  const region = ['north', 'south', ''][Math.floor(rng() * 3)], faith = ['hindu', 'muslim', ''][Math.floor(rng() * 3)];
  // SPEC "Leads": which local leader is first among equals on each side, drawn per seed like the culture
  const usLead = rng() < 0.5 ? 'pro' : 'anti', homeLead = rng() < 0.5 ? 'pro' : 'anti';
  const q = new URLSearchParams({ dev: '1', reset: '1', name: `Fuzz${seed}`, uslead: usLead, homelead: homeLead });
  if (viaProfile) q.set('profile', '1'); else { q.set('culture', culture); if (culture === 'in') { if (region) q.set('region', region); if (faith) q.set('faith', faith); } }
  errors = [];
  await send('Page.navigate', { url: `${BASE}/?${q}` });
  for (let i = 0; i < 80; i++) { await sleep(100); try { if (await ev(`!!(window.gv && window.gv.game && document.querySelector('.stage'))`)) break; } catch { /* loading */ } }
  await ev(PAGE_LIB);
  const trace = [], fails = [], notes = [];
  let steps = 0, idle = 0, lastDay = 0, finished = false, maxDay = 1, topups = 0, blank = 0;
  const tour = { visited: new Set(), known: new Set(), done: false }; // per day: scenes visited, scenes known from exits, tour finished
  const t0 = Date.now();
  for (; steps < STEPS; steps++) {
    let snap;
    try { snap = await ev('JSON.stringify(window.__fz.snapshot())').then(JSON.parse); } catch (e) { fails.push({ step: steps, what: 'snapshot failed', detail: String(e.message).slice(0, 200) }); break; }
    if (snap.finished) { finished = true; break; }
    maxDay = Math.max(maxDay, snap.day || 1);
    if (typeof snap.actions === 'number' && snap.actions < 0) fails.push({ step: steps, what: 'actions below zero', detail: `actions=${snap.actions}` });
    if (snap.holes.length) fails.push({ step: steps, what: 'unfilled placeholder on screen', detail: `${snap.holes.join(' ')} in ${snap.scene} (${snap.panel})` });
    if (snap.sceneBlank) { blank++; if (blank >= 2) fails.push({ step: steps, what: 'scene shows no background image', detail: `${snap.scene} (${snap.panel}), src ${snap.sceneBg || 'none'}` }); } else blank = 0;
    if (snap.day !== lastDay) { trace.push(`\n## Day ${snap.day} (${snap.actions} actions)`); lastDay = snap.day; tour.visited.clear(); tour.done = false; }
    if (snap.scene) tour.visited.add(snap.scene);
    // test mode: the tour must not stall on an empty action bar; top up and say so in the trace
    if (TOPUP && typeof snap.actions === 'number' && snap.actions <= 0 && !tour.done && !snap.pending && !snap.module) {
      await ev('gv.actions(8)'); topups++; trace.push(`${String(steps).padStart(3)} d${snap.day} a0 ${String(snap.scene).padEnd(9)} topup     actions set back to 8 (tour not finished)`);
      continue;
    }
    let cands;
    try { cands = await ev('JSON.stringify(window.__fz.candidates())').then(JSON.parse); } catch (e) { fails.push({ step: steps, what: 'candidates failed', detail: String(e.message).slice(0, 200) }); break; }
    cands = cands.filter((c) => c.w > 0);
    if (!cands.length || (cands.length === 1 && cands[0].kind === 'end')) {
      if (cands[0]?.kind === 'end') { finished = true; break; }
      idle++;
      if (idle >= 3) { fails.push({ step: steps, what: 'stuck: nothing to click', detail: `scene ${snap.scene}, panel ${snap.panel}, module ${snap.module}, actions ${snap.actions}, pending ${snap.pending}` }); break; }
      await sleep(400); continue;
    }
    idle = 0;
    // a dialogue row must always offer a click (a choice or Next); the phone and module windows cover the panel, so only when neither is open
    if (snap.panel === 'dialogue' && !snap.module && !snap.phoneOpen && !cands.some((c) => c.kind === 'choice')) fails.push({ step: steps, what: 'dialogue with no enabled choice', detail: snap.status || snap.line.slice(0, 80) });
    for (const c of cands) for (const m of [/^(?:exit|hub):(\w+)$/.exec(c.fk || '')]) if (m) tour.known.add(m[1]);
    if (LEAD) for (const c of cands) if (c.kind === 'choice') c.w = c.leads ? 20 : c.leave ? 0.4 : 4;
    if (TOUR && !snap.module && !snap.phoneOpen && !snap.pending && snap.panel !== 'dialogue') {
      const figures = cands.filter((c) => c.kind === 'figure');
      const unvisited = [...tour.known].filter((id) => !tour.visited.has(id));
      if (figures.length) for (const c of figures) c.w = 60;
      else if (unvisited.length) {
        const direct = cands.filter((c) => { const m = /^(?:exit|hub):(\w+)$/.exec(c.fk || ''); return m && unvisited.includes(m[1]); });
        const toHub = cands.filter((c) => /^(?:exit|hub):street$/.test(c.fk || ''));
        for (const c of direct.length ? direct : toHub) c.w = 60;
      } else if (!tour.done) { tour.done = true; trace.push(`${String(steps).padStart(3)} d${snap.day} a${snap.actions} ${String(snap.scene).padEnd(9)} tour      every known scene visited, everyone met; letting the day run out`); }
      // tour done: head for bed and sleep (or the ringing phone) so the next day's tour can start
      if (tour.done) for (const c of cands) { if (c.kind === 'phone' && /ringing/i.test(c.label)) c.w = 40; if (c.fk === 'hs:bed') c.w = 30; if (c.kind === 'hotspot' && c.fk !== 'hs:bed') c.w = 0.2; if (c.kind === 'exit' && !/^(?:exit|hub):home$/.test(c.fk || '')) c.w = 0.5; }
    }
    if (TOUR && tour.done && snap.panel === 'bed') for (const c of cands) if (c.kind === 'choice' && /sleep|bed|turn in/i.test(c.label)) c.w = 40;
    if (false) {
    }
    const c = pickWeighted(rng, cands);
    let ok = false;
    try { ok = await ev(`window.__fz.act(${JSON.stringify(c)})`); } catch (e) { fails.push({ step: steps, what: 'click threw', detail: `${c.kind} ${c.label}: ${String(e.message).slice(0, 160)}` }); }
    trace.push(`${String(steps).padStart(3)} d${snap.day} a${snap.actions} ${snap.scene.padEnd(9)} ${c.kind.padEnd(9)} ${c.label}${ok ? '' : ' (no-op)'}`);
    // scene swaps fade in; module windows load an iframe
    await sleep(c.kind === 'exit' ? 650 : c.kind === 'hotspot' || c.kind === 'phone-btn' || c.kind === 'frame-btn' ? 350 : 120);
    for (const e of errors.splice(0)) (e.kind === 'warning' ? notes : fails).push({ step: steps, what: e.kind, detail: e.text.slice(0, 240) });
  }
  const ms = Date.now() - t0;
  // the game's own log is the faithful transcript
  const log = await ev(`(() => { const k = Object.keys(localStorage).find(k => k.includes('log') && k.includes('DEV1')); return k ? localStorage.getItem(k) : ''; })()`);
  const lines = (log || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const content = await ev(`JSON.stringify({ rows: Object.fromEntries([...gv.content.dialogue].map(([k, rs]) => [k, Object.fromEntries(rs.map(r => [r.id, { line: r.line, choices: r.choices.map(c => c.text) }]))])), events: Object.fromEntries(gv.content.events.map(e => [e.id, e.text])), names: Object.fromEntries(gv.content.npcs.map(n => [n.id, n.name])), nrows: [...gv.content.dialogue.values()].reduce((a, rs) => a + rs.length, 0), nevents: gv.content.events.length })`).then(JSON.parse);
  const rowsSeen = new Set(), eventsSeen = new Set(); let convos = 0, charged = 0;
  const tr = [`# Seed ${seed}: ${viaProfile ? 'profile asked' : `culture ${culture}${culture === 'in' ? ` ${region || 'region-skip'} ${faith || 'faith-skip'}` : ''}`} · usLead ${usLead} · homeLead ${homeLead}`, ''];
  let day = 0;
  for (const l of lines) {
    if (l.day !== day) { day = l.day; tr.push(`\n## Day ${day}`); }
    const who = (id) => content.names[id] || id;
    switch (l.type) {
      case 'profile': tr.push(`- profile: heritage ${l.heritage} -> pack ${l.pack}${l.variant && Object.keys(l.variant).length ? ' ' + JSON.stringify(l.variant) : ''}`); break;
      case 'move': tr.push(`- -> ${l.target}`); break;
      case 'dialogue': { rowsSeen.add(`${l.target}/${l.rule}`); const r = content.rows[l.target]?.[l.rule]; tr.push(`- **${who(l.target)}** (${l.rule}): ${r ? r.line : '?'}`); break; }
      case 'beat': tr.push(`  - (next)`); break;
      case 'choice': { if (l.event) { tr.push(`  - you (event ${l.rule}): choice ${l.choice}`); break; } const r = content.rows[l.target]?.[l.rule]; tr.push(`  - you: ${r?.choices[l.choice - 1] ?? '?'}${l.charged ? ` (charged ${l.charged})` : ''}`); if (l.charged) charged += l.charged; break; }
      case 'conversation': convos++; tr.push(`  - [${l.turns} turns, ${l.exit}, cost ${l.cost ?? 0}]`); break;
      case 'event': eventsSeen.add(l.rule); tr.push(`- event ${l.rule}: ${(content.events[l.rule] || '').slice(0, 140)}`); break;
      case 'hotspot': tr.push(`- looks at ${l.target}`); break;
      case 'window': tr.push(`- window ${l.target}${l.op ? ' ' + l.op : ''}`); break;
      case 'survey': tr.push(`- survey ${l.target} answered`); break;
      case 'whosaid': tr.push(`- who said what: ${l.score}/${l.n} right (${l.within} within, ${l.between} between)`); break;
      case 'day_end': tr.push(`- day ends (wallet $${l.wallet})`); break;
      default: break;
    }
  }
  tr.push('', '## Click trace', '```', ...trace, '```');
  if (fails.length) tr.push('', '## Failures', ...fails.map((f) => `- step ${f.step}: ${f.what}: ${f.detail}`));
  if (notes.length) tr.push('', '## Engine notes', ...notes.map((f) => `- step ${f.step}: ${f.detail}`));
  fs.writeFileSync(path.join(OUT, `seed-${seed}.md`), tr.join('\n') + '\n');
  return { seed, topups, culture: viaProfile ? 'profile' : culture, region: culture === 'in' ? region || '-' : '-', faith: culture === 'in' ? faith || '-' : '-', steps, ms, finished, maxDay, convos, charged, rows: rowsSeen, events: eventsSeen, fails, notes, nrows: content.nrows, nevents: content.nevents };
}

// ---------------------------------------------------------------- run
const results = [];
const allRows = new Set(), allEvents = new Set();
const started = Date.now();
for (const seed of SEEDS) {
  process.stdout.write(`seed ${seed} ... `);
  try {
    const r = await walk(seed);
    results.push(r);
    for (const x of r.rows) allRows.add(x); for (const x of r.events) allEvents.add(x);
    console.log(`${r.steps} steps, day ${r.maxDay}${r.finished ? ' (finished)' : ''}, ${r.convos} conversations, ${r.fails.length} failure(s), ${(r.ms / 1000).toFixed(0)}s`);
  } catch (e) { console.log('crashed: ' + e.message); results.push({ seed, steps: 0, ms: 0, finished: false, maxDay: 0, convos: 0, charged: 0, rows: new Set(), events: new Set(), fails: [{ step: 0, what: 'walker crashed', detail: String(e.message).slice(0, 200) }], notes: [], culture: '?', region: '-', faith: '-' }); }
}
const nrows = results.find((r) => r.nrows)?.nrows ?? 0, nevents = results.find((r) => r.nevents)?.nevents ?? 0;
const byWhat = new Map();
for (const r of results) for (const f of r.fails) { const k = `${f.what}: ${f.detail.replace(/\d+/g, 'N').slice(0, 90)}`; if (!byWhat.has(k)) byWhat.set(k, []); byWhat.get(k).push(`${r.seed}@${f.step}`); }
const md = [];
md.push(`# Fuzz walk ${STAMP} (mode ${MODE}${TOPUP ? ', top-ups on' : ''})`, '', `${results.length} seed(s), ${STEPS} steps max, ${((Date.now() - started) / 1000).toFixed(0)} s total. Base ${BASE}.`, '');
md.push(`| seed | start | steps | day | done | convos | charged | top-ups | fails |`, `|---|---|---|---|---|---|---|---|---|`);
for (const r of results) md.push(`| ${r.seed} | ${r.culture}${r.region !== '-' ? ' ' + r.region : ''}${r.faith !== '-' ? ' ' + r.faith : ''} | ${r.steps} | ${r.maxDay} | ${r.finished ? 'yes' : 'no'} | ${r.convos} | ${r.charged} | ${r.topups ?? 0} | ${r.fails.length} |`);
md.push('', `Dialogue rows seen: ${allRows.size} of ${nrows} (${nrows ? (100 * allRows.size / nrows).toFixed(0) : 0}%). Events seen: ${allEvents.size} of ${nevents}. Finished the week: ${results.filter((r) => r.finished).length}/${results.length}.`);
md.push('', byWhat.size ? '## Failures (grouped)' : '## No failures');
for (const [k, where] of [...byWhat].sort((a, b) => b[1].length - a[1].length)) md.push(`- ${where.length}x ${k}  (seed@step: ${where.slice(0, 8).join(', ')}${where.length > 8 ? ', ...' : ''})`);
const noteCount = new Map();
for (const r of results) for (const n of r.notes) { const k = n.detail.replace(/\d+/g, 'N').slice(0, 100); noteCount.set(k, (noteCount.get(k) || 0) + 1); }
if (noteCount.size) { md.push('', '## Engine notes (warnings)'); for (const [k, n] of [...noteCount].sort((a, b) => b[1] - a[1]).slice(0, 12)) md.push(`- ${n}x ${k}`); }
md.push('', `Transcripts: ${OUT}/seed-<n>.md. Repro: node tools/fuzz/walk.mjs --mode ${MODE} --seed <n> --steps ${STEPS}`);
fs.writeFileSync(path.join(OUT, 'summary.md'), md.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ stamp: STAMP, base: BASE, steps: STEPS, results: results.map((r) => ({ ...r, rows: [...r.rows], events: [...r.events] })), rowsSeen: [...allRows], eventsSeen: [...allEvents], nrows, nevents }, null, 1));
console.log(`\nsummary: ${path.join(OUT, 'summary.md')}`);
ws.close(); chrome.kill();
process.exit(results.some((r) => r.fails.length) ? 1 : 0);
