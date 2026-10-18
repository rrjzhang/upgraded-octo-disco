#!/usr/bin/env node
// Great Vote content checker: schema validation, completeness and reachability
// of parameter-conditioned dialogue sheets. See README.md and demo/SPEC.md.
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import Papa from 'papaparse';

// ---------------------------------------------------------------- vocabulary
export const DIALOGUE_COLUMNS = 'id,met,rapport,lastValence,nationalLeader,playerLean,dayPhase,priority,emotion,line,choice1,effect1,next1,choice2,effect2,next2,choice3,effect3,next3'.split(',');
export const EVENT_COLUMNS = 'id,source,target,valence,proximity,trigger,scene,npc,minRapport,playerLean,nationalLeader,chance,cost,emotion,text,choice1,effect1,choice2,effect2'.split(',');
export const NEWS_COLUMNS = 'id,channel,nationalLeader,dayMin,valence,headline,body'.split(',');

const DIMS = [
  { key: 'met', values: ['no', 'yes'] },
  { key: 'rapport', values: ['0', '1', '2', '3'] },
  { key: 'lastValence', values: ['none', 'positive', 'negative'] },
  { key: 'nationalLeader', values: ['enforcement', 'inclusive'] },
  { key: 'playerLean', values: ['us-leaning', 'balanced', 'home-leaning'] },
  { key: 'dayPhase', values: ['early', 'mid', 'late'] },
];
const RADIX = DIMS.map(d => d.values.length);
const NCELLS = RADIX.reduce((a, b) => a * b, 1); // 432
const NSTATE = 24; // met x rapport x lastValence
const NWORLD = 18; // nationalLeader x playerLean x dayPhase
const BUDGET = 40;

const EMOTIONS = ['neutral', 'warm', 'guarded', 'worried'];
const COMMUNITY_SCENE = ['home', 'us', 'neutral'];
const LIGHTING = ['warm_indoor', 'cool_indoor', 'outdoor'];
const ACTION_TYPES = ['window', 'news', 'end_day', 'move', 'look', 'talk'];
const MODULES = ['tv', 'work', 'survey'];
const PACKS = ['shared', 'cn', 'mx', 'in'];
const NPC_COMMUNITY = ['us', 'home', 'other', 'bicultural'];
const ROLES = ['neighbor', 'stranger', 'local_leader', 'national_leader'];
const STANCES = ['integration', 'separation', 'none'];
const EV_SIDES = ['us', 'home', 'other', 'bicultural'];
const VALENCE = ['positive', 'negative'];
const PROXIMITY = ['proximal', 'distal'];
const TRIGGERS = ['day_start', 'enter', 'invite'];
const CHANNELS = ['tv', 'print'];

const cellIndex = (v) => v.reduce((acc, x, i) => acc * RADIX[i] + x, 0);
function cellVector(c) {
  const v = new Array(6);
  for (let i = 5; i >= 0; i--) { v[i] = c % RADIX[i]; c = Math.floor(c / RADIX[i]); }
  return v;
}
const stateOf = (v) => (v[0] * 4 + v[1]) * 3 + v[2];
const stateVec = (s) => [Math.floor(s / 12), Math.floor(s / 3) % 4, s % 3];
const cellLabel = (c) => cellVector(c).map((x, i) => `${DIMS[i].key}=${DIMS[i].values[x]}`).join(', ');

// ---------------------------------------------------------------- diagnostics
class Diag {
  constructor() { this.list = []; }
  add(severity, code, file, loc, message, extra = {}) {
    this.list.push({ severity, code, file, ...loc, message, ...extra });
  }
  error(code, file, loc, message, extra) { this.add('error', code, file, loc, message, extra); }
  warn(code, file, loc, message, extra) { this.add('warning', code, file, loc, message, extra); }
  info(code, file, loc, message, extra) { this.add('info', code, file, loc, message, extra); }
}
export function formatDiag(d) {
  const where = [d.file, d.line != null ? `line ${d.line}` : null, d.row != null ? `row ${d.row}` : null, d.column ? `column ${d.column}` : null, d.path || null].filter(Boolean).join(' ');
  return `${d.severity.toUpperCase().padEnd(7)} [${d.code}] ${where}: ${d.message}`;
}

// ---------------------------------------------------------------- loaders
function readCsv(file, rel, expected, diag, required = true) {
  if (!fs.existsSync(file)) {
    if (required) diag.error('MISSING_FILE', rel, {}, 'file not found');
    return null;
  }
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const records = [];
  let prevCursor = 0;
  // line number of each record = 1 + newlines before its start offset
  const nlBefore = (off) => { let n = 0; for (let i = 0; i < off && i < text.length; i++) if (text[i] === '\n') n++; return n; };
  Papa.parse(text, {
    skipEmptyLines: false,
    step: (res) => {
      let start = prevCursor;
      while (start < text.length && (text[start] === '\n' || text[start] === '\r')) start++;
      records.push({ data: res.data, line: 1 + nlBefore(start), errors: res.errors });
      prevCursor = res.meta.cursor;
    },
  });
  if (!records.length) { diag.error('EMPTY_FILE', rel, {}, 'file is empty'); return null; }
  const header = records[0].data.map(h => h.trim());
  let ok = true;
  const unknown = header.filter(h => !expected.includes(h));
  const missing = expected.filter(h => !header.includes(h));
  for (const h of unknown) { diag.error('UNKNOWN_COLUMN', rel, { line: 1, column: h }, `unknown column "${h}"; expected exactly: ${expected.join(',')}`); ok = false; }
  for (const h of missing) { diag.error('MISSING_COLUMN', rel, { line: 1, column: h }, `missing column "${h}"; expected exactly: ${expected.join(',')}`); ok = false; }
  if (ok && header.join(',') !== expected.join(',')) diag.error('COLUMN_ORDER', rel, { line: 1 }, `columns out of order; expected: ${expected.join(',')}`);
  const dupes = header.filter((h, i) => header.indexOf(h) !== i);
  for (const h of new Set(dupes)) diag.error('DUPLICATE_COLUMN', rel, { line: 1, column: h }, `column "${h}" appears more than once`);
  const rows = [];
  for (const rec of records.slice(1)) {
    if (rec.data.length === 1 && rec.data[0].trim() === '') continue; // blank line
    for (const e of rec.errors) diag.error('CSV_PARSE', rel, { line: rec.line }, e.message);
    if (rec.data.length !== header.length) diag.error('FIELD_COUNT', rel, { line: rec.line }, `has ${rec.data.length} fields, header has ${header.length}`);
    const row = { __line: rec.line };
    for (const h of expected) row[h] = '';
    header.forEach((h, i) => { row[h] = (rec.data[i] ?? '').trim(); });
    rows.push(row);
  }
  return rows;
}

