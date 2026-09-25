import { Router } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  createUserSchema,
  idParamSchema,
  updateUserDetailsSchema,
  updateUserRoleSchema,
} from "../validation/schemas.js";

const router = Router();

router.use(requireAuth, requireRole("admin"));

const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  canManageBlog: true,
  canManageBrandPages: true,
  createdAt: true,
} as const;

router.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: USER_SELECT,
    orderBy: { createdAt: "asc" },
  });
  res.json({ users });
});

// Admins create accounts for staff, e.g. an editor who only manages the blog.
// Blog / brand page access only applies to editors, so it's cleared for
// any other role.
router.post("/users", validateBody(createUserSchema), async (req, res) => {
  const { fullName, email, password, role } = req.body;
  const isEditor = role === "editor";
  const canManageBlog = isEditor && req.body.canManageBlog;
  const canManageBrandPages = isEditor && req.body.canManageBrandPages;
  try {
    const user = await prisma.user.create({
      data: {
        fullName,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role,
        canManageBlog,
        canManageBrandPages,
      },
      select: USER_SELECT,
    });
    res.status(201).json({ user });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return res.status(409).json({ error: "An account already uses that email" });
    }
    throw err;
  }
});

router.patch(
  "/users/:id",
  validateParams(idParamSchema),
  validateBody(updateUserDetailsSchema),
  async (req: AuthedRequest, res) => {
    const targetId = Number(req.params.id);
    const { fullName, email } = req.body;
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { role: true },
    });
    if (!target) return res.status(404).json({ error: "User not found" });
    const isEditor = target.role === "editor";
    const canManageBlog = isEditor && !!req.body.canManageBlog;
    const canManageBrandPages = isEditor && !!req.body.canManageBrandPages;

    try {
      const updated = await prisma.user.update({
        where: { id: targetId },
        data: { fullName, email, canManageBlog, canManageBrandPages },
        select: USER_SELECT,
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

    // Leaving the editor role takes its blog / brand page access with it.
    const updated = await prisma.user.update({
      where: { id: targetId },
      data:
        role === "editor"
          ? { role }
          : { role, canManageBlog: false, canManageBrandPages: false },
      select: USER_SELECT,
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
