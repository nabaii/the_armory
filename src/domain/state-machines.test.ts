import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applicationTransition,
  bookingTransition,
  deriveFirearmStatus,
  invitationTransition,
  isLicenceLive,
  licenceTransition,
  membershipTransition,
  sessionTransition,
  type CustodyEventRecord,
  type Effect,
} from "./state-machines";

/**
 * §5 — "Implement these as explicit transitions with guards. Do not allow
 * status to be set by direct assignment from a form."
 *
 * These tests assert the guards AND the effects. The effects are where the
 * club's guest accounting actually lives — §5 states in one sentence that
 * cancelling returns an allowance and attending does not, and getting that
 * pair the wrong way round would either leak guest slots or charge members for
 * visits that never happened.
 */

const at = (iso: string) => new Date(iso);

const hasEffect = (effects: readonly Effect[], kind: Effect["kind"]) =>
  effects.some((e) => e.kind === kind);

const countEffects = (effects: readonly Effect[], kind: Effect["kind"]) =>
  effects.filter((e) => e.kind === kind).length;

/* ===========================================================================
   APPLICATION
   ======================================================================== */

describe("application", () => {
  it("runs submitted → under_review → admitted with headroom", () => {
    const review = applicationTransition("submitted", { type: "begin_review" });
    assert.equal(review.ok && review.to, "under_review");

    const admit = applicationTransition("under_review", {
      type: "admit",
      rosterHeadroom: 3,
    });
    assert.equal(admit.ok && admit.to, "admitted");
    assert.ok(admit.ok && hasEffect(admit.effects, "issue_membership"));
  });

  it("§12: roster at cap → blocked, or admitted only with a founder override", () => {
    const blocked = applicationTransition("under_review", {
      type: "admit",
      rosterHeadroom: 0,
    });
    assert.equal(blocked.ok, false);
    assert.equal(!blocked.ok && blocked.code, "ROSTER_AT_CAP");
    assert.equal(!blocked.ok && blocked.overridable, true);

    const overridden = applicationTransition("under_review", {
      type: "admit",
      rosterHeadroom: 0,
      founderOverride: { staffUserId: "founder", reason: "Founding cohort seat" },
    });
    assert.equal(overridden.ok, true);
  });

  it("closes the waitlist entry when admitting from the waitlist", () => {
    const admit = applicationTransition("waitlisted", {
      type: "admit",
      rosterHeadroom: 1,
    });
    assert.ok(admit.ok && hasEffect(admit.effects, "close_waitlist_entry"));
  });

  it("allows withdrawal from any state, and refuses to review a decided one", () => {
    for (const from of ["submitted", "under_review", "waitlisted", "admitted"] as const) {
      assert.equal(applicationTransition(from, { type: "withdraw" }).ok, true);
    }
    assert.equal(
      applicationTransition("declined", { type: "begin_review" }).ok,
      false,
    );
  });
});

/* ===========================================================================
   MEMBERSHIP
   ======================================================================== */

describe("membership", () => {
  const standalone = { id: "m1", isAttached: false };
  const partner = { id: "m2", isAttached: true };

  it("activates on payment from pending and from lapsed", () => {
    assert.equal(
      membershipTransition("pending", { type: "payment_received" }, standalone).ok,
      true,
    );
    assert.equal(
      membershipTransition("lapsed", { type: "payment_received" }, standalone).ok,
      true,
    );
  });

  it("refuses to let payment reinstate a suspended membership", () => {
    /* §5: "suspended → active on staff action" — not on payment. Otherwise a
       suspended member could reinstate themselves with a card. */
    const result = membershipTransition(
      "suspended",
      { type: "payment_received" },
      standalone,
    );
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.message : "", /founder/i);
  });

  it("treats a renewal on a live membership as a no-op, not an error", () => {
    const result = membershipTransition(
      "active",
      { type: "payment_received" },
      standalone,
    );
    assert.equal(result.ok && result.to, "active");
  });

  it("§5: a Partner membership cannot outlive its principal", () => {
    const cascaded = membershipTransition(
      "active",
      { type: "principal_ended" },
      partner,
    );
    assert.equal(cascaded.ok && cascaded.to, "lapsed");

    /* And a standalone membership is not governed by anyone else's ending. */
    const standaloneResult = membershipTransition(
      "active",
      { type: "principal_ended" },
      standalone,
    );
    assert.equal(standaloneResult.ok, false);
    assert.equal(!standaloneResult.ok && standaloneResult.code, "NOT_ATTACHED");
  });

  it("cascades to attached memberships whenever the principal changes state", () => {
    for (const event of [
      { type: "renewal_missed" as const },
      { type: "resign" as const },
      { type: "suspend" as const, staffUserId: "s", reason: "conduct" },
    ]) {
      const result = membershipTransition("active", event, standalone);
      assert.ok(
        result.ok && hasEffect(result.effects, "cascade_to_attached_memberships"),
        `${event.type} must cascade`,
      );
    }
  });
});

