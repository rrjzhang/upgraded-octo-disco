export type Community = 'home' | 'us' | 'neutral';
export type Leader = 'enforcement' | 'inclusive';
/** SPEC "Leads": which of a side's two leaders is first among equals in this room (pro- or anti-integration). */
export type LeadPos = 'pro' | 'anti';
export const LEAD_POS: readonly LeadPos[] = ['pro', 'anti'];
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
  /** look: per-pack variants of `text` (SPEC "Content schemas"); `text` stays the fallback */
  textByPack?: Partial<Record<CultureId, string>>;
}

// placeholder: true draws a visible PLACEHOLDER box over the zone until the art that should be there exists
export interface Hotspot { id: string; label: string; zone: Zone; action: HotspotAction; placeholder?: boolean }

// A background variant with some NPCs painted into the image. Used when the asset exists and every
// listed NPC is in the player's roster; those NPCs are then present without a figure and are reached
// through `talk` hotspots instead of clickable cut-outs.
export interface Painted { background: string; npcs: string[] }
/**
 * SPEC "Content schemas" occupied: a background variant drawn while any of the named slots is taken by a present NPC
 * (the park's chess game in progress: the board is only set when someone sits at it). Resolved like the other variants:
 * only when the asset is real; `byBackground` quads resolve through the scene's base background.
 */
export interface Occupied { background: string; slots: string[] }
/** SPEC "Content schemas" byPack: a per-pack background (and evening render) that replaces the scene's `background` once its asset exists. */
export interface PackBackground { background: string; evening?: string }
/** Where a figure's feet stand (fractions of the image; y may exceed 1 to crop the legs). `scale` overrides the horizon formula. */
export interface Slot { id: string; x: number; y: number; scale?: number; /** a seated spot (on real seating); seated figures may only use these */ seated?: boolean }
/** A TV screen painted into the background: the glass corners (top-left, top-right, bottom-right, bottom-left) as fractions of the image. */
export interface Screen { id: string; quad: [number, number][]; /** a different quad for a background variant (e.g. bg_home_eve), keyed by its asset id */ byBackground?: Record<string, [number, number][]> }
export interface Prop {
  asset: string; x: number; y: number; w: number;
  /** SPEC "Content schemas": the image projected onto this quad (fractions of the background; TL, TR, BR, BL) instead of x/y/w */
  quad?: [number, number][];
  /** a different quad for a background variant, keyed by its asset id (as Screen.byBackground) */
  byBackground?: Record<string, [number, number][]>;
  /** drawn above the figures (the town hall podium, cropped from the background, in front of the speaker) */
  over?: boolean;
}
export interface Exit { to: string; label: string }

export interface Scene {
  id: string;
  name: string;
  community: Community;
  /** SPEC "Packs": the culture pack this scene belongs to; absent = shared (listed for everyone). */
  pack?: CultureId;
  background: string; // asset id or 'none'
  lighting?: string;
  description: string;
  exits: Exit[];
  hotspots: Hotspot[];
  slots: Slot[];
  props: Prop[];
  painted?: Painted;
  occupied?: Occupied;
  /** per-pack background variants (cn | mx | in); used only when the asset exists and is not a placeholder */
  byPack?: Partial<Record<CultureId, PackBackground>>;
  /** TV glass quads the engine draws the current story onto (SPEC "TV screens show the news") */
  screens: Screen[];
  /** Eye-level line as a fraction of the image height (where the vanishing lines meet). */
  horizon: number;
  /** Camera height in metres (default 1.6). */
  cameraHeight: number;
  /** Cut-out figures present at once (SPEC "How many people at once"); absent = the room's maxPresent, else 3. */
  maxPresent?: number;
  /** not a place the player walks to: entered by the engine only (the town hall) */
  hidden?: boolean;
}

