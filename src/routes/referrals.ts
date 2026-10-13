import { Router } from "express";
import { getCreditSettings } from "../lib/creditSettings.js";
import { prisma } from "../lib/prisma.js";
import {
  REFERRAL_YEARLY_CAP,
  ensureReferralCode,
  referralLink,
  reverseReferral,
  shortName,
} from "../lib/referrals.js";
import {
  loadAccount,
  requireAuth,
  requireRole,
  type AuthedRequest,
} from "../middleware/auth.js";
import { validateParams } from "../middleware/validate.js";
import { idParamSchema } from "../validation/schemas.js";

const router = Router();

// The "Refer a friend" page: the account's link, what a referral earns, and
// everyone who signed up through it. Credits are shared by the company, so
// every member can see this. Staff have no account, so no link.
router.get("/", requireAuth, loadAccount, async (req: AuthedRequest, res) => {
  const account = req.account;
  if (!account) return res.json({ referral: null });

  const code = await ensureReferralCode(account);
  const [{ referralRewards }, rows] = await Promise.all([
    getCreditSettings(),
    prisma.referral.findMany({
      where: { referrerAccountId: account.id },
      orderBy: { id: "desc" },
      include: { referred: { select: { name: true } } },
    }),
  ]);
  // A referral an admin stopped before it paid out is nobody's business.
  const shown = rows.filter((r) => r.status !== "cancelled");

  res.json({
    referral: {
      code,
      link: referralLink(code),
      rewards: referralRewards,
      yearlyCap: REFERRAL_YEARLY_CAP,
      // Bonus credits only go to an account on an active paid plan; until
      // then they wait.
      canEarn: account.status === "active",
      totals: {
        signedUp: shown.length,
        rewarded: shown.filter((r) => r.status === "rewarded").length,
        credits: shown
          .filter((r) => r.status === "rewarded")
          .reduce((sum, r) => sum + r.referrerCredits, 0),
      },
      referrals: shown.map((r) => ({
        id: r.id,
        name: shortName(r.referred.name),
        status: r.status,
        credits: r.status === "rewarded" ? r.referrerCredits : 0,
        createdAt: r.createdAt,
        rewardedAt: r.rewardedAt,
      })),
    },
  });
});

// Whether a code from a link is real, and what the friend gets, for the
// sign-up page's "You've been invited" note. Says nothing about whose it is.
router.get("/check/:code", async (req, res) => {
  const code = String(req.params.code).trim().toUpperCase();
  const valid =
    /^[A-Z0-9]{6,12}$/.test(code) &&
    !!(await prisma.account.findUnique({ where: { referralCode: code }, select: { id: true } }));
  const { referralRewards } = await getCreditSettings();
  res.json({ valid, friendCredits: valid ? referralRewards.friend : 0 });
});

const ACCOUNT_SELECT = {
  id: true,
  name: true,
  plan: true,
  status: true,
  users: { where: { accountRole: "owner" }, select: { email: true }, take: 1 },
} as const;

// Admin → Referrals: every referral, newest first.
router.get("/admin", requireAuth, requireRole("admin"), async (_req, res) => {
  const rows = await prisma.referral.findMany({
    orderBy: { id: "desc" },
    include: { referrer: { select: ACCOUNT_SELECT }, referred: { select: ACCOUNT_SELECT } },
  });
  const side = (a: (typeof rows)[number]["referrer"]) => ({
    id: a.id,
    name: a.name,
    email: a.users[0]?.email ?? null,
    plan: a.plan,
    status: a.status,
  });
  res.json({
    referrals: rows.map((r) => ({
      id: r.id,
      referrer: side(r.referrer),
      referred: side(r.referred),
      status: r.status,
      note: r.note,
      referrerCredits: r.referrerCredits,
      referredCredits: r.referredCredits,
      createdAt: r.createdAt,
      rewardedAt: r.rewardedAt,
    })),
  });
});

// Stops a referral that looks like abuse: one that hasn't paid out is
// cancelled, and a rewarded one has its credits taken back from both sides.
router.post(
  "/admin/:id/reverse",
  requireAuth,
  requireRole("admin"),
  validateParams(idParamSchema),
  async (req, res) => {
    const reversed = await reverseReferral(Number(req.params.id), "Reversed by an admin");
    if (!reversed) {
      return res.status(409).json({ error: "This referral can't be reversed any more." });
    }
    res.json({ reversed: true });
  }
);

export default router;
