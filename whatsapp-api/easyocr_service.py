#!/usr/bin/env python3

import os
import re
import threading
from pathlib import Path

import easyocr
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image, ImageOps

app = FastAPI()

ALLOWED_ROOT = Path(
    "/root/n8n/whatsapp-api/public/received_media"
).resolve()

reader = easyocr.Reader(
    ["bn", "en"],
    gpu=False,
    verbose=False,
)

lock = threading.Lock()


class OCRRequest(BaseModel):
    path: str


def allowed_file(raw_path: str) -> Path:
    p = Path(raw_path).resolve()

    try:
        p.relative_to(ALLOWED_ROOT)
    except ValueError:
        raise HTTPException(
            status_code=403,
            detail="Path outside received_media is not allowed",
        )

    if not p.is_file():
        raise HTTPException(status_code=404, detail="Image not found")

    return p


def normalize_key(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def useful(text: str) -> bool:
    chars = re.findall(r"[A-Za-z0-9\u0980-\u09FF]", text)
    return len(chars) >= 2


def run_region(image: Image.Image, region_name: str):
    arr = np.asarray(image)

    results = reader.readtext(
        arr,
        detail=1,
        paragraph=False,
        decoder="greedy",
        contrast_ths=0.05,
        adjust_contrast=0.7,
        text_threshold=0.5,
        low_text=0.25,
        link_threshold=0.3,
        mag_ratio=1.35,
    )

    out = []

    for _box, text, confidence in results:
        text = str(text or "").strip()
        confidence = float(confidence or 0)

        # Very-low-confidence noise is not useful for identity matching.
        # Keep 0.12+ because real names from difficult screen photos can
        # still appear below 0.50.
        if confidence < 0.12:
            continue

        if not useful(text):
            continue

        out.append({
            "text": text,
            "confidence": round(confidence, 4),
            "region": region_name,
        })

    return out


@app.get("/health")
def health():
    return {
        "ok": True,
        "engine": "easyocr",
        "languages": ["bn", "en"],
    }


@app.post("/ocr")
def ocr(body: OCRRequest):
    image_path = allowed_file(body.path)

    try:
        source = ImageOps.exif_transpose(
            Image.open(image_path)
        ).convert("RGB")
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot open image: {exc}",
        )

    # Prevent very large phone photos from consuming excessive RAM.
    source.thumbnail((2600, 2600), Image.Resampling.LANCZOS)

    w, h = source.size

    # Generic overlapping regions: no customer/name/layout is hard-coded.
    regions = [
        ("full", source),

        ("top",
         source.crop((
             0,
             0,
             w,
             int(h * 0.42),
         ))),

        ("middle",
         source.crop((
             0,
             int(h * 0.24),
             w,
             int(h * 0.70),
         ))),

        ("lower",
         source.crop((
             0,
             int(h * 0.50),
             w,
             h,
         ))),

        ("right-middle",
         source.crop((
             int(w * 0.36),
             int(h * 0.38),
             w,
             int(h * 0.90),
         ))),
    ]

    evidence = []
    seen = set()

    # EasyOCR/PyTorch CPU inference is deliberately serialized so several
    # simultaneous WhatsApp images cannot exhaust this VPS.
    with lock:
        for region_name, image in regions:
            for item in run_region(image, region_name):
                key = normalize_key(item["text"])

                if key in seen:
                    continue

                seen.add(key)
                evidence.append(item)

                if len(evidence) >= 100:
                    break

            if len(evidence) >= 100:
                break

    # Highest-confidence readings first. The backend will still perform
    # deterministic customer matching; OCR does NOT choose a customer.
    evidence.sort(
        key=lambda x: x["confidence"],
        reverse=True,
    )

    text = "\n".join(item["text"] for item in evidence)

    return {
        "text": text,
        "engine": "easyocr",
        "languages": ["bn", "en"],
        "regions": len(regions),
        "evidence": evidence,
    }
