// Great Vote content checker core: schema validation, completeness and reachability
// of parameter-conditioned dialogue sheets. Pure functions over file texts (no fs/path/process),
// shared by the CLI (check.mjs) and the researcher editor (src/editor). See README.md and demo/SPEC.md.
import * as yaml from 'js-yaml';
import Papa from 'papaparse';

// ---------------------------------------------------------------- vocabulary
export const DIALOGUE_COLUMNS = 'id,met,rapport,lastValence,nationalLeader,playerLean,dayPhase,priority,emotion,line,choice1,effect1,next1,choice2,effect2,next2,choice3,effect3,next3'.split(',');
export const EVENT_COLUMNS = 'id,source,target,valence,proximity,trigger,scene,npc,minRapport,playerLean,nationalLeader,chance,cost,emotion,text,choice1,effect1,choice2,effect2'.split(',');
export const NEWS_COLUMNS = 'id,channel,nationalLeader,dayMin,valence,headline,body'.split(',');
// optional trailing columns (SPEC 2026-10-18, cast): accepted when present, never required
export const EVENT_OPTIONAL = ['portrait'];
export const NEWS_OPTIONAL = ['figure'];
// optional dialogue column (SPEC 2026-10-18 "Dialogue location"), placed after dayPhase: blank = anywhere, else scene ids joined by |
export const DIALOGUE_OPTIONAL = ['scene'];
/** SPEC "Conversation limit": default conversations per NPC per day, and the demo length the limit is spread over. */
export const DEFAULT_TALKS = 1;
export const DEMO_DAYS = 5;
/** dayPhase index (DIMS[5]) of each demo day 1..5: early early mid late late */
const DAY_PHASE = [0, 0, 1, 2, 2];

export const DIMS = [
  { key: 'met', values: ['no', 'yes'] },
  { key: 'rapport', values: ['0', '1', '2', '3'] },
  { key: 'lastValence', values: ['none', 'positive', 'negative'] },
  { key: 'nationalLeader', values: ['enforcement', 'inclusive'] },
  { key: 'playerLean', values: ['us-leaning', 'balanced', 'home-leaning'] },
  { key: 'dayPhase', values: ['early', 'mid', 'late'] },
];
const RADIX = DIMS.map(d => d.values.length);
export const NCELLS = RADIX.reduce((a, b) => a * b, 1); // 432
const NSTATE = 24; // met x rapport x lastValence
/** a dialogue `scene` cell: blank = anywhere, else scene ids separated by | */
export const sceneList = (cell) => String(cell ?? '').split('|').map(x => x.trim()).filter(Boolean);
export const NWORLD = 18; // nationalLeader x playerLean x dayPhase
export const BUDGET = 40;
/** Engine rule (src/rules.ts FREE_DEPTH / DIALOGUE_COST): opening a conversation whose row has depth < FREE_DEPTH is free. */
export const FREE_DEPTH = 3;
export const DIALOGUE_COST = 1;

export const EMOTIONS = ['neutral', 'warm', 'guarded', 'worried'];
const COMMUNITY_SCENE = ['home', 'us', 'neutral'];
const LIGHTING = ['warm_indoor', 'cool_indoor', 'outdoor'];
const ACTION_TYPES = ['window', 'news', 'end_day', 'move', 'look', 'talk'];
const MODULES = ['tv', 'work', 'survey'];
const PACKS = ['shared', 'cn', 'mx', 'in'];
const NPC_COMMUNITY = ['us', 'home', 'other', 'bicultural'];
const ROLES = ['neighbor', 'stranger', 'local_leader', 'national_leader'];
// SPEC "Stances": Berry's acculturation strategies minus marginalization
export const STANCES = ['none', 'integration', 'assimilation', 'separation'];
// SPEC "Packs": a scene may carry one of these (absent = shared)
export const SCENE_PACKS = ['cn', 'mx', 'in'];
export const EV_SIDES = ['us', 'home', 'other', 'bicultural'];
export const VALENCE = ['positive', 'negative'];
export const PROXIMITY = ['proximal', 'distal'];
export const TRIGGERS = ['day_start', 'enter', 'invite'];
export const CHANNELS = ['tv', 'print'];

export const cellIndex = (v) => v.reduce((acc, x, i) => acc * RADIX[i] + x, 0);
export function cellVector(c) {
  const v = new Array(6);
  for (let i = 5; i >= 0; i--) { v[i] = c % RADIX[i]; c = Math.floor(c / RADIX[i]); }
  return v;
}
const stateOf = (v) => (v[0] * 4 + v[1]) * 3 + v[2];
const stateVec = (s) => [Math.floor(s / 12), Math.floor(s / 3) % 4, s % 3];
export const cellLabel = (c) => cellVector(c).map((x, i) => `${DIMS[i].key}=${DIMS[i].values[x]}`).join(', ');

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
// text: file contents, or null/undefined when the file does not exist
function readCsv(text, rel, expected, diag, required = true, optional = []) {
  if (text == null) {
    if (required) diag.error('MISSING_FILE', rel, {}, 'file not found');
    return null;
  }
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
  const unknown = header.filter(h => !expected.includes(h) && !optional.includes(h));
  const missing = expected.filter(h => !header.includes(h));
  for (const h of unknown) { diag.error('UNKNOWN_COLUMN', rel, { line: 1, column: h }, `unknown column "${h}"; expected exactly: ${expected.join(',')}`); ok = false; }
  for (const h of missing) { diag.error('MISSING_COLUMN', rel, { line: 1, column: h }, `missing column "${h}"; expected exactly: ${expected.join(',')}`); ok = false; }
  if (ok && header.filter(h => !optional.includes(h)).join(',') !== expected.join(',')) diag.error('COLUMN_ORDER', rel, { line: 1 }, `columns out of order; expected: ${expected.join(',')}`);
  const dupes = header.filter((h, i) => header.indexOf(h) !== i);
  for (const h of new Set(dupes)) diag.error('DUPLICATE_COLUMN', rel, { line: 1, column: h }, `column "${h}" appears more than once`);
  const rows = [];
  for (const rec of records.slice(1)) {
    if (rec.data.length === 1 && rec.data[0].trim() === '') continue; // blank line
    for (const e of rec.errors) diag.error('CSV_PARSE', rel, { line: rec.line }, e.message);
    if (rec.data.length !== header.length) diag.error('FIELD_COUNT', rel, { line: rec.line }, `has ${rec.data.length} fields, header has ${header.length}`);
    const row = { __line: rec.line };
    for (const h of expected) row[h] = '';
    for (const h of optional) row[h] = '';
    header.forEach((h, i) => { row[h] = (rec.data[i] ?? '').trim(); });
    rows.push(row);
  }
  return rows;
}

