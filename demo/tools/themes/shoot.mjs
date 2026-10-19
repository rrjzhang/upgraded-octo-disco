// Font/theme review gallery for Great Vote. Injects each theme from themes.json into the RUNNING dev server page
// (no source file changes), screenshots the main screen in a conversation and the phone, writes out/<stamp>/index.html.
// Usage: node tools/themes/shoot.mjs [--only id1,id2] [--base http://localhost:5173] [--port 9371]
// A theme may `extends` another (palette and fonts copied) and carry `scale` / `phoneScale` (type size multipliers).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://localhost:5173');
const PORT = +arg('--port', '9371');
const only = arg('--only', '')?.split(',').filter(Boolean);
const DSF = +arg('--dsf', '2'); // device pixels per CSS pixel: PNGs are 2880x1800 at 2; the JPG previews stay 1440 px wide
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
  return `:root{--ink:${q.ink};--panel:${q.panel};--panel2:${q.panel2};--accent:${q.accent};--amber:${q.amber};--muted:${q.muted};--ui:${ui};--serif:${serif};--phoneFrame:${q.phoneFrame};}
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
.ph-tabs{border-bottom-color:${q.line}}
.ph-tab:disabled{color:${mix(q.muted, q.panel, 0.35)}}
.ph-journal{background:${q.card};border-color:${q.line};color:${q.ink}}
.ph-contacts li,.ph-ledger li{border-bottom-color:${q.line}}
.card textarea.q-json,.card input,.card select{background:${q.card};border-color:${q.line};color:${q.ink}}`;
}

/**
 * In-page expression that builds the type-scale overrides: every px font-size in the game's own stylesheets (not the
 * injected theme) is re-declared under the same selector, times `scale`, or times `phoneScale` for the phone's own
 * selectors (`.phone`, `.ph-*`; not `.phone-btn` in the strip or the `.ph-mark` placeholder tag). Inherited sizes
 * follow from `.stage` / `.phone` (16 px default) and the phone's buttons get the phone scale.
 */
const scaleCssExpr = (scale, phoneScale, smallScale = 1) => `(()=>{const S=${scale},P=${phoneScale},SS=${smallScale},out=[];
  const isPhone=(sel)=>/(^|[\\s>+~(])\\.(phone(?![-\\w])|ph-(?!mark))/.test(sel);
  // the text that is still small at 1x: top bar, exit strip, the portrait's name tag and mood chip, the scene description,
  // the phone's tabs and its journal / contacts / wallet text (not the dev status line, not the opening questions)
  const isSmall=(sel)=>${SMALL_RE.toString()}.test(sel);
  const px=(v,k)=>(Math.round(parseFloat(v)*k*100)/100)+'px';
  for (const sh of document.styleSheets) {
    if (sh.ownerNode?.dataset?.gvTheme) continue;
    let rules; try { rules = sh.cssRules; } catch { continue; }
    for (const r of rules) {
      if (!(r instanceof CSSStyleRule)) continue;
      // a 'font' shorthand that uses var() leaves the longhands empty in the CSSOM, so read its size from the text
      let fs=r.style.fontSize; if (!fs) { const m=/(?:^|\\s)(\\d+(?:\\.\\d+)?px)(?:\\/\\S+)?\\s/.exec(r.style.getPropertyValue('font')+' '); fs=m?m[1]:''; }
      if (!fs || !fs.endsWith('px')) continue;
      const sels=r.selectorText.split(',').map(x=>x.trim());
      for (const [k, list] of [[S, sels.filter(x=>!isPhone(x)&&!isSmall(x))], [S*SS, sels.filter(x=>!isPhone(x)&&isSmall(x))], [P, sels.filter(x=>isPhone(x)&&!isSmall(x))], [P*SS, sels.filter(x=>isPhone(x)&&isSmall(x))]])
        if (list.length && k!==1) out.push(list.join(',')+'{font-size:'+px(fs,k)+'}');
    }
  }
  out.unshift('.stage{font-size:'+px('16px',S)+'}');
  out.push('.phone{font-size:'+px('16px',P)+'}', '.phone .btn{font-size:'+px('15px',P)+'}', '.phone .btn.small{font-size:'+px('13px',P)+'}');
  // small text that inherits its size today (the name tag, the phone button, contact names) gets an explicit size
  if (SS!==1) out.push('.who{font-size:'+px('16px',S*SS)+'}', '.phone-btn{font-size:'+px('16px',S*SS)+'}', '.ph-contacts{font-size:'+px('16px',P*SS)+'}');
  return out.join('\\n');})()`;
