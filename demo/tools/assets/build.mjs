#!/usr/bin/env node
// Great Vote demo asset build. Re-runnable: regenerates public/assets/** and manifest.json
// from image_generation/out/ (read-only). Uses macOS `sips` for resampling/JPEG, and a tiny
// zlib-based PNG decoder/encoder for alpha trimming, reference crops and silhouette placeholders.
// Usage: node tools/assets/build.mjs [--src <dir>] [--out <dir>]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SRC = path.resolve(arg('--src', path.resolve(DEMO, '..', 'image_generation', 'out')));
const OUT = path.resolve(arg('--out', path.join(DEMO, 'public', 'assets')));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-assets-'));

// ---------------------------------------------------------------- configuration
const BACKGROUNDS = {
  bg_home_day: 'warm_indoor', bg_home_eve: 'warm_indoor',
  bg_center_cn_day: 'warm_indoor', bg_center_mx_day: 'warm_indoor', bg_center_in_day: 'warm_indoor',
  bg_library_day: 'warm_indoor', bg_clinic_day: 'cool_indoor', bg_work_day: 'cool_indoor', bg_park_day: 'outdoor',
  bg_park_chess_day: 'outdoor',
};
// background id -> source _A files in order of preference (default: [`${id}_A`]). Round 2 images
// with the TV painted in replace the plain rooms when present.
const BG_SOURCES = {
  bg_home_day: ['bg_home_tv_day_A', 'bg_home_day_A'],
  bg_home_eve: ['bg_home_tv_eve_A', 'bg_home_eve_A'],
  bg_clinic_day: ['bg_clinic_tv_day_A', 'bg_clinic_day_A'],
};
// Characters come from public/content/npcs.yaml (SPEC "Art": a new pack needs no build change): each NPC's
// `portrait` (`ch_<id>`) is the source base of its busts / reference sheet, and its `figure` plus every
// appearance's `figure` override are the figures to process. Only the exceptions live here.
// content id -> source base, overriding the NPC's portrait field
const PORTRAIT_SOURCES = {
  nat_enforcement: 'ch_nat_anti', // the Round 3 enforcement leader set
  nat_inclusive: 'cast_president_inclusive', // Lena Ortiz: Round 4 cast images replace the Round 3 male 'ch_nat_multi' set
};
const EXPRESSIONS = ['neutral', 'warm', 'guarded', 'worried'];
// several generated reference sheets for one character: the researcher page picks one per room
const CANDIDATES = { cn_leader_sep: ['ch_cn_leader_sep_ref_A_1', 'ch_cn_leader_sep_ref_A_2', 'ch_cn_leader_sep_ref_A_3'] };
const isSeatedId = (id) => /_fig_sit/.test(id);

/**
 * { characters: [[contentId, sourceBase, portraitId]], figures: [figureId] } from npcs.yaml, plus any character with art
 * in the source folder (ch_<id>_<expression|ref>_A.png) that npcs.yaml does not name yet, so art never drops out of
 * the manifest while content catches up. Figures without a source image become placeholder entries.
 */
