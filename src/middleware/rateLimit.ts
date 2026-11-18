import type { Request } from "express";
import { rateLimit, ipKeyGenerator, type Options } from "express-rate-limit";

// Per-visitor throttles for the public endpoints people (or bots) can hammer
// without signing in. Counts are kept in memory: the API runs as one process.
// The visitor's IP is req.ip, which is the real client address because
// index.ts trusts exactly one proxy (nginx) — a client-sent X-Forwarded-For
// can't change it.

const MINUTE = 60 * 1000;

function limiter(windowMs: number, limit: number, error: string, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // The frontend shows `error` from any failed response.
    message: { error },
    ...extra,
  });
}

const TOO_MANY_SIGN_INS = "Too many sign-in attempts. Please wait 15 minutes and try again.";

// Password guessing from one IP: only failed sign-ins count, so someone who
// signs in fine (or mistypes once or twice) is never held up.
export const loginIpLimiter = limiter(15 * MINUTE, 20, TOO_MANY_SIGN_INS, {
  skipSuccessfulRequests: true,
});

// Password guessing against one account from many IPs: failed sign-ins for
// the same email, whoever sends them.
export const loginEmailLimiter = limiter(15 * MINUTE, 10, TOO_MANY_SIGN_INS, {
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return email ? `email:${email}` : `ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
  },
});

// Mass fake sign-ups.
export const registerLimiter = limiter(
  60 * MINUTE,
  5,
  "Too many accounts created from this network. Please try again in an hour."
);

// Google sign-in: Google checks the credential, but it's still a public
// endpoint that creates accounts.
export const googleAuthLimiter = limiter(15 * MINUTE, 20, TOO_MANY_SIGN_INS);

// The public contact / "Request ads" form.
export const contactLimiter = limiter(
  10 * MINUTE,
  20,
  "Too many messages. Please try again in a few minutes."
);
