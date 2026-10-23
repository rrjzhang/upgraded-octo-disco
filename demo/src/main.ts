/** index.html: room entry -> character setup -> game. */
import './style.css';
import { effectivePack, getSource, loadContent } from './content';
import { Game } from './game';
import { fbBoot } from './firebase';
import { appendLog, getRoom, loadState, logKey, newState, saveRoom, saveState, stateKey, type RoomRecord } from './store';
import type { Content, CultureId, Leader, LeadPos, PlayerInfo, RoomConfig } from './types';
import { h, isDev, isFixtures, isoNow, params } from './util';

const app = document.getElementById('app')!;

function fatal(msg: string, detail: string[] = []): void {
  app.replaceChildren(h('div', { class: 'form-page' }, h('div', { class: 'card' },
    h('h1', { text: 'Could not start' }), h('p', { text: msg }),
    detail.length ? h('ul', { class: 'errlist' }, ...detail.slice(0, 30).map((d) => h('li', { text: d }))) : null)));
}

// SPEC "Full screen": browsers grant requestFullscreen only on a user gesture, so the game asks once per page load, on
// the player's first deliberate click into it (Enter / Continue on the room form, or the first click on the stage when
// the page resumes straight into a room). A refusal (headless, permissions, old browser) is silent; leaving full screen
// with Esc is respected (no second attempt). `&fullscreen=0` turns it off.
let fsTried = false;
function goFullscreen(): void {
  if (fsTried) return;
  fsTried = true;
  const el = document.documentElement;
  if (params.get('fullscreen') === '0' || document.fullscreenElement || typeof el.requestFullscreen !== 'function') return;
  try { el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); } catch { /* a synchronous throw in an old browser */ }
}
/** Resuming straight into a room: the first click anywhere (capture, so it runs inside the gesture) asks for full screen. */
function fullscreenOnFirstClick(): void {
  const once = (): void => { document.removeEventListener('click', once, true); goFullscreen(); };
  document.addEventListener('click', once, true);
}

function startGame(content: Content, room: RoomRecord, player?: PlayerInfo): void {
  let state = loadState(room.code);
  if (!state) {
    if (!player) throw new Error('no player info');
    state = newState(content, room, player);
    saveState(state);
    appendLog(state, { type: 'start', target: 'game', player, config: room.config, content: content.source });
  }
  // dev: &culture= on an existing save switches it (the Game recomputes the effective pack on load)
  if (isDev && player && params.get('culture') && state.player.homeCulture !== player.homeCulture) state.player.homeCulture = player.homeCulture;
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
  // the home culture is no longer asked here: the phone asks the heritage question (and its follow-ups) when the game
  // opens (SPEC "Profile questions and variant words")
  const lang = h('select', { id: 'plang' },
    ...['English', 'Mandarin Chinese', 'Spanish', 'Hindi', 'Other'].map((l) => h('option', { value: l, text: l })));
  const elig = h('input', { id: 'pelig', type: 'checkbox' });
  const err = h('p', { class: 'err', role: 'alert' });
  const form = h('form', { class: 'card' },
    h('h1', { text: 'Your character' }),
    h('p', { class: 'muted', text: `Room ${room.code}` }),
    h('label', { for: 'pname', text: 'Display name' }), name,
    h('label', { for: 'plang', text: 'Language you mostly speak at home (recorded only)' }), lang,
    h('label', { class: 'check' }, elig, ' I confirm I am eligible to take part in this study and agree to my choices being recorded.'),
    err,
    h('button', { class: 'btn', type: 'submit', text: 'Begin' }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!name.value.trim()) { err.textContent = 'Please enter a display name.'; name.focus(); return; }
    if (!elig.checked) { err.textContent = 'Please confirm eligibility to continue.'; elig.focus(); return; }
    startGame(content, room, { name: name.value.trim(), homeCulture: 'cn', pack: 'cn', language: lang.value, eligible: true, profilePending: true });
  });
  app.replaceChildren(h('div', { class: 'form-page' }, form));
  name.focus();
}

