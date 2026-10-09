import path from "node:path";
import { Router } from "express";
import { Prisma, type Ad, type Author } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import {
  entitlementsOfRequest,
  loadAccount,
  optionalAuth,
  requireAuth,
  requireRole,
  type AuthedRequest,
} from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { joinTags, resolveTags, splitTags } from "../lib/tags.js";
import { normalizeAdContent, type AdContent } from "../lib/adContent.js";
import { watermarkedCopyOf } from "../lib/watermark.js";
import { toAuthorSummary } from "../lib/authors.js";
import { createAdSchema } from "../validation/schemas.js";

const router = Router();

// Loads the people credited on an ad page along with the ad.
export const adInclude = { author: true, reviewer: true } as const;

type AdWithPeople = Ad & { author?: Author | null; reviewer?: Author | null };

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);

// `full` adds the long-form page content, which lists (the library grid,
// saved ads) don't need.
// All of an ad's categories, primary first. Older ads only have `category`.
function adCategories(ad: { category: string; categories: Prisma.JsonValue | null }) {
  const list = Array.isArray(ad.categories)
    ? ad.categories.filter((c): c is string => typeof c === "string" && !!c)
    : [];
  return list.length ? list : [ad.category];
}

// All of an ad's markets, primary first. Older ads only have `market`.
function adMarkets(ad: { market: string; markets: Prisma.JsonValue | null }) {
  const list = Array.isArray(ad.markets)
    ? ad.markets.filter((m): m is string => typeof m === "string" && !!m)
    : [];
  return list.length ? list : [ad.market];
}

export function toAdResponse(ad: AdWithPeople, { full = true } = {}) {
  return {
    id: ad.slug,
    title: ad.title,
    format: ad.format,
    variant: ad.variant,
    eyebrow: ad.eyebrow ?? undefined,
    headline: ad.headline,
    sub: ad.sub ?? undefined,
    cta: ad.cta ?? undefined,
    badge: ad.badge ?? undefined,
    description: ad.description ?? undefined,
    primaryText: ad.primaryText ?? undefined,
    brandName: ad.brandName ?? undefined,
    creativeDescription: ad.creativeDescription ?? undefined,
    tags: splitTags(ad.tags),
    mediaType: ad.mediaType,
    swatch: ad.swatch,
    light: ad.light,
    category: ad.category,
    categories: adCategories(ad),
    market: ad.market,
    markets: adMarkets(ad),
    language: ad.language,
    photo: ad.photoUrl ?? undefined,
    platforms: ad.platforms ? ad.platforms.split(",") : [],
    editable: ad.editable,
    canvaUrl: ad.canvaUrl ?? undefined,
    hasEditableCopy: !!ad.canvaUrl,
    premium: !!ad.canvaUrl && ad.canvaPremium,
    live: ad.isLive,
    dominantColor: ad.dominantColor ?? undefined,
    videoLength: ad.videoLength ?? undefined,
    featured: ad.featured,
    heroPlatforms: splitList(ad.heroPlatforms),
    createdAt: ad.createdAt,
    subcategory: ad.subcategory ?? undefined,
    adFormat: ad.adFormat ?? undefined,
    imageAlt: ad.imageAlt ?? undefined,
    dateAdded: isoDate(ad.dateAdded) ?? isoDate(ad.createdAt),
    dateUpdated: isoDate(ad.dateUpdated),
    author: ad.author ? toAuthorSummary(ad.author) : undefined,
    reviewer: ad.reviewer ? toAuthorSummary(ad.reviewer) : undefined,
    ...(full && {
      onImageText: ad.onImageText ?? undefined,
      seoTitle: ad.seoTitle ?? undefined,
      metaDescription: ad.metaDescription ?? undefined,
      pageHeadline: ad.pageHeadline ?? undefined,
      introParagraph: ad.introParagraph ?? undefined,
      imageFileName: ad.imageFileName ?? undefined,
      imageCaption: ad.imageCaption ?? undefined,
      content: (ad.content as AdContent | null) ?? undefined,
    }),
  };
}

