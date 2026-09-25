import { Router } from "express";
import { Prisma, type BrandPage } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { cleanHtml } from "../lib/sanitize.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
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
    ctaLabel: (body.ctaLabel as string) || "Sign up",
    published: !!body.published,
  };
}

function toBrandPageResponse(page: BrandPage) {
  return {
    id: page.id,
    slug: page.slug,
    brandName: page.brandName,
    heading: page.heading,
    bodyHtml: page.bodyHtml,
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

// Public: what /brands/:slug renders. Drafts stay hidden until published.
router.get("/public/:slug", async (req, res) => {
  const page = await prisma.brandPage.findUnique({
    where: { slug: String(req.params.slug) },
  });
  if (!page || !page.published) {
    return res.status(404).json({ error: "Page not found" });
  }
  res.json({ page: toBrandPageResponse(page) });
});

router.use(requireAuth, requireRole("admin"));

router.get("/", async (_req, res) => {
  const pages = await prisma.brandPage.findMany({
    orderBy: { updatedAt: "desc" },
  });
  res.json({ pages: pages.map(toBrandPageResponse) });
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
      data: toBrandPageData(req.body),
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
        data: toBrandPageData(req.body),
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
