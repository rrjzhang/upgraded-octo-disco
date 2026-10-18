// Culture-pack gating checks for events.csv / news.csv rows and the PACK_LEAK lint (SPEC "Culture packs" and "Checker").
// Pure: called from checkContent in core.mjs with the already-validated content.
import * as yaml from 'js-yaml';

const PACKS = ['cn', 'mx', 'in'];
/** Placeholders the engine fills for every player; `pack.<pack>.<name>` strings add per-pack ones. */
const BUILTIN_VARS = ['homeCulture', 'playerName', 'leaderName'];

/** A strings.en.json key: `pack.<pack>.<name>` or `pack.<pack>|<dim>=<value>[|...].<name>` (SPEC "Profile questions and variant words"). */
export const PACK_KEY = /^pack\.([^.|]+)((?:\|\w+=\w+)*)\.(\w+)$/;

/**
 * content/profile.yaml -> { dims: { in: { region: Set(north, south), faith: Set(hindu, muslim) } } } (skip options left
 * out), with schema problems reported; null when the file is absent.
 */
export function parseProfile(text, diag) {
  if (text == null) return null;
  let doc;
  try { doc = yaml.load(text); } catch (e) { diag.error('YAML_PARSE', 'profile.yaml', { line: e.mark ? e.mark.line + 1 : undefined }, e.reason || e.message); return null; }
  const dims = {};
  const checkQ = (q, where, needId) => {
    if (!q || typeof q !== 'object' || typeof q.question !== 'string' || !q.question.trim()) { diag.error('SCHEMA', 'profile.yaml', { path: where }, 'needs a question'); return null; }
    if (needId && !/^\w+$/.test(String(q.id ?? ''))) { diag.error('SCHEMA', 'profile.yaml', { path: where }, 'needs an id (a word)'); return null; }
    const opts = Array.isArray(q.options) ? q.options : [];
    const ids = [];
    opts.forEach((o, i) => {
      if (!o || typeof o !== 'object' || !/^\w+$/.test(String(o.id ?? '')) || typeof o.label !== 'string' || !o.label.trim()) diag.error('SCHEMA', 'profile.yaml', { path: `${where}.options[${i}]` }, 'needs id (a word) and label');
      else if (!o.skip) ids.push(String(o.id));
    });
    if (!ids.length) diag.error('SCHEMA', 'profile.yaml', { path: where }, 'needs at least one option that is not skip');
    return ids;
  };
  const h = checkQ(doc?.heritage, 'heritage', false) || [];
  for (const id of h) if (!['cn', 'mx', 'in', 'other'].includes(id)) diag.error('BAD_VALUE', 'profile.yaml', { path: 'heritage.options' }, `option "${id}"; expected cn | mx | in | other`);
  for (const [pack, list] of Object.entries(doc?.followups ?? {})) {
    if (!PACKS.includes(pack)) { diag.error('BAD_VALUE', 'profile.yaml', { path: `followups.${pack}` }, `pack "${pack}"; expected ${PACKS.join('|')}`); continue; }
    dims[pack] = {};
    (Array.isArray(list) ? list : []).forEach((q, i) => {
      const ids = checkQ(q, `followups.${pack}[${i}]`, true);
      if (!ids) return;
      if (dims[pack][q.id] || q.id === 'heritage') diag.error('DUPLICATE_ID', 'profile.yaml', { path: `followups.${pack}[${i}].id` }, `duplicate question id "${q.id}"`);
      dims[pack][q.id] = new Set(ids);
    });
  }
  return { dims };
}

/** SPEC "Packs": the variant group of an events.csv / news.csv id (the id without a trailing _cn | _mx | _in). */
export const packGroup = (id) => String(id).replace(/_(cn|mx|in)$/, '');

/**
 * pack_terms.yaml text -> { cn: [terms], mx: [...], in: [...] } (lowercased), or null when the file is absent.
 * An optional `allow` list of { file, row, term, why } marks one deliberate use (returned as `allow`).
 */
