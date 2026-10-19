/** Pure game rules: conditions, row selection, effects, lean, phases. */
import type { CondField, DialogueRow, DayPhase, EventRow, GameState, Lean, Leader, LeadPos, NpcState, Phase } from './types';
import { COND_FIELDS, LEAD_POS } from './types';
import { clamp } from './util';

export const DAY_ACTIONS = 8;
/** Wallet balance a new game starts with. */
export const START_WALLET = 1000;
export const DEMO_DAYS = 5;
/** The bust expressions every roster character has (SPEC "Portraits"); the dialogue/event `emotion` column and beat tags accept exactly these. */
export const EMOTIONS = ['neutral', 'warm', 'guarded', 'worried'] as const;
/** What staying in a conversation past its free turns costs, once per conversation (SPEC "Pay when you stay"). */
export const DIALOGUE_COST = 1;
/** Turns (NPC lines shown) of every conversation that are free; the choice that leads to turn FREE_TURNS + 1 costs DIALOGUE_COST. */
export const FREE_TURNS = 3;

export function phaseOf(actions: number): Phase {
  if (actions >= 6) return 'morning';
  if (actions >= 3) return 'afternoon';
  return 'evening';
}

export function dayPhaseOf(day: number): DayPhase {
  return day <= 2 ? 'early' : day === 3 ? 'mid' : 'late';
}

export function leanOf(spent: GameState['spent']): Lean {
  const total = spent.home + spent.us;
  if (total === 0) return 'balanced';
  const share = spent.home / total;
  if (share < 0.35) return 'us-leaning';
  if (share > 0.65) return 'home-leaning';
  return 'balanced';
}

const ENUMS: Partial<Record<CondField, string[]>> = {
  met: ['yes', 'no'],
  lastValence: ['none', 'positive', 'negative'],
  nationalLeader: ['enforcement', 'inclusive'],
  playerLean: ['us-leaning', 'balanced', 'home-leaning'],
  dayPhase: ['early', 'mid', 'late'],
};

/** Returns an error message for an invalid condition cell, or null. */
export function validateCond(field: CondField, value: string): string | null {
  if (value === '') return null;
  if (field === 'rapport') {
    return /^[0-3]$|^[0-3]-[0-3]$|^[0-3]\+$/.test(value) ? null : `bad rapport condition "${value}" (use 0..3, a range like 1-3, or 2+)`;
  }
  const allowed = ENUMS[field];
  return allowed && !allowed.includes(value) ? `bad ${field} "${value}" (allowed: ${allowed.join('|')})` : null;
}

/** A `day` cell on an event (SPEC "Leads"): blank = any day, `4`, `2-3` or `3+` over the demo days 1..5. */
export function validateDay(value: string): string | null {
  if (value === '') return null;
  return /^[1-5]$|^[1-5]-[1-5]$|^[1-5]\+$/.test(value) ? null : `bad day "${value}" (use a day 1..5, a range like 2-3, or 4+)`;
}
export const dayMatches = (cell: string, day: number): boolean => cell === '' || rapportMatches(cell, day);

/** A lead cell (dialogue `usLead`/`homeLead`, or an event's with `|` alternatives): blank = any room. */
export function validateLead(value: string): string | null {
  if (value === '') return null;
  const bad = value.split('|').map((x) => x.trim()).filter((x) => !(LEAD_POS as readonly string[]).includes(x));
  return bad.length ? `bad lead condition "${value}" (use pro, anti, or pro|anti)` : null;
}
export const leadMatches = (cell: string, pos: LeadPos): boolean => cell === '' || cell.split('|').map((x) => x.trim()).includes(pos);

export function rapportMatches(cell: string, r: number): boolean {
  let m: RegExpExecArray | null;
  if ((m = /^(\d)$/.exec(cell))) return r === +m[1];
  if ((m = /^(\d)-(\d)$/.exec(cell))) return r >= +m[1] && r <= +m[2];
  if ((m = /^(\d)\+$/.exec(cell))) return r >= +m[1];
  return false;
}

/**
 * `scene`: the scene the conversation happens in. A row whose `scene` cell is non-blank only matches there
 * (SPEC "Dialogue location"); with `scene` undefined, only rows with a blank `scene` cell match.
 */
