// Type declarations for core.mjs (used by the TypeScript editor under src/editor).
export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  file: string;
  line?: number;
  row?: string;
  column?: string;
  path?: string;
  message: string;
  cells?: number;
}
export interface NpcResult {
  id: string;
  name?: string;
  sheet: string | null;
  sheetRequired?: boolean;
  skipped?: boolean;
  rowCount?: number;
  fallback?: string | null;
  coverage?: number;
  served?: number;
  noMatch?: number;
  ties?: { rows: string[]; cells: number }[];
  neverWins?: string[];
  unreachable?: string[];
  overBudget?: string[];
  reachableStates?: number;
  canTalk?: boolean;
  rows?: Record<string, { cost: number | null; witness: string | null }>;
  winCount?: Record<string, number>;
  cells?: { row: string | null; spec?: number; prio?: number; line?: string; tie?: string[] | null; cost: number | null }[];
  errors?: number;
  warnings?: number;
}
export interface CheckResult {
  content: string;
  generated: string;
  ok: boolean;
  counts: { error: number; warning: number; info: number };
  diagnostics: Diagnostic[];
  npcs: NpcResult[];
}
export interface CheckInput {
  files: Record<string, string | null | undefined>;
  manifest?: string | object | null;
  content?: string;
  analyse?: string[] | null;
}
export function checkContent(input: CheckInput): CheckResult;
export function formatDiag(d: Diagnostic): string;
export function parseCondition(dimIdx: number, raw: string): { set?: Set<number> | null; error?: string };
export function parseEffects(raw: string, eventIds?: Set<string>): { ops: any[]; errors: string[] };
export const DIALOGUE_COLUMNS: string[];
export const EVENT_COLUMNS: string[];
export const NEWS_COLUMNS: string[];
export const EVENT_OPTIONAL: string[];
export const NEWS_OPTIONAL: string[];
export const DIMS: { key: string; values: string[] }[];
export const NCELLS: number;
export const NWORLD: number;
export const BUDGET: number;
export const EMOTIONS: string[];
export const EV_SIDES: string[];
export const VALENCE: string[];
export const PROXIMITY: string[];
export const TRIGGERS: string[];
export const CHANNELS: string[];
export function cellIndex(v: number[]): number;
export function cellVector(c: number): number[];
export function cellLabel(c: number): string;
