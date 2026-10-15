
// The content of a brand page made from a brand CSV, stored in
// brand_pages.profile. The frontend parses the CSV (adplaylist-fe
// src/lib/brandProfile.ts, which mirrors these types) and lays the page out;
// here it's only cleaned before it's stored. Every part is optional and the
// page leaves out a section with nothing in it.
export type BrandProfileAd = {
  // Copied from a real, running ad; otherwise a new concept made for the page.
  live: boolean;
  label?: string;
  cta?: string;
  // Shown next to "Sponsored", e.g. Story or Carousel.
  format?: string;
  // A finished creative. Without one the ad is drawn from the fields below.
  image?: string;
  alt?: string;
  layout?: "hook" | "proof" | "local";
  eyebrow?: string;
  headline?: string;
  subline?: string;
  bigNumber?: string;
  photo?: string;
  photoCredit?: string;
  footer?: string;
  servicesLine?: string;
  townsLine?: string;
  button?: string;
  phone?: string;
  // Set on what a visitor without access is sent, in place of the creative.
  locked?: boolean;
};

export type BrandProfile = {
  category?: string;
  city?: string;
  state?: string;
  country?: string;
  logo?: string;
  intro?: string;
  recommendPct?: string;
  reviewCount?: string;
  // A short credential shown with the reviews, e.g. "Licensed WA & OR".
  highlight?: string;
  contact?: { website?: string; mobile?: string; email?: string; messenger?: string };
  colors?: { primary?: string; secondary?: string };
  ads?: BrandProfileAd[];
  serviceArea?: { title?: string; towns?: string[] };
  brief?: { services?: string; audience?: string; proof?: string; cta?: string };
  services?: string[];
  similar?: {
    subtitle?: string;
    companies?: { name: string; city?: string; logo?: string; ads?: string[] }[];
  };
  about?: { title?: string; paragraphs?: string[] };
  why?: { title?: string; points?: { title: string; text: string }[] };
  faq?: { q: string; a: string }[];
  footerCta?: { text?: string };
  breadcrumb?: string[];
  seo?: {
    title?: string;
    description?: string;
    keywords?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
    schemaType?: string;
  };
};

const AD_TEXT_KEYS = [
  "label",
  "cta",
  "format",
  "alt",
  "eyebrow",
  "headline",
  "subline",
  "bigNumber",
  "photoCredit",
  "footer",
  "servicesLine",
  "townsLine",
  "button",
  "phone",
] as const;
const LAYOUTS = ["hook", "proof", "local"] as const;

const text = (v: unknown, max = 2000) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
// Images are uploaded to our storage or hot-linked; anything else (a file
// name left over from the CSV, a javascript: URL) is dropped.
const url = (v: unknown) => {
  const s = text(v, 1000);
  return /^https?:\/\/\S+$/.test(s) ? s : "";
};
// Colours end up in inline styles.
const color = (v: unknown) => {
  const s = text(v, 9);
  return /^#[0-9a-f]{3,8}$/i.test(s) ? s : "";
};
const list = (v: unknown, clean: (item: unknown) => string = text) =>
  Array.isArray(v) ? v.map((item) => clean(item)).filter(Boolean) : [];

// Copies the non-empty values of `fields` into a new object; undefined when
// none are left, so an empty section isn't stored at all.
function group<T extends Record<string, unknown>>(fields: T) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value) ? value.length : value) out[key] = value;
  }
  return Object.keys(out).length ? (out as Partial<T>) : undefined;
}

function normalizeAd(input: unknown): BrandProfileAd | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const ad: BrandProfileAd = { live: !!raw.live };
  for (const key of AD_TEXT_KEYS) {
    const v = text(raw[key], 300);
    if (v) ad[key] = v;
  }
  const image = url(raw.image);
  if (image) ad.image = image;
  const photo = url(raw.photo);
  if (photo) ad.photo = photo;
  const layout = LAYOUTS.find((l) => l === raw.layout);
  if (layout) ad.layout = layout;
  return ad.image || ad.headline || ad.bigNumber ? ad : null;
}

