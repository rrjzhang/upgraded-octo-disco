/** Loads and loosely validates content + manifest. Errors are logged naming file and row, never thrown for row-level problems. */
import { load as loadYaml } from 'js-yaml';
import Papa from 'papaparse';
import type {
  Content, DialogueRow, Emotion, EventRow, Manifest, NewsRow, Npc, Questionnaire, Scene, Slot, Hotspot, CondField, Screen,
  CastInfo, OverrideInfo, CultureId, Prop, Profile, ProfileOption, ProfileQuestion, LeadPos, Townhall, TownhallRow, Topic, TopicOption, TopicStance, Moderator,
} from './types';
import { COND_FIELDS, LEAD_POS, TOPIC_STANCES } from './types';
import { DEFAULT_STRINGS } from './strings';
import { validateEffects, validateCond, validateDay, validateLead, sceneList, EMOTIONS as EMOTION_LIST } from './rules';
import { appUrl } from './util';

export interface Source {
  kind: 'live' | 'fixtures';
  text(path: string): Promise<string | null>;
  assetUrl(file: string): string;
}

export const DIALOGUE_COLUMNS = [
  'id', 'met', 'rapport', 'lastValence', 'nationalLeader', 'playerLean', 'dayPhase', 'priority', 'emotion', 'line',
  'choice1', 'effect1', 'next1', 'choice2', 'effect2', 'next2', 'choice3', 'effect3', 'next3',
];
export const EVENT_COLUMNS = [
  'id', 'source', 'target', 'valence', 'proximity', 'trigger', 'scene', 'npc', 'minRapport', 'playerLean',
  'nationalLeader', 'chance', 'cost', 'emotion', 'text', 'choice1', 'effect1', 'choice2', 'effect2',
];
export const NEWS_COLUMNS = ['id', 'channel', 'nationalLeader', 'dayMin', 'valence', 'headline', 'body'];
/** Optional dialogue columns, placed after dayPhase: `scene` (SPEC "Dialogue location": blank = anywhere, else scene ids
 *  joined by `|`), then `usLead` and `homeLead` (SPEC "Leads": blank = any room, else pro|anti). */
export const DIALOGUE_OPTIONAL_COLUMNS = ['scene', 'usLead', 'homeLead'];
/** Optional columns (SPEC "Cast", "Packs", "Leads"): blank or absent = unchanged behaviour. */
export const EVENT_OPTIONAL_COLUMNS = ['portrait', 'medium', 'pack', 'day', 'usLead', 'homeLead'];
/** content/townhall/<npcId>.csv (SPEC "Town hall") */
export const TOWNHALL_COLUMNS = ['id', 'kind', 'nationalLeader', 'block', 'stance', 'emotion', 'text'];
export const NEWS_OPTIONAL_COLUMNS = ['figure', 'pack'];
/** localStorage key of the researcher's text override (written by /editor.html). */
export const OVERRIDE_KEY = 'gv:override:v1';
/** IndexedDB database / object store of the researcher's image overrides. */
export const OVERRIDE_DB = 'gv';
export const OVERRIDE_STORE = 'images';
const EMOTIONS: Emotion[] = [...EMOTION_LIST];
/** SPEC "Stances": Berry's acculturation strategies minus marginalization. */
export const STANCES = ['none', 'integration', 'assimilation', 'separation'] as const;
/** SPEC "Packs": culture packs a scene may belong to (absent = shared by everyone). */
export const SCENE_PACKS = ['cn', 'mx', 'in'] as const;

export function liveSource(): Source {
  return {
    kind: 'live',
    async text(path) {
      try {
        const res = await fetch(appUrl(path), { cache: 'no-cache' });
        if (!res.ok) return null;
        const ct = res.headers.get('content-type') ?? '';
        const body = await res.text();
        // Vite's dev server answers unknown paths with index.html; treat that as missing.
        if (!path.endsWith('.html') && (ct.includes('text/html') || /^\s*<!doctype html/i.test(body))) return null;
        return body;
      } catch {
        return null;
      }
    },
    assetUrl(file) {
      if (/^(data:|https?:|blob:)/.test(file)) return file;
      return file.startsWith('/') ? appUrl(file) : appUrl('assets/' + file);
    },
  };
}

class Reporter {
  errors: string[] = [];
  /** quiet: collect errors without logging them (an override candidate; the caller warns once and falls back). */
  constructor(private quiet = false) {}
  error(file: string, msg: string) {
    const m = `[content] ${file}: ${msg}`;
    this.errors.push(m);
    if (!this.quiet) console.error(m);
  }
  warn(file: string, msg: string) {
    if (!this.quiet) console.warn(`[content] ${file}: ${msg}`);
  }
}

const str = (v: unknown, d = ''): string => (v === null || v === undefined ? d : String(v).trim());
const num = (v: unknown, d: number): number => {
  const s = str(v);
  if (s === '') return d;
  const n = Number(s);
  return Number.isFinite(n) ? n : d;
};

function parseCsv(r: Reporter, file: string, text: string, columns: string[], optional: string[] = []): Record<string, string>[] {
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy' });
  for (const e of res.errors) r.error(file, `CSV parse error at row ${(e.row ?? 0) + 2}: ${e.message}`);
  const fields = (res.meta.fields ?? []).map((f) => f.trim());
  const unknown = fields.filter((f) => !columns.includes(f) && !optional.includes(f));
  const missing = columns.filter((c) => !fields.includes(c));
  if (unknown.length) r.error(file, `unknown column(s): ${unknown.join(', ')}`);
  if (missing.length) r.error(file, `missing column(s): ${missing.join(', ')}`);
  return res.data.map((row) => {
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) o[k.trim()] = str(v);
    return o;
  });
}

/** Scene perspective defaults: the backgrounds were generated as eye-level shots, horizon about a third from the top. */
export const DEFAULT_HORIZON = 1 / 3;
export const DEFAULT_CAMERA_HEIGHT = 1.6;
/** Standing adult and seated figure (the seated assets include the stool or bench) heights in metres. */
export const PERSON_HEIGHT = 1.7;
export const SEATED_HEIGHT = 1.3;
/** A figure is never drawn shorter or taller than these fractions of the frame. */
export const FIGURE_MIN = 0.12;
export const FIGURE_MAX = 0.95;

/**
 * Horizon-locked figure height as a fraction of the image height. On an eye-level shot the horizon is at camera height
 * at every depth, so a person of height H whose feet are at y spans (y - horizon) * H / cameraHeight of the frame.
 * A slot's explicit `scale` overrides this.
 */
export function figureHeight(sc: Pick<Scene, 'horizon' | 'cameraHeight'>, slot: Pick<Slot, 'y' | 'scale'>, seated: boolean): number {
  if (slot.scale) return slot.scale;
  const h = (slot.y - sc.horizon) * ((seated ? SEATED_HEIGHT : PERSON_HEIGHT) / sc.cameraHeight);
  return Math.min(FIGURE_MAX, Math.max(FIGURE_MIN, h));
}