function contentTables(npcsYaml, srcDir) {
  const chars = new Map(), figures = [];
  const addFig = (f) => { if (f && typeof f === 'string' && !figures.includes(f)) figures.push(f); };
  let list = [];
  if (fs.existsSync(npcsYaml)) {
    try { const doc = loadYaml(fs.readFileSync(npcsYaml, 'utf8')); list = Array.isArray(doc?.npcs) ? doc.npcs : []; }
    catch (e) { warn.push(`public/content/npcs.yaml: ${e.message} (characters from the source folder only)`); }
  } else warn.push('public/content/npcs.yaml not found (characters from the source folder only)');
  for (const n of list) {
    if (!n?.id) continue;
    const id = String(n.id), portrait = n.portrait ? String(n.portrait) : `ch_${id}`;
    if (!chars.has(id)) chars.set(id, { base: PORTRAIT_SOURCES[id] ?? portrait, portrait });
    addFig(n.figure);
    for (const a of Array.isArray(n.appearances) ? n.appearances : []) addFig(a?.figure);
  }
  const used = new Set([...chars.values()].flatMap((c) => [c.base, c.portrait]).concat(Object.values(PORTRAIT_SOURCES), ['ch_nat_multi']));
  const files = fs.existsSync(srcDir) ? fs.readdirSync(srcDir).sort() : [];
  for (const f of files) {
    const m = /^ch_(.+?)_(neutral|warm|guarded|worried|ref)_A(_\d+)?\.png$/.exec(f);
    if (m && !chars.has(m[1]) && !used.has(`ch_${m[1]}`)) chars.set(m[1], { base: `ch_${m[1]}`, portrait: `ch_${m[1]}` });
  }
  // every figure image of a listed character, referenced or not (a writer may name it on an appearance later)
  const bases = new Set([...chars.values()].map((c) => c.base));
  for (const f of files) {
    const m = /^(ch_.+?)_fig_(stand|sit)_A\.png$/.exec(f);
    if (m && bases.has(m[1])) addFig(f.replace(/_A\.png$/, ''));
  }
  return { characters: [...chars].map(([id, c]) => [id, c.base, c.portrait]), figures };
}
const PROPS = ['prop_tv_A', 'prop_chessboard_A'];
// Cast: authority figures named by news.csv `figure` and events.csv `portrait` (SPEC "Cast").
// Sources: image_generation/out/cast_<id>_ref_A.png, cast_<id>_bust_A.png (1:1, transparent), cast_<id>_tv_A.png (16:9).
// The content agent owns the names: public/content/cast.yaml (a list of { id, name, role }, or { cast: [...] }) is read
// first and wins. This table is only the fallback; ids starting with "_" are examples and are skipped. Any
// cast_<id>_*_A.png in the source folder also gets an entry (name = id) so new art shows up without editing this file.
const CAST = {
  _example_governor: { name: 'Governor Example', role: 'State governor' }, // example entry: copy without the leading _
};
const PORTRAIT = 640, FIG_H = 700, PROP_W = 600, BG_W = 1536, TV_W = 1280;

