import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { toUserResponse } from "./profile.js";

const router = Router();

function signToken(userId: number) {
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) return null;
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

router.post("/register", async (req, res) => {
  const { fullName, email, password } = req.body ?? {};
  if (
    typeof fullName !== "string" ||
    !fullName.trim() ||
    typeof email !== "string" ||
    !email.trim() ||
    typeof password !== "string"
  ) {
    return res
      .status(400)
      .json({ error: "Full name, email, and password are required" });
  }
  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters" });
  }

  const [existing] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM users WHERE email = ?",
    [email]
  );
  if (existing[0]) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    "INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)",
    [email, passwordHash, fullName.trim()]
  );
  const userId = (result as { insertId: number }).insertId;

  const token = signToken(userId);
  if (!token) return res.status(500).json({ error: "Server misconfigured" });

  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM users WHERE id = ?",
    [userId]
  );
  const user = rows[0];
  if (!user) return res.status(500).json({ error: "Failed to create account" });

  res.status(201).json({ token, user: toUserResponse(user) });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM users WHERE email = ?",
    [email]
  );
  const user = rows[0];
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = signToken(user.id);
  if (!token) return res.status(500).json({ error: "Server misconfigured" });

  res.json({ token, user: toUserResponse(user) });
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM users WHERE id = ?",
    [req.userId]
  );
  const user = rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: toUserResponse(user) });
});

export default router;
