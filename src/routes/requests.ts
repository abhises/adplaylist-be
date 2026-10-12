import { Router, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import {
  loadAccount,
  requireAuth,
  requireEntitlement,
  requireRole,
  type AuthedRequest,
} from "../middleware/auth.js";
import { refundCredit, refundRequestCredit, spendCredit } from "../lib/billing.js";
import { getCreditSettings } from "../lib/creditSettings.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  canvaRequestSchema,
  createRequestSchema,
  declineRequestSchema,
  deliverRequestSchema,
  idParamSchema,
  revisionRequestSchema,
} from "../validation/schemas.js";
import { toAdResponse } from "./ads.js";
import { broadcastRequest, notifyStaff, notifyUser } from "../lib/realtime.js";
import { deliveryEmail, mailConfigured, sendMail } from "../lib/mailer.js";
import type { Account, Ad, CreativeRequest, User } from "../generated/prisma/client.js";

const router = Router();

const CANVA_EDIT = "Canva edit";
const SIMILAR_DESIGN = "Similar design";
const REVISION = "Revision";

// What's said when an account can't afford a request.
function outOfCredits(cost: number, balance: number) {
  return {
    error:
      balance > 0
        ? `This request needs ${cost} credits and you have ${balance}.`
        : "You're out of credits.",
    upgrade: true,
    outOfCredits: true,
  };
}

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
    media: request.media ? request.media.split(",") : undefined,
    sizeNeeded: request.sizeNeeded ?? undefined,
    extraSizes: request.extraSizes,
    revisionOfId: request.revisionOfId ?? undefined,
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
    // Whether credits paid for it (declining refunds them), and how many.
    creditCharged: request.creditCharged,
    creditCost: request.creditCost,
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
      title: `${
        request.type === CANVA_EDIT
          ? "Canva edit request"
          : request.type === SIMILAR_DESIGN
            ? "Similar design request"
            : request.type === REVISION
              ? "Revision request"
              : request.media?.includes("video")
              ? "New video request"
              : "New request"
      } from ${from}`,
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

