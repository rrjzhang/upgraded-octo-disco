/** Images tab: every image slot the game draws, with the current image, upload, game-size preview and revert. */
import { h, modal, toast } from './dom';
import type { Manifest, Model } from './model';
import type { ImageRecord } from './store';
import type { Ctx } from './shared';
import { appUrl } from '../util';

export type SlotKind = 'bust' | 'figure' | 'bg' | 'tv' | 'castBust' | 'castTv';
export interface Slot {
  /** IndexedDB key, SPEC scheme "<section>/<id>/<variant>" */
  key: string;
  group: string;
  label: string;
  kind: SlotKind;
  /** manifest file under /assets/, or null when the game shows a placeholder */
  file: string | null;
  /** download name for Export (the manifest file's name, as PNG) */
  exportName: string;
}

const EXPRESSIONS = ['neutral', 'warm', 'guarded', 'worried'] as const;

/** manifest lookup honouring aliases and the ch_ prefix (as the engine's assetEntry does); returns the key found */
function findKey(m: Manifest, table: Record<string, unknown> | undefined, id: string): string | null {
  if (!table || !id) return null;
  if (table[id]) return id;
  const a = m.aliases?.[id];
  if (a && table[a]) return a;
  const bare = id.replace(/^ch_/, '');
  if (table[bare]) return bare;
  if (table['ch_' + id]) return 'ch_' + id;
  return null;
}

const base = (f: string) => f.split('/').pop()!.replace(/\.(jpe?g|png|webp)$/i, '') + '.png';

export function enumerateSlots(model: Model): Slot[] {
  const m = model.manifest;
  const out: Slot[] = [];
  const seen = new Set<string>();
  const add = (s: Slot) => { if (!seen.has(s.key)) { seen.add(s.key); out.push(s); } };
  for (const n of model.npcs) {
    const pk = findKey(m, m.portraits, n.portrait);
    // SPEC key: portraits/<npcId>/<expression> (the engine also accepts the portrait base id; they coincide)
    const pid = n.id;
    const entry = pk ? (m.portraits![pk] as Record<string, unknown>) : undefined;
    const grp = `${n.name} (${n.id})`;
    for (const ex of EXPRESSIONS) {
      const file = typeof entry?.[ex] === 'string' ? (entry[ex] as string) : null;
      add({ key: `portraits/${pid}/${ex}`, group: grp, label: `bust · ${ex}`, kind: 'bust', file, exportName: file ? base(file) : `${n.portrait.replace(/^ch_/, '')}_${ex}.png` });
    }
    if (n.figure) {
      const fk = findKey(m, m.figures, n.figure);
      const file = fk ? m.figures![fk].file : null;
      add({ key: `figures/${n.figure}`, group: grp, label: `figure${n.seated ? ' (seated)' : ''}`, kind: 'figure', file, exportName: file ? base(file) : `${n.figure}.png` });
    }
  }
  const bg = (id: string, label: string, group: string) => {
    const k = findKey(m, m.backgrounds, id);
    const file = k ? m.backgrounds![k].file : null;
    add({ key: `backgrounds/${id}`, group, label, kind: 'bg', file, exportName: file ? base(file) : `${id}.png` });
  };
  for (const s of model.scenes) {
    if (s.background === 'none') continue;
    const grp = `Scene: ${s.name}`;
    bg(s.background, s.background, grp);
    const eve = s.background.includes('_day') ? s.background.replace('_day', '_eve') : `${s.background}_eve`;
    if (findKey(m, m.backgrounds, eve)) bg(eve, `${eve} (evening)`, grp);
    if (s.painted) bg(s.painted, `${s.painted} (painted)`, grp);
  }
  const leaders = new Set<string>([...model.npcs.filter((n) => n.role === 'national_leader').map((n) => n.id), ...Object.keys(m.tv ?? {})]);
  for (const id of leaders) {
    const k = findKey(m, m.tv as Record<string, unknown>, id);
    const files = (k ? m.tv![k] : []) ?? [];
    const name = model.npcs.find((n) => n.id === id)?.name ?? id;
    const n = Math.max(1, files.length);
    for (let i = 0; i < n; i++) {
      const file = files[i] ?? null;
      add({ key: `tv/${id}/${i}`, group: `TV stills`, label: `${name} · still ${i + 1}`, kind: 'tv', file, exportName: file ? base(file) : `${id}_${i + 1}.png` });
    }
  }
  const cast = new Set<string>([...Object.keys(m.cast ?? {}), ...model.castIds]);
  for (const [path, col] of [['news.csv', 'figure'], ['events.csv', 'portrait']] as const) {
    for (const r of model.doc(path)?.table?.rows ?? []) if (r[col]) cast.add(r[col].trim());
  }
  for (const id of [...cast].sort()) {
    const c = m.cast?.[id];
    const nm = c?.name ?? model.castNames.get(id);
    const grp = `Cast: ${nm ? `${nm} (${id})` : id}`;
    add({ key: `cast/${id}/bust`, group: grp, label: 'bust (1:1, transparent)', kind: 'castBust', file: c?.bust ?? null, exportName: c?.bust ? base(c.bust) : `cast_${id}_bust_A.png` });
    add({ key: `cast/${id}/tv`, group: grp, label: 'TV still (16:9)', kind: 'castTv', file: c?.tv ?? null, exportName: c?.tv ? base(c.tv) : `cast_${id}_tv_A.png` });
  }
  return out;
}

