// Bakes the ADPLAYLIST watermark into every published ad's image that
// doesn't have it yet (ads from before watermarking). The clean image is
// kept as the ad's original. Safe to re-run: ads already watermarked are
// skipped, and one that fails is left unchanged and reported.
//
//   npm run ads:watermark
import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { publishWatermarked } from "../lib/watermark.js";

const ads = await prisma.ad.findMany({
  where: { photoUrl: { not: null }, originalPhotoUrl: null },
  select: { id: true, slug: true, photoUrl: true, imageFileName: true },
});
console.log(`${ads.length} ad(s) to watermark`);

let done = 0;
for (const ad of ads) {
  try {
    const watermarked = await publishWatermarked(ad.photoUrl!, ad.imageFileName || ad.slug);
    await prisma.ad.update({
      where: { id: ad.id },
      data: { photoUrl: watermarked, originalPhotoUrl: ad.photoUrl },
    });
    done++;
    console.log(`  ✓ ${ad.slug}`);
  } catch (err) {
    console.log(`  ✗ ${ad.slug}: ${(err as Error).message}`);
  }
}
console.log(`Watermarked ${done} of ${ads.length}.`);
await prisma.$disconnect();
