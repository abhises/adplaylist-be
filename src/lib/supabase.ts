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
