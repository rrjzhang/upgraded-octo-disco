import type { Emotion } from './types';
import { EMOTIONS } from './rules';

/**
 * SPEC "Writing dialogue: beats and stage directions".
 *
 * A `$` in a dialogue line (or an event text) splits it into beats shown one at a time: the panel shows the first beat with
 * a single Next button, then the second, and the row's choices only with the last beat. A beat may start with `[warm]`,
 * `[guarded]`, `[worried]` or `[neutral]` to change the bust for that beat; otherwise the row's emotion column applies.
 * Beats are not turns: they never count towards the stay charge (SPEC "Pay when you stay").
 */
export interface Beat { text: string; emotion?: Emotion }

export function splitBeats(line: string): Beat[] {
  const parts = line.split('$').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return [{ text: '' }];
  return parts.map((text) => {
    const m = /^\[([a-z]+)\]\s*/.exec(text);
    if (m && (EMOTIONS as readonly string[]).includes(m[1])) return { text: text.slice(m[0].length), emotion: m[1] as Emotion };
    return { text };
  });
}

/**
 * A stage direction is a short phrase in underscores or asterisks standing on its own between sentences:
 * `Here a notary is a man with a stamp. _scowls_ And the flyers count on people not knowing that.` It is shown on its own
 * line in italics (`.line.stage`), the way a script prints an action. Markers glued inside a word (snake_case ids, 2*3)
 * are left alone: the opening mark must follow a space or the start, the closing one must be followed by space,
 * punctuation or the end.
 */
export type SpeechPart = { kind: 'say' | 'stage'; text: string };

const STAGE = /(^|\s)([_*])([^_*\n]{1,120}?)\2(?=[\s.,;:!?)]|$)/g;

export function speechParts(text: string): SpeechPart[] {
  const out: SpeechPart[] = [];
  let last = 0;
  for (const m of text.matchAll(STAGE)) {
    const start = m.index! + m[1].length;
    const before = text.slice(last, start).trim();
    if (before) out.push({ kind: 'say', text: before });
    out.push({ kind: 'stage', text: m[3].trim() });
    last = m.index! + m[0].length;
  }
  const tail = text.slice(last).trim();
  if (tail) out.push({ kind: 'say', text: tail });
  return out.length ? out : [{ kind: 'say', text }];
}
