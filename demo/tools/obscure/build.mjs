// Post-build step for the public deploy (SPEC "Public build"):
//   1. every text asset under dist/content/** and dist/assets/manifest.json is deflated, masked with the key from
//      src/obscure.ts and prefixed "GVZ1" (the game decodes it, see src/obscure.ts);
//   2. every script (dist/_app/*.js, dist/logview.js, dist/modules/**/*.js) and every inline <script> in
//      dist/*.html and dist/modules/*.html is run through javascript-obfuscator;
//   3. the content editor page, the dialogue reader (normally not even built under VITE_PUBLIC) and the markdown notes are dropped.
// Usage: node tools/obscure/build.mjs [dist]   (after `vite build`); idempotent on already-obscured files.
import { readFileSync, writeFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import JavaScriptObfuscator from 'javascript-obfuscator';

const dist = process.argv[2] || 'dist';
const KEY = /KEY = '([^']+)'/.exec(readFileSync('src/obscure.ts', 'utf8'))[1];
const key = Buffer.from(KEY, 'utf8');
const MAGIC = Buffer.from('GVZ1');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : out.push(p); }
  return out;
}
function encode(buf) {
  if (buf.length >= 4 && buf.subarray(0, 4).equals(MAGIC)) return buf; // already done
  const z = deflateRawSync(buf, { level: 9 });
  const out = Buffer.alloc(z.length);
  for (let i = 0; i < z.length; i++) out[i] = z[i] ^ key[i % key.length];
  return Buffer.concat([MAGIC, out]);
}

// 1. text assets
let nText = 0, before = 0, after = 0;
const textFiles = [...walk(join(dist, 'content')), join(dist, 'assets', 'manifest.json')].filter(existsSync);
for (const f of textFiles) {
  const src = readFileSync(f); before += src.length;
  const enc = encode(src); after += enc.length;
  writeFileSync(f, enc); nText++;
}

// 2. scripts
const OPTS = {
  compact: true, target: 'browser', sourceMap: false, renameGlobals: false, selfDefending: false,
  identifierNamesGenerator: 'hexadecimal', stringArray: true, stringArrayEncoding: ['base64'], stringArrayThreshold: 0.8,
  stringArrayRotate: true, stringArrayShuffle: true, stringArrayWrappersCount: 1, splitStrings: false,
  controlFlowFlattening: false, deadCodeInjection: false, numbersToExpressions: false, simplify: true, unicodeEscapeSequence: false,
  ignoreImports: true,
};
const DONE = '/*gv-obscured*/';
function obfuscate(code) {
  if (code.startsWith(DONE)) return code;
  return DONE + JavaScriptObfuscator.obfuscate(code, OPTS).getObfuscatedCode();
}
let nJs = 0, nInline = 0;
const jsFiles = [...walk(join(dist, '_app')), join(dist, 'logview.js'), ...walk(join(dist, 'modules'))].filter((f) => existsSync(f) && extname(f) === '.js');
for (const f of jsFiles) { writeFileSync(f, obfuscate(readFileSync(f, 'utf8'))); nJs++; }
const htmlFiles = [...readdirSync(dist).filter((n) => n.endsWith('.html')).map((n) => join(dist, n)), ...walk(join(dist, 'modules')).filter((f) => f.endsWith('.html'))];
for (const f of htmlFiles) {
  const html = readFileSync(f, 'utf8');
  const out = html.replace(/<script>([\s\S]*?)<\/script>/g, (m, body) => { if (!body.trim()) return m; nInline++; return `<script>${obfuscate(body)}</script>`; });
  if (out !== html) writeFileSync(f, out);
}

// 3. drop what the public does not need
for (const p of [join(dist, 'editor.html'), join(dist, 'reader.html'), ...walk(join(dist, '_app')).filter((f) => /[\\/]reader-[^\\/]*\.(js|css)$/.test(f)), ...walk(dist).filter((f) => f.endsWith('.md'))]) { rmSync(p, { force: true }); }

console.log(`obscured ${nText} text files (${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB), ${nJs} scripts, ${nInline} inline scripts; editor.html, reader.html and *.md removed`);
