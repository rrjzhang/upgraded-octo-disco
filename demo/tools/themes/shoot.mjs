// Font/theme review gallery for Great Vote. Injects each theme from themes.json into the RUNNING dev server page
// (no source file changes), screenshots the main screen in a conversation and the phone, writes out/<stamp>/index.html.
// Usage: node tools/themes/shoot.mjs [--only id1,id2] [--base http://localhost:5173] [--port 9371]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://localhost:5173');
const PORT = +arg('--port', '9371');
const only = arg('--only', '')?.split(',').filter(Boolean);
const CHROME = process.env.CHROME || '/Users/richardzhang/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

// ---------------------------------------------------------------- colour helpers
const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t)); // t of b into a
const lum = (c) => { const [r, g, b] = hex(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** Fills in the colours style.css hard-codes, derived from the six variables unless the theme gives them. */
function fullPalette(p) {
  const dark = lum(p.panel) < 0.2;
  const d = dark ? {
    card: mix(p.panel, '#ffffff', 0.06), line: mix(p.panel, p.ink, 0.25), onAccent: '#ffffff',
    accentHover: mix(p.accent, '#ffffff', 0.18), topbar: mix(p.panel, '#000000', 0.45), topbarInk: p.ink,
  } : {
    card: mix(p.panel, '#ffffff', 0.75), line: mix(p.panel2, p.ink, 0.13), onAccent: '#ffffff',
    accentHover: mix(p.accent, '#000000', 0.2), topbar: p.ink, topbarInk: p.panel,
  };
  const q = { ...d, ...p };
  q.topbarMuted ??= mix(q.topbarInk, q.topbar, 0.18);
  q.strip ??= dark ? mix(q.panel, '#000000', 0.3) : mix(q.topbar, '#ffffff', 0.07);
  q.stripInk ??= dark ? q.ink : q.panel2;
  q.exitOff ??= mix(q.strip, '#ffffff', 0.12);
  q.exitOffInk ??= mix(q.strip, '#ffffff', 0.55);
  q.phoneFrame ??= dark ? mix(q.panel, '#ffffff', 0.18) : q.topbar;
  q.dark = dark;
  return q;
}

function contrastChecks(q) {
  const pairs = [
    ['ink on panel', q.ink, q.panel, 4.5], ['muted on panel', q.muted, q.panel, 4.5], ['ink on card (choices)', q.ink, q.card, 4.5],
    ['muted on card', q.muted, q.card, 4.5], ['ink on panel2', q.ink, q.panel2, 4.5], ['top bar text', q.topbarInk, q.topbar, 4.5],
    ['top bar muted', q.topbarMuted, q.topbar, 4.5], ['button text on accent', q.onAccent, q.accent, 4.5], ['accent text on panel', q.accent, q.panel, 4.5],
    ['strip text', q.stripInk, q.strip, 4.5],
  ];
  return pairs.map(([what, f, b, min]) => ({ what, fg: f, bg: b, ratio: +contrast(f, b).toFixed(2), min, ok: contrast(f, b) >= min }));
}

const fontStack = (fam, fallback) => `'${fam}', ${fallback}`;
const SERIF_FB = "Georgia, 'Times New Roman', serif", UI_FB = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Google Fonts css2 URL for a family; tries italic+weights, then plainer specs (css2 answers 400 if a style is missing). */
const urlCache = new Map();
async function fontUrl(fam, wantItalic) {
  const key = fam + wantItalic; if (urlCache.has(key)) return urlCache.get(key);
  const f = fam.replace(/ /g, '+');
  const specs = wantItalic ? [`:ital,wght@0,400;0,500;0,600;1,400;1,600`, `:ital,wght@0,400;0,600;1,400`, `:ital@0;1`, `:wght@400;600`, ``] : [`:wght@400;500;600;700`, `:wght@400;600`, ``];
  for (const s of specs) {
    const u = `https://fonts.googleapis.com/css2?family=${f}${s}&display=swap`;
    try { const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/131' }, signal: AbortSignal.timeout(8000) }); if (r.ok) { urlCache.set(key, { url: u, spec: s }); return urlCache.get(key); } } catch {}
  }
  urlCache.set(key, null); return null;
}

function themeCss(t, q) {
  const serif = t.serifStack ?? fontStack(t.serif, SERIF_FB), ui = t.uiStack ?? fontStack(t.ui, UI_FB);
  return `:root{--ink:${q.ink};--panel:${q.panel};--panel2:${q.panel2};--accent:${q.accent};--amber:${q.amber};--muted:${q.muted};--ui:${ui};--serif:${serif};}
html,body{background:${q.strip}}
.topbar{background:${q.topbar};color:${q.topbarInk}}
.tb-scene,.tb-legend,.tb-room{color:${q.topbarMuted}}
.dot{border-color:${q.topbarMuted}}
.left{background:${q.strip}}
.strip{background:${q.strip}}
.phone-badge{box-shadow:0 0 0 2px ${q.strip}}
.exit:disabled{background:${q.exitOff};color:${q.exitOffInk}}
.exit:disabled .arrow{color:${q.exitOffInk}}
.exit:hover:not(:disabled){background:${q.card}}
.reveal-btn{color:${q.stripInk};border-color:${mix(q.strip, q.stripInk, 0.45)}}
.btn{color:${q.onAccent}}
.btn:hover{background:${q.accentHover}}
.btn:disabled{background:${mix(q.muted, q.panel, 0.35)}}
.choice{background:${q.card};border-color:${q.line};color:${q.ink}}
.choice:hover:not(:disabled),.choice:focus-visible{background:${mix(q.card, q.accent, 0.08)}}
.hub{background:${q.panel2}}
.hub-exit{background:${q.card};border-color:${q.line};color:${q.ink}}
.hub-exit:disabled{background:${q.panel2}}
.bg-flat{background:repeating-linear-gradient(135deg,${q.panel2} 0 22px,${mix(q.panel2, q.ink, 0.05)} 22px 44px)}
.chip{background:${q.card};color:${q.ink}}
.who{background:rgba(20,18,16,.82);color:#f4f1ea}
.phone{border-color:${q.phoneFrame}}
.ph-tabs{border-bottom-color:${q.line}}
.ph-tab:disabled{color:${mix(q.muted, q.panel, 0.35)}}
.ph-journal{background:${q.card};border-color:${q.line};color:${q.ink}}
.ph-contacts li,.ph-ledger li{border-bottom-color:${q.line}}
.card textarea.q-json,.card input,.card select{background:${q.card};border-color:${q.line};color:${q.ink}}`;
}

// ---------------------------------------------------------------- browser
const all = JSON.parse(readFileSync(join(here, 'themes.json'), 'utf8')).themes;
const themes = only?.length ? all.filter((t) => only.includes(t.id)) : all;
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const out = join(here, 'out', stamp); mkdirSync(join(out, 'png'), { recursive: true }); mkdirSync(join(out, 'jpg'), { recursive: true });
const profile = join(here, 'out', '.profile');

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1440,900', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => chrome.kill());
let targets; for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets?.length) break; } catch {} await sleep(250); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else if (msg.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)); };
const send = (method, params = {}, ms = 20000) => new Promise((r, j) => { const i = ++id; const to = setTimeout(() => { pending.delete(i); j(new Error(`timeout ${method}`)); }, ms); pending.set(i, (m) => { clearTimeout(to); r(m); }); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text); return r.result?.result?.value; };
const shot = async (name, clip) => {
  const png = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  writeFileSync(join(out, 'png', name + '.png'), Buffer.from(png.result.data, 'base64'));
  const w = clip ? clip.width : 1440, h = clip ? clip.height : 900, scale = clip ? Math.min(1, 360 / w) : 720 / 1440;
  const jpg = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82, clip: { x: clip?.x ?? 0, y: clip?.y ?? 0, width: w, height: h, scale } });
  writeFileSync(join(out, 'jpg', name + '.jpg'), Buffer.from(jpg.result.data, 'base64'));
};

