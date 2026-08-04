/**
 * PASSWORDLESS SIGN-IN — token generation and hashing.
 *
 * ===========================================================================
 * WHY PASSWORDLESS
 *
 * The Brief describes this membership list as "a list of wealthy Abuja
 * residents and where they will be, and when… an attractive target". Storing
 * password hashes for those people creates an asset worth stealing, a reset
 * flow worth attacking, and a credential-reuse exposure we do not control.
 *
 * A magic link has none of those. It also suits the actual usage pattern — a
 * member signs in a few times a month, not several times a day — and the
 * transactional email path already exists and is already monitored, because
 * Flows A and B depend on it.
 *
 * ===========================================================================
 * THE THREE PROPERTIES THAT MAKE IT SAFE
 *
 * 1. HIGH ENTROPY. 32 random bytes. A sign-in link is a bearer credential:
 *    anyone holding it is the member, so it must not be guessable and must not
 *    be derived from anything about the account.
 *
 * 2. STORED HASHED. Only SHA-256 of the token is persisted. The raw value
 *    exists in the email and nowhere else. A dump of `auth_tokens` therefore
 *    grants nobody a session — which is the entire point of hashing something
 *    that functions as a password.
 *
 *    SHA-256 rather than a slow KDF is correct HERE and would be wrong for a
 *    password: the input is 256 bits of uniform randomness, so there is no
 *    dictionary to attack and nothing for bcrypt's work factor to buy.
 *
 * 3. SHORT-LIVED AND SINGLE-USE. Fifteen minutes, consumed on redemption.
 *    Email is not a secure channel — it sits in inboxes, forwards, and backups
 *    — so the window in which a leaked link is useful must be small.
 *
 * Web Crypto throughout rather than `node:crypto`, for the same reason as the
 * Paystack signature check: nothing here depends on a Node-specific API, so
 * the hosting decision stays reversible.
 */

/** Sign-in links expire quickly. Email is not a secure channel. */
export const AUTH_TOKEN_TTL_MS = 15 * 60_000;

/**
 * Sessions last 30 days. Long enough that a member checking their league
 * weekly is not re-authenticating every visit; short enough that a stolen
 * cookie is not indefinite. Refreshed on use — see session.ts.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

/** How many sign-in links one address may request per window. */
export const AUTH_REQUEST_LIMIT = { limit: 5, windowMs: 15 * 60_000 };

/**
 * A URL-safe bearer token. 32 bytes ≈ 256 bits.
 *
 * base64url so it survives an email client, a copy-paste and a query string
 * without escaping. No padding, so there is no trailing `=` for a link
 * detector to truncate — a real cause of "the link doesn't work" reports.
 */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** SHA-256, hex. What goes in the database; never the raw token. */
export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Canonical form of an email for storage and lookup.
 *
 * Trim and lowercase only. Deliberately NOT stripping dots or `+tags`: that
 * behaviour is specific to Gmail, and applying it universally silently merges
 * distinct accounts on providers that treat those characters as significant.
 * Two members would end up sharing one identity, which is a far worse outcome
 * than a duplicate row.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Wall-clock expiry for a newly issued sign-in token. */
export const authTokenExpiry = (now: Date = new Date()): Date =>
  new Date(now.getTime() + AUTH_TOKEN_TTL_MS);

export const sessionExpiry = (now: Date = new Date()): Date =>
  new Date(now.getTime() + SESSION_TTL_MS);

/**
 * Whether a stored token may still be redeemed.
 *
 * Both conditions are also expressed in the redemption UPDATE's WHERE clause —
 * the HTTP driver has no multi-statement transactions, so a read-then-write
 * check here would be a race that lets one link be redeemed twice. This
 * function is for reporting the reason, not for guarding the write.
 */
export function tokenRedeemable(
  token: { expiresAt: Date; consumedAt: Date | null },
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: "expired" | "already-used" } {
  if (token.consumedAt !== null) return { ok: false, reason: "already-used" };
  if (token.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}
