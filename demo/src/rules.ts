/** Pure game rules: conditions, row selection, effects, lean, phases. */
import type { CondField, DialogueRow, DayPhase, EventRow, GameState, Lean, Leader, NpcState, Phase } from './types';
import { COND_FIELDS } from './types';
import { clamp } from './util';

export const DAY_ACTIONS = 8;
export const DEMO_DAYS = 5;
export const DIALOGUE_COST = 1;

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

export function rapportMatches(cell: string, r: number): boolean {
  let m: RegExpExecArray | null;
  if ((m = /^(\d)$/.exec(cell))) return r === +m[1];
  if ((m = /^(\d)-(\d)$/.exec(cell))) return r >= +m[1] && r <= +m[2];
  if ((m = /^(\d)\+$/.exec(cell))) return r >= +m[1];
  return false;
}

export interface Ctx extends NpcState { nationalLeader: Leader; playerLean: Lean; dayPhase: DayPhase }

export function rowMatches(row: DialogueRow, ctx: Ctx): boolean {
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
  | { k: 'actions'; v: number };

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
    else errors.push(`unknown effect token "${t}"`);
  }
  return { tokens, errors };
}

export function validateEffects(s: string): string[] {
  return parseEffects(s).errors;
}

export type Delta = Record<string, [unknown, unknown]>;

/** Applies an effect string in order. NPC tokens target `npcId` (ignored with a warning when null). */
export function applyEffects(state: GameState, npcId: string | null, effect: string, why: string): Delta {
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
        const nv = clamp(t.rel ? ns.rapport + t.v : t.v, 0, 3);
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
  }
  return delta;
}

export interface EventCtx {
  scene: string;
  present: Set<string>;
  lean: Lean;
  leader: Leader;
  npcs: GameState['npcs'];
  requirePresence: boolean;
}

export function eventMatches(ev: EventRow, c: EventCtx): boolean {
  if (ev.scene && ev.scene !== c.scene) return false;
  if (ev.npc && c.requirePresence && !c.present.has(ev.npc)) return false;
  if (ev.minRapport !== null) {
    const ns = ev.npc ? c.npcs[ev.npc] : undefined;
    if (!ns || ns.rapport < ev.minRapport) return false;
  }
  // events allow `a|b` alternatives in these two cells
  if (ev.playerLean && !ev.playerLean.split('|').map((x) => x.trim()).includes(c.lean)) return false;
  if (ev.nationalLeader && !ev.nationalLeader.split('|').map((x) => x.trim()).includes(c.leader)) return false;
  return true;
}
