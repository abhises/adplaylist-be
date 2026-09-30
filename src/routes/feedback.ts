import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  createFeedbackSchema,
  idParamSchema,
  updateFeedbackSchema,
} from "../validation/schemas.js";
import type { Feedback, User } from "../generated/prisma/client.js";

const router = Router();

router.use(requireAuth);

function toFeedbackResponse(
  feedback: Feedback,
  sender?: Pick<User, "fullName" | "email" | "role"> | null
) {
  return {
    id: feedback.id,
    message: feedback.message,
    email: feedback.email ?? undefined,
    screenshotUrl: feedback.screenshotUrl ?? undefined,
    screenshotName: feedback.screenshotName ?? undefined,
    pageUrl: feedback.pageUrl ?? undefined,
    resolved: feedback.resolved,
    sender: sender
      ? { fullName: sender.fullName, email: sender.email, role: sender.role }
      : undefined,
    createdAt: feedback.createdAt,
  };
}

// Any signed-in user can send feedback; only admins can read it.
router.post(
  "/",
  validateBody(createFeedbackSchema),
  async (req: AuthedRequest, res) => {
    const { message, email, screenshotUrl, screenshotName, pageUrl } = req.body;
    const created = await prisma.feedback.create({
      data: {
        userId: req.userId!,
        message,
        email: email || null,
        screenshotUrl: screenshotUrl || null,
        screenshotName: screenshotName || null,
        pageUrl: pageUrl || null,
      },
    });
    res.status(201).json({ feedback: toFeedbackResponse(created) });
  }
);

router.get("/", requireRole("admin"), async (_req, res) => {
  const feedback = await prisma.feedback.findMany({
    include: { user: { select: { fullName: true, email: true, role: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ feedback: feedback.map((f) => toFeedbackResponse(f, f.user)) });
});

router.patch(
  "/:id",
  requireRole("admin"),
  validateParams(idParamSchema),
  validateBody(updateFeedbackSchema),
  async (req, res) => {
    const updated = await prisma.feedback.update({
      where: { id: Number(req.params.id) },
      data: { resolved: req.body.resolved },
      include: { user: { select: { fullName: true, email: true, role: true } } },
    });
    res.json({ feedback: toFeedbackResponse(updated, updated.user) });
  }
);

router.delete(
  "/:id",
  requireRole("admin"),
  validateParams(idParamSchema),
  async (req, res) => {
    await prisma.feedback.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  }
);

export default router;
