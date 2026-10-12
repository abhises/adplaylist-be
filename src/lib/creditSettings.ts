// What things cost in credits and how many credits a trial gets: defaults
// here, edited by admins (credit_settings table, /admin/pricing).
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

export type CreditSettings = {
  costs: Record<CreditCostKey, number>;
  trialCredits: Record<PlanId, number>;
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
};

const costRow = (key: CreditCostKey) => `cost_${key}`;
const trialRow = (plan: PlanId) => `trial_${plan}`;

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
  };
  cached = { settings, at: Date.now() };
  return settings;
}

// An admin's change. Applies to what's requested (and trials started) from
// now on: requests already made keep the cost they were charged.
export async function setCreditSettings(
  changes: { costs?: Partial<CreditSettings["costs"]>; trialCredits?: Partial<CreditSettings["trialCredits"]> },
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
