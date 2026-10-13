// Refer a friend. Every customer account has a link (/?ref=<code>); an
// account created through it is recorded as a pending referral. When that
// account pays its first invoice, the referrer and the friend both get bonus
// credits (amounts in creditSettings.ts, edited at /admin/pricing).
//
// The rules that keep it from being farmed:
//  - Nothing is given for signing up or starting a trial, only for a payment.
//  - A friend who paid with a card the referrer also has on file is the
//    referrer themselves: no reward.
//  - At most REFERRAL_YEARLY_CAP rewarded referrals per account a year.
//  - The referrer needs an active paid plan to be credited. If they aren't
//    on one yet, the reward waits and is given when they next pay.
//  - A refund or chargeback of that first payment takes the credits back.
import { randomInt } from "node:crypto";
import type Stripe from "stripe";
import { Prisma, type Account } from "../generated/prisma/client.js";
import { getStripe } from "./billing.js";
import { getCreditSettings } from "./creditSettings.js";
import { sendReferralRewardEmail } from "./mailer.js";
import { prisma } from "./prisma.js";
import { notifyAdmins, notifyUser } from "./realtime.js";

export const REFERRAL_YEARLY_CAP = 10;

export type ReferralStatus =
  | "pending"
  | "waiting"
  | "rewarded"
  | "ineligible"
  | "reversed"
  | "cancelled";

// No 0/O or 1/I/L, so a code read aloud or typed by hand can't be mistaken.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function newCode() {
  return Array.from(
    { length: CODE_LENGTH },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  ).join("");
}

// The account's referral code, made the first time it's needed.
export async function ensureReferralCode(account: Account): Promise<string> {
  if (account.referralCode) return account.referralCode;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      // Only if it still has none, so two requests at once agree on one code.
      await prisma.account.updateMany({
        where: { id: account.id, referralCode: null },
        data: { referralCode: newCode() },
      });
      break;
    } catch (err) {
      // Another account already has that code: try a new one.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
    }
  }
  const { referralCode } = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
  if (!referralCode) throw new Error(`Couldn't make a referral code for account ${account.id}`);
  return referralCode;
}

export function referralLink(code: string) {
  const site = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${site}/?ref=${code}`;
}

// "Nina Vogel" → "Nina V.": enough for the referrer to recognise who it
// was, without showing a stranger's full name if the link was shared widely.
export function shortName(name: string) {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first || "Someone";
}

async function ownersOf(accountId: number) {
  return prisma.user.findMany({
    where: { accountId, accountRole: "owner", deactivatedAt: null },
    select: { id: true, email: true, fullName: true },
  });
}

// Records that a newly created account came from a referral link. Never
// throws: a bad or unknown code mustn't fail the sign-up.
export async function attachReferral(referredAccountId: number | null, code: unknown) {
  if (!referredAccountId || typeof code !== "string" || !code) return;
  try {
    const referrer = await prisma.account.findUnique({ where: { referralCode: code } });
    if (!referrer || referrer.id === referredAccountId) return;
    const referred = await prisma.account.findUnique({ where: { id: referredAccountId } });
    if (!referred) return;
    await prisma.referral.create({
      data: { referrerAccountId: referrer.id, referredAccountId },
    });
    const { referralRewards } = await getCreditSettings();
    for (const owner of await ownersOf(referrer.id)) {
      void notifyUser(owner.id, {
        type: "referral.signup",
        title: `${shortName(referred.name)} signed up with your link`,
        body: `You'll get up to ${referralRewards.referrer} bonus credits when they pay for their first month.`,
        link: "/referrals",
      });
    }
  } catch (err) {
    console.error("[referrals] couldn't record a referral", err);
  }
}

// Adds (or, with a negative amount, takes back) bonus credits, with a ledger
// entry. Taking back stops at zero: credits already spent aren't owed.
async function adjustCredits(
  tx: Prisma.TransactionClient,
  accountId: number,
  amount: number,
  note: string
) {
  if (amount < 0) {
    const { credits } = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
    amount = -Math.min(credits, -amount);
  }
  if (amount === 0) return;
  const { credits } = await tx.account.update({
    where: { id: accountId },
    data: { credits: { increment: amount } },
  });
  await tx.creditTransaction.create({
    data: { accountId, reason: "referral", delta: amount, balance: credits, note },
  });
}

