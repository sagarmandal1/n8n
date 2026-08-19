#!/usr/bin/env python3

import os

# Limit PyTorch/OpenMP pressure on this production VPS.
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")

import re
import threading
import time
from pathlib import Path

import easyocr
import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image, ImageOps

torch.set_num_threads(2)
try:
    torch.set_num_interop_threads(1)
except RuntimeError:
    pass

app = FastAPI()

ALLOWED_ROOT = Path(
    "/root/n8n/whatsapp-api/public/received_media"
).resolve()

reader = easyocr.Reader(
    ["bn", "en"],
    gpu=False,
    verbose=False,
)

ocr_lock = threading.Lock()


class OCRRequest(BaseModel):
    path: str


def resolve_image(raw_path: str) -> Path:
    p = Path(raw_path).resolve()

    try:
        p.relative_to(ALLOWED_ROOT)
    except ValueError:
        raise HTTPException(
            status_code=403,
            detail="Path outside received_media is not allowed",
        )

    if not p.is_file():
        raise HTTPException(
            status_code=404,
            detail="Image not found",
        )

    return p


def text_key(text: str) -> str:
    return re.sub(
        r"\s+",
        " ",
        str(text or "").strip().lower(),
    )


def useful_text(text: str) -> bool:
    chars = re.findall(
        r"[A-Za-z0-9\u0980-\u09FF]",
        str(text or ""),
    )
    return len(chars) >= 2


def box_rect(box):
    xs = [float(point[0]) for point in box]
    ys = [float(point[1]) for point in box]

    return (
        int(min(xs)),
        int(min(ys)),
        int(max(xs)),
        int(max(ys)),
    )


def identity_label(text: str):
    original = str(text or "")
    low = original.lower().strip()

    if (
        re.search(r"\bname\b", low)
        or "নাম" in original
    ):
        return "name"

    if (
        re.search(
            r"\b(?:date\s*of\s*birth|dob|birth\s*date)\b",
            low,
        )
        or "জন্ম তারিখ" in original
        or "জন্মতারিখ" in original
    ):
        return "dob"

    return None


def run_easyocr(image: Image.Image, region: str):
    results = reader.readtext(
        np.asarray(image),
        detail=1,
        paragraph=False,
        decoder="greedy",
        batch_size=1,
        workers=0,
        canvas_size=1920,
        mag_ratio=1.0,
        contrast_ths=0.05,
        adjust_contrast=0.7,
        text_threshold=0.50,
        low_text=0.25,
        link_threshold=0.30,
    )

    output = []

    for box, text, confidence in results:
        text = str(text or "").strip()
        confidence = float(confidence or 0)

        if confidence < 0.10:
            continue

        if not useful_text(text):
            continue

        output.append({
            "text": text,
            "confidence": round(confidence, 4),
            "region": region,
            "box": box_rect(box),
        })

    return output


def make_field_crop(
    source: Image.Image,
    rect,
):
    w, h = source.size
    x1, y1, x2, y2 = rect

    # Identity forms normally place the value beside or just below
    # the label. Include most of the row to remain layout-independent.
    left = max(
        0,
        min(x1, int(w * 0.08)),
    )
    top = max(
        0,
        y1 - int(h * 0.045),
    )
    right = w
    bottom = min(
        h,
        y2 + int(h * 0.09),
    )

    crop = source.crop(
        (left, top, right, bottom)
    )

    # Small field rows benefit from enlargement.
    if max(crop.size) < 2200:
        scale = min(
            2.2,
            2200 / max(crop.size),
        )

        crop = crop.resize(
            (
                max(1, round(crop.width * scale)),
                max(1, round(crop.height * scale)),
            ),
            Image.Resampling.LANCZOS,
        )

    return crop


@app.get("/health")
def health():
    return {
        "ok": True,
        "engine": "easyocr",
        "languages": ["bn", "en"],
        "mode": "full-plus-dynamic-fields",
    }


@app.post("/ocr")
def ocr(body: OCRRequest):
    started = time.time()
    image_path = resolve_image(body.path)

    try:
        source = ImageOps.exif_transpose(
            Image.open(image_path)
        ).convert("RGB")
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot open image: {exc}",
        )

    # Bound CPU/RAM use.
    source.thumbnail(
        (1800, 1800),
        Image.Resampling.LANCZOS,
    )

    evidence = []
    seen = set()

    def add(items):
        for item in items:
            key = text_key(item["text"])

            if not key or key in seen:
                continue

            seen.add(key)
            evidence.append(item)

    with ocr_lock:
        # PASS 1:
        # Whole document. Gets DOB, BRN/NID, labels and most names.
        full = run_easyocr(
            source,
            "full",
        )
        add(full)

        # PASS 2/3:
        # Dynamically locate Name/DOB labels and reread only those rows.
        # Maximum one crop per field, so this never becomes a 5-large-image
        # EasyOCR loop.
        field_boxes = {}

        for item in full:
            field = identity_label(
                item["text"]
            )

            if field and field not in field_boxes:
                field_boxes[field] = item["box"]

        for field in ("name", "dob"):
            rect = field_boxes.get(field)

            if not rect:
                continue

            crop = make_field_crop(
                source,
                rect,
            )

            focused = run_easyocr(
                crop,
                f"focused-{field}",
            )

            add(focused)

    # Keep stronger evidence first but retain weaker OCR evidence for the
    # deterministic backend matcher. OCR itself never chooses a customer.
    evidence.sort(
        key=lambda item: item["confidence"],
        reverse=True,
    )

    text = "\n".join(
        item["text"]
        for item in evidence
    )

    return {
        "text": text,
        "engine": "easyocr",
        "languages": ["bn", "en"],
        "passes": 1 + len(field_boxes),
        "elapsedMs": round(
            (time.time() - started) * 1000
        ),
        "evidence": evidence[:100],
    }