// The Canva link is the editable copy, so it's only sent to viewers whose
// plan includes editable copies; others still learn one exists
// (hasEditableCopy) so the page can show a locked button.
export function adForViewer(req: AuthedRequest, options?: { full?: boolean }) {
  const canEdit = !!entitlementsOfRequest(req)?.editableCopies;
  return (ad: AdWithPeople) => {
    const res = toAdResponse(ad, options);
    return canEdit ? res : { ...res, canvaUrl: undefined };
  };
}

// The columns the library grid and its filters use: the whole library is
// sent at once, so the long text (creative description, primary text, …)
// and the credited people are left out to keep it small and quick.
const cardSelect = {
  slug: true,
  title: true,
  format: true,
  headline: true,
  badge: true,
  brandName: true,
  tags: true,
  mediaType: true,
  swatch: true,
  light: true,
  category: true,
  categories: true,
  market: true,
  markets: true,
  language: true,
  photoUrl: true,
  platforms: true,
  canvaUrl: true,
  canvaPremium: true,
  isLive: true,
  dominantColor: true,
  videoLength: true,
  createdAt: true,
  subcategory: true,
  adFormat: true,
  imageAlt: true,
} satisfies Prisma.AdSelect;

type CardAd = Prisma.AdGetPayload<{ select: typeof cardSelect }>;

// The same for every viewer: only whether a Canva copy exists is sent, never
// the link itself.
function toCardResponse(ad: CardAd) {
  return {
    id: ad.slug,
    title: ad.title,
    format: ad.format,
    headline: ad.headline,
    badge: ad.badge ?? undefined,
    brandName: ad.brandName ?? undefined,
    tags: splitTags(ad.tags),
    mediaType: ad.mediaType,
    swatch: ad.swatch,
    light: ad.light,
    category: ad.category,
    categories: adCategories(ad),
    market: ad.market,
    markets: adMarkets(ad),
    language: ad.language,
    photo: ad.photoUrl ?? undefined,
    platforms: ad.platforms ? ad.platforms.split(",") : [],
    hasEditableCopy: !!ad.canvaUrl,
    premium: !!ad.canvaUrl && ad.canvaPremium,
    live: ad.isLive,
    dominantColor: ad.dominantColor ?? undefined,
    videoLength: ad.videoLength ?? undefined,
    createdAt: ad.createdAt,
    subcategory: ad.subcategory ?? undefined,
    adFormat: ad.adFormat ?? undefined,
    imageAlt: ad.imageAlt ?? undefined,
  };
}

// ?view=card: the whole library for the grid (see cardSelect), without the
// per-viewer account lookup the full list needs.
router.get("/", (req, res, next) => {
  if (req.query.view !== "card") return next();
  prisma.ad
    .findMany({ select: cardSelect, orderBy: { id: "asc" } })
    .then((ads) => res.json({ ads: ads.map(toCardResponse) }))
    .catch(next);
});

router.get("/", optionalAuth, loadAccount, async (req: AuthedRequest, res) => {
  const { category, market, language, mediaType, platform, q, featured } =
    req.query;
  const where: Prisma.AdWhereInput = {};

  const and: Prisma.AdWhereInput[] = [];
  if (typeof category === "string" && category) {
    and.push({ OR: [{ category }, { categories: { array_contains: category } }] });
  }
  if (typeof market === "string" && market) {
    and.push({ OR: [{ market }, { markets: { array_contains: market } }] });
  }
  if (and.length) where.AND = and;
  if (typeof language === "string" && language) where.language = language;
  if (typeof mediaType === "string" && mediaType) where.mediaType = mediaType;
  if (typeof platform === "string" && platform) {
    where.platforms = { contains: platform };
  }
  if (featured === "true") where.featured = true;
  if (typeof q === "string" && q) {
    where.OR = [
      { title: { contains: q } },
      { headline: { contains: q } },
    ];
  }

  const ads = await prisma.ad.findMany({
    where,
    include: adInclude,
    orderBy: { id: "asc" },
  });
  res.json({ ads: ads.map(adForViewer(req, { full: false })) });
});

// An ad whose slug was changed is still found by its old slug.
async function findAdBySlug(slug: string) {
  const ad = await prisma.ad.findUnique({ where: { slug }, include: adInclude });
  if (ad) return ad;
  const redirect = await prisma.adSlugRedirect.findUnique({
    where: { oldSlug: slug },
    include: { ad: { include: adInclude } },
  });
  return redirect?.ad ?? null;
}

