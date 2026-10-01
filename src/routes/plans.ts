import { Router } from "express";
import { getPriceTable, type PriceTable } from "../lib/catalog.js";
import { PLANS, PLAN_IDS } from "../lib/plans.js";

const router = Router();

// The public price list (pricing page, billing page), in dollars.
export function toPlansResponse(table: PriceTable) {
  return PLAN_IDS.map((id) => ({
    id,
    name: PLANS[id].name,
    trialCredits: PLANS[id].trialCredits,
    maxBrands: PLANS[id].maxBrands,
    maxSeats: PLANS[id].maxSeats,
    turnaround: PLANS[id].turnaround,
    tiers: Object.entries(table[id]).map(([volume, cents]) => ({
      volume: Number(volume),
      monthly: cents.monthly / 100,
      yearly: cents.yearly / 100,
    })),
  }));
}

router.get("/", async (_req, res) => {
  res.json({ plans: toPlansResponse(await getPriceTable()) });
});

export default router;
