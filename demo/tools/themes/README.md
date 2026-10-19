# Theme review gallery

Screenshots of font/colour candidates for the game, for people to compare and choose. Nothing in `src/` changes:
each theme is injected into the running dev page (a Google Fonts `<link>` plus a `<style>` that overrides the
`:root` variables and the few colours `style.css` hard-codes), screenshotted, then removed.

## Run

```sh
npm run dev                      # if it is not already running on http://localhost:5173
node tools/themes/shoot.mjs      # all themes (several minutes)
node tools/themes/shoot.mjs --only current,night-lora   # a subset
```

Options: `--base <url>` (default `http://localhost:5173`), `--port <n>` (Chrome debugging port, default 9371).
It uses the Playwright-cached Chromium (override with `CHROME=/path/to/chrome`).

Output goes to `tools/themes/out/<stamp>/` (git-ignored):

- `index.html` - the gallery: per theme the name, fonts, swatches, contrast, main screen and phone side by side, and a
  `:root` block ready to paste; then a "Phone only" grid (journal and contacts tabs) to judge the phone separately.
- `png/` full-size 1440x900 screenshots (`<id>_main`, `<id>_phone`, `<id>_later` = the same conversation two clicks on,
  with a longer line and more choices) and phone crops (`<id>_phone_journal`, `<id>_phone_contacts`, `<id>_phone_profile`
  = the opening questions with India chosen, the longest version).
- `jpg/` previews (720 px wide for full screens).
- `results.json` - font load status, contrast warnings, the scale, measured sizes and layout warnings per theme.

The script prints a warning for any text pair below 4.5:1 (ink, muted, top bar, strip, button text, accent text) and
lists any font that did not load. It also measures the layout in every state it shoots and prints a `~` note (shown in
red on the gallery card) for text cut off, boxes overlapping, the right panel needing to scroll, a squeezed dialogue
box (saying whether it still happens without the dev-only Back/edit buttons), the phone tabs not fitting, the camera
cutout covering a control, or the opening questions needing to scroll (SPEC wants them on one screen).

## Add a theme

Add an entry to `themes.json`:

```json
{"id":"my-theme","name":"My theme","mood":"warm paper","serif":"Lora","ui":"Inter",
 "palette":{"panel":"#f6f1e7","panel2":"#ebe3d2","ink":"#2a241d","muted":"#6a5f50","accent":"#8a4b2a","amber":"#d39b3a"}}
```

- `serif` (dialogue, `--serif`) and `ui` (`--ui`) are Google Fonts family names; use `serifStack` / `uiStack`
  instead for a system font stack.
- The six palette keys are the `style.css` variables. Optional keys override colours that are hard-coded today and
  are otherwise derived: `card` (choice and textarea background), `line` (borders), `onAccent` (button text),
  `accentHover`, `topbar`, `topbarInk`, `topbarMuted`, `strip` (dark exit strip), `stripInk`, `exitOff`, `exitOffInk`,
  `phoneFrame` (the phone bezel and its camera cutout, the `--phoneFrame` variable). Dark themes (dark `panel`) need a
  light `ink` and usually an `onAccent`.

### Bigger text: `extends`, `scale`, `phoneScale`

```json
{"id":"paper-lora-xl","name":"Paper / Lora · extra large","extends":"paper-lora","scale":1.3}
```

- `extends` copies another theme's fonts, mood and palette (keys given here win; `palette` merges).
- `scale` multiplies every type size in the game (default 1). `style.css` sets sizes in px, so the script reads every
  px `font-size` (and the size inside a `font:` shorthand) from the game's own stylesheets and re-declares it under the
  same selector, times the scale, in the injected `<style>`: dialogue `.line`, choices, the exit strip, the top bar,
  labels, everything. Boxes, images, the phone and the cutout keep their size.
- `phoneScale` does the same for the phone's selectors (`.phone`, `.ph-*`) and its buttons; it defaults to `scale`.
- Name them "<base> · large" (1.15) / "<base> · extra large" (1.3) and id `<base>-large` / `<base>-xl`. The gallery
  card states the scale and the measured dialogue, choice and phone-tab sizes. A scale that clips something is reported
  on the card, never shrunk to fit.

## Adopting a theme

Copy the theme's `:root` block from the gallery into `src/style.css`, add the font families to the Google Fonts link
in `index.html`, and, if the theme sets any of the optional keys, change the matching hard-coded colours in
`style.css` (see `themeCss()` in `shoot.mjs` for which selector each one maps to). A scaled theme also means
multiplying the px font sizes in `style.css` (or turning them into `calc(<px> * var(--fs))`); the card's layout notes
say what to rework first.
