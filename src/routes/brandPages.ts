import { Router } from "express";
import crypto from "node:crypto";
import { Prisma, type BrandPage } from "../generated/prisma/client.js";
import {
  lockBrandProfileAds,
  normalizeBrandProfile,
  type BrandProfile,
} from "../lib/brandProfile.js";
import { prisma } from "../lib/prisma.js";
import { cleanHtml } from "../lib/sanitize.js";
import {
  optionalAuth,
  requireAuth,
  requirePermission,
  type AuthedRequest,
} from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { brandPageSchema, idParamSchema } from "../validation/schemas.js";

const router = Router();

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function toBrandPageData(body: Record<string, unknown>) {
  const brandName = String(body.brandName);
  return {
    brandName,
    slug: (body.slug as string) || slugify(brandName),
    heading: (body.heading as string) || `${brandName} ads`,
    bodyHtml: cleanHtml((body.bodyHtml as string) ?? ""),
    profile: normalizeBrandProfile(body.profile) ?? Prisma.DbNull,
    ctaLabel: (body.ctaLabel as string) || "Sign up",
    published: !!body.published,
  };
}

const newAccessKey = () => crypto.randomBytes(12).toString("base64url");

// `showAds: false` is what visitors get: the page with its ads locked, and
// without the key that unlocks them.
function toBrandPageResponse(page: BrandPage, { showAds = true } = {}) {
  const profile = (page.profile as BrandProfile | null) ?? undefined;
  return {
    id: page.id,
    slug: page.slug,
    brandName: page.brandName,
    heading: page.heading,
    bodyHtml: page.bodyHtml,
    profile: profile && !showAds ? lockBrandProfileAds(profile) : profile,
    adsLocked: !!profile && !showAds,
    accessKey: showAds ? (page.accessKey ?? undefined) : undefined,
    ctaLabel: page.ctaLabel,
    published: page.published,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

function isSlugConflict(err: unknown) {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

function keyMatches(page: BrandPage, key: unknown) {
  if (!page.accessKey || typeof key !== "string") return false;
  const a = Buffer.from(page.accessKey);
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Public: what /brands/:slug renders. Drafts stay hidden until published.
// A CSV page's ads are for signed-in visitors; the brand itself gets them
// through the ?key= on the link in its outreach email.
router.get("/public/:slug", optionalAuth, async (req: AuthedRequest, res) => {
  const page = await prisma.brandPage.findUnique({
    where: { slug: String(req.params.slug) },
  });
  if (!page || !page.published) {
    return res.status(404).json({ error: "Page not found" });
  }
  const showAds = !!req.userId || keyMatches(page, req.query.key);
  const { accessKey: _key, ...response } = toBrandPageResponse(page, { showAds });
  res.json({ page: response });
});

router.use(requireAuth, requirePermission("brandPages"));

router.get("/", async (_req, res) => {
  const pages = await prisma.brandPage.findMany({
    orderBy: { updatedAt: "desc" },
  });
  res.json({ pages: pages.map((page) => toBrandPageResponse(page)) });
});

router.get("/:id", validateParams(idParamSchema), async (req, res) => {
  const page = await prisma.brandPage.findUnique({
    where: { id: Number(req.params.id) },
  });
  if (!page) return res.status(404).json({ error: "Page not found" });
  res.json({ page: toBrandPageResponse(page) });
});

router.post("/", validateBody(brandPageSchema), async (req, res) => {
  try {
    const page = await prisma.brandPage.create({
      data: { ...toBrandPageData(req.body), accessKey: newAccessKey() },
    });
    res.status(201).json({ page: toBrandPageResponse(page) });
  } catch (err) {
    if (isSlugConflict(err)) {
      return res.status(409).json({ error: "A page with that link already exists" });
    }
    throw err;
  }
});

router.put(
  "/:id",
  validateParams(idParamSchema),
  validateBody(brandPageSchema),
  async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.brandPage.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Page not found" });
    try {
      const page = await prisma.brandPage.update({
        where: { id },
        // Pages from before access keys get theirs on the next save.
        data: {
          ...toBrandPageData(req.body),
          accessKey: existing.accessKey ?? newAccessKey(),
        },
      });
      res.json({ page: toBrandPageResponse(page) });
    } catch (err) {
      if (isSlugConflict(err)) {
        return res.status(409).json({ error: "A page with that link already exists" });
      }
      throw err;
    }
  }
);

router.delete("/:id", validateParams(idParamSchema), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.brandPage.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Page not found" });
  await prisma.brandPage.delete({ where: { id } });
  res.status(204).send();
});

export default router;
