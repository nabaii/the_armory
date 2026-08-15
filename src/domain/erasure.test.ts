import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { people } from "@/db/armory/schema";
import {
  IDENTIFYING_FIELDS,
  RETAINED_FIELDS,
  UNSET_RETENTION,
  dueForErasure,
  mayErase,
  redactionFor,
  type ErasureSubject,
} from "./erasure";

/**
 * §10, Guest data: "A guest who does not join has provided data for a single
 *       visit. A defined retention position is required from counsel; BUILD THE
 *       DELETION PATH NOW."
 * §3.4: the custody log is "the sole source of truth for where any firearm is."
 * §12:  "the blocked path asserts the reason string."
 *
 * The dangerous direction here is not refusing too much — it is erasing
 * something the club is required to hold, or reporting success while leaving a
 * column populated. Both are tested below.
 */

const PERSON = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-08-14T09:00:00.000Z");

const subject = (over: Partial<ErasureSubject> = {}): ErasureSubject => ({
  personId: PERSON,
  membershipStatus: null,
  anonymisedAt: null,
  outstandingKobo: 0,
  unreturnedFirearms: 0,
  lastVisitAt: new Date("2026-01-10T18:00:00.000Z"),
  ownsRegisteredFirearm: false,
  ...over,
});

describe("who may be erased", () => {
  it("erases a guest who came once and did not join", () => {
    /* The case §10 names. */
    const decision = mayErase(subject());
    assert.equal(decision.allowed, true);
    assert.equal(decision.allowed && decision.alreadyErased, false);
  });

  it("erases a former member who has resigned", () => {
    assert.equal(mayErase(subject({ membershipStatus: "resigned" })).allowed, true);
  });

  it("erases somebody whose membership lapsed", () => {
    assert.equal(mayErase(subject({ membershipStatus: "lapsed" })).allowed, true);
  });

  it("treats a second request as done rather than as an error", () => {
    const decision = mayErase(
      subject({ anonymisedAt: new Date("2026-06-01T09:00:00.000Z") }),
    );
    assert.equal(decision.allowed, true);
    assert.equal(decision.allowed && decision.alreadyErased, true);
  });

  it("refuses a live member, and says what to do first", () => {
    for (const status of ["active", "pending", "suspended"] as const) {
      const decision = mayErase(subject({ membershipStatus: status }));
      assert.equal(decision.allowed, false, `${status} was erased`);
      if (decision.allowed) continue;
      assert.equal(decision.refusal.message, "This person holds a live membership.");
      assert.match(decision.refusal.remedy ?? "", /resigned/);
    }
  });

  it("refuses while a firearm is recorded as issued to them — §3.4", () => {
    /* A firearm issued to nobody is exactly the record the custody log exists
       to prevent. */
    const decision = mayErase(subject({ unreturnedFirearms: 1 }));
    assert.equal(decision.allowed, false);
    if (decision.allowed) return;
    assert.equal(
      decision.refusal.message,
      "A firearm is still recorded as issued to this person.",
    );
    assert.match(decision.refusal.remedy ?? "", /return/i);
  });

  it("counts more than one unreturned firearm correctly", () => {
    const decision = mayErase(subject({ unreturnedFirearms: 3 }));
    assert.equal(decision.allowed, false);
    if (decision.allowed) return;
    assert.match(decision.refusal.message, /^3 firearms/);
  });

  it("refuses while they own a firearm on the register", () => {
    const decision = mayErase(subject({ ownsRegisteredFirearm: true }));
    assert.equal(decision.allowed, false);
  });

  it("DOES erase somebody who owes the club money", () => {
    /**
     * A deliberate decision, and the one most likely to be argued with.
     *
     * A data-protection request is not a debt-collection instrument. Holding
     * personal data because somebody owes money is the club using an obligation
     * it has as leverage over one it owes — and the charge survives erasure as a
     * row against an anonymised person, so the club can still see the number.
     */
    const decision = mayErase(subject({ outstandingKobo: 1_500_000 }));
    assert.equal(decision.allowed, true);
  });
});

