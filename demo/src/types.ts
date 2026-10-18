export type Community = 'home' | 'us' | 'neutral';
export type Leader = 'enforcement' | 'inclusive';
export type Lean = 'us-leaning' | 'balanced' | 'home-leaning';
export type DayPhase = 'early' | 'mid' | 'late';
export type Phase = 'morning' | 'afternoon' | 'evening';
export type Valence = 'none' | 'positive' | 'negative';
export type Emotion = 'neutral' | 'warm' | 'guarded' | 'worried';
export type ModuleId = 'tv' | 'work' | 'survey';
export type CultureId = 'cn' | 'mx' | 'in';

export interface Zone { x: number; y: number; w: number; h: number }

export interface HotspotAction {
  type: 'window' | 'news' | 'end_day' | 'move' | 'look' | 'talk';
  module?: ModuleId;
  cost?: number;
  to?: string;
  text?: string;
  npc?: string; // talk: the NPC this zone stands for (a person painted into the background)
}

// placeholder: true draws a visible PLACEHOLDER box over the zone until the art that should be there exists
export interface Hotspot { id: string; label: string; zone: Zone; action: HotspotAction; placeholder?: boolean }

// A background variant with some NPCs painted into the image. Used when the asset exists and every
// listed NPC is in the player's roster; those NPCs are then present without a figure and are reached
// through `talk` hotspots instead of clickable cut-outs.
export interface Painted { background: string; npcs: string[] }
export interface Slot { id: string; x: number; y: number; scale: number }
export interface Prop { asset: string; x: number; y: number; w: number }
export interface Exit { to: string; label: string }

export interface Scene {
  id: string;
  name: string;
  community: Community;
  background: string; // asset id or 'none'
  lighting?: string;
  description: string;
  exits: Exit[];
  hotspots: Hotspot[];
  slots: Slot[];
  props: Prop[];
  painted?: Painted;
}

export interface Appearance { scene: string; slot: string; chance: number }

export interface NpcState { met: 'yes' | 'no'; rapport: number; lastValence: Valence }

export interface Npc {
  id: string;
  name: string;
  pack: string;
  community: string;
  role: string;
  stance: string;
  portrait: string;
  figure?: string;
  seated: boolean;
  appearances: Appearance[];
  initial: NpcState;
}

export const COND_FIELDS = ['met', 'rapport', 'lastValence', 'nationalLeader', 'playerLean', 'dayPhase'] as const;
export type CondField = (typeof COND_FIELDS)[number];

export interface Choice { text: string; effect: string; next: string }

export interface DialogueRow {
  id: string;
  npc: string;
  conds: Record<CondField, string>;
  priority: number;
  specificity: number;
  emotion: Emotion;
  line: string;
  choices: Choice[];
  rowNum: number; // 1-based CSV line number (header = 1)
}

export interface EventRow {
  id: string;
  source: string;
  target: string;
  valence: string;
  proximity: string;
  trigger: 'day_start' | 'enter' | 'invite';
  scene: string;
  npc: string;
  minRapport: number | null;
  playerLean: string;
  nationalLeader: string;
  chance: number;
  cost: number;
  emotion: Emotion;
  text: string;
  choices: { text: string; effect: string }[];
  rowNum: number;
}

export interface NewsRow {
  id: string;
  channel: 'tv' | 'print';
  nationalLeader: string;
  dayMin: number;
  valence: string;
  headline: string;
  body: string;
}

export interface QItem {
  id: string;
  type: 'likert' | 'choice' | 'text';
  text: string;
  scale?: { min: number; max: number; minLabel?: string; maxLabel?: string };
  options?: string[];
}
export interface Questionnaire { id: string; title: string; intro?: string; pages: { items: QItem[] }[] }

export interface ManifestImage { file: string; w?: number; h?: number; placeholder?: boolean; seated?: boolean; lighting?: string }
export interface ManifestPortrait {
  neutral?: string | null; warm?: string | null; guarded?: string | null; worried?: string | null;
  placeholder?: boolean; fromReference?: boolean;
}
export interface Manifest {
  backgrounds: Record<string, ManifestImage>;
  portraits: Record<string, ManifestPortrait>;
  figures: Record<string, ManifestImage>;
  props: Record<string, ManifestImage>;
  tv: Record<string, string[]>;
  candidates: Record<string, string[]>;
  /** optional: alternate id -> canonical id (e.g. ch_us_neighbor -> us_neighbor) */
  aliases?: Record<string, string>;
  tvMeta?: Record<string, { placeholder?: boolean; w?: number; h?: number }>;
}

export interface Content {
  source: 'live' | 'fixtures';
  scenes: Scene[];
  sceneById: Map<string, Scene>;
  npcs: Npc[];
  npcById: Map<string, Npc>;
  dialogue: Map<string, DialogueRow[]>;
  events: EventRow[];
  news: NewsRow[];
  eod: Questionnaire;
  manifest: Manifest;
  strings: Record<string, string>;
  assetUrl: (file: string) => string;
  errors: string[];
}

export interface RoomConfig {
  code: string;
  password: string;
  nationalLeader: Leader;
  seed: number;
  rosterPicks: Record<string, string>;
  created: string;
  note?: string;
}

export interface PlayerInfo {
  name: string;
  homeCulture: CultureId;
  pack: 'cn';
  language: string;
  eligible: boolean;
}

export interface WalletEntry { day: number; amount: number; why: string }

export interface GameState {
  v: 1;
  room: string;
  config: RoomConfig;
  player: PlayerInfo;
  day: number;
  actions: number;
  wallet: number;
  walletLog: WalletEntry[];
  scene: string;
  npcs: Record<string, NpcState>;
  spent: { home: number; us: number; neutral: number };
  invites: string[];
  fired: string[];
  seenNews: string[];
  entries: Record<string, number>; // `${day}:${scene}` -> entry count, seeds event rolls
  journal: string;
  dayStartDone: number; // day whose day_start processing has run
  surveyDay?: number; // day whose end-of-day survey is open; a reload reopens it instead of dropping it
  finished: boolean;
  started: string;
}
