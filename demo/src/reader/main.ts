/**
 * Dialogue reader (/reader.html, dev only; SPEC "Dialogue reader and notes (dev only)"). One conversation chain per
 * screen, read beat by beat, with the author's notes (demo/dialogue_notes/<npc>.md) shown beside the rows they name.
 * Keys: ←/→ chain, ↑/↓ NPC, Enter = notes stub for the chain, d = HEAD text of changed rows, ? = keys.
 */
import './reader.css';
import { liveSource, loadContent, packVars, leadNpc, parseDialogueQuiet } from '../content';
import { splitBeats, speechParts } from '../beats';
import { parseEffects } from '../rules';
import { h } from '../util';
import type { Content, DialogueRow, Npc } from '../types';
import { buildSheet, conditionWords, homePack, type Sheet } from './chains';
import { parseNotes, fetchNotes, fetchHead, addStub, type Notes } from './notes';

const CULTURE: Record<string, string> = { cn: 'Chinese', mx: 'Mexican', in: 'Indian' };
const app = document.getElementById('app')!;

let c: Content;
let order: Npc[] = [];
const sheets = new Map<string, Sheet>();
let npcIx = 0, chainIx = 0;
let showDiff = false, showHelp = false;
/** raw notes text per NPC; null = middleware absent */
const notesText = new Map<string, string | null>();
/** HEAD rows per NPC: a Map (empty when the sheet is new), or null when the middleware is absent */
const headRows = new Map<string, Map<string, DialogueRow> | null>();
let toastTimer = 0;

const npc = () => order[npcIx];
const sheet = () => sheets.get(npc().id)!;

function sheetOf(n: Npc): Sheet {
  let s = sheets.get(n.id);
  if (!s) { s = buildSheet(n, c.dialogue.get(n.id) ?? []); sheets.set(n.id, s); }
  return s;
}

/** The game's default fill for {placeholders}: the NPC's pack, pro leads, the enforcement president. */
function vars(n: Npc, row?: DialogueRow): Record<string, string> {
  const pack = homePack(n);
  const us = leadNpc(c, pack, 'us', (row?.usLead || 'pro') as 'pro' | 'anti');
  const home = leadNpc(c, pack, 'home', (row?.homeLead || 'pro') as 'pro' | 'anti');
  const leader = c.npcById.get(`nat_${row?.conds.nationalLeader || 'enforcement'}`);
  return {
    ...packVars(c.strings, pack),
    homeCulture: CULTURE[pack], playerName: '⟨your name⟩', leaderName: leader?.name ?? 'the President',
    usLead: us?.called ?? us?.name ?? 'the council member', homeLead: home?.called ?? home?.name ?? 'the association chair',
    usLeadFull: us?.name ?? 'the council member', homeLeadFull: home?.name ?? 'the association chair',
  };
}

