// Keyword list: ten words as different from each other as possible (Divergent Association Task, Olson et al. 2021).
// See CONTRACT.md. No live score (that needs word embeddings); responses carry the words for later scoring.
window.GV_TASKS = window.GV_TASKS || {};
window.GV_TASKS.dat = {
  id: 'dat',
  title: 'Keyword list',
  blurb: 'The inventory system needs ten keywords that have nothing to do with each other. Single words, no names.',
  seconds: 150,
  run(root, ctx, done) {
    const N = 10, MIN = 7, el = ctx.el, t0 = Date.now();
    let ended = false;

    root.append(el('style', { textContent: `
      .task.dat { gap: 12px; }
      .task.dat .prompt { font-size: 22px; }
      .dat-rules { margin: 0; padding-left: 20px; line-height: 1.4; font-size: 15px; }
      .dat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 28px; }
      .task.dat .dat-row input[type=text] { font-size: 18px; padding: 6px 12px; }
      .dat-head { flex-wrap: nowrap; align-items: flex-start; }
      .dat-left { display: flex; flex-direction: column; gap: 2px; }
      @media (max-width: 640px) { .dat-grid { grid-template-columns: 1fr; } }
      .dat-row { display: flex; align-items: center; gap: 10px; }
      .dat-row label { width: 2em; text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }
      .dat-row input[aria-invalid=true] { border-color: #8a2a1f; }
      .dat-row input.ok { border-color: var(--accent); }
      .dat-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      .dat-note { min-height: 1.5em; margin: 0; }
    ` }));

    root.classList.add('dat');
    const head = el('div', { className: 'dat-bar dat-head' },
      el('p', { className: 'prompt', textContent: 'Enter ten words that are as different from each other as possible, in all meanings and uses.' }));
    const cd = ctx.countdown(this.seconds, () => finish('time'));
    head.append(cd.el);
    const rules = el('ul', { className: 'dat-rules muted' },
      el('li', { textContent: 'Only single words, one per box.' }),
      el('li', { textContent: 'Only nouns: things, objects, concepts.' }),
      el('li', { textContent: 'No proper nouns: no specific people or places.' }),
      el('li', { textContent: 'No specialised vocabulary: no technical terms.' }),
      el('li', { textContent: 'Think of the words yourself; don’t just name things you can see around you.' }));

    const grid = el('div', { className: 'dat-grid' });
    const inputs = [], lastEdit = new Array(N).fill(null);
    // column-major order so 1-5 run down the left and 6-10 down the right
    const order = [0, 5, 1, 6, 2, 7, 3, 8, 4, 9];
    for (let i = 0; i < N; i++) {
      const id = `dat-w${i + 1}`;
      const inp = el('input', { type: 'text', id, autocomplete: 'off', spellcheck: false, maxLength: 40 });
      inp.setAttribute('autocapitalize', 'none');
      inp.setAttribute('aria-describedby', 'dat-note');
      inp.addEventListener('input', () => { lastEdit[i] = Date.now() - t0; inp.removeAttribute('aria-invalid'); inp.classList.remove('ok'); refresh(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); enter(i); } });
      inp.addEventListener('change', () => { if (inp.value.trim()) check(i, true); });
      inputs.push(inp);
    }
    for (const i of order) grid.append(el('div', { className: 'dat-row' }, el('label', { htmlFor: `dat-w${i + 1}`, textContent: `${i + 1}.` }), inputs[i]));

    const note = el('p', { className: 'dat-note err', id: 'dat-note', role: 'status' });
    const count = el('span', { className: 'muted' });
    const fin = el('button', { className: 'btn', type: 'button', textContent: 'Finish' });
    fin.onclick = () => finish('button');
    root.append(head, rules, grid, el('div', { className: 'dat-bar' }, el('div', { className: 'dat-left' }, count, note), fin));

    const clean = (s) => s.trim();
    /** Why this word can't be accepted in box i, or '' if it can. */
    function problem(i) {
      const w = clean(inputs[i].value);
      if (!w) return 'empty';
      if (/\s/.test(w)) return 'One word per box, please.';
      if (!/^\p{L}+(?:[-'’]\p{L}+)*$/u.test(w)) return 'Letters only, please (no numbers or symbols).';
      if ((w.match(/\p{L}/gu) || []).length < 2) return 'Words need at least two letters.';
      const lw = w.toLowerCase();
      for (let j = 0; j < N; j++) if (j !== i && clean(inputs[j].value).toLowerCase() === lw && !problemBasic(j)) {
        // the word typed first keeps it (ties: the lower box); the other one is the duplicate
        const tj = lastEdit[j] ?? Infinity, ti = lastEdit[i] ?? Infinity;
        if (tj < ti || (tj === ti && j < i)) return `“${w}” is already in box ${j + 1}.`;
      }
      return '';
    }
    function problemBasic(i) {
      const w = clean(inputs[i].value);
      return !w || /\s/.test(w) || !/^\p{L}+(?:[-'’]\p{L}+)*$/u.test(w) || (w.match(/\p{L}/gu) || []).length < 2;
    }
    const validSlots = () => inputs.map((_, i) => i).filter((i) => !problem(i));

    function refresh() {
      const valid = new Set(validSlots());
      inputs.forEach((x, j) => { if (valid.has(j)) { x.removeAttribute('aria-invalid'); if (x !== document.activeElement) x.classList.add('ok'); } else x.classList.remove('ok'); });
      const n = valid.size;
      count.textContent = n >= MIN ? `${n} of ${N} words.` : `${n} of ${N} words. Finish opens at ${MIN}.`;
      fin.disabled = ended || n < MIN;
    }
    /** Show or clear the note for box i; returns true if the word is accepted. */
    function check(i, show) {
      const p = problem(i), inp = inputs[i];
      if (!p) { inp.classList.add('ok'); inp.removeAttribute('aria-invalid'); if (show) note.textContent = ''; return true; }
      if (p === 'empty') { if (show) note.textContent = 'Type a word first.'; return false; }
      inp.setAttribute('aria-invalid', 'true'); inp.classList.remove('ok');
      if (show) note.textContent = `Box ${i + 1}: ${p}`;
      return false;
    }
    function enter(i) {
      if (ended || !check(i, true)) return;
      for (let k = 1; k <= N; k++) {
        const j = (i + k) % N;
        if (problem(j)) { inputs[j].focus(); return; }
      }
      finish('complete'); // all ten boxes hold accepted words
    }

    function finish(how) {
      if (ended) return;
      if (how === 'button' && validSlots().length < MIN) return;
      ended = true; cd.stop(); fin.disabled = true;
      inputs.forEach((x) => { x.readOnly = true; });
      const ok = new Set(validSlots());
      const responses = [], rejected = [];
      for (let i = 0; i < N; i++) {
        const text = inputs[i].value;
        if (ok.has(i)) responses.push({ slot: i + 1, word: clean(text), ms: lastEdit[i] });
        else if (text.trim()) rejected.push({ slot: i + 1, text, reason: problem(i), ms: lastEdit[i] });
      }
      const n = responses.length;
      done({
        summary: n === 0 ? 'You listed no words.' : `You listed ${n} word${n === 1 ? '' : 's'}.`,
        score: null, responses, rejected, ended: how,
      });
    }

    refresh();
    inputs[0].focus();
    return { stop() { ended = true; cd.stop(); } };
  },
};