/** Selectors scaled by `smallScale` on top of `scale` (a selector's last-matching class decides; `.exits`, `.chip-warm` etc. excluded). */
const SMALL_RE = /\.(topbar|tb-[\w-]+|exit|strip|phone-btn|phone-badge|reveal-btn|who|chip|desc|ph-tab|ph-hint|ph-journal|ph-msg|ph-contacts|ct-name|ct-meta|ph-ledger|ph-balance)(?![\w-])/;

/** In-page snippet: computed font-size of the first match of each selector (null when absent). */
const SIZES = (m) => `Object.fromEntries(Object.entries(${JSON.stringify(m)}).map(([k,s])=>{const e=document.querySelector(s); return [k, e&&e.getClientRects().length?getComputedStyle(e).fontSize:null];}))`;

/** In-page layout probe for the main screen: text cut off, boxes overlapping, the right panel needing to scroll. */
const MAIN_PROBE = `(()=>{const w=[]; const R=(e)=>e.getBoundingClientRect(); const hit=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
  const clipX=(sel,what)=>document.querySelectorAll(sel).forEach((e,i)=>{ if(e.offsetParent&&e.scrollWidth>e.clientWidth+1) w.push(what+' '+(i+1)+' cut off ('+(e.scrollWidth-e.clientWidth)+' px)'); });
  // a squeezed dialogue box: measured as shot (dev mode) and again with the dev-only buttons (Back, edit) hidden, as a player sees it
  const devBtns=[...document.querySelectorAll('.choices .choice')].filter(e=>e.classList.contains('dev-back')||/\\(dev\\)/.test(e.textContent));
  const over=()=>[...document.querySelectorAll('.right .dialogue, .right .desc')].map(e=>[e, e.scrollHeight-e.clientHeight]).filter(([,d])=>d>1);
  const asShot=over(); devBtns.forEach(e=>e.style.display='none'); const asPlayer=new Set(over().map(([e])=>e)); devBtns.forEach(e=>e.style.display='');
  for (const [e,d] of asShot) w.push((e.classList.contains('desc')?'scene description':'dialogue')+' text overflows its box by '+d+' px and runs under the choices'+(devBtns.length?(asPlayer.has(e)?' (also without the dev-only buttons)':' (only with the dev-only buttons; fits as a player sees it)'):''));
  clipX('.choice','choice'); clipX('.exit','exit'); clipX('.topbar','top bar'); clipX('.tb-left > *, .tb-right > *','top bar item'); clipX('.line','dialogue line');
  const tl=document.querySelector('.tb-left'), tr=document.querySelector('.tb-right'); if(tl&&tr&&hit(R(tl),R(tr))) w.push('top bar: left and right groups overlap');
  const tb=document.querySelector('.topbar'); if(tb) for(const c of tb.querySelectorAll('.tb-left > *, .tb-right > *')){const r=R(c); if(r.height>R(tb).height-4) w.push('top bar item wraps or is taller than the bar'); if(r.right>R(tb).right+1) w.push('top bar item runs off the bar');}
  const ch=[...document.querySelectorAll('.choice')]; for(let i=0;i<ch.length;i++) for(let j=i+1;j<ch.length;j++) if(hit(R(ch[i]),R(ch[j]))) w.push('choices '+(i+1)+' and '+(j+1)+' overlap');
  const ex=[...document.querySelectorAll('.exit, .phone-btn')]; for(let i=0;i<ex.length;i++) for(let j=i+1;j<ex.length;j++) if(hit(R(ex[i]),R(ex[j]))) w.push('exit buttons overlap');
  const st=document.querySelector('.strip'); if(st){ for(const e of ex) if(R(e).bottom>R(st).bottom+1||R(e).top<R(st).top-1) w.push('exit strip: a button sits outside the strip'); }
  const rp=document.querySelector('.right'); let below=0; if(rp&&rp.scrollHeight>rp.clientHeight+1){ below=rp.scrollHeight-rp.clientHeight; const last=ch[ch.length-1]; const hidden=last&&R(last).bottom>R(rp).bottom; w.push('right panel scrolls '+below+' px'+(hidden?' (last choice below the fold at 1440x900)':'')); }
  return {warn:[...new Set(w)], choices:ch.length, rightOverflow:below, lineFont:getComputedStyle(document.querySelector('.dialogue .line')||document.body).fontSize, choiceFont:getComputedStyle(ch[0]||document.body).fontSize, ...${SIZES({topbar:'.tb-day', topbarSmall:'.tb-legend', who:'.portrait .who', chip:'.portrait .chip', desc:'.right .desc', exit:'.exit', phoneBtn:'.phone-btn'})}};})()`;

