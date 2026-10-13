// What things cost in credits, how many credits a trial gets and what a
// referral earns: defaults here, edited by admins (credit_settings table,
// /admin/pricing).
import { prisma } from "./prisma.js";
import { PLAN_IDS, type PlanId } from "./plans.js";

export const CREDIT_COST_KEYS = [
  "image",
  "video",
  "imageRevision",
  "videoRevision",
  "extraSize",
  "canvaEdit",
  "similarDesign",
] as const;
export type CreditCostKey = (typeof CREDIT_COST_KEYS)[number];

// Bonus credits for a referral, given when the referred account first pays.
export const REFERRAL_REWARD_KEYS = ["referrer", "referrerStarter", "friend"] as const;
export type ReferralRewardKey = (typeof REFERRAL_REWARD_KEYS)[number];

export type CreditSettings = {
  costs: Record<CreditCostKey, number>;
  trialCredits: Record<PlanId, number>;
  referralRewards: Record<ReferralRewardKey, number>;
};

export const DEFAULT_CREDIT_SETTINGS: CreditSettings = {
  costs: {
    // A new image ad creative, and a new video ad creative.
    image: 5,
    video: 10,
    // Changes to a delivered creative.
    imageRevision: 2,
    videoRevision: 4,
    // Each size beyond the first.
    extraSize: 1,
    // The one-click requests on an ad's page.
    canvaEdit: 2,
    similarDesign: 5,
  },
  trialCredits: { starter: 5, pro: 10, agency: 10 },
  referralRewards: {
    // To the referrer, when their friend pays for Pro or Agency.
    referrer: 50,
    // To the referrer, when their friend pays for Starter (which is too
    // cheap to carry the full reward).
    referrerStarter: 10,
    // To the friend, on top of their first month's credits.
    friend: 10,
  },
};

const costRow = (key: CreditCostKey) => `cost_${key}`;
const trialRow = (plan: PlanId) => `trial_${plan}`;
const referralRow = (key: ReferralRewardKey) => `referral_${key}`;

const CACHE_MS = 60 * 1000;
let cached: { settings: CreditSettings; at: number } | null = null;

// What admins set, falling back to the defaults for anything not stored.
export async function getCreditSettings(): Promise<CreditSettings> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.settings;
  const stored = new Map(
    (await prisma.creditSetting.findMany()).map((row) => [row.key, row.value])
  );
  const settings: CreditSettings = {
    costs: Object.fromEntries(
      CREDIT_COST_KEYS.map((key) => [
        key,
        stored.get(costRow(key)) ?? DEFAULT_CREDIT_SETTINGS.costs[key],
      ])
    ) as CreditSettings["costs"],
    trialCredits: Object.fromEntries(
      PLAN_IDS.map((plan) => [
        plan,
        stored.get(trialRow(plan)) ?? DEFAULT_CREDIT_SETTINGS.trialCredits[plan],
      ])
    ) as CreditSettings["trialCredits"],
    referralRewards: Object.fromEntries(
      REFERRAL_REWARD_KEYS.map((key) => [
        key,
        stored.get(referralRow(key)) ?? DEFAULT_CREDIT_SETTINGS.referralRewards[key],
      ])
    ) as CreditSettings["referralRewards"],
  };
  cached = { settings, at: Date.now() };
  return settings;
}

// An admin's change. Applies to what's requested (and trials started, and
// referrals rewarded) from now on: requests already made keep the cost they
// were charged.
export async function setCreditSettings(
  changes: {
    costs?: Partial<CreditSettings["costs"]>;
    trialCredits?: Partial<CreditSettings["trialCredits"]>;
    referralRewards?: Partial<CreditSettings["referralRewards"]>;
  },
  adminId: number
) {
  const rows: { key: string; value: number }[] = [
    ...CREDIT_COST_KEYS.filter((key) => changes.costs?.[key] !== undefined).map((key) => ({
      key: costRow(key),
      value: changes.costs![key]!,
    })),
    ...PLAN_IDS.filter((plan) => changes.trialCredits?.[plan] !== undefined).map((plan) => ({
      key: trialRow(plan),
      value: changes.trialCredits![plan]!,
    })),
    ...REFERRAL_REWARD_KEYS.filter((key) => changes.referralRewards?.[key] !== undefined).map(
      (key) => ({ key: referralRow(key), value: changes.referralRewards![key]! })
    ),
  ];
  await prisma.$transaction(
    rows.map(({ key, value }) =>
      prisma.creditSetting.upsert({
        where: { key },
        create: { key, value, updatedById: adminId },
        update: { value, updatedById: adminId },
      })
    )
  );
  cached = null;
  return getCreditSettings();
}
