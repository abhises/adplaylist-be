// The library grid's filtering, counting, ordering and paging, done here so
// the browser only gets the ads it shows instead of the whole library.
// The rules match what the website's LibraryView used to do in the browser.

// The card fields the filters read (a subset of the card response).
export interface LibraryCard {
  id: string;
  title: string;
  format: string;
  headline: string;
  brandName?: string | undefined;
  tags: string[];
  mediaType: string;
  categories: string[];
  markets: string[];
  language: string;
  platforms: string[];
  hasEditableCopy: boolean;
  premium: boolean;
  live: boolean;
  dominantColor?: string | undefined;
  videoLength?: string | undefined;
  createdAt: Date;
  subcategory?: string | undefined;
  adFormat?: string | undefined;
}

export interface LibraryFilters {
  q: string;
  tags: string[];
  mediaTypes: string[];
  platforms: string[];
  categories: string[];
  country: string;
  language: string;
  addedDays: number | null;
  formats: string[];
  canva: "" | "editable" | "non-editable";
  premium: boolean;
  adType: "" | "live" | "concept";
  lengths: string[];
  colors: string[];
}

export const PLATFORMS = ["META", "Google", "TikTok", "LinkedIn"];

// Visitors preview this many ads per platform they pick (or this many in
// total with none picked); the rest is a blurred teaser of LOCKED_COUNT.
export const PREVIEW_PER_PLATFORM = 10;
const LOCKED_COUNT = 10;

const MAX_PAGE_SIZE = 100;

type Query = Record<string, unknown>;

// A query value that may be given once or repeated (?tag=a&tag=b).
function list(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.filter((v): v is string => typeof v === "string" && !!v);
}

function one(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseLibraryFilters(query: Query): LibraryFilters {
  const days = Number(one(query.addedDays));
  const canva = one(query.canva);
  const adType = one(query.adType);
  return {
    q: one(query.q).trim(),
    tags: list(query.tag),
    mediaTypes: list(query.mediaType),
    platforms: list(query.platform),
    categories: list(query.category),
    country: one(query.country),
    language: one(query.language),
    addedDays: one(query.addedDays) && Number.isFinite(days) && days > 0 ? days : null,
    formats: list(query.format),
    canva: canva === "editable" || canva === "non-editable" ? canva : "",
    premium: one(query.premium) === "true",
    adType: adType === "live" || adType === "concept" ? adType : "",
    lengths: list(query.length),
    colors: list(query.color),
  };
}

export function parsePaging(query: Query) {
  const page = Math.max(1, Math.floor(Number(one(query.page))) || 1);
  const size = Math.floor(Number(one(query.pageSize))) || 20;
  return { page, pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, size)) };
}

export function matchesFilters(ad: LibraryCard, f: LibraryFilters, now = Date.now()) {
  const kw = f.q.toLowerCase();
  const adTags = ad.tags.map((t) => t.toLowerCase());
  if (
    kw &&
    ![ad.headline, ad.title, ad.brandName, ad.adFormat, ad.subcategory, ...ad.categories].some(
      (v) => v?.toLowerCase().includes(kw)
    ) &&
    !adTags.some((t) => t.includes(kw) || kw.includes(t))
  ) {
    return false;
  }
  const wantedTags = f.tags.map((t) => t.toLowerCase());
  if (wantedTags.length && !wantedTags.some((t) => adTags.includes(t))) return false;
  if (f.mediaTypes.length && !f.mediaTypes.includes(ad.mediaType)) return false;
  if (f.platforms.length && !f.platforms.some((p) => ad.platforms.includes(p))) return false;
  if (f.categories.length && !ad.categories.some((c) => f.categories.includes(c))) return false;
  if (f.country && !ad.markets.includes(f.country)) return false;
  if (f.language && ad.language !== f.language) return false;
  if (f.addedDays !== null && ad.createdAt.getTime() < now - f.addedDays * 24 * 60 * 60 * 1000) {
    return false;
  }
  if (f.formats.length && !f.formats.includes(ad.format)) return false;
  if (f.canva === "editable" && !ad.hasEditableCopy) return false;
  if (f.canva === "non-editable" && ad.hasEditableCopy) return false;
  if (f.premium && !ad.premium) return false;
  if (f.adType === "live" && !ad.live) return false;
  if (f.adType === "concept" && ad.live) return false;
  if (f.lengths.length && !(ad.videoLength && f.lengths.includes(ad.videoLength))) return false;
  if (f.colors.length && !(ad.dominantColor && f.colors.includes(ad.dominantColor))) return false;
  return true;
}

// The counts beside the filters. Taken over the whole library, not the
// filtered list, as before.
export function libraryFacets(ads: LibraryCard[]) {
  const categories: Record<string, number> = {};
  const formats: Record<string, number> = {};
  const platforms: Record<string, number> = Object.fromEntries(PLATFORMS.map((p) => [p, 0]));
  let image = 0;
  let video = 0;
  let premium = 0;
  let live = 0;
  for (const ad of ads) {
    if (ad.mediaType === "image") image++;
    if (ad.mediaType === "video") video++;
    if (ad.premium) premium++;
    if (ad.live) live++;
    for (const c of ad.categories) categories[c] = (categories[c] ?? 0) + 1;
    formats[ad.format] = (formats[ad.format] ?? 0) + 1;
    for (const p of PLATFORMS) if (ad.platforms.includes(p)) platforms[p] = (platforms[p] ?? 0) + 1;
  }
  return {
    total: ads.length,
    image,
    video,
    premium,
    live,
    platforms,
    categories,
    formats: Object.keys(formats)
      .sort()
      .map((name) => ({ name, count: formats[name] ?? 0 })),
  };
}

// A random order that is the same for the same seed, so paging through a
// visit's shuffled library doesn't repeat or skip ads. mulberry32.
export function seededShuffle<T>(items: T[], seed: number): T[] {
  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

// Signed out: up to PREVIEW_PER_PLATFORM ads for each picked platform (an ad
// on two platforms counts once), then a teaser of what's locked behind
// sign-up.
export function visitorPreview<T extends LibraryCard>(filtered: T[], all: T[], platforms: string[]) {
  const groups: (string | null)[] = platforms.length
    ? PLATFORMS.filter((p) => platforms.includes(p))
    : [null];
  const shownIds = new Set<string>();
  const shown: T[] = [];
  for (const platform of groups) {
    let n = 0;
    for (const ad of filtered) {
      if (n >= PREVIEW_PER_PLATFORM) break;
      if (shownIds.has(ad.id) || (platform && !ad.platforms.includes(platform))) continue;
      shownIds.add(ad.id);
      shown.push(ad);
      n++;
    }
  }
  const locked: T[] = [];
  for (const ad of [...filtered, ...all]) {
    if (locked.length >= LOCKED_COUNT) break;
    if (shownIds.has(ad.id)) continue;
    shownIds.add(ad.id);
    locked.push(ad);
  }
  return { shown, locked };
}
