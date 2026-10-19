/** Conversation graph for the dialogue tab (SPEC "Conversation graph"): rows as nodes, choices as edges to their `next`,
 *  layered left-to-right by depth with entry rows (rows that win at least one cell) in the first column. Hand-rolled SVG,
 *  read-only: it never edits the sheet. */
import { parseEffects, sceneList } from '../../tools/checker/core.mjs';
import { h } from './dom';
import type { Row } from './csv';
import './graph.css';

const NS = 'http://www.w3.org/2000/svg';
const W = 172;         // node width
const H = 58;          // node height
const VGAP = 14;       // vertical gap between nodes in a column
const COL = W + 124;   // column pitch (node + room for edge labels)
const PORT = (k: number) => 15 + (k - 1) * 14; // y of choice k's port on the node's right edge
const STUB = 30;       // exit stub length
const READABLE = 0.8;  // smallest zoom the first view uses
// focus view (a clicked row spread out with its full line, its choices and their targets)
const FW = 330;        // focused card width
const PW = 220;        // card width of a row that leads here
const CW = 260;        // choice card width
const TW = 220;        // card width of a row a choice leads to
const G_IN = 54, G_OUT = 54, G_TGT = 46, G_STACK = 14;
const CONDS = ['met', 'rapport', 'lastValence', 'nationalLeader', 'playerLean', 'dayPhase'] as const;
export const EMOTION_COLOR: Record<string, string> = { neutral: '#9a9283', warm: '#c2563f', guarded: '#3d6e95', worried: '#7a5ca8' };

type Attrs = Record<string, string | number>;
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of kids) if (c != null) el.append(c);
  return el;
}
const trunc = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);
/** first ~40 characters of a line, wrapped into at most two lines */
function excerpt(line: string): string[] {
  const t = trunc(line.replace(/\s+/g, ' ').trim(), 44);
  const out: string[] = [];
  let cur = '';
  for (const w of t.split(' ')) {
    if ((cur + ' ' + w).trim().length > 27 && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  if (out.length > 2) return [out[0], trunc(out.slice(1).join(' '), 27)];
  return out;
}

export interface GNode { i: number; id: string; row: Row; layer: number; x: number; y: number; entry: boolean; fallback: boolean; flagged: boolean; wins: number; incoming: GEdge[]; outgoing: GEdge[] }
export interface GEdge { from: number; k: number; to: number | null; next: string; text: string; effect: string; kind: 'fwd' | 'back' | 'exit' | 'dangling' }
/** a line's markup made readable: one block per `$` beat, a leading [tag] as an emotion chip, `_stage_` / `*stage*` in italics
 *  on its own line, {placeholders} marked */
function lineBlocks(line: string, emotion: string): HTMLElement[] {
  const beats = (line || '').split('$');
  return beats.map((raw, j) => {
    let t = raw.trim();
    let emo = emotion;
    const tag = /^\[(\w+)\]\s*/.exec(t);
    if (tag) { emo = tag[1]; t = t.slice(tag[0].length); }
    const el = h('div', { class: 'gf-beat' });
    if (beats.length > 1 || tag) el.append(h('span', { class: `gf-emo${tag ? ' tagged' : ''}`, style: `--c:${EMOTION_COLOR[emo] ?? '#c9c1ae'}`, text: `${beats.length > 1 ? `beat ${j + 1}/${beats.length} · ` : ''}${emo || 'no emotion'}` }));
    // split out stage directions (opening mark after a space or start, closing mark before space, punctuation or end)
    const re = /(^|\s)([_*])([^_*]+?)\2(?=[\s.,;:!?)\u2014-]|$)/g;
    let last = 0, m: RegExpExecArray | null;
    const parts: HTMLElement[] = [];
    let para = h('p', { class: 'gf-say' });
    const flush = () => { if (para.textContent!.trim()) parts.push(para); para = h('p', { class: 'gf-say' }); };
    while ((m = re.exec(t))) {
      para.append(...marked(t.slice(last, m.index + m[1].length)));
      flush();
      parts.push(h('p', { class: 'gf-stage', text: m[3].trim() }));
      last = m.index + m[0].length;
    }
    para.append(...marked(t.slice(last)));
    flush();
    if (!parts.length) parts.push(h('p', { class: 'gf-say muted', text: '(empty)' }));
    el.append(...parts);
    return el;
  });
}
/** text with {placeholders} wrapped in a marker */
function marked(t: string): (string | HTMLElement)[] {
  return t.split(/(\{[^}]*\})/).filter(Boolean).map((p) => (/^\{[^}]*\}$/.test(p) ? h('span', { class: 'gf-ph', text: p }) : p));
}
const costOf = (effect: string) => parseEffects(effect).ops.reduce((n: number, o: { op: string; v: number }) => (o.op === 'cost' ? n + o.v : n), 0);
const effectSummary = (effect: string) => effect.split(';').map((x) => x.trim()).filter(Boolean).join(' · ');

export interface GraphInput { rows: Row[]; winCount?: Record<string, number>; fallback?: string | null }