/** `figure`: asset id used in this scene instead of the NPC's default figure (blank = default). */
export interface Appearance { scene: string; slot: string; chance: number; figure?: string }

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
  /** Writer-facing character profile (SPEC "Profiles"), exactly as written in npcs.yaml; the engine never uses it. */
  profile?: NpcProfile;
  /** SPEC "Leads": this NPC is one of the side's two leaders (pro- or anti-integration); the room picks which one leads. */
  lead?: LeadPos;
  /** how other people refer to them in a line ("Mr. Guo", "Ruth"); {usLead}/{homeLead} use it, falling back to `name` */
  called?: string;
  /** rapport can never rise above this (default 3); a hostile NPC carries 1 */
  maxRapport: number;
  /** emotions this NPC's rows may use (default all four); a never-warm NPC lists three */
  emotions?: Emotion[];
}

/** SPEC "Character profiles": camelCase keys as in npcs.yaml; unknown keys are kept (the checker warns on them). */
export interface NpcProfile {
  integrationLean?: number;
  warmth?: number;
  talkative?: number;
  backstory?: string;
  motivation?: string;
  voice?: string;
  topics?: string[];
  avoid?: string[];
  [key: string]: unknown;
}

export const COND_FIELDS = ['met', 'rapport', 'lastValence', 'nationalLeader', 'playerLean', 'dayPhase'] as const;
export type CondField = (typeof COND_FIELDS)[number];

export interface Choice { text: string; effect: string; next: string }

export interface DialogueRow {
  id: string;
  npc: string;
  conds: Record<CondField, string>;
  /** optional `usLead` / `homeLead` columns: '' = any room, else pro|anti (SPEC "Leads"); each adds 1 to specificity */
  usLead: string;
  homeLead: string;
  /** optional `day` column: '' = any day, else `4`, `2-3` or `4+` (SPEC "Leads": the day-4 story does not repeat on day 5); adds 1 to specificity */
  day: string;
  /** optional `absent` column: an NPC id who must NOT be in the scene for the row ("I'm waiting on Walt" only while Walt is not there); adds 1 to specificity */
  absent: string;
  /** optional `scene` column: raw cell ('' = anywhere) and its `|`-separated scene ids */
  scene: string;
  scenes: string[];
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
  /** optional cast id (manifest.cast / content/cast.yaml): that bust is shown on the right panel */
  portrait: string;
  /** optional prop id (manifest.props, e.g. prop_radio): the event is heard, not seen; that object is shown
   *  on the right panel instead of any bust (SPEC "Content schemas", events.csv `medium`) */
  medium: string;
  /** SPEC "Packs": culture pack this row is for; '' = every pack (a variant in its id group replaces it for that pack) */
  pack: CultureId | '';
  /** optional `day` cell: '' = any day, else a day 1..5, a range `2-3` or `4+` (SPEC "Leads": forced and day-4 events) */
  day: string;
  /** optional lead conditions, `|` alternatives allowed: '' = any room, else pro|anti */
  usLead: string;
  homeLead: string;
  /** invitations only (SPEC "Plans"): the part of the day the plan happens; '' = at the next day start, as before */
  when: '' | Phase;
}

export interface NewsRow {
  id: string;
  channel: 'tv' | 'print';
  nationalLeader: string;
  dayMin: number;
  valence: string;
  headline: string;
  body: string;
  /** optional cast id: TV shows that figure's still, print shows the bust beside the headline */
  figure: string;
  /** SPEC "Packs": culture pack this story is for; '' = every pack (a variant in its id group replaces it for that pack) */
  pack: CultureId | '';
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
  /** npc id -> candidate id -> 160 px thumbnail (portrait/<npc>_candidate_<n>.png), for the researcher page */
  candidateThumbs?: Record<string, Record<string, string>>;
  /** optional: alternate id -> canonical id (e.g. ch_us_neighbor -> us_neighbor) */
  aliases?: Record<string, string>;
  tvMeta?: Record<string, { placeholder?: boolean; w?: number; h?: number }>;
  /** authority figures referenced by news.csv `figure` and events.csv `portrait` */
  cast?: Record<string, ManifestCast>;
}
export interface ManifestCast {
  name?: string; role?: string;
  bust?: string | null; tv?: string | null; ref?: string | null;
  placeholder?: boolean; fromReference?: boolean;
}

