import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY environment variables");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

export const UPLOADS_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "uploads";

export async function ensureUploadsBucket() {
  const { data, error } = await supabase.storage.getBucket(UPLOADS_BUCKET);
  if (data) return;

  if (error && !/not found/i.test(error.message)) {
    throw error;
  }

  const { error: createError } = await supabase.storage.createBucket(UPLOADS_BUCKET, {
    public: true,
    fileSizeLimit: "25MB",
  });
  if (createError && !/already exists/i.test(createError.message)) {
    throw createError;
  }
}

export type StoredFile = { key: string; size: number };

// Every file in a bucket, including those in folders.
export async function listBucket(bucket: string, prefix = ""): Promise<StoredFile[]> {
  const files: StoredFile[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    for (const item of data) {
      const key = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) files.push(...(await listBucket(bucket, key)));
      else files.push({ key, size: Number(item.metadata?.size ?? 0) });
    }
    if (data.length < 1000) break;
  }
  return files;
}