// The response's ad.id is the current slug, which the page redirects to.
router.get("/:slug", optionalAuth, loadAccount, async (req: AuthedRequest, res) => {
  const ad = await findAdBySlug(String(req.params.slug));
  if (!ad) return res.status(404).json({ error: "Ad not found" });
  res.json({ ad: adForViewer(req)(ad) });
});

// Download for anyone signed in: the clean creative for staff and paid
// plans, the watermarked copy (made on first need) for everyone else. The
// file is served as a download under the ad's keyword file name.
router.get("/:slug/download", requireAuth, loadAccount, async (req: AuthedRequest, res) => {
  const ad = await findAdBySlug(String(req.params.slug));
  if (!ad?.photoUrl) return res.status(404).json({ error: "This ad has no image to download" });

  const clean = !!entitlementsOfRequest(req)?.cleanDownload;
  let file: string | null;
  try {
    file = clean ? ad.photoUrl : await watermarkedCopyOf(ad);
  } catch (err) {
    // Never fall back to the clean file for an unpaid download.
    console.error("Watermarking the download failed:", err);
    return res.status(500).json({ error: "Couldn't prepare the download. Try again." });
  }
  if (!file) return res.status(404).json({ error: "This ad has no image to download" });

  const url = new URL(file);
  const base = path.basename(ad.imageFileName || ad.slug, path.extname(ad.imageFileName || ""));
  if (url.pathname.includes("/storage/v1/object/public/")) {
    url.searchParams.set("download", `${base}${path.extname(url.pathname)}`);
  }
  res.json({ url: url.toString(), watermarked: !clean });
});

// Deleting is admin-only (stricter than publishing, which designers can also
// do): it removes any saved bookmarks for the ad and unlinks it from any
// creative request it was delivered against, per the FK's ON DELETE rules.
router.delete(
  "/:slug",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const ad = await prisma.ad.findUnique({
      where: { slug: String(req.params.slug) },
    });
    if (!ad) return res.status(404).json({ error: "Ad not found" });

    await prisma.ad.delete({ where: { id: ad.id } });
    res.status(204).send();
  }
);

// The landing hero's product panel has a tab each for these platforms. An
// admin picks any ads for each tab, up to HERO_PER_PLATFORM per tab; the same
// ad can be in several. Matches the frontend's lib/ads.ts.
const HERO_PLATFORMS = ["META", "Google", "LinkedIn"];
const HERO_PER_PLATFORM = 6;

const splitList = (value: string) => (value ? value.split(",") : []);
const platformName = (p: string) => (p === "META" ? "Meta" : p);

// Admins pick which ads the landing page shows: `featured` for the library
// section, `heroPlatforms` (the hero tabs it's in) for the hero panel. Kept
// separate from PUT so toggling them doesn't resend (and revalidate) the
// whole ad.
router.patch(
  "/:slug/home-section",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const data: { featured?: boolean; heroPlatforms?: string } = {};
    const featured = req.body?.featured;
    if (featured !== undefined) {
      if (typeof featured !== "boolean") {
        return res.status(400).json({ error: "featured must be true or false" });
      }
      data.featured = featured;
    }
    const hero = req.body?.heroPlatforms;
    if (hero !== undefined) {
      if (!Array.isArray(hero) || hero.some((p) => !HERO_PLATFORMS.includes(p))) {
        return res.status(400).json({
          error: `heroPlatforms must be a list of ${HERO_PLATFORMS.join(", ")}`,
        });
      }
      // Stored in HERO_PLATFORMS order, without repeats.
      data.heroPlatforms = HERO_PLATFORMS.filter((p) => hero.includes(p)).join(",");
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const ad = await prisma.ad.findUnique({
      where: { slug: String(req.params.slug) },
    });
    if (!ad) return res.status(404).json({ error: "Ad not found" });

    // Each hero tab the ad is being added to must have room.
    if (data.heroPlatforms !== undefined) {
      const current = splitList(ad.heroPlatforms);
      const added = splitList(data.heroPlatforms).filter((p) => !current.includes(p));
      if (added.length > 0) {
        const others = await prisma.ad.findMany({
          where: { heroPlatforms: { not: "" }, id: { not: ad.id } },
          select: { heroPlatforms: true },
        });
        for (const p of added) {
          const count = others.filter((a) => splitList(a.heroPlatforms).includes(p)).length;
          if (count >= HERO_PER_PLATFORM) {
            return res.status(400).json({
              error: `The hero panel's ${platformName(p)} tab already has ${HERO_PER_PLATFORM} ads`,
            });
          }
        }
      }
    }

    const updated = await prisma.ad.update({
      where: { id: ad.id },
      data,
      include: adInclude,
    });
    res.json({ ad: toAdResponse(updated) });
  }
);

