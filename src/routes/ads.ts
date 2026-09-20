import { Router } from "express";
import { Prisma, type Ad } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
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
    dominantColor: ad.dominantColor ?? undefined,
    videoLength: ad.videoLength ?? undefined,
    createdAt: ad.createdAt,
  };
}

router.get("/", async (req, res) => {
  const { category, market, language, mediaType, platform, q } = req.query;
  const where: Prisma.AdWhereInput = {};

  if (typeof category === "string" && category) where.category = category;
  if (typeof market === "string" && market) where.market = market;
  if (typeof language === "string" && language) where.language = language;
  if (typeof mediaType === "string" && mediaType) where.mediaType = mediaType;
  if (typeof platform === "string" && platform) {
    where.platforms = { contains: platform };
  }
  if (typeof q === "string" && q) {
    where.OR = [
      { title: { contains: q } },
      { headline: { contains: q } },
    ];
  }

  const ads = await prisma.ad.findMany({ where, orderBy: { id: "asc" } });
  res.json({ ads: ads.map(toAdResponse) });
});

router.get("/:slug", async (req, res) => {
  const ad = await prisma.ad.findUnique({ where: { slug: req.params.slug } });
  if (!ad) return res.status(404).json({ error: "Ad not found" });
  res.json({ ad: toAdResponse(ad) });
});

router.post(
  "/",
  requireAuth,
  validateBody(createAdSchema),
  async (req: AuthedRequest, res) => {
    const {
      title,
      format,
      variant,
      eyebrow,
      headline,
      sub,
      cta,
      badge,
      mediaType,
      swatch,
      light,
      category,
      market,
      language,
      photo,
      platforms,
      editable,
      canvaUrl,
      dominantColor,
      videoLength,
    } = req.body;

    const slug = String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    let created;
    try {
      created = await prisma.ad.create({
        data: {
          slug,
          title,
          format: format ?? "Feed 1:1",
          variant: variant ?? "overlay",
          eyebrow: eyebrow ?? null,
          headline,
          sub: sub ?? null,
          cta: cta ?? null,
          badge: badge ?? null,
          mediaType: mediaType ?? "image",
          swatch: swatch ?? "bg-neutral-800",
          light: !!light,
          category,
          market,
          language: language ?? "English (EN)",
          photoUrl: photo ?? null,
          platforms: Array.isArray(platforms) ? platforms.join(",") : "",
          editable: !!editable,
          canvaUrl: canvaUrl ?? null,
          dominantColor: dominantColor ?? null,
          videoLength: videoLength ?? null,
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

export default router;
