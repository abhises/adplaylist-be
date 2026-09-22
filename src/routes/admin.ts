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

    if (target.role === "admin") {
      return res.status(400).json({ error: "Admins can't have their role changed." });
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

    if (target.role === "admin") {
      return res.status(400).json({ error: "Admins can't be deleted." });
    }

    await prisma.user.delete({ where: { id: targetId } });
    res.status(204).send();
  }
);

export default router;
