import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import {
  loadAccount,
  requireAuth,
  requireEntitlement,
  requireRole,
  type AuthedRequest,
} from "../middleware/auth.js";
import { refundCredit, refundRequestCredit, spendCredit } from "../lib/billing.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  canvaRequestSchema,
  createRequestSchema,
  declineRequestSchema,
  deliverRequestSchema,
  idParamSchema,
} from "../validation/schemas.js";
import { toAdResponse } from "./ads.js";
import { broadcastRequest, notifyStaff, notifyUser } from "../lib/realtime.js";
import { deliveryEmail, mailConfigured, sendMail } from "../lib/mailer.js";
import type { Account, Ad, CreativeRequest, User } from "../generated/prisma/client.js";

const router = Router();

const CANVA_EDIT = "Canva edit";

function siteUrl() {
  return (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
}

// The public page of an ad, saved on Canva edit requests as their ad link.
function adPageUrl(slug: string) {
  return `${siteUrl()}/ads/${slug}`;
}

// The ad a delivered link points at, when it's one of our own ad pages
// (…/ads/<slug>, on any of our hosts), so it shows as a card for the client.
async function adFromUrl(url: string) {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const slug = path.match(/^\/ads\/([^/]+)\/?$/)?.[1];
  if (!slug) return null;
  return prisma.ad.findUnique({ where: { slug: decodeURIComponent(slug) } });
}

// Emails the client that their request is ready. Best effort: the in-app
// notification is the main one, so a mail failure is only logged.
function emailDelivery(
  to: string,
  fullName: string,
  title: string,
  link: string,
  note: string | null
) {
  if (!mailConfigured()) return;
  const { subject, text, html } = deliveryEmail({ fullName, title, link, note });
  sendMail({ to, subject, text, html }).catch((err) =>
    console.error("Delivery email failed:", (err as Error).message)
  );
}

// Loads what staff need to see who sent a request: the person and the
// company account they belong to.
const withRequester = {
  ad: true,
  user: { include: { account: true } },
} as const;

type Requester = Pick<User, "id" | "fullName" | "email" | "role" | "accountRole"> & {
  account?: Pick<Account, "name" | "plan" | "status"> | null;
};

function toRequestResponse(
  request: CreativeRequest,
  ad?: Ad | null,
  requester?: Requester | null
) {
  return {
    id: request.id,
    title: request.title,
    type: request.type,
    adUrl: request.adUrl ?? undefined,
    deliveredUrl: request.deliveredUrl ?? undefined,
    deliveryNote: request.deliveryNote ?? undefined,
    sizeNeeded: request.sizeNeeded ?? undefined,
    neededBy: request.neededBy ?? undefined,
    notes: request.notes ?? undefined,
    status: request.status,
    reason: request.reason ?? undefined,
    attachmentUrl: request.attachmentUrl ?? undefined,
    attachmentName: request.attachmentName ?? undefined,
    ad: ad ? toAdResponse(ad, { full: false }) : undefined,
    requester: requester
      ? {
          id: requester.id,
          fullName: requester.fullName,
          email: requester.email,
          role: requester.role,
          accountRole: requester.accountRole ?? undefined,
          company: requester.account
            ? {
                name: requester.account.name,
                plan: requester.account.plan,
                status: requester.account.status,
              }
            : undefined,
        }
      : undefined,
    // Whether a credit paid for it (declining refunds it).
    creditCharged: request.creditCharged,
    createdAt: request.createdAt,
  };
}

// Puts a just-created request in the staff inbox and live queue, saying who
// sent it and from which company. The request is already saved, so a failure
// here is logged rather than failing it.
async function announceNewRequest(id: number) {
  try {
    const request = await prisma.creativeRequest.findUnique({
      where: { id },
      include: withRequester,
    });
    if (!request) return;
    const { user } = request;
    const from = user.account ? `${user.fullName} (${user.account.name})` : user.fullName;
    await notifyStaff({
      type: "request.created",
      title: `${request.type === CANVA_EDIT ? "Canva edit request" : "New request"} from ${from}`,
      body: request.title,
      link: `/admin/requests?request=${request.id}`,
      requestId: request.id,
      actorId: user.id,
    });
    broadcastRequest(toRequestResponse(request, request.ad, request.user));
  } catch (err) {
    console.error(`Failed to announce request ${id}:`, err);
  }
}

router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const requests = await prisma.creativeRequest.findMany({
    where: { userId: req.userId! },
    include: { ad: true },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    requests: requests.map((r) => toRequestResponse(r, r.ad)),
  });
});

