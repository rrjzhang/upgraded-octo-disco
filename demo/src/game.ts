/** The game runtime: state transitions + plain-DOM rendering of the 1440x900 stage. */
import type {
  Content, CultureId, DialogueRow, Questionnaire, Emotion, EventRow, GameState, Hotspot, ModuleId, NewsRow, Npc, Prop, Scene, Screen, Slot,
  LeadPos, Phase, TownhallRow, TownhallState, TopicStance,
} from './types';
import { TOPIC_STANCES } from './types';
import {
  DAY_ACTIONS, DEFAULT_TALKS_PER_DAY, DEMO_DAYS, FEATURES, applyEffects, dayPhaseOf, eventMatches, leanOf, optionCharge, phaseOf, selectRow,
  DEFAULT_MAX_PRESENT, figureRect, figuresClash, type FigRect,
  type Delta,
} from './rules';
import { appendLog, debugEnabled, getRoom, readLog, saveState } from './store';
import {
  assetEntry, dialogueCsvFromRows, effectivePack, figureHeight, isSeatedFigure, leadNpc, liveSource, overrideForWrite, overrideIds, parseDialogueQuiet,
  patchDialogueRow, packVars, questionnaireProblems, rowInPack, sceneInPack, storeOverride,
} from './content';
import { SILHOUETTE_BUST, appUrl, downloadText, h, isDev, params, seeded, silhouetteFigure, subst } from './util';
import { matrix3d } from './homography';
import { splitBeats, speechParts, type Beat } from './beats';

const CULTURE_NAMES: Record<string, string> = { cn: 'Chinese', mx: 'Mexican', in: 'Indian' };
const CULTURE_PACK_NAMES: Record<string, string> = { cn: 'China', mx: 'Mexico', in: 'India' };
const IMG_W = 900;
const IMG_H = 600;

type Panel =
  // `ended`: the conversation just finished; the last bust stays on the panel and fades (SPEC "Conversation end")
  | { kind: 'idle'; note?: string; ended?: { npc: string; emotion: Emotion } }
  // `beat`: which `$`-separated part of the line is on screen (SPEC "Writing dialogue: beats and stage directions")
  | { kind: 'dialogue'; npc: string; row: DialogueRow; tie: string[]; beat?: number }
  | { kind: 'event'; ev: EventRow; beat?: number }
  | { kind: 'text'; title?: string; text: string; rule?: string; figure?: string }
  | { kind: 'bed'; hs: string } // going to bed with actions left: confirm first
  | { kind: 'townhall' }; // SPEC "Town hall": the day-5 closing sequence; what is shown comes from state.townhall

// slot null = the NPC is painted into the background (scene.painted); no figure is drawn and a `talk` hotspot stands for them.
// figure = the appearance's own figure asset (blank = the NPC's default).
interface Presence { npc: Npc; slot: Slot | null; figure?: string }

/** Longest the scene swap waits for its images before showing the scene anyway. */
const PRELOAD_CAP_MS = 1500;
/** Cross-fade between the old and the new scene. */
const SWAP_FADE_MS = 150;
/** The TV still is laid out at this size, then mapped onto the screen quad. */
const TV_W = 1280;
const TV_H = 720;
/** The phone's top row with its camera cutout (SPEC "Phone"): decorative, hidden from assistive tech, nothing clickable under it. */
const phoneStatus = (): HTMLElement => h('div', { class: 'ph-status', 'aria-hidden': 'true' }, h('span', { class: 'ph-island' }));

interface OpenWindow {
  module: ModuleId;
  overlay: HTMLElement;
  frame: HTMLIFrameElement;
  onSubmit?: (answers: Record<string, unknown>) => void;
  onClose?: () => void;
}

export class Game {
  private panel: Panel = { kind: 'idle' };
  private queue: EventRow[] = [];
  private phoneOpen = false;
  private phoneTab: 'journal' | 'contacts' | 'wallet' | 'call' | 'profile' = 'journal';
  /** answers in progress on the opening questions (SPEC "Profile questions and variant words") */
  private profileDraft: Record<string, string> = {};
  private win: OpenWindow | null = null;
  private stage: HTMLElement;
  private top!: HTMLElement;
  private sceneBox!: HTMLElement;
  private strip!: HTMLElement;
  private right!: HTMLElement;
  private phoneEl!: HTMLElement;
  private journalDraft: string | null = null;
  private surveyLoading = false;
  /**
   * Dev only: gv.place() puts an NPC on a slot of a scene, for checking sizes. Lives in memory only (never saved,
   * gone on reload) and is ignored by event rolls, so a placement can never change the saved game.
   */
  private devPlaced = new Map<string, { npc: string; slot: string }[]>();
  /** Debugging aids (SPEC "Debug toggle"): reveal button and H, status line, rapport/valence, dev guides. */
  private debug = debugEnabled();
  /** dev only: the dialogue row being edited in place (SPEC "Dev: editing a line in place"); the draft survives re-renders */
  private editing: { npc: string; row: string; line: string; choices: string[]; note?: string; busy?: boolean } | null = null;
  /** image URLs already loaded and decoded (a revisit swaps at once) */
  private loaded = new Set<string>();
  /** a scene swap is waiting for its images (the scene key it waits for): input is held, the old scene stays on screen */
  private swapping: string | null = null;
  /** the scene id currently drawn in the scene box (a change of scene preloads and cross-fades) */
  private shownScene: string | null = null;
  /** dev only: screen quads set with gv.screens(), per scene, in memory */
  private devScreens = new Map<string, Screen[]>();
  /** dev only: prop quads set with gv.propQuad(), per scene and prop asset, in memory (null = flat placement) */
  private devPropQuads = new Map<string, Map<string, [number, number][] | null>>();
  /** the still the room screens showed when the TV was switched on; kept until the TV window closes (memory only) */
  private tvOnScreen: { id: string; image: string | null } | null = null;

  constructor(host: HTMLElement, private c: Content, private s: GameState) {
    // SPEC "Packs": the effective pack follows the content on disk; old saves (no pack, or a pack the content no longer
    // has, or one it has gained since) are recomputed on load. A player left standing in another pack's scene goes home.
    const pack = effectivePack(c, s.player.homeCulture);
    if (s.player.pack !== pack) {
      console.info(`[pack] ${s.player.homeCulture}: effective pack ${s.player.pack ?? '(none)'} -> ${pack}`);
      s.player.pack = pack;
      saveState(s);
    }
    if (!sceneInPack(c.sceneById.get(s.scene), pack)) { s.scene = 'home'; saveState(s); }
    this.stage = h('div', { class: 'stage', id: 'stage' });
    host.replaceChildren(this.stage);
    this.buildShell();
    window.addEventListener('resize', () => this.fit());
    window.addEventListener('message', (e) => this.onMessage(e));
    document.addEventListener('keydown', (e) => this.onKey(e));
    // stamp the open conversation when the page goes away, so a reload closes it with its real duration
    window.addEventListener('pagehide', () => { if (this.s.convo) { this.s.convo.last = Date.now(); this.save(); } });
    // SPEC "Action log": client_error lines, so a blank scene or a crash seen on a participant's machine can be read back
    // from the exported log (what failed, where, which build)
    window.addEventListener('error', (e) => this.clientError('uncaught', `${e.message} @ ${e.filename ?? ''}:${e.lineno ?? ''}`));
    window.addEventListener('unhandledrejection', (e) => this.clientError('unhandledrejection', String((e as PromiseRejectionEvent).reason?.message ?? (e as PromiseRejectionEvent).reason).slice(0, 300)));
    this.fit();
  }

  // ------------------------------------------------------------------ lifecycle
  start(): void {
    if (this.s.finished) {
      this.render();
      this.renderEnd();
      return;
    }
    // SPEC "Profile questions and variant words": the opening questions come first; the day begins once they are answered
    if (this.s.player.profilePending) {
      this.phoneOpen = true;
      this.phoneTab = 'profile';
      this.render();
      return;
    }
    // a conversation open when the page went away (reload, closed tab) resumes on the row it was on (SPEC "Conversation
    // limit semantics": a conversation in progress can always be finished). A stale one (another day, a row that no
    // longer exists after a content edit) is closed as "left", timed to its last turn.
    const cv = this.s.convo;
    const resumeRow = cv && this.s.dayStartDone >= this.s.day && this.s.surveyDay !== this.s.day
      ? (this.c.dialogue.get(cv.npc) ?? []).find((r) => r.id === cv.rules[cv.rules.length - 1]) : undefined;
    if (cv && !resumeRow) this.endConvo(this.s.dayStartDone < this.s.day ? 'day_end' : 'left', cv.last);
    if (this.s.dayStartDone < this.s.day) this.beginDay();
    else {
      // an event on screen (already fired and paid for) and the ones queued behind it survive a reload
      const ev = (id?: string) => (id ? this.c.events.find((e) => e.id === id) : undefined);
      const open = ev(this.s.openEvent);
      this.queue = (this.s.queuedEvents ?? []).map((id) => ev(id)).filter((e): e is EventRow => !!e);
      if (open) this.panel = { kind: 'event', ev: open };
      else if (resumeRow && cv) {
        this.panel = { kind: 'dialogue', npc: cv.npc, row: resumeRow, tie: [] };
        console.info(`[talk] ${cv.npc}: resuming the conversation on ${resumeRow.id} after a reload`);
      }
      if (!open && !resumeRow && this.queue.length) this.nextQueued();
      else this.render();
    }
    // SPEC "Town hall": a reload in the middle of the town hall comes back to the same step
    if (this.townhallActive()) { this.phoneOpen = false; this.panel = { kind: 'townhall' }; this.render(); }
    // The survey window lives only in the DOM; a page reload (dev-server HMR, F5, crash) used to drop it silently
    // and leave the player at home on the same day. The open survey is persisted, so it comes back.
    if (this.s.surveyDay === this.s.day) this.endDay();
  }

  private beginDay(): void {
    const s = this.s;
    s.scene = 'home';
    s.actions = DAY_ACTIONS;
    s.dayStartDone = s.day;
    s.talks = { day: s.day, counts: {} };
    this.panel = { kind: 'idle' };
    this.queue = [];
    // SPEC "Plans": an invitation with a `when` becomes today's plan and fires at that time; the others fire now, as before
    s.plans = [];
    for (const id of s.invites) {
      const ev = this.c.events.find((e) => e.id === id);
      if (!ev) { console.error(`[events] invitation to unknown event "${id}"`); continue; }
      if (ev.when) s.plans.push({ id: ev.id, when: ev.when });
      else this.queue.push(ev);
    }
    s.invites = [];
    const rng = seeded(s.config.seed, 'day_start', s.day);
    const ctx = this.eventCtx('home', false);
    for (const ev of this.eventOrder()) {
      if (ev.trigger !== 'day_start' || s.fired.includes(ev.id)) continue;
      if (!this.eventInPack(ev) || !eventMatches(ev, ctx)) continue;
      if (rng() < ev.chance) {
        this.queue.push(ev);
        break;
      }
    }
    appendLog(s, { type: 'start', target: `day${s.day}`, invites: this.queue.map((e) => e.id) });
    this.save();
    this.nextQueued();
  }

  private nextQueued(): void {
    while (this.queue.length) {
      const ev = this.queue.shift()!;
      if (this.fireEvent(ev)) return;
    }
    this.panel = this.panel.kind === 'event' ? { kind: 'idle' } : this.panel;
    this.render();
  }

  // ------------------------------------------------------------------ SPEC "Plans": timed invitations
  /** Today's plans that have not fired yet, with their event rows. */
  private plans(): { id: string; when: Phase; ev: EventRow }[] {
    return (this.s.plans ?? []).flatMap((p) => { const ev = this.c.events.find((e) => e.id === p.id); return ev ? [{ ...p, ev }] : []; });
  }

  /** Actions kept back for today's plans (their costs): the player cannot spend below this before they happen. */
  private reserved(): number {
    return this.plans().reduce((a, p) => a + p.ev.cost, 0);
  }

  /** Actions the player may still spend on other things today. */
  private available(): number {
    return Math.max(0, this.s.actions - this.reserved());
  }

  /** The plan whose time has come: its phase has arrived, or the free actions are used up (the plan is what is left). */
  private duePlan(): { id: string; when: Phase; ev: EventRow } | null {
    const order: Phase[] = ['morning', 'afternoon', 'evening'];
    const now = order.indexOf(phaseOf(this.s.actions));
    const list = this.plans();
    const byTime = list.find((p) => order.indexOf(p.when) <= now);
    if (byTime) return byTime;
    return this.available() <= 0 && list.length ? list.slice().sort((a, b) => order.indexOf(a.when) - order.indexOf(b.when))[0] : null;
  }

  /** Fires the due plan when nothing else is on screen. Returns true when it took over the panel. */
  private checkPlans(): boolean {
    if (this.panel.kind !== 'idle' || this.win || this.phoneOpen || this.s.player.profilePending || this.townhallActive() || this.swapping) return false;
    const p = this.duePlan();
    if (!p) return false;
    this.s.plans = (this.s.plans ?? []).filter((x) => x.id !== p.id);
    this.endConvo('left');
    if (p.ev.scene && this.openToPlayer(p.ev.scene) && this.s.scene !== p.ev.scene) {
      const from = this.s.scene;
      this.s.scene = p.ev.scene;
      appendLog(this.s, { type: 'move', target: p.ev.scene, from, plan: p.id });
    }
    this.fireEvent(p.ev, false, true);
    appendLog(this.s, { type: 'dev', op: 'plan', rule: p.id, when: p.when, phase: phaseOf(this.s.actions) });
    this.panel = { kind: 'event', ev: p.ev };
    this.save();
    return true;
  }

  private save(): void {
    this.s.openEvent = this.panel.kind === 'event' ? this.panel.ev.id : undefined;
    this.s.queuedEvents = this.queue.length ? this.queue.map((e) => e.id) : undefined;
    saveState(this.s);
  }

  // ------------------------------------------------------------------ derived
  private get scene(): Scene {
    return this.c.sceneById.get(this.s.scene) ?? this.c.scenes[0];
  }

  private str(key: string, vars: Record<string, string | number> = {}): string {
    const raw = this.c.strings[key] ?? key;
    return raw.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }

  private vars(): Record<string, string> {
    const leader = this.c.npcById.get(`nat_${this.s.config.nationalLeader}`);
    // SPEC "Packs": strings `pack.<pack>.<name>` become {name} for players of that pack ({homeCenter}, {chessRival}, ...)
    // and `pack.<pack>|<dim>=<value>.<name>` variant words chosen by the profile answers (SPEC "Profile questions and variant words")
    // SPEC "Leads": {usLead}/{homeLead} = how people refer to the room's first-among-equals on each side; *Full = full name
    const us = this.leadOf('us'), home = this.leadOf('home');
    return {
      ...packVars(this.c.strings, this.s.player.pack, this.s.player.variant),
      homeCulture: CULTURE_NAMES[this.s.player.pack] ?? 'Chinese',
      playerName: this.s.player.name || 'you',
      leaderName: leader?.name ?? 'the President',
      usLead: us?.called ?? us?.name ?? 'the council member',
      homeLead: home?.called ?? home?.name ?? 'the association chair',
      usLeadFull: us?.name ?? 'the council member',
      homeLeadFull: home?.name ?? 'the association chair',
    };
  }

  private t(text: string): string {
    return subst(text, this.vars());
  }

  private tired(): boolean {
    return this.s.actions <= 0 && this.s.scene !== 'home' && this.scene.background !== 'none' && !this.townhallActive();
  }

  /** "1 action" / "2 actions", for aria-label and title. */
  private costWords(n: number): string {
    return this.str(n === 1 ? 'ui.cost' : 'ui.costs', { n });
  }

  /** The visible cost symbol: one amber dot per action, decorative (the accessible name carries the words). */
  private costDots(n: number): HTMLElement | null {
    if (n <= 0) return null;
    const el = h('span', { class: 'cost', 'aria-hidden': 'true' });
    for (let i = 0; i < n; i++) el.append(h('span', { class: 'cost-dot' }));
    return el;
  }

  /** Extra actions a dialogue/event choice spends through an `actions -N` effect. */
  private choiceCost(effect: string): number {
    let n = 0;
    for (const t of effect.split(';')) {
      const m = /^\s*actions\s+-(\d+)\s*$/.exec(t);
      if (m) n += +m[1];
    }
    return n;
  }

  /** Out of actions: every destination except home is closed. */
  private moveBlocked(to: string): boolean {
    return this.s.actions <= 0 && to !== 'home';
  }

  /** What the player may spend on something that is not today's plan (SPEC "Plans": the plan's actions are kept back). */
  private spendable(): number {
    return this.available();
  }

  /** SPEC "Packs": shared scenes and the scenes of the player's effective pack. */
  private openToPlayer(sceneId: string): boolean {
    return sceneInPack(this.c.sceneById.get(sceneId), this.s.player.pack);
  }

  /** The exits of a scene the player may take (other packs' scenes are not listed). */
  private exitsOf(sc: Scene): Scene['exits'] {
    return sc.exits.filter((ex) => this.openToPlayer(ex.to));
  }

  /** An event from someone outside the player's roster, or set in another pack's scene, never fires. */
  private eventInPack(ev: EventRow): boolean {
    if (!rowInPack(ev, this.c.events, this.s.player.pack)) return false; // events.csv `pack` (SPEC "Packs")
    if (ev.npc) { const n = this.c.npcById.get(ev.npc); if (n && !this.inRoster(n)) return false; }
    return !ev.scene || this.openToPlayer(ev.scene);
  }

