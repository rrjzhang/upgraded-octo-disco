#!/usr/bin/env python3
"""Watch this directory and generate an image for each newly added Markdown file.

Requires OPENAI_API_KEY. Uses only the Python standard library so it can run on
macOS and Linux without installing a file-watching package.
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
API_URL = "https://api.openai.com/v1/images/generations"
EDIT_URL = "https://api.openai.com/v1/images/edits"
POLL_SECONDS = 1.0


def frontmatter(text: str) -> dict[str, str]:
    match = re.match(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", text, re.S)
    if not match:
        raise ValueError("missing YAML frontmatter")
    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        item = re.match(r"^([A-Za-z_][\w-]*):\s*(.*?)\s*$", line)
        if item:
            value = item.group(2)
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]
            fields[item.group(1)] = value
    return fields


def prompt_from(text: str) -> str:
    blocks = re.findall(r"```(?:[\w+-]+)?\s*\n(.*?)\n```", text, re.S)
    if not blocks:
        raise ValueError("no fenced prompt block found")
    return blocks[-1].strip()


def image_size(aspect: str) -> str:
    if aspect in {"3:2", "16:9"}:
        return "1536x1024"
    if aspect in {"2:3", "9:16"}:
        return "1024x1536"
    return "1024x1024"


def generate(prompt: str, fields: dict[str, str]) -> bytes:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    payload = {
        "model": os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-1"),
        "prompt": prompt,
        "size": image_size(fields.get("aspect", "1:1")),
        "quality": "high",
        "output_format": "png",
    }
    if fields.get("transparent_background", "false").lower() == "true":
        payload["background"] = "transparent"
    attachment = fields.get("attach", "none")
    if attachment and attachment.lower() != "none":
        image_path = (ROOT / attachment).resolve()
        if ROOT not in image_path.parents or not image_path.is_file():
            raise ValueError(f"attachment does not exist inside image_generation/: {attachment}")
        boundary = "----image-generation-" + str(time.time_ns())
        parts = []
        for key, value in payload.items():
            parts.extend((
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n".encode(),
                str(value).encode(),
                b"\r\n",
            ))
        parts.extend((
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{image_path.name}\"\r\nContent-Type: image/png\r\n\r\n".encode(),
            image_path.read_bytes(),
            f"\r\n--{boundary}--\r\n".encode(),
        ))
        req = urllib.request.Request(
            EDIT_URL,
            data=b"".join(parts),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
            method="POST",
        )
    else:
        req = urllib.request.Request(
            API_URL,
            data=json.dumps(payload).encode(),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
    try:
        with urllib.request.urlopen(req, timeout=300) as response:
            result = json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise RuntimeError(f"image API returned HTTP {error.code}: {detail}") from error
    try:
        return base64.b64decode(result["data"][0]["b64_json"])
    except (KeyError, IndexError, TypeError) as error:
        raise RuntimeError("image API response did not contain image data") from error


def process(path: Path) -> None:
    print(f"Generating from {path.name}...", flush=True)
    original = path.read_text()
    fields = frontmatter(original)
    prompt = prompt_from(original)
    image_path = (ROOT / fields["save_image_as"]).resolve()
    prompt_path = (ROOT / fields["save_prompt_used_as"]).resolve()
    if ROOT not in image_path.parents or ROOT not in prompt_path.parents:
        raise ValueError("output paths must stay inside image_generation/")
    image_path.parent.mkdir(parents=True, exist_ok=True)
    prompt_path.parent.mkdir(parents=True, exist_ok=True)
    image_data = generate(prompt, fields)
    image_path.write_bytes(image_data)
    prompt_path.write_text(prompt + "\n")

    updated = re.sub(
        r"(?m)^status:\s*.*$", "status: \"done\"", original, count=1
    )
    path.write_text(updated)
    print(f"Saved {image_path.relative_to(ROOT)}", flush=True)


def mark_failed(path: Path, reason: str) -> None:
    try:
        original = path.read_text()
        updated = re.sub(
            r"(?m)^status:\s*.*$", 'status: "failed"', original, count=1
        )
        if updated != original:
            updated = updated.replace(
                "---\n\n# ", f"---\nerror: {json.dumps(reason[:300])}\n\n# ", 1
            )
            path.write_text(updated)
    except OSError:
        pass


def main() -> None:
    print(f"Watching {ROOT} for new .md files (Ctrl-C to stop)", flush=True)
    known = {p.resolve() for p in ROOT.glob("*.md")}
    while True:
        current = {p.resolve() for p in ROOT.glob("*.md")}
        for path in sorted(current - known):
            # Wait for the writer to finish before reading a newly created file.
            previous_size = -1
            for _ in range(20):
                try:
                    size = path.stat().st_size
                except FileNotFoundError:
                    break
                if size == previous_size and size > 0:
                    break
                previous_size = size
                time.sleep(0.25)
            if not path.exists():
                continue
            try:
                process(path)
            except Exception as error:  # keep listening after an individual failure
                print(f"Failed {path.name}: {error}", file=sys.stderr, flush=True)
                mark_failed(path, str(error))
        known = current
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Stopped.", flush=True)
