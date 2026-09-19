import "dotenv/config";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import { pool } from "./pool.js";

const PLATFORM_OPTIONS = "META,Google,TikTok,LinkedIn";

const ADS = [
  {
    slug: "long-walk-home",
    title: "Long Walk Home",
    format: "Feed 1:1",
    variant: "overlay",
    eyebrow: "Spring drop",
    headline: "Built for the long walk home.",
    sub: null,
    cta: "Shop now",
    badge: null,
    mediaType: "image",
    swatch: "bg-gradient-to-b from-neutral-700 via-neutral-800 to-black",
    light: false,
    category: "E-commerce / DTC",
    market: "UK",
    photo: "https://picsum.photos/seed/adplaylist-long-walk-home/800/1000",
    editable: true,
    dominantColor: "Black",
    videoLength: null,
  },
  {
    slug: "members-weekend",
    title: "Members Weekend",
    format: "Poster",
    variant: "overlay",
    eyebrow: null,
    headline: "30% off",
    sub: "Ends Sunday. Members only.",
    cta: null,
    badge: null,
    mediaType: "image",
    swatch: "bg-brand",
    light: false,
    category: "E-commerce / DTC",
    market: "UK",
    photo: null,
    editable: true,
    dominantColor: "Red",
    videoLength: null,
  },
  {
    slug: "season-two",
    title: "Season Two",
    format: "Photo lockup",
    variant: "lockup",
    eyebrow: null,
    headline: "New season, same boots.",
    sub: "Free returns for 60 days",
    cta: null,
    badge: null,
    mediaType: "image",
    swatch: "bg-gradient-to-b from-neutral-400 to-neutral-500",
    light: false,
    category: "E-commerce / DTC",
    market: "UK",
    photo: "https://picsum.photos/seed/adplaylist-season-two/800/600",
    editable: false,
    dominantColor: "Grey",
    videoLength: null,
  },
  {
    slug: "flash-sale",
    title: "Flash Sale",
    format: "Story set",
    variant: "overlay",
    eyebrow: null,
    headline: "Two days. Then it's gone.",
    sub: null,
    cta: null,
    badge: "Story · 9:16",
    mediaType: "image",
    swatch: "bg-neutral-200",
    light: true,
    category: "E-commerce / DTC",
    market: "UK",
    photo: null,
    editable: true,
    dominantColor: "White",
    videoLength: null,
  },
  {
    slug: "six-weeks",
    title: "Six Weeks",
    format: "Bumper 15s",
    variant: "overlay",
    eyebrow: null,
    headline: "Six weeks of rain. One pair.",
    sub: "Bumper · sound off",
    cta: null,
    badge: "0:15",
    mediaType: "video",
    swatch: "bg-gradient-to-br from-neutral-800 to-black",
    light: false,
    category: "E-commerce / DTC",
    market: "UK",
    photo: "https://picsum.photos/seed/adplaylist-six-weeks/800/1000",
    editable: false,
    dominantColor: "Black",
    videoLength: "6–15s",
  },
  {
    slug: "fleur-serum",
    title: "Fleur Serum",
    format: "Feed 1:1",
    variant: "overlay",
    eyebrow: "New formula",
    headline: "Ten drops. One week.",
    sub: null,
    cta: "Try it",
    badge: null,
    mediaType: "image",
    swatch: "bg-gradient-to-br from-pink-300 to-rose-400",
    light: false,
    category: "Beauty & Skincare",
    market: "DE",
    photo: "https://picsum.photos/seed/adplaylist-fleur-serum/800/1000",
    editable: true,
    dominantColor: "Pink",
    videoLength: null,
  },
  {
    slug: "night-routine",
    title: "Night Routine",
    format: "Story set",
    variant: "overlay",
    eyebrow: null,
    headline: "Three steps before bed.",
    sub: null,
    cta: null,
    badge: "Story · 9:16",
    mediaType: "image",
    swatch: "bg-gradient-to-b from-violet-400 to-indigo-600",
    light: false,
    category: "Beauty & Skincare",
    market: "DE",
    photo: "https://picsum.photos/seed/adplaylist-night-routine/800/1000",
    editable: true,
    dominantColor: "Purple",
    videoLength: null,
  },
  {
    slug: "glow-test",
    title: "Glow Test",
    format: "Reel 30s",
    variant: "overlay",
    eyebrow: null,
    headline: "We tested it for 30 nights.",
    sub: "Reel · captions on",
    cta: null,
    badge: "0:30",
    mediaType: "video",
    swatch: "bg-gradient-to-br from-fuchsia-300 to-pink-500",
    light: false,
    category: "Beauty & Skincare",
    market: "DE",
    photo: "https://picsum.photos/seed/adplaylist-glow-test/800/1000",
    editable: true,
    dominantColor: "Pink",
    videoLength: "15–30s",
  },
  {
    slug: "refill-club",
    title: "Refill Club",
    format: "Poster",
    variant: "overlay",
    eyebrow: null,
    headline: "Refill & save",
    sub: "Two bottles, one price.",
    cta: null,
    badge: null,
    mediaType: "image",
    swatch: "bg-gradient-to-br from-emerald-500 to-green-700",
    light: false,
    category: "Beauty & Skincare",
    market: "NL",
    photo: null,
    editable: true,
    dominantColor: "Green",
    videoLength: null,
  },
  {
    slug: "northbank-savings",
    title: "Northbank Savings",
    format: "Feed 1:1",
    variant: "overlay",
    eyebrow: "Fixed rate",
    headline: "4.2% and it stays there.",
    sub: null,
    cta: "Open account",
    badge: null,
    mediaType: "image",
    swatch: "bg-gradient-to-b from-slate-700 to-slate-900",
    light: false,
    category: "Finance & Fintech",
    market: "UK",
    photo: "https://picsum.photos/seed/adplaylist-northbank-savings/800/1000",
    editable: true,
    dominantColor: "Blue",
    videoLength: null,
  },
  {
    slug: "rift-nine",
    title: "Rift Nine",
    format: "Launch 1:1",
    variant: "overlay",
    eyebrow: "Season nine",
    headline: "The rift opens tonight.",
    sub: null,
    cta: "Play free",
    badge: null,
    mediaType: "image",
    swatch: "bg-gradient-to-br from-purple-800 via-purple-900 to-black",
    light: false,
    category: "Gaming & Creator",
    market: "US",
    photo: "https://picsum.photos/seed/adplaylist-rift-nine/800/1000",
    editable: true,
    dominantColor: "Purple",
    videoLength: null,
  },
  {
    slug: "vitalis-sleep",
    title: "Vitalis Sleep",
    format: "Feed 1:1",
    variant: "overlay",
    eyebrow: "Sleep study",
    headline: "Asleep in nineteen minutes.",
    sub: null,
    cta: "See the study",
    badge: null,
    mediaType: "image",
    swatch: "bg-gradient-to-b from-sky-700 to-blue-950",
    light: false,
    category: "Health & Fitness",
    market: "US",
    photo: "https://picsum.photos/seed/adplaylist-vitalis-sleep/800/1000",
    editable: true,
    dominantColor: "Blue",
    videoLength: null,
  },
  {
    slug: "cadence-launch",
    title: "Cadence Launch",
    format: "Feed 1:1",
    variant: "overlay",
    eyebrow: "Now shipping",
    headline: "Plan the quarter in an hour.",
    sub: null,
    cta: "Book a demo",
    badge: null,
    mediaType: "image",
    swatch: "bg-gradient-to-br from-teal-600 to-cyan-800",
    light: false,
    category: "SaaS & Tech",
    market: "US",
    photo: "https://picsum.photos/seed/adplaylist-cadence-launch/800/1000",
    editable: true,
    dominantColor: "Black",
    videoLength: null,
  },
  {
    slug: "clean-shelf",
    title: "Clean Shelf",
    format: "Photo lockup",
    variant: "lockup",
    eyebrow: null,
    headline: "Nothing you can't pronounce.",
    sub: "Vegan, refillable, unscented",
    cta: null,
    badge: null,
    mediaType: "image",
    swatch: "bg-neutral-300",
    light: false,
    category: "Beauty & Skincare",
    market: "NL",
    photo: "https://picsum.photos/seed/adplaylist-clean-shelf/800/600",
    editable: false,
    dominantColor: "Grey",
    videoLength: null,
  },
];