function readYaml(text, rel, diag) {
  if (text == null) { diag.error('MISSING_FILE', rel, {}, 'file not found'); return null; }
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
export function parseCondition(dimIdx, raw) {
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
export function parseEffects(raw, eventIds) {
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
const scenesHaveSeatedFlags = (scenes) => { for (const sc of scenes.values()) for (const sl of sc.slotById.values()) if (sl && sl.seated != null) return true; return false; };
// asset lookup in a manifest section, following manifest.aliases (SPEC's base id -> manifest key) if present
const hasAsset = (assets, section, id) => !!(assets?.[section]?.[id] || (assets?.aliases?.[id] && assets[section]?.[assets.aliases[id]]));
const isFrac = (x) => typeof x === 'number' && x >= 0 && x <= 1;

function validateScenes(files, diag, assets) {
  const rel = 'scenes.yaml';
  const y = readYaml(files[rel], rel, diag);
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
    scenes.set(sc.id, { ...sc, slotIds: new Set(), slotById: new Map() });
    if (!sc.name) diag.error('SCHEMA', rel, loc('name'), 'missing name');
    if (!COMMUNITY_SCENE.includes(sc.community)) diag.error('BAD_VALUE', rel, loc('community'), `community "${sc.community}"; expected ${COMMUNITY_SCENE.join('|')}`);
    if (sc.background == null || sc.background === '') diag.error('SCHEMA', rel, loc('background'), 'missing background (use "none" for hub scenes)');
    else if (sc.background !== 'none' && assets && !hasAsset(assets, 'backgrounds', sc.background)) diag.warn('UNKNOWN_ASSET', rel, loc('background'), `background "${sc.background}" not in assets/manifest.json`);
    if (sc.horizon != null && !(typeof sc.horizon === 'number' && sc.horizon > 0 && sc.horizon < 1)) diag.error('BAD_VALUE', rel, loc('horizon'), `horizon must be a fraction 0..1, got ${JSON.stringify(sc.horizon)}`);
    if (sc.cameraHeight != null && !(typeof sc.cameraHeight === 'number' && sc.cameraHeight > 0 && sc.cameraHeight < 5)) diag.error('BAD_VALUE', rel, loc('cameraHeight'), `cameraHeight must be metres (0..5), got ${JSON.stringify(sc.cameraHeight)}`);
    if (sc.pack != null && sc.pack !== '' && !SCENE_PACKS.includes(sc.pack)) diag.error('BAD_VALUE', rel, loc('pack'), `pack "${sc.pack}"; expected ${SCENE_PACKS.join('|')} (or omit for a shared scene)`);
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
    if (sc.screens != null) {
      if (!Array.isArray(sc.screens)) diag.error('SCHEMA', rel, loc('screens'), 'screens must be a list of { id, quad }');
      else sc.screens.forEach((scr, j) => {
        if (scr && scr.byBackground != null) {
          if (typeof scr.byBackground !== 'object' || Array.isArray(scr.byBackground)) diag.error('SCHEMA', rel, loc(`screens[${j}].byBackground`), 'byBackground must map a background asset id to a quad');
          else for (const [bg, bq] of Object.entries(scr.byBackground)) {
            if (!(Array.isArray(bq) && bq.length === 4 && bq.every(pt => Array.isArray(pt) && pt.length === 2 && pt.every(v => typeof v === 'number' && v >= -0.2 && v <= 1.2)))) diag.error('BAD_VALUE', rel, loc(`screens[${j}].byBackground.${bg}`), 'expected four [x, y] fraction pairs');
            else if (assets && !hasAsset(assets, 'backgrounds', bg)) diag.warn('UNKNOWN_ASSET', rel, loc(`screens[${j}].byBackground.${bg}`), `background "${bg}" not in assets/manifest.json`);
          }
        }
        const q = scr && scr.quad;
        const ok = Array.isArray(q) && q.length === 4 && q.every(pt => Array.isArray(pt) && pt.length === 2 && pt.every(v => typeof v === 'number' && v >= -0.2 && v <= 1.2));
        if (!scr || !scr.id) diag.error('SCHEMA', rel, loc(`screens[${j}].id`), 'screen needs id');
        if (!ok) diag.error('BAD_VALUE', rel, loc(`screens[${j}].quad`), 'quad must be four [x, y] fraction pairs: top-left, top-right, bottom-right, bottom-left');
        else {
          // corners in order and the quad convex (a crossed or folded quad would draw the still inside out)
          let sign = 0, convex = true;
          for (let k = 0; k < 4; k++) {
            const [ax, ay] = q[k], [bx, by] = q[(k + 1) % 4], [cx, cy] = q[(k + 2) % 4];
            const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
            if (Math.abs(z) < 1e-12) continue;
            if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) convex = false;
          }
          if (!convex || sign < 0) diag.error('BAD_VALUE', rel, loc(`screens[${j}].quad`), 'quad corners must go top-left, top-right, bottom-right, bottom-left (clockwise on screen) and form a convex shape');
        }
      });
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
      scenes.get(sc.id).slotById.set(sl.id, sl);
      if (sl.seated != null && typeof sl.seated !== 'boolean') diag.error('BAD_VALUE', rel, loc(`slots[${j}].seated`), `seated must be true|false, got ${JSON.stringify(sl.seated)}`);
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

/** A seated figure asset: manifest `seated: true`, or (without a manifest entry saying otherwise) an id containing `_fig_sit`. */
export function isSeatedFigure(assets, id) {
  if (!id) return false;
  const e = assets?.figures?.[id] || (assets?.aliases?.[id] && assets?.figures?.[assets.aliases[id]]);
  if (e && typeof e.seated === 'boolean') return e.seated;
  return /_fig_sit/.test(id);
}

/** SPEC "Character profiles": writer-facing fields on an NPC (the engine ignores them). */
export const PROFILE_SCALES = ['integrationLean', 'warmth', 'talkative'];
export const PROFILE_TEXTS = ['backstory', 'motivation', 'voice'];
export const PROFILE_LISTS = ['topics', 'avoid'];

function validateProfile(pr, diag, rel, loc) {
  if (pr == null) return;
  if (typeof pr !== 'object' || Array.isArray(pr)) { diag.error('BAD_VALUE', rel, loc('profile'), 'profile must be a mapping of fields'); return; }
  for (const [k, v] of Object.entries(pr)) {
    const at = loc(`profile.${k}`);
    if (PROFILE_SCALES.includes(k)) {
      if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10)) diag.error('BAD_VALUE', rel, at, `profile.${k} must be a number 0..10, got ${JSON.stringify(v)}`);
    } else if (PROFILE_TEXTS.includes(k)) {
      if (typeof v !== 'string') diag.error('BAD_VALUE', rel, at, `profile.${k} must be text, got ${JSON.stringify(v)}`);
    } else if (PROFILE_LISTS.includes(k)) {
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) diag.error('BAD_VALUE', rel, at, `profile.${k} must be a list of text items, got ${JSON.stringify(v)}`);
    } else {
      diag.warn('PROFILE_KEY', rel, at, `unknown profile key "${k}"; expected ${[...PROFILE_SCALES, ...PROFILE_TEXTS, ...PROFILE_LISTS].join(', ')}`);
    }
  }
}

function validateNpcs(files, diag, scenes, assets) {
  const rel = 'npcs.yaml';
  const y = readYaml(files[rel], rel, diag);
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
      if (a.figure != null && a.figure !== '' && typeof a.figure !== 'string') diag.error('BAD_VALUE', rel, loc(`appearances[${j}].figure`), `figure must be an asset id, got ${JSON.stringify(a.figure)}`);
      if (a.figure && assets && !hasAsset(assets, 'figures', a.figure)) diag.warn('UNKNOWN_ASSET', rel, loc(`appearances[${j}].figure`), `figure "${a.figure}" not in assets/manifest.json`);
      // SPEC "Per-appearance figure": a seated figure (it includes its stool) only on a slot marked seated: true.
      // Enforced once scenes.yaml carries seated flags at all; until then every slot reads as not seated.
      const fig = a.figure || n.figure;
      const slot = scenes.get(a.scene).slotById.get(a.slot);
      if (slot && scenesHaveSeatedFlags(scenes) && isSeatedFigure(assets, fig) && slot.seated !== true) {
        diag.error('SEATED_SLOT', rel, loc(`appearances[${j}]`), `seated figure "${fig}" on slot "${a.slot}" in ${a.scene}, which is not marked seated: true; use a seated slot or a standing figure`);
      }
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
    validateProfile(n.profile, diag, rel, loc);
    npcs.set(n.id, { ...n, appearances: apps, line: yamlLine(y.text, n.id), start: ((met ? 1 : 0) * 4 + rap) * 3 + ['none', 'positive', 'negative'].indexOf(lv) });
  });
  return npcs;
}

