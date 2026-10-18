/** CSV <-> editable table. Canonical serialisation (Papa.unparse, \n newlines, trailing newline) so two tables are
 *  equal exactly when their serialisations are. */
import Papa from 'papaparse';

export type Row = Record<string, string>;
export interface Table {
  columns: string[];
  rows: Row[];
}

export function parseTable(text: string, expected: string[]): Table {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const res = Papa.parse<string[]>(text, { header: false, skipEmptyLines: 'greedy' });
  const data = res.data as string[][];
  const header = (data[0] ?? []).map((h) => String(h).trim());
  const columns = header.length ? header : [...expected];
  const rows = data.slice(1).map((rec) => {
    const r: Row = {};
    for (const c of expected) r[c] = '';
    columns.forEach((c, i) => (r[c] = String(rec[i] ?? '').trim()));
    return r;
  });
  return { columns, rows };
}

/** Columns to write: the file's own header, plus any optional column that now holds a value. */
export function outColumns(t: Table, optional: string[]): string[] {
  const cols = [...t.columns];
  for (const o of optional) if (!cols.includes(o) && t.rows.some((r) => (r[o] ?? '') !== '')) cols.push(o);
  return cols;
}

export function serialize(t: Table, optional: string[] = []): string {
  const cols = outColumns(t, optional);
  const body = Papa.unparse([cols, ...t.rows.map((r) => cols.map((c) => r[c] ?? ''))], { newline: '\n' });
  return body + '\n';
}

/** 1-based line number of each data row in serialize(t) (header is line 1). */
export function rowLines(t: Table, optional: string[] = []): number[] {
  const cols = outColumns(t, optional);
  const out: number[] = [];
  let line = 2;
  for (const r of t.rows) {
    out.push(line);
    line += 1 + cols.reduce((n, c) => n + ((r[c] ?? '').match(/\n/g)?.length ?? 0), 0);
  }
  return out;
}

export const cloneTable = (t: Table): Table => ({ columns: [...t.columns], rows: t.rows.map((r) => ({ ...r })) });
