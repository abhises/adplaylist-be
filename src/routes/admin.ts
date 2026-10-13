import { Router } from "express";
import Stripe from "stripe";
import bcrypt from "bcryptjs";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { setPlanPrice } from "../lib/catalog.js";
import { setCreditSettings } from "../lib/creditSettings.js";
import { getStripe } from "../lib/billing.js";
import { isValidVolume } from "../lib/plans.js";
import { priceListResponse } from "./plans.js";
import { toOnboardingResponse } from "./profile.js";
import {
  createUserSchema,
  creditSettingsSchema,
  idParamSchema,
  planPricesSchema,
  promoCodeActiveSchema,
  promoCodeSchema,
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
  accountRole: true,
  account: {
    select: {
      name: true,
      plan: true,
      creditVolume: true,
      billingCycle: true,
      status: true,
      currentPeriodEnd: true,
    },
  },
} as const;

// Accounts that have paid for their current period: active, cancelled but
// running to the end of what they paid for, or past due on a renewal.
const PAID_STATUSES = ["active", "cancelled", "past_due"];

type SelectedUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

// Adds the user's plan, and whether it's paid, for the Users table.
function toAdminUser({ account, accountRole, ...user }: SelectedUser) {
  return {
    ...user,
    billing: account
      ? {
          company: account.name,
          plan: account.plan,
          creditVolume: account.creditVolume,
          billingCycle: account.billingCycle,
          status: account.status,
          currentPeriodEnd: account.currentPeriodEnd,
          paid: PAID_STATUSES.includes(account.status),
          owner: accountRole === "owner",
        }
      : null,
  };
}

router.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: USER_SELECT,
    orderBy: { createdAt: "asc" },
  });
  res.json({ users: users.map(toAdminUser) });
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
    res.status(201).json({ user: toAdminUser(user) });
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
      res.json({ user: toAdminUser(updated) });
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
    res.json({ user: toAdminUser(updated) });
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
        ...(await priceListResponse()),
      });
    }
  }
  res.json(await priceListResponse());
});

// What requests cost in credits, what each plan's trial gets and what a
// referral earns. Applies from now on: requests already made keep what they
// were charged.
router.put(
  "/credit-settings",
  validateBody(creditSettingsSchema),
  async (req: AuthedRequest, res) => {
    await setCreditSettings(req.body, req.userId!);
    res.json(await priceListResponse());
  }
);

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

// ---- Promo codes: discount codes customers type in at checkout ----
//
// Stripe keeps them, as a coupon (the discount) plus a promotion code (the
// word typed in). Each code made here gets a coupon of its own.

function toPromoCode(p: Stripe.PromotionCode) {
  const coupon = p.promotion.coupon && typeof p.promotion.coupon !== "string" ? p.promotion.coupon : null;
  return {
    id: p.id,
    code: p.code,
    active: p.active,
    percentOff: coupon?.percent_off ?? null,
    // Stripe amounts are in cents; our prices are all in USD.
    amountOff: coupon?.amount_off != null ? coupon.amount_off / 100 : null,
    duration: coupon?.duration ?? null,
    months: coupon?.duration_in_months ?? null,
    timesRedeemed: p.times_redeemed,
    maxRedemptions: p.max_redemptions,
    expiresAt: p.expires_at ? new Date(p.expires_at * 1000) : null,
    firstTimeOnly: p.restrictions.first_time_transaction,
    createdAt: new Date(p.created * 1000),
  };
}

// Stripe's own message for a request it turned down (e.g. a code that's
// already in use) is the useful one to show.
function stripeRejection(err: unknown) {
  return err instanceof Stripe.errors.StripeInvalidRequestError ? err.message : null;
}

router.get("/promo-codes", async (_req, res) => {
  const { data } = await getStripe().promotionCodes.list({
    limit: 100,
    expand: ["data.promotion.coupon"],
  });
  // A code whose coupon was deleted in Stripe can never be used again.
  const usable = data.filter((p) => {
    const coupon = p.promotion.coupon;
    return !!coupon && (typeof coupon === "string" || !("deleted" in coupon && coupon.deleted));
  });
  res.json({ promoCodes: usable.map(toPromoCode) });
});