function validateEvents(files, diag, scenes, npcs, assets, castIds) {
  const rel = 'events.csv';
  const rows = readCsv(files[rel], rel, EVENT_COLUMNS, diag, true, EVENT_OPTIONAL) || [];
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
    if (r.portrait && assets && !assets.cast?.[r.portrait] && !castIds.has(r.portrait)) diag.warn('UNKNOWN_ASSET', rel, loc('portrait'), `cast "${r.portrait}" is not in cast.yaml or assets/manifest.json cast (PLACEHOLDER shown)`);
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

function validateNews(files, diag, assets, castIds) {
  const rel = 'news.csv';
  const rows = readCsv(files[rel], rel, NEWS_COLUMNS, diag, true, NEWS_OPTIONAL) || [];
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
    if (r.figure && assets && !assets.cast?.[r.figure] && !castIds.has(r.figure)) diag.warn('UNKNOWN_ASSET', rel, loc('figure'), `cast "${r.figure}" is not in cast.yaml or assets/manifest.json cast (PLACEHOLDER shown)`);
  }
  return rows;
}

/**
 * npcScenes: scenes this NPC can be met in (completeness scope); a row whose `scene` names any other scene is an error.
 */
function validateDialogue(files, npcId, diag, eventIds, scenes, npcScenes) {
  const rel = `dialogue/${npcId}.csv`;
  const rows = readCsv(files[rel], rel, DIALOGUE_COLUMNS, diag, false, DIALOGUE_OPTIONAL);
  if (!rows) return null;
  const header = (files[rel] || '').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].split(',').map(x => x.trim());
  if (header.includes('scene') && header.indexOf('scene') !== header.indexOf('dayPhase') + 1) diag.warn('COLUMN_ORDER', rel, { line: 1, column: 'scene' }, 'the optional scene column belongs right after dayPhase');
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
    const located = sceneList(r.scene);
    let offScene = false;
    for (const sc of located) {
      if (!scenes.has(sc)) { diag.error('UNKNOWN_SCENE', rel, loc('scene'), `scene "${sc}" is not a scene id in scenes.yaml`); bad = true; }
      else if (!npcScenes.has(sc) && (offScene = true)) diag.error('SCENE_NOT_APPEARED', rel, loc('scene'), `scene "${sc}": ${npcId} never appears there (scenes: ${[...npcScenes].join(', ') || 'none'}), so this row can never be selected`);
    }
    if (r.scene && !located.length) diag.error('BAD_VALUE', rel, loc('scene'), `"${r.scene}"; expected scene ids separated by | or blank`);
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
    // a non-blank scene adds 1 to specificity (SPEC "Dialogue location"), so a located row beats the same row anywhere
    const sceneSet = located.length ? new Set(located) : null;
    const specificity = cond.filter(Boolean).length + (sceneSet ? 1 : 0);
    parsed.push({ id: r.id, line: r.__line, text: r.line, cond, scenes: sceneSet, offScene, priority, specificity, choices, bad, raw: r });
  }
  // next targets
  for (const row of parsed) for (const ch of row.choices) {
    if (ch.next && !ids.has(ch.next)) diag.error('DANGLING_NEXT', rel, { line: row.line, row: row.id, column: `next${ch.k}` }, `next${ch.k} points to "${ch.next}", which is not a row id in this sheet`);
  }
  return { rel, rows: parsed, located: parsed.some(r => r.scenes) };
}

