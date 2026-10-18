/** Editor state: bundled content, the saved override, and the working copy. */
import { load as loadYaml } from 'js-yaml';
import { DIALOGUE_COLUMNS, DIALOGUE_OPTIONAL, EVENT_COLUMNS, NEWS_COLUMNS, EVENT_OPTIONAL, NEWS_OPTIONAL } from '../../tools/checker/core.mjs';
import { parseTable, serialize, cloneTable, type Table } from './csv';
import { appUrl } from '../util';
import { readOverride, writeOverride, listImages, putImage, deleteImage, clearImages, type Override, type ImageRecord } from './store';

export type DocKind = 'dialogue' | 'events' | 'news';

export interface Doc {
  /** content path, relative to /content/ (and the checker's file key) */
  path: string;
  kind: DocKind;
  npc?: string;
  expected: string[];
  optional: string[];
  /** bundled text; null when the game ships no such file */
  bundled: string | null;
  bundledCanon: string | null;
  /** canonical text as last saved (override if present, else bundled) */
  savedCanon: string | null;
  table: Table | null;
}

export interface NpcInfo {
  id: string;
  name: string;
  role: string;
  portrait: string;
  figure?: string;
  seated: boolean;
  /** scenes the NPC has an appearance in (the dialogue `scene` cell offers these first) */
  scenes: string[];
  /** per-appearance figure asset -> scenes it is used in */
  appearanceFigures: Map<string, string[]>;
}
export interface SceneInfo {
  id: string;
  name: string;
  background: string;
  painted?: string;
}

export interface Manifest {
  backgrounds?: Record<string, { file: string; w?: number; h?: number }>;
  portraits?: Record<string, Record<string, unknown>>;
  figures?: Record<string, { file: string; w?: number; h?: number; placeholder?: boolean }>;
  tv?: Record<string, string[]>;
  tvMeta?: Record<string, { placeholder?: boolean; w?: number; h?: number }>;
  cast?: Record<string, { name?: string; role?: string; bust?: string | null; tv?: string | null; ref?: string | null }>;
  aliases?: Record<string, string>;
  [k: string]: unknown;
}

export async function fetchText(path: string): Promise<string | null> {
  try {
    const res = await fetch(appUrl(path), { cache: 'no-cache' });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    const body = await res.text();
    // Vite answers unknown paths with index.html; that means "missing"
    if (ct.includes('text/html') || /^\s*<!doctype html/i.test(body)) return null;
    return body;
  } catch {
    return null;
  }
}

const listOf = (text: string | null, key: string): any[] => {
  if (!text) return [];
  try {
    const d: any = loadYaml(text);
    return Array.isArray(d?.[key]) ? d[key] : [];
  } catch {
    return [];
  }
};

export class Model {
  docs = new Map<string, Doc>();
  npcs: NpcInfo[] = [];
  scenes: SceneInfo[] = [];
  manifest: Manifest = {};
  manifestText: string | null = null;
  /** yaml texts the checker needs (override replaces bundled, as in the game) */
  scenesText: string | null = null;
  npcsText: string | null = null;
  /** override keys the editor does not manage (npcs, scenes, sheets of unknown NPCs): kept on save */
  keep: Partial<Override> = {};
  /** cast ids/names from content/cast.yaml (optional; the manifest's cast table is the other source) */
  castIds: string[] = [];
  castText: string | null = null;
  castNames = new Map<string, string>();
  overrideActive = false;
  savedUpdated: string | null = null;
  /** images in IndexedDB, and staged changes (null = delete on save) */
  storedImages = new Map<string, ImageRecord>();
  pendingImages = new Map<string, ImageRecord | null>();
  onChange: () => void = () => {};

