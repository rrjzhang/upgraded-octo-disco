// Word links: compound remote associates (three cue words, one word that makes a common compound or phrase
// with each: cottage / swiss / cake -> cheese). Items follow the normed compound remote associate lists
// (Bowden & Jung-Beeman 2003) and Mednick-style triads, each cue checked to form a familiar compound or
// two-word phrase with the answer. See CONTRACT.md for the run(root, ctx, done) contract.
(function () {
  const ITEMS_PER_SHIFT = 8;
  const ITEM_SECONDS = 15;
  const FEEDBACK_MS = 1100;

  // 20 sets of 8 (160 triads). Each set mixes easy, medium and hard items (easy first, hard last in the
  // listing; the order shown is shuffled per shift). Answers are unique across the bank, and no set has a cue
  // that is another item's answer in the same set. `alt` lists other accepted answers; a plain -s/-es plural of
  // the answer is accepted everywhere.
  const SETS = [
  // set 0: EEEMMMHH
  [
    { cues: ['cream', 'skate', 'water'], answer: 'ice', alt: [] },
    { cues: ['break', 'attack', 'beat'], answer: 'heart', alt: [] },
    { cues: ['water', 'mine', 'shaker'], answer: 'salt', alt: [] },
    { cues: ['palm', 'family', 'apple'], answer: 'tree', alt: [] },
    { cues: ['base', 'snow', 'room'], answer: 'ball', alt: [] },
    { cues: ['jelly', 'coffee', 'kidney'], answer: 'bean', alt: [] },
    { cues: ['stick', 'service', 'read'], answer: 'lip', alt: [] },
    { cues: ['bump', 'egg', 'chase'], answer: 'goose', alt: [] },
  ],
  // set 1: EEEMMMHH
  [
    { cues: ['cottage', 'swiss', 'cake'], answer: 'cheese', alt: [] },
    { cues: ['melon', 'fall', 'proof'], answer: 'water', alt: [] },
    { cues: ['dress', 'dial', 'flower'], answer: 'sun', alt: [] },
    { cues: ['room', 'blood', 'salts'], answer: 'bath', alt: [] },
    { cues: ['fortune', 'jar', 'cutter'], answer: 'cookie', alt: [] },
    { cues: ['line', 'end', 'bolt'], answer: 'dead', alt: [] },
    { cues: ['mare', 'gown', 'club'], answer: 'night', alt: [] },
    { cues: ['ticket', 'shop', 'broker'], answer: 'pawn', alt: [] },
  ],
  // set 2: EEEMMMHH
  [
    { cues: ['flake', 'mobile', 'cone'], answer: 'snow', alt: [] },
    { cues: ['cut', 'spray', 'style'], answer: 'hair', alt: [] },
    { cues: ['kitchen', 'spoon', 'chicken'], answer: 'soup', alt: [] },
    { cues: ['falling', 'movie', 'dust'], answer: 'star', alt: [] },
    { cues: ['sleeping', 'trash', 'tea'], answer: 'bag', alt: [] },
    { cues: ['plant', 'shell', 'nest'], answer: 'egg', alt: [] },
    { cues: ['word', 'road', 'eyed'], answer: 'cross', alt: [] },
    { cues: ['officer', 'cash', 'larceny'], answer: 'petty', alt: [] },
  ],
  // set 3: EEEMMMHH
  [
    { cues: ['cracker', 'fly', 'fighter'], answer: 'fire', alt: [] },
    { cues: ['coast', 'life', 'body'], answer: 'guard', alt: [] },
    { cues: ['power', 'race', 'sea'], answer: 'horse', alt: [] },
    { cues: ['tooth', 'potato', 'heart'], answer: 'sweet', alt: [] },
    { cues: ['manners', 'round', 'tennis'], answer: 'table', alt: [] },
    { cues: ['quarters', 'phone', 'ache'], answer: 'head', alt: [] },
    { cues: ['hopper', 'land', 'roots'], answer: 'grass', alt: [] },
    { cues: ['fork', 'black', 'perfect'], answer: 'pitch', alt: [] },
  ],
  // set 4: EEMMMMHH
  [
    { cues: ['rocking', 'wheel', 'high'], answer: 'chair', alt: [] },
    { cues: ['finger', 'toe', 'polish'], answer: 'nail', alt: [] },
    { cues: ['river', 'note', 'account'], answer: 'bank', alt: [] },
    { cues: ['blank', 'list', 'mate'], answer: 'check', alt: [] },
    { cues: ['flower', 'friend', 'scout'], answer: 'girl', alt: [] },
    { cues: ['junk', 'man', 'chain'], answer: 'mail', alt: [] },
    { cues: ['way', 'lance', 'style'], answer: 'free', alt: [] },
    { cues: ['inch', 'deal', 'peg'], answer: 'square', alt: [] },
  ],
  // set 5: EEMMMMHH
  [
    { cues: ['fountain', 'baking', 'pop'], answer: 'soda', alt: [] },
    { cues: ['fruit', 'vine', 'juice'], answer: 'grape', alt: [] },
    { cues: ['night', 'wrist', 'stop'], answer: 'watch', alt: [] },
    { cues: ['coin', 'quick', 'spoon'], answer: 'silver', alt: [] },
    { cues: ['board', 'magic', 'out'], answer: 'black', alt: [] },
    { cues: ['snap', 'gun', 'mug'], answer: 'shot', alt: [] },
    { cues: ['pad', 'smith', 'air'], answer: 'lock', alt: [] },
    { cues: ['carpet', 'alert', 'ink'], answer: 'red', alt: [] },
  ],
  // set 6: EEMMMMHH
  [
    { cues: ['tooth', 'hair', 'paint'], answer: 'brush', alt: [] },
    { cues: ['cat', 'sword', 'jelly'], answer: 'fish', alt: [] },
    { cues: ['dream', 'break', 'light'], answer: 'day', alt: [] },
    { cues: ['type', 'ghost', 'screen'], answer: 'writer', alt: [] },
    { cues: ['washer', 'picture', 'sill'], answer: 'window', alt: [] },
    { cues: ['life', 'cat', 'flower'], answer: 'wild', alt: [] },
    { cues: ['fight', 'frog', 'dozer'], answer: 'bull', alt: [] },
    { cues: ['date', 'alley', 'fold'], answer: 'blind', alt: [] },
  ],
  // set 7: EEMMMMHH
  [
    { cues: ['butter', 'dragon', 'house'], answer: 'fly', alt: [] },
    { cues: ['ball', 'step', 'note'], answer: 'foot', alt: [] },
    { cues: ['dust', 'cereal', 'fish'], answer: 'bowl', alt: [] },
    { cues: ['cadet', 'capsule', 'ship'], answer: 'space', alt: [] },
    { cues: ['wheel', 'hand', 'shopping'], answer: 'cart', alt: [] },
    { cues: ['castle', 'paper', 'quick'], answer: 'sand', alt: [] },
    { cues: ['chamber', 'staff', 'box'], answer: 'music', alt: [] },
    { cues: ['mill', 'tooth', 'dust'], answer: 'saw', alt: [] },
  ],
  // set 8: EEMMMMHH
  [
    { cues: ['bed', 'class', 'waiting'], answer: 'room', alt: [] },
    { cues: ['milk', 'peanut', 'scotch'], answer: 'butter', alt: [] },
    { cues: ['aid', 'rubber', 'wagon'], answer: 'band', alt: [] },
    { cues: ['lounge', 'hour', 'napkin'], answer: 'cocktail', alt: [] },
    { cues: ['french', 'car', 'shoe'], answer: 'horn', alt: [] },
    { cues: ['board', 'time', 'hot'], answer: 'spring', alt: [] },
    { cues: ['cow', 'bus', 'tom'], answer: 'boy', alt: [] },
    { cues: ['cover', 'arm', 'wear'], answer: 'under', alt: [] },
  ],
  // set 9: EEMMMMHH
  [
    { cues: ['board', 'hole', 'chain'], answer: 'key', alt: [] },
    { cues: ['drop', 'storm', 'fall'], answer: 'rain', alt: ['snow'] },
    { cues: ['safety', 'cushion', 'point'], answer: 'pin', alt: [] },
    { cues: ['eight', 'skate', 'stick'], answer: 'figure', alt: [] },
    { cues: ['life', 'dinner', 'leather'], answer: 'jacket', alt: [] },
    { cues: ['wet', 'swim', 'business'], answer: 'suit', alt: [] },
    { cues: ['loser', 'throat', 'spot'], answer: 'sore', alt: [] },
    { cues: ['shine', 'beam', 'struck'], answer: 'moon', alt: [] },
  ],
  // set 10: EEMMMMHH
  [
    { cues: ['police', 'fire', 'gas'], answer: 'station', alt: [] },
    { cues: ['sea', 'home', 'car'], answer: 'sick', alt: [] },
    { cues: ['measure', 'video', 'duct'], answer: 'tape', alt: [] },
    { cues: ['trip', 'house', 'goal'], answer: 'field', alt: [] },
    { cues: ['pea', 'chest', 'dough'], answer: 'nut', alt: [] },
    { cues: ['cage', 'song', 'early'], answer: 'bird', alt: [] },
    { cues: ['duck', 'fold', 'dollar'], answer: 'bill', alt: [] },
    { cues: ['hound', 'pressure', 'shot'], answer: 'blood', alt: [] },
  ],
  // set 11: EEMMMMHH
  [
    { cues: ['cup', 'pan', 'pound'], answer: 'cake', alt: [] },
    { cues: ['playing', 'credit', 'report'], answer: 'card', alt: [] },
    { cues: ['pine', 'crab', 'sauce'], answer: 'apple', alt: [] },
    { cues: ['back', 'step', 'screen'], answer: 'door', alt: [] },
    { cues: ['shade', 'post', 'desk'], answer: 'lamp', alt: [] },
    { cues: ['rag', 'satellite', 'main'], answer: 'dish', alt: [] },
    { cues: ['ranger', 'tropical', 'national'], answer: 'forest', alt: [] },
    { cues: ['pie', 'luck', 'belly'], answer: 'pot', alt: [] },
  ],
  // set 12: EEMMMMHH
  [
    { cues: ['life', 'day', 'night'], answer: 'time', alt: [] },
    { cues: ['catcher', 'food', 'hot'], answer: 'dog', alt: [] },
    { cues: ['opera', 'hand', 'dish'], answer: 'soap', alt: [] },
    { cues: ['way', 'board', 'sleep'], answer: 'walk', alt: [] },
    { cues: ['pick', 'money', 'knife'], answer: 'pocket', alt: [] },
    { cues: ['paper', 'heavy', 'feather'], answer: 'weight', alt: [] },
    { cues: ['cane', 'daddy', 'plum'], answer: 'sugar', alt: [] },
    { cues: ['fox', 'man', 'peep'], answer: 'hole', alt: [] },
  ],
  // set 13: EEMMMMHH
  [
    { cues: ['tool', 'match', 'juice'], answer: 'box', alt: [] },
    { cues: ['high', 'district', 'house'], answer: 'school', alt: [] },
    { cues: ['boot', 'summer', 'ground'], answer: 'camp', alt: [] },
    { cues: ['lift', 'card', 'mask'], answer: 'face', alt: [] },
    { cues: ['knife', 'rabbit', 'hammer'], answer: 'jack', alt: [] },
    { cues: ['chop', 'drum', 'joy'], answer: 'stick', alt: [] },
    { cues: ['age', 'mile', 'sand'], answer: 'stone', alt: [] },
    { cues: ['sense', 'courtesy', 'place'], answer: 'common', alt: [] },
  ],
  // set 14: EEMMMMHH
  [
    { cues: ['wedding', 'diamond', 'boxing'], answer: 'ring', alt: [] },
    { cues: ['pop', 'flakes', 'cob'], answer: 'corn', alt: [] },
    { cues: ['tank', 'hill', 'secret'], answer: 'top', alt: [] },
    { cues: ['cross', 'rain', 'tie'], answer: 'bow', alt: [] },
    { cues: ['flower', 'paper', 'stone'], answer: 'wall', alt: [] },
    { cues: ['case', 'talk', 'game'], answer: 'show', alt: [] },
    { cues: ['mask', 'natural', 'tank'], answer: 'gas', alt: [] },
    { cues: ['guess', 'nature', 'opinion'], answer: 'second', alt: [] },
  ],
  // set 15: EEMMMMHH
  [
    { cues: ['car', 'swimming', 'cue'], answer: 'pool', alt: [] },
    { cues: ['shirt', 'pants', 'shop'], answer: 'sweat', alt: [] },
    { cues: ['stick', 'maker', 'point'], answer: 'match', alt: [] },
    { cues: ['worm', 'shelf', 'end'], answer: 'book', alt: [] },
    { cues: ['quarter', 'bone', 'pack'], answer: 'back', alt: [] },
    { cues: ['kick', 'line', 'car'], answer: 'side', alt: [] },
    { cues: ['political', 'surprise', 'line'], answer: 'party', alt: [] },
    { cues: ['booth', 'road', 'bridge'], answer: 'toll', alt: [] },
  ],
  // set 16: EEMMMMHH
  [
    { cues: ['bulb', 'flash', 'year'], answer: 'light', alt: [] },
    { cues: ['jam', 'cop', 'circle'], answer: 'traffic', alt: [] },
    { cues: ['right', 'cat', 'carbon'], answer: 'copy', alt: [] },
    { cues: ['dive', 'rocket', 'scraper'], answer: 'sky', alt: [] },
    { cues: ['turtle', 'bottle', 'tie'], answer: 'neck', alt: [] },
    { cues: ['news', 'lemonade', 'grand'], answer: 'stand', alt: [] },
    { cues: ['sore', 'shoulder', 'sweat'], answer: 'cold', alt: [] },
    { cues: ['mark', 'place', 'rate'], answer: 'birth', alt: [] },
  ],
  // set 17: EEMMMMHH
  [
    { cues: ['tea', 'cake', 'board'], answer: 'cup', alt: [] },
    { cues: ['drum', 'plug', 'muff'], answer: 'ear', alt: [] },
    { cues: ['fur', 'rack', 'tail'], answer: 'coat', alt: [] },
    { cues: ['thumb', 'pepper', 'envy'], answer: 'green', alt: [] },
    { cues: ['witness', 'ball', 'brow'], answer: 'eye', alt: [] },
    { cues: ['tail', 'pen', 'guinea'], answer: 'pig', alt: [] },
    { cues: ['nuclear', 'feud', 'album'], answer: 'family', alt: [] },
    { cues: ['proof', 'track', 'bite'], answer: 'sound', alt: [] },
  ],
  // set 18: EEMMMMHH
  [
    { cues: ['light', 'green', 'ware'], answer: 'house', alt: [] },
    { cues: ['dew', 'comb', 'bee'], answer: 'honey', alt: [] },
    { cues: ['hour', 'wine', 'eye'], answer: 'glass', alt: [] },
    { cues: ['candy', 'stool', 'tender'], answer: 'bar', alt: [] },
    { cues: ['pit', 'band', 'rest'], answer: 'arm', alt: [] },
    { cues: ['shake', 'man', 'chocolate'], answer: 'milk', alt: [] },
    { cues: ['line', 'fruit', 'drunk'], answer: 'punch', alt: [] },
    { cues: ['way', 'mark', 'town'], answer: 'hall', alt: [] },
  ],
  // set 19: EEMMMMHH
  [
    { cues: ['shake', 'writing', 'cuff'], answer: 'hand', alt: [] },
    { cues: ['fish', 'mine', 'rush'], answer: 'gold', alt: [] },
    { cues: ['wise', 'work', 'tower'], answer: 'clock', alt: [] },
    { cues: ['tug', 'gravy', 'house'], answer: 'boat', alt: [] },
    { cues: ['rail', 'block', 'map'], answer: 'road', alt: [] },
    { cues: ['time', 'look', 'night'], answer: 'over', alt: [] },
    { cues: ['motion', 'poke', 'down'], answer: 'slow', alt: [] },
    { cues: ['food', 'forward', 'break'], answer: 'fast', alt: [] },
  ],
  ];

  // Per-player permutation of the sets (FNV-1a + mulberry32, as in work.html), indexed by shift slot.
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffle(arr, rng) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function setIndexFor(ctx) {
    const perm = shuffle(SETS.map((_, i) => i), mulberry32(hashStr(`${ctx.seed}|rat-bank`)));
    const day = Math.max(1, Number(ctx.day) || 1), shift = Math.max(0, Number(ctx.shift) || 0);
    const slot = (day - 1) * 4 + Math.min(shift, 3); // 0..19 over the five days
    return perm[slot % perm.length];
  }

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]+/g, '');
  function isRight(typed, item) {
    const t = norm(typed);
    if (!t) return false;
    return [item.answer, ...item.alt].some((a) => { const n = norm(a); return t === n || t === n + 's' || t === n + 'es'; });
  }

  const CSS = `
    .rat-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .rat-cues { display: flex; justify-content: center; flex-wrap: wrap; gap: 14px 22px; margin: 18px 0 6px; }
    .rat-cue { font-family: 'Source Serif 4', Georgia, serif; font-size: 40px; line-height: 1.1; padding: 14px 26px;
      background: #fff; border: 1.5px solid #d6cfbf; border-radius: 10px; min-width: 9ch; text-align: center; }
    .rat-row { display: flex; gap: 10px; align-items: stretch; }
    .rat-row input[type=text] { flex: 1; }
    .rat-feedback { min-height: 1.6em; font-size: 20px; text-align: center; margin: 0; }
    .rat-feedback.ok { color: #1F6F6B; font-weight: 600; }
    .rat-feedback.bad { color: #8a2a1f; }
    .rat-feedback b { font-family: 'Source Serif 4', Georgia, serif; font-size: 24px; }
    .rat-hint { text-align: center; margin: 0; }
    .rat-row .btn.ghost:disabled { opacity: .45; cursor: not-allowed; }
  `;

  window.GV_TASKS = window.GV_TASKS || {};
  window.GV_TASKS.rat = {
    id: 'rat',
    title: 'Word links',
    blurb: 'Three words, one missing: find the word that goes with all three to make a common phrase or compound. Eight of them, fifteen seconds each.',
    seconds: 120,
    run(root, ctx, done) {
      const el = ctx.el;
      const setIndex = setIndexFor(ctx);
      const items = shuffle(SETS[setIndex], ctx.rng).slice(0, ITEMS_PER_SHIFT);
      const responses = [];
      let idx = -1, score = 0, phase = 'idle', shownAt = 0, cd = null, feedbackTimer = null, stopped = false;

      const progress = el('span', { className: 'muted' });
      const scoreEl = el('span', { className: 'score' });
      const timerSlot = el('div');
      const cuesBox = el('div', { className: 'rat-cues' });
      cuesBox.setAttribute('role', 'group');
      cuesBox.setAttribute('aria-label', 'The three words');
      const input = el('input', { type: 'text', autocomplete: 'off', spellcheck: false, maxLength: 40 });
      input.setAttribute('aria-label', 'The word that goes with all three');
      input.setAttribute('autocapitalize', 'off');
      const submitBtn = el('button', { type: 'button', className: 'btn', textContent: 'Submit' });
      const skipBtn = el('button', { type: 'button', className: 'btn ghost', textContent: 'Skip' });
      skipBtn.setAttribute('aria-label', 'Skip this one');
      const feedback = el('p', { className: 'rat-feedback' });
      feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
      const hint = el('p', { className: 'muted rat-hint', textContent: 'Type one word and press Enter. Example: battle, war and friend all go with ship.' });

      root.append(
        el('style', { textContent: CSS }),
        el('div', { className: 'rat-top' }, progress, timerSlot, scoreEl),
        cuesBox,
        el('div', { className: 'rat-row' }, input, submitBtn, skipBtn),
        feedback, hint,
      );

      const showScore = () => { scoreEl.textContent = `Found ${score} of ${ITEMS_PER_SHIFT}`; };
      const setBusy = (busy) => { input.disabled = busy; submitBtn.disabled = busy; skipBtn.disabled = busy; };
      const stopClock = () => { if (cd) { cd.stop(); cd = null; } };

      function next() {
        feedbackTimer = null;
        if (stopped) return;
        idx += 1;
        if (idx >= items.length) { finish(); return; }
        const item = items[idx];
        progress.textContent = `Word ${idx + 1} of ${items.length}`;
        cuesBox.replaceChildren(...item.cues.map((c) => el('span', { className: 'rat-cue', textContent: c })));
        feedback.textContent = ''; feedback.className = 'rat-feedback';
        input.value = '';
        setBusy(false);
        stopClock();
        cd = ctx.countdown(ITEM_SECONDS, () => { cd = null; resolve('timeout'); });
        timerSlot.replaceChildren(cd.el);
        phase = 'answer';
        shownAt = Date.now();
        input.focus();
      }

      // One response per item; `phase` guards against double advances (rapid Enter/Submit/Skip, timer races).
      function resolve(how) {
        if (stopped || phase !== 'answer') return;
        const item = items[idx];
        const typed = how === 'submit' ? input.value.trim() : '';
        if (how === 'submit' && !norm(typed)) { input.focus(); return; } // nothing typed: keep waiting
        phase = 'feedback';
        stopClock();
        const correct = how === 'submit' && isRight(typed, item);
        if (correct) score += 1;
        responses.push({ cues: item.cues.slice(), answer: item.answer, typed, correct, ms: Date.now() - shownAt, skipped: how === 'skip', timedOut: how === 'timeout' });
        showScore();
        setBusy(true);
        feedback.replaceChildren();
        if (correct) { feedback.className = 'rat-feedback ok'; feedback.append('Right: ', el('b', { textContent: item.answer })); }
        else {
          feedback.className = 'rat-feedback bad';
          feedback.append(how === 'timeout' ? 'Time. The word was ' : how === 'skip' ? 'Skipped. The word was ' : 'Not quite. The word was ', el('b', { textContent: item.answer }), '.');
        }
        feedbackTimer = setTimeout(next, FEEDBACK_MS);
      }

      function finish() {
        if (phase === 'done') return;
        phase = 'done';
        stopClock();
        setBusy(true);
        done({
          summary: `You found ${score} of ${items.length} word${items.length === 1 ? '' : 's'}.`,
          score,
          responses,
          items: { set: setIndex, answers: items.map((it) => it.answer) },
        });
      }

      submitBtn.onclick = () => resolve('submit');
      skipBtn.onclick = () => resolve('skip');
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); resolve('submit'); } });

      showScore();
      next();

      return {
        stop() {
          stopped = true; phase = 'done';
          stopClock();
          if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }
        },
      };
    },
  };

  // Exposed for checks (the bank and the slot rule); not used by the shell.
  window.GV_TASKS.rat._bank = SETS;
  window.GV_TASKS.rat._setIndexFor = setIndexFor;
})();
