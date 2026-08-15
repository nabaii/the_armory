import { and, eq, sql } from "drizzle-orm";
import { getArmoryDb, schema } from "@/db/armory/client";
import { getDb } from "@/db/client";
import { members } from "@/db/schema";
import { uuidv7 } from "@/lib/uuidv7";
import { hashSecret, verifySecret } from "./kdf";

/**
 * SIGNING IN AS AN EXISTING MEMBER — the interim password path.
 *
 * ===========================================================================
 * WHAT THIS IS FOR
 *
 * §9's intended front door is an SMS one-time passcode, and no SMS provider is
 * configured. This is what lets the club test §6.2's portal end to end before
 * that lands, and it does one thing the magic-link sign-in cannot: it resolves
 * the person signing in to a row in `armory.people`, which is what
 * `members.person_id` has needed since drizzle/0005 and which nothing wrote.
 *
 * ===========================================================================
 * THE IDENTIFIER IS THE PHONE, NOT THE EMAIL, AND THAT IS NOT ARBITRARY
 *
 * §3.1 makes `people.phone` NOT NULL and UNIQUE and `people.email` nullable,
 * and the schema says why: "the club's primary channel is WhatsApp (§9) and OTP
 * is sent by SMS, so the phone number is the account identifier — email is
 * optional and secondary, which is the reverse of the leagues product."
 *
 * Signing in by phone therefore means this path and the OTP path that replaces
 * it identify people the same way. A member who learns their phone number is
 * their club identity now does not have to learn something different later.
 *
 * ===========================================================================
 * WHY EMAIL MATCHING WAS REJECTED OUTRIGHT
 *
 * The cheapest version of this feature is: if `people.email` equals the address
 * on the portal session, link them. It was rejected and should stay rejected.
 *
 * `people.email` is typed in by staff from an application form and is never
 * verified by anybody. One transposed character that happens to land on a real
 * address hands a stranger a member's bookings, guest allowance, shooting
 * history and account balance — and nothing in the system would report it,
 * because from the inside it looks exactly like the right person signing in.
 *
 * A password is a secret the member holds. A staff-typed email is not.
 */

/* ============================================================================
   THE IDENTIFIER
   ========================================================================= */

/**
 * E.164, leniently.
 *
 * The same normalisation `src/app/actions/visit.ts` applies to a guest's phone,
 * and for the same reason recorded there: §3.1 needs the stored value canonical
 * and nothing says the member has to know what E.164 means. Somebody typing
 * their own number at a sign-in form will use spaces and a leading zero.
 *
 * Duplicated deliberately rather than imported from that action: it lives in a
 * `"use server"` module whose other exports are server actions, and importing
 * from one to reach a pure helper drags a form-handling surface into an
 * authentication path. If a third caller appears, it moves to src/lib.
 */
export function normalisePhone(raw: string): string {
  const trimmed = raw.replace(/[\s()-]/g, "");
  if (trimmed.startsWith("+")) return trimmed;
  if (trimmed.startsWith("0")) return `+234${trimmed.slice(1)}`;
  return trimmed;
}

/* ============================================================================
   THROTTLE
   ========================================================================= */

/**
 * Five attempts, then fifteen minutes.
 *
 * The same figures as the staff PIN lockout, and the reasoning there applies
 * unchanged: a lockout that triggers on ordinary human error is a lockout that
 * gets designed around. A password has more entropy than a six-digit PIN, so
 * this throttle is doing less work — but it is still the defence that matters,
 * because scrypt only protects a stolen database and does nothing about an
 * attacker who can keep asking.
 */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/** Below this a password is not a password. Stated once, used by both paths. */
export const MIN_PASSWORD_LENGTH = 10;

/* ============================================================================
   VERIFY
   ========================================================================= */