export interface CastInfo { id: string; name: string; role: string }

/** What the researcher override (localStorage gv:override:v1 + IndexedDB gv/images) changed for this load. */
export interface OverrideInfo {
  /** text keys applied, e.g. "dialogue/us_neighbor", "news", "events", "npcs", "scenes" */
  applied: string[];
  /** text keys rejected (validation failed; bundled file used instead), with their problems */
  rejected: { key: string; problems: string[] }[];
  /** image keys with an object URL, e.g. "portraits/us_neighbor/warm" */
  images: string[];
  updated?: string;
  ignored?: boolean; // &nooverride=1
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
  profile: Profile;
  /** SPEC "Town hall": moderator text, topics and the per-lead speeches and reactions */
  townhall: Townhall;
  assetUrl: (file: string) => string;
  errors: string[];
  /** cast id -> display name and role (content/cast.yaml, falling back to the manifest) */
  cast: Map<string, CastInfo>;
  override: OverrideInfo;
  /** image override key -> object URL (see SPEC "Researcher editing, overrides and casting") */
  imageOverrides: Map<string, { url: string; w?: number; h?: number }>;
}

export interface RoomConfig {
  code: string;
  password: string;
  nationalLeader: Leader;
  /** SPEC "Leads": which US local leader and which heritage leader is first among equals (default pro). */
  usLead?: LeadPos;
  homeLead?: LeadPos;
  seed: number;
  rosterPicks: Record<string, string>;
  created: string;
  note?: string;
  /** End-of-day questionnaire pasted by the researcher (same schema as questionnaire/eod.json); overrides the bundled one. */
  questionnaire?: Questionnaire;
  /** Or a URL to fetch that questionnaire from (used when `questionnaire` is absent). */
  questionnaireUrl?: string;
  /** A pinned override snapshot (SPEC); not applied by the demo engine yet: overrides are per browser. */
  override?: { text: unknown; imageKeys: string[] };
  /** Conversations allowed per NPC per day (default 1; SPEC "Conversation limit"). */
  maxTalksPerNpcPerDay?: number;
  /** Cut-out figures present at once in a scene without its own `maxPresent` (default 3; SPEC "How many people at once"). */
  maxPresent?: number;
}

/** SPEC "Profile questions and variant words": the opening questions on the phone (content/profile.yaml). */
export interface ProfileOption { id: string; label: string; /** leaves the dimension unset (the base word is used) */ skip?: boolean }
export interface ProfileQuestion { id: string; question: string; options: ProfileOption[] }
export interface Profile { heritage: ProfileQuestion; followups: Partial<Record<CultureId, ProfileQuestion[]>> }