function readYaml(file, rel, diag) {
  if (!fs.existsSync(file)) { diag.error('MISSING_FILE', rel, {}, 'file not found'); return null; }
  const text = fs.readFileSync(file, 'utf8');
  try {
    return { doc: yaml.load(text), text };
  } catch (e) {
    diag.error('YAML_PARSE', rel, { line: e.mark ? e.mark.line + 1 : undefined }, e.reason || e.message);
    return null;
  }
}
// best-effort line lookup for a YAML item with a given id
function yamlLine(text, id) {
  if (!text || id == null) return undefined;
  const re = new RegExp(`(^|[\\s{,-])id:\\s*["']?${String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*([,}#]|$)`, 'm');
  const m = re.exec(text);
  return m ? text.slice(0, m.index).split('\n').length + (m[1] === '\n' ? 1 : 0) : undefined;
}

// ---------------------------------------------------------------- conditions / effects
// returns {set:Set<int>|null, error?:string}
function parseCondition(dimIdx, raw) {
  const dim = DIMS[dimIdx];
  if (raw === '') return { set: null };
  if (dim.key === 'rapport') {
    let m;
    if ((m = /^([0-3])$/.exec(raw))) return { set: new Set([+m[1]]) };
    if ((m = /^([0-3])\+$/.exec(raw))) { const s = new Set(); for (let i = +m[1]; i <= 3; i++) s.add(i); return { set: s }; }
    if ((m = /^([0-3])-([0-3])$/.exec(raw))) {
      const a = +m[1], b = +m[2];
      if (a > b) return { error: `range "${raw}" is empty (lower bound above upper bound)` };
      const s = new Set(); for (let i = a; i <= b; i++) s.add(i); return { set: s };
    }
    return { error: `"${raw}" is not a rapport condition; expected 0|1|2|3, a range like 1-3, or N+ like 2+` };
  }
  const i = dim.values.indexOf(raw);
  if (i < 0) return { error: `"${raw}" is not valid; expected one of ${dim.values.join('|')} or blank` };
  return { set: new Set([i]) };
}

// effect ops: {op:'met',v} {op:'rapport',mode:'add'|'set',v} {op:'lastValence',v} {op:'money',v} {op:'invite',id} {op:'actions',v}
function parseEffects(raw, eventIds) {
  const ops = [], errors = [];
  if (!raw) return { ops, errors };
  for (const part of raw.split(';')) {
    const tok = part.trim();
    if (!tok) continue;
    const [name, ...rest] = tok.split(/\s+/);
    const arg = rest.join(' ');
    let m;
    if (name === 'met' && arg === 'yes') ops.push({ op: 'met', v: 1 });
    else if (name === 'rapport' && (m = /^([+-])?(\d+)$/.exec(arg))) {
      const n = +m[2];
      if (!m[1] && n > 3) errors.push(`"${tok}": absolute rapport must be 0..3`);
      else ops.push({ op: 'rapport', mode: m[1] ? 'add' : 'set', v: m[1] === '-' ? -n : n });
    } else if (name === 'lastValence' && ['positive', 'negative', 'none'].includes(arg)) ops.push({ op: 'lastValence', v: ['none', 'positive', 'negative'].indexOf(arg) });
    else if (name === 'money' && (m = /^[+-]?\d+$/.exec(arg))) ops.push({ op: 'money', v: +arg });
    else if (name === 'invite' && /^\S+$/.test(arg)) {
      if (eventIds && !eventIds.has(arg)) errors.push(`"${tok}": event "${arg}" does not exist in events.csv`);
      ops.push({ op: 'invite', id: arg });
    } else if (name === 'actions' && (m = /^-(\d+)$/.exec(arg)) && +m[1] > 0) ops.push({ op: 'actions', v: +m[1] });
    else errors.push(`unknown effect token "${tok}"; expected met yes | rapport +N/-N/N | lastValence positive|negative|none | money +N | invite <eventId> | actions -N`);
  }
  return { ops, errors };
}

const NPC_STATE_OPS = new Set(['met', 'rapport', 'lastValence']);

// apply effects to an NPC state; returns {s, mask, extra}
function applyEffects(s, mask, ops, inviteBit) {
  let [met, rap, lv] = stateVec(s);
  let extra = 0;
  for (const o of ops) {
    if (o.op === 'met') met = o.v;
    else if (o.op === 'rapport') rap = Math.max(0, Math.min(3, o.mode === 'add' ? rap + o.v : o.v));
    else if (o.op === 'lastValence') lv = o.v;
    else if (o.op === 'actions') extra += o.v;
    else if (o.op === 'invite' && inviteBit.has(o.id)) mask |= inviteBit.get(o.id);
  }
  return { s: (met * 4 + rap) * 3 + lv, mask, extra };
}

// ---------------------------------------------------------------- schema validation
// asset lookup in a manifest section, following manifest.aliases (SPEC's base id -> manifest key) if present
const hasAsset = (assets, section, id) => !!(assets?.[section]?.[id] || (assets?.aliases?.[id] && assets[section]?.[assets.aliases[id]]));
const isFrac = (x) => typeof x === 'number' && x >= 0 && x <= 1;

