import { Router } from "express";
import { Prisma, type User } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { updateProfileSchema } from "../validation/schemas.js";

const router = Router();

export function toUserResponse(user: User) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    defaultLanguage: user.defaultLanguage,
    gridDensity: user.gridDensity,
    memberSince: user.createdAt,
    emailPreferences: {
      onboarding: user.prefOnboarding,
      product: user.prefProduct,
      promotions: user.prefPromotions,
      brand: user.prefBrand,
      newsletter: user.prefNewsletter,
    },
  };
}

router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: toUserResponse(user) });
});

router.put(
  "/",
  requireAuth,
  validateBody(updateProfileSchema),
  async (req: AuthedRequest, res) => {
    const { fullName, defaultLanguage, gridDensity, emailPreferences } =
      req.body;

    try {
      const user = await prisma.user.update({
        where: { id: req.userId! },
        data: {
          fullName: fullName ?? undefined,
          defaultLanguage: defaultLanguage ?? undefined,
          gridDensity: gridDensity ?? undefined,
          prefOnboarding: emailPreferences?.onboarding ?? undefined,
          prefProduct: emailPreferences?.product ?? undefined,
          prefPromotions: emailPreferences?.promotions ?? undefined,
          prefBrand: emailPreferences?.brand ?? undefined,
          prefNewsletter: emailPreferences?.newsletter ?? undefined,
        },
      });
      res.json({ user: toUserResponse(user) });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        return res.status(404).json({ error: "User not found" });
      }
      throw err;
    }
  }
);

export default router;
