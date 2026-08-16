#!/usr/bin/env python3
"""Bounded local WhatsApp voice-note transcription."""

import json
import os
import sys
from pathlib import Path

from faster_whisper import WhisperModel


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"text": "", "error": "audio path required"}))
        return 2

    audio_path = Path(sys.argv[1])
    if not audio_path.is_file():
        print(json.dumps({"text": "", "error": "audio file not found"}))
        return 2
    if audio_path.stat().st_size > 25 * 1024 * 1024:
        print(json.dumps({"text": "", "error": "audio file exceeds 25 MB limit"}))
        return 2

    project_root = Path(__file__).resolve().parents[2]
    model_name = os.environ.get("LOCAL_WHISPER_MODEL", "base")
    model_dir = project_root / ".models" / "faster-whisper"
    model_dir.mkdir(parents=True, exist_ok=True)

    try:
        model = WhisperModel(
            model_name,
            device="cpu",
            compute_type="int8",
            download_root=str(model_dir),
            cpu_threads=max(1, min(4, os.cpu_count() or 1)),
            num_workers=1,
        )
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
            text = (segment.text or "").strip()
            if text:
                pieces.append(text)
            duration = max(duration, float(segment.end or 0))
        result = " ".join(pieces).strip()[:12000]
        print(json.dumps({
            "text": result,
            "language": info.language,
            "languageProbability": round(float(info.language_probability or 0), 4),
            "duration": round(duration, 2),
            "model": model_name,
            "error": "" if result else "No speech detected",
        }, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"text": "", "error": str(exc)[:1000]}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
