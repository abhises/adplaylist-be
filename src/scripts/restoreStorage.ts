// Uploads a folder made by storage:backup (<folder>/<bucket>/<path>) into
// the Supabase project in .env, creating the buckets as public ones. Files already there are left alone, so it can be re-run.
// The project's ref must be passed to confirm which one is written to.
//
//   npm run storage:restore -- <folder> <project-ref>
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureUploadsBucket, supabase, UPLOADS_BUCKET } from "../lib/supabase.js";

const [source, ref] = process.argv.slice(2);
const target = new URL(process.env.SUPABASE_URL!).hostname.split(".")[0];
if (!source || !ref) {
  console.error("Usage: npm run storage:restore -- <folder> <project-ref>");
  process.exit(1);
}
if (ref !== target) {
  console.error(`.env points at project "${target}", not "${ref}". Nothing uploaded.`);
  process.exit(1);
}

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

async function filesIn(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? filesIn(path.join(dir, e.name)) : [path.join(dir, e.name)]))
  );
  return nested.flat();
}

await ensureUploadsBucket();
let uploaded = 0;
let failed = 0;
for (const bucket of await fs.readdir(source)) {
  const files = await filesIn(path.join(source, bucket));
  if (!files.length) continue;
  if (bucket !== UPLOADS_BUCKET) {
    const { error } = await supabase.storage.createBucket(bucket, { public: true });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
  console.log(`${bucket}: ${files.length} file(s)`);
  for (const file of files) {
    const key = path.relative(path.join(source, bucket), file).split(path.sep).join("/");
    const { error } = await supabase.storage.from(bucket).upload(key, await fs.readFile(file), {
      contentType: TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      cacheControl: "31536000",
    });
    if (!error) uploaded++;
    else if (!/already exists|duplicate/i.test(error.message)) {
      failed++;
      console.log(`  ✗ ${key}: ${error.message}`);
    }
  }
}
console.log(`Uploaded ${uploaded} file(s)${failed ? `, ${failed} failed (re-run to retry)` : ""}.`);