export function parsePackTerms(text, diag) {
  if (text == null) return null;
  let doc;
  try { doc = yaml.load(text); } catch (e) { diag.error('YAML_PARSE', 'pack_terms.yaml', { line: e.mark ? e.mark.line + 1 : undefined }, e.reason || e.message); return null; }
  const out = {};
  for (const [k, v] of Object.entries(doc || {})) {
    if (k === 'allow') {
      out.allow = (Array.isArray(v) ? v : []).filter(a => {
        const ok = a && a.file && a.row && a.term && a.why;
        if (!ok) diag.error('SCHEMA', 'pack_terms.yaml', { path: 'allow' }, `allow entries need file, row, term and why; got ${JSON.stringify(a)}`);
        return ok;
      }).map(a => ({ file: String(a.file), row: String(a.row), term: String(a.term).toLowerCase(), why: String(a.why), used: false }));
      continue;
    }
    if (!PACKS.includes(k)) { diag.error('BAD_VALUE', 'pack_terms.yaml', { path: k }, `unknown pack "${k}"; expected ${PACKS.join('|')}`); continue; }
    if (!Array.isArray(v)) { diag.error('SCHEMA', 'pack_terms.yaml', { path: k }, 'expected a list of terms'); continue; }
    out[k] = v.map(t => String(t).trim().toLowerCase()).filter(Boolean);
  }
  return out;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** One regex per pack: whole words or phrases, case-insensitive, optional plural s. */
export function termMatchers(terms) {
  const m = {};
  for (const [p, list] of Object.entries(terms || {})) {
    if (!list.length) continue;
    const alt = [...list].sort((a, b) => b.length - a.length).map(t => escRe(t).replace(/\s+/g, '\\s+')).join('|');
    m[p] = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})s?(?![\\p{L}\\p{N}])`, 'giu');
  }
  return m;
}

/** Terms of packs other than `own` (own = null: every pack) found in `text`, as { pack: [terms] }. */
export function findLeaks(text, matchers, own = null) {
  const clean = String(text ?? '').replace(/\{\w+\}/g, ' ');
  const hits = {};
  for (const [p, re] of Object.entries(matchers)) {
    if (p === own) continue;
    const found = [...clean.matchAll(re)].map(x => x[0].toLowerCase().replace(/\s+/g, ' '));
    if (found.length) hits[p] = [...new Set(found)];
  }
  return hits;
}

/**
 * input: { files, diag, scenes (Map), npcs (Map), events (validated rows), news (rows), sheets (Map npcId -> sheet) }
 * Adds BAD_VALUE / PACK_MISMATCH / PACK_GAP for the `pack` columns, UNKNOWN_VAR for placeholders, and PACK_LEAK.
 */
export function checkPacks({ files, diag, scenes, npcs, events, news, sheets }) {
  const scenePack = (id) => { const p = scenes.get(id)?.pack; return PACKS.includes(p) ? p : null; };
  const npcPack = (id) => { const p = npcs.get(id)?.pack; return PACKS.includes(p) ? p : null; };

  // ---- the pack column: values, consistency with npc / scene, and every pack covered in an id group
  for (const [rel, rows] of [['events.csv', events], ['news.csv', news]]) {
    for (const r of rows) {
      if (!r.id || !r.pack) continue;
      const loc = { line: r.__line, row: r.id, column: 'pack' };
      if (!PACKS.includes(r.pack)) { diag.error('BAD_VALUE', rel, loc, `pack "${r.pack}"; expected ${PACKS.join('|')} or blank (every pack)`); continue; }
      const np = r.npc ? npcPack(r.npc) : null, sp = r.scene ? scenePack(r.scene) : null;
      if (np && np !== r.pack) diag.warn('PACK_MISMATCH', rel, loc, `pack ${r.pack} but npc ${r.npc} is pack ${np}; nobody ever sees this row`);
      if (sp && sp !== r.pack) diag.warn('PACK_MISMATCH', rel, loc, `pack ${r.pack} but scene ${r.scene} is pack ${sp}; nobody ever sees this row`);
    }
    const groups = new Map();
    for (const r of rows) if (r.id) { const g = packGroup(r.id); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
    for (const [g, rs] of groups) {
      if (!rs.some(r => PACKS.includes(r.pack))) continue;
      if (rs.some(r => !r.pack)) continue; // a blank-pack row is the fallback for the packs without a variant
      const missing = PACKS.filter(p => !rs.some(r => r.pack === p));
      // a group tied to one pack's npc or scene needs no variants for the others
      const tied = rs.every(r => (r.npc && npcPack(r.npc)) || (r.scene && scenePack(r.scene)));
      if (missing.length && !tied) diag.warn('PACK_GAP', rel, { line: rs[0].__line, row: rs[0].id, column: 'pack' }, `id group "${g}" is pack-gated (${rs.map(r => `${r.id}: ${r.pack}`).join(', ')}) but has no variant for ${missing.join(', ')} and no blank-pack fallback; add ${missing.map(p => `${g}_${p}`).join(', ')} or a row with a blank pack`);
    }
  }

  // ---- per-pack strings: pack.<pack>.<name> must exist for every pack; {placeholders} must be known
  let strings = null;
  if (files['strings.en.json'] != null) {
    try { strings = JSON.parse(files['strings.en.json']); } catch (e) { diag.error('JSON_PARSE', 'strings.en.json', {}, e.message); }
  }
  const profile = parseProfile(files['profile.yaml'], diag);
  const packVarNames = new Map(); // name -> Set(packs) with a base (unconstrained) word
  const allVarNames = new Set();
  if (strings) {
    const constrained = []; // [pack, name, key]
    for (const k of Object.keys(strings)) {
      if (!k.startsWith('pack.')) continue;
      const m = PACK_KEY.exec(k);
      if (!m) { diag.error('BAD_VALUE', 'strings.en.json', { path: k }, 'expected pack.<pack>.<name> or pack.<pack>|<dim>=<value>.<name>'); continue; }
      if (!PACKS.includes(m[1])) { diag.error('BAD_VALUE', 'strings.en.json', { path: k }, `pack "${m[1]}"; expected ${PACKS.join('|')}`); continue; }
      allVarNames.add(m[3]);
      if (!m[2]) {
        if (!packVarNames.has(m[3])) packVarNames.set(m[3], new Set());
        packVarNames.get(m[3]).add(m[1]);
        continue;
      }
      constrained.push([m[1], m[3], k]);
      // SPEC "Profile questions and variant words": every <dim>=<value> must be a follow-up question and a non-skip option of that pack
      const dims = profile?.dims?.[m[1]];
      for (const c of m[2].slice(1).split('|')) {
        const [d, v] = c.split('=');
        if (!profile) continue; // no profile.yaml in the input: nothing to check against
        if (!dims || !dims[d]) diag.error('BAD_VALUE', 'strings.en.json', { path: k }, `"${d}" is not a follow-up question for pack ${m[1]} in profile.yaml (${dims ? Object.keys(dims).join(', ') || 'none' : 'no follow-ups'})`);
        else if (!dims[d].has(v)) diag.error('BAD_VALUE', 'strings.en.json', { path: k }, `"${v}" is not an option of ${m[1]}.${d} (${[...dims[d]].join(', ')})`);
      }
    }
    for (const [p, name, k] of constrained) if (!packVarNames.get(name)?.has(p)) diag.warn('PACK_GAP', 'strings.en.json', { path: k }, `variant word without a base: add pack.${p}.${name} for players who skipped or answered differently`);
    for (const [name, ps] of packVarNames) {
      const missing = PACKS.filter(p => !ps.has(p));
      if (missing.length) diag.warn('PACK_GAP', 'strings.en.json', { path: `pack.*.${name}` }, `{${name}} is defined for ${[...ps].join(', ')} but not ${missing.join(', ')}; those players would see "{${name}}"`);
    }
  }

  // ---- every player-facing text with the pack that sees it (null = every pack)
  const texts = [];
  const add = (rel, loc, pack, field, text) => { if (text) texts.push({ rel, loc, pack, field, text: String(text) }); };
  for (const r of events) {
    if (!r.id) continue;
    const pack = PACKS.includes(r.pack) ? r.pack : (r.npc && npcPack(r.npc)) || (r.scene && scenePack(r.scene)) || null;
    for (const f of ['text', 'choice1', 'choice2']) add('events.csv', { line: r.__line, row: r.id, column: f }, pack, f, r[f]);
  }
  for (const r of news) {
    if (!r.id) continue;
    for (const f of ['headline', 'body']) add('news.csv', { line: r.__line, row: r.id, column: f }, PACKS.includes(r.pack) ? r.pack : null, f, r[f]);
  }
  for (const [id, s] of sheets) {
    const pack = npcPack(id);
    for (const row of s.rows) for (const f of ['line', 'choice1', 'choice2', 'choice3']) add(s.rel, { line: row.line, row: row.id, column: f }, pack, f, f === 'line' ? row.text : row.raw?.[f]);
  }
  for (const sc of scenes.values()) {
    const pack = scenePack(sc.id), at = (sub) => ({ path: `scenes.${sc.id}${sub ? '.' + sub : ''}` });
    add('scenes.yaml', at('name'), pack, 'name', sc.name);
    add('scenes.yaml', at('description'), pack, 'description', sc.description);
    for (const h of Array.isArray(sc.hotspots) ? sc.hotspots : []) {
      if (!h) continue;
      // a talk zone is shown only while its NPC is in the roster
      const hp = pack || (h.action?.type === 'talk' && h.action.npc ? npcPack(h.action.npc) : null);
      add('scenes.yaml', at(`hotspots.${h.id}.label`), hp, 'label', h.label);
      // a look's textByPack { cn|mx|in: text } is seen by that pack only; `text` by the packs without one
      const byPack = h.action?.textByPack && typeof h.action.textByPack === 'object' ? h.action.textByPack : {};
      for (const [p, v] of Object.entries(byPack)) if (PACKS.includes(p)) add('scenes.yaml', at(`hotspots.${h.id}.action.textByPack.${p}`), p, 'text', v);
      const uncovered = PACKS.filter(p => !(typeof byPack[p] === 'string' && byPack[p].trim()));
      if (uncovered.length) add('scenes.yaml', at(`hotspots.${h.id}.text`), hp || (uncovered.length === 1 ? uncovered[0] : null), 'text', h.action?.text);
    }
    // the street lists an exit only to scenes open to the player
    for (const [j, e] of (Array.isArray(sc.exits) ? sc.exits : []).entries()) if (e) add('scenes.yaml', at(`exits[${j}].label`), pack || scenePack(e.to), 'label', e.label);
  }
  if (strings) for (const [k, v] of Object.entries(strings)) {
    if (k.startsWith('culture.') || typeof v !== 'string') continue; // the culture names are labels, shown on purpose
    const m = PACK_KEY.exec(k);
    add('strings.en.json', { path: k }, m && PACKS.includes(m[1]) ? m[1] : null, 'value', v);
  }
  if (files['questionnaire/eod.json'] != null) {
    try {
      const q = JSON.parse(files['questionnaire/eod.json']);
      add('questionnaire/eod.json', { path: 'title' }, null, 'title', q.title);
      add('questionnaire/eod.json', { path: 'intro' }, null, 'intro', q.intro);
      (q.pages || []).forEach((pg, i) => (pg.items || []).forEach((it, j) => {
        add('questionnaire/eod.json', { path: `pages[${i}].items[${j}].text` }, null, 'text', it.text);
        for (const o of it.options || []) add('questionnaire/eod.json', { path: `pages[${i}].items[${j}].options` }, null, 'option', o);
      }));
    } catch { /* the engine reports bad questionnaire JSON */ }
  }

  // ---- placeholders the engine cannot fill (only when strings.en.json is part of the input)
  if (strings) {
    const known = new Set([...BUILTIN_VARS, ...allVarNames]);
    for (const t of texts) {
      if (t.rel === 'strings.en.json' || t.rel.startsWith('questionnaire/')) continue; // UI strings and {H}/{M} have their own placeholders
      const unknown = [...new Set([...t.text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(n => !known.has(n)))];
      if (unknown.length) diag.warn('UNKNOWN_VAR', t.rel, t.loc, `{${unknown.join('}, {')}} is not filled by the engine (known: ${[...known].map(n => `{${n}}`).join(' ')}; add pack.<pack>.<name> strings for a per-pack word)`);
    }
  }

  // ---- PACK_LEAK
  const terms = parsePackTerms(files['pack_terms.yaml'], diag);
  if (!terms) return;
  const { allow = [], ...lists } = terms;
  const matchers = termMatchers(lists);
  for (const t of texts) {
    const hits = findLeaks(t.text, matchers, t.pack);
    for (const [p, all] of Object.entries(hits)) {
      const words = all.filter(w => !allow.some(a => a.file === t.rel && a.row === t.loc.row && (w === a.term || w === a.term + 's') && (a.used = true)));
      if (!words.length) continue;
      const who = t.pack ? `only ${t.pack} players see it` : 'every pack sees it';
      diag.warn('PACK_LEAK', t.rel, t.loc, `${t.field} mentions ${words.map(w => `"${w}"`).join(', ')} (pack ${p} terms in pack_terms.yaml), but ${who}; ${t.pack ? 'reword it' : `gate it with pack ${p} and add variants for the other packs, use a pack.<pack>.<name> placeholder, or reword it`}`);
    }
  }
  for (const a of allow) if (!a.used) diag.warn('PACK_LEAK', 'pack_terms.yaml', { path: 'allow', row: a.row }, `allow entry for "${a.term}" in ${a.file} row ${a.row} matches nothing; remove it`);
}
