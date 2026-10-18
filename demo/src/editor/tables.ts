/** Events and News tabs: generic editable tables with checker validation. */
import { DIMS, EMOTIONS, EV_SIDES, VALENCE, PROXIMITY, TRIGGERS, CHANNELS } from '../../tools/checker/core.mjs';
import { h } from './dom';
import type { Row, Table } from './csv';
import type { Doc } from './model';
import { badge, diagList, diagsByRow, markCells, nextId, selectEl, type Ctx } from './shared';

type ColKind = { type: 'enum'; values: () => string[]; blank: boolean } | { type: 'text'; size?: number; list?: () => string[] } | { type: 'long' };
interface ColSpec { key: string; label?: string; kind: ColKind }

const en = (values: string[] | (() => string[]), blank = true): ColKind => ({ type: 'enum', values: typeof values === 'function' ? values : () => values, blank });

export class TableTab {
  el = h('div', { class: 'tab-body tbl' });
  sel = -1;
  private tbody = h('tbody');
  private side = h('aside', { class: 'side' });
  private msg = h('span', { class: 'msg', role: 'status' });
  private cols: ColSpec[];

  constructor(private ctx: Ctx, private path: 'events.csv' | 'news.csv') {
    const m = ctx.model;
    const npcIds = () => m.npcs.map((n) => n.id);
    const sceneIds = () => m.scenes.map((s) => s.id);
    const castIds = () => [...new Set([...Object.keys(m.manifest.cast ?? {}), ...m.castIds])];
    this.cols = path === 'events.csv'
      ? [
        { key: 'id', kind: { type: 'text', size: 14 } },
        { key: 'source', kind: en(EV_SIDES, false) }, { key: 'target', kind: en(EV_SIDES, false) },
        { key: 'valence', kind: en(VALENCE, false) }, { key: 'proximity', kind: en(PROXIMITY, false) },
        { key: 'trigger', kind: en(TRIGGERS, false) },
        { key: 'scene', kind: en(sceneIds) }, { key: 'npc', kind: en(npcIds) },
        { key: 'minRapport', label: 'minRap', kind: en(['0', '1', '2', '3']) },
        { key: 'playerLean', label: 'lean', kind: en(DIMS[4].values) }, { key: 'nationalLeader', label: 'leader', kind: en(DIMS[3].values) },
        { key: 'chance', kind: { type: 'text', size: 3 } }, { key: 'cost', kind: { type: 'text', size: 2 } },
        { key: 'emotion', kind: en(EMOTIONS) },
        { key: 'portrait', label: 'portrait (cast)', kind: { type: 'text', size: 10, list: castIds } },
        { key: 'text', kind: { type: 'long' } },
        { key: 'choice1', kind: { type: 'long' } }, { key: 'effect1', kind: { type: 'text', size: 18 } },
        { key: 'choice2', kind: { type: 'long' } }, { key: 'effect2', kind: { type: 'text', size: 18 } },
      ]
      : [
        { key: 'id', kind: { type: 'text', size: 12 } },
        { key: 'channel', kind: en(CHANNELS, false) },
        { key: 'nationalLeader', label: 'leader', kind: en(DIMS[3].values) },
        { key: 'dayMin', kind: en(['1', '2', '3', '4', '5']) },
        { key: 'valence', kind: en(VALENCE) },
        { key: 'figure', label: 'figure (cast)', kind: { type: 'text', size: 10, list: castIds } },
        { key: 'headline', kind: { type: 'long' } },
        { key: 'body', kind: { type: 'long' } },
      ];
  }

  get doc(): Doc | undefined { return this.ctx.model.doc(this.path); }
  get table(): Table | null { return this.doc?.table ?? null; }
  analyse(): string[] { return []; }

  render(): void {
    const m = this.ctx.model, d = this.doc;
    const head = h('div', { class: 'toolbar' },
      h('button', { onclick: () => this.add(), disabled: !this.table, text: '+ Row' }),
      h('button', { class: 'ghost', onclick: () => this.revert(), disabled: !(d && m.changed(d)), text: 'Revert file' }),
      h('span', { class: 'muted', text: `content/${this.path}` }),
      this.msg);
    const wrap = h('div', { class: 'tablewrap' });
    const castList = h('datalist', { id: `cast-${this.path}` }, ...[...new Set([...Object.keys(m.manifest.cast ?? {}), ...m.castIds])].map((v) => h('option', { value: v })));
    if (!this.table) wrap.append(h('p', { class: 'empty', text: `content/${this.path} is missing.` }));
    else {
      wrap.append(castList, h('table', { class: 'sheet' },
        h('thead', {}, h('tr', {}, h('th'), ...this.cols.map((c) => h('th', { class: c.kind.type === 'long' ? 'wide' : '', text: c.label ?? c.key, title: c.key })), h('th'))),
        this.tbody));
      this.renderRows();
    }
    this.el.replaceChildren(head, h('div', { class: 'split' }, wrap, this.side));
    this.renderSide();
  }

