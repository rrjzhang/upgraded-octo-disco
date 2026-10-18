/** index.html: room entry -> character setup -> game. */
import './style.css';
import { getSource, loadContent } from './content';
import { Game } from './game';
import { appendLog, getRoom, loadState, logKey, newState, saveRoom, saveState, stateKey, type RoomRecord } from './store';
import type { Content, CultureId, Leader, PlayerInfo } from './types';
import { h, isDev, isFixtures, isoNow, params } from './util';

const app = document.getElementById('app')!;

function fatal(msg: string, detail: string[] = []): void {
  app.replaceChildren(h('div', { class: 'form-page' }, h('div', { class: 'card' },
    h('h1', { text: 'Could not start' }), h('p', { text: msg }),
    detail.length ? h('ul', { class: 'errlist' }, ...detail.slice(0, 30).map((d) => h('li', { text: d }))) : null)));
}

function startGame(content: Content, room: RoomRecord, player?: PlayerInfo): void {
  let state = loadState(room.code);
  if (!state) {
    if (!player) throw new Error('no player info');
    state = newState(content, room, player);
    saveState(state);
    appendLog(state, { type: 'start', target: 'game', player, config: room.config, content: content.source });
  }
  // NPCs added to content after the save was made get their initial state.
  for (const n of content.npcs) if (!state.npcs[n.id]) state.npcs[n.id] = { ...n.initial };
  document.body.classList.add('in-game');
  const game = new Game(app, content, state);
  if (isDev || isFixtures) (window as any).gv = game.devApi();
  if (isDev && params.get('eod')) game.devEod = params.get('eod');
  game.start();
}

function setupForm(content: Content, room: RoomRecord): void {
  const name = h('input', { id: 'pname', type: 'text', required: true, maxlength: 40, autocomplete: 'off' });
  const cultures: [CultureId, string][] = [['cn', 'China'], ['mx', 'Mexico'], ['in', 'India']];
  const radios = h('fieldset', { class: 'radios' }, h('legend', { text: 'Home culture' }),
    ...cultures.map(([id, label], i) => h('label', {},
      h('input', { type: 'radio', name: 'culture', value: id, checked: i === 0 }), ` ${label}`,
      id !== 'cn' ? h('span', { class: 'muted', text: ' (pack not in demo; China roster used)' }) : null)));
  const lang = h('select', { id: 'plang' },
    ...['English', 'Mandarin Chinese', 'Spanish', 'Hindi', 'Other'].map((l) => h('option', { value: l, text: l })));
  const elig = h('input', { id: 'pelig', type: 'checkbox' });
  const err = h('p', { class: 'err', role: 'alert' });
  const form = h('form', { class: 'card' },
    h('h1', { text: 'Your character' }),
    h('p', { class: 'muted', text: `Room ${room.code}` }),
    h('label', { for: 'pname', text: 'Display name' }), name,
    radios,
    h('label', { for: 'plang', text: 'Language you mostly speak at home (recorded only)' }), lang,
    h('label', { class: 'check' }, elig, ' I confirm I am eligible to take part in this study and agree to my choices being recorded.'),
    err,
    h('button', { class: 'btn', type: 'submit', text: 'Begin' }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!name.value.trim()) { err.textContent = 'Please enter a display name.'; name.focus(); return; }
    if (!elig.checked) { err.textContent = 'Please confirm eligibility to continue.'; elig.focus(); return; }
    const culture = (form.querySelector<HTMLInputElement>('input[name=culture]:checked')?.value ?? 'cn') as CultureId;
    startGame(content, room, { name: name.value.trim(), homeCulture: culture, pack: 'cn', language: lang.value, eligible: true });
  });
  app.replaceChildren(h('div', { class: 'form-page' }, form));
  name.focus();
}

function roomForm(content: Content): void {
  const code = h('input', { id: 'rcode', type: 'text', maxlength: 4, autocomplete: 'off', value: params.get('room') ?? '', style: 'text-transform:uppercase' });
  const pw = h('input', { id: 'rpw', type: 'text', autocomplete: 'off' });
  const err = h('p', { class: 'err', role: 'alert' });
  const form = h('form', { class: 'card' },
    h('h1', { text: 'The Great Vote' }),
    h('p', { class: 'muted', text: 'Enter the room code and password your researcher gave you.' }),
    h('label', { for: 'rcode', text: 'Room code' }), code,
    h('label', { for: 'rpw', text: 'Password' }), pw,
    err,
    h('button', { class: 'btn', type: 'submit', text: 'Enter' }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const c = code.value.trim().toUpperCase();
    const room = getRoom(c);
    if (!room) { err.textContent = `No room "${c}" on this computer.`; return; }
    if (room.password.trim().toLowerCase() !== pw.value.trim().toLowerCase()) { err.textContent = 'Wrong password.'; return; }
    if (loadState(c)) startGame(content, room);
    else setupForm(content, room);
  });
  app.replaceChildren(h('div', { class: 'form-page' }, form));
  (code.value ? pw : code).focus();
}

async function main(): Promise<void> {
  const content = await loadContent(await getSource(isFixtures));
  if (!content.scenes.length || !content.sceneById.has('home')) {
    fatal('Content failed to load (see the browser console for file and row details).', content.errors);
    return;
  }
  if (isDev) {
    const code = isFixtures ? 'DEVF' : 'DEV1';
    if (params.get('reset') === '1') {
      localStorage.removeItem(stateKey(code));
      localStorage.removeItem(logKey(code));
      // drop reset=1 from the address so a later reload (F5, dev-server HMR) resumes the save instead of wiping it again
      const u = new URL(location.href);
      u.searchParams.delete('reset');
      history.replaceState(null, '', u);
    }
    const leader: Leader = params.get('leader') === 'inclusive' ? 'inclusive' : 'enforcement';
    let room = getRoom(code);
    if (!room || room.config.nationalLeader !== leader) {
      room = { code, password: 'dev', config: { code, password: 'dev', nationalLeader: leader, seed: 1234, rosterPicks: {}, created: isoNow(), note: 'dev room' } };
      saveRoom(room);
      const st = loadState(code);
      if (st && st.config.nationalLeader !== leader) { st.config = room.config; saveState(st); }
    }
    const culture = (['cn', 'mx', 'in'].includes(params.get('culture') ?? '') ? params.get('culture') : 'cn') as CultureId;
    startGame(content, room, { name: params.get('name') ?? 'Alex', homeCulture: culture, pack: 'cn', language: 'English', eligible: true });
    return;
  }
  roomForm(content);
}

main().catch((e) => {
  console.error(e);
  fatal(String(e?.message ?? e));
});
