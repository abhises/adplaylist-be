// Downloads every file in every Supabase storage bucket into a local folder,
// as <folder>/<bucket>/<path>. Read-only on Supabase. Files already there at
// the same size are skipped, so an interrupted backup can be re-run.
//
//   npm run storage:backup -- <folder>
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { listBucket, supabase } from "../lib/supabase.js";

const dest = process.argv[2];
if (!dest) {
  console.error("Usage: npm run storage:backup -- <folder>");
  process.exit(1);
}

const { data: buckets, error } = await supabase.storage.listBuckets();
if (error) throw error;

let failed = 0;
for (const bucket of buckets) {
  const files = await listBucket(bucket.name);
  console.log(`${bucket.name}: ${files.length} file(s)`);
  for (const file of files) {
    const target = path.join(dest, bucket.name, file.key);
    const existing = await fs.stat(target).catch(() => null);
    if (existing?.size === file.size) continue;
    const { data, error } = await supabase.storage.from(bucket.name).download(file.key);
    if (error || !data) {
      failed++;
      console.log(`  ✗ ${file.key}: ${error?.message ?? "no data"}`);
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(await data.arrayBuffer()));
  }
}
console.log(failed ? `Finished with ${failed} failure(s); re-run to retry them.` : "All files backed up.");
