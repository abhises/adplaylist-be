import Stripe from "stripe";
import type { Account, Prisma, User } from "../generated/prisma/client.js";
import { prisma } from "./prisma.js";
import {
  ALL_ENTITLEMENTS,
  PAST_DUE_GRACE_DAYS,
  PLANS,
  entitlementsFor,
  isPlanId,
  lookupKey,
  planOfPrice,
  type AccountStatus,
  type BillingCycle,
  type Entitlements,
  type PlanId,
} from "./plans.js";

const DAY_MS = 24 * 60 * 60 * 1000;

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  client = new Stripe(key);
  return client;
}

// Lookup key → price id. Kept briefly rather than for the process's life, so
// re-running stripe:setup with new prices takes effect without a restart.
const PRICE_CACHE_MS = 5 * 60 * 1000;
const priceIds = new Map<string, { id: string; at: number }>();

// Called after prices change in Stripe, so checkout uses the new ones now.
export function clearPriceCache() {
  priceIds.clear();
}

// Prices are found by lookup key (set by scripts/stripeSetup.ts) rather than
// hard-coded ids, so test and live accounts need no code or env changes.
export async function priceIdFor(plan: PlanId, volume: number, cycle: BillingCycle) {
  const key = lookupKey(plan, volume, cycle);
  const cached = priceIds.get(key);
  if (cached && Date.now() - cached.at < PRICE_CACHE_MS) return cached.id;
  const { data } = await getStripe().prices.list({
    lookup_keys: [key],
    active: true,
    limit: 1,
  });
  if (!data[0]) {
    throw new Error(`No active Stripe price with lookup key ${key}; run npm run stripe:setup`);
  }
  priceIds.set(key, { id: data[0].id, at: Date.now() });
  return data[0].id;
}

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function fromUnix(seconds: number | null | undefined) {
  return seconds ? new Date(seconds * 1000) : null;
}

const EXPIRED = { status: "expired", credits: 0, nextRefillAt: null } as const;

// --- Credit ledger -------------------------------------------------------

export type CreditReason =
  | "trial"
  | "refill"
  | "upgrade"
  | "spent"
  | "refunded"
  | "expired"
  | "adjustment";

type Grant = {
  reason: CreditReason;
  note: string;
  topUp?: boolean;
  // The Stripe invoice behind the grant, shown against that payment.
  invoiceId?: string | null;
};

function planLabel(plan: string, volume: number) {
  const name = isPlanId(plan) ? PLANS[plan].name : plan;
  return volume ? `${name} ${volume}` : name;
}

// Records a change of balance from `before` to `after`. Credits don't roll
// over, so a grant that replaces the balance (refill, upgrade, new trial) is
// logged as the unused credits expiring and then the new grant — that way
// received, used and expired totals always add up to the balance. A top-up
// adds to the balance instead.
async function logBalanceChange(
  tx: Prisma.TransactionClient,
  accountId: number,
  before: number,
  after: number,
  grant?: Grant
) {
  const entries: Omit<Prisma.CreditTransactionCreateManyInput, "accountId">[] = [];
  if (grant?.topUp) {
    entries.push({
      reason: grant.reason,
      delta: after - before,
      balance: after,
      note: grant.note,
      stripeInvoiceId: grant.invoiceId ?? null,
    });
  } else {
    if (before > 0) {
      entries.push({
        reason: "expired",
        delta: -before,
        balance: 0,
        note: grant ? "Unused credits reset" : "Plan ended",
      });
    }
    if (grant && after > 0) {
      entries.push({
        reason: grant.reason,
        delta: after,
        balance: after,
        note: grant.note,
        stripeInvoiceId: grant.invoiceId ?? null,
      });
    }
  }
  if (entries.length) {
    await tx.creditTransaction.createMany({ data: entries.map((e) => ({ ...e, accountId })) });
  }
}

// Updates an account and, if its credits change, records why — in one
// transaction so the ledger can't drift from the balance.
async function updateAccount(account: Account, data: Partial<Account>, grant?: Grant) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.account.update({ where: { id: account.id }, data });
    if (updated.credits !== account.credits) {
      await logBalanceChange(tx, account.id, account.credits, updated.credits, grant);
    }
    return updated;
  });
}

