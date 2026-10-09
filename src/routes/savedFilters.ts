import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  idParamSchema,
  savedFilterSchema,
  updateSavedFilterSchema,
} from "../validation/schemas.js";

const router = Router();

export const MAX_SAVED_FILTERS = 3;

type Row = { id: number; name: string; filters: unknown; isDefault: boolean };
const toResponse = (row: Row) => ({
  id: row.id,
  name: row.name,
  filters: row.filters,
  isDefault: row.isDefault,
});

router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const rows = await prisma.savedFilter.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "asc" },
  });
  res.json({ filters: rows.map(toResponse) });
});

router.post("/", requireAuth, validateBody(savedFilterSchema), async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const { name, filters, isDefault } = req.body;
  const count = await prisma.savedFilter.count({ where: { userId } });
  if (count >= MAX_SAVED_FILTERS) {
    return res.status(409).json({
      error: `You can save up to ${MAX_SAVED_FILTERS} filters. Delete one to save another.`,
    });
  }
  // Only one default: making this one the default unsets the others.
  const row = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.savedFilter.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return tx.savedFilter.create({ data: { userId, name, filters, isDefault } });
  });
  res.status(201).json({ filter: toResponse(row) });
});

router.patch(
  "/:id",
  requireAuth,
  validateParams(idParamSchema),
  validateBody(updateSavedFilterSchema),
  async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const id = Number(req.params.id);
    const existing = await prisma.savedFilter.findFirst({ where: { id, userId } });
    if (!existing) return res.status(404).json({ error: "Saved filter not found" });

    const { name, isDefault } = req.body;
    const row = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.savedFilter.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.savedFilter.update({ where: { id }, data: { name, isDefault } });
    });
    res.json({ filter: toResponse(row) });
  }
);

router.delete("/:id", requireAuth, validateParams(idParamSchema), async (req: AuthedRequest, res) => {
  await prisma.savedFilter.deleteMany({
    where: { id: Number(req.params.id), userId: req.userId! },
  });
  res.json({ deleted: true });
});

export default router;