export interface Ctx extends NpcState { nationalLeader: Leader; playerLean: Lean; dayPhase: DayPhase; scene?: string; usLead?: LeadPos; homeLead?: LeadPos; day?: number }

/** Default conversations per NPC per day (SPEC "Conversation limit"). */
export const DEFAULT_TALKS_PER_DAY = 1;

/** Default cap on cut-out figures present in a scene at once (SPEC "How many people at once"); painted NPCs do not count. */
export const DEFAULT_MAX_PRESENT = 3;
/** A nearer figure may cover at most this share of a further figure's rectangle (SPEC "How many people at once"). */
export const OCCLUSION_MAX = 0.4;
/** The top share of a further figure that counts as its head band: no nearer figure may cover any of it. */
export const HEAD_BAND = 0.25;
/** Width / height assumed for a figure whose asset size is unknown. */
export const DEFAULT_FIGURE_ASPECT = 0.45;

/** A figure's on-screen box in px: feet anchored at the bottom centre, as the renderer draws it. */
export interface FigRect { x0: number; y0: number; x1: number; y1: number }

/** `x`,`y`: slot fractions; `hFrac`: figureHeight(); `aspect`: width / height; `w`,`h`: image box size in px. */
export function figureRect(x: number, y: number, hFrac: number, aspect: number, w: number, h: number): FigRect {
  const hgt = hFrac * h, wid = hgt * aspect;
  return { x0: x * w - wid / 2, x1: x * w + wid / 2, y0: y * h - hgt, y1: y * h };
}

/** How much of `far` the nearer figure `near` hides: the covered share of its rectangle and of its head band (0..1). */
export function occlusion(near: FigRect, far: FigRect): { covered: number; head: number } {
  const ix = Math.max(0, Math.min(near.x1, far.x1) - Math.max(near.x0, far.x0));
  const fw = far.x1 - far.x0, fh = far.y1 - far.y0;
  if (!ix || fw <= 0 || fh <= 0) return { covered: 0, head: 0 };
  const iy = Math.max(0, Math.min(near.y1, far.y1) - Math.max(near.y0, far.y0));
  const headBottom = far.y0 + fh * HEAD_BAND;
  const ihy = Math.max(0, Math.min(near.y1, headBottom) - Math.max(near.y0, far.y0));
  return { covered: (ix * iy) / (fw * fh), head: (ix * ihy) / (fw * fh * HEAD_BAND) };
}

/**
 * True when two figures may not stand together: the nearer one (larger feet y; equal y checks both ways) would cover any
 * of the further one's head band, or more than OCCLUSION_MAX of its rectangle. Mirrored in tools/checker/core.mjs.
 */
export function figuresClash(a: { y: number; rect: FigRect }, b: { y: number; rect: FigRect }): boolean {
  const bad = (near: FigRect, far: FigRect) => { const o = occlusion(near, far); return o.head > 0 || o.covered > OCCLUSION_MAX; };
  return (a.y >= b.y && bad(a.rect, b.rect)) || (b.y >= a.y && bad(b.rect, a.rect));
}

/** Feature switches kept in code but off for the study (SPEC "TV once a day"). */
export const FEATURES = {
  /** the TV module's "Keep watching" second story (1 action); off: one story per day */
  tvKeepWatching: false,
} as const;

/** Parses a dialogue `scene` cell: blank = anywhere, else scene ids separated by `|`. */
export function sceneList(cell: string): string[] {
  return (cell ?? '').split('|').map((x) => x.trim()).filter(Boolean);
}

export function rowMatches(row: DialogueRow, ctx: Ctx): boolean {
  if (row.scenes?.length && (ctx.scene === undefined || !row.scenes.includes(ctx.scene))) return false;
  // SPEC "Leads": a row written for one lead only shows in rooms with that lead (default pro)
  if (row.usLead && !leadMatches(row.usLead, ctx.usLead ?? 'pro')) return false;
  if (row.homeLead && !leadMatches(row.homeLead, ctx.homeLead ?? 'pro')) return false;
  if (row.day && (ctx.day === undefined || !dayMatches(row.day, ctx.day))) return false;
  for (const f of COND_FIELDS) {
    const cell = row.conds[f];
    if (cell === '') continue;
    if (f === 'rapport') {
      if (!rapportMatches(cell, ctx.rapport)) return false;
    } else if (String(ctx[f]) !== cell) return false;
  }
  return true;
}