// Applies the time-based transitions that no webhook announces — the
// past-due grace period ending, a cancelled
// plan reaching its end date — and the monthly refill on yearly plans.
// Called whenever an account is loaded, so state is right without a cron.
export async function refreshAccount(account: Account): Promise<Account> {
  const now = new Date();
  let data: Partial<Account> | null = null;

  // (A trial with no card hasn't started yet: it begins, for TRIAL_DAYS,
  // when the owner adds a card at checkout, so it doesn't run out here.)
  if (
    account.status === "past_due" &&
    account.pastDueSince &&
    account.pastDueSince.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS <= now.getTime()
  ) {
    data = EXPIRED;
  } else if (
    account.status === "cancelled" &&
    account.currentPeriodEnd &&
    account.currentPeriodEnd <= now
  ) {
    data = EXPIRED;
  } else if (
    account.status === "active" &&
    account.billingCycle === "yearly" &&
    account.nextRefillAt &&
    account.nextRefillAt <= now
  ) {
    // Credits don't roll over: a refill resets the balance to the volume.
    let next = account.nextRefillAt;
    while (next <= now) next = addMonths(next, 1);
    return updateAccount(
      account,
      { credits: account.creditVolume, nextRefillAt: next },
      { reason: "refill", note: `Monthly credits · ${planLabel(account.plan, account.creditVolume)}` }
    );
  }

  if (!data) return account;
  return updateAccount(account, data);
}

export async function loadAccountForUser(
  userId: number
): Promise<{ user: User; account: Account | null } | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { account: true },
  });
  if (!user) return null;
  const { account, ...rest } = user;
  return { user: rest, account: account ? await refreshAccount(account) : null };
}

// Staff (no account) can do everything their role allows.
export function entitlementsOf(account: Account | null): Entitlements {
  if (!account) return ALL_ENTITLEMENTS;
  const plan = isPlanId(account.plan) ? account.plan : "starter";
  // The free trial needs a card on file (a Stripe subscription) before
  // anything unlocks; until then the account can only browse, like expired.
  if (needsCard(account)) return entitlementsFor(plan, "expired");
  const entitlements = entitlementsFor(plan, account.status as AccountStatus);
  // A trial cancelled before paying never became a paid plan.
  return cancelledInTrial(account) ? { ...entitlements, cleanDownload: false } : entitlements;
}

// A trial without a card yet: sign-up creates the account, but the trial only
// unlocks once the owner adds a card through Stripe Checkout.
export function needsCard(account: Account) {
  return account.status === "trial" && !account.stripeSubscriptionId;
}

// A trial that was cancelled: it ends when the trial would have, unpaid.
function cancelledInTrial(account: Account) {
  return (
    account.status === "cancelled" &&
    !!account.trialEndsAt &&
    !!account.currentPeriodEnd &&
    account.currentPeriodEnd.getTime() <= account.trialEndsAt.getTime()
  );
}

export function toAccountResponse(account: Account, accountRole: string | null) {
  const plan = isPlanId(account.plan) ? account.plan : "starter";
  const def = PLANS[plan];
  return {
    id: account.id,
    name: account.name,
    plan,
    planName: def.name,
    creditVolume: account.creditVolume,
    billingCycle: account.billingCycle,
    status: account.status,
    trialEndsAt: account.trialEndsAt,
    currentPeriodEnd: account.currentPeriodEnd,
    pastDueSince: account.pastDueSince,
    graceEndsAt: account.pastDueSince
      ? new Date(account.pastDueSince.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS)
      : null,
    credits: account.credits,
    // What this period's credits started from: the trial allowance during a
    // trial, the monthly volume otherwise, and nothing once expired.
    creditTotal:
      account.status === "expired"
        ? 0
        : account.status === "trial" || cancelledInTrial(account)
          ? def.trialCredits
          : account.creditVolume,
    // Monthly plans refill on renewal; yearly ones on nextRefillAt.
    nextRefillAt:
      account.billingCycle === "yearly" ? account.nextRefillAt : account.currentPeriodEnd,
    hasSubscription: !!account.stripeSubscriptionId,
    needsCard: needsCard(account),
    cancelledInTrial: cancelledInTrial(account),
    maxBrands: def.maxBrands,
    maxSeats: def.maxSeats,
    turnaround: def.turnaround,
    role: accountRole ?? "member",
    entitlements: entitlementsOf(account),
  };
}

// --- Credits -------------------------------------------------------------

