import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { broadcastRead, notificationsFor, toNotificationResponse } from "../lib/realtime.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { validateParams } from "../middleware/validate.js";
import { idParamSchema } from "../validation/schemas.js";

// The bell: each person sees their own notifications plus their role's, and
// has their own read status (a notification_reads row means read).
const router = Router();

router.use(requireAuth);

function viewer(req: AuthedRequest) {
  return prisma.user.findUnique({
    where: { id: req.userId! },
    select: { id: true, role: true },
  });
}

router.get("/", async (req: AuthedRequest, res) => {
  const user = await viewer(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const visible = notificationsFor(user);
  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({
      where: visible,
      include: {
        actor: { select: { fullName: true, email: true } },
        reads: { where: { userId: user.id }, select: { userId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.notification.count({
      where: { AND: [visible, { reads: { none: { userId: user.id } } }] },
    }),
  ]);
  res.json({
    notifications: notifications.map((n) => toNotificationResponse(n, n.reads.length > 0)),
    unread,
  });
});

router.post("/read-all", async (req: AuthedRequest, res) => {
  const user = await viewer(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const unread = await prisma.notification.findMany({
    where: { AND: [notificationsFor(user), { reads: { none: { userId: user.id } } }] },
    select: { id: true },
  });
  await prisma.notificationRead.createMany({
    data: unread.map((n) => ({ notificationId: n.id, userId: user.id })),
    skipDuplicates: true,
  });
  broadcastRead(user.id, { all: true });
  res.json({ ok: true });
});

router.post("/:id/read", validateParams(idParamSchema), async (req: AuthedRequest, res) => {
  const user = await viewer(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const notificationId = Number(req.params.id);
  const visible = await prisma.notification.count({
    where: { AND: [notificationsFor(user), { id: notificationId }] },
  });
  if (!visible) return res.status(404).json({ error: "Notification not found" });
  await prisma.notificationRead.createMany({
    data: [{ notificationId, userId: user.id }],
    skipDuplicates: true,
  });
  broadcastRead(user.id, { id: notificationId });
  res.json({ ok: true });
});

export default router;
