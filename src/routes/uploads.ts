import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { uploadSignSchema } from "../validation/schemas.js";
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

// The proxy in front of this API (Varnish/Apache, inherited from this app's
// original PHP hosting) corrupts multipart/form-data bodies in transit —
// verified by comparing a direct-to-localhost upload (succeeds) against the
// same request through the public domain (fails with "Unexpected end of
// form" regardless of file size). Browsers upload straight to Supabase
// instead, using a short-lived signed URL issued here, so the file bytes
// never pass through that proxy.
router.post(
  "/sign",
  requireAuth,
  validateBody(uploadSignSchema),
  async (req: AuthedRequest, res: Response) => {
    const { filename, contentType } = req.body;
    if (!ALLOWED_MIME.test(contentType)) {
      return res.status(400).json({ error: "Unsupported file type" });
    }

    const ext = path.extname(filename).toLowerCase();
    const key = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;

    const { data, error } = await supabase.storage
      .from(UPLOADS_BUCKET)
      .createSignedUploadUrl(key);

    if (error || !data) {
      console.error("Failed to create signed upload URL:", error);
      return res.status(500).json({ error: "Could not prepare upload" });
    }

    const { data: publicUrlData } = supabase.storage
      .from(UPLOADS_BUCKET)
      .getPublicUrl(key);

    res.status(201).json({
      path: key,
      token: data.token,
      signedUrl: data.signedUrl,
      url: publicUrlData.publicUrl,
    });
  }
);

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