/* ===========================================================================
   BOOKING
   ======================================================================== */

describe("booking", () => {
  const booking = { id: "b1", hostMembershipId: "m1", heldAllowances: 0 };

  it("runs draft → confirmed → completed", () => {
    assert.equal(
      bookingTransition("draft", { type: "confirm" }, booking).ok,
      true,
    );
    assert.equal(
      bookingTransition("confirmed", { type: "complete" }, booking).ok,
      true,
    );
  });

  it("§5: cancellation releases lane capacity and every held allowance", () => {
    const result = bookingTransition(
      "confirmed",
      { type: "cancel" },
      { ...booking, heldAllowances: 2 },
    );
    assert.ok(result.ok);
    if (!result.ok) return;

    assert.ok(hasEffect(result.effects, "release_lane_capacity"));
    /* Two guests booked, two allowances returned. Returning one would leak a
       guest slot on every multi-guest cancellation. */
    assert.equal(countEffects(result.effects, "release_allowance"), 2);
  });

  it("§5: a no-show is set by the end-of-day close, not by hand", () => {
    const manual = bookingTransition(
      "confirmed",
      { type: "mark_no_show", source: "manual" as never },
      booking,
    );
    assert.equal(manual.ok, false);
    assert.equal(!manual.ok && manual.code, "MANUAL_NO_SHOW");

    const automatic = bookingTransition(
      "confirmed",
      { type: "mark_no_show", source: "end_of_day_close" },
      booking,
    );
    assert.equal(automatic.ok && automatic.to, "no_show");
  });

  it("refuses to cancel a booking that already went through the range", () => {
    assert.equal(
      bookingTransition("completed", { type: "cancel" }, booking).ok,
      false,
    );
  });
});

/* ===========================================================================
   GUEST INVITATION — the allowance rules
   ======================================================================== */

describe("guest invitation", () => {
  const invitation = { hostMembershipId: "m1" };

  it("runs issued → opened → completed → attended", () => {
    assert.equal(
      invitationTransition("issued", { type: "open" }, invitation).ok,
      true,
    );
    assert.equal(
      invitationTransition("opened", { type: "complete" }, invitation).ok,
      true,
    );
    assert.equal(
      invitationTransition("completed", { type: "attend" }, invitation).ok,
      true,
    );
  });

  it("§5: cancelling before the session returns the allowance", () => {
    for (const from of ["issued", "opened", "completed"] as const) {
      const result = invitationTransition(from, { type: "cancel" }, invitation);
      assert.ok(result.ok, `${from} must be cancellable`);
      assert.ok(
        result.ok && hasEffect(result.effects, "release_allowance"),
        `cancelling from ${from} must return the allowance`,
      );
    }
  });

  it("§5: attended is terminal and does NOT return allowance", () => {
    const attend = invitationTransition("completed", { type: "attend" }, invitation);
    assert.ok(attend.ok);
    assert.equal(
      attend.ok && hasEffect(attend.effects, "release_allowance"),
      false,
      "the guest came and the slot was used",
    );

    /* Terminal: it cannot then be cancelled to claw the slot back. */
    const cancel = invitationTransition("attended", { type: "cancel" }, invitation);
    assert.equal(cancel.ok, false);
    assert.match(!cancel.ok ? cancel.message : "", /already visited/i);
  });

  it("expiry returns the allowance — the guest never came", () => {
    const result = invitationTransition("issued", { type: "expire" }, invitation);
    assert.ok(result.ok && hasEffect(result.effects, "release_allowance"));
  });

  it("is idempotent on reopening, because guests reopen the link (§7)", () => {
    const result = invitationTransition("opened", { type: "open" }, invitation);
    assert.equal(result.ok && result.to, "opened");
  });
});

/* ===========================================================================
   SESSION — the guarded close
   ======================================================================== */