// All open/delivered/declined requests across every client, for the
// designer/admin queue — as opposed to GET "/" above, which is scoped to the
// caller's own requests.
router.get(
  "/queue",
  requireAuth,
  requireRole("designer", "admin"),
  async (_req: AuthedRequest, res) => {
    const requests = await prisma.creativeRequest.findMany({
      include: withRequester,
      orderBy: { createdAt: "desc" },
    });

    res.json({
      requests: requests.map((r) => toRequestResponse(r, r.ad, r.user)),
    });
  }
);

// A customer's request spends one of their account's shared credits; staff
// requests are free. If saving fails the credit goes straight back.
router.post(
  "/",
  requireAuth,
  loadAccount,
  requireEntitlement("requests"),
  validateBody(createRequestSchema),
  async (req: AuthedRequest, res) => {
    const { title, adUrl, sizeNeeded, neededBy, notes, attachmentUrl, attachmentName } =
      req.body;

    const account = req.userRole === "client" ? req.account ?? null : null;
    if (req.userRole === "client" && !account) {
      return res.status(402).json({ error: "Choose a plan to request ads.", upgrade: true });
    }
    const spentEntryId = account ? await spendCredit(account.id, `Request: ${title}`) : null;
    if (account && !spentEntryId) {
      return res.status(402).json({
        error: "You're out of credits.",
        upgrade: true,
        outOfCredits: true,
      });
    }

    let created;
    try {
      created = await prisma.creativeRequest.create({
        data: {
          userId: req.userId!,
          accountId: account?.id ?? null,
          creditCharged: !!account,
          title,
          type: "New creative",
          adUrl,
          sizeNeeded: sizeNeeded ?? null,
          neededBy: neededBy ? new Date(neededBy) : null,
          notes: notes ?? null,
          status: "Open",
          attachmentUrl: attachmentUrl ?? null,
          attachmentName: attachmentName ?? null,
        },
      });
    } catch (err) {
      if (account) await refundCredit(account.id, `Request failed to save: ${title}`);
      throw err;
    }
    if (spentEntryId) {
      await prisma.creditTransaction.update({
        where: { id: spentEntryId },
        data: { requestId: created.id },
      });
    }

    await announceNewRequest(created.id);
    res.status(201).json({ request: toRequestResponse(created) });
  }
);

// "Request Canva Edit": asks the team to add an editable Canva copy to an ad
// that doesn't have one. Costs a customer one credit, like any request, and
// shows in their credit history; asking twice for the same ad while the first
// is still open doesn't charge again.
router.post(
  "/canva",
  requireAuth,
  loadAccount,
  requireEntitlement("requests"),
  validateBody(canvaRequestSchema),
  async (req: AuthedRequest, res) => {
    const ad = await prisma.ad.findUnique({ where: { slug: req.body.adId } });
    if (!ad) return res.status(404).json({ error: "Ad not found" });
    if (ad.canvaUrl) {
      return res.status(409).json({ error: "This ad already has a Canva copy." });
    }

    const account = req.userRole === "client" ? req.account ?? null : null;
    if (req.userRole === "client" && !account) {
      return res.status(402).json({ error: "Choose a plan to request ads.", upgrade: true });
    }

    const open = await prisma.creativeRequest.findFirst({
      where: {
        adId: ad.id,
        type: CANVA_EDIT,
        status: "Open",
        ...(account ? { accountId: account.id } : { userId: req.userId! }),
      },
    });
    if (open) return res.json({ request: toRequestResponse(open, ad), alreadyRequested: true });

    const title = `Canva edit: ${ad.title}`;
    const spentEntryId = account ? await spendCredit(account.id, title) : null;
    if (account && !spentEntryId) {
      return res.status(402).json({
        error: "You're out of credits.",
        upgrade: true,
        outOfCredits: true,
      });
    }

    let created;
    try {
      created = await prisma.creativeRequest.create({
        data: {
          userId: req.userId!,
          accountId: account?.id ?? null,
          creditCharged: !!account,
          title,
          type: CANVA_EDIT,
          notes: "Add an editable Canva copy of this ad.",
          status: "Open",
          adId: ad.id,
          adUrl: adPageUrl(ad.slug),
        },
      });
    } catch (err) {
      if (account) await refundCredit(account.id, `Request failed to save: ${title}`);
      throw err;
    }
    if (spentEntryId) {
      await prisma.creditTransaction.update({
        where: { id: spentEntryId },
        data: { requestId: created.id },
      });
    }

    await announceNewRequest(created.id);
    res.status(201).json({ request: toRequestResponse(created, ad), alreadyRequested: false });
  }
);

