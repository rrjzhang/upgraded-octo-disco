// Gridded renders of every background, for placing slots, zones and TV screens by eye.
//
//   node tools/scenes/grid.mjs                         all backgrounds -> tools/scenes/grid/<scene>.jpg
//   node tools/scenes/grid.mjs --only clinic           one scene (or background id)
//   node tools/scenes/grid.mjs --only home --crop 0.02,0.05,0.26,0.42
//                                                      zoomed crop with a 1% grid -> tools/scenes/grid/home_crop.jpg
//
// Full renders are 1350x900: a 10% grid (5% dashed) labelled 0.0-1.0 on both axes, the scene's horizon in red,
// hotspot zones (blue, dashed), screen quads (green) and every slot as a dot with its id, plus a ghost rectangle of the
// figure the engine would draw there. Figure height follows SPEC "horizon-locked" sizing:
//   height / image height = (y - horizon) * H / cameraHeight,  H = 1.70 m standing, 1.30 m for slots marked
//   `seated: true`, clamped 0.12..0.95; an explicit slot `scale` wins. A tick marks the head line.
// Slots with y > 1 (feet below the frame) are drawn on the bottom edge with their y in the label.
// Rendering is a canvas in one headless Chrome driven over CDP (Node's built-in WebSocket); no npm deps beyond js-yaml.
// Set CHROME=/path/to/chrome to override the browser binary.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { load as loadYaml } from 'js-yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = resolve(ROOT, opt('--out', 'tools/scenes/grid'));
const ONLY = opt('--only', null);
const CROP = opt('--crop', null)?.split(',').map(Number) ?? null;
if (CROP && (CROP.length !== 4 || CROP.some((v) => !(v >= 0 && v <= 1)) || CROP[2] <= CROP[0] || CROP[3] <= CROP[1])) {
  console.error('--crop wants x0,y0,x1,y1 as fractions'); process.exit(2);
}
const CHROME = process.env.CHROME ||
  '/Users/richardzhang/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const IMG_W = 1536, IMG_H = 1024;            // background size (all backgrounds share it)
const W = 1350;
const H = CROP ? Math.round(W * ((CROP[3] - CROP[1]) * IMG_H) / ((CROP[2] - CROP[0]) * IMG_W)) : 900;

const scenes = loadYaml(readFileSync(join(ROOT, 'public/content/scenes.yaml'), 'utf8')).scenes;
const bgDir = join(ROOT, 'public/assets/bg');
const bgs = readdirSync(bgDir).filter((f) => f.endsWith('.jpg')).map((f) => basename(f, '.jpg'));

// Which scene each background belongs to, and the output name.
function sceneFor(bg) {
  for (const s of scenes) {
    if (s.background === bg) return { scene: s, name: s.id };
    if (s.painted?.background === bg) return { scene: s, name: `${s.id}_painted` };
    if (s.background && s.background.replace(/_day$/, '_eve') === bg) return { scene: s, name: `${s.id}_eve` };
  }
  return { scene: null, name: bg };
}

