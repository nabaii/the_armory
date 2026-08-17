import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isAmendable, type MemberBooking } from "./member-bookings";

/**
 * ONE MEMBER MUST NOT BE ABLE TO ACT ON ANOTHER MEMBER'S RECORDS.
 *
 * ===========================================================================
 * WHY THIS TEST READS SOURCE INSTEAD OF CALLING A FUNCTION
 *
 * The guarantee lives in a WHERE clause. Proving it by execution needs a
 * database with two memberships and a booking under each, which is an
 * integration test this suite does not have a harness for — and the version of
 * it that runs without one, a hand-rolled fake `ArmoryReader` asserting on the
 * SQL it was handed, tests the mock rather than the query.
 *
 * So this asserts the constraint is present in the code that performs it. It is
 * the same move `glaze.test.ts` makes when it reads the stylesheet: a narrow
 * structural check on the one value whose loss would be silent, standing in for
 * a runtime check that cannot be written here.
 *
 * It is a weaker test than executing the query and it guards the exact failure
 * that already happened. `cancelInvitation` took an invitation id from a form,
 * passed it to a function that reads by id and asks nothing about the caller,
 * and let any signed-in member cancel any other member's guest. Nothing typed,
 * linted or tested would have caught it, and the receipt would look legitimate,
 * because the operation itself is one the club performs.
 *
 * ===========================================================================
 * IF THIS FAILS
 *
 * Do not delete the assertion. Either the ownership constraint has been removed
 * from a member-facing path — which is the bug this exists for — or the code
 * was restructured and the check needs to point somewhere new. The second is
 * fine; establish where ownership is enforced now and re-aim it.
 */

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("a member-facing read is scoped to the member", () => {
  const bookings = source("./member-bookings.ts");

  it("constrains memberBookingById on the caller's membership", () => {
    const fn = bookings.slice(bookings.indexOf("export async function memberBookingById"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));

    assert.ok(
      body.includes("eq(schema.bookings.hostMembershipId, input.membershipId)"),
      "memberBookingById must filter on hostMembershipId — it is the read behind the booking detail screen and behind cancellation, and without it either will serve another member's booking",
    );
  });

  it("constrains upcomingBookingsFor the same way", () => {
    const fn = bookings.slice(bookings.indexOf("export async function upcomingBookingsFor"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));

    assert.ok(
      body.includes("eq(schema.bookings.hostMembershipId, input.membershipId)"),
      "upcomingBookingsFor must filter on hostMembershipId",
    );
  });
});

describe("a member-facing cancel asks whose record it is", () => {
  it("checks the invitation belongs to the caller before cancelling it", () => {
    const hosting = source("../../app/actions/hosting.ts");
    const fn = hosting.slice(hosting.indexOf("export async function cancelInvitation"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));

    assert.ok(
      body.includes("schema.guestInvitations.hostMembershipId") &&
        body.includes("resolution.member.membershipId"),
      "cancelInvitation must confirm the invitation is the caller's own — applyInvitationEvent reads by id and cannot do it, because it is also the desk's function",
    );
  });

  it("resolves the booking through the scoped read before cancelling it", () => {
    const amend = source("../../app/actions/booking-amend.ts");

    assert.ok(
      amend.includes("memberBookingById"),
      "cancelBooking must go through the scoped read rather than passing a form id straight to applyBookingEvent",
    );
    assert.ok(
      amend.includes("membershipId: resolution.member.membershipId"),
      "and it must pass the caller's own membership to it",
    );
  });
});

/* ============================================================================
   THE ONE RULE THAT DECIDES WHETHER CANCELLING IS OFFERED
   ========================================================================= */

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

describe("when a booking is still the member's to cancel", () => {
  it("is amendable right up to the moment it starts", () => {
    const start = new Date("2026-08-20T17:00:00.000Z");

    assert.equal(
      isAmendable(booking(), new Date(start.getTime() - 60_000)),
      true,
      "a minute before is still theirs — the club has set no cancellation window, and inventing one here would put a number in front of members that nobody at the club chose",
    );
    assert.equal(
      isAmendable(booking(), start),
      false,
      "at the start it is the range's, not the member's",
    );
    assert.equal(
      isAmendable(booking(), new Date(start.getTime() + 60_000)),
      false,
    );
  });
});
