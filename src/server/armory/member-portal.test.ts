import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { statusOf } from "@/components/member/StatusPill";
import { accrualStatement } from "./member-record";
import {
  bookingWorthHosting,
  isAmendable,
  type MemberBooking,
} from "./member-bookings";
import { CONVERSION_VISITS, isWorthConverting, type HostedGuest } from "./member-file";

/**
 * The decidable half of the Members Portal's server layer.
 *
 * Everything here is a function over data rather than a query, and each one
 * encodes a sentence from the specification that a future change could quietly
 * reverse. The queries themselves are exercised against a real database by
 * `npm run db:prove`; these are the rules.
 */

const booking = (over: Partial<MemberBooking> = {}): MemberBooking => ({
  id: "booking-1",
  slotStart: new Date("2026-08-20T17:00:00.000Z"),
  slotEnd: new Date("2026-08-20T18:00:00.000Z"),
  discipline: "10m-air-rifle",
  bookingType: "shoot",
  companions: [],
  partySize: 1,
  ...over,
});

/* ============================================================================
   §8.6 — THE ACCRUAL STATEMENT
   ========================================================================= */

describe("what Compete says before the Ladder opens", () => {
  const record = (cardCount: number, ladder: { position: number; of: number; movement: number } | null = null) => ({
    shooting: { history: [], bests: [], cardCount, mostRecent: null },
    leagues: [],
    ladder,
  });

  it("counts the rounds and promises the position", () => {
    /* §8.6: "37 rounds recorded. Your position appears when the Ladder opens.
       That is not a placeholder. It tells the member their history is being
       kept, that it will matter, and that showing up now compounds." */
    const line = accrualStatement(record(37)) ?? "";
    assert.match(line, /37 rounds recorded/);
    assert.match(line, /when the Ladder opens/);
  });

  it("does not say '1 rounds'", () => {
    assert.match(accrualStatement(record(1)) ?? "", /1 round recorded/);
  });

  it("does not read as a failure to a member who has not started", () => {
    /* "0 rounds recorded" is arithmetically true and is the club telling
       somebody they are behind on their first day. */
    const line = accrualStatement(record(0)) ?? "";
    assert.doesNotMatch(line, /0 rounds/);
    assert.match(line, /from your first session/);
  });

  it("falls silent the day the Ladder opens", () => {
    /* The whole reason this is a function and not a line in the page: on the
       day a position exists, the sentence has to stop being printed, and
       nobody should have to find it to delete it. */
    assert.equal(accrualStatement(record(37, { position: 4, of: 26, movement: 1 })), null);
  });
});

/* ============================================================================
   §10 — HOSTING'S TODAY PROMPT
   ========================================================================= */

describe("which booking is worth a hosting prompt", () => {
  it("picks a booking with nobody on it", () => {
    assert.equal(bookingWorthHosting([booking()])?.id, "booking-1");
  });

  it("leaves a booking that already has guests alone", () => {
    /* §10: the card appears on "any upcoming booking with NO GUESTS ATTACHED
       and allowance remaining. Suggestive, dismissible, and never repeated for
       the same booking." */
    assert.equal(
      bookingWorthHosting([
        booking({
          companions: [
            { personId: "p", name: "Ada", isGuest: true, invitationStatus: "issued" },
          ],
        }),
      ]),
      null,
    );
  });

  it("does not suggest bringing a guest to a booking that is only watching", () => {
    assert.equal(bookingWorthHosting([booking({ bookingType: "spectate" })]), null);
  });

  it("takes the soonest eligible booking, not the first empty one it likes", () => {
    const soon = booking({ id: "soon" });
    const later = booking({
      id: "later",
      slotStart: new Date("2026-08-27T17:00:00.000Z"),
    });

    assert.equal(bookingWorthHosting([soon, later])?.id, "soon");
  });
});

describe("whether a member may still change a booking", () => {
  it("offers a change on a session that has not started", () => {
    assert.equal(isAmendable(booking(), new Date("2026-08-20T16:00:00.000Z")), true);
  });

  it("withdraws the offer once it has", () => {
    /* A card offering "cancel" on a session that started an hour ago is an
       offer the server will refuse, which teaches a member not to trust the
       buttons. */
    assert.equal(isAmendable(booking(), new Date("2026-08-20T17:30:00.000Z")), false);
  });
});

/* ============================================================================
   §3.2, §10 — THE CONVERSION ROUTE
   ========================================================================= */

describe("when a guest is worth inviting to join", () => {
  const guest = (visits: number): HostedGuest => ({
    invitationId: "invitation-1",
    name: "Ada Bello",
    status: "attended",
    issuedAt: new Date("2026-07-01T00:00:00.000Z"),
    bookingId: null,
    visitsAcrossAllHosts: visits,
  });

  it("waits until the threshold", () => {
    assert.equal(isWorthConverting(guest(CONVERSION_VISITS - 1)), false);
    assert.equal(isWorthConverting(guest(CONVERSION_VISITS)), true);
  });

  it("counts visits across all hosts, not this host's", () => {
    /* §3.2 counts them this way deliberately: "someone brought four times by
       four different members is the person most likely to join". The type has
       no per-host count to be tempted by, which is the point of asserting the
       shape here. */
    const brought = guest(4);
    assert.equal(brought.visitsAcrossAllHosts, 4);
    assert.equal(isWorthConverting(brought), true);
  });
});

/* ============================================================================
   §11 — WHAT A STACK OF REFUSALS ADDS UP TO
   ========================================================================= */

describe("the status a set of refusals adds up to", () => {
  it("is clear when there is nothing to say", () => {
    assert.equal(statusOf({ blocking: 0, foreseen: 0 }), "clear");
  });

  it("is attention for something the member can deal with in advance", () => {
    assert.equal(statusOf({ blocking: 0, foreseen: 2 }), "attention");
  });

  it("is blocked when something stops them now, whatever else is pending", () => {
    /* §4.3 resolves a row to its single most fundamental reason. A member who
       is blocked AND has an expiring licence is blocked. */
    assert.equal(statusOf({ blocking: 1, foreseen: 5 }), "blocked");
  });
});
