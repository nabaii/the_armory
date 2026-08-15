import { and, eq, isNull, sql } from "drizzle-orm";
import { getArmoryDb, schema } from "@/db/armory/client";
import { getDb } from "@/db/client";
import { members } from "@/db/schema";
import { generateToken, hashToken, normaliseEmail } from "@/server/auth/tokens";
import { uuidv7 } from "@/lib/uuidv7";

/**
 * PROVING AN EMAIL ADDRESS.
 *
 * The reasoning is in drizzle/0008_email_verification.sql — why a proposed
 * address is inert until proved, and why this is not `auth_tokens`. This module
 * is the two halves of the round trip.
 *
 * ===========================================================================
 * WHAT PROVING AN ADDRESS BUYS, AND WHAT IT MUST NOT
 *
 * It buys a second way in and a way back: `/sign-in` mails a link, and a member
 * who forgets their password stops being dependent on the desk. It must not buy
 * anything else — redeeming a verification grants NO session. A member proves a
 * mailbox and stays exactly as signed in as they already were.
 *
 * That separation is what stops this becoming a privilege-escalation route: a
 * verification link forwarded to somebody else is worth a proved address on
 * somebody else's account, not an account.
 */

/** Long enough to walk to a laptop, short enough that a forwarded link dies. */
export const VERIFICATION_TTL_MS = 60 * 60_000;

const expiry = (now: Date) => new Date(now.getTime() + VERIFICATION_TTL_MS);

export type VerificationRequest =
  | { readonly ok: true; readonly rawToken: string; readonly email: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Issue a verification for an address, replacing any earlier one.
 *
 * ===========================================================================
 * THE ADDRESS IS REFUSED IF IT BELONGS TO SOMEBODY ELSE, AND SAID SO PLAINLY
 *
 * `members.email` is UNIQUE — the leagues product identifies people by it — so
 * a second account cannot take an address already in use. That check happens
 * HERE, before a mail is sent, rather than at redemption, because a member who
 * typed one character wrong should learn it now and not after walking to their
 * inbox and finding nothing.
 *
 * This is a departure from the anti-enumeration silence that `/sign-in` and
 * `verifyMemberPassword` keep, and the reason it is safe is that the caller is
 * ALREADY AUTHENTICATED and already inside the club. The threat those two guard
 * against is an anonymous prober learning the roster; a signed-in member
 * learning that an address is taken is a much smaller disclosure than the cost
 * of leaving them staring at a mailbox forever. The rate limit at the call site
 * is what bounds the difference.
 */
export async function requestEmailVerification(input: {
  readonly personId: string;
  readonly email: string;
  readonly now: Date;
}): Promise<VerificationRequest> {
  const email = normaliseEmail(input.email);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, reason: "Please check the email address." };
  }

  const db = getArmoryDb();

  const [person] = await db
    .select({ id: schema.people.id, current: schema.people.email })
    .from(schema.people)
    .where(eq(schema.people.id, input.personId))
    .limit(1);

  if (!person) return { ok: false, reason: "Sign in to add an email address." };

  /* Another PERSON already holds it. `people.email` is not unique in the
     schema — §3.1 leaves it nullable and unconstrained — so this is a rule the
     application keeps rather than one the database enforces. */
  const [otherPerson] = await db
    .select({ id: schema.people.id })
    .from(schema.people)
    .where(and(eq(schema.people.email, email), sql`${schema.people.id} <> ${input.personId}`))
    .limit(1);

  if (otherPerson) {
    return {
      ok: false,
      reason: "That address is already on another member's record. Speak to the club.",
    };
  }

  /* Another PORTAL ACCOUNT already holds it. This one the database does
     enforce, and redemption would fail on the unique index — better to refuse
     before sending the mail than after. An unlinked account at that address is
     refused too rather than claimed: merging two accounts' league history is a
     migration somebody decides on, not a side effect of a form. */
  const [otherAccount] = await getDb()
    .select({ id: members.id, personId: members.personId })
    .from(members)
    .where(eq(members.email, email))
    .limit(1);

  if (otherAccount && otherAccount.personId !== input.personId) {
    return {
      ok: false,
      reason: "That address is already used by another account. Speak to the club.",
    };
  }

  const raw = generateToken();

  /* Earlier pending verifications for this person are consumed, not deleted.
     A member who asks twice should find the newest link works and the older one
     does not — and the row stays as evidence that it was asked for. */
  await db
    .update(schema.emailVerifications)
    .set({ consumedAt: input.now })
    .where(
      and(
        eq(schema.emailVerifications.personId, input.personId),
        isNull(schema.emailVerifications.consumedAt),
      ),
    );

  await db.insert(schema.emailVerifications).values({
    id: uuidv7(),
    personId: input.personId,
    email,
    tokenHash: await hashToken(raw),
    expiresAt: expiry(input.now),
  });

  return { ok: true, rawToken: raw, email };
}