export interface Selection { row: DialogueRow | null; tie: DialogueRow[] }

export function selectRow(rows: DialogueRow[], ctx: Ctx): Selection {
  let best: DialogueRow | null = null;
  let tie: DialogueRow[] = [];
  for (const row of rows) {
    if (!rowMatches(row, ctx)) continue;
    if (!best || row.priority > best.priority || (row.priority === best.priority && row.specificity > best.specificity)) {
      best = row;
      tie = [];
    } else if (row.priority === best.priority && row.specificity === best.specificity) {
      tie.push(row);
    }
  }
  return { row: best, tie };
}

// ---- effects ----
export type EffectToken =
  | { k: 'met'; v: 'yes' | 'no' }
  | { k: 'rapport'; rel: boolean; v: number }
  | { k: 'lastValence'; v: 'positive' | 'negative' | 'none' }
  | { k: 'money'; v: number }
  | { k: 'invite'; v: string }
  | { k: 'actions'; v: number }
  /** dialogue options only: taking this option costs N actions (a substantive ask, "help me with ..."); charged by the engine, not here */
  | { k: 'cost'; v: number };

export function parseEffects(s: string): { tokens: EffectToken[]; errors: string[] } {
  const tokens: EffectToken[] = [];
  const errors: string[] = [];
  for (const raw of (s ?? '').split(';')) {
    const t = raw.trim().replace(/\s+/g, ' ');
    if (!t) continue;
    let m: RegExpExecArray | null;
    if ((m = /^met (yes|no)$/.exec(t))) tokens.push({ k: 'met', v: m[1] as 'yes' | 'no' });
    else if ((m = /^rapport ([+-]?)(\d+)$/.exec(t))) tokens.push({ k: 'rapport', rel: m[1] !== '', v: (m[1] === '-' ? -1 : 1) * +m[2] });
    else if ((m = /^lastValence (positive|negative|none)$/.exec(t))) tokens.push({ k: 'lastValence', v: m[1] as any });
    else if ((m = /^money ([+-]?\d+)$/.exec(t))) tokens.push({ k: 'money', v: +m[1] });
    else if ((m = /^invite (\S+)$/.exec(t))) tokens.push({ k: 'invite', v: m[1] });
    else if ((m = /^actions ([+-]?\d+)$/.exec(t))) tokens.push({ k: 'actions', v: +m[1] });
    else if ((m = /^cost (\d+)$/.exec(t))) tokens.push({ k: 'cost', v: +m[1] });
    else errors.push(`unknown effect token "${t}"`);
  }
  return { tokens, errors };
}

export function validateEffects(s: string): string[] {
  return parseEffects(s).errors;
}

export type Delta = Record<string, [unknown, unknown]>;

/** Applies an effect string in order. NPC tokens target `npcId` (ignored with a warning when null). */
/** `maxRapport`: the NPC's cap (SPEC "Leads": a hostile NPC never passes 1); default 3. */
export function applyEffects(state: GameState, npcId: string | null, effect: string, why: string, maxRapport = 3): Delta {
  const delta: Delta = {};
  const { tokens, errors } = parseEffects(effect);
  for (const e of errors) console.error(`[effects] ${why}: ${e}`);
  const note = (key: string, before: unknown, after: unknown) => {
    if (before === after) return;
    delta[key] = key in delta ? [delta[key][0], after] : [before, after];
  };
  for (const t of tokens) {
    if (t.k === 'met' || t.k === 'rapport' || t.k === 'lastValence') {
      const ns = npcId ? state.npcs[npcId] : undefined;
      if (!ns) {
        console.warn(`[effects] ${why}: "${t.k}" has no target NPC; ignored`);
        continue;
      }
      if (t.k === 'met') { note(`${npcId}.met`, ns.met, t.v); ns.met = t.v; }
      if (t.k === 'rapport') {
        const nv = clamp(t.rel ? ns.rapport + t.v : t.v, 0, Math.min(3, maxRapport));
        note(`${npcId}.rapport`, ns.rapport, nv);
        ns.rapport = nv;
      }
      if (t.k === 'lastValence') { note(`${npcId}.lastValence`, ns.lastValence, t.v); ns.lastValence = t.v; }
    } else if (t.k === 'money') {
      note('wallet', state.wallet, state.wallet + t.v);
      state.wallet += t.v;
      state.walletLog.push({ day: state.day, amount: t.v, why });
    } else if (t.k === 'invite') {
      if (!state.invites.includes(t.v)) {
        note('invites', state.invites.join(',') || null, [...state.invites, t.v].join(','));
        state.invites.push(t.v);
      }
    } else if (t.k === 'actions') {
      const nv = clamp(state.actions + t.v, 0, DAY_ACTIONS);
      note('actions', state.actions, nv);
      state.actions = nv;
    }
    // `cost N` is charged by the engine before the effects run (see optionCharge); nothing to apply here
  }
  return delta;
}