/** In-page layout probe for the open phone: the camera cutout covers nothing interactive, tabs fit, pane text not cut. */
const PHONE_PROBE = `(()=>{const w=[]; const ph=document.querySelector('.phone'); if(!ph||ph.hidden) return {warn:['phone not open']};
  const R=(e)=>e.getBoundingClientRect(); const hit=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  const isl=ph.querySelector('.ph-island'); const ir=isl&&R(isl);
  const items=[...ph.querySelectorAll('button,input,textarea,select,a[href],label')].filter(e=>e.getClientRects().length);
  if(!isl) w.push('no camera cutout'); else for(const e of items) if(hit(R(e),ir)) w.push('camera cutout covers '+e.tagName.toLowerCase()+'.'+e.className);
  const f=items[0]; if(f){const r=R(f); const at=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); if(!(at&&(at===f||f.contains(at)))) w.push('first control not reachable');}
  const tabs=ph.querySelector('.ph-tabs'); if(tabs&&tabs.scrollWidth>tabs.clientWidth+1) w.push('phone tabs do not fit');
  ph.querySelectorAll('.ph-tab').forEach(t=>{ if(t.scrollWidth>t.clientWidth+1) w.push('phone tab cut off: '+t.textContent); if(R(t).height>60) w.push('phone tab wraps: '+t.textContent); });
  const pane=ph.querySelector('.ph-pane'); if(pane&&pane.scrollHeight>pane.clientHeight+1) w.push('phone pane scrolls '+(pane.scrollHeight-pane.clientHeight)+' px');
  const ta=ph.querySelector('.ph-journal'); if(ta&&R(ta).height<140) w.push('journal box only '+Math.round(R(ta).height)+' px tall');
  return {warn:[...new Set(w)], island:ir&&{w:Math.round(ir.width),h:Math.round(ir.height)}, tabFont:getComputedStyle(ph.querySelector('.ph-tab')||ph).fontSize, ...${SIZES({hint:'.phone .ph-hint', journal:'.phone .ph-journal', ctName:'.phone .ct-name', ctMeta:'.phone .ct-talk', profileQ:'.phone .ph-q legend'})}};})()`;