function parseScenes(r: Reporter, file: string, text: string): Scene[] {
  let doc: any;
  try {
    doc = loadYaml(text);
  } catch (e) {
    r.error(file, `YAML error: ${(e as Error).message}`);
    return [];
  }
  const list = Array.isArray(doc?.scenes) ? doc.scenes : [];
  if (!list.length) r.error(file, 'no `scenes:` list found');
  const out: Scene[] = [];
  list.forEach((s: any, i: number) => {
    const where = `scene #${i + 1}${s?.id ? ` (${s.id})` : ''}`;
    if (!s?.id) return r.error(file, `${where}: missing id`);
    const community = str(s.community, 'neutral');
    if (!['home', 'us', 'neutral'].includes(community)) r.error(file, `${where}: bad community "${community}"`);
    const pack = s.pack === undefined || s.pack === null || s.pack === '' ? undefined : str(s.pack);
    if (pack !== undefined && !(SCENE_PACKS as readonly string[]).includes(pack)) r.error(file, `${where}: bad pack "${pack}" (cn | mx | in, or omit for a shared scene)`);
    const hotspots: Hotspot[] = [];
    (Array.isArray(s.hotspots) ? s.hotspots : []).forEach((hs: any, j: number) => {
      const hw = `${where} hotspot #${j + 1}${hs?.id ? ` (${hs.id})` : ''}`;
      const z = hs?.zone;
      if (!hs?.id || !z || [z.x, z.y, z.w, z.h].some((v) => typeof v !== 'number')) {
        return r.error(file, `${hw}: needs id and zone {x,y,w,h} as numbers`);
      }
      const a = hs.action ?? {};
      const type = str(a.type);
      if (!['window', 'news', 'end_day', 'move', 'look', 'talk'].includes(type)) r.error(file, `${hw}: unknown action type "${type}"`);
      if (type === 'talk' && !a.npc) r.error(file, `${hw}: talk action needs npc`);
      if (type === 'window' && !['tv', 'work', 'survey'].includes(str(a.module))) r.error(file, `${hw}: unknown module "${a.module}"`);
      hotspots.push({
        id: str(hs.id),
        label: str(hs.label, hs.id),
        zone: { x: z.x, y: z.y, w: z.w, h: z.h },
        action: { type: type as any, module: a.module, cost: a.cost === undefined ? undefined : num(a.cost, 1), to: a.to, text: a.text, npc: a.npc === undefined ? undefined : str(a.npc), ...parseTextByPack(r, file, hw, a.textByPack) },
        placeholder: hs.placeholder === true,
      });
    });
    out.push({
      id: str(s.id),
      name: str(s.name, s.id),
      community: community as any,
      ...(pack !== undefined ? { pack: pack as CultureId } : {}),
      background: str(s.background, 'none'),
      lighting: str(s.lighting),
      description: str(s.description),
      exits: (Array.isArray(s.exits) ? s.exits : [])
        .filter((e: any, j: number) => (e?.to ? true : (r.error(file, `${where} exit #${j + 1}: missing to`), false)))
        .map((e: any) => ({ to: str(e.to), label: str(e.label, e.to) })),
      hotspots,
      slots: (Array.isArray(s.slots) ? s.slots : [])
        .filter((sl: any, j: number) =>
          sl?.id && typeof sl.x === 'number' && typeof sl.y === 'number' ? true : (r.error(file, `${where} slot #${j + 1}: needs id,x,y`), false))
        .map((sl: any) => ({ id: str(sl.id), x: sl.x, y: sl.y, scale: typeof sl.scale === 'number' && sl.scale > 0 ? sl.scale : undefined, seated: sl.seated === true })),
      screens: parseScreens(r, file, where, s.screens),
      props: (Array.isArray(s.props) ? s.props : [])
        .filter((p: any, j: number) => (p?.asset ? true : (r.error(file, `${where} prop #${j + 1}: missing asset`), false)))
        .map((p: any, j: number) => ({ asset: str(p.asset), x: num(p.x, 0), y: num(p.y, 0), w: num(p.w, 0.1), ...parsePropQuad(r, file, `${where} prop #${j + 1}`, p) })),
      ...(s.hidden === true ? { hidden: true } : {}),
      horizon: typeof s.horizon === 'number' && s.horizon > 0 && s.horizon < 1 ? s.horizon : DEFAULT_HORIZON,
      cameraHeight: typeof s.cameraHeight === 'number' && s.cameraHeight > 0 ? s.cameraHeight : DEFAULT_CAMERA_HEIGHT,
      ...(Number.isInteger(s.maxPresent) && s.maxPresent > 0 ? { maxPresent: s.maxPresent } : {}),
      occupied: s.occupied && typeof s.occupied === 'object' && s.occupied.background
        ? { background: str(s.occupied.background), slots: (Array.isArray(s.occupied.slots) ? s.occupied.slots : []).map((x: any) => str(x)) }
        : undefined,
      painted: s.painted && typeof s.painted === 'object' && s.painted.background
        ? { background: str(s.painted.background), npcs: (Array.isArray(s.painted.npcs) ? s.painted.npcs : []).map((x: any) => str(x)) }
        : undefined,
      ...parseByPack(r, file, where, s.byPack),
    });
  });
  const ids = new Set(out.map((s) => s.id));
  for (const s of out) {
    for (const e of s.exits) if (!ids.has(e.to)) r.error(file, `scene ${s.id}: exit to unknown scene "${e.to}"`);
    for (const hs of s.hotspots) if (hs.action.type === 'move' && !ids.has(str(hs.action.to))) r.error(file, `scene ${s.id} hotspot ${hs.id}: move to unknown scene "${hs.action.to}"`);
  }
  if (!ids.has('home')) r.error(file, 'no scene with id "home" (the day starts there)');
  return out;
}

const isQuad = (q: any): boolean => Array.isArray(q) && q.length === 4 && q.every((p: any) => Array.isArray(p) && p.length === 2 && p.every((v: any) => typeof v === 'number' && Number.isFinite(v)));
const toQuad = (q: number[][]) => q.map((p) => [p[0], p[1]] as [number, number]);

/** Prop `quad` / `byBackground` (SPEC "Content schemas": a flat prop projected onto a surface seen in perspective). */
function parsePropQuad(r: Reporter, file: string, where: string, p: any): Pick<Prop, 'quad' | 'byBackground'> {
  const out: Pick<Prop, 'quad' | 'byBackground'> = {};
  if (p.quad != null) {
    if (isQuad(p.quad)) out.quad = toQuad(p.quad);
    else r.error(file, `${where}: quad must be [[x,y],[x,y],[x,y],[x,y]] (top-left, top-right, bottom-right, bottom-left)`);
  }
  if (p.byBackground && typeof p.byBackground === 'object') {
    out.byBackground = {};
    for (const [bg, q] of Object.entries(p.byBackground)) {
      if (isQuad(q)) out.byBackground[bg] = toQuad(q as number[][]);
      else r.error(file, `${where}: byBackground.${bg} is not a quad`);
    }
  }
  return out;
}

/** SPEC "Content schemas" byPack: { cn|mx|in: { background, evening? } } (per-pack background variants). */
function parseByPack(r: Reporter, file: string, where: string, raw: unknown): { byPack?: Scene['byPack'] } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) { r.error(file, `${where}: byPack must map cn | mx | in to { background, evening? }`); return {}; }
  const out: NonNullable<Scene['byPack']> = {};
  for (const [k, v] of Object.entries(raw as Record<string, any>)) {
    if (!(SCENE_PACKS as readonly string[]).includes(k)) { r.error(file, `${where}: byPack key "${k}" is not a pack (cn | mx | in)`); continue; }
    if (!v || typeof v !== 'object' || !v.background) { r.error(file, `${where}: byPack.${k} needs background`); continue; }
    out[k as CultureId] = { background: str(v.background), ...(v.evening ? { evening: str(v.evening) } : {}) };
  }
  return { byPack: out };
}

/** SPEC "Content schemas" textByPack on a look action: per-pack variants of its text. */
function parseTextByPack(r: Reporter, file: string, where: string, raw: unknown): { textByPack?: Partial<Record<CultureId, string>> } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) { r.error(file, `${where}: textByPack must map cn | mx | in to text`); return {}; }
  const out: Partial<Record<CultureId, string>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, any>)) {
    if (!(SCENE_PACKS as readonly string[]).includes(k)) r.error(file, `${where}: textByPack key "${k}" is not a pack (cn | mx | in)`);
    else if (typeof v === 'string' && v) out[k as CultureId] = v;
  }
  return { textByPack: out };
}