// (re)load the page and set up state; also used when the dev server reloads the page mid-run (HMR from src/ edits)
async function setup() {
  await send('Page.navigate', { url: `${base}/?dev=1&reset=1` }); await sleep(3000);
  await ev(`new Promise(r=>{const t=()=>window.gv?r():setTimeout(t,100);t()})`);
  await ev(`gv.game.s.player.profilePending=false; gv.set('us_neighbor','met','yes'); gv.set('us_stranger_a','met','yes'); gv.game.save(); window.__gvThemeRun=1; true`);
}
await setup();

const JOURNAL = 'Dana at the library: worried about the bus route.\nAsk again on Thursday.';
const results = [];
async function shootTheme(t) {
  const q = fullPalette(t.palette); const checks = contrastChecks(q); const warn = checks.filter((c) => !c.ok);
  for (const w of warn) console.log(`  ! ${t.id}: ${w.what} ${w.fg} on ${w.bg} = ${w.ratio}:1 (< ${w.min})`);
  const fams = [...new Set([t.serifStack ? null : t.serif, t.uiStack ? null : t.ui].filter(Boolean))];
  const links = [];
  for (const f of fams) { const u = await fontUrl(f, f === t.serif); links.push({ family: f, url: u?.url ?? null, spec: u?.spec ?? null }); }
  const css = themeCss(t, q);
  await ev(`(()=>{document.querySelectorAll('[data-gv-theme]').forEach(e=>e.remove());
    for (const u of ${JSON.stringify(links.filter((l) => l.url).map((l) => l.url))}) { const l=document.createElement('link'); l.rel='stylesheet'; l.href=u; l.dataset.gvTheme=1; document.head.append(l); }
    const s=document.createElement('style'); s.dataset.gvTheme=1; s.textContent=${JSON.stringify(css)}; document.head.append(s); return true;})()`);
  // (a) main screen in a conversation
  await ev(`gv.game.phoneOpen=false; gv.goto('library'); gv.actions(10); gv.place('us_neighbor','near'); gv.talk('us_neighbor',{force:true}); true`);
  await sleep(250);
  const fontState = await ev(`(async()=>{
    await Promise.all([...document.querySelectorAll('link[data-gv-theme]')].map(l=>l.sheet?1:new Promise(r=>{l.onload=l.onerror=r; setTimeout(r,4000)})));
    const fams=${JSON.stringify(fams)};
    await Promise.race([Promise.all(fams.flatMap(f=>[document.fonts.load('19px "'+f+'"'),document.fonts.load('italic 17px "'+f+'"'),document.fonts.load('600 15px "'+f+'"')])), new Promise(r=>setTimeout(r,5000))]);
    await document.fonts.ready;
    return Object.fromEntries(fams.map(f=>[f,[...document.fonts].some(ff=>ff.family.replace(/"/g,'')===f && ff.status==='loaded')]));})()`);
  const probe = await ev(`({line:getComputedStyle(document.querySelector('.dialogue .line')||document.body).fontFamily, choice:getComputedStyle(document.querySelector('.choice')||document.body).fontFamily, choices:document.querySelectorAll('.choice').length})`);
  await sleep(150);
  await shot(`${t.id}_main`);
  // (b) phone open on the journal tab, then the contacts tab
  await ev(`gv.game.phoneTab='journal'; gv.game.journalDraft=${JSON.stringify(JOURNAL)}; document.querySelector('.phone-btn').click(); true`);
  await sleep(250);
  await shot(`${t.id}_phone`);
  const rect = await ev(`(()=>{const r=document.querySelector('.phone').getBoundingClientRect(); return {x:Math.max(0,r.x-12),y:Math.max(0,r.y-12),width:Math.min(1440,r.width+24),height:Math.min(900,r.height+24)}})()`);
  await shot(`${t.id}_phone_journal`, rect);
  await ev(`[...document.querySelectorAll('.ph-tab')][1].click(); true`); await sleep(250);
  const contacts = await ev(`document.querySelectorAll('.ph-contacts li').length`);
  await shot(`${t.id}_phone_contacts`, rect);
  await ev(`gv.game.phoneOpen=false; gv.game.phoneTab='journal'; gv.game.render(); true`);
  const failed = Object.entries(fontState).filter(([, ok]) => !ok).map(([f]) => f).concat(links.filter((l) => !l.url).map((l) => l.family + ' (no css)'));
  return { t, q, checks, warn, links, fontState, failed, probe, contacts };
}
for (const t of themes) {
  let r = null;
  for (let attempt = 1; attempt <= 3 && !r; attempt++) {
    try {
      if (!(await ev(`!!window.__gvThemeRun && !!window.gv`).catch(() => false))) { console.log(`  (page reloaded; setting up again)`); await setup(); }
      r = await shootTheme(t);
    } catch (e) { console.log(`  ${t.id}: attempt ${attempt} failed (${e.message.split('\n')[0]}); reloading`); await setup().catch(() => {}); }
  }
  if (!r) { console.log(`${t.id}: SKIPPED after 3 attempts`); continue; }
  const { warn, failed, probe, contacts } = r; results.push(r);
  console.log(`${t.id.padEnd(22)} fonts:${failed.length ? ' FAILED ' + failed.join(',') : ' ok'}  contrast:${warn.length ? ' ' + warn.length + ' warn' : ' ok'}  choices:${probe.choices} contacts:${contacts}`);
}
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}

