import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { toAdResponse } from "./ads.js";

const router = Router();

function toRequestResponse(row: RowDataPacket, ad?: RowDataPacket) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    sizeNeeded: row.size_needed ?? undefined,
    neededBy: row.needed_by ?? undefined,
    notes: row.notes ?? undefined,
    status: row.status,
    reason: row.reason ?? undefined,
    attachmentUrl: row.attachment_url ?? undefined,
    ad: ad ? toAdResponse(ad) : undefined,
    createdAt: row.created_at,
  };
}

router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM creative_requests WHERE user_id = ? ORDER BY created_at DESC",
    [req.userId]
  );

  const adIds = [...new Set(rows.map((r) => r.ad_id).filter(Boolean))];
  const adsById = new Map<number, RowDataPacket>();
  if (adIds.length) {
    const [adRows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM ads WHERE id IN (${adIds.map(() => "?").join(",")})`,
      adIds
    );
    for (const adRow of adRows) adsById.set(adRow.id, adRow);
  }

  res.json({
    requests: rows.map((row) =>
      toRequestResponse(row, row.ad_id ? adsById.get(row.ad_id) : undefined)
    ),
  });
});

router.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const { title, sizeNeeded, neededBy, notes, attachmentUrl } = req.body ?? {};
  if (!title) {
    return res.status(400).json({ error: "Title is required" });
  }

  const [result] = await pool.query(
    `INSERT INTO creative_requests (user_id, title, type, size_needed, needed_by, notes, status, attachment_url)
     VALUES (?, ?, 'New creative', ?, ?, ?, 'Open', ?)`,
    [
      req.userId,
      title,
      sizeNeeded ?? null,
      neededBy ?? null,
      notes ?? null,
      attachmentUrl ?? null,
    ]
  );

  const insertId = (result as { insertId: number }).insertId;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM creative_requests WHERE id = ?",
    [insertId]
  );
  const created = rows[0];
  if (!created) return res.status(500).json({ error: "Failed to create request" });
  res.status(201).json({ request: toRequestResponse(created) });
});

// Marks a request as delivered and links the finished ad, so it shows up as
// a card in the Delivered tab. No admin UI calls this yet — the app doesn't
// have an admin role built out — but it's a real, usable capability rather
// than a stub, ready for whenever a fulfilment flow is added.
router.post("/:id/deliver", requireAuth, async (req: AuthedRequest, res) => {
  const { adId } = req.body ?? {};
  if (!adId) return res.status(400).json({ error: "adId is required" });

  const [adRows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM ads WHERE slug = ?",
    [adId]
  );
  const ad = adRows[0];
  if (!ad) return res.status(404).json({ error: "Ad not found" });

  const [result] = await pool.query(
    `UPDATE creative_requests SET status = 'Delivered', ad_id = ?
     WHERE id = ? AND user_id = ?`,
    [ad.id, req.params.id, req.userId]
  );
  if ((result as { affectedRows: number }).affectedRows === 0) {
    return res.status(404).json({ error: "Request not found" });
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM creative_requests WHERE id = ?",
    [req.params.id]
  );
  const updated = rows[0];
  if (!updated) return res.status(500).json({ error: "Failed to update request" });
  res.json({ request: toRequestResponse(updated, ad) });
});

export default router;