function parseScreens(r: Reporter, file: string, where: string, raw: unknown): Screen[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) { r.error(file, `${where}: screens must be a list`); return []; }
  const out: Screen[] = [];
  raw.forEach((sc: any, j: number) => {
    const isQuad = (q: any) => Array.isArray(q) && q.length === 4 && q.every((p: any) => Array.isArray(p) && p.length === 2 && p.every((v: any) => typeof v === 'number' && Number.isFinite(v)));
    const toQuad = (q: number[][]) => q.map((p) => [p[0], p[1]] as [number, number]);
    if (!isQuad(sc?.quad)) return r.error(file, `${where} screen #${j + 1}: needs quad: [[x,y],[x,y],[x,y],[x,y]] (top-left, top-right, bottom-right, bottom-left)`);
    let byBackground: Record<string, [number, number][]> | undefined;
    if (sc.byBackground && typeof sc.byBackground === 'object') {
      byBackground = {};
      for (const [bg, q] of Object.entries(sc.byBackground)) {
        if (isQuad(q)) byBackground[bg] = toQuad(q as number[][]);
        else r.error(file, `${where} screen #${j + 1}: byBackground.${bg} is not a quad`);
      }
    }
    out.push({ id: str(sc.id, `screen${j + 1}`), quad: toQuad(sc.quad), byBackground });
  });
  return out;
}

/** True when a figure asset is a seated one (manifest `seated: true`, or an id with `_fig_sit`). */
export function isSeatedFigure(m: Manifest, id: string | undefined): boolean {
  if (!id) return false;
  const e = assetEntry(m, m.figures, id);
  if (e && typeof e.seated === 'boolean') return e.seated;
  return /_fig_sit/.test(id);
}

function parseNpcs(r: Reporter, file: string, text: string, scenes: Map<string, Scene>): Npc[] {
  let doc: any;
  try {
    doc = loadYaml(text);
  } catch (e) {
    r.error(file, `YAML error: ${(e as Error).message}`);
    return [];
  }
  const list = Array.isArray(doc?.npcs) ? doc.npcs : [];
  if (!list.length) r.error(file, 'no `npcs:` list found');
  const out: Npc[] = [];
  list.forEach((n: any, i: number) => {
    const where = `npc #${i + 1}${n?.id ? ` (${n.id})` : ''}`;
    if (!n?.id) return r.error(file, `${where}: missing id`);
    const init = n.initial ?? {};
    const metRaw = init.met;
    const met = metRaw === true || str(metRaw) === 'yes' || str(metRaw) === 'true' ? 'yes' : 'no';
    const lv = str(init.lastValence, 'none');
    const appearances = (Array.isArray(n.appearances) ? n.appearances : []).filter((a: any, j: number) => {
      const sc = scenes.get(str(a?.scene));
      if (!sc) return r.error(file, `${where} appearance #${j + 1}: unknown scene "${a?.scene}"`), false;
      if (!sc.slots.some((s) => s.id === str(a.slot))) return r.error(file, `${where} appearance #${j + 1}: unknown slot "${a.slot}" in scene ${sc.id}`), false;
      return true;
    }).map((a: any) => ({ scene: str(a.scene), slot: str(a.slot), chance: num(a.chance, 1), figure: str(a.figure) || undefined }));
    const stance = str(n.stance, 'none') || 'none';
    if (!(STANCES as readonly string[]).includes(stance)) r.error(file, `${where}: bad stance "${stance}" (${STANCES.join(' | ')})`);
    // SPEC "Leads": pro|anti marks one of a side's two leaders; `called` is how others name them in a line
    const lead = str(n.lead);
    if (lead && !(LEAD_POS as readonly string[]).includes(lead)) r.error(file, `${where}: bad lead "${lead}" (pro | anti)`);
    const maxRapport = n.maxRapport === undefined ? 3 : num(n.maxRapport, 3);
    if (!(Number.isInteger(maxRapport) && maxRapport >= 0 && maxRapport <= 3)) r.error(file, `${where}: maxRapport must be 0..3`);
    const emotions = Array.isArray(n.emotions) ? n.emotions.map((x: unknown) => str(x)) : undefined;
    if (emotions) for (const e of emotions) if (!EMOTIONS.includes(e as Emotion)) r.error(file, `${where}: emotions: unknown "${e}"`);
    out.push({
      id: str(n.id),
      name: str(n.name, n.id),
      pack: str(n.pack, 'shared'),
      community: str(n.community),
      role: str(n.role),
      stance,
      ...(lead ? { lead: lead as LeadPos } : {}),
      ...(str(n.called) ? { called: str(n.called) } : {}),
      maxRapport: Number.isInteger(maxRapport) ? Math.max(0, Math.min(3, maxRapport)) : 3,
      ...(emotions ? { emotions: emotions.filter((e: string) => EMOTIONS.includes(e as Emotion)) as Emotion[] } : {}),
      portrait: str(n.portrait, `ch_${n.id}`),
      figure: n.figure ? str(n.figure) : undefined,
      seated: n.seated === true,
      appearances,
      // writer-facing only (SPEC "Profiles"): kept as written, never read by the engine; the checker validates it
      ...(n.profile && typeof n.profile === 'object' && !Array.isArray(n.profile) ? { profile: { ...n.profile } } : {}),
      initial: {
        met,
        rapport: Math.max(0, Math.min(3, num(init.rapport, 0))),
        lastValence: (['none', 'positive', 'negative'].includes(lv) ? lv : 'none') as any,
      },
    });
  });
  return out;
}

function parseDialogue(r: Reporter, npcId: string, file: string, text: string, sceneIds?: Set<string>): DialogueRow[] {
  const rows = parseCsv(r, file, text, DIALOGUE_COLUMNS, DIALOGUE_OPTIONAL_COLUMNS);
  const out: DialogueRow[] = [];
  rows.forEach((row, i) => {
    const rowNum = i + 2;
    const where = `row ${rowNum}${row.id ? ` (${row.id})` : ''}`;
    if (!row.id) return r.error(file, `${where}: missing id`);
    const conds = {} as Record<CondField, string>;
    let specificity = 0;
    for (const f of COND_FIELDS) {
      conds[f] = row[f] ?? '';
      if (conds[f] !== '') {
        specificity++;
        const err = validateCond(f, conds[f]);
        if (err) r.error(file, `${where}: ${err}`);
      }
    }
    const sceneCell = row.scene ?? '';
    const scenes = sceneList(sceneCell);
    if (scenes.length) specificity++; // a located row is more specific than the same row anywhere
    // SPEC "Leads": a row for one lead only (pro|anti) is more specific than the same row in any room
    const usLead = row.usLead ?? '', homeLead = row.homeLead ?? '';
    for (const [k, v] of [['usLead', usLead], ['homeLead', homeLead]] as const) {
      if (v === '') continue;
      if (v.includes('|')) r.error(file, `${where}: ${k} "${v}": one of pro|anti (no alternatives in dialogue)`);
      else { const e = validateLead(v); if (e) r.error(file, `${where}: ${k}: ${e}`); }
      specificity++;
    }
    if (sceneIds) for (const sc of scenes) if (!sceneIds.has(sc)) r.error(file, `${where}: scene "${sc}" is not a scene id in scenes.yaml`);
    const emotion = (row.emotion || 'neutral') as Emotion;
    if (!EMOTIONS.includes(emotion)) r.error(file, `${where}: unknown emotion "${row.emotion}"`);
    if (row.priority && !Number.isFinite(Number(row.priority))) r.error(file, `${where}: priority "${row.priority}" is not a number`);
    const choices = [1, 2, 3]
      .map((k) => ({ text: row[`choice${k}`] ?? '', effect: row[`effect${k}`] ?? '', next: row[`next${k}`] ?? '' }))
      .filter((c, k) => {
        if (!c.text && (c.effect || c.next)) r.error(file, `${where}: effect${k + 1}/next${k + 1} set without choice${k + 1}`);
        return c.text !== '';
      });
    for (const c of choices) for (const e of validateEffects(c.effect)) r.error(file, `${where}: ${e}`);
    out.push({
      id: row.id, npc: npcId, conds, scene: scenes.join('|'), scenes, usLead, homeLead, specificity, rowNum,
      priority: num(row.priority, 0),
      emotion: EMOTIONS.includes(emotion) ? emotion : 'neutral',
      line: row.line ?? '',
      choices,
    });
  });
  const ids = new Set<string>();
  for (const row of out) {
    if (ids.has(row.id)) r.error(file, `row ${row.rowNum}: duplicate id "${row.id}"`);
    ids.add(row.id);
  }
  for (const row of out) for (const c of row.choices) if (c.next && !ids.has(c.next)) r.error(file, `row ${row.rowNum} (${row.id}): next "${c.next}" not found in sheet`);
  if (!out.some((x) => x.specificity === 0)) r.error(file, 'no fallback row (all six condition cells, scene and the lead cells blank)');
  return out;
}

