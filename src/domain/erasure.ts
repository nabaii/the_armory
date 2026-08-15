/**
 * ERASURE — §10's guest data requirement, §11 M10.
 *
 *   §10, Guest data: "A guest who does not join has provided data for a single
 *    visit. A defined retention position is required from counsel; BUILD THE
 *    DELETION PATH NOW."
 *
 * The instruction is unusual and worth reading twice. Counsel has not settled
 * the retention PERIOD, and §10 says to build the path anyway — because the
 * answer changes when erasure happens, not what erasure is, and a club that has
 * to design one under a regulator's deadline will design it badly.
 *
 * ===========================================================================
 * IT IS NOT A DELETE, AND IT CANNOT BE
 *
 * `DELETE FROM armory.people` is refused by Postgres before it is refused by
 * anything here: `participations`, `custody_events`, `waiver_signatures`,
 * `rounds` and `incident_persons` all reference a person with `ON DELETE
 * RESTRICT`, and most of those tables reject DELETE outright (drizzle/0002).
 *
 * That is §12 and §3.4 working exactly as designed. §3.4's custody log names a
 * counterparty and is "the sole source of truth for where any firearm is"; a
 * log that could be made to forget who a firearm went to would not be the
 * record the club's licence rests on.
 *
 * So erasure is REDACTION of the person row — the identifying fields — leaving
 * the activity attached to somebody who can no longer be identified from the
 * database. `people.anonymised_at` has existed since M0 for this, and the
 * schema comment says why: "erasure anonymises in place rather than deleting
 * the row, because participations, custody events and incidents reference it
 * and those are append-only by law and by §3."
 *
 * ===========================================================================
 * WHAT SURVIVES, AND WHY THAT IS THE HONEST ANSWER
 *
 * After erasure the club can still answer "how many guests visited in March",
 * "was a firearm returned", "who was on lane four when the incident happened" —
 * as a row, not as a name. It cannot answer "what was that person's phone
 * number", which is the question the guest asked it to forget.
 *
 * A club that promised more than that would be promising something it cannot
 * deliver while holding a firearm custody log, and it is better to be able to
 * state the limit than to discover it during a request.
 *
 * ===========================================================================
 * PURE, BECAUSE THE HARD PART IS THE POLICY
 *
 * Which fields go, which stay, and who may be erased at all are decisions —
 * and decisions about personal data are the ones that must be reviewable
 * without a database. The SQL is in src/server/armory/erasure.ts and does what
 * this file says.
 */

/* ============================================================================
   WHO MAY BE ERASED
   ========================================================================= */

/**
 * A person, as far as erasure is concerned.
 *
 * Deliberately few fields. The decision turns on standing and on outstanding
 * obligations, and a wider input would invite a rule that turned on something
 * else.
 */
export type ErasureSubject = {
  readonly personId: string;
  /** Null for somebody who has never been a member — a guest or an applicant. */
  readonly membershipStatus:
    | "pending"
    | "active"
    | "lapsed"
    | "suspended"
    | "resigned"
    | null;
  /** Already erased. Erasing twice is a no-op, not an error. */
  readonly anonymisedAt: Date | null;
  /** Money the club is owed, in kobo. */
  readonly outstandingKobo: number;
  /** Firearms recorded as issued to them and not returned. §3.4. */
  readonly unreturnedFirearms: number;
  /** Their most recent visit, or null if they never came. */
  readonly lastVisitAt: Date | null;
  /** True while they own a firearm on the club's register. §3.4. */
  readonly ownsRegisteredFirearm: boolean;
};

export type ErasureRefusal = {
  readonly code: string;
  /** One line. §4.3's shape applied to a data-protection decision. */
  readonly message: string;
  readonly remedy: string | null;
};

export type ErasureDecision =
  | { readonly allowed: true; readonly alreadyErased: boolean }
  | { readonly allowed: false; readonly refusal: ErasureRefusal };

/**
 * How long after a visit a guest's data is kept.
 *
 * `null` until counsel answers (§14), and null means **no automatic erasure** —
 * the sweep below finds nobody. That is the safe direction for a rule nobody
 * has set: erasing on a guessed schedule destroys records the club may be
 * required to hold, and destruction is the one mistake here that cannot be
 * undone.
 *
 * A founder can still erase an individual on request, which is the obligation
 * that actually has a deadline. This governs only the automatic sweep.
 */
