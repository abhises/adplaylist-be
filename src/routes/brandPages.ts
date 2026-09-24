import { Router } from "express";
import sanitizeHtml from "sanitize-html";
import { Prisma, type BrandPage } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { brandPageSchema, idParamSchema } from "../validation/schemas.js";

const router = Router();

// Only admins write these pages, but the HTML is still sanitized before it's
// stored so a pasted template can't smuggle scripts or event handlers onto a
// public page. Layout markup, images, links and inline styles are kept.
function cleanHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "h1",
      "h2",
      "figure",
      "figcaption",
      "section",
      "span",
      "video",
      "source",
    ]),
    allowedAttributes: {
      "*": ["class", "style", "id", "align"],
      // Placeholder for an embedded library ad; see adplaylist-fe/src/lib/adEmbed.ts
      div: ["data-ad"],
      a: ["href", "target", "rel", "title"],
      img: ["src", "alt", "width", "height", "loading", "title"],
      video: ["src", "poster", "controls", "autoplay", "muted", "loop", "playsinline", "width", "height"],
      source: ["src", "type"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs:
          attribs.target === "_blank"
            ? { ...attribs, rel: "noopener noreferrer" }
            : attribs,
      }),
    },
  });
}

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
