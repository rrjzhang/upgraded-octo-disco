/** The game runtime: state transitions + plain-DOM rendering of the 1440x900 stage. */
import type {
  Content, DialogueRow, Questionnaire, Emotion, EventRow, GameState, Hotspot, ModuleId, NewsRow, Npc, Scene, Screen, Slot,
} from './types';
import {
  DAY_ACTIONS, DEFAULT_TALKS_PER_DAY, DEMO_DAYS, DIALOGUE_COST, FREE_DEPTH, applyEffects, dayPhaseOf, eventMatches, leanOf, phaseOf, rowDepth, selectRow,
  type Delta,
} from './rules';
import { appendLog, debugEnabled, getRoom, readLog, saveState } from './store';
import { assetEntry, figureHeight, isSeatedFigure, overrideIds, questionnaireProblems } from './content';
import { SILHOUETTE_BUST, appUrl, downloadText, h, isDev, params, seeded, silhouetteFigure, subst } from './util';
import { matrix3d } from './homography';

const CULTURE_NAMES: Record<string, string> = { cn: 'Chinese', mx: 'Mexican', in: 'Indian' };
const CULTURE_PACK_NAMES: Record<string, string> = { cn: 'China', mx: 'Mexico', in: 'India' };
const IMG_W = 900;
const IMG_H = 600;

