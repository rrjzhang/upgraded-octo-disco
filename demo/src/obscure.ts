// Obscured text assets (SPEC "Public build"): `npm run build:public` deflates every file under content/ (and
// assets/manifest.json), masks the bytes with KEY and prefixes "GVZ1". The game reads text through decodeMaybe(),
// which undoes that when the header is present and otherwise returns the bytes as UTF-8, so the plain build and
// the dev server keep working unchanged. This is obscurity against casual inspection, not security: the key is in
// the bundle. tools/obscure/build.mjs reads KEY from this file.
export const KEY = 'gv-2026-10-19-quiet-cues-7f3a9c';

const MAGIC = [0x47, 0x56, 0x5a, 0x31]; // "GVZ1"

export function isObscured(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf);
  return b.length >= 4 && MAGIC.every((v, i) => b[i] === v);
}

export async function decodeMaybe(buf: ArrayBuffer): Promise<string> {
  if (!isObscured(buf)) return new TextDecoder().decode(buf);
  const b = new Uint8Array(buf, 4);
  const k = new TextEncoder().encode(KEY);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b[i] ^ k[i % k.length];
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([out]).stream().pipeThrough(ds);
  return new Response(stream).text();
}
