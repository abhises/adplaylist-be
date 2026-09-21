import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  createRequestSchema,
  declineRequestSchema,
  deliverRequestSchema,
  idParamSchema,
} from "../validation/schemas.js";
import { toAdResponse } from "./ads.js";
import type { Ad, CreativeRequest, User } from "../generated/prisma/client.js";

const router = Router();

function toRequestResponse(
  request: CreativeRequest,
  ad?: Ad | null,
  requester?: Pick<User, "fullName" | "email"> | null
) {
  return {
    id: request.id,
    title: request.title,
    type: request.type,
    sizeNeeded: request.sizeNeeded ?? undefined,
    neededBy: request.neededBy ?? undefined,
    notes: request.notes ?? undefined,
    status: request.status,
    reason: request.reason ?? undefined,
    attachmentUrl: request.attachmentUrl ?? undefined,
    attachmentName: request.attachmentName ?? undefined,
    ad: ad ? toAdResponse(ad) : undefined,
    requester: requester
      ? { fullName: requester.fullName, email: requester.email }
      : undefined,
    createdAt: request.createdAt,
  };
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
      include: { ad: true, user: true },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      requests: requests.map((r) => toRequestResponse(r, r.ad, r.user)),
    });
  }
);

router.post(
  "/",
  requireAuth,
  validateBody(createRequestSchema),
  async (req: AuthedRequest, res) => {
    const { title, sizeNeeded, neededBy, notes, attachmentUrl, attachmentName } =
      req.body;

    const created = await prisma.creativeRequest.create({
      data: {
        userId: req.userId!,
        title,
        type: "New creative",
        sizeNeeded: sizeNeeded ?? null,
        neededBy: neededBy ? new Date(neededBy) : null,
        notes: notes ?? null,
        status: "Open",
        attachmentUrl: attachmentUrl ?? null,
        attachmentName: attachmentName ?? null,
      },
    });

    res.status(201).json({ request: toRequestResponse(created) });
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
    const { adId } = req.body;

    const ad = await prisma.ad.findUnique({ where: { slug: adId } });
    if (!ad) return res.status(404).json({ error: "Ad not found" });

    const { count } = await prisma.creativeRequest.updateMany({
      where: { id: Number(req.params.id) },
      data: { status: "Delivered", adId: ad.id },
    });
    if (count === 0) {
      return res.status(404).json({ error: "Request not found" });
    }

    const updated = await prisma.creativeRequest.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!updated)
      return res.status(500).json({ error: "Failed to update request" });
    res.json({ request: toRequestResponse(updated, ad) });
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

    const updated = await prisma.creativeRequest.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!updated)
      return res.status(500).json({ error: "Failed to update request" });
    res.json({ request: toRequestResponse(updated) });
  }
);

export default router;