export type RetentionPolicy = {
  readonly guestRetentionDays: number | null;
};

export const UNSET_RETENTION: RetentionPolicy = { guestRetentionDays: null };

/**
 * May this person be erased?
 *
 * ===========================================================================
 * THE REFUSALS ARE ALL ABOUT AN OBLIGATION THAT OUTLIVES THE REQUEST
 *
 * A right to erasure is not unconditional anywhere it exists, and the exceptions
 * are consistently about a record somebody else still needs. Three apply here
 * and each is a fact about the club rather than a preference:
 *
 *   · A MEMBER is in a live contractual relationship. Erasing them mid-
 *     membership would leave a membership, a tier and a booking horizon
 *     belonging to a person the club cannot name. Resigning first is the step,
 *     and it is one they can take.
 *   · An UNRETURNED FIREARM means the custody log's counterparty is still
 *     needed. §3.4 makes that log the answer to where every firearm is, and a
 *     firearm issued to nobody is exactly the record that log exists to prevent.
 *   · A REGISTERED FIREARM in their name is a regulated holding, not a
 *     preference the club can drop.
 *
 * Money owed is deliberately NOT a refusal — see below.
 */
export function mayErase(subject: ErasureSubject): ErasureDecision {
  if (subject.anonymisedAt) {
    /* Already done. A success, so a repeated request — from a person who asked
       twice, or a sweep that ran twice — is not reported as a failure. */
    return { allowed: true, alreadyErased: true };
  }

  if (
    subject.membershipStatus === "active" ||
    subject.membershipStatus === "pending" ||
    subject.membershipStatus === "suspended"
  ) {
    return {
      allowed: false,
      refusal: {
        code: "LIVE_MEMBERSHIP",
        message: "This person holds a live membership.",
        remedy: "A membership has to be resigned before the record is erased.",
      },
    };
  }

  if (subject.unreturnedFirearms > 0) {
    return {
      allowed: false,
      refusal: {
        code: "FIREARM_OUT",
        message:
          subject.unreturnedFirearms === 1
            ? "A firearm is still recorded as issued to this person."
            : `${subject.unreturnedFirearms} firearms are still recorded as issued to this person.`,
        remedy: "Record the return before erasing the record.",
      },
    };
  }

  if (subject.ownsRegisteredFirearm) {
    return {
      allowed: false,
      refusal: {
        code: "OWNS_FIREARM",
        message: "This person owns a firearm on the club's register.",
        remedy:
          "The register has to be settled with them before the record is erased.",
      },
    };
  }

  /**
   * MONEY OWED IS NOT A REFUSAL, AND THAT IS A DECISION.
   *
   * It reads like one — the club is owed something and is being asked to forget
   * who owes it. It is refused as a ground for refusal anyway, for two reasons.
   *
   * A data-protection request is not a debt-collection instrument. Holding
   * somebody's personal data because they owe money is the club using an
   * obligation it has as leverage over one it owes, and that is the shape of
   * thing a regulator is looking for.
   *
   * And the sums are small. §1.2 rule 5 puts guest money on the host, so a
   * guest owes nothing; the outstanding balance here belongs to a former member,
   * and the charge survives erasure as a row against an anonymised person. The
   * club can still see the number. It just cannot ring them about it — which,
   * for a person who has asked to be forgotten, is the point.
   *
   * `outstandingKobo` stays on the subject so the founder can be TOLD, and the
   * server writes it into the audit row. Informed, not blocked.
   */

  return { allowed: true, alreadyErased: false };
}

/* ============================================================================
   WHAT IS REDACTED
   ========================================================================= */

