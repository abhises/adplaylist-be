import { Router } from "express";
import {
  Prisma,
  type Account,
  type OnboardingAnswers,
  type User,
} from "../generated/prisma/client.js";
import { loadAccountForUser, toAccountResponse } from "../lib/billing.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  onboardingAnswersSchema,
  updateProfileSchema,
} from "../validation/schemas.js";

const router = Router();

export async function toUserResponse(user: User, account: Account | null = null) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    permissions: {
      blog: user.role === "admin" || (user.role === "editor" && user.canManageBlog),
      brandPages:
        user.role === "admin" || (user.role === "editor" && user.canManageBrandPages),
    },
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
    account: account ? await toAccountResponse(account, user.accountRole) : null,
  };
}

// The user plus their account (with any due status changes applied).
export async function userResponseFor(userId: number) {
  const loaded = await loadAccountForUser(userId);
  return loaded ? toUserResponse(loaded.user, loaded.account) : null;
}

router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const user = await userResponseFor(req.userId!);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user });
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
      res.json({ user: await userResponseFor(user.id) });
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

export function toOnboardingResponse(row: OnboardingAnswers | null) {
  if (!row) return null;
  return {
    niche: row.niche ?? "",
    product: row.product ?? "",
    brand: row.brand ?? "",
    website: row.website ?? "",
    libraryType: row.libraryType === "google" ? "google" : "meta",
    libraryUrl: row.libraryUrl ?? "",
    competitors: Array.isArray(row.competitors)
      ? (row.competitors as unknown[]).filter((c) => typeof c === "string")
      : [],
    completedAt: row.completedAt,
    skippedAt: row.skippedAt,
    updatedAt: row.updatedAt,
  };
}

router.get("/onboarding", requireAuth, async (req: AuthedRequest, res) => {
  const row = await prisma.onboardingAnswers.findUnique({
    where: { userId: req.userId! },
  });
  res.json({ answers: toOnboardingResponse(row) });
});

// Fields left out are kept, so each step of the popup saves only its own.
router.put(
  "/onboarding",
  requireAuth,
  validateBody(onboardingAnswersSchema),
  async (req: AuthedRequest, res) => {
    const { action, ...fields } = req.body as {
      action?: "complete" | "skip";
      niche?: string;
      product?: string;
      brand?: string;
      website?: string;
      libraryType?: string;
      libraryUrl?: string;
      competitors?: string[];
    };
    const data: Prisma.OnboardingAnswersUncheckedUpdateInput = {};
    for (const key of [
      "niche",
      "product",
      "brand",
      "website",
      "libraryUrl",
    ] as const) {
      const value = fields[key];
      if (value !== undefined) data[key] = value || null;
    }
    if (fields.libraryType) data.libraryType = fields.libraryType;
    if (fields.competitors) data.competitors = fields.competitors;
    if (action === "complete") data.completedAt = new Date();
    if (action === "skip") data.skippedAt = new Date();
    const row = await prisma.onboardingAnswers.upsert({
      where: { userId: req.userId! },
      create: {
        ...(data as Prisma.OnboardingAnswersUncheckedCreateInput),
        userId: req.userId!,
      },
      update: data,
    });
    res.json({ answers: toOnboardingResponse(row) });
  }
);

export default router;