router.post("/promo-codes", validateBody(promoCodeSchema), async (req, res) => {
  const { code, percentOff, duration, months, maxRedemptions, expiresOn, firstTimeOnly } = req.body;
  // Usable through the end of the chosen day (UTC).
  const expiresAt = expiresOn ? Date.parse(`${String(expiresOn).slice(0, 10)}T23:59:59Z`) : null;
  if (expiresAt !== null && expiresAt <= Date.now()) {
    return res.status(400).json({ error: "The expiry date must be in the future." });
  }

  const stripe = getStripe();
  const coupon = await stripe.coupons.create({
    name: code,
    percent_off: percentOff,
    duration,
    ...(duration === "repeating" ? { duration_in_months: months } : {}),
  });
  try {
    const created = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: coupon.id },
      code,
      ...(maxRedemptions ? { max_redemptions: maxRedemptions } : {}),
      ...(expiresAt ? { expires_at: Math.floor(expiresAt / 1000) } : {}),
      ...(firstTimeOnly ? { restrictions: { first_time_transaction: true } } : {}),
      expand: ["promotion.coupon"],
    });
    res.status(201).json({ promoCode: toPromoCode(created) });
  } catch (err) {
    // No code without its coupon, and no coupon left over without a code.
    await stripe.coupons.del(coupon.id).catch(() => {});
    const message = stripeRejection(err);
    if (message) return res.status(400).json({ error: message });
    throw err;
  }
});

// Turns a code off (it stops working at checkout; subscriptions already
// using it keep their discount) or back on.
router.put("/promo-codes/:id", validateBody(promoCodeActiveSchema), async (req, res) => {
  const id = String(req.params.id);
  if (!/^promo_[A-Za-z0-9]+$/.test(id)) {
    return res.status(404).json({ error: "Promo code not found" });
  }
  try {
    const updated = await getStripe().promotionCodes.update(id, {
      active: req.body.active,
      expand: ["promotion.coupon"],
    });
    res.json({ promoCode: toPromoCode(updated) });
  } catch (err) {
    const message = stripeRejection(err);
    if (message) return res.status(400).json({ error: message });
    throw err;
  }
});

// ---- Transactions: every customer's payments and credit movements ----

const RANGE_DAYS = [30, 90, 365];

// The range from ?days= (30, 90 or 365; default 30), as its first day at
// midnight UTC and the list of days in it ("YYYY-MM-DD"), oldest first.
function rangeFrom(query: unknown) {
  const asked = Number((query as { days?: string }).days);
  const days = RANGE_DAYS.includes(asked) ? asked : 30;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const keys = Array.from({ length: days }, (_, i) =>
    new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10)
  );
  return { days, start, keys };
}

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const cents = (n: number) => Math.round(n * 100) / 100;

// Stripe invoices across every customer, newest first, with the account they
// belong to. Only paid invoices count towards revenue.
const MAX_INVOICES = 1000;

// Everyone's answers to the library's brand questionnaire, newest first.
router.get("/onboarding", async (_req, res) => {
  const rows = await prisma.onboardingAnswers.findMany({
    orderBy: { updatedAt: "desc" },
    include: { user: { select: { id: true, fullName: true, email: true } } },
  });
  res.json({
    answers: rows.map((row) => ({
      id: row.id,
      user: row.user,
      ...toOnboardingResponse(row)!,
    })),
  });
});