function parseEvents(r: Reporter, file: string, text: string, scenes: Map<string, Scene>, npcs: Map<string, Npc>): EventRow[] {
  const rows = parseCsv(r, file, text, EVENT_COLUMNS, EVENT_OPTIONAL_COLUMNS);
  const out: EventRow[] = [];
  rows.forEach((row, i) => {
    const rowNum = i + 2;
    const where = `row ${rowNum}${row.id ? ` (${row.id})` : ''}`;
    if (!row.id) return r.error(file, `${where}: missing id`);
    if (!['day_start', 'enter', 'invite'].includes(row.trigger)) r.error(file, `${where}: bad trigger "${row.trigger}"`);
    if (row.scene && !scenes.has(row.scene)) r.error(file, `${where}: unknown scene "${row.scene}"`);
    if (row.npc && !npcs.has(row.npc)) r.error(file, `${where}: unknown npc "${row.npc}"`);
    for (const f of ['playerLean', 'nationalLeader'] as const) {
      for (const alt of (row[f] ?? '').split('|').map((x) => x.trim()).filter(Boolean)) {
        const e = validateCond(f, alt);
        if (e) r.error(file, `${where}: ${e}`);
      }
    }
    const emotion = (row.emotion || 'neutral') as Emotion;
    if (!EMOTIONS.includes(emotion)) r.error(file, `${where}: unknown emotion "${row.emotion}"`);
    // SPEC "Leads": optional day and lead cells
    const day = row.day ?? '', usLead = row.usLead ?? '', homeLead = row.homeLead ?? '';
    for (const e of [validateDay(day), validateLead(usLead), validateLead(homeLead)]) if (e) r.error(file, `${where}: ${e}`);
    const choices = [1, 2].map((k) => ({ text: row[`choice${k}`] ?? '', effect: row[`effect${k}`] ?? '' })).filter((c) => c.text);
    for (const c of choices) for (const e of validateEffects(c.effect)) r.error(file, `${where}: ${e}`);
    out.push({
      id: row.id, source: row.source, target: row.target, valence: row.valence, proximity: row.proximity,
      trigger: row.trigger as any, scene: row.scene, npc: row.npc,
      minRapport: row.minRapport === '' ? null : num(row.minRapport, 0),
      playerLean: row.playerLean, nationalLeader: row.nationalLeader,
      chance: num(row.chance, 1), cost: num(row.cost, 0),
      emotion: EMOTIONS.includes(emotion) ? emotion : 'neutral',
      text: row.text, choices, rowNum, portrait: row.portrait ?? '', medium: (row.medium ?? '').trim(), pack: rowPack(r, file, where, row.pack),
      day, usLead, homeLead,
    });
  });
  const ids = new Set(out.map((e) => e.id));
  for (const ev of out) for (const c of ev.choices) {
    const m = /invite\s+(\S+)/.exec(c.effect);
    if (m && !ids.has(m[1])) r.error(file, `row ${ev.rowNum} (${ev.id}): invite of unknown event "${m[1]}"`);
  }
  return out;
}

function parseNews(r: Reporter, file: string, text: string): NewsRow[] {
  return parseCsv(r, file, text, NEWS_COLUMNS, NEWS_OPTIONAL_COLUMNS).flatMap((row, i) => {
    const where = `row ${i + 2}${row.id ? ` (${row.id})` : ''}`;
    if (!row.id) return r.error(file, `${where}: missing id`), [];
    if (!['tv', 'print'].includes(row.channel)) r.error(file, `${where}: channel must be tv|print`);
    return [{
      id: row.id, channel: (row.channel === 'print' ? 'print' : 'tv') as NewsRow['channel'],
      nationalLeader: row.nationalLeader, dayMin: num(row.dayMin, 1), valence: row.valence,
      headline: row.headline, body: row.body, figure: row.figure ?? '', pack: rowPack(r, file, where, row.pack),
    }];
  });
}

/** Schema checks for questionnaire JSON (bundled eod.json, a researcher paste, a server or URL response). Returns problems; empty = valid. */
export function questionnaireProblems(q: unknown): string[] {
  if (!q || typeof q !== 'object' || Array.isArray(q)) return ['must be a JSON object'];
  const pages = (q as any).pages;
  if (!Array.isArray(pages)) return ['missing pages[]'];
  const out: string[] = [];
  pages.forEach((p: any, i: number) =>
    (p?.items ?? []).forEach((it: any, j: number) => {
      if (!it?.id || !['likert', 'choice', 'text'].includes(it?.type)) out.push(`page ${i + 1} item ${j + 1}: needs id and type likert|choice|text`);
    }));
  return out;
}

const FALLBACK_EOD: Questionnaire = {
  id: 'eod-missing',
  title: 'Evening check-in',
  intro: '(questionnaire/eod.json is missing; placeholder shown)',
  pages: [{ items: [{ id: 'mood', type: 'choice', text: 'How was today?', options: ['Good', 'Okay', 'Hard'] }] }],
};

/** Looks an asset id up in a manifest table, honouring `aliases` and a `ch_` prefix difference. */
export function assetEntry<T>(m: Manifest, table: Record<string, T> | undefined, id: string | undefined): T | undefined {
  if (!table || !id) return undefined;
  if (table[id]) return table[id];
  const alias = m.aliases?.[id];
  if (alias && table[alias]) return table[alias];
  const bare = id.replace(/^ch_/, '');
  if (table[bare]) return table[bare];
  if (table['ch_' + id]) return table['ch_' + id];
  return undefined;
}

function emptyManifest(): Manifest {
  return { backgrounds: {}, portraits: {}, figures: {}, props: {}, tv: {}, candidates: {} };
}

// ------------------------------------------------------------------ researcher overrides (SPEC "Researcher editing, overrides and casting")
/** Shape of localStorage['gv:override:v1']; every key optional, a present key replaces that whole file. */
export interface OverrideText {
  v: 1;
  updated?: string;
  dialogue?: Record<string, string>;
  news?: string;
  events?: string;
  npcs?: string;
  scenes?: string;
}

function readOverrideText(): OverrideText | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(OVERRIDE_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not a JSON object');
    if (o.v !== 1) throw new Error(`unsupported version ${JSON.stringify(o.v)} (expected 1)`);
    return o as OverrideText;
  } catch (e) {
    console.warn(`[override] ${OVERRIDE_KEY} ignored: ${(e as Error).message}`);
    return null;
  }
}