function roomForm(content: Content): void {
  // ?room=CODE&pw=word-word (the researcher page's "Open the game" link) fills both fields; nothing is submitted, so the
  // reviewer sees the form and the Enter press is the gesture full screen needs
  const code = h('input', { id: 'rcode', type: 'text', maxlength: 4, autocomplete: 'off', value: (params.get('room') ?? '').trim().toUpperCase(), style: 'text-transform:uppercase' });
  const pw = h('input', { id: 'rpw', type: 'text', autocomplete: 'off', value: (params.get('pw') ?? '').trim() });
  const enterBtn = h('button', { class: 'btn', type: 'submit', text: 'Enter' });
  const err = h('p', { class: 'err', role: 'alert' });
  const form = h('form', { class: 'card' },
    h('h1', { text: 'The Great Vote' }),
    h('p', { class: 'muted', text: 'Enter the room code and password your researcher gave you.' }),
    h('label', { for: 'rcode', text: 'Room code' }), code,
    h('label', { for: 'rpw', text: 'Password' }), pw,
    err,
    enterBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const c = code.value.trim().toUpperCase();
    const room = getRoom(c);
    if (!room) {
      err.textContent = `No room "${c}" on this computer. Rooms are kept in the browser that created them: open the game from the researcher page in this same browser.`;
      return;
    }
    if (room.password.trim().toLowerCase() !== pw.value.trim().toLowerCase()) { err.textContent = 'Wrong password.'; return; }
    goFullscreen();
    enter(content, room);
  });
  // a room entered before on this browser can be re-entered without the password (SPEC "Study administration")
  const last = rememberedRoom();
  if (last && getRoom(last)) {
    form.append(h('p', { class: 'muted', style: 'margin-top:14px' }, 'Back again? ',
      h('button', { class: 'btn ghost', type: 'button', text: `Continue in room ${last}`, onclick: () => { goFullscreen(); enter(content, getRoom(last)!); } })));
  }
  app.replaceChildren(h('div', { class: 'form-page' }, form));
  (code.value && pw.value ? enterBtn : code.value ? pw : code).focus();
}

const LOGIN_KEY = 'gv:login';
/** The room entered in this tab (sessionStorage: survives a refresh, not a new tab) or on this browser (localStorage, for the Continue button). */
function rememberedRoom(): string | null {
  try { return sessionStorage.getItem(LOGIN_KEY) || localStorage.getItem(LOGIN_KEY); } catch { return null; }
}
function enter(content: Content, room: RoomRecord): void {
  try { sessionStorage.setItem(LOGIN_KEY, room.code); localStorage.setItem(LOGIN_KEY, room.code); } catch { /* private mode */ }
  if (loadState(room.code)) startGame(content, room);
  else setupForm(content, room);
}

async function main(): Promise<void> {
  // researcher edits (SPEC "Researcher editing, overrides and casting"); &nooverride=1 loads the bundled files only
  const content = await loadContent(await getSource(isFixtures), { override: params.get('nooverride') !== '1' });
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
    // SPEC "Leads": &uslead=pro|anti and &homelead=pro|anti pick the first-among-equals on each side (default pro)
    const usLead: LeadPos = params.get('uslead') === 'anti' ? 'anti' : 'pro';
    const homeLead: LeadPos = params.get('homelead') === 'anti' ? 'anti' : 'pro';
    let room = getRoom(code);
    const stale = (c: RoomConfig) => c.nationalLeader !== leader || (c.usLead ?? 'pro') !== usLead || (c.homeLead ?? 'pro') !== homeLead;
    if (!room || stale(room.config)) {
      room = { code, password: 'dev', config: { code, password: 'dev', nationalLeader: leader, usLead, homeLead, seed: 1234, rosterPicks: {}, created: isoNow(), note: 'dev room' } };
      saveRoom(room);
      const st = loadState(code);
      if (st && stale(st.config)) { st.config = room.config; saveState(st); }
    }
    // &culture=cn|mx|in skips the opening questions (&region=, &faith= set the variant); &profile=1 asks them
    const culture = (['cn', 'mx', 'in'].includes(params.get('culture') ?? '') ? params.get('culture') : 'cn') as CultureId;
    const variant: Record<string, string> = {};
    for (const dim of ['region', 'faith']) if (params.get(dim)) variant[dim] = params.get(dim)!;
    fullscreenOnFirstClick();
    startGame(content, room, {
      name: params.get('name') ?? 'Alex', homeCulture: culture, pack: effectivePack(content, culture), language: 'English', eligible: true,
      heritage: culture, variant, profilePending: params.get('profile') === '1',
    });
    return;
  }
  // a refresh in the same tab goes straight back into the room (SPEC "Study administration")
  let remembered: string | null = null;
  try { remembered = sessionStorage.getItem(LOGIN_KEY); } catch { /* private mode */ }
  // ...unless the address names another room (an "Open the game" link for a different room): then the form, prefilled
  const asked = (params.get('room') ?? '').trim().toUpperCase();
  if (remembered && getRoom(remembered) && (!asked || asked === remembered)) { fullscreenOnFirstClick(); enter(content, getRoom(remembered)!); return; }
  roomForm(content);
}

fbBoot();
main().catch((e) => {
  console.error(e);
  fatal(String(e?.message ?? e));
});
