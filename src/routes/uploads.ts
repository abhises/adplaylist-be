import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "../../uploads");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  },
});

// Shared by the Add-ad creative upload (images only, capped tighter
// client-side) and the Requests page's brief attachment (images, PDF, ZIP).
// The server accepts the union of both and enforces the larger 25 MB cap;
// each page applies its own stricter client-side check for its use case.
const ALLOWED_MIME = /^(image\/(png|jpe?g|webp|gif|svg\+xml)|application\/pdf|application\/zip|application\/x-zip-compressed)$/;

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type"));
    }
  },
});

const router = Router();

function handleUpload(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      return res.status(400).json({ error: message });
    }
    next();
  });
}

router.post(
  "/",
  requireAuth,
  handleUpload,
  (req: AuthedRequest, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const url = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    res.status(201).json({
      url,
      width: req.body.width ? Number(req.body.width) : undefined,
      height: req.body.height ? Number(req.body.height) : undefined,
    });
  }
);

export default router;
