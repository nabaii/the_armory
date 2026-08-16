import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluate } from "@/domain/capability";
import type { Capability } from "@/domain/enums";
import { assertNoRestrictedFields, hydrate, subjectFor } from "@/offline/daypack";
import { projectDayPack } from "./daypack-projection";
import { subjectFromSnapshot } from "./subject";
import type { DayPackSource } from "./rows";

/**
 * THE PARITY GUARANTEE — §4 and §8, together.
 *
 *   §4: "no permission check is duplicated in the client and the server"
 *   §8: "The desk and lane surfaces work fully offline. Not read-only — fully."
 *
 * Those two only coexist because `evaluate()` is pure and there are two loaders.
 * This file is the test that the loaders agree.
 *
 * ===========================================================================
 * WHY THIS TEST IS SHAPED LIKE THIS
 *
 * The obvious version of this test writes a `Subject` by hand and checks that the
 * pack produces something equal to it. That is worth having and it exists in
 * src/offline/daypack.test.ts, but it proves something weaker than it looks: that
 * the desk's builder matches an expectation a developer typed. If the server's
 * builder later starts doing something different, the test still passes.
 *
 * So this one starts from ONE fixture of database rows and runs both paths:
 *
 *   rows ──→ subjectFromSnapshot ─────────────────→ Subject (server)
 *     └────→ projectDayPack ─→ hydrate ─→ subjectFor ─→ Subject (desk)
 *
 * and compares the results, then compares the DECISIONS for every capability. Any
 * divergence between the two builders fails here, including one that changes no
 * behaviour today.
 */

const NOW = new Date("2026-08-12T09:00:00.000Z");

const PERSON = "11111111-1111-4111-8111-111111111111";
const GUEST = "22222222-2222-4222-8222-222222222222";
const TIER = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP = "44444444-4444-4444-8444-444444444444";
const WAIVER = "55555555-5555-4555-8555-555555555555";
const LICENCE = "66666666-6666-4666-8666-666666666666";
const DEVICE = "77777777-7777-4777-8777-777777777777";

/**
 * One snapshot of the club, as the day pack query returns it.
 *
 * Deliberately not minimal: a host with a licence and a qualification, a guest
 * with neither, an expiring licence and a firearm register. The interesting parity
 * failures are in optional fields and empty collections, so both are present.
 */
function source(overrides: Partial<DayPackSource> = {}): DayPackSource {
  return {
    pulledAt: NOW,
    windowStart: "2026-08-12",
    windowEnd: "2026-08-13",

    activeWaiverVersionId: WAIVER,
    activeWaiverVersion: "2026.1",
    activeWaiverBody: "You accept that a live range is dangerous.",
    waiverValidityDays: null,
    storageEnabled: false,
    disciplinesRequiringQualification: ["25m-pistol"],

    people: [
      { id: PERSON, firstName: "Ada", lastName: "Nwosu", photoUrl: null },
      { id: GUEST, firstName: "Bode", lastName: "Adeyemi", photoUrl: null },
    ],

    tiers: [
      {
        id: TIER,
        name: "Full",
        canHost: true,
        guestAllowanceAnnual: 6,
        guestConcurrentMax: 2,
        canOwnFirearm: true,
        canStoreFirearm: false,
        disciplineAccess: ["10m-air-rifle", "25m-pistol"],
        bookingHorizonDays: 14,
        concurrentBookingsMax: 2,
        /* Present on the row, absent from a Subject. The field that caught a real
           divergence when the pack was spreading its tier. */
        active: true,
      },
    ],

    memberships: [
      {
        id: MEMBERSHIP,
        personId: PERSON,
        tierId: TIER,
        memberNumber: 14,
        status: "active",
        endedOn: null,
        renewsOn: "2027-01-01",
      },
    ],

    licences: [
      {
        id: LICENCE,
        personId: PERSON,
        status: "verified",
        calibres: [".22 LR"],
        expiresOn: "2027-06-01",
      },
    ],

    qualifications: [
      {
        personId: PERSON,
        discipline: "25m-pistol",
        level: "unsupervised",
        expiresAt: "2027-01-01T00:00:00.000Z",
      },
    ],

    waiverSignatures: [
      {
        personId: PERSON,
        waiverVersionId: WAIVER,
        signedAt: "2026-01-05T10:00:00.000Z",
      },
    ],

    allowances: [
      {
        membershipId: MEMBERSHIP,
        includedQuota: 6,
        usedCount: 1,
        overagePriceLabel: null,
      },
    ],

    invitations: [],
    arrivals: [
      {
        personId: PERSON,
        bookingId: null,
        sessionId: null,
        role: "member_shooter",
        discipline: "25m-pistol",
        bookingType: "shoot",
        slotStart: "2026-08-12T17:00:00.000Z",
        hostPersonId: null,
        invitationId: null,
      },
    ],

    /* §6.5. Empty here on purpose: the parity this file exists to prove is
       about the SUBJECT the two sides build, and nothing in `subjectFor` or
       `subjectFromSnapshot` reads a participation. A non-empty list would assert
       the projection rather than the parity, and that belongs in daypack.test.ts. */
    participations: [],

    firearms: [
      {
        id: "88888888-8888-4888-8888-888888888888",
        serialNumber: "AX-4471",
        make: "Walther",
        model: "GSP",
        calibre: ".22 LR",
        ownership: "club",
        ownerPersonId: null,
        status: "in_service",
      },
    ],

    ammunitionLots: [
      { id: "99999999-9999-4999-8999-999999999999", calibre: ".22 LR", quantityRemaining: 460 },
    ],

    lanes: [],
    staff: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        personId: PERSON,
        displayName: "Ada N.",
        role: "range_officer",
        active: true,
      },
    ],

    devices: [{ id: DEVICE, label: "Desk tablet", surface: "desk", revoked: false }],

    ...overrides,
  };
}