// ---------------------------------------------------------------- completeness
function rowMatches(row, v, scene) {
  if (row.scenes && !row.scenes.has(scene)) return false;
  for (let i = 0; i < 6; i++) if (row.cond[i] && !row.cond[i].has(v[i])) return false;
  return true;
}
/** Winning row per cell for one scene (scene null = "anywhere": only rows with a blank scene cell match). */
function winnersFor(usable, scene) {
  const winners = new Array(NCELLS);
  for (let c = 0; c < NCELLS; c++) {
    const v = cellVector(c);
    let best = [];
    for (const r of usable) {
      if (!rowMatches(r, v, scene)) continue;
      if (!best.length || r.priority > best[0].priority || (r.priority === best[0].priority && r.specificity > best[0].specificity)) best = [r];
      else if (r.priority === best[0].priority && r.specificity === best[0].specificity) best.push(r);
    }
    winners[c] = best.length ? { row: best[0], tie: best.length > 1 ? best : null } : null;
  }
  return winners;
}
/**
 * SPEC "Dialogue location": completeness is checked per scene the NPC can be met in. `scenes` is that list
 * (empty for a TV-only NPC: then one pass with scene null). The fallback (all six conditions and scene blank)
 * is mandatory regardless.
 */
function analyseCompleteness(sheet, diag, scenes) {
  const { rel, rows } = sheet;
  const usable = rows.filter(r => !r.bad);
  const fallbacks = usable.filter(r => r.specificity === 0);
  const fallback = fallbacks[0] || null;
  if (!fallback) diag.error('MISSING_FALLBACK', rel, {}, 'no fallback row (all six condition cells and scene blank); required by SPEC');
  else if (fallback.priority !== 0) diag.warn('FALLBACK_PRIORITY', rel, { line: fallback.line, row: fallback.id, column: 'priority' }, `fallback row has priority ${fallback.priority}; SPEC requires 0`);
  const scope = scenes.length ? scenes : [null];
  const winCount = new Map(rows.map(r => [r.id, 0]));
  const ties = new Map(); // key -> {rows, cells (max per scene), scenes}
  const perScene = [];
  const byScene = new Map();
  for (const sc of scope) {
    const winners = winnersFor(usable, sc);
    byScene.set(sc, winners);
    let noMatch = 0, served = 0;
    const local = new Map();
    for (let c = 0; c < NCELLS; c++) {
      const w = winners[c];
      if (!w) { noMatch++; continue; }
      winCount.set(w.row.id, winCount.get(w.row.id) + 1);
      if (w.tie) {
        const key = w.tie.map(r => r.id).join('|');
        if (!local.has(key)) local.set(key, { rows: w.tie, cells: [] });
        local.get(key).cells.push(c);
      }
      if (w.row !== fallback) served++;
    }
    for (const [key, t] of local) {
      if (!ties.has(key)) ties.set(key, { rows: t.rows, cells: t.cells.length, example: t.cells[0], scenes: [] });
      const g = ties.get(key);
      g.cells = Math.max(g.cells, t.cells.length);
      g.scenes.push(sc);
    }
    const located = usable.filter(r => r.scenes && r.scenes.has(sc)).map(r => r.id);
    perScene.push({ scene: sc, coverage: served / NCELLS, served, noMatch, ties: [...local.values()].map(t => ({ rows: t.rows.map(r => r.id), cells: t.cells.length })), located });
  }
  const where = (list) => sheet.located && list[0] != null ? ` in ${list.length === scope.length && scope.length > 1 ? 'every scene' : `scene ${list.join(', ')}`}` : '';
  for (const t of ties.values()) {
    diag.error('TIE', rel, { line: t.rows[0].line, row: t.rows.map(r => r.id).join(',') },
      `rows ${t.rows.map(r => r.id).join(', ')} tie (priority ${t.rows[0].priority}, specificity ${t.rows[0].specificity}) in ${t.cells} cell(s)${where(t.scenes)}, e.g. ${cellLabel(t.example)}`, { cells: t.cells, scenes: t.scenes.filter(x => x != null) });
  }
  const worst = perScene.reduce((a, b) => (b.noMatch > a.noMatch ? b : a), perScene[0]);
  if (worst.noMatch) diag.error('NO_MATCH', rel, {}, `${worst.noMatch} of ${NCELLS} cells match no row at all${where([worst.scene])}`);
  // rows that only appear as next targets are expected not to win cells
  const nextTargets = new Set(rows.flatMap(r => r.choices.map(c => c.next).filter(Boolean)));
  const neverWins = [];
  for (const r of usable) {
    if (winCount.get(r.id) > 0) continue;
    if (nextTargets.has(r.id)) continue;
    neverWins.push(r.id);
    if (r.offScene) continue; // already reported as SCENE_NOT_APPEARED
    // find who shadows it (in a scene the row can match)
    let anyCell = -1, anyScene = null;
    for (const sc of scope) {
      for (let c = 0; c < NCELLS && anyCell < 0; c++) if (rowMatches(r, cellVector(c), sc)) { anyCell = c; anyScene = sc; }
      if (anyCell >= 0) break;
    }
    const w = anyCell >= 0 ? byScene.get(anyScene)[anyCell] : null;
    diag.warn('NEVER_WINS', rel, { line: r.line, row: r.id }, anyCell < 0 ? (r.scenes ? 'row matches no cell in any scene this NPC appears in' : 'row matches no cell') : `row never wins any cell (shadowed; e.g. ${w ? w.row.id : '?'} wins at ${cellLabel(anyCell)}${where([anyScene])})`);
  }
  // headline numbers: the weakest scene (a sheet is only as complete as its least-covered scene)
  const minScene = perScene.reduce((a, b) => (b.coverage < a.coverage ? b : a), perScene[0]);
  return {
    winners: byScene.get(minScene.scene), byScene, scope, perScene, fallback,
    coverage: minScene.coverage, served: minScene.served, noMatch: worst.noMatch,
    ties: [...ties.values()].map(t => ({ rows: t.rows.map(r => r.id), cells: t.cells, scenes: t.scenes.filter(x => x != null) })),
    neverWins, winCount: Object.fromEntries(winCount), nextTargets,
  };
}

