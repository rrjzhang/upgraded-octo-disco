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

Options: `--base <url>` (default `http://localhost:5173`), `--port <n>` (Chrome debugging port, default 9371),
`--dsf <n>` (device scale factor, default 2: the PNGs are 2880x1800, so text stays sharp when zoomed).
It uses the Playwright-cached Chromium (override with `CHROME=/path/to/chrome`).

Output goes to `tools/themes/out/<stamp>/` (git-ignored):

- `index.html` - the gallery: per theme the name, fonts, swatches, contrast, main screen and phone side by side, and a
  `:root` block ready to paste; then a "Phone only" grid (journal and contacts tabs) to judge the phone separately.
- `png/` full-size screenshots of the 1440x900 page at the device scale factor (2880x1800 by default) (`<id>_main`, `<id>_phone`, `<id>_later` = the same conversation two clicks on,
  with a longer line and more choices) and phone crops (`<id>_phone_journal`, `<id>_phone_contacts`, `<id>_phone_profile`
  = the opening questions with India chosen, the longest version).
- `jpg/` previews: full screens 1440 px wide, phone crops 720 px wide (quality 82).
- `html/<id>.html` - an HTML rendition per theme: the right panel twice (Walt at the park, row WT28: a beat with a
  stage direction and the Next triangle, then the last beat with its three choices) and the phone (journal with the
  two-line draft, contacts), side by side at their real CSS size. It is the game's own DOM, captured while the theme is
  injected, styled by `src/style.css` copied in verbatim plus exactly the CSS the script injected (colours, fonts, the
  type-scale rules), so the text is vector and zooms crisply. Each file is standalone (doctype, charset, viewport, Google
  Fonts links only); busts and contact photos are one neutral inline SVG; dev-only elements (Back / edit buttons, the
  status line, the contacts' debug line) are removed. After the run each file is opened on its own and its text sizes are
  compared with the ones measured in the game; a difference is printed and shown on the card.
- `results.json` - font load status, contrast warnings, the scales, measured sizes (dialogue, choices, top bar, name tag,
  chip, scene description, exits, phone tabs, journal, contacts, opening questions), the rendition check and layout
  warnings per theme.

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

### Bigger text: `extends`, `scale`, `phoneScale`, `smallScale`

```json
{"id":"paper-lora-xl","name":"Paper / Lora · extra large","extends":"paper-lora","scale":1.3}
```

- `extends` copies another theme's fonts, mood and palette (keys given here win; `palette` merges).
- `scale` multiplies every type size in the game (default 1). `style.css` sets sizes in px, so the script reads every
  px `font-size` (and the size inside a `font:` shorthand) from the game's own stylesheets and re-declares it under the
  same selector, times the scale, in the injected `<style>`: dialogue `.line`, choices, the exit strip, the top bar,
  labels, everything. Boxes, images, the phone and the cutout keep their size.
- `phoneScale` does the same for the phone's selectors (`.phone`, `.ph-*`) and its buttons; it defaults to `scale`.
- `smallScale` (default 1) multiplies, on top of `scale` (or `phoneScale` for the phone), the text that is still small
  at 1x: the top bar (day, scene, legend, wallet, room), the exit strip (exits, the phone button, the reveal button),
  the portrait's `.who` name tag and `.chip`, the scene description `.desc`, and on the phone the tabs, the hint, the
  journal, the contacts (names and detail) and the wallet. Not the dev status line, not the opening questions. The
  selectors are `SMALL_RE` in `shoot.mjs`; text that inherits its size today (`.who`, `.phone-btn`, contact names) gets
  an explicit one. Example: `{"id":"current-large-s125","extends":"current","scale":1.15,"smallScale":1.25}`.
- Name them "<base> · large" (1.15) / "<base> · extra large" (1.3) and id `<base>-large` / `<base>-xl`, and
  "<base> · large, small text 1.25×" / id `<base>-large-s125` with a `smallScale`. The gallery card states the scales and
  the measured sizes. A scale that clips something is reported on the card, never shrunk to fit.

## Adopting a theme

Copy the theme's `:root` block from the gallery into `src/style.css`, add the font families to the Google Fonts link
in `index.html`, and, if the theme sets any of the optional keys, change the matching hard-coded colours in
`style.css` (see `themeCss()` in `shoot.mjs` for which selector each one maps to). A scaled theme also means
multiplying the px font sizes in `style.css` (or turning them into `calc(<px> * var(--fs))`), with the `smallScale`
selectors multiplied once more; the type-scale block at the end of the theme's `<style>` in its `html/<id>.html` lists
every resulting size. The card's layout notes say what to rework first.
