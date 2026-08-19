import { Router } from "express";
import multer from "multer";
import fs from "fs-extra";
import os from "os";
import path from "path";
import crypto from "crypto";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { extractGoogleLensText } from "../lib/signcopy/googleLensOcr.js";
import { formatOcrResult } from "./ocrTestRouter.js";

const router = Router();
const limiter = new RateLimiterMemory({ points: 2, duration: 60 });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.toLowerCase().startsWith("image/")),
});

router.get("/", (_req, res) => res.json({
  success: true,
  service: "google-lens-web-ocr",
  usage: "POST multipart/form-data with field image",
  note: "Uses the verified Chromium Google Lens session on this VPS.",
}));

router.post("/", upload.single("image"), async (req, res) => {
  try {
    await limiter.consume(req.ip);
  } catch {
    return res.status(429).json({ success: false, error: "Google Lens rate limit reached; try again later" });
  }
  if (!req.file) return res.status(400).json({ success: false, error: "Upload an image in the 'image' field" });

  const tempPath = path.join(os.tmpdir(), `ocr-lens-${crypto.randomBytes(8).toString("hex")}${path.extname(req.file.originalname) || ".bin"}`);
  try {
    await fs.writeFile(tempPath, req.file.buffer);
    const result = await extractGoogleLensText(tempPath);
    const formatted = formatOcrResult(result.text);
    return res.json({
      success: Boolean(result.text),
      fields: formatted.fields,
      method: result.method,
      error: result.error,
      file: { name: req.file.originalname, mime: req.file.mimetype, bytes: req.file.size },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "Google Lens OCR failed" });
  } finally {
    await fs.remove(tempPath).catch(() => {});
  }
});

export default router;
