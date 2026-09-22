import "dotenv/config";
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
import { prisma } from "./lib/prisma.js";
import { ensureUploadsBucket } from "./lib/supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim());
app.use(cors({ origin: corsOrigins }));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.get("/api/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok", message: "Backend is running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/ads", adsRoutes);
app.use("/api/saved", savedRoutes);
app.use("/api/requests", requestsRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/uploads", uploadsRoutes);
app.use("/api/admin", adminRoutes);

app.use(
  (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
);

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("Connected to MySQL database");
  } catch (err) {
    console.error("Failed to connect to MySQL database:", err);
  }
  try {
    await ensureUploadsBucket();
    console.log(`Supabase storage bucket ready`);
  } catch (err) {
    console.error("Failed to set up Supabase storage bucket:", err);
  }
});
