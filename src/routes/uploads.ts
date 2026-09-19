import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { supabase, UPLOADS_BUCKET } from "../lib/supabase.js";

// Shared by the Add-ad creative upload (images only, capped tighter
// client-side) and the Requests page's brief attachment (images, PDF, ZIP).
// The server accepts the union of both and enforces the larger 25 MB cap;
// each page applies its own stricter client-side check for its use case.
const ALLOWED_MIME = /^(image\/(png|jpe?g|webp|gif|svg\+xml)|application\/pdf|application\/zip|application\/x-zip-compressed)$/;

const upload = multer({
  storage: multer.memoryStorage(),
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
  async (req: AuthedRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const ext = path.extname(req.file.originalname).toLowerCase();
    const key = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(UPLOADS_BUCKET)
      .upload(key, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: "31536000",
      });

    if (uploadError) {
      console.error("Supabase upload failed:", uploadError);
      return res.status(500).json({ error: "Upload failed" });
    }

    const { data } = supabase.storage.from(UPLOADS_BUCKET).getPublicUrl(key);

    res.status(201).json({
      url: data.publicUrl,
      width: req.body.width ? Number(req.body.width) : undefined,
      height: req.body.height ? Number(req.body.height) : undefined,
    });
  }
);

export default router;
