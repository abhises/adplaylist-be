import express, { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import { Prisma } from "../generated/prisma/client.js";
import {
  getStripe,
  handleInvoicePaid,
  priceIdFor,
  refreshFromStripe,
  syncSubscription,
  toAccountResponse,
} from "../lib/billing.js";
import { prisma } from "../lib/prisma.js";
import {
  loadAccount,
  requireAccountOwner,
  requireAuth,
  type AuthedRequest,
} from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { checkoutSchema, checkoutReturnSchema } from "../validation/schemas.js";

const router = Router();

// Tags our Checkout Sessions in the Stripe Dashboard.
const INTEGRATION_IDENTIFIER = "adplaylist_plans_kqvmzrta";
// Stripe needs a Checkout trial to end at least 48 hours out; with less of
// the app trial left than this, checkout charges straight away instead.
const MIN_CHECKOUT_TRIAL_MS = 49 * 60 * 60 * 1000;

function frontendUrl() {
  return (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
}

router.get("/", requireAuth, loadAccount, (req: AuthedRequest, res) => {
  res.json({
    account: req.account ? toAccountResponse(req.account, req.accountRole ?? null) : null,
  });
});

// Starts a subscription through Stripe Checkout. Changing an existing
// subscription goes through the customer portal instead (POST /portal),
// which handles proration and end-of-period downgrades.
router.post(
  "/checkout",
  requireAuth,
  loadAccount,
  requireAccountOwner,
  validateBody(checkoutSchema),
  async (req: AuthedRequest, res) => {
    const account = req.account!;
    const { plan, volume, cycle } = req.body;
    const stripe = getStripe();

    // An account that expired after its grace period still has the unpaid
    // subscription in Stripe. End it so subscribing afresh isn't blocked.
    if (account.status === "expired" && account.stripeSubscriptionId) {
      await stripe.subscriptions.cancel(account.stripeSubscriptionId).catch(() => {});
      account.stripeSubscriptionId = null;
      await prisma.account.update({
        where: { id: account.id },
        data: { stripeSubscriptionId: null },
      });
    }

    if (account.stripeSubscriptionId) {
      return res.status(409).json({
        error: "You already have a subscription. Change it from Manage billing.",
        usePortal: true,
      });
    }

    let customerId = account.stripeCustomerId;
    if (!customerId) {
      const user = await prisma.user.findUnique({ where: { id: req.userId! } });
      const customer = await stripe.customers.create({
        ...(user ? { email: user.email } : {}),
        name: account.name,
        metadata: { account_id: String(account.id) },
      });
      customerId = customer.id;
      await prisma.account.update({
        where: { id: account.id },
        data: { stripeCustomerId: customerId },
      });
    }

    // Subscribing during the trial keeps the trial: the card is saved now and
    // first charged when the trial ends (day 8). After it, pay straight away.
    const trialEnd =
      account.status === "trial" &&
      account.trialEndsAt &&
      account.trialEndsAt.getTime() - Date.now() > MIN_CHECKOUT_TRIAL_MS
        ? Math.floor(account.trialEndsAt.getTime() / 1000)
        : undefined;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: String(account.id),
      line_items: [{ price: await priceIdFor(plan, volume, cycle), quantity: 1 }],
      subscription_data: {
        ...(trialEnd ? { trial_end: trialEnd } : {}),
        metadata: { account_id: String(account.id) },
      },
      integration_identifier: INTEGRATION_IDENTIFIER,
      success_url: `${frontendUrl()}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl()}/billing?checkout=cancelled`,
    });

    res.json({ url: session.url });
  }
);

// Called by the billing page when Stripe redirects back, so the new plan
// shows immediately even if the webhook hasn't arrived yet. The webhook
// does the same work; both are safe to run.
router.post(
  "/checkout/return",
  requireAuth,
  loadAccount,
  requireAccountOwner,
  validateBody(checkoutReturnSchema),
  async (req: AuthedRequest, res) => {
    const account = req.account!;
    const session = await getStripe().checkout.sessions.retrieve(req.body.sessionId, {
      expand: ["invoice"],
    });
    const customerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id;
    if (!customerId || customerId !== account.stripeCustomerId) {
      return res.status(404).json({ error: "Checkout session not found" });
    }
    await fulfilCheckout(session);
    const updated = await prisma.account.findUnique({ where: { id: account.id } });
    res.json({ account: toAccountResponse(updated!, req.accountRole ?? null) });
  }
);