router.get("/transactions/payments", async (req, res) => {
  const { days, start, keys } = rangeFrom(req.query);
  const invoices = [];
  for await (const inv of getStripe().invoices.list({
    limit: 100,
    created: { gte: Math.floor(start.getTime() / 1000) },
  })) {
    if (inv.status !== "draft") invoices.push(inv);
    if (invoices.length >= MAX_INVOICES) break;
  }

  const customerIds = [
    ...new Set(
      invoices
        .map((inv) => (typeof inv.customer === "string" ? inv.customer : inv.customer?.id))
        .filter((id): id is string => !!id)
    ),
  ];
  const accounts = await prisma.account.findMany({
    where: { stripeCustomerId: { in: customerIds } },
    select: {
      stripeCustomerId: true,
      name: true,
      users: { where: { accountRole: "owner" }, select: { email: true }, take: 1 },
    },
  });
  const accountFor = (customer: string | null | undefined) =>
    accounts.find((a) => a.stripeCustomerId === customer);

  const revenue = new Map(keys.map((k) => [k, 0]));
  const count = new Map(keys.map((k) => [k, 0]));
  let total = 0;
  let paidCount = 0;
  const currencies = new Set<string>();
  for (const inv of invoices) {
    if (inv.status !== "paid" || inv.amount_paid <= 0) continue;
    const key = dayKey(new Date(inv.created * 1000));
    revenue.set(key, (revenue.get(key) ?? 0) + inv.amount_paid / 100);
    count.set(key, (count.get(key) ?? 0) + 1);
    total += inv.amount_paid / 100;
    paidCount += 1;
    currencies.add(inv.currency.toUpperCase());
  }

  res.json({
    days,
    currency: [...currencies][0] ?? "USD",
    totals: {
      revenue: cents(total),
      payments: paidCount,
      average: paidCount ? cents(total / paidCount) : 0,
    },
    series: keys.map((date) => ({
      date,
      revenue: cents(revenue.get(date) ?? 0),
      payments: count.get(date) ?? 0,
    })),
    payments: invoices.map((inv) => {
      const customer = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
      const account = accountFor(customer);
      return {
        id: inv.id,
        number: inv.number,
        date: new Date(inv.created * 1000),
        company: account?.name ?? inv.customer_name ?? undefined,
        email: account?.users[0]?.email ?? inv.customer_email ?? undefined,
        description:
          [...inv.lines.data].sort((x, y) => y.amount - x.amount)[0]?.description ??
          inv.description ??
          "Adplaylist subscription",
        reason: inv.billing_reason,
        amount: inv.total / 100,
        amountPaid: inv.amount_paid / 100,
        currency: inv.currency.toUpperCase(),
        status: inv.status,
        receiptUrl: inv.hosted_invoice_url ?? null,
      };
    }),
  });
});

// Every credit movement across all accounts in the range, with daily totals
// of credits granted, used (net of refunds) and expired.
const GRANT_REASONS = ["trial", "refill", "upgrade", "adjustment", "referral"];

router.get("/transactions/credits", async (req, res) => {
  const { days, start, keys } = rangeFrom(req.query);
  const entries = await prisma.creditTransaction.findMany({
    where: { createdAt: { gte: start } },
    orderBy: { id: "desc" },
    include: {
      account: {
        select: {
          name: true,
          users: { where: { accountRole: "owner" }, select: { email: true }, take: 1 },
        },
      },
    },
  });

  const blank = () => new Map(keys.map((k) => [k, 0]));
  const granted = blank();
  const used = blank();
  const expired = blank();
  const add = (map: Map<string, number>, key: string, n: number) =>
    map.set(key, (map.get(key) ?? 0) + n);
  for (const e of entries) {
    const key = dayKey(e.createdAt);
    if (GRANT_REASONS.includes(e.reason)) add(granted, key, e.delta);
    else if (e.reason === "spent" || e.reason === "refunded") add(used, key, -e.delta);
    else if (e.reason === "expired") add(expired, key, -e.delta);
  }
  const sum = (map: Map<string, number>) => [...map.values()].reduce((a, b) => a + b, 0);

  res.json({
    days,
    totals: { granted: sum(granted), used: sum(used), expired: sum(expired), entries: entries.length },
    series: keys.map((date) => ({
      date,
      granted: granted.get(date) ?? 0,
      used: used.get(date) ?? 0,
      expired: expired.get(date) ?? 0,
    })),
    entries: entries.slice(0, 500).map((e) => ({
      id: e.id,
      date: e.createdAt,
      company: e.account.name,
      email: e.account.users[0]?.email,
      reason: e.reason,
      delta: e.delta,
      balance: e.balance,
      note: e.note ?? undefined,
    })),
  });
});

export default router;
