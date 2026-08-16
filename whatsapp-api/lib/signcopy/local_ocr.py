#!/usr/bin/env python3
"""Local OCR helper for WhatsApp document photos.

Uses only Pillow/numpy from the system Python and the installed Tesseract
binary. It deliberately creates several low-noise variants because phone
photos of screens often contain moire, uneven lighting and small text.
"""

import difflib
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps


def variants(source: Image.Image):
    source = ImageOps.exif_transpose(source).convert("RGB")
    image = source.convert("L")
    # 3500 keeps a 300-dpi A4/Letter page (2550x3300) at native size. The old
    # 2400 cap downscaled it to 1855x2400 and cost real accuracy — the same page
    # reads 1994-03-11 at full size and 1994-83-11 after the shrink. The cap
    # still bounds memory for large phone photos; a full-size page costs ~0.4s
    # per Tesseract pass against a 4s timeout, so there is ample headroom.
    image.thumbnail((3500, 3500), Image.Resampling.LANCZOS)
    if max(image.size) < 1600:
        scale = min(2.5, 1600 / max(image.size))
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)

    # The untouched grayscale page. Every other variant is tuned for photos of
    # monitors, and that denoise/sharpen/contrast chain measurably hurts clean
    # digital scans: on a rasterised PDF the processed variants read 1994-03-11
    # as 1994-63-11 while the plain image reads it correctly. Cheap to add and
    # it wins ties, since it is yielded first.
    yield "plain", image

    # Mild blur/median removes camera-screen colour grid without destroying glyphs.
    denoised = image.filter(ImageFilter.MedianFilter(size=3))
    sharp = denoised.filter(ImageFilter.UnsharpMask(radius=1.4, percent=170, threshold=3))
    contrast = ImageOps.autocontrast(sharp, cutoff=(1, 1))
    yield "gray", contrast

    # Adaptive-ish local threshold: divide the image into horizontal bands so
    # shadows on one part of a page do not erase text elsewhere.
    arr = np.asarray(contrast, dtype=np.uint8)
    thresholded = np.empty_like(arr)
    bands = 8
    for start in range(0, arr.shape[0], max(1, arr.shape[0] // bands)):
        end = min(arr.shape[0], start + max(1, arr.shape[0] // bands))
        band = arr[start:end]
        threshold = float(np.percentile(band, 58))
        thresholded[start:end] = np.where(band > threshold, 255, 0).astype(np.uint8)
    yield "threshold", Image.fromarray(thresholded, mode="L")

    # A softer variant is better for thin Bengali strokes and anti-aliased text.
    soft = ImageEnhance.Contrast(denoised).enhance(1.8)
    yield "soft", soft

    # Screen photos often have a coloured scan-line pattern. One RGB channel
    # can contain much cleaner glyphs than the combined grayscale image.
    for index, name in enumerate(("red", "green", "blue")):
        channel = source.getchannel(index).filter(ImageFilter.MedianFilter(size=3))
        channel = ImageOps.autocontrast(channel, cutoff=(1, 1))
        channel = channel.filter(ImageFilter.UnsharpMask(radius=1.1, percent=150, threshold=3))
        yield name, channel

    # Birth-certificate photos are commonly tight crops of a monitor. Running
    # the whole frame makes Tesseract mix the large header with the fields.
    # Crop the three useful bands so the registration number, DOB and name are
    # recognized independently.
    width, height = image.size
    bands = (
        ("field-top", (0, 0, width, round(height * 0.36))),
        ("field-middle", (0, round(height * 0.25), width, round(height * 0.62))),
        ("field-lower", (0, round(height * 0.48), width, height)),
    )
    for name, box in bands:
        crop = image.crop(box)
        crop = crop.resize((crop.width * 2, crop.height * 2), Image.Resampling.LANCZOS)
        crop = ImageOps.autocontrast(crop.filter(ImageFilter.MedianFilter(size=3)), cutoff=(1, 1))
        crop = crop.filter(ImageFilter.UnsharpMask(radius=1.2, percent=170, threshold=3))
        yield name, crop


def run_tesseract(image_path: Path, psm: int):
    command = [
        "tesseract", str(image_path), "stdout", "-l", "eng+ben",
        "--psm", str(psm), "-c", "preserve_interword_spaces=1",
    ]
    process = None
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True,
                                   start_new_session=True)
        stdout, _ = process.communicate(timeout=4)
    except subprocess.TimeoutExpired:
        if process is not None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        return "", 0
    text = (stdout or "").strip()
    # Tesseract confidence is not always available in stdout; use a stable
    # quality heuristic to reject empty/noise-only candidates.
    useful = len(re.findall(r"[A-Za-z0-9\u0980-\u09FF]", text))
    return text, useful


def letter_skeleton(line: str) -> str:
    """The line reduced to its letters, which OCR reads far more reliably than
    digits. Two readings of one source line share a skeleton even when their
    digits disagree."""
    return re.sub(r"[^A-Za-zঀ-৿]", "", line).lower()


def is_competing_reading(line: str, existing: list) -> bool:
    """True when `line` looks like another variant's reading of a line already
    collected, rather than a genuinely new line.

    Variants disagree on digits far more than on letters, so exact-match dedupe
    treats every misreading as a separate fact: one `DOB: 1994-03-11` arrives as
    `-63-`, `-93-`, `-83-` and `-@3-` and all four survive. Downstream matching
    then sees four conflicting dates for one document, which both hides the true
    value and inflates the chance of colliding with the wrong pending order.

    Trade-off: two genuinely different lines sharing letters but differing in
    digits (`Amount 500` / `Amount 700`) collapse to the first. Losing evidence
    only pushes a decision toward the review queue, whereas contradictory
    evidence can produce a wrong auto-delivery, so we accept that direction.
    """
    skeleton = letter_skeleton(line)
    if len(skeleton) < 3:
        return False
    for candidate in existing:
        if letter_skeleton(candidate) != skeleton:
            continue
        if difflib.SequenceMatcher(None, line, candidate).ratio() >= 0.75:
            return True
    return False


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"text": "", "error": "image path required"}))
        return 2
    image_path = Path(sys.argv[1])
    try:
        source = Image.open(image_path)
    except Exception as exc:
        print(json.dumps({"text": "", "error": f"cannot open image: {exc}"}))
        return 1

    candidates = []
    with tempfile.TemporaryDirectory(prefix="local-ocr-") as work:
        for name, image in variants(source):
            target = Path(work) / f"{name}.png"
            image.save(target, format="PNG", optimize=True)
            # Cropped field bands are already layout-constrained; one focused
            # pass avoids spending the full timeout on redundant page modes.
            psm_values = (6,) if name.startswith("field-") else (6, 11)
            for psm in psm_values:
                text, score = run_tesseract(target, psm)
                if text:
                    candidates.append((score, text, name, psm))

    if not candidates:
        print(json.dumps({"text": "", "error": "tesseract produced no output"}))
        return 0

    # Prefer the candidate containing the most real characters. Keep a second
    # candidate when it contains useful lines missing from the winner.
    candidates.sort(key=lambda item: item[0], reverse=True)
    winner = candidates[0]
    lines = [line.strip() for line in winner[1].splitlines() if line.strip()]
    seen = set(lines)
    for _, text, _, _ in candidates[1:]:
        for line in text.splitlines():
            line = line.strip()
            if len(line) < 4 or line in seen or len(lines) >= 80:
                continue
            if is_competing_reading(line, lines):
                continue
            lines.append(line)
            seen.add(line)
    print(json.dumps({
        "text": "\n".join(lines),
        "variant": winner[2],
        "psm": winner[3],
        "candidates": len(candidates),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