describe("what redaction replaces", () => {
  const redaction = redactionFor(PERSON);

  it("empties every identifying field it can", () => {
    assert.equal(redaction.email, null);
    assert.equal(redaction.dateOfBirth, null);
    assert.equal(redaction.photoUrl, null);
    assert.equal(redaction.address, null);
    assert.equal(redaction.emergencyContactName, null);
    assert.equal(redaction.emergencyContactPhone, null);
    assert.equal(redaction.notes, null);
  });

  it("replaces the two columns that cannot be emptied", () => {
    /* first_name, last_name and phone are NOT NULL in §3.1. */
    assert.equal(redaction.firstName, "Erased");
    assert.equal(redaction.lastName, "person");
    assert.ok(redaction.phone.length > 0);
  });

  it("gives each erased person a unique phone placeholder", () => {
    /* `people_phone_key` is UNIQUE. A shared placeholder would collide on the
       second erasure and the whole path would fail on its second use. */
    const other = "22222222-2222-4222-8222-222222222222";
    assert.notEqual(redactionFor(PERSON).phone, redactionFor(other).phone);
  });

  it("leaves a placeholder nobody could mistake for a phone number", () => {
    assert.match(redaction.phone, /^erased:/);
    assert.doesNotMatch(redaction.phone, /^\+?\d/);
  });

  it("reads as a name on a report rather than as a blank", () => {
    /* A founder reading a March participation list sees "Erased person", not an
       empty cell that sends them looking for a bug. */
    assert.equal(`${redaction.firstName} ${redaction.lastName}`, "Erased person");
  });
});

describe("the field lists account for every column on people", () => {
  it("names every column as either identifying or retained", () => {
    /**
     * The guard that matters most in this file.
     *
     * A column added to `people` in two years — a second phone number, a
     * next-of-kin address — appears in neither list, and erasure would keep
     * reporting success while leaving it populated. Nothing else would notice.
     *
     * Read from the Drizzle table itself rather than from a hand-written list,
     * so the check cannot drift from the schema it is checking.
     *
     * This is the one place a `src/domain` file touches the schema, and it is a
     * TEST — the rule in src/domain/enums.ts is about what reaches a tablet
     * bundle, and nothing here does. Checking the policy against the real table
     * is the entire value of the assertion.
     */
    /* `getTableColumns`, not `Object.keys` — a Drizzle table object also
       carries internals (`enableRLS` and friends) that are not columns, and a
       list that included them would fail for a reason that has nothing to do
       with personal data. This test found that on its first run, which is a
       reasonable advertisement for the guard. */
    const columns = Object.keys(getTableColumns(people));

    const accounted = new Set<string>([
      ...IDENTIFYING_FIELDS,
      ...RETAINED_FIELDS,
    ]);

    const unaccounted = columns.filter((column) => !accounted.has(column));

    assert.deepEqual(
      unaccounted,
      [],
      `people has ${unaccounted.length} column(s) erasure does not mention: ` +
        `${unaccounted.join(", ")}. Add each to IDENTIFYING_FIELDS or ` +
        `RETAINED_FIELDS in src/domain/erasure.ts — and if it identifies a ` +
        `person, to redactionFor() as well.`,
    );
  });

  it("redacts exactly the fields it says it does", () => {
    const redacted = Object.keys(redactionFor(PERSON));
    assert.deepEqual([...redacted].sort(), [...IDENTIFYING_FIELDS].sort());
  });
});

describe("the retention sweep", () => {
  const old = subject({ lastVisitAt: new Date("2024-01-10T18:00:00.000Z") });

  it("finds nobody while counsel has not set a period", () => {
    /* §14's answer is outstanding, and an automatic schedule nobody agreed
       destroys records the club may be required to keep. */
    assert.deepEqual(dueForErasure([old], UNSET_RETENTION, NOW), []);
  });

  it("finds a guest past the period once one is set", () => {
    const due = dueForErasure([old], { guestRetentionDays: 365 }, NOW);
    assert.equal(due.length, 1);
  });

  it("leaves a guest inside the period alone", () => {
    const recent = subject({ lastVisitAt: new Date("2026-08-01T18:00:00.000Z") });
    assert.deepEqual(dueForErasure([recent], { guestRetentionDays: 365 }, NOW), []);
  });

  it("never sweeps somebody who has no recorded visit", () => {
    /* An applicant or an enquiry is a different relationship with a different
       retention answer. Assuming the guest rule covers them is the assumption
       that makes automatic deletion dangerous. */
    const applicant = subject({ lastVisitAt: null });
    assert.deepEqual(
      dueForErasure([applicant], { guestRetentionDays: 1 }, NOW),
      [],
    );
  });

  it("applies the same guards the individual path applies", () => {
    /* A sweep that could erase somebody an officer could not would be a second
       policy hiding inside the first. */
    const member = subject({
      membershipStatus: "active",
      lastVisitAt: new Date("2024-01-10T18:00:00.000Z"),
    });
    const holding = subject({
      unreturnedFirearms: 1,
      lastVisitAt: new Date("2024-01-10T18:00:00.000Z"),
    });

    assert.deepEqual(
      dueForErasure([member, holding], { guestRetentionDays: 365 }, NOW),
      [],
    );
  });

  it("skips somebody already erased", () => {
    const done = subject({
      lastVisitAt: new Date("2024-01-10T18:00:00.000Z"),
      anonymisedAt: new Date("2025-06-01T09:00:00.000Z"),
    });
    assert.deepEqual(dueForErasure([done], { guestRetentionDays: 365 }, NOW), []);
  });
});