/** The explicit `cost N` of a dialogue option's effect string (several tokens add up; 0 when there is none). */
export function explicitCost(effect: string): number {
  return parseEffects(effect).tokens.reduce((n, t) => (t.k === 'cost' ? n + t.v : n), 0);
}

/**
 * What taking a dialogue option costs (SPEC "Pay when you stay"). Starting a conversation is free and so are its first
 * FREE_TURNS turns; the first option that leads to turn FREE_TURNS + 1 (its `next` row would be that turn) costs
 * DIALOGUE_COST, once per conversation. An option's explicit `cost N` is charged instead when both apply: the click costs
 * max(explicit, stay charge) and the stay charge counts as paid. `turnsShown`: NPC lines shown so far in this
 * conversation (1 on the opening row); `stayPaid`: the stay charge was already taken; `leadsOn`: the option has a
 * `next` row that exists. Mirrored in tools/checker/core.mjs.
 */
export function optionCharge(effect: string, leadsOn: boolean, turnsShown: number, stayPaid: boolean): { charge: number; stay: boolean } {
  const stay = leadsOn && !stayPaid && turnsShown + 1 > FREE_TURNS;
  return { charge: Math.max(explicitCost(effect), stay ? DIALOGUE_COST : 0), stay };
}

export interface EventCtx {
  scene: string;
  present: Set<string>;
  lean: Lean;
  leader: Leader;
  npcs: GameState['npcs'];
  requirePresence: boolean;
  /** SPEC "Leads": the room's leads and today's day, for the optional `usLead`/`homeLead`/`day` cells */
  usLead?: LeadPos;
  homeLead?: LeadPos;
  day?: number;
  /** whether `npc` has an appearance (figure, painted or talk zone) in `scene`; an event there from someone who never appears is a visit or a call */
  canAppear?: (npc: string, scene: string) => boolean;
}

export function eventMatches(ev: EventRow, c: EventCtx): boolean {
  if (ev.scene && ev.scene !== c.scene) return false;
  // an NPC who can stand in this scene must be there; one who never appears in it arrives at the door or on the phone
  const visit = !!ev.scene && !!c.canAppear && !c.canAppear(ev.npc, ev.scene);
  if (ev.npc && c.requirePresence && !visit && !c.present.has(ev.npc)) return false;
  if (ev.minRapport !== null) {
    const ns = ev.npc ? c.npcs[ev.npc] : undefined;
    if (!ns || ns.rapport < ev.minRapport) return false;
  }
  // events allow `a|b` alternatives in these two cells
  if (ev.playerLean && !ev.playerLean.split('|').map((x) => x.trim()).includes(c.lean)) return false;
  if (ev.nationalLeader && !ev.nationalLeader.split('|').map((x) => x.trim()).includes(c.leader)) return false;
  if (ev.day && c.day !== undefined && !dayMatches(ev.day, c.day)) return false;
  if (ev.usLead && !leadMatches(ev.usLead, c.usLead ?? 'pro')) return false;
  if (ev.homeLead && !leadMatches(ev.homeLead, c.homeLead ?? 'pro')) return false;
  return true;
}