describe("session close", () => {
  const clear = {
    unreturnedFirearms: [],
    unreconciledAmmunition: [],
    missingCheckouts: [],
  };

  it("closes when nothing is outstanding", () => {
    const result = sessionTransition("open", { type: "close" }, clear);
    assert.equal(result.ok && result.to, "closed");
  });

  it("§12: blocked with a firearm unreturned, and names the specific firearm", () => {
    const result = sessionTransition("open", { type: "close" }, {
      ...clear,
      unreturnedFirearms: ["AX-4471"],
    });

    assert.equal(result.ok, false);
    if (result.ok) return;

    assert.equal(result.code, "SESSION_NOT_CLEAR");
    /* "Lists the specific firearm" — the serial, not a count. */
    assert.deepEqual(result.outstanding, ["Firearm AX-4471 is still out"]);
    /* "Override requires a reason and appears on the dashboard." */
    assert.equal(result.overridable, true);
  });

  it("§6.4: lists EVERYTHING outstanding at once, not the first problem", () => {
    const result = sessionTransition("open", { type: "close" }, {
      unreturnedFirearms: ["AX-4471", "CL-0012"],
      unreconciledAmmunition: ["40 rounds of .22 LR"],
      missingCheckouts: ["Ada Nwosu"],
    });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.outstanding?.length, 4);
  });

  it("refuses to close an already-closed session", () => {
    assert.equal(sessionTransition("closed", { type: "close" }, clear).ok, false);
  });
});

/* ===========================================================================
   FIREARM — status derived from the custody log, never set
   ======================================================================== */

describe("firearm status derivation", () => {
  const event = (
    id: string,
    eventType: CustodyEventRecord["eventType"],
    occurredAt: string,
    correctsEventId: string | null = null,
  ): CustodyEventRecord => ({
    id,
    eventType,
    occurredAt: at(occurredAt),
    correctsEventId,
  });

  it("a firearm with no history is in service", () => {
    assert.equal(deriveFirearmStatus([]), "in_service");
  });

  it("follows the latest event", () => {
    const history = [
      event("a", "issued", "2026-08-10T09:00:00Z"),
      event("b", "returned", "2026-08-10T11:00:00Z"),
    ];
    assert.equal(deriveFirearmStatus(history), "in_service");
    assert.equal(deriveFirearmStatus([history[0]]), "issued");
  });

  it("is order-independent — the log may arrive from an outbox out of order", () => {
    const a = event("a", "issued", "2026-08-10T09:00:00Z");
    const b = event("b", "returned", "2026-08-10T11:00:00Z");
    assert.equal(deriveFirearmStatus([b, a]), "in_service");
  });

  it("§1.2 rule 3: a correction withdraws the event it references", () => {
    /* An officer recorded `taken_out` against the wrong firearm and corrected
       it. The firearm is not off site; it is where the remaining log says. */
    const history = [
      event("a", "returned", "2026-08-10T09:00:00Z"),
      event("b", "taken_out", "2026-08-10T10:00:00Z"),
      event("c", "correction", "2026-08-10T10:05:00Z", "b"),
    ];
    assert.equal(deriveFirearmStatus(history), "in_service");
  });

  it("breaks a timestamp tie by id, which is time-ordered (UUIDv7)", () => {
    const history = [
      event("00000000-0000-7000-8000-000000000001", "issued", "2026-08-10T09:00:00Z"),
      event("00000000-0000-7000-8000-000000000002", "returned", "2026-08-10T09:00:00Z"),
    ];
    assert.equal(deriveFirearmStatus(history), "in_service");
  });

  it("maps every custody event type to a status", () => {
    const cases = [
      ["issued", "issued"],
      ["returned", "in_service"],
      ["brought_in", "in_service"],
      ["taken_out", "off_site"],
      ["stored", "in_storage"],
      ["withdrawn", "in_service"],
      ["sent_for_service", "at_service"],
      ["returned_from_service", "in_service"],
      ["decommissioned", "decommissioned"],
    ] as const;

    for (const [type, expected] of cases) {
      assert.equal(
        deriveFirearmStatus([event("x", type, "2026-08-10T09:00:00Z")]),
        expected,
        `${type} should derive ${expected}`,
      );
    }
  });
});

/* ===========================================================================
   LICENCE
   ======================================================================== */

describe("licence", () => {
  it("runs pending_review → verified", () => {
    const result = licenceTransition("pending_review", {
      type: "verify",
      staffUserId: "s",
    });
    assert.equal(result.ok && result.to, "verified");
  });

  it("refuses to re-verify a revoked licence", () => {
    const result = licenceTransition("revoked", { type: "verify", staffUserId: "s" });
    assert.equal(result.ok, false);
  });

  it("§5: capability is live only while verified AND unexpired", () => {
    const now = at("2026-08-10T09:00:00Z");

    assert.equal(
      isLicenceLive({ status: "verified", expiresOn: at("2027-01-01T00:00:00Z") }, now),
      true,
    );
    /* The clock overtakes the column: still marked verified, already expired.
       The sweep has not run yet, and the date is what is true. */
    assert.equal(
      isLicenceLive({ status: "verified", expiresOn: at("2026-08-09T00:00:00Z") }, now),
      false,
    );
    assert.equal(
      isLicenceLive({ status: "pending_review", expiresOn: null }, now),
      false,
    );
  });
});
