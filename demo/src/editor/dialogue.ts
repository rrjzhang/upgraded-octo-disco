/** Dialogue tab: one NPC's sheet as an editable table, with a follow-up tree and live checker validation. */
import { DIALOGUE_COST, DIMS, EMOTIONS, FREE_TURNS, NCELLS, parseCondition, parseEffects, sceneList, type CheckResult, type Diagnostic, type NpcResult } from '../../tools/checker/core.mjs';
import { h } from './dom';
import type { Row, Table } from './csv';
import type { Doc } from './model';
import { badge, diagList, diagsByRow, markCells, nextId, selectEl, type Ctx } from './shared';
import { ConvGraph } from './graph';
import { characterCard } from './character';

type View = 'table' | 'split' | 'graph';
const VIEW_KEY = 'gv:editor:dlgView';
const PANEL_KEY = 'gv:editor:sidePanel';
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

const COND = DIMS.map((d) => d.key);
const COND_LABEL: Record<string, string> = { met: 'met', rapport: 'rapport', lastValence: 'lastVal', nationalLeader: 'leader', playerLean: 'lean', dayPhase: 'phase' };
const RAPPORT_HINTS = ['0', '1', '2', '3', '1+', '2+', '3+', '0-1', '0-2', '1-2', '1-3', '2-3'];

/** Longest run of turns from a row: 1 + max depth of the choices' next rows; a cycle counts as FREE_TURNS + 1 (it can run into the paid turn) */
export function depths(rows: Row[]): Map<string, number> {
  const byId = new Map(rows.filter((r) => r.id).map((r) => [r.id, r]));
  const memo = new Map<string, number>();
  const visit = (id: string, stack: Set<string>): number => {
    if (stack.has(id)) return Infinity;
    if (memo.has(id)) return memo.get(id)!;
    const r = byId.get(id);
    if (!r) return 0;
    stack.add(id);
    let d = 1;
    for (const k of [1, 2, 3]) {
      const n = r[`next${k}`];
      if (!r[`choice${k}`] || !n || !byId.has(n)) continue;
      const c = visit(n, stack);
      d = c === Infinity ? Math.max(d, FREE_TURNS + 1) : Math.max(d, 1 + c);
    }
    stack.delete(id);
    memo.set(id, d);
    return d;
  };
  for (const id of byId.keys()) visit(id, new Set());
  return memo;
}

export class DialogueTab {
  el = h('div', { class: 'tab-body dlg' });
  npc: string;
  sel = -1;
  private tbody = h('tbody');
  private side = h('aside', { class: 'side' });
  private head = h('div', { class: 'toolbar' });
  private msg = h('span', { class: 'msg', role: 'status' });
  private lastDiag: Map<number, Diagnostic[]> = new Map();
  /** SPEC "Conversation graph": Table / Split (graph above the table) / Graph */
  view: View = (['table', 'split', 'graph'] as const).find((v) => v === lsGet(VIEW_KEY)) ?? 'split';
  private sideHidden = lsGet(PANEL_KEY) === 'hidden';
  private graphH = ((v) => (v >= 160 ? v : 0))(Number(lsGet('gv:editor:graphH')));
  private cardOpen = true;
  private graph = new ConvGraph({
    pick: (i) => this.select(i),
    open: (i) => { if (this.view === 'graph') this.setView('split'); this.sel = -1; this.select(i); },
  });

  constructor(private ctx: Ctx) {
    this.npc = ctx.model.npcs[0]?.id ?? '';
    try { const s = localStorage.getItem('gv:editor:npc'); if (s && ctx.model.npcs.some((n) => n.id === s)) this.npc = s; } catch { /* ignore */ }
  }

  get doc(): Doc | undefined { return this.ctx.model.doc(`dialogue/${this.npc}.csv`); }
  get table(): Table | null { return this.doc?.table ?? null; }

  analyse(): string[] { return [this.npc]; }