// ---------------------------------------------------------------- reachability
/**
 * Mirror of the engine's rowDepth (src/rules.ts): depth(row) = 1 + max depth of its choices' `next` rows, a cycle counts
 * as FREE_DEPTH, results capped at FREE_DEPTH. `rows` are parsed sheet rows ({ id, choices: [{ next }] }).
 */
export function rowDepth(rows, row, cache = new Map()) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const stack = new Set();
  const visit = (r) => {
    const hit = cache.get(r.id);
    if (hit !== undefined) return hit;
    if (stack.has(r.id)) return FREE_DEPTH;
    stack.add(r.id);
    let deepest = 0;
    for (const c of r.choices) { const nx = c.next ? byId.get(c.next) : undefined; if (nx) deepest = Math.max(deepest, visit(nx)); }
    stack.delete(r.id);
    const d = Math.min(FREE_DEPTH, 1 + deepest);
    cache.set(r.id, d);
    return d;
  };
  return visit(row);
}

/** What opening a conversation on `row` costs (engine talkCost): 0 for a short conversation, else DIALOGUE_COST. */
export const talkCost = (rows, row, cache) => (rowDepth(rows, row, cache) < FREE_DEPTH ? 0 : DIALOGUE_COST);

/**
 * Dijkstra over (NPC state, invite flags, row on screen[, day, conversations today]).
 *  - limit null: the old over-approximation (world variables, dayPhase included, free; any number of conversations).
 *    Used to tell "unreachable at all" from "unreachable under the conversation limit".
 *  - limit T: SPEC "Conversation limit": at most T conversations with this NPC per day over the 5-day demo. The day is
 *    tracked (dayPhase follows it: days 1-2 early, 3 mid, 4-5 late), going to the next day is free, follow-ups via
 *    `next` stay in the same conversation, and events do not count as conversations.
 * Talking happens in any of `talkScenes`; the row shown is the winner in that scene (scene filter).
 */
