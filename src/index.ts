import "dotenv/config";
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

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000" }));
app.use(express.json());

app.get("/api/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok", message: "Backend is running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/ads", adsRoutes);
app.use("/api/saved", savedRoutes);
app.use("/api/requests", requestsRoutes);
app.use("/api/profile", profileRoutes);

app.use(
  (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
