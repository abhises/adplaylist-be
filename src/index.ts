import "dotenv/config";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import adsRoutes from "./routes/ads.js";
import savedRoutes from "./routes/saved.js";
import requestsRoutes from "./routes/requests.js";
import profileRoutes from "./routes/profile.js";
import uploadsRoutes from "./routes/uploads.js";
import adminRoutes from "./routes/admin.js";
import brandPagesRoutes from "./routes/brandPages.js";
import tagsRoutes from "./routes/tags.js";
import blogPostsRoutes from "./routes/blogPosts.js";
import feedbackRoutes from "./routes/feedback.js";
import authorsRoutes from "./routes/authors.js";
import contactRoutes from "./routes/contact.js";
import billingRoutes, { webhookHandler as stripeWebhook } from "./routes/billing.js";
import plansRoutes from "./routes/plans.js";
import { Prisma } from "./generated/prisma/client.js";
import { prisma, waitForDatabase } from "./lib/prisma.js";
import { ensureStorage, STORAGE_DRIVER } from "./lib/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim());
app.use(cors({ origin: corsOrigins }));
// Before express.json(): Stripe's signature check needs the raw body.
app.post("/api/billing/webhook", ...stripeWebhook);
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Cloudways puts Varnish in front of the API and caches GET responses, so
// unauthenticated reads (e.g. the frontend server rendering /brands/:slug)
// kept getting a stale copy after an admin edited the data. API responses
// are always live data, so tell every cache not to store them.
app.use("/api", (_req: Request, res: Response, next: NextFunction) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.get("/api/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok", message: "Backend is running" });
});

let dbReady = false;
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/health" || dbReady) return next();
  res.status(503).json({ error: "Server is starting up, please retry shortly" });
});

app.use("/api/auth", authRoutes);
app.use("/api/ads", adsRoutes);
app.use("/api/saved", savedRoutes);
app.use("/api/requests", requestsRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/uploads", uploadsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/tags", tagsRoutes);
app.use("/api/blog-posts", blogPostsRoutes);
app.use("/api/brand-pages", brandPagesRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/authors", authorsRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/plans", plansRoutes);

// Database errors caused by what the client sent get a real status and a
// message they can act on; anything else stays a generic 500.
function clientFacingError(err: unknown): { status: number; error: string } | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;
  switch (err.code) {
    case "P2000": {
      const column = /Column: (\w+)/.exec(err.message)?.[1];
      return {
        status: 400,
        error: column ? `${column} is too long` : "A value is too long",
      };
    }
    case "P2002":
      return { status: 409, error: "That already exists" };
    case "P2025":
      return { status: 404, error: "Not found" };
    default:
      return null;
  }
}

app.use(
  (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    // pm2's logs carry no timestamps or request info, so start every error
    // with one line that has both, plus an id the client also receives —
    // quoting it finds the exact entry in the error log.
    const errorId = randomUUID().slice(0, 8);
    const known = clientFacingError(err);
    console.error(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${known?.status ?? 500} (error ${errorId})`
    );
    console.error(err);
    res
      .status(known?.status ?? 500)
      .json({ error: known?.error ?? "Internal server error", errorId });
  }
);

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  try {
    await waitForDatabase();
    dbReady = true;
    console.log("Connected to MySQL database");
  } catch (err) {
    console.error("Failed to connect to MySQL database after retries:", err);
  }
  try {
    await ensureStorage();
    console.log(`Storage ready (${STORAGE_DRIVER})`);
  } catch (err) {
    console.error(`Failed to set up storage (${STORAGE_DRIVER}):`, err);
  }
});