// Fingerprints of the cards an invoice was paid with. The same physical card
// has the same fingerprint on every customer.
async function cardsThatPaid(invoiceId: string) {
  const { data } = await getStripe().invoicePayments.list({
    invoice: invoiceId,
    status: "paid",
    expand: ["data.payment.payment_intent.latest_charge"],
  });
  const fingerprints = new Set<string>();
  for (const p of data) {
    const pi = p.payment.payment_intent;
    const charge =
      pi && typeof pi !== "string" && pi.latest_charge && typeof pi.latest_charge !== "string"
        ? pi.latest_charge
        : null;
    const fingerprint = charge?.payment_method_details?.card?.fingerprint;
    if (fingerprint) fingerprints.add(fingerprint);
  }
  return fingerprints;
}

async function sharesCard(referrer: Account, invoiceId: string) {
  if (!referrer.stripeCustomerId) return false;
  const paidWith = await cardsThatPaid(invoiceId);
  if (!paidWith.size) return false;
  const { data } = await getStripe().paymentMethods.list({
    customer: referrer.stripeCustomerId,
    type: "card",
    limit: 20,
  });
  return data.some((pm) => !!pm.card?.fingerprint && paidWith.has(pm.card.fingerprint));
}

async function rewardedThisYear(referrerAccountId: number) {
  return prisma.referral.count({
    where: {
      referrerAccountId,
      status: "rewarded",
      rewardedAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
    },
  });
}

// Gives both sides their credits. `from` is the status the referral must
// still be in, so two webhook deliveries racing each other reward it once.
async function reward(
  referralId: number,
  from: ReferralStatus,
  referrer: Account,
  referred: Account,
  invoiceId: string
) {
  const { referralRewards } = await getCreditSettings();
  const referrerCredits =
    referred.plan === "starter" ? referralRewards.referrerStarter : referralRewards.referrer;
  const referredCredits = from === "pending" ? referralRewards.friend : 0;

  const done = await prisma.$transaction(async (tx) => {
    const { count } = await tx.referral.updateMany({
      where: { id: referralId, status: from },
      data: {
        status: "rewarded",
        note: null,
        referrerCredits,
        // A waiting referral's friend got theirs when they paid.
        ...(from === "pending" ? { referredCredits } : {}),
        stripeInvoiceId: invoiceId,
        rewardedAt: new Date(),
      },
    });
    if (count !== 1) return false;
    await adjustCredits(
      tx,
      referrer.id,
      referrerCredits,
      `Referral bonus · ${shortName(referred.name)} subscribed`
    );
    await adjustCredits(
      tx,
      referred.id,
      referredCredits,
      `Welcome bonus · referred by ${shortName(referrer.name)}`
    );
    return true;
  });
  if (!done) return;

  if (referrerCredits > 0) {
    for (const owner of await ownersOf(referrer.id)) {
      void notifyUser(owner.id, {
        type: "referral.rewarded",
        title: `You earned ${referrerCredits} bonus credits`,
        body: `${shortName(referred.name)} subscribed with your referral link. The credits are in your balance now.`,
        link: "/referrals",
      });
      sendReferralRewardEmail(owner.email, owner.fullName, referrerCredits, shortName(referred.name));
    }
  }
  if (referredCredits > 0) {
    for (const owner of await ownersOf(referred.id)) {
      void notifyUser(owner.id, {
        type: "referral.rewarded",
        title: `${referredCredits} bonus credits added`,
        body: `A welcome bonus for joining through ${shortName(referrer.name)}'s link.`,
        link: "/billing",
      });
    }
  }
  void notifyAdmins({
    type: "referral.rewarded",
    title: `Referral rewarded: ${referrer.name} referred ${referred.name}`,
    body: `${referrerCredits} credits to ${referrer.name}${
      referredCredits ? `, ${referredCredits} to ${referred.name}` : ""
    }`,
    link: "/admin/referrals",
  });
}

