/** localStorage-backed rooms, game state and the append-only action log. */
import type { Content, GameState, PlayerInfo, RoomConfig } from './types';
import { DAY_ACTIONS, START_WALLET, leanOf } from './rules';
import { appUrl, isDev, isoNow, lsGet, lsSet } from './util';

/** Per-browser settings, written by the researcher page (SPEC "Debug toggle"). */
export const SETTINGS_KEY = 'gv:settings';
export interface Settings { debug?: boolean }
export function getSettings(): Settings {
  const s = lsGet<Settings | null>(SETTINGS_KEY, null);
  return s && typeof s === 'object' ? s : {};
}
export function saveSettings(patch: Settings): Settings {
  const next = { ...getSettings(), ...patch };
  lsSet(SETTINGS_KEY, next);
  return next;
}
/** Debugging aids are on with ?dev=1 (forced for that tab) or when the researcher switched them on; off by default. */
export function debugEnabled(): boolean {
  return isDev || getSettings().debug === true;
}

export const roomKey = (code: string) => `gv:room:${code}`;
export const stateKey = (code: string) => `gv:state:${code}`;
export const logKey = (code: string) => `gv:log:${code}`;

export interface RoomRecord { code: string; password: string; config: RoomConfig }

export function getRoom(code: string): RoomRecord | null {
  return lsGet<RoomRecord | null>(roomKey(code), null);
}

export function saveRoom(rec: RoomRecord): void {
  lsSet(roomKey(rec.code), rec);
}

export function listRooms(): RoomRecord[] {
  const out: RoomRecord[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('gv:room:')) {
        const r = lsGet<RoomRecord | null>(k, null);
        if (r) out.push(r);
      }
    }
  } catch { /* storage blocked */ }
  return out.sort((a, b) => (b.config.created ?? '').localeCompare(a.config.created ?? ''));
}

export function loadState(code: string): GameState | null {
  const s = lsGet<GameState | null>(stateKey(code), null);
  return s && s.v === 1 ? s : null;
}

export function saveState(s: GameState): void {
  lsSet(stateKey(s.room), s);
}

export function newState(content: Content, room: RoomRecord, player: PlayerInfo): GameState {
  const npcs: GameState['npcs'] = {};
  for (const n of content.npcs) npcs[n.id] = { ...n.initial };
  return {
    v: 1,
    room: room.code,
    config: room.config,
    player,
    day: 1,
    actions: DAY_ACTIONS,
    wallet: START_WALLET,
    walletLog: [],
    scene: 'home',
    npcs,
    spent: { home: 0, us: 0, neutral: 0 },
    invites: [],
    fired: [],
    seenNews: [],
    entries: {},
    journal: '',
    dayStartDone: 0,
    finished: false,
    started: isoNow(),
  };
}

export interface LogLine {
  t: string;
  room: string;
  day: number;
  actions: number;
  type: 'dialogue' | 'choice' | 'event' | 'hotspot' | 'move' | 'window' | 'survey' | 'journal' | 'day_end' | 'start' | 'conversation';
  scene: string;
  target?: string;
  rule?: string;
  choice?: number;
  delta?: Record<string, [unknown, unknown]>;
  lean: string;
  [k: string]: unknown;
}

export function readLog(code: string): string {
  try {
    return localStorage.getItem(logKey(code)) ?? '';
  } catch {
    return '';
  }
}

export function appendLog(s: GameState, line: Omit<LogLine, 't' | 'room' | 'day' | 'actions' | 'scene' | 'lean'> & Partial<LogLine>): LogLine {
  const full: LogLine = {
    t: isoNow(),
    room: s.room,
    day: s.day,
    actions: s.actions,
    scene: s.scene,
    lean: leanOf(s.spent),
    ...line,
  } as LogLine;
  for (const k of Object.keys(full)) if (full[k] === undefined) delete full[k];
  const json = JSON.stringify(full);
  try {
    const key = logKey(s.room);
    const prev = localStorage.getItem(key) ?? '';
    localStorage.setItem(key, prev + json + '\n');
  } catch (e) {
    console.warn('[log] localStorage append failed', e);
  }
  try {
    fetch(appUrl('api/log'), { method: 'POST', body: json, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
  } catch { /* ignore */ }
  return full;
}