// The account's credit history and lifetime totals. Credits are shared, so
// every member can see this, not just the owner.
router.get("/credits", requireAuth, loadAccount, async (req: AuthedRequest, res) => {
  const account = req.account;
  if (!account) return res.json({ totals: null, entries: [] });

  const [sums, entries] = await Promise.all([
    prisma.creditTransaction.groupBy({
      by: ["reason"],
      where: { accountId: account.id },
      _sum: { delta: true },
    }),
    prisma.creditTransaction.findMany({
      where: { accountId: account.id },
      orderBy: { id: "desc" },
      take: 100,
    }),
  ]);
  const sum = (reason: string) => sums.find((s) => s.reason === reason)?._sum.delta ?? 0;

  res.json({
    totals: {
      // Everything ever granted: trial, monthly refills, upgrades, and any
      // balance carried in from before the ledger existed.
      received: sum("trial") + sum("refill") + sum("upgrade") + sum("adjustment"),
      // Spent on requests, less those refunded when a request was declined.
      used: -(sum("spent") + sum("refunded")),
      // Unused credits that reset at a refill or when the plan ended.
      expired: -sum("expired"),
      available: account.credits,
    },
    entries: entries.map((e) => ({
      id: e.id,
      reason: e.reason,
      delta: e.delta,
      balance: e.balance,
      note: e.note,
      createdAt: e.createdAt,
    })),
  });
});

// The account's payments, straight from Stripe's invoices — including the
// $0 invoice that starts a trial, so it's clear nothing was charged yet.
router.get(
  "/payments",
  requireAuth,
  loadAccount,
  requireAccountOwner,
  async (req: AuthedRequest, res) => {
    const customer = req.account!.stripeCustomerId;
    if (!customer) return res.json({ payments: [] });
    const { data } = await getStripe().invoices.list({ customer, limit: 50 });

    // Credits each invoice granted (trial start, refill or upgrade).
    const grants = await prisma.creditTransaction.groupBy({
      by: ["stripeInvoiceId"],
      where: {
        accountId: req.account!.id,
        stripeInvoiceId: { in: data.map((inv) => inv.id).filter((id): id is string => !!id) },
        delta: { gt: 0 },
      },
      _sum: { delta: true },
    });
    const creditsFor = (id: string | undefined) =>
      grants.find((g) => g.stripeInvoiceId === id)?._sum.delta ?? 0;

    // The next charge, so a trial's $0 invoice isn't mistaken for the price.
    // None once the subscription is cancelled or gone.
    let upcoming = null;
    const subscription = req.account!.stripeSubscriptionId;
    if (subscription && ["trial", "active", "past_due"].includes(req.account!.status)) {
      try {
        const preview = await getStripe().invoices.createPreview({ customer, subscription });
        upcoming = {
          // When the subscription next bills: the trial's end, or renewal.
          date:
            req.account!.status === "trial"
              ? req.account!.trialEndsAt
              : req.account!.currentPeriodEnd,
          amount: preview.amount_due / 100,
          currency: preview.currency.toUpperCase(),
          description:
            [...preview.lines.data].sort((x, y) => y.amount - x.amount)[0]?.description ??
            "Adplaylist subscription",
        };
      } catch (err) {
        console.warn("[billing] couldn't preview the next invoice", err);
      }
    }

    res.json({
      upcoming,
      payments: data
        .filter((inv) => inv.status !== "draft")
        .map((inv) => ({
          id: inv.id,
          number: inv.number,
          date: new Date(inv.created * 1000),
          // The line for what was bought, not a proration credit for
          // unused time on the old plan.
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
          pdfUrl: inv.invoice_pdf ?? null,
          credits: creditsFor(inv.id),
        })),
    });
  }
);