// ---------------------------------------------------------------- PNG codec
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function decodePNG(file) {
  const buf = fs.readFileSync(file);
  let p = 8, w, h, depth, ctype, interlace; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; interlace = d[12]; }
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (ctype !== 2 && ctype !== 6)) throw new Error(`${file}: unsupported PNG (depth ${depth}, type ${ctype}, interlace ${interlace})`);
  const bpp = ctype === 6 ? 4 : 3, stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * bpp;
      out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = bpp === 4 ? cur[s + 3] : 255;
    }
    [prev, cur] = [cur, prev];
  }
  return { w, h, alpha: bpp === 4, data: out };
}
function encodePNG(img, file, withAlpha = true) {
  const bpp = withAlpha ? 4 : 3, stride = img.w * bpp, raw = Buffer.alloc((stride + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < img.w; x++) {
      const s = (y * img.w + x) * 4, o = y * (stride + 1) + 1 + x * bpp;
      raw[o] = img.data[s]; raw[o + 1] = img.data[s + 1]; raw[o + 2] = img.data[s + 2]; if (withAlpha) raw[o + 3] = img.data[s + 3];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4); ihdr[8] = 8; ihdr[9] = withAlpha ? 6 : 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
function crop(img, x, y, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let r = 0; r < h; r++) img.data.copy(out, r * w * 4, ((y + r) * img.w + x) * 4, ((y + r) * img.w + x + w) * 4);
  return { w, h, alpha: img.alpha, data: out };
}
function alphaBBox(img, thr = 8, pad = 4) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (img.data[(y * img.w + x) * 4 + 3] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { x: 0, y: 0, w: img.w, h: img.h };
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(img.w - 1, x1 + pad); y1 = Math.min(img.h - 1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
// Head-and-shoulders square from a full-body reference sheet on a flat grey ground:
// find the top of the subject and the head's horizontal centre, then crop a square around it.
function referenceBustBox(img) {
  const bg = [0, 1, 2].map(c => img.data[(10 * img.w + 10) * 4 + c]);
  const fg = (x, y) => { const o = (y * img.w + x) * 4; return Math.abs(img.data[o] - bg[0]) + Math.abs(img.data[o + 1] - bg[1]) + Math.abs(img.data[o + 2] - bg[2]) > 60; };
  let top = 0;
  outer: for (let y = 0; y < img.h; y++) { let n = 0; for (let x = 0; x < img.w; x++) if (fg(x, y) && ++n > 6) { top = y; break outer; } }
  let sx = 0, n = 0;
  for (let y = top; y < Math.min(img.h, top + 160); y++) for (let x = 0; x < img.w; x++) if (fg(x, y)) { sx += x; n++; }
  const cx = n ? sx / n : img.w / 2, S = Math.min(560, img.w);
  const x = Math.round(Math.min(Math.max(0, cx - S / 2), img.w - S)), y = Math.max(0, Math.min(top - 50, img.h - S));
  return { x, y, w: S, h: S };
}

// ---------------------------------------------------------------- silhouettes (SDF + supersampled coverage)
function render(w, h, sdf, rgb = [140, 133, 119]) {
  const data = Buffer.alloc(w * h * 4), SS = 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let cov = 0;
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) if (sdf(x + (i + 0.5) / SS, y + (j + 0.5) / SS) <= 0) cov++;
    const o = (y * w + x) * 4; data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = Math.round(255 * cov / (SS * SS));
  }
  return { w, h, alpha: true, data };
}
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
const ellipse = (cx, cy, rx, ry) => (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
const capsule = (ax, ay, bx, by, r) => (x, y) => {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - dx * t, py - dy * t) - r;
};
const union = (...fs) => (x, y) => Math.min(...fs.map(f => f(x, y)));
const mirror = (W, f) => (x, y) => Math.min(f(x, y), f(W - x, y));

const SIL_BUST = union(circle(320, 250, 108), capsule(320, 330, 320, 420, 52), ellipse(320, 700, 270, 270));
const SIL_STAND = union(circle(130, 66, 48), capsule(130, 100, 130, 140, 20), capsule(130, 190, 130, 370, 66),
  mirror(260, union(capsule(80, 182, 105, 175, 30), capsule(64, 196, 52, 392, 21), capsule(108, 392, 104, 666, 26))),
  capsule(108, 385, 152, 385, 44));
const SIL_SIT = union(circle(150, 66, 48), capsule(150, 100, 150, 140, 20), capsule(150, 190, 150, 360, 68),
  mirror(300, union(capsule(98, 182, 125, 175, 30), capsule(84, 196, 92, 330, 21), capsule(92, 330, 128, 402, 20),
    capsule(116, 405, 112, 455, 38), capsule(110, 470, 106, 668, 24))),
  capsule(118, 395, 182, 395, 46));

// ---------------------------------------------------------------- helpers
const exists = id => fs.existsSync(path.join(SRC, id + '.png'));
const src = id => path.join(SRC, id + '.png');
// status of the image_generation request file that produced an image id ("done" | "failed" | "pending" | null)
const REQ_DIR = path.resolve(SRC, '..');
let reqStatus = null;
function requestFailed(id) {
  if (!reqStatus) {
    reqStatus = new Map();
    for (const f of fs.existsSync(REQ_DIR) ? fs.readdirSync(REQ_DIR) : []) {
      const m = /^\d+_(.+)\.md$/.exec(f); if (!m) continue;
      const st = /^status:\s*"?(\w+)"?/m.exec(fs.readFileSync(path.join(REQ_DIR, f), 'utf8'));
      reqStatus.set(m[1], st ? st[1] : null);
    }
  }
  return reqStatus.get(id) === 'failed';
}
const rel = f => path.relative(OUT, f).split(path.sep).join('/');
function sips(...args) { execFileSync('sips', args, { stdio: ['ignore', 'ignore', 'pipe'] }); }
function dims(file) {
  const o = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file]).toString();
  return { w: +o.match(/pixelWidth: (\d+)/)[1], h: +o.match(/pixelHeight: (\d+)/)[1] };
}
let tmpN = 0; const tmp = () => path.join(TMP, `t${tmpN++}.png`);
function out(sub, name) { const d = path.join(OUT, sub); fs.mkdirSync(d, { recursive: true }); return path.join(d, name); }
// Green-screen spill removal: the generated figures carry a faint green ground shadow in
// semi-transparent pixels. Clamp green to max(r, b) there; opaque pixels (clothing) are untouched.
function despill(img) {
  let n = 0;
  for (let o = 0; o < img.data.length; o += 4) {
    const a = img.data[o + 3];
    if (a === 0) continue;
    const r = img.data[o], g = img.data[o + 1], b = img.data[o + 2], m = Math.max(r, b);
    // Saturated chroma-key green at any opacity is leftover ground, never clothing (olive and forest
    // greens have g within ~30 of r or b). Drop it.
    if (g - m > 40) { img.data[o + 3] = 0; n++; continue; }
    if (a >= 250) continue;
    // Semi-transparent haze left by an imperfect green-screen knockout (Round 3 figures): a greenish
    // or neutral pixel well below full opacity is background, not person. Drop it entirely.
    if (a < 200 && g >= m - 12) { img.data[o + 3] = 0; n++; continue; }
    if (a < 40) { img.data[o + 3] = 0; n++; continue; }
    if (g > m + 8) { img.data[o + 1] = m; n++; }
  }
  return n;
}
function trimTo(id, dest, mode, size, clean = false) {
  const img = decodePNG(src(id)), t = tmp();
  if (clean) despill(img); // before the bounding box, so dropped haze does not widen the figure
  const b = alphaBBox(img);
  encodePNG(crop(img, b.x, b.y, b.w, b.h), t, true);
  sips(mode === 'h' ? '--resampleHeight' : '--resampleWidth', String(size), t, '--out', dest);
  return { ...dims(dest), trimBox: b };
}