  private renderRows(): void {
    const t = this.table!;
    this.tbody.replaceChildren(...t.rows.map((r, i) => this.rowEl(r, i)));
    this.wire();
    this.onResult();
  }

  private rowEl(r: Row, i: number): HTMLTableRowElement {
    const at = (c: string) => ({ 'data-i': String(i), 'data-c': c, 'aria-label': `${r.id} ${c}` });
    const cell = (c: ColSpec) => {
      const v = r[c.key] ?? '';
      if (c.kind.type === 'enum') return selectEl(c.kind.values(), v, at(c.key), c.kind.blank);
      if (c.kind.type === 'long') return h('textarea', { ...at(c.key), rows: 3 }, v);
      return h('input', { ...at(c.key), value: v, size: c.kind.size ?? 8, list: c.kind.list ? `cast-${this.path}` : null });
    };
    return h('tr', { 'data-row': String(i), class: i === this.sel ? 'sel' : '' },
      h('td', { class: 'b' }),
      ...this.cols.map((c) => h('td', { class: c.kind.type === 'long' ? 'wide' : '' }, cell(c))),
      h('td', { class: 'acts' },
        h('button', { class: 'mini', 'data-act': 'up', 'data-i': String(i), title: 'Move up', text: '↑' }),
        h('button', { class: 'mini', 'data-act': 'down', 'data-i': String(i), title: 'Move down', text: '↓' }),
        h('button', { class: 'mini', 'data-act': 'dup', 'data-i': String(i), title: 'Duplicate row', text: 'Dup' }),
        h('button', { class: 'mini danger', 'data-act': 'del', 'data-i': String(i), title: 'Delete row', text: 'Del' })));
  }

