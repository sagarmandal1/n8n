import multer from "multer";
import path from "path";
import fs from "fs";

// Ensure uploads directory exists
const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.wav', '.ogg', '.mp4', '.mpeg', '.avi', '.mov', '.pdf', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.rar'];
const BLOCKED_EXTENSIONS = ['.html', '.htm', '.svg', '.js', '.jsx', '.ts', '.tsx', '.php', '.php5', '.phtml', '.asp', '.aspx', '.jsp', '.sh', '.bat', '.cmd', '.exe', '.msi', '.pl', '.py'];

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname).toLowerCase());
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max per file to be safe on disk
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

export default upload;