// ------------------------------------------------------------------ dev: editing a line in place (SPEC "Dev: editing a line in place")
/** The override JSON to write into: the stored one (if valid), else a fresh empty set. */
export function overrideForWrite(): OverrideText {
  return readOverrideText() ?? { v: 1 };
}

/** Stores the override set with `updated` = now. Returns false when localStorage refuses (full, blocked). */
export function storeOverride(o: OverrideText): boolean {
  o.updated = new Date().toISOString();
  try { localStorage.setItem(OVERRIDE_KEY, JSON.stringify(o)); return true; } catch { return false; }
}

/** CSV text in the editor's canonical form (Papa.unparse, quoting only where needed, \n newlines, trailing newline). */
function unparseCsv(data: string[][]): string {
  return Papa.unparse(data, { newline: '\n' }) + '\n';
}

/** A dialogue sheet regenerated from parsed rows (fallback when the bundled text cannot be read); `scene` written when used. */
export function dialogueCsvFromRows(rows: DialogueRow[]): string {
  const cols = [...DIALOGUE_COLUMNS];
  if (rows.some((r) => r.scene)) cols.splice(cols.indexOf('dayPhase') + 1, 0, 'scene');
  const data = rows.map((r) => {
    const cell: Record<string, string> = {
      ...r.conds, id: r.id, scene: r.scene, priority: String(r.priority), emotion: r.emotion, line: r.line,
    };
    r.choices.forEach((c, i) => { cell[`choice${i + 1}`] = c.text; cell[`effect${i + 1}`] = c.effect; cell[`next${i + 1}`] = c.next; });
    return cols.map((c) => cell[c] ?? '');
  });
  return unparseCsv([cols, ...data]);
}

/**
 * Rewrites one row of a dialogue sheet: its `line` cell and the texts of its existing (non-blank) choices, in order.
 * Every other cell, row and the header are kept. Returns the new CSV text, or an error message.
 */
export function patchDialogueRow(text: string, rowId: string, line: string, choiceTexts: string[]): { text: string } | { error: string } {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const data = (Papa.parse<string[]>(text, { header: false, skipEmptyLines: 'greedy' }).data as string[][]).map((r) => r.map((x) => String(x ?? '')));
  const header = (data[0] ?? []).map((x) => x.trim());
  const col = (name: string) => header.indexOf(name);
  if (col('id') < 0 || col('line') < 0) return { error: 'sheet has no id/line column' };
  const rec = data.slice(1).find((r) => (r[col('id')] ?? '').trim() === rowId);
  if (!rec) return { error: `row "${rowId}" not found in the sheet` };
  while (rec.length < header.length) rec.push('');
  rec[col('line')] = line;
  const slots = [1, 2, 3].map((k) => col(`choice${k}`)).filter((i) => i >= 0 && (rec[i] ?? '').trim() !== '');
  if (slots.length !== choiceTexts.length) return { error: 'choice count changed under the editor; reload and try again' };
  slots.forEach((i, n) => { rec[i] = choiceTexts[n]; });
  return { text: unparseCsv(data) };
}

/** Parses a dialogue sheet quietly (no console noise); the rows, or the problems found. */
export function parseDialogueQuiet(npcId: string, text: string, sceneIds: Set<string>): { rows: DialogueRow[] } | { errors: string[] } {
  const q = new Reporter(true);
  const rows = parseDialogue(q, npcId, `content/dialogue/${npcId}.csv`, text, sceneIds);
  return q.errors.length ? { errors: q.errors } : { rows };
}

/**
 * Reads every image override from IndexedDB gv/images and makes an object URL for each. Never creates the
 * database: if it does not exist yet the upgrade is aborted, so the editor's own first open still creates its store.
 */
export function loadImageOverrides(timeoutMs = 2000): Promise<Map<string, { url: string; w?: number; h?: number }>> {
  const out = new Map<string, { url: string; w?: number; h?: number }>();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(out); } };
    const timer = setTimeout(() => { console.warn('[override] image store did not answer in time; images not overridden'); finish(); }, timeoutMs);
    const end = () => { clearTimeout(timer); finish(); };
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(OVERRIDE_DB); } catch { return end(); }
    req.onupgradeneeded = (e) => {
      if ((e as IDBVersionChangeEvent).oldVersion === 0) req.transaction?.abort(); // no database yet: leave it to the editor
    };
    req.onerror = (e) => { e.preventDefault(); end(); };
    req.onblocked = () => end();
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OVERRIDE_STORE)) { db.close(); return end(); }
      try {
        const st = db.transaction(OVERRIDE_STORE, 'readonly').objectStore(OVERRIDE_STORE);
        const cur = st.openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) { db.close(); return end(); }
          const v = c.value as { blob?: Blob; w?: number; h?: number } | Blob | undefined;
          const blob = v instanceof Blob ? v : v?.blob;
          if (typeof c.key === 'string' && blob instanceof Blob) {
            out.set(c.key, { url: URL.createObjectURL(blob), w: v instanceof Blob ? undefined : v?.w, h: v instanceof Blob ? undefined : v?.h });
          }
          c.continue();
        };
        cur.onerror = (e) => { e.preventDefault(); db.close(); end(); };
      } catch { db.close(); end(); }
    };
  });
}

/** Image override lookup by SPEC key, e.g. "portraits/us_neighbor/warm", "figures/ch_us_neighbor_fig_stand", "tv/nat_inclusive/0". */
export function overrideImage(c: Pick<Content, 'imageOverrides'>, key: string): { url: string; w?: number; h?: number } | undefined {
  return c.imageOverrides.get(key);
}

/** Override keys for an asset id under a section, tolerating the `ch_` prefix difference the manifest also tolerates. */
export function overrideIds(id: string): string[] {
  const bare = id.replace(/^ch_/, '');
  return [...new Set([id, bare, 'ch_' + bare])];
}

function parseCast(r: Reporter, file: string, text: string): CastInfo[] {
  let doc: any;
  try { doc = loadYaml(text); } catch (e) { r.error(file, `YAML error: ${(e as Error).message}`); return []; }
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.cast) ? doc.cast : [];
  return list.flatMap((x: any, i: number) => {
    if (!x?.id) return r.error(file, `entry #${i + 1}: missing id`), [];
    return [{ id: str(x.id), name: str(x.name, x.id), role: str(x.role) }];
  });
}

export interface LoadOptions {
  /** apply the researcher override (default true for the live source; false with &nooverride=1) */
  override?: boolean;
}

