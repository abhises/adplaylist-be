import { Router } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { replaceTagOnAds } from "../lib/tags.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { idParamSchema, tagSchema } from "../validation/schemas.js";

const router = Router();

router.use(requireAuth);

router.get("/", async (_req, res) => {
  const tags = await prisma.tag.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  res.json({ tags });
});

function isDuplicate(err: unknown) {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

// Designers can add a tag while tagging an ad; renaming and deleting reach
// into every ad, so they're admin-only.
router.post(
  "/",
  requireRole("designer", "admin"),
  validateBody(tagSchema),
  async (req, res) => {
    try {
      const tag = await prisma.tag.create({
        data: { name: req.body.name },
        select: { id: true, name: true },
      });
      res.status(201).json({ tag });
    } catch (err) {
      if (isDuplicate(err)) {
        return res.status(409).json({ error: "That tag already exists" });
      }
      throw err;
    }
  }
);

router.patch(
  "/:id",
  requireRole("admin"),
  validateParams(idParamSchema),
  validateBody(tagSchema),
  async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.tag.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Tag not found" });

    try {
      const tag = await prisma.$transaction(async (tx) => {
        const updated = await tx.tag.update({
          where: { id },
          data: { name: req.body.name },
          select: { id: true, name: true },
        });
        await replaceTagOnAds(tx, existing.name, updated.name);
        return updated;
      });
      res.json({ tag });
    } catch (err) {
      if (isDuplicate(err)) {
        return res.status(409).json({ error: "That tag already exists" });
      }
      throw err;
    }
  }
);

router.delete(
  "/:id",
  requireRole("admin"),
  validateParams(idParamSchema),
  async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.tag.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Tag not found" });

    await prisma.$transaction(async (tx) => {
      await replaceTagOnAds(tx, existing.name, null);
      await tx.tag.delete({ where: { id } });
    });
    res.status(204).send();
  }
);

export default router;
