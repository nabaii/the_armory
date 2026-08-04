import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Member } from "@/db/schema";
import { SESSION_TTL_MS, generateToken } from "@/server/auth/tokens";
import {
  createSession,
  deleteSession,
  findSession,
  refreshSession,
} from "@/server/auth/repository";
import { isDatabaseConfigured } from "@/db/client";
import { routes } from "@/lib/site";

/**
 * SESSION COOKIE HANDLING.
 *
 * The cookie holds a random secret; the database holds its SHA-256. Nothing
 * about the member is encoded in it — no id, no email, no status. A session
 * cookie is a lookup key, not a claim, so it cannot be tampered into being
 * someone else and it reveals nothing if it leaks into a log or a screenshot.
 *
 * That also means membership status is read fresh from the database on every
 * request. A member who lapses, or is upgraded to founding, takes effect
 * immediately rather than at their next sign-in — which matters because status
 * gates captaincy, the club ladder and the season cap.
 */

const COOKIE = "armory_session";

const cookieOptions = {
  httpOnly: true,
  /* No JavaScript path to the session token, so an XSS bug cannot exfiltrate it. */
  sameSite: "lax" as const,
  /* `lax` rather than `strict`: the sign-in link arrives from an email client,
     which is a cross-site top-level navigation. `strict` would drop the cookie
     on exactly the journey that creates it. */
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: Math.floor(SESSION_TTL_MS / 1000),
};

/** Issue a fresh session and set the cookie. Called only after a redeemed token. */
export async function startSession(memberId: string): Promise<void> {
  const raw = generateToken();
  await createSession(raw, memberId);
  const jar = await cookies();
  jar.set(COOKIE, raw, cookieOptions);
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (raw) {
    /* Delete server-side first. Clearing only the cookie would leave a live
       session row that a copied token could still use. */
    await deleteSession(raw).catch(() => undefined);
  }
  jar.delete(COOKIE);
}

/**
 * The current member, or null.
 *
 * Returns null rather than throwing when the database is unconfigured, so the
 * Phase 1 marketing site — which has no database and no accounts — keeps
 * working untouched.
 */
export async function getMember(): Promise<Member | null> {
  if (!isDatabaseConfigured()) return null;

  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;

  const session = await findSession(raw);
  if (!session) return null;

  /* Rolling expiry, but only past the halfway point. Refreshing on every
     request would add a write to every authenticated page load. */
  if (shouldRefresh(session.expiresAt)) {
    await refreshSession(session.id).catch(() => undefined);
  }

  return session.member;
}

export function shouldRefresh(expiresAt: Date, now: Date = new Date()): boolean {
  const remaining = expiresAt.getTime() - now.getTime();
  return remaining < SESSION_TTL_MS / 2;
}

/**
 * Guard for member-only pages. Redirects to sign-in, carrying the intended
 * destination so the member lands where they were going rather than on a
 * generic home page after authenticating.
 */
export async function requireMember(returnTo?: string): Promise<Member> {
  const member = await getMember();
  if (member) return member;

  const target = returnTo
    ? `${routes.signIn}?next=${encodeURIComponent(returnTo)}`
    : routes.signIn;
  redirect(target);
}

/**
 * Where to send someone after signing in.
 *
 * Only relative, single-slash paths are accepted. An open redirect on a
 * sign-in flow is a phishing primitive: `?next=https://evil.example` would let
 * an attacker send a genuine Armory sign-in link that lands the member
 * somewhere else entirely, with the club's domain in the sending address.
 */
export function safeReturnTo(next: string | undefined | null): string {
  if (!next) return routes.portal;
  if (!next.startsWith("/")) return routes.portal;
  /* `//evil.example` and `/\evil.example` are protocol-relative URLs. */
  if (next.startsWith("//") || next.startsWith("/\\")) return routes.portal;
  return next;
}