// Marks a request as delivered and links the finished ad, so it shows up as
// a card in the Delivered tab. Restricted to designer/admin since it fulfils
// requests raised by other users, not just the caller's own.
router.post(
  "/:id/deliver",
  requireAuth,
  requireRole("designer", "admin"),
  validateParams(idParamSchema),
  validateBody(deliverRequestSchema),
  async (req: AuthedRequest, res) => {
    const deliveredUrl: string = req.body.deliveredUrl;
    const note: string | null = req.body.note || null;
    // A Canva edit is about its ad already; otherwise link the delivered ad
    // when the URL is one of our ad pages.
    const ad = await adFromUrl(deliveredUrl);

    const { count } = await prisma.creativeRequest.updateMany({
      where: { id: Number(req.params.id) },
      data: {
        status: "Delivered",
        deliveredUrl,
        deliveryNote: note,
        ...(ad ? { adId: ad.id } : {}),
      },
    });
    if (count === 0) {
      return res.status(404).json({ error: "Request not found" });
    }

    const updated = await prisma.creativeRequest.findUnique({
      where: { id: Number(req.params.id) },
      include: withRequester,
    });
    if (!updated)
      return res.status(500).json({ error: "Failed to update request" });
    const response = toRequestResponse(updated, updated.ad, updated.user);
    broadcastRequest(response);
    if (updated.userId !== req.userId) {
      await notifyUser(updated.userId, {
        type: "request.delivered",
        title: "Your request was delivered",
        body: note ? `${updated.title}: ${note}` : updated.title,
        link: "/requests?tab=Delivered",
        requestId: updated.id,
        actorId: req.userId,
      });
      emailDelivery(updated.user.email, updated.user.fullName, updated.title, deliveredUrl, note);
    }
    res.json({ request: response });
  }
);

// Declines a request with a reason, shown to the client in their Declined
// tab. Restricted to designer/admin for the same reason as /deliver.
router.post(
  "/:id/decline",
  requireAuth,
  requireRole("designer", "admin"),
  validateParams(idParamSchema),
  validateBody(declineRequestSchema),
  async (req: AuthedRequest, res) => {
    const { reason } = req.body;

    const { count } = await prisma.creativeRequest.updateMany({
      where: { id: Number(req.params.id) },
      data: { status: "Declined", reason },
    });
    if (count === 0) {
      return res.status(404).json({ error: "Request not found" });
    }

    // A declined request gives its credit back (once, however many times
    // it's declined).
    await refundRequestCredit(Number(req.params.id));

    const updated = await prisma.creativeRequest.findUnique({
      where: { id: Number(req.params.id) },
      include: withRequester,
    });
    if (!updated)
      return res.status(500).json({ error: "Failed to update request" });
    const response = toRequestResponse(updated, updated.ad, updated.user);
    broadcastRequest(response);
    if (updated.userId !== req.userId) {
      await notifyUser(updated.userId, {
        type: "request.declined",
        title: "Your request was declined",
        body: `${updated.title}: ${reason}`,
        link: "/requests?tab=Declined",
        requestId: updated.id,
        actorId: req.userId,
      });
    }
    res.json({ request: response });
  }
);

export default router;
