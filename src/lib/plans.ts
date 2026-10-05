// The plan catalogue from "Adplaylist – User Types & Plan Rules", with the
// prices from the pricing-page redesign. Prices are in USD cents, excluding
// tax; yearly is the monthly price × 12 less 20%.
// scripts/stripeSetup.ts creates one Stripe Product per plan + volume and a
// monthly and yearly Price for each, keyed by lookupKey() below.

export type PlanId = "starter" | "pro" | "agency";
export type BillingCycle = "monthly" | "yearly";
export type AccountStatus =
  | "trial"
  | "active"
  | "past_due"
  | "cancelled"
  | "expired";

type PlanDef = {
  name: string;
  // Credit volume → price in cents.
  prices: Record<number, { monthly: number; yearly: number }>;
  trialCredits: number;
  maxBrands: number;
  maxSeats: number;
  turnaround: string | null;
};

export const PLANS: Record<PlanId, PlanDef> = {
  starter: {
    name: "Starter",
    prices: { 0: { monthly: 1500, yearly: 14400 } },
    trialCredits: 0,
    maxBrands: 1,
    maxSeats: 1,
    turnaround: null,
  },
  pro: {
    name: "Pro",
    prices: {
      10: { monthly: 4900, yearly: 47040 },
      20: { monthly: 9500, yearly: 91200 },
      30: { monthly: 13900, yearly: 133440 },
      40: { monthly: 17900, yearly: 171840 },
    },
    trialCredits: 2,
    maxBrands: 2,
    maxSeats: 2,
    turnaround: "3 days",
  },
  agency: {
    name: "Agency",
    prices: {
      50: { monthly: 21500, yearly: 206400 },
      70: { monthly: 28900, yearly: 277440 },
      100: { monthly: 39900, yearly: 383040 },
      150: { monthly: 49900, yearly: 479040 },
    },
    trialCredits: 2,
    maxBrands: 5,
    maxSeats: 5,
    turnaround: "48 hours",
  },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];
export const TRIAL_DAYS = 7;
export const PAST_DUE_GRACE_DAYS = 7;

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && value in PLANS;
}

export function isValidVolume(plan: PlanId, volume: number) {
  return volume in PLANS[plan].prices;
}

export function lookupKey(plan: PlanId, volume: number, cycle: BillingCycle) {
  return `adplaylist_${plan}_${volume}_${cycle}`;
}

// Which plan a Stripe price belongs to. Uses the product (whose id is fixed)
// and the billing interval rather than the lookup key, because a price
// change moves the lookup key to a new price — subscribers still on the old
// price must keep being recognised.
export function planOfPrice(price: {
  product: string | { id: string };
  recurring: { interval: string } | null;
}): { plan: PlanId; volume: number; cycle: BillingCycle } | null {
  const product = typeof price.product === "string" ? price.product : price.product.id;
  const m = /^adplaylist_(starter|pro|agency)_(\d+)$/.exec(product);
  const interval = price.recurring?.interval;
  if (!m || (interval !== "month" && interval !== "year")) return null;
  const plan = m[1] as PlanId;
  const volume = Number(m[2]);
  if (!isValidVolume(plan, volume)) return null;
  return { plan, volume, cycle: interval === "month" ? "monthly" : "yearly" };
}

// Product ids are fixed so the setup script can find what it made before.
export function productId(plan: PlanId, volume: number) {
  return `adplaylist_${plan}_${volume}`;
}

export function productName(plan: PlanId, credits: number) {
  return plan === "starter"
    ? "Adplaylist Starter"
    : `Adplaylist ${PLANS[plan].name} – ${credits} credits/month`;
}

// What an account may do right now, from its plan and status. Staff (no
// account) get everything; they're checked by role elsewhere.
export type Entitlements = {
  save: boolean;
  // Downloading creatives without the watermark (paid plans). Anyone signed
  // in can download; without this they get the watermarked copy.
  cleanDownload: boolean;
  editableCopies: boolean;
  requests: boolean;
  videoRequests: boolean;
  brandKit: boolean;
};

export const ALL_ENTITLEMENTS: Entitlements = {
  save: true,
  cleanDownload: true,
  editableCopies: true,
  requests: true,
  videoRequests: true,
  brandKit: true,
};

export function entitlementsFor(plan: PlanId, status: AccountStatus): Entitlements {
  if (status === "expired") {
    return {
      save: false,
      cleanDownload: false,
      editableCopies: false,
      requests: false,
      videoRequests: false,
      brandKit: false,
    };
  }
  return {
    save: true,
    // Paid: active, in the past-due grace period, or cancelled but still in
    // a paid period (see entitlementsOf for a trial cancelled before paying).
    cleanDownload: status !== "trial",
    editableCopies: plan !== "starter",
    requests: plan !== "starter",
    videoRequests: plan === "agency",
    brandKit: plan === "agency",
  };
}
