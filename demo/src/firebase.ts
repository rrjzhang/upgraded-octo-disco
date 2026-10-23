/**
 * Firebase log upload, a proof of concept (SPEC "Firebase log upload (proof of concept)"). Every log line is also
 * queued here and sent to Firestore in chunks under an anonymous Firebase user. The SDK is imported lazily, on the
 * first flush, so the game's first load is not slowed. Any failure is quiet: one console warning, the game carries on,
 * the queue stays and the next flush tries again. Temporary: to be replaced by the real backend.
 */
import type { GameState } from './types';
import type { LogLine } from './store';
import { lsGet, lsSet, params } from './util';

const CONFIG = {
  apiKey: 'AIzaSyAHz-5jPpzwPWZjEzFn4TfE-tAgEMYtEFo',
  authDomain: 'the-great-vote-8571.firebaseapp.com',
  projectId: 'the-great-vote-8571',
  storageBucket: 'the-great-vote-8571.firebasestorage.app',
  messagingSenderId: '449587037652',
  appId: '1:449587037652:web:11ce886569612bfcb88241',
};

/** Lines not yet acknowledged by Firestore, each with its per-browser sequence number. */
const QUEUE_KEY = 'gv:fb:queue';
/** Next sequence number to hand out. */
const SEQ_KEY = 'gv:fb:seq';
/** Count of lines Firestore has acknowledged (survives reloads; shown on the dev status line). */
const SENT_KEY = 'gv:fb:sent';
/** Uid whose `sessions/{uid}` doc already has `started` (so a reload does not move it). */
const STARTED_KEY = 'gv:fb:started';

const CHUNK = 500;
const DEBOUNCE_MS = 3000;

interface Queued { seq: number; line: LogLine }

/** On by default; off under ?dev=1 (the fuzz walker) unless ?fb=1; ?fb=0 turns it off. The public build ignores ?dev. */
export const fbEnabled = ((): boolean => {
  const fb = params.get('fb');
  if (fb === '0') return false;
  if (fb === '1') return true;
  return import.meta.env.VITE_PUBLIC === '1' || params.get('dev') !== '1';
})();

let meta: Record<string, unknown> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let busy = false;
let again = false;
let warned = false;
let sessionWritten = false;
let listening = false;
let api: Promise<Api> | null = null;

type Api = {
  uid: string;
  db: import('firebase/firestore/lite').Firestore;
  fs: Pick<typeof import('./firebase-sdk'), 'setDoc' | 'doc' | 'serverTimestamp'>;
};

/** Lines Firestore has accepted from this browser (dev status line). */
export function fbSent(): number {
  return lsGet<number>(SENT_KEY, 0);
}

/** Called by appendLog for every line. */
export function fbLog(s: GameState, line: LogLine): void {
  if (!fbEnabled) return;
  meta = sessionMeta(s);
  const seq = lsGet<number>(SEQ_KEY, 0);
  const q = lsGet<Queued[]>(QUEUE_KEY, []);
  q.push({ seq, line });
  lsSet(QUEUE_KEY, q);
  lsSet(SEQ_KEY, seq + 1);
  listen();
  schedule(DEBOUNCE_MS);
}

/** On boot: send whatever an earlier page load left unsent. */
export function fbBoot(): void {
  if (!fbEnabled) return;
  listen();
  if (lsGet<Queued[]>(QUEUE_KEY, []).length) schedule(DEBOUNCE_MS);
}

function listen(): void {
  if (listening) return;
  listening = true;
  // best effort: a write started while the page is going away may or may not reach the server
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') schedule(0); });
  window.addEventListener('pagehide', () => schedule(0));
}

function schedule(ms: number): void {
  clearTimeout(timer);
  timer = setTimeout(() => { void flush(); }, ms);
}

function sessionMeta(s: GameState): Record<string, unknown> {
  const c = s.config;
  const m: Record<string, unknown> = {
    room: s.room,
    playerName: s.player?.name,
    pack: s.player?.pack,
    homeCulture: s.player?.homeCulture,
    heritage: s.player?.heritage,
    language: s.player?.language,
    nationalLeader: c?.nationalLeader,
    usLead: c?.usLead,
    homeLead: c?.homeLead,
    seed: c?.seed,
  };
  for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
  return m;
}

/** Firestore refuses an array directly inside an array (a `delta` of a list, for one): such inner arrays are stored as
 *  their JSON text, so one odd line cannot block the queue for good. */
function firestoreSafe(v: unknown, inArray = false): unknown {
  if (Array.isArray(v)) return inArray ? JSON.stringify(v) : v.map((x) => firestoreSafe(x, true));
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = firestoreSafe(x);
    return o;
  }
  return v;
}

function connect(): Promise<Api> {
  if (!api) {
    api = (async () => {
      const { initializeApp, setLogLevel, initializeAuth, browserLocalPersistence, signInAnonymously, initializeFirestore, setDoc, doc, serverTimestamp } = await import('./firebase-sdk');
      setLogLevel('silent'); // the SDK's own console noise; flush() warns once itself
      const app = initializeApp(CONFIG);
      // initializeAuth without a popup/redirect resolver keeps the auth bundle small; the uid persists in localStorage
      const a = initializeAuth(app, { persistence: browserLocalPersistence });
      await a.authStateReady();
      const user = a.currentUser ?? (await signInAnonymously(a)).user;
      const fs = { setDoc, doc, serverTimestamp };
      return { uid: user.uid, db: initializeFirestore(app, { ignoreUndefinedProperties: true }), fs };
    })();
    api.catch(() => { api = null; });
  }
  return api;
}

async function flush(): Promise<void> {
  if (busy) { again = true; return; }
  busy = true;
  try {
    let q = lsGet<Queued[]>(QUEUE_KEY, []);
    if (!q.length) return;
    const { uid, db, fs } = await connect();
    if (!sessionWritten) {
      const doc: Record<string, unknown> = { ...(meta ?? { room: q[q.length - 1].line.room }), userAgent: navigator.userAgent, site: location.host, updated: fs.serverTimestamp() };
      if (lsGet<string>(STARTED_KEY, '') !== uid) doc.started = fs.serverTimestamp();
      await fs.setDoc(fs.doc(db, 'sessions', uid), doc, { merge: true });
      lsSet(STARTED_KEY, uid);
      sessionWritten = true;
    }
    while (q.length) {
      const part = q.slice(0, CHUNK);
      const from = part[0].seq, to = part[part.length - 1].seq;
      // the doc id is the first seq: a resend after a lost ack rewrites the same doc with the same (or more) lines
      await fs.setDoc(fs.doc(db, 'sessions', uid, 'chunks', String(from).padStart(8, '0')),
        { lines: part.map((p) => firestoreSafe(p.line)), from, to, at: fs.serverTimestamp() });
      q = lsGet<Queued[]>(QUEUE_KEY, []).filter((p) => p.seq > to);
      lsSet(QUEUE_KEY, q);
      lsSet(SENT_KEY, fbSent() + part.length);
    }
  } catch (e) {
    if (!warned) { warned = true; console.warn('[fb] log upload failed; will retry on the next flush', e); }
  } finally {
    busy = false;
    if (again) { again = false; schedule(DEBOUNCE_MS); }
  }
}
