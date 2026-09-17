import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

const router = Router();

export function toUserResponse(user: RowDataPacket) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    defaultLanguage: user.default_language,
    gridDensity: user.grid_density,
    memberSince: user.created_at,
    emailPreferences: {
      onboarding: !!user.pref_onboarding,
      product: !!user.pref_product,
      promotions: !!user.pref_promotions,
      brand: !!user.pref_brand,
      newsletter: !!user.pref_newsletter,
    },
  };
}

router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM users WHERE id = ?",
    [req.userId]
  );
  const user = rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: toUserResponse(user) });
});

router.put("/", requireAuth, async (req: AuthedRequest, res) => {
  const { fullName, defaultLanguage, gridDensity, emailPreferences } =
    req.body ?? {};

  await pool.query(
    `UPDATE users SET
      full_name = COALESCE(?, full_name),
      default_language = COALESCE(?, default_language),
      grid_density = COALESCE(?, grid_density),
      pref_onboarding = COALESCE(?, pref_onboarding),
      pref_product = COALESCE(?, pref_product),
      pref_promotions = COALESCE(?, pref_promotions),
      pref_brand = COALESCE(?, pref_brand),
      pref_newsletter = COALESCE(?, pref_newsletter)
     WHERE id = ?`,
    [
      fullName ?? null,
      defaultLanguage ?? null,
      gridDensity ?? null,
      emailPreferences?.onboarding !== undefined
        ? Number(emailPreferences.onboarding)
        : null,
      emailPreferences?.product !== undefined
        ? Number(emailPreferences.product)
        : null,
      emailPreferences?.promotions !== undefined
        ? Number(emailPreferences.promotions)
        : null,
      emailPreferences?.brand !== undefined
        ? Number(emailPreferences.brand)
        : null,
      emailPreferences?.newsletter !== undefined
        ? Number(emailPreferences.newsletter)
        : null,
      req.userId,
    ]
  );

  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM users WHERE id = ?",
    [req.userId]
  );
  const user = rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: toUserResponse(user) });
});

export default router;