// ---------------------------------------------------------------- build
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const manifest = { generated: new Date().toISOString(), source: 'image_generation/out (_A set)', backgrounds: {}, portraits: {}, aliases: {}, figures: {}, props: {}, tv: {}, candidates: CANDIDATES };
const warn = [];
const { characters: CHARACTERS, figures: FIGURES } = contentTables(path.resolve(arg('--npcs', path.join(DEMO, 'public', 'content', 'npcs.yaml'))), SRC);

for (const [id, lighting] of Object.entries(BACKGROUNDS)) {
  const choices = BG_SOURCES[id] ?? [id + '_A'], sid = choices.find(exists);
  if (!sid) { warn.push(`missing background ${choices.join(' / ')}`); continue; }
  const dest = out('bg', id + '.jpg');
  sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '--resampleWidth', String(BG_W), src(sid), '--out', dest);
  manifest.backgrounds[id] = { file: rel(dest), ...dims(dest), lighting, source: sid };
}

const placeholderBust = out('portrait', 'placeholder_neutral.png');
encodePNG(render(PORTRAIT, PORTRAIT, SIL_BUST), placeholderBust, true);

for (const [cid, base, portraitId] of CHARACTERS) {
  const entry = { neutral: null, warm: null, guarded: null, worried: null, placeholder: false, fromReference: false, sources: [] };
  if (base) {
    for (const ex of EXPRESSIONS) {
      // cast-style sources have a single `_bust_A` instead of per-expression busts; use it as neutral
      const sid = exists(`${base}_${ex}_A`) ? `${base}_${ex}_A` : (ex === 'neutral' && exists(`${base}_bust_A`) ? `${base}_bust_A` : null);
      if (!sid) continue;
      const dest = out('portrait', `${cid}_${ex}.png`);
      const d0 = dims(src(sid));
      if (d0.w !== d0.h) {
        // Round 3 busts came back 2:3: take a square the width of the image, anchored just above the subject
        // (alpha bounding box), so the head and shoulders fill the square without distortion.
        const img = decodePNG(src(sid)), b = alphaBBox(img, 8, 0);
        const side = Math.min(img.w, img.h), y = Math.max(0, Math.min(img.h - side, b.y - Math.round(side * 0.04)));
        const x = Math.max(0, Math.min(img.w - side, Math.round(b.x + b.w / 2 - side / 2)));
        const t = tmp(); encodePNG(crop(img, x, y, side, side), t, true);
        sips('-z', String(PORTRAIT), String(PORTRAIT), t, '--out', dest);
      } else sips('-z', String(PORTRAIT), String(PORTRAIT), src(sid), '--out', dest);
      entry[ex] = rel(dest); entry.sources.push(sid);
    }
    if (!entry.neutral) {
      const refId = CANDIDATES[cid]?.[0] ?? `${base}_ref_A`;
      if (exists(refId)) {
        const img = decodePNG(src(refId)), b = referenceBustBox(img), t = tmp(), dest = out('portrait', `${cid}_neutral.png`);
        encodePNG(crop(img, b.x, b.y, b.w, b.h), t, false);
        sips('-z', String(PORTRAIT), String(PORTRAIT), t, '--out', dest);
        entry.neutral = rel(dest); entry.fromReference = true; entry.sources.push(refId); entry.referenceCrop = b;
      }
    }
  }
  if (!entry.neutral) { entry.neutral = rel(placeholderBust); entry.placeholder = true; }
  if (CANDIDATES[cid]) entry.candidates = CANDIDATES[cid];
  manifest.portraits[cid] = entry;
  manifest.aliases[`ch_${cid}`] = cid;
  if (base) manifest.aliases[base] = cid;
  if (portraitId) manifest.aliases[portraitId] = cid;
}

