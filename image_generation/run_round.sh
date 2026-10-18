#!/bin/zsh
# Drive the codex generating agent ("Luna") over every pending request file in this folder.
# Run from anywhere:  zsh image_generation/run_round.sh
# Codex runs non-interactively with write access limited to this folder; it follows README.md.
set -e
cd "$(dirname "$0")"
mkdir -p logs
LOG="logs/codex_$(date +%Y%m%d_%H%M%S).log"
codex exec -s workspace-write --skip-git-repo-check -o "logs/last_message.md" \
"You are the generating agent for this folder. Read README.md first, in particular 'Rules of engagement' and 'Protocol for the generating agent', and follow them exactly. Then process every request file NN_<id>.md whose frontmatter status is \"pending\", in ascending order of the number prefix (a character's _ref_A file comes before the files that attach it, so order matters). For each file: take the LAST fenced code block as the exact prompt; honour the frontmatter aspect (2:3 portrait, 1:1 square, 16:9 landscape) and transparent_background; when attach is not \"none\", pass that image as the reference for an edit so the person stays the same; generate with image_gen.imagegen; save the PNG exactly at save_image_as and the prompt you actually used at save_prompt_used_as; then change ONLY the status line of that file to \"done\", or to \"failed\" plus one error: line if it failed after one retry. Never edit any other line, never touch README.md, _manifest.json, ref/, existing out/ files or any file with status done. Do not crop, upscale or retouch. Work through all pending files without asking questions; if the image tool is rate limited, wait and continue. Finish with a short table: file, status, one-line note on anything odd (wrong aspect, extra person, visible text)." \
  2>&1 | tee "$LOG"
echo "codex finished; log: image_generation/$LOG (gitignored)"
