import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs-extra";
import { authenticate } from "../middlewares/authMiddleware.js";

const uploadRouter = Router();

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");
fs.ensureDirSync(UPLOADS_DIR);

const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.wav', '.ogg', '.mp4', '.mpeg', '.avi', '.mov', '.pdf', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.rar'];
const BLOCKED_EXTENSIONS = ['.html', '.htm', '.svg', '.js', '.jsx', '.ts', '.tsx', '.php', '.php5', '.phtml', '.asp', '.aspx', '.jsp', '.sh', '.bat', '.cmd', '.exe', '.msi', '.pl', '.py'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max per file
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext) || BLOCKED_EXTENSIONS.includes(ext)) {
      return cb(new Error("Forbidden file type/extension"), false);
    }

    const mime = file.mimetype.toLowerCase();
    const isAllowedMime = 
      mime.startsWith("image/") || 
      mime.startsWith("audio/") || 
      mime.startsWith("video/") || 
      [
        "application/pdf", 
        "text/plain", 
        "application/msword", 
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/zip",
        "application/x-rar-compressed",
        "application/octet-stream"
      ].includes(mime);

    if (!isAllowedMime) {
      return cb(new Error("Invalid MIME type"), false);
    }
    cb(null, true);
  }
});

uploadRouter.post("/", authenticate, (req, res, next) => {
  upload.single("media")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }

    // Determine mediaType based on mimetype
    let mediaType = "document";
    const mime = req.file.mimetype;
    if (mime.startsWith("image/")) mediaType = "image";
    else if (mime.startsWith("video/")) mediaType = "video";
    else if (mime.startsWith("audio/")) mediaType = "audio";

    const publicUrl = `/uploads/${req.file.filename}`;

    res.json({
      success: true,
      url: publicUrl,
      mediaType: mediaType,
      message: "File uploaded successfully",
    });
  });
});

export default uploadRouter;