// Maps a validated create/update body to the ad's columns. Both routes send
// the full ad, so a field left out is cleared rather than kept.
// The primary category is the first in the list; a body with only
// `category` (older clients, CSV scripts) is a list of one.
function categoryData(b: Record<string, any>) {
  const list: string[] = Array.isArray(b.categories) && b.categories.length
    ? [...new Set<string>(b.categories)]
    : [b.category as string];
  return { category: list[0]!, categories: list };
}

// Same shape as categoryData: the primary market is the first in the list.
function marketData(b: Record<string, any>) {
  const list: string[] = Array.isArray(b.markets) && b.markets.length
    ? [...new Set<string>(b.markets)]
    : [b.market as string];
  return { market: list[0]!, markets: list };
}

function toAdData(body: Record<string, unknown>) {
  const b = body as Record<string, any>;
  return {
    title: b.title,
    format: b.format || "Feed 1:1",
    variant: b.variant ?? "overlay",
    eyebrow: b.eyebrow || null,
    headline: b.headline,
    sub: b.sub || null,
    cta: b.cta || null,
    badge: b.badge || null,
    description: b.description || null,
    primaryText: b.primaryText || null,
    brandName: b.brandName || null,
    creativeDescription: b.creativeDescription || null,
    mediaType: b.mediaType ?? "image",
    swatch: b.swatch || "bg-neutral-800",
    light: !!b.light,
    ...categoryData(b),
    ...marketData(b),
    language: b.language || "English (EN)",
    photoUrl: b.photo || null,
    platforms: Array.isArray(b.platforms) ? b.platforms.join(",") : "",
    editable: !!b.editable,
    canvaUrl: b.canvaUrl || null,
    // Premium describes the Canva copy, so it goes with the link.
    canvaPremium: !!b.canvaUrl && !!b.canvaPremium,
    isLive: !!b.isLive,
    dominantColor: b.dominantColor || null,
    videoLength: b.videoLength || null,
    subcategory: b.subcategory || null,
    adFormat: b.adFormat || null,
    onImageText: b.onImageText || null,
    seoTitle: b.seoTitle || null,
    metaDescription: b.metaDescription || null,
    pageHeadline: b.pageHeadline || null,
    introParagraph: b.introParagraph || null,
    imageFileName: b.imageFileName || null,
    imageAlt: b.imageAlt || null,
    imageCaption: b.imageCaption || null,
    content: normalizeAdContent(b.content) ?? Prisma.DbNull,
  };
}

export function slugifyTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 150)
    .replace(/-$/, "");
}

const today = () => new Date(new Date().toISOString().slice(0, 10));

// Looks up the "Added by" / "Reviewed by" authors named in the body. Throws
// a 400-style error for a slug that doesn't match an author.
class BadRequest extends Error {}
async function resolveAuthors(body: Record<string, any>) {
  async function find(slug: unknown, label: string) {
    if (!slug) return null;
    const author = await prisma.author.findUnique({ where: { slug: String(slug) } });
    if (!author) throw new BadRequest(`${label}: no author with the slug "${slug}"`);
    return author.id;
  }
  return {
    authorId: await find(body.authorSlug, "Added by"),
    reviewerId: await find(body.reviewerSlug, "Reviewed by"),
  };
}

