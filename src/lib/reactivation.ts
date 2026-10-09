import type { User } from "../generated/prisma/client.js";
import { sendWelcomeBackEmail } from "./mailer.js";
import { prisma } from "./prisma.js";
import { notifyAdmins } from "./realtime.js";

// Someone who deleted (deactivated) their account has signed in again: they
// get it back with everything they had. An owner whose company isn't
// paying any more gets no second free trial: the account is marked as
// needing payment, which keeps the app locked on the billing page until
// they subscribe (charged straight away, since only a "trial" account gets a
// trial at checkout). Returns whether they must subscribe first.
export async function welcomeBack(user: User): Promise<boolean> {
  const account = user.accountId
    ? await prisma.account.findUnique({ where: { id: user.accountId } })
    : null;
  const paying =
    !!account &&
    !!account.stripeSubscriptionId &&
    ["active", "past_due", "cancelled"].includes(account.status);
  const mustSubscribe = !!account && user.accountRole === "owner" && !paying;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { deactivatedAt: null } });
    if (mustSubscribe) {
      await tx.account.update({
        where: { id: account!.id },
        data: {
          paymentRequired: true,
          // A card-less trial can't be picked up again either.
          ...(account!.status === "trial" ? { status: "expired", credits: 0 } : {}),
        },
      });
    }
    await tx.cancellationFeedback.create({
      data: {
        userId: user.id,
        accountId: account?.id ?? null,
        userName: user.fullName,
        userEmail: user.email,
        accountName: account?.name ?? null,
        plan: account?.plan ?? null,
        outcome: "returned",
      },
    });
  });

  sendWelcomeBackEmail(user.email, user.fullName, mustSubscribe);
  void notifyAdmins({
    type: "user.returned",
    title: `${user.fullName}${account ? ` (${account.name})` : ""} has rejoined`,
    body: `${user.email} signed in again after deleting their account${
      mustSubscribe ? ". They need to subscribe before using the app (no free trial)." : "."
    }`,
    link: "/admin/cancellations",
    actorId: user.id,
  });
  return mustSubscribe;
}
