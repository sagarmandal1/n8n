#!/usr/bin/env python3
"""Local-only persistent Faster-Whisper service for WhatsApp voice notes."""

import asyncio
import os
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from faster_whisper import WhisperModel

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MEDIA_ROOT = (PROJECT_ROOT / "public" / "received_media").resolve()
MODEL_NAME = os.environ.get("LOCAL_WHISPER_MODEL", "base")
MODEL_ROOT = PROJECT_ROOT / ".models" / "faster-whisper"

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
model = WhisperModel(
    MODEL_NAME,
    device="cpu",
    compute_type="int8",
    download_root=str(MODEL_ROOT),
    cpu_threads=max(1, min(4, os.cpu_count() or 1)),
    num_workers=1,
)
transcription_lock = asyncio.Lock()


class AudioRequest(BaseModel):
    path: str


def transcribe_file(audio_path: Path):
    segments, info = model.transcribe(
        str(audio_path),
        beam_size=2,
        best_of=2,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=True,
    )
    pieces = []
    duration = 0.0
    for segment in segments:
        if segment.start > 300:
            break
        value = (segment.text or "").strip()
        if value:
            pieces.append(value)
        duration = max(duration, float(segment.end or 0))
    text = " ".join(pieces).strip()[:12000]
    return {
        "text": text,
        "language": info.language,
        "languageProbability": round(float(info.language_probability or 0), 4),
        "duration": round(duration, 2),
        "model": MODEL_NAME,
        "error": "" if text else "No speech detected",
    }


@app.get("/healthz")
async def health():
    return {"ok": True, "model": MODEL_NAME}


@app.post("/transcribe")
async def transcribe(request: AudioRequest):
    audio_path = Path(request.path).resolve()
    if MEDIA_ROOT not in audio_path.parents:
        raise HTTPException(status_code=400, detail="Path is outside the received-media directory")
    if not audio_path.is_file():
        raise HTTPException(status_code=404, detail="Audio file not found")
    if audio_path.stat().st_size > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio file exceeds 25 MB limit")
    async with transcription_lock:
        return await asyncio.to_thread(transcribe_file, audio_path)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=4012, log_level="warning")