  render(): void {
    const m = this.ctx.model;
    const npcSel = h('select', { 'aria-label': 'NPC', id: 'npc-pick', onchange: (e: Event) => {
      this.npc = (e.target as HTMLSelectElement).value; this.sel = -1; this.graph.reset();
      try { localStorage.setItem('gv:editor:npc', this.npc); } catch { /* ignore */ }
      this.render(); this.ctx.changed();
    } });
    for (const n of m.npcs) {
      const d = m.doc(`dialogue/${n.id}.csv`);
      const mark = d && m.changed(d) ? ' •' : '';
      npcSel.append(h('option', { value: n.id, text: `${n.name} (${n.id})${mark}` }));
    }
    npcSel.value = this.npc;
    const doc = this.doc;
    const viewBtn = (v: View, text: string, title: string) => h('button', { class: `seg${this.view === v ? ' on' : ''}`, 'aria-pressed': String(this.view === v), 'data-view': v, title, text, onclick: () => this.setView(v) });
    this.head.replaceChildren(
      h('label', { class: 'fld' }, 'NPC ', npcSel),
      h('span', { class: 'segs', role: 'group', 'aria-label': 'View' },
        viewBtn('table', 'Table', 'Sheet only'), viewBtn('split', 'Graph + table', 'Conversation graph above the sheet'), viewBtn('graph', 'Graph', 'Conversation graph only (double-click a node to open it in the table)')),
      h('button', { class: 'ghost', id: 'side-toggle', 'aria-pressed': String(!this.sideHidden), onclick: () => this.toggleSide(), text: this.sideHidden ? 'Show panel ◂' : 'Hide panel ▸', title: 'Character card, validation and selected row' }),
      h('button', { onclick: () => this.addRow(), disabled: !this.table, text: '+ Row' }),
      h('button', { class: 'ghost', id: 'revert-sheet', onclick: () => this.revert(), disabled: !(doc && m.changed(doc)), text: 'Revert sheet' }),
      h('span', { class: 'muted', text: doc ? `content/${doc.path}${doc.bundled == null ? ' (not bundled)' : ''}` : '' }),
      this.msg,
    );
    const wrap = h('div', { class: 'tablewrap' });
    if (!this.table) {
      wrap.append(h('div', { class: 'empty' },
        h('p', { text: 'This NPC has no dialogue sheet (TV-only NPCs may not need one).' }),
        h('button', { onclick: () => { m.createSheet(this.npc, nextId([], this.npc.split('_').map((s) => s[0]).join('').toUpperCase() + '01')); this.render(); this.ctx.changed(); }, text: 'Create sheet with a fallback row' })));
    } else {
      const thead = h('thead', {}, h('tr', {},
        h('th', { text: '' }), h('th', { text: 'id' }),
        h('th', { text: 'conditions · scene · priority · emotion' }), h('th', { class: 'wide', text: 'line' }),
        h('th', { class: 'wide', text: 'choices (text · effect · next)' }), h('th', { text: '' })));
      wrap.append(h('table', { class: 'sheet' }, thead, this.tbody), this.sceneHints());
      this.renderRows();
    }
    this.side.hidden = this.sideHidden;
    let main: HTMLElement = wrap;
    if (this.table && this.view === 'graph') main = this.graph.el;
    else if (this.table && this.view === 'split') {
      const divider = h('div', { class: 'g-divider', role: 'separator', 'aria-orientation': 'horizontal', title: 'Drag to resize the graph' });
      main = h('div', { class: 'stack' }, this.graph.el, divider, wrap);
      if (this.graphH) this.graph.el.style.height = `${this.graphH}px`;
      this.wireDivider(divider, main);
    }
    this.graph.el.classList.toggle('full', this.view === 'graph');
    if (this.view !== 'split') this.graph.el.style.height = '';
    this.el.replaceChildren(this.head, h('div', { class: 'split' }, main, this.side));
    this.renderSide();
    this.updateGraph();
  }

  setView(v: View): void {
    if (v === this.view) return;
    this.view = v;
    lsSet(VIEW_KEY, v);
    this.graph.reset();
    const sel = this.sel;
    this.render();
    this.sel = sel;
    this.graph.setSelected(sel);
    this.scrollToSel();
  }

  private toggleSide(): void {
    this.sideHidden = !this.sideHidden;
    lsSet(PANEL_KEY, this.sideHidden ? 'hidden' : 'shown');
    this.side.hidden = this.sideHidden;
    const b = this.head.querySelector<HTMLButtonElement>('#side-toggle');
    if (b) { b.textContent = this.sideHidden ? 'Show panel ◂' : 'Hide panel ▸'; b.setAttribute('aria-pressed', String(!this.sideHidden)); }
    requestAnimationFrame(() => this.graph.fit(0.8));
  }