const placeholderFigures = [];
for (const key of FIGURES) {
  const seated = isSeatedId(key), id = `${key}_A`;
  if (!exists(id)) {
    // named in npcs.yaml, no art yet: the silhouette of the right posture, marked placeholder
    placeholderFigures.push(key);
    continue;
  }
  const dest = out('figure', key + '.png');
  const r = trimTo(id, dest, 'h', FIG_H, true);
  manifest.figures[key] = { file: rel(dest), w: r.w, h: r.h, seated, placeholder: false };
}
for (const [kind, sdf, w] of [['stand', SIL_STAND, 260], ['sit', SIL_SIT, 300]]) {
  const dest = out('figure', `placeholder_${kind}.png`);
  encodePNG(render(w, FIG_H, sdf), dest, true);
  manifest.figures[`placeholder_${kind}`] = { file: rel(dest), w, h: FIG_H, seated: kind === 'sit', placeholder: true };
}
for (const key of placeholderFigures) manifest.figures[key] = { ...manifest.figures[`placeholder_${isSeatedId(key) ? 'sit' : 'stand'}`], placeholder: true };
if (placeholderFigures.length) warn.push(`placeholder figures (no source yet): ${placeholderFigures.join(', ')}`);

for (const id of PROPS) {
  if (!exists(id)) { warn.push(`missing prop ${id}`); continue; }
  const key = id.replace(/_A$/, ''), dest = out('prop', key + '.png');
  const r = trimTo(id, dest, 'w', PROP_W);
  manifest.props[key] = { file: rel(dest), w: r.w, h: r.h };
}

if (exists('ch_nat_anti_tv_1_A')) {
  const dest = out('tv', 'nat_enforcement_1.jpg');
  sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '--resampleWidth', String(TV_W), src('ch_nat_anti_tv_1_A'), '--out', dest);
  manifest.tv.nat_enforcement = [rel(dest)];
  manifest.tv.nat_inclusive = [rel(dest)];
  manifest.tvMeta = {
    nat_enforcement: { placeholder: false, ...dims(dest) },
    nat_inclusive: { placeholder: true, note: 'no inclusive-leader still yet; reuses nat_enforcement_1.jpg' },
  };
} else warn.push('missing ch_nat_anti_tv_1_A');
const incTv = ['cast_president_inclusive_tv_A', 'ch_nat_multi_tv_1_A'].find(exists);
if (incTv) {
  const dest = out('tv', 'nat_inclusive_1.jpg');
  sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '--resampleWidth', String(TV_W), src(incTv), '--out', dest);
  manifest.tv.nat_inclusive = [rel(dest)];
  manifest.tvMeta = { ...(manifest.tvMeta || {}), nat_inclusive: { placeholder: false, ...dims(dest) } };
}

