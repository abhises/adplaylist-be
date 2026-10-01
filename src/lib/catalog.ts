// The live price list and keeping Stripe in step with it. Prices start as
// the defaults in plans.ts and are then edited by admins (plan_prices table).
// Stripe prices can't be edited, so a change creates a new Stripe Price that
// takes over the lookup key; subscribers already on the old Price keep it.
import Stripe from "stripe";
import { clearPriceCache, getStripe } from "./billing.js";
import { prisma } from "./prisma.js";
import {
  PLANS,
  PLAN_IDS,
  lookupKey,
  productId,
  productName,
  type BillingCycle,
  type PlanId,
} from "./plans.js";

export type PriceTable = Record<PlanId, Record<number, { monthly: number; yearly: number }>>;

const CYCLES: BillingCycle[] = ["monthly", "yearly"];
const TABLE_CACHE_MS = 60 * 1000;
let cached: { table: PriceTable; at: number } | null = null;

function defaults(): PriceTable {
  return Object.fromEntries(
    PLAN_IDS.map((plan) => [
      plan,
      Object.fromEntries(
        Object.entries(PLANS[plan].prices).map(([v, p]) => [Number(v), { ...p }])
      ),
    ])
  ) as PriceTable;
}

// Prices in cents for every plan and volume: what admins set, falling back
// to the defaults for anything not stored.
export async function getPriceTable(): Promise<PriceTable> {
  if (cached && Date.now() - cached.at < TABLE_CACHE_MS) return cached.table;
  const table = defaults();
  const rows = await prisma.planPrice.findMany();
  for (const row of rows) {
    const tiers = table[row.plan as PlanId];
    if (tiers && row.volume in tiers) {
      tiers[row.volume] = { monthly: row.monthlyCents, yearly: row.yearlyCents };
    }
  }
  cached = { table, at: Date.now() };
  return table;
}

async function ensureProduct(stripe: Stripe, id: string, name: string) {
  try {
    const existing = await stripe.products.retrieve(id);
    if (existing.name !== name || !existing.active) {
      return await stripe.products.update(id, { name, active: true });
    }
    return existing;
  } catch (err) {
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing") {
      return stripe.products.create({ id, name });
    }
    throw err;
  }
}

async function ensurePrice(
  stripe: Stripe,
  product: string,
  key: string,
  amount: number,
  cycle: BillingCycle
) {
  const { data } = await stripe.prices.list({ lookup_keys: [key], limit: 1 });
  const existing = data[0];
  const interval = cycle === "monthly" ? "month" : "year";
  if (
    existing &&
    existing.active &&
    existing.unit_amount === amount &&
    existing.currency === "usd" &&
    existing.recurring?.interval === interval &&
    existing.product === product
  ) {
    return { price: existing, created: false };
  }
  const price = await stripe.prices.create({
    product,
    currency: "usd",
    unit_amount: amount,
    recurring: { interval },
    lookup_key: key,
    transfer_lookup_key: true,
    tax_behavior: "exclusive",
  });
  return { price, created: true };
}

