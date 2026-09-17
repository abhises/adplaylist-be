import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

const router = Router();

export function toAdResponse(row: RowDataPacket) {
  return {
    id: row.slug,
    title: row.title,
    format: row.format,
    variant: row.variant,
    eyebrow: row.eyebrow ?? undefined,
    headline: row.headline,
    sub: row.sub ?? undefined,
    cta: row.cta ?? undefined,
    badge: row.badge ?? undefined,
    mediaType: row.media_type,
    swatch: row.swatch,
    light: !!row.light,
    category: row.category,
    market: row.market,
    language: row.language,
    photo: row.photo_url ?? undefined,
    platforms: row.platforms ? row.platforms.split(",") : [],
    createdAt: row.created_at,
  };
}

router.get("/", async (req, res) => {
  const { category, market, language, mediaType, platform, q } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (typeof category === "string" && category) {
    conditions.push("category = ?");
    params.push(category);
  }
  if (typeof market === "string" && market) {
    conditions.push("market = ?");
    params.push(market);
  }
  if (typeof language === "string" && language) {
    conditions.push("language = ?");
    params.push(language);
  }
  if (typeof mediaType === "string" && mediaType) {
    conditions.push("media_type = ?");
    params.push(mediaType);
  }
  if (typeof platform === "string" && platform) {
    conditions.push("FIND_IN_SET(?, platforms)");
    params.push(platform);
  }
  if (typeof q === "string" && q) {
    conditions.push("(title LIKE ? OR headline LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM ads ${where} ORDER BY id ASC`,
    params
  );
  res.json({ ads: rows.map(toAdResponse) });
});

router.get("/:slug", async (req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM ads WHERE slug = ?",
    [req.params.slug]
  );
  const ad = rows[0];
  if (!ad) return res.status(404).json({ error: "Ad not found" });
  res.json({ ad: toAdResponse(ad) });
});

router.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const {
    title,
    format,
    variant,
    eyebrow,
    headline,
    sub,
    cta,
    badge,
    mediaType,
    swatch,
    light,
    category,
    market,
    language,
    photo,
    platforms,
  } = req.body ?? {};

  if (!title || !headline || !category || !market) {
    return res.status(400).json({
      error: "title, headline, category, and market are required",
    });
  }

  const slug = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  try {
    await pool.query(
      `INSERT INTO ads
        (slug, title, format, variant, eyebrow, headline, sub, cta, badge, media_type, swatch, light, category, market, language, photo_url, platforms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        slug,
        title,
        format ?? "Feed 1:1",
        variant ?? "overlay",
        eyebrow ?? null,
        headline,
        sub ?? null,
        cta ?? null,
        badge ?? null,
        mediaType ?? "image",
        swatch ?? "bg-neutral-800",
        light ? 1 : 0,
        category,
        market,
        language ?? "English (EN)",
        photo ?? null,
        Array.isArray(platforms) ? platforms.join(",") : "",
      ]
    );
  } catch (err) {
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "An ad with that name already exists" });
    }
    throw err;
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM ads WHERE slug = ?",
    [slug]
  );
  const created = rows[0];
  if (!created) return res.status(500).json({ error: "Failed to create ad" });
  res.status(201).json({ ad: toAdResponse(created) });
});

export default router;