  private inRoster(n: Npc): boolean {
    return n.pack === 'shared' || n.pack === this.s.player.pack;
  }

  /** The painted background variant applies when its asset exists and every painted NPC is in the roster. */
  private paintedActive(sc: Scene): boolean {
    const p = sc.painted;
    if (!p) return false;
    if (!this.hasBg(p.background)) return false;
    return p.npcs.every((id) => { const n = this.c.npcById.get(id); return !!n && this.inRoster(n); });
  }

  /**
   * Who is in a scene today. Each appearance rolls on its own hash of (room seed, day, scene, NPC id, slot), so the
   * answer does not depend on the order of npcs.yaml or on which other NPCs exist: editing one NPC's appearances
   * never moves anybody else. Two NPCs rolling into the same slot: the lower roll wins (ties by id), again order-free.
   * Candidates are taken in that same (roll, id) order up to `maxPresentIn` cut-out figures, skipping one whose figure would
   * clash with an accepted one (SPEC "How many people at once": head band covered, or > 40% hidden). Painted NPCs do not count.
   * `dev` adds gv.place() placements (rendering only; event rolls pass false); they bypass the cap and the clash check.
   */
  presentIn(sceneId: string, dev = true): Presence[] {
    const sc = this.c.sceneById.get(sceneId);
    if (!sc) return [];
    // SPEC "Town hall": the hidden scene holds only the person at the podium
    if (sc.hidden) {
      const sp = this.townhallSpeaker();
      const slot = sc.slots.find((x) => x.id === 'podium') ?? sc.slots[0];
      return sp && slot ? [{ npc: sp, slot }] : [];
    }
    const out: Presence[] = [];
    if (this.paintedActive(sc)) for (const id of sc.painted!.npcs) out.push({ npc: this.c.npcById.get(id)!, slot: null });
    const cands: { npc: Npc; slot: Slot; roll: number; figure?: string }[] = [];
    for (const n of this.c.npcs) {
      if (!this.inRoster(n)) continue;
      for (const a of n.appearances) {
        if (a.scene !== sceneId) continue;
        const roll = seeded(this.s.config.seed, 'presence', this.s.day, sceneId, n.id, a.slot)();
        if (roll >= a.chance) continue;
        const slot = sc.slots.find((x) => x.id === a.slot);
        if (slot) cands.push({ npc: n, slot, roll, figure: a.figure });
      }
    }
    cands.sort((a, b) => a.roll - b.roll || (a.npc.id < b.npc.id ? -1 : a.npc.id > b.npc.id ? 1 : 0));
    const used = new Set<string>();
    const max = this.maxPresentIn(sc);
    const placed: { y: number; rect: FigRect }[] = [];
    for (const cd of cands) {
      if (placed.length >= max) break;
      if (used.has(cd.slot.id) || out.some((p) => p.npc.id === cd.npc.id)) continue;
      const box = { y: cd.slot.y, rect: this.figureBox(sc, cd.slot, cd.npc, cd.figure) };
      if (placed.some((p) => figuresClash(p, box))) continue;
      used.add(cd.slot.id);
      placed.push(box);
      out.push({ npc: cd.npc, slot: cd.slot, figure: cd.figure });
    }
    if (dev) for (const pl of this.devPlaced.get(sceneId) ?? []) {
      const n = this.c.npcById.get(pl.npc);
      const slot = sc.slots.find((x) => x.id === pl.slot);
      if (!n || !slot) continue;
      for (let i = out.length - 1; i >= 0; i--) if (out[i].npc.id === n.id || out[i].slot?.id === slot.id) out.splice(i, 1);
      out.push({ npc: n, slot });
    }
    return out;
  }

  private eventCtx(sceneId: string, requirePresence: boolean) {
    return {
      scene: sceneId,
      present: new Set(this.presentIn(sceneId, false).map((p) => p.npc.id)),
      lean: leanOf(this.s.spent),
      leader: this.s.config.nationalLeader,
      npcs: this.s.npcs,
      requirePresence,
      ...this.leads(),
      day: this.s.day,
      canAppear: (npc: string, scene: string) => this.canAppear(npc, scene),
    };
  }

  /** The NPC can be present in the scene at all: an appearance, a painted variant or a talk zone naming them. */
  private canAppear(npcId: string, sceneId: string): boolean {
    const n = this.c.npcById.get(npcId);
    const sc = this.c.sceneById.get(sceneId);
    if (!n || !sc) return false;
    return n.appearances.some((a) => a.scene === sceneId) || !!sc.painted?.npcs.includes(npcId)
      || sc.hotspots.some((hs) => hs.action.type === 'talk' && hs.action.npc === npcId);
  }

  // ---- image resolution: researcher override (IndexedDB gv/images, SPEC key scheme) first, manifest second
  /** Override image for `<section>/<id>` or `<section>/<id>/<variant>`, tolerating the ch_ prefix difference. */
  private ovImg(section: string, id: string | undefined, variant?: string): { url: string; w?: number; h?: number } | undefined {
    if (!id) return undefined;
    for (const x of overrideIds(id)) {
      const hit = this.c.imageOverrides.get(variant === undefined ? `${section}/${x}` : `${section}/${x}/${variant}`);
      if (hit) return hit;
    }
    return undefined;
  }

  private hasBg(id: string): boolean {
    return !!this.ovImg('backgrounds', id) || !!assetEntry(this.c.manifest, this.c.manifest.backgrounds, id);
  }

  /** A background asset that is really there: an editor override, or a manifest entry that is not a placeholder. */
  private realBg(id: string | undefined): boolean {
    if (!id) return false;
    if (this.ovImg('backgrounds', id)) return true;
    const e = assetEntry(this.c.manifest, this.c.manifest.backgrounds, id);
    return !!e && !e.placeholder;
  }

  /**
   * The background drawn for a scene. `base` is the background id the drawn one stands in for (SPEC "Content schemas"
   * byPack): a pack variant resolves `screens`/`props` byBackground through it, so the TV quad measured on bg_home_day
   * (or bg_home_eve) keeps working on bg_home_<pack>_day (or _eve).
   * Order: painted variant (when active) > the player's pack variant (when its asset is real) > the scene background;
   * in the evening the `_eve` render of whichever was chosen, else (pack variant without an evening) the base's `_eve`.
   */
  private bgFor(sc: Scene): { url: string; placeholder: boolean; id: string; base: string } | null {
    if (sc.background === 'none') return null;
    const m = this.c.manifest.backgrounds;
    const eveOf = (x: string) => (x.includes('_day') ? x.replace('_day', '_eve') : `${x}_eve`);
    const evening = phaseOf(this.s.actions) === 'evening';
    let id = this.paintedActive(sc) ? sc.painted!.background : sc.background;
    let base = id;
    // SPEC "Content schemas" occupied: the variant for a taken seat (the chess game) when someone present sits there
    const occ = sc.occupied;
    if (id === sc.background && occ && this.realBg(occ.background) && this.presentIn(sc.id).some((p) => !!p.slot && occ.slots.includes(p.slot.id))) id = occ.background;
    const pv = id === sc.background ? sc.byPack?.[this.s.player.pack] : undefined;
    if (pv && this.realBg(pv.background)) {
      if (!evening) id = pv.background;
      else if (this.realBg(pv.evening ?? eveOf(pv.background))) { id = pv.evening ?? eveOf(pv.background); if (this.hasBg(eveOf(base))) base = eveOf(base); }
      else if (this.hasBg(eveOf(base))) id = base = eveOf(base);
      else id = pv.background;
    } else if (evening) {
      const eve = eveOf(id);
      if (this.hasBg(eve)) id = base = eve;
    }
    const o = this.ovImg('backgrounds', id);
    if (o) return { url: o.url, placeholder: false, id, base };
    const e = assetEntry(this.c.manifest, m, id);
    return e ? { url: this.c.assetUrl(e.file), placeholder: !!e.placeholder, id, base } : { url: '', placeholder: true, id, base };
  }

  private portraitFor(n: Npc, emotion: Emotion): { url: string; placeholder: boolean } {
    const pick = this.s.config.rosterPicks?.[n.id];
    const man = this.c.manifest;
    // SPEC key portraits/<npcId>/<expression>; the portrait base id without ch_ is the same id by convention, accept both
    const ids = [...new Set([n.id, n.portrait.replace(/^ch_/, '')])];
    const ov = (e: Emotion) => ids.map((id) => this.c.imageOverrides.get(`portraits/${id}/${e}`)?.url).find(Boolean);
    const p = (pick && assetEntry(man, man.portraits, pick)) || assetEntry(man, man.portraits, n.portrait);
    // the requested expression beats a neutral fallback, whichever side each comes from
    const exact = ov(emotion) ?? (p?.[emotion] ? this.c.assetUrl(p[emotion]!) : undefined);
    if (exact) return { url: exact, placeholder: !ov(emotion) && !!p?.placeholder };
    const neutral = ov('neutral') ?? (p?.neutral ? this.c.assetUrl(p.neutral) : undefined);
    if (!neutral) return { url: SILHOUETTE_BUST, placeholder: true };
    return { url: neutral, placeholder: !ov('neutral') && !!p?.placeholder };
  }

  /**
   * The figure drawn for a presence: the appearance's own `figure` when it names one, else the NPC's default.
   * `seated` follows the asset actually drawn (manifest `seated`, or `_fig_sit` in the id); the NPC's flag covers its default.
   */
  private figureFor(n: Npc, appearanceFigure?: string): { url: string; placeholder: boolean; aspect: number; seated: boolean } {
    // an appearance's own figure whose art does not exist yet falls back to the NPC's default figure
    const own = appearanceFigure && (this.ovImg('figures', appearanceFigure) || assetEntry(this.c.manifest, this.c.manifest.figures, appearanceFigure)?.file) ? appearanceFigure : undefined;
    const id = own || n.figure;
    const seated = own ? isSeatedFigure(this.c.manifest, own) : n.seated;
    const o = this.ovImg('figures', id);
    if (o) return { url: o.url, placeholder: false, aspect: o.w && o.h ? o.w / o.h : 0.45, seated };
    const f = assetEntry(this.c.manifest, this.c.manifest.figures, id);
    if (!f?.file) return { url: silhouetteFigure(seated), placeholder: true, aspect: seated ? 300 / 500 : 300 / 700, seated };
    return { url: this.c.assetUrl(f.file), placeholder: !!f.placeholder, aspect: f.w && f.h ? f.w / f.h : 0.45, seated };
  }

  /** A cast member's bust or TV still: override `cast/<id>/<bust|tv>`, then manifest.cast; url '' when missing. */
  private castImage(id: string, variant: 'bust' | 'tv'): { url: string; placeholder: boolean; name: string; role: string } {
    const info = this.c.cast.get(id);
    const name = info?.name || this.c.manifest.cast?.[id]?.name || id;
    const role = info?.role || this.c.manifest.cast?.[id]?.role || '';
    const o = this.c.imageOverrides.get(`cast/${id}/${variant}`);
    if (o) return { url: o.url, placeholder: false, name, role };
    const m = this.c.manifest.cast?.[id];
    const file = m?.[variant];
    return file ? { url: this.c.assetUrl(file), placeholder: !!m?.placeholder, name, role } : { url: '', placeholder: true, name, role };
  }

  /** An object shown on the right panel for an event that is heard, not seen (events.csv `medium`, e.g. prop_radio):
   *  override `props/<id>`, then manifest.props; url '' when missing. label is the id without `prop_` ("radio"). */
  private propImage(id: string): { url: string; placeholder: boolean; label: string } {
    const label = id.replace(/^prop_/, '').replace(/_/g, ' ');
    const o = this.c.imageOverrides.get(`props/${id}`);
    if (o) return { url: o.url, placeholder: false, label };
    const m = assetEntry(this.c.manifest, this.c.manifest.props, id);
    return m?.file ? { url: this.c.assetUrl(m.file), placeholder: false, label } : { url: '', placeholder: true, label };
  }

  /** The leader's TV stills: manifest list, with `tv/<leaderId>/<i>` overrides replacing or extending it. */
  private tvImages(leaderId: string): { urls: string[]; overridden: boolean } {
    const urls = (assetEntry(this.c.manifest, this.c.manifest.tv, leaderId) ?? []).map((f) => this.c.assetUrl(f));
    let overridden = false;
    for (let i = 0; i < Math.max(urls.length + 1, 8); i++) {
      const o = this.c.imageOverrides.get(`tv/${leaderId}/${i}`);
      if (!o) continue;
      overridden = true;
      if (i < urls.length) urls[i] = o.url;
      else urls.push(o.url);
    }
    return { urls, overridden };
  }

  // ------------------------------------------------------------------ actions
  private spend(n: number): void {
    if (n <= 0) return;
    const used = Math.min(n, this.s.actions);
    this.s.actions -= used;
    this.s.spent[this.scene.community] += used;
  }

  /** Applies effects and accounts any `actions -N` as spending in the current scene. */
  private effects(npcId: string | null, effect: string, why: string): Delta {
    const before = this.s.actions;
    const d = applyEffects(this.s, npcId, effect, why, npcId ? this.c.npcById.get(npcId)?.maxRapport ?? 3 : 3);
    if (this.s.actions < before) this.s.spent[this.scene.community] += before - this.s.actions;
    return d;
  }

  /** `force` (dev, gv.goto): leave even in the middle of a conversation; the exits are otherwise locked while one is on screen. */
  moveTo(sceneId: string, opts: { force?: boolean } = {}): void {
    if (!this.c.sceneById.has(sceneId)) {
      console.error(`[move] unknown scene "${sceneId}"`);
      return;
    }
    if (!this.openToPlayer(sceneId)) {
      console.info(`[move] scene "${sceneId}" belongs to another culture pack (player pack ${this.s.player.pack}); refused`);
      return;
    }
    if (this.panel.kind === 'dialogue' && !opts.force) {
      // SPEC "Conversation end": no walking off mid-sentence; every row has a leave option
      console.info(`[move] in a conversation with ${this.panel.npc}; take a leave option first (gv.goto forces)`);
      return;
    }
    if (this.moveBlocked(sceneId)) {
      this.panel = { kind: 'idle', note: this.str('ui.tired') };
      this.render();
      return;
    }
    this.endConvo('left');
    const from = this.s.scene;
    this.s.scene = sceneId;
    this.panel = { kind: 'idle' };
    appendLog(this.s, { type: 'move', target: sceneId, from });
    this.save();
    if (!this.tired()) this.rollEnterEvent(sceneId);
    this.render(); // a different scene: render() preloads its images and cross-fades
  }

  private rollEnterEvent(sceneId: string): void {
    const key = `${this.s.day}:${sceneId}`;
    const n = (this.s.entries[key] = (this.s.entries[key] ?? 0) + 1);
    const rng = seeded(this.s.config.seed, 'enter', this.s.day, sceneId, n);
    const ctx = this.eventCtx(sceneId, true);
    for (const ev of this.eventOrder()) {
      if (ev.trigger !== 'enter' || this.s.fired.includes(ev.id)) continue;
      if (!this.eventInPack(ev) || !eventMatches(ev, ctx)) continue;
      if (rng() < ev.chance) {
        if (this.fireEvent(ev, false)) return;
      }
    }
  }

  /** Shows an event in the right panel. Returns false if it could not be afforded. */
  private fireEvent(ev: EventRow, rerender = true, force = false): boolean {
    // SPEC "Plans": a plan's own cost is no longer reserved when it fires; a plan fires even if an `actions -N` effect ate into its reserve
    if (!force && ev.cost > this.spendable()) return false;
    const before = this.s.actions;
    this.spend(ev.cost);
    this.s.fired.push(ev.id);
    this.panel = { kind: 'event', ev };
    appendLog(this.s, {
      type: 'event', target: ev.npc || undefined, rule: ev.id, trigger: ev.trigger,
      delta: before !== this.s.actions ? { actions: [before, this.s.actions] } : undefined,
    });
    this.save();
    if (rerender) this.render();
    return true;
  }

  // ------------------------------------------------------------------ conversations
  private startConvo(npc: string, rule: string): void {
    const now = Date.now();
    this.s.convo = { npc, scene: this.s.scene, started: now, last: now, turns: 1, rules: [rule] };
  }

  private convoTurn(rule: string): void {
    const cv = this.s.convo;
    if (!cv) return;
    cv.turns += 1;
    cv.rules.push(rule);
    cv.last = Date.now();
  }

  /**
   * Logs the open conversation (one `conversation` line) and clears it. This is where the per-NPC daily count goes up
   * (SPEC "Conversation limit semantics"): when a conversation ends or is left, never at its start or mid-tree.
   */
  private endConvo(exit: 'ended' | 'left' | 'day_end', at = Date.now()): void {
    const cv = this.s.convo;
    if (!cv) return;
    this.s.convo = undefined;
    if (exit !== 'day_end') this.countTalk(cv.npc); // the day's counts reset at day start anyway
    appendLog(this.s, {
      type: 'conversation', target: cv.npc, scene: cv.scene, turns: cv.turns, ms: Math.max(0, at - cv.started), rules: cv.rules, exit, cost: cv.cost ?? 0,
    });
    this.save();
  }

