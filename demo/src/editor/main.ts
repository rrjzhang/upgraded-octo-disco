/** Researcher content editor (/editor.html). Edits dialogue, events, news and images; saves an override the game
 *  applies on load (SPEC "Researcher editing, overrides and casting"). */
import './editor.css';
import { checkContent, type CheckResult } from '../../tools/checker/core.mjs';
import { h, toast, modal, download } from './dom';
import { Model } from './model';
import { DialogueTab, rapportDatalist } from './dialogue';
import { TableTab } from './tables';
import { ImagesTab, enumerateSlots, toPng } from './images';
import { OVERRIDE_KEY } from './store';
import type { Ctx } from './shared';
import { appUrl } from '../util';

type TabId = 'dialogue' | 'events' | 'news' | 'images';
interface Tab { el: HTMLElement; render(): void; onResult(): void; analyse(): string[] }

const model = new Model();
let result: CheckResult | null = null;
let timer = 0;
let current: TabId = 'dialogue';
/** SPEC "Conversation limit": conversations per NPC per day the reachability search assumes (editor setting, default 1) */
const TALKS_KEY = 'gv:editor:talks';
let maxTalks = (() => { try { const v = Number(localStorage.getItem(TALKS_KEY)); return Number.isInteger(v) && v > 0 ? v : 1; } catch { return 1; } })();

const ctx: Ctx = {
  model,
  changed() { scheduleValidate(); refreshHeader(); },
  result: () => result,
};

const app = document.getElementById('app')!;
const statusChip = h('span', { class: 'chip-status', role: 'status' });
const changesBtn = h('button', { class: 'ghost', onclick: () => showChanges() });
const saveBtn = h('button', { class: 'primary', onclick: () => void save(), text: 'Save', title: 'Write the override (Ctrl/Cmd+S)' });
const revertAllBtn = h('button', { class: 'ghost danger', onclick: () => void revertAll(), text: 'Revert all' });
const tabsNav = h('nav', { class: 'tabs', role: 'tablist' });
const body = h('main', { class: 'body' });
let tabs: Record<TabId, Tab>;

function validate(): void {
  const tab = tabs[current];
  const t0 = performance.now();
  result = checkContent({ files: model.checkerFiles(), manifest: model.manifest, content: 'editor working copy', analyse: tab.analyse(), maxTalks });
  (window as any).__gvEditorCheckMs = Math.round(performance.now() - t0);
  tab.onResult();
}
function scheduleValidate(): void {
  clearTimeout(timer);
  timer = window.setTimeout(validate, 180);
}

function changedFiles() {
  return [...model.docs.values()].filter((d) => model.changed(d));
}

function refreshHeader(): void {
  const dirty = model.isDirty();
  const n = changedFiles().length + model.imageKeys().length;
  statusChip.className = `chip-status ${dirty ? 'dirty' : model.overrideActive || model.storedImages.size ? 'over' : 'clean'}`;
  statusChip.textContent = dirty ? 'Unsaved changes'
    : model.overrideActive || model.storedImages.size ? `Saved · override active${model.savedUpdated ? ' · ' + new Date(model.savedUpdated).toLocaleString() : ''}`
      : 'Bundled content (no override)';
  changesBtn.textContent = `Changes (${n})`;
  saveBtn.toggleAttribute('disabled', !dirty);
  document.title = `${dirty ? '• ' : ''}The Great Vote · Editor`;
}

async function save(): Promise<void> {
  try {
    const o = await model.save();
    const full = checkContent({ files: model.checkerFiles(), manifest: model.manifest, content: 'saved', maxTalks });
    toast(`Saved${o ? '' : ' (no text differs from bundled; override cleared)'}. Checker on all sheets: ${full.counts.error} error(s), ${full.counts.warning} warning(s).`, full.counts.error ? 'err' : 'ok');
  } catch (e) {
    toast(`Save failed: ${(e as Error).message}`, 'err');
  }
  tabs[current].render();
  validate();
  refreshHeader();
}

let revertArmed = 0;
async function revertAll(): Promise<void> {
  if (!revertArmed) {
    revertAllBtn.textContent = 'Click again: clear override and images';
    revertArmed = window.setTimeout(() => { revertArmed = 0; revertAllBtn.textContent = 'Revert all'; }, 4000);
    return;
  }
  clearTimeout(revertArmed);
  revertArmed = 0;
  revertAllBtn.textContent = 'Revert all';
  await model.revertAll();
  toast(`Cleared ${OVERRIDE_KEY} and all image overrides; showing bundled content.`, 'ok');
  buildTabs();
  showTab(current);
  refreshHeader();
}