/** Layout: longest-path layering over the acyclic part (entry rows pinned to column 0), barycentre ordering, y aligned to the source port. */
export function layout(input: GraphInput): { nodes: GNode[]; edges: GEdge[]; width: number; height: number; known: boolean } {
  const { rows, winCount } = input;
  const known = !!winCount;
  const idx = new Map<string, number>();
  rows.forEach((r, i) => { if (r.id && !idx.has(r.id)) idx.set(r.id, i); });
  const nodes: GNode[] = rows.map((r, i) => ({ i, id: r.id, row: r, layer: 0, x: 0, y: 0, entry: !!r.id && (winCount?.[r.id] ?? 0) > 0,
    fallback: !!r.id && r.id === input.fallback, flagged: false, wins: r.id ? winCount?.[r.id] ?? 0 : 0, incoming: [], outgoing: [] }));
  const edges: GEdge[] = [];
  rows.forEach((r, i) => {
    for (const k of [1, 2, 3]) {
      const text = (r[`choice${k}`] ?? '').trim(), next = (r[`next${k}`] ?? '').trim();
      if (!text && !next) continue;
      const to = next ? idx.get(next) ?? null : null;
      const e: GEdge = { from: i, k, to, next, text, effect: r[`effect${k}`] ?? '', kind: !next ? 'exit' : to == null ? 'dangling' : 'fwd' };
      edges.push(e);
      nodes[i].outgoing.push(e);
      if (to != null) nodes[to].incoming.push(e);
    }
  });
  for (const n of nodes) n.flagged = known && !n.entry && n.incoming.length === 0;

  // back edges: DFS from entries, then rows with no way in, then anything left (cycles nobody enters)
  const state = new Array(nodes.length).fill(0); // 0 new, 1 on stack, 2 done
  const dfs = (v: number) => {
    state[v] = 1;
    for (const e of nodes[v].outgoing) {
      if (e.to == null) continue;
      if (state[e.to] === 1) e.kind = 'back';
      else if (state[e.to] === 0) dfs(e.to);
    }
    state[v] = 2;
  };
  const order0 = [...nodes.filter((n) => n.entry), ...nodes.filter((n) => !n.entry && !n.incoming.length), ...nodes];
  for (const n of order0) if (!state[n.i]) dfs(n.i);
  // edges into an entry row do not push it right (entries stay in the first column); draw them as back edges
  for (const e of edges) if (e.kind === 'fwd' && e.to != null && nodes[e.to].entry) e.kind = 'back';
  const layering = (e: GEdge) => e.kind === 'fwd';

  // longest path (a row reachable from several places sits at its max depth)
  const indeg = nodes.map((n) => n.incoming.filter(layering).length);
  const queue = nodes.filter((n) => indeg[n.i] === 0).map((n) => n.i);
  while (queue.length) {
    const v = queue.shift()!;
    for (const e of nodes[v].outgoing) {
      if (!layering(e) || e.to == null) continue;
      nodes[e.to].layer = Math.max(nodes[e.to].layer, nodes[v].layer + 1);
      if (--indeg[e.to] === 0) queue.push(e.to);
    }
  }
  const maxLayer = Math.max(0, ...nodes.map((n) => n.layer));
  const layers: GNode[][] = Array.from({ length: maxLayer + 1 }, () => []);
  // column 0: entry rows (fallback last), then rows nothing leads to
  const group = (n: GNode) => (n.layer > 0 ? 0 : n.entry ? (n.fallback ? 1 : 0) : 2);
  for (const n of nodes) layers[n.layer].push(n);
  layers[0].sort((a, b) => group(a) - group(b) || a.i - b.i);
  const pos = new Map<number, number>();
  const index = () => layers.forEach((L) => L.forEach((n, j) => pos.set(n.i, j)));
  index();
  const bary = (vals: number[], fallbackPos: number) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : fallbackPos);
  for (let it = 0; it < 8; it++) {
    for (let l = 1; l <= maxLayer; l++) {
      const key = new Map(layers[l].map((n) => [n.i, bary(n.incoming.filter(layering).map((e) => pos.get(e.from)! + (e.k - 2) * 0.15), pos.get(n.i)!)]));
      layers[l].sort((a, b) => key.get(a.i)! - key.get(b.i)! || a.i - b.i);
      index();
    }
    for (let l = maxLayer - 1; l >= 0; l--) {
      const key = new Map(layers[l].map((n) => [n.i, bary(n.outgoing.filter((e) => layering(e) && e.to != null).map((e) => pos.get(e.to!)!), pos.get(n.i)!)]));
      layers[l].sort((a, b) => (l === 0 ? group(a) - group(b) : 0) || key.get(a.i)! - key.get(b.i)! || a.i - b.i);
      index();
    }
  }
  // y: column 0 stacked; later columns aim each node at the mean of its sources' ports, then push apart
  layers[0].forEach((n, j) => { n.y = j * (H + VGAP) + (group(n) === 2 && j > 0 && group(layers[0][j - 1]) !== 2 ? 24 : 0); });
  for (let j = 1; j < layers[0].length; j++) layers[0][j].y = Math.max(layers[0][j].y, layers[0][j - 1].y + H + VGAP + (group(layers[0][j]) === 2 && group(layers[0][j - 1]) !== 2 ? 24 : 0));
  for (let l = 1; l <= maxLayer; l++) {
    let prev = -Infinity;
    for (const n of layers[l]) {
      const ins = n.incoming.filter(layering);
      const want = ins.length ? ins.reduce((a, e) => a + nodes[e.from].y + PORT(e.k), 0) / ins.length - H / 2 : 0;
      n.y = Math.max(want, prev + H + VGAP);
      prev = n.y;
    }
  }
  const minY = Math.min(0, ...nodes.map((n) => n.y));
  for (const n of nodes) { n.y -= minY; n.x = n.layer * COL; }
  const width = maxLayer * COL + W + STUB + 140;
  const height = Math.max(H, ...nodes.map((n) => n.y + H)) + 40;
  return { nodes, edges, width, height, known };
}

export interface GraphHooks {
  /** a node was clicked: select that row */
  pick(i: number): void;
  /** a node was double-clicked: show it in the table */
  open(i: number): void;
}

