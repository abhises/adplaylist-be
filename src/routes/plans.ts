import { Router } from "express";
import { getPriceTable, type PriceTable } from "../lib/catalog.js";
import { getCreditSettings, type CreditSettings } from "../lib/creditSettings.js";
import { PLANS, PLAN_IDS } from "../lib/plans.js";

const router = Router();

// The public price list (pricing page, billing page), in dollars.
export function toPlansResponse(table: PriceTable, settings: CreditSettings) {
  return PLAN_IDS.map((id) => ({
    id,
    name: PLANS[id].name,
    trialCredits: settings.trialCredits[id],
    maxBrands: PLANS[id].maxBrands,
    maxSeats: PLANS[id].maxSeats,
    turnaround: PLANS[id].turnaround,
    tiers: Object.entries(table[id]).map(([volume, cents]) => ({
      volume: Number(volume),
      monthly: cents.monthly / 100,
      yearly: cents.yearly / 100,
      credits: cents.credits,
    })),
  }));
}

// The plans, what each kind of request costs in credits and what a referral
// earns.
export async function priceListResponse() {
  const settings = await getCreditSettings();
  return {
    plans: toPlansResponse(await getPriceTable(), settings),
    creditCosts: settings.costs,
    referralRewards: settings.referralRewards,
  };
}

router.get("/", async (_req, res) => {
  res.json(await priceListResponse());
});

export default router;
