/** Dialogue tab: one NPC's sheet as an editable table, with a follow-up tree and live checker validation. */
import { DIMS, EMOTIONS, NCELLS, parseCondition, type CheckResult, type Diagnostic, type NpcResult } from '../../tools/checker/core.mjs';
import { h } from './dom';
import type { Row, Table } from './csv';
import type { Doc } from './model';
import { badge, diagList, diagsByRow, markCells, nextId, selectEl, type Ctx } from './shared';

const COND = DIMS.map((d) => d.key);
const COND_LABEL: Record<string, string> = { met: 'met', rapport: 'rapport', lastValence: 'lastVal', nationalLeader: 'leader', playerLean: 'lean', dayPhase: 'phase' };
const RAPPORT_HINTS = ['0', '1', '2', '3', '1+', '2+', '3+', '0-1', '0-2', '1-2', '1-3', '2-3'];

/** SPEC depth: 1 + max depth of the choices' next rows; a cycle counts as depth 3 */
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
      d = c === Infinity ? Math.max(d, 3) : Math.max(d, 1 + c);
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
      this.npc = (e.target as HTMLSelectElement).value; this.sel = -1;
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
    this.head.replaceChildren(
      h('label', { class: 'fld' }, 'NPC ', npcSel),
      h('button', { onclick: () => this.addRow(), disabled: !this.table, text: '+ Row' }),
      h('button', { class: 'ghost', onclick: () => this.revert(), disabled: !(doc && m.changed(doc)), text: 'Revert sheet' }),
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
        h('th', { text: 'conditions · priority · emotion' }), h('th', { class: 'wide', text: 'line' }),
        h('th', { class: 'wide', text: 'choices (text · effect · next)' }), h('th', { text: '' })));
      wrap.append(h('table', { class: 'sheet' }, thead, this.tbody));
      this.renderRows();
    }
    this.el.replaceChildren(this.head, h('div', { class: 'split' }, wrap, this.side));
    this.renderSide();
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
        ...COND.slice(2).map((c, di) => h('label', { class: 'cf' }, h('span', { text: COND_LABEL[c] }), condCell(c, di + 2))))),
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
    this.applyDiag();
    this.renderSide();
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
    if (!res || !t || !d) { this.side.replaceChildren(h('p', { class: 'muted', text: t ? 'Validating…' : '' })); return; }
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
        stat('over budget', String(nr?.overBudget?.length ?? 0), !!nr?.overBudget?.length)),
      h('p', { class: 'muted small', text: `Coverage = share of the ${NCELLS} parameter cells won by a non-fallback row.` }),
      diagList(mine, (x) => this.pickDiag(x)),
      others.length ? h('p', { class: 'd-err small', text: `${others.length} error(s) in other files (${[...new Set(others.map((o) => o.file))].join(', ')}).` }) : null);
    this.side.replaceChildren(summary, this.selectedPanel(nr), this.treePanel(nr));
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
      h('p', { class: 'small' }, `Wins ${wins} of ${NCELLS} cells · conversation depth ${dep ?? '–'}${dep != null && dep < 3 ? ' (free to talk: depth < 3)' : ''}`),
      h('div', { class: 'witness' },
        h('div', { class: 'muted small', text: info?.witness ? `Cheapest path: ${info.cost} action(s)` : 'Witness path' }),
        h('code', { text: info?.witness ?? (nr?.skipped ? '(not analysed)' : 'unreachable: no sequence of choices or events reaches this row') })),
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
        h('span', { class: 'turn', text: `turn ${turn}` }),
        h('span', { class: 'excerpt', text: (r.line || '').slice(0, 60) }),
        h('span', { class: 'meta', text: `${turn === 1 ? `${win[id] ?? 0} cells · depth ${dep.get(id)}${(dep.get(id) ?? 3) < 3 ? ' · free' : ''}` : ''}${cost != null ? ` · ${cost} act` : ''}` }));
      li.append(line);
      const kids: HTMLElement[] = [];
      if (turn < 12) {
        const p2 = new Set(path).add(id);
        for (const k of [1, 2, 3]) {
          const n = r[`next${k}`];
          if (r[`choice${k}`] && n) kids.push(node(n, turn + 1, `c${k} `, p2));
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
