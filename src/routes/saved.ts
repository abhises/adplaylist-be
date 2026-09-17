import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { toAdResponse } from "./ads.js";

const router = Router();

router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ads.* FROM saved_ads
     JOIN ads ON ads.id = saved_ads.ad_id
     WHERE saved_ads.user_id = ?
     ORDER BY saved_ads.created_at DESC`,
    [req.userId]
  );
  res.json({ ads: rows.map(toAdResponse) });
});

router.post("/:slug", requireAuth, async (req: AuthedRequest, res) => {
  const [adRows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM ads WHERE slug = ?",
    [req.params.slug]
  );
  const ad = adRows[0];
  if (!ad) return res.status(404).json({ error: "Ad not found" });

  await pool.query(
    "INSERT IGNORE INTO saved_ads (user_id, ad_id) VALUES (?, ?)",
    [req.userId, ad.id]
  );
  res.status(201).json({ saved: true });
});

router.delete("/:slug", requireAuth, async (req: AuthedRequest, res) => {
  await pool.query(
    `DELETE saved_ads FROM saved_ads
     JOIN ads ON ads.id = saved_ads.ad_id
     WHERE saved_ads.user_id = ? AND ads.slug = ?`,
    [req.userId, req.params.slug]
  );
  res.json({ saved: false });
});

export default router;
