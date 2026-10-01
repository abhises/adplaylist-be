// Creates the plan catalogue in Stripe: one Product per plan + credit volume
// (9), each with a monthly and a yearly Price (18), and a customer portal
// configuration that lets owners switch between them. Safe to re-run: it
// reuses what's already there and only creates what's missing.
//
//   npm run stripe:setup
//
// Prints the portal configuration id to put in STRIPE_PORTAL_CONFIGURATION.
import "dotenv/config";
import Stripe from "stripe";
import { getStripe } from "../lib/billing.js";
import {
  PLANS,
  PLAN_IDS,
  lookupKey,
  productId,
  productName,
  type BillingCycle,
} from "../lib/plans.js";

const stripe = getStripe();
const CYCLES: BillingCycle[] = ["monthly", "yearly"];

async function ensureProduct(id: string, name: string) {
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

async function ensurePrice(product: string, key: string, amount: number, cycle: BillingCycle) {
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
    return existing;
  }
  // Prices can't be edited, so a changed amount gets a new Price that takes
  // over the lookup key; existing subscribers stay on the old one until
  // they change plan.
  if (existing) console.log(`  replacing ${key} (amount or product changed)`);
  return stripe.prices.create({
    product,
    currency: "usd",
    unit_amount: amount,
    recurring: { interval },
    lookup_key: key,
    transfer_lookup_key: true,
    tax_behavior: "exclusive",
  });
}

const portalProducts: { product: string; prices: string[] }[] = [];

for (const plan of PLAN_IDS) {
  for (const [volumeStr, amounts] of Object.entries(PLANS[plan].prices)) {
    const volume = Number(volumeStr);
    const product = await ensureProduct(productId(plan, volume), productName(plan, volume));
    const prices: string[] = [];
    for (const cycle of CYCLES) {
      const key = lookupKey(plan, volume, cycle);
      const price = await ensurePrice(product.id, key, amounts[cycle], cycle);
      prices.push(price.id);
      console.log(`${key.padEnd(34)} ${price.id}  $${(amounts[cycle] / 100).toFixed(2)}`);
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

const existingConfig = (
  await stripe.billingPortal.configurations.list({ active: true, limit: 100 })
).data.find((c) => c.metadata?.app === "adplaylist");

const config = existingConfig
  ? await stripe.billingPortal.configurations.update(existingConfig.id, portalConfig)
  : await stripe.billingPortal.configurations.create(portalConfig);

console.log(`\nPortal configuration: ${config.id}`);
console.log(`Set STRIPE_PORTAL_CONFIGURATION=${config.id} in .env`);
