import { Router } from "express";
import { Prisma, type Ad } from "../generated/prisma/client.js";
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
import { createAdSchema } from "../validation/schemas.js";

const router = Router();

export function toAdResponse(ad: Ad) {
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
    market: ad.market,
    language: ad.language,
    photo: ad.photoUrl ?? undefined,
    platforms: ad.platforms ? ad.platforms.split(",") : [],
    editable: ad.editable,
    canvaUrl: ad.canvaUrl ?? undefined,
    hasEditableCopy: !!ad.canvaUrl,
    dominantColor: ad.dominantColor ?? undefined,
    videoLength: ad.videoLength ?? undefined,
    featured: ad.featured,
    showInHero: ad.showInHero,
    createdAt: ad.createdAt,
  };
}

// The Canva link is the editable copy, so it's only sent to viewers whose
// plan includes editable copies; others still learn one exists
// (hasEditableCopy) so the page can show a locked button.
export function adForViewer(req: AuthedRequest) {
  const canEdit = !!entitlementsOfRequest(req)?.editableCopies;
  return (ad: Ad) => {
    const res = toAdResponse(ad);
    return canEdit ? res : { ...res, canvaUrl: undefined };
  };
}

router.get("/", optionalAuth, loadAccount, async (req: AuthedRequest, res) => {
  const { category, market, language, mediaType, platform, q, featured } =
    req.query;
  const where: Prisma.AdWhereInput = {};

  if (typeof category === "string" && category) where.category = category;
  if (typeof market === "string" && market) where.market = market;
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

  const ads = await prisma.ad.findMany({ where, orderBy: { id: "asc" } });
  res.json({ ads: ads.map(adForViewer(req)) });
});

router.get("/:slug", optionalAuth, loadAccount, async (req: AuthedRequest, res) => {
  const ad = await prisma.ad.findUnique({ where: { slug: String(req.params.slug) } });
  if (!ad) return res.status(404).json({ error: "Ad not found" });
  res.json({ ad: adForViewer(req)(ad) });
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

// Admins pick which ads the landing page shows: `featured` for the library
// section, `showInHero` for the hero panel. Kept separate from PUT so
// toggling them doesn't resend (and revalidate) the whole ad.
router.patch(
  "/:slug/home-section",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const data: { featured?: boolean; showInHero?: boolean } = {};
    for (const key of ["featured", "showInHero"] as const) {
      const value = req.body?.[key];
      if (value === undefined) continue;
      if (typeof value !== "boolean") {
        return res.status(400).json({ error: `${key} must be true or false` });
      }
      data[key] = value;
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const ad = await prisma.ad.findUnique({
      where: { slug: String(req.params.slug) },
    });
    if (!ad) return res.status(404).json({ error: "Ad not found" });

    const updated = await prisma.ad.update({ where: { id: ad.id }, data });
    res.json({ ad: toAdResponse(updated) });
  }
);

// Maps a validated create/update body to the ad's columns. Both routes send
// the full ad, so a field left out is cleared rather than kept.
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
    category: b.category,
    market: b.market,
    language: b.language || "English (EN)",
    photoUrl: b.photo || null,
    platforms: Array.isArray(b.platforms) ? b.platforms.join(",") : "",
    editable: !!b.editable,
    canvaUrl: b.canvaUrl || null,
    dominantColor: b.dominantColor || null,
    videoLength: b.videoLength || null,
  };
}

router.post(
  "/",
  requireAuth,
  requireRole("designer", "admin"),
  validateBody(createAdSchema),
  async (req: AuthedRequest, res) => {
    const slug = String(req.body.title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    let created;
    try {
      created = await prisma.ad.create({
        data: {
          slug,
          ...toAdData(req.body),
          tags: joinTags(await resolveTags(req.body.tags)),
        },
      });
    } catch (err) {
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

// Admins can edit any published ad. The slug is kept even if the title
// changes, so existing links and saved bookmarks keep working.
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

    const updated = await prisma.ad.update({
      where: { id: ad.id },
      data: {
        ...toAdData(req.body),
        tags: joinTags(await resolveTags(req.body.tags)),
      },
    });
    res.json({ ad: toAdResponse(updated) });
  }
);

export default router;
