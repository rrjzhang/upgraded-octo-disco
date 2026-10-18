# Assets build

`node tools/assets/build.mjs` (from `demo/`) wipes and regenerates `public/assets/**` and
`public/assets/manifest.json` from `../image_generation/out/` (read-only, `_A` photoreal set only).
Options: `--src <dir>`, `--out <dir>`, `--npcs <file>` (default `public/content/npcs.yaml`). Needs macOS `sips`; no npm packages. Runs in about 5 s.

Processing: backgrounds to JPEG q85 at 1536 wide; busts to 640 x 640 PNG with alpha; figures trimmed
to the alpha > 8 bounding box (4 px pad, own zlib PNG decoder), green-spill removed from
semi-transparent pixels, scaled to 700 tall; props trimmed and scaled to 600 wide; TV still to JPEG
1280 wide. Missing neutral busts are cropped from the reference sheet: a 560 px square around the
detected head (top of subject minus 50 px, centred on the head), scaled to 640, grey ground, no
alpha (`fromReference: true`). Silhouette placeholders are drawn procedurally (SDF shapes,
3x3 supersampled alpha).

**Characters come from `public/content/npcs.yaml`** (SPEC "Art"; added 2026-10-18): each NPC's `portrait`
(`ch_<id>`) is the source base for `<base>_<expression>_A.png` / `<base>_bust_A.png` / `<base>_ref_A.png`, and its
`figure` plus every appearance's `figure` override are the figures to build (`<figure>_A.png`; seated when the id has
`_fig_sit`). A figure or portrait with no source yet gets a silhouette entry marked `placeholder: true`, so a new pack
needs no build change. The only hard-coded exceptions: `nat_enforcement` reads `ch_nat_anti`, `nat_inclusive` reads
`cast_president_inclusive`, and `cn_leader_sep` has three reference `candidates`. Characters with art in the source
folder that `npcs.yaml` does not name yet (`ch_mx_neighbor_ref_A`) are still built, and every `<base>_fig_*_A.png` of a
listed character is processed even when no appearance names it. The table below is a snapshot.

Manifest `portraits` is keyed by content id; `aliases` maps `ch_<id>` and the source base
(`ch_nat_anti`) to the content id. Missing expressions are `null` (engine falls back to neutral).

| Character id | Source files (`_A`) | Outputs | Placeholder |
|---|---|---|---|
| us_neighbor (Dana) | ch_us_neighbor_warm_A, ch_us_neighbor_ref_A, ch_us_neighbor_fig_stand_A | portrait/us_neighbor_warm.png, portrait/us_neighbor_neutral.png (fromReference), figure/ch_us_neighbor_fig_stand.png | no |
| us_stranger_a (Walt) | ch_us_stranger_a_ref_A, ch_us_stranger_a_fig_sit_A | portrait/us_stranger_a_neutral.png (fromReference), figure/ch_us_stranger_a_fig_sit.png | no |
| us_stranger_b (Kelsey) | none | portrait/placeholder_neutral.png, figure/placeholder_stand.png as ch_us_stranger_b_fig_stand | yes |
| us_leader_int (Ruth Hale) | none | placeholder bust, ch_us_leader_int_fig_stand -> placeholder_stand | yes |
| us_leader_seg (Gary Pruitt) | none | placeholder bust, ch_us_leader_seg_fig_stand -> placeholder_stand | yes |
| nat_enforcement | ch_nat_anti_ref_A, ch_nat_anti_tv_1_A | portrait/nat_enforcement_neutral.png (fromReference), tv/nat_enforcement_1.jpg | no |
| nat_inclusive | none | placeholder bust; tv reuses tv/nat_enforcement_1.jpg | yes |
| cn_neighbor (Mrs. Chen) | none | placeholder bust, ch_cn_neighbor_fig_stand -> placeholder_stand | yes |
| cn_stranger_a (Mr. Lin) | ch_cn_stranger_a_ref_A, ch_cn_stranger_a_fig_sit_A | portrait/cn_stranger_a_neutral.png (fromReference), figure/ch_cn_stranger_a_fig_sit.png | no |
| cn_stranger_b (Jia) | none | placeholder bust, ch_cn_stranger_b_fig_stand -> placeholder_stand | yes |
| cn_leader_int (Dr. Zhou) | none | placeholder bust, ch_cn_leader_int_fig_stand -> placeholder_stand | yes |
| cn_leader_sep (Mr. Guo) | ch_cn_leader_sep_neutral_A, _guarded_A, _fig_stand_A; candidates ref_A_1..3 | portrait/cn_leader_sep_neutral.png, portrait/cn_leader_sep_guarded.png, figure/ch_cn_leader_sep_fig_stand.png | no |
| mx_neighbor | ch_mx_neighbor_ref_A | portrait/mx_neighbor_neutral.png (fromReference) | no |
| in_neighbor | ch_in_neighbor_ref_A | portrait/in_neighbor_neutral.png (fromReference) | no |

Backgrounds (`bg/<id>.jpg`, 1536 x 1024): bg_home_day, bg_home_eve, bg_center_cn_day, bg_center_mx_day,
bg_center_in_day, bg_library_day (warm_indoor); bg_clinic_day, bg_work_day (cool_indoor); bg_park_day,
bg_park_chess_day (outdoor). Each manifest entry records `source`, the `_A` file it was built from.
Source preference (`BG_SOURCES` in build.mjs; first file present wins, otherwise `<id>_A`):

| Background id | Preferred source (Round 2) | Fallback |
|---|---|---|
| bg_home_day | bg_home_tv_day_A (TV painted in) | bg_home_day_A |
| bg_home_eve | bg_home_tv_eve_A (TV painted in) | bg_home_eve_A |
| bg_clinic_day | bg_clinic_tv_day_A (TV painted in) | bg_clinic_day_A |
| bg_park_chess_day | bg_park_chess_day_A (two seated chess players painted in) | none: skipped with a warning |

When `source` is a `_tv_` file the room already shows the television, so the engine should not
composite prop_tv on top of it (the prop stays in the manifest for the other scenes).
Props: prop/prop_tv.png (600 x 342), prop/prop_chessboard.png (600 x 515).

## Cast (authority figures)

Named by `news.csv` `figure` and `events.csv` `portrait`. Ids, names and roles come from
`public/content/cast.yaml` (content owns them: a list of `{ id, name, role }`, or `{ cast: [...] }`); the `CAST`
table in `build.mjs` is only a fallback (entries starting with `_` are examples and skipped), and any
`cast_<id>_*_A.png` in the source folder also gets an entry. Sources per id, any subset:

| Source | Output | Processing |
|---|---|---|
| `cast_<id>_bust_A.png` (1:1, transparent) | `cast/<id>_bust.png` | 640 x 640; a non-square file gets the Round 3 square crop (image-width square just above the alpha box) |
| `cast_<id>_tv_A.png` (16:9) | `cast/<id>_tv.jpg` | JPEG q85, 1280 wide, like the president's still |
| `cast_<id>_ref_A.png` | `cast/<id>_ref.jpg` | JPEG q85, 1024 wide; also cropped to the bust (`fromReference: true`) when there is no bust file |

The cast.yaml ids already carry the prefix (`cast_governor`), so `cast_governor_bust_A.png` serves id
`cast_governor` (`cast_cast_governor_bust_A.png` would too). Manifest: `cast[<id>] = { name, role, bust, tv, ref,
placeholder, fromReference, sources }`; `placeholder: true` with null files when nothing exists yet, and the game
then shows a silhouette bust or a PLACEHOLDER TV screen with the person's name.
