import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hydrate, type DayPack } from "./daypack";
import { todayRows, todaySummary } from "./today";

/**
 * §6.4: "Expected arrivals in time order … and ONE status indicator — clear,
 *        attention, blocked."
 * §12.1: "Guest arrives before host → Blocked with a clear reason. Clears
 *         automatically when the host checks in — no retry needed."
 *
 * The second one is the reason this module is a pure function. "Clears
 * automatically" is not a subscription or a refetch — it is this function called
 * again with a larger set of people who are present, which is what a check-in
 * produces locally with no network at all.
 */

const NOW = new Date("2026-08-12T09:00:00.000Z");
const TODAY = "2026-08-12";

const HOST = "11111111-1111-4111-8111-111111111111";
const GUEST = "22222222-2222-4222-8222-222222222222";
const LATE = "33333333-3333-4333-8333-333333333333";
const TIER = "44444444-4444-4444-8444-444444444444";
const WAIVER = "55555555-5555-4555-8555-555555555555";
const INVITATION = "66666666-6666-4666-8666-666666666666";

function pack(overrides: Partial<DayPack> = {}): DayPack {
  return {
    pulledAt: "2026-08-12T07:00:00.000Z",
    windowStart: TODAY,
    windowEnd: "2026-08-13",
    activeWaiverVersionId: WAIVER,
    waiverValidityDays: null,
    storageEnabled: false,
    disciplinesRequiringQualification: [],

    tiers: [
      {
        id: TIER,
        name: "Full",
        canHost: true,
        guestAllowanceAnnual: 6,
        guestConcurrentMax: 2,
        canOwnFirearm: true,
        canStoreFirearm: false,
        disciplineAccess: ["25m-pistol"],
        bookingHorizonDays: 14,
        concurrentBookingsMax: 2,
        active: true,
      },
    ],

    people: [
      { id: HOST, firstName: "Ada", lastName: "Nwosu", photoUrl: null },
      { id: GUEST, firstName: "Bode", lastName: "Adeyemi", photoUrl: null },
      { id: LATE, firstName: "Chidi", lastName: "Okafor", photoUrl: null },
    ],

    memberships: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        personId: HOST,
        tierId: TIER,
        memberNumber: 14,
        status: "active",
        endedOn: null,
        renewsOn: "2027-01-01",
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        personId: LATE,
        tierId: TIER,
        memberNumber: 22,
        status: "lapsed",
        endedOn: "2026-07-31",
        renewsOn: null,
      },
    ],

    licences: [],
    qualifications: [],

    waiverSignatures: [
      { personId: HOST, waiverVersionId: WAIVER, signedAt: "2026-01-05T10:00:00.000Z" },
      { personId: GUEST, waiverVersionId: WAIVER, signedAt: "2026-08-11T18:00:00.000Z" },
      { personId: LATE, waiverVersionId: WAIVER, signedAt: "2026-02-01T10:00:00.000Z" },
    ],

    allowances: [],

    invitations: [
      {
        id: INVITATION,
        hostMembershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        hostPersonId: HOST,
        guestPersonId: GUEST,
        bookingId: null,
        status: "completed",
        expiresAt: "2026-08-12T23:00:00.000Z",
        isChargeable: true,
      },
    ],

    arrivals: [
      {
        personId: GUEST,
        bookingId: null,
        sessionId: null,
        role: "guest_shooter",
        discipline: "25m-pistol",
        slotStart: "2026-08-12T10:00:00.000Z",
        hostPersonId: HOST,
        invitationId: INVITATION,
      },
      {
        personId: HOST,
        bookingId: null,
        sessionId: null,
        role: "member_shooter",
        discipline: "25m-pistol",
        slotStart: "2026-08-12T10:00:00.000Z",
        hostPersonId: null,
        invitationId: null,
      },
      {
        personId: LATE,
        bookingId: null,
        sessionId: null,
        role: "member_shooter",
        discipline: "25m-pistol",
        slotStart: "2026-08-12T14:00:00.000Z",
        hostPersonId: null,
        invitationId: null,
      },
    ],

    firearms: [],
    ammunitionLots: [],
    staff: [],
    devices: [],
    ...overrides,
  };
}