async function settle(account: Account, invoice: Stripe.Invoice) {
  if (!invoice.id || invoice.amount_paid <= 0) return;

  // This account was referred, and this is its first payment.
  const referral = await prisma.referral.findUnique({
    where: { referredAccountId: account.id },
    include: { referrer: true },
  });
  if (referral?.status === "pending") {
    const { referrer } = referral;
    const stop = (status: ReferralStatus, note: string) =>
      prisma.referral.updateMany({
        where: { id: referral.id, status: "pending" },
        data: { status, note, stripeInvoiceId: invoice.id! },
      });

    if (await sharesCard(referrer, invoice.id)) {
      await stop("ineligible", "Paid with a card the referrer also uses");
    } else if ((await rewardedThisYear(referrer.id)) >= REFERRAL_YEARLY_CAP) {
      await stop("ineligible", `The referrer reached ${REFERRAL_YEARLY_CAP} rewarded referrals this year`);
    } else if (referrer.status !== "active") {
      // The friend still gets their welcome bonus now; the referrer's share
      // waits for their own next payment (below).
      const { referralRewards } = await getCreditSettings();
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.referral.updateMany({
          where: { id: referral.id, status: "pending" },
          data: {
            status: "waiting",
            note: "Waiting for the referrer to be on an active paid plan",
            referredCredits: referralRewards.friend,
            stripeInvoiceId: invoice.id!,
          },
        });
        if (count !== 1) return;
        await adjustCredits(
          tx,
          account.id,
          referralRewards.friend,
          `Welcome bonus · referred by ${shortName(referrer.name)}`
        );
      });
    } else {
      await reward(referral.id, "pending", referrer, account, invoice.id);
    }
  }

  // This account referred others whose reward was waiting for it to pay.
  if (account.status !== "active") return;
  const waiting = await prisma.referral.findMany({
    where: { referrerAccountId: account.id, status: "waiting" },
    include: { referred: true },
    orderBy: { id: "asc" },
  });
  for (const w of waiting) {
    if ((await rewardedThisYear(account.id)) >= REFERRAL_YEARLY_CAP) break;
    await reward(w.id, "waiting", account, w.referred, w.stripeInvoiceId ?? invoice.id);
  }
}

// Called for every paid subscription invoice, after its credits are
// refilled (a refill resets the balance; the bonus is added on top). Safe to
// call again for the same invoice. Never throws, so a referral problem can't
// fail the payment's own handling; whatever didn't go through is retried the
// next time the invoice is handled.
export async function settleReferrals(account: Account, invoice: Stripe.Invoice) {
  try {
    await settle(account, invoice);
  } catch (err) {
    console.error(`[referrals] couldn't settle referrals for account ${account.id}`, err);
  }
}

// Undoes a referral: a rewarded one has its credits taken back from both
// sides (as far as they're still unspent); one that hasn't paid out yet is
// just stopped. Returns false if there was nothing to undo.
export async function reverseReferral(referralId: number, note: string) {
  return prisma.$transaction(async (tx) => {
    const referral = await tx.referral.findUnique({
      where: { id: referralId },
      include: { referrer: true, referred: true },
    });
    if (!referral || !["pending", "waiting", "rewarded"].includes(referral.status)) return false;
    const paidOut = referral.status === "rewarded";
    const { count } = await tx.referral.updateMany({
      where: { id: referral.id, status: referral.status },
      data: { status: paidOut || referral.referredCredits > 0 ? "reversed" : "cancelled", note },
    });
    if (count !== 1) return false;
    if (paidOut) {
      await adjustCredits(
        tx,
        referral.referrerAccountId,
        -referral.referrerCredits,
        `Referral bonus reversed · ${shortName(referral.referred.name)}`
      );
    }
    await adjustCredits(
      tx,
      referral.referredAccountId,
      -referral.referredCredits,
      "Welcome bonus reversed"
    );
    return true;
  });
}

// A payment was refunded in full or disputed: if it was the one that earned
// a referral reward, the reward is taken back.
export async function reverseReferralForPayment(
  customer: string | { id: string } | null,
  paymentIntent: string | { id: string } | null,
  why: string
) {
  const customerId = typeof customer === "string" ? customer : customer?.id;
  const paymentIntentId = typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id;
  if (!customerId || !paymentIntentId) return;
  const account = await prisma.account.findUnique({ where: { stripeCustomerId: customerId } });
  if (!account) return;
  const referral = await prisma.referral.findUnique({ where: { referredAccountId: account.id } });
  if (!referral?.stripeInvoiceId || !["waiting", "rewarded"].includes(referral.status)) return;

  const { data } = await getStripe().invoicePayments.list({ invoice: referral.stripeInvoiceId });
  const paidByThis = data.some((p) => {
    const pi = p.payment.payment_intent;
    return (typeof pi === "string" ? pi : pi?.id) === paymentIntentId;
  });
  if (!paidByThis) return;

  if (await reverseReferral(referral.id, why)) {
    void notifyAdmins({
      type: "referral.reversed",
      title: `Referral reversed: ${account.name}`,
      body: why,
      link: "/admin/referrals",
    });
  }
}
