/**
 * SPEC "Dialogue reader and notes (dev only)": a sheet as conversation chains.
 * An opener is any row that is not a priority -1 follow-up; its chain is everything reachable from it through choice
 * `next` links, nested under the choice that leads there. Rows no opener reaches (none in the shipped content) become
 * chains of their own, marked as orphans, so every row of a sheet appears in some chain.
 */
import type { Content, DialogueRow, Npc } from '../types';
import { leadNpc } from '../content';

export interface Chain { opener: DialogueRow; orphan: boolean; ids: Set<string> }

export interface Sheet {
  npc: Npc;
  rows: DialogueRow[];
  byId: Map<string, DialogueRow>;
  chains: Chain[];
  /** row id -> the chain roots (opener ids) that reach it */
  reachedFrom: Map<string, string[]>;
}

function reach(byId: Map<string, DialogueRow>, root: string): Set<string> {
  const seen = new Set<string>(), stack = [root];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    for (const c of byId.get(id)!.choices) if (c.next) stack.push(c.next);
  }
  return seen;
}

export function buildSheet(npc: Npc, rows: DialogueRow[]): Sheet {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const chains: Chain[] = rows.filter((r) => r.priority !== -1).map((opener) => ({ opener, orphan: false, ids: reach(byId, opener.id) }));
  const covered = new Set(chains.flatMap((c) => [...c.ids]));
  // orphans: start from rows nothing else unreached points at, then anything left (a cycle)
  for (;;) {
    const left = rows.filter((r) => !covered.has(r.id));
    if (!left.length) break;
    const targeted = new Set(left.flatMap((r) => r.choices.map((c) => c.next)));
    const root = left.find((r) => !targeted.has(r.id)) ?? left[0];
    const ids = reach(byId, root.id);
    for (const id of ids) covered.add(id);
    chains.push({ opener: root, orphan: true, ids });
  }
  const reachedFrom = new Map<string, string[]>();
  for (const ch of chains) for (const id of ch.ids) {
    if (!reachedFrom.has(id)) reachedFrom.set(id, []);
    reachedFrom.get(id)!.push(ch.opener.id);
  }
  return { npc, rows, byId, chains, reachedFrom };
}

/** Plain-English conditions of a row: "first meeting · heritage center · enforcement president · Ruth is the US lead · day 3+". */
export function conditionWords(c: Content, npc: Npc, row: DialogueRow): string[] {
  const out: string[] = [];
  const k = row.conds;
  if (k.met === 'no') out.push('first meeting');
  else if (k.met === 'yes') out.push('already met');
  if (row.scenes.length) out.push(row.scenes.map((s) => c.sceneById.get(s)?.name.toLowerCase() ?? s).join(' or '));
  if (k.rapport) out.push(`rapport ${k.rapport.replace('-', '–')}`);
  if (k.lastValence) out.push({ positive: 'last talk went well', negative: 'last talk went badly', none: 'last talk neutral' }[k.lastValence] ?? `lastValence ${k.lastValence}`);
  if (k.nationalLeader) out.push(`${k.nationalLeader} president`);
  if (k.playerLean) out.push({ 'us-leaning': 'player leans US', 'home-leaning': 'player leans home', balanced: 'player balanced' }[k.playerLean] ?? k.playerLean);
  if (k.dayPhase) out.push(`${k.dayPhase} in the week`);
  const pack = homePack(npc);
  for (const side of ['us', 'home'] as const) {
    const pos = side === 'us' ? row.usLead : row.homeLead;
    if (!pos) continue;
    const who = leadNpc(c, pack, side, pos as 'pro' | 'anti');
    out.push(`${who?.called ?? who?.name ?? `the ${pos} leader`} is the ${side === 'us' ? 'US' : 'heritage'} lead`);
  }
  if (row.day) out.push(/^\d-\d$/.test(row.day) ? `days ${row.day.replace('-', '–')}` : `day ${row.day}`);
  if (row.absent) out.push(`${c.npcById.get(row.absent)?.called ?? c.npcById.get(row.absent)?.name ?? row.absent} not there`);
  return out;
}

/** The culture pack a sheet's {placeholders} and heritage lead are read in: the NPC's own, else cn (the demo pack). */
export function homePack(npc: Npc): 'cn' | 'mx' | 'in' {
  return npc.pack === 'mx' || npc.pack === 'in' ? npc.pack : 'cn';
}