export type SignInResult =
  | {
      readonly ok: true;
      readonly personId: string;
      /** The portal account this person signs into. See `linkPortalAccount`. */
      readonly memberId: string;
      /** True while they are on a password somebody else chose. */
      readonly mustChange: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Verify a phone and password, and resolve them to a portal account.
 *
 * ===========================================================================
 * EVERY FAILURE RETURNS THE SAME SENTENCE
 *
 * A wrong password, an unknown number, a person with no credential, a person
 * with no membership — all of them answer "Those details do not match a
 * membership." That is a deliberate departure from §4.3's rule that a block
 * states its specific reason, and it is the one place in this codebase where
 * being unhelpful is correct.
 *
 * §4.3 is about a member standing at a desk in front of their guest. This is an
 * unauthenticated form on the public internet, and a specific refusal here is
 * an oracle: "no membership with that number" tells anybody who asks which of
 * the club's members exist, and this is a members' club whose roster is the
 * thing it does not publish. `src/app/actions/auth.ts` takes the same position
 * on the magic link — "a member sees 'check your email'; a prober learns
 * nothing."
 *
 * The lockout message is the single exception, because a member who has locked
 * themselves out cannot act on "those details do not match" — they would keep
 * trying, which is the behaviour the lockout exists to stop.
 */
export async function verifyMemberPassword(input: {
  readonly phone: string;
  readonly password: string;
  readonly now: Date;
}): Promise<SignInResult> {
  const phone = normalisePhone(input.phone);
  const db = getArmoryDb();

  const refused: SignInResult = {
    ok: false,
    reason: "Those details do not match a membership.",
  };

  if (phone === "" || input.password === "") return refused;

  const [person] = await db
    .select({ id: schema.people.id, anonymisedAt: schema.people.anonymisedAt })
    .from(schema.people)
    .where(eq(schema.people.phone, phone))
    .limit(1);

  /* An erased person (§10) is refused here as well as having had their
     credential cascaded away. Belt and braces, because the cost of being wrong
     is signing somebody in to a record the club has promised to forget. */
  if (!person || person.anonymisedAt) return refused;

  const [credential] = await db
    .select({
      id: schema.memberCredentials.id,
      passwordHash: schema.memberCredentials.passwordHash,
      mustChange: schema.memberCredentials.mustChange,
      failedCount: schema.memberCredentials.failedCount,
      lockedUntil: schema.memberCredentials.lockedUntil,
    })
    .from(schema.memberCredentials)
    .where(eq(schema.memberCredentials.personId, person.id))
    .limit(1);

  if (!credential) return refused;

  if (credential.lockedUntil && credential.lockedUntil > input.now) {
    const minutes = Math.max(
      1,
      Math.ceil((credential.lockedUntil.getTime() - input.now.getTime()) / 60_000),
    );

    return {
      ok: false,
      reason: `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
    };
  }

  const correct = await verifySecret(input.password, credential.passwordHash);

  if (!correct) {
    const failedCount = credential.failedCount + 1;
    const locked = failedCount >= MAX_ATTEMPTS;

    await db
      .update(schema.memberCredentials)
      .set({
        failedCount: locked ? 0 : failedCount,
        lockedUntil: locked
          ? new Date(input.now.getTime() + LOCKOUT_MINUTES * 60_000)
          : credential.lockedUntil,
        updatedAt: input.now,
      })
      .where(eq(schema.memberCredentials.id, credential.id));

    return refused;
  }

  /**
   * A membership is required, and this is where the feature earns its name.
   *
   * "A log in for existing members" — a person row alone is not a membership.
   * A former guest has a person row, and signing them in would put them on
   * §6.2's screens with nothing to show and an Account page describing a tier
   * they do not hold.
   *
   * `pending` counts: §5 makes it the state between admission and first
   * payment, and a member who has been admitted and is being asked to pay needs
   * the portal to pay from.
   */
  const [membership] = await db
    .select({ status: schema.memberships.status })
    .from(schema.memberships)
    .where(eq(schema.memberships.personId, person.id))
    .limit(1);

  const admitted =
    membership?.status === "active" ||
    membership?.status === "pending" ||
    membership?.status === "suspended" ||
    membership?.status === "lapsed";

  /* A lapsed or suspended member signs IN. §4 refuses what they may not do,
     with a reason and a remedy — and a lapsed member who cannot reach the
     portal cannot renew, which would make the lapse permanent by accident. */
  if (!admitted) return refused;

  await db
    .update(schema.memberCredentials)
    .set({
      failedCount: 0,
      lockedUntil: null,
      lastSignedInAt: input.now,
      updatedAt: input.now,
    })
    .where(eq(schema.memberCredentials.id, credential.id));

  const memberId = await linkPortalAccount(person.id);

  return {
    ok: true,
    personId: person.id,
    memberId,
    mustChange: credential.mustChange,
  };
}

/* ============================================================================
   THE LINK — what drizzle/0005 was waiting for
   ========================================================================= */

/**
 * Find or create the portal account for a person, and link the two.
 *
 * ===========================================================================
 * THIS IS THE WRITE `members.person_id` HAS NEVER HAD
 *
 * drizzle/0005 added the column, explained at length why one sign-in serving
 * two systems of record is better than two, and left the write to whatever
 * proved a person's identity. Nothing did, until this.
 *
 * ===========================================================================
 * THE SYNTHESISED ADDRESS, WHICH IS A COMPROMISE AND IS LABELLED AS ONE
 *
 * `members.email` is NOT NULL and UNIQUE — the leagues product identifies
 * people by email — and `people.email` is nullable, because the club identifies
 * them by phone. A member the club has no email for therefore cannot have a
 * portal row created from their real address, because there is not one.
 *
 * So one is synthesised, at `@armory.invalid`. RFC 2606 reserves `.invalid`
 * precisely so that a non-routable address is obviously non-routable: nothing
 * will ever deliver to it, no member will ever see it, and anybody who finds
 * one in the column can tell at a glance what it is and why.
 *
 * The consequence is real and worth stating: that member cannot use the
 * magic-link sign-in, because there is no address to send a link to. They have
 * a password, which is the point. When the club records a real email for them,
 * or when OTP replaces this path entirely, the synthesised row is updatable in
 * place — it is keyed on `person_id`, not on the address.
 */
export async function linkPortalAccount(personId: string): Promise<string> {
  const armoryDb = getArmoryDb();
  const db = getDb();

  const [existing] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.personId, personId))
    .limit(1);

  if (existing) return existing.id;

  const [person] = await armoryDb
    .select({
      firstName: schema.people.firstName,
      lastName: schema.people.lastName,
      email: schema.people.email,
    })
    .from(schema.people)
    .where(eq(schema.people.id, personId))
    .limit(1);

  if (!person) throw new Error(`No person ${personId} to link a portal account to.`);

  const email = person.email?.trim().toLowerCase() || synthesisedEmail(personId);

  /**
   * An account may already exist at this address — the member signed in with
   * the magic link before they ever set a password. That row is CLAIMED rather
   * than duplicated: it holds their display name and any league history, and a
   * second account would split one member in two.
   *
   * Guarded on `person_id IS NULL` so claiming cannot steal an account already
   * linked to somebody else. If that guard matches nothing, the address belongs
   * to a different person and the fallback below gives this member their own
   * row rather than failing the sign-in.
   */
  const claimed = await db
    .update(members)
    .set({ personId })
    .where(and(eq(members.email, email), sql`${members.personId} IS NULL`))
    .returning({ id: members.id });

  if (claimed[0]) return claimed[0].id;

  const [created] = await db
    .insert(members)
    .values({
      email: (await addressIsTaken(email)) ? synthesisedEmail(personId) : email,
      displayName: await uniqueDisplayName(person.firstName, person.lastName),
      fullName: `${person.firstName} ${person.lastName}`,
      /* Deliberately left at the default. `members.status` is the LEAGUES
         product's notion of standing (it gates ladders and captaincy); the
         club's is `armory.memberships.status`, which §4 reads. Setting this
         from the other system would put two answers to "is this person a
         member" in one database, which is the divergence §3.4 warns about in a
         different table for the same reason. */
      personId,
    })
    .returning({ id: members.id });

  if (!created) throw new Error(`Could not open a portal account for ${personId}.`);
  return created.id;
}

const synthesisedEmail = (personId: string) => `person+${personId}@armory.invalid`;

async function addressIsTaken(email: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: members.id })
    .from(members)
    .where(eq(members.email, email))
    .limit(1);

  return Boolean(row);
}

/**
 * A display name that does not collide.
 *
 * `members.display_name` is UNIQUE and §7 of the leagues spec puts it on
 * standings, so it is the one name that appears on a shared surface. Two
 * members called Chidi Eze would otherwise collide on the second one's first
 * sign-in — the same problem `provisionalDisplayName` solves for the magic-link
 * path, solved the same way.
 */
async function uniqueDisplayName(
  firstName: string,
  lastName: string,
): Promise<string> {
  const base = `${firstName} ${lastName}`.trim() || "Member";
  const db = getDb();

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base} ${attempt + 1}`;

    const [taken] = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.displayName, candidate))
      .limit(1);

    if (!taken) return candidate;
  }

  /* Fifty people with one name is not a case worth branching for, and a
     failed sign-in is not the place to discover it. */
  return `${base} ${uuidv7().slice(0, 8)}`;
}