export async function loadContent(src: Source, opts: LoadOptions = {}): Promise<Content> {
  const r = new Reporter();
  const need = async (path: string) => {
    const t = await src.text(path);
    if (t === null) r.error(path, 'file missing or unreadable');
    return t;
  };

  const useOverride = (opts.override ?? true) && src.kind === 'live';
  const ov = useOverride ? readOverrideText() : null;
  const info: OverrideInfo = { applied: [], rejected: [], images: [], updated: ov?.updated, ignored: opts.override === false || undefined };
  if (opts.override === false) {
    try { if (localStorage.getItem(OVERRIDE_KEY)) console.info('[override] present but ignored (&nooverride=1)'); } catch { /* ignore */ }
  }
  /** Parses an override text with the bundled file's parser and validation; null (bundled file used) on any problem. */
  const tryOverride = <T,>(key: string, file: string, text: unknown, parse: (q: Reporter, file: string, text: string) => T): T | null => {
    if (text === undefined || text === null) return null;
    const q = new Reporter(true);
    let v: T | null = null;
    if (typeof text !== 'string') q.error(file, 'override value is not a string');
    else {
      try { v = parse(q, file, text); } catch (e) { q.error(file, `parse failed: ${(e as Error).message}`); }
    }
    if (q.errors.length) {
      console.warn(`[override] ${key} rejected, bundled ${file} used instead:\n  ${q.errors.join('\n  ')}`);
      info.rejected.push({ key, problems: q.errors });
      return null;
    }
    info.applied.push(key);
    return v;
  };

  const [scenesText, npcsText, eventsText, newsText, eodText, manifestText, stringsText, castText, images, profileText] = await Promise.all([
    ov?.scenes !== undefined ? src.text('content/scenes.yaml') : need('content/scenes.yaml'),
    ov?.npcs !== undefined ? src.text('content/npcs.yaml') : need('content/npcs.yaml'),
    ov?.events !== undefined ? src.text('content/events.csv') : need('content/events.csv'),
    ov?.news !== undefined ? src.text('content/news.csv') : need('content/news.csv'),
    need('content/questionnaire/eod.json'),
    need('assets/manifest.json'),
    src.text('content/strings.en.json'),
    src.text('content/cast.yaml'),
    useOverride ? loadImageOverrides() : Promise.resolve(new Map<string, { url: string; w?: number; h?: number }>()),
    src.text('content/profile.yaml'),
  ]);
  const profile = parseProfile(r, 'content/profile.yaml', profileText);
  const townhallText = await src.text('content/townhall.yaml');

  const SCENES = 'content/scenes.yaml', NPCS = 'content/npcs.yaml', EVENTS = 'content/events.csv', NEWS = 'content/news.csv';
  const scenes = tryOverride('scenes', SCENES, ov?.scenes, parseScenes)
    ?? (scenesText ? parseScenes(r, SCENES, scenesText) : (ov?.scenes !== undefined && r.error(SCENES, 'file missing or unreadable'), []));
  const sceneById = new Map(scenes.map((s) => [s.id, s]));
  const npcs = tryOverride('npcs', NPCS, ov?.npcs, (q, f, t) => parseNpcs(q, f, t, sceneById))
    ?? (npcsText ? parseNpcs(r, NPCS, npcsText, sceneById) : (ov?.npcs !== undefined && r.error(NPCS, 'file missing or unreadable'), []));
  const npcById = new Map(npcs.map((n) => [n.id, n]));

  const ovDialogue = ov?.dialogue && typeof ov.dialogue === 'object' ? ov.dialogue : {};
  for (const id of Object.keys(ovDialogue)) {
    if (!npcById.has(id)) {
      console.warn(`[override] dialogue/${id} rejected: no NPC "${id}" in npcs.yaml`);
      info.rejected.push({ key: `dialogue/${id}`, problems: [`no NPC "${id}" in npcs.yaml`] });
    }
  }
  const dialogue = new Map<string, DialogueRow[]>();
  const sceneIds = new Set(scenes.map((s) => s.id));
  await Promise.all(
    npcs.map(async (n) => {
      const file = `content/dialogue/${n.id}.csv`;
      const fromOv = tryOverride(`dialogue/${n.id}`, file, ovDialogue[n.id], (q, f, t) => parseDialogue(q, n.id, f, t, sceneIds));
      if (fromOv) { dialogue.set(n.id, fromOv); return; }
      const t = await src.text(file);
      if (t === null) {
        // TV-only NPCs may legitimately have no sheet; warn instead of erroring.
        if (n.figure) r.error(file, 'file missing or unreadable');
        else r.warn(file, 'no dialogue sheet (TV-only NPC)');
        dialogue.set(n.id, []);
        return;
      }
      dialogue.set(n.id, parseDialogue(r, n.id, file, t, sceneIds));
    }),
  );

  // SPEC "Town hall": one speech/reaction sheet per lead
  const thRows = new Map<string, TownhallRow[]>();
  await Promise.all(npcs.filter((n) => n.lead).map(async (n) => {
    const file = `content/townhall/${n.id}.csv`;
    const t = await src.text(file);
    if (t === null) { r.warn(file, 'no town hall sheet for this lead (the moderator reads a stand-in)'); thRows.set(n.id, []); return; }
    thRows.set(n.id, parseTownhallRows(r, n.id, file, t));
  }));
  const townhall = parseTownhall(r, 'content/townhall.yaml', townhallText, thRows);

  const events = tryOverride('events', EVENTS, ov?.events, (q, f, t) => parseEvents(q, f, t, sceneById, npcById))
    ?? (eventsText ? parseEvents(r, EVENTS, eventsText, sceneById, npcById) : (ov?.events !== undefined && r.error(EVENTS, 'file missing or unreadable'), []));
  const news = tryOverride('news', NEWS, ov?.news, parseNews)
    ?? (newsText ? parseNews(r, NEWS, newsText) : (ov?.news !== undefined && r.error(NEWS, 'file missing or unreadable'), []));

  let eod = FALLBACK_EOD;
  if (eodText) {
    try {
      const q = JSON.parse(eodText);
      if (!Array.isArray(q?.pages)) throw new Error('missing pages[]');
      for (const p of questionnaireProblems(q)) r.error('content/questionnaire/eod.json', p);
      eod = q;
    } catch (e) {
      r.error('content/questionnaire/eod.json', `JSON error: ${(e as Error).message}`);
    }
  }

  let manifest = emptyManifest();
  if (manifestText) {
    try {
      manifest = { ...emptyManifest(), ...JSON.parse(manifestText) };
    } catch (e) {
      r.error('assets/manifest.json', `JSON error: ${(e as Error).message}`);
    }
  }
  info.images = [...images.keys()].sort();
  const hasImg = (section: string, id: string, variant?: string) =>
    overrideIds(id).some((x) => images.has(variant === undefined ? `${section}/${x}` : `${section}/${x}/${variant}`));
  for (const s of scenes) {
    if (s.background !== 'none' && !assetEntry(manifest, manifest.backgrounds, s.background) && !hasImg('backgrounds', s.background)) r.warn('assets/manifest.json', `no background "${s.background}" for scene ${s.id} (flat panel shown)`);
    for (const p of s.props) if (!assetEntry(manifest, manifest.props, p.asset)) r.warn('assets/manifest.json', `no prop "${p.asset}" for scene ${s.id}`);
  }
  for (const n of npcs) {
    if (!assetEntry(manifest, manifest.portraits, n.portrait) && !images.has(`portraits/${n.id}/neutral`)) r.warn('assets/manifest.json', `no portrait "${n.portrait}" for ${n.id} (silhouette shown)`);
    if (n.figure && !assetEntry(manifest, manifest.figures, n.figure) && !hasImg('figures', n.figure)) r.warn('assets/manifest.json', `no figure "${n.figure}" for ${n.id} (silhouette shown)`);
  }

  // a located dialogue row only matters where its NPC can be met (appearances, painted, talk zones, events naming them)
  for (const n of npcs) {
    const where = npcScenes(n, scenes, events);
    for (const row of dialogue.get(n.id) ?? []) {
      for (const sc of row.scenes) if (sceneIds.has(sc) && !where.has(sc)) r.warn(`content/dialogue/${n.id}.csv`, `row ${row.rowNum} (${row.id}): scene "${sc}" is not a scene ${n.id} appears in (${[...where].join(', ') || 'none'})`);
    }
    for (const a of n.appearances) {
      if (a.figure && !assetEntry(manifest, manifest.figures, a.figure) && !hasImg('figures', a.figure)) r.warn('assets/manifest.json', `no figure "${a.figure}" for ${n.id} in ${a.scene} (their default figure is shown until it exists)`);
    }
  }

  // cast: names from content/cast.yaml (content owns them), else from the manifest's copy
  const cast = new Map<string, CastInfo>();
  for (const [id, m] of Object.entries(manifest.cast ?? {})) cast.set(id, { id, name: m.name || id, role: m.role || '' });
  if (castText) for (const ci of parseCast(r, 'content/cast.yaml', castText)) cast.set(ci.id, ci);
  for (const nw of news) if (nw.figure && !cast.has(nw.figure)) r.warn(NEWS, `story ${nw.id}: figure "${nw.figure}" is not in cast.yaml or the manifest (PLACEHOLDER shown)`);
  for (const ev of events) if (ev.portrait && !cast.has(ev.portrait)) r.warn(EVENTS, `event ${ev.id}: portrait "${ev.portrait}" is not in cast.yaml or the manifest (PLACEHOLDER shown)`);

  let strings = { ...DEFAULT_STRINGS };
  if (stringsText) {
    try {
      strings = { ...strings, ...JSON.parse(stringsText) };
    } catch (e) {
      r.error('content/strings.en.json', `JSON error: ${(e as Error).message}`);
    }
  }

  if (r.errors.length) console.error(`[content] ${r.errors.length} content error(s) from ${src.kind} source; see above.`);
  else console.info(`[content] loaded ${scenes.length} scenes, ${npcs.length} npcs, ${events.length} events, ${news.length} news from ${src.kind} source`);
  if (info.applied.length || info.images.length || info.rejected.length) {
    console.info(`[override] applied: ${info.applied.join(', ') || 'none'}; images: ${info.images.length}; rejected: ${info.rejected.map((x) => x.key).join(', ') || 'none'}`);
  }

  return {
    source: src.kind, scenes, sceneById, npcs, npcById, dialogue, events, news, eod, manifest, strings, profile, townhall,
    assetUrl: src.assetUrl, errors: r.errors, cast, override: info, imageOverrides: images,
  };
}

