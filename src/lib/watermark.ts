import crypto from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { supabase, UPLOADS_BUCKET } from "./supabase.js";

// Ad creatives are published with a faint repeating "ADPLAYLIST" mark baked
// into the file, so saving the image from a page (right-click, drag, open in
// new tab) keeps it. The clean upload is kept as the ad's original, for
// signed-in users' downloads.

// The pattern of the "Public ad page" prototype (tiles about a third of the
// image wide, rotated -30°), in white with a faint dark outline so it shows
// on both light and dark parts of a photo.
function watermarkSvg(width: number, height: number) {
  const tileW = Math.max(120, Math.round(width * 0.34));
  const tileH = Math.round(tileW * 0.4);
  const fontSize = Math.round(tileW * 0.07);
  const spacing = (fontSize * 0.21).toFixed(1);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <pattern id="wm" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse"
      patternTransform="rotate(-30 ${width / 2} ${height / 2})">
      <text x="${tileW / 2}" y="${Math.round(tileH * 0.56)}" text-anchor="middle"
        font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-weight="bold"
        font-size="${fontSize}" letter-spacing="${spacing}"
        fill="#ffffff" fill-opacity="0.32"
        stroke="#000000" stroke-opacity="0.18" stroke-width="${Math.max(1, fontSize * 0.06).toFixed(1)}">ADPLAYLIST</text>
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#wm)"/>
</svg>`
  );
}

const FORMATS = {
  png: { ext: ".png", type: "image/png" },
  jpeg: { ext: ".jpg", type: "image/jpeg" },
  webp: { ext: ".webp", type: "image/webp" },
} as const;

// Returns the image with the watermark drawn over it, in the same format
// (PNG, JPEG or WebP; anything else, e.g. GIF or SVG, becomes PNG).
export async function watermarkImage(input: Buffer) {
  const image = sharp(input, { animated: false }).rotate();
  const meta = await image.metadata();
  // .rotate() applies the EXIF orientation; 5–8 mean the photo is turned a
  // quarter, so its displayed width and height are swapped.
  const turned = (meta.orientation ?? 1) >= 5;
  const width = turned ? meta.height : meta.width;
  const height = turned ? meta.width : meta.height;
  if (!width || !height) throw new Error("Couldn't read the image size");

  const format = meta.format === "jpeg" || meta.format === "webp" ? meta.format : "png";
  const composed = image.composite([{ input: watermarkSvg(width, height), top: 0, left: 0 }]);
  const buffer =
    format === "jpeg"
      ? await composed.jpeg({ quality: 90 }).toBuffer()
      : format === "webp"
        ? await composed.webp({ quality: 90 }).toBuffer()
        : await composed.png().toBuffer();
  return { buffer, ...FORMATS[format] };
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 120);

// Downloads `originalUrl`, watermarks it and uploads the result under the
// keyword file name (e.g. dog-food-testimonial-ad-1200x1200.png) in a folder
// of its own, so two ads can share a name. Returns the new public URL.
export async function publishWatermarked(originalUrl: string, fileName: string) {
  const res = await fetch(originalUrl);
  if (!res.ok) throw new Error(`Couldn't fetch the creative (${res.status})`);
  const { buffer, ext, type } = await watermarkImage(Buffer.from(await res.arrayBuffer()));

  const base = slug(path.basename(fileName, path.extname(fileName))) || "ad-creative";
  const key = `ads/${crypto.randomBytes(4).toString("hex")}/${base}${ext}`;
  const { error } = await supabase.storage
    .from(UPLOADS_BUCKET)
    .upload(key, buffer, { contentType: type, cacheControl: "31536000" });
  if (error) throw error;
  return supabase.storage.from(UPLOADS_BUCKET).getPublicUrl(key).data.publicUrl;
}

// Works out an ad's published (watermarked) and original image when it's
// saved:
// - unchanged image and name: kept as they are;
// - same image, new SEO file name: re-published from the original;
// - a new upload (or an ad from before watermarking): the upload becomes the
//   original and a watermarked copy is published.
// If watermarking fails the clean image is used as before, so saving an ad
// never fails over it; the failure is logged.
export async function prepareCreative({
  photoUrl,
  fileName,
  existing,
}: {
  photoUrl: string | null;
  fileName: string;
  existing?: { photoUrl: string | null; originalPhotoUrl: string | null } | null;
}): Promise<{ photoUrl: string | null; originalPhotoUrl: string | null }> {
  if (!photoUrl) return { photoUrl: null, originalPhotoUrl: null };

  const keepsImage = !!existing && photoUrl === existing.photoUrl;
  const original =
    keepsImage && existing.originalPhotoUrl ? existing.originalPhotoUrl : photoUrl;

  if (keepsImage && existing.originalPhotoUrl) {
    const wantedBase = slug(path.basename(fileName, path.extname(fileName)));
    const currentBase = path.basename(photoUrl, path.extname(photoUrl));
    if (!wantedBase || wantedBase === currentBase) {
      return { photoUrl, originalPhotoUrl: existing.originalPhotoUrl };
    }
  }

  try {
    return { photoUrl: await publishWatermarked(original, fileName), originalPhotoUrl: original };
  } catch (err) {
    console.error("Watermarking the creative failed; publishing it without:", err);
    return { photoUrl: original, originalPhotoUrl: null };
  }
}
