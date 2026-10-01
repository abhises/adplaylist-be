import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Account } from "../generated/prisma/client.js";
import { entitlementsOf, loadAccountForUser } from "../lib/billing.js";
import { prisma } from "../lib/prisma.js";
import type { Entitlements } from "../lib/plans.js";

export interface AuthedRequest extends Request {
  userId?: number;
  userRole?: string;
  // Set by loadAccount: the caller's customer account (null for staff), and
  // whether they own it.
  account?: Account | null;
  accountRole?: string | null;
}

const JWT_SECRET = process.env.JWT_SECRET;

function bearerUserId(req: Request): number | null {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || !JWT_SECRET) return null;
  try {
    return (jwt.verify(token, JWT_SECRET) as { userId: number }).userId;
  } catch {
    return null;
  }
}

// For routes visitors can also reach: sets userId when a valid token is
// sent, and carries on either way.
export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const userId = bearerUserId(req);
  if (userId) req.userId = userId;
  next();
}

export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token || !JWT_SECRET) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number };
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Checked against the database on every request, rather than trusting a role
// baked into the JWT, so a role change takes effect immediately instead of
// waiting for the user's token to expire.
export function requireRole(...roles: string[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    });
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: "You don't have access to this." });
    }
    req.userRole = user.role;
    next();
  };
}

export type Permission = "blog" | "brandPages";

// Admins, or editors an admin has granted this permission to. Like
// requireRole, it's checked against the database on every request.
export function requirePermission(permission: Permission) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true, canManageBlog: true, canManageBrandPages: true },
    });
    const allowed =
      !!user &&
      (user.role === "admin" ||
        (user.role === "editor" &&
          (permission === "blog" ? user.canManageBlog : user.canManageBrandPages)));
    if (!allowed) {
      return res.status(403).json({ error: "You don't have access to this." });
    }
    req.userRole = user.role;
    next();
  };
}

// Loads the caller's account (applying any due trial/grace/refill
// transitions) onto the request. Use after requireAuth or optionalAuth.
export async function loadAccount(req: AuthedRequest, _res: Response, next: NextFunction) {
  if (!req.userId) return next();
  const loaded = await loadAccountForUser(req.userId);
  if (loaded) req.userRole = loaded.user.role;
  req.account = loaded?.account ?? null;
  req.accountRole = loaded?.user.accountRole ?? null;
  next();
}

// What the caller may do. Visitors get nothing; staff get everything.
export function entitlementsOfRequest(req: AuthedRequest): Entitlements | null {
  if (!req.userId || !req.userRole) return null;
  if (req.userRole !== "client") return entitlementsOf(null);
  return entitlementsOf(req.account ?? null);
}

// Blocks the action unless the plan and status allow it. The 402 carries an
// `upgrade` flag so the frontend can show its upgrade prompt.
export function requireEntitlement(feature: keyof Entitlements) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const ent = entitlementsOfRequest(req);
    if (ent?.[feature]) return next();
    res.status(402).json({
      error:
        req.account?.status === "expired"
          ? "Your plan has expired. Subscribe to unlock this."
          : "Your plan doesn't include this. Upgrade to unlock it.",
      upgrade: true,
    });
  };
}

export function requireAccountOwner(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.account) {
    return res.status(403).json({ error: "Only customer accounts have billing." });
  }
  if (req.accountRole !== "owner") {
    return res
      .status(403)
      .json({ error: "Only the account owner can manage billing." });
  }
  next();
}