export class ConvGraph {
  el = h('div', { class: 'graph', tabindex: '-1' });
  private svg = s('svg', { class: 'g-svg', role: 'img', 'aria-label': 'Conversation graph' });
  private world = s('g');
  private info = h('div', { class: 'g-info' });
  private tip = h('div', { class: 'g-tip', hidden: true });
  private zoomLbl = h('span', { class: 'g-zoom' });
  private k = 1; private tx = 20; private ty = 20;
  private needFit = true;
  private data: ReturnType<typeof layout> | null = null;
  private sel = -1;
  private nodeEls = new Map<number, SVGGElement>();
  private edgeEls: { e: GEdge; el: SVGElement }[] = [];
  private ro: ResizeObserver;
  /** focused row (spread-out view), -1 = overview */
  private focus = -1;
  /** overview transform to return to when the focus is cleared */
  private overview: { k: number; tx: number; ty: number } | null = null;
  /** focused cluster in world units: its bounds and the focused card's centre */
  private fbox: { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number } | null = null;
  private fMeasured = true;
  private anim = 0;

  constructor(private hooks: GraphHooks) {
    const defs = s('defs');
    for (const [id, c] of [['g-arrow', '#8a8272'], ['g-arrow-up', '#c98a1c'], ['g-arrow-down', '#1F6F6B'], ['g-arrow-err', '#a1281e']] as const) {
      defs.append(s('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' },
        s('path', { d: 'M0,0 L10,5 L0,10 z', fill: c })));
    }
    this.svg.append(defs, this.world);
    const btn = (text: string, title: string, fn: () => void) => h('button', { class: 'mini', title, text, onclick: fn });
    const controls = h('div', { class: 'g-ctrl' },
      btn('Fit', 'Fit the whole graph in view', () => this.fit()),
      btn('−', 'Zoom out', () => this.zoomBy(1 / 1.25)),
      btn('+', 'Zoom in', () => this.zoomBy(1.25)),
      this.zoomLbl);
    const legend = h('div', { class: 'g-legend' },
      ...Object.entries(EMOTION_COLOR).map(([e, c]) => h('span', {}, h('i', { class: 'sw', style: `background:${c}` }), e)),
      h('span', {}, h('i', { class: 'sw sw-entry' }), 'entry (wins a cell)'),
      h('span', {}, h('i', { class: 'sw sw-flag' }), 'no way in'),
      h('span', {}, h('i', { class: 'sw sw-up' }), 'upstream'),
      h('span', {}, h('i', { class: 'sw sw-down' }), 'downstream'),
      h('span', { class: 'muted' }, '⊣ ends the conversation · drag to pan · wheel to zoom'));
    this.el.append(h('div', { class: 'g-bar' }, this.info, controls), h('div', { class: 'g-canvas' }, this.svg, this.tip), legend);
    this.wirePanZoom();
    this.ro = new ResizeObserver(() => {
      if (!this.svg.clientWidth || !this.data) return;
      if (this.needFit) this.initialView();
      if (this.focus >= 0 && !this.fMeasured) { this.drawFocus(); this.viewFocus(false); }
    });
    this.el.addEventListener('keydown', (ev) => this.onKey(ev));
    this.ro.observe(this.el);
  }

  /** next update fits the view (NPC switched) */
  reset(): void { this.needFit = true; this.sel = -1; this.focus = -1; this.overview = null; this.el.classList.remove('focusing'); }

  update(input: GraphInput, sel: number): void {
    this.data = layout(input);
    this.sel = sel;
    if (this.focus >= this.data.nodes.length) this.focus = -1;
    this.draw();
    if (this.needFit && this.svg.clientWidth > 0) { this.initialView(); if (this.focus >= 0) this.viewFocus(false); }
    else this.apply();
  }

  /** selection from outside (the table, the info bar's links): follows the focus when one is open, else highlights and reveals */
  setSelected(i: number): void {
    this.sel = i;
    if (this.focus >= 0 && i >= 0 && this.data?.nodes[i]) { this.focusOn(i); return; }
    if (i < 0 && this.focus >= 0) this.clearFocus();
    this.highlight();
    this.reveal(i);
  }

  /** spread row i out in the middle of the view: full line, its choices with full text, the rows around it */
  focusOn(i: number, animate = true): void {
    if (!this.data?.nodes[i]) return;
    if (this.focus === i && this.fbox) return;
    if (this.focus < 0) this.overview = { k: this.k, tx: this.tx, ty: this.ty };
    this.focus = i;
    this.sel = i;
    this.tip.hidden = true;
    this.highlight();
    this.drawFocus();
    this.viewFocus(animate);
  }

  /** back to the overview (Escape, a click on empty space) */
  clearFocus(): void {
    if (this.focus < 0) return;
    this.focus = -1;
    this.fbox = null;
    this.world.querySelector('.gf-layer')?.remove();
    this.el.classList.remove('focusing');
    this.highlight();
    const o = this.overview;
    this.overview = null;
    if (o) this.animateTo(o.k, o.tx, o.ty);
  }

  /** pan so node i is in view (only when it is not) */
  reveal(i: number): void {
    const n = this.data?.nodes[i];
    const cw = this.svg.clientWidth, ch = this.svg.clientHeight;
    if (!n || !cw || this.needFit) return;
    const x0 = this.tx + n.x * this.k, y0 = this.ty + n.y * this.k, x1 = x0 + W * this.k, y1 = y0 + H * this.k;
    const top = 8, bottom = ch - 8;
    if (x0 >= 8 && x1 <= cw - 8 && y0 >= top && y1 <= bottom) return;
    this.tx = cw / 2 - (n.x + W / 2) * this.k;
    this.ty = (top + bottom) / 2 - (n.y + H / 2) * this.k;
    this.apply();
  }

  // ------------------------------------------------------------ drawing
  private draw(): void {
    const d = this.data!;
    this.world.replaceChildren();
    this.nodeEls.clear();
    this.edgeEls = [];
    const gEdges = s('g', { class: 'g-edges' }), gLabels = s('g', { class: 'g-labels' }), gNodes = s('g', { class: 'g-nodes' });
    for (const e of d.edges) {
      const a = d.nodes[e.from];
      const x1 = a.x + W, y1 = a.y + PORT(e.k);
      // an explicit `cost N` (a substantive ask, SPEC "Pay when you stay") is marked on the edge label
      const ask = parseEffects(e.effect).ops.reduce((n: number, o: { op: string; v: number }) => (o.op === 'cost' ? n + o.v : n), 0);
      const tipText = `c${e.k} · ${e.text || '(no choice text)'}${ask ? `\ncosts ${ask} action${ask === 1 ? '' : 's'}` : ''}${e.effect ? `\neffect: ${e.effect}` : ''}${e.kind === 'exit' ? '\nends the conversation' : e.kind === 'dangling' ? `\nnext ${e.next} does not exist` : `\n→ ${e.next}`}`;
      let path: SVGElement;
      if (e.kind === 'exit' || e.kind === 'dangling') {
        const bad = e.kind === 'dangling';
        path = s('g', { class: `g-edge ${bad ? 'dangling' : 'exit'}` },
          s('path', { d: `M${x1},${y1} H${x1 + STUB}` }),
          bad ? s('text', { x: x1 + STUB + 3, y: y1 + 3, class: 'g-dangle' }, `→ ${e.next}?`) : s('path', { d: `M${x1 + STUB},${y1 - 4} V${y1 + 4}`, class: 'cap' }));
      } else {
        const b = d.nodes[e.to!];
        const x2 = b.x, y2 = b.y + H / 2;
        let p: string;
        if (e.kind === 'fwd') {
          const dx = Math.max(40, (x2 - x1) * 0.5);
          p = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
        } else {
          // back edge (cycle, or a return to an entry row): leave right, swing below both nodes, come in from the left
          const low = Math.max(a.y, b.y) + H + 18 + (e.k - 1) * 6;
          p = `M${x1},${y1} C${x1 + 70},${y1} ${x1 + 70},${low} ${x1},${low} L${x2 + 0.01},${low} C${x2 - 60},${low} ${x2 - 60},${y2} ${x2},${y2}`;
          if (x2 > x1) p = `M${x1},${y1} C${x1 + 60},${y1} ${x2 - 60},${low} ${x2},${y2}`;
        }
        path = s('path', { d: p, class: `g-edge ${e.kind}`, 'marker-end': 'url(#g-arrow)' });
      }
      path.append(s('title', {}, tipText));
      gEdges.append(path);
      const lbl = s('text', { x: x1 + 6, y: y1 - 3, class: `g-elbl${e.kind === 'exit' ? ' exit' : ''}` }, `c${e.k}${ask ? ` ●${ask}` : ''} · ${trunc(e.text || '(no text)', e.kind === 'exit' ? 14 : 17 - (ask ? 3 : 0))}`);
      lbl.append(s('title', {}, tipText));
      gLabels.append(lbl);
      this.edgeEls.push({ e, el: path }, { e, el: lbl });
    }
    for (const n of d.nodes) {
      const r = n.row;
      const emo = EMOTION_COLOR[r.emotion] ?? '#c9c1ae';
      const scene = sceneList(r.scene ?? '');
      const lines = excerpt(r.line ?? '');
      const cls = ['g-node', n.entry ? 'entry' : '', n.fallback ? 'fallback' : '', n.flagged ? 'flagged' : ''].filter(Boolean).join(' ');
      const g = s('g', { class: cls, transform: `translate(${n.x},${n.y})`, tabindex: 0, role: 'button', 'data-i': n.i,
        'aria-label': `${n.id || 'row without id'}${n.entry ? ', entry row' : ''}${n.flagged ? ', no way in' : ''}: ${r.line ?? ''}` },
        s('rect', { class: 'box', width: W, height: H, rx: 6 }),
        s('rect', { class: 'emo', x: 0, y: 0, width: 6, height: H, rx: 3, fill: emo }),
        s('text', { x: 13, y: 15, class: 'g-id' }, n.id || '(no id)'),
        scene.length ? s('text', { x: 13 + Math.max(4, (n.id || '(no id)').length) * 7.4 + 6, y: 15, class: 'g-scene' }, trunc('@' + scene.join('|'), 18)) : null,
        s('text', { x: W - 8, y: 15, class: `g-meta${n.flagged ? ' bad' : ''}`, 'text-anchor': 'end' },
          n.fallback ? 'fallback' : n.entry ? `${n.wins} cells` : n.flagged ? 'no way in' : ''),
        ...lines.map((t, j) => s('text', { x: 13, y: 32 + j * 14, class: 'g-line' }, t)));
      for (const e of n.outgoing) g.append(s('circle', { class: `g-port ${e.kind}`, cx: W, cy: PORT(e.k), r: 2.6 }));
      g.addEventListener('pointerenter', (ev) => this.showTip(n, ev as PointerEvent));
      g.addEventListener('pointermove', (ev) => this.moveTip(ev as PointerEvent));
      g.addEventListener('pointerleave', () => { this.tip.hidden = true; });
      g.addEventListener('keydown', (ev) => { if ((ev as KeyboardEvent).key === 'Enter' || (ev as KeyboardEvent).key === ' ') { ev.preventDefault(); this.follow(n.i); } });
      gNodes.append(g);
      this.nodeEls.set(n.i, g);
    }
    this.world.append(gEdges, gNodes, gLabels);
    this.highlight();
    if (this.focus >= 0) this.drawFocus();
  }

  // ------------------------------------------------------------ focus view
  private drawFocus(): void {
    const d = this.data;
    this.world.querySelector('.gf-layer')?.remove();
    const n = d?.nodes[this.focus];
    if (!d || !n) return;
    this.el.classList.add('focusing');
    const layer = s('g', { class: 'gf-layer' });
    const back = s('rect', { class: 'gf-back', x: -1e5, y: -1e5, width: 2e5, height: 2e5 });
    const gE = s('g', { class: 'gf-edges' }), gC = s('g', { class: 'gf-cards' });
    layer.append(back, gE, gC);
    this.world.append(layer);
    /** an HTML card in a foreignObject; measured after it is in the document */
    const card = (w: number, cls: string, i: number | null, label: string, ...kids: (Node | string | null)[]) => {
      const div = h('div', { class: `gf-card ${cls}`, ...(i != null ? { 'data-i': i, tabindex: 0, role: 'button', 'aria-label': label } : {}) }, ...kids);
      const fo = s('foreignObject', { width: w, height: 10 });
      fo.append(div);
      gC.append(fo);
      return { fo, div, w, x: 0, y: 0, hh: 0 };
    };
    type Card = ReturnType<typeof card>;
    const r = n.row;
    const emo = EMOTION_COLOR[r.emotion] ?? '#c9c1ae';
    const conds = CONDS.filter((c) => (r[c] ?? '').trim()).map((c) => `${c} ${r[c]}`);
    const scene = sceneList(r.scene ?? '');
    const status = n.fallback ? 'fallback entry' : n.entry ? `entry · wins ${n.wins} cells` : n.flagged ? 'no way in' : 'follow-up';
    const F = card(FW, `gf-focus${n.entry ? ' gf-entry' : ''}${n.flagged ? ' gf-flagged' : ''}`, null, '',
      h('div', { class: 'gf-head' }, h('b', { text: n.id || '(no id)' }), h('span', { class: 'gf-emo', style: `--c:${emo}`, text: r.emotion || 'no emotion' }),
        scene.length ? h('span', { class: 'gf-scene', text: '@' + scene.join(' | ') }) : null, h('span', { class: `gf-status${n.flagged ? ' bad' : ''}`, text: status })),
      conds.length || r.priority ? h('div', { class: 'gf-conds', text: [...conds, r.priority ? `priority ${r.priority}` : ''].filter(Boolean).join(' · ') }) : null,
      h('div', { class: 'gf-line' }, ...lineBlocks(r.line ?? '', r.emotion ?? '')),
      n.outgoing.length ? null : h('div', { class: 'gf-foot muted', text: 'No choices: Continue ends the conversation.' }));
    F.div.style.setProperty('--c', emo);

    // rows that lead here (deduplicated), each with the choice(s) the player took
    const parents = new Map<number, GEdge[]>();
    for (const e of n.incoming) parents.set(e.from, [...(parents.get(e.from) ?? []), e]);
    const P: Card[] = [...parents].map(([pi, es]) => {
      const pn = d.nodes[pi];
      return card(PW, 'gf-parent', pi, `go to ${pn.id}`,
        h('div', { class: 'gf-head' }, h('i', { class: 'gf-sw', style: `background:${EMOTION_COLOR[pn.row.emotion] ?? '#c9c1ae'}` }), h('b', { text: pn.id || '(no id)' }), h('span', { class: 'gf-status', text: pi === n.i ? 'this row' : 'leads here' })),
        h('div', { class: 'gf-excerpt', text: (pn.row.line ?? '').replace(/\$/g, ' ') }),
        ...es.map((e) => h('div', { class: 'gf-via' }, h('b', { text: `c${e.k} ` }), ...marked(e.text || '(no text)'))));
    });

    // the choices, full text
    const C: { c: Card; e: GEdge }[] = n.outgoing.map((e) => {
      const ask = costOf(e.effect);
      const eff = effectSummary(e.effect);
      const tn = e.to != null ? d.nodes[e.to] : null;
      const foot = e.kind === 'exit' ? h('div', { class: 'gf-foot muted', text: '⊣ ends the conversation' })
        : e.kind === 'dangling' ? h('div', { class: 'gf-foot d-err', text: `→ ${e.next} does not exist` })
          : h('div', { class: 'gf-foot', text: `→ ${tn!.id}${e.kind === 'back' ? ' (back)' : ''}` });
      return { e, c: card(CW, `gf-choice gf-${e.kind}`, e.to, `choice ${e.k}: ${e.text}${e.to != null ? `, go to ${e.next}` : ''}`,
        h('div', { class: 'gf-head' }, h('b', { text: `c${e.k}` }), ask ? h('span', { class: 'gf-cost', title: `costs ${ask} action${ask === 1 ? '' : 's'}`, text: `${'●'.repeat(Math.min(ask, 5))} ${ask}` }) : null),
        h('div', { class: 'gf-ctext' }, ...marked(e.text || '(no choice text)')),
        eff ? h('div', { class: 'gf-eff', text: eff }) : null,
        foot) };
    });

    // rows the choices lead to (deduplicated)
    const tgtOf = new Map<number, Card>();
    for (const { e } of C) {
      if (e.to == null || tgtOf.has(e.to)) continue;
      const tn = d.nodes[e.to];
      tgtOf.set(e.to, card(TW, 'gf-target', e.to, `go to ${tn.id}`,
        h('div', { class: 'gf-head' }, h('i', { class: 'gf-sw', style: `background:${EMOTION_COLOR[tn.row.emotion] ?? '#c9c1ae'}` }), h('b', { text: tn.id || '(no id)' }),
          h('span', { class: 'gf-status', text: e.to === n.i ? 'this row again' : `${tn.outgoing.length} choice${tn.outgoing.length === 1 ? '' : 's'}` })),
        h('div', { class: 'gf-excerpt', text: (tn.row.line ?? '').replace(/\$/g, ' ') })));
    }

    // measure
    const all = [F, ...P, ...C.map((x) => x.c), ...tgtOf.values()];
    this.fMeasured = true;
    for (const c of all) {
      const hh = c.div.offsetHeight;
      if (!hh) this.fMeasured = false;
      c.hh = Math.ceil(hh || 90) + 2;
      c.fo.setAttribute('height', String(c.hh));
    }
    // place: focused card centred on the overview node, parents to the left, choices then targets to the right
    const ox = n.x + W / 2 - FW / 2, oy = n.y + H / 2 - F.hh / 2;
    F.x = ox; F.y = oy;
    const stack = (cards: Card[], x: number) => {
      const tot = cards.reduce((a, c) => a + c.hh, 0) + G_STACK * Math.max(0, cards.length - 1);
      let y = oy + F.hh / 2 - tot / 2;
      for (const c of cards) { c.x = x; c.y = y; y += c.hh + G_STACK; }
    };
    stack(P, ox - G_IN - PW);
    stack(C.map((x) => x.c), ox + FW + G_OUT);
    const tx = ox + FW + G_OUT + CW + G_TGT;
    const T = [...tgtOf.entries()].map(([ti, c]) => {
      const mine = C.filter((x) => x.e.to === ti).map((x) => x.c.y + x.c.hh / 2);
      c.x = tx; c.y = mine.reduce((a, b) => a + b, 0) / mine.length - c.hh / 2;
      return c;
    }).sort((a, b) => a.y - b.y);
    for (let j = 1; j < T.length; j++) T[j].y = Math.max(T[j].y, T[j - 1].y + T[j - 1].hh + G_STACK);
    for (const c of all) { c.fo.setAttribute('x', String(c.x)); c.fo.setAttribute('y', String(c.y)); }

    // connectors
    const curve = (x1: number, y1: number, x2: number, y2: number, cls: string, marker: string) => {
      const dx = Math.max(18, (x2 - x1) * 0.5);
      gE.append(s('path', { d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, class: `gf-edge ${cls}`, 'marker-end': `url(#${marker})` }));
    };
    const clampY = (y: number, c: Card) => Math.min(c.y + c.hh - 12, Math.max(c.y + 12, y));
    P.forEach((p) => curve(p.x + PW, p.y + p.hh / 2, F.x, clampY(p.y + p.hh / 2, F), 'up', 'g-arrow-up'));
    C.forEach(({ c, e }) => {
      curve(F.x + FW, clampY(c.y + c.hh / 2, F), c.x, c.y + c.hh / 2, 'down', 'g-arrow-down');
      const t = e.to != null ? tgtOf.get(e.to) : null;
      if (t) curve(c.x + CW, c.y + c.hh / 2, t.x, clampY(c.y + c.hh / 2, t), `down${e.kind === 'back' ? ' back' : ''}`, 'g-arrow-down');
    });
    const x0 = Math.min(...all.map((c) => c.x)), y0 = Math.min(...all.map((c) => c.y));
    const x1 = Math.max(...all.map((c) => c.x + c.w)), y1 = Math.max(...all.map((c) => c.y + c.hh));
    this.fbox = { x0, y0, x1, y1, cx: F.x + FW / 2, cy: F.y + F.hh / 2 };
  }

  /** pan/zoom so the focused card is centred and as much of its cluster as fits is in view */
  private viewFocus(animate = true): void {
    const b = this.fbox;
    const cw = this.svg.clientWidth, ch = this.svg.clientHeight;
    if (!b || !cw || !ch) return;
    const pad = 16;
    const k = Math.max(0.6, Math.min(1, (cw - 2 * pad) / (b.x1 - b.x0), (ch - 2 * pad) / (b.y1 - b.y0)));
    const axis = (lo: number, hi: number, c: number, size: number) => {
      let t = size / 2 - c * k;                         // focused card centred
      if ((hi - lo) * k <= size - 2 * pad) t = Math.max(pad - lo * k, Math.min(size - pad - hi * k, t)); // whole cluster in view when it fits
      else t = Math.max(size - pad - hi * k, Math.min(pad - lo * k, t)); // too big: no empty room before or after it
      return t;
    };
    const tx = axis(b.x0, b.x1, b.cx, cw), ty = axis(b.y0, b.y1, b.cy, ch);
    this.needFit = false;
    if (animate) this.animateTo(k, tx, ty);
    else { cancelAnimationFrame(this.anim); this.k = k; this.tx = tx; this.ty = ty; this.apply(); }
  }

  private animateTo(k: number, tx: number, ty: number): void {
    cancelAnimationFrame(this.anim);
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = { k: this.k, tx: this.tx, ty: this.ty }, t0 = performance.now(), dur = reduce ? 0 : 260;
    const step = (now: number) => {
      const p = dur ? Math.min(1, (now - t0) / dur) : 1, e = 1 - Math.pow(1 - p, 3);
      this.k = from.k + (k - from.k) * e; this.tx = from.tx + (tx - from.tx) * e; this.ty = from.ty + (ty - from.ty) * e;
      this.apply();
      if (p < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  /** Escape: overview · ↑/↓: between the focused row's choices · ←: a row that leads here · →: the choice's target · Enter: follow */
  private onKey(ev: KeyboardEvent): void {
    if (this.focus < 0) return;
    const t = ev.target as HTMLElement;
    if (t.matches?.('input, textarea, select')) return;
    if (ev.key === 'Escape') { ev.preventDefault(); this.clearFocus(); this.el.focus({ preventScroll: true }); return; }
    const cards = (sel: string) => [...this.world.querySelectorAll<HTMLElement>(`.gf-card.${sel}`)];
    const choices = cards('gf-choice');
    const cur = choices.indexOf(t.closest('.gf-card') as HTMLElement);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (!choices.length) return;
      ev.preventDefault();
      const j = cur < 0 ? (ev.key === 'ArrowDown' ? 0 : choices.length - 1) : (cur + (ev.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length;
      choices[j].focus({ preventScroll: true });
    } else if (ev.key === 'ArrowLeft') {
      const p = cards('gf-parent')[0];
      if (p) { ev.preventDefault(); this.follow(+p.dataset.i!); }
    } else if (ev.key === 'ArrowRight') {
      const c = cur >= 0 ? choices[cur] : choices.find((x) => x.dataset.i != null);
      if (c?.dataset.i != null) { ev.preventDefault(); this.follow(+c.dataset.i); }
    } else if ((ev.key === 'Enter' || ev.key === ' ') && t.closest('.gf-card')?.hasAttribute('data-i')) {
      ev.preventDefault();
      this.follow(+(t.closest('.gf-card') as HTMLElement).dataset.i!);
    }
  }

  /** move the focus to row i (a click in the graph), select it in the table, keep keyboard focus in the graph */
  private follow(i: number): void {
    this.focusOn(i);
    this.hooks.pick(i);
    this.el.focus({ preventScroll: true });
    const first = this.world.querySelector<HTMLElement>('.gf-card.gf-choice');
    first?.focus({ preventScroll: true });
  }

  /** upstream = every row with a path to the selection, downstream = every row the selection can lead to */
  private highlight(): void {
    const d = this.data;
    if (!d) return;
    const sel = d.nodes[this.sel] ? this.sel : -1;
    const up = new Set<number>(), down = new Set<number>();
    if (sel >= 0) {
      const walk = (start: number, dir: 'up' | 'down', acc: Set<number>) => {
        const st = [start];
        while (st.length) {
          const v = st.pop()!;
          const next = dir === 'up' ? d.nodes[v].incoming.map((e) => e.from) : d.nodes[v].outgoing.filter((e) => e.to != null).map((e) => e.to!);
          for (const w of next) if (!acc.has(w) && w !== start) { acc.add(w); st.push(w); }
        }
      };
      walk(sel, 'up', up);
      walk(sel, 'down', down);
    }
    this.el.classList.toggle('has-sel', sel >= 0);
    for (const [i, g] of this.nodeEls) {
      g.classList.toggle('sel', i === sel);
      g.classList.toggle('up', up.has(i));
      g.classList.toggle('down', down.has(i) && !up.has(i));
    }
    for (const { e, el } of this.edgeEls) {
      const isUp = sel >= 0 && e.to != null && (e.to === sel || up.has(e.to)) && up.has(e.from);
      const isDown = sel >= 0 && !isUp && (e.from === sel || down.has(e.from)) && (e.to == null || e.to === sel || down.has(e.to));
      el.classList.toggle('up', isUp);
      el.classList.toggle('down', isDown);
      if (el.tagName === 'path' && e.kind !== 'exit' && e.kind !== 'dangling') el.setAttribute('marker-end', `url(#${isUp ? 'g-arrow-up' : isDown ? 'g-arrow-down' : 'g-arrow'})`);
    }
    // keep highlighted nodes painted above dimmed ones
    const gNodes = this.world.querySelector('.g-nodes');
    if (gNodes && sel >= 0) for (const i of [...up, ...down, sel]) { const g = this.nodeEls.get(i); if (g) gNodes.append(g); }
    this.renderInfo(sel, up, down);
  }

  private renderInfo(sel: number, up: Set<number>, down: Set<number>): void {
    const d = this.data!;
    const n = d.nodes[sel];
    if (!n) {
      const flagged = d.nodes.filter((x) => x.flagged);
      const parts: HTMLElement[] = [h('div', { class: 'muted small', text: `${d.nodes.length} rows · ${d.nodes.filter((x) => x.entry).length} entry rows${d.known ? '' : ' (validating…)'}. Click a row to spread it out with its full line and choices and trace it backwards and forwards.` }),
      ];
      if (flagged.length) parts.push(h('div', { class: 'small d-err' }, `No way in (no incoming choice, wins no cell): `, ...flagged.map((f) => this.link(f.i, f.id))));
      this.info.replaceChildren(...parts);
      return;
    }
    const via = n.incoming.map((e) => ({ i: e.from, label: `${d.nodes[e.from].id} c${e.k}` }));
    const leads = n.outgoing.map((e) => e.kind === 'exit' ? h('span', { class: 'muted', text: `c${e.k} ends` })
      : e.kind === 'dangling' ? h('span', { class: 'd-err', text: `c${e.k} → ${e.next} (missing)` })
        : this.link(e.to!, `c${e.k} → ${e.next}`));
    const sep = (els: HTMLElement[]) => els.flatMap((el, j) => (j ? [', ', el] : [el]));
    this.info.replaceChildren(
      ...(this.focus >= 0 ? [h('div', { class: 'g-info-focus small' }, h('b', { text: 'Focused' }), ' · click a choice or a row to follow it · ↑↓ choices, ← back, → follow · ',
        h('button', { class: 'linkish', text: 'Esc: overview', onclick: () => this.clearFocus() }))] : []),
      h('div', { class: 'g-info-head' }, h('b', { text: n.id || '(no id)' }), h('span', { class: 'muted small', text: n.entry ? `entry · wins ${n.wins} cells${n.fallback ? ' · fallback' : ''}` : n.flagged ? 'no way in' : 'follow-up' })),
      h('div', { class: 'small' }, h('span', { class: 'k-up', text: 'Reached from: ' }), ...(via.length ? sep(via.map((v) => this.link(v.i, v.label))) : [h('span', { class: 'muted', text: n.entry ? 'opens a conversation' : 'nothing' })])),
      h('div', { class: 'small' }, h('span', { class: 'k-down', text: 'Leads to: ' }), ...(leads.length ? sep(leads) : [h('span', { class: 'muted', text: 'no choices' })])),
      h('div', { class: 'muted small', text: `${up.size} row${up.size === 1 ? '' : 's'} upstream · ${down.size} downstream` }));
  }

  private link(i: number, text: string): HTMLElement {
    return h('button', { class: 'linkish', text, onclick: () => this.hooks.pick(i) });
  }

  private showTip(n: GNode, ev: PointerEvent): void {
    const r = n.row;
    this.tip.replaceChildren(
      h('div', { class: 'g-tip-head' }, h('b', { text: n.id || '(no id)' }), ` ${r.emotion || ''}${r.scene ? ' · @' + sceneList(r.scene).join('|') : ''} · priority ${r.priority || '–'}`),
      h('div', { class: 'g-tip-line', text: r.line || '(no line)' }),
      ...n.outgoing.map((e) => h('div', { class: 'small' }, h('b', { text: `c${e.k} ` }), e.text || '(no text)', h('span', { class: 'muted', text: e.next ? ` → ${e.next}` : ' (ends)' }))));
    this.tip.hidden = false;
    this.moveTip(ev);
  }
  private moveTip(ev: PointerEvent): void {
    if (this.tip.hidden) return;
    const box = this.tip.parentElement!.getBoundingClientRect();
    const x = ev.clientX - box.left + 14, y = ev.clientY - box.top + 14;
    const w = this.tip.offsetWidth, hgt = this.tip.offsetHeight;
    this.tip.style.left = `${Math.min(x, box.width - w - 8)}px`;
    this.tip.style.top = `${y + hgt > box.height - 8 ? Math.max(8, ev.clientY - box.top - hgt - 10) : y}px`;
  }

  // ------------------------------------------------------------ pan / zoom
  private apply(): void {
    this.world.setAttribute('transform', `translate(${this.tx.toFixed(1)},${this.ty.toFixed(1)}) scale(${this.k.toFixed(4)})`);
    this.zoomLbl.textContent = `${Math.round(this.k * 100)}%`;
  }
  /** the whole graph in view (Fit button) */
  fit(minK = 0): void {
    const d = this.data;
    const cw = this.svg.clientWidth, ch = this.svg.clientHeight;
    if (!d || !cw || !ch) return;
    const padTop = 12, pad = 16;
    const k = Math.min(1.1, (cw - 2 * pad) / d.width, (ch - padTop - 8) / d.height);
    this.k = Math.max(k, minK);
    this.tx = pad + Math.max(0, (cw - 2 * pad - d.width * this.k) / 2);
    this.ty = padTop;
    this.needFit = false;
    this.apply();
  }
  /** first view of a sheet: fit, but never below a readable zoom (the Fit button shows everything) */
  private initialView(): void {
    this.fit(READABLE);
    if (this.sel >= 0) this.reveal(this.sel);
  }
  private zoomBy(f: number, cx = this.svg.clientWidth / 2, cy = this.svg.clientHeight / 2): void {
    const k2 = Math.min(2.5, Math.max(0.15, this.k * f));
    this.tx = cx - ((cx - this.tx) / this.k) * k2;
    this.ty = cy - ((cy - this.ty) / this.k) * k2;
    this.k = k2;
    this.apply();
  }
  private wirePanZoom(): void {
    let down: { x: number; y: number; tx: number; ty: number; node: number; bg: boolean; moved: boolean; id: number } | null = null;
    this.svg.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      cancelAnimationFrame(this.anim);
      const tgt = ev.target as Element;
      const g = tgt.closest('.g-node, .gf-card[data-i]') as SVGGElement | HTMLElement | null;
      const bg = !g && (!!tgt.closest('.gf-back') || tgt === this.svg || !tgt.closest('.gf-card'));
      down = { x: ev.clientX, y: ev.clientY, tx: this.tx, ty: this.ty, node: g ? +g.dataset.i! : -1, bg, moved: false, id: ev.pointerId };
    });
    this.svg.addEventListener('pointermove', (ev) => {
      if (!down || ev.pointerId !== down.id) return;
      const dx = ev.clientX - down.x, dy = ev.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) > 4) { down.moved = true; this.svg.setPointerCapture(ev.pointerId); this.el.classList.add('panning'); this.tip.hidden = true; }
      if (down.moved) { this.tx = down.tx + dx; this.ty = down.ty + dy; this.apply(); }
    });
    const end = (ev: PointerEvent) => {
      if (!down || ev.pointerId !== down.id) return;
      const d = down;
      down = null;
      this.el.classList.remove('panning');
      if (d.moved) return;
      if (d.node >= 0) this.follow(d.node);
      else if (d.bg && this.focus >= 0) { this.clearFocus(); this.el.focus({ preventScroll: true }); }
    };
    this.svg.addEventListener('pointerup', end);
    this.svg.addEventListener('pointercancel', () => { down = null; this.el.classList.remove('panning'); });
    this.svg.addEventListener('dblclick', (ev) => {
      const g = (ev.target as Element).closest('.g-node, .gf-card.gf-focus, .gf-card[data-i]') as SVGGElement | HTMLElement | null;
      if (g) this.hooks.open(g.dataset.i != null ? +g.dataset.i : this.focus);
    });
    this.svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const box = this.svg.getBoundingClientRect();
      const f = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015));
      this.zoomBy(f, ev.clientX - box.left, ev.clientY - box.top);
    }, { passive: false });
  }
}
