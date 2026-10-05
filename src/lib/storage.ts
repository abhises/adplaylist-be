import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Where uploaded files live: S3 in production, Supabase in development.
// Chosen by STORAGE_DRIVER ("s3" or "supabase", the default). Supabase is
// loaded only when used, so production needs no Supabase settings.
export const STORAGE_DRIVER = process.env.STORAGE_DRIVER === "s3" ? "s3" : "supabase";

const S3_BUCKET = process.env.S3_BUCKET || "";
const AWS_REGION = process.env.AWS_REGION || "";

if (STORAGE_DRIVER === "s3" && (!S3_BUCKET || !AWS_REGION)) {
  throw new Error("STORAGE_DRIVER=s3 needs S3_BUCKET and AWS_REGION");
}

// Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
const s3 = STORAGE_DRIVER === "s3" ? new S3Client({ region: AWS_REGION }) : null;

const S3_PUBLIC_BASE_URL = (
  process.env.S3_PUBLIC_BASE_URL || `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com`
).replace(/\/$/, "");

const CACHE_CONTROL = "max-age=31536000";

export function s3PublicUrl(key: string) {
  return `${S3_PUBLIC_BASE_URL}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

// Stores `body` under `key` and returns its public URL.
export async function uploadFile(key: string, body: Buffer, contentType: string) {
  if (s3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: CACHE_CONTROL,
      })
    );
    return s3PublicUrl(key);
  }
  const { supabase, UPLOADS_BUCKET } = await import("./supabase.js");
  const { error } = await supabase.storage
    .from(UPLOADS_BUCKET)
    .upload(key, body, { contentType, cacheControl: "31536000" });
  if (error) throw error;
  return supabase.storage.from(UPLOADS_BUCKET).getPublicUrl(key).data.publicUrl;
}

// A short-lived URL the browser PUTs the file to directly, plus the file's
// public URL once it's there.
export async function signUpload(key: string, contentType: string) {
  if (s3) {
    const signedUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: 600 }
    );
    return { signedUrl, url: s3PublicUrl(key) };
  }
  const { supabase, UPLOADS_BUCKET } = await import("./supabase.js");
  const { data, error } = await supabase.storage.from(UPLOADS_BUCKET).createSignedUploadUrl(key);
  if (error || !data) throw error ?? new Error("No signed upload URL");
  const url = supabase.storage.from(UPLOADS_BUCKET).getPublicUrl(key).data.publicUrl;
  return { signedUrl: data.signedUrl, url };
}

// Creates the Supabase bucket if it's missing. The S3 bucket is made by hand
// in the AWS console, so there's nothing to do for it.
export async function ensureStorage() {
  if (s3) return;
  const { ensureUploadsBucket } = await import("./supabase.js");
  await ensureUploadsBucket();
}
