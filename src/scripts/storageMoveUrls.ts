// Points the database at S3 instead of Supabase: every stored file URL under
// the Supabase project's public "uploads" bucket becomes the same key's S3
// URL. Run storage:backup and upload the files to S3 first; a URL is only
// changed once its file is reachable on S3. Without --apply it just reports.
//
//   npm run storage:move-urls            (dry run)
//   npm run storage:move-urls -- --apply
import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { s3PublicUrl, STORAGE_DRIVER } from "../lib/storage.js";

const apply = process.argv.includes("--apply");
if (STORAGE_DRIVER !== "s3") {
  console.error("Set STORAGE_DRIVER=s3 (and the S3 settings) in .env first.");
  process.exit(1);
}

const SUPABASE_PREFIX = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/uploads\//;

// Every column that stores an uploaded file's URL.
const COLUMNS = [
  ["ads", "photo_url"],
  ["ads", "watermarked_photo_url"],
  ["ads", "video_url"],
  ["authors", "photo_url"],
  ["creative_requests", "attachment_url"],
  ["blog_posts", "cover_image_url"],
  ["feedback", "screenshot_url"],
] as const;

let changed = 0;
let missing = 0;
for (const [table, column] of COLUMNS) {
  const rows = await prisma.$queryRawUnsafe<{ id: unknown; url: string }[]>(
    `SELECT id, ${column} AS url FROM ${table} WHERE ${column} LIKE '%supabase.co/storage/v1/object/public/uploads/%'`
  );
  for (const { id, url } of rows) {
    const key = decodeURIComponent(url.replace(SUPABASE_PREFIX, "").split("?")[0] ?? "");
    const next = s3PublicUrl(key);
    const res = await fetch(next, { method: "HEAD" });
    if (!res.ok) {
      missing++;
      console.log(`  ✗ ${table}.${column} #${id}: ${key} not on S3 (${res.status})`);
      continue;
    }
    changed++;
    console.log(`  ${apply ? "✓" : "→"} ${table}.${column} #${id}: ${key}`);
    if (apply) {
      await prisma.$executeRawUnsafe(
        `UPDATE ${table} SET ${column} = ? WHERE id = ? AND ${column} = ?`,
        next,
        id,
        url
      );
    }
  }
}
console.log(
  `${apply ? "Changed" : "Would change"} ${changed} URL(s)` +
    (missing ? `; ${missing} left alone because the file isn't on S3.` : ".") +
    (apply ? "" : " Re-run with --apply to save.")
);
await prisma.$disconnect();