function searchNpc(npc, sheet, comp, myEvents, inviteBit, startMask, talkScenes, limit) {
  const rowById = new Map(sheet.rows.map(r => [r.id, r]));
  const depthCache = new Map();
  const limited = limit != null;
  const dist = new Map(), prev = new Map();
  const key = (s, m, r, day, used) => `${s}|${m}|${r || ''}|${day}|${used}`;
  const buckets = [];
  const push = (k, d, from, label) => {
    if (dist.has(k) && dist.get(k) <= d) return;
    dist.set(k, d); prev.set(k, { from, label });
    (buckets[d] ||= []).push(k);
  };
  push(key(npc.start, startMask, '', 0, 0), 0, null, null);
  const choiceEdges = (s, m, row, base, day, used, out) => {
    for (const ch of row.choices) {
      const r = applyEffects(s, m, ch.ops, inviteBit);
      const nxt = ch.next && rowById.has(ch.next) ? ch.next : '';
      const cost = base + r.extra;
      out.push({ k: key(r.s, r.mask, nxt, day, used), cost, label: `${row.id}/choice${ch.k} (+${cost})` });
    }
  };
  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d] || [];
    for (let bi = 0; bi < bucket.length; bi++) { // zero-cost edges append to this bucket while it is walked
      const k = bucket[bi];
      if (dist.get(k) !== d) continue;
      const [ss, mm, rid, dd, uu] = k.split('|');
      const s = +ss, m = +mm, day = +dd, used = +uu;
      const out = [];
      if (rid) {
        choiceEdges(s, m, rowById.get(rid), 0, day, used, out);
        if (!rowById.get(rid).choices.length) out.push({ k: key(s, m, '', day, used), cost: 0, label: null });
      } else {
        if (talkScenes.length && (!limited || used < limit)) {
          const seenRows = new Set();
          for (const sc of talkScenes) {
            const winners = comp.byScene.get(sc);
            for (let w = 0; w < NWORLD; w++) {
              if (limited && w % 3 !== DAY_PHASE[day]) continue; // the day fixes dayPhase
              const win = winners[s * NWORLD + w];
              if (!win || seenRows.has(win.row.id)) continue;
              seenRows.add(win.row.id);
              // the engine charges at talk start: free when the opening row is a short conversation (depth < 3)
              choiceEdges(s, m, win.row, talkCost(sheet.rows, win.row, depthCache), day, limited ? used + 1 : 0, out);
            }
          }
        }
        const rap = stateVec(s)[1];
        for (const e of myEvents) {
          if (e.trigger === 'invite' && !(m & inviteBit.get(e.id))) continue;
          if (rap < e.minRapport) continue;
          for (const ch of e.choices) {
            const r = applyEffects(s, m, ch.ops, inviteBit);
            const cost = e.cost + r.extra;
            out.push({ k: key(r.s, r.mask, '', day, used), cost, label: `event:${e.id}/choice${ch.k} (+${cost})` });
          }
        }
        if (limited && day < DEMO_DAYS - 1) out.push({ k: key(s, m, '', day + 1, 0), cost: 0, label: `day ${day + 2}` });
      }
      for (const ed of out) push(ed.k, d + ed.cost, k, ed.label);
    }
  }
  const pathTo = (k) => {
    const labels = [];
    while (k && prev.get(k)) { const p = prev.get(k); if (p.label) labels.push(p.label); k = p.from; }
    // "day 2 → day 3 → day 4" (nights with no conversation) reads as just "day 4"
    return labels.reverse().filter((l, i, a) => !(/^day \d$/.test(l) && /^day \d$/.test(a[i + 1] ?? '')));
  };
  // cheapest idle node from which a conversation can start, per cell (state x world; dayPhase follows the day when limited)
  const cellCost = new Array(NCELLS).fill(Infinity), cellKey = new Array(NCELLS).fill(null);
  const showCost = new Map(), showKey = new Map();
  for (const [k, d] of dist) {
    const [ss, , rid, dd, uu] = k.split('|');
    if (rid) { if (!showCost.has(rid) || d < showCost.get(rid)) { showCost.set(rid, d); showKey.set(rid, k); } continue; }
    if (!talkScenes.length || (limited && +uu >= limit)) continue;
    for (let w = 0; w < NWORLD; w++) {
      if (limited && w % 3 !== DAY_PHASE[+dd]) continue;
      const c = +ss * NWORLD + w;
      if (d < cellCost[c]) { cellCost[c] = d; cellKey[c] = k; }
    }
  }
  const rows = {};
  for (const r of sheet.rows) {
    if (r.bad) continue;
    let best = Infinity, bestCell = -1, bestScene = null, via = null;
    for (const sc of talkScenes) {
      const winners = comp.byScene.get(sc);
      for (let c = 0; c < NCELLS; c++) {
        const w = winners[c];
        if (w && w.row === r && cellCost[c] < best) { best = cellCost[c]; bestCell = c; bestScene = sc; }
      }
    }
    if (showCost.has(r.id) && showCost.get(r.id) < best) { best = showCost.get(r.id); via = showKey.get(r.id); bestCell = -1; }
    let witness = null;
    if (best < Infinity) {
      const labels = via ? pathTo(via) : pathTo(cellKey[bestCell]);
      witness = [...labels, r.id].join(' → ');
      if (bestCell >= 0) witness += `  [at ${cellLabel(bestCell)}${sheet.located ? `, scene=${bestScene}` : ''}]`; else witness += '  [via next]';
    }
    rows[r.id] = { cost: best === Infinity ? null : best, witness };
  }
  const reachableStates = new Set([...dist.keys()].filter(k => k.split('|')[2] === '').map(k => k.split('|')[0])).size;
  return { cellCost, rows, reachableStates };
}

function analyseReachability(npc, sheet, comp, events, invitedExternally, diag, talkScenes, maxTalks) {
  const rel = sheet.rel;
  const myEvents = events.filter(e => e.npc === npc.id);
  const inviteBit = new Map();
  myEvents.filter(e => e.trigger === 'invite').forEach((e, i) => inviteBit.set(e.id, 1 << i));
  let startMask = 0;
  for (const [id, bit] of inviteBit) if (invitedExternally.has(id)) startMask |= bit;
  const canTalk = talkScenes.length > 0;
  const depthCache = new Map();
  const free = searchNpc(npc, sheet, comp, myEvents, inviteBit, startMask, talkScenes, null);
  const lim = searchNpc(npc, sheet, comp, myEvents, inviteBit, startMask, talkScenes, maxTalks);
  const rowsOut = {};
  const unreachable = [], overBudget = [], limitUnreachable = [];
  for (const r of sheet.rows) {
    if (r.bad) continue;
    const a = free.rows[r.id], b = lim.rows[r.id];
    rowsOut[r.id] = {
      cost: b.cost, witness: b.witness, depth: rowDepth(sheet.rows, r, depthCache),
      // without the conversation limit (only differs when the limit makes the row dearer or unreachable)
      ...(a.cost !== b.cost ? { costNoLimit: a.cost, witnessNoLimit: a.witness } : {}),
    };
    if (!canTalk || comp.neverWins.includes(r.id)) continue; // never-win rows are reported once, as NEVER_WINS
    const talkWins = talkScenes.some(sc => comp.byScene.get(sc).some(w => w && w.row === r)) || comp.nextTargets.has(r.id);
    if (a.cost == null && !talkWins) {
      // it only wins in scenes where this NPC is met through events (e.g. a visit at home): no conversation starts there
      const only = comp.scope.filter(sc => sc != null && !talkScenes.includes(sc) && comp.byScene.get(sc).some(w => w && w.row === r));
      diag.info('EVENT_SCENE_ONLY', rel, { line: r.line, row: r.id }, `row wins only in ${only.join(', ') || 'no scene'}, where ${npc.id} is met through events, not conversation; completeness there is checked, reachability is not`);
    } else if (a.cost == null) {
      unreachable.push(r.id);
      diag.error('UNREACHABLE', rel, { line: r.line, row: r.id }, `row is unreachable from initial state (${cellLabel(npc.start * NWORLD).split(', ').slice(0, 3).join(', ')}): no sequence of dialogue choices or events reaches a cell it wins`);
    } else if (b.cost == null) {
      limitUnreachable.push(r.id);
      diag.error('LIMIT_UNREACHABLE', rel, { line: r.line, row: r.id }, `row is unreachable with at most ${maxTalks} conversation(s) per day over ${DEMO_DAYS} days (dayPhase follows the day); without the limit: ${a.cost} action(s) via ${a.witness}`, { talks: maxTalks });
    } else if (b.cost > BUDGET) {
      overBudget.push(r.id);
      diag.warn('OVER_BUDGET', rel, { line: r.line, row: r.id }, `row needs at least ${b.cost} actions; budget is ${BUDGET}`);
    }
  }
  if (!canTalk) diag.info('NO_APPEARANCES', rel, {}, `NPC ${npc.id} has no appearances, so dialogue can never start; reachability not enforced`);
  return { cellCost: lim.cellCost, rows: rowsOut, unreachable, limitUnreachable, overBudget, reachableStates: lim.reachableStates, canTalk };
}