// Takes one credit if the account has any, returning the ledger entry's id
// (null if there were none). The decrement is a conditional UPDATE so two
// requests submitted at once can't both spend the last credit.
export async function spendCredit(accountId: number, note: string) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.account.updateMany({
      where: { id: accountId, credits: { gte: 1 } },
      data: { credits: { decrement: 1 } },
    });
    if (count !== 1) return null;
    const { credits } = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
    const entry = await tx.creditTransaction.create({
      data: { accountId, reason: "spent", delta: -1, balance: credits, note },
    });
    return entry.id;
  });
}

async function giveBack(tx: Prisma.TransactionClient, accountId: number, note: string, requestId?: number) {
  const { credits } = await tx.account.update({
    where: { id: accountId },
    data: { credits: { increment: 1 } },
  });
  await tx.creditTransaction.create({
    data: { accountId, reason: "refunded", delta: 1, balance: credits, note, requestId: requestId ?? null },
  });
}

export async function refundCredit(accountId: number, note: string) {
  await prisma.$transaction((tx) => giveBack(tx, accountId, note));
}

// Gives a declined request's credit back. Clearing creditCharged in the same
// conditional update means declining twice refunds once.
export async function refundRequestCredit(requestId: number) {
  await prisma.$transaction(async (tx) => {
    const request = await tx.creativeRequest.findUnique({ where: { id: requestId } });
    if (!request?.accountId) return;
    const { count } = await tx.creativeRequest.updateMany({
      where: { id: requestId, creditCharged: true },
      data: { creditCharged: false },
    });
    if (count === 1) {
      await giveBack(tx, request.accountId, `Request declined: ${request.title}`, requestId);
    }
  });
}

// --- Stripe → account sync -------------------------------------------------

function mapStatus(sub: Stripe.Subscription): AccountStatus | null {
  const cancelling = sub.cancel_at_period_end || !!sub.cancel_at;
  switch (sub.status) {
    // Cancelling during a trial ends it at the trial's end with no charge,
    // so it shows as cancelled (with that end date), not as a trial that's
    // about to bill.
    case "trialing":
      return cancelling ? "cancelled" : "trial";
    case "active":
      return cancelling ? "cancelled" : "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
    case "paused":
      return "expired";
    default:
      // "incomplete": the first payment hasn't gone through yet. Leave the
      // account as it was until it does or fails.
      return null;
  }
}

async function accountForCustomer(customer: Stripe.Subscription["customer"]) {
  const customerId = typeof customer === "string" ? customer : customer.id;
  return prisma.account.findUnique({ where: { stripeCustomerId: customerId } });
}

// Copies a subscription's plan, status and dates onto its account. Always
// re-fetches the subscription first, so out-of-order or stale webhook
// payloads can't roll the account back to an older state.
export async function syncSubscription(subscriptionId: string): Promise<Account | null> {
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  const account = await accountForCustomer(sub.customer);
  if (!account) {
    console.warn(`[billing] no account for Stripe customer of ${sub.id}`);
    return null;
  }

  // An older subscription that's ended after the account moved on to a new
  // one mustn't overwrite the new one's state.
  if (account.stripeSubscriptionId && account.stripeSubscriptionId !== sub.id) {
    const live = ["trialing", "active", "past_due"].includes(sub.status);
    if (!live) return account;
  }

  const status = mapStatus(sub);
  if (!status) return account;

  const item = sub.items.data[0];
  const parsed = item ? planOfPrice(item.price) : null;
  if (!item || !parsed) {
    console.warn(`[billing] ${sub.id} has a price that isn't an Adplaylist plan`);
    return account;
  }
  const { plan, volume, cycle } = parsed;

  if (status === "expired") {
    return updateAccount(account, {
      ...EXPIRED,
      stripeSubscriptionId: null,
      pastDueSince: null,
      currentPeriodEnd: fromUnix(sub.ended_at) ?? new Date(),
    });
  }

  const data: Partial<Account> = {
    plan,
    creditVolume: volume,
    billingCycle: cycle,
    status,
    stripeSubscriptionId: sub.id,
    currentPeriodEnd:
      status === "cancelled"
        ? fromUnix(sub.cancel_at) ?? fromUnix(item.current_period_end)
        : fromUnix(item.current_period_end),
    pastDueSince: status === "past_due" ? account.pastDueSince ?? new Date() : null,
  };
  let grant: Grant | undefined;

  if (status === "trial") {
    data.trialEndsAt = fromUnix(sub.trial_end);
    // A trial with a card gets the plan's trial credits (2 for Pro and
    // Agency, 0 for Starter) when it starts. Moving to a plan with more
    // trial credits mid-trial tops up the difference, so switching plans
    // can't be used to reset spent credits.
    const note = `Trial credits · ${planLabel(plan, volume)}`;
    const invoiceId =
      typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id ?? null;
    if (account.stripeSubscriptionId !== sub.id) {
      data.credits = PLANS[plan].trialCredits;
      grant = { reason: "trial", note, invoiceId };
    } else if (account.plan !== plan && isPlanId(account.plan)) {
      const extra = PLANS[plan].trialCredits - PLANS[account.plan].trialCredits;
      if (extra > 0) {
        data.credits = account.credits + extra;
        grant = { reason: "trial", note, topUp: true, invoiceId };
      }
    }
  }
  // Paid credits (refills and upgrades) come only from paid invoices, in
  // handleInvoicePaid, so each is granted exactly once whichever webhook
  // arrives first.

  return updateAccount(account, data, grant);
}