type Panel =
  | { kind: 'idle'; note?: string }
  | { kind: 'dialogue'; npc: string; row: DialogueRow; tie: string[] }
  | { kind: 'event'; ev: EventRow }
  | { kind: 'text'; title?: string; text: string; rule?: string; figure?: string }
  | { kind: 'bed'; hs: string }; // going to bed with actions left: confirm first

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
  private phoneTab: 'journal' | 'contacts' | 'wallet' | 'call' = 'journal';
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
  /** rowDepth caches per NPC sheet */
  private depthCache = new Map<string, Map<string, number>>();
  /** image URLs already loaded and decoded (a revisit swaps at once) */
  private loaded = new Set<string>();
  /** a scene swap is waiting for its images (the scene key it waits for): input is held, the old scene stays on screen */
  private swapping: string | null = null;
  /** the scene id currently drawn in the scene box (a change of scene preloads and cross-fades) */
  private shownScene: string | null = null;
  /** dev only: screen quads set with gv.screens(), per scene, in memory */
  private devScreens = new Map<string, Screen[]>();

  constructor(host: HTMLElement, private c: Content, private s: GameState) {
    this.stage = h('div', { class: 'stage', id: 'stage' });
    host.replaceChildren(this.stage);
    this.buildShell();
    window.addEventListener('resize', () => this.fit());
    window.addEventListener('message', (e) => this.onMessage(e));
    document.addEventListener('keydown', (e) => this.onKey(e));
    // stamp the open conversation when the page goes away, so a reload closes it with its real duration
    window.addEventListener('pagehide', () => { if (this.s.convo) { this.s.convo.last = Date.now(); this.save(); } });
    this.fit();
  }

  // ------------------------------------------------------------------ lifecycle
  start(): void {
    if (this.s.finished) {
      this.render();
      this.renderEnd();
      return;
    }
    // a conversation open when the page went away (reload, closed tab) is closed as "left", timed to its last turn
    if (this.s.convo) this.endConvo('left', this.s.convo.last);
    if (this.s.dayStartDone < this.s.day) this.beginDay();
    else {
      // an event on screen (already fired and paid for) and the ones queued behind it survive a reload
      const ev = (id?: string) => (id ? this.c.events.find((e) => e.id === id) : undefined);
      const open = ev(this.s.openEvent);
      this.queue = (this.s.queuedEvents ?? []).map((id) => ev(id)).filter((e): e is EventRow => !!e);
      if (open) this.panel = { kind: 'event', ev: open };
      if (!open && this.queue.length) this.nextQueued();
      else this.render();
    }
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
    for (const id of s.invites) {
      const ev = this.c.events.find((e) => e.id === id);
      if (ev) this.queue.push(ev);
      else console.error(`[events] invitation to unknown event "${id}"`);
    }
    s.invites = [];
    const rng = seeded(s.config.seed, 'day_start', s.day);
    const ctx = this.eventCtx('home', false);
    for (const ev of this.c.events) {
      if (ev.trigger !== 'day_start' || s.fired.includes(ev.id)) continue;
      if (!eventMatches(ev, ctx)) continue;
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
    return {
      homeCulture: CULTURE_NAMES[this.s.player.pack] ?? 'Chinese',
      playerName: this.s.player.name || 'you',
      leaderName: leader?.name ?? 'the President',
    };
  }

  private t(text: string): string {
    return subst(text, this.vars());
  }

  private tired(): boolean {
    return this.s.actions <= 0 && this.s.scene !== 'home' && this.scene.background !== 'none';
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
   * `dev` adds gv.place() placements (rendering only; event rolls pass false).
   */
  presentIn(sceneId: string, dev = true): Presence[] {
    const sc = this.c.sceneById.get(sceneId);
    if (!sc) return [];
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
    for (const cd of cands) {
      if (used.has(cd.slot.id) || out.some((p) => p.npc.id === cd.npc.id)) continue;
      used.add(cd.slot.id);
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

  private bgFor(sc: Scene): { url: string; placeholder: boolean; id: string } | null {
    if (sc.background === 'none') return null;
    const m = this.c.manifest.backgrounds;
    let id = this.paintedActive(sc) ? sc.painted!.background : sc.background;
    if (phaseOf(this.s.actions) === 'evening') {
      const eve = id.includes('_day') ? id.replace('_day', '_eve') : `${id}_eve`;
      if (this.hasBg(eve)) id = eve;
    }
    const o = this.ovImg('backgrounds', id);
    if (o) return { url: o.url, placeholder: false, id };
    const e = assetEntry(this.c.manifest, m, id);
    return e ? { url: this.c.assetUrl(e.file), placeholder: !!e.placeholder, id } : { url: '', placeholder: true, id };
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
    const d = applyEffects(this.s, npcId, effect, why);
    if (this.s.actions < before) this.s.spent[this.scene.community] += before - this.s.actions;
    return d;
  }

  moveTo(sceneId: string): void {
    if (!this.c.sceneById.has(sceneId)) {
      console.error(`[move] unknown scene "${sceneId}"`);
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
    for (const ev of this.c.events) {
      if (ev.trigger !== 'enter' || this.s.fired.includes(ev.id)) continue;
      if (!eventMatches(ev, ctx)) continue;
      if (rng() < ev.chance) {
        if (this.fireEvent(ev, false)) return;
      }
    }
  }

  /** Shows an event in the right panel. Returns false if it could not be afforded. */
  private fireEvent(ev: EventRow, rerender = true): boolean {
    if (ev.cost > this.s.actions) return false;
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

  /** Logs the open conversation (one `conversation` line) and clears it. */
  private endConvo(exit: 'ended' | 'left' | 'day_end', at = Date.now()): void {
    const cv = this.s.convo;
    if (!cv) return;
    this.s.convo = undefined;
    appendLog(this.s, {
      type: 'conversation', target: cv.npc, scene: cv.scene, turns: cv.turns, ms: Math.max(0, at - cv.started), rules: cv.rules, exit,
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

  /** depth of a row over its sheet's `next` DAG (cycle = 3), cached per sheet. */
  private depthOf(row: DialogueRow): number {
    let cache = this.depthCache.get(row.npc);
    if (!cache) this.depthCache.set(row.npc, (cache = new Map()));
    return rowDepth(this.c.dialogue.get(row.npc) ?? [], row, cache);
  }

  /**
   * What talking to `n` costs right now. The row that would open the conversation is a pure function of state, so
   * it is selected here at label time: a short conversation (depth < 3) is free, anything longer costs DIALOGUE_COST.
   */
  talkCost(n: Npc): number {
    const sel = this.pickRow(n, true);
    return sel && this.depthOf(sel.row) < FREE_DEPTH ? 0 : DIALOGUE_COST;
  }

  /** A talk needs at least one action left even when free (no conversations after the day's actions run out). */
  private canTalk(cost: number): boolean {
    return !this.tired() && this.s.actions > 0 && this.s.actions >= cost;
  }

  /**
   * Conversations allowed per NPC per day: the room's `maxTalksPerNpcPerDay` (default 1). In dev mode `&talks=N`
   * overrides it for the tab (and the DEV1 room has no value, so it stays 1).
   */
  get maxTalks(): number {
    const dev = isDev ? Number(params.get('talks')) : NaN;
    if (Number.isInteger(dev) && dev > 0) return dev;
    const v = Number(this.s.config.maxTalksPerNpcPerDay);
    return Number.isInteger(v) && v > 0 ? v : DEFAULT_TALKS_PER_DAY;
  }

  /** Conversations with `npcId` started today. */
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

  /** "Talk to Dana (1 action)" / "(free)" / "(no actions left)": the same words for aria-label and hover title. */
  private talkLabel(n: Npc, cost: number): string {
    if (this.talkedOut(n.id)) return `${n.name}: ${this.str('ui.talkedToday')}`;
    const why = this.s.actions <= 0 ? this.str('ui.noActionsShort') : cost ? this.costWords(cost) : this.str('ui.free');
    return `${this.str('ui.talkTo', { name: n.name })} (${why})`;
  }

  /** `force` (dev only, gv.talk(npc, {force:true})) ignores the per-day conversation limit. */
  talkTo(npcId: string, opts: { force?: boolean } = {}): void {
    const n = this.c.npcById.get(npcId);
    if (!n) return;
    if (this.talkedOut(n.id) && !opts.force) {
      // the figure is disabled; this covers gv.talk and anything else that calls in directly
      console.info(`[talk] ${n.id}: already talked ${this.talksToday(n.id)} time(s) today (limit ${this.maxTalks})`);
      if (!(this.panel.kind === 'dialogue' && this.panel.npc === n.id)) {
        this.panel = { kind: 'idle', note: `${n.name}: ${this.str('ui.talkedToday')}` };
        this.render();
      }
      return;
    }
    this.endConvo('left'); // talking to someone else (or the same person afresh) leaves the current conversation
    const cost = this.talkCost(n);
    if (!this.canTalk(cost)) {
      this.panel = { kind: 'idle', note: this.str(this.tired() ? 'ui.tired' : 'ui.notEnough') };
      return this.render();
    }
    const before = this.s.actions;
    this.spend(cost);
    const row = this.pickRow(n);
    if (!row) {
      this.panel = { kind: 'idle', note: `(No dialogue for ${n.name} yet.)` };
    } else {
      this.panel = { kind: 'dialogue', npc: n.id, row: row.row, tie: row.tie };
      this.countTalk(n.id);
      appendLog(this.s, { type: 'dialogue', target: n.id, rule: row.row.id, cost, talk: this.talksToday(n.id), delta: { actions: [before, this.s.actions] }, ...(opts.force ? { forced: true } : {}) });
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

  /** idx = authored index (0-based); shown = displayed position (1-based). The log keeps both. */
  private chooseDialogue(row: DialogueRow, idx: number, shown: number): void {
    const ch = row.choices[idx];
    const delta = this.effects(row.npc, ch.effect, `${row.npc}/${row.id}`);
    appendLog(this.s, { type: 'choice', target: row.npc, rule: row.id, choice: idx + 1, shown, delta, next: ch.next || undefined });
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
      this.panel = { kind: 'idle', note: `${this.c.npcById.get(row.npc)?.name ?? row.npc}: conversation ended.` };
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
    if (cost > this.s.actions) {
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
        this.panel = { kind: 'text', title: hs.label, text: a.text ?? '' };
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
        const before = this.s.actions;
        this.spend(cost);
        let content: unknown = {};
        let rule: string | undefined;
        if (mod === 'tv') {
          const tv = this.tvContent();
          content = tv;
          rule = tv.stories[0]?.id;
          if (rule) this.s.seenNews.push(rule);
          this.s.tvWatched = { day: this.s.day, phase: phaseOf(this.s.actions), story: rule };
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
      (n) => n.channel === channel && (!n.nationalLeader || n.nationalLeader === leader) && n.dayMin <= this.s.day,
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
    const stories = this.pickNews('tv').slice(0, 2).map((n, i) => {
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

  endDay(): void {
    if (this.win?.module === 'survey' || this.surveyLoading) return; // already open: re-opening would reload the frame and wipe answers
    this.endConvo('day_end');
    this.phoneOpen = false;
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
        this.closeWindow(false);
        this.finishDay();
      },
      onClose: () => {
        this.s.surveyDay = undefined;
        this.save();
      },
    });
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
        if (n > this.s.actions) return this.reply('state', { ok: false });
        const before = this.s.actions;
        this.spend(n);
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

  /** The story a room TV shows: what tvContent() would open with, or, once watched this phase, the next story. */
  private screenStory(): { id: string; image: string | null } | null {
    const tv = this.tvContent();
    if (!tv.stories.length) return null;
    const w = this.s.tvWatched;
    const watched = !!w && w.day === this.s.day && w.phase === phaseOf(this.s.actions);
    const st = watched ? tv.stories.find((x) => x.id !== w!.story) ?? tv.stories[0] : tv.stories[0];
    return { id: st.id, image: st.image ?? null };
  }

  /** A TV glass: the still laid out at 1280 x 720 and projected onto the quad (scene-box pixels) with matrix3d. */
  private screenEl(scr: Screen): HTMLElement {
    // the screen as measured on the background actually drawn (the evening render may put the TV a little elsewhere)
    const bgId = this.bgFor(this.scene)?.id;
    const q = (bgId && scr.byBackground?.[bgId]) || scr.quad;
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
        h('span', { class: 'tb-wallet', 'aria-label': this.str('ui.wallet'), text: `$${s.wallet}` }),
        h('span', { class: 'tb-room', text: `${this.str('ui.room')} ${s.room}` }),
        this.overrideChip(),
        this.c.source === 'fixtures' ? h('span', { class: 'tb-fx', text: 'FIXTURES' }) : null),
    );
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

  private flatPanel(sc: Scene, bgId: string): HTMLElement {
    return h('div', { class: 'bg-flat', role: 'img', 'aria-label': `${sc.name} (background pending)` },
      h('div', { class: 'bg-flat-name', text: sc.name }),
      h('div', { class: 'bg-flat-id', text: `${this.str('ui.pendingBg')}: ${bgId}` }));
  }

  private renderScene(): void {
    const sc = this.scene;
    const box = this.sceneBox;
    box.replaceChildren();
    box.dataset.lighting = sc.lighting ?? '';
    box.classList.toggle('evening', phaseOf(this.s.actions) === 'evening');
    box.classList.toggle('is-tired', this.tired());

    if (sc.background === 'none') {
      box.append(this.hubCard(sc));
      return;
    }
    const bg = this.bgFor(sc)!;
    if (bg.url) {
      const img = h('img', { class: 'bg', src: bg.url, alt: '', draggable: 'false' });
      img.addEventListener('error', () => img.replaceWith(this.flatPanel(sc, bg.id)));
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
      const prop = h('img', {
        class: 'prop', src: this.c.assetUrl(m.file), alt: '', draggable: 'false',
        style: `left:${p.x * IMG_W}px;top:${p.y * IMG_H}px;width:${w}px;`,
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
      const cost = talkNpc ? this.talkCost(talkNpc) : a.cost ?? (a.type === 'window' || a.type === 'news' ? 1 : 0);
      const blockedMove = a.type === 'move' && this.moveBlocked(String(a.to));
      const talked = !!talkNpc && this.talkedOut(talkNpc.id);
      const disabled = talkNpc ? talked || !this.canTalk(cost) : tired || cost > this.s.actions || blockedMove;
      const label = talkNpc ? (talked ? this.talkLabel(talkNpc, cost) : this.str('ui.talkTo', { name: talkNpc.name })) : hs.label;
      const costTxt = talkNpc ? (talked ? '' : this.talkLabel(talkNpc, cost).slice(label.length)) : cost ? ` (${this.costWords(cost)})` : blockedMove ? ` (${this.str('ui.tired')})` : '';
      const speaking = !!talkNpc && ((this.panel.kind === 'dialogue' && this.panel.npc === talkNpc.id) || (this.panel.kind === 'event' && this.panel.ev.npc === talkNpc.id));
      const b = h('button', {
        class: `hotspot${hs.placeholder ? ' ph' : ''}${talkNpc ? ' talk' : ''}${speaking ? ' speaking' : ''}${talked ? ' talked' : ''}`,
        'data-fk': `hs:${hs.id}`, 'aria-label': `${label}${costTxt}`, title: `${label}${costTxt}`,
        disabled, onclick: () => this.hotspot(hs),
        style: `left:${hs.zone.x * 100}%;top:${hs.zone.y * 100}%;width:${hs.zone.w * 100}%;height:${hs.zone.h * 100}%;`,
      },
      hs.placeholder ? h('span', { class: 'ph-mark', text: `${this.str('ui.pendingArt')} · ${hs.label}` }) : null,
      talked ? h('span', { class: 'hs-label talked-label', text: this.str('ui.talkedToday') }) : h('span', { class: 'hs-label' }, label, this.costDots(cost)));
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
      const cost = this.talkCost(npc);
      const talkLabel = this.talkLabel(npc, cost);
      // SPEC "Conversation limit": still standing there, but today's conversation has been had
      const talked = this.talkedOut(npc.id) && !speaking;
      const btn = h('button', {
        class: `figure${speaking ? ' speaking' : ''}${fig.seated ? ' seated' : ''}${cost ? '' : ' free'}${talked ? ' talked' : ''}`, 'data-fk': `npc:${npc.id}`,
        'aria-label': talkLabel, title: talkLabel, 'data-cost': cost,
        disabled: talked || !this.canTalk(cost), onclick: () => this.talkTo(npc.id),
        style: `left:${left}px;top:${top}px;width:${wid}px;height:${hgt}px;z-index:${10 + Math.round(slot.y * 100)};`,
      },
      h('span', { class: 'shadow', style: `width:${wid * (fig.seated ? 0.9 : 0.7)}px;height:${Math.max(8, hgt * 0.05)}px;` }),
      h('img', { src: fig.url, alt: '', draggable: 'false' }),
      talked
        ? h('span', { class: 'fig-label talked-label', 'aria-hidden': 'true', text: this.str('ui.talkedToday') })
        : h('span', { class: 'fig-label', 'aria-hidden': 'true' }, npc.name, this.costDots(cost)),
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
    if (this.s.player.homeCulture !== 'cn') {
      box.append(h('div', { class: 'banner', role: 'note', text: this.str('ui.packBanner', { culture: CULTURE_PACK_NAMES[this.s.player.homeCulture] }) }));
    }
  }

  private hubCard(sc: Scene): HTMLElement {
    const list = h('div', { class: 'hub-exits' });
    for (const ex of sc.exits) {
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
    for (const ex of sc.exits) {
      const blocked = this.moveBlocked(ex.to);
      const name = this.c.sceneById.get(ex.to)?.name ?? ex.to;
      exits.append(h('button', {
        class: `exit${blocked ? ' blocked' : ''}`, 'data-fk': `exit:${ex.to}`, disabled: blocked, onclick: () => this.moveTo(ex.to),
        'aria-label': `${ex.label}, go to ${name}${blocked ? ` (${this.str('ui.tired')})` : ''}`,
        title: blocked ? this.str('ui.tired') : null,
      },
        h('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }), ex.label));
    }
    // out of actions away from home: home stays one click away even when no exit here leads there
    if (this.s.actions <= 0 && sc.id !== 'home' && !sc.exits.some((ex) => ex.to === 'home')) {
      exits.append(h('button', { class: 'exit', 'data-fk': 'exit:home', onclick: () => this.moveTo('home') },
        h('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }), this.str('ui.goHome')));
    }
    this.strip.replaceChildren(
      h('button', {
        class: `phone-btn${this.ringing() ? ' ringing' : ''}`, 'data-fk': 'phone', 'aria-expanded': String(this.phoneOpen),
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
    if (p.kind === 'dialogue') { npc = this.c.npcById.get(p.npc); emotion = p.row.emotion; }
    if (p.kind === 'event' && p.ev.npc) { npc = this.c.npcById.get(p.ev.npc); emotion = p.ev.emotion; }

    const portrait = h('div', { class: 'portrait' });
    let via: string | null = null;
    if (p.kind === 'event' && p.ev.portrait) {
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

    if (p.kind === 'dialogue') {
      body.append(h('p', { class: 'line', text: this.t(p.row.line) }));
      this.choiceOrder(p.row.id, p.row.choices.length).forEach((i, pos) => {
        const ch = p.row.choices[i];
        choices.append(this.choiceBtn(i, this.t(ch.text), this.choiceCost(ch.effect), () => this.chooseDialogue(p.row, i, pos + 1)));
      });
      if (!p.row.choices.length) {
        choices.append(h('button', { class: 'choice', 'data-fk': 'ch:cont', onclick: () => { this.endConvo('ended'); this.panel = { kind: 'idle' }; this.render(); }, text: this.str('ui.continue') }));
      }
      status = `rule ${p.row.id} · ${p.npc} · p${p.row.priority} s${p.row.specificity} · depth ${this.depthOf(p.row)}${p.tie.length ? ` · TIE with ${p.tie.join(',')}` : ''}`;
    } else if (p.kind === 'event') {
      if (via) body.append(h('h3', { class: 'text-title via', text: via }));
      body.append(h('p', { class: 'line', text: this.t(p.ev.text) }));
      this.choiceOrder(p.ev.id, p.ev.choices.length).forEach((i, pos) => {
        const ch = p.ev.choices[i];
        choices.append(this.choiceBtn(i, this.t(ch.text), this.choiceCost(ch.effect), () => this.chooseEvent(p.ev, i, pos + 1)));
      });
      if (!p.ev.choices.length) {
        choices.append(h('button', { class: 'choice', 'data-fk': 'ch:cont', onclick: () => this.chooseEvent(p.ev, null), text: this.str('ui.continue') }));
      }
      status = `event ${p.ev.id} · ${p.ev.trigger}${p.ev.npc ? ` · ${p.ev.npc}` : ''}${p.ev.portrait ? ` · cast ${p.ev.portrait}` : ''}`;
    } else if (p.kind === 'bed') {
      body.append(h('p', { class: 'line', text: this.str('ui.bed.prompt', { actions: this.costWords(this.s.actions) }) }));
      const pick = (n: 1 | 2 | 3) => {
        appendLog(this.s, { type: 'hotspot', target: p.hs, choice: n });
        this.panel = { kind: 'idle' };
        if (n === 1) return this.moveTo('work');
        if (n === 2) return this.endDay();
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

  private choiceBtn(i: number, text: string, cost: number, onclick: () => void): HTMLElement {
    return h('button', {
      class: 'choice', 'data-fk': `ch:${i}`, onclick,
      'aria-label': cost ? `${text} (${this.costWords(cost)})` : null, title: cost ? this.costWords(cost) : null,
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
    return this.s.actions <= 0 && !this.s.finished && !this.win;
  }

  private renderPhone(): void {
    const el = this.phoneEl;
    el.hidden = !this.phoneOpen;
    if (!this.phoneOpen) return;
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
    el.replaceChildren(
      h('div', { class: 'ph-head' },
        h('span', { text: this.str('ui.phone') }),
        h('button', { class: 'ph-close', 'aria-label': this.str('ui.close'), onclick: () => { this.phoneOpen = false; this.renderPhone(); this.renderStrip(); }, text: '×' })),
      tabBar, pane);
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
      goto: (scene: string) => this.moveTo(scene),
      /** Starts a conversation; `{ force: true }` ignores the per-day conversation limit (dev only). */
      talk: (npc: string, opts: { force?: boolean } = {}) => this.talkTo(npc, opts),
      /** Conversations per NPC today and the limit. */
      talks: () => ({ limit: this.maxTalks, day: this.s.day, counts: { ...(this.s.talks?.day === this.s.day ? this.s.talks.counts : {}) } }),
      /**
       * Dev only: TV screen quads for a scene, in memory (never saved). gv.screens('home', [[x,y],[x,y],[x,y],[x,y]])
       * sets one screen (fractions of the background: top-left, top-right, bottom-right, bottom-left); gv.screens('home', null) clears.
       */
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
      /** Cost of talking to an NPC now (0 = a short, free conversation). */
      cost: (npc: string) => { const n = this.c.npcById.get(npc); return n ? this.talkCost(n) : `no npc ${npc}`; },
      endDay: () => this.endDay(),
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