// Makes Stripe match `table`: a Product per plan + volume, a monthly and a
// yearly Price at the table's amounts (new ones only where an amount
// changed), and the customer portal offering exactly those Prices. Returns
// what it did, for the setup script's output. With `only`, just that plan +
// volume is checked one by one; the rest are looked up in bulk (an admin
// saving one price shouldn't wait on all eighteen).
export async function syncStripeCatalog(
  table: PriceTable,
  only?: { plan: PlanId; volume: number }
) {
  const stripe = getStripe();
  const lines: string[] = [];
  const portalProducts: { product: string; prices: string[] }[] = [];

  const known = new Map<string, string>();
  if (only) {
    const keys = PLAN_IDS.flatMap((plan) =>
      Object.keys(table[plan]).flatMap((v) => CYCLES.map((c) => lookupKey(plan, Number(v), c)))
    );
    // Stripe takes up to 10 lookup keys per request.
    for (let i = 0; i < keys.length; i += 10) {
      const { data } = await stripe.prices.list({
        lookup_keys: keys.slice(i, i + 10),
        active: true,
        limit: 10,
      });
      for (const price of data) if (price.lookup_key) known.set(price.lookup_key, price.id);
    }
  }

  for (const plan of PLAN_IDS) {
    for (const [volumeStr, amounts] of Object.entries(table[plan])) {
      const volume = Number(volumeStr);
      if (only && !(only.plan === plan && only.volume === volume)) {
        const ids = CYCLES.map((c) => known.get(lookupKey(plan, volume, c)));
        if (ids.every((id): id is string => !!id)) {
          portalProducts.push({ product: productId(plan, volume), prices: ids });
          continue;
        }
        // Missing in Stripe: fall through and create it.
      }
      const product = await ensureProduct(stripe, productId(plan, volume), productName(plan, volume));
      const prices: string[] = [];
      for (const cycle of CYCLES) {
        const key = lookupKey(plan, volume, cycle);
        const { price, created } = await ensurePrice(stripe, product.id, key, amounts[cycle], cycle);
        prices.push(price.id);
        lines.push(
          `${key.padEnd(34)} ${price.id}  $${(amounts[cycle] / 100).toFixed(2)}${created ? "  (new)" : ""}`
        );
      }
      portalProducts.push({ product: product.id, prices });
    }
  }

  const portalConfig: Stripe.BillingPortal.ConfigurationCreateParams = {
    business_profile: { headline: "Manage your Adplaylist plan" },
    metadata: { app: "adplaylist" },
    features: {
      customer_update: { enabled: true, allowed_updates: ["name", "email", "address", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      // Cancelling keeps the plan until the paid period ends.
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        products: portalProducts,
        // Upgrades are charged (and their credits granted) straight away;
        // lowering the volume or switching to a shorter interval waits for
        // the next billing date.
        proration_behavior: "always_invoice",
        schedule_at_period_end: {
          conditions: [{ type: "decreasing_item_amount" }, { type: "shortening_interval" }],
        },
      },
    },
  };

  const existing = (
    await stripe.billingPortal.configurations.list({ active: true, limit: 100 })
  ).data.find((c) => c.metadata?.app === "adplaylist");
  const config = existing
    ? await stripe.billingPortal.configurations.update(existing.id, portalConfig)
    : await stripe.billingPortal.configurations.create(portalConfig);

  clearPriceCache();
  return { lines, portalConfigurationId: config.id };
}

// Price changes run one at a time, so two saves can't each sync Stripe from
// a table that doesn't include the other's change.
let queue: Promise<unknown> = Promise.resolve();

// An admin's price change: Stripe first, so a failure there leaves the
// stored price (and what the site shows) as it was.
export function setPlanPrice(
  plan: PlanId,
  volume: number,
  cents: { monthly: number; yearly: number },
  adminId: number
): Promise<PriceTable> {
  const run = queue.then(() => applyPlanPrice(plan, volume, cents, adminId));
  queue = run.catch(() => {});
  return run;
}

async function applyPlanPrice(
  plan: PlanId,
  volume: number,
  cents: { monthly: number; yearly: number },
  adminId: number
) {
  cached = null;
  const table = await getPriceTable();
  const next: PriceTable = { ...table, [plan]: { ...table[plan], [volume]: cents } };
  await syncStripeCatalog(next, { plan, volume });
  await prisma.planPrice.upsert({
    where: { plan_volume: { plan, volume } },
    create: {
      plan,
      volume,
      monthlyCents: cents.monthly,
      yearlyCents: cents.yearly,
      updatedById: adminId,
    },
    update: { monthlyCents: cents.monthly, yearlyCents: cents.yearly, updatedById: adminId },
  });
  cached = null;
  return getPriceTable();
}
