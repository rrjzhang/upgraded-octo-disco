/** Small helpers shared by the game and researcher pages. */

export function hashStr(s: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic rng keyed by parts, e.g. seeded(seed, day, scene). */
export function seeded(...parts: (string | number)[]): () => number {
  return mulberry32(hashStr(parts.join('|')));
}

type Attrs = Record<string, string | number | boolean | null | undefined | ((e: any) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      e.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      e.className = String(v);
    } else if (k === 'style') {
      e.setAttribute('style', String(v));
    } else if (k === 'text') {
      e.textContent = String(v);
    } else if (v === true) {
      e.setAttribute(k, '');
    } else {
      e.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c);
  }
  return e;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function subst(text: string, vars: Record<string, string>): string {
  return (text ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export function svgUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export const SILHOUETTE_BUST = svgUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><rect width="640" height="640" fill="none"/>` +
    `<circle cx="320" cy="250" r="120" fill="#B9B0A0"/>` +
    `<path d="M110 640 C110 470 210 400 320 400 C430 400 530 470 530 640 Z" fill="#B9B0A0"/></svg>`,
);

export function silhouetteFigure(seated: boolean): string {
  if (seated) {
    return svgUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 500"><circle cx="150" cy="70" r="50" fill="#8F8676"/>` +
        `<path d="M80 140 Q150 115 220 140 L230 320 L270 330 L270 500 L230 500 L225 370 L90 370 Z" fill="#8F8676"/></svg>`,
    );
  }
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 700"><circle cx="150" cy="75" r="55" fill="#8F8676"/>` +
      `<path d="M75 150 Q150 125 225 150 L245 420 L205 420 L200 700 L160 700 L150 470 L140 700 L100 700 L95 420 L55 420 Z" fill="#8F8676"/></svg>`,
  );
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('[gv] localStorage write failed', key, e);
  }
}

export function downloadText(filename: string, text: string, mime = 'application/x-ndjson'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const params = new URLSearchParams(location.search);
export const isFixtures = params.get('fixtures') === '1';
export const isDev = params.get('dev') === '1';
