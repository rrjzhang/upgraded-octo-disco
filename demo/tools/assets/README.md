# Assets build

`node tools/assets/build.mjs` (from `demo/`) wipes and regenerates `public/assets/**` and
`public/assets/manifest.json` from `../image_generation/out/` (read-only, `_A` photoreal set only).
Options: `--src <dir>`, `--out <dir>`. Needs macOS `sips`; no npm packages. Runs in about 5 s.

Processing: backgrounds to JPEG q85 at 1536 wide; busts to 640 x 640 PNG with alpha; figures trimmed
to the alpha > 8 bounding box (4 px pad, own zlib PNG decoder), green-spill removed from
semi-transparent pixels, scaled to 700 tall; props trimmed and scaled to 600 wide; TV still to JPEG
1280 wide. Missing neutral busts are cropped from the reference sheet: a 560 px square around the
detected head (top of subject minus 50 px, centred on the head), scaled to 640, grey ground, no
alpha (`fromReference: true`). Silhouette placeholders are drawn procedurally (SDF shapes,
3x3 supersampled alpha).

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
bg_center_in_day, bg_library_day (warm_indoor); bg_clinic_day, bg_work_day (cool_indoor); bg_park_day (outdoor).
Props: prop/prop_tv.png (600 x 342), prop/prop_chessboard.png (600 x 515).