export interface PlayerInfo {
  name: string;
  homeCulture: CultureId;
  /** the heritage option chosen on the phone (cn | mx | in | other); homeCulture is cn for `other` */
  heritage?: string;
  /** follow-up answers that pick variant words: { region: 'south', faith: 'muslim' } (skipped dimensions absent) */
  variant?: Record<string, string>;
  /** the opening questions have not been answered yet: the phone is open on them and the day has not begun */
  profilePending?: boolean;
  /** The effective culture pack (SPEC "Packs"): homeCulture when the content has that pack, else cn. Recomputed on load. */
  pack: CultureId;
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
  /** SPEC "Plans": invitations accepted for today with a `when`; they fire at that phase (or before the actions run out) */
  plans?: { id: string; when: Phase }[];
  fired: string[];
  seenNews: string[];
  entries: Record<string, number>; // `${day}:${scene}` -> entry count, seeds event rolls
  journal: string;
  dayStartDone: number; // day whose day_start processing has run
  /**
   * The conversation in progress; persisted so a reload resumes it (the last entry of `rules` is the row on screen).
   * `stayPaid`: the one-off charge for staying past the free turns was taken; `cost`: actions its choices spent so far.
   */
  convo?: {
    npc: string; scene: string; started: number; last: number; turns: number; rules: string[]; stayPaid?: boolean; cost?: number;
    /** dev only (`?dev=1`): JSON snapshots of the state before each choice or beat, for the Back button (SPEC "Dev: stepping back") */
    history?: string[];
  };
  /** The event on screen (already fired and paid for) and the ones queued behind it, so a reload shows them again. */
  openEvent?: string;
  queuedEvents?: string[];
  /** conversations ended today per NPC (reset at day start); counted when a conversation ends, follow-ups do not count */
  talks?: { day: number; counts: Record<string, number> };
  /** when the TV was last watched (and which story); used by the Keep watching path (FEATURES.tvKeepWatching) */
  tvWatched?: { day: number; phase: Phase; story?: string };
  /** SPEC "TV once a day": the day the TV was opened; it cannot be opened again that day and the room screens go black */
  tvWatchedDay?: number;
  surveyDay?: number; // day whose end-of-day survey (or the memory test after it) is open; a reload reopens it instead of dropping it
  surveyAnswered?: number; // day whose check-in has been submitted but whose night is not over yet (the memory test follows)
  /** SPEC "Who said what": the day whose nightly memory test was answered (asked once per day, before the survey) */
  whoSaidDay?: number;
  /** SPEC "Town hall": the day-5 closing sequence in progress or done; absent until bed on the last day */
  townhall?: TownhallState;
  finished: boolean;
  started: string;
}

// ---- SPEC "Town hall" (added 2026-10-19): the day-5 closing sequence
export type Stance = 'none' | 'integration' | 'assimilation' | 'separation';
/** a player option at the town hall is coded with one of these; `neutral` = declines to take a side */
export type TopicStance = 'integration' | 'assimilation' | 'separation' | 'neutral';
export const TOPIC_STANCES: readonly TopicStance[] = ['integration', 'assimilation', 'separation', 'neutral'];
export interface TopicOption { text: string; stance: TopicStance }
export interface Topic { id: string; title: string; prompt: string; options: TopicOption[] }
export interface Moderator {
  name: string;
  /** opening words ($ beats allowed, {usLead}/{homeLead} filled) */
  open: string;
  /** before each speaker; {speaker} = that leader's name */
  introduce: string;
  /** the label above the 1..7 scale after each speech block */
  rate: string;
  /** the player is called up, before the topic list */
  callUp: string;
  /** after the leaders' reactions */
  close: string;
}
/** one row of content/townhall/<npcId>.csv */
export interface TownhallRow {
  id: string;
  speaker: string;
  kind: 'speech' | 'reaction';
  nationalLeader: string;
  /** speech: 1-based block number (rated after each); reaction: 0 */
  block: number;
  /** reaction: the player's dominant stance this answers ('' = fallback); speech: '' */
  stance: string;
  emotion: Emotion;
  text: string;
  rowNum: number;
}
export interface Townhall { moderator: Moderator; topics: Topic[]; rows: Map<string, TownhallRow[]> }
export type TownhallStage = 'intro' | 'introduce' | 'speech' | 'rate' | 'callUp' | 'board' | 'topic' | 'reaction' | 'close' | 'done';
export interface TownhallState {
  stage: TownhallStage;
  /** the two leads in speaking order (random per room) */
  order: string[];
  speaker: number;
  block: number;
  beat: number;
  ratings: { speaker: string; block: number; value: number }[];
  answers: Record<string, { option: number; stance: TopicStance }>;
  topic?: string;
  reaction: number;
}
