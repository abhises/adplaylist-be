import crypto from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "./prisma.js";
import { supabase, UPLOADS_BUCKET } from "./supabase.js";

// Unpaid users' downloads get a copy of the creative with a faint repeating
// "ADPLAYLIST" mark baked into the file. Pages, staff and paid plans get the
// clean upload.

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

// Watermarks `input` and uploads the result under the keyword file name
// (e.g. dog-food-testimonial-ad-1200x1200.png) in a folder of its own, so two
// ads can share a name. Returns the new public URL.
export async function publishWatermarked(input: Buffer, fileName: string) {
  const { buffer, ext, type } = await watermarkImage(input);
  const base = slug(path.basename(fileName, path.extname(fileName))) || "ad-creative";
  const key = `ads/${crypto.randomBytes(4).toString("hex")}/${base}${ext}`;
  const { error } = await supabase.storage
    .from(UPLOADS_BUCKET)
    .upload(key, buffer, { contentType: type, cacheControl: "31536000" });
  if (error) throw error;
  return supabase.storage.from(UPLOADS_BUCKET).getPublicUrl(key).data.publicUrl;
}

// The ad's watermarked copy, made and saved on first need. Null when the ad
// has no image.
export async function watermarkedCopyOf(ad: {
  id: number;
  slug: string;
  photoUrl: string | null;
  watermarkedPhotoUrl: string | null;
  imageFileName: string | null;
}) {
  if (ad.watermarkedPhotoUrl) return ad.watermarkedPhotoUrl;
  if (!ad.photoUrl) return null;
  const res = await fetch(ad.photoUrl);
  if (!res.ok) throw new Error(`Couldn't fetch the creative (${res.status})`);
  const url = await publishWatermarked(
    Buffer.from(await res.arrayBuffer()),
    ad.imageFileName || ad.slug
  );
  // Only if the image hasn't changed meanwhile (an admin re-uploading it).
  await prisma.ad.updateMany({
    where: { id: ad.id, photoUrl: ad.photoUrl },
    data: { watermarkedPhotoUrl: url },
  });
  return url;
}
