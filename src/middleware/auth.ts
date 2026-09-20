import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";

export interface AuthedRequest extends Request {
  userId?: number;
  userRole?: string;
}

const JWT_SECRET = process.env.JWT_SECRET;

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
