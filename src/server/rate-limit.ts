/**
 * RATE LIMITING — first line only.
 *
 * A fixed-window counter held in module memory. Cheap, dependency-free, and
 * enough to stop a naive script hammering the application endpoint.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT
 *
 * It is NOT a distributed rate limiter, and it must not be mistaken for one.
 * Module memory is per-instance: on a serverless or edge host, each cold start
 * gets its own empty map, and concurrent instances do not share counts. An
 * attacker with a spread of source addresses, or enough concurrency to fan out
 * across instances, walks straight through it.
 *
 * The real protection for this site should sit in front of the application, at
 * the CDN — Cloudflare rate limiting rules, or an equivalent WAF. That is also
 * where bot scoring and IP reputation live. Turnstile (see turnstile.ts) is the
 * second layer, and it is the one that actually raises the cost of automation.
 *
 * Recorded here rather than in a ticket because a limiter that looks like
 * protection is worse than none: it invites the assumption that the endpoint is
 * covered.
 * ---------------------------------------------------------------------------
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/** Bound the map so a spray of unique keys cannot grow it without limit. */
const MAX_KEYS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the window resets. For the Retry-After header. */
  retryAfter: number;
};

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_KEYS) sweep(now);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  existing.count += 1;

  if (existing.count > limit) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return { allowed: true, retryAfter: 0 };
}

function sweep(now: number) {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  /* Still full of live windows — drop the oldest rather than grow unbounded. */
  if (windows.size >= MAX_KEYS) {
    const oldest = [...windows.entries()]
      .sort((a, b) => a[1].resetAt - b[1].resetAt)
      .slice(0, Math.floor(MAX_KEYS / 4));
    for (const [key] of oldest) windows.delete(key);
  }
}

/**
 * Best-effort client identity.
 *
 * `x-forwarded-for` is trivially spoofable in general, but behind a CDN that
 * rewrites it, the leftmost entry is the one the edge observed. Any host we
 * deploy to must terminate at a proxy that sets this — a direct-to-origin
 * deployment would need a different source of truth.
 */
export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    "unknown";
  return `${scope}:${ip}`;
}

/**
 * Limits per endpoint. Intake endpoints are generous per window, because a
 * genuine applicant who mistypes an email and resubmits four times must not be
 * locked out of the primary conversion event on the site.
 */
export const LIMITS = {
  application: { limit: 8, windowMs: 10 * 60_000 },
  groupEnquiry: { limit: 8, windowMs: 10 * 60_000 },
  waitlist: { limit: 6, windowMs: 10 * 60_000 },
  booking: { limit: 12, windowMs: 10 * 60_000 },
} as const;

/** Exposed for tests. */
export function __resetRateLimits() {
  windows.clear();
}