async function exportChanged(): Promise<void> {
  const docs = changedFiles();
  const slots = new Map(enumerateSlots(model).map((s) => [s.key, s]));
  const images = model.imageKeys();
  if (!docs.length && !images.length) { toast('Nothing differs from the bundled content.', 'info'); return; }
  const names: string[] = [];
  for (const d of docs) {
    const t = model.canon(d);
    if (t == null) continue;
    const name = d.path.split('/').pop()!;
    download(name, new Blob([t], { type: 'text/csv' }));
    names.push(name);
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const k of images) {
    const rec = model.image(k);
    if (!rec) continue;
    const name = slots.get(k)?.exportName ?? k.replace(/\//g, '_') + '.png';
    download(name, await toPng(rec));
    names.push(name);
    await new Promise((r) => setTimeout(r, 250));
  }
  toast(`Exported ${names.join(', ')}. CSV/YAML go into public/content (dialogue sheets into dialogue/), images into image_generation/out.`, 'ok');
}

function showChanges(): void {
  const list = h('div', { class: 'changes' });
  const draw = () => {
    const ds = changedFiles(), is = model.imageKeys();
    list.replaceChildren(h('div', {},
      h('h4', { text: 'Text files (differ from public/content)' }),
      ds.length ? h('ul', {}, ...ds.map((d) => h('li', {}, h('code', { text: d.path }), model.unsavedDoc(d) ? h('span', { class: 'tag', text: 'unsaved' }) : null,
        h('button', { class: 'mini ghost', onclick: () => { model.revertDoc(d); draw(); tabs[current].render(); ctx.changed(); }, text: 'Revert' })))) : h('p', { class: 'muted', text: 'None.' }),
      h('h4', { text: 'Images (IndexedDB gv/images)' }),
      is.length ? h('ul', {}, ...is.map((k) => h('li', {}, h('code', { text: k }), model.pendingImages.has(k) ? h('span', { class: 'tag', text: 'unsaved' }) : null,
        h('button', { class: 'mini ghost', onclick: () => { model.stageImage(k, null); draw(); tabs[current].render(); ctx.changed(); }, text: 'Revert' })))) : h('p', { class: 'muted', text: 'None.' }),
      h('p', { class: 'muted small', text: 'Revert puts the working copy back to the bundled file; Save makes it stick.' }),
      model.isDirty() ? h('button', { class: 'ghost', onclick: () => { model.discardAll(); draw(); tabs[current].render(); ctx.changed(); }, text: 'Discard unsaved changes (back to last save)' }) : null));
  };
  draw();
  modal('Changes', list);
}

function copyOverride(): void {
  const snap = model.snapshot();
  const text = JSON.stringify(snap, null, 2);
  const ta = h('textarea', { class: 'json', rows: 18, readonly: true, 'aria-label': 'Override JSON' }, text);
  const note = model.isDirty() ? 'You have unsaved changes; this is the last saved override. Save first to include them.' : 'Paste into the room config (roomConfig.override) on the researcher page. Images stay in this browser; only their keys are listed.';
  const copy = h('button', { class: 'primary', text: 'Copy to clipboard', onclick: async () => {
    try { await navigator.clipboard.writeText(text); toast('Override JSON copied.', 'ok'); } catch { ta.select(); document.execCommand('copy'); toast('Override JSON copied.', 'ok'); }
  } });
  modal('Override JSON (room snapshot)', h('div', {}, h('p', { class: `small ${model.isDirty() ? 'd-warn' : 'muted'}`, text: note }), ta, h('div', { class: 'row-right' }, copy)), true);
}

function buildTabs(): void {
  tabs = {
    dialogue: new DialogueTab(ctx),
    events: new TableTab(ctx, 'events.csv'),
    news: new TableTab(ctx, 'news.csv'),
    images: new ImagesTab(ctx),
  };
}

function showTab(id: TabId): void {
  current = id;
  if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  tabsNav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
  tabs[id].render();
  body.replaceChildren(tabs[id].el);
  validate();
}

async function boot(): Promise<void> {
  await model.load();
  buildTabs();
  const labels: Record<TabId, string> = { dialogue: 'Dialogue', events: 'Events', news: 'News', images: 'Images' };
  for (const id of Object.keys(labels) as TabId[]) {
    tabsNav.append(h('button', { role: 'tab', 'data-tab': id, onclick: () => showTab(id), text: labels[id] }));
  }
  const header = h('header', { class: 'e-head' },
    h('span', { class: 'e-title', text: 'The Great Vote · Editor' }),
    tabsNav,
    statusChip,
    h('span', { class: 'grow' }),
    h('label', { class: 'fld talks', title: 'Conversations per person per day the reachability check assumes (the room setting maxTalksPerNpcPerDay; checker --talks N)' },
      'Talks/day ', h('input', { id: 'talks-setting', type: 'number', min: 1, max: 8, step: 1, value: String(maxTalks), 'aria-label': 'Conversations per person per day', onchange: (e: Event) => {
        const v = Math.floor(Number((e.target as HTMLInputElement).value));
        if (!(v >= 1 && v <= 8)) { (e.target as HTMLInputElement).value = String(maxTalks); return; }
        maxTalks = v;
        try { localStorage.setItem(TALKS_KEY, String(v)); } catch { /* ignore */ }
        validate();
      } })),
    changesBtn,
    saveBtn,
    h('button', { onclick: () => void exportChanged(), text: 'Export', title: 'Download each changed file (CSV, PNG)' }),
    h('button', { class: 'ghost', onclick: () => copyOverride(), text: 'Copy override JSON' }),
    revertAllBtn,
    h('a', { href: appUrl('?dev=1'), target: '_blank', rel: 'noopener', text: 'Game ↗' }),
    h('a', { href: appUrl('researcher.html'), text: 'Researcher' }));
  app.replaceChildren(header, body, rapportDatalist());
  const fromHash = location.hash.slice(1) as TabId;
  showTab(fromHash in labels ? fromHash : 'dialogue');
  refreshHeader();
  window.addEventListener('beforeunload', (e) => {
    if (!model.isDirty()) return;
    e.preventDefault();
    e.returnValue = '';
  });
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1) as TabId; if (t in labels && t !== current) showTab(t); });
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (model.isDirty()) void save(); }
  });
  (window as any).gvEditor = { model, validate: () => { validate(); return result; }, save, tab: (id: TabId) => showTab(id), tabs: () => tabs };
}

boot().catch((e) => {
  console.error(e);
  app.replaceChildren(h('p', { class: 'loading', text: `Editor failed to load: ${(e as Error).message}` }));
});
