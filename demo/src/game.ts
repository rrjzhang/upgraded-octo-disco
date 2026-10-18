/** The game runtime: state transitions + plain-DOM rendering of the 1440x900 stage. */
import type {
  Content, DialogueRow, Emotion, EventRow, GameState, Hotspot, ModuleId, NewsRow, Npc, Scene, Slot,
} from './types';
import {
  DAY_ACTIONS, DEMO_DAYS, DIALOGUE_COST, applyEffects, dayPhaseOf, eventMatches, leanOf, phaseOf, selectRow,
  type Delta,
} from './rules';
import { appendLog, readLog, saveState } from './store';
import { assetEntry } from './content';
import { SILHOUETTE_BUST, downloadText, h, seeded, silhouetteFigure, subst } from './util';

const CULTURE_NAMES: Record<string, string> = { cn: 'Chinese', mx: 'Mexican', in: 'Indian' };
const CULTURE_PACK_NAMES: Record<string, string> = { cn: 'China', mx: 'Mexico', in: 'India' };
const IMG_W = 900;
const IMG_H = 600;

type Panel =
  | { kind: 'idle'; note?: string }
  | { kind: 'dialogue'; npc: string; row: DialogueRow; tie: string[] }
  | { kind: 'event'; ev: EventRow }
  | { kind: 'text'; title?: string; text: string; rule?: string };

