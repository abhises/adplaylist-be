
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