const urls = new WeakMap<Blob, string>();
export function blobUrl(b: Blob): string {
  let u = urls.get(b);
  if (!u) { u = URL.createObjectURL(b); urls.set(b, u); }
  return u;
}

export function slotUrl(model: Model, s: Slot): { url: string | null; source: 'override' | 'bundled' | 'placeholder'; rec: ImageRecord | null } {
  const rec = model.image(s.key);
  if (rec) return { url: blobUrl(rec.blob), source: 'override', rec };
  if (s.file) return { url: appUrl('assets/' + s.file), source: 'bundled', rec: null };
  return { url: null, source: 'placeholder', rec: null };
}

/** shape problems for a slot kind, given pixel size and (for PNG) whether any pixel is transparent */
export function shapeWarnings(kind: SlotKind, w: number, h: number, type: string, hasAlpha: boolean | null): string[] {
  const out: string[] = [];
  const r = w / h;
  if ((kind === 'bust' || kind === 'castBust') && Math.abs(r - 1) > 0.02) out.push(`busts should be square; this is ${w}×${h}`);
  if (kind === 'figure' || kind === 'castBust') {
    if (type && type !== 'image/png') out.push(`${kind === 'figure' ? 'figures' : 'cast busts'} should be transparent PNG; this is ${type.replace('image/', '').toUpperCase()}`);
    else if (hasAlpha === false) out.push('no transparent pixels: the figure will show its background');
  }
  if (kind === 'figure' && h < 500) out.push(`figures are drawn up to 700 px tall; this is only ${h} px`);
  if (kind === 'bg' && Math.abs(r - 1.5) > 0.03) out.push(`backgrounds are 3:2 (e.g. 1536×1024); this is ${w}×${h} and will be cropped`);
  if ((kind === 'tv' || kind === 'castTv') && Math.abs(r - 16 / 9) > 0.04) out.push(`TV stills are 16:9; this is ${w}×${h}`);
  return out;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('image failed to load'));
    img.src = url;
  });
}