  private wireDivider(div: HTMLElement, stack: HTMLElement): void {
    div.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      div.setPointerCapture(e.pointerId);
      const top = stack.getBoundingClientRect().top;
      const move = (ev: PointerEvent) => {
        this.graphH = Math.round(Math.min(stack.clientHeight - 120, Math.max(160, ev.clientY - top)));
        this.graph.el.style.height = `${this.graphH}px`;
      };
      const up = () => { div.removeEventListener('pointermove', move); div.removeEventListener('pointerup', up); lsSet('gv:editor:graphH', String(this.graphH)); this.graph.reveal(this.sel); };
      div.addEventListener('pointermove', move);
      div.addEventListener('pointerup', up);
    });
  }

  /** relayout from the working copy; runs after each (debounced) validation, so it follows every edit */
  private updateGraph(): void {
    const t = this.table;
    if (!t || this.view === 'table') return;
    const nr = this.npcResult();
    this.graph.update({ rows: t.rows, winCount: nr?.winCount, fallback: nr?.fallback ?? null }, this.sel);
  }

  private renderRows(): void {
    const t = this.table;
    if (!t) return;
    const ids = t.rows.map((r) => r.id).filter(Boolean);
    this.tbody.replaceChildren(...t.rows.map((r, i) => this.rowEl(r, i, ids)));
    this.wire();
    this.applyDiag();
  }

  private rowEl(r: Row, i: number, ids: string[]): HTMLTableRowElement {
    const at = (c: string) => ({ 'data-i': String(i), 'data-c': c });
    const condCell = (c: string, di: number) => {
      if (c === 'rapport') {
        return h('input', { ...at(c), class: 'cond-in', value: r[c], list: 'rapport-hints', size: 3, 'aria-label': `${r.id} rapport` });
      }
      return selectEl(DIMS[di].values, r[c] ?? '', { ...at(c), 'aria-label': `${r.id} ${c}` });
    };
    const choices = h('div', { class: 'choices' });
    for (const k of [1, 2, 3]) {
      const next = selectEl(ids.filter((x) => x !== undefined), r[`next${k}`] ?? '', { ...at(`next${k}`), 'aria-label': `${r.id} next${k}`, class: 'next' });
      choices.append(h('div', { class: 'choice' },
        h('span', { class: 'k', text: String(k) }),
        h('input', { ...at(`choice${k}`), class: 'ctext', value: r[`choice${k}`], placeholder: `choice ${k}`, 'aria-label': `${r.id} choice${k}` }),
        h('input', { ...at(`effect${k}`), class: 'ceff', value: r[`effect${k}`], placeholder: 'effect', 'aria-label': `${r.id} effect${k}` }),
        next,
        h('button', { class: 'mini', 'data-act': 'follow', 'data-k': String(k), 'data-i': String(i), title: `Add a follow-up row linked from choice ${k}`, text: '+↳' })));
    }
    const tr = h('tr', { 'data-row': String(i), class: i === this.sel ? 'sel' : '' },
      h('td', { class: 'b' }),
      h('td', {}, h('input', { ...at('id'), class: 'id', value: r.id, size: 6, 'aria-label': 'row id' })),
      h('td', { class: 'conds' }, h('div', { class: 'cgrid' },
        ...COND.slice(0, 2).map((c, di) => h('label', { class: 'cf' }, h('span', { text: COND_LABEL[c] }), condCell(c, di))),
        h('label', { class: 'cf' }, h('span', { text: 'priority' }), h('input', { ...at('priority'), class: 'prio', value: r.priority, size: 3, 'aria-label': `${r.id} priority` })),
        h('label', { class: 'cf' }, h('span', { text: 'emotion' }), selectEl(EMOTIONS, r.emotion ?? '', { ...at('emotion'), 'aria-label': `${r.id} emotion` })),
        ...COND.slice(2).map((c, di) => h('label', { class: 'cf' }, h('span', { text: COND_LABEL[c] }), condCell(c, di + 2))),
        // SPEC "Dialogue location": blank = anywhere, else scene ids joined by |
        h('label', { class: 'cf cf-scene', title: 'Scene: blank = anywhere; one scene id, or several joined by |' }, h('span', { text: 'scene' }),
          h('input', { ...at('scene'), class: 'scene-in', value: r.scene ?? '', list: `scene-hints-${this.npc}`, placeholder: 'anywhere', 'aria-label': `${r.id} scene` })),
        // SPEC "Leads": blank = any room, else only rooms where that side's pro- or anti-integration leader leads
        h('label', { class: 'cf', title: 'usLead: blank = any room; pro or anti = only rooms where that US leader is first among equals' }, h('span', { text: 'usLead' }),
          selectEl(['pro', 'anti'], r.usLead ?? '', { ...at('usLead'), 'aria-label': `${r.id} usLead` })),
        h('label', { class: 'cf', title: 'homeLead: blank = any room; pro or anti = only rooms where that heritage leader is first among equals' }, h('span', { text: 'homeLead' }),
          selectEl(['pro', 'anti'], r.homeLead ?? '', { ...at('homeLead'), 'aria-label': `${r.id} homeLead` })),
        h('label', { class: 'cf', title: 'day: blank = any day; a day 1..5, a range like 2-3, or 4+ (the row shows only on those days)' }, h('span', { text: 'day' }),
          h('input', { ...at('day'), class: 'prio', value: r.day ?? '', size: 3, placeholder: 'any', 'aria-label': `${r.id} day` })),
        h('label', { class: 'cf', title: 'absent: an NPC id who must not be in the scene for this row ("waiting on Walt" only while Walt is away)' }, h('span', { text: 'absent' }),
          h('input', { ...at('absent'), class: 'scene-in', value: r.absent ?? '', size: 10, placeholder: 'nobody', 'aria-label': `${r.id} absent` })))),
      h('td', { class: 'wide' }, h('textarea', { ...at('line'), rows: 3, 'aria-label': `${r.id} line` }, r.line ?? '')),
      h('td', { class: 'wide' }, choices),
      h('td', { class: 'acts' },
        h('button', { class: 'mini', 'data-act': 'up', 'data-i': String(i), title: 'Move up', text: '↑' }),
        h('button', { class: 'mini', 'data-act': 'down', 'data-i': String(i), title: 'Move down', text: '↓' }),
        h('button', { class: 'mini', 'data-act': 'dup', 'data-i': String(i), title: 'Duplicate row', text: 'Dup' }),
        h('button', { class: 'mini danger', 'data-act': 'del', 'data-i': String(i), title: 'Delete row', text: 'Del' })),
    );
    return tr;
  }

  private wired = false;
  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    const tb = this.tbody;
    const set = (e: Event) => {
      const el = e.target as HTMLInputElement;
      const i = el.dataset.i, c = el.dataset.c;
      const t = this.table;
      if (i == null || !c || !t || !t.rows[+i]) return false;
      t.rows[+i][c] = el.value;
      return true;
    };
    tb.addEventListener('input', (e) => {
      if (!set(e)) return;
      const el = e.target as HTMLInputElement;
      if (el.dataset.c === 'rapport') this.checkRapport(el);
      if (el.dataset.c === 'scene') this.checkScene(el);
      this.ctx.changed();
    });
    tb.addEventListener('change', (e) => {
      if (!set(e)) return;
      const c = (e.target as HTMLElement).dataset.c ?? '';
      // ids feed every next dropdown and the tree; redraw once the edit is done
      if (c === 'id') this.renderRows();
      this.ctx.changed();
    });
    tb.addEventListener('focusin', (e) => {
      const tr = (e.target as HTMLElement).closest('tr');
      if (tr?.dataset.row != null) this.select(+tr.dataset.row, false);
    });
    tb.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!b) return;
      const i = +(b.dataset.i ?? -1);
      const act = b.dataset.act;
      if (act === 'up') this.move(i, -1);
      else if (act === 'down') this.move(i, 1);
      else if (act === 'dup') this.duplicate(i);
      else if (act === 'del') this.remove(i);
      else if (act === 'follow') this.followUp(i, +(b.dataset.k ?? 1));
    });
  }

  private checkRapport(el: HTMLInputElement): void {
    const v = el.value.trim();
    const err = v === '' ? null : parseCondition(1, v).error;
    el.classList.toggle('cell-err', !!err);
    el.title = err ?? '';
  }

  /** live hint while typing; the checker's UNKNOWN_SCENE / SCENE_NOT_APPEARED errors follow on validation */
  private checkScene(el: HTMLInputElement): void {
    const ids = new Set(this.ctx.model.scenes.map((s) => s.id));
    const here = new Set(this.ctx.model.npcs.find((n) => n.id === this.npc)?.scenes ?? []);
    const parts = sceneList(el.value);
    const unknown = parts.filter((p) => !ids.has(p));
    const away = parts.filter((p) => ids.has(p) && !here.has(p));
    const err = unknown.length ? `not a scene id: ${unknown.join(', ')}` : away.length ? `${this.npc} has no appearance in ${away.join(', ')} (fine only if an event brings them there)` : '';
    el.classList.toggle('cell-err', !!unknown.length);
    el.classList.toggle('cell-warn', !unknown.length && !!away.length);
    el.title = err;
  }

  /** suggestions for the scene cell: this NPC's scenes first, then |-joined pairs of them, then every other scene */
  private sceneHints(): HTMLElement {
    const m = this.ctx.model;
    const mine = m.npcs.find((n) => n.id === this.npc)?.scenes ?? [];
    const pairs = mine.flatMap((a, i) => mine.slice(i + 1).map((b) => `${a}|${b}`));
    const others = m.scenes.map((s) => s.id).filter((id) => !mine.includes(id));
    return h('datalist', { id: `scene-hints-${this.npc}` }, ...[...mine, ...pairs, ...others].map((v) => h('option', { value: v })));
  }

  private say(text: string, kind: 'ok' | 'err' = 'ok'): void {
    this.msg.textContent = text;
    this.msg.className = `msg ${kind}`;
    clearTimeout((this.msg as any)._t);
    (this.msg as any)._t = setTimeout(() => (this.msg.textContent = ''), 6000);
  }

  private blankRow(): Row {
    const t = this.table!;
    return Object.fromEntries(t.columns.map((c) => [c, ''])) as Row;
  }

  addRow(): void {
    const t = this.table;
    if (!t) return;
    const ids = t.rows.map((r) => r.id);
    const r = this.blankRow();
    r.id = nextId(ids, ids[ids.length - 1] || 'R01');
    r.emotion = 'neutral';
    t.rows.push(r);
    this.sel = t.rows.length - 1;
    this.structural(`Added row ${r.id}. Set its conditions; an all-blank row ties with the fallback.`);
  }

  duplicate(i: number): void {
    const t = this.table!;
    const r = { ...t.rows[i] };
    r.id = nextId(t.rows.map((x) => x.id), t.rows[i].id || 'R01');
    t.rows.splice(i + 1, 0, r);
    this.sel = i + 1;
    this.structural(`Duplicated ${t.rows[i].id} as ${r.id}.`);
  }

  followUp(i: number, k: number): void {
    const t = this.table!;
    const src = t.rows[i];
    if (src[`next${k}`]) {
      this.say(`Choice ${k} of ${src.id} already continues to ${src[`next${k}`]}; clear its next first.`, 'err');
      return;
    }
    const r = this.blankRow();
    r.id = nextId(t.rows.map((x) => x.id), src.id || 'R01');
    r.met = 'yes';
    r.priority = '-1';
    r.emotion = src.emotion || 'neutral';
    r.line = 'New line.';
    if (!src[`choice${k}`]) src[`choice${k}`] = 'Go on.';
    src[`next${k}`] = r.id;
    // place it after the source row's existing follow-ups
    t.rows.splice(i + 1, 0, r);
    this.sel = i + 1;
    this.structural(`Added follow-up ${r.id} (priority -1, met yes), linked from ${src.id} choice ${k}.`);
    queueMicrotask(() => this.tbody.querySelector<HTMLTextAreaElement>(`textarea[data-i="${i + 1}"]`)?.focus());
  }

  remove(i: number): void {
    const t = this.table!;
    const id = t.rows[i].id;
    const refs = id ? t.rows.filter((r, j) => j !== i && [1, 2, 3].some((k) => r[`next${k}`] === id)).map((r) => r.id) : [];
    if (refs.length) {
      this.say(`Can't delete ${id}: ${refs.join(', ')} ${refs.length > 1 ? 'continue' : 'continues'} to it. Change their next first.`, 'err');
      return;
    }
    t.rows.splice(i, 1);
    if (this.sel >= t.rows.length) this.sel = t.rows.length - 1;
    this.structural(`Deleted ${id || 'row'}.`);
  }

  move(i: number, d: number): void {
    const t = this.table!;
    const j = i + d;
    if (j < 0 || j >= t.rows.length) return;
    [t.rows[i], t.rows[j]] = [t.rows[j], t.rows[i]];
    this.sel = j;
    this.structural('');
  }

  revert(): void {
    const d = this.doc;
    if (!d) return;
    this.ctx.model.revertDoc(d);
    this.sel = -1;
    this.render();
    this.ctx.changed();
    this.say('Sheet reverted to the bundled file (Save to make it stick).');
  }

  private structural(msg: string): void {
    this.renderRows();
    this.ctx.changed();
    if (msg) this.say(msg);
    this.scrollToSel();
  }

  select(i: number, scroll = true): void {
    if (this.sel === i) return;
    this.sel = i;
    this.graph.setSelected(i);
    this.tbody.querySelectorAll('tr.sel').forEach((e) => e.classList.remove('sel'));
    this.tbody.querySelector(`tr[data-row="${i}"]`)?.classList.add('sel');
    if (scroll) this.scrollToSel();
    this.renderSide();
  }

  private scrollToSel(): void {
    this.tbody.querySelector(`tr[data-row="${this.sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  selectId(id: string): void {
    const i = this.table?.rows.findIndex((r) => r.id === id) ?? -1;
    if (i >= 0) this.select(i);
  }

  onResult(): void {
    const d = this.doc;
    this.head.querySelector('#revert-sheet')?.toggleAttribute('disabled', !(d && this.ctx.model.changed(d)));
    this.applyDiag();
    this.renderSide();
    this.updateGraph();
  }

  private applyDiag(): void {
    const t = this.table, d = this.doc;
    if (!t || !d) return;
    const { rows } = diagsByRow(t, d.optional, d.path, this.ctx.result());
    this.lastDiag = rows;
    this.tbody.querySelectorAll<HTMLTableRowElement>('tr[data-row]').forEach((tr) => {
      const i = +tr.dataset.row!;
      tr.querySelector('td.b')!.replaceChildren(badge(rows.get(i)));
      tr.classList.toggle('has-err', !!rows.get(i)?.some((x) => x.severity === 'error'));
    });
    markCells(this.tbody, rows);
  }

  private npcResult(): NpcResult | undefined {
    return this.ctx.result()?.npcs.find((n) => n.id === this.npc);
  }

  private renderSide(): void {
    const res = this.ctx.result();
    const t = this.table, d = this.doc;
    if (!res || !t || !d) { this.side.replaceChildren(this.card(), h('p', { class: 'muted', text: t ? 'Validating…' : '' })); return; }
    const nr = this.npcResult();
    const mine = res.diagnostics.filter((x) => x.file === d.path && x.severity !== 'info');
    const errs = mine.filter((x) => x.severity === 'error').length;
    const warns = mine.length - errs;
    const others = res.diagnostics.filter((x) => x.file !== d.path && x.severity === 'error');
    const has = (code: string) => mine.filter((x) => x.code === code);
    const stat = (label: string, v: string, bad = false) => h('div', { class: `stat${bad ? ' bad' : ''}` }, h('span', { text: label }), h('b', { text: v }));
    const summary = h('section', { class: 'panel' },
      h('h3', {}, 'Validation ', h('span', { class: `pill ${errs ? 'p-err' : warns ? 'p-warn' : 'p-ok'}`, text: errs ? `${errs} error${errs > 1 ? 's' : ''}` : warns ? `${warns} warning${warns > 1 ? 's' : ''}` : 'all clear' })),
      h('div', { class: 'stats' },
        stat('rows', String(t.rows.length)),
        stat('coverage', nr?.coverage != null ? `${(nr.coverage * 100).toFixed(1)}%` : '–'),
        stat('fallback', nr?.fallback ?? 'missing', !nr?.fallback),
        stat('ties', String(nr?.ties?.length ?? 0), !!nr?.ties?.length),
        stat('dangling next', String(has('DANGLING_NEXT').length), !!has('DANGLING_NEXT').length),
        stat('unreachable', String(nr?.unreachable?.length ?? 0), !!nr?.unreachable?.length),
        stat('never win', String(nr?.neverWins?.length ?? 0), !!nr?.neverWins?.length),
        stat('over budget', String(nr?.overBudget?.length ?? 0), !!nr?.overBudget?.length),
        stat(`unreachable at ${nr?.maxTalks ?? 1} talk/day`, String(nr?.limitUnreachable?.length ?? 0), !!nr?.limitUnreachable?.length)),
      h('p', { class: 'muted small', text: `Coverage = share of the ${NCELLS} parameter cells won by a non-fallback row, in the weakest scene a conversation can start in. Reachability assumes at most ${nr?.maxTalks ?? 1} conversation(s) per person per day over 5 days (Talks/day in the header).` }),
      this.scenePanel(nr),
      diagList(mine, (x) => this.pickDiag(x)),
      others.length ? h('p', { class: 'd-err small', text: `${others.length} error(s) in other files (${[...new Set(others.map((o) => o.file))].join(', ')}).` }) : null);
    this.side.replaceChildren(this.card(), summary, this.selectedPanel(nr), this.treePanel(nr));
  }

  private card(): HTMLElement {
    const info = this.ctx.model.npcs.find((n) => n.id === this.npc);
    const el = characterCard(info, this.ctx.model.scenes, this.cardOpen);
    el.addEventListener('toggle', () => { this.cardOpen = (el as HTMLDetailsElement).open; });
    return el;
  }

  /** direct predecessors / successors of a row (the graph's "Reached from" / "Leads to", in text) */
  private links(r: Row): HTMLElement {
    const t = this.table!;
    const from = t.rows.flatMap((x) => [1, 2, 3].filter((k) => r.id && x[`choice${k}`] && x[`next${k}`] === r.id).map((k) => `${x.id} c${k}`));
    const to = [1, 2, 3].filter((k) => r[`choice${k}`] || r[`next${k}`]).map((k) => (r[`next${k}`] ? `c${k} → ${r[`next${k}`]}` : `c${k} ends`));
    return h('div', { class: 'small links' },
      h('div', {}, h('span', { class: 'k-up', text: 'Reached from: ' }), from.join(', ') || '–'),
      h('div', {}, h('span', { class: 'k-down', text: 'Leads to: ' }), to.join(', ') || '–'));
  }

  /** SPEC "Dialogue location": completeness per scene this NPC can be met in */
  private scenePanel(nr: NpcResult | undefined): HTMLElement | null {
    const list = nr?.scenes;
    if (!list?.length) return null;
    const talk = new Set(nr?.talkScenes ?? []);
    return h('table', { class: 'scenes-tbl small' },
      h('thead', {}, h('tr', {}, ...['scene', 'coverage', 'no row', 'ties', 'rows only here'].map((t) => h('th', { text: t })))),
      h('tbody', {}, ...list.map((sc) => h('tr', {},
        h('td', { text: sc.scene == null ? '(anywhere)' : `${sc.scene}${talk.has(sc.scene) ? '' : ' (events only)'}` }),
        h('td', { text: `${(sc.coverage * 100).toFixed(1)}%` }),
        h('td', { class: sc.noMatch ? 'd-err' : '', text: String(sc.noMatch) }),
        h('td', { class: sc.ties.length ? 'd-err' : '', text: String(sc.ties.length) }),
        h('td', { text: sc.located.join(', ') || '–' })))));
  }

  private pickDiag(x: Diagnostic): void {
    const t = this.table!;
    const id = x.row?.split(',')[0];
    const i = id ? t.rows.findIndex((r) => r.id === id) : -1;
    if (i >= 0) this.select(i);
    const el = this.tbody.querySelector<HTMLElement>(`[data-i="${i}"][data-c="${x.column}"]`);
    el?.focus();
  }

  private selectedPanel(nr: NpcResult | undefined): HTMLElement {
    const t = this.table!;
    const r = t.rows[this.sel];
    if (!r) return h('section', { class: 'panel' }, h('h3', { text: 'Selected row' }), h('p', { class: 'muted', text: 'Click a row to see how a player reaches it.' }));
    const info = r.id ? nr?.rows?.[r.id] : undefined;
    const dep = depths(t.rows).get(r.id);
    const wins = r.id ? nr?.winCount?.[r.id] ?? 0 : 0;
    const ds = this.lastDiag.get(this.sel) ?? [];
    return h('section', { class: 'panel' },
      h('h3', {}, `Selected row `, h('code', { text: r.id || '(no id)' })),
      this.links(r),
      h('p', { class: 'small' }, `${r.scene ? `Only in ${sceneList(r.scene).join(', ')} · ` : ''}Wins ${wins} cells (all scenes) · runs up to ${dep ?? '–'} turn(s) from here${dep != null ? (dep > FREE_TURNS ? ` (turns 1-${FREE_TURNS} free; staying for turn ${FREE_TURNS + 1} costs ${DIALOGUE_COST})` : ` (within the ${FREE_TURNS} free turns)`) : ''}`),
      h('div', { class: 'witness' },
        h('div', { class: 'muted small', text: info?.witness ? `Cheapest path: ${info.cost} action(s)` : 'Witness path' }),
        h('code', { text: info?.witness ?? (nr?.skipped ? '(not analysed)' : info?.witnessNoLimit ? `unreachable with ${nr?.maxTalks ?? 1} conversation(s) per day; without the limit (${info.costNoLimit} action(s)): ${info.witnessNoLimit}` : 'unreachable: no sequence of choices or events reaches this row') })),
      ds.length ? diagList(ds) : null);
  }

  private treePanel(nr: NpcResult | undefined): HTMLElement {
    const t = this.table!;
    const byId = new Map(t.rows.filter((r) => r.id).map((r) => [r.id, r]));
    const dep = depths(t.rows);
    const win = nr?.winCount ?? {};
    const entries = t.rows.filter((r) => r.id && (win[r.id] ?? 0) > 0);
    const reached = new Set<string>();
    let budget = 400; // diamonds in the graph repeat subtrees; keep the view bounded
    const node = (id: string, turn: number, via: string, path: Set<string>): HTMLElement => {
      const r = byId.get(id);
      const li = h('li');
      if (--budget < 0) { if (budget === -1) li.append(h('span', { class: 'muted small', text: '… (tree truncated)' })); return li; }
      if (!r) { li.append(h('span', { class: 'd-err', text: `${via}→ ${id} (missing row)` })); return li; }
      if (path.has(id)) { li.append(h('span', { class: 'muted', text: `${via}↻ back to ${id}` })); return li; }
      reached.add(id);
      const cost = nr?.rows?.[id]?.cost;
      const line = h('button', { class: `tnode${t.rows[this.sel]?.id === id ? ' on' : ''}`, onclick: () => this.selectId(id) },
        h('span', { class: 'via', text: via }),
        h('b', { text: id }),
        r.scene ? h('span', { class: 'scene-tag', text: `@${sceneList(r.scene).join('|')}` }) : null,
        h('span', { class: 'turn', text: `turn ${turn}` }),
        h('span', { class: 'excerpt', text: (r.line || '').slice(0, 60) }),
        turn === FREE_TURNS + 1 ? h('span', { class: 'turn', title: `the choice into turn ${FREE_TURNS + 1} costs ${DIALOGUE_COST} action (once per conversation)`, text: `pay to stay +${DIALOGUE_COST}` }) : null,
        h('span', { class: 'meta', text: `${turn === 1 ? `${win[id] ?? 0} cells · up to ${dep.get(id)} turns` : ''}${cost != null ? ` · ${cost} act` : ''}` }));
      li.append(line);
      const kids: HTMLElement[] = [];
      if (turn < 12) {
        const p2 = new Set(path).add(id);
        for (const k of [1, 2, 3]) {
          const n = r[`next${k}`];
          // an explicit `cost N` (a substantive ask) shows on the edge
          const ask = parseEffects(r[`effect${k}`] ?? '').ops.reduce((a: number, o: { op: string; v: number }) => (o.op === 'cost' ? a + o.v : a), 0);
          if (r[`choice${k}`] && n) kids.push(node(n, turn + 1, `c${k}${ask ? ` (cost ${ask})` : ''} `, p2));
        }
      }
      if (kids.length) li.append(h('ul', {}, ...kids));
      return li;
    };
    const roots = entries.map((r) => node(r.id, 1, '', new Set()));
    const orphans = t.rows.filter((r) => r.id && !reached.has(r.id));
    return h('section', { class: 'panel tree' },
      h('h3', { text: 'Conversation tree' }),
      h('p', { class: 'muted small', text: 'Entry rows (rows that win at least one cell) and the follow-ups their choices lead to.' }),
      h('ul', { class: 'troot' }, ...roots),
      orphans.length ? h('div', {}, h('div', { class: 'muted small', text: 'Not reached from any entry row:' }),
        h('div', { class: 'orphans' }, ...orphans.map((r) => h('button', { class: 'mini', onclick: () => this.selectId(r.id), text: r.id })))) : null);
  }
}

export function rapportDatalist(): HTMLElement {
  return h('datalist', { id: 'rapport-hints' }, ...RAPPORT_HINTS.map((v) => h('option', { value: v })));
}

export type { CheckResult };
