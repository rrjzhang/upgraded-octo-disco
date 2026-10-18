/** Loads and loosely validates content + manifest. Errors are logged naming file and row, never thrown for row-level problems. */
import { load as loadYaml } from 'js-yaml';
import Papa from 'papaparse';
import type {
  Content, DialogueRow, Emotion, EventRow, Manifest, NewsRow, Npc, Questionnaire, Scene, Hotspot, CondField,
} from './types';
import { COND_FIELDS } from './types';
import { DEFAULT_STRINGS } from './strings';
import { validateEffects, validateCond } from './rules';

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
const EMOTIONS: Emotion[] = ['neutral', 'warm', 'guarded', 'worried'];

export function liveSource(): Source {
  return {
    kind: 'live',
    async text(path) {
      try {
        const res = await fetch('/' + path, { cache: 'no-cache' });
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
      if (/^(data:|https?:|\/)/.test(file)) return file;
      return '/assets/' + file;
    },
  };
}

class Reporter {
  errors: string[] = [];
  error(file: string, msg: string) {
    const m = `[content] ${file}: ${msg}`;
    this.errors.push(m);
    console.error(m);
  }
  warn(file: string, msg: string) {
    console.warn(`[content] ${file}: ${msg}`);
  }
}

const str = (v: unknown, d = ''): string => (v === null || v === undefined ? d : String(v).trim());
const num = (v: unknown, d: number): number => {
  const s = str(v);
  if (s === '') return d;
  const n = Number(s);
  return Number.isFinite(n) ? n : d;
};

function parseCsv(r: Reporter, file: string, text: string, columns: string[]): Record<string, string>[] {
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy' });
  for (const e of res.errors) r.error(file, `CSV parse error at row ${(e.row ?? 0) + 2}: ${e.message}`);
  const fields = (res.meta.fields ?? []).map((f) => f.trim());
  const unknown = fields.filter((f) => !columns.includes(f));
  const missing = columns.filter((c) => !fields.includes(c));
  if (unknown.length) r.error(file, `unknown column(s): ${unknown.join(', ')}`);
  if (missing.length) r.error(file, `missing column(s): ${missing.join(', ')}`);
  return res.data.map((row) => {
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) o[k.trim()] = str(v);
    return o;
  });
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
        action: { type: type as any, module: a.module, cost: a.cost === undefined ? undefined : num(a.cost, 1), to: a.to, text: a.text, npc: a.npc === undefined ? undefined : str(a.npc) },
        placeholder: hs.placeholder === true,
      });
    });
    out.push({
      id: str(s.id),
      name: str(s.name, s.id),
      community: community as any,
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
        .map((sl: any) => ({ id: str(sl.id), x: sl.x, y: sl.y, scale: num(sl.scale, 0.5) })),
      props: (Array.isArray(s.props) ? s.props : [])
        .filter((p: any, j: number) => (p?.asset ? true : (r.error(file, `${where} prop #${j + 1}: missing asset`), false)))
        .map((p: any) => ({ asset: str(p.asset), x: num(p.x, 0), y: num(p.y, 0), w: num(p.w, 0.1) })),
      painted: s.painted && typeof s.painted === 'object' && s.painted.background
        ? { background: str(s.painted.background), npcs: (Array.isArray(s.painted.npcs) ? s.painted.npcs : []).map((x: any) => str(x)) }
        : undefined,
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
    }).map((a: any) => ({ scene: str(a.scene), slot: str(a.slot), chance: num(a.chance, 1) }));
    out.push({
      id: str(n.id),
      name: str(n.name, n.id),
      pack: str(n.pack, 'shared'),
      community: str(n.community),
      role: str(n.role),
      stance: str(n.stance, 'none'),
      portrait: str(n.portrait, `ch_${n.id}`),
      figure: n.figure ? str(n.figure) : undefined,
      seated: n.seated === true,
      appearances,
      initial: {
        met,
        rapport: Math.max(0, Math.min(3, num(init.rapport, 0))),
        lastValence: (['none', 'positive', 'negative'].includes(lv) ? lv : 'none') as any,
      },
    });
  });
  return out;
}

function parseDialogue(r: Reporter, npcId: string, file: string, text: string): DialogueRow[] {
  const rows = parseCsv(r, file, text, DIALOGUE_COLUMNS);
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
      id: row.id, npc: npcId, conds, specificity, rowNum,
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
  if (!out.some((x) => x.specificity === 0)) r.error(file, 'no fallback row (all six condition cells blank)');
  return out;
}