// The other ad using `slug` (as its slug, or an old slug that redirects to
// it), or null when it's free for ad `adId` (null for a new ad).
async function slugOwner(slug: string, adId: number | null) {
  const [ad, redirect] = await Promise.all([
    prisma.ad.findUnique({ where: { slug }, select: { id: true, slug: true, title: true } }),
    prisma.adSlugRedirect.findUnique({
      where: { oldSlug: slug },
      include: { ad: { select: { id: true, slug: true, title: true } } },
    }),
  ]);
  const owner = ad ?? redirect?.ad ?? null;
  return owner && owner.id !== adId ? owner : null;
}

// The 409 for a taken slug: names the ad that has it, so the editor can
// link to it (it may be this same ad, published a moment ago).
function slugTakenResponse(slug: string, owner: { slug: string; title: string }) {
  return {
    error: `The URL slug "${slug}" is already used by "${owner.title}". If that's this ad, it's already published; otherwise change the URL slug and publish again.`,
    existingAd: { id: owner.slug, title: owner.title },
  };
}

router.post(
  "/",
  requireAuth,
  requireRole("designer", "admin"),
  validateBody(createAdSchema),
  async (req: AuthedRequest, res) => {
    const slug = req.body.slug || slugifyTitle(String(req.body.title));
    if (!slug) return res.status(400).json({ error: "The ad needs a name or URL slug" });
    const owner = await slugOwner(slug, null);
    if (owner) return res.status(409).json(slugTakenResponse(slug, owner));

    let created;
    try {
      const data = toAdData(req.body);
      created = await prisma.ad.create({
        data: {
          slug,
          ...data,
          ...(await resolveAuthors(req.body)),
          tags: joinTags(await resolveTags(req.body.tags)),
          dateAdded: req.body.dateAdded || today(),
          dateUpdated: req.body.dateUpdated || req.body.dateAdded || today(),
        },
        include: adInclude,
      });
    } catch (err) {
      if (err instanceof BadRequest) {
        return res.status(400).json({ error: err.message });
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return res
          .status(409)
          .json({ error: "An ad with that name already exists" });
      }
      throw err;
    }

    res.status(201).json({ ad: toAdResponse(created) });
  }
);

// Admins can edit any published ad. The slug only changes when a new one is
// sent (renaming the ad keeps it); the old slug is then kept as a redirect so
// existing links and search results still reach the ad.
router.put(
  "/:slug",
  requireAuth,
  requireRole("admin"),
  validateBody(createAdSchema),
  async (req: AuthedRequest, res) => {
    const ad = await prisma.ad.findUnique({
      where: { slug: String(req.params.slug) },
    });
    if (!ad) return res.status(404).json({ error: "Ad not found" });

    const newSlug: string = req.body.slug || ad.slug;
    const owner = newSlug !== ad.slug ? await slugOwner(newSlug, ad.id) : null;
    if (owner) return res.status(409).json(slugTakenResponse(newSlug, owner));

    // Saving counts as an update unless a different date was picked by hand.
    const sentUpdated = req.body.dateUpdated
      ? isoDate(new Date(req.body.dateUpdated))
      : undefined;
    const dateUpdated =
      sentUpdated && sentUpdated !== isoDate(ad.dateUpdated)
        ? new Date(sentUpdated)
        : today();

    let people;
    try {
      people = await resolveAuthors(req.body);
    } catch (err) {
      if (err instanceof BadRequest) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    const data = toAdData(req.body);
    const tags = joinTags(await resolveTags(req.body.tags));

    const updated = await prisma.$transaction(async (tx) => {
      if (newSlug !== ad.slug) {
        // Moving back to an old slug turns that redirect into the live slug.
        await tx.adSlugRedirect.deleteMany({ where: { oldSlug: newSlug } });
        await tx.adSlugRedirect.create({ data: { oldSlug: ad.slug, adId: ad.id } });
      }
      return tx.ad.update({
        where: { id: ad.id },
        data: {
          ...data,
          ...people,
          slug: newSlug,
          // A new image needs a new watermarked copy.
          ...(data.photoUrl !== ad.photoUrl && { watermarkedPhotoUrl: null }),
          tags,
          dateAdded: req.body.dateAdded || ad.dateAdded || ad.createdAt,
          dateUpdated,
        },
        include: adInclude,
      });
    });
    res.json({ ad: toAdResponse(updated) });
  }
);

export default router;