// Null when nothing usable is left, which keeps the column empty for the
// pages written as HTML.
export function normalizeBrandProfile(input: unknown): BrandProfile | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, any>;
  const obj = (v: unknown): Record<string, any> =>
    v && typeof v === "object" ? (v as Record<string, any>) : {};

  const similar = obj(raw.similar);
  const out = group({
    category: text(raw.category, 100),
    city: text(raw.city, 100),
    state: text(raw.state, 50),
    country: text(raw.country, 50),
    logo: url(raw.logo),
    intro: text(raw.intro),
    recommendPct: text(raw.recommendPct, 10),
    reviewCount: text(raw.reviewCount, 10),
    highlight: text(raw.highlight, 100),
    contact: group({
      website: text(obj(raw.contact).website, 255),
      mobile: text(obj(raw.contact).mobile, 50),
      email: text(obj(raw.contact).email, 255),
      messenger: text(obj(raw.contact).messenger, 255),
    }),
    colors: group({
      primary: color(obj(raw.colors).primary),
      secondary: color(obj(raw.colors).secondary),
    }),
    ads: (Array.isArray(raw.ads) ? raw.ads : [])
      .map(normalizeAd)
      .filter((ad): ad is BrandProfileAd => !!ad)
      .slice(0, 24),
    serviceArea: group({
      title: text(obj(raw.serviceArea).title, 255),
      towns: list(obj(raw.serviceArea).towns),
    }),
    brief: group({
      services: text(obj(raw.brief).services, 500),
      audience: text(obj(raw.brief).audience, 500),
      proof: text(obj(raw.brief).proof, 500),
      cta: text(obj(raw.brief).cta, 500),
    }),
    services: list(raw.services),
    similar: group({
      subtitle: text(similar.subtitle, 255),
      companies: (Array.isArray(similar.companies) ? similar.companies : [])
        .map((c: unknown) => ({
          name: text(obj(c).name, 150),
          ...group({
            city: text(obj(c).city, 100),
            logo: url(obj(c).logo),
            ads: list(obj(c).ads, url).slice(0, 3),
          }),
        }))
        .filter((c: { name: string }) => c.name),
    }),
    about: group({
      title: text(obj(raw.about).title, 255),
      paragraphs: list(obj(raw.about).paragraphs),
    }),
    why: group({
      title: text(obj(raw.why).title, 255),
      points: (Array.isArray(obj(raw.why).points) ? obj(raw.why).points : [])
        .map((p: unknown) => ({ title: text(obj(p).title, 255), text: text(obj(p).text) }))
        .filter((p: { title: string; text: string }) => p.title || p.text),
    }),
    faq: (Array.isArray(raw.faq) ? raw.faq : [])
      .map((f: unknown) => ({ q: text(obj(f).q, 500), a: text(obj(f).a) }))
      .filter((f: { q: string; a: string }) => f.q && f.a),
    footerCta: group({ text: text(obj(raw.footerCta).text, 255) }),
    breadcrumb: list(raw.breadcrumb),
    seo: group({
      title: text(obj(raw.seo).title, 255),
      description: text(obj(raw.seo).description, 500),
      keywords: text(obj(raw.seo).keywords, 500),
      ogTitle: text(obj(raw.seo).ogTitle, 255),
      ogDescription: text(obj(raw.seo).ogDescription, 500),
      ogImage: url(obj(raw.seo).ogImage),
      // A schema.org type name, e.g. RoofingContractor.
      schemaType: /^[A-Za-z]+$/.test(text(obj(raw.seo).schemaType))
        ? text(obj(raw.seo).schemaType, 60)
        : "",
    }),
  });

  return (out as BrandProfile | undefined) ?? null;
}

// What a visitor without access gets: each ad keeps its place, status and
// label on the page, but nothing of the creative itself.
export function lockBrandProfileAds(profile: BrandProfile): BrandProfile {
  const out: BrandProfile = { ...profile };
  if (profile.ads) {
    out.ads = profile.ads.map((ad) => {
      const locked: BrandProfileAd = { live: ad.live, locked: true };
      if (ad.label) locked.label = ad.label;
      if (ad.cta) locked.cta = ad.cta;
      if (ad.format) locked.format = ad.format;
      return locked;
    });
  }
  if (profile.similar?.companies) {
    out.similar = {
      ...profile.similar,
      companies: profile.similar.companies.map(({ ads: _ads, ...company }) => company),
    };
  }
  return out;
}
