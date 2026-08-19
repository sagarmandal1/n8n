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


export async function extractImageTextEasyOcr(imagePath) {
  if (!imagePath) {
    return { text: "", method: "NONE", error: "Missing image path" };
  }

  try {
    const response = await axios.post(
      "http://127.0.0.1:4014/ocr",
      { path: path.resolve(imagePath) },
      {
        timeout: 75000,
        maxContentLength: 2 * 1024 * 1024,
        maxBodyLength: 2 * 1024 * 1024,
      },
    );

    const text = String(response.data?.text || "").trim();

    return {
      text,
      method: text ? "EASYOCR" : "NONE",
      error: text ? null : "EasyOCR returned no readable text",
    };
  } catch (error) {
    return {
      text: "",
      method: "NONE",
      error: `EasyOCR unavailable: ${error.message}`,
    };
  }
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

async function runImageOcr(imagePath, fast = false) {
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
    const args = fast ? [script, imagePath, "--fast"] : [script, imagePath];
    const { stdout } = await execFileAsync("python3", args, {
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
  if (!imagePath) {
    return { text: "", method: "NONE", error: "Missing image path" };
  }

  let localText = "";
  let fallbackText = "";
  let localError = null;

  // Attempts 1-4 are handled inside local_ocr.py:
  // full-frame variants, broad field crops, focused red-name,
  // and focused green-name OCR.
  try {
    localText = String(await runImageOcr(imagePath) || "").trim();
    if (!localText) localError = "No readable local OCR text found";
  } catch (error) {
    localError = error.message;
  }

  // Attempt 5: always run the independent fallback OCR service.
  // Do not skip it merely because local OCR produced a few noisy characters.
  try {
    fallbackText = String(await runCaptchaServiceOcr(imagePath) || "").trim();
  } catch (_) {
    // Local OCR can still succeed when fallback service is unavailable.
  }

  const lines = [];
  const seen = new Set();

  for (const block of [localText, fallbackText]) {
    for (const rawLine of String(block || "").split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (line.length < 3) continue;

      const key = line
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\s+/gu, " ");

      if (!key || seen.has(key)) continue;

      seen.add(key);
      lines.push(line);

      if (lines.length >= 120) break;
    }

    if (lines.length >= 120) break;
  }

  const combined = lines.join("\n").trim();

  if (combined.length >= 3) {
    return {
      text: combined,
      method: fallbackText ? "OCR_MULTI_PASS" : "OCR",
      error: null,
    };
  }

  return {
    text: "",
    method: "NONE",
    error: localError || "No readable text found after all OCR attempts",
  };
}

// A scanned PDF used to get markedly weaker OCR than the same page sent as a
// photo: images run the multi-variant local engine and can fall back to
// EasyOCR, while a PDF got one plain Tesseract pass per rendered page. Same
// document, same customer, different odds of being delivered.
//
// This is the PDF equivalent of the image fallback. It is deliberately NOT part
// of extractPdfText: stage 1 (pdftotext) and stage 2 (rasterise + one Tesseract
// pass) are fast and resolve most documents, so this only runs once matching has
// already failed — the same cheap-first order the image path uses.
//
// Pages are rendered inside public/received_media because the EasyOCR service
// refuses any path outside that root.
const PDF_DEEP_PAGE_LIMIT = 2;

export async function extractPdfTextDeep(pdfPath) {
  if (!pdfPath) {
    return { text: "", method: "NONE", error: "Missing PDF path" };
  }

  const workDir = path.join(
    process.cwd(),
    "public",
    "received_media",
    ".pdf-pages",
    crypto.randomBytes(6).toString("hex"),
  );
  await fs.ensureDir(workDir);

  try {
    const prefix = path.join(workDir, "page");
    await execFileAsync("pdftoppm", [
      "-r", "300", "-png", "-f", "1", "-l", String(PDF_DEEP_PAGE_LIMIT), pdfPath, prefix,
    ]);

    const pages = (await fs.readdir(workDir))
      .filter((file) => file.endsWith(".png"))
      .sort();

    if (!pages.length) {
      return { text: "", method: "NONE", error: "PDF produced no rendered pages" };
    }

    const lines = [];
    const seen = new Set();

    const addText = (block) => {
      for (const rawLine of String(block || "").split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (line.length < 3) continue;

        const key = line.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ");
        if (!key || seen.has(key)) continue;

        seen.add(key);
        lines.push(line);

        if (lines.length >= 160) return;
      }
    };

    let usedEasyOcr = false;

    for (const page of pages) {
      const pagePath = path.join(workDir, page);

      // Multi-variant local OCR: the same engine, preprocessing and
      // competing-reading dedupe the image path relies on.
      //
      // Fast mode, and not only for speed. A rendered page arrives at native
      // 300-dpi size, where full mode keeps every bit of scan-line and sensor
      // noise; measured on a degraded certificate it spent 94s and returned
      // unusable text. Fast mode's 1400px working image averages that noise
      // away and read the same page correctly in 2s. Downsampling is itself a
      // denoiser here, so the cheaper path is also the more accurate one.
      try {
        addText(await runImageOcr(pagePath, true));
      } catch (_) {
        // A failed page must not lose the pages that did read.
      }

      const easy = await extractImageTextEasyOcr(pagePath);
      if (easy.text) {
        usedEasyOcr = true;
        addText(easy.text);
      }
    }

    const text = lines.join("\n").trim();

    if (!text) {
      return { text: "", method: "NONE", error: "No readable text found in rendered PDF pages" };
    }

    return {
      text,
      method: usedEasyOcr ? "PDF_DEEP_MULTI_PASS" : "PDF_DEEP_LOCAL",
      error: null,
    };
  } catch (error) {
    return { text: "", method: "NONE", error: error.message };
  } finally {
    await fs.remove(workDir);
  }
}

export async function extractImageTextFast(imagePath) {
  if (!imagePath) return { text: "", method: "NONE", error: "Missing image path" };
  try {
    const text = String(await runImageOcr(imagePath, true) || "").trim();
    return { text, method: text ? "OCR_FAST_LOCAL" : "NONE", error: text ? null : "No readable text found" };
  } catch (error) {
    return { text: "", method: "NONE", error: error.message };
  }
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
