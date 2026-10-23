// Alternative uses (Guilford): list as many different uses for an everyday object as you can in 90 seconds.
// Contract: see CONTRACT.md. Score = fluency (distinct uses); everything typed is kept in `responses`.
(function () {
  // The object bank. `id` is the stable id logged in `items`; `a` is how the prompt names it.
  const BANK = [
    { id: 'brick', a: 'a brick' },
    { id: 'paper-clip', a: 'a paper clip' },
    { id: 'shoe', a: 'a shoe' },
    { id: 'newspaper', a: 'a newspaper' },
    { id: 'tin-can', a: 'a tin can' },
    { id: 'rope', a: 'a length of rope' },
    { id: 'rubber-band', a: 'a rubber band' },
    { id: 'bucket', a: 'a bucket' },
    { id: 'umbrella', a: 'an umbrella' },
    { id: 'wooden-spoon', a: 'a wooden spoon' },
    { id: 'bed-sheet', a: 'a bed sheet' },
    { id: 'coat-hanger', a: 'a coat hanger' },
    { id: 'cardboard-box', a: 'a cardboard box' },
    { id: 'pencil', a: 'a pencil' },
    { id: 'sock', a: 'a sock' },
    { id: 'plastic-bottle', a: 'a plastic bottle' },
    { id: 'towel', a: 'a towel' },
    { id: 'key', a: 'a key' },
    { id: 'mug', a: 'a mug' },
    { id: 'chair', a: 'a chair' },
  ];
  const SECONDS = 90;

  // FNV-1a + mulberry32, as in work.html: a per-player permutation of the bank that is stable across the week.
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function permFor(seed) {
    const r = mulberry32(hashStr(`${seed}|aut|bank`));
    const p = BANK.map((_, i) => i);
    for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    return p;
  }
  function pickObject(ctx) {
    const day = Math.max(1, Number(ctx.day) || 1), shift = Math.max(0, Number(ctx.shift) || 0);
    const slot = (day - 1) * 4 + Math.min(shift, 3);
    const perm = permFor(ctx.seed ?? '');
    return BANK[perm[slot % perm.length]];
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const norm = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();

  const CSS = `
    .aut-top { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
    .aut-entry { display: flex; gap: 10px; align-items: stretch; }
    .aut-entry input { flex: 1; }
    .aut-note { min-height: 1.4em; margin: 0; font-size: 15px; }
    .aut-list { margin: 0; padding-left: 2.2em; columns: 2 280px; column-gap: 32px; font-size: 18px; line-height: 1.5; }
    .aut-list li { break-inside: avoid; }
    .aut-list li.new { animation: ok .4s; }
    .aut-foot { display: flex; justify-content: flex-end; }
  `;

  window.GV_TASKS = window.GV_TASKS || {};
  window.GV_TASKS.aut = {
    id: 'aut',
    title: 'Odds and ends',
    blurb: 'Marketing wants ideas: as many different uses for an everyday object as you can think of in a minute and a half.',
    seconds: SECONDS,
    run(root, ctx, done) {
      const el = ctx.el;
      const obj = pickObject(ctx);
      const started = performance.now();
      const ms = () => Math.round(performance.now() - started);
      const seen = new Set();
      const responses = []; // every submitted entry, in order, as typed
      let finished = false;

      const style = el('style', { textContent: CSS });
      const cd = ctx.countdown(SECONDS, () => finish('time'));
      const score = el('div', { className: 'score', textContent: '0 uses so far' });
      score.setAttribute('aria-live', 'polite');
      const prompt = el('p', { className: 'prompt', textContent: `${cap(obj.a)}. List as many different uses for it as you can.` });
      const input = el('input', { type: 'text', autocomplete: 'off', spellcheck: true, maxLength: 200, placeholder: 'Type a use and press Enter' });
      input.setAttribute('aria-label', `A use for ${obj.a}`);
      const add = el('button', { className: 'btn', type: 'button', textContent: 'Add' });
      add.setAttribute('aria-label', 'Add this use to the list');
      const note = el('p', { className: 'aut-note muted', role: 'status' });
      const list = el('ol', { className: 'aut-list' });
      list.setAttribute('aria-label', `Uses for ${obj.a}`);
      const finishBtn = el('button', { className: 'btn ghost', type: 'button', textContent: 'Finish early', hidden: true });

      root.append(
        style,
        el('div', { className: 'aut-top' }, cd.el, score),
        prompt,
        el('div', { className: 'aut-entry' }, input, add),
        note,
        list,
        el('div', { className: 'aut-foot' }, finishBtn),
      );

      const distinct = () => responses.filter((r) => !r.dup && !r.unsent).length;
      const usesWord = (n) => `${n} use${n === 1 ? '' : 's'}`;

      function submit() {
        if (finished) return;
        const raw = input.value;
        const key = norm(raw);
        if (!key) { input.value = ''; input.focus(); return; }
        const dup = seen.has(key);
        responses.push({ object: obj.id, text: raw, ms: ms(), ...(dup ? { dup: true } : {}) });
        input.value = '';
        if (dup) {
          note.textContent = `"${raw.trim()}" is already on your list. Try something different.`;
        } else {
          seen.add(key);
          note.textContent = '';
          list.querySelector('li.new')?.classList.remove('new');
          list.append(el('li', { className: 'new', textContent: raw.trim() }));
          const n = distinct();
          score.textContent = `${usesWord(n)} so far`;
          finishBtn.hidden = false;
        }
        input.focus();
      }

      function finish(why) {
        if (finished) return;
        finished = true;
        cd.stop();
        input.disabled = true; add.disabled = true; finishBtn.disabled = true;
        const left = input.value;
        if (left.trim()) responses.push({ object: obj.id, text: left, ms: ms(), unsent: true });
        const n = distinct();
        done({
          summary: `You listed ${usesWord(n)} for ${obj.a}.`,
          score: n,
          responses,
          items: [obj.id],
          object: obj.a,
          ended: why,
        });
      }

      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
      input.addEventListener('input', () => { if (note.textContent) note.textContent = ''; });
      add.onclick = submit;
      finishBtn.onclick = () => { if (distinct() > 0) finish('early'); else input.focus(); };
      input.focus();

      return { stop() { finished = true; cd.stop(); } };
    },
  };
})();
