# Work tasks: the contract between `work.html` and `work/<id>.js`

`work.html` is the shift shell. It talks to the game (cost, pay, logging) and draws one task per shift from the
registered tasks. A task script owns one file, `public/modules/work/<id>.js`, is loaded with a plain `<script>` tag
(no modules, no imports, no build step; it must run from `file://` and from the Vite dev server alike) and registers
itself:

```js
window.GV_TASKS = window.GV_TASKS || {};
window.GV_TASKS.rat = {
  id: 'rat',
  title: 'Word links',          // player-facing shift name shown in the header (not the test's academic name)
  blurb: 'One sentence the player reads before starting the shift.',
  seconds: 120,                 // nominal length of a shift; the shell tells the player "About N minutes"
  run(root, ctx, done) { ... return { stop() {} }; },
};
```

`run(root, ctx, done)`:

- `root` is an empty `<div class="task">` inside the module's `<main>`; render everything in there. The shell's CSS
  gives `.task input[type=text]`, `.task textarea`, `.task .prompt`, `.chips`/`.chip`, `.timer`, `.score`,
  `.flash-ok`/`.flash-bad` and `.center`; `module.css` gives `.btn`, `.btn.ghost`, `.muted`, `.serif`, `.err`.
  Add task-specific styles with a `<style>` element appended to `root` if you need them.
- `ctx.rng()` is a seeded PRNG in [0, 1) (seeded from room seed, day, shift and task id): draw items, orders and
  anything random from it, never from `Math.random`, so a shift can be replayed from the log.
- `ctx.day` (1-5) and `ctx.shift` (0-based count of shifts already done today) are there so item banks can be
  cycled: the player must not meet the same item twice in the five days (at least 2 shifts a day, so plan for
  about 10 shifts; one task is drawn from three, so about 4 shifts of yours).
- `ctx.el(tag, attrs, ...kids)` creates an element (`attrs` are assigned as properties: `className`, `textContent`,
  `type`, `onclick`...). `ctx.countdown(seconds, onEnd)` returns `{ el, stop, left }`: append `el` (a `.timer`)
  and call `stop()` when you finish early.
- Call `done(result)` exactly once, when time is up or the player finishes. `result` is
  `{ summary, score, responses, items? }`: `summary` is one plain sentence for the "Shift over" screen
  ("You listed 11 uses."), `score` a number or `null` when nothing can be scored live, `responses` the raw data a
  researcher needs to score the task later (per item: the prompt, the answer text, elapsed ms), `items` the item
  ids/prompts that were shown. The shell adds task id, shift, start time and duration and logs it all as a `work`
  log line.
- Return `{ stop() }` (or nothing) so the shell can halt timers when the player presses Close mid-shift (no pay,
  nothing logged in that case).

Player-facing text: plain, specific English; the player is a working adult in a logistics office, so frame the
task as office work only lightly (a header title is enough), and never mention psychology, tests or creativity
research. Everything the player types is logged as is.

Keyboard: text inputs must submit on Enter; the first input gets focus when the task starts. Accessibility as the
rest of the modules: real `<button>`s, `aria-label`s on anything not self-describing, focus visible.

The fuzz walker (`tools/fuzz/walk.mjs`) fills textareas and text inputs with a word and presses buttons at
random, so a task must end by timer even if the player types nothing, and must survive any button order.

## Cycling an item bank without repeats

`ctx.rng` differs per shift, so it cannot give one stable permutation across the week. For a bank, derive a
per-player permutation from `ctx.seed` with your own small string hash + PRNG (copy the FNV-1a + mulberry32 pair
from `work.html`), then index it with the shift slot:

```js
const slot = (ctx.day - 1) * 4 + Math.min(ctx.shift, 3); // 0..19 over the five days
const item = perm[slot % perm.length];
```

A bank of 15 or more entries (objects, triad sets) then never repeats within a week for any realistic player.
