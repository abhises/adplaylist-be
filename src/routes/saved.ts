import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { toAdResponse } from "./ads.js";

const router = Router();

router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const saved = await prisma.savedAd.findMany({
    where: { userId: req.userId! },
    include: { ad: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ ads: saved.map((s) => toAdResponse(s.ad)) });
});

router.post("/:slug", requireAuth, async (req: AuthedRequest, res) => {
  const ad = await prisma.ad.findUnique({ where: { slug: String(req.params.slug) } });
  if (!ad) return res.status(404).json({ error: "Ad not found" });

  await prisma.savedAd.upsert({
    where: { userId_adId: { userId: req.userId!, adId: ad.id } },
    update: {},
    create: { userId: req.userId!, adId: ad.id },
  });
  res.status(201).json({ saved: true });
});

router.delete("/:slug", requireAuth, async (req: AuthedRequest, res) => {
  const ad = await prisma.ad.findUnique({ where: { slug: String(req.params.slug) } });
  if (ad) {
    await prisma.savedAd.deleteMany({
      where: { userId: req.userId!, adId: ad.id },
    });
  }
  res.json({ saved: false });
});

export default router;