function parseEvents(r: Reporter, file: string, text: string, scenes: Map<string, Scene>, npcs: Map<string, Npc>): EventRow[] {
  const rows = parseCsv(r, file, text, EVENT_COLUMNS);
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
    const choices = [1, 2].map((k) => ({ text: row[`choice${k}`] ?? '', effect: row[`effect${k}`] ?? '' })).filter((c) => c.text);
    for (const c of choices) for (const e of validateEffects(c.effect)) r.error(file, `${where}: ${e}`);
    out.push({
      id: row.id, source: row.source, target: row.target, valence: row.valence, proximity: row.proximity,
      trigger: row.trigger as any, scene: row.scene, npc: row.npc,
      minRapport: row.minRapport === '' ? null : num(row.minRapport, 0),
      playerLean: row.playerLean, nationalLeader: row.nationalLeader,
      chance: num(row.chance, 1), cost: num(row.cost, 0),
      emotion: EMOTIONS.includes(emotion) ? emotion : 'neutral',
      text: row.text, choices, rowNum,
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
  return parseCsv(r, file, text, NEWS_COLUMNS).flatMap((row, i) => {
    const where = `row ${i + 2}${row.id ? ` (${row.id})` : ''}`;
    if (!row.id) return r.error(file, `${where}: missing id`), [];
    if (!['tv', 'print'].includes(row.channel)) r.error(file, `${where}: channel must be tv|print`);
    return [{
      id: row.id, channel: (row.channel === 'print' ? 'print' : 'tv') as NewsRow['channel'],
      nationalLeader: row.nationalLeader, dayMin: num(row.dayMin, 1), valence: row.valence,
      headline: row.headline, body: row.body,
    }];
  });
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

export async function loadContent(src: Source): Promise<Content> {
  const r = new Reporter();
  const need = async (path: string) => {
    const t = await src.text(path);
    if (t === null) r.error(path, 'file missing or unreadable');
    return t;
  };

  const [scenesText, npcsText, eventsText, newsText, eodText, manifestText, stringsText] = await Promise.all([
    need('content/scenes.yaml'),
    need('content/npcs.yaml'),
    need('content/events.csv'),
    need('content/news.csv'),
    need('content/questionnaire/eod.json'),
    need('assets/manifest.json'),
    src.text('content/strings.en.json'),
  ]);

  const scenes = scenesText ? parseScenes(r, 'content/scenes.yaml', scenesText) : [];
  const sceneById = new Map(scenes.map((s) => [s.id, s]));
  const npcs = npcsText ? parseNpcs(r, 'content/npcs.yaml', npcsText, sceneById) : [];
  const npcById = new Map(npcs.map((n) => [n.id, n]));

  const dialogue = new Map<string, DialogueRow[]>();
  await Promise.all(
    npcs.map(async (n) => {
      const file = `content/dialogue/${n.id}.csv`;
      const t = await src.text(file);
      if (t === null) {
        // TV-only NPCs may legitimately have no sheet; warn instead of erroring.
        if (n.figure) r.error(file, 'file missing or unreadable');
        else r.warn(file, 'no dialogue sheet (TV-only NPC)');
        dialogue.set(n.id, []);
        return;
      }
      dialogue.set(n.id, parseDialogue(r, n.id, file, t));
    }),
  );

  const events = eventsText ? parseEvents(r, 'content/events.csv', eventsText, sceneById, npcById) : [];
  const news = newsText ? parseNews(r, 'content/news.csv', newsText) : [];

  let eod = FALLBACK_EOD;
  if (eodText) {
    try {
      const q = JSON.parse(eodText);
      if (!Array.isArray(q.pages)) throw new Error('missing pages[]');
      q.pages.forEach((p: any, i: number) =>
        (p.items ?? []).forEach((it: any, j: number) => {
          if (!it.id || !['likert', 'choice', 'text'].includes(it.type)) r.error('content/questionnaire/eod.json', `page ${i + 1} item ${j + 1}: needs id and type likert|choice|text`);
        }));
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
  for (const s of scenes) {
    if (s.background !== 'none' && !assetEntry(manifest, manifest.backgrounds, s.background)) r.warn('assets/manifest.json', `no background "${s.background}" for scene ${s.id} (flat panel shown)`);
    for (const p of s.props) if (!assetEntry(manifest, manifest.props, p.asset)) r.warn('assets/manifest.json', `no prop "${p.asset}" for scene ${s.id}`);
  }
  for (const n of npcs) {
    if (!assetEntry(manifest, manifest.portraits, n.portrait)) r.warn('assets/manifest.json', `no portrait "${n.portrait}" for ${n.id} (silhouette shown)`);
    if (n.figure && !assetEntry(manifest, manifest.figures, n.figure)) r.warn('assets/manifest.json', `no figure "${n.figure}" for ${n.id} (silhouette shown)`);
  }

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

  return {
    source: src.kind, scenes, sceneById, npcs, npcById, dialogue, events, news, eod, manifest, strings,
    assetUrl: src.assetUrl, errors: r.errors,
  };
}

export async function getSource(fixtures: boolean): Promise<Source> {
  if (fixtures) {
    const m = await import('./fixtures');
    return m.fixtureSource();
  }
  return liveSource();
}
