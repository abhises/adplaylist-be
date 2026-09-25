import { Router } from "express";
import { Prisma, type BlogPost } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { cleanHtml } from "../lib/sanitize.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { blogPostSchema, idParamSchema } from "../validation/schemas.js";

const router = Router();

function slugify(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function toBlogPostData(body: Record<string, unknown>, existing?: BlogPost) {
  const title = String(body.title);
  const published = !!body.published;
  return {
    title,
    slug: (body.slug as string) || slugify(title),
    excerpt: (body.excerpt as string) || null,
    coverImageUrl: (body.coverImageUrl as string) || null,
    bodyHtml: cleanHtml((body.bodyHtml as string) ?? ""),
    published,
    publishedAt: existing?.publishedAt ?? (published ? new Date() : null),
  };
}

function toBlogPostResponse(post: BlogPost, { withBody = true } = {}) {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt ?? undefined,
    coverImageUrl: post.coverImageUrl ?? undefined,
    ...(withBody ? { bodyHtml: post.bodyHtml } : {}),
    published: post.published,
    publishedAt: post.publishedAt ?? undefined,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

function isSlugConflict(err: unknown) {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

// Public: the /blog index, newest first. Bodies are left out; the index only
// shows titles, excerpts and covers.
router.get("/public", async (_req, res) => {
  const posts = await prisma.blogPost.findMany({
    where: { published: true },
    orderBy: { publishedAt: "desc" },
  });
  res.json({ posts: posts.map((p) => toBlogPostResponse(p, { withBody: false })) });
});

// Public: what /blog/:slug renders. Drafts stay hidden until published.
router.get("/public/:slug", async (req, res) => {
  const post = await prisma.blogPost.findUnique({
    where: { slug: String(req.params.slug) },
  });
  if (!post || !post.published) {
    return res.status(404).json({ error: "Post not found" });
  }
  res.json({ post: toBlogPostResponse(post) });
});

router.use(requireAuth, requireRole("admin"));

router.get("/", async (_req, res) => {
  const posts = await prisma.blogPost.findMany({
    orderBy: { updatedAt: "desc" },
  });
  res.json({ posts: posts.map((p) => toBlogPostResponse(p, { withBody: false })) });
});

router.get("/:id", validateParams(idParamSchema), async (req, res) => {
  const post = await prisma.blogPost.findUnique({
    where: { id: Number(req.params.id) },
  });
  if (!post) return res.status(404).json({ error: "Post not found" });
  res.json({ post: toBlogPostResponse(post) });
});

router.post("/", validateBody(blogPostSchema), async (req, res) => {
  try {
    const post = await prisma.blogPost.create({
      data: toBlogPostData(req.body),
    });
    res.status(201).json({ post: toBlogPostResponse(post) });
  } catch (err) {
    if (isSlugConflict(err)) {
      return res.status(409).json({ error: "A post with that link already exists" });
    }
    throw err;
  }
});

router.put(
  "/:id",
  validateParams(idParamSchema),
  validateBody(blogPostSchema),
  async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.blogPost.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Post not found" });
    try {
      const post = await prisma.blogPost.update({
        where: { id },
        data: toBlogPostData(req.body, existing),
      });
      res.json({ post: toBlogPostResponse(post) });
    } catch (err) {
      if (isSlugConflict(err)) {
        return res.status(409).json({ error: "A post with that link already exists" });
      }
      throw err;
    }
  }
);

router.delete("/:id", validateParams(idParamSchema), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.blogPost.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Post not found" });
  await prisma.blogPost.delete({ where: { id } });
  res.status(204).send();
});

export default router;