/** The built-in profile: the heritage question alone (content/profile.yaml absent or broken, fixtures). */
export const DEFAULT_PROFILE: Profile = {
  heritage: {
    id: 'heritage',
    question: 'What is the heritage culture that you most identify with before arriving in the US? If you were born in the US, what is the heritage culture that your parents most identify with?',
    options: [{ id: 'cn', label: 'Chinese' }, { id: 'mx', label: 'Mexican' }, { id: 'in', label: 'Indian' }, { id: 'other', label: 'Another culture' }],
  },
  followups: {},
};

/** SPEC "Profile questions and variant words": content/profile.yaml. Problems are reported and the built-in profile used. */
export function parseProfile(r: Reporter, file: string, text: string | null): Profile {
  if (!text) return DEFAULT_PROFILE;
  let doc: any;
  try { doc = loadYaml(text); } catch (e) { r.error(file, `YAML error: ${(e as Error).message}`); return DEFAULT_PROFILE; }
  const q = (raw: any, where: string, fixedId?: string): ProfileQuestion | null => {
    if (!raw || typeof raw !== 'object' || typeof raw.question !== 'string' || !raw.question.trim()) { r.error(file, `${where}: needs a question`); return null; }
    const id = fixedId ?? str(raw.id);
    if (!/^\w+$/.test(id)) { r.error(file, `${where}: id "${id}" must be a word`); return null; }
    const options: ProfileOption[] = [];
    for (const [i, o] of (Array.isArray(raw.options) ? raw.options : []).entries()) {
      if (!o || typeof o !== 'object' || !/^\w+$/.test(str(o.id)) || typeof o.label !== 'string' || !o.label.trim()) { r.error(file, `${where}.options[${i}]: needs id (a word) and label`); continue; }
      options.push({ id: str(o.id), label: o.label.trim(), ...(o.skip ? { skip: true } : {}) });
    }
    if (!options.some((o) => !o.skip)) { r.error(file, `${where}: needs at least one option that is not skip`); return null; }
    return { id, question: raw.question.trim(), options };
  };
  const heritage = q(doc?.heritage, 'heritage', 'heritage') ?? DEFAULT_PROFILE.heritage;
  for (const o of heritage.options) if (!['cn', 'mx', 'in', 'other'].includes(o.id)) r.error(file, `heritage option "${o.id}": expected cn | mx | in | other`);
  const followups: Profile['followups'] = {};
  for (const [pack, list] of Object.entries(doc?.followups ?? {})) {
    if (!(SCENE_PACKS as readonly string[]).includes(pack)) { r.error(file, `followups.${pack}: expected ${SCENE_PACKS.join(' | ')}`); continue; }
    const qs = (Array.isArray(list) ? list : []).map((x: any, i: number) => q(x, `followups.${pack}[${i}]`)).filter((x): x is ProfileQuestion => !!x);
    const ids = new Set<string>();
    for (const fq of qs) { if (ids.has(fq.id) || fq.id === 'heritage') r.error(file, `followups.${pack}: duplicate question id "${fq.id}"`); ids.add(fq.id); }
    followups[pack as CultureId] = qs;
  }
  return { heritage, followups };
}

/**
 * SPEC "Profile questions and variant words": the {placeholders} of a player. `pack.<pack>.<name>` is the base word;
 * `pack.<pack>|<dim>=<value>[|<dim>=<value>].<name>` applies when every listed dimension matches the player's
 * variant answers, the most specific key winning (ties: the last key in file order).
 */
export function packVars(strings: Record<string, string>, pack: string, variant: Record<string, string> = {}): Record<string, string> {
  const best = new Map<string, { n: number; v: string }>();
  for (const [k, v] of Object.entries(strings)) {
    const m = /^pack\.([a-z]+)((?:\|\w+=\w+)*)\.(\w+)$/.exec(k);
    if (!m || m[1] !== pack) continue;
    const cons = m[2] ? m[2].slice(1).split('|').map((c) => c.split('=')) : [];
    if (!cons.every(([d, val]) => variant[d] === val)) continue;
    const cur = best.get(m[3]);
    if (!cur || cons.length >= cur.n) best.set(m[3], { n: cons.length, v });
  }
  return Object.fromEntries([...best].map(([k, { v }]) => [k, v]));
}

/** Scenes an NPC can be met in: appearances, painted variants and talk zones naming them, and events with that npc and a scene. */
export function npcScenes(n: Npc, scenes: Scene[], events: EventRow[]): Set<string> {
  const out = new Set(n.appearances.map((a) => a.scene));
  for (const s of scenes) {
    if (s.painted?.npcs.includes(n.id)) out.add(s.id);
    if (s.hotspots.some((hs) => hs.action.type === 'talk' && hs.action.npc === n.id)) out.add(s.id);
  }
  for (const e of events) if (e.npc === n.id && e.scene) out.add(e.scene);
  return out;
}

export async function getSource(fixtures: boolean): Promise<Source> {
  if (fixtures) {
    const m = await import('./fixtures');
    return m.fixtureSource();
  }
  return liveSource();
}

/**
 * SPEC "Packs": the player's effective culture pack. Their homeCulture when the content has at least one NPC in that
 * pack and at least one scene carrying it; otherwise `cn` (the standing-in roster, with the banner).
 */
export function effectivePack(c: Pick<Content, 'npcs' | 'scenes'>, homeCulture: string | undefined): CultureId {
  const want = (SCENE_PACKS as readonly string[]).includes(String(homeCulture)) ? (homeCulture as CultureId) : 'cn';
  if (want === 'cn') return 'cn';
  return c.npcs.some((n) => n.pack === want) && c.scenes.some((s) => s.pack === want) ? want : 'cn';
}

