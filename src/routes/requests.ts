import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

const router = Router();

function toRequestResponse(row: RowDataPacket) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    sizeNeeded: row.size_needed ?? undefined,
    neededBy: row.needed_by ?? undefined,
    notes: row.notes ?? undefined,
    status: row.status,
    createdAt: row.created_at,
  };
}

router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM creative_requests WHERE user_id = ? ORDER BY created_at DESC",
    [req.userId]
  );
  res.json({ requests: rows.map(toRequestResponse) });
});

router.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const { title, sizeNeeded, neededBy, notes } = req.body ?? {};
  if (!title) {
    return res.status(400).json({ error: "Title is required" });
  }

  const [result] = await pool.query(
    `INSERT INTO creative_requests (user_id, title, type, size_needed, needed_by, notes, status)
     VALUES (?, ?, 'New creative', ?, ?, ?, 'Open')`,
    [req.userId, title, sizeNeeded ?? null, neededBy ?? null, notes ?? null]
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

export default router;
