// Makes the watermarked copy (for unpaid users' downloads) of every ad that
// doesn't have one yet, so their first download doesn't wait for it. Only
// adds files: the clean images pages show are never changed. Safe to re-run.
//
//   npm run ads:watermark -- --dry-run   lists the ads, changing nothing
//   npm run ads:watermark                makes the copies
import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { watermarkedCopyOf } from "../lib/watermark.js";

const dryRun = process.argv.includes("--dry-run");

const ads = await prisma.ad.findMany({
  where: { photoUrl: { not: null }, watermarkedPhotoUrl: null },
  select: { id: true, slug: true, photoUrl: true, watermarkedPhotoUrl: true, imageFileName: true },
});
console.log(`${ads.length} ad(s) without a watermarked copy${dryRun ? " (dry run: nothing is changed)" : ""}`);

let done = 0;
for (const ad of ads) {
  if (dryRun) {
    console.log(`  ${ad.slug}: would make a watermarked copy of ${ad.photoUrl}`);
    continue;
  }
  try {
    await watermarkedCopyOf(ad);
    done++;
    console.log(`  ✓ ${ad.slug}`);
  } catch (err) {
    console.log(`  ✗ ${ad.slug}: ${(err as Error).message}`);
  }
}
if (!dryRun) console.log(`Done: ${done} of ${ads.length}.`);
await prisma.$disconnect();