/* ============================================================================
   SETTING A PASSWORD
   ========================================================================= */

export type PasswordRefusal = { readonly ok: false; readonly reason: string };
export type PasswordSet = { readonly ok: true };

/**
 * Set or replace a person's password.
 *
 * `mustChange` defaults to true because the common caller is a founder setting
 * one FOR somebody — a secret two people now know. A member changing their own
 * passes false.
 *
 * ===========================================================================
 * THE ONLY RULE IS LENGTH
 *
 * No character classes, no forced symbols. Composition rules produce
 * `Password1!` and a note on a monitor; length is the only requirement that
 * reliably buys entropy, and it is what NIST has recommended since 2017.
 *
 * Ten rather than eight because this credential has no second factor behind it
 * — §9's OTP is what will provide that, and until it does the password is the
 * whole of the front door.
 */
export async function setMemberPassword(input: {
  readonly personId: string;
  readonly password: string;
  readonly mustChange?: boolean;
  readonly now: Date;
}): Promise<PasswordSet | PasswordRefusal> {
  const password = input.password;

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `A password needs at least ${MIN_PASSWORD_LENGTH} characters. Length is what makes it hard to guess — a phrase you will remember beats a short one with symbols in it.`,
    };
  }

  const db = getArmoryDb();

  const [person] = await db
    .select({ id: schema.people.id, anonymisedAt: schema.people.anonymisedAt })
    .from(schema.people)
    .where(eq(schema.people.id, input.personId))
    .limit(1);

  if (!person) {
    return { ok: false, reason: "That person is not on the club's records." };
  }

  if (person.anonymisedAt) {
    /* §10. An erased person has asked to be forgotten; giving them a working
       credential would be the club quietly un-forgetting them. */
    return {
      ok: false,
      reason: "That record has been erased and cannot be signed in to.",
    };
  }

  const passwordHash = await hashSecret(password);

  await db
    .insert(schema.memberCredentials)
    .values({
      id: uuidv7(),
      personId: input.personId,
      passwordHash,
      mustChange: input.mustChange ?? true,
      failedCount: 0,
      lockedUntil: null,
    })
    .onConflictDoUpdate({
      target: schema.memberCredentials.personId,
      set: {
        passwordHash,
        mustChange: input.mustChange ?? true,
        /* A reset clears the lockout. A member who forgot their password and
           locked themselves out must not still be locked out after the founder
           helps them — that is the same wall, one step further along. */
        failedCount: 0,
        lockedUntil: null,
        updatedAt: input.now,
      },
    });

  return { ok: true };
}

/** Destroy a person's credential. Called by §10's erasure, and on request. */
export async function revokeMemberPassword(personId: string): Promise<void> {
  await getArmoryDb()
    .delete(schema.memberCredentials)
    .where(eq(schema.memberCredentials.personId, personId));
}