function validateScenes(content, diag, assets) {
  const rel = 'scenes.yaml';
  const y = readYaml(path.join(content, rel), rel, diag);
  const scenes = new Map();
  if (!y) return scenes;
  const list = y.doc && y.doc.scenes;
  if (!Array.isArray(list)) { diag.error('SCHEMA', rel, { path: 'scenes' }, 'expected a top-level "scenes" list'); return scenes; }
  list.forEach((sc, i) => {
    const p = `scenes[${i}]`;
    const loc = (sub) => ({ line: yamlLine(y.text, sc && sc.id), path: sub ? `${p}.${sub}` : p });
    if (!sc || typeof sc !== 'object') { diag.error('SCHEMA', rel, loc(), 'expected a mapping'); return; }
    if (!sc.id || typeof sc.id !== 'string') { diag.error('SCHEMA', rel, loc('id'), 'missing or non-string id'); return; }
    if (scenes.has(sc.id)) diag.error('DUPLICATE_ID', rel, loc('id'), `duplicate scene id "${sc.id}"`);
    scenes.set(sc.id, { ...sc, slotIds: new Set() });
    if (!sc.name) diag.error('SCHEMA', rel, loc('name'), 'missing name');
    if (!COMMUNITY_SCENE.includes(sc.community)) diag.error('BAD_VALUE', rel, loc('community'), `community "${sc.community}"; expected ${COMMUNITY_SCENE.join('|')}`);
    if (sc.background == null || sc.background === '') diag.error('SCHEMA', rel, loc('background'), 'missing background (use "none" for hub scenes)');
    else if (sc.background !== 'none' && assets && !hasAsset(assets, 'backgrounds', sc.background)) diag.warn('UNKNOWN_ASSET', rel, loc('background'), `background "${sc.background}" not in assets/manifest.json`);
    if (sc.horizon != null && !(typeof sc.horizon === 'number' && sc.horizon > 0 && sc.horizon < 1)) diag.error('BAD_VALUE', rel, loc('horizon'), `horizon must be a fraction 0..1, got ${JSON.stringify(sc.horizon)}`);
    if (sc.cameraHeight != null && !(typeof sc.cameraHeight === 'number' && sc.cameraHeight > 0 && sc.cameraHeight < 5)) diag.error('BAD_VALUE', rel, loc('cameraHeight'), `cameraHeight must be metres (0..5), got ${JSON.stringify(sc.cameraHeight)}`);
    if (sc.lighting != null && !LIGHTING.includes(sc.lighting)) diag.error('BAD_VALUE', rel, loc('lighting'), `lighting "${sc.lighting}"; expected ${LIGHTING.join('|')}`);
    for (const [j, pr] of (sc.props || []).entries()) {
      if (!pr || !pr.asset) diag.error('SCHEMA', rel, loc(`props[${j}]`), 'prop needs asset');
      else if (assets && !hasAsset(assets, 'props', pr.asset)) diag.warn('UNKNOWN_ASSET', rel, loc(`props[${j}].asset`), `prop "${pr.asset}" not in assets/manifest.json`);
      for (const k of ['x', 'y', 'w']) if (pr && !isFrac(pr[k])) diag.error('BAD_VALUE', rel, loc(`props[${j}].${k}`), `expected a fraction 0..1, got ${JSON.stringify(pr[k])}`);
    }
    const hsIds = new Set();
    for (const [j, h] of (sc.hotspots || []).entries()) {
      const hp = `hotspots[${j}]`;
      if (!h || !h.id) { diag.error('SCHEMA', rel, loc(hp), 'hotspot needs id'); continue; }
      if (hsIds.has(h.id)) diag.error('DUPLICATE_ID', rel, loc(`${hp}.id`), `duplicate hotspot id "${h.id}" in scene ${sc.id}`);
      hsIds.add(h.id);
      if (!h.label) diag.error('SCHEMA', rel, loc(`${hp}.label`), 'hotspot needs label');
      const z = h.zone || {};
      for (const k of ['x', 'y', 'w', 'h']) if (!isFrac(z[k])) diag.error('BAD_VALUE', rel, loc(`${hp}.zone.${k}`), `expected a fraction 0..1, got ${JSON.stringify(z[k])}`);
      if (isFrac(z.x) && isFrac(z.w) && z.x + z.w > 1.0001) diag.error('BAD_VALUE', rel, loc(`${hp}.zone`), 'zone extends past the right edge (x + w > 1)');
      if (isFrac(z.y) && isFrac(z.h) && z.y + z.h > 1.0001) diag.error('BAD_VALUE', rel, loc(`${hp}.zone`), 'zone extends past the bottom edge (y + h > 1)');
      const a = h.action || {};
      if (!ACTION_TYPES.includes(a.type)) diag.error('BAD_VALUE', rel, loc(`${hp}.action.type`), `action type "${a.type}"; expected ${ACTION_TYPES.join('|')}`);
      if (a.type === 'window' && !MODULES.includes(a.module)) diag.error('BAD_VALUE', rel, loc(`${hp}.action.module`), `module "${a.module}"; expected ${MODULES.join('|')}`);
      if (a.type === 'look' && !a.text) diag.error('SCHEMA', rel, loc(`${hp}.action.text`), 'look action needs text');
      if (a.type === 'talk' && !a.npc) diag.error('SCHEMA', rel, loc(`${hp}.action.npc`), 'talk action needs npc');
      if (h.placeholder != null && typeof h.placeholder !== 'boolean') diag.error('BAD_VALUE', rel, loc(`${hp}.placeholder`), 'placeholder must be true or false');
      if (a.cost != null && !(Number.isInteger(a.cost) && a.cost >= 0)) diag.error('BAD_VALUE', rel, loc(`${hp}.action.cost`), `cost must be a non-negative integer, got ${JSON.stringify(a.cost)}`);
    }
    if (sc.painted != null) {
      const pt = sc.painted;
      if (!pt || typeof pt !== 'object' || !pt.background) diag.error('SCHEMA', rel, loc('painted'), 'painted needs { background, npcs }');
      else {
        if (assets && !hasAsset(assets, 'backgrounds', pt.background)) diag.warn('UNKNOWN_ASSET', rel, loc('painted.background'), `painted background "${pt.background}" not in assets/manifest.json (the plain background is used until it is)`);
        if (!Array.isArray(pt.npcs) || !pt.npcs.length) diag.error('SCHEMA', rel, loc('painted.npcs'), 'painted needs a non-empty npcs list');
      }
    }
    for (const [j, sl] of (sc.slots || []).entries()) {
      if (!sl || !sl.id) { diag.error('SCHEMA', rel, loc(`slots[${j}]`), 'slot needs id'); continue; }
      if (scenes.get(sc.id).slotIds.has(sl.id)) diag.error('DUPLICATE_ID', rel, loc(`slots[${j}].id`), `duplicate slot id "${sl.id}"`);
      scenes.get(sc.id).slotIds.add(sl.id);
      if (!isFrac(sl.x)) diag.error('BAD_VALUE', rel, loc(`slots[${j}].x`), `expected a fraction 0..1, got ${JSON.stringify(sl.x)}`);
      // y may run below the frame (feet cropped) up to 1.3
      if (!(typeof sl.y === 'number' && sl.y >= 0 && sl.y <= 1.3)) diag.error('BAD_VALUE', rel, loc(`slots[${j}].y`), `expected 0..1.3, got ${JSON.stringify(sl.y)}`);
      // scale is optional: without it the engine sizes the figure from the scene's horizon and camera height
      if (sl.scale != null && !(typeof sl.scale === 'number' && sl.scale > 0 && sl.scale <= 1.5)) diag.error('BAD_VALUE', rel, loc(`slots[${j}].scale`), `expected a positive scale, got ${JSON.stringify(sl.scale)}`);
      if (typeof sl.y === 'number' && sc.horizon != null && sl.y <= sc.horizon && sl.scale == null) diag.error('BAD_VALUE', rel, loc(`slots[${j}].y`), `feet at y ${sl.y} are at or above the horizon ${sc.horizon}; the figure would have no height`);
    }
  });
  // second pass: exits and move targets
  list.forEach((sc, i) => {
    if (!sc || !sc.id) return;
    const loc = (sub) => ({ line: yamlLine(y.text, sc.id), path: `scenes[${i}].${sub}` });
    for (const [j, ex] of (sc.exits || []).entries()) {
      if (!ex || !scenes.has(ex.to)) diag.error('UNKNOWN_SCENE', rel, loc(`exits[${j}].to`), `exit to unknown scene "${ex && ex.to}"`);
      if (ex && !ex.label) diag.error('SCHEMA', rel, loc(`exits[${j}].label`), 'exit needs label');
    }
    for (const [j, h] of (sc.hotspots || []).entries()) {
      if (h && h.action && h.action.type === 'move' && !scenes.has(h.action.to)) diag.error('UNKNOWN_SCENE', rel, loc(`hotspots[${j}].action.to`), `move to unknown scene "${h.action.to}"`);
    }
  });
  return scenes;
}