// Ends the free trial now: charges the card on file today and grants the
// plan's full monthly credits, for a trial that's used its credits and
// wants to keep going. If the charge fails the trial carries on unchanged.
router.post(
  "/start-now",
  requireAuth,
  loadAccount,
  requireAccountOwner,
  async (req: AuthedRequest, res) => {
    const account = req.account!;
    if (account.status !== "trial" || !account.stripeSubscriptionId) {
      return res.status(409).json({ error: "Only an active free trial can be started early." });
    }
    try {
      await getStripe().subscriptions.update(account.stripeSubscriptionId, {
        trial_end: "now",
        // Fail outright on a declined card rather than leaving the
        // subscription past due.
        payment_behavior: "error_if_incomplete",
      });
    } catch (err) {
      if (err instanceof Stripe.errors.StripeCardError) {
        return res.status(402).json({
          error: "Your card was declined. Update it in Manage billing and try again.",
        });
      }
      throw err;
    }
    const updated = await refreshFromStripe(account);
    res.json({ account: toAccountResponse(updated, req.accountRole ?? null) });
  }
);

// Re-reads the subscription from Stripe. The billing page calls this when it
// opens, so a change made in the portal shows even if its webhook is late.
router.post("/sync", requireAuth, loadAccount, async (req: AuthedRequest, res) => {
  if (!req.account) return res.json({ account: null });
  const account = await refreshFromStripe(req.account);
  res.json({ account: toAccountResponse(account, req.accountRole ?? null) });
});

// Opens the Stripe customer portal: change plan or volume, update the card,
// cancel or resubscribe, and see invoices.
router.post(
  "/portal",
  requireAuth,
  loadAccount,
  requireAccountOwner,
  async (req: AuthedRequest, res) => {
    const account = req.account!;
    if (!account.stripeCustomerId) {
      return res.status(409).json({ error: "Choose a plan first." });
    }
    const session = await getStripe().billingPortal.sessions.create({
      customer: account.stripeCustomerId,
      return_url: `${frontendUrl()}/billing`,
      ...(process.env.STRIPE_PORTAL_CONFIGURATION
        ? { configuration: process.env.STRIPE_PORTAL_CONFIGURATION }
        : {}),
    });
    res.json({ url: session.url });
  }
);

async function fulfilCheckout(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription" || !session.subscription) return;
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  await syncSubscription(subscriptionId);
  // A checkout that charged straight away (no trial) also refills credits.
  const invoice = session.invoice;
  if (invoice && typeof invoice !== "string" && invoice.status === "paid") {
    await handleInvoicePaid(invoice);
  }
}

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = await getStripe().checkout.sessions.retrieve(event.data.object.id, {
        expand: ["invoice"],
      });
      await fulfilCheckout(session);
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      await syncSubscription(event.data.object.id);
      break;
    // Payloads follow the webhook endpoint's API version, which can be older
    // than the SDK's (invoices moved `subscription` under `parent`), so the
    // invoice is re-fetched in the SDK's version rather than read from the
    // event.
    case "invoice.paid": {
      const id = event.data.object.id;
      if (id) await handleInvoicePaid(await getStripe().invoices.retrieve(id));
      break;
    }
    case "invoice.payment_failed": {
      const id = event.data.object.id;
      if (!id) break;
      const invoice = await getStripe().invoices.retrieve(id);
      const subRef = invoice.parent?.subscription_details?.subscription;
      if (subRef) await syncSubscription(typeof subRef === "string" ? subRef : subRef.id);
      break;
    }
  }
}

// Mounted in index.ts ahead of express.json(): signature checking needs the
// raw request body.
export const webhookHandler = [
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const signature = req.headers["stripe-signature"];
    if (!secret || typeof signature !== "string") {
      return res.status(400).json({ error: "Missing webhook signature" });
    }

    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(req.body, signature, secret);
    } catch {
      return res.status(400).json({ error: "Invalid webhook signature" });
    }

    // Record the event first so a redelivery is skipped; forget it again if
    // handling fails, so Stripe's retry gets another go.
    try {
      await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return res.json({ received: true, duplicate: true });
      }
      throw err;
    }

    try {
      await handleEvent(event);
    } catch (err) {
      await prisma.stripeEvent.delete({ where: { id: event.id } }).catch(() => {});
      console.error(`[billing] failed to handle ${event.type} ${event.id}`, err);
      return res.status(500).json({ error: "Webhook handling failed" });
    }
    res.json({ received: true });
  },
];

export default router;
