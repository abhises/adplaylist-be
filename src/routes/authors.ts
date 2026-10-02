import { Router } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { slugifyName, toAuthorSummary } from "../lib/authors.js";
import { optionalAuth, requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { authorSchema, idParamSchema } from "../validation/schemas.js";
import { adForViewer, adInclude } from "./ads.js";

const router = Router();

function toAuthorData(body: Record<string, any>) {
  return {
    name: body.name,
    slug: body.slug || slugifyName(body.name),
    jobTitle: body.jobTitle || null,
    credentials: body.credentials || null,
    bio: body.bio || null,
    photoUrl: body.photoUrl || null,
    linkedinUrl: body.linkedinUrl || null,
    websiteUrl: body.websiteUrl || null,
  };
}

const withAdCount = { _count: { select: { adsAdded: true } } } as const;

// Public: the curators, for the admin list and for matching the "Added by"
// name in an ad's CSV.
router.get("/", async (_req, res) => {
  const authors = await prisma.author.findMany({
    include: withAdCount,
    orderBy: { name: "asc" },
  });
  res.json({
    authors: authors.map((a) => toAuthorSummary(a, a._count.adsAdded)),
  });
});

// Public author page: the profile and every ad they added.
router.get("/:slug", optionalAuth, async (req: AuthedRequest, res) => {
  const author = await prisma.author.findUnique({
    where: { slug: String(req.params.slug) },
  });
  if (!author) return res.status(404).json({ error: "Author not found" });
  const ads = await prisma.ad.findMany({
    where: { authorId: author.id },
    include: adInclude,
    orderBy: { id: "desc" },
  });
  res.json({
    author: toAuthorSummary(author, ads.length),
    ads: ads.map(adForViewer(req, { full: false })),
  });
});

function isDuplicate(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

router.post(
  "/",
  requireAuth,
  requireRole("admin"),
  validateBody(authorSchema),
  async (req, res) => {
    try {
      const author = await prisma.author.create({ data: toAuthorData(req.body) });
      res.status(201).json({ author: toAuthorSummary(author, 0) });
    } catch (err) {
      if (isDuplicate(err)) {
        return res.status(409).json({ error: "An author already uses that slug" });
      }
      throw err;
    }
  }
);

router.put(
  "/:id",
  requireAuth,
  requireRole("admin"),
  validateParams(idParamSchema),
  validateBody(authorSchema),
  async (req, res) => {
    const id = Number(req.params.id);
    try {
      const author = await prisma.author.update({
        where: { id },
        data: toAuthorData(req.body),
        include: withAdCount,
      });
      res.json({ author: toAuthorSummary(author, author._count.adsAdded) });
    } catch (err) {
      if (isDuplicate(err)) {
        return res.status(409).json({ error: "An author already uses that slug" });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        return res.status(404).json({ error: "Author not found" });
      }
      throw err;
    }
  }
);

// Their ads stay published; the byline is just removed (ON DELETE SET NULL).
router.delete(
  "/:id",
  requireAuth,
  requireRole("admin"),
  validateParams(idParamSchema),
  async (req, res) => {
    const { count } = await prisma.author.deleteMany({
      where: { id: Number(req.params.id) },
    });
    if (!count) return res.status(404).json({ error: "Author not found" });
    res.status(204).send();
  }
);

export default router;
