import { prisma } from "./prisma.js";

// Ads keep their tags in one comma-separated column (ads.tags).
export function splitTags(value: string | null): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

export function joinTags(tags: string[]): string | null {
  return tags.length ? tags.join(",") : null;
}

// Returns an ad's tags spelled the way the tag list spells them ("Lead Gen"
// becomes "lead gen"), adding any the list doesn't have yet so it stays the
// full set designers pick from.
export async function resolveTags(names: unknown): Promise<string[]> {
  if (!Array.isArray(names) || !names.length) return [];
  const known = await prisma.tag.findMany({ select: { name: true } });
  const byLower = new Map(known.map((t) => [t.name.toLowerCase(), t.name]));
  const resolved: string[] = [];
  const missing: string[] = [];
  for (const raw of names as string[]) {
    const name = byLower.get(raw.toLowerCase()) ?? raw;
    if (!byLower.has(raw.toLowerCase())) {
      missing.push(name);
      byLower.set(raw.toLowerCase(), name);
    }
    if (!resolved.includes(name)) resolved.push(name);
  }
  if (missing.length) {
    await prisma.tag.createMany({
      data: missing.map((name) => ({ name })),
      skipDuplicates: true,
    });
  }
  return resolved;
}

// Rewrites every ad carrying `from` (matched case-insensitively): renamed to
// `to`, or removed when `to` is null.
export async function replaceTagOnAds(
  tx: Pick<typeof prisma, "ad">,
  from: string,
  to: string | null
) {
  const ads = await tx.ad.findMany({
    where: { tags: { contains: from } },
    select: { id: true, tags: true },
  });
  const target = from.toLowerCase();
  for (const ad of ads) {
    const current = splitTags(ad.tags);
    if (!current.some((t) => t.toLowerCase() === target)) continue;
    const next = [
      ...new Set(
        current.flatMap((t) => (t.toLowerCase() === target ? (to ? [to] : []) : [t]))
      ),
    ];
    await tx.ad.update({ where: { id: ad.id }, data: { tags: joinTags(next) } });
  }
}
