import crypto from "node:crypto";
import path from "node:path";
import { supabase, UPLOADS_BUCKET } from "./supabase.js";

// The long-form sections of an ad's public page, stored in ads.content.
// Every part is optional; the page leaves out a section with nothing in it.
export type AdContent = {
  takeaways?: { format?: string; bestFor?: string; hook?: string; reuse?: string };
  whyItWorks?: { title: string; text: string }[];
  targets?: string;
  copywriting?: string;
  visualDesign?: string;
  adaptSteps?: string[];
  platformTips?: string;
  headlineIdeas?: string[];
  collections?: string[];
  relatedGuides?: string[];
  popularSearches?: string[];
  // Ad slugs picked by hand; empty means "pick similar ads automatically".
  relatedAds?: string[];
};

const TEXT_KEYS = ["targets", "copywriting", "visualDesign", "platformTips"] as const;
const LIST_KEYS = [
  "adaptSteps",
  "headlineIdeas",
  "collections",
  "relatedGuides",
  "popularSearches",
  "relatedAds",
] as const;
const TAKEAWAY_KEYS = ["format", "bestFor", "hook", "reuse"] as const;

const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// Drops empty strings, list items and "why it works" points, so a
// half-filled CSV doesn't leave blank rows on the page. Null when nothing is
// left, which keeps the column empty for ads without editorial content.
export function normalizeAdContent(input: unknown): AdContent | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, any>;
  const out: AdContent = {};

  for (const key of TEXT_KEYS) {
    const v = clean(raw[key]);
    if (v) out[key] = v;
  }
  for (const key of LIST_KEYS) {
    const list = Array.isArray(raw[key])
      ? [...new Set(raw[key].map(clean).filter(Boolean) as string[])]
      : [];
    if (list.length) out[key] = list;
  }
  if (raw.takeaways && typeof raw.takeaways === "object") {
    const t: NonNullable<AdContent["takeaways"]> = {};
    for (const key of TAKEAWAY_KEYS) {
      const v = clean(raw.takeaways[key]);
      if (v) t[key] = v;
    }
    if (Object.keys(t).length) out.takeaways = t;
  }
  if (Array.isArray(raw.whyItWorks)) {
    const points = raw.whyItWorks
      .map((p: any) => ({ title: clean(p?.title), text: clean(p?.text) }))
      .filter((p: { title: string; text: string }) => p.title || p.text);
    if (points.length) out.whyItWorks = points;
  }

  return Object.keys(out).length ? out : null;
}

// The storage key of a file in our uploads bucket, from its public URL; null
// for an image hosted anywhere else.
function storageKey(url: string): string | null {
  const marker = `/object/public/${UPLOADS_BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length));
}

// Google Images reads the file name, so a creative is served under the
// keyword file name from the ad's CSV (e.g. dog-food-testimonial-ad-1200x1200.png)
// instead of the random name it was uploaded with. The file is copied once,
// into its own folder so two ads can use the same name; the copy keeps the
// uploaded file's real extension. Anything that can't be copied keeps its
// current URL, since a working image matters more than its name.
export async function withSeoFileName(
  photoUrl: string | null,
  fileName: string | null
): Promise<string | null> {
  if (!photoUrl || !fileName) return photoUrl;
  const key = storageKey(photoUrl);
  if (!key) return photoUrl;

  const ext = path.extname(key).toLowerCase();
  const base = path
    .basename(fileName, path.extname(fileName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  if (!base) return photoUrl;
  const wanted = `${base}${ext}`;
  if (path.basename(key) === wanted) return photoUrl;

  const newKey = `ads/${crypto.randomBytes(4).toString("hex")}/${wanted}`;
  const { error } = await supabase.storage.from(UPLOADS_BUCKET).copy(key, newKey);
  if (error) {
    console.error("Could not copy creative to its SEO file name:", error);
    return photoUrl;
  }
  return supabase.storage.from(UPLOADS_BUCKET).getPublicUrl(newKey).data.publicUrl;
}
