import { Router } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  idParamSchema,
  updateUserDetailsSchema,
  updateUserRoleSchema,
} from "../validation/schemas.js";

const router = Router();

router.use(requireAuth, requireRole("admin"));

// True if `targetId` is an admin and removing them (by role change or
// deletion) would leave zero admins behind.
async function wouldRemoveLastAdmin(targetId: number, targetRole: string) {
  if (targetRole !== "admin") return false;
  const otherAdmins = await prisma.user.count({
    where: { role: "admin", id: { not: targetId } },
  });
  return otherAdmins === 0;
}

router.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, fullName: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json({ users });
});

router.patch(
  "/users/:id",
  validateParams(idParamSchema),
  validateBody(updateUserDetailsSchema),
  async (req: AuthedRequest, res) => {
    const targetId = Number(req.params.id);
    const { fullName, email } = req.body;

    try {
      const updated = await prisma.user.update({
        where: { id: targetId },
        data: { fullName, email },
        select: { id: true, email: true, fullName: true, role: true, createdAt: true },
      });
      res.json({ user: updated });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2025") {
          return res.status(404).json({ error: "User not found" });
        }
        if (err.code === "P2002") {
          return res
            .status(409)
            .json({ error: "Another account already uses that email" });
        }
      }
      throw err;
    }
  }
);

router.patch(
  "/users/:id/role",
  validateParams(idParamSchema),
  validateBody(updateUserRoleSchema),
  async (req: AuthedRequest, res) => {
    const targetId = Number(req.params.id);
    const { role } = req.body;

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: "User not found" });

    if (role !== "admin" && (await wouldRemoveLastAdmin(targetId, target.role))) {
      return res.status(400).json({ error: "Can't remove the last admin." });
    }

    const updated = await prisma.user.update({
      where: { id: targetId },
      data: { role },
      select: { id: true, email: true, fullName: true, role: true, createdAt: true },
    });
    res.json({ user: updated });
  }
);

router.delete(
  "/users/:id",
  validateParams(idParamSchema),
  async (req: AuthedRequest, res) => {
    const targetId = Number(req.params.id);

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: "User not found" });

    if (await wouldRemoveLastAdmin(targetId, target.role)) {
      return res.status(400).json({ error: "Can't delete the last admin." });
    }

    await prisma.user.delete({ where: { id: targetId } });
    res.status(204).send();
  }
);

export default router;