  /** Per-NPC totals from this room's conversation lines (the log is the source of truth). */
  private convoTotals(): Map<string, { n: number; turns: number; ms: number }> {
    const out = new Map<string, { n: number; turns: number; ms: number }>();
    for (const ln of readLog(this.s.room).split('\n')) {
      if (!ln.includes('"conversation"')) continue;
      try {
        const l = JSON.parse(ln);
        if (l.type !== 'conversation' || typeof l.target !== 'string') continue;
        const t = out.get(l.target) ?? { n: 0, turns: 0, ms: 0 };
        t.n += 1; t.turns += Number(l.turns) || 0; t.ms += Number(l.ms) || 0;
        out.set(l.target, t);
      } catch { /* skip a damaged line */ }
    }
    return out;
  }

  /**
   * What option `idx` of the row on screen costs (SPEC "Pay when you stay"): starting a conversation and its first
   * FREE_TURNS turns are free, the option into turn FREE_TURNS + 1 costs DIALOGUE_COST once, an explicit `cost N` is
   * charged instead when larger. Leaving (no `next`, no `cost N`) is always free.
   */
  private optionCharge(row: DialogueRow, idx: number): { charge: number; stay: boolean } {
    const ch = row.choices[idx];
    const cv = this.s.convo;
    const leadsOn = !!ch.next && (this.c.dialogue.get(row.npc) ?? []).some((r) => r.id === ch.next);
    return optionCharge(ch.effect, leadsOn, cv?.turns ?? 1, !!cv?.stayPaid);
  }

  /**
   * Starting a conversation is free, so it only needs the scene to be usable: tired() (0 actions away from home) still
   * forbids it, as it forbids every interaction there. A conversation already open can be finished at 0 actions.
   */
  private canTalk(): boolean {
    return !this.tired() && !this.townhallActive();
  }

  /**
   * Conversations allowed per NPC per day: the room's `maxTalksPerNpcPerDay` (default 1). In dev mode `&talks=N`
   * overrides it for the tab (and the DEV1 room has no value, so it stays 1).
   */
  /** Cut-out figures allowed at once in a scene: its `maxPresent`, else the room's, else 3. Dev: `&present=N` for the tab. */
  maxPresentIn(sc: Scene): number {
    const dev = isDev ? Number(params.get('present')) : NaN;
    if (Number.isInteger(dev) && dev > 0) return dev;
    for (const v of [sc.maxPresent, Number(this.s.config.maxPresent)]) if (Number.isInteger(v) && v! > 0) return v!;
    return DEFAULT_MAX_PRESENT;
  }

  /** The figure's box in the 900 x 600 image, exactly as renderScene() draws it (SPEC "How many people at once"). */
  private figureBox(sc: Scene, slot: Slot, npc: Npc, figure?: string): FigRect {
    const fig = this.figureFor(npc, figure);
    return figureRect(slot.x, slot.y, figureHeight(sc, slot, fig.seated), fig.aspect, IMG_W, IMG_H);
  }

  get maxTalks(): number {
    const dev = isDev ? Number(params.get('talks')) : NaN;
    if (Number.isInteger(dev) && dev > 0) return dev;
    const v = Number(this.s.config.maxTalksPerNpcPerDay);
    return Number.isInteger(v) && v > 0 ? v : DEFAULT_TALKS_PER_DAY;
  }

  /** Conversations with `npcId` had today (ended or left; the one in progress does not count yet). */
  talksToday(npcId: string): number {
    const t = this.s.talks;
    return t && t.day === this.s.day ? t.counts[npcId] ?? 0 : 0;
  }

  /** Already had today's conversation(s) with this NPC (SPEC "Conversation limit"). */
  talkedOut(npcId: string): boolean {
    return this.talksToday(npcId) >= this.maxTalks;
  }

  private countTalk(npcId: string): void {
    if (!this.s.talks || this.s.talks.day !== this.s.day) this.s.talks = { day: this.s.day, counts: {} };
    this.s.talks.counts[npcId] = (this.s.talks.counts[npcId] ?? 0) + 1;
  }

  /** "Talk to Dana" / "Talk to Dana (no actions left)": the same words for aria-label and hover title (starting is free). */
  private talkLabel(n: Npc): string {
    if (this.talkedOut(n.id)) return this.talkedAria(n);
    const base = this.str('ui.talkTo', { name: n.name });
    return this.canTalk() ? base : `${base} (${this.str('ui.noActionsShort')})`;
  }

  /** At the limit the figure has no visible label at all; this name is for assistive tech only. */
  private talkedAria(n: Npc): string {
    return `${n.name} (talked today)`;
  }

  /** `force` (dev only, gv.talk(npc, {force:true})) ignores the per-day conversation limit. */
  talkTo(npcId: string, opts: { force?: boolean } = {}): void {
    const n = this.c.npcById.get(npcId);
    if (!n) return;
    // the conversation with this person is already on screen: clicking them again keeps it (and does not end it)
    if (this.s.convo?.npc === n.id && this.panel.kind === 'dialogue' && this.panel.npc === n.id && !opts.force) return;
    // SPEC "Conversation end": no switching to someone else mid-sentence; every row has a leave option (gv.talk forces)
    if (this.panel.kind === 'dialogue' && this.panel.npc !== n.id && !opts.force) {
      console.info(`[talk] in a conversation with ${this.panel.npc}; take a leave option first (gv.talk forces)`);
      return;
    }
    if (this.talkedOut(n.id) && !opts.force) {
      // the figure is non-interactive; this covers gv.talk and anything else that calls in directly (no visible notice)
      console.info(`[talk] ${n.id}: already talked ${this.talksToday(n.id)} time(s) today (limit ${this.maxTalks})`);
      return;
    }
    this.endConvo('left'); // talking to someone else (or the same person afresh) leaves the current conversation
    if (this.talkedOut(n.id) && !opts.force) {
      // leaving an open conversation with this same person (forced dev path) just used up the last one
      this.panel = { kind: 'idle' };
      this.save();
      return this.render();
    }
    if (!this.canTalk()) {
      this.panel = { kind: 'idle', note: this.str('ui.tired') };
      return this.render();
    }
    const row = this.pickRow(n);
    if (!row) {
      this.panel = { kind: 'idle', note: `(No dialogue for ${n.name} yet.)` };
    } else {
      this.panel = { kind: 'dialogue', npc: n.id, row: row.row, tie: row.tie };
      // `talk` = which of today's conversations with this NPC this is (counted when it ends)
      // starting is free (SPEC "Pay when you stay"): `cost` stays 0 here; charges go on the choice lines
      appendLog(this.s, { type: 'dialogue', target: n.id, rule: row.row.id, cost: 0, talk: this.talksToday(n.id) + 1, ...(opts.force ? { forced: true } : {}) });
      this.startConvo(n.id, row.row.id);
    }
    this.save();
    this.render();
  }

  private pickRow(n: Npc, quiet = false): { row: DialogueRow; tie: string[] } | null {
    const rows = this.c.dialogue.get(n.id) ?? [];
    const ns = this.s.npcs[n.id] ?? { ...n.initial };
    const sel = selectRow(rows, {
      ...ns,
      nationalLeader: this.s.config.nationalLeader,
      playerLean: leanOf(this.s.spent),
      dayPhase: dayPhaseOf(this.s.day),
      scene: this.s.scene, // rows with a `scene` cell only match where they are set
      ...this.leads(), // rows with a usLead/homeLead cell only match rooms with that lead (SPEC "Leads")
      day: this.s.day, // rows with a `day` cell only match on those days
      present: new Set(this.presentIn(this.s.scene).map((p) => p.npc.id)), // rows with an `absent` cell need that person away
    });
    if (!sel.row) {
      if (!quiet) console.error(`[dialogue] ${n.id}: no row matched (missing fallback?)`);
      return null;
    }
    if (sel.tie.length && !quiet) {
      console.warn(`[dialogue] ${n.id}: tie between ${[sel.row.id, ...sel.tie.map((r) => r.id)].join(', ')}; taking ${sel.row.id}`);
    }
    return { row: sel.row, tie: sel.tie.map((r) => r.id) };
  }

  /**
   * Display order of a row's choices: a deterministic shuffle per (room seed, row id, day), so the exit or the
   * low-valence option is not always last. Returns authored indices in display order.
   */
  choiceOrder(rowId: string, n: number): number[] {
    const idx = Array.from({ length: n }, (_, i) => i);
    const rng = seeded(this.s.config.seed, 'choices', rowId, this.s.day);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
  }

  // ------------------------------------------------------------------ beats (SPEC "Writing dialogue: beats and stage directions")
  /** The `$`-separated beats of a line and the one on screen (`at`, clamped). */
  private beatsOf(text: string, at: number | undefined): { beats: Beat[]; at: number; cur: Beat; last: boolean } {
    const beats = splitBeats(text);
    const i = Math.max(0, Math.min(at ?? 0, beats.length - 1));
    return { beats, at: i, cur: beats[i], last: i === beats.length - 1 };
  }

  /** The bust shown with a row's last beat: its `[tag]`, else the row's emotion column. */
  private closingEmotion(row: DialogueRow): Emotion {
    const { beats } = this.beatsOf(row.line, 0);
    return beats[beats.length - 1].emotion ?? row.emotion;
  }

  /** A line as paragraphs: speech, with any `_stage direction_` on its own italic line. Placeholders are filled first. */
  private speech(text: string): HTMLElement[] {
    return speechParts(this.t(text)).map((part) => h('p', { class: part.kind === 'stage' ? 'line direction' : 'line', text: part.text }));
  }

  /** Next inside a line: show the following beat. Not a turn (no stay charge); logged as `beat`. */
  private nextBeat(): void {
    const p = this.panel;
    if (p.kind !== 'dialogue' && p.kind !== 'event') return;
    const bt = this.beatsOf(p.kind === 'dialogue' ? p.row.line : p.ev.text, p.beat);
    if (bt.last) return;
    if (p.kind === 'dialogue') {
      if (this.debug) this.snapshot();
      appendLog(this.s, { type: 'beat', target: p.npc, rule: p.row.id, beat: bt.at + 2 });
    } else appendLog(this.s, { type: 'beat', target: p.ev.npc || undefined, rule: p.ev.id, beat: bt.at + 2, event: true });
    this.panel = { ...p, beat: bt.at + 1 };
    this.save();
    this.render();
  }

  // ------------------------------------------------------------------ dev: stepping back (SPEC "Dev: stepping back")
  /** Remember the state before a choice or beat, so the Back button can restore it. Dev only; the log stays append-only. */
  private snapshot(): void {
    const cv = this.s.convo, p = this.panel;
    if (!cv || p.kind !== 'dialogue') return;
    const { history, ...rest } = cv;
    const snap = JSON.stringify({ s: { ...this.s, convo: rest }, row: p.row.id, beat: p.beat ?? 0 });
    cv.history = [...(history ?? []).slice(-19), snap];
  }

  private stepBack(): void {
    const cv = this.s.convo;
    const snap = cv?.history?.pop();
    if (!cv || !snap) return;
    const { s, row, beat } = JSON.parse(snap) as { s: GameState; row: string; beat: number };
    const r = (this.c.dialogue.get(cv.npc) ?? []).find((x) => x.id === row);
    if (!r) return;
    appendLog(this.s, { type: 'dev', op: 'back', target: cv.npc, rule: row });
    Object.assign(this.s, s);
    this.s.convo = { ...s.convo!, history: cv.history };
    this.panel = { kind: 'dialogue', npc: cv.npc, row: r, tie: [], beat };
    this.save();
    this.render();
  }

  // ------------------------------------------------------------------ dev: editing a line in place (SPEC "Dev: editing a line in place")
  private startEdit(): void {
    const p = this.panel;
    if (!this.debug || p.kind !== 'dialogue') return;
    this.editing = { npc: p.npc, row: p.row.id, line: p.row.line, choices: p.row.choices.map((c) => c.text) };
    this.renderRight();
    (this.right.querySelector('.dev-edit-line') as HTMLTextAreaElement | null)?.focus();
  }

  private cancelEdit(): void {
    this.editing = null;
    this.renderRight();
  }

  /**
   * Writes the edited row into localStorage['gv:override:v1'].dialogue[npc] (the NPC's whole sheet, only this row's
   * line and choice texts changed), re-parses it and swaps it into the loaded content, without a reload.
   */
  private async saveEdit(): Promise<void> {
    const ed = this.editing, p = this.panel;
    if (!ed || ed.busy || p.kind !== 'dialogue' || p.npc !== ed.npc || p.row.id !== ed.row) return;
    const fail = (note: string) => { ed.note = note; ed.busy = false; this.renderRight(); };
    if (!ed.line.trim()) return fail(this.str('ui.dev.emptyLine'));
    const blank = ed.choices.findIndex((c) => !c.trim());
    if (blank >= 0) return fail(this.str('ui.dev.emptyChoice', { n: blank + 1 }));
    if (this.c.override.ignored) return fail('overrides are ignored on this load (&nooverride=1); saving would overwrite them. Reload without it.');
    ed.busy = true;
    const ov = overrideForWrite();
    // the stored sheet unless it was rejected at load (then the bundled one is what is on screen)
    const stored = ov.dialogue?.[ed.npc];
    let base = typeof stored === 'string' && !this.c.override.rejected.some((x) => x.key === `dialogue/${ed.npc}`) ? stored : null;
    // no (applied) override for this NPC yet: start from the bundled sheet as written, else regenerate it from the loaded rows
    if (base === null && this.c.source === 'live') base = await liveSource().text(`content/dialogue/${ed.npc}.csv`);
    if (base === null) base = dialogueCsvFromRows(this.c.dialogue.get(ed.npc) ?? []);
    if (this.editing !== ed) return; // cancelled while the sheet loaded
    const patched = patchDialogueRow(base, ed.row, ed.line, ed.choices.map((c) => c.trim()));
    if ('error' in patched) return fail(patched.error);
    const parsed = parseDialogueQuiet(ed.npc, patched.text, new Set(this.c.scenes.map((s) => s.id)));
    if ('errors' in parsed) return fail(parsed.errors.slice(0, 3).map((e) => e.replace(/^\[content\] /, '')).join('; '));
    const nr = parsed.rows.find((r) => r.id === ed.row);
    if (!nr) return fail(`row "${ed.row}" vanished after the edit`);
    ov.dialogue = { ...(ov.dialogue ?? {}), [ed.npc]: patched.text };
    if (!storeOverride(ov)) return fail(`could not write localStorage['gv:override:v1']`);
    // hot-apply: the loaded content, the override chip, the panel (same row, first beat; the conversation goes on)
    this.c.dialogue.set(ed.npc, parsed.rows);
    const o = this.c.override, key = `dialogue/${ed.npc}`;
    if (!o.applied.includes(key)) o.applied.push(key);
    o.rejected = o.rejected.filter((x) => x.key !== key);
    o.updated = ov.updated;
    appendLog(this.s, { type: 'dev', op: 'edit', target: ed.npc, rule: ed.row });
    console.info(`[dev] edited ${ed.npc}/${ed.row}; saved to override dialogue/${ed.npc}`);
    this.editing = null;
    this.panel = { ...p, row: nr, beat: 0 };
    this.save();
    this.render();
  }