const page = (bgUrl, sc, title, view) => `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{display:block}</style>
<canvas id="c" width="${W}" height="${H}"></canvas><script>
const sc = ${JSON.stringify(sc)}; const W = ${W}, H = ${H}; const [vx0, vy0, vx1, vy1] = ${JSON.stringify(view)};
const crop = ${JSON.stringify(!!CROP)};
const X = (f) => (f - vx0) / (vx1 - vx0) * W, Y = (f) => (f - vy0) / (vy1 - vy0) * H;   // fraction -> canvas px
const PX = H / (vy1 - vy0);                                                            // canvas px per unit of image height
const c = document.getElementById('c').getContext('2d');
const img = new Image();
img.onload = () => {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  c.drawImage(img, vx0 * iw, vy0 * ih, (vx1 - vx0) * iw, (vy1 - vy0) * ih, 0, 0, W, H);
  c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(0, 0, W, H);
  c.font = 'bold 13px Helvetica, Arial, sans-serif';
  const tag = (t, x, y, fg = '#fff', bg = 'rgba(0,0,0,0.7)') => {
    const w = c.measureText(t).width + 6; c.fillStyle = bg; c.fillRect(x, y - 12, w, 15); c.fillStyle = fg; c.fillText(t, x + 3, y);
  };
  // grid: full view 10% (5% dashed); crop 5% labelled (1% dashed)
  const minor = crop ? 0.01 : 0.05, every = crop ? 5 : 2, dec = crop ? 2 : 1;
  for (let k = 0; k <= Math.round(1 / minor); k++) {
    const f = k * minor, major = k % every === 0;
    c.strokeStyle = major ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.3)'; c.lineWidth = 1; c.setLineDash(major ? [] : [4, 4]);
    if (f >= vx0 && f <= vx1) {
      c.beginPath(); c.moveTo(Math.round(X(f)) + 0.5, 0); c.lineTo(Math.round(X(f)) + 0.5, H); c.stroke();
      if (major) { tag(f.toFixed(dec), Math.min(W - 36, X(f) + 2), 14); tag(f.toFixed(dec), Math.min(W - 36, X(f) + 2), H - 3); }
    }
    if (f >= vy0 && f <= vy1) {
      c.beginPath(); c.moveTo(0, Math.round(Y(f)) + 0.5); c.lineTo(W, Math.round(Y(f)) + 0.5); c.stroke();
      if (major) { const yy = Math.max(28, Math.min(H - 18, Y(f) + 13)); tag(f.toFixed(dec), 2, yy); tag(f.toFixed(dec), W - 36, yy); }
    }
  }
  c.setLineDash([]);
  if (!sc) { tag(${JSON.stringify(title)} + ' (no scene uses this background)', W / 2 - 160, 34, '#ff0'); window.__done = true; return; }
  for (const h of sc.hotspots || []) {
    const z = h.zone; if (!z) continue;
    c.strokeStyle = 'rgba(80,170,255,0.95)'; c.lineWidth = 2; c.setLineDash([6, 3]);
    c.strokeRect(X(z.x), Y(z.y), X(z.x + z.w) - X(z.x), Y(z.y + z.h) - Y(z.y)); c.setLineDash([]);
    tag(h.id, X(z.x) + 3, Y(z.y) + 15, '#9cf');
  }
  for (const s of sc.screens || []) {
    c.strokeStyle = '#2f2'; c.lineWidth = crop ? 1 : 2; c.beginPath();
    s.quad.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)))); c.closePath(); c.stroke();
    tag('screen ' + s.id, X(s.quad[0][0]) + 3, Y(s.quad[0][1]) + 15, '#6f6');
  }
  const hz = sc.horizon ?? 1 / 3, cam = sc.cameraHeight ?? 1.6;
  c.strokeStyle = '#f22'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, Y(hz)); c.lineTo(W, Y(hz)); c.stroke();
  tag('horizon ' + hz + '  camera ' + cam + ' m', W * 0.5 - 80, Y(hz) - 4, '#f66');
  for (const s of sc.slots || []) {
    const seated = !!s.seated;
    let fh = s.scale || (s.y - hz) * (seated ? 1.3 : 1.7) / cam;
    fh = Math.min(0.95, Math.max(0.12, fh));
    const hp = fh * PX, wp = hp * (seated ? 0.48 : 0.30);      // typical figure aspect: standing ~0.30, seated with stool ~0.48
    const fx = X(s.x), fy = Y(s.y);
    c.fillStyle = seated ? 'rgba(255,170,0,0.16)' : 'rgba(255,255,0,0.14)';
    c.strokeStyle = seated ? 'rgba(255,170,0,0.95)' : 'rgba(255,255,0,0.95)'; c.lineWidth = 1.5;
    c.fillRect(fx - wp / 2, fy - hp, wp, hp); c.strokeRect(fx - wp / 2, fy - hp, wp, hp);
    const head = fy - hp + hp * (seated ? 0.16 : 0.13);
    c.beginPath(); c.moveTo(fx - wp / 2 - 6, head); c.lineTo(fx + wp / 2 + 6, head); c.stroke();
    const dy = Math.min(fy, H - 6);
    c.fillStyle = seated ? '#fa0' : '#ff0'; c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); c.arc(fx, dy, 6, 0, 7); c.fill(); c.stroke();
    tag(s.id + (seated ? ' (seated)' : '') + ' ' + s.x + ',' + s.y, fx + 9, Math.min(dy - 4, H - 22), seated ? '#fc6' : '#ff6');
  }
  tag(${JSON.stringify(title)}, W / 2 - 60, 34, '#fff');
  window.__done = true;
};
img.src = ${JSON.stringify(bgUrl)};
</script>`;

const tmp = join(tmpdir(), `gv-grid-${process.pid}`);
mkdirSync(tmp, { recursive: true });
mkdirSync(OUT, { recursive: true });

// One headless Chrome, driven over the DevTools protocol.
const PORT = 9300 + (process.pid % 500);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
  `--remote-debugging-port=${PORT}`, `--window-size=${W},${H}`, `--user-data-dir=${join(tmp, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch {} });
let targets;
for (let i = 0; i < 80 && !targets?.length; i++) {
  try { targets = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((t) => t.type === 'page'); } catch {}
  if (!targets?.length) await sleep(250);
}
if (!targets?.length) { console.error('Chrome did not start'); process.exit(1); }
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((res) => (ws.onopen = res));
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

let n = 0;
for (const bg of bgs) {
  const { scene, name } = sceneFor(bg);
  if (ONLY && ONLY !== bg && ONLY !== scene?.id && ONLY !== name) continue;
  const outName = CROP ? `${name}_crop` : name;
  const html = join(tmp, `${outName}.html`);
  writeFileSync(html, page(pathToFileURL(join(bgDir, `${bg}.jpg`)).href, scene, `${name} (${bg})`, CROP ?? [0, 0, 1, 1]));
  await send('Page.navigate', { url: pathToFileURL(html).href });
  let ok = false;
  for (let i = 0; i < 50 && !ok; i++) {
    await sleep(100);
    const r = await send('Runtime.evaluate', { expression: 'window.__done === true', returnByValue: true });
    ok = r.result?.result?.value === true;
  }
  if (!ok) { console.error(`failed ${name}: image did not load`); continue; }
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  const jpg = join(OUT, `${outName}.jpg`);
  writeFileSync(jpg, Buffer.from(shot.result.data, 'base64'));
  console.log('wrote', jpg); n++;
}
ws.close();
console.log(`${n} grid render(s)`);
process.exit(n ? 0 : 1);