function validateNpcs(content, diag, scenes, assets) {
  const rel = 'npcs.yaml';
  const y = readYaml(path.join(content, rel), rel, diag);
  const npcs = new Map();
  if (!y) return npcs;
  const list = y.doc && y.doc.npcs;
  if (!Array.isArray(list)) { diag.error('SCHEMA', rel, { path: 'npcs' }, 'expected a top-level "npcs" list'); return npcs; }
  list.forEach((n, i) => {
    const p = `npcs[${i}]`;
    const loc = (sub) => ({ line: yamlLine(y.text, n && n.id), path: sub ? `${p}.${sub}` : p });
    if (!n || !n.id) { diag.error('SCHEMA', rel, loc('id'), 'missing id'); return; }
    if (npcs.has(n.id)) diag.error('DUPLICATE_ID', rel, loc('id'), `duplicate npc id "${n.id}"`);
    if (!n.name) diag.error('SCHEMA', rel, loc('name'), 'missing name');
    const enumCheck = (k, vals) => { if (!vals.includes(n[k])) diag.error('BAD_VALUE', rel, loc(k), `${k} "${n[k]}"; expected ${vals.join('|')}`); };
    enumCheck('pack', PACKS); enumCheck('community', NPC_COMMUNITY); enumCheck('role', ROLES); enumCheck('stance', STANCES);
    if (!n.portrait) diag.error('SCHEMA', rel, loc('portrait'), 'missing portrait');
    else if (assets && !hasAsset(assets, 'portraits', n.portrait)) diag.warn('UNKNOWN_ASSET', rel, loc('portrait'), `portrait "${n.portrait}" not in assets/manifest.json`);
    if (n.figure && assets && !hasAsset(assets, 'figures', n.figure)) diag.warn('UNKNOWN_ASSET', rel, loc('figure'), `figure "${n.figure}" not in assets/manifest.json`);
    if (n.seated != null && typeof n.seated !== 'boolean') diag.error('BAD_VALUE', rel, loc('seated'), 'seated must be true|false');
    const apps = Array.isArray(n.appearances) ? n.appearances : [];
    if (n.appearances != null && !Array.isArray(n.appearances)) diag.error('SCHEMA', rel, loc('appearances'), 'appearances must be a list');
    apps.forEach((a, j) => {
      if (!a || !scenes.has(a.scene)) { diag.error('UNKNOWN_SCENE', rel, loc(`appearances[${j}].scene`), `unknown scene "${a && a.scene}"`); return; }
      if (!scenes.get(a.scene).slotIds.has(a.slot)) diag.error('UNKNOWN_SLOT', rel, loc(`appearances[${j}].slot`), `scene "${a.scene}" has no slot "${a.slot}"; slots: ${[...scenes.get(a.scene).slotIds].join(', ') || '(none)'}`);
      if (!(typeof a.chance === 'number' && a.chance >= 0 && a.chance <= 1)) diag.error('BAD_VALUE', rel, loc(`appearances[${j}].chance`), `chance must be 0..1, got ${JSON.stringify(a.chance)}`);
    });
    if (apps.length && !n.figure) diag.error('SCHEMA', rel, loc('figure'), 'NPC has appearances but no figure');
    let init = n.initial;
    if (!init) { diag.warn('SCHEMA', rel, loc('initial'), 'missing initial; assuming { met: false, rapport: 0, lastValence: none }'); init = {}; }
    let met = init.met ?? false;
    if (met === 'yes' || met === 'no') met = met === 'yes';
    if (typeof met !== 'boolean') { diag.error('BAD_VALUE', rel, loc('initial.met'), `initial.met must be true|false, got ${JSON.stringify(init.met)}`); met = false; }
    let rap = init.rapport ?? 0;
    if (!(Number.isInteger(rap) && rap >= 0 && rap <= 3)) { diag.error('BAD_VALUE', rel, loc('initial.rapport'), `initial.rapport must be 0..3, got ${JSON.stringify(init.rapport)}`); rap = 0; }
    let lv = init.lastValence ?? 'none';
    if (!['none', 'positive', 'negative'].includes(lv)) { diag.error('BAD_VALUE', rel, loc('initial.lastValence'), `initial.lastValence must be none|positive|negative, got ${JSON.stringify(lv)}`); lv = 'none'; }
    npcs.set(n.id, { ...n, appearances: apps, line: yamlLine(y.text, n.id), start: ((met ? 1 : 0) * 4 + rap) * 3 + ['none', 'positive', 'negative'].indexOf(lv) });
  });
  return npcs;
}

function validateEvents(content, diag, scenes, npcs) {
  const rel = 'events.csv';
  const rows = readCsv(path.join(content, rel), rel, EVENT_COLUMNS, diag) || [];
  const ids = new Set(rows.map(r => r.id).filter(Boolean));
  const events = [];
  const seen = new Set();
  for (const r of rows) {
    const loc = (column) => ({ line: r.__line, row: r.id || undefined, column });
    if (!r.id) { diag.error('SCHEMA', rel, loc('id'), 'missing id'); continue; }
    if (seen.has(r.id)) diag.error('DUPLICATE_ID', rel, loc('id'), `duplicate event id "${r.id}"`);
    seen.add(r.id);
    const en = (col, vals, blankOk) => { if (!(blankOk && r[col] === '') && !vals.includes(r[col])) diag.error('BAD_VALUE', rel, loc(col), `"${r[col]}"; expected ${vals.join('|')}${blankOk ? ' or blank' : ''}`); };
    en('source', EV_SIDES); en('target', EV_SIDES); en('valence', VALENCE); en('proximity', PROXIMITY); en('trigger', TRIGGERS);
    en('playerLean', DIMS[4].values, true); en('nationalLeader', DIMS[3].values, true); en('emotion', EMOTIONS, true);
    if (r.scene && !scenes.has(r.scene)) diag.error('UNKNOWN_SCENE', rel, loc('scene'), `unknown scene "${r.scene}"`);
    if (r.npc && !npcs.has(r.npc)) diag.error('UNKNOWN_NPC', rel, loc('npc'), `unknown npc "${r.npc}"`);
    let minRapport = 0;
    if (r.minRapport !== '') { if (/^[0-3]$/.test(r.minRapport)) minRapport = +r.minRapport; else diag.error('BAD_VALUE', rel, loc('minRapport'), `"${r.minRapport}"; expected 0..3 or blank`); }
    if (r.minRapport !== '' && !r.npc) diag.error('SCHEMA', rel, loc('minRapport'), 'minRapport set but npc is blank');
    if (r.chance !== '' && !(/^\d*\.?\d+$/.test(r.chance) && +r.chance >= 0 && +r.chance <= 1)) diag.error('BAD_VALUE', rel, loc('chance'), `"${r.chance}"; expected a probability 0..1`);
    let cost = 0;
    if (r.cost !== '') { if (/^\d+$/.test(r.cost)) cost = +r.cost; else diag.error('BAD_VALUE', rel, loc('cost'), `"${r.cost}"; expected a non-negative integer or blank`); }
    if (!r.text) diag.error('SCHEMA', rel, loc('text'), 'missing text');
    const choices = [];
    for (const k of [1, 2]) {
      const c = r[`choice${k}`], e = r[`effect${k}`];
      if (!c && e) diag.error('SCHEMA', rel, loc(`effect${k}`), `effect${k} given but choice${k} is blank`);
      const pe = parseEffects(e, ids);
      for (const msg of pe.errors) diag.error(msg.startsWith('unknown') ? 'UNKNOWN_EFFECT' : 'BAD_EFFECT', rel, loc(`effect${k}`), msg);
      if (pe.ops.some(o => NPC_STATE_OPS.has(o.op)) && !r.npc) diag.error('BAD_EFFECT', rel, loc(`effect${k}`), 'effect changes NPC state but the event has no npc');
      if (c) choices.push({ k, ops: pe.ops });
    }
    if (!r.choice1 && r.choice2) diag.warn('SCHEMA', rel, loc('choice2'), 'choice2 given but choice1 is blank');
    events.push({ ...r, minRapport, cost, choices });
  }
  return { events, ids };
}

