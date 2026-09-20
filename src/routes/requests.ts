import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  createRequestSchema,
  deliverRequestSchema,
  idParamSchema,
} from "../validation/schemas.js";
import { toAdResponse } from "./ads.js";
import type { Ad, CreativeRequest } from "../generated/prisma/client.js";

const router = Router();

function toRequestResponse(request: CreativeRequest, ad?: Ad | null) {
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
// a card in the Delivered tab. No admin UI calls this yet — the app doesn't
// have an admin role built out — but it's a real, usable capability rather
// than a stub, ready for whenever a fulfilment flow is added.
router.post(
  "/:id/deliver",
  requireAuth,
  validateParams(idParamSchema),
  validateBody(deliverRequestSchema),
  async (req: AuthedRequest, res) => {
    const { adId } = req.body;

    const ad = await prisma.ad.findUnique({ where: { slug: adId } });
    if (!ad) return res.status(404).json({ error: "Ad not found" });

    const { count } = await prisma.creativeRequest.updateMany({
      where: { id: Number(req.params.id), userId: req.userId! },
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

export default router;