/**
 * The identifying fields, and what each becomes.
 *
 * A `null` means the column is emptied. A string means it is replaced, because
 * two columns cannot be emptied:
 *
 *   · `first_name` and `last_name` are NOT NULL (§3.1), and every screen that
 *     lists a participation renders them. "Erased person" is what a founder
 *     reading a March report should see — not a blank, which reads as a bug and
 *     sends somebody looking for the missing name.
 *   · `phone` is NOT NULL and UNIQUE. Emptying it is impossible and reusing a
 *     placeholder would collide on the second erasure, so it is replaced with a
 *     value derived from the person's own id — unique by construction, and
 *     obviously not a phone number.
 *
 * Everything else goes to null.
 */
export const REDACTED_NAME = "Erased" as const;
export const REDACTED_SURNAME = "person" as const;

export type Redaction = {
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string;
  readonly email: null;
  readonly emailVerifiedAt: null;
  readonly dateOfBirth: null;
  readonly photoUrl: null;
  readonly address: null;
  readonly emergencyContactName: null;
  readonly emergencyContactPhone: null;
  readonly notes: null;
};

/**
 * The values that replace a person's identifying fields.
 *
 * The phone placeholder carries the person's own id. It is unique because the id
 * is, it cannot be dialled, and it is self-describing to anybody who finds one
 * in the column and wonders what it is.
 */
export const redactionFor = (personId: string): Redaction => ({
  firstName: REDACTED_NAME,
  lastName: REDACTED_SURNAME,
  phone: `erased:${personId}`,
  email: null,
  /* Cleared WITH the address rather than kept as a timestamp. Left behind it
     would assert that an erased person confirmed a mailbox the row no longer
     holds — a fact about somebody nobody can identify, and a contradiction on
     the same row. */
  emailVerifiedAt: null,
  dateOfBirth: null,
  photoUrl: null,
  address: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  notes: null,
});

/**
 * Fields the erasure MUST clear, asserted by a test.
 *
 * Listed separately from `redactionFor` on purpose, and the pairing is the
 * point: a column added to `people` in two years — a second phone number, a
 * next-of-kin address — will not appear in either list, and the test that
 * compares this against the table's own column set is what catches it.
 *
 * Without that, erasure keeps reporting success while quietly leaving the new
 * column populated. That is the same failure `LOCAL_DATABASES` in
 * src/offline/revoke.ts is guarded against, for the same reason: a destructive
 * operation that silently misses something is worse than one that fails.
 */
export const IDENTIFYING_FIELDS = [
  "firstName",
  "lastName",
  "phone",
  "email",
  "emailVerifiedAt",
  "dateOfBirth",
  "photoUrl",
  "address",
  "emergencyContactName",
  "emergencyContactPhone",
  "notes",
] as const;

/**
 * Columns on `people` that erasure deliberately KEEPS.
 *
 * Every one of them is either a key, a timestamp, or the flag that records the
 * erasure itself. None identifies a person. The test pairs this list with
 * `IDENTIFYING_FIELDS` and the table's real columns, so the two lists together
 * must account for every column that exists.
 */
export const RETAINED_FIELDS = [
  "id",
  "anonymisedAt",
  "createdAt",
  "updatedAt",
] as const;

/* ============================================================================
   THE SWEEP — §10's retention position, once counsel sets one
   ========================================================================= */

/**
 * Which guests are past the retention period.
 *
 * Returns nothing while the policy is unset, which is the whole of the safety
 * argument: an automatic erasure schedule nobody agreed is a schedule that
 * destroys records the club may be required to keep.
 *
 * A person with no recorded visit is never swept. They are an applicant, an
 * enquiry, or somebody a member put forward — a different relationship with a
 * different retention answer, and guessing that a guest rule covers them is
 * exactly the assumption that makes an automated deletion dangerous.
 */
export function dueForErasure(
  subjects: readonly ErasureSubject[],
  policy: RetentionPolicy,
  now: Date,
): readonly ErasureSubject[] {
  const days = policy.guestRetentionDays;
  if (days === null) return [];

  const cutoff = now.getTime() - days * 86_400_000;

  return subjects.filter((subject) => {
    if (subject.anonymisedAt) return false;
    if (subject.lastVisitAt === null) return false;
    if (subject.lastVisitAt.getTime() > cutoff) return false;

    /* The same guards the individual path applies. A sweep that could erase
       somebody an officer could not is a sweep that has a second policy in it. */
    return mayErase(subject).allowed;
  });
}