// ---------------------------------------------------------------- gallery
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SW = ['panel', 'panel2', 'card', 'ink', 'muted', 'accent', 'amber', 'topbar', 'strip', 'line'];
const rootBlock = (r) => `  --ink: ${r.q.ink};\n  --panel: ${r.q.panel};\n  --panel2: ${r.q.panel2};\n  --accent: ${r.q.accent};\n  --amber: ${r.q.amber};\n  --muted: ${r.q.muted};\n  --ui: ${r.t.uiStack ?? fontStack(r.t.ui, UI_FB)};\n  --serif: ${r.t.serifStack ?? fontStack(r.t.serif, SERIF_FB)};`;
const card = (r, i) => {
  const { t } = r;
  const fonts = `<b>Dialogue</b> ${esc(t.serifStack ? 'system: ' + t.serifStack.split(',')[0] : t.serif)} &middot; <b>UI</b> ${esc(t.uiStack ? 'system: ' + t.uiStack.split(',')[0] : t.ui)}`;
  const warn = r.warn.length ? `<p class="warn">Contrast below 4.5:1: ${r.warn.map((w) => `${esc(w.what)} ${w.ratio}:1`).join('; ')}</p>` : '';
  const ff = r.failed.length ? `<p class="warn">Font not loaded: ${esc(r.failed.join(', '))}</p>` : '';
  return `<section class="theme" id="${t.id}">
  <header><span class="num">${i + 1}</span><h2>${esc(t.name)}</h2><span class="mood">${esc(t.mood)}</span><code>${t.id}</code></header>
  <p class="fonts">${fonts} <span class="cr">ink/panel ${r.checks[0].ratio}:1 &middot; muted/panel ${r.checks[1].ratio}:1</span></p>
  <div class="sw">${SW.map((k) => `<span title="${k} ${r.q[k]}"><i style="background:${r.q[k]}"></i>${k}<br><code>${r.q[k]}</code></span>`).join('')}</div>
  ${warn}${ff}
  <div class="pair"><a href="png/${t.id}_main.png"><img loading="lazy" src="jpg/${t.id}_main.jpg" alt="main screen"></a><a href="png/${t.id}_phone.png"><img loading="lazy" src="jpg/${t.id}_phone.jpg" alt="phone open"></a></div>
  <p class="links">Full size: <a href="png/${t.id}_main.png">main</a> &middot; <a href="png/${t.id}_phone.png">phone (full screen)</a> &middot; <a href="png/${t.id}_phone_journal.png">phone journal</a> &middot; <a href="png/${t.id}_phone_contacts.png">phone contacts</a></p>
  <details><summary>:root block for style.css</summary><pre>${esc(rootBlock(r))}</pre></details>
</section>`;
};
const phoneCard = (r, i) => `<figure id="phone-${r.t.id}"><div class="pp"><a href="png/${r.t.id}_phone_journal.png"><img loading="lazy" src="jpg/${r.t.id}_phone_journal.jpg" alt="journal"></a><a href="png/${r.t.id}_phone_contacts.png"><img loading="lazy" src="jpg/${r.t.id}_phone_contacts.jpg" alt="contacts"></a></div><figcaption><span class="num">${i + 1}</span> <a href="#${r.t.id}">${esc(r.t.name)}</a><br><small>${esc(r.t.serifStack ? 'system serif' : r.t.serif)} / ${esc(r.t.uiStack ? 'system UI' : r.t.ui)}</small></figcaption></figure>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Great Vote themes ${stamp}</title>
<style>
:root{--bg:#f6f5f2;--fg:#1b1a18;--mut:#5f5b54;--rule:#dcd8cf;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#161514;--fg:#ecebe8;--mut:#a9a49b;--rule:#34312d;--card:#1f1e1c}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;padding:24px 20px 80px}
main{max-width:1520px;margin:0 auto}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:0}
.lead{color:var(--mut);max-width:70ch}
nav{display:flex;gap:16px;flex-wrap:wrap;margin:12px 0 24px}nav a{color:inherit}
.toc{columns:4 220px;font-size:13px;margin:0 0 32px;padding:0;list-style:none}.toc li{break-inside:avoid}.toc a{color:inherit}
.theme{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:16px 18px;margin:0 0 22px}
.theme header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.num{display:inline-block;min-width:26px;padding:1px 6px;border-radius:5px;background:var(--fg);color:var(--bg);font-weight:700;font-size:13px;text-align:center}
.mood{color:var(--mut);font-size:13px;text-transform:uppercase;letter-spacing:.06em}
code{font:12px ui-monospace,Menlo,monospace;color:var(--mut)}
.fonts{margin:6px 0}.cr{color:var(--mut);font-size:13px;margin-left:10px}
.sw{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--mut);margin:6px 0 10px}
.sw span{display:flex;flex-direction:column;align-items:flex-start;line-height:1.25}
.sw i{width:44px;height:26px;border-radius:4px;border:1px solid var(--rule);margin-bottom:2px}
.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr));gap:12px}
.pair img{width:100%;height:auto;display:block;border-radius:6px;border:1px solid var(--rule)}
.links{font-size:13px;color:var(--mut);margin:8px 0 4px}.links a{color:inherit}
.warn{color:#b3261e;font-weight:600;margin:4px 0}
@media (prefers-color-scheme:dark){.warn{color:#ff8a80}}
pre{background:var(--bg);padding:10px;border-radius:6px;overflow-x:auto;font-size:12px}
.phones{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:18px}
.phones figure{margin:0;background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:10px}
.pp{display:grid;grid-template-columns:1fr 1fr;gap:6px}.pp img{width:100%;height:auto;display:block}
figcaption{margin-top:6px;font-size:14px}figcaption a{color:inherit;font-weight:600}figcaption small{color:var(--mut)}
</style></head><body><main>
<h1>Great Vote: font and theme candidates</h1>
<p class="lead">${results.length} combinations rendered ${esc(stamp)} from <code>tools/themes/themes.json</code>, injected into the running game (nothing in <code>src/</code> changed). Each theme shows the main screen in a conversation (library, Dana) and the phone open. The <a href="#phones">phone section</a> shows the phone on its own, journal and contacts tabs, to judge separately. Click any image for the full-size PNG. Pick by number or id.</p>
<nav><a href="#main">Main screen, all themes</a><a href="#phones">Phone only</a></nav>
<ul class="toc">${results.map((r, i) => `<li>${i + 1}. <a href="#${r.t.id}">${esc(r.t.name)}</a>${r.warn.length || r.failed.length ? ' *' : ''}</li>`).join('')}</ul>
<h2 id="main" style="font-size:22px;margin:0 0 14px">Main screen and phone, per theme</h2>
${results.map(card).join('\n')}
<h2 id="phones" style="font-size:22px;margin:32px 0 14px">Phone only (journal, contacts)</h2>
<div class="phones">${results.map(phoneCard).join('\n')}</div>
</main></body></html>`;
writeFileSync(join(out, 'index.html'), html);
writeFileSync(join(out, 'results.json'), JSON.stringify(results.map((r) => ({ id: r.t.id, fonts: r.links, fontLoaded: r.fontState, failed: r.failed, contrastWarnings: r.warn, probe: r.probe, contacts: r.contacts })), null, 2));
console.log(`\n${results.length} themes -> ${join(out, 'index.html')}`);
console.log(`font failures: ${results.filter((r) => r.failed.length).map((r) => r.t.id + '(' + r.failed + ')').join(' ') || 'none'}`);
console.log(`contrast warnings: ${results.filter((r) => r.warn.length).map((r) => r.t.id).join(' ') || 'none'}`);
console.log(`page errors: ${errors.length}`); for (const e of errors.slice(0, 5)) console.log('  ' + e.slice(0, 200));
process.exit(0);