// ---------------------------------------------------------------- cast
{
  const table = Object.fromEntries(Object.entries(CAST).filter(([id]) => !id.startsWith('_')));
  const castYaml = path.join(DEMO, 'public', 'content', 'cast.yaml');
  if (fs.existsSync(castYaml)) {
    try {
      const doc = loadYaml(fs.readFileSync(castYaml, 'utf8'));
      const list = Array.isArray(doc) ? doc : Array.isArray(doc?.cast) ? doc.cast : [];
      for (const e of list) if (e?.id) table[String(e.id)] = { ...(table[e.id] ?? {}), name: e.name ?? table[e.id]?.name, role: e.role ?? table[e.id]?.role };
    } catch (e) { warn.push(`public/content/cast.yaml: ${e.message}`); }
  }
  for (const f of fs.existsSync(SRC) ? fs.readdirSync(SRC) : []) {
    const m = /^cast_(.+)_(ref|bust|tv)_A\.png$/.exec(f);
    if (m && !table[m[1]] && !table[`cast_${m[1]}`]) table[m[1]] = {};
  }
  manifest.cast = {};
  for (const [id, meta] of Object.entries(table)) {
    const entry = { name: meta.name ?? id, role: meta.role ?? '', bust: null, tv: null, ref: null, placeholder: false, fromReference: false, sources: [] };
    // SPEC names the files cast_<id>_<kind>_A.png; cast.yaml ids already carry the prefix (cast_governor), so a
    // cast_governor_bust_A.png serves id cast_governor (and cast_cast_governor_bust_A.png would too)
    const srcFor = (kind) => [`cast_${id}_${kind}_A`, `${id}_${kind}_A`].find(exists) ?? `cast_${id}_${kind}_A`;
    const refId = srcFor('ref'), bustId = srcFor('bust'), tvId = srcFor('tv');
    // A request file marked failed (e.g. the generator saw a colour halo on the cut-out) means the saved
    // image is not to be used; the bust is cropped from the reference sheet instead.
    const bustOk = exists(bustId) && !requestFailed(bustId);
    if (exists(refId)) {
      const dest = out('cast', `${id}_ref.jpg`);
      sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '--resampleWidth', '1024', src(refId), '--out', dest);
      entry.ref = rel(dest); entry.sources.push(refId);
    }
    if (bustOk) {
      const dest = out('cast', `${id}_bust.png`), d0 = dims(src(bustId));
      if (d0.w !== d0.h) {
        // same square crop as the Round 3 busts: image-width square anchored just above the subject's alpha box
        const img = decodePNG(src(bustId)), b = alphaBBox(img, 8, 0);
        const side = Math.min(img.w, img.h), y = Math.max(0, Math.min(img.h - side, b.y - Math.round(side * 0.04)));
        const x = Math.max(0, Math.min(img.w - side, Math.round(b.x + b.w / 2 - side / 2)));
        const t = tmp(); encodePNG(crop(img, x, y, side, side), t, true);
        sips('-z', String(PORTRAIT), String(PORTRAIT), t, '--out', dest);
      } else sips('-z', String(PORTRAIT), String(PORTRAIT), src(bustId), '--out', dest);
      entry.bust = rel(dest); entry.sources.push(bustId);
    } else if (exists(refId)) {
      const img = decodePNG(src(refId)), b = referenceBustBox(img), t = tmp(), dest = out('cast', `${id}_bust.png`);
      encodePNG(crop(img, b.x, b.y, b.w, b.h), t, false);
      sips('-z', String(PORTRAIT), String(PORTRAIT), t, '--out', dest);
      entry.bust = rel(dest); entry.fromReference = true;
    }
    if (exists(tvId)) {
      // like the president's still: JPEG q85, 1280 wide
      const dest = out('cast', `${id}_tv.jpg`);
      sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '--resampleWidth', String(TV_W), src(tvId), '--out', dest);
      entry.tv = rel(dest); entry.sources.push(tvId);
    }
    // referenced but no art yet: the engine shows a silhouette / the leader's still with the word PLACEHOLDER
    if (!entry.bust && !entry.tv) { entry.placeholder = true; warn.push(`cast ${id}: no ${id.startsWith('cast_') ? id : `cast_${id}`}_{ref,bust,tv}_A.png yet (placeholder)`); }
    manifest.cast[id] = entry;
  }
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.rmSync(TMP, { recursive: true, force: true });
const c = o => Object.keys(o).length;
console.log(`assets -> ${OUT}`);
console.log(`backgrounds ${c(manifest.backgrounds)}, portraits ${c(manifest.portraits)}, figures ${c(manifest.figures)}, props ${c(manifest.props)}, tv ${c(manifest.tv)}, cast ${c(manifest.cast)}`);
for (const w of warn) console.warn('WARN', w);