function validateNews(content, diag) {
  const rel = 'news.csv';
  const rows = readCsv(path.join(content, rel), rel, NEWS_COLUMNS, diag) || [];
  const seen = new Set();
  for (const r of rows) {
    const loc = (column) => ({ line: r.__line, row: r.id || undefined, column });
    if (!r.id) { diag.error('SCHEMA', rel, loc('id'), 'missing id'); continue; }
    if (seen.has(r.id)) diag.error('DUPLICATE_ID', rel, loc('id'), `duplicate news id "${r.id}"`);
    seen.add(r.id);
    if (!CHANNELS.includes(r.channel)) diag.error('BAD_VALUE', rel, loc('channel'), `"${r.channel}"; expected tv|print`);
    if (r.nationalLeader && !DIMS[3].values.includes(r.nationalLeader)) diag.error('BAD_VALUE', rel, loc('nationalLeader'), `"${r.nationalLeader}"; expected enforcement|inclusive or blank`);
    if (r.dayMin && !(/^[1-5]$/.test(r.dayMin))) diag.error('BAD_VALUE', rel, loc('dayMin'), `"${r.dayMin}"; expected a day 1..5 or blank`);
    if (r.valence && !VALENCE.includes(r.valence)) diag.error('BAD_VALUE', rel, loc('valence'), `"${r.valence}"; expected positive|negative or blank`);
    if (!r.headline) diag.error('SCHEMA', rel, loc('headline'), 'missing headline');
  }
  return rows;
}

function validateDialogue(content, npcId, diag, eventIds) {
  const rel = `dialogue/${npcId}.csv`;
  const rows = readCsv(path.join(content, rel), rel, DIALOGUE_COLUMNS, diag, false);
  if (!rows) return null;
  const parsed = [];
  const ids = new Set();
  for (const r of rows) {
    const loc = (column) => ({ line: r.__line, row: r.id || undefined, column });
    if (!r.id) { diag.error('SCHEMA', rel, loc('id'), 'missing id'); continue; }
    if (ids.has(r.id)) diag.error('DUPLICATE_ID', rel, loc('id'), `duplicate row id "${r.id}"`);
    ids.add(r.id);
    const cond = [];
    let bad = false;
    DIMS.forEach((d, i) => {
      const pc = parseCondition(i, r[d.key] ?? '');
      if (pc.error) { diag.error('BAD_CONDITION', rel, loc(d.key), pc.error); bad = true; cond.push(null); }
      else cond.push(pc.set);
    });
    let priority = 0;
    if (r.priority !== '' && r.priority != null) {
      if (/^-?\d+(\.\d+)?$/.test(r.priority)) priority = +r.priority;
      else diag.error('BAD_VALUE', rel, loc('priority'), `"${r.priority}"; expected a number or blank`);
    }
    if (r.emotion && !EMOTIONS.includes(r.emotion)) diag.error('BAD_VALUE', rel, loc('emotion'), `"${r.emotion}"; expected ${EMOTIONS.join('|')} or blank`);
    if (!r.line) diag.error('SCHEMA', rel, loc('line'), 'missing line');
    const choices = [];
    for (const k of [1, 2, 3]) {
      const c = r[`choice${k}`], e = r[`effect${k}`], n = r[`next${k}`];
      if (!c && (e || n)) diag.error('SCHEMA', rel, loc(e ? `effect${k}` : `next${k}`), `${e ? 'effect' : 'next'}${k} given but choice${k} is blank`);
      const pe = parseEffects(e, eventIds);
      for (const msg of pe.errors) diag.error(msg.startsWith('unknown') ? 'UNKNOWN_EFFECT' : 'BAD_EFFECT', rel, loc(`effect${k}`), msg);
      if (c) choices.push({ k, ops: pe.ops, next: n || null, nextLine: r.__line });
    }
    for (const k of [2, 3]) if (r[`choice${k}`] && !r[`choice${k - 1}`]) diag.warn('SCHEMA', rel, loc(`choice${k}`), `choice${k} given but choice${k - 1} is blank`);
    const specificity = cond.filter(Boolean).length;
    parsed.push({ id: r.id, line: r.__line, text: r.line, cond, priority, specificity, choices, bad, raw: r });
  }
  // next targets
  for (const row of parsed) for (const ch of row.choices) {
    if (ch.next && !ids.has(ch.next)) diag.error('DANGLING_NEXT', rel, { line: row.line, row: row.id, column: `next${ch.k}` }, `next${ch.k} points to "${ch.next}", which is not a row id in this sheet`);
  }
  return { rel, rows: parsed };
}

