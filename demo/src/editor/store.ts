/** Override persistence, exactly per SPEC "Researcher editing, overrides and casting":
 *  text in localStorage['gv:override:v1'], images in IndexedDB `gv` / `images`. */

export const OVERRIDE_KEY = 'gv:override:v1';
export const IDB_NAME = 'gv';
export const IDB_STORE = 'images';

export interface Override {
  v: 1;
  updated: string;
  dialogue?: Record<string, string>;
  news?: string;
  events?: string;
  npcs?: string;
  scenes?: string;
}

export interface ImageRecord {
  blob: Blob;
  type: string;
  w: number;
  h: number;
  updated: string;
}

export function readOverride(): Override | null {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || o.v !== 1) return null;
    return o as Override;
  } catch {
    return null;
  }
}

export function writeOverride(o: Override | null): void {
  if (!o) localStorage.removeItem(OVERRIDE_KEY);
  else localStorage.setItem(OVERRIDE_KEY, JSON.stringify(o));
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** Opens `gv` at whatever version exists; adds the `images` store with a version bump only if it is missing,
 *  so the editor never fights the engine over the schema version. */
export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(IDB_STORE)) return resolve(watch(db));
      const v = db.version + 1;
      db.close();
      const up = indexedDB.open(IDB_NAME, v);
      up.onupgradeneeded = () => {
        if (!up.result.objectStoreNames.contains(IDB_STORE)) up.result.createObjectStore(IDB_STORE);
      };
      up.onerror = () => reject(up.error);
      up.onsuccess = () => resolve(watch(up.result));
    };
  });
  return dbPromise;
}

function watch(db: IDBDatabase): IDBDatabase {
  // another tab (the game) may need to upgrade; step aside and reopen on next use
  db.onversionchange = () => {
    db.close();
    dbPromise = null;
  };
  return db;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(IDB_STORE, mode);
        const r = fn(t.objectStore(IDB_STORE));
        t.oncomplete = () => resolve(r ? r.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export async function listImages(): Promise<Map<string, ImageRecord>> {
  const out = new Map<string, ImageRecord>();
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(IDB_STORE, 'readonly');
    const req = t.objectStore(IDB_STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      const v = c.value as ImageRecord;
      if (v && v.blob instanceof Blob) out.set(String(c.key), v);
      c.continue();
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  return out;
}

export const putImage = (key: string, rec: ImageRecord) => tx('readwrite', (s) => s.put(rec, key)).then(() => undefined);
export const deleteImage = (key: string) => tx('readwrite', (s) => s.delete(key)).then(() => undefined);
export const clearImages = () => tx('readwrite', (s) => s.clear()).then(() => undefined);