/** text with {placeholders} filled and marked (the raw name in the title); unknown ones left visible */
function filled(text: string, v: Record<string, string>): Node[] {
  const out: Node[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    if (m.index! > last) out.push(document.createTextNode(text.slice(last, m.index)));
    out.push(m[1] in v ? h('span', { class: 'ph', title: `{${m[1]}}`, text: v[m[1]] }) : h('span', { class: 'ph unknown', text: m[0] }));
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

function beats(line: string, rowEmotion: string, v: Record<string, string>): HTMLElement {
  const bs = splitBeats(line);
  return h('div', { class: 'beats' }, ...bs.map((b) => h('p', { class: 'beat' },
    b.emotion ? h('span', { class: `tag emo-${b.emotion}${b.emotion === rowEmotion ? ' same' : ''}`, text: b.emotion }) : null,
    ...speechParts(b.text).flatMap((p) => p.kind === 'stage' ? [h('em', { class: 'stage' }, ...filled(p.text, v)), ' '] : [h('span', {}, ...filled(p.text, v)), ' ']))));
}

function effectChips(effect: string, next: string): HTMLElement {
  const out: HTMLElement[] = [];
  for (const t of parseEffects(effect).tokens) {
    if (t.k === 'met') continue;
    const txt = t.k === 'rapport' ? `rapport ${t.rel && t.v >= 0 ? '+' : ''}${t.v}`
      : t.k === 'lastValence' ? `valence ${t.v === 'positive' ? '+' : t.v === 'negative' ? '−' : '0'}`
        : t.k === 'cost' ? `cost ${t.v}` : t.k === 'invite' ? `invite ${t.v}` : t.k === 'money' ? `money ${t.v > 0 ? '+' : ''}${t.v}` : `actions ${t.v > 0 ? '+' : ''}${t.v}`;
    out.push(h('span', { class: `fx fx-${t.k}${t.k === 'rapport' && t.v < 0 ? ' neg' : ''}`, text: txt }));
  }
  out.push(h('span', { class: next ? 'fx fx-next' : 'fx fx-end', text: next ? `→ ${next}` : 'ends' }));
  return h('span', { class: 'fxs' }, ...out);
}

function noteBox(text: string | undefined, label: string): HTMLElement | null {
  if (text === undefined) return null;
  const body = text.trim()
    ? text.split(/(“[^”\n]+”|"[^"\n]+")/).map((part, i) => (i % 2 ? h('q', { class: 'want', text: part.slice(1, -1) }) : document.createTextNode(part)))
    : [h('span', { class: 'empty', text: `empty: write under the heading in dialogue_notes/${npc().id}.md` })];
  return h('aside', { class: 'note', 'aria-label': label }, h('span', { class: 'note-label', text: label }), h('div', { class: 'note-text' }, ...body));
}

function changeOf(row: DialogueRow): { kind: 'new' | 'changed'; head?: DialogueRow } | null {
  const hr = headRows.get(npc().id);
  if (!hr) return null;
  const old = hr.get(row.id);
  if (!old) return { kind: 'new' };
  const same = old.line === row.line && old.choices.length === row.choices.length && old.choices.every((ch, i) => ch.text === row.choices[i].text);
  return same ? null : { kind: 'changed', head: old };
}

function renderRow(row: DialogueRow, s: Sheet, rootId: string, notes: Notes | null, path: Set<string>, seen: Set<string>, alsoShown: Set<string>): HTMLElement {
  seen.add(row.id);
  const v = vars(s.npc, row);
  const ch = changeOf(row);
  const others = (s.reachedFrom.get(row.id) ?? []).filter((o) => o !== rootId);
  if (others.length) alsoShown.add(row.id);
  const meta = h('div', { class: 'meta' },
    h('span', { class: `tag emo-${row.emotion}`, text: row.emotion }),
    ch ? h('span', { class: `chip ${ch.kind}`, text: ch.kind }) : null,
    others.length && row.priority === -1 ? h('span', { class: 'also', text: `also reached from ${others.join(', ')}` }) : null);
  const headBlock = showDiff && ch?.head ? h('div', { class: 'head' }, h('span', { class: 'head-label', text: 'HEAD' }),
    ch.head.line !== row.line ? beats(ch.head.line, ch.head.emotion, v) : h('p', { class: 'muted', text: 'line unchanged' }),
    ...ch.head.choices.map((hc, i) => hc.text !== row.choices[i]?.text ? h('p', { class: 'head-choice' }, `choice ${i + 1}: `, ...filled(hc.text, v)) : null)) : null;
  const choices = h('ol', { class: 'choices' }, ...row.choices.map((choice, i) => {
    let follow: HTMLElement | null = null;
    if (choice.next) {
      const target = s.byId.get(choice.next);
      if (!target) follow = h('p', { class: 'ref bad', text: `next ${choice.next} is not in the sheet` });
      else if (path.has(target.id)) follow = h('p', { class: 'ref', text: `↺ loops back to ${target.id}` });
      else if (seen.has(target.id)) follow = h('p', { class: 'ref' }, '↳ continues at ', h('a', { href: `#row-${target.id}`, text: target.id }), ' (above)');
      else {
        const p2 = new Set(path); p2.add(target.id);
        follow = renderRow(target, s, rootId, notes, p2, seen, alsoShown);
      }
    }
    return h('li', { class: 'choice' },
      h('div', { class: 'choice-line' }, h('span', { class: 'choice-n', text: String(i + 1) }), h('span', { class: 'choice-text' }, ...filled(choice.text, v)), effectChips(choice.effect, choice.next)),
      follow ? h('div', { class: 'follow' }, follow) : null);
  }));
  const main = h('div', { class: 'row-main' }, meta, beats(row.line, row.emotion, v), headBlock, noteBox(notes?.rows.get(row.id), `note on ${row.id}`));
  return h('section', { class: `row${ch ? ' is-changed' : ''}`, id: `row-${row.id}`, 'data-id': row.id },
    h('button', { class: 'rid', title: `Add a note heading for ${row.id}`, text: row.id, onclick: () => void stub(row.id, false) }),
    h('div', { class: 'row-body' }, main),
    row.choices.length ? choices : h('p', { class: 'ref', text: 'no choices: Continue ends the conversation' }));
}

function render(keepScroll = false): void {
  const y = window.scrollY;
  const s = sheet();
  const n = s.npc;
  const chain = s.chains[chainIx];
  const raw = notesText.get(n.id);
  const notes = raw ? parseNotes(raw) : null;
  const devOnly = raw === null;
  const select = h('select', { 'aria-label': 'NPC', onchange: (e: Event) => { const t = e.target as HTMLSelectElement; npcIx = t.selectedIndex; chainIx = 0; void openNpc(); t.blur(); } },
    ...order.map((o, i) => { const opt = h('option', { value: o.id, text: `${o.name} · ${o.id}` }); if (i === npcIx) opt.selected = true; return opt; }));
  const head = h('header', { class: 'top' },
    h('div', { class: 'who' }, h('h1', { text: n.name }), h('span', { class: 'npc-id', text: n.id }), select),
    h('div', { class: 'where' },
      h('span', { class: 'count', text: s.chains.length ? `chain ${chainIx + 1} of ${s.chains.length}` : 'no rows' }),
      chain ? h('span', { class: 'opener-id', text: chain.opener.id }) : null,
      h('span', { class: 'toggles' },
        h('span', { class: showDiff ? 'on' : '', text: 'd HEAD' }), h('span', { text: '? keys' }),
        devOnly ? h('span', { class: 'devonly', text: 'notes and diff: dev server only' }) : null)));
  if (!chain) { app.replaceChildren(head, h('p', { class: 'muted', text: 'This NPC has no dialogue rows.' })); return; }
  const conds = conditionWords(c, n, chain.opener);
  const condLine = chain.orphan ? `orphan: no opener reaches this row (priority ${chain.opener.priority})`
    : chain.opener.specificity === 0 ? `fallback (no conditions) · priority ${chain.opener.priority}`
      : `${conds.join(' · ')} · priority ${chain.opener.priority}`;
  const alsoShown = new Set<string>();
  const tree = renderRow(chain.opener, s, chain.opener.id, notes, new Set([chain.opener.id]), new Set(), alsoShown);
  const changed = [...chain.ids].filter((id) => changeOf(s.byId.get(id)!)).length;
  const help = showHelp ? h('div', { class: 'help', role: 'dialog', 'aria-label': 'Keys' },
    h('h2', { text: 'Keys' }),
    h('dl', {}, ...[
      ['← →', 'previous / next chain of this NPC (wraps)'], ['↑ ↓', 'previous / next NPC'],
      ['Enter', `add "## chain ${chain.opener.id}" to dialogue_notes/${n.id}.md`], ['click a row id', 'add "## <rowId>" for that row'],
      ['d', 'HEAD text under changed rows'], ['?', 'this list'],
    ].flatMap(([k, d]) => [h('dt', { text: k }), h('dd', { text: d })])),
    h('p', { class: 'muted', text: 'Notes: quoted text is wording to use; unquoted text is direction for the rewrite. The page re-reads the file every 2 s.' })) : null;
  app.replaceChildren(head,
    h('div', { class: 'chain-head' }, h('p', { class: 'conds', text: condLine }),
      h('p', { class: 'stats', text: `${chain.ids.size} row${chain.ids.size === 1 ? '' : 's'}${changed ? ` · ${changed} changed since HEAD` : ''}${alsoShown.size ? ` · ${alsoShown.size} shared with other chains` : ''}` }),
      noteBox(notes?.chains.get(chain.opener.id), `note on chain ${chain.opener.id}`)),
    h('main', { class: 'chain' }, tree),
    help ?? '',
    h('div', { class: 'toast', id: 'toast', role: 'status' }));
  if (keepScroll) window.scrollTo(0, y);
  const u = new URL(location.href);
  u.searchParams.set('npc', n.id); u.searchParams.set('chain', chain.opener.id);
  history.replaceState(null, '', u);
  document.title = `${n.name} · ${chain.opener.id} · Reader`;
}

function toast(msg: string): void {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2600);
}

async function stub(id: string, chain: boolean): Promise<void> {
  const r = await addStub(npc().id, id, chain);
  if ('error' in r) return toast(r.error);
  toast(r.added ? `added "${r.heading}" to ${r.file}` : `"${r.heading}" is already in ${r.file}`);
  await pollNotes(true);
}

async function pollNotes(force = false): Promise<void> {
  const id = npc().id;
  const t = await fetchNotes(id);
  if (id !== npc().id) return;
  if (!force && notesText.has(id) && notesText.get(id) === t) return;
  notesText.set(id, t);
  render(true);
}

async function loadHead(n: Npc): Promise<void> {
  if (headRows.has(n.id)) return;
  const t = await fetchHead(n.id);
  if (t === null) { headRows.set(n.id, null); return; }
  const p = t ? parseDialogueQuiet(n.id, t, new Set(c.sceneById.keys())) : { rows: [] };
  headRows.set(n.id, new Map(('rows' in p ? p.rows : []).map((r) => [r.id, r])));
}

async function openNpc(): Promise<void> {
  const n = npc();
  sheetOf(n);
  render();
  window.scrollTo(0, 0);
  await Promise.all([loadHead(n), fetchNotes(n.id).then((t) => { notesText.set(n.id, t); })]);
  if (n === npc()) render(true);
}

function move(dChain: number, dNpc: number): void {
  if (dNpc) {
    npcIx = (npcIx + dNpc + order.length) % order.length;
    chainIx = 0;
    void openNpc();
    return;
  }
  const k = sheet().chains.length;
  if (!k) return;
  chainIx = (chainIx + dChain + k) % k;
  render();
  window.scrollTo(0, 0);
}

function onKey(e: KeyboardEvent): void {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === 'ArrowRight') move(1, 0);
  else if (k === 'ArrowLeft') move(-1, 0);
  else if (k === 'ArrowDown') move(0, 1);
  else if (k === 'ArrowUp') move(0, -1);
  else if (k === 'Enter') { const ch = sheet().chains[chainIx]; if (ch) void stub(ch.opener.id, true); }
  else if (k === 'd') { showDiff = !showDiff; render(true); }
  else if (k === '?') { showHelp = !showHelp; render(true); }
  else if (k === 'Escape' && showHelp) { showHelp = false; render(true); }
  else return;
  e.preventDefault();
}

async function boot(): Promise<void> {
  c = await loadContent(liveSource(), { override: false });
  const withRows = c.npcs.filter((n) => (c.dialogue.get(n.id) ?? []).length);
  order = [...withRows.filter((n) => /_leader_/.test(n.id)), ...withRows.filter((n) => !/_leader_/.test(n.id))];
  if (!order.length) { app.textContent = 'No dialogue loaded.'; return; }
  const q = new URLSearchParams(location.search);
  npcIx = Math.max(0, order.findIndex((n) => n.id === q.get('npc')));
  const s = sheetOf(npc());
  chainIx = Math.max(0, s.chains.findIndex((ch) => ch.opener.id === q.get('chain')));
  document.addEventListener('keydown', onKey);
  window.addEventListener('focus', () => void pollNotes());
  // cheap: one small GET every 2 s, only while the page has focus
  setInterval(() => { if (document.hasFocus() && !document.hidden) void pollNotes(); }, 2000);
  await openNpc();
  (window as any).__reader = {
    state: () => ({ npc: npc().id, chain: sheet().chains[chainIx]?.opener.id, chainIx, chains: sheet().chains.length, openers: sheet().rows.filter((r) => r.priority !== -1).length, rows: sheet().rows.map((r) => r.id) }),
  };
}

void boot();