// ---------------------------------------------------------------- completeness
function rowMatches(row, v) {
  for (let i = 0; i < 6; i++) if (row.cond[i] && !row.cond[i].has(v[i])) return false;
  return true;
}
function analyseCompleteness(sheet, diag) {
  const { rel, rows } = sheet;
  const usable = rows.filter(r => !r.bad);
  const fallbacks = usable.filter(r => r.specificity === 0);
  const fallback = fallbacks[0] || null;
  if (!fallback) diag.error('MISSING_FALLBACK', rel, {}, 'no fallback row (all six condition cells blank); required by SPEC');
  else if (fallback.priority !== 0) diag.warn('FALLBACK_PRIORITY', rel, { line: fallback.line, row: fallback.id, column: 'priority' }, `fallback row has priority ${fallback.priority}; SPEC requires 0`);
  const winners = new Array(NCELLS);
  const ties = new Map(); // key -> {rows, cells}
  let noMatch = 0, served = 0;
  const winCount = new Map(rows.map(r => [r.id, 0]));
  for (let c = 0; c < NCELLS; c++) {
    const v = cellVector(c);
    let best = [];
    for (const r of usable) {
      if (!rowMatches(r, v)) continue;
      if (!best.length || r.priority > best[0].priority || (r.priority === best[0].priority && r.specificity > best[0].specificity)) best = [r];
      else if (r.priority === best[0].priority && r.specificity === best[0].specificity) best.push(r);
    }
    if (!best.length) { winners[c] = null; noMatch++; continue; }
    winners[c] = { row: best[0], tie: best.length > 1 ? best : null };
    winCount.set(best[0].id, winCount.get(best[0].id) + 1);
    if (best.length > 1) {
      const key = best.map(r => r.id).join('|');
      if (!ties.has(key)) ties.set(key, { rows: best, cells: [] });
      ties.get(key).cells.push(c);
    }
    if (best[0] !== fallback) served++;
  }
  for (const t of ties.values()) {
    diag.error('TIE', rel, { line: t.rows[0].line, row: t.rows.map(r => r.id).join(',') },
      `rows ${t.rows.map(r => r.id).join(', ')} tie (priority ${t.rows[0].priority}, specificity ${t.rows[0].specificity}) in ${t.cells.length} cell(s), e.g. ${cellLabel(t.cells[0])}`, { cells: t.cells.length });
  }
  if (noMatch) diag.error('NO_MATCH', rel, {}, `${noMatch} of ${NCELLS} cells match no row at all`);
  // rows that only appear as next targets are expected not to win cells
  const nextTargets = new Set(rows.flatMap(r => r.choices.map(c => c.next).filter(Boolean)));
  const neverWins = [];
  for (const r of usable) {
    if (winCount.get(r.id) > 0) continue;
    if (nextTargets.has(r.id)) continue;
    neverWins.push(r.id);
    // find who shadows it
    const anyCell = (() => { for (let c = 0; c < NCELLS; c++) if (rowMatches(r, cellVector(c))) return c; return -1; })();
    const by = anyCell >= 0 && winners[anyCell] ? winners[anyCell].row.id : null;
    diag.warn('NEVER_WINS', rel, { line: r.line, row: r.id }, anyCell < 0 ? 'row matches no cell' : `row never wins any cell (shadowed; e.g. ${by} wins at ${cellLabel(anyCell)})`);
  }
  return { winners, fallback, coverage: served / NCELLS, served, noMatch, ties: [...ties.values()].map(t => ({ rows: t.rows.map(r => r.id), cells: t.cells.length })), neverWins, winCount: Object.fromEntries(winCount), nextTargets };
}

