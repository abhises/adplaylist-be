import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  googleAuthLimiter,
  loginEmailLimiter,
  loginIpLimiter,
  registerLimiter,
} from "../middleware/rateLimit.js";
import { googleAuthSchema, loginSchema, registerSchema } from "../validation/schemas.js";
import { verifyGoogleCredential } from "../lib/googleAuth.js";
import { sendWelcomeEmail } from "../lib/mailer.js";
import { welcomeBack } from "../lib/reactivation.js";
import { attachReferral } from "../lib/referrals.js";
import { TRIAL_DAYS } from "../lib/plans.js";
import { notifyAdmins } from "../lib/realtime.js";
import { userResponseFor } from "./profile.js";
import { passwordProblem } from "../lib/passwordPolicy.js";
import {
  endSession,
  revokeAllSessions,
  sessionToken,
  startSession,
  userIdFromToken,
} from "../lib/session.js";

// Tells admins someone new signed up.
function announceSignup(user: { id: number; fullName: string; email: string; role: string }, via: string) {
  void notifyAdmins({
    type: "user.signup",
    title: `New sign-up: ${user.fullName}${user.role === "client" ? "" : ` (${user.role})`}`,
    body: `${user.email} · ${via}`,
    link: "/admin",
    actorId: user.id,
  });
}

// Every new customer owns a fresh account that starts a 7-day Starter trial;
// choosing a paid plan (with a card) happens on the billing page. Staff
// roles don't get an account — they never use a seat.
function newOwnerAccount(role: string, fullName: string) {
  if (role !== "client") return {};
  return {
    accountRole: "owner",
    account: {
      create: {
        name: fullName,
        plan: "starter",
        status: "trial",
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      },
    },
  };
}

const router = Router();

const MISCONFIGURED = { error: "Server misconfigured" };

router.post("/register", registerLimiter, validateBody(registerSchema), async (req, res) => {
  const { fullName, email, password, referralCode } = req.body;
  // Always a customer: staff roles are only ever granted by an admin.
  const role = "client";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.deactivatedAt) {
    return res.status(409).json({
      error: "Welcome back! You already have an account. Sign in to reactivate it.",
    });
  }
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  const problem = await passwordProblem(password, email);
  if (problem) return res.status(400).json({ error: problem });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName: fullName.trim(),
      role,
      ...newOwnerAccount(role, fullName.trim()),
    },
  });

  if (!startSession(res, user)) return res.status(500).json(MISCONFIGURED);

  if (role === "client") sendWelcomeEmail(user.email, user.fullName, TRIAL_DAYS);
  announceSignup(user, "email");
  await attachReferral(user.accountId, referralCode);

  res.status(201).json({ user: await userResponseFor(user.id) });
});

router.post("/login", loginIpLimiter, loginEmailLimiter, validateBody(loginSchema), async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  if (!user.passwordHash) {
    return res.status(401).json({
      error: "This account uses Google Sign-In. Continue with Google instead.",
    });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  // Coming back after deleting their account: it's reactivated.
  const returning = !!user.deactivatedAt;
  if (returning) await welcomeBack(user);

  if (!startSession(res, user)) return res.status(500).json(MISCONFIGURED);

  res.json({ user: await userResponseFor(user.id), welcomeBack: returning });
});

router.post("/google", googleAuthLimiter, validateBody(googleAuthSchema), async (req, res) => {
  const { credential } = req.body;

  let googleUser;
  try {
    googleUser = await verifyGoogleCredential(credential);
  } catch {
    return res.status(401).json({ error: "Invalid Google credential" });
  }

  let user = await prisma.user.findUnique({
    where: { googleId: googleUser.googleId },
  });

  let isNewUser = false;
  if (!user) {
    const existingByEmail = await prisma.user.findUnique({
      where: { email: googleUser.email },
    });

    user = existingByEmail
      ? await prisma.user.update({
          where: { id: existingByEmail.id },
          data: { googleId: googleUser.googleId },
        })
      : await prisma.user.create({
          data: {
            email: googleUser.email,
            fullName: googleUser.fullName,
            googleId: googleUser.googleId,
            role: "client",
            ...newOwnerAccount("client", googleUser.fullName),
          },
        });
    isNewUser = !existingByEmail;
  }
  const returning = !!user.deactivatedAt;
  if (returning) await welcomeBack(user);

  if (!startSession(res, user)) return res.status(500).json(MISCONFIGURED);

  if (isNewUser) {
    sendWelcomeEmail(user.email, user.fullName, TRIAL_DAYS);
    announceSignup(user, "Google");
    await attachReferral(user.accountId, req.body.referralCode);
  }

  res.json({ user: await userResponseFor(user.id), welcomeBack: returning });
});

// Who's signed in on this browser, or null for a visitor. Never a 401, so the
// app can ask on every page load without an error for visitors.
router.get("/session", async (req, res) => {
  const userId = await userIdFromToken(sessionToken(req));
  if (!userId) {
    if (sessionToken(req)) endSession(res);
    return res.json({ user: null });
  }
  res.json({ user: await userResponseFor(userId) });
});

// One-off move for browsers signed in before sessions used a cookie: the old
// token (kept in localStorage) is swapped for the cookie, and the browser
// then deletes its copy. Only a still-valid token is accepted.
router.post("/session/migrate", async (req, res) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const userId = await userIdFromToken(token);
  if (!userId) return res.json({ user: null });
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, tokenVersion: true },
  });
  if (!user || !startSession(res, user)) return res.json({ user: null });
  res.json({ user: await userResponseFor(userId) });
});

// Signs out this browser.
router.post("/logout", (_req, res) => {
  endSession(res);
  res.status(204).send();
});

// Signs out every device, this one included.
router.post("/logout-all", requireAuth, async (req: AuthedRequest, res) => {
  await revokeAllSessions(req.userId!);
  endSession(res);
  res.status(204).send();
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await userResponseFor(req.userId!);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user });
});

export default router;
