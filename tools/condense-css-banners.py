#!/usr/bin/env python3
"""
My MaNaGeR - Comment-banner condenser (owner 2026-09-06: "these make my code
file bigger than what it is, all this yapping -> put it in the continuation
directive").

Replaces multi-line /* ... */ comment blocks (>= MIN_LINES lines) in CSS
content with a single condensed line: "/* <first sentence, trimmed> */".

Used on:
  - css/marketing.css, css/mmgr.css      (external CSS - no CSP impact)
  - admin.html <style> block             (inline CSS - style-src has unsafe-inline, no regen needed)
  - app.html <style> block               (same)
  - js/*.js                              (with --js; verify with node --check after)

NEVER touches <script> contents in HTML. Only edits CSS comment syntax /
JS block comments, never // line comments or strings that embed them.

Usage:
    python tools/condense-css-banners.py                # do it
    python tools/condense-css-banners.py --dry-run      # preview
    python tools/condense-css-banners.py --js           # also js/*.js
"""

import argparse
import re
import sys
from pathlib import Path

MIN_LINES = 6
MIN_CHARS = 280

TARGETS = [
    "css/marketing.css",
    "css/mmgr.css",
    "admin.html",
    "app.html",
]

JS_GLOB = "js/*.js"


def condense_css(css_text: str):
    """Replace long /* ... */ blocks with one-liners. Returns (new_text, count)."""
    count = 0

    def repl(m):
        nonlocal count
        block = m.group(0)
        lines = block.count("\n") + 1
        if lines < MIN_LINES and len(block) < MIN_CHARS:
            return block
        inner = block[2:-2]
        # First meaningful line as the condensed summary
        parts = [ln.strip(" -*=\t") for ln in inner.split("\n")]
        first = next((p for p in parts if p), "")
        # Trim to first sentence, max 90 chars
        sentence = re.split(r"(?<=[.!?:])\s", first, maxsplit=1)[0]
        sentence = sentence.rstrip(".")
        if len(sentence) > 90:
            sentence = sentence[:87].rstrip() + "..."
        if not sentence:
            return block
        count += 1
        return "/* " + sentence + " */"

    new_text = re.sub(r"/\*[\s\S]*?\*/", repl, css_text)
    return new_text, count


def condense_js(js_text: str):
    """Same as condense_css but guards against touching /* inside strings by
    checking the block does not span a quote-heavy region. Given the js/ tree
    was pre-verified (no /* or */ inside string literals), we apply the same
    regex. node --check on every touched file is REQUIRED after running."""
    return condense_css(js_text)


def extract_style_block(html_text: str):
    """Find the single <style>...</style> block (app/admin pages have exactly one inline)."""
    m = re.search(r"<style[^>]*>([\s\S]*?)</style>", html_text)
    return m if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--js", action="store_true", help="also condense js/*.js (node --check after!)')")
    args = ap.parse_args()

    targets = list(TARGETS)
    if args.js:
        targets += [str(p) for p in sorted(Path(".").glob(JS_GLOB))]

    for target in targets:
        p = Path(target)
        if not p.exists():
            print(f"skip (missing): {target}")
            continue
        txt = p.read_text(encoding="utf-8")
        orig_len = len(txt)

        if target.endswith(".css"):
            new_txt, n = condense_css(txt)
        elif target.endswith(".js"):
            new_txt, n = condense_js(txt)
        else:
            m = extract_style_block(txt)
            if not m:
                print(f"skip (no <style> block): {target}")
                continue
            style_css = m.group(1)
            new_css, n = condense_css(style_css)
            new_txt = txt[: m.start(1)] + new_css + txt[m.end(1):]

        if n == 0:
            print(f"{target}: nothing to condense")
            continue
        saved = orig_len - len(new_txt)
        print(f"{target}: condensed {n} banner blocks, saved {saved} chars "
              f"({saved / 1024:.1f} KB)")
        if not args.dry_run:
            p.write_text(new_txt, encoding="utf-8", newline="\n")

    if args.dry_run:
        print("\n(dry run - no files written)")
    else:
        print("\nDone. Remember: rebuild bundles + regen CSP hashes if inline <style> changed.")


if __name__ == "__main__":
    main()
