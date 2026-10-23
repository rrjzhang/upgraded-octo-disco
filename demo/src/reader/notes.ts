/** SPEC "Dialogue reader and notes (dev only)": the notes files and the dev-server middleware (tools/reader/plugin.mjs). */

export interface Notes { rows: Map<string, string>; chains: Map<string, string> }

/** `## <rowId>` = a row note, `## chain <openerId>` = a chain note; the text under each heading up to the next one. */
export function parseNotes(md: string): Notes {
  const out: Notes = { rows: new Map(), chains: new Map() };
  const text = md.replace(/<!--[\s\S]*?-->/g, '');
  let cur: { map: Map<string, string>; id: string; lines: string[] } | null = null;
  const flush = () => { if (cur) cur.map.set(cur.id, cur.lines.join('\n').trim()); };
  for (const line of text.split(/\r?\n/)) {
    const m = /^##\s+(chain\s+)?([A-Za-z0-9_]+)\s*$/.exec(line);
    if (m) { flush(); cur = { map: m[1] ? out.chains : out.rows, id: m[2], lines: [] }; continue; }
    if (cur) cur.lines.push(line);
  }
  flush();
  return out;
}

/** null = the middleware is not there (preview or public build); '' = no notes file yet. */
export async function fetchNotes(npc: string): Promise<string | null> {
  try {
    const res = await fetch(`/__reader/notes?npc=${encodeURIComponent(npc)}`, { cache: 'no-store' });
    if (res.headers.get('x-reader') !== '1') return null;
    return res.ok ? await res.text() : '';
  } catch { return null; }
}

/** The NPC's sheet as committed (HEAD); null = middleware absent, '' = not in HEAD. */
export async function fetchHead(npc: string): Promise<string | null> {
  try {
    const res = await fetch(`/__reader/head?npc=${encodeURIComponent(npc)}`, { cache: 'no-store' });
    if (res.headers.get('x-reader') !== '1') return null;
    return res.ok ? await res.text() : '';
  } catch { return null; }
}

export async function addStub(npc: string, id: string, chain: boolean): Promise<{ heading: string; added: boolean; file: string } | { error: string }> {
  try {
    const res = await fetch('/__reader/notes/stub', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ npc, id, chain }) });
    if (res.headers.get('x-reader') !== '1') return { error: 'notes: dev server only' };
    if (!res.ok) return { error: await res.text() };
    return await res.json();
  } catch (e) { return { error: String((e as Error).message ?? e) }; }
}
