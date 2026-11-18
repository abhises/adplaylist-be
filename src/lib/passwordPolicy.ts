import { createHash } from "node:crypto";

// Rules for a new password, on top of the 8–128 length the schemas check.
// Returns what's wrong with it, or null when it's fine.
export async function passwordProblem(password: string, email?: string) {
  const lower = password.toLowerCase();
  if (email && lower === email.trim().toLowerCase()) {
    return "Your password can't be your email address.";
  }
  if (new Set(password).size < 4) {
    return "That password is too easy to guess. Use a mix of different characters.";
  }
  if (await isBreached(password)) {
    return "This password has appeared in a known data breach, so it isn't safe. Please choose a different one.";
  }
  return null;
}

// Checks Have I Been Pwned's list of leaked passwords without revealing the
// password: only the first 5 characters of its SHA-1 hash are sent
// (k-anonymity), and the match is made here. If the service is slow or down
// the password is allowed rather than blocking sign-up.
async function isBreached(password: string) {
  const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "adplaylist-api" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split("\n").some((line) => {
      const [rest, count] = line.trim().split(":");
      return rest === suffix && Number(count) > 0;
    });
  } catch (err) {
    console.warn("[password] breach check unavailable:", err instanceof Error ? err.message : err);
    return false;
  }
}
