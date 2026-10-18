/** researcher.html: create rooms, list them, export logs. */
import './style.css';
import { getSource } from './content';
import { listRooms, loadState, readLog, saveRoom, getRoom, type RoomRecord } from './store';
import type { Leader, RoomConfig } from './types';
import { downloadText, h, isFixtures, isoNow } from './util';

const app = document.getElementById('app')!;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const WORDS = [
  'amber', 'birch', 'cedar', 'delta', 'ember', 'fern', 'granite', 'harbor', 'iris', 'juniper', 'kettle', 'lantern',
  'maple', 'nectar', 'orchard', 'pepper', 'quartz', 'river', 'saffron', 'tulip', 'umber', 'violet', 'willow', 'yarrow',
  'acorn', 'basil', 'clover', 'dune', 'falcon', 'garnet', 'heron', 'indigo', 'jasper', 'lotus', 'meadow', 'otter',
];

const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]): T => a[rnd(a.length)];

function mintCode(): string {
  for (let tries = 0; tries < 1000; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[rnd(CODE_CHARS.length)];
    if (!getRoom(c) && !c.startsWith('DEV')) return c;
  }
  throw new Error('could not mint a free room code');
}

async function main(): Promise<void> {
  let candidates: Record<string, string[]> = {};
  const src = await getSource(isFixtures);
  const mt = await src.text('assets/manifest.json');
  if (mt) {
    try { candidates = JSON.parse(mt).candidates ?? {}; } catch (e) { console.error('[researcher] assets/manifest.json:', e); }
  } else {
    console.warn('[researcher] assets/manifest.json missing; no roster candidates to pick');
  }

  const leader = h('select', { id: 'leader' }, h('option', { value: 'enforcement', text: 'enforcement' }), h('option', { value: 'inclusive', text: 'inclusive' }));
  const seed = h('input', { id: 'seed', type: 'number', min: 0, step: 1 });
  const note = h('input', { id: 'note', type: 'text', placeholder: 'optional, e.g. session or participant group' });
  const picks: Record<string, HTMLSelectElement> = {};
  const pickRows = h('div', { class: 'picks' });
  for (const [npc, list] of Object.entries(candidates)) {
    if (!Array.isArray(list) || list.length < 2) continue;
    const sel = h('select', { id: `pick_${npc}` }, ...list.map((c) => h('option', { value: c, text: c })));
    picks[npc] = sel;
    pickRows.append(h('label', { for: `pick_${npc}`, text: npc }), sel);
  }
  const randomize = () => {
    leader.value = pick<Leader>(['enforcement', 'inclusive']);
    seed.value = String(rnd(1_000_000));
    for (const sel of Object.values(picks)) sel.selectedIndex = rnd(sel.options.length);
  };
  randomize();

  const result = h('div', { class: 'result', 'aria-live': 'polite' });
  const table = h('tbody');

  const renderRooms = () => {
    table.replaceChildren();
    const rooms = listRooms();
    if (!rooms.length) table.append(h('tr', {}, h('td', { colspan: 7, class: 'muted', text: 'No rooms on this computer yet.' })));
    for (const r of rooms) {
      const st = loadState(r.code);
      const status = !st ? 'not started' : st.finished ? `finished (day ${st.day})` : `day ${st.day}, ${st.actions} actions left`;
      const lines = readLog(r.code).split('\n').filter(Boolean).length;
      table.append(h('tr', {},
        h('td', { class: 'mono', text: r.code }),
        h('td', { class: 'mono', text: r.password }),
        h('td', { text: r.config.nationalLeader }),
        h('td', { text: (r.config.created ?? '').slice(0, 16).replace('T', ' ') }),
        h('td', { text: status }),
        h('td', { text: String(lines) }),
        h('td', {}, h('button', {
          class: 'btn small', disabled: lines === 0, 'aria-label': `Export log for room ${r.code}`,
          onclick: () => downloadText(`greatvote_${r.code}.jsonl`, readLog(r.code)), text: 'Export log',
        }))));
    }
  };

  const form = h('form', { class: 'card wide' },
    h('h1', { text: 'Create a room' }),
    h('p', { class: 'muted', text: 'Values are randomized; every field can be edited before creating.' + (isFixtures ? ' (fixtures manifest)' : '') }),
    h('div', { class: 'grid2' },
      h('label', { for: 'leader', text: 'National leader condition' }), leader,
      h('label', { for: 'seed', text: 'Event seed' }), seed,
      h('label', { for: 'note', text: 'Note' }), note),
    Object.keys(picks).length ? h('h2', { text: 'Roster candidates' }) : null,
    pickRows,
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', type: 'button', onclick: randomize, text: 'Re-randomize' }),
      h('button', { class: 'btn', type: 'submit', text: 'Create room' })),
    result);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = mintCode();
    const password = `${pick(WORDS)}-${pick(WORDS)}`;
    const config: RoomConfig = {
      code, password,
      nationalLeader: leader.value as Leader,
      seed: Math.floor(Number(seed.value) || 0),
      rosterPicks: Object.fromEntries(Object.entries(picks).map(([k, s]) => [k, s.value])),
      created: isoNow(),
      note: note.value.trim() || undefined,
    };
    const rec: RoomRecord = { code, password, config };
    saveRoom(rec);
    const link = `${location.origin}/?room=${code}${isFixtures ? '&fixtures=1' : ''}`;
    result.replaceChildren(
      h('p', {}, 'Room ', h('strong', { class: 'mono', text: code }), ' password ', h('strong', { class: 'mono', text: password })),
      h('p', { class: 'muted' }, 'Participant link: ', h('a', { href: link, text: link })));
    randomize();
    renderRooms();
  });

  app.replaceChildren(h('div', { class: 'researcher' },
    form,
    h('section', { class: 'card wide' },
      h('h1', { text: 'Rooms on this computer' }),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ...['Code', 'Password', 'Leader', 'Created', 'Status', 'Log lines', ''].map((t) => h('th', { text: t })))),
        table)),
      h('p', { class: 'muted', text: 'Rooms, saves and logs live in this browser\'s localStorage until a server is added.' }))));
  renderRooms();
  window.addEventListener('storage', renderRooms);
}

main().catch((e) => {
  console.error(e);
  app.textContent = String(e);
});