async function seed() {
  console.log("Seeding database...");

  const passwordHash = await bcrypt.hash("password123", 10);
  await pool.query(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name)`,
    ["anna.smith@atlasmedia.co", passwordHash, "Anna Smith"]
  );

  for (const ad of ADS) {
    await pool.query(
      `INSERT INTO ads
        (slug, title, format, variant, eyebrow, headline, sub, cta, badge, media_type, swatch, light, category, market, language, photo_url, platforms, editable, dominant_color, video_length)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        title = VALUES(title), format = VALUES(format), variant = VALUES(variant),
        eyebrow = VALUES(eyebrow), headline = VALUES(headline), sub = VALUES(sub),
        cta = VALUES(cta), badge = VALUES(badge), media_type = VALUES(media_type),
        swatch = VALUES(swatch), light = VALUES(light), category = VALUES(category),
        market = VALUES(market), language = VALUES(language), photo_url = VALUES(photo_url),
        platforms = VALUES(platforms), editable = VALUES(editable),
        dominant_color = VALUES(dominant_color), video_length = VALUES(video_length)`,
      [
        ad.slug,
        ad.title,
        ad.format,
        ad.variant,
        ad.eyebrow,
        ad.headline,
        ad.sub,
        ad.cta,
        ad.badge,
        ad.mediaType,
        ad.swatch,
        ad.light ? 1 : 0,
        ad.category,
        ad.market,
        "English (EN)",
        ad.photo,
        PLATFORM_OPTIONS,
        ad.editable ? 1 : 0,
        ad.dominantColor,
        ad.videoLength,
      ]
    );
  }

  const [userRows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM users WHERE email = ?",
    ["anna.smith@atlasmedia.co"]
  );
  const userId = userRows[0]?.id;
  if (userId === undefined) throw new Error("Seeded user not found");

  const [adRows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM ads WHERE slug = ?",
    ["members-weekend"]
  );
  const membersWeekendId = adRows[0]?.id;
  if (membersWeekendId === undefined) throw new Error("Seeded ad not found");
  await pool.query(
    "INSERT IGNORE INTO saved_ads (user_id, ad_id) VALUES (?, ?)",
    [userId, membersWeekendId]
  );

  const [countRows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) as count FROM creative_requests WHERE user_id = ?",
    [userId]
  );
  const requestCount = countRows[0]?.count ?? 0;
  if (requestCount === 0) {
    await pool.query(
      `INSERT INTO creative_requests (user_id, title, type, size_needed, needed_by, status)
       VALUES
        (?, 'Long Walk Home in 728 x 90', 'New size', '728 x 90', '2026-09-18', 'In design'),
        (?, 'Members Weekend — Swedish copy', 'Localisation', NULL, '2026-09-22', 'Awaiting brief'),
        (?, 'Autumn boot range — story set', 'New creative', '1080 x 1920', '2026-09-30', 'In review')`,
      [userId, userId, userId]
    );
  }

  // A delivered example so the Requests page's Delivered tab has something
  // real to render (a request that resulted in an existing library ad),
  // added separately/idempotently since it postdates the block above.
  const [deliveredRows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM creative_requests WHERE user_id = ? AND title = ?",
    [userId, "Long Walk Home — hero banner"]
  );
  if (deliveredRows.length === 0) {
    const [heroAdRows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM ads WHERE slug = ?",
      ["long-walk-home"]
    );
    const heroAdId = heroAdRows[0]?.id;
    if (heroAdId === undefined) throw new Error("Seeded ad not found");
    await pool.query(
      `INSERT INTO creative_requests (user_id, title, type, size_needed, needed_by, status, ad_id)
       VALUES (?, 'Long Walk Home — hero banner', 'New creative', '1080 x 1080', '2026-09-05', 'Delivered', ?)`,
      [userId, heroAdId]
    );
  }

  console.log(`Seeded 1 user and ${ADS.length} ads.`);
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
