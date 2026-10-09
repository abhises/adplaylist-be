import { Router } from "express";
import Stripe from "stripe";
import type { Account } from "../generated/prisma/client.js";
import { getStripe, refreshFromStripe, toAccountResponse } from "../lib/billing.js";
import { prisma } from "../lib/prisma.js";
import { notifyAdmins } from "../lib/realtime.js";
import {
  loadAccount,
  requireAuth,
  requireRole,
  type AuthedRequest,
} from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { deleteAccountSchema } from "../validation/schemas.js";

const router = Router();

// "Before you go" discounts, in the order they're offered: someone who took
// the first and comes back to delete again is offered the second, and after
// both, none. Each takes a percentage off the next 3 invoices.
const RETENTION_OFFERS = [
  { percent: 25, months: 3, coupon: "adplaylist_retention_25_3mo" },
  { percent: 10, months: 3, coupon: "adplaylist_retention_10_3mo" },
] as const;

type Offer = (typeof RETENTION_OFFERS)[number];

// The offer this caller would get, if any: only the owner of a company with
// a running subscription (active, or a trial with a card on file), and not
// while a discount is already on it — a new one would replace it.
async function offerFor(req: AuthedRequest): Promise<Offer | null> {
  const account = req.account;
  if (!account || req.accountRole !== "owner" || !account.stripeSubscriptionId) return null;
  if (account.status !== "active" && account.status !== "trial") return null;
  const offer = RETENTION_OFFERS[account.retentionOffersUsed];
  if (!offer) return null;
  try {
    const sub = await getStripe().subscriptions.retrieve(account.stripeSubscriptionId);
    if (sub.discounts.length > 0) return null;
  } catch {
    return null;
  }
  return offer;
}

// The coupon behind an offer, created in Stripe the first time it's needed.
async function ensureCoupon(offer: Offer) {
  const stripe = getStripe();
  try {
    await stripe.coupons.retrieve(offer.coupon);
  } catch (err) {
    if (!(err instanceof Stripe.errors.StripeInvalidRequestError) || err.code !== "resource_missing") {
      throw err;
    }
    await stripe.coupons.create({
      id: offer.coupon,
      name: `Stay offer: ${offer.percent}% off ${offer.months} months`,
      percent_off: offer.percent,
      duration: "repeating",
      duration_in_months: offer.months,
    });
  }
}

async function record(
  req: AuthedRequest,
  data: { offerPercent: number | null; outcome: "discount" | "deactivated"; reason?: string; details?: string }
) {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return;
  await prisma.cancellationFeedback.create({
    data: {
      userId: user.id,
      accountId: req.account?.id ?? null,
      userName: user.fullName,
      userEmail: user.email,
      accountName: req.account?.name ?? null,
      plan: req.account?.plan ?? null,
      offerPercent: data.offerPercent,
      outcome: data.outcome,
      reason: data.reason ?? null,
      details: data.details || null,
    },
  });
  return user;
}

// The discount to show before the cancel questions, or null to skip it.
router.get("/offer", requireAuth, loadAccount, async (req: AuthedRequest, res) => {
  const offer = await offerFor(req);
  res.json({ offer: offer ? { percent: offer.percent, months: offer.months } : null });
});

// "Claim 25% off and stay": puts the discount on the subscription, from the
// next invoice.
router.post("/offer/accept", requireAuth, loadAccount, async (req: AuthedRequest, res) => {
  const offer = await offerFor(req);
  if (!offer) return res.status(409).json({ error: "This offer isn't available any more." });
  const account = req.account!;

  await ensureCoupon(offer);
  await getStripe().subscriptions.update(account.stripeSubscriptionId!, {
    discounts: [{ coupon: offer.coupon }],
  });
  await prisma.account.update({
    where: { id: account.id },
    data: { retentionOffersUsed: { increment: 1 } },
  });
  await record(req, { offerPercent: offer.percent, outcome: "discount" });

  const updated = await refreshFromStripe(account);
  res.json({
    offer: { percent: offer.percent, months: offer.months },
    account: await toAccountResponse(updated, req.accountRole ?? null),
  });
});

// "Delete my account": saves why, cancels the company's subscription if the
// owner is leaving, and deactivates the user. Nothing is erased; they just
// can't sign in any more.
router.post(
  "/delete",
  requireAuth,
  loadAccount,
  validateBody(deleteAccountSchema),
  async (req: AuthedRequest, res) => {
    if (req.userRole !== "client") {
      return res.status(403).json({ error: "Staff accounts can't be deleted here." });
    }
    const { reason, details } = req.body;
    const offer = await offerFor(req);

    const account: Account | null = req.account ?? null;
    if (account && req.accountRole === "owner" && account.stripeSubscriptionId && account.status !== "expired") {
      try {
        await getStripe().subscriptions.cancel(account.stripeSubscriptionId);
      } catch (err) {
        // Already cancelled in Stripe: nothing left to stop.
        if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) throw err;
      }
      await refreshFromStripe(account).catch(() => {});
    }

    await prisma.user.update({
      where: { id: req.userId! },
      data: { deactivatedAt: new Date() },
    });
    const user = await record(req, {
      offerPercent: offer?.percent ?? null,
      outcome: "deactivated",
      reason,
      details,
    });

    if (user) {
      void notifyAdmins({
        type: "user.deactivated",
        title: `Account deleted: ${user.fullName}${account ? ` (${account.name})` : ""}`,
        body: details ? `${reason}: ${details}` : reason,
        link: "/admin/cancellations",
        actorId: user.id,
      });
    }
    res.json({ deactivated: true });
  }
);

// Admin → Cancellations: every pass through the flow, newest first.
router.get("/feedback", requireAuth, requireRole("admin"), async (_req, res) => {
  const rows = await prisma.cancellationFeedback.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ feedback: rows });
});

export default router;
