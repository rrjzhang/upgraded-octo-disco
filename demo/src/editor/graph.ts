/** Conversation graph for the dialogue tab (SPEC "Conversation graph"): rows as nodes, choices as edges to their `next`,
 *  layered left-to-right by depth with entry rows (rows that win at least one cell) in the first column. Hand-rolled SVG,
 *  read-only: it never edits the sheet. */
import { parseEffects, sceneList } from '../../tools/checker/core.mjs';
import { h } from './dom';
import type { Row } from './csv';

const NS = 'http://www.w3.org/2000/svg';
const W = 172;         // node width
const H = 58;          // node height
const VGAP = 14;       // vertical gap between nodes in a column
const COL = W + 124;   // column pitch (node + room for edge labels)
const PORT = (k: number) => 15 + (k - 1) * 14; // y of choice k's port on the node's right edge
const STUB = 30;       // exit stub length
const READABLE = 0.8;  // smallest zoom the first view uses
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
    this.ro = new ResizeObserver(() => { if (this.needFit && this.svg.clientWidth > 0 && this.data) this.initialView(); });
    this.ro.observe(this.el);
  }

  /** next update fits the view (NPC switched) */
  reset(): void { this.needFit = true; this.sel = -1; }

  update(input: GraphInput, sel: number): void {
    this.data = layout(input);
    this.sel = sel;
    this.draw();
    if (this.needFit && this.svg.clientWidth > 0) this.initialView();
    else this.apply();
  }

  setSelected(i: number): void {
    this.sel = i;
    this.highlight();
    this.reveal(i);
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
      g.addEventListener('keydown', (ev) => { if ((ev as KeyboardEvent).key === 'Enter' || (ev as KeyboardEvent).key === ' ') { ev.preventDefault(); this.hooks.pick(n.i); } });
      gNodes.append(g);
      this.nodeEls.set(n.i, g);
    }
    this.world.append(gEdges, gNodes, gLabels);
    this.highlight();
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
      const parts: HTMLElement[] = [h('div', { class: 'muted small', text: `${d.nodes.length} rows · ${d.nodes.filter((x) => x.entry).length} entry rows${d.known ? '' : ' (validating…)'}. Click a row to trace it backwards and forwards.` }),
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
    let down: { x: number; y: number; tx: number; ty: number; node: number; moved: boolean; id: number } | null = null;
    this.svg.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      const g = (ev.target as Element).closest('.g-node') as SVGGElement | null;
      down = { x: ev.clientX, y: ev.clientY, tx: this.tx, ty: this.ty, node: g ? +g.dataset.i! : -1, moved: false, id: ev.pointerId };
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
      if (!d.moved && d.node >= 0) this.hooks.pick(d.node);
    };
    this.svg.addEventListener('pointerup', end);
    this.svg.addEventListener('pointercancel', () => { down = null; this.el.classList.remove('panning'); });
    this.svg.addEventListener('dblclick', (ev) => {
      const g = (ev.target as Element).closest('.g-node') as SVGGElement | null;
      if (g) this.hooks.open(+g.dataset.i!);
    });
    this.svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const box = this.svg.getBoundingClientRect();
      const f = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015));
      this.zoomBy(f, ev.clientX - box.left, ev.clientY - box.top);
    }, { passive: false });
  }
}