// A customer's request spends their account's shared credits: the cost of an
// image ad, a video ad or both, plus each extra size (creditSettings.ts).
// Staff requests are free. If saving fails the credits go straight back.
router.post(
  "/",
  requireAuth,
  loadAccount,
  requireEntitlement("requests"),
  validateBody(createRequestSchema),
  async (req: AuthedRequest, res) => {
    const { title, adUrl, sizeNeeded, neededBy, notes, attachmentUrl, attachmentName } =
      req.body;
    const media: string[] = req.body.media ?? ["image"];
    const extraSizes: number = req.body.extraSizes ?? 0;
    const { costs } = await getCreditSettings();
    const cost =
      (media.includes("image") ? costs.image : 0) +
      (media.includes("video") ? costs.video : 0) +
      extraSizes * costs.extraSize;

    const account = req.userRole === "client" ? req.account ?? null : null;
    if (req.userRole === "client" && !account) {
      return res.status(402).json({ error: "Choose a plan to request ads.", upgrade: true });
    }
    const spentEntryId = account
      ? await spendCredit(account.id, `Request: ${title}`, cost)
      : null;
    if (account && !spentEntryId) {
      return res.status(402).json(outOfCredits(cost, account.credits));
    }

    let created;
    try {
      created = await prisma.creativeRequest.create({
        data: {
          userId: req.userId!,
          accountId: account?.id ?? null,
          creditCharged: !!account,
          creditCost: cost,
          title,
          type: "New creative",
          media: media.join(","),
          adUrl,
          sizeNeeded: sizeNeeded ?? null,
          extraSizes,
          neededBy: neededBy ? new Date(neededBy) : null,
          notes: notes ?? null,
          status: "Open",
          attachmentUrl: attachmentUrl ?? null,
          attachmentName: attachmentName ?? null,
        },
      });
    } catch (err) {
      if (account) await refundCredit(account.id, `Request failed to save: ${title}`, cost);
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

// A request about one of our ads, sent with one click from its page: costs
// a customer `cost` credits and shows in their credit history. Asking twice for the same ad while the first is still open
// doesn't charge again (alreadyRequested).
async function requestForAd(
  req: AuthedRequest,
  res: Response,
  ad: Ad,
  { type, title, notes, cost }: { type: string; title: string; notes: string; cost: number }
) {
  const account = req.userRole === "client" ? req.account ?? null : null;
  if (req.userRole === "client" && !account) {
    return res.status(402).json({ error: "Choose a plan to request ads.", upgrade: true });
  }

  const open = await prisma.creativeRequest.findFirst({
    where: {
      adId: ad.id,
      type,
      status: "Open",
      ...(account ? { accountId: account.id } : { userId: req.userId! }),
    },
  });
  if (open) return res.json({ request: toRequestResponse(open, ad), alreadyRequested: true });

  const spentEntryId = account ? await spendCredit(account.id, title, cost) : null;
  if (account && !spentEntryId) {
    return res.status(402).json(outOfCredits(cost, account.credits));
  }

  let created;
  try {
    created = await prisma.creativeRequest.create({
      data: {
        userId: req.userId!,
        accountId: account?.id ?? null,
        creditCharged: !!account,
        creditCost: cost,
        title,
        type,
        notes,
        status: "Open",
        adId: ad.id,
        adUrl: adPageUrl(ad.slug),
      },
    });
  } catch (err) {
    if (account) await refundCredit(account.id, `Request failed to save: ${title}`, cost);
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

// "Request Canva Edit": asks the team to add an editable Canva copy to an ad
// that doesn't have one.
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
    await requestForAd(req, res, ad, {
      type: CANVA_EDIT,
      title: `Canva edit: ${ad.title}`,
      notes: "Add an editable Canva copy of this ad.",
      cost: (await getCreditSettings()).costs.canvaEdit,
    });
  }
);

// "Request a similar design" on a live ad (one copied from a real, running
// ad): asks the team to design something like it for the customer.
router.post(
  "/similar",
  requireAuth,
  loadAccount,
  requireEntitlement("requests"),
  validateBody(canvaRequestSchema),
  async (req: AuthedRequest, res) => {
    const ad = await prisma.ad.findUnique({ where: { slug: req.body.adId } });
    if (!ad) return res.status(404).json({ error: "Ad not found" });
    await requestForAd(req, res, ad, {
      type: SIMILAR_DESIGN,
      title: `Similar design: ${ad.title}`,
      notes: "Design an ad similar to this live ad for us.",
      cost: (await getCreditSettings()).costs.similarDesign,
    });
  }
);

// Asks for changes to a delivered request: a new request linked to it,
// costing an image revision, a video revision or both, by what was delivered.
router.post(
  "/:id/revision",
  requireAuth,
  loadAccount,
  requireEntitlement("requests"),
  validateParams(idParamSchema),
  validateBody(revisionRequestSchema),
  async (req: AuthedRequest, res) => {
    const account = req.userRole === "client" ? req.account ?? null : null;
    if (req.userRole === "client" && !account) {
      return res.status(402).json({ error: "Choose a plan to request ads.", upgrade: true });
    }
    // Their own request, or one from their company's account.
    const original = await prisma.creativeRequest.findFirst({
      where: {
        id: Number(req.params.id),
        OR: [{ userId: req.userId! }, ...(account ? [{ accountId: account.id }] : [])],
      },
    });
    if (!original) return res.status(404).json({ error: "Request not found" });
    if (original.status !== "Delivered") {
      return res.status(409).json({ error: "Only a delivered request can be revised." });
    }

    const media = original.media ? original.media.split(",") : ["image"];
    const { costs } = await getCreditSettings();
    const cost =
      (media.includes("image") ? costs.imageRevision : 0) +
      (media.includes("video") ? costs.videoRevision : 0);
    // A revision of a revision is still about the first request's creative.
    const base = original.title.replace(/^Revision: /, "");
    const title = `Revision: ${base}`;

    const spentEntryId = account ? await spendCredit(account.id, title, cost) : null;
    if (account && !spentEntryId) {
      return res.status(402).json(outOfCredits(cost, account.credits));
    }

    let created;
    try {
      created = await prisma.creativeRequest.create({
        data: {
          userId: req.userId!,
          accountId: account?.id ?? null,
          creditCharged: !!account,
          creditCost: cost,
          title,
          type: REVISION,
          media: media.join(","),
          revisionOfId: original.id,
          adId: original.adId,
          // What to change: the creative that was delivered.
          adUrl: original.deliveredUrl ?? original.adUrl,
          notes: req.body.notes,
          status: "Open",
          attachmentUrl: req.body.attachmentUrl || null,
          attachmentName: req.body.attachmentName || null,
        },
        include: { ad: true },
      });
    } catch (err) {
      if (account) await refundCredit(account.id, `Request failed to save: ${title}`, cost);
      throw err;
    }
    if (spentEntryId) {
      await prisma.creditTransaction.update({
        where: { id: spentEntryId },
        data: { requestId: created.id },
      });
    }

    await announceNewRequest(created.id);
    res.status(201).json({ request: toRequestResponse(created, created.ad) });
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
