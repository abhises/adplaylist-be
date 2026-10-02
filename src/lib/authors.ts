import type { Author } from "../generated/prisma/client.js";

// What an ad page shows about its curator or reviewer (the byline and the
// "About the curator" box). adCount is only known on the author routes.
export function toAuthorSummary(author: Author, adCount?: number) {
  return {
    id: author.id,
    slug: author.slug,
    name: author.name,
    jobTitle: author.jobTitle ?? undefined,
    credentials: author.credentials ?? undefined,
    bio: author.bio ?? undefined,
    photoUrl: author.photoUrl ?? undefined,
    linkedinUrl: author.linkedinUrl ?? undefined,
    websiteUrl: author.websiteUrl ?? undefined,
    adCount,
  };
}

export function slugifyName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 150)
    .replace(/-$/, "");
}
