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
  /** TIE: the scenes the tie occurs in (only when the sheet has located rows) */
  scenes?: string[];
  talks?: number;
}
export interface SceneCompleteness {
  /** null = a TV-only NPC, checked "anywhere" (only blank-scene rows match) */
  scene: string | null;
  coverage: number;
  served: number;
  noMatch: number;
  ties: { rows: string[]; cells: number }[];
  /** rows whose scene cell names this scene */
  located: string[];
}
export type Cell = { row: string | null; spec?: number; prio?: number; line?: string; tie?: string[] | null; cost: number | null };
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
  rows?: Record<string, { cost: number | null; witness: string | null; depth?: number; costNoLimit?: number | null; witnessNoLimit?: string | null }>;
  scenes?: SceneCompleteness[];
  /** scenes where a conversation can start (appearances, painted, talk zones) */
  talkScenes?: string[];
  /** the sheet has rows with a non-blank scene cell */
  located?: boolean;
  sceneCells?: Record<string, Cell[]>;
  maxTalks?: number;
  /** rows reachable without the conversation limit but not with it */
  limitUnreachable?: string[];
  winCount?: Record<string, number>;
  cells?: Cell[];
  errors?: number;
  warnings?: number;
}
export interface CheckResult {
  content: string;
  generated: string;
  ok: boolean;
  counts: { error: number; warning: number; info: number };
  maxTalks: number;
  diagnostics: Diagnostic[];
  npcs: NpcResult[];
  /** SPEC "Packs": per home culture, the pack played and the scenes open to that player */
  packs?: Record<string, PackView>;
}
export interface PackView { culture: string; pack: string; fallback: boolean; scenes: string[] }
export function packView(npcs: Iterable<{ pack?: string }>, scenes: Iterable<{ id: string; pack?: string }>, culture: string): PackView;
export const STANCES: string[];
export const SCENE_PACKS: string[];
export interface CheckInput {
  files: Record<string, string | null | undefined>;
  manifest?: string | object | null;
  content?: string;
  analyse?: string[] | null;
  /** conversations per NPC per day for the reachability search (default 1) */
  maxTalks?: number;
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
export const DIALOGUE_OPTIONAL: string[];
export const DEFAULT_TALKS: number;
export const DEMO_DAYS: number;
export function sceneList(cell: string): string[];
export function isSeatedFigure(assets: any, id: string | undefined): boolean;
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