  private wired = false;
  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    const set = (e: Event) => {
      const el = e.target as HTMLInputElement;
      const i = el.dataset.i, c = el.dataset.c, t = this.table;
      if (i == null || !c || !t?.rows[+i]) return false;
      t.rows[+i][c] = el.value;
      return true;
    };
    this.tbody.addEventListener('input', (e) => { if (set(e)) this.ctx.changed(); });
    this.tbody.addEventListener('change', (e) => { if (set(e)) this.ctx.changed(); });
    this.tbody.addEventListener('focusin', (e) => {
      const tr = (e.target as HTMLElement).closest('tr');
      if (tr?.dataset.row == null) return;
      this.sel = +tr.dataset.row;
      this.tbody.querySelectorAll('tr.sel').forEach((x) => x.classList.remove('sel'));
      tr.classList.add('sel');
    });
    this.tbody.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!b) return;
      const i = +(b.dataset.i ?? -1), t = this.table!;
      const act = b.dataset.act;
      if (act === 'up' || act === 'down') {
        const j = i + (act === 'up' ? -1 : 1);
        if (j < 0 || j >= t.rows.length) return;
        [t.rows[i], t.rows[j]] = [t.rows[j], t.rows[i]];
        this.sel = j;
      } else if (act === 'dup') {
        const r = { ...t.rows[i], id: nextId(t.rows.map((x) => x.id), t.rows[i].id || 'row_1') };
        t.rows.splice(i + 1, 0, r);
        this.sel = i + 1;
        this.say(`Duplicated as ${r.id}.`);
      } else if (act === 'del') {
        const id = t.rows[i].id;
        const refs = this.referrers(id);
        if (refs.length) { this.say(`Can't delete ${id}: invited by ${refs.join(', ')}.`, 'err'); return; }
        t.rows.splice(i, 1);
        this.say(`Deleted ${id}.`);
      }
      this.renderRows();
      this.ctx.changed();
    });
  }

  /** dialogue rows and events whose effects invite this event id */
  private referrers(id: string): string[] {
    if (this.path !== 'events.csv' || !id) return [];
    const re = new RegExp(`(^|;)\\s*invite\\s+${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(;|$)`);
    const out: string[] = [];
    for (const d of this.ctx.model.docs.values()) {
      if (!d.table || d.kind === 'news') continue;
      for (const r of d.table.rows) for (const k of [1, 2, 3]) if (re.test(r[`effect${k}`] ?? '') && r.id !== id) out.push(`${d.kind === 'dialogue' ? d.npc + '/' : ''}${r.id}`);
    }
    return [...new Set(out)];
  }

  private add(): void {
    const t = this.table!;
    const r: Row = Object.fromEntries(t.columns.map((c) => [c, ''])) as Row;
    r.id = nextId(t.rows.map((x) => x.id), t.rows[t.rows.length - 1]?.id || (this.path === 'events.csv' ? 'ev_1' : 'news_1'));
    if (this.path === 'events.csv') Object.assign(r, { source: 'us', target: 'home', valence: 'positive', proximity: 'proximal', trigger: 'enter', chance: '0.3', cost: '0' });
    else Object.assign(r, { channel: 'tv', dayMin: '1' });
    t.rows.push(r);
    this.sel = t.rows.length - 1;
    this.renderRows();
    this.ctx.changed();
    this.tbody.querySelector(`tr[data-row="${this.sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  private revert(): void {
    const d = this.doc;
    if (!d) return;
    this.ctx.model.revertDoc(d);
    this.render();
    this.ctx.changed();
    this.say('Reverted to the bundled file (Save to make it stick).');
  }

  private say(text: string, kind: 'ok' | 'err' = 'ok'): void {
    this.msg.textContent = text;
    this.msg.className = `msg ${kind}`;
  }

  onResult(): void {
    const t = this.table, d = this.doc;
    if (!t || !d) return;
    const { rows } = diagsByRow(t, d.optional, d.path, this.ctx.result());
    this.tbody.querySelectorAll<HTMLTableRowElement>('tr[data-row]').forEach((tr) => {
      const i = +tr.dataset.row!;
      tr.querySelector('td.b')!.replaceChildren(badge(rows.get(i)));
      tr.classList.toggle('has-err', !!rows.get(i)?.some((x) => x.severity === 'error'));
    });
    markCells(this.tbody, rows);
    this.renderSide();
  }

  private renderSide(): void {
    const res = this.ctx.result(), d = this.doc;
    if (!res || !d) { this.side.replaceChildren(h('p', { class: 'muted', text: 'Validating…' })); return; }
    const mine = res.diagnostics.filter((x) => x.file === d.path && x.severity !== 'info');
    const errs = mine.filter((x) => x.severity === 'error').length;
    const t = this.table;
    const extra = this.path === 'news.csv' && t
      ? h('p', { class: 'small muted', text: `${t.rows.filter((r) => r.channel === 'tv').length} TV, ${t.rows.filter((r) => r.channel === 'print').length} print · enforcement ${t.rows.filter((r) => r.nationalLeader === 'enforcement').length}, inclusive ${t.rows.filter((r) => r.nationalLeader === 'inclusive').length}, any ${t.rows.filter((r) => !r.nationalLeader).length}` })
      : t ? h('p', { class: 'small muted', text: `${t.rows.length} events · triggers: ${TRIGGERS.map((g) => `${g} ${t.rows.filter((r) => r.trigger === g).length}`).join(', ')} · overheard (no choices): ${t.rows.filter((r) => !r.choice1 && !r.choice2).length}` }) : null;
    this.side.replaceChildren(h('section', { class: 'panel' },
      h('h3', {}, 'Validation ', h('span', { class: `pill ${errs ? 'p-err' : mine.length ? 'p-warn' : 'p-ok'}`, text: errs ? `${errs} error${errs > 1 ? 's' : ''}` : mine.length ? `${mine.length} warning(s)` : 'all clear' })),
      extra,
      diagList(mine, (x) => {
        const i = this.table?.rows.findIndex((r) => r.id === x.row) ?? -1;
        this.tbody.querySelector<HTMLElement>(`[data-i="${i}"][data-c="${x.column ?? 'id'}"]`)?.focus();
      }),
      h('p', { class: 'small muted', text: 'The optional cast column names a cast id (content/cast.yaml or the asset manifest\'s cast table); leave blank for the default image.' })));
  }
}