// A paid invoice is what refills credits — so a past-due account gets none
// until it pays. The $0 invoice that opens a trial doesn't count.
export async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const subRef = invoice.parent?.subscription_details?.subscription;
  if (!subRef) return;
  const subscriptionId = typeof subRef === "string" ? subRef : subRef.id;

  const account = await syncSubscription(subscriptionId);
  if (!account || account.status === "expired") return;
  if (account.lastRefillInvoiceId === invoice.id) return;

  const isTrialStart =
    invoice.billing_reason === "subscription_create" && invoice.amount_paid === 0;
  const isRenewal = invoice.billing_reason === "subscription_cycle";
  // `total`, not amount_paid: an upgrade paid from the customer's Stripe
  // balance still counts.
  if (isTrialStart || (!isRenewal && invoice.total <= 0)) return;
  // A mid-cycle upgrade is invoiced as prorations; label its grant as an
  // upgrade. Anything else (renewal, trial ending) is the monthly refill.
  const isUpgrade = invoice.lines.data.some(
    (line) => line.parent?.subscription_item_details?.proration
  );

  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  const periodStart = fromUnix(sub.items.data[0]?.current_period_start) ?? new Date();

  // Conditional on the invoice id so two deliveries racing each other can't
  // both refill.
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.account.updateMany({
      where: {
        id: account.id,
        OR: [{ lastRefillInvoiceId: null }, { lastRefillInvoiceId: { not: invoice.id } }],
      },
      data: {
        credits: account.creditVolume,
        lastRefillInvoiceId: invoice.id,
        nextRefillAt:
          account.billingCycle === "yearly"
            ? account.nextRefillAt && account.nextRefillAt > new Date() && !isRenewal
              ? account.nextRefillAt
              : addMonths(periodStart, 1)
            : null,
      },
    });
    if (count === 1) {
      const label = planLabel(account.plan, account.creditVolume);
      await logBalanceChange(
        tx,
        account.id,
        account.credits,
        account.creditVolume,
        isUpgrade
          ? { reason: "upgrade", note: `Upgraded to ${label}`, invoiceId: invoice.id }
          : { reason: "refill", note: `Monthly credits · ${label}`, invoiceId: invoice.id }
      );
    }
  });
}

// Pulls the account's current subscription and latest invoice straight from
// Stripe. Webhooks normally keep the account current; this covers a late or
// missed one (e.g. right after the customer returns from the portal). Safe
// to run any number of times: credit grants are idempotent.
export async function refreshFromStripe(account: Account): Promise<Account> {
  if (!account.stripeCustomerId) return account;
  const stripe = getStripe();

  let subscriptionId = account.stripeSubscriptionId;
  if (!subscriptionId) {
    // A checkout whose webhook never arrived: find the customer's newest
    // live subscription.
    const { data } = await stripe.subscriptions.list({
      customer: account.stripeCustomerId,
      status: "all",
      limit: 5,
    });
    subscriptionId =
      data.find((s) => ["trialing", "active", "past_due"].includes(s.status))?.id ?? null;
    if (!subscriptionId) return account;
  }

  await syncSubscription(subscriptionId);
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice"] });
  const invoice = sub.latest_invoice;
  if (invoice && typeof invoice !== "string" && invoice.status === "paid") {
    await handleInvoicePaid(invoice);
  }
  return (await prisma.account.findUnique({ where: { id: account.id } })) ?? account;
}
