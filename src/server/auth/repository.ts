import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { authTokens, members, sessions, type Member } from "@/db/schema";
import {
  authTokenExpiry,
  hashToken,
  normaliseEmail,
  sessionExpiry,
} from "@/server/auth/tokens";

/**
 * AUTH PERSISTENCE.
 *
 * ===========================================================================
 * THE CONSTRAINT THAT SHAPES THIS FILE
 *
 * The Neon HTTP driver has no multi-statement transactions — a deliberate
 * trade for runtime portability (see src/db/client.ts). That makes the obvious
 * implementation of token redemption a race:
 *
 *     const token = await find(hash);        // ← two clicks both reach here
 *     if (token.consumedAt) reject();        // ← both see null
 *     await markConsumed(token.id);          // ← both proceed
 *
 * Two rapid clicks on the same email link — or a double-submit, or a retry —
 * would each mint a session. So redemption is expressed as a SINGLE statement
 * whose WHERE clause carries the guard, and which returns a row only if it was
 * the one that actually changed it. Postgres makes that atomic for free.
 *
 * The rule generalises: anywhere a check-then-write would race, put the check
 * in the WHERE clause and let the row count be the answer.
 * ===========================================================================
 */

/* ---------------------------------------------------------------------------
   MEMBERS
   -------------------------------------------------------------------------- */

export async function findMemberByEmail(email: string): Promise<Member | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(members)
    .where(eq(members.email, normaliseEmail(email)))
    .limit(1);
  return row ?? null;
}

export async function findMemberById(id: string): Promise<Member | null> {
  const db = getDb();
  const [row] = await db.select().from(members).where(eq(members.id, id)).limit(1);
  return row ?? null;
}

/* ---------------------------------------------------------------------------
   SIGN-IN TOKENS
   -------------------------------------------------------------------------- */

/**
 * Issue a sign-in token for an address.
 *
 * Stores only the HASH — the raw token exists in the email and nowhere else.
 * Deliberately does NOT require a member to exist: an unknown address gets a
 * token row too, so that requesting a link for a non-member is indistinguishable
 * from requesting one for a member. Account enumeration on a private club's
 * membership list is a real disclosure, not a theoretical one.
 */
export async function issueAuthToken(
  rawToken: string,
  email: string,
): Promise<void> {
  const db = getDb();
  await db.insert(authTokens).values({
    tokenHash: await hashToken(rawToken),
    email: normaliseEmail(email),
    expiresAt: authTokenExpiry(),
  });
}

export type RedeemResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid-or-used-or-expired" };

/**
 * Redeem a sign-in token. Atomic, single-use, and safe against concurrent
 * clicks.
 *
 * The UPDATE only matches a row that is unconsumed and unexpired, and sets
 * `consumedAt` in the same statement. A second concurrent attempt matches zero
 * rows and gets nothing back.
 *
 * The failure reason is deliberately not distinguished. "Expired" versus
 * "already used" versus "never existed" tells an attacker holding a stale link
 * which of those it is; the member is told the same thing either way — request
 * a new link.
 */
export async function redeemAuthToken(rawToken: string): Promise<RedeemResult> {
  const db = getDb();
  const tokenHash = await hashToken(rawToken);

  const rows = await db
    .update(authTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, tokenHash),
        isNull(authTokens.consumedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .returning({ email: authTokens.email });

  if (rows.length === 0) return { ok: false, reason: "invalid-or-used-or-expired" };
  return { ok: true, email: rows[0].email };
}

/**
 * Housekeeping. Consumed and expired tokens have no purpose and are a standing
 * liability — they associate an email address with a moment in time.
 */
export async function purgeStaleAuthTokens(): Promise<number> {
  const db = getDb();
  const rows = await db
    .delete(authTokens)
    .where(sql`${authTokens.expiresAt} < now() - interval '7 days'`)
    .returning({ id: authTokens.id });
  return rows.length;
}

/* ---------------------------------------------------------------------------
   MEMBER PROVISIONING

   A redeemed token proves control of an email address. It does NOT make
   somebody a member — status starts at `non_member` and only staff or the CRM
   sync can raise it. Signing in is identity, not entitlement.
   -------------------------------------------------------------------------- */

export async function findOrCreateMember(email: string): Promise<Member> {
  const db = getDb();
  const normalised = normaliseEmail(email);

  const existing = await findMemberByEmail(normalised);
  if (existing) return existing;

  /* `onConflictDoNothing` then re-read, rather than check-then-insert: two
     simultaneous redemptions of two different tokens for the same address
     would otherwise both insert and one would fail on the unique index. */
  await db
    .insert(members)
    .values({
      email: normalised,
      displayName: provisionalDisplayName(normalised),
      status: "non_member",
    })
    .onConflictDoNothing({ target: members.email });

  const created = await findMemberByEmail(normalised);
  if (!created) throw new Error("member row vanished immediately after insert");
  return created;
}

/**
 * A provisional display name, used only until the member chooses one.
 *
 * Derived from the local part of the address and suffixed for uniqueness,
 * because `display_name` is unique — two members called "chidi" would otherwise
 * collide on first sign-in.
 *
 * It must never be the full email: display names appear on standings, and
 * publishing a member's email address to everyone in their league would be a
 * disclosure, not a default.
 */
function provisionalDisplayName(email: string): string {
  const local = email.split("@")[0].replace(/[^a-z0-9]+/gi, "") || "member";
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${local.slice(0, 20)}-${suffix}`;
}

/* ---------------------------------------------------------------------------
   SESSIONS
   -------------------------------------------------------------------------- */

export async function createSession(
  rawToken: string,
  memberId: string,
): Promise<void> {
  const db = getDb();
  await db.insert(sessions).values({
    tokenHash: await hashToken(rawToken),
    memberId,
    expiresAt: sessionExpiry(),
  });
}

export type SessionRecord = { id: string; expiresAt: Date; member: Member };

/** Resolve a session cookie to its member. Expired sessions return null. */
export async function findSession(rawToken: string): Promise<SessionRecord | null> {
  const db = getDb();
  const tokenHash = await hashToken(rawToken);

  const [row] = await db
    .select({
      id: sessions.id,
      expiresAt: sessions.expiresAt,
      member: members,
    })
    .from(sessions)
    .innerJoin(members, eq(sessions.memberId, members.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row ?? null;
}

/**
 * Extend a session's life.
 *
 * Called only when a session is past its halfway point — see shouldRefresh().
 * Writing on every request would put a database round trip on every
 * authenticated page load, which on this audience's connection is exactly the
 * latency we spent Phase 1 avoiding.
 */
export async function refreshSession(sessionId: string): Promise<void> {
  const db = getDb();
  await db
    .update(sessions)
    .set({ expiresAt: sessionExpiry() })
    .where(eq(sessions.id, sessionId));
}

export async function deleteSession(rawToken: string): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.tokenHash, await hashToken(rawToken)));
}

/** Sign out everywhere. Offered because a shared or lost device is the likely reason. */
export async function deleteAllSessionsForMember(memberId: string): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.memberId, memberId));
}