function alphaOf(img: HTMLImageElement): boolean {
  const c = document.createElement('canvas');
  const s = Math.min(1, 128 / Math.max(img.naturalWidth, img.naturalHeight));
  c.width = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

export async function toPng(rec: ImageRecord): Promise<Blob> {
  if (rec.type === 'image/png') return rec.blob;
  const img = await loadImage(blobUrl(rec.blob));
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
}

export class ImagesTab {
  el = h('div', { class: 'tab-body imgs' });
  private filter = '';
  constructor(private ctx: Ctx) {}
  analyse(): string[] { return []; }
  onResult(): void { /* images are not validated by the checker */ }

  render(): void {
    const m = this.ctx.model;
    const slots = enumerateSlots(m);
    const q = this.filter.toLowerCase();
    const shown = slots.filter((s) => !q || `${s.group} ${s.label} ${s.key}`.toLowerCase().includes(q));
    const groups = new Map<string, Slot[]>();
    for (const s of shown) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
    const overrides = slots.filter((s) => m.image(s.key)).length;
    const search = h('input', { type: 'search', placeholder: 'Filter (name, scene, key)…', value: this.filter, 'aria-label': 'Filter image slots' });
    search.addEventListener('input', () => { this.filter = search.value; this.render(); search.focus(); });
    this.el.replaceChildren(
      h('div', { class: 'toolbar' }, search,
        h('span', { class: 'muted', text: `${slots.length} slots · ${overrides} overridden · stored in IndexedDB gv/images, keyed <section>/<id>/<variant>` })),
      h('div', { class: 'groups' }, ...[...groups].map(([g, ss]) => h('section', { class: 'igroup' }, h('h3', { text: g }), h('div', { class: 'cards' }, ...ss.map((s) => this.card(s)))))));
  }

  private card(s: Slot): HTMLElement {
    const m = this.ctx.model;
    const cur = slotUrl(m, s);
    const info = h('div', { class: 'iinfo small' });
    const warn = h('div', { class: 'iwarn small' });
    const thumb = h('div', { class: `thumb k-${s.kind}` });
    if (cur.url) {
      const img = h('img', { src: cur.url, alt: `${s.group} ${s.label}`, loading: 'lazy' });
      img.addEventListener('load', () => {
        const w = img.naturalWidth, hh = img.naturalHeight;
        info.textContent = `${w}×${hh}px · ${cur.source === 'override' ? 'override' : s.file}`;
        const type = cur.rec?.type ?? (s.file?.endsWith('.png') ? 'image/png' : 'image/jpeg');
        const alpha = s.kind === 'figure' || s.kind === 'castBust' ? alphaOf(img) : null;
        warn.replaceChildren(...shapeWarnings(s.kind, w, hh, type, alpha).map((t) => h('div', { text: '⚠ ' + t })));
      });
      thumb.append(img);
    } else {
      thumb.append(h('span', { class: 'ph', text: 'PLACEHOLDER' }));
      info.textContent = 'no image: the game shows PLACEHOLDER';
    }
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg', class: 'hidden-file', 'aria-label': `Upload ${s.key}` });
    file.addEventListener('change', () => { const f = file.files?.[0]; if (f) void this.upload(s, f); });
    const src = cur.source === 'override' ? (m.pendingImages.has(s.key) ? 'override (unsaved)' : 'override') : cur.source;
    return h('div', { class: `card${cur.source === 'override' ? ' over' : ''}`, 'data-key': s.key },
      h('button', { class: 'thumbbtn', title: 'Preview at game size', onclick: () => this.preview(s) }, thumb),
      h('div', { class: 'clabel' }, h('b', { text: s.label }), h('span', { class: `src s-${cur.source}`, text: src })),
      h('code', { class: 'key small', text: s.key }),
      info, warn,
      h('div', { class: 'cacts' },
        h('label', { class: 'btn mini' }, 'Upload', file),
        h('button', { class: 'mini', onclick: () => this.preview(s), text: 'Preview' }),
        h('button', { class: 'mini ghost', disabled: cur.source !== 'override', onclick: () => { m.stageImage(s.key, null); this.render(); this.ctx.changed(); }, text: 'Revert' })));
  }

  async upload(s: Slot, f: File): Promise<void> {
    if (!['image/png', 'image/jpeg'].includes(f.type)) { toast(`${f.name}: only PNG or JPEG`, 'err'); return; }
    let img: HTMLImageElement;
    try { img = await loadImage(URL.createObjectURL(f)); } catch { toast(`${f.name} could not be read as an image`, 'err'); return; }
    const rec: ImageRecord = { blob: f, type: f.type, w: img.naturalWidth, h: img.naturalHeight, updated: new Date().toISOString() };
    URL.revokeObjectURL(img.src);
    const warns = shapeWarnings(s.kind, rec.w, rec.h, rec.type, s.kind === 'figure' || s.kind === 'castBust' ? alphaOf(img) : null);
    this.ctx.model.stageImage(s.key, rec);
    this.render();
    this.ctx.changed();
    toast(`${s.key}: ${rec.w}×${rec.h} staged${warns.length ? ' · ' + warns.join('; ') : ''}. Save to apply.`, warns.length ? 'err' : 'ok');
    this.preview(s);
  }

  preview(s: Slot): void {
    const cur = slotUrl(this.ctx.model, s);
    const img = () => (cur.url ? h('img', { src: cur.url, alt: s.label }) : h('span', { class: 'ph', text: 'PLACEHOLDER' }));
    let stage: HTMLElement;
    let note: string;
    if (s.kind === 'bust' || s.kind === 'castBust') {
      stage = h('div', { class: 'pv-portrait' }, img(), h('span', { class: 'chip', text: s.kind === 'bust' ? s.label.replace('bust · ', '') : 'cast' }));
      note = 'Right-panel portrait as the game draws it: 484×300 panel, bust 290×290 contained, bottom-centred.';
    } else if (s.kind === 'figure') {
      stage = h('div', { class: 'pv-figure' }, h('div', { class: 'shadow' }), img());
      note = 'Figure at 700 px tall on a neutral ground (the largest the game draws a near-slot figure).';
    } else if (s.kind === 'bg') {
      stage = h('div', { class: 'pv-bg' }, img());
      note = 'Scene viewport, 900×600 (3:2), cover.';
    } else {
      stage = h('div', { class: 'pv-tv' }, img());
      note = 'TV still in a 16:9 frame (640×360).';
    }
    modal(`Preview · ${s.key}`, h('div', { class: 'pv' }, h('p', { class: 'muted small', text: note }), stage), true);
  }
}