  async load(): Promise<void> {
    const ov = readOverride();
    this.overrideActive = !!ov;
    this.savedUpdated = ov?.updated ?? null;
    const [scenesB, npcsB, eventsB, newsB, manifestText, castText] = await Promise.all([
      fetchText('content/scenes.yaml'), fetchText('content/npcs.yaml'), fetchText('content/events.csv'),
      fetchText('content/news.csv'), fetchText('assets/manifest.json'), fetchText('content/cast.yaml'),
    ]);
    this.castText = castText;
    let castList: any[] = [];
    try { const d: any = castText ? loadYaml(castText) : null; castList = Array.isArray(d) ? d : Array.isArray(d?.cast) ? d.cast : []; } catch { castList = []; }
    this.castIds = castList.filter((c) => c?.id).map((c) => String(c.id));
    this.castNames = new Map(castList.filter((c) => c?.id && c.name).map((c) => [String(c.id), String(c.name)]));
    this.manifestText = manifestText;
    try {
      this.manifest = manifestText ? JSON.parse(manifestText) : {};
    } catch {
      this.manifest = {};
    }
    this.scenesText = ov?.scenes ?? scenesB;
    this.npcsText = ov?.npcs ?? npcsB;
    this.keep = {};
    if (ov?.scenes != null) this.keep.scenes = ov.scenes;
    if (ov?.npcs != null) this.keep.npcs = ov.npcs;
    this.npcs = listOf(this.npcsText, 'npcs').filter((n) => n?.id).map((n) => ({
      id: String(n.id), name: String(n.name ?? n.id), role: String(n.role ?? ''), portrait: String(n.portrait ?? `ch_${n.id}`),
      figure: n.figure ? String(n.figure) : undefined, seated: n.seated === true,
      scenes: [...new Set<string>((Array.isArray(n.appearances) ? n.appearances : []).filter((a: any) => a?.scene).map((a: any) => String(a.scene)))],
      appearanceFigures: (Array.isArray(n.appearances) ? n.appearances : []).filter((a: any) => a?.figure).reduce((m: Map<string, string[]>, a: any) => {
        const f = String(a.figure);
        m.set(f, [...(m.get(f) ?? []), String(a.scene)]);
        return m;
      }, new Map<string, string[]>()),
    }));
    this.scenes = listOf(this.scenesText, 'scenes').filter((s) => s?.id).map((s) => ({
      id: String(s.id), name: String(s.name ?? s.id), background: String(s.background ?? 'none'),
      painted: s.painted?.background ? String(s.painted.background) : undefined,
    }));
    this.docs.clear();
    this.addDoc('events.csv', 'events', EVENT_COLUMNS, EVENT_OPTIONAL, eventsB, ov?.events);
    this.addDoc('news.csv', 'news', NEWS_COLUMNS, NEWS_OPTIONAL, newsB, ov?.news);
    const sheets = await Promise.all(this.npcs.map((n) => fetchText(`content/dialogue/${n.id}.csv`)));
    this.npcs.forEach((n, i) => this.addDoc(`dialogue/${n.id}.csv`, 'dialogue', DIALOGUE_COLUMNS, DIALOGUE_OPTIONAL, sheets[i], ov?.dialogue?.[n.id], n.id));
    const known = new Set(this.npcs.map((n) => n.id));
    const extra = Object.entries(ov?.dialogue ?? {}).filter(([id]) => !known.has(id));
    if (extra.length) this.keep.dialogue = Object.fromEntries(extra);
    try {
      this.storedImages = await listImages();
    } catch (e) {
      console.warn('[editor] IndexedDB unavailable; image overrides disabled', e);
      this.storedImages = new Map();
    }
    this.pendingImages.clear();
  }

  private addDoc(path: string, kind: DocKind, expected: string[], optional: string[], bundled: string | null, override: string | undefined, npc?: string) {
    const bundledTable = bundled != null ? parseTable(bundled, expected) : null;
    const bundledCanon = bundledTable ? serialize(bundledTable, optional) : null;
    const startText = override ?? bundled;
    const table = startText != null ? parseTable(startText, expected) : null;
    const canon = table ? serialize(table, optional) : null;
    this.docs.set(path, { path, kind, npc, expected, optional, bundled, bundledCanon, savedCanon: canon, table });
  }

  doc(path: string): Doc | undefined {
    return this.docs.get(path);
  }
  canon(d: Doc): string | null {
    return d.table ? serialize(d.table, d.optional) : null;
  }
  /** differs from what ships in public/content */
  changed(d: Doc): boolean {
    return this.canon(d) !== d.bundledCanon;
  }
  /** differs from what is saved */
  unsavedDoc(d: Doc): boolean {
    return this.canon(d) !== d.savedCanon;
  }
  isDirty(): boolean {
    for (const d of this.docs.values()) if (this.unsavedDoc(d)) return true;
    return this.pendingImages.size > 0;
  }

