import type { Server as HttpServer } from "node:http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import type { Notification, Prisma, User } from "../generated/prisma/client.js";
import { prisma } from "./prisma.js";

// Live updates over Socket.IO. A signed-in browser connects with its login
// token and joins a room of its own; designers and admins also join "staff",
// and admins "admin". New notifications are pushed to their audience's room.
const STAFF_ROLES = ["designer", "admin"];
const STAFF_ROOM = "staff";
const ADMIN_ROOM = "admin";
const userRoom = (userId: number) => `user:${userId}`;

let io: Server | null = null;

export function initRealtime(server: HttpServer, corsOrigins: string[]) {
  io = new Server(server, { cors: { origin: corsOrigins } });

  // Varnish sits in front of the API on Cloudways; the long-polling
  // fallback must never be served from its cache.
  io.engine.on("headers", (headers: Record<string, string>) => {
    headers["Cache-Control"] = "no-store";
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    const secret = process.env.JWT_SECRET;
    if (typeof token !== "string" || !secret) return next(new Error("Not authenticated"));
    try {
      const { userId } = jwt.verify(token, secret) as { userId: number };
      // The role comes from the database, like requireRole, so a role change
      // applies on the next connection.
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (!user) return next(new Error("Not authenticated"));
      socket.data.userId = userId;
      socket.data.role = user.role;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const role: string = socket.data.role;
    socket.join(userRoom(socket.data.userId));
    if (STAFF_ROLES.includes(role)) socket.join(STAFF_ROOM);
    if (role === "admin") socket.join(ADMIN_ROOM);
  });
}

// Which notifications this person can see: their own, plus their role's.
export function notificationsFor(user: { id: number; role: string }): Prisma.NotificationWhereInput {
  const audiences: Prisma.NotificationWhereInput[] = [{ audience: "user", recipientId: user.id }];
  if (STAFF_ROLES.includes(user.role)) audiences.push({ audience: "staff" });
  if (user.role === "admin") audiences.push({ audience: "admin" });
  return { OR: audiences };
}

type NotificationWithActor = Notification & {
  actor?: Pick<User, "fullName" | "email"> | null;
};

// `read` is for the person asking: whether they have read it.
export function toNotificationResponse(n: NotificationWithActor, read: boolean) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body ?? undefined,
    link: n.link ?? undefined,
    requestId: n.requestId ?? undefined,
    actor: n.actor ? { fullName: n.actor.fullName, email: n.actor.email } : undefined,
    read,
    createdAt: n.createdAt,
  };
}

type NotificationInput = {
  type: string;
  title: string;
  body?: string | undefined;
  link?: string | undefined;
  requestId?: number | undefined;
  actorId?: number | undefined;
};

// Saves a notification and pushes it to everyone in its audience who's
// connected. Never throws: a failed notification mustn't fail the action
// that caused it.
async function notify(
  audience: { audience: "staff" | "admin" } | { audience: "user"; recipientId: number },
  data: NotificationInput
) {
  try {
    const created = await prisma.notification.create({
      data: {
        audience: audience.audience,
        recipientId: audience.audience === "user" ? audience.recipientId : null,
        type: data.type,
        title: data.title,
        body: data.body ?? null,
        link: data.link ?? null,
        requestId: data.requestId ?? null,
        actorId: data.actorId ?? null,
      },
      include: { actor: { select: { fullName: true, email: true } } },
    });
    const room =
      audience.audience === "user"
        ? userRoom(audience.recipientId)
        : audience.audience === "admin"
          ? ADMIN_ROOM
          : STAFF_ROOM;
    io?.to(room).emit("notification", toNotificationResponse(created, false));
  } catch (err) {
    console.error(`Failed to send notification (${data.type}):`, err);
  }
}

// Designers and admins.
export const notifyStaff = (data: NotificationInput) => notify({ audience: "staff" }, data);
export const notifyAdmins = (data: NotificationInput) => notify({ audience: "admin" }, data);
export const notifyUser = (recipientId: number, data: NotificationInput) =>
  notify({ audience: "user", recipientId }, data);

// Tells connected staff a request changed (new, delivered, declined) so an
// open requests queue updates without a reload.
export function broadcastRequest(request: unknown) {
  io?.to(STAFF_ROOM).emit("request", request);
}

// Tells the reader's other open tabs and devices that they read something.
export function broadcastRead(userId: number, read: { id: number } | { all: true }) {
  io?.to(userRoom(userId)).emit("notifications-read", read);
}