// ---------------------------------------------------------------- main
/**
 * Runs every check over in-memory content.
 * input.files: { 'scenes.yaml': text, 'npcs.yaml': text, 'events.csv': text, 'news.csv': text, 'cast.yaml'?: text,
 *   'dialogue/<npcId>.csv': text, ... } (absent key = file missing; dialogue keys in listing order)
 * input.manifest: manifest.json text, a parsed manifest object, or null when there is none
 * input.content: label for the content location (CLI: absolute path)
 * input.analyse: optional list of NPC ids; completeness/reachability run only for those (editor speed-up)
 * input.maxTalks: conversations per NPC per day the reachability search allows (roomConfig.maxTalksPerNpcPerDay; default 1)
 */
/**
 * SPEC "Packs", mirroring the engine: the effective pack of a player whose home culture is `culture` (their culture
 * when some NPC and some scene carry it, else cn) and the scenes open to them (shared ones plus that pack's).
 * `npcs` / `scenes`: iterables of { pack } / { id, pack }.
 */
export function packView(npcs, scenes, culture) {
  const npcList = [...npcs], sceneList = [...scenes];
  const want = SCENE_PACKS.includes(culture) ? culture : 'cn';
  const pack = want === 'cn' || (npcList.some(n => n && n.pack === want) && sceneList.some(sc => sc && sc.pack === want)) ? want : 'cn';
  return { culture: want, pack, fallback: pack !== want, scenes: sceneList.filter(sc => sc && (!sc.pack || sc.pack === pack)).map(sc => sc.id) };
}