// ---------------------------------------------------------------- reachability
function analyseReachability(npc, sheet, comp, events, invitedExternally, diag) {
  const rel = sheet.rel;
  const rowById = new Map(sheet.rows.map(r => [r.id, r]));
  const myEvents = events.filter(e => e.npc === npc.id);
  const inviteBit = new Map();
  myEvents.filter(e => e.trigger === 'invite').forEach((e, i) => inviteBit.set(e.id, 1 << i));
  let startMask = 0;
  for (const [id, bit] of inviteBit) if (invitedExternally.has(id)) startMask |= bit;
  const canTalk = npc.appearances.length > 0;

  // node key: s|mask|showRowId('' = idle)
  const dist = new Map(), prev = new Map();
  const key = (s, m, r) => `${s}|${m}|${r || ''}`;
  const buckets = [];
  const push = (k, d, from, label) => {
    if (dist.has(k) && dist.get(k) <= d) return;
    dist.set(k, d); prev.set(k, { from, label });
    (buckets[d] ||= []).push(k);
  };
  push(key(npc.start, startMask, ''), 0, null, null);
  const choiceEdges = (s, m, row, base, labelPrefix, out) => {
    for (const ch of row.choices) {
      const r = applyEffects(s, m, ch.ops, inviteBit);
      const nxt = ch.next && rowById.has(ch.next) ? ch.next : '';
      out.push({ k: key(r.s, r.mask, nxt), cost: base + r.extra, label: `${labelPrefix}${row.id}/choice${ch.k}` });
    }
  };
  for (let d = 0; d < buckets.length; d++) {
    for (const k of buckets[d] || []) {
      if (dist.get(k) !== d) continue;
      const [ss, mm, rid] = k.split('|');
      const s = +ss, m = +mm;
      const out = [];
      if (rid) {
        choiceEdges(s, m, rowById.get(rid), 0, '', out);
        if (!rowById.get(rid).choices.length) out.push({ k: key(s, m, ''), cost: 0, label: null });
      } else {
        if (canTalk) {
          const seenRows = new Set();
          for (let w = 0; w < NWORLD; w++) {
            const win = comp.winners[s * NWORLD + w];
            if (!win || seenRows.has(win.row.id)) continue;
            seenRows.add(win.row.id);
            choiceEdges(s, m, win.row, 1, '', out);
          }
        }
        const rap = stateVec(s)[1];
        for (const e of myEvents) {
          if (e.trigger === 'invite' && !(m & inviteBit.get(e.id))) continue;
          if (rap < e.minRapport) continue;
          for (const ch of e.choices) {
            const r = applyEffects(s, m, ch.ops, inviteBit);
            out.push({ k: key(r.s, r.mask, ''), cost: e.cost + r.extra, label: `event:${e.id}/choice${ch.k}` });
          }
        }
      }
      for (const ed of out) push(ed.k, d + ed.cost, k, ed.label);
    }
  }
  const pathTo = (k) => { const labels = []; while (k && prev.get(k)) { const p = prev.get(k); if (p.label) labels.push(p.label); k = p.from; } return labels.reverse(); };
  // best idle cost per NPC state
  const stateCost = new Array(NSTATE).fill(Infinity), stateKey = new Array(NSTATE).fill(null);
  const showCost = new Map(), showKey = new Map();
  for (const [k, d] of dist) {
    const [ss, , rid] = k.split('|');
    if (!rid) { if (d < stateCost[+ss]) { stateCost[+ss] = d; stateKey[+ss] = k; } }
    else if (!showCost.has(rid) || d < showCost.get(rid)) { showCost.set(rid, d); showKey.set(rid, k); }
  }
  const cellCost = new Array(NCELLS);
  for (let c = 0; c < NCELLS; c++) cellCost[c] = canTalk ? stateCost[Math.floor(c / NWORLD)] : Infinity;
  const rowsOut = {};
  const unreachable = [], overBudget = [];
  for (const r of sheet.rows) {
    if (r.bad) continue;
    let best = Infinity, bestCell = -1, via = null;
    for (let c = 0; c < NCELLS; c++) {
      const w = comp.winners[c];
      if (w && w.row === r && cellCost[c] < best) { best = cellCost[c]; bestCell = c; }
    }
    if (showCost.has(r.id) && showCost.get(r.id) < best) { best = showCost.get(r.id); via = showKey.get(r.id); bestCell = -1; }
    let witness = null;
    if (best < Infinity) {
      const labels = via ? pathTo(via) : pathTo(stateKey[Math.floor(bestCell / NWORLD)]);
      witness = [...labels, r.id].join(' → ');
      if (bestCell >= 0) witness += `  [at ${cellLabel(bestCell)}]`; else witness += '  [via next]';
    }
    rowsOut[r.id] = { cost: best === Infinity ? null : best, witness };
    if (!canTalk || comp.neverWins.includes(r.id)) continue; // never-win rows are reported once, as NEVER_WINS
    if (best === Infinity) {
      unreachable.push(r.id);
      diag.error('UNREACHABLE', rel, { line: r.line, row: r.id }, `row is unreachable from initial state (${cellLabel(npc.start * NWORLD).split(', ').slice(0, 3).join(', ')}): no sequence of dialogue choices or events reaches a cell it wins`);
    } else if (best > BUDGET) {
      overBudget.push(r.id);
      diag.warn('OVER_BUDGET', rel, { line: r.line, row: r.id }, `row needs at least ${best} actions; budget is ${BUDGET}`);
    }
  }
  if (!canTalk) diag.info('NO_APPEARANCES', rel, {}, `NPC ${npc.id} has no appearances, so dialogue can never start; reachability not enforced`);
  const reachableStates = stateCost.filter(x => x < Infinity).length;
  return { cellCost, rows: rowsOut, unreachable, overBudget, reachableStates, canTalk };
}

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
  h += `<h1>Great Vote content checker</h1><p class="muted">Content: <code>${esc(result.content)}</code> · generated ${esc(result.generated)} · budget ${BUDGET} actions · ${NCELLS} cells per NPC</p>`;
  h += `<p>${result.ok ? '<span class="ok">PASS</span>' : '<span class="bad">FAIL</span>'} — ${result.counts.error} error(s), ${result.counts.warning} warning(s)</p>`;
  h += `<div class="scroll"><table class="sum"><tr><th>NPC</th><th>Rows</th><th>Coverage</th><th>Ties</th><th>Never win</th><th>Unreachable</th><th>Over budget</th><th>Reachable states</th><th>Errors</th><th>Warnings</th></tr>`;
  for (const n of result.npcs) {
    h += `<tr><td><a href="#npc-${esc(n.id)}">${esc(n.id)}</a></td>`;
    if (!n.sheet) { h += `<td colspan="9" class="${n.sheetRequired ? 'bad' : 'muted'}">no dialogue sheet</td></tr>`; continue; }
    h += `<td>${n.rowCount}</td><td>${(n.coverage * 100).toFixed(1)}%</td><td class="${n.ties.length ? 'bad' : ''}">${n.ties.length}</td><td class="${n.neverWins.length ? 'warn' : ''}">${n.neverWins.length}</td><td class="${n.unreachable.length ? 'bad' : ''}">${n.unreachable.length}</td><td class="${n.overBudget.length ? 'warn' : ''}">${n.overBudget.length}</td><td>${n.reachableStates}/24</td><td class="${n.errors ? 'bad' : ''}">${n.errors}</td><td class="${n.warnings ? 'warn' : ''}">${n.warnings}</td></tr>`;
  }
  h += `</table></div>`;
  const global = result.diagnostics.filter(d => !d.file.startsWith('dialogue/'));
  h += `<h2>Global (scenes, npcs, events, news)</h2>${diagList(global)}`;
  h += `<p class="legend muted">Cell colour = specificity of the winning row:${SPEC_COLORS.map((c, i) => `<span style="background:${c}"></span>${i}${i === 0 ? ' (fallback)' : ''}`).join('')}<span style="background:#c0392b"></span>tie<span style="background:#1F1D1A"></span>no row · faded = NPC state unreachable</p>`;
  for (const n of result.npcs) {
    h += `<h2 id="npc-${esc(n.id)}">${esc(n.id)} <span class="muted">${esc(n.name || '')}</span></h2>`;
    if (!n.sheet) { h += `<p class="muted">No dialogue sheet.</p>`; continue; }
    h += `<p class="muted">Coverage ${(n.coverage * 100).toFixed(1)}% (${n.served}/${NCELLS} cells served by a non-fallback row) · fallback <code>${esc(n.fallback || '—')}</code></p>`;
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
        const cell = n.cells[c];
        const cls = [cell.row == null ? 'none' : '', cell.tie ? 'tie' : '', cell.cost == null ? 'unr' : ''].filter(Boolean).join(' ');
        const title = `${cellLabel(c)}\n` + (cell.row == null ? 'NO ROW MATCHES' : `${cell.tie ? 'TIE: ' + cell.tie.join(', ') + '\n' : ''}row ${cell.row} (specificity ${cell.spec}, priority ${cell.prio})\n“${cell.line}”`) + `\n${cell.cost == null ? 'unreachable' : 'min actions to reach: ' + cell.cost}`;
        h += `<td class="${cls}" style="background:${cell.row == null ? '' : SPEC_COLORS[cell.spec]}" title="${esc(title)}"></td>`;
      }
      h += `</tr>`;
    }
    h += `</table></div>`;
    const mine = result.diagnostics.filter(d => d.file === n.sheet);
    h += `<h3>Errors</h3>${diagList(mine.filter(d => d.severity === 'error'))}`;
    h += `<h3>Warnings</h3>${diagList(mine.filter(d => d.severity !== 'error'))}`;
    h += `<h3>Witness paths</h3><ul class="diag wit">${Object.entries(n.rows).map(([id, r]) => `<li>${esc(id)}: ${r.witness ? `${esc(r.cost)} action(s) — ${esc(r.witness)}` : '<span class="bad">unreachable</span>'}</li>`).join('')}</ul>`;
  }
  return h;
}

