import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { googleAuthSchema, loginSchema, registerSchema } from "../validation/schemas.js";
import { verifyGoogleCredential } from "../lib/googleAuth.js";
import { toUserResponse } from "./profile.js";

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
    data: { email, passwordHash, fullName: fullName.trim(), role },
  });

  const token = signToken(user.id);
  if (!token) return res.status(500).json({ error: "Server misconfigured" });

  res.status(201).json({ token, user: toUserResponse(user) });
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

  res.json({ token, user: toUserResponse(user) });
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
          },
        });
  }

  const token = signToken(user.id);
  if (!token) return res.status(500).json({ error: "Server misconfigured" });

  res.json({ token, user: toUserResponse(user) });
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: toUserResponse(user) });
});

export default router;