export function checkContent(input) {
  const { files = {}, manifest = null, content = '', analyse = null } = input || {};
  const maxTalks = Number.isInteger(input?.maxTalks) && input.maxTalks > 0 ? input.maxTalks : DEFAULT_TALKS;
  const diag = new Diag();
  let assets = null;
  if (manifest != null) {
    if (typeof manifest === 'object') assets = manifest;
    else { try { assets = JSON.parse(manifest); } catch (e) { diag.warn('MANIFEST', 'assets/manifest.json', {}, `could not parse: ${e.message}`); } }
  }
  const scenes = validateScenes(files, diag, assets);
  const npcs = validateNpcs(files, diag, scenes, assets);
  // cross-file: talk hotspots and painted casts must name real NPCs
  for (const sc of scenes.values()) {
    const rel = 'scenes.yaml';
    for (const h of sc.hotspots || []) if (h?.action?.type === 'talk' && h.action.npc && !npcs.has(h.action.npc)) diag.error('UNKNOWN_NPC', rel, { path: `scenes.${sc.id}.hotspots.${h.id}.action.npc` }, `talk hotspot names unknown npc "${h.action.npc}"`);
    for (const id of (sc.painted && Array.isArray(sc.painted.npcs) ? sc.painted.npcs : [])) if (!npcs.has(id)) diag.error('UNKNOWN_NPC', rel, { path: `scenes.${sc.id}.painted.npcs` }, `painted cast names unknown npc "${id}"`);
  }
  // optional cast.yaml (a list, or { cast: [...] }, of { id, name, role }): cast ids named by news.figure / events.portrait
  const castIds = new Set();
  if (files['cast.yaml'] != null) {
    try {
      const d = yaml.load(files['cast.yaml']);
      for (const c of Array.isArray(d) ? d : Array.isArray(d?.cast) ? d.cast : []) if (c && c.id) castIds.add(String(c.id));
    } catch (e) { diag.error('YAML_PARSE', 'cast.yaml', { line: e.mark ? e.mark.line + 1 : undefined }, e.reason || e.message); }
  }
  // SPEC "Packs": a pack is playable when it has NPCs and a scene; one without the other falls back to cn silently
  {
    const npcPacks = new Set([...npcs.values()].map(n => n.pack).filter(p => SCENE_PACKS.includes(p)));
    const scenePacks = new Set([...scenes.values()].map(sc => sc.pack).filter(p => SCENE_PACKS.includes(p)));
    for (const p of SCENE_PACKS) {
      // cn is the standing-in pack: cn players always play cn, so cn NPCs without a cn scene still meet people in shared scenes
      if (p !== 'cn' && npcPacks.has(p) && !scenePacks.has(p)) diag.warn('PACK_INCOMPLETE', 'scenes.yaml', { path: 'scenes' }, `pack "${p}" has NPCs in npcs.yaml but no scene carries pack: ${p}; ${p} players fall back to the cn pack`);
      if (scenePacks.has(p) && !npcPacks.has(p)) diag.warn('PACK_INCOMPLETE', 'npcs.yaml', { path: 'npcs' }, p === 'cn' ? 'scenes carry pack: cn but no NPC has pack: cn' : `scenes carry pack: ${p} but no NPC has pack: ${p}; ${p} players fall back to the cn pack and never see those scenes`);
    }
    // an NPC appearing in another pack's scene could never be met there (only one pack is ever in play)
    for (const [id, n] of npcs) for (const [j, a] of (n.appearances || []).entries()) {
      const sc = a && scenes.get(a.scene);
      if (sc && SCENE_PACKS.includes(sc.pack) && n.pack !== 'shared' && n.pack !== sc.pack) diag.warn('PACK_MISMATCH', 'npcs.yaml', { line: n.line, path: `npcs.${id}.appearances[${j}]` }, `${id} (pack ${n.pack}) appears in ${sc.id}, a pack ${sc.pack} scene; nobody playing ${n.pack} can go there`);
    }
  }
  const { events, ids: eventIds } = validateEvents(files, diag, scenes, npcs, assets, castIds);
  validateNews(files, diag, assets, castIds);

  const sheetFiles = Object.keys(files).filter(k => k.startsWith('dialogue/') && k.endsWith('.csv') && files[k] != null).map(k => k.slice('dialogue/'.length));
  for (const f of sheetFiles) {
    const id = f.slice(0, -4);
    if (!npcs.has(id)) diag.error('UNKNOWN_NPC', `dialogue/${f}`, {}, `sheet for unknown npc "${id}" (not in npcs.yaml)`);
  }
  // where each NPC can be met: talkScenes (figure appearances, painted variants, talk zones) are where a
  // conversation can start; completeness also covers scenes of events naming the NPC (SPEC "Dialogue location")
  const talkScenesOf = new Map(), metScenesOf = new Map();
  for (const [id, n] of npcs) {
    const talk = new Set(n.appearances.filter(a => a && scenes.has(a.scene)).map(a => a.scene));
    for (const sc of scenes.values()) {
      if (sc.painted && Array.isArray(sc.painted.npcs) && sc.painted.npcs.includes(id)) talk.add(sc.id);
      if ((sc.hotspots || []).some(h => h?.action?.type === 'talk' && h.action.npc === id)) talk.add(sc.id);
    }
    const met = new Set(talk);
    for (const e of events) if (e.npc === id && e.scene && scenes.has(e.scene)) met.add(e.scene);
    talkScenesOf.set(id, [...talk]);
    metScenesOf.set(id, [...met]);
  }
  const sheets = new Map();
  for (const id of npcs.keys()) {
    const s = validateDialogue(files, id, diag, eventIds, scenes, new Set(metScenesOf.get(id)));
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
    if (analyse && !analyse.includes(id)) { npcResults.push({ id, name: npc.name, sheet: s.rel, skipped: true, rowCount: s.rows.length }); continue; }
    const comp = analyseCompleteness(s, diag, metScenesOf.get(id));
    // headline coverage: the weakest scene a conversation can start in (events-only scenes stay listed per scene)
    const talkPer = comp.perScene.filter(p => talkScenesOf.get(id).includes(p.scene));
    if (talkPer.length) { const w = talkPer.reduce((a, b) => (b.coverage < a.coverage ? b : a)); comp.coverage = w.coverage; comp.served = w.served; comp.winners = comp.byScene.get(w.scene); }
    // invites of this NPC's events issued from outside this NPC's own model
    const external = new Set();
    for (const [evId, owners] of inviteSources) for (const o of owners) if (o !== id) external.add(evId);
    const reach = analyseReachability(npc, s, comp, events, external, diag, talkScenesOf.get(id).filter(x => comp.byScene.has(x)), maxTalks);
    const mine = diag.list.slice(before);
    const cellsOf = (winners) => winners.map((w, c) => w ? { row: w.row.id, spec: w.row.specificity, prio: w.row.priority, line: w.row.text, tie: w.tie ? w.tie.map(r => r.id) : null, cost: reach.cellCost[c] === Infinity ? null : reach.cellCost[c] } : { row: null, cost: reach.cellCost[c] === Infinity ? null : reach.cellCost[c] });
    const cells = cellsOf(comp.winners);
    npcResults.push({
      id, name: npc.name, sheet: s.rel, rowCount: s.rows.length, fallback: comp.fallback?.id ?? null,
      coverage: comp.coverage, served: comp.served, noMatch: comp.noMatch, ties: comp.ties, neverWins: comp.neverWins,
      // per-scene completeness (SPEC "Dialogue location"); scene null = a TV-only NPC checked "anywhere"
      scenes: comp.perScene, talkScenes: talkScenesOf.get(id), located: s.located,
      // per-scene grids only when the sheet has located rows (otherwise every scene's grid is the same)
      sceneCells: s.located ? Object.fromEntries([...comp.byScene].map(([sc, w]) => [sc, cellsOf(w)])) : undefined,
      maxTalks, limitUnreachable: reach.limitUnreachable,
      unreachable: reach.unreachable, overBudget: reach.overBudget, reachableStates: reach.reachableStates, canTalk: reach.canTalk,
      rows: reach.rows, winCount: comp.winCount, cells,
      errors: mine.filter(d => d.severity === 'error').length, warnings: mine.filter(d => d.severity === 'warning').length,
    });
  }
  const counts = { error: 0, warning: 0, info: 0 };
  for (const d of diag.list) counts[d.severity]++;
  const packs = Object.fromEntries(SCENE_PACKS.map(p => [p, packView(npcs.values(), scenes.values(), p)]));
  return { content, generated: new Date().toISOString(), ok: counts.error === 0, counts, maxTalks, diagnostics: diag.list, npcs: npcResults, packs };
}