export type VerificationRedemption =
  | { readonly ok: true; readonly email: string; readonly personId: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Redeem a verification, and write the address to both halves of the system.
 *
 * ===========================================================================
 * THE GUARD IS IN THE WHERE CLAUSE
 *
 * Marked consumed in the same statement that reads it, which is the pattern
 * src/db/client.ts argues is stronger than a transaction for this job: it is
 * atomic against a concurrent redemption without holding a lock, and it is the
 * reason a link cannot be redeemed twice by clicking it twice.
 *
 * ===========================================================================
 * BOTH WRITES OR NEITHER
 *
 * `people.email` is the club's record and `members.email` is the sign-in
 * identity, and the whole point of this feature is that they agree. Writing one
 * without the other recreates the divergence §3.4 warns about — the same class
 * of bug as the standing mismatch in src/server/leagues/standing.ts — so they
 * go in one transaction. The pool supports them (see §8.3's allowance) and this
 * is exactly what that capability is for.
 *
 * The two schemas are addressed through their own drizzle clients, so the
 * transaction is opened on the armory client and the leagues write is issued
 * inside it as SQL against the shared connection.
 */
export async function redeemEmailVerification(input: {
  readonly rawToken: string;
  readonly now: Date;
}): Promise<VerificationRedemption> {
  const db = getArmoryDb();
  const tokenHash = await hashToken(input.rawToken);

  const refused: VerificationRedemption = {
    ok: false,
    reason: "That link has expired or has already been used. Ask for a new one.",
  };

  const claimed = await db
    .update(schema.emailVerifications)
    .set({ consumedAt: input.now })
    .where(
      and(
        eq(schema.emailVerifications.tokenHash, tokenHash),
        isNull(schema.emailVerifications.consumedAt),
        sql`${schema.emailVerifications.expiresAt} > ${input.now}`,
      ),
    )
    .returning({
      personId: schema.emailVerifications.personId,
      email: schema.emailVerifications.email,
    });

  const row = claimed[0];
  if (!row) return refused;

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.people)
        .set({ email: row.email, emailVerifiedAt: input.now })
        .where(eq(schema.people.id, row.personId));

      /* The leagues half, written as SQL because it lives in another schema
         whose drizzle client is configured differently — see the note in
         src/server/leagues/standing.ts on why the two clients do not reach
         across. Inside the transaction, on the same connection. */
      await tx.execute(
        sql`update public.members set email = ${row.email} where person_id = ${row.personId}`,
      );
    });
  } catch {
    /* The unique index on members.email is the likeliest cause: the address was
       free when the link was issued and was taken before it was clicked. The
       token is already spent, which is correct — it cannot be replayed — and
       the member is told to ask again rather than being shown a database
       error. */
    return {
      ok: false,
      reason: "That address is no longer available. Speak to the club.",
    };
  }

  return { ok: true, email: row.email, personId: row.personId };
}

/**
 * What the account screen renders from.
 *
 * Four states rather than three, because "we have an address for you" and "we
 * have sent you a link" are different sentences and a screen that says the
 * second when the first is true has lied to a member about something they are
 * about to go and check. `unconfirmed` is where an address typed at the desk
 * sits: on the club's record, not yet a way in, and one button from becoming
 * one.
 */
export type EmailState =
  | { readonly state: "verified"; readonly email: string }
  | { readonly state: "pending"; readonly email: string }
  | { readonly state: "unconfirmed"; readonly email: string }
  | { readonly state: "none" };

export async function emailStateFor(personId: string): Promise<EmailState> {
  const db = getArmoryDb();

  const [person] = await db
    .select({ email: schema.people.email, verifiedAt: schema.people.emailVerifiedAt })
    .from(schema.people)
    .where(eq(schema.people.id, personId))
    .limit(1);

  if (person?.email && person.verifiedAt) {
    return { state: "verified", email: person.email };
  }

  const [pending] = await db
    .select({ email: schema.emailVerifications.email })
    .from(schema.emailVerifications)
    .where(
      and(
        eq(schema.emailVerifications.personId, personId),
        isNull(schema.emailVerifications.consumedAt),
      ),
    )
    .orderBy(sql`${schema.emailVerifications.createdAt} desc`)
    .limit(1);

  if (pending) return { state: "pending", email: pending.email };

  /* An address staff typed and nobody proved is deliberately NOT reported as
     verified. It is the club's way of reaching this member and it is not a way
     in, which is the distinction `email_verified_at` exists to draw. */
  if (person?.email) return { state: "unconfirmed", email: person.email };

  return { state: "none" };
}
