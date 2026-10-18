/** researcher.html: create rooms, list them, export logs. */
import './style.css';
import { getSource, questionnaireProblems } from './content';
import { getSettings, listRooms, loadState, readLog, saveRoom, saveSettings, getRoom, type RoomRecord } from './store';
import type { Leader, Questionnaire, RoomConfig } from './types';
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
  const qJson = h('textarea', {
    id: 'qjson', class: 'q-json mono', rows: 6, spellcheck: 'false',
    placeholder: 'Optional. Paste questionnaire JSON (same schema as content/questionnaire/eod.json) to replace the bundled end-of-day survey for this room.',
  });
  const qUrl = h('input', { id: 'qurl', type: 'text', placeholder: 'optional, e.g. https://example.org/eod.json or /content/questionnaire/eod.json' });
  const qErr = h('div', { class: 'err', role: 'alert' });
  /** Parses and checks the questionnaire fields; returns the config additions, or null after showing the problems. */
  const readQuestionnaire = (): Pick<RoomConfig, 'questionnaire' | 'questionnaireUrl'> | null => {
    qErr.replaceChildren();
    const out: Pick<RoomConfig, 'questionnaire' | 'questionnaireUrl'> = {};
    const problems: string[] = [];
    const raw = qJson.value.trim();
    if (raw) {
      let q: unknown;
      try { q = JSON.parse(raw); } catch (e) { problems.push(`Questionnaire JSON: ${(e as Error).message}`); }
      if (q !== undefined) {
        const p = questionnaireProblems(q);
        if (p.length) problems.push(...p.map((x) => `Questionnaire JSON: ${x}`));
        else out.questionnaire = q as Questionnaire;
      }
    }
    const url = qUrl.value.trim();
    if (url) {
      try { new URL(url, location.origin); out.questionnaireUrl = url; } catch { problems.push(`Questionnaire URL: not a valid URL`); }
    }
    if (problems.length) {
      qErr.append(h('ul', { class: 'errlist' }, ...problems.slice(0, 20).map((p) => h('li', { text: p }))));
      (raw && problems.some((p) => p.startsWith('Questionnaire JSON')) ? qJson : qUrl).focus();
      return null;
    }
    return out;
  };
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
        h('td', { class: 'r-actions' }, h('button', {
          class: 'btn small', disabled: lines === 0, 'aria-label': `Export log for room ${r.code}`,
          onclick: () => downloadText(`greatvote_${r.code}.jsonl`, readLog(r.code)), text: 'Export log',
        }), h('a', { class: 'r-view', href: appUrl(`logview.html?room=${encodeURIComponent(r.code)}`), 'aria-label': `View log for room ${r.code}`, text: 'View log' }))));
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
    h('h2', { text: 'End-of-day questionnaire' }),
    h('p', { class: 'muted', text: 'Leave both empty to use the bundled BIIS-2 check-in. A questionnaire from the study server, when there is one, still takes precedence.' }),
    h('label', { for: 'qjson', text: 'Questionnaire JSON' }), qJson,
    h('label', { for: 'qurl', text: 'Questionnaire URL (used when no JSON is pasted)' }), qUrl,
    qErr,
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', type: 'button', onclick: randomize, text: 'Re-randomize' }),
      h('button', { class: 'btn', type: 'submit', text: 'Create room' })),
    result);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = readQuestionnaire();
    if (!q) return;
    const code = mintCode();
    const password = `${pick(WORDS)}-${pick(WORDS)}`;
    const config: RoomConfig = {
      code, password,
      nationalLeader: leader.value as Leader,
      seed: Math.floor(Number(seed.value) || 0),
      rosterPicks: Object.fromEntries(Object.entries(picks).map(([k, s]) => [k, s.value])),
      created: isoNow(),
      note: note.value.trim() || undefined,
      ...q,
    };
    const rec: RoomRecord = { code, password, config };
    saveRoom(rec);
    const link = `${location.origin}/?room=${code}${isFixtures ? '&fixtures=1' : ''}`;
    result.replaceChildren(
      h('p', {}, 'Room ', h('strong', { class: 'mono', text: code }), ' password ', h('strong', { class: 'mono', text: password })),
      h('p', { class: 'muted' }, 'Participant link: ', h('a', { href: link, text: link })));
    randomize();
    qJson.value = ''; qUrl.value = '';
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
      h('p', { class: 'muted', text: 'Rooms, saves and logs live in this browser\'s localStorage until a server is added.' })),
    settings));
  renderRooms();
  window.addEventListener('storage', renderRooms);
}

main().catch((e) => {
  console.error(e);
  app.textContent = String(e);
});
