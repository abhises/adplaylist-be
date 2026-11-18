import type { CookieOptions, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";

// Sign-in sessions live in an httpOnly cookie, so page scripts (and so any
// injected script) can never read the token. The site (adplaylist.com) and
// the API (api.adplaylist.com) are the same site, so the browser sends it on
// the frontend's credentialed fetches; SameSite=Lax keeps other sites'
// pages from sending it with their requests.
export const SESSION_COOKIE = "adp_session";
const SESSION_DAYS = 7;

type TokenPayload = { userId: number; tv?: number };

function secret() {
  return process.env.JWT_SECRET || null;
}

// Production is served over HTTPS; local development is plain http.
function secureCookies() {
  return (process.env.FRONTEND_URL || "").startsWith("https://");
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
  };
}

export function signToken(user: { id: number; tokenVersion: number }) {
  const key = secret();
  if (!key) return null;
  return jwt.sign({ userId: user.id, tv: user.tokenVersion }, key, {
    expiresIn: `${SESSION_DAYS}d`,
  });
}

// Signs the user in on this browser. False when the server has no JWT secret.
export function startSession(res: Response, user: { id: number; tokenVersion: number }) {
  const token = signToken(user);
  if (!token) return false;
  res.cookie(SESSION_COOKIE, token, {
    ...cookieOptions(),
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
  return true;
}

export function endSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

// The value of one cookie from a raw Cookie header.
export function readCookie(header: string | undefined, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function sessionToken(req: Pick<Request, "headers">) {
  return readCookie(req.headers.cookie, SESSION_COOKIE);
}

// The user a token belongs to, if it's genuine, unexpired, not revoked (its
// version still matches) and the account isn't deleted.
export async function userIdFromToken(token: string | null | undefined) {
  const key = secret();
  if (!token || !key) return null;
  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, key) as TokenPayload;
  } catch {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { tokenVersion: true, deactivatedAt: true },
  });
  if (!user || user.deactivatedAt) return null;
  // Tokens from before versions existed carry none and count as version 0.
  if ((payload.tv ?? 0) !== user.tokenVersion) return null;
  return payload.userId;
}

// Signs the user out on every device: every token issued so far stops working.
export async function revokeAllSessions(userId: number) {
  return prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
    select: { id: true, tokenVersion: true },
  });
}
