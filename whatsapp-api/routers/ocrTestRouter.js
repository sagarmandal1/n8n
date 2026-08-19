import { Router } from "express";
import multer from "multer";
import fs from "fs-extra";
import os from "os";
import path from "path";
import crypto from "crypto";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { extractImageTextFast } from "../lib/signcopy/documentProcessor.js";

const router = Router();
const limiter = new RateLimiterMemory({ points: 5, duration: 60 });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype.toLowerCase().startsWith("image/"));
  },
});

function cleanOcrText(value = "") {
  const lines = String(value)
    .normalize("NFKC")
    .split(/\r?\n/u)
    .map((line) => line.replace(/[ \t]+/gu, " ").trim())
    .filter((line) => line.length >= 3);
  const seen = new Set();
  return lines.filter((line) => {
    const key = line.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join("\n");
}

export function formatOcrResult(rawText) {
  const cleanedText = cleanOcrText(rawText);
  const registrationCandidates = [];
  for (const line of cleanedText.split("\n")) {
    const digits = line.replace(/\D/gu, "");
    if (digits.length === 17) {
      const labelled = /(registration|birth|নিবন্ধন|রেজিস্ট্রেশন)/iu.test(line);
      registrationCandidates.push({ digits, score: (line.length <= 28 ? 100 : 0) + (labelled ? 20 : 0) });
    }
  }
  registrationCandidates.sort((a, b) => b.score - a.score);
  const labelledRegistration = cleanedText.match(/(?:birth\s+)?registration\s+number\s*[:.-]?\s*(\d{17})/iu);
  const birthRegistrationNumber = labelledRegistration?.[1] || registrationCandidates[0]?.digits || null;
  const dateMatch = cleanedText.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/u);
  const bengaliNameMatch = cleanedText.match(/name\s*\(\s*bengali\s*\)\s*[:.-]?\s*([^\n]+)/iu);
  const englishNameMatch = cleanedText.match(/(?:^|\n)\s*name(?:\s*\(\s*english\s*\))?\s*[:.-]\s*([^\n]+)/iu);
  const banglaNameMatch = cleanedText.match(/(?:^|\n)\s*নাম\s*[:.-]?\s*([^\n]+)/u);
  const registeredNameMatch = cleanedText.match(/registered\s+name\s*[:.-]?\s*([^\n]+)/iu);
  const rawName = englishNameMatch?.[1]?.trim() || registeredNameMatch?.[1]?.trim() || banglaNameMatch?.[1]?.trim() || bengaliNameMatch?.[1]?.trim() || "";
  const parenthetical = rawName.match(/\(([^()]*)\)/u)?.[1] || "";
  const bengaliInParentheses = parenthetical.split("/").map((part) => part.trim()).find((part) => /[ঀ-৿]/u.test(part)) || null;
  const englishInParentheses = parenthetical.split("/").map((part) => part.trim()).find((part) => part && !/[ঀ-৿]/u.test(part)) || null;
  const labelledBengaliName = bengaliNameMatch?.[1]
    ? bengaliNameMatch[1].replace(/[^ঀ-৿\s]/gu, " ").replace(/\s+/gu, " ").trim() || null
    : null;
  const candidateEnglishName = englishInParentheses || rawName.replace(/\([^)]*\)/u, "").replace(/[.:]+$/u, "").trim() || null;
  const cleanEnglishName = candidateEnglishName && !/(partially visible|cut off|not visible|unreadable)/iu.test(candidateEnglishName)
    ? candidateEnglishName
    : null;

  return {
    cleaned_text: cleanedText,
    fields: {
      birth_registration_number: birthRegistrationNumber,
      date_of_birth: dateMatch ? dateMatch[0].replace(/[.-]/gu, "/") : null,
      name: cleanEnglishName,
      name_bengali: labelledBengaliName || bengaliInParentheses,
    },
  };
}

router.get("/", (_req, res) => {
  res.json({
    success: true,
    service: "free-local-bangla-english-ocr",
    usage: "POST multipart/form-data with field image",
    example: "curl -F image=@document.jpg https://wa-api.bdx.kg/api/ocr-test",
    note: "Fast local OCR; screen photos usually return in about 10–20 seconds.",
  });
});

router.post("/", upload.single("image"), async (req, res) => {
  try {
    await limiter.consume(req.ip);
  } catch {
    return res.status(429).json({ success: false, error: "OCR rate limit reached; try again later" });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, error: "Upload an image in the 'image' field" });
  }

  const tempPath = path.join(os.tmpdir(), `ocr-test-${crypto.randomBytes(8).toString("hex")}${path.extname(req.file.originalname) || ".bin"}`);
  try {
    await fs.writeFile(tempPath, req.file.buffer);
    const result = await extractImageTextFast(tempPath);
    const formatted = formatOcrResult(result.text);
    return res.json({
      success: true,
      text: formatted.cleaned_text,
      raw_text: result.text,
      fields: formatted.fields,
      method: result.method,
      error: result.error,
      file: { name: req.file.originalname, mime: req.file.mimetype, bytes: req.file.size },
    });
  } catch (error) {
    console.error("OCR test error:", error);
    return res.status(500).json({ success: false, error: error.message || "OCR failed" });
  } finally {
    await fs.remove(tempPath).catch(() => {});
  }
});

export default router;