const rows = (checkedIn: string[] = []) =>
  todayRows(hydrate(pack()), TODAY, NOW, new Set(checkedIn));

describe("the Today screen", () => {
  it("§6.4: lists arrivals in time order", () => {
    const list = rows();
    assert.deepEqual(
      list.map((row) => row.name),
      ["Bode Adeyemi", "Ada Nwosu", "Chidi Okafor"],
    );
  });

  it("§12.1: the guest is blocked before the host arrives", () => {
    const guest = rows().find((row) => row.personId === GUEST);
    assert.ok(guest);
    assert.notEqual(guest.status, "clear");
    assert.match(guest.line, /Ada/, "the block names the host, not a code");
  });

  it("§12.1: the guest clears when the host checks in — no retry", () => {
    /* The same pack, the same clock, the same function. The only thing that changed
       is that the host is now on the premises, which is exactly what a local
       check-in produces with no network. */
    const before = rows().find((row) => row.personId === GUEST);
    const after = rows([HOST]).find((row) => row.personId === GUEST);

    assert.ok(before && after);
    assert.notEqual(before.status, "clear");
    assert.equal(after.status, "clear");
    assert.equal(after.line, "", "a cleared row says nothing");
  });

  it("a lapsed member is flagged with the reason, not a code", () => {
    const late = rows().find((row) => row.personId === LATE);
    assert.ok(late);
    assert.notEqual(late.status, "clear");
    assert.match(late.line, /[.]$/);
    assert.ok(!/[A-Z_]{4,}/.test(late.line), `shows a reason code: "${late.line}"`);
  });

  it("§6.4: a member shows their tier, a guest shows their host", () => {
    const list = rows();
    assert.equal(list.find((row) => row.personId === HOST)?.subtitle, "Full");
    assert.equal(
      list.find((row) => row.personId === GUEST)?.subtitle,
      "Guest of Ada Nwosu",
    );
  });

  it("renders one status per row and only the three §6.4 allows", () => {
    for (const row of rows()) {
      assert.ok(
        ["clear", "attention", "blocked"].includes(row.status),
        `unexpected status: ${row.status}`,
      );
    }
  });

  it("distinguishes what an officer may override from what they may not", () => {
    /* §4.3 permits an override "where the override is permitted". The indicator has
       to carry that difference, because `attention` means "you may let this through
       and record why" and `blocked` means "this is not yours to waive". */
    const list = rows();
    for (const row of list) {
      if (row.status === "attention") assert.equal(row.overridable, true);
      if (row.status === "blocked") assert.equal(row.overridable, false);
    }
  });

  it("survives an arrival for somebody the pack does not carry", () => {
    /* The failure mode of throwing here is a blank Today screen at eight in the
       morning. §1.1: the range keeps operating. */
    const broken = pack({
      arrivals: [
        {
          personId: "99999999-9999-4999-8999-999999999999",
          bookingId: null,
          sessionId: null,
          role: "member_shooter",
          discipline: "25m-pistol",
          slotStart: "2026-08-12T11:00:00.000Z",
          hostPersonId: null,
          invitationId: null,
        },
      ],
    });

    const list = todayRows(hydrate(broken), TODAY, NOW, new Set());
    assert.equal(list.length, 1);
    assert.equal(list[0].status, "blocked");
    assert.match(list[0].line, /does not have on file/);
  });

  it("only shows the requested day", () => {
    const tomorrow = todayRows(hydrate(pack()), "2026-08-13", NOW, new Set());
    assert.equal(tomorrow.length, 0);
  });

  it("summarises the day in one sentence", () => {
    assert.match(todaySummary(rows()), /3 arrivals expected/);
    assert.match(todaySummary(rows()), /needing attention/);
    assert.equal(todaySummary([]), "No arrivals expected today.");
  });
});