// ---------------------------------------------------------------- main
export function check(contentDir) {
  const diag = new Diag();
  const content = path.resolve(contentDir);
  let assets = null;
  const manifest = path.join(content, '..', 'assets', 'manifest.json');
  if (fs.existsSync(manifest)) { try { assets = JSON.parse(fs.readFileSync(manifest, 'utf8')); } catch (e) { diag.warn('MANIFEST', 'assets/manifest.json', {}, `could not parse: ${e.message}`); } }
  const scenes = validateScenes(content, diag, assets);
  const npcs = validateNpcs(content, diag, scenes, assets);
  // cross-file: talk hotspots and painted casts must name real NPCs
  for (const sc of scenes.values()) {
    const rel = 'scenes.yaml';
    for (const h of sc.hotspots || []) if (h?.action?.type === 'talk' && h.action.npc && !npcs.has(h.action.npc)) diag.error('UNKNOWN_NPC', rel, { path: `scenes.${sc.id}.hotspots.${h.id}.action.npc` }, `talk hotspot names unknown npc "${h.action.npc}"`);
    for (const id of (sc.painted && Array.isArray(sc.painted.npcs) ? sc.painted.npcs : [])) if (!npcs.has(id)) diag.error('UNKNOWN_NPC', rel, { path: `scenes.${sc.id}.painted.npcs` }, `painted cast names unknown npc "${id}"`);
  }
  const { events, ids: eventIds } = validateEvents(content, diag, scenes, npcs);
  validateNews(content, diag);

  const dlgDir = path.join(content, 'dialogue');
  const sheetFiles = fs.existsSync(dlgDir) ? fs.readdirSync(dlgDir).filter(f => f.endsWith('.csv')) : [];
  for (const f of sheetFiles) {
    const id = f.slice(0, -4);
    if (!npcs.has(id)) diag.error('UNKNOWN_NPC', `dialogue/${f}`, {}, `sheet for unknown npc "${id}" (not in npcs.yaml)`);
  }
  const sheets = new Map();
  for (const id of npcs.keys()) {
    const s = validateDialogue(content, id, diag, eventIds);
    if (s) sheets.set(id, s);
    else if (npcs.get(id).appearances.length) diag.error('MISSING_SHEET', `dialogue/${id}.csv`, {}, `NPC ${id} appears in scenes but has no dialogue sheet`);
  }
  // invites: who invites what
  const inviteSources = new Map(); // eventId -> Set(npcId of sheet or 'event:<npc>')
  const noteInvite = (evId, owner) => { if (!inviteSources.has(evId)) inviteSources.set(evId, new Set()); inviteSources.get(evId).add(owner); };
  for (const [id, s] of sheets) for (const r of s.rows) for (const c of r.choices) for (const o of c.ops) if (o.op === 'invite') noteInvite(o.id, id);
  for (const e of events) for (const c of e.choices) for (const o of c.ops) if (o.op === 'invite') noteInvite(o.id, e.npc || '');
  for (const e of events) {
    if (e.trigger === 'invite' && !inviteSources.has(e.id)) diag.warn('NEVER_INVITED', 'events.csv', { line: e.__line, row: e.id, column: 'trigger' }, 'trigger is invite but no dialogue or event effect invites it');
    if (e.trigger !== 'invite' && inviteSources.has(e.id)) diag.warn('INVITE_TRIGGER', 'events.csv', { line: e.__line, row: e.id, column: 'trigger' }, `event is invited (by ${[...inviteSources.get(e.id)].join(', ')}) but its trigger is "${e.trigger}", not invite`);
  }

  const npcResults = [];
  for (const [id, npc] of npcs) {
    const s = sheets.get(id);
    const before = diag.list.length;
    if (!s) { npcResults.push({ id, name: npc.name, sheet: null, sheetRequired: npc.appearances.length > 0 }); continue; }
    const comp = analyseCompleteness(s, diag);
    // invites of this NPC's events issued from outside this NPC's own model
    const external = new Set();
    for (const [evId, owners] of inviteSources) for (const o of owners) if (o !== id) external.add(evId);
    const reach = analyseReachability(npc, s, comp, events, external, diag);
    const mine = diag.list.slice(before);
    const cells = comp.winners.map((w, c) => w ? { row: w.row.id, spec: w.row.specificity, prio: w.row.priority, line: w.row.text, tie: w.tie ? w.tie.map(r => r.id) : null, cost: reach.cellCost[c] === Infinity ? null : reach.cellCost[c] } : { row: null, cost: reach.cellCost[c] === Infinity ? null : reach.cellCost[c] });
    npcResults.push({
      id, name: npc.name, sheet: s.rel, rowCount: s.rows.length, fallback: comp.fallback?.id ?? null,
      coverage: comp.coverage, served: comp.served, noMatch: comp.noMatch, ties: comp.ties, neverWins: comp.neverWins,
      unreachable: reach.unreachable, overBudget: reach.overBudget, reachableStates: reach.reachableStates, canTalk: reach.canTalk,
      rows: reach.rows, winCount: comp.winCount, cells,
      errors: mine.filter(d => d.severity === 'error').length, warnings: mine.filter(d => d.severity === 'warning').length,
    });
  }
  const counts = { error: 0, warning: 0, info: 0 };
  for (const d of diag.list) counts[d.severity]++;
  return { content, generated: new Date().toISOString(), ok: counts.error === 0, counts, diagnostics: diag.list, npcs: npcResults };
}

function parseArgs(argv) {
  const a = { content: 'public/content', report: 'tools/checker/report', json: false };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === '--content') a.content = argv[++i];
    else if (f === '--report') a.report = argv[++i];
    else if (f === '--json') a.json = true;
    else if (f === '-h' || f === '--help') { a.help = true; }
    else { console.error(`unknown argument ${f}`); process.exit(2); }
  }
  return a;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log('usage: node tools/checker/check.mjs [--content <dir>] [--report <dir>] [--json]'); process.exit(0); }
  if (!fs.existsSync(args.content)) { console.error(`content directory not found: ${args.content}`); process.exit(2); }
  const result = check(args.content);
  fs.mkdirSync(args.report, { recursive: true });
  fs.writeFileSync(path.join(args.report, 'results.json'), JSON.stringify(result, null, 1));
  fs.writeFileSync(path.join(args.report, 'index.html'), renderHtml(result));
  if (args.json) {
    const slim = { ...result, npcs: result.npcs.map(({ cells, ...rest }) => rest) };
    process.stdout.write(JSON.stringify(slim, null, 2) + '\n');
  } else {
    for (const d of result.diagnostics) if (d.severity !== 'info') console.log(formatDiag(d));
    console.log('');
    console.log('NPC'.padEnd(18) + 'rows  coverage  ties  never-win  unreachable  over-budget');
    for (const n of result.npcs) {
      if (!n.sheet) { console.log(n.id.padEnd(18) + '(no dialogue sheet)'); continue; }
      console.log(n.id.padEnd(18) + String(n.rowCount).padEnd(6) + `${(n.coverage * 100).toFixed(1)}%`.padEnd(10) + String(n.ties.length).padEnd(6) + String(n.neverWins.length).padEnd(11) + String(n.unreachable.length).padEnd(13) + n.overBudget.length);
    }
    console.log(`\n${result.ok ? 'PASS' : 'FAIL'}: ${result.counts.error} error(s), ${result.counts.warning} warning(s). Report: ${path.join(args.report, 'index.html')}`);
  }
  process.exit(result.ok ? 0 : 1);
}
