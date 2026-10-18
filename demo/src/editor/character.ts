/** Read-only Character card for the dialogue tab (SPEC "Character profiles"): roster facts plus the writer-facing
 *  `profile` block from npcs.yaml. Edit the profile in npcs.yaml; the engine ignores it. */
import { h } from './dom';
import type { NpcInfo, SceneInfo } from './model';

const SCALES: { key: 'integrationLean' | 'warmth' | 'talkative'; label: string; lo: string; hi: string }[] = [
  { key: 'integrationLean', label: 'integration lean', lo: 'keeps worlds separate', hi: 'fully blended' },
  { key: 'warmth', label: 'warmth', lo: 'cool', hi: 'warm' },
  { key: 'talkative', label: 'talkative', lo: 'terse', hi: 'chatty' },
];
/** the profile fields and what goes in each, for "No profile yet" */
export const PROFILE_FIELDS: [string, string][] = [
  ['integrationLean', '0–10: 0 keeps the heritage world separate, 10 fully blended (stance stays the manipulation)'],
  ['warmth', '0–10'],
  ['talkative', '0–10'],
  ['backstory', '3–5 sentences'],
  ['motivation', 'one sentence: what they want from the player'],
  ['voice', 'how they talk: sentence length, habits, what they never say'],
  ['topics', 'list'],
  ['avoid', 'list'],
];

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v.trim() ? [v] : []);

function bar(label: string, raw: unknown, lo: string, hi: string): HTMLElement {
  const n = typeof raw === 'number' ? raw : Number(raw);
  const ok = raw != null && raw !== '' && Number.isFinite(n) && n >= 0 && n <= 10;
  return h('div', { class: 'pbar', title: `${label}: ${raw ?? '–'} (0 ${lo} … 10 ${hi})` },
    h('span', { class: 'pbar-l', text: label }),
    h('span', { class: 'pbar-t' }, ok ? h('i', { style: `width:${n * 10}%` }) : null),
    h('b', { class: ok ? '' : 'd-err', text: raw == null || raw === '' ? '–' : ok ? String(n) : `${raw}?` }));
}

export function characterCard(npc: NpcInfo | undefined, scenes: SceneInfo[], open: boolean): HTMLElement {
  const card = h('details', { class: 'panel char-card', open });
  if (!npc) { card.append(h('summary', { text: 'Character' })); return card; }
  const sceneName = new Map(scenes.map((s) => [s.id, s.name]));
  const facts = h('dl', { class: 'facts' },
    ...([['pack', npc.pack], ['community', npc.community], ['role', npc.role], ['stance', npc.stance]] as const)
      .flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v || '–' })]));
  const apps = npc.appearances.length
    ? h('ul', { class: 'apps' }, ...npc.appearances.map((a) => h('li', {},
      h('b', { text: sceneName.get(a.scene) ?? a.scene }), ` · ${a.slot || '(no slot)'} · ${a.chance != null ? `${Math.round(a.chance * 100)}%` : 'chance –'}`,
      a.figure ? h('span', { class: 'muted', text: ` · ${a.figure}` }) : null)))
    : h('p', { class: 'muted small', text: 'No appearances (TV only, or reached through events).' });
  const p = npc.profile;
  let prof: HTMLElement;
  if (p) {
    const text = (k: string, label: string) => {
      const v = p[k];
      return v != null && String(v).trim() ? h('div', { class: 'ptext' }, h('span', { class: 'pk', text: label }), h('p', { text: String(v) }))
        : h('div', { class: 'ptext' }, h('span', { class: 'pk', text: label }), h('p', { class: 'muted', text: '(not written yet)' }));
    };
    const chips = (k: string, label: string) => {
      const v = list(p[k]);
      return h('div', { class: 'ptext' }, h('span', { class: 'pk', text: label }),
        v.length ? h('div', { class: `chips${k === 'avoid' ? ' avoid' : ''}` }, ...v.map((x) => h('span', { class: 'chip', text: x }))) : h('p', { class: 'muted', text: '(none)' }));
    };
    prof = h('div', { class: 'profile' },
      h('div', { class: 'pbars' }, ...SCALES.map((sc) => bar(sc.label, p[sc.key], sc.lo, sc.hi))),
      text('backstory', 'Backstory'), text('motivation', 'Motivation'), text('voice', 'Voice'),
      chips('topics', 'Topics'), chips('avoid', 'Avoid'));
  } else {
    prof = h('div', { class: 'profile none' },
      h('p', { class: 'small' }, h('b', { text: 'No profile yet.' }), ` Add a `, h('code', { text: 'profile:' }), ` block under ${npc.id} in npcs.yaml (Mrs. Chen, cn_neighbor, has the example):`),
      h('ul', { class: 'pfields' }, ...PROFILE_FIELDS.map(([k, d]) => h('li', {}, h('code', { text: k }), ` ${d}`))));
  }
  card.append(
    h('summary', {}, h('span', { text: 'Character · ' }), h('b', { text: npc.name }), h('span', { class: 'muted small', text: ` ${npc.id}` })),
    facts,
    h('div', { class: 'pk', text: 'Appearances (scene · slot · chance)' }), apps,
    h('div', { class: 'pk', text: 'Profile (writer-facing, read-only here)' }), prof);
  return card;
}