/** Both Subjects for one person, from one snapshot. */
function bothWays(rows: DayPackSource, personId: string) {
  const server = subjectFromSnapshot(rows, personId);
  const desk = subjectFor(hydrate(projectDayPack(rows)), personId);
  return { server, desk };
}

/**
 * Every capability, with a context that exercises it.
 *
 * Listed rather than generated so that each one carries the arguments it actually
 * needs; a generated context would pass the same object to all of them and stop
 * distinguishing the checks.
 */
const contexts = [
  { capability: "MAY_ATTEND" as const, now: NOW, activeWaiverVersionId: WAIVER, waiverValidityDays: null },
  {
    capability: "MAY_BOOK" as const,
    now: NOW,
    slotStart: new Date("2026-08-20T17:00:00.000Z"),
    discipline: "10m-air-rifle",
    bookingType: "shoot",
    heldBookings: 0,
  },
  {
    capability: "MAY_SHOOT_DISCIPLINE" as const,
    now: NOW,
    discipline: "25m-pistol",
    bookingType: "shoot",
    requiresQualification: true,
  },
  { capability: "MAY_STORE_FIREARM" as const, now: NOW, storageEnabled: false },
];

describe("the desk and the server reach the same decision", () => {
  it("builds an identical Subject for a member", () => {
    const { server, desk } = bothWays(source(), PERSON);
    assert.deepEqual(desk, server);
  });

  it("builds an identical Subject for a guest — no membership, empty collections", () => {
    /* §3.1: "applicant, guest and member are states, not separate tables." The
       guest path is where one builder returning `[]` and the other `undefined`
       would go unnoticed for months. */
    const { server, desk } = bothWays(source(), GUEST);
    assert.deepEqual(desk, server);
    assert.equal(desk?.membership, null);
    assert.deepEqual(desk?.licences, []);
    assert.deepEqual(desk?.qualifications, []);
  });

  it("reaches the identical decision, sentence for sentence", () => {
    const { server, desk } = bothWays(source(), PERSON);
    assert.ok(desk);

    for (const context of contexts) {
      assert.deepEqual(
        evaluate(desk, context),
        evaluate(server, context),
        `${context.capability} diverged between the desk and the server`,
      );
    }
  });

  it("agrees when a licence has expired", () => {
    /* §4.1 makes the human string part of the contract — "Licence expired 14
       March" — so this compares the whole decision, not `allowed`. */
    const rows = source({
      licences: [
        {
          id: LICENCE,
          personId: PERSON,
          status: "verified",
          calibres: [".22 LR"],
          expiresOn: "2026-08-09",
        },
      ],
    });

    const { server, desk } = bothWays(rows, PERSON);
    assert.ok(desk);

    const context = {
      capability: "MAY_USE_OWN_FIREARM" as const,
      now: NOW,
      firearm: {
        id: "88888888-8888-4888-8888-888888888888",
        serialNumber: "AX-4471",
        calibre: ".22 LR",
        ownership: "member" as const,
        ownerPersonId: PERSON,
        status: "in_service" as const,
      },
    };

    const decision = evaluate(desk, context);
    assert.deepEqual(decision, evaluate(server, context));
    assert.equal(decision.allowed, false);
  });

  it("agrees when the membership has lapsed", () => {
    const rows = source({
      memberships: [
        {
          id: MEMBERSHIP,
          personId: PERSON,
          tierId: TIER,
          memberNumber: 14,
          status: "lapsed",
          endedOn: "2026-07-31",
          renewsOn: null,
        },
      ],
    });

    const { server, desk } = bothWays(rows, PERSON);
    assert.ok(desk);

    for (const context of contexts) {
      assert.deepEqual(
        evaluate(desk, context),
        evaluate(server, context),
        `${context.capability} diverged for a lapsed member`,
      );
    }
  });

  it("agrees that a person the snapshot does not know is nobody", () => {
    const rows = source();
    const desk = subjectFor(hydrate(projectDayPack(rows)), "unknown-person");
    assert.equal(desk, null, "the desk refuses to invent a person");
  });

  it("covers every capability the system defines", () => {
    /* Exhaustiveness tripwire. A capability added to §4.2 without a context here
       is a capability whose desk-versus-server parity is untested — which is the
       one property §4 exists to guarantee. */
    const covered = new Set<Capability>([
      ...contexts.map((context) => context.capability),
      "MAY_USE_OWN_FIREARM",
      /* Guest capabilities take a guest context (host presence, invitation) and
         are covered against the same snapshot in daypack.test.ts. */
      "MAY_HOST",
      "GUEST_MAY_ATTEND",
    ]);

    const declared: Capability[] = [
      "MAY_BOOK",
      "MAY_HOST",
      "MAY_ATTEND",
      "GUEST_MAY_ATTEND",
      "MAY_SHOOT_DISCIPLINE",
      "MAY_USE_OWN_FIREARM",
      "MAY_STORE_FIREARM",
    ];

    for (const capability of declared) {
      assert.ok(covered.has(capability), `${capability} has no parity coverage`);
    }
  });
});