interface Presence { npc: Npc; slot: Slot }

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

  constructor(host: HTMLElement, private c: Content, private s: GameState) {
    this.stage = h('div', { class: 'stage', id: 'stage' });
    host.replaceChildren(this.stage);
    this.buildShell();
    window.addEventListener('resize', () => this.fit());
    window.addEventListener('message', (e) => this.onMessage(e));
    document.addEventListener('keydown', (e) => this.onKey(e));
    this.fit();
  }

  // ------------------------------------------------------------------ lifecycle
  start(): void {
    if (this.s.finished) {
      this.render();
      this.renderEnd();
      return;
    }
    if (this.s.dayStartDone < this.s.day) this.beginDay();
    else this.render();
  }

  private beginDay(): void {
    const s = this.s;
    s.scene = 'home';
    s.actions = DAY_ACTIONS;
    s.dayStartDone = s.day;
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

  private inRoster(n: Npc): boolean {
    return n.pack === 'shared' || n.pack === this.s.player.pack;
  }

  presentIn(sceneId: string): Presence[] {
    const sc = this.c.sceneById.get(sceneId);
    if (!sc) return [];
    const rng = seeded(this.s.config.seed, this.s.day, sceneId);
    const used = new Set<string>();
    const out: Presence[] = [];
    for (const n of this.c.npcs) {
      for (const a of n.appearances) {
        if (a.scene !== sceneId) continue;
        const roll = rng(); // always draw so presence is stable regardless of roster
        if (!this.inRoster(n) || roll >= a.chance || used.has(a.slot)) continue;
        if (out.some((p) => p.npc.id === n.id)) continue;
        const slot = sc.slots.find((x) => x.id === a.slot);
        if (!slot) continue;
        used.add(a.slot);
        out.push({ npc: n, slot });
      }
    }
    return out;
  }

  private eventCtx(sceneId: string, requirePresence: boolean) {
    return {
      scene: sceneId,
      present: new Set(this.presentIn(sceneId).map((p) => p.npc.id)),
      lean: leanOf(this.s.spent),
      leader: this.s.config.nationalLeader,
      npcs: this.s.npcs,
      requirePresence,
    };
  }

  private bgFor(sc: Scene): { url: string; placeholder: boolean; id: string } | null {
    if (sc.background === 'none') return null;
    const m = this.c.manifest.backgrounds;
    let id = sc.background;
    if (phaseOf(this.s.actions) === 'evening') {
      const eve = id.includes('_day') ? id.replace('_day', '_eve') : `${id}_eve`;
      if (assetEntry(this.c.manifest, m, eve)) id = eve;
    }
    const e = assetEntry(this.c.manifest, m, id);
    return e ? { url: this.c.assetUrl(e.file), placeholder: !!e.placeholder, id } : { url: '', placeholder: true, id };
  }

  private portraitFor(n: Npc, emotion: Emotion): { url: string; placeholder: boolean } {
    const pick = this.s.config.rosterPicks?.[n.id];
    const man = this.c.manifest;
    const p = (pick && assetEntry(man, man.portraits, pick)) || assetEntry(man, man.portraits, n.portrait);
    const file = p?.[emotion] || p?.neutral;
    if (!p || !file) return { url: SILHOUETTE_BUST, placeholder: true };
    return { url: this.c.assetUrl(file), placeholder: !!p.placeholder };
  }

  private figureFor(n: Npc): { url: string; placeholder: boolean; aspect: number } {
    const f = assetEntry(this.c.manifest, this.c.manifest.figures, n.figure);
    if (!f?.file) return { url: silhouetteFigure(n.seated), placeholder: true, aspect: n.seated ? 300 / 500 : 300 / 700 };
    return { url: this.c.assetUrl(f.file), placeholder: !!f.placeholder, aspect: f.w && f.h ? f.w / f.h : 0.45 };
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
    const from = this.s.scene;
    this.s.scene = sceneId;
    this.panel = { kind: 'idle' };
    appendLog(this.s, { type: 'move', target: sceneId, from });
    this.save();
    if (!this.tired()) this.rollEnterEvent(sceneId);
    this.render();
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

  talkTo(npcId: string): void {
    const n = this.c.npcById.get(npcId);
    if (!n) return;
    if (this.s.actions < DIALOGUE_COST) {
      this.panel = { kind: 'idle', note: this.str('ui.notEnough') };
      return this.render();
    }
    const before = this.s.actions;
    this.spend(DIALOGUE_COST);
    const row = this.pickRow(n);
    if (!row) {
      this.panel = { kind: 'idle', note: `(No dialogue for ${n.name} yet.)` };
    } else {
      this.panel = { kind: 'dialogue', npc: n.id, row: row.row, tie: row.tie };
      appendLog(this.s, { type: 'dialogue', target: n.id, rule: row.row.id, delta: { actions: [before, this.s.actions] } });
    }
    this.save();
    this.render();
  }

  private pickRow(n: Npc): { row: DialogueRow; tie: string[] } | null {
    const rows = this.c.dialogue.get(n.id) ?? [];
    const ns = this.s.npcs[n.id] ?? { ...n.initial };
    const sel = selectRow(rows, {
      ...ns,
      nationalLeader: this.s.config.nationalLeader,
      playerLean: leanOf(this.s.spent),
      dayPhase: dayPhaseOf(this.s.day),
    });
    if (!sel.row) {
      console.error(`[dialogue] ${n.id}: no row matched (missing fallback?)`);
      return null;
    }
    if (sel.tie.length) {
      console.warn(`[dialogue] ${n.id}: tie between ${[sel.row.id, ...sel.tie.map((r) => r.id)].join(', ')}; taking ${sel.row.id}`);
    }
    return { row: sel.row, tie: sel.tie.map((r) => r.id) };
  }

  private chooseDialogue(row: DialogueRow, idx: number): void {
    const ch = row.choices[idx];
    const delta = this.effects(row.npc, ch.effect, `${row.npc}/${row.id}`);
    appendLog(this.s, { type: 'choice', target: row.npc, rule: row.id, choice: idx + 1, delta, next: ch.next || undefined });
    if (ch.next) {
      const nx = (this.c.dialogue.get(row.npc) ?? []).find((r) => r.id === ch.next);
      if (nx) {
        this.panel = { kind: 'dialogue', npc: row.npc, row: nx, tie: [] };
        appendLog(this.s, { type: 'dialogue', target: row.npc, rule: nx.id, followup: true });
      } else {
        console.error(`[dialogue] ${row.npc}/${row.id}: next "${ch.next}" not found`);
        this.panel = { kind: 'idle' };
      }
    } else {
      this.panel = { kind: 'idle', note: `${this.c.npcById.get(row.npc)?.name ?? row.npc}: conversation ended.` };
    }
    this.save();
    this.render();
  }

  private chooseEvent(ev: EventRow, idx: number | null): void {
    if (idx !== null) {
      const ch = ev.choices[idx];
      const delta = this.effects(ev.npc || null, ch.effect, `event ${ev.id}`);
      appendLog(this.s, { type: 'choice', target: ev.npc || undefined, rule: ev.id, choice: idx + 1, delta, event: true });
    }
    this.panel = { kind: 'idle' };
    this.save();
    if (this.queue.length) this.nextQueued();
    else this.render();
  }

  private hotspot(hs: Hotspot): void {
    const a = hs.action;
    const cost = a.cost ?? (a.type === 'window' || a.type === 'news' ? 1 : 0);
    if (cost > this.s.actions) {
      this.panel = { kind: 'idle', note: this.str('ui.notEnough') };
      return this.render();
    }
    switch (a.type) {
      case 'move':
        appendLog(this.s, { type: 'hotspot', target: hs.id });
        return this.moveTo(String(a.to));
      case 'end_day':
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
          this.panel = { kind: 'text', title: this.str('ui.newsTitle'), text: `**${story.headline}**\n\n${story.body}`, rule: story.id };
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

  private tvContent() {
    const leaderId = `nat_${this.s.config.nationalLeader}`;
    const imgs = (assetEntry(this.c.manifest, this.c.manifest.tv, leaderId) ?? []).map((f) => this.c.assetUrl(f));
    const placeholder = !!this.c.manifest.tvMeta?.[leaderId]?.placeholder;
    const stories = this.pickNews('tv').slice(0, 2).map((n, i) => ({
      id: n.id, valence: n.valence, headline: this.t(n.headline), body: this.t(n.body), image: imgs.length ? imgs[i % imgs.length] : null,
    }));
    return { leaderId, leaderName: this.vars().leaderName, placeholder, stories };
  }

  endDay(): void {
    this.phoneOpen = false;
    this.openWindow('survey', { ...this.c.eod, day: this.s.day }, {
      onSubmit: (answers) => {
        appendLog(this.s, { type: 'survey', target: this.c.eod.id, answers });
        this.closeWindow(false);
        this.finishDay();
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
    const frame = h('iframe', { src: `/modules/${module}.html`, title: `${module} window`, class: 'win-frame' });
    const overlay = h('div', { class: 'win-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${module} window` },
      h('div', { class: 'win-box' }, frame));
    frame.addEventListener('load', () => {
      frame.contentWindow?.postMessage({
        type: 'init',
        payload: { day: this.s.day, actions: this.s.actions, wallet: this.s.wallet, condition: this.s.config.nationalLeader, content },
      }, location.origin);
      frame.focus();
    });
    this.stage.append(overlay);
    this.win = { module, overlay, frame, ...hooks };
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
        if (w.module === 'tv' && typeof m.story === 'string') this.s.seenNews.push(m.story);
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
    if ((e.key === 'h' || e.key === 'H') && !e.metaKey && !e.ctrlKey && !this.win) this.reveal();
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
        dots,
        h('span', { class: 'tb-wallet', 'aria-label': this.str('ui.wallet'), text: `$${s.wallet}` }),
        h('span', { class: 'tb-room', text: `${this.str('ui.room')} ${s.room}` }),
        this.c.source === 'fixtures' ? h('span', { class: 'tb-fx', text: 'FIXTURES' }) : null),
    );
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

    for (const p of sc.props) {
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

    const tired = this.tired();
    for (const hs of sc.hotspots) {
      const a = hs.action;
      const cost = a.cost ?? (a.type === 'window' || a.type === 'news' ? 1 : 0);
      const disabled = tired || cost > this.s.actions;
      const costTxt = cost ? ` (${this.str(cost === 1 ? 'ui.cost' : 'ui.costs', { n: cost })})` : '';
      const b = h('button', {
        class: 'hotspot', 'data-fk': `hs:${hs.id}`, 'aria-label': `${hs.label}${costTxt}`, title: `${hs.label}${costTxt}`,
        disabled, onclick: () => this.hotspot(hs),
        style: `left:${hs.zone.x * 100}%;top:${hs.zone.y * 100}%;width:${hs.zone.w * 100}%;height:${hs.zone.h * 100}%;`,
      }, h('span', { class: 'hs-label', text: hs.label }));
      box.append(b);
    }

    const present = this.presentIn(sc.id).sort((a, b) => a.slot.y - b.slot.y);
    for (const { npc, slot } of present) {
      const fig = this.figureFor(npc);
      const hgt = slot.scale * IMG_H;
      const wid = hgt * fig.aspect;
      const left = slot.x * IMG_W - wid / 2;
      const top = slot.y * IMG_H - hgt;
      const speaking = (this.panel.kind === 'dialogue' && this.panel.npc === npc.id) || (this.panel.kind === 'event' && this.panel.ev.npc === npc.id);
      const btn = h('button', {
        class: `figure${speaking ? ' speaking' : ''}${npc.seated ? ' seated' : ''}`, 'data-fk': `npc:${npc.id}`,
        'aria-label': this.str('ui.talkTo', { name: npc.name }) + ` (${this.str('ui.cost', { n: DIALOGUE_COST })})`,
        title: npc.name, disabled: tired || this.s.actions < DIALOGUE_COST, onclick: () => this.talkTo(npc.id),
        style: `left:${left}px;top:${top}px;width:${wid}px;height:${hgt}px;z-index:${10 + Math.round(slot.y * 100)};`,
      },
      h('span', { class: 'shadow', style: `width:${wid * (npc.seated ? 0.9 : 0.7)}px;height:${Math.max(8, hgt * 0.05)}px;` }),
      h('img', { src: fig.url, alt: '', draggable: 'false' }),
      fig.placeholder ? this.pendingTag() : null);
      const img = btn.querySelector('img')!;
      img.addEventListener('error', () => { img.src = silhouetteFigure(npc.seated); });
      box.append(btn);
    }

    if (tired) {
      box.append(h('div', { class: 'tired' },
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
      const blocked = this.s.actions <= 0 && ex.to !== 'home' && dest?.background !== 'none';
      list.append(h('button', { class: 'hub-exit', 'data-fk': `hub:${ex.to}`, onclick: () => this.moveTo(ex.to) },
        h('span', { class: 'hub-label', text: ex.label }),
        h('span', { class: 'hub-dest', text: (dest?.name ?? ex.to) + (blocked ? ` · ${this.str('ui.tired')}` : '') })));
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
      exits.append(h('button', { class: 'exit', 'data-fk': `exit:${ex.to}`, onclick: () => this.moveTo(ex.to), 'aria-label': `${ex.label}, go to ${this.c.sceneById.get(ex.to)?.name ?? ex.to}` },
        h('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }), ex.label));
    }
    this.strip.replaceChildren(
      h('button', { class: 'phone-btn', 'data-fk': 'phone', 'aria-expanded': String(this.phoneOpen), onclick: () => { this.phoneOpen = !this.phoneOpen; this.renderPhone(); this.renderStrip(); } },
        h('span', { class: 'phone-icon', 'aria-hidden': 'true' }), this.str('ui.phone')),
      exits,
      sc.background !== 'none'
        ? h('button', { class: 'reveal-btn', 'data-fk': 'reveal', onclick: () => this.reveal(), text: this.str('ui.showInteractables') })
        : '',
    );
  }

  private renderRight(): void {
    const p = this.panel;
    let npc: Npc | undefined;
    let emotion: Emotion = 'neutral';
    if (p.kind === 'dialogue') { npc = this.c.npcById.get(p.npc); emotion = p.row.emotion; }
    if (p.kind === 'event' && p.ev.npc) { npc = this.c.npcById.get(p.ev.npc); emotion = p.ev.emotion; }

    const portrait = h('div', { class: 'portrait' });
    if (npc) {
      const pi = this.portraitFor(npc, emotion);
      const img = h('img', { class: 'bust', src: pi.url, alt: `${npc.name}, ${emotion}` });
      img.addEventListener('error', () => { img.src = SILHOUETTE_BUST; });
      portrait.append(img,
        h('span', { class: `chip chip-${emotion}`, text: emotion }),
        h('span', { class: 'who', text: npc.name }),
        pi.placeholder ? this.pendingTag() : '');
    }

    const desc = h('p', { class: 'desc', text: this.t(this.scene.description) });
    const body = h('div', { class: 'dialogue' });
    const choices = h('div', { class: 'choices' });
    let status = '';

    if (p.kind === 'dialogue') {
      body.append(h('p', { class: 'line', text: this.t(p.row.line) }));
      p.row.choices.forEach((ch, i) =>
        choices.append(h('button', { class: 'choice', 'data-fk': `ch:${i}`, onclick: () => this.chooseDialogue(p.row, i), text: this.t(ch.text) })));
      if (!p.row.choices.length) {
        choices.append(h('button', { class: 'choice', 'data-fk': 'ch:cont', onclick: () => { this.panel = { kind: 'idle' }; this.render(); }, text: this.str('ui.continue') }));
      }
      status = `rule ${p.row.id} · ${p.npc} · p${p.row.priority} s${p.row.specificity}${p.tie.length ? ` · TIE with ${p.tie.join(',')}` : ''}`;
    } else if (p.kind === 'event') {
      body.append(h('p', { class: 'line', text: this.t(p.ev.text) }));
      p.ev.choices.forEach((ch, i) =>
        choices.append(h('button', { class: 'choice', 'data-fk': `ch:${i}`, onclick: () => this.chooseEvent(p.ev, i), text: this.t(ch.text) })));
      if (!p.ev.choices.length) {
        choices.append(h('button', { class: 'choice', 'data-fk': 'ch:cont', onclick: () => this.chooseEvent(p.ev, null), text: this.str('ui.continue') }));
      }
      status = `event ${p.ev.id} · ${p.ev.trigger}${p.ev.npc ? ` · ${p.ev.npc}` : ''}`;
    } else if (p.kind === 'text') {
      if (p.title) body.append(h('h3', { class: 'text-title', text: p.title }));
      for (const para of this.t(p.text).split(/\n\n+/)) {
        const bold = /^\*\*(.+)\*\*$/.exec(para.trim());
        body.append(bold ? h('p', { class: 'headline', text: bold[1] }) : h('p', { class: 'line', text: para }));
      }
      choices.append(h('button', { class: 'choice', 'data-fk': 'ch:cont', onclick: () => { this.panel = { kind: 'idle' }; this.render(); }, text: this.str('ui.close') }));
      status = p.rule ? `story ${p.rule}` : '';
    } else {
      if (p.note) body.append(h('p', { class: 'note', text: p.note }));
      else if (this.s.actions <= 0) body.append(h('p', { class: 'note', text: this.str('ui.noActions') }));
      status = `lean ${leanOf(this.s.spent)} · ${dayPhaseOf(this.s.day)}`;
    }

    this.right.replaceChildren(portrait, desc, body, choices, h('div', { class: 'status', text: status }));
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
      for (const n of met) {
        const ns = this.s.npcs[n.id];
        const pi = this.portraitFor(n, 'neutral');
        ul.append(h('li', {},
          h('img', { src: pi.url, alt: '' }),
          h('div', {},
            h('div', { class: 'ct-name', text: n.name }),
            h('div', { class: 'ct-meta', text: `${'●'.repeat(ns.rapport)}${'○'.repeat(3 - ns.rapport)} · last talk: ${ns.lastValence}` }))));
      }
      pane.append(ul);
    } else if (this.phoneTab === 'wallet') {
      pane.append(h('p', { class: 'ph-balance' }, `${this.str('ui.phone.balance')}: `, h('strong', { text: `$${this.s.wallet}` })));
      const ul = h('ul', { class: 'ph-ledger' });
      for (const e of [...this.s.walletLog].reverse()) ul.append(h('li', { text: `Day ${e.day} · ${e.amount >= 0 ? '+' : ''}$${e.amount} · ${e.why}` }));
      pane.append(ul);
    } else {
      pane.append(h('p', { class: 'ph-hint', text: this.str('ui.phone.callHome') }),
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
      talk: (npc: string) => this.talkTo(npc),
      present: (scene?: string) => this.presentIn(scene ?? this.s.scene).map((p) => `${p.npc.id}@${p.slot.id}`),
      panel: () => this.panel,
      endDay: () => this.endDay(),
    };
  }
}