  /** files for the checker core, working copies included */
  checkerFiles(): Record<string, string | null> {
    const files: Record<string, string | null> = {};
    if (this.scenesText != null) files['scenes.yaml'] = this.scenesText;
    if (this.npcsText != null) files['npcs.yaml'] = this.npcsText;
    if (this.castText != null) files['cast.yaml'] = this.castText;
    for (const d of this.docs.values()) {
      const t = this.canon(d);
      if (t != null) files[d.path] = t;
    }
    return files;
  }

  createSheet(npc: string, fallbackId: string): void {
    const d = this.docs.get(`dialogue/${npc}.csv`);
    if (!d) return;
    const row: Record<string, string> = Object.fromEntries(DIALOGUE_COLUMNS.map((c) => [c, '']));
    row.id = fallbackId;
    row.priority = '0';
    row.emotion = 'neutral';
    row.line = 'Hello.';
    d.table = { columns: [...DIALOGUE_COLUMNS], rows: [row] };
  }

  revertDoc(d: Doc): void {
    d.table = d.bundled != null ? parseTable(d.bundled, d.expected) : null;
  }
  discardDoc(d: Doc): void {
    d.table = d.savedCanon != null ? parseTable(d.savedCanon, d.expected) : null;
  }

  // ------------------------------------------------------------ images
  /** effective override image for a key (staged change first) */
  image(key: string): ImageRecord | null {
    if (this.pendingImages.has(key)) return this.pendingImages.get(key) ?? null;
    return this.storedImages.get(key) ?? null;
  }
  stageImage(key: string, rec: ImageRecord | null): void {
    const stored = this.storedImages.get(key) ?? null;
    if (rec === null && !stored) this.pendingImages.delete(key);
    else if (rec && stored === rec) this.pendingImages.delete(key);
    else this.pendingImages.set(key, rec);
  }
  imageKeys(): string[] {
    const keys = new Set(this.storedImages.keys());
    for (const [k, v] of this.pendingImages) v ? keys.add(k) : keys.delete(k);
    return [...keys].sort();
  }

  // ------------------------------------------------------------ save / revert
  buildOverride(): Override | null {
    const o: Override = { v: 1, updated: new Date().toISOString() };
    const dialogue: Record<string, string> = { ...(this.keep.dialogue ?? {}) };
    let any = false;
    for (const d of this.docs.values()) {
      if (!this.changed(d)) continue;
      const t = this.canon(d);
      if (t == null) continue;
      any = true;
      if (d.kind === 'dialogue') dialogue[d.npc!] = t;
      else if (d.kind === 'events') o.events = t;
      else o.news = t;
    }
    if (Object.keys(dialogue).length) { o.dialogue = dialogue; any = true; }
    if (this.keep.npcs != null) { o.npcs = this.keep.npcs; any = true; }
    if (this.keep.scenes != null) { o.scenes = this.keep.scenes; any = true; }
    return any ? o : null;
  }

  async save(): Promise<Override | null> {
    const o = this.buildOverride();
    writeOverride(o);
    this.overrideActive = !!o;
    this.savedUpdated = o?.updated ?? null;
    for (const d of this.docs.values()) d.savedCanon = this.canon(d);
    for (const [k, v] of this.pendingImages) {
      if (v) { await putImage(k, v); this.storedImages.set(k, v); }
      else { await deleteImage(k); this.storedImages.delete(k); }
    }
    this.pendingImages.clear();
    return o;
  }

  /** Revert all: clears the override key and every image key, back to bundled content. */
  async revertAll(): Promise<void> {
    writeOverride(null);
    try { await clearImages(); } catch { /* no IndexedDB */ }
    this.keep = {};
    await this.load();
  }

  discardAll(): void {
    for (const d of this.docs.values()) this.discardDoc(d);
    this.pendingImages.clear();
  }

  /** the room-pinning snapshot shape from SPEC: roomConfig.override = { text, imageKeys } */
  snapshot(): { text: Override | null; imageKeys: string[] } {
    return { text: readOverride(), imageKeys: [...this.storedImages.keys()].sort() };
  }
}

export { cloneTable };