  /** The in-place editor: the raw line cell, one input per existing choice text, the marks hint, Save / Cancel. */
  private editForm(ed: NonNullable<Game['editing']>): HTMLElement {
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancelEdit(); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void this.saveEdit(); }
    };
    const ta = h('textarea', { class: 'dev-edit-line', rows: 6, spellcheck: 'true', 'aria-label': 'line (raw CSV cell)' }) as HTMLTextAreaElement;
    ta.value = ed.line;
    ta.addEventListener('input', () => { ed.line = ta.value; });
    ta.addEventListener('keydown', keys);
    const inputs = ed.choices.map((c, i) => {
      const inp = h('input', { class: 'dev-edit-choice', type: 'text', 'aria-label': `choice ${i + 1} text` }) as HTMLInputElement;
      inp.value = c;
      inp.addEventListener('input', () => { ed.choices[i] = inp.value; });
      inp.addEventListener('keydown', keys);
      return h('label', { class: 'dev-edit-row' }, h('span', { text: `${i + 1}` }), inp);
    });
    return h('div', { class: 'dev-edit' },
      h('div', { class: 'dev-edit-head', text: `edit ${ed.npc}/${ed.row} (dev)` }),
      ta,
      h('p', { class: 'dev-edit-hint', text: this.str('ui.dev.editHint') }),
      ...inputs,
      ed.note ? h('p', { class: 'dev-edit-note', role: 'alert', text: ed.note }) : null,
      h('div', { class: 'dev-edit-btns' },
        h('button', { class: 'choice dev-edit-save', title: 'Save (Cmd/Ctrl+Enter)', onclick: () => void this.saveEdit(), text: this.str('ui.dev.save') }),
        h('button', { class: 'choice dev-edit-cancel', title: 'Cancel (Escape)', onclick: () => this.cancelEdit(), text: this.str('ui.dev.cancel') })));
  }

  /** idx = authored index (0-based); shown = displayed position (1-based). The log keeps both. */
  private chooseDialogue(row: DialogueRow, idx: number, shown: number): void {
    const ch = row.choices[idx];
    const { charge, stay } = this.optionCharge(row, idx);
    if (charge > this.spendable()) {
      // the button is disabled; this covers anything that calls in directly
      console.info(`[dialogue] ${row.npc}/${row.id} option ${idx + 1}: costs ${charge}, ${this.s.actions} action(s) left`);
      return;
    }
    if (this.debug) this.snapshot();
    const before = this.s.actions;
    this.spend(charge);
    const cv = this.s.convo;
    if (cv && stay) cv.stayPaid = true;
    const delta = this.effects(row.npc, ch.effect, `${row.npc}/${row.id}`);
    if (this.s.actions !== before) delta.actions = [before, this.s.actions];
    if (cv) cv.cost = (cv.cost ?? 0) + Math.max(0, before - this.s.actions);
    appendLog(this.s, {
      type: 'choice', target: row.npc, rule: row.id, choice: idx + 1, shown, delta, next: ch.next || undefined,
      ...(charge ? { charged: charge } : {}), ...(stay ? { stay: true } : {}),
    });
    if (ch.next) {
      const nx = (this.c.dialogue.get(row.npc) ?? []).find((r) => r.id === ch.next);
      if (nx) {
        this.panel = { kind: 'dialogue', npc: row.npc, row: nx, tie: [] };
        appendLog(this.s, { type: 'dialogue', target: row.npc, rule: nx.id, followup: true });
        this.convoTurn(nx.id);
      } else {
        console.error(`[dialogue] ${row.npc}/${row.id}: next "${ch.next}" not found`);
        this.panel = { kind: 'idle' };
        this.endConvo('ended');
      }
    } else {
      const name = this.c.npcById.get(row.npc)?.name ?? row.npc;
      this.panel = { kind: 'idle', note: this.str('ui.convoEnded', { name }), ended: { npc: row.npc, emotion: this.closingEmotion(row) } };
      this.endConvo('ended');
    }
    this.save();
    this.render();
  }

  private chooseEvent(ev: EventRow, idx: number | null, shown?: number): void {
    if (idx !== null) {
      const ch = ev.choices[idx];
      const delta = this.effects(ev.npc || null, ch.effect, `event ${ev.id}`);
      appendLog(this.s, { type: 'choice', target: ev.npc || undefined, rule: ev.id, choice: idx + 1, shown, delta, event: true });
    }
    this.panel = { kind: 'idle' };
    this.save();
    if (this.queue.length) this.nextQueued();
    else this.render();
  }

  private hotspot(hs: Hotspot): void {
    const a = hs.action;
    if (a.type !== 'talk' && a.type !== 'end_day' && !(a.type === 'window' && a.module === 'survey')) this.endConvo('left');
    const cost = a.cost ?? (a.type === 'window' || a.type === 'news' ? 1 : 0);
    if (cost > this.spendable()) {
      this.panel = { kind: 'idle', note: this.str('ui.notEnough') };
      return this.render();
    }
    switch (a.type) {
      case 'talk':
        return this.talkTo(String(a.npc));
      case 'move':
        appendLog(this.s, { type: 'hotspot', target: hs.id });
        return this.moveTo(String(a.to));
      case 'end_day':
        if (this.s.actions > 0) {
          // actions left: offer work or staying up before ending the day early
          this.panel = { kind: 'bed', hs: hs.id };
          return this.render();
        }
        appendLog(this.s, { type: 'hotspot', target: hs.id });
        return this.endDay();
      case 'look': {
        const before = this.s.actions;
        this.spend(cost);
        this.panel = { kind: 'text', title: hs.label, text: a.textByPack?.[this.s.player.pack] ?? a.text ?? '' };
        appendLog(this.s, { type: 'hotspot', target: hs.id, delta: before !== this.s.actions ? { actions: [before, this.s.actions] } : undefined });
        break;
      }
      case 'news': {
        const before = this.s.actions;
        this.spend(cost);
        const story = this.pickNews('print')[0];
        if (story) {
          this.s.seenNews.push(story.id);
          this.panel = { kind: 'text', title: this.str('ui.newsTitle'), text: `**${story.headline}**\n\n${story.body}`, rule: story.id, figure: story.figure || undefined };
        } else {
          this.panel = { kind: 'text', title: this.str('ui.newsTitle'), text: this.str('ui.noNews') };
        }
        appendLog(this.s, { type: 'hotspot', target: hs.id, rule: story?.id, delta: { actions: [before, this.s.actions] } });
        break;
      }
      case 'window': {
        const mod = a.module as ModuleId;
        if (mod === 'survey') {
          appendLog(this.s, { type: 'hotspot', target: hs.id });
          return this.endDay();
        }
        if (mod === 'tv' && this.tvWatchedToday()) {
          // SPEC "TV once a day": the hotspot is disabled; this covers anything that calls in directly (no notice)
          console.info('[tv] already watched today');
          return;
        }
        const before = this.s.actions;
        this.spend(cost);
        let content: unknown = {};
        let rule: string | undefined;
        if (mod === 'tv') {
          const tv = this.tvContent();
          // the room screen keeps the still it showed when the TV was switched on until the window closes
          this.tvOnScreen = this.screenStory();
          content = { ...tv, keepWatching: FEATURES.tvKeepWatching };
          rule = tv.stories[0]?.id;
          if (rule) this.s.seenNews.push(rule);
          this.s.tvWatched = { day: this.s.day, phase: phaseOf(this.s.actions), story: rule };
          this.s.tvWatchedDay = this.s.day;
        }
        appendLog(this.s, { type: 'window', target: mod, rule, delta: before !== this.s.actions ? { actions: [before, this.s.actions] } : undefined });
        this.save();
        this.render();
        return this.openWindow(mod, content);
      }
    }
    this.save();
    this.render();
  }

  private pickNews(channel: 'tv' | 'print'): NewsRow[] {
    const leader = this.s.config.nationalLeader;
    const pool = this.c.news.filter(
      (n) => n.channel === channel && (!n.nationalLeader || n.nationalLeader === leader) && n.dayMin <= this.s.day
        && rowInPack(n, this.c.news, this.s.player.pack),
    );
    // unseen first, newest-eligible (highest dayMin) first, then file order
    return pool
      .map((n, i) => ({ n, i }))
      .sort((a, b) => {
        const sa = this.s.seenNews.includes(a.n.id) ? 1 : 0;
        const sb = this.s.seenNews.includes(b.n.id) ? 1 : 0;
        return sa - sb || b.n.dayMin - a.n.dayMin || a.i - b.i;
      })
      .map((x) => x.n);
  }

  /**
   * The TV module's content. A story with a `figure` shows that cast member's still when it exists; until then the
   * screen shows PLACEHOLDER with their name. Stories without a figure show the national leader's still as before.
   */
  private tvContent() {
    const leaderId = `nat_${this.s.config.nationalLeader}`;
    const { urls: imgs, overridden } = this.tvImages(leaderId);
    const placeholder = !overridden && !!this.c.manifest.tvMeta?.[leaderId]?.placeholder;
    const leaderName = this.vars().leaderName;
    const stories = this.pickNews('tv').slice(0, FEATURES.tvKeepWatching ? 2 : 1).map((n, i) => {
      const leaderImg = imgs.length ? imgs[i % imgs.length] : null;
      const base = { id: n.id, valence: n.valence, headline: this.t(n.headline), body: this.t(n.body) };
      if (!n.figure) return { ...base, image: leaderImg, placeholder, figure: null, figureName: leaderName };
      const ci = this.castImage(n.figure, 'tv');
      return ci.url
        ? { ...base, image: ci.url, placeholder: ci.placeholder, figure: n.figure, figureName: ci.name, figureRole: ci.role }
        // no still for this person yet: a PLACEHOLDER screen, not the leader's face under someone else's name
        : { ...base, image: null, placeholder: true, pendingNote: `${ci.name} still`, figure: n.figure, figureName: ci.name, figureRole: ci.role };
    });
    return { leaderId, leaderName, placeholder, stories };
  }


  // ------------------------------------------------------------------ SPEC "Who said what" (nightly memory test, Taylor et al. 1978)
  /** A line as the player read it: beats joined, tags and stage directions dropped, placeholders filled, trimmed to a sentence or two. */
  private cleanLine(line: string, max = 200): string {
    const parts = splitBeats(line).flatMap((b) => speechParts(this.t(b.text)).filter((p) => p.kind !== 'stage').map((p) => p.text));
    let text = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (text.length > max) { const cut = text.slice(0, 200); const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! ')); text = end > 60 ? cut.slice(0, end + 1) : cut.replace(/\s\S*$/, '') + '\u2026'; }
    return text;
  }

  /** NPC lines the player saw today (openers and follow-ups, from today's log), without the ones that name their speaker. */
  private linesToday(): { npc: string; text: string; words: number }[] {
    const out: { npc: string; text: string; words: number }[] = [];
    const seen = new Set<string>();
    for (const ln of readLog(this.s.room).split('\n')) {
      if (!ln.includes('"dialogue"') && !ln.includes('"choice"')) continue;
      let l: any;
      try { l = JSON.parse(ln); } catch { continue; }
      if (l.day !== this.s.day) continue;
      let npc: string | undefined, rule: string | undefined;
      if (l.type === 'dialogue' && l.target && l.rule) { npc = l.target; rule = l.rule; }
      else if (l.type === 'choice' && !l.event && l.target && l.next) { npc = l.target; rule = l.next; }
      else continue;
      const key = `${npc}|${rule}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const n = this.c.npcById.get(npc!);
      const row = (this.c.dialogue.get(npc!) ?? []).find((r) => r.id === rule);
      if (!n || !row) continue;
      const text = this.cleanLine(row.line);
      if (text.split(/\s+/).length < 6) continue;
      const names = [...n.name.split(/\s+/), ...(n.called ? n.called.split(/\s+/) : [])].filter((w) => w.length > 2 && !/^(Mr|Mrs|Ms|Dr|Don|Sra)\.?$/i.test(w));
      if (names.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text))) continue;
      out.push({ npc: n.id, text, words: this.cleanLine(row.line, Infinity).split(/\s+/).length });
    }
    return out;
  }

  /**
   * The nightly test: up to six of today's lines, the longest ones (length stands in for "remarkable"), each with the
   * people met so far as the options (speakers from both communities).
   */
  private whoSaidQuestionnaire(): (Questionnaire & { key: Record<string, string> }) | null {
    const lines = this.linesToday();
    if (lines.length < 2) return null;
    const rng = seeded(this.s.config.seed, 'whosaid', this.s.day);
    const shuffle = <T,>(a: T[]) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
    const picked = shuffle(shuffle(lines).sort((a, b) => b.words - a.words).slice(0, 6)); // ties broken by the shuffle; shown in a drawn order
    const speakers = new Set(picked.map((x) => x.npc));
    const met = this.c.npcs.filter((n) => n.appearances.length && (speakers.has(n.id) || this.s.npcs[n.id]?.met === 'yes') && this.inRoster(n));
    // options: today's speakers plus other people met, so a wrong answer can land in either community; at most eight names
    const side = (n: Npc) => (n.community === 'us' ? 'us' : 'home');
    const extras = shuffle(met.filter((n) => !speakers.has(n.id)));
    const pool = [...met.filter((n) => speakers.has(n.id))];
    for (const want of ['us', 'home']) if (!pool.some((n) => side(n) === want)) { const e = extras.find((n) => side(n) === want); if (e) pool.push(e); }
    for (const e of extras) { if (pool.length >= 8) break; if (!pool.includes(e)) pool.push(e); }
    const options = pool.map((n) => n.name).sort((a, b) => a.localeCompare(b));
    const key: Record<string, string> = {};
    const items = picked.map((x, i) => { key[`ws_${i + 1}`] = x.npc; return { id: `ws_${i + 1}`, type: 'choice' as const, text: `\u201C${x.text}\u201D`, options }; });
    return {
      id: 'whosaid', title: this.str('ui.whosaid.title'), intro: this.str('ui.whosaid.intro'),
      pages: [{ items }], key,
    };
  }

  /** Scores the answers (Taylor et al. 1978: errors within vs between the two communities) and writes the `whosaid` line. */
  private logWhoSaid(q: Questionnaire & { key: Record<string, string> }, answers: Record<string, unknown>): void {
    const byName = new Map(this.c.npcs.map((n) => [n.name, n]));
    const side = (n?: Npc) => (!n ? '' : n.community === 'us' ? 'us' : 'home');
    const items = Object.entries(q.key).map(([id, npc]) => {
      const n = this.c.npcById.get(npc);
      const chosen = byName.get(String(answers[id] ?? ''));
      const item = (q.pages[0].items.find((it) => it.id === id));
      const correct = chosen?.id === npc;
      return { id, text: item?.text ?? '', speaker: npc, speakerSide: side(n), chosen: chosen?.id ?? null, chosenSide: side(chosen), correct, error: correct ? null : chosen ? (side(chosen) === side(n) ? 'within' : 'between') : 'none' };
    });
    const score = items.filter((x) => x.correct).length;
    appendLog(this.s, {
      type: 'whosaid', target: `day${this.s.day}`, n: items.length, score,
      within: items.filter((x) => x.error === 'within').length, between: items.filter((x) => x.error === 'between').length,
      options: q.pages[0].items[0]?.options ?? [], items,
    });
  }

  endDay(): void {
    if (this.win?.module === 'survey' || this.surveyLoading) return; // already open: re-opening would reload the frame and wipe answers
    // SPEC "Town hall": on the last day, bed leads into the town hall; the survey follows once it is over
    if (this.s.day >= DEMO_DAYS && !this.s.townhall) return this.startTownhall();
    if (this.townhallActive()) return;
    this.endConvo('day_end');
    this.phoneOpen = false;
    // SPEC "Who said what": the check-in is already answered tonight; only the memory test is left
    if (this.s.surveyAnswered === this.s.day) return this.afterSurvey();
    this.s.surveyDay = this.s.day;
    this.save();
    this.render();
    this.surveyLoading = true;
    const day = this.s.day;
    // a slow lookup shows "Loading your call…" instead of a dead click
    let loading: HTMLElement | null = null;
    const slow = setTimeout(() => {
      loading = h('div', { class: 'win-overlay', role: 'status', 'aria-live': 'polite' },
        h('div', { class: 'call-loading' }, h('span', { class: 'phone-icon ringing-icon', 'aria-hidden': 'true' }), this.str('ui.loadingCall')));
      this.stage.append(loading);
    }, 250);
    this.resolveQuestionnaire(day)
      .catch(() => ({ q: this.c.eod, source: 'bundled' as const }))
      .then(({ q, source }) => {
        clearTimeout(slow);
        (loading as HTMLElement | null)?.remove();
        this.surveyLoading = false;
        if (this.s.day !== day || this.s.surveyDay !== day) return; // the day moved on meanwhile
        this.openSurvey(q, source);
      });
  }

  /** End-of-day questionnaire, first match wins: server for this room/day, the room's own (pasted JSON or URL, or dev &eod=), bundled eod.json. */
  private async resolveQuestionnaire(day: number): Promise<{ q: Questionnaire; source: 'server' | 'room' | 'bundled' }> {
    const fromServer = await fetchQuestionnaire(appUrl(`api/questionnaire?room=${encodeURIComponent(this.s.room)}&day=${day}`));
    if (fromServer) return { q: fromServer, source: 'server' };
    const cfg = getRoom(this.s.room)?.config ?? this.s.config;
    const devUrl = this.devEod;
    if (devUrl) {
      const q = await fetchQuestionnaire(devUrl);
      if (q) return { q, source: 'room' };
      console.warn(`[survey] &eod=${devUrl} did not give a valid questionnaire; falling through`);
    }
    if (cfg.questionnaire && !questionnaireProblems(cfg.questionnaire).length) return { q: cfg.questionnaire, source: 'room' };
    if (cfg.questionnaireUrl) {
      const q = await fetchQuestionnaire(cfg.questionnaireUrl);
      if (q) return { q, source: 'room' };
    }
    return { q: this.c.eod, source: 'bundled' };
  }

  /** Dev mode only: `&eod=<url>` stands in for the room's questionnaire URL. */
  devEod: string | null = null;

  private openSurvey(q: Questionnaire, source: 'server' | 'room' | 'bundled'): void {
    this.openWindow('survey', { ...q, day: this.s.day }, {
      onSubmit: (answers) => {
        appendLog(this.s, { type: 'survey', target: q.id, source, answers });
        this.s.surveyDay = undefined;
        this.s.surveyAnswered = this.s.day;
        this.closeWindow(false);
        this.afterSurvey();
      },
      onClose: () => {
        this.s.surveyDay = undefined;
        this.save();
      },
    });
  }

  /** SPEC "Who said what": after the check-in comes the nightly memory test, once per day; then the day ends. */
  private afterSurvey(): void {
    if (this.s.whoSaidDay !== this.s.day) {
      const q = this.whoSaidQuestionnaire();
      if (q) {
        this.s.surveyDay = this.s.day; // a reload comes back to the open test
        this.save();
        this.render();
        this.openWindow('survey', { ...q, day: this.s.day }, {
          onSubmit: (answers) => { this.logWhoSaid(q, answers); this.s.whoSaidDay = this.s.day; this.closeWindow(false); this.afterSurvey(); },
          onClose: () => { this.s.surveyDay = undefined; this.save(); }, // bed asks the test again, not the check-in
        });
        return;
      }
      this.s.whoSaidDay = this.s.day; // nothing to ask tonight
    }
    this.s.surveyDay = undefined;
    this.s.surveyAnswered = undefined;
    this.finishDay();
  }

  private finishDay(): void {
    appendLog(this.s, {
      type: 'day_end', target: `day${this.s.day}`,
      npcs: Object.fromEntries(Object.entries(this.s.npcs).filter(([, v]) => v.met === 'yes')),
      wallet: this.s.wallet, spent: { ...this.s.spent },
    });
    if (this.s.day >= DEMO_DAYS) {
      this.s.finished = true;
      this.save();
      this.render();
      this.renderEnd();
      return;
    }
    this.s.day += 1;
    this.beginDay();
  }

  // ------------------------------------------------------------------ windows
  private openWindow(module: ModuleId, content: unknown, hooks: Pick<OpenWindow, 'onSubmit' | 'onClose'> = {}): void {
    this.closeWindow(false);
    const frame = h('iframe', { src: appUrl(`modules/${module}.html`), title: `${module} window`, class: 'win-frame' });
    const overlay = h('div', { class: 'win-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${module} window` },
      h('div', { class: 'win-box' }, frame));
    frame.addEventListener('load', () => {
      frame.contentWindow?.postMessage({
        type: 'init',
        payload: { day: this.s.day, actions: this.s.actions, wallet: this.s.wallet, condition: this.s.config.nationalLeader, homeCulture: this.s.player.homeCulture, content },
      }, location.origin);
      frame.focus();
    });
    this.stage.append(overlay);
    this.win = { module, overlay, frame, ...hooks };
    this.renderStrip(); // a ringing phone stops ringing while the call (survey) is on screen
  }

  private closeWindow(notify = true): void {
    if (!this.win) return;
    const w = this.win;
    this.win = null;
    if (w.module === 'tv') this.tvOnScreen = null; // SPEC "TV once a day": the room screens go black for the rest of the day
    w.overlay.remove();
    if (notify) w.onClose?.();
    this.render();
  }

  private reply(type: string, extra: Record<string, unknown> = {}) {
    this.win?.frame.contentWindow?.postMessage({ type, payload: { actions: this.s.actions, wallet: this.s.wallet, ...extra } }, location.origin);
  }

  private onMessage(e: MessageEvent): void {
    const w = this.win;
    if (!w || e.source !== w.frame.contentWindow) return;
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case 'earn': {
        const amount = Math.max(0, Math.min(1000, Math.round(Number(m.amount) || 0)));
        if (!amount) return;
        const before = this.s.wallet;
        this.s.wallet += amount;
        this.s.walletLog.push({ day: this.s.day, amount, why: w.module });
        appendLog(this.s, { type: 'window', target: w.module, op: 'earn', delta: { wallet: [before, this.s.wallet] } });
        this.save();
        this.renderTop();
        this.reply('state', { ok: true });
        return;
      }
      case 'spend': {
        const n = Math.max(0, Math.round(Number(m.actions) || 0));
        if (n > this.spendable()) return this.reply('state', { ok: false });
        const before = this.s.actions;
        this.spend(n);
        if (w.module === 'tv' && !FEATURES.tvKeepWatching) return this.reply('state', { ok: false }); // Keep watching is off
        if (w.module === 'tv' && typeof m.story === 'string') {
          this.s.seenNews.push(m.story);
          this.s.tvWatched = { day: this.s.day, phase: phaseOf(this.s.actions), story: m.story };
        }
        appendLog(this.s, { type: 'window', target: w.module, op: 'spend', rule: typeof m.story === 'string' ? m.story : undefined, delta: { actions: [before, this.s.actions] } });
        this.save();
        this.renderTop();
        this.reply('state', { ok: true });
        return;
      }
      case 'submit':
        if (w.onSubmit) w.onSubmit((m.answers && typeof m.answers === 'object' ? m.answers : {}) as Record<string, unknown>);
        return;
      case 'close':
        this.closeWindow(true);
        return;
      default:
        return; // host ignores anything else
    }
  }

  // ------------------------------------------------------------------ input
  private onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.key === 'h' || e.key === 'H') && !e.metaKey && !e.ctrlKey && !this.win && this.debug) this.reveal();
    if (e.key === 'Escape') {
      if (this.win) this.closeWindow(true);
      else if (this.phoneOpen) { this.phoneOpen = false; this.renderPhone(); }
    }
  }

  private reveal(): void {
    this.sceneBox.classList.add('reveal');
    setTimeout(() => this.sceneBox.classList.remove('reveal'), 2000);
  }

  private fit(): void {
    const sc = Math.min(window.innerWidth / 1440, window.innerHeight / 900);
    const x = (window.innerWidth - 1440 * sc) / 2;
    const y = (window.innerHeight - 900 * sc) / 2;
    this.stage.style.transform = `translate(${x}px, ${y}px) scale(${sc})`;
  }

  // ------------------------------------------------------------------ rendering
  private buildShell(): void {
    this.top = h('header', { class: 'topbar' });
    this.sceneBox = h('div', { class: 'scene-box' });
    this.strip = h('nav', { class: 'strip', 'aria-label': 'Exits' });
    this.right = h('aside', { class: 'right', 'aria-live': 'polite' });
    this.phoneEl = h('div', { class: 'phone', role: 'dialog', 'aria-label': 'Phone', hidden: true });
    const left = h('section', { class: 'left' }, this.sceneBox, this.strip, this.phoneEl);
    this.stage.append(this.top, h('main', { class: 'body' }, left, this.right));
  }

  render(): void {
    // a different scene (or background variant) is held back until its images are in: see beginSwap()
    if (this.sceneKey() !== this.shownScene) { this.beginSwap(); return; }
    // whatever replaced the dialogue panel (a hotspot's text, a note, an event) means the player left the conversation
    if (this.s.convo && !(this.panel.kind === 'dialogue' && this.panel.npc === this.s.convo.npc)) this.endConvo('left');
    // SPEC "Plans": a plan whose time has come takes the panel as soon as it is free (a scene change re-enters render)
    if (this.checkPlans() && this.sceneKey() !== this.shownScene) { this.beginSwap(); return; }
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.fk;
    this.renderTop();
    this.renderScene();
    this.renderStrip();
    this.renderRight();
    this.renderPhone();
    if (focusKey) {
      const el = this.stage.querySelector<HTMLElement>(`[data-fk="${CSS.escape(focusKey)}"]`);
      if (el && !(el as HTMLButtonElement).disabled) el.focus();
      else this.right.querySelector<HTMLElement>('.choice')?.focus();
    }
  }

  // ------------------------------------------------------------------ scene swap (SPEC "Figures appear with the scene")
  /** What the scene box shows: the scene and its background variant (evening, painted). A change preloads and fades. */
  private sceneKey(): string {
    const sc = this.scene;
    return `${sc.id}|${sc.background === 'none' ? 'none' : this.bgFor(sc)?.id ?? ''}`;
  }

  /** Every image the scene box will draw right away: background, props, present figures, the TV screen still. */
  private sceneImageUrls(sc: Scene): string[] {
    const urls: string[] = [];
    if (sc.background !== 'none') {
      const bg = this.bgFor(sc);
      if (bg?.url) urls.push(bg.url);
      for (const p of this.paintedActive(sc) ? [] : sc.props) {
        const m = assetEntry(this.c.manifest, this.c.manifest.props, p.asset);
        if (m?.file) urls.push(this.c.assetUrl(m.file));
      }
      for (const pr of this.presentIn(sc.id)) if (pr.slot) urls.push(this.figureFor(pr.npc, pr.figure).url);
      if (this.screensFor(sc).length) { const st = this.screenStory(); if (st?.image) urls.push(st.image); }
    }
    return [...new Set(urls)].filter((u) => u && !u.startsWith('data:'));
  }

  private keepAlive = new Map<string, HTMLImageElement>();
  private preload(url: string): Promise<void> {
    if (this.loaded.has(url)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const img = new Image();
      const done = () => { this.loaded.add(url); resolve(); };
      img.onload = () => { img.decode().then(done, done); };
      img.onerror = done; // a broken image falls back to its placeholder when drawn; never hold the scene for it
      img.src = url;
      this.keepAlive.set(url, img);
    });
  }

  /**
   * Holds the old scene on screen (input paused) while the new scene's images load and decode, at most
   * PRELOAD_CAP_MS, then draws the new scene under a snapshot of the old one and fades the snapshot out.
   */
  private beginSwap(): void {
    const key = this.sceneKey();
    if (this.swapping === key) return;
    this.swapping = key;
    const sc = this.scene;
    const need = this.sceneImageUrls(sc).filter((u) => !this.loaded.has(u));
    const finish = () => {
      if (this.swapping !== key) return; // superseded by another swap
      this.swapping = null;
      this.stage.classList.remove('swapping');
      const first = this.shownScene === null;
      const ghost = first ? null : (this.sceneBox.cloneNode(true) as HTMLElement);
      this.shownScene = key;
      this.render();
      if (ghost) {
        ghost.classList.add('scene-ghost');
        ghost.removeAttribute('aria-live');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.querySelectorAll('button').forEach((b) => b.setAttribute('tabindex', '-1'));
        this.sceneBox.after(ghost);
        requestAnimationFrame(() => requestAnimationFrame(() => ghost.classList.add('out')));
        setTimeout(() => ghost.remove(), SWAP_FADE_MS + 60);
      } else {
        this.sceneBox.classList.add('fade-in');
        setTimeout(() => this.sceneBox.classList.remove('fade-in'), SWAP_FADE_MS + 60);
      }
    };
    if (!need.length) return finish();
    this.stage.classList.add('swapping');
    let timer = 0;
    const cap = new Promise<void>((r) => { timer = window.setTimeout(() => { console.info(`[scene] ${sc.id}: images still loading after ${PRELOAD_CAP_MS} ms; showing the scene`); r(); }, PRELOAD_CAP_MS); });
    void Promise.race([Promise.all(need.map((u) => this.preload(u))), cap]).then(() => { clearTimeout(timer); finish(); });
  }

  // ------------------------------------------------------------------ TV screens (SPEC "TV screens show the news")
  private screensFor(sc: Scene): Screen[] {
    return this.devScreens.get(sc.id) ?? sc.screens ?? [];
  }

  /** SPEC "TV once a day": the TV (home or clinic, one shared state) has been opened today. */
  private tvWatchedToday(): boolean {
    return this.s.tvWatchedDay === this.s.day;
  }

  /**
   * The story a room TV shows: what tvContent() would open with. Once the TV has been opened today, the still it
   * showed at that moment stays while the TV window is open (opening marks the story seen, which must not change the
   * screen), and after the window closes the screens are black for the rest of the day.
   */
  private screenStory(): { id: string; image: string | null } | null {
    if (this.tvWatchedToday()) return this.tvOnScreen;
    const st = this.tvContent().stories[0];
    return st ? { id: st.id, image: st.image ?? null } : null;
  }

  /** A prop's projection quad on the background actually drawn (dev override first), or null for flat placement. */
  private propQuad(sc: Scene, p: Prop): [number, number][] | null {
    const dev = this.devPropQuads.get(sc.id);
    if (dev?.has(p.asset)) return dev.get(p.asset) ?? null;
    const bg = this.bgFor(sc);
    return (bg && (p.byBackground?.[bg.id] ?? p.byBackground?.[bg.base])) || p.quad || null;
  }

  /** A TV glass: the still laid out at 1280 x 720 and projected onto the quad (scene-box pixels) with matrix3d. */
  private screenEl(scr: Screen): HTMLElement {
    // the screen as measured on the background actually drawn (the evening render may put the TV a little elsewhere)
    // a pack variant (byPack) resolves through the base background it replaces
    const bg = this.bgFor(this.scene);
    const q = (bg && (scr.byBackground?.[bg.id] ?? scr.byBackground?.[bg.base])) || scr.quad;
    const quad = q.map(([x, y]) => [x * IMG_W, y * IMG_H] as [number, number]);
    const st = this.screenStory();
    const glass = h('div', {
      class: `tv-glass${st?.image ? '' : ' dark'}`, 'data-story': st?.id ?? '',
      style: `width:${TV_W}px;height:${TV_H}px;transform:${matrix3d(quad, TV_W, TV_H)};`,
    });
    if (st?.image) {
      const img = h('img', { src: st.image, alt: '', draggable: 'false' });
      img.addEventListener('error', () => { img.remove(); glass.classList.add('dark'); });
      glass.append(img);
    }
    glass.append(h('div', { class: 'tv-sheen' }));
    return h('div', { class: 'tv-screen', 'aria-hidden': 'true', 'data-screen': scr.id }, glass);
  }

  private renderTop(): void {
    const s = this.s;
    const phase = phaseOf(s.actions);
    const dots = h('span', { class: 'dots', role: 'img', 'aria-label': `${this.str('ui.actions')}: ${s.actions} of ${DAY_ACTIONS}` });
    for (let i = 0; i < DAY_ACTIONS; i++) dots.append(h('span', { class: i < s.actions ? 'dot on' : 'dot' }));
    this.top.replaceChildren(
      h('div', { class: 'tb-left' },
        h('span', { class: 'tb-day', text: `${this.str('ui.day')} ${s.day} of ${DEMO_DAYS} · ${this.str(`ui.phase.${phase}`)}` }),
        h('span', { class: 'tb-scene', text: this.scene.name })),
      h('div', { class: 'tb-right' },
        h('span', { class: 'tb-legend', title: this.str('ui.costLegendTitle') }, this.costDots(1), ` = ${this.costWords(1)}`),
        dots,
        this.planChip(),
        h('span', { class: 'tb-wallet', 'aria-label': this.str('ui.wallet'), text: `$${s.wallet}` }),
        h('span', { class: 'tb-room', text: `${this.str('ui.room')} ${s.room}` }),
        this.overrideChip(),
        this.c.source === 'fixtures' ? h('span', { class: 'tb-fx', text: 'FIXTURES' }) : null),
    );
  }

  /** SPEC "Plans": today's accepted invitation and its time, in the top bar; the actions it needs are kept back. */
  private planChip(): HTMLElement | null {
    const list = this.plans();
    if (!list.length) return null;
    const p = list[0];
    const who = p.ev.npc ? this.c.npcById.get(p.ev.npc)?.name ?? p.ev.npc : p.ev.id;
    const text = this.str('ui.plan.chip', { name: who, when: this.str(`ui.plan.${p.when}`) });
    return h('span', { class: 'tb-plan', title: `${text}. ${this.costWords(p.ev.cost)} kept back for it.`, text: `\u{1F4CC} ${text}` });
  }

  /** "edited content" chip while a researcher override is active; the tooltip lists what changed and any rejection. */
  private overrideChip(): HTMLElement | null {
    const o = this.c.override;
    if (!o.applied.length && !o.images.length && !o.rejected.length) return null;
    const lines: string[] = [];
    if (o.applied.length) lines.push(`Edited: ${o.applied.join(', ')}`);
    if (o.images.length) lines.push(`Images: ${o.images.join(', ')}`);
    for (const r of o.rejected) lines.push(`Rejected ${r.key} (bundled file used): ${r.problems.slice(0, 5).map((p) => p.replace(/^\[content\] /, '')).join('; ')}${r.problems.length > 5 ? ` (+${r.problems.length - 5} more)` : ''}`);
    if (o.updated) lines.push(`Saved ${o.updated}`);
    const tip = lines.join('\n');
    return h('span', { class: `tb-edited${o.rejected.length ? ' warn' : ''}`, title: tip, 'aria-label': `${this.str('ui.edited')}. ${tip}`, tabindex: 0, text: this.str('ui.edited') + (o.rejected.length ? ' !' : '') });
  }

  private pendingTag(): HTMLElement {
    return h('span', { class: 'pending', text: this.str('ui.pendingArt') });
  }

  /** One `client_error` log line (deduplicated per message within a session) plus a console.error for the walker. */
  private clientErrors = new Set<string>();
  private clientError(what: string, detail: string): void {
    const key = `${what}|${detail}`;
    if (this.clientErrors.has(key)) return;
    this.clientErrors.add(key);
    console.error(`[client] ${what}: ${detail}`);
    try { appendLog(this.s, { type: 'client_error', what, detail: detail.slice(0, 400), ua: navigator.userAgent.slice(0, 120), href: location.href.slice(0, 200) }); } catch { /* logging must never throw */ }
  }

  private flatPanel(sc: Scene, bgId: string): HTMLElement {
    return h('div', { class: 'bg-flat', role: 'img', 'aria-label': `${sc.name} (background pending)` },
      h('div', { class: 'bg-flat-name', text: sc.name }),
      h('div', { class: 'bg-flat-id', text: `${this.str('ui.pendingBg')}: ${bgId}` }));
  }

  private renderScene(): void {
    const sc = this.scene;
    const box = this.sceneBox;
    box.replaceChildren();
    this.stage.classList.toggle('profile-pending', !!this.s.player.profilePending);
    box.dataset.lighting = sc.lighting ?? '';
    box.classList.toggle('evening', phaseOf(this.s.actions) === 'evening');
    box.classList.toggle('is-tired', this.tired());

    if (sc.background === 'none') {
      const hub = this.hubCard(sc);
      box.append(hub);
      // in the hub the banner sits inside the card (the card fills the scene; a bottom overlay would cover the last exit)
      const card = hub.querySelector<HTMLElement>('.hub-card')!;
      const before = card.childElementCount;
      this.appendPackBanner(card, card.querySelector('.hub-where'));
      card.classList.toggle('has-banner', card.childElementCount > before);
      return;
    }
    const bg = this.bgFor(sc)!;
    if (bg.url) {
      const img = h('img', { class: 'bg', src: bg.url, alt: '', draggable: 'false' });
      img.addEventListener('error', () => { this.clientError('image', `background ${bg.id} failed to load: ${bg.url}`); img.replaceWith(this.flatPanel(sc, bg.id)); });
      box.append(img);
      if (bg.placeholder) box.append(this.pendingTag());
    } else {
      box.append(this.flatPanel(sc, bg.id));
    }

    // composited props belong to the plain background; a painted variant has them in the image already
    for (const p of this.paintedActive(sc) ? [] : sc.props) {
      const m = assetEntry(this.c.manifest, this.c.manifest.props, p.asset);
      if (!m?.file) continue;
      const w = p.w * IMG_W;
      const q = this.propQuad(sc, p);
      // SPEC "Content schemas": with a quad the prop is laid out at its manifest size and projected onto the quad
      // (the same homography as the TV glass); without one it is placed flat at x/y/w
      const pw = m.w || 1000, ph = m.h || 1000;
      const prop = h('img', {
        class: `${q ? 'prop prop-quad' : 'prop'}${p.over ? ' prop-over' : ''}`, src: this.c.assetUrl(m.file), alt: '', draggable: 'false',
        style: q
          ? `left:0;top:0;width:${pw}px;height:${ph}px;max-width:none;transform-origin:0 0;transform:${matrix3d(q.map(([x, y]) => [x * IMG_W, y * IMG_H] as [number, number]), pw, ph)};`
          : `left:${p.x * IMG_W}px;top:${p.y * IMG_H}px;width:${w}px;`,
      });
      prop.addEventListener('error', () => prop.remove());
      box.append(prop);
    }
    // the TV glass sits over the background and props, under the hotspot (the click still opens the TV)
    for (const scr of this.screensFor(sc)) box.append(this.screenEl(scr));

    const tired = this.tired();
    const present = this.presentIn(sc.id);
    for (const hs of sc.hotspots) {
      const a = hs.action;
      // a talk zone only exists while its NPC is painted into the current background
      const talkNpc = a.type === 'talk' ? present.find((p) => p.npc.id === a.npc && p.slot === null)?.npc : undefined;
      if (a.type === 'talk' && !talkNpc) continue;
      if (a.type === 'move' && !this.openToPlayer(String(a.to))) continue; // another pack's scene
      const cost = talkNpc ? 0 : a.cost ?? (a.type === 'window' || a.type === 'news' ? 1 : 0); // starting a conversation is free
      const blockedMove = a.type === 'move' && this.moveBlocked(String(a.to));
      const speaking = !!talkNpc && ((this.panel.kind === 'dialogue' && this.panel.npc === talkNpc.id) || (this.panel.kind === 'event' && this.panel.ev.npc === talkNpc.id));
      // another conversation is on screen: this person waits (SPEC "Conversation end")
      const inOther = !!talkNpc && this.panel.kind === 'dialogue' && this.panel.npc !== talkNpc.id;
      // SPEC "Conversation limit semantics" / "TV once a day": simply non-interactive, no visible label or notice
      const talked = !!talkNpc && this.talkedOut(talkNpc.id) && !speaking;
      const watched = a.type === 'window' && a.module === 'tv' && this.tvWatchedToday();
      const spent = talked || watched;
      const disabled = spent || inOther || (talkNpc ? !this.canTalk() : tired || cost > this.spendable() || blockedMove);
      const label = talkNpc ? this.str('ui.talkTo', { name: talkNpc.name }) : hs.label;
      const costTxt = talkNpc ? this.talkLabel(talkNpc).slice(label.length) : cost ? ` (${this.costWords(cost)})` : blockedMove ? ` (${this.str('ui.tired')})` : '';
      const aria = talked ? this.talkedAria(talkNpc!) : watched ? `${hs.label} (watched today)` : inOther ? `${label} (${this.str('ui.inConversation')})` : `${label}${costTxt}`;
      const b = h('button', {
        class: `hotspot${hs.placeholder ? ' ph' : ''}${talkNpc ? ' talk' : ''}${speaking ? ' speaking' : ''}${spent ? ' spent' : ''}${inOther ? ' locked' : ''}`,
        'data-fk': `hs:${hs.id}`, 'aria-label': aria, title: spent ? null : aria,
        disabled, onclick: () => this.hotspot(hs),
        style: `left:${hs.zone.x * 100}%;top:${hs.zone.y * 100}%;width:${hs.zone.w * 100}%;height:${hs.zone.h * 100}%;`,
      },
      hs.placeholder ? h('span', { class: 'ph-mark', text: `${this.str('ui.pendingArt')} · ${hs.label}` }) : null,
      spent ? null : h('span', { class: 'hs-label' }, label, this.costDots(cost)));
      box.append(b);
    }

    const figures = present.filter((p): p is Presence & { slot: Slot } => p.slot !== null).sort((a, b) => a.slot.y - b.slot.y);
    for (const { npc, slot, figure } of figures) {
      const fig = this.figureFor(npc, figure);
      const hgt = figureHeight(sc, slot, fig.seated) * IMG_H;
      const wid = hgt * fig.aspect;
      const left = slot.x * IMG_W - wid / 2;
      const top = slot.y * IMG_H - hgt;
      const speaking = (this.panel.kind === 'dialogue' && this.panel.npc === npc.id) || (this.panel.kind === 'event' && this.panel.ev.npc === npc.id);
      // SPEC "Conversation limit semantics": still standing there, simply non-interactive (no outline, no label)
      const talked = this.talkedOut(npc.id) && !speaking;
      const inOther = this.panel.kind === 'dialogue' && this.panel.npc !== npc.id; // someone else is talking to the player (SPEC "Conversation end")
      // SPEC "Town hall": the person at the podium is not someone to talk to
      const talkLabel = sc.hidden ? npc.name : talked ? this.talkedAria(npc) : inOther ? `${this.talkLabel(npc)} (${this.str('ui.inConversation')})` : this.talkLabel(npc);
      // starting a conversation is free (SPEC "Pay when you stay"): no cost dot; the paid turn shows its dot on the choice
      const btn = h('button', {
        class: `figure${speaking ? ' speaking' : ''}${fig.seated ? ' seated' : ''}${talked ? ' talked' : ''}${inOther ? ' locked' : ''}`, 'data-fk': `npc:${npc.id}`,
        'aria-label': talkLabel, title: talked ? null : inOther ? this.str('ui.inConversation') : talkLabel,
        disabled: talked || inOther || !this.canTalk(), onclick: () => this.talkTo(npc.id),
        style: `left:${left}px;top:${top}px;width:${wid}px;height:${hgt}px;z-index:${10 + Math.round(slot.y * 100)};`,
      },
      h('span', { class: 'shadow', style: `width:${wid * (fig.seated ? 0.9 : 0.7)}px;height:${Math.max(8, hgt * 0.05)}px;` }),
      h('img', { src: fig.url, alt: '', draggable: 'false' }),
      talked ? null : h('span', { class: 'fig-label', 'aria-hidden': 'true' }, npc.name),
      fig.placeholder ? this.pendingTag() : null);
      const img = btn.querySelector('img')!;
      img.addEventListener('error', () => { img.src = silhouetteFigure(fig.seated); });
      box.append(btn);
      // dev guide (shown with H): where this figure's head lands, to compare with the horizon line
      if (this.debug) box.append(h('div', { class: 'dev-guide dev-head', style: `top:${top}px;left:${left - 12}px;width:${wid + 24}px;`, title: `${npc.name}: feet ${slot.y}, ${slot.scale ? 'scale override' : 'horizon formula'}` },
        h('span', { text: `${npc.name} ${(hgt / IMG_H).toFixed(2)}${slot.scale ? ' (scale)' : ''}` })));
    }
    if (this.debug) box.append(h('div', { class: 'dev-guide dev-horizon', style: `top:${sc.horizon * IMG_H}px;` },
      h('span', { text: `horizon ${+sc.horizon.toFixed(3)} · camera ${sc.cameraHeight} m` })));

    if (tired) {
      box.append(h('div', { class: 'tired', role: 'alert' },
        h('p', { text: this.str('ui.tired') }),
        h('button', { class: 'btn', 'data-fk': 'gohome', onclick: () => this.moveTo('home'), text: this.str('ui.goHome') })));
    }
    this.appendPackBanner(box);
  }

  /** SPEC "Packs": the home culture's pack is not in the content, so another pack (cn) stands in; say which. */
  private appendPackBanner(box: HTMLElement, before: Element | null = null): void {
    if (this.s.player.homeCulture === this.s.player.pack) return;
    box.insertBefore(h('div', { class: `banner${before ? ' banner-inline' : ''}`, role: 'note', text: this.str('ui.packBanner', {
      culture: CULTURE_PACK_NAMES[this.s.player.homeCulture] ?? this.s.player.homeCulture,
      pack: CULTURE_PACK_NAMES[this.s.player.pack] ?? this.s.player.pack,
    }) }), before);
  }

  private hubCard(sc: Scene): HTMLElement {
    const list = h('div', { class: 'hub-exits' });
    for (const ex of this.exitsOf(sc)) {
      const dest = this.c.sceneById.get(ex.to);
      const blocked = this.moveBlocked(ex.to);
      const name = dest?.name ?? ex.to;
      list.append(h('button', {
        class: `hub-exit${blocked ? ' blocked' : ''}`, 'data-fk': `hub:${ex.to}`, disabled: blocked, onclick: () => this.moveTo(ex.to),
        'aria-label': `${ex.label}, go to ${name}${blocked ? ` (${this.str('ui.tired')})` : ''}`,
        title: blocked ? this.str('ui.tired') : null,
      },
        h('span', { class: 'hub-label', text: ex.label }),
        h('span', { class: 'hub-dest', text: name + (blocked ? ` · ${this.str('ui.tired')}` : '') })));
    }
    return h('div', { class: 'hub' },
      h('div', { class: 'hub-card' },
        h('h2', { text: sc.name }),
        sc.description ? h('p', { class: 'hub-desc', text: this.t(sc.description) }) : null,
        h('p', { class: 'hub-where', text: this.str('ui.street') }),
        list));
  }

  private renderStrip(): void {
    const sc = this.scene;
    const exits = h('div', { class: 'exits' });
    // SPEC "Conversation end": the exits are locked while a conversation is on screen (every row has a leave option);
    // and while the opening questions are on the phone
    const locked = this.panel.kind === 'dialogue' || !!this.s.player.profilePending || this.townhallActive();
    const why = (blocked: boolean) => (blocked ? this.str('ui.tired') : locked ? this.str('ui.inConversation') : null);
    for (const ex of this.exitsOf(sc)) {
      const blocked = this.moveBlocked(ex.to);
      const name = this.c.sceneById.get(ex.to)?.name ?? ex.to;
      const reason = why(blocked);
      exits.append(h('button', {
        class: `exit${blocked ? ' blocked' : ''}${locked ? ' locked' : ''}`, 'data-fk': `exit:${ex.to}`, disabled: blocked || locked, onclick: () => this.moveTo(ex.to),
        'aria-label': `${ex.label}, go to ${name}${reason ? ` (${reason})` : ''}`,
        title: reason,
      },
        h('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }), ex.label));
    }
    // out of actions away from home: home stays one click away even when no exit here leads there
    if (this.s.actions <= 0 && sc.id !== 'home' && !this.townhallActive() && !this.exitsOf(sc).some((ex) => ex.to === 'home')) {
      exits.append(h('button', { class: `exit${locked ? ' locked' : ''}`, 'data-fk': 'exit:home', disabled: locked, title: why(false), onclick: () => this.moveTo('home') },
        h('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }), this.str('ui.goHome')));
    }
    this.strip.replaceChildren(
      h('button', {
        class: `phone-btn${this.ringing() ? ' ringing' : ''}`, 'data-fk': 'phone', 'aria-expanded': String(this.phoneOpen),
        disabled: this.townhallActive(), title: this.townhallActive() ? this.str('ui.townhall.inSession') : null,
        'aria-label': this.ringing() ? `${this.str('ui.phone')}: ${this.str('ui.ringing')}` : null,
        onclick: () => {
          this.phoneOpen = !this.phoneOpen;
          if (this.phoneOpen && this.ringing()) this.phoneTab = 'call'; // picking up a ringing phone goes straight to the call
          this.renderPhone(); this.renderStrip();
        },
      },
        h('span', { class: 'phone-icon', 'aria-hidden': 'true' }), this.str('ui.phone'),
        this.ringing() ? h('span', { class: 'phone-badge', 'aria-hidden': 'true', text: '1' }) : null),
      exits,
      sc.background !== 'none' && this.debug
        ? h('button', { class: 'reveal-btn', 'data-fk': 'reveal', onclick: () => this.reveal(), text: this.str('ui.showInteractables') })
        : '',
    );
  }

  /**
   * How an event's NPC reaches the player when they are not standing in the current scene: an invitation arrives
   * as an invitation, a day-start event as a call. Without this an invitation at home reads as a visit.
   */
  private viaLabel(ev: EventRow, name: string): string | null {
    if (!ev.npc) return null;
    if (this.presentIn(this.s.scene).some((p) => p.npc.id === ev.npc)) return null;
    // an `enter` event from someone who is not here is a visit (the text says they knock) or a call
    const key = ev.trigger === 'invite' ? 'ui.via.invite'
      : ev.trigger === 'day_start' ? 'ui.via.call'
        : ev.trigger === 'enter' ? (/\b(knock|knocks|knocking|doorbell|at the door)\b/i.test(ev.text) ? 'ui.via.door' : 'ui.via.call')
          : 'ui.via.message';
    return this.str(key, { name });
  }

  private bustImg(url: string, alt: string): HTMLImageElement {
    const img = h('img', { class: 'bust', src: url || SILHOUETTE_BUST, alt });
    img.addEventListener('error', () => { img.src = SILHOUETTE_BUST; });
    return img;
  }

  private renderRight(): void {
    const p = this.panel;
    let npc: Npc | undefined;
    let emotion: Emotion = 'neutral';
    if (p.kind === 'dialogue') { npc = this.c.npcById.get(p.npc); emotion = this.beatsOf(p.row.line, p.beat).cur.emotion ?? p.row.emotion; }
    if (p.kind === 'event' && p.ev.npc) { npc = this.c.npcById.get(p.ev.npc); emotion = this.beatsOf(p.ev.text, p.beat).cur.emotion ?? p.ev.emotion; }
    if (p.kind === 'idle' && p.ended) { npc = this.c.npcById.get(p.ended.npc); emotion = p.ended.emotion; }
    if (p.kind === 'townhall') { const sp = this.townhallSpoken(); npc = sp?.npc; emotion = sp?.emotion ?? 'neutral'; }

    const portrait = h('div', { class: 'portrait' });
    if (p.kind === 'idle' && p.ended) portrait.classList.add('ended');
    let via: string | null = null;
    if (p.kind === 'event' && p.ev.medium) {
      // heard, not seen (a radio): the object, uncropped on a plain ground; `portrait` (if any) names the voice
      const pr = this.propImage(p.ev.medium);
      const voice = p.ev.portrait ? this.castImage(p.ev.portrait, 'bust').name : '';
      portrait.classList.add('medium');
      portrait.append(pr.url
        ? h('img', { class: 'medium-img', src: pr.url, alt: pr.label })
        : h('div', { class: 'medium-ph', role: 'img', 'aria-label': `${pr.label} (${this.str('ui.pendingArt')})` },
          h('span', { class: 'ph-mark', text: `${this.str('ui.pendingArt')} · ${pr.label}` })),
        h('span', { class: 'who', text: voice ? `${pr.label} · ${voice}` : pr.label }));
    } else if (p.kind === 'event' && p.ev.portrait) {
      // a cast member (authority figure) speaks: their bust, their name and role
      const ci = this.castImage(p.ev.portrait, 'bust');
      via = npc ? this.viaLabel(p.ev, npc.name) : null;
      portrait.append(this.bustImg(ci.url, ci.name),
        h('span', { class: 'who', text: ci.role ? `${ci.name} · ${ci.role}` : ci.name }),
        ci.placeholder ? this.pendingTag() : '');
    } else if (npc) {
      const pi = this.portraitFor(npc, emotion);
      via = p.kind === 'event' ? this.viaLabel(p.ev, npc.name) : null;
      portrait.append(this.bustImg(pi.url, `${npc.name}, ${emotion}`),
        h('span', { class: `chip chip-${emotion}`, text: emotion }),
        h('span', { class: 'who', text: via ?? npc.name }),
        pi.placeholder ? this.pendingTag() : '');
    }
    if (via) portrait.classList.add('remote');

    const desc = h('p', { class: 'desc', text: this.t(this.scene.description) });
    const body = h('div', { class: 'dialogue' });
    const choices = h('div', { class: 'choices' });
    let status = '';

    if (this.editing && !(p.kind === 'dialogue' && p.npc === this.editing.npc && p.row.id === this.editing.row)) this.editing = null;
    if (p.kind === 'dialogue' && this.debug && this.editing) {
      body.append(this.editForm(this.editing));
      status = `editing rule ${p.row.id} · ${p.npc}`;
    } else if (p.kind === 'dialogue') {
      const bt = this.beatsOf(p.row.line, p.beat);
      body.append(...this.speech(bt.cur.text));
      if (!bt.last) {
        // a beat in progress: only Next (the choices come with the last beat)
        choices.append(h('button', { class: 'choice next', 'data-fk': 'ch:next', 'aria-label': this.str('ui.next'), title: this.str('ui.next'), onclick: () => this.nextBeat() }, h('span', { class: 'tri', 'aria-hidden': 'true', text: '\u25BE' })));
      } else {
        this.choiceOrder(p.row.id, p.row.choices.length).forEach((i, pos) => {
          const ch = p.row.choices[i];
          const { charge } = this.optionCharge(p.row, i);
          // the leave option (no `next`, no `cost N`) has charge 0, so it is never disabled by cost
          choices.append(this.choiceBtn(i, this.t(ch.text), charge + this.choiceCost(ch.effect), () => this.chooseDialogue(p.row, i, pos + 1), charge > this.spendable()));
        });
        if (!p.row.choices.length) {
          const ended = { npc: p.npc, emotion };
          choices.append(h('button', {
            class: 'choice', 'data-fk': 'ch:cont', text: this.str('ui.continue'),
            onclick: () => { this.endConvo('ended'); this.panel = { kind: 'idle', note: this.str('ui.convoEnded', { name: npc?.name ?? p.npc }), ended }; this.render(); },
          }));
        }
      }
      if (this.debug && this.s.convo?.history?.length) {
        choices.append(h('button', { class: 'choice dev-back', 'data-fk': 'ch:back', title: 'dev: step back one choice or beat (the log keeps a dev line)', onclick: () => this.stepBack(), text: `\u25C2 ${this.str('ui.back')} (dev)` }));
      }
      if (this.debug) {
        choices.append(h('button', { class: 'choice dev-back dev-edit-open', 'data-fk': 'ch:edit', title: 'dev: edit this line and its choice texts in place (saved to the override set)', onclick: () => this.startEdit(), text: `\u270E ${this.str('ui.dev.edit')} (dev)` }));
      }
      const cv = this.s.convo;
      const bts = this.beatsOf(p.row.line, p.beat);
      status = `rule ${p.row.id} · ${p.npc} · p${p.row.priority} s${p.row.specificity} · turn ${cv?.turns ?? 1}${cv?.stayPaid ? ' (stay paid)' : ''}${bts.beats.length > 1 ? ` · beat ${bts.at + 1}/${bts.beats.length}` : ''}${p.tie.length ? ` · TIE with ${p.tie.join(',')}` : ''}`;
    } else if (p.kind === 'event') {
      if (via) body.append(h('h3', { class: 'text-title via', text: via }));
      const bt = this.beatsOf(p.ev.text, p.beat);
      body.append(...this.speech(bt.cur.text));
      if (!bt.last) {
        choices.append(h('button', { class: 'choice next', 'data-fk': 'ch:next', 'aria-label': this.str('ui.next'), title: this.str('ui.next'), onclick: () => this.nextBeat() }, h('span', { class: 'tri', 'aria-hidden': 'true', text: '\u25BE' })));
      } else {
        this.choiceOrder(p.ev.id, p.ev.choices.length).forEach((i, pos) => {
          const ch = p.ev.choices[i];
          choices.append(this.choiceBtn(i, this.t(ch.text), this.choiceCost(ch.effect), () => this.chooseEvent(p.ev, i, pos + 1)));
        });
        if (!p.ev.choices.length) {
          choices.append(h('button', { class: 'choice', 'data-fk': 'ch:cont', onclick: () => this.chooseEvent(p.ev, null), text: this.str('ui.continue') }));
        }
      }
      status = `event ${p.ev.id} · ${p.ev.trigger}${p.ev.npc ? ` · ${p.ev.npc}` : ''}${p.ev.portrait ? ` · cast ${p.ev.portrait}` : ''}${p.ev.medium ? ` · medium ${p.ev.medium}` : ''}`;
    } else if (p.kind === 'townhall') {
      status = this.renderTownhall(portrait, body, choices);
    } else if (p.kind === 'bed') {
      body.append(h('p', { class: 'line', text: this.str('ui.bed.prompt', { actions: this.costWords(this.s.actions) }) }));
      const pick = (n: 1 | 2 | 3) => {
        appendLog(this.s, { type: 'hotspot', target: p.hs, choice: n });
        this.panel = { kind: 'idle' };
        if (n === 1) return this.moveTo('work');
        if (n === 2) return this.bedtimeCall();
        this.render();
      };
      choices.append(
        h('button', { class: 'choice', 'data-fk': 'ch:0', onclick: () => pick(1), text: this.str('ui.bed.work') }),
        h('button', { class: 'choice', 'data-fk': 'ch:1', onclick: () => pick(2), text: this.str('ui.bed.sleep') }),
        h('button', { class: 'choice', 'data-fk': 'ch:2', onclick: () => pick(3), text: this.str('ui.bed.stay') }));
    } else if (p.kind === 'text') {
      if (p.title) body.append(h('h3', { class: 'text-title', text: p.title }));
      let first = true;
      for (const para of this.t(p.text).split(/\n\n+/)) {
        const bold = /^\*\*(.+)\*\*$/.exec(para.trim());
        if (bold && first && p.figure) {
          // print news with a cast figure: their bust beside the headline
          const ci = this.castImage(p.figure, 'bust');
          body.append(h('div', { class: 'news-head' },
            h('figure', { class: 'news-bust' }, this.bustImg(ci.url, ci.name), ci.placeholder ? this.pendingTag() : null,
              h('figcaption', { text: ci.role ? `${ci.name}, ${ci.role}` : ci.name })),
            h('p', { class: 'headline', text: bold[1] })));
        } else body.append(bold ? h('p', { class: 'headline', text: bold[1] }) : h('p', { class: 'line', text: para }));
        first = false;
      }
      choices.append(h('button', { class: 'choice', 'data-fk': 'ch:cont', onclick: () => { this.panel = { kind: 'idle' }; this.render(); }, text: this.str('ui.close') }));
      status = p.rule ? `story ${p.rule}${p.figure ? ` · cast ${p.figure}` : ''}` : '';
    } else {
      if (p.note) body.append(h('p', { class: 'note', text: p.note }));
      else if (this.s.actions <= 0) body.append(h('p', { class: 'note', text: this.str('ui.noActions') }));
      if (this.ringing()) body.append(h('p', { class: 'note ringing-note', text: this.str('ui.ringing') }));
      status = `lean ${leanOf(this.s.spent)} · ${dayPhaseOf(this.s.day)}`;
    }

    this.right.replaceChildren(portrait, desc, body, choices, this.debug ? h('div', { class: 'status', text: status }) : '');
  }

  /** `unaffordable`: the option costs more than the actions left; disabled, with the no-actions wording. */
  private choiceBtn(i: number, text: string, cost: number, onclick: () => void, unaffordable = false): HTMLElement {
    const words = cost ? `${this.costWords(cost)}${unaffordable ? `, ${this.str('ui.noActionsShort')}` : ''}` : '';
    return h('button', {
      class: 'choice', 'data-fk': `ch:${i}`, onclick, disabled: unaffordable,
      'aria-label': cost ? `${text} (${words})` : null, title: cost ? words : null,
    }, text, this.costDots(cost));
  }

  private talkSummary(t?: { n: number; turns: number; ms: number }): string {
    if (!t) return '0 conversations';
    const min = t.ms / 60000;
    const minTxt = min < 0.1 ? '<0.1' : min < 10 ? min.toFixed(1) : String(Math.round(min));
    return `${t.n} conversation${t.n === 1 ? '' : 's'} · ${t.turns} turn${t.turns === 1 ? '' : 's'} · ${minTxt} min`;
  }

  /** Out of actions and the day not over: the end-of-day call is waiting to be answered. */
  private ringing(): boolean {
    return (this.s.actions <= 0 || this.bedtime) && !this.s.finished && !this.win && !this.townhallActive();
  }

  /** "Go to bed anyway": the phone rings for a moment (so the call reads as a call) before the evening check-in opens. */
  private bedtime = false;
  private bedtimeCall(): void {
    if (this.bedtime) return;
    this.bedtime = true;
    this.render();
    setTimeout(() => { this.bedtime = false; this.endDay(); }, 1400);
  }

  private renderPhone(): void {
    const el = this.phoneEl;
    el.hidden = !this.phoneOpen;
    if (!this.phoneOpen) return;
    if (this.s.player.profilePending) return this.renderProfile();
    const callOk = this.s.actions <= 0;
    const tabs: [typeof this.phoneTab, string, boolean][] = [
      ['journal', this.str('ui.phone.journal'), true],
      ['contacts', this.str('ui.phone.contacts'), true],
      ['wallet', this.str('ui.phone.wallet'), true],
      ['call', this.str('ui.phone.call'), callOk],
    ];
    if (this.phoneTab === 'call' && !callOk) this.phoneTab = 'journal';
    const tabBar = h('div', { class: 'ph-tabs', role: 'tablist' });
    for (const [id, label, enabled] of tabs) {
      tabBar.append(h('button', {
        class: `ph-tab${this.phoneTab === id ? ' on' : ''}`, role: 'tab', 'aria-selected': String(this.phoneTab === id),
        'data-fk': `ph:${id}`, disabled: !enabled, title: enabled ? label : this.str('ui.phone.callLocked'),
        onclick: () => { this.phoneTab = id; this.renderPhone(); },
      }, label));
    }
    const pane = h('div', { class: 'ph-pane', role: 'tabpanel' });
    if (this.phoneTab === 'journal') {
      const ta = h('textarea', { class: 'ph-journal', 'aria-label': this.str('ui.phone.journal'), placeholder: this.str('ui.phone.journalHint') });
      ta.value = this.journalDraft ?? this.s.journal;
      ta.addEventListener('input', () => { this.journalDraft = ta.value; });
      const msg = h('span', { class: 'ph-msg', 'aria-live': 'polite' });
      pane.append(h('p', { class: 'ph-hint', text: this.str('ui.phone.journalHint') }), ta,
        h('div', { class: 'ph-row' },
          h('button', { class: 'btn', onclick: () => {
            this.s.journal = ta.value;
            this.journalDraft = null;
            appendLog(this.s, { type: 'journal', text: ta.value });
            this.save();
            msg.textContent = this.str('ui.phone.saved');
          }, text: this.str('ui.phone.save') }), msg));
    } else if (this.phoneTab === 'contacts') {
      const met = this.c.npcs.filter((n) => this.s.npcs[n.id]?.met === 'yes');
      if (!met.length) pane.append(h('p', { class: 'ph-hint', text: this.str('ui.phone.noContacts') }));
      const ul = h('ul', { class: 'ph-contacts' });
      const totals = this.convoTotals();
      for (const n of met) {
        const ns = this.s.npcs[n.id];
        const pi = this.portraitFor(n, 'neutral');
        ul.append(h('li', {},
          h('img', { src: pi.url, alt: '' }),
          h('div', {},
            h('div', { class: 'ct-name', text: n.name }),
            this.debug ? h('div', { class: 'ct-meta ct-debug', text: `${'●'.repeat(ns.rapport)}${'○'.repeat(3 - ns.rapport)} · last talk: ${ns.lastValence}` }) : null,
            h('div', { class: 'ct-meta ct-talk', text: this.talkSummary(totals.get(n.id)) }))));
      }
      pane.append(ul);
    } else if (this.phoneTab === 'wallet') {
      pane.append(h('p', { class: 'ph-balance' }, `${this.str('ui.phone.balance')}: `, h('strong', { text: `$${this.s.wallet}` })));
      const ul = h('ul', { class: 'ph-ledger' });
      for (const e of [...this.s.walletLog].reverse()) ul.append(h('li', { text: `Day ${e.day} · ${e.amount >= 0 ? '+' : ''}$${e.amount} · ${e.why}` }));
      pane.append(ul);
    } else {
      pane.append(h('p', { class: 'ph-hint', text: this.str('ui.phone.callIncoming') }),
        h('button', { class: 'btn', 'data-fk': 'ph:callhome', onclick: () => this.endDay(), text: this.str('ui.phone.callHome') }));
    }
    el.replaceChildren(phoneStatus(),
      h('div', { class: 'ph-head' },
        h('span', { text: this.str('ui.phone') }),
        h('button', { class: 'ph-close', 'aria-label': this.str('ui.close'), onclick: () => { this.phoneOpen = false; this.renderPhone(); this.renderStrip(); }, text: '×' })),
      tabBar, pane);
  }

  // ------------------------------------------------------------------ opening questions (SPEC "Profile questions and variant words")
  /** The phone, open on the profile questions and nothing else: heritage first, then that pack's follow-ups. */
  private renderProfile(): void {
    const el = this.phoneEl;
    const prof = this.c.profile;
    const draft = this.profileDraft;
    const pane = h('div', { class: 'ph-pane ph-profile', role: 'group', 'aria-label': this.str('ui.profile.title') });
    const ask = (q: { id: string; question: string; options: { id: string; label: string }[] }) => {
      const fs = h('fieldset', { class: 'ph-q' }, h('legend', { text: q.question }));
      for (const o of q.options) {
        const input = h('input', { type: 'radio', name: `prof-${q.id}`, value: o.id, 'data-fk': `prof:${q.id}:${o.id}` }) as HTMLInputElement;
        input.checked = draft[q.id] === o.id;
        input.addEventListener('change', () => { draft[q.id] = o.id; if (q.id === 'heritage') for (const k of Object.keys(draft)) if (k !== 'heritage') delete draft[k]; this.renderPhone(); });
        fs.append(h('label', { class: 'ph-opt' }, input, ` ${o.label}`));
      }
      return fs;
    };
    pane.append(h('p', { class: 'ph-hint', text: this.str('ui.profile.intro') }), ask(prof.heritage));
    const heritage = draft.heritage;
    const followups = heritage ? prof.followups[heritage as CultureId] ?? [] : [];
    for (const q of followups) pane.append(ask(q));
    const ready = !!heritage && followups.every((q) => !!draft[q.id]);
    const note = h('p', { class: 'ph-hint ph-profile-note', text: ready ? '' : this.str('ui.profile.pick') });
    pane.append(note, h('div', { class: 'ph-row' },
      h('button', { class: 'btn', 'data-fk': 'prof:begin', disabled: !ready, onclick: () => this.completeProfile(), text: this.str('ui.profile.begin') })));
    el.replaceChildren(phoneStatus(), h('div', { class: 'ph-head' }, h('span', { text: this.str('ui.profile.title') })), pane);
  }

  /** The answers become the player's pack and variant; logged as `profile`; then the first day begins. */
  private completeProfile(): void {
    const prof = this.c.profile, draft = this.profileDraft, p = this.s.player;
    const heritage = draft.heritage;
    if (!heritage) return;
    const followups = prof.followups[heritage as CultureId] ?? [];
    if (!followups.every((q) => !!draft[q.id])) return;
    const variant: Record<string, string> = {};
    for (const q of followups) {
      const o = q.options.find((x) => x.id === draft[q.id]);
      if (o && !o.skip) variant[q.id] = o.id;
    }
    p.heritage = heritage;
    p.homeCulture = (['cn', 'mx', 'in'].includes(heritage) ? heritage : 'cn') as CultureId;
    p.pack = effectivePack(this.c, p.homeCulture);
    p.variant = variant;
    p.profilePending = false;
    this.profileDraft = {};
    appendLog(this.s, { type: 'profile', heritage, homeCulture: p.homeCulture, pack: p.pack, variant });
    this.phoneOpen = false;
    this.phoneTab = 'journal';
    if (heritage === 'other') this.panel = { kind: 'idle', note: this.str('ui.profile.otherCulture') };
    this.save();
    this.start();
  }

  private renderEnd(): void {
    const met = this.c.npcs.filter((n) => this.s.npcs[n.id]?.met === 'yes').map((n) => n.name);
    const overlay = h('div', { class: 'end-overlay', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'end-card' },
        h('h1', { text: this.str('ui.end.title') }),
        h('p', { text: this.str('ui.end.body') }),
        h('p', { class: 'end-sum', text: `People met: ${met.join(', ') || 'none'} · Wallet: $${this.s.wallet} · Lean: ${leanOf(this.s.spent)}` }),
        h('button', { class: 'btn', id: 'export', onclick: () => downloadText(`greatvote_${this.s.room}.jsonl`, readLog(this.s.room)), text: this.str('ui.end.export') })));
    this.stage.append(overlay);
    overlay.querySelector<HTMLButtonElement>('#export')?.focus();
  }

  // ------------------------------------------------------------------ SPEC "Leads" and "Town hall" (added 2026-10-19)
  /** The room's first-among-equals on each side (default pro). */
  private leads(): { usLead: LeadPos; homeLead: LeadPos } {
    return { usLead: this.s.config.usLead ?? 'pro', homeLead: this.s.config.homeLead ?? 'pro' };
  }

  /** The NPC who leads a side in this room (undefined when the content has no such leader). */
  private leadOf(side: 'us' | 'home'): Npc | undefined {
    const { usLead, homeLead } = this.leads();
    return leadNpc(this.c, this.s.player.pack, side, side === 'us' ? usLead : homeLead);
  }

  /** Event rows in roll order: forced rows (chance 1) first, then the rest in file order, so a forced overheard line is never skipped behind a random one. */
  private eventOrder(): EventRow[] {
    return [...this.c.events].sort((a, b) => (b.chance >= 1 ? 1 : 0) - (a.chance >= 1 ? 1 : 0));
  }

  private townhallActive(): boolean {
    const th = this.s.townhall;
    return !!th && th.stage !== 'done';
  }

  /** The leader at the podium: the current speaker during introduce/speech/rate, the reacting lead during reactions. */
  private townhallSpeaker(): Npc | undefined {
    const th = this.s.townhall;
    if (!th || th.stage === 'done') return undefined;
    const id = ['introduce', 'speech', 'rate'].includes(th.stage) ? th.order[th.speaker] : th.stage === 'reaction' ? th.order[th.reaction] : undefined;
    return id ? this.c.npcById.get(id) : undefined;
  }

  /** The leader whose words are on the right panel, with the bust for the beat shown (speech and reaction stages only). */
  private townhallSpoken(): { npc: Npc; emotion: Emotion } | undefined {
    const th = this.s.townhall;
    if (!th || !['speech', 'rate', 'reaction'].includes(th.stage)) return undefined;
    const npc = this.townhallSpeaker();
    if (!npc) return undefined;
    const row = th.stage === 'reaction' ? this.thReaction(npc.id) : this.thSpeech(npc.id, th.block);
    if (!row) return { npc, emotion: 'neutral' };
    const emotion = th.stage === 'rate' ? this.beatsOf(row.text, 1e9).cur.emotion ?? row.emotion : this.beatsOf(row.text, th.beat).cur.emotion ?? row.emotion;
    return { npc, emotion };
  }

  private thRows(npcId: string): TownhallRow[] {
    return this.c.townhall.rows.get(npcId) ?? [];
  }

  /** Speech block `block` of a lead for this room's president: a row naming the president beats a blank one. */
  private thSpeech(npcId: string, block: number): TownhallRow | null {
    const L = this.s.config.nationalLeader;
    const rows = this.thRows(npcId).filter((r) => r.kind === 'speech' && r.block === block && (!r.nationalLeader || r.nationalLeader === L));
    rows.sort((a, b) => (b.nationalLeader ? 1 : 0) - (a.nationalLeader ? 1 : 0));
    return rows[0] ?? null;
  }

  /** How many speech blocks a lead has under this president (at least 1: a lead with no sheet still "speaks", as a stand-in line). */
  private thBlocks(npcId: string): number {
    let n = 0;
    while (n < 4 && this.thSpeech(npcId, n + 1)) n++;
    return Math.max(1, n);
  }

  /** The lead's reaction to the player's dominant stance: a row for that stance (president-specific first), else the fallback. */
  private thReaction(npcId: string): TownhallRow | null {
    const L = this.s.config.nationalLeader;
    const { dominant } = this.thTally();
    const rows = this.thRows(npcId).filter((r) => r.kind === 'reaction' && (!r.nationalLeader || r.nationalLeader === L));
    const score = (r: TownhallRow) => (r.stance === dominant ? 2 : r.stance === '' ? 0 : -9) + (r.nationalLeader ? 1 : 0);
    rows.sort((a, b) => score(b) - score(a));
    return rows.length && score(rows[0]) >= 0 ? rows[0] : null;
  }

  /** Stances chosen on the topic board: counts and the dominant one (`mixed` when the top two tie). */
  private thTally(): { counts: Record<TopicStance, number>; dominant: TopicStance | 'mixed' } {
    const counts = Object.fromEntries(TOPIC_STANCES.map((s) => [s, 0])) as Record<TopicStance, number>;
    for (const a of Object.values(this.s.townhall?.answers ?? {})) counts[a.stance]++;
    const sorted = [...TOPIC_STANCES].sort((a, b) => counts[b] - counts[a]);
    const dominant = counts[sorted[0]] > 0 && counts[sorted[0]] > counts[sorted[1]] ? sorted[0] : 'mixed';
    return { counts, dominant };
  }

  /** Bed on the last day: the town hall opens instead of the survey (SPEC "Town hall"). */
  private startTownhall(): void {
    this.endConvo('day_end');
    this.phoneOpen = false;
    const us = this.leadOf('us'), home = this.leadOf('home');
    const order = [us?.id, home?.id].filter((x): x is string => !!x);
    if (seeded(this.s.config.seed, 'townhall', this.s.room)() < 0.5) order.reverse();
    this.s.townhall = { stage: 'intro', order, speaker: 0, block: 1, beat: 0, ratings: [], answers: {}, reaction: 0 };
    const sc = this.c.scenes.find((x) => x.hidden);
    if (sc) this.s.scene = sc.id;
    this.panel = { kind: 'townhall' };
    appendLog(this.s, { type: 'townhall', op: 'start', order, ...this.leads(), president: this.s.config.nationalLeader });
    this.save();
    this.render();
  }

  private thSet(patch: Partial<TownhallState>): void {
    this.s.townhall = { ...this.s.townhall!, beat: 0, ...patch };
    this.save();
    this.render();
  }

  /** Continue at the end of a town hall text: the next step of the sequence. */
  private thAdvance(): void {
    const th = this.s.townhall!;
    switch (th.stage) {
      case 'intro': return this.thSet({ stage: th.order.length ? 'introduce' : 'callUp', speaker: 0, block: 1 });
      case 'introduce': return this.thSet({ stage: 'speech', block: 1 });
      case 'speech': return this.thSet({ stage: 'rate' });
      case 'callUp': return this.thSet({ stage: 'board' });
      case 'reaction': {
        const next = th.reaction + 1;
        return next < th.order.length ? this.thSet({ stage: 'reaction', reaction: next }) : this.thSet({ stage: 'close' });
      }
      case 'close': {
        appendLog(this.s, { type: 'townhall', op: 'end', ratings: th.ratings, answers: th.answers, ...this.thTally() });
        this.s.townhall = { ...th, stage: 'done' };
        this.panel = { kind: 'idle' };
        // back home before the call: a player who closes the survey must not be left in a room with no exits
        this.s.scene = 'home';
        this.save();
        return this.endDay();
      }
      default: return;
    }
  }

  /** The 1..7 rating of the speech block just heard (1 boo .. 7 cheer); then the next block, the next speaker, or the floor. */
  private thRate(value: number): void {
    const th = this.s.townhall!;
    if (th.stage !== 'rate') return;
    const speaker = th.order[th.speaker];
    th.ratings.push({ speaker, block: th.block, value });
    appendLog(this.s, { type: 'townhall', op: 'rating', target: speaker, block: th.block, value });
    if (th.block < this.thBlocks(speaker)) return this.thSet({ stage: 'speech', block: th.block + 1 });
    const next = th.speaker + 1;
    if (next < th.order.length) return this.thSet({ stage: 'introduce', speaker: next, block: 1 });
    this.thSet({ stage: 'callUp' });
  }

  private thAnswer(topicId: string, option: number): void {
    const th = this.s.townhall!;
    const topic = this.c.townhall.topics.find((t) => t.id === topicId);
    const opt = topic?.options[option];
    if (!topic || !opt) return;
    th.answers[topicId] = { option, stance: opt.stance };
    appendLog(this.s, { type: 'townhall', op: 'answer', target: topicId, choice: option + 1, stance: opt.stance, text: opt.text });
    this.thSet({ stage: 'board', topic: undefined });
  }

  private thSit(): void {
    const th = this.s.townhall!;
    if (this.c.townhall.topics.some((t) => !th.answers[t.id])) return;
    appendLog(this.s, { type: 'townhall', op: 'summary', ...this.thTally(), answers: th.answers });
    this.thSet({ stage: th.order.length ? 'reaction' : 'close', reaction: 0 });
  }

  /** The right panel during the town hall. Returns the dev status line. */
  private renderTownhall(portrait: HTMLElement, body: HTMLElement, choices: HTMLElement): string {
    const th = this.s.townhall!;
    const md = this.c.townhall.moderator;
    const speaker = this.townhallSpeaker();
    const moderatorSays = (text: string, vars: Record<string, string> = {}) => {
      portrait.classList.add('moderator');
      portrait.append(h('span', { class: 'who', text: md.name }));
      const filled = text.replace(/\{(speaker)\}/g, (m, k) => (k in vars ? vars[k] : m));
      this.thBeats(filled, body, choices);
    };
    const cont = (fk: string, label = this.str('ui.continue')) => h('button', { class: 'choice', 'data-fk': fk, onclick: () => this.thAdvance(), text: label });
    switch (th.stage) {
      case 'intro': moderatorSays(md.open); break;
      case 'introduce': moderatorSays(md.introduce, { speaker: speaker?.name ?? '' }); break;
      case 'speech': {
        const row = speaker ? this.thSpeech(speaker.id, th.block) : null;
        this.thBeats(row?.text ?? this.str('ui.townhall.noLines', { name: speaker?.name ?? '' }), body, choices);
        break;
      }
      case 'rate': {
        body.append(h('p', { class: 'line direction', text: this.str('ui.townhall.rate') }));
        const scale = h('div', { class: 'scale7', role: 'group', 'aria-label': this.str('ui.townhall.rate') });
        for (let v = 1; v <= 7; v++) {
          const end = v === 1 ? this.str('ui.townhall.boo') : v === 7 ? this.str('ui.townhall.cheer') : '';
          scale.append(h('button', { class: 'choice rate', 'data-fk': `th:rate:${v}`, 'aria-label': `${v} of 7${end ? `, ${end}` : ''}`, onclick: () => this.thRate(v), text: String(v) }));
        }
        choices.append(scale, h('div', { class: 'scale7-ends', 'aria-hidden': 'true' }, h('span', { text: this.str('ui.townhall.boo') }), h('span', { text: this.str('ui.townhall.cheer') })));
        break;
      }
      case 'callUp': moderatorSays(md.callUp); break;
      case 'board': {
        portrait.classList.add('moderator');
        portrait.append(h('span', { class: 'who', text: md.name }));
        body.append(h('p', { class: 'line', text: this.str('ui.townhall.board') }));
        const topics = this.c.townhall.topics;
        topics.forEach((t, i) => {
          const done = !!th.answers[t.id];
          choices.append(h('button', { class: `choice topic${done ? ' done' : ''}`, 'data-fk': `th:topic:${t.id}`, onclick: () => this.thSet({ stage: 'topic', topic: t.id }), 'aria-label': `${t.title}${done ? ` (${this.str('ui.townhall.answered')})` : ''}` },
            h('span', { class: 'topic-mark', 'aria-hidden': 'true', text: done ? '✓' : String(i + 1) }), t.title));
        });
        const left = topics.filter((t) => !th.answers[t.id]).length;
        choices.append(h('button', { class: 'choice sit', 'data-fk': 'th:sit', disabled: left > 0, title: left ? this.str('ui.townhall.sitLocked', { n: left }) : null, onclick: () => this.thSit(), text: this.str('ui.townhall.sit') }));
        break;
      }
      case 'topic': {
        const t = this.c.townhall.topics.find((x) => x.id === th.topic);
        if (!t) { this.thSet({ stage: 'board', topic: undefined }); return 'townhall'; }
        portrait.classList.add('moderator');
        portrait.append(h('span', { class: 'who', text: md.name }));
        body.append(h('h3', { class: 'text-title', text: t.title }), ...this.speech(t.prompt));
        const cur = th.answers[t.id];
        t.options.forEach((o, i) => choices.append(h('button', { class: `choice${cur?.option === i ? ' picked' : ''}`, 'data-fk': `th:opt:${i}`, 'aria-pressed': cur ? String(cur.option === i) : null, onclick: () => this.thAnswer(t.id, i), text: this.t(o.text) })));
        choices.append(h('button', { class: 'choice dev-back', 'data-fk': 'th:back', onclick: () => this.thSet({ stage: 'board', topic: undefined }), text: `◂ ${this.str('ui.townhall.back')}` }));
        break;
      }
      case 'reaction': {
        const row = speaker ? this.thReaction(speaker.id) : null;
        this.thBeats(row?.text ?? this.str('ui.townhall.noLines', { name: speaker?.name ?? '' }), body, choices);
        break;
      }
      case 'close': moderatorSays(md.close); break;
      default: choices.append(cont('th:cont'));
    }
    return `townhall ${th.stage} · speaker ${th.order[th.speaker] ?? '-'} · block ${th.block}${th.stage === 'reaction' ? ` · reacting ${th.order[th.reaction]}` : ''} · ${this.thTally().dominant}`;
  }

  /** A town hall text as beats: the triangle between beats, Continue after the last one. */
  private thBeats(text: string, body: HTMLElement, choices: HTMLElement): void {
    const th = this.s.townhall!;
    const bt = this.beatsOf(text, th.beat);
    body.append(...this.speech(bt.cur.text));
    if (!bt.last) {
      choices.append(h('button', { class: 'choice next', 'data-fk': 'ch:next', 'aria-label': this.str('ui.next'), title: this.str('ui.next'), onclick: () => this.thSet({ beat: bt.at + 1 }), }, h('span', { class: 'tri', 'aria-hidden': 'true', text: '▾' })));
    } else {
      choices.append(h('button', { class: 'choice', 'data-fk': 'th:cont', onclick: () => this.thAdvance(), text: this.str('ui.continue') }));
    }
  }

  // ------------------------------------------------------------------ dev
  devApi() {
    return {
      game: this,
      state: this.s,
      content: this.c,
      set: (npc: string, field: 'met' | 'rapport' | 'lastValence', value: any) => {
        const ns = this.s.npcs[npc];
        if (!ns) return `no npc ${npc}`;
        (ns as any)[field] = value;
        this.save();
        this.render();
        return ns;
      },
      actions: (n: number) => { this.s.actions = n; this.save(); this.render(); },
      lean: (home: number, us: number) => { this.s.spent.home = home; this.s.spent.us = us; this.save(); this.render(); return leanOf(this.s.spent); },
      goto: (scene: string) => this.moveTo(scene, { force: true }),
      /** Starts a conversation; `{ force: true }` ignores the per-day conversation limit (dev only). */
      talk: (npc: string, opts: { force?: boolean } = {}) => this.talkTo(npc, opts),
      /** Conversations per NPC today and the limit. */
      talks: () => ({ limit: this.maxTalks, day: this.s.day, counts: { ...(this.s.talks?.day === this.s.day ? this.s.talks.counts : {}) } }),
      /**
       * Dev only: TV screen quads for a scene, in memory (never saved). gv.screens('home', [[x,y],[x,y],[x,y],[x,y]])
       * sets one screen (fractions of the background: top-left, top-right, bottom-right, bottom-left); gv.screens('home', null) clears.
       */
      /**
       * Dev only: a prop's projection quad, in memory (never saved). gv.propQuad('park', 'prop_chessboard', [[x,y],[x,y],[x,y],[x,y]])
       * (fractions of the background: top-left, top-right, bottom-right, bottom-left of the prop image); `null` draws it flat
       * at x/y/w; with no quad argument the dev override is dropped. Returns the quad now in use.
       */
      propQuad: (scene: string, asset: string, quad?: [number, number][] | null) => {
        const sc = this.c.sceneById.get(scene) ?? this.scene;
        const map = this.devPropQuads.get(sc.id) ?? new Map<string, [number, number][] | null>();
        if (quad === undefined) map.delete(asset); else map.set(asset, quad);
        this.devPropQuads.set(sc.id, map);
        this.render();
        const p = sc.props.find((x) => x.asset === asset);
        return p ? this.propQuad(sc, p) : `no prop ${asset} in scene ${sc.id}`;
      },
      screens: (scene?: string, quad?: [number, number][] | null) => {
        const id = scene ?? this.s.scene;
        if (quad === null) this.devScreens.delete(id);
        else if (quad) this.devScreens.set(id, [{ id: 'dev', quad }]);
        this.render();
        return this.screensFor(this.c.sceneById.get(id) ?? this.scene);
      },
      present: (scene?: string) => this.presentIn(scene ?? this.s.scene).map((p) => `${p.npc.id}@${p.slot ? p.slot.id : 'painted'}`),
      panel: () => this.panel,
      /** Puts an NPC on a slot of the current scene (dev, for checking figure sizes); gv.place() clears. In memory only: never saved. */
      place: (npc?: string, slot?: string) => {
        if (!npc) this.devPlaced.clear();
        else this.devPlaced.set(this.s.scene, [...(this.devPlaced.get(this.s.scene) ?? []), { npc, slot: slot ?? 'near' }]);
        this.render();
        return this.presentIn(this.s.scene).map((p) => `${p.npc.id}@${p.slot ? p.slot.id : 'painted'}`);
      },
      reveal: (on = true) => { this.sceneBox.classList.toggle('reveal', on); },
      /** What the researcher override changed for this load (text keys, image keys, rejections). */
      override: () => {
        const o = this.c.override;
        console.info(`[override] ${o.ignored ? 'IGNORED (&nooverride=1)' : o.applied.length || o.images.length ? 'active' : 'none'}`
          + `\n  text: ${o.applied.join(', ') || '-'}\n  images: ${o.images.join(', ') || '-'}`
          + `\n  rejected: ${o.rejected.map((r) => `${r.key} (${r.problems.length} problem(s))`).join(', ') || '-'}${o.updated ? `\n  saved ${o.updated}` : ''}`);
        return o;
      },
      /** Choice display order for a row/event id today (authored indices, 0-based). */
      order: (id: string, n = 3) => this.choiceOrder(id, n),
      /**
       * Starting a conversation is always free (0). With a conversation on screen, also the charge of each option
       * (authored order) under SPEC "Pay when you stay".
       */
      cost: () => {
        const p = this.panel;
        if (p.kind !== 'dialogue') return 0;
        return { start: 0, turn: this.s.convo?.turns ?? 1, stayPaid: !!this.s.convo?.stayPaid, options: p.row.choices.map((_, i) => this.optionCharge(p.row, i).charge) };
      },
      endDay: () => this.endDay(),
      /** SPEC "Town hall": the state of the closing sequence, or start it now (dev) */
      townhall: () => this.s.townhall,
      startTownhall: () => this.startTownhall(),
      leads: () => ({ ...this.leads(), us: this.leadOf('us')?.id, home: this.leadOf('home')?.id }),
    };
  }
}

/** GET a questionnaire with a 2 s timeout; null on any failure (network, status, non-JSON, schema). */
async function fetchQuestionnaire(url: string): Promise<Questionnaire | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 2000);
  try {
    const res = await fetch(appUrl(url), { signal: ac.signal, cache: 'no-cache', headers: { accept: 'application/json' } });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const q = await res.json();
    return questionnaireProblems(q).length ? null : (q as Questionnaire);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
