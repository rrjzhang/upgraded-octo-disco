/* Great Vote log viewer: standalone, dependency-free. Reads gv:log:<ROOM> from localStorage or a .jsonl export,
   resolves ids against /content/*, and renders day > location > conversation > turn as <details> dropdowns. */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const CULTURE = { cn: 'Chinese', mx: 'Mexican', in: 'Indian' };

  // ------------------------------------------------------------ tiny DOM helper
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
    return e;
  }

  // ------------------------------------------------------------ parsers
  function parseCSV(text) {
    const rows = []; let row = []; let f = ''; let q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = ''; if (row.some((x) => x !== '')) rows.push(row); row = [];
      } else f += c;
    }
    row.push(f); if (row.some((x) => x !== '')) rows.push(row);
    const head = (rows.shift() || []).map((h) => h.trim());
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
  }

  /** Value of a YAML scalar: strips quotes and trailing comments. */
  function yval(s) {
    s = s.trim();
    if (s[0] === '"' || s[0] === "'") {
      const qc = s[0]; let out = '';
      for (let i = 1; i < s.length; i++) {
        if (qc === '"' && s[i] === '\\') { out += s[++i]; continue; }
        if (s[i] === qc) { if (qc === "'" && s[i + 1] === "'") { out += "'"; i++; continue; } break; }
        out += s[i];
      }
      return out;
    }
    return s.replace(/\s+#.*$/, '').trim();
  }
  /** Pulls key: value pairs out of a one-line flow map like `{ type: look, text: "a, b" }`. */
  function flowMap(s) {
    const o = {}; const re = /(\w+)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,{}]+)/g; let m;
    while ((m = re.exec(s))) o[m[1]] = yval(m[2]);
    return o;
  }
  /** Minimal reader for scenes.yaml / npcs.yaml: top-level list items with id, name, hotspots (id, label, action). */
  function parseItems(text) {
    const items = []; let cur = null; let section = ''; let hs = null;
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*(#|$)/.test(line)) continue;
      let m;
      if ((m = /^ {2}- id:\s*(.+)$/.exec(line))) { cur = { id: yval(m[1]), hotspots: [], exits: [] }; items.push(cur); section = ''; hs = null; continue; }
      if (!cur) continue;
      if ((m = /^ {4}(\w+):\s*(.*)$/.exec(line))) {
        section = m[1]; hs = null;
        if (m[1] === 'name' || m[1] === 'description') cur[m[1]] = yval(m[2]);
        continue;
      }
      if (section === 'hotspots') {
        if ((m = /^ {6}- \{(.*)\}\s*$/.exec(line))) { hs = flowMap(m[1]); cur.hotspots.push(hs); continue; }
        if ((m = /^ {6}- id:\s*(.+)$/.exec(line))) { hs = { id: yval(m[1]) }; cur.hotspots.push(hs); continue; }
        if (hs && (m = /^ {8}label:\s*(.+)$/.exec(line))) { hs.label = yval(m[1]); continue; }
        if (hs && (m = /^ {8}action:\s*\{(.*)\}/.exec(line))) { hs.action = flowMap(m[1]); continue; }
      }
      if (section === 'exits' && (m = /^ {6}- \{(.*)\}/.exec(line))) cur.exits.push(flowMap(m[1]));
    }
    return items;
  }

  // ------------------------------------------------------------ content
  const C = { npcs: new Map(), scenes: new Map(), dialogue: new Map(), events: new Map(), news: new Map(), missing: [] };
  async function fetchText(path) {
    try {
      const r = await fetch(path, { cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status);
      const t = await r.text();
      if (/^\s*<!doctype html/i.test(t)) throw new Error('html fallback'); // dev server SPA fallback for missing files
      return t;
    } catch (e) { C.missing.push(path); return null; }
  }
  async function loadContent() {
    const [npcs, scenes, events, news] = await Promise.all(['npcs.yaml', 'scenes.yaml', 'events.csv', 'news.csv'].map((f) => fetchText('content/' + f)));
    if (npcs) for (const n of parseItems(npcs)) C.npcs.set(n.id, n);
    if (scenes) for (const s of parseItems(scenes)) C.scenes.set(s.id, s);
    if (events) for (const r of parseCSV(events)) C.events.set(r.id, r);
    if (news) for (const r of parseCSV(news)) C.news.set(r.id, r);
    await Promise.all([...C.npcs.keys()].map(async (id) => {
      const t = await fetchText(`content/dialogue/${id}.csv`);
      if (t) C.dialogue.set(id, new Map(parseCSV(t).map((r) => [r.id, r])));
    }));
    // TV-only national leaders have no sheet; that is expected
    C.missing = C.missing.filter((p) => !/dialogue\/nat_/.test(p));
  }
  const contentReady = loadContent();

  // ------------------------------------------------------------ naming helpers
  let VARS = {};
  const fill = (s) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (VARS[k] != null ? VARS[k] : m));
  const npcName = (id) => (id && C.npcs.get(id)?.name) || id || 'someone';
  const sceneName = (id) => (id && C.scenes.get(id)?.name) || id || '?';
  function hotspotOf(scene, id) {
    const own = C.scenes.get(scene)?.hotspots.find((h) => h.id === id);
    if (own) return own;
    for (const s of C.scenes.values()) { const h = s.hotspots.find((x) => x.id === id); if (h) return h; }
    return null;
  }
  const dRow = (npc, rule) => C.dialogue.get(npc)?.get(rule) || null;
  const headline = (id) => (C.news.get(id) ? fill(C.news.get(id).headline) : null);
  const fmtTime = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour12: false }); };
  function fmtMs(ms) {
    if (!(ms >= 0)) return '';
    if (ms < 1000) return `${ms} ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)} s`;
    const m = Math.floor(s / 60);
    return `${m} min ${String(Math.round(s - m * 60)).padStart(2, '0')} s`;
  }
  const actionsSpent = (lines) => lines.reduce((a, l) => {
    const d = l.delta && l.delta.actions;
    return a + (Array.isArray(d) && d[0] > d[1] ? d[0] - d[1] : 0);
  }, 0);
  /** Human-readable delta, with npc ids swapped for names. */
  function fmtDelta(delta) {
    if (!delta || typeof delta !== 'object') return '';
    const parts = [];
    for (const [k, v] of Object.entries(delta)) {
      const [a, b] = Array.isArray(v) ? v : [undefined, v];
      let label = k; const dot = k.indexOf('.');
      if (dot > 0) label = `${npcName(k.slice(0, dot))} ${k.slice(dot + 1)}`;
      const money = k === 'wallet' ? '$' : '';
      parts.push(`${label} ${money}${a ?? '∅'}→${money}${b ?? '∅'}`);
    }
    return parts.join(', ');
  }

  // ------------------------------------------------------------ model
  function parseLog(text) {
    const lines = []; const bad = [];
    text.split(/\r?\n/).forEach((raw, i) => {
      if (!raw.trim()) return;
      try { const o = JSON.parse(raw); if (o && typeof o === 'object') lines.push(Object.assign(o, { _raw: raw, _n: i + 1 })); else bad.push(i + 1); }
      catch { bad.push(i + 1); }
    });
    return { lines, bad };
  }

  function build(lines) {
    const days = [];
    let day = null, loc = null;
    const convsByDay = new Map();
    for (const l of lines) {
      const dn = Number(l.day) || 0;
      if (!day || day.day !== dn) { day = { day: dn, lines: [], locs: [] }; days.push(day); loc = null; convsByDay.set(dn, []); }
      day.lines.push(l);
      const sc = l.scene || '?';
      if (!loc || loc.scene !== sc) { loc = { scene: sc, lines: [], items: [] }; day.locs.push(loc); }
      loc.lines.push(l);
      const last = loc.items[loc.items.length - 1];
      const convs = convsByDay.get(dn);
      if (l.type === 'dialogue') {
        const lastChoice = last && last.kind === 'conv' ? [...last.lines].reverse().find((x) => x.type === 'choice') : null;
        const cont = last && last.kind === 'conv' && last.target === l.target && !last.summary &&
          (l.followup || (lastChoice && lastChoice.next === l.rule));
        if (cont) last.lines.push(l);
        else { const c = { kind: 'conv', target: l.target, lines: [l] }; loc.items.push(c); convs.push(c); }
      } else if ((l.type === 'beat' && !l.event) || l.type === 'dev') {
        // Next inside a line, or a dev step back: part of the open conversation
        if (last && last.kind === 'conv' && last.target === l.target) last.lines.push(l); else loc.items.push({ kind: 'line', line: l });
      } else if (l.type === 'beat' && l.event) {
        const evItem = [...loc.items].reverse().find((x) => x.kind === 'event' && x.rule === l.rule);
        if (evItem) evItem.lines.push(l); else loc.items.push({ kind: 'line', line: l });
      } else if (l.type === 'choice' && !l.event) {
        if (last && last.kind === 'conv' && last.target === l.target) last.lines.push(l);
        else { const c = { kind: 'conv', target: l.target, lines: [l] }; loc.items.push(c); convs.push(c); }
      } else if (l.type === 'choice' && l.event) {
        const evItem = [...loc.items].reverse().find((x) => x.kind === 'event' && x.rule === l.rule);
        if (evItem) evItem.lines.push(l); else loc.items.push({ kind: 'event', rule: l.rule, lines: [l] });
      } else if (l.type === 'event') {
        loc.items.push({ kind: 'event', rule: l.rule, lines: [l] });
      } else if (l.type === 'conversation') {
        const c = [...convs].reverse().find((x) => x.target === l.target && !x.summary);
        if (c) { c.summary = l; c.lines.push(l); } else loc.items.push({ kind: 'line', line: l });
      } else {
        loc.items.push({ kind: 'line', line: l });
      }
    }
    return days;
  }

  function convStats(c) {
    const dl = c.lines.filter((l) => l.type === 'dialogue');
    const ch = c.lines.filter((l) => l.type === 'choice');
    const real = c.lines.filter((l) => l.type !== 'conversation');
    let valence = null, r0, r1;
    const vk = `${c.target}.lastValence`, rk = `${c.target}.rapport`;
    for (const l of ch) {
      const d = l.delta || {};
      if (Array.isArray(d[vk])) valence = d[vk][1];
      if (Array.isArray(d[rk])) { if (r0 === undefined) r0 = d[rk][0]; r1 = d[rk][1]; }
    }
    const t0 = Date.parse(real[0]?.t), t1 = Date.parse(real[real.length - 1]?.t);
    const s = c.summary;
    return {
      turns: s && Number.isFinite(s.turns) ? s.turns : Math.max(dl.length, ch.length),
      choices: ch.length,
      ms: s && Number.isFinite(s.ms) ? s.ms : (t1 - t0 || 0),
      // conversations since "pay when you stay" log `cost`; older logs: the actions their lines spent (start charge included)
      cost: s && Number.isFinite(s.cost) ? s.cost : actionsSpent(real),
      valence, r0, r1, exit: s ? s.exit : (ch.length && !ch[ch.length - 1].next ? 'ended' : dl.length > ch.length ? 'left without choosing' : ''),
      fromSummary: !!s,
    };
  }

  // ------------------------------------------------------------ line descriptions
  function describe(l) {
    const T = (s) => document.createTextNode(s);
    const q = (s) => el('span', { class: 'say', text: `“${fill(s)}”` });
    switch (l.type) {
      case 'start':
        if (l.target === 'game' || l.player) {
          const p = l.player || {};
          return [T('Game started: player '), el('b', { text: p.name || '?' }), T(`, home culture ${CULTURE[p.homeCulture] || p.homeCulture || '?'}, language ${p.language || '?'}; condition `), el('b', { text: l.config?.nationalLeader || '?' }),
            T(l.config?.seed != null ? `, seed ${l.config.seed}` : ''), T(l.content ? `, content ${l.content}` : '')];
        }
        return [T(`${String(l.target || '').replace(/^day/, 'Day ')} began with ${l.actions} actions`),
          l.invites && l.invites.length ? T(`; queued: ${l.invites.map((id) => id).join(', ')}`) : null];
      case 'move':
        return [T(`Walked to ${sceneName(l.target)}`), l.from ? T(` from ${sceneName(l.from)}`) : null];
      case 'hotspot': {
        const h = hotspotOf(l.scene, l.target);
        const label = h?.label || l.target;
        const t = h?.action?.type;
        if (t === 'news' || l.rule) {
          const hl = headline(l.rule);
          return [T(`Read the ${label.toLowerCase()}: `), hl ? el('b', { text: hl }) : T(l.rule ? l.rule : 'no story available')];
        }
        if (t === 'look') return [T(`Looked at ${label}`), h.action.text ? el('span', { class: 'small', text: fill(h.action.text) }) : null];
        if (t === 'end_day') return [T(`Clicked ${label} (end the day)`)];
        if (t === 'move') return [T(`Clicked ${label} (go to ${sceneName(h.action.to)})`)];
        if (t === 'window') return [T(`Clicked ${label} (${h.action.module} window)`)];
        return [T(`Clicked ${label}`)];
      }
      case 'window': {
        const m = l.target;
        if (l.op === 'earn') return [T(`Earned $${(l.delta?.wallet?.[1] ?? 0) - (l.delta?.wallet?.[0] ?? 0)} in the ${m} window`)];
        if (m === 'tv') {
          const hl = headline(l.rule);
          return [T(l.op === 'spend' ? 'Kept watching TV: ' : 'Watched TV: '), hl ? el('b', { text: hl }) : T(l.rule || '(no story)')];
        }
        if (m === 'work') return [T(l.op === 'spend' ? `Worked a shift (${actionsSpent([l])} actions)` : 'Opened the work computer')];
        return [T(`${l.op ? l.op + ' in' : 'Opened'} the ${m} window`)];
      }
      case 'journal':
        return [T('Wrote in the phone journal: '), el('span', { class: 'say', text: `“${l.text ?? ''}”` })];
      case 'survey': {
        const a = l.answers || {};
        const sc = a.scores || {};
        const items = Object.entries(a).filter(([k]) => !['scores', 'labels', 'instrument', 'filledRandomly'].includes(k));
        return [T(`Submitted survey ${l.target || ''}`), a.instrument ? T(` (${a.instrument})`) : null, l.source ? T(` [${l.source}]`) : null,
          sc.harmony != null || sc.blendedness != null ? el('span', { class: 'scores', text: ` — harmony ${fmtN(sc.harmony)}, blendedness ${fmtN(sc.blendedness)}` }) : null,
          a.filledRandomly ? el('span', { class: 'tag amber', text: 'filled randomly' }) : null,
          el('span', { class: 'small', text: items.map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join('  ') }),
          Object.keys(sc).length ? el('span', { class: 'small', text: 'scores: ' + Object.entries(sc).map(([k, v]) => `${k} ${fmtN(v)}`).join(', ') }) : null];
      }
      case 'day_end': {
        const n = l.npcs || {};
        const ppl = Object.entries(n).map(([id, s]) => `${npcName(id)} rapport ${s.rapport} (${s.lastValence})`).join('; ');
        const sp = l.spent ? ` Time spent: home ${l.spent.home}, us ${l.spent.us}, neutral ${l.spent.neutral}.` : '';
        return [T(`${String(l.target || 'Day').replace(/^day/, 'Day ')} ended. Wallet $${l.wallet ?? 0}.${sp}`), ppl ? el('span', { class: 'small', text: `Met so far: ${ppl}` }) : null];
      }
      case 'conversation':
        return [T(`Conversation summary: ${l.turns} turns, ${fmtMs(l.ms)}, exit ${l.exit || '?'}${Number.isFinite(l.cost) ? `, cost ${l.cost} action${l.cost === 1 ? '' : 's'}` : ''}`), l.rules ? el('span', { class: 'small', text: `rules ${l.rules.join(' → ')}` }) : null];
      case 'dialogue': {
        const r = dRow(l.target, l.rule);
        return [el('span', { class: 'who', text: `${npcName(l.target)} said: ` }), r ? q(r.line) : T(`(line ${l.rule} not found)`),
          el('span', { class: 'small' }, el('span', { class: 'id', text: l.rule }), r?.emotion ? T(` · ${r.emotion}`) : null, l.followup ? T(' · follow-up') : null, l.delta ? T(` · ${fmtDelta(l.delta)}`) : null)];
      }
      case 'choice': {
        let text = null;
        if (l.event) text = C.events.get(l.rule)?.[`choice${l.choice}`];
        else text = dRow(l.target, l.rule)?.[`choice${l.choice}`];
        const d = fmtDelta(l.delta);
        return [el('span', { class: 'chose' }, T('Chose: '), text ? q(text) : T(`option ${l.choice}`)),
          el('span', { class: 'small' }, el('span', { class: 'id', text: `${l.rule} #${l.choice}` }), l.next ? T(` → ${l.next}`) : null,
            l.charged ? el('b', { text: ` · charged ${l.charged} action${l.charged === 1 ? '' : 's'}${l.stay ? ' (stayed past turn 3)' : ''}` }) : null, T(d ? ` · ${d}` : ' · no effect'))];
      }
      case 'event': {
        const e = C.events.get(l.rule);
        return [el('span', { class: 'who', text: `Event${e?.npc ? ` (${npcName(e.npc)})` : ''}: ` }), e ? q(e.text) : T(l.rule || '?'),
          el('span', { class: 'small' }, el('span', { class: 'id', text: l.rule }), l.trigger ? T(` · trigger ${l.trigger}`) : null,
            e ? T(` · ${e.valence} ${e.proximity}, ${e.source}→${e.target}`) : null, l.delta ? T(` · ${fmtDelta(l.delta)}`) : null)];
      }
      case 'profile':
        return [el('span', { class: 'who', text: 'Profile: ' }), T(`heritage ${l.heritage || '?'} → pack ${l.pack || '?'}` + (l.variant && Object.keys(l.variant).length ? `, ${Object.entries(l.variant).map(([k, v]) => `${k} ${v}`).join(', ')}` : ', no variant'))];
      case 'beat':
        return [el('span', { class: 'who', text: 'Next: ' }), T(`beat ${l.beat} of the line`), el('span', { class: 'small' }, el('span', { class: 'id', text: l.rule }))];
      case 'dev':
        return [el('span', { class: 'who', text: 'Dev: ' }), T(l.op === 'back' ? 'stepped back one choice or beat' : String(l.op || 'action')), el('span', { class: 'small' }, el('span', { class: 'id', text: l.rule || '' }))];
      default:
        return [T(`${l.type || 'line'}${l.target ? ' ' + l.target : ''}${l.rule ? ' ' + l.rule : ''}`), l.delta ? el('span', { class: 'small', text: fmtDelta(l.delta) }) : null];
    }
  }
  const fmtN = (v) => (typeof v === 'number' ? (Math.round(v * 100) / 100).toFixed(2) : v == null ? '–' : String(v));

  function rowFor(l) {
    const raw = el('pre', { class: 'raw', text: l._raw });
    raw.hidden = !$('#rawAll').checked;
    const btn = el('button', { class: 'raw-btn', type: 'button', title: `Raw JSON (line ${l._n})`, 'aria-label': `Show raw JSON for line ${l._n}`, 'aria-pressed': String(!raw.hidden), text: '{}' });
    btn.addEventListener('click', () => { raw.hidden = !raw.hidden; btn.setAttribute('aria-pressed', String(!raw.hidden)); });
    const r = el('div', { class: 'row', 'data-type': l.type }, el('span', { class: 't', text: fmtTime(l.t) }), el('span', { class: 'txt' }, describe(l)), btn, raw);
    return r;
  }

  const bits = (...xs) => el('span', { class: 's-bits' }, xs.filter(Boolean).map((x) => (x.nodeType ? el('span', {}, x) : el('span', { text: x }))));

  function renderConv(c) {
    const st = convStats(c);
    const rch = st.r0 !== undefined && st.r1 !== undefined ? st.r1 - st.r0 : 0;
    const val = st.valence ? el('span', { class: `tag ${st.valence}`, text: `valence ${st.valence}` }) : el('span', { class: 'tag', text: 'valence unchanged' });
    const rap = st.r0 !== undefined ? el('span', { class: rch > 0 ? 'up' : rch < 0 ? 'down' : '', text: `rapport ${st.r0}→${st.r1} (${rch >= 0 ? '+' : ''}${rch})` }) : 'rapport unchanged';
    const d = el('details', { class: 'conv' },
      el('summary', {}, el('span', { class: 's-title', text: `Talked with ${npcName(c.target)}` }),
        bits(`${st.turns} turn${st.turns === 1 ? '' : 's'}`, `${st.cost} action${st.cost === 1 ? '' : 's'}`, val, rap, fmtMs(st.ms), st.exit ? `exit: ${st.exit}` : '', st.fromSummary ? 'from summary line' : '')),
      el('div', { class: 'conv-body' }, c.lines.map(rowFor)));
    return d;
  }
  function renderEvent(e) {
    const ev = C.events.get(e.rule);
    const ch = e.lines.find((l) => l.type === 'choice');
    const chText = ch ? (ev?.[`choice${ch.choice}`] || `option ${ch.choice}`) : null;
    return el('details', { class: 'ev' },
      el('summary', {}, el('span', { class: 's-title', text: `Event ${e.rule}` }),
        bits(ev ? `${ev.valence} ${ev.proximity}` : '', ev?.npc ? npcName(ev.npc) : '', chText ? `chose “${fill(chText)}”` : ev && ev.choice1 ? 'no choice logged' : 'no choices')),
      el('div', { class: 'conv-body' }, e.lines.map(rowFor)));
  }

  function locWhat(loc) {
    const out = []; const talked = new Map();
    for (const it of loc.items) {
      if (it.kind === 'conv') talked.set(it.target, (talked.get(it.target) || 0) + 1);
    }
    for (const [id, n] of talked) out.push(`talked to ${npcName(id)}${n > 1 ? ' ×' + n : ''}`);
    for (const it of loc.items) {
      if (it.kind === 'event') out.push(`event ${it.rule}`);
      if (it.kind !== 'line') continue;
      const l = it.line;
      if (l.type === 'hotspot') {
        const h = hotspotOf(l.scene, l.target);
        const t = h?.action?.type;
        if (t === 'look') out.push(`looked at ${(h.label || l.target).toLowerCase()}`);
        else if (t === 'news' || l.rule) out.push('read the paper');
        else if (t === 'end_day') out.push('went to bed');
      } else if (l.type === 'window' && !l.op) out.push(l.target === 'tv' ? 'watched TV' : l.target === 'work' ? 'worked a shift' : `${l.target} window`);
      else if (l.type === 'window' && l.op === 'earn') out.push(`earned $${(l.delta?.wallet?.[1] ?? 0) - (l.delta?.wallet?.[0] ?? 0)}`);
      else if (l.type === 'journal') out.push('wrote in journal');
      else if (l.type === 'survey') out.push('survey');
    }
    const uniq = [...new Set(out)];
    if (!uniq.length) return loc.lines.every((l) => l.type === 'move') ? 'passed through' : '';
    return uniq.join(', ');
  }

  function renderLoc(loc) {
    const t0 = fmtTime(loc.lines[0].t), t1 = fmtTime(loc.lines[loc.lines.length - 1].t);
    const spent = actionsSpent(loc.lines);
    return el('details', { class: 'loc' },
      el('summary', {}, el('span', { class: 's-title', text: sceneName(loc.scene) }),
        bits(t0 === t1 ? t0 : `${t0}–${t1}`, `${spent} action${spent === 1 ? '' : 's'}`, locWhat(loc))),
      el('div', { class: 'loc-body' }, loc.items.map((it) => (it.kind === 'conv' ? renderConv(it) : it.kind === 'event' ? renderEvent(it) : rowFor(it.line)))));
  }

  function renderDay(day, open) {
    const spent = actionsSpent(day.lines);
    const scenes = [...new Set(day.locs.map((l) => l.scene).filter((s) => s !== 'street'))].map(sceneName);
    const talk = new Map();
    for (const loc of day.locs) for (const it of loc.items) if (it.kind === 'conv') talk.set(it.target, (talk.get(it.target) || 0) + 1);
    const people = [...talk].map(([id, n]) => `${npcName(id)}${n > 1 ? ' ×' + n : ''}`);
    const lastLean = (day.lines.find((l) => l.type === 'day_end') || day.lines[day.lines.length - 1])?.lean;
    const sv = day.lines.filter((l) => l.type === 'survey').pop();
    const sc = sv?.answers?.scores;
    const survey = sv ? el('span', { class: 'tag positive', text: sc ? `survey: harmony ${fmtN(sc.harmony)}, blendedness ${fmtN(sc.blendedness)}` : 'survey submitted' })
      : el('span', { class: 'tag', text: day.lines.some((l) => l.type === 'day_end') ? 'no survey' : 'survey not yet' });
    return el('details', { class: 'day', open },
      el('summary', {}, el('span', { class: 's-title', text: day.day ? `Day ${day.day}` : 'No day' }),
        bits(`${spent} action${spent === 1 ? '' : 's'} spent`, scenes.length ? scenes.join(', ') : 'no visits', people.length ? `talked to ${people.join(', ')}` : 'talked to nobody',
          lastLean ? `lean ${lastLean}` : '', survey)),
      el('div', { class: 'day-body' }, day.locs.map(renderLoc)));
  }

  // ------------------------------------------------------------ load + render
  let current = { text: '', label: '' };
  async function show(text, label) {
    current = { text, label };
    await contentReady;
    const { lines, bad } = parseLog(text);
    const start = lines.find((l) => l.type === 'start' && l.player);
    const cfg = start?.config || {};
    const leader = C.npcs.get(`nat_${cfg.nationalLeader}`);
    VARS = {};
    if (start?.player?.name) VARS.playerName = start.player.name;
    const pk = start?.player?.pack || start?.player?.homeCulture;
    if (pk) VARS.homeCulture = CULTURE[pk] || pk;
    if (leader) VARS.leaderName = leader.name;
    const out = $('#out');
    if (!lines.length) {
      out.replaceChildren(el('p', { class: 'empty', text: `No log lines in ${label}.` }));
    } else {
      const days = build(lines);
      out.replaceChildren(...days.map((d, i) => renderDay(d, i === days.length - 1)));
    }
    const room = lines.find((l) => l.room)?.room;
    $('#meta').replaceChildren(...[
      document.createTextNode('Showing '), el('b', { text: label }), document.createTextNode(` · ${lines.length} lines`),
      room ? document.createTextNode(` · room ${room}`) : null,
      start?.player ? document.createTextNode(` · player ${start.player.name || '?'} (${CULTURE[start.player.homeCulture] || start.player.homeCulture || '?'})`) : null,
      cfg.nationalLeader ? document.createTextNode(` · condition ${cfg.nationalLeader}`) : null,
      bad.length ? el('span', { class: 'warn', text: ` · ${bad.length} unparseable line${bad.length > 1 ? 's' : ''} (${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''})` }) : null,
      C.missing.length ? el('span', { class: 'warn', text: ` · content not found: ${C.missing.join(', ')}` }) : null].filter(Boolean));
    applyFilter();
  }

  function lsKeys() {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('gv:log:')) out.push(k.slice(7)); } } catch { /* storage blocked */ }
    return out.sort();
  }
  function lsLog(code) { try { return localStorage.getItem('gv:log:' + code); } catch { return null; } }
  function renderRooms(active) {
    const box = $('#rooms');
    const codes = lsKeys();
    box.replaceChildren(...codes.map((c) => {
      const n = (lsLog(c) || '').split('\n').filter(Boolean).length;
      return el('button', { type: 'button', class: 'room-chip' + (c === active ? ' on' : ''), title: `Load room ${c}`, onclick: () => loadRoom(c) }, c, el('small', { text: String(n) }));
    }));
    if (!codes.length) box.append(el('span', { class: 'meta', text: 'no logs in this browser' }));
  }
  function loadRoom(code) {
    code = String(code || '').trim().toUpperCase();
    if (!code) return;
    $('#room').value = code;
    const t = lsLog(code);
    renderRooms(code);
    try { const u = new URL(location.href); u.searchParams.set('room', code); history.replaceState(null, '', u); } catch { /* ignore */ }
    if (t == null) { $('#out').replaceChildren(el('p', { class: 'empty', text: `No log for room ${code} in this browser (key gv:log:${code}).` })); $('#meta').textContent = `Room ${code}: nothing stored.`; return; }
    show(t, `room ${code} (localStorage)`);
  }
  function loadFile(f) {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { renderRooms(null); show(String(r.result || ''), f.name); };
    r.onerror = () => { $('#meta').textContent = `Could not read ${f.name}.`; };
    r.readAsText(f);
  }

  // ------------------------------------------------------------ filter / expand
  function applyFilter() {
    const q = $('#filter').value.trim().toLowerCase();
    const rows = document.querySelectorAll('#out .row');
    for (const r of rows) {
      if (!q) { r.hidden = false; continue; }
      const hay = (r.querySelector('.txt').textContent + ' ' + r.querySelector('.raw').textContent).toLowerCase();
      r.hidden = !hay.includes(q);
    }
    const groups = [...document.querySelectorAll('#out details')].reverse(); // innermost first
    for (const d of groups) {
      if (!q) { d.hidden = false; continue; }
      const any = d.querySelector('.row:not([hidden])');
      d.hidden = !any;
      if (any) d.open = true;
    }
  }
  const setAll = (open) => document.querySelectorAll('#out details').forEach((d) => { d.open = open; });

  // ------------------------------------------------------------ wire up
  $('#roomForm').addEventListener('submit', (e) => { e.preventDefault(); loadRoom($('#room').value); });
  $('#file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
  $('#filter').addEventListener('input', applyFilter);
  $('#expand').addEventListener('click', () => setAll(true));
  $('#collapse').addEventListener('click', () => setAll(false));
  $('#rawAll').addEventListener('change', (e) => {
    document.querySelectorAll('#out .row').forEach((r) => {
      r.querySelector('.raw').hidden = !e.target.checked;
      r.querySelector('.raw-btn').setAttribute('aria-pressed', String(e.target.checked));
    });
  });
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; $('#drop').hidden = false; } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').hidden = true; } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('#drop').hidden = true; loadFile(e.dataTransfer?.files?.[0]); });
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('gv:log:')) {
      const active = current.label.startsWith('room ') ? current.label.split(' ')[1] : null;
      renderRooms(active);
      if (active && e.key === 'gv:log:' + active) show(e.newValue || '', current.label);
    }
  });

  // expose for tests / console
  window.logview = { loadRoom, show, parseCSV, parseItems, content: C };

  const want = new URLSearchParams(location.search).get('room');
  const codes = lsKeys();
  renderRooms(null);
  if (want) loadRoom(want);
  else if (codes.length === 1) loadRoom(codes[0]);
  else if (codes.includes('DEV1')) loadRoom('DEV1');
})();
