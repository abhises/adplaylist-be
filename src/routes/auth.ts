import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { googleAuthSchema, loginSchema, registerSchema } from "../validation/schemas.js";
import { verifyGoogleCredential } from "../lib/googleAuth.js";
import { sendWelcomeEmail } from "../lib/mailer.js";
import { TRIAL_DAYS } from "../lib/plans.js";
import { userResponseFor } from "./profile.js";

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

function signToken(userId: number) {
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) return null;
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

router.post("/register", validateBody(registerSchema), async (req, res) => {
  const { fullName, email, password, role } = req.body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

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

  const token = signToken(user.id);
  if (!token) return res.status(500).json({ error: "Server misconfigured" });

  if (role === "client") sendWelcomeEmail(user.email, user.fullName, TRIAL_DAYS);

  res.status(201).json({ token, user: await userResponseFor(user.id) });
});

router.post("/login", validateBody(loginSchema), async (req, res) => {
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

  const token = signToken(user.id);
  if (!token) return res.status(500).json({ error: "Server misconfigured" });

  res.json({ token, user: await userResponseFor(user.id) });
});

router.post("/google", validateBody(googleAuthSchema), async (req, res) => {
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

  const token = signToken(user.id);
  if (!token) return res.status(500).json({ error: "Server misconfigured" });

  if (isNewUser) sendWelcomeEmail(user.email, user.fullName, TRIAL_DAYS);

  res.json({ token, user: await userResponseFor(user.id) });
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await userResponseFor(req.userId!);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user });
});

export default router;