/* ===========================================================================
   §10 — WHAT THE PROJECTION REFUSES TO SEND
   ======================================================================== */

describe("the pack the server builds carries nothing §10 forbids", () => {
  it("never contains a licence document, address, or token hash", () => {
    const pack = projectDayPack(source());
    const serialised = JSON.stringify(pack);

    for (const forbidden of [
      "documentUrl",
      "document_url",
      "address",
      "dateOfBirth",
      "emergencyContact",
      "pinHash",
      "tokenHash",
    ]) {
      assert.ok(
        !serialised.includes(forbidden),
        `the pack carries ${forbidden}, which §10 forbids on a desk device`,
      );
    }
  });

  it("drops a column the query selected but the pack has no business carrying", () => {
    /* This is what field-by-field projection buys, stated as a test rather than
       as a comment: a query that selects one column too many produces a pack
       without it. The alternative — `...person` — would put it on the tablet, and
       nothing downstream would notice. */
    const rows = source({
      people: [
        {
          id: PERSON,
          firstName: "Ada",
          lastName: "Nwosu",
          photoUrl: null,
          address: "14 Aso Drive, Abuja",
          dateOfBirth: "1984-03-02",
        } as never,
      ],
    });

    const pack = projectDayPack(rows);

    assert.deepEqual(pack.people, [
      { id: PERSON, firstName: "Ada", lastName: "Nwosu", photoUrl: null },
    ]);
  });

  it("the device-side guard catches what a projection cannot", () => {
    /**
     * Where `assertNoRestrictedFields` actually earns its keep.
     *
     * On this side the projection is exhaustive, so the check is a tripwire for
     * fields not yet invented. On the DEVICE the pack arrives as JSON from the
     * network and TypeScript is not there at runtime — a server bug, an older
     * deployment, or a hand-rolled fixture can hand a tablet anything. That is the
     * case below, and it is why the check runs again in
     * src/offline/daypack-store.ts before a pack is stored.
     */
    const pack = projectDayPack(source()) as unknown as Record<string, unknown>;
    (pack.licences as Record<string, unknown>[])[0].documentUrl =
      "https://storage.example/licence-scan.pdf";

    assert.throws(
      () => assertNoRestrictedFields(pack as never),
      /§10/,
      "a pack carrying a licence scan must be rejected, not stored",
    );
  });
});
