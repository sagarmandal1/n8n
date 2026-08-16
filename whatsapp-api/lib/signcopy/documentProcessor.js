import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import { promisify } from "util";
import { execFile } from "child_process";
import axios from "axios";

const execFileAsync = promisify(execFile);

async function runCaptchaServiceOcr(imagePath) {
  const image = await fs.readFile(imagePath);
  const response = await axios.post("http://127.0.0.1:4004/api/ocr", {
    imageBase64: image.toString("base64"),
  }, {
    timeout: 30000,
    maxContentLength: 12 * 1024 * 1024,
    maxBodyLength: 12 * 1024 * 1024,
  });
  return String(response.data?.text || "").trim();
}

async function runTextExtraction(pdfPath) {
  const { stdout } = await execFileAsync("pdftotext", [
    "-layout",
    pdfPath,
    "-",
  ]);
  return String(stdout || "").trim();
}

async function runOcrExtraction(pdfPath) {
  const tmpDir = path.join(
    process.cwd(),
    "tmp",
    "signcopy",
    crypto.randomBytes(6).toString("hex"),
  );
  await fs.ensureDir(tmpDir);

  try {
    const prefix = path.join(tmpDir, "page");
    // 300 dpi is Tesseract's documented sweet spot. pdftoppm defaults to 150,
    // which misreads digits on otherwise clean pages (a 0 came back as @ or 6);
    // 400 is no better than 300 and costs more time and memory per page.
    await execFileAsync("pdftoppm", ["-r", "300", "-png", "-f", "1", "-l", "3", pdfPath, prefix]);
    const files = (await fs.readdir(tmpDir))
      .filter((file) => file.endsWith(".png"))
      .sort();

    let combined = "";
    for (const file of files) {
      const fullPath = path.join(tmpDir, file);
      const { stdout } = await execFileAsync("tesseract", [
        fullPath,
        "stdout",
        "-l",
        "eng+ben",
        "--psm",
        "6",
      ]);
      combined += `\n${stdout || ""}`;
    }

    return combined.trim();
  } finally {
    await fs.remove(tmpDir);
  }
}

async function runImageOcr(imagePath) {
  const tmpDir = path.join(
    process.cwd(),
    "tmp",
    "ocr",
    crypto.randomBytes(6).toString("hex"),
  );
  await fs.ensureDir(tmpDir);
  try {
    // Python/Pillow makes several variants and lets Tesseract choose the most
    // useful result. This handles screen photos better than one ImageMagick
    // pass, while keeping the OCR fully local.
    const script = path.join(process.cwd(), "lib", "signcopy", "local_ocr.py");
    const { stdout } = await execFileAsync("python3", [script, imagePath], {
      maxBuffer: 4 * 1024 * 1024,
      timeout: 90000,
    });
    const result = JSON.parse(String(stdout || "{}"));
    if (result.error) throw new Error(result.error);
    return String(result.text || "").trim();
  } finally {
    await fs.remove(tmpDir);
  }
}

export async function extractPdfText(pdfPath) {
  if (!pdfPath) {
    return { text: "", method: "NONE", error: "Missing PDF path" };
  }

  try {
    const directText = await runTextExtraction(pdfPath);
    if (directText && directText.length >= 20) {
      return { text: directText, method: "TEXT", error: null };
    }
  } catch (error) {
    // OCR fallback below.
  }

  try {
    const ocrText = await runOcrExtraction(pdfPath);
    if (ocrText && ocrText.length >= 10) {
      return { text: ocrText, method: "OCR", error: null };
    }
  } catch (error) {
    return { text: "", method: "NONE", error: error.message };
  }

  return { text: "", method: "NONE", error: "No readable text found" };
}

export async function extractImageText(imagePath) {
  if (!imagePath) return { text: "", method: "NONE", error: "Missing image path" };
  let localError = null;
  try {
    const text = await runImageOcr(imagePath);
    if (text && text.length >= 3) {
      return { text, method: "OCR", error: null };
    }
    localError = "No readable text found";
  } catch (error) {
    localError = error.message;
  }
  try {
    const fallback = await runCaptchaServiceOcr(imagePath);
    if (fallback.length >= 3) {
      return { text: fallback, method: "OCR", error: null };
    }
  } catch (_) {
    // Keep the original local OCR error in the result.
  }
  return { text: "", method: "NONE", error: localError || "No readable text found" };
}

export async function extractAudioText(audioPath) {
  if (!audioPath) return { text: "", method: "NONE", error: "Missing audio path" };
  try {
    const stat = await fs.stat(audioPath);
    if (stat.size > 25 * 1024 * 1024) {
      return { text: "", method: "NONE", error: "Audio file exceeds 25 MB limit" };
    }
    let result;
    try {
      const response = await axios.post(
        "http://127.0.0.1:4012/transcribe",
        { path: path.resolve(audioPath) },
        { timeout: 240000, maxContentLength: 1024 * 1024 },
      );
      result = response.data || {};
    } catch (_) {
      // The one-shot fallback keeps voice intake functional during a local
      // transcription-service restart.
      const script = path.join(process.cwd(), "lib", "signcopy", "local_voice.py");
      const python = path.join(process.cwd(), ".venv-voice", "bin", "python");
      const { stdout } = await execFileAsync(python, [script, audioPath], {
        maxBuffer: 2 * 1024 * 1024,
        timeout: 240000,
        env: { ...process.env, LOCAL_WHISPER_MODEL: process.env.LOCAL_WHISPER_MODEL || "base" },
      });
      result = JSON.parse(String(stdout || "{}"));
    }
    const text = String(result.text || "").trim();
    if (text) {
      return {
        text,
        method: "TRANSCRIPTION",
        error: null,
        language: result.language || "",
        languageProbability: Number(result.languageProbability || 0),
      };
    }
    return { text: "", method: "NONE", error: result.error || "No speech detected" };
  } catch (error) {
    return { text: "", method: "NONE", error: error.message };
  }
}

export function findMatchingDigits(text = "", digits = []) {
  if (!text || !digits.length) return [];
  return digits.filter((digit) => String(text).includes(String(digit)));
}
