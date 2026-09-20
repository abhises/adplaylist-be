import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { idParamSchema, updateUserRoleSchema } from "../validation/schemas.js";

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
  "/users/:id/role",
  validateParams(idParamSchema),
  validateBody(updateUserRoleSchema),
  async (req: AuthedRequest, res) => {
    const targetId = Number(req.params.id);
    const { role } = req.body;

    if (targetId === req.userId) {
      return res.status(400).json({ error: "You can't change your own role." });
    }

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: "User not found" });

    if (target.role === "admin" && role !== "admin") {
      const otherAdmins = await prisma.user.count({
        where: { role: "admin", id: { not: targetId } },
      });
      if (otherAdmins === 0) {
        return res
          .status(400)
          .json({ error: "Can't remove the last admin." });
      }
    }

    const updated = await prisma.user.update({
      where: { id: targetId },
      data: { role },
      select: { id: true, email: true, fullName: true, role: true, createdAt: true },
    });
    res.json({ user: updated });
  }
);

export default router;
