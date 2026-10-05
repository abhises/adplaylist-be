import { Router } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { getPriceTable, setPlanPrice } from "../lib/catalog.js";
import { isValidVolume } from "../lib/plans.js";
import { toPlansResponse } from "./plans.js";
import {
  createUserSchema,
  idParamSchema,
  planPricesSchema,
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

// Saves every edited price in one go. Each goes through Stripe in turn; if
// one fails, the ones before it stay saved and the error says which failed.
router.put("/plan-prices", validateBody(planPricesSchema), async (req: AuthedRequest, res) => {
  const changes: { plan: string; volume: number; monthly: number; yearly: number; credits: number }[] =
    req.body.changes;
  type Plan = Parameters<typeof setPlanPrice>[0];
  const bad = changes.find((c) => !isValidVolume(c.plan as Plan, c.volume));
  if (bad) {
    return res.status(404).json({ error: `${bad.plan} doesn't have a ${bad.volume} credit volume.` });
  }
  let saved = 0;
  for (const c of changes) {
    try {
      await setPlanPrice(
        c.plan as Plan,
        c.volume,
        { monthly: Math.round(c.monthly * 100), yearly: Math.round(c.yearly * 100), credits: c.credits },
        req.userId!
      );
      saved++;
    } catch (err) {
      console.error("Price change failed:", err);
      const what = `${c.plan}${c.volume ? ` ${c.volume}` : ""}`;
      return res.status(502).json({
        error: `Saved ${saved} of ${changes.length}; ${what} failed: ${err instanceof Error ? err.message : "unknown error"}`,
        plans: toPlansResponse(await getPriceTable()),
      });
    }
  }
  res.json({ plans: toPlansResponse(await getPriceTable()) });
});

// Every price each plan + volume has had, newest first, with who set it.
router.get("/plan-prices/history", async (_req, res) => {
  const rows = await prisma.planPriceChange.findMany({
    orderBy: [{ changedAt: "desc" }, { id: "desc" }],
    take: 500,
  });
  const adminIds = [...new Set(rows.map((r) => r.changedById).filter((id): id is number => id !== null))];
  const admins = await prisma.user.findMany({
    where: { id: { in: adminIds } },
    select: { id: true, fullName: true },
  });
  const nameOf = new Map(admins.map((a) => [a.id, a.fullName]));
  const dollars = (cents: number | null) => (cents === null ? null : cents / 100);
  res.json({
    history: rows.map((r) => ({
      id: r.id,
      plan: r.plan,
      volume: r.volume,
      oldMonthly: dollars(r.oldMonthlyCents),
      oldYearly: dollars(r.oldYearlyCents),
      monthly: r.monthlyCents / 100,
      yearly: r.yearlyCents / 100,
      oldCredits: r.oldCredits,
      credits: r.credits,
      changedBy: r.changedById ? (nameOf.get(r.changedById) ?? null) : null,
      changedAt: r.changedAt.toISOString(),
    })),
  });
});

export default router;