/** SPEC "Packs": a scene is open to a player when it is shared (no pack) or carries their effective pack. */
/** SPEC "Packs": an events.csv / news.csv `pack` cell: blank = every pack, else cn | mx | in (anything else is reported and ignored). */
function rowPack(r: Reporter, file: string, where: string, raw: string | undefined): CultureId | '' {
  const p = (raw ?? '').trim();
  if (!p) return '';
  if ((SCENE_PACKS as readonly string[]).includes(p)) return p as CultureId;
  r.error(file, `${where}: bad pack "${p}" (cn | mx | in, or blank for every pack)`);
  return '';
}

/** SPEC "Packs": the variant group of an events.csv / news.csv id, the id without a trailing _cn | _mx | _in. */
export function packGroup(id: string): string {
  return id.replace(/_(cn|mx|in)$/, '');
}

/**
 * SPEC "Packs": whether an event or news row is shown to a player of `pack`. A row with a pack only to that pack; a
 * blank-pack row to everyone, except where its id group (packGroup) has a variant for that pack, which replaces it.
 */
export function rowInPack(row: { id: string; pack?: string }, rows: readonly { id: string; pack?: string }[], pack: string): boolean {
  if (row.pack) return row.pack === pack;
  const g = packGroup(row.id);
  return !rows.some((o) => o !== row && o.pack === pack && packGroup(o.id) === g);
}

export function sceneInPack(sc: Pick<Scene, 'pack'> | undefined, pack: string): boolean {
  return !!sc && (!sc.pack || sc.pack === pack);
}

// ---------------------------------------------------------------- SPEC "Leads" and "Town hall" (added 2026-10-19)

/** The NPC who leads a side in this room: `side` us (shared roster) or home (the player's pack); `pos` from the room config. */
export function leadNpc(c: Pick<Content, 'npcs'>, pack: CultureId, side: 'us' | 'home', pos: LeadPos): Npc | undefined {
  return c.npcs.find((n) => n.lead === pos && (side === 'us' ? n.pack === 'shared' : n.pack === pack));
}

/** The built-in moderator and topics (content/townhall.yaml absent or broken, fixtures): enough to run the sequence. */
export const DEFAULT_TOWNHALL: Townhall = {
  moderator: {
    name: 'Moderator',
    open: 'Thank you all for coming. Two members of the community have asked to speak, and then we will hear from the floor.',
    introduce: 'First, {speaker}.',
    rate: 'How did that land with you?',
    callUp: 'We have time for the floor. {playerName}, you had your hand up. Pick a question and tell us where you stand.',
    close: 'That is all we have time for. Thank you, and get home safe.',
  },
  topics: [{
    id: 'belonging', title: 'Who counts as local', prompt: 'Who should get a say in how this town is run?',
    options: [
      { text: 'Anyone who lives here, in whatever language they bring.', stance: 'integration' },
      { text: 'Anyone who lives here and takes the trouble to fit in.', stance: 'assimilation' },
      { text: 'Each community should look after its own.', stance: 'separation' },
      { text: 'I would rather listen than decide tonight.', stance: 'neutral' },
    ],
  }],
  rows: new Map(),
};

function parseTownhallRows(r: Reporter, npcId: string, file: string, text: string): TownhallRow[] {
  const rows = parseCsv(r, file, text, TOWNHALL_COLUMNS);
  const out: TownhallRow[] = [];
  const ids = new Set<string>();
  rows.forEach((row, i) => {
    const rowNum = i + 2;
    const where = `row ${rowNum}${row.id ? ` (${row.id})` : ''}`;
    if (!row.id) return r.error(file, `${where}: missing id`);
    if (ids.has(row.id)) r.error(file, `${where}: duplicate id`);
    ids.add(row.id);
    const kind = row.kind === 'reaction' ? 'reaction' : row.kind === 'speech' ? 'speech' : null;
    if (!kind) return r.error(file, `${where}: kind must be speech|reaction`);
    const e = validateCond('nationalLeader', row.nationalLeader ?? '');
    if (e) r.error(file, `${where}: ${e}`);
    const block = kind === 'speech' ? num(row.block, 0) : 0;
    if (kind === 'speech' && !(Number.isInteger(block) && block >= 1 && block <= 4)) r.error(file, `${where}: a speech needs block 1..4`);
    const stance = row.stance ?? '';
    if (kind === 'reaction' && stance && !(TOPIC_STANCES as readonly string[]).includes(stance)) r.error(file, `${where}: stance \"${stance}\" (integration|assimilation|separation|neutral or blank)`);
    if (kind === 'speech' && stance) r.error(file, `${where}: a speech has no stance`);
    const emotion = (row.emotion || 'neutral') as Emotion;
    if (!EMOTIONS.includes(emotion)) r.error(file, `${where}: unknown emotion \"${row.emotion}\"`);
    if (!row.text) r.error(file, `${where}: missing text`);
    out.push({ id: row.id, speaker: npcId, kind, nationalLeader: row.nationalLeader ?? '', block, stance, emotion: EMOTIONS.includes(emotion) ? emotion : 'neutral', text: row.text ?? '', rowNum });
  });
  for (const leader of ['enforcement', 'inclusive']) {
    const blocks = out.filter((x) => x.kind === 'speech' && (!x.nationalLeader || x.nationalLeader === leader));
    if (!blocks.some((b) => b.block === 1)) r.error(file, `no speech block 1 under nationalLeader ${leader}`);
  }
  if (!out.some((x) => x.kind === 'reaction' && !x.stance)) r.error(file, 'no fallback reaction (kind reaction, stance blank)');
  return out;
}

/** content/townhall.yaml: moderator text and the topic board. Problems are reported and the built-in text used. */
export function parseTownhall(r: Reporter, file: string, text: string | null, rows: Map<string, TownhallRow[]>): Townhall {
  if (!text) return { ...DEFAULT_TOWNHALL, rows };
  let doc: any;
  try { doc = loadYaml(text); } catch (e) { r.error(file, `YAML error: ${(e as Error).message}`); return { ...DEFAULT_TOWNHALL, rows }; }
  const md = doc?.moderator ?? {};
  const moderator: Moderator = { ...DEFAULT_TOWNHALL.moderator };
  for (const k of ['name', 'open', 'introduce', 'rate', 'callUp', 'close'] as const) {
    if (typeof md[k] === 'string' && md[k].trim()) moderator[k] = md[k].trim();
    else r.error(file, `moderator.${k}: missing text (built-in used)`);
  }
  const topics: Topic[] = [];
  const seen = new Set<string>();
  for (const [i, t] of (Array.isArray(doc?.topics) ? doc.topics : []).entries()) {
    const where = `topics[${i}]`;
    if (!t || typeof t !== 'object' || !/^\w+$/.test(str(t.id)) || typeof t.title !== 'string' || typeof t.prompt !== 'string') { r.error(file, `${where}: needs id (a word), title and prompt`); continue; }
    if (seen.has(str(t.id))) r.error(file, `${where}: duplicate id \"${t.id}\"`);
    seen.add(str(t.id));
    const options: TopicOption[] = [];
    for (const [j, o] of (Array.isArray(t.options) ? t.options : []).entries()) {
      if (!o || typeof o !== 'object' || typeof o.text !== 'string' || !o.text.trim() || !(TOPIC_STANCES as readonly string[]).includes(str(o.stance))) { r.error(file, `${where}.options[${j}]: needs text and stance integration|assimilation|separation|neutral`); continue; }
      options.push({ text: o.text.trim(), stance: str(o.stance) as TopicStance });
    }
    if (options.length < 2) { r.error(file, `${where}: needs at least two options`); continue; }
    topics.push({ id: str(t.id), title: t.title.trim(), prompt: t.prompt.trim(), options });
  }
  if (!topics.length) { r.error(file, 'no usable topics (built-in topic used)'); return { moderator, topics: DEFAULT_TOWNHALL.topics, rows }; }
  return { moderator, topics, rows };
}
