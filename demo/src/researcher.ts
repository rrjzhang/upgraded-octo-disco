/** researcher.html: create rooms, list them, export logs. */
import './style.css';
import { load as loadYaml } from 'js-yaml';
import { getSource } from './content';
import { getSettings, listRooms, loadState, readLog, saveRoom, saveSettings, getRoom, type RoomRecord } from './store';
import type { Leader, LeadPos, Npc, RoomConfig } from './types';
import { appUrl, downloadText, h, isFixtures, isoNow } from './util';

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

// pack display names, as the home-culture choice reads them (main.ts culture radios: China / Mexico / India)
const PACK_NAMES: Record<string, string> = { shared: 'Shared', cn: 'Chinese', mx: 'Mexican', in: 'Indian' };

async function main(): Promise<void> {
  let candidates: Record<string, string[]> = {};
  let thumbs: Record<string, Record<string, string>> = {};
  const src = await getSource(isFixtures);
  const mt = await src.text('assets/manifest.json');
  if (mt) {
    try { const m = JSON.parse(mt); candidates = m.candidates ?? {}; thumbs = m.candidateThumbs ?? {}; } catch (e) { console.error('[researcher] assets/manifest.json:', e); }
  } else {
    console.warn('[researcher] assets/manifest.json missing; no roster candidates to pick');
  }
  // character names and packs for the candidates block (ids stay out of sight)
  const npcs = new Map<string, Npc>();
  const ny = await src.text('content/npcs.yaml');
  try { for (const n of ((ny && (loadYaml(ny) as { npcs?: Npc[] })?.npcs) || [])) if (n?.id) npcs.set(n.id, n); }
  catch (e) { console.error('[researcher] content/npcs.yaml:', e); }

  const leader = h('select', { id: 'leader' }, h('option', { value: 'enforcement', text: 'enforcement' }), h('option', { value: 'inclusive', text: 'inclusive' }));
  // SPEC "Leads": which local leader is first among equals on each side (the other still exists in the town)
  const leadSel = (id: string) => h('select', { id }, h('option', { value: 'pro', text: 'pro-integration' }), h('option', { value: 'anti', text: 'anti-integration' }));
  const usLead = leadSel('uslead'), homeLead = leadSel('homelead');
  const seed = h('input', { id: 'seed', type: 'number', min: 0, step: 1 });
  const note = h('input', { id: 'note', type: 'text', placeholder: 'optional, e.g. session or participant group' });
  // SPEC "Conversation limit": conversations a participant may have with each person per day
  const talks = h('input', { id: 'talks', type: 'number', min: 1, max: 8, step: 1, value: '1', 'aria-describedby': 'talks-help' });
  // The questionnaire JSON / URL inputs were removed 2026-10-18 pending a backend (request + webhook). RoomConfig's
  // `questionnaire` and `questionnaireUrl` are still honoured by the engine (server -> room -> bundled), so a room
  // config made elsewhere keeps working; this page just does not offer them.
  const formErr = h('div', { class: 'err', role: 'alert' });
  // npc id -> its candidate reference ids; the chosen radio is "random" or a candidate index
  const picks: Record<string, string[]> = {};
  const pickRows = h('div', { class: 'cand-groups' });
  const byPack = new Map<string, HTMLElement[]>();
  for (const [npc, list] of Object.entries(candidates)) {
    if (!Array.isArray(list) || list.length < 2) continue;
    picks[npc] = list;
    const n = npcs.get(npc);
    const role = n ? [n.stance, (n.role ?? '').replace(/^local_/, '').replace(/_/g, ' ')].filter(Boolean).join(' ') : '';
    const who = n?.name ? `${n.name}${role ? `, ${role}` : ''}` : 'Unnamed character';
    const opts = list.map((c, i) => h('label', { class: 'cand-opt', title: c },
      h('input', { type: 'radio', name: `pick_${npc}`, value: String(i) }),
      thumbs[npc]?.[c] ? h('img', { src: src.assetUrl(thumbs[npc][c]), alt: '', width: 80, height: 80 }) : null,
      h('span', { text: `Reference ${i + 1}` })));
    opts.push(h('label', { class: 'cand-opt cand-random' },
      h('input', { type: 'radio', name: `pick_${npc}`, value: 'random', checked: true }), h('span', { text: 'Random' })));
    const pack = n?.pack ?? 'shared';
    if (!byPack.has(pack)) byPack.set(pack, []);
    byPack.get(pack)!.push(h('fieldset', { class: 'cand-row' }, h('legend', { text: who }), h('div', { class: 'cand-opts' }, ...opts)));
  }
  const packOrder = (p: string) => { const i = Object.keys(PACK_NAMES).indexOf(p); return i < 0 ? 99 : i; };
  for (const [pack, rows] of [...byPack].sort((a, b) => packOrder(a[0]) - packOrder(b[0]))) {
    pickRows.append(h('h3', { text: `${PACK_NAMES[pack] ?? pack} pack` }), ...rows);
  }
  /** The candidate id chosen for each character; "random" resolves here, once per room. */
  const readPicks = (): Record<string, string> => Object.fromEntries(Object.entries(picks).map(([npc, list]) => {
    const v = pickRows.querySelector<HTMLInputElement>(`input[name="pick_${npc}"]:checked`)?.value ?? 'random';
    const i = v === 'random' ? rnd(list.length) : Number(v);
    return [npc, list[i] ?? list[0]];
  }));
  const randomize = () => {
    leader.value = pick<Leader>(['enforcement', 'inclusive']);
    usLead.value = pick<LeadPos>(['pro', 'anti']);
    homeLead.value = pick<LeadPos>(['pro', 'anti']);
    seed.value = String(rnd(1_000_000));
    for (const npc of Object.keys(picks)) {
      const r = pickRows.querySelector<HTMLInputElement>(`input[name="pick_${npc}"][value="random"]`);
      if (r) r.checked = true;
    }
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
        h('td', { text: `${r.config.nationalLeader} · ${r.config.maxTalksPerNpcPerDay ?? 1} talk/day` }),
        h('td', { text: (r.config.created ?? '').slice(0, 16).replace('T', ' ') }),
        h('td', { text: status }),
        h('td', { text: String(lines) }),
        h('td', { class: 'r-actions' }, h('button', {
          class: 'btn small', disabled: lines === 0, 'aria-label': `Export log for room ${r.code}`,
          onclick: () => downloadText(`greatvote_${r.code}.jsonl`, readLog(r.code)), text: 'Export log',
        }), h('a', { class: 'r-view', href: appUrl(`logview.html?room=${encodeURIComponent(r.code)}`), 'aria-label': `View log for room ${r.code}`, text: 'View log' }))));
    }
  };

  // Backup and restore (2026-10-19): rooms, saves, logs, the login and the editor's text override are per browser origin
  // (the dev server on 5173 and the preview on 4173 do not share them), so they can be carried across as one JSON file.
  const backupMsg = h('span', { class: 'muted', 'aria-live': 'polite' });
  const exportAll = () => {
    const items: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('gv:')) items[k] = localStorage.getItem(k) ?? '';
    }
    const stamp = isoNow().slice(0, 16).replace(/[:T]/g, '-');
    downloadText(`greatvote_backup_${stamp}.json`, JSON.stringify({ app: 'great-vote', version: 1, exported: isoNow(), origin: location.origin, items }, null, 1), 'application/json');
    backupMsg.textContent = `Exported ${Object.keys(items).length} entries.`;
  };
  const importFile = h('input', { type: 'file', accept: '.json,application/json', id: 'backup-file', 'aria-label': 'Backup file to restore' }) as HTMLInputElement;
  importFile.addEventListener('change', async () => {
    const f = importFile.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data?.app !== 'great-vote' || !data.items || typeof data.items !== 'object') throw new Error('not a Great Vote backup');
      let n = 0, skipped = 0;
      for (const [k, v] of Object.entries(data.items as Record<string, string>)) {
        if (!k.startsWith('gv:') || typeof v !== 'string') { skipped++; continue; }
        // a room's log is appended to, so the longer of the two copies wins; everything else is replaced
        if (k.startsWith('gv:log:')) { const mine = localStorage.getItem(k) ?? ''; if (mine.length > v.length) { skipped++; continue; } }
        localStorage.setItem(k, v);
        n++;
      }
      backupMsg.textContent = `Restored ${n} entries from ${String(data.origin ?? 'another browser')}${skipped ? ` (${skipped} kept as they were)` : ''}.`;
      renderRooms();
    } catch (e) {
      backupMsg.textContent = `Could not restore: ${(e as Error).message}`;
    }
    importFile.value = '';
  });
  const backup = h('div', { class: 'backup' },
    h('h2', { text: 'Backup and restore' }),
    h('p', { class: 'muted', text: 'Everything above as one file: rooms, saves, logs, the remembered login and the editor\'s text changes. Use it to carry a playtest from the dev server to the preview server, or to another browser. Restoring merges: rooms and saves are replaced by the file\'s, a log is replaced only by a longer one.' }),
    h('div', { class: 'backup-row' },
      h('button', { class: 'btn', type: 'button', onclick: exportAll, text: 'Export everything' }),
      h('label', { class: 'btn ghost', for: 'backup-file', text: 'Restore from file\u2026' }), importFile,
      backupMsg));

  const form = h('form', { class: 'card wide' },
    h('h1', { text: 'Create a room' }),
    h('p', { class: 'muted', text: 'Values are randomized; every field can be edited before creating.' + (isFixtures ? ' (fixtures manifest)' : '') }),
    h('div', { class: 'grid2' },
      h('label', { for: 'leader', text: 'National leader condition' }), leader,
      h('label', { for: 'uslead', text: 'US local leader who leads (first among equals)' }), usLead,
      h('label', { for: 'homelead', text: 'Heritage community leader who leads' }), homeLead,
      h('label', { for: 'seed', text: 'Event seed' }), seed,
      h('label', { for: 'note', text: 'Note' }), note,
      h('label', { for: 'talks', text: 'Conversations per person per day' }),
      h('div', {}, talks, h('span', { id: 'talks-help', class: 'muted', text: ' Default 1. After that many, the person shows "Talked already today". Run the checker with --talks N to match.' }))),
    Object.keys(picks).length ? h('h2', { text: 'Roster candidates' }) : null,
    Object.keys(picks).length ? h('p', { class: 'muted', text: 'Candidates are alternative generated reference sheets for the same character; the pick is per room.' }) : null,
    pickRows,
    formErr,
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', type: 'button', onclick: randomize, text: 'Re-randomize' }),
      h('button', { class: 'btn', type: 'submit', text: 'Create room' })),
    result);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    formErr.replaceChildren();
    const maxTalks = Math.floor(Number(talks.value));
    if (!(maxTalks >= 1 && maxTalks <= 8)) {
      formErr.replaceChildren(h('ul', { class: 'errlist' }, h('li', { text: 'Conversations per person per day: a whole number from 1 to 8.' })));
      talks.focus();
      return;
    }
    const code = mintCode();
    const password = `${pick(WORDS)}-${pick(WORDS)}`;
    const config: RoomConfig = {
      code, password,
      nationalLeader: leader.value as Leader,
      usLead: usLead.value as LeadPos,
      homeLead: homeLead.value as LeadPos,
      seed: Math.floor(Number(seed.value) || 0),
      rosterPicks: readPicks(),
      created: isoNow(),
      note: note.value.trim() || undefined,
      maxTalksPerNpcPerDay: maxTalks,
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

  // SPEC "Debug toggle": one switch for this browser; off by default (rooms made here start without debugging aids)
  const dbg = h('input', { id: 'dbg', type: 'checkbox', role: 'switch', checked: getSettings().debug === true });
  const dbgMsg = h('span', { class: 'muted', 'aria-live': 'polite' });
  dbg.addEventListener('change', () => {
    saveSettings({ debug: dbg.checked });
    dbgMsg.textContent = dbg.checked ? ' On: games opened in this browser show the debugging aids.' : ' Off.';
  });
  const settings = h('section', { class: 'card wide' },
    h('h1', { text: 'Settings' }),
    h('label', { class: 'check', for: 'dbg' }, dbg, ' Show debugging aids', dbgMsg),
    h('p', { class: 'muted', text: 'Interactables button and H key, the rule / lean / phase line under the dialogue, rapport and last-talk valence in Contacts, and the figure-size guides. Applies to every game opened in this browser; ?dev=1 always shows them.' }));

  app.replaceChildren(h('div', { class: 'researcher' },
    form,
    h('section', { class: 'card wide' },
      h('h1', { text: 'Rooms on this computer' }),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ...['Code', 'Password', 'Leader', 'Created', 'Status', 'Log lines', ''].map((t) => h('th', { text: t })))),
        table)),
      h('p', { class: 'muted', text: 'Rooms, saves and logs live in this browser\'s localStorage until a server is added.' }),
      backup),
    settings));
  renderRooms();
  window.addEventListener('storage', renderRooms);
}

main().catch((e) => {
  console.error(e);
  app.textContent = String(e);
});