// ---------------------------------------------------------------- browser
const raw = JSON.parse(readFileSync(join(here, 'themes.json'), 'utf8')).themes;
const byId = new Map(raw.map((t) => [t.id, t]));
/** `extends` copies the base theme's fonts and palette (own keys win); scale defaults to 1, phoneScale to scale, smallScale to 1. */
const all = raw.map((t) => {
  const b = t.extends ? byId.get(t.extends) : null;
  if (t.extends && !b) throw new Error(`theme ${t.id}: extends unknown theme ${t.extends}`);
  const m = b ? { ...b, mood: b.mood, ...t, palette: { ...b.palette, ...(t.palette ?? {}) } } : { ...t };
  m.scale = +(t.scale ?? 1); m.phoneScale = +(t.phoneScale ?? m.scale); m.smallScale = +(t.smallScale ?? 1);
  return m;
});
const themes = only?.length ? all.filter((t) => only.includes(t.id)) : all;
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const out = join(here, 'out', stamp); mkdirSync(join(out, 'png'), { recursive: true }); mkdirSync(join(out, 'jpg'), { recursive: true }); mkdirSync(join(out, 'html'), { recursive: true });
const profile = join(here, 'out', '.profile');

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1440,900', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => chrome.kill());
let targets; for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets?.length) break; } catch {} await sleep(250); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else if (msg.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)); };
const send = (method, params = {}, ms = 20000) => new Promise((r, j) => { const i = ++id; const to = setTimeout(() => { pending.delete(i); j(new Error(`timeout ${method}`)); }, ms); pending.set(i, (m) => { clearTimeout(to); r(m); }); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: DSF, mobile: false });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text); return r.result?.result?.value; };
const shot = async (name, clip) => {
  const png = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  writeFileSync(join(out, 'png', name + '.png'), Buffer.from(png.result.data, 'base64'));
  // the clip scale multiplies the device scale factor: full screens come out 1440 px wide, phone crops 720 px wide (2x of 360)
  const w = clip ? clip.width : 1440, h = clip ? clip.height : 900, scale = (clip ? Math.min(DSF, 720 / w) : 1) / DSF;
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
// ---------------------------------------------------------------- HTML rendition
// Per theme, html/<id>.html: the right panel (twice: a beat with a stage direction and the Next triangle, then the same
// row's last beat with its three choices) and the phone (journal, contacts) as the game's own DOM, styled by src/style.css
// (copied in verbatim) plus exactly the CSS this script injects for the theme, so the text is vector and the sizes are the
// game's. Dev-only elements (Back / edit buttons, the status line, the contacts' debug line) are left out; the busts and
// contact photos are one neutral inline SVG. Its sizes are checked against the game's after the run (see verifyRenditions).
const REND = { npc: 'us_stranger_a', scene: 'park', slot: 'by_fence', row: 'WT28' };
const BUST = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 290 290"><g fill="#8d887e" fill-opacity=".55"><circle cx="145" cy="112" r="56"/><path d="M38 290c0-68 48-110 107-110s107 42 107 110z"/></g></svg>`);
const GRAB = (sel) => `(()=>{const r=document.querySelector(${JSON.stringify(sel)}); const c=r.cloneNode(true);
  c.querySelectorAll('.dev-back,.dev-edit-open,.status,.ct-debug').forEach(e=>e.remove());
  const ta=r.querySelector('textarea'), tc=c.querySelector('textarea'); if(ta&&tc) tc.textContent=ta.value;
  c.querySelectorAll('img').forEach(i=>i.setAttribute('src','__BUST__'));
  const b=r.getBoundingClientRect(); return {html:c.outerHTML, w:Math.round(b.width), h:Math.round(b.height)};})()`;
async function captureRendition() {
  await ev(`gv.game.phoneOpen=false; gv.goto('${REND.scene}'); gv.actions(10); gv.place('${REND.npc}','${REND.slot}'); gv.talk('${REND.npc}',{force:true}); true`);
  await sleep(250);
  const right = [];
  for (const beat of [0, 1]) {
    const ok = await ev(`(()=>{const p=gv.panel(); const row=gv.content.dialogue.get('${REND.npc}')?.find(r=>r.id==='${REND.row}'); if(!row||p.kind!=='dialogue'||p.npc!=='${REND.npc}') return false; gv.game.panel={...p,row,beat:${beat}}; gv.game.render(); return true})()`);
    if (!ok) throw new Error(`rendition: could not show ${REND.npc} row ${REND.row}`);
    await sleep(200); right.push(await ev(GRAB('.right')));
  }
  await ev(`gv.game.phoneTab='journal'; gv.game.journalDraft=${JSON.stringify(JOURNAL)}; document.querySelector('.phone-btn').click(); true`); await sleep(250);
  const journal = await ev(GRAB('.phone'));
  await ev(`[...document.querySelectorAll('.ph-tab')][1].click(); true`); await sleep(250);
  const contacts = await ev(GRAB('.phone'));
  await ev(`gv.game.phoneOpen=false; gv.game.phoneTab='journal'; gv.game.journalDraft=null; gv.game.render(); true`);
  return { right, journal, contacts };
}
const STYLE_CSS = readFileSync(join(here, '..', '..', 'src', 'style.css'), 'utf8');
function writeRendition(t, q, links, css, rd, sizes) {
  const e = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const sized = (x) => x.html.replace(/^<div /, `<div style="height:${x.h}px" `).replaceAll('__BUST__', BUST);
  const sz = Object.entries({ dialogue: sizes.line, choices: sizes.choice, 'scene description': sizes.desc, 'name tag': sizes.who, 'mood chip': sizes.chip, 'phone tabs': sizes.phoneTab, journal: sizes.journal, 'contact names': sizes.ctName, 'contact detail': sizes.ctMeta }).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ');
  const cell = (cap, inner) => `<figure class="gvr-cell"><figcaption class="gvr-cap">${cap}</figcaption>${inner}</figure>`;
  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(t.name)} · HTML rendition</title>
${links.filter((l) => l.url).map((l) => `<link rel="stylesheet" href="${e(l.url)}">`).join('\n')}
<style>/* src/style.css, copied verbatim */
${STYLE_CSS}</style>
<style>/* the theme exactly as tools/themes/shoot.mjs injects it into the game: colours, fonts and the type scale */
${css}</style>
<style>/* rendition layout only: the panels side by side at their real size; no type sizes for game elements */
body.gvr { height: auto; min-height: 100%; overflow: auto; background: ${q.strip}; color: ${q.stripInk}; }
.gvr-top { font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; padding: 20px 24px 0; max-width: 1100px; }
.gvr-top h1 { font: 600 19px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; margin: 0 0 4px; }
.gvr-top p { margin: 0 0 4px; opacity: .85; }
.stage.gvr-stage { position: static; width: auto; height: auto; overflow: visible; display: block; background: transparent; }
.gvr-row { display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-start; padding: 18px 24px 48px; }
.gvr-cell { margin: 0; flex: none; }
.gvr-cap { font: 600 12px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; letter-spacing: .06em; text-transform: uppercase; color: ${q.stripInk}; opacity: .8; margin: 0 0 8px; }
.gvr-row .right { flex: none; border-radius: 4px; }
.gvr-row .phone { position: relative; left: auto; bottom: auto; z-index: auto; }
</style></head>
<body class="gvr">
<header class="gvr-top"><h1>${e(t.name)}</h1>
<p>${e(t.serifStack ? t.serifStack.split(',')[0] : t.serif)} for dialogue, ${e(t.uiStack ? t.uiStack.split(',')[0] : t.ui)} for the interface. Text ${t.scale}&times;${t.phoneScale !== t.scale ? `, phone ${t.phoneScale}&times;` : ''}${t.smallScale !== 1 ? `, small text a further ${t.smallScale}&times;` : ''}.</p>
<p>Rendered from the game's own markup and stylesheet with this theme's CSS, at 1:1 CSS pixels (zoom in: the text stays sharp). Sizes measured in the game: ${e(sz)}. Portraits are a neutral placeholder; dev-only buttons are left out.</p></header>
<div class="stage gvr-stage"><div class="gvr-row">
${cell('Right panel &middot; a beat with a stage direction', sized(rd.right[0]))}
${cell('Right panel &middot; the last beat, three choices', sized(rd.right[1]))}
${cell('Phone &middot; journal', sized(rd.journal))}
${cell('Phone &middot; contacts', sized(rd.contacts))}
</div></div>
</body></html>
`;
  writeFileSync(join(out, 'html', t.id + '.html'), page);
}

const results = [];
async function shootTheme(t) {
  await setup(); // the same fresh game state for every theme (the contacts' talk counts, rapport, the day)
  const q = fullPalette(t.palette); const checks = contrastChecks(q); const warn = checks.filter((c) => !c.ok);
  for (const w of warn) console.log(`  ! ${t.id}: ${w.what} ${w.fg} on ${w.bg} = ${w.ratio}:1 (< ${w.min})`);
  const fams = [...new Set([t.serifStack ? null : t.serif, t.uiStack ? null : t.ui].filter(Boolean))];
  const links = [];
  for (const f of fams) { const u = await fontUrl(f, f === t.serif); links.push({ family: f, url: u?.url ?? null, spec: u?.spec ?? null }); }
  await ev(`(()=>{document.querySelectorAll('[data-gv-theme]').forEach(e=>e.remove()); return true})()`);
  const scaled = t.scale !== 1 || t.phoneScale !== 1 || t.smallScale !== 1;
  const scaleCss = scaled ? await ev(scaleCssExpr(t.scale, t.phoneScale, t.smallScale)) : '';
  const css = themeCss(t, q) + (scaleCss ? '\n/* type scale ' + t.scale + ', phone ' + t.phoneScale + ', small text ' + t.smallScale + ' */\n' + scaleCss : '');
  await ev(`(()=>{
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
  const mainLayout = await ev(MAIN_PROBE);
  await shot(`${t.id}_main`);
  // (b) phone open on the journal tab, then the contacts tab
  await ev(`gv.game.phoneTab='journal'; gv.game.journalDraft=${JSON.stringify(JOURNAL)}; document.querySelector('.phone-btn').click(); true`);
  await sleep(250);
  await shot(`${t.id}_phone`);
  const rect = await ev(`(()=>{const r=document.querySelector('.phone').getBoundingClientRect(); return {x:Math.max(0,r.x-12),y:Math.max(0,r.y-12),width:Math.min(1440,r.width+24),height:Math.min(900,r.height+24)}})()`);
  await shot(`${t.id}_phone_journal`, rect);
  const journalLayout = await ev(PHONE_PROBE);
  await ev(`[...document.querySelectorAll('.ph-tab')][1].click(); true`); await sleep(250);
  const contacts = await ev(`document.querySelectorAll('.ph-contacts li').length`);
  await shot(`${t.id}_phone_contacts`, rect);
  const contactsLayout = await ev(PHONE_PROBE);
  // the opening questions (SPEC: a single screen), worst case: heritage `in` with both follow-ups shown; state restored after
  await ev(`gv.game.s.player.profilePending=true; gv.game.profileDraft={heritage:'in'}; gv.game.phoneOpen=true; gv.game.render(); true`); await sleep(250);
  await shot(`${t.id}_phone_profile`, rect);
  const profileLayout = await ev(PHONE_PROBE);
  await ev(`gv.game.s.player.profilePending=false; gv.game.profileDraft={}; gv.game.phoneOpen=false; gv.game.render(); true`);
  await ev(`gv.game.phoneOpen=false; gv.game.phoneTab='journal'; gv.game.render(); true`);
  // (c) lead on twice in the conversation, so longer lines and choice lists are checked too; the last state is shot as _later
  const laterWarn = [];
  for (let k = 0; k < 2; k++) {
    const ok = await ev(`(()=>{const c=[...document.querySelectorAll('.choices .choice:not(.dev-back):not([disabled])')].filter(e=>!/edit \\(dev\\)/.test(e.textContent)); const e=c.find(e=>e.classList.contains('next'))||c[1]||c[0]; if(!e) return false; e.click(); return true})()`);
    if (!ok) break; await sleep(250);
    for (const w of (await ev(MAIN_PROBE)).warn) if (!mainLayout.warn.includes(w)) laterWarn.push(`after ${k + 1} click${k ? "s" : ""} in the conversation: ${w}`);
  }
  mainLayout.warn.push(...new Set(laterWarn));
  await sleep(150);
  await shot(`${t.id}_later`);
  // (d) the HTML rendition: the right panel and the phone as DOM, with this theme's injected CSS (see writeRendition)
  const rendition = await captureRendition();
  const failed = Object.entries(fontState).filter(([, ok]) => !ok).map(([f]) => f).concat(links.filter((l) => !l.url).map((l) => l.family + ' (no css)'));
  const layout = [...mainLayout.warn.map((x) => 'main: ' + x), ...journalLayout.warn.map((x) => 'phone journal: ' + x), ...contactsLayout.warn.map((x) => 'phone contacts: ' + x), ...profileLayout.warn.map((x) => 'phone opening questions: ' + x.replace(/^phone pane scrolls (\d+) px$/, 'Begin needs scrolling ($1 px; SPEC wants one screen)'))];
  for (const l of layout) console.log(`  ~ ${t.id}: ${l}`);
  const { warn: _w1, choices: _c, rightOverflow: _r, lineFont, choiceFont, ...mainSizes } = mainLayout;
  const sizes = { line: lineFont, choice: choiceFont, phoneTab: journalLayout.tabFont, ...mainSizes, hint: journalLayout.hint, journal: journalLayout.journal, ctName: contactsLayout.ctName, ctMeta: contactsLayout.ctMeta, profileQ: profileLayout.profileQ, island: journalLayout.island };
  writeRendition(t, q, links, css, rendition, sizes);
  return { t, q, checks, warn, links, fontState, failed, probe, contacts, layout, sizes };
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
  const { warn, failed, probe, contacts, layout, sizes } = r; results.push(r);
  console.log(`${t.id.padEnd(22)} fonts:${failed.length ? ' FAILED ' + failed.join(',') : ' ok'}  contrast:${warn.length ? ' ' + warn.length + ' warn' : ' ok'}  layout:${layout.length ? ' ' + layout.length + ' note' : ' ok'}  choices:${probe.choices} contacts:${contacts}  line ${sizes.line} choice ${sizes.choice}`);
}
// each HTML rendition, opened on its own: its text sizes must be the ones measured in the game
const REND_SIZES = { line: '.dialogue .line:not(.stage)', choice: '.choice:not(.next)', desc: '.right .desc', who: '.portrait .who', chip: '.portrait .chip', phoneTab: '.ph-tab', journal: '.ph-journal', hint: '.ph-hint', ctName: '.ct-name', ctMeta: '.ct-talk' };
for (const r of results) {
  try {
    await send('Page.navigate', { url: pathToFileURL(join(out, 'html', r.t.id + '.html')).href }); await sleep(1200);
    await ev(`document.fonts.ready.then(()=>true)`);
    const got = await ev(SIZES(REND_SIZES));
    const stage = await ev(`getComputedStyle(document.querySelector('.line.stage')).fontSize`);
    r.rendition = { sizes: got, stage, mismatch: Object.keys(REND_SIZES).filter((k) => got[k] !== r.sizes[k]).map((k) => `${k}: game ${r.sizes[k]}, html ${got[k]}`), errors: errors.length };
    r.sizes.stage = stage;
    if (r.rendition.mismatch.length) console.log(`  ! ${r.t.id} html rendition differs: ${r.rendition.mismatch.join('; ')}`);
  } catch (e) { r.rendition = { mismatch: ['not checked: ' + e.message] }; console.log(`  ! ${r.t.id} html rendition not checked (${e.message})`); }
}
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}

// ---------------------------------------------------------------- gallery
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SW = ['panel', 'panel2', 'card', 'ink', 'muted', 'accent', 'amber', 'topbar', 'strip', 'line'];
const rootBlock = (r) => (r.t.scale !== 1 || r.t.phoneScale !== 1 || r.t.smallScale !== 1 ? `  /* type scale ${r.t.scale}, phone ${r.t.phoneScale}, small text x${r.t.smallScale} more: multiply the px font sizes in style.css (see scaleCssExpr in shoot.mjs) */\n` : '') + `  --ink: ${r.q.ink};\n  --panel: ${r.q.panel};\n  --panel2: ${r.q.panel2};\n  --accent: ${r.q.accent};\n  --amber: ${r.q.amber};\n  --muted: ${r.q.muted};\n  --ui: ${r.t.uiStack ?? fontStack(r.t.ui, UI_FB)};\n  --serif: ${r.t.serifStack ?? fontStack(r.t.serif, SERIF_FB)};`;
const card = (r, i) => {
  const { t } = r;
  const fonts = `<b>Dialogue</b> ${esc(t.serifStack ? 'system: ' + t.serifStack.split(',')[0] : t.serif)} &middot; <b>UI</b> ${esc(t.uiStack ? 'system: ' + t.uiStack.split(',')[0] : t.ui)}`;
  const warn = r.warn.length ? `<p class="warn">Contrast below 4.5:1: ${r.warn.map((w) => `${esc(w.what)} ${w.ratio}:1`).join('; ')}</p>` : '';
  const ff = r.failed.length ? `<p class="warn">Font not loaded: ${esc(r.failed.join(', '))}</p>` : '';
  const s = r.sizes;
  const sc = `<p class="scale">Type scale <b>${t.scale}&times;</b>${t.phoneScale !== t.scale ? ` (phone ${t.phoneScale}&times;)` : ''}, small text <b>${t.smallScale}&times;</b> on top: dialogue ${esc(s.line)}, choices ${esc(s.choice)}, phone tabs ${esc(s.phoneTab)}, top bar ${esc(s.topbar)}, name tag ${esc(s.who)}, chip ${esc(s.chip)}, scene description ${esc(s.desc)}, exits ${esc(s.exit)}, journal ${esc(s.journal)}, contact detail ${esc(s.ctMeta)}</p>`
    + (r.rendition?.mismatch?.length ? `<p class="warn">HTML rendition sizes differ: ${esc(r.rendition.mismatch.join('; '))}</p>` : '');
  const lay = r.layout.length ? `<p class="warn">At 1440x900: ${r.layout.map(esc).join('; ')}</p>` : '';
  return `<section class="theme" id="${t.id}">
  <header><span class="num">${i + 1}</span><h2>${esc(t.name)}</h2><span class="mood">${esc(t.mood)}</span>${t.scale !== 1 ? `<span class="mood">${t.scale}&times; text</span>` : ''}<code>${t.id}</code></header>
  <p class="fonts">${fonts} <span class="cr">ink/panel ${r.checks[0].ratio}:1 &middot; muted/panel ${r.checks[1].ratio}:1</span></p>
  <div class="sw">${SW.map((k) => `<span title="${k} ${r.q[k]}"><i style="background:${r.q[k]}"></i>${k}<br><code>${r.q[k]}</code></span>`).join('')}</div>
  ${sc}${warn}${ff}${lay}
  <div class="pair"><a href="png/${t.id}_main.png"><img loading="lazy" src="jpg/${t.id}_main.jpg" alt="main screen"></a><a href="png/${t.id}_phone.png"><img loading="lazy" src="jpg/${t.id}_phone.jpg" alt="phone open"></a></div>
  <p class="links">Full size: <a href="png/${t.id}_main.png">main</a> &middot; <a href="png/${t.id}_phone.png">phone (full screen)</a> &middot; <a href="png/${t.id}_phone_journal.png">phone journal</a> &middot; <a href="png/${t.id}_phone_contacts.png">phone contacts</a> &middot; <a href="png/${t.id}_phone_profile.png">phone opening questions</a> &middot; <a href="png/${t.id}_later.png">two clicks later</a> &middot; <a href="html/${t.id}.html">open as HTML</a></p>
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
.warn{color:#b3261e;font-weight:600;margin:4px 0}.scale{margin:4px 0}
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
writeFileSync(join(out, 'results.json'), JSON.stringify(results.map((r) => ({ id: r.t.id, scale: r.t.scale, phoneScale: r.t.phoneScale, smallScale: r.t.smallScale, sizes: r.sizes, rendition: r.rendition, layoutWarnings: r.layout, fonts: r.links, fontLoaded: r.fontState, failed: r.failed, contrastWarnings: r.warn, probe: r.probe, contacts: r.contacts })), null, 2));
console.log(`\n${results.length} themes -> ${join(out, 'index.html')}`);
console.log(`font failures: ${results.filter((r) => r.failed.length).map((r) => r.t.id + '(' + r.failed + ')').join(' ') || 'none'}`);
console.log(`contrast warnings: ${results.filter((r) => r.warn.length).map((r) => r.t.id).join(' ') || 'none'}`);
console.log(`layout notes: ${results.filter((r) => r.layout.length).map((r) => r.t.id).join(' ') || 'none'}`);
console.log(`html renditions differing from the game: ${results.filter((r) => r.rendition?.mismatch?.length).map((r) => r.t.id).join(' ') || 'none'}`);
console.log(`page errors: ${errors.length}`); for (const e of errors.slice(0, 5)) console.log('  ' + e.slice(0, 200));
process.exit(0);
