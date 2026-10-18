/** Helpers shared by the table tabs: diagnostics per row, ids, cell highlighting. */
import type { CheckResult, Diagnostic } from '../../tools/checker/core.mjs';
import type { Model } from './model';
import type { Table } from './csv';
import { rowLines } from './csv';

export interface Ctx {
  model: Model;
  /** a working copy changed: revalidate and refresh header state */
  changed(): void;
  result(): CheckResult | null;
}

/** row index -> diagnostics for that row, plus the file-level ones */
export function diagsByRow(table: Table, optional: string[], file: string, result: CheckResult | null): { rows: Map<number, Diagnostic[]>; file: Diagnostic[] } {
  const rows = new Map<number, Diagnostic[]>();
  const fileLevel: Diagnostic[] = [];
  if (!result) return { rows, file: fileLevel };
  const byId = new Map<string, number[]>();
  table.rows.forEach((r, i) => { if (r.id) byId.set(r.id, [...(byId.get(r.id) ?? []), i]); });
  const lines = rowLines(table, optional);
  const byLine = new Map(lines.map((l, i) => [l, i]));
  const add = (i: number, d: Diagnostic) => rows.set(i, [...(rows.get(i) ?? []), d]);
  for (const d of result.diagnostics) {
    if (d.file !== file || d.severity === 'info') continue;
    let hit: number[] = [];
    if (d.row) {
      const ids = d.code === 'TIE' ? d.row.split(',') : [d.row];
      for (const id of ids) hit.push(...(byId.get(id) ?? []));
      // duplicates: pin to the line the checker named when possible
      if (d.code === 'DUPLICATE_ID' && d.line != null && byLine.has(d.line)) hit = [byLine.get(d.line)!];
    } else if (d.line != null && byLine.has(d.line)) hit = [byLine.get(d.line)!];
    if (hit.length) for (const i of new Set(hit)) add(i, d);
    else fileLevel.push(d);
  }
  return { rows, file: fileLevel };
}

export function badge(ds: Diagnostic[] | undefined): HTMLElement {
  const el = document.createElement('span');
  const errs = (ds ?? []).filter((d) => d.severity === 'error');
  const warns = (ds ?? []).filter((d) => d.severity === 'warning');
  el.className = 'badge ' + (errs.length ? 'b-err' : warns.length ? 'b-warn' : 'b-ok');
  el.textContent = errs.length ? String(errs.length) : warns.length ? String(warns.length) : '';
  el.title = (ds ?? []).map((d) => `${d.severity}: [${d.code}] ${d.column ? d.column + ': ' : ''}${d.message}`).join('\n') || 'no problems';
  return el;
}

/** marks the inputs a diagnostic names (data-i = row index, data-c = column) */
export function markCells(root: HTMLElement, byRow: Map<number, Diagnostic[]>): void {
  root.querySelectorAll('.cell-err, .cell-warn').forEach((e) => { e.classList.remove('cell-err', 'cell-warn'); e.removeAttribute('data-msg'); (e as HTMLElement).title = ''; });
  for (const [i, ds] of byRow) for (const d of ds) {
    if (!d.column) continue;
    const el = root.querySelector<HTMLElement>(`[data-i="${i}"][data-c="${d.column}"]`);
    if (!el) continue;
    el.classList.add(d.severity === 'error' ? 'cell-err' : 'cell-warn');
    el.title = (el.title ? el.title + '\n' : '') + d.message;
  }
}

/** next free id like the given one: DN07 -> DN25 when DN24 is the highest DN id */
export function nextId(ids: string[], like: string): string {
  const m = /^(.*?)(\d+)$/.exec(like);
  const prefix = m ? m[1] : like + '_';
  const width = m ? m[2].length : 2;
  let max = 0;
  for (const id of ids) {
    const mm = /^(.*?)(\d+)$/.exec(id);
    if (mm && mm[1] === prefix) max = Math.max(max, +mm[2]);
  }
  const taken = new Set(ids);
  let n = max + 1;
  let id = prefix + String(n).padStart(width, '0');
  while (taken.has(id)) id = prefix + String(++n).padStart(width, '0');
  return id;
}

export function selectEl(values: string[], current: string, attrs: Record<string, string>, blank = true): HTMLSelectElement {
  const s = document.createElement('select');
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  const opts = blank ? ['', ...values] : [...values];
  if (current && !opts.includes(current)) opts.push(current);
  for (const v of opts) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v === '' ? '·' : v;
    if (v && !values.includes(v)) o.textContent = `${v} (invalid)`;
    s.append(o);
  }
  s.value = current;
  return s;
}

export function diagList(ds: Diagnostic[], onPick?: (d: Diagnostic) => void): HTMLElement {
  const ul = document.createElement('ul');
  ul.className = 'diag';
  if (!ds.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'None.';
    ul.append(li);
  }
  const order = { error: 0, warning: 1, info: 2 } as const;
  for (const d of [...ds].sort((a, b) => order[a.severity] - order[b.severity])) {
    const li = document.createElement('li');
    li.className = d.severity === 'error' ? 'd-err' : d.severity === 'warning' ? 'd-warn' : 'muted';
    const where = [d.row ? `row ${d.row}` : d.line ? `line ${d.line}` : '', d.column ?? '', d.path ?? ''].filter(Boolean).join(' · ');
    li.innerHTML = '';
    const code = document.createElement('b');
    code.textContent = d.code;
    li.append(code, ` ${where ? where + ': ' : ''}${d.message}`);
    if (onPick && (d.row || d.line)) { li.classList.add('pick'); li.addEventListener('click', () => onPick(d)); }
    ul.append(li);
  }
  return ul;
}
