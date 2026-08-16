import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluate } from "@/domain/capability";
import { hydrate, subjectFor, type DayPack } from "./daypack";
import { personDetail } from "./person";
import { todayRows } from "./today";
import {
  buildWaiverSignature,
  signedWaivers,
  pendingImages,
  type CapturedSignature,
  type LocalWaiverSignature,
} from "./waiver";

/**
 * §8.5 step 9: "sign a waiver".
 *
 * docs/M1_offline_acceptance.md recorded steps 9–12 as unbuilt, and the M5 edit
 * moved the line to "steps 5–11 are built" while only equipment had been added —
 * so step 9 was claimed and missing. These are the tests for the layer that
 * closes it.
 *
 * The delivery half was never in doubt: src/sync/push.test.ts already proves
 * `waiver_signatures.create` produces one row when delivered twice. What had no
 * coverage was anything that BUILT one.
 */

const NOW = new Date("2026-08-14T17:00:00.000Z");
const DAY = 86_400_000;

const captured: CapturedSignature = {
  contentType: "image/png",
  /* Node has Blob globally from 18. The bytes are irrelevant to every rule here;
     what matters is that something was captured. */
  bytes: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
};

function pack(overrides: Partial<DayPack> = {}): DayPack {
  return {
    pulledAt: "2026-08-14T05:00:00.000Z",
    windowStart: "2026-08-14",
    windowEnd: "2026-08-15",
    activeWaiverVersionId: "waiver-active",
    activeWaiverVersion: "2026.1",
    activeWaiverBody: "You accept that a live range is dangerous.",
    waiverValidityDays: null,
    storageEnabled: false,
    disciplinesRequiringQualification: [],
    tiers: [
      {
        id: "tier-1",
        name: "Full",
        active: true,
        canHost: true,
        guestAllowanceAnnual: 10,
        guestConcurrentMax: 2,
        canOwnFirearm: true,
        canStoreFirearm: false,
        disciplineAccess: ["25m-pistol"],
        bookingHorizonDays: 30,
        concurrentBookingsMax: 3,
      },
    ],
    people: [
      { id: "p-1", firstName: "Ada", lastName: "Okoro", photoUrl: null },
    ],
    memberships: [
      {
        id: "m-1",
        personId: "p-1",
        tierId: "tier-1",
        memberNumber: 1,
        status: "active",
        endedOn: null,
        renewsOn: null,
      },
    ],
    licences: [],
    qualifications: [],
    waiverSignatures: [],
    allowances: [],
    invitations: [],
    arrivals: [],
    firearms: [],
    ammunitionLots: [],
    lanes: [],
    staff: [],
    devices: [],
    ...overrides,
  };
}

const context = (overrides: Partial<Parameters<typeof buildWaiverSignature>[2]> = {}) => ({
  actorStaffId: "staff-1",
  now: NOW,
  captured,
  ...overrides,
});

const build = (
  source: DayPack = pack(),
  input: Partial<Parameters<typeof buildWaiverSignature>[1]> = {},
  ctx: Partial<Parameters<typeof buildWaiverSignature>[2]> = {},
) =>
  buildWaiverSignature(
    hydrate(source),
    { personId: "p-1", alreadySigned: null, ...input },
    context(ctx),
  );

describe("the record a signature produces", () => {
  it("writes the signature against the version the pack says is active", () => {
    const result = build();
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.writes.signature.waiverVersionId, "waiver-active");
    assert.equal(result.writes.signature.personId, "p-1");
    assert.equal(result.writes.signature.signedAt, NOW.toISOString());
  });

  it("queues the signature and its audit row, in that order", () => {
    /* §3.6 lists waivers among the things that are audited. Two rows, not one
       transaction — the same shape as a check-in, and for the same reason. */
    const result = build();
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.deepEqual(
      result.writes.queue.map((item) => item.operation),
      ["waiver_signatures.create", "audit_log.create"],
    );
  });

  it("gives the queued write the signature's own id, so a replay is one row", () => {
    /* §7. The record's id IS the queue item's id; the endpoint's idempotency is
       an insert on a key that already exists. push.test.ts proves the other half. */
    const result = build();
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.writes.queue[0].id, result.writes.signature.id);
  });

  it("records the officer who witnessed it", () => {
    /* §10: "every staff action attributable to a named person." */
    const result = build();
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.writes.signature.witnessedByStaffId, "staff-1");
  });

  it("carries a null attribution rather than a stale name when no shift is live", () => {
    const result = build(pack(), {}, { actorStaffId: null });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.writes.signature.witnessedByStaffId, null);
  });
});

describe("the signature image", () => {
  it("names the object after the row, so no UPDATE is ever needed", () => {
    /* The whole reason the key is decided at signing time: waiver_signatures is
       append-only (drizzle/0002 rejects UPDATE), so a null written now could
       never be filled in later. */
    const result = build();
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(
      result.writes.signature.imageKey,
      `waivers/${result.writes.signature.id}.png`,
    );
  });

  it("puts the same key in the queued payload as in the local record", () => {
    const result = build();
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const payload = result.writes.queue[0].payload as {
      signatureImageUrl: string | null;
    };
    assert.equal(payload.signatureImageUrl, result.writes.signature.imageKey);
  });

  it("keeps the captured bytes with the record until something uploads them", () => {
    const result = build();
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.writes.signature.image, captured.bytes);
    assert.equal(pendingImages([result.writes.signature]).length, 1);
  });

  it("writes no key when the tablet took no mark", () => {
    /* A row with a key naming an object that will never exist would be worse
       than one that honestly holds none. */
    const result = build(pack(), {}, { captured: null });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.writes.signature.imageKey, null);
    assert.equal(result.writes.signature.image, null);
  });

  it("keeps the storage key out of the audit row", () => {
    /* §10 holds the key to the founder role, and the audit log is read on the
       dashboard. src/server/armory/licences.ts makes the same exclusion. */
    const result = build();
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(
      JSON.stringify(result.writes.queue[1].payload).includes("waivers/"),
      false,
    );
  });
});

describe("what the desk refuses", () => {
  it("refuses somebody the pack does not carry", () => {
    const result = build(pack(), { personId: "p-stranger" });
    assert.equal(result.ok, false);
    if (result.ok) return;

    assert.match(result.refusal.reason, /does not have that person on file/);
    assert.equal(result.refusal.remedy, "Sync while there is a connection.");
  });

  it("refuses when the pack carries no waiver text to show", () => {
    /**
     * A pack stored before the text travelled with it. Signing against a
     * document the desk could not display would produce a row that looks like
     * consent and is evidence of none.
     */
    const result = build(
      pack({ activeWaiverBody: null, activeWaiverVersion: null }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;

    assert.match(result.refusal.reason, /does not have the current waiver text/);
    assert.match(result.refusal.remedy ?? "", /Sync/);
  });

  it("refuses a second signature against the version already signed", () => {
    /* Not a prohibition on resigning — §3.1 makes a resignature a new row. This
       is the guard against a double-tap, which §7 cannot catch because the
       second attempt would carry a fresh UUIDv7 and land as a second row. */
    const result = build(pack(), {
      alreadySigned: {
        waiverVersionId: "waiver-active",
        signedAt: new Date(NOW.getTime() - 60_000),
      },
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.refusal.reason, /already signed the current waiver/);
  });

  it("permits signing when the held signature is against a superseded version", () => {
    /* §3.1: "exactly one active version at a time. A signature against any other
       is stale." This is the case scripts/seed.ts plants deliberately. */
    const result = build(pack(), {
      alreadySigned: {
        waiverVersionId: "waiver-old",
        signedAt: new Date(NOW.getTime() - DAY),
      },
    });

    assert.equal(result.ok, true);
  });

  it("permits signing when the held signature has aged out of its window", () => {
    const result = build(pack({ waiverValidityDays: 30 }), {
      alreadySigned: {
        waiverVersionId: "waiver-active",
        signedAt: new Date(NOW.getTime() - 31 * DAY),
      },
    });

    assert.equal(result.ok, true);
  });

  it("refuses inside the validity window the club has set", () => {
    const result = build(pack({ waiverValidityDays: 30 }), {
      alreadySigned: {
        waiverVersionId: "waiver-active",
        signedAt: new Date(NOW.getTime() - 29 * DAY),
      },
    });

    assert.equal(result.ok, false);
  });
});

describe("local signatures, as the capability service reads them", () => {
  const local = (
    overrides: Partial<LocalWaiverSignature> = {},
  ): LocalWaiverSignature => ({
    id: "sig-1",
    personId: "p-1",
    waiverVersionId: "waiver-active",
    signedAt: NOW.toISOString(),
    imageKey: "waivers/sig-1.png",
    image: null,
    witnessedByStaffId: "staff-1",
    ...overrides,
  });

  it("keeps the latest signature per person", () => {
    const map = signedWaivers([
      local({ id: "sig-1", signedAt: new Date(NOW.getTime() - DAY).toISOString() }),
      local({ id: "sig-2", waiverVersionId: "waiver-active" }),
    ]);

    assert.equal(map.get("p-1")?.signedAt.toISOString(), NOW.toISOString());
  });

  it("overlays a desk signature the pack cannot know about", () => {
    const subject = subjectFor(
      hydrate(pack()),
      "p-1",
      signedWaivers([local()]),
    );

    assert.equal(subject?.waiver?.waiverVersionId, "waiver-active");
  });

  it("prefers whichever signature is later, whichever side it came from", () => {
    /* Both directions happen: signed at the desk (local is newer), and signed in
       the portal while the tablet was offline (the pack is newer). */
    const withPackSignature = pack({
      waiverSignatures: [
        {
          personId: "p-1",
          waiverVersionId: "waiver-active",
          signedAt: NOW.toISOString(),
        },
      ],
    });

    const stale = signedWaivers([
      local({ signedAt: new Date(NOW.getTime() - DAY).toISOString() }),
    ]);

    const subject = subjectFor(hydrate(withPackSignature), "p-1", stale);
    assert.equal(subject?.waiver?.signedAt.toISOString(), NOW.toISOString());
  });

  it("reads exactly as before when nothing was signed locally", () => {
    /* The overlay is optional, and the server's parity test calls without it. */
    assert.equal(subjectFor(hydrate(pack()), "p-1")?.waiver, null);
  });
});

describe("the block clears without a reload", () => {
  /**
   * §12.1's mechanism, applied to §3.1's rule.
   *
   * This is the property the acceptance run checks by hand at step 9, and it is
   * the same one step 7 checks for a guest whose host arrives: nothing is
   * refetched and nothing is subscribed to. The row re-evaluates because
   * everything it depends on is an argument.
   */
  const arriving = pack({
    arrivals: [
      {
        personId: "p-1",
        role: "member_shooter",
        hostPersonId: null,
        invitationId: null,
        bookingId: "b-1",
        sessionId: "s-1",
        discipline: "25m-pistol",
        bookingType: "shoot",
        slotStart: "2026-08-14T17:30:00.000Z",
      },
    ],
    /* Signed against last year's version — the WAIVER_SUPERSEDED case the seed
       plants for every ninth member. */
    waiverSignatures: [
      {
        personId: "p-1",
        waiverVersionId: "waiver-old",
        signedAt: new Date(NOW.getTime() - 200 * DAY).toISOString(),
      },
    ],
  });

  it("blocks a superseded waiver, and says a signature is the way through", () => {
    const [row] = todayRows(hydrate(arriving), "2026-08-14", NOW, new Set());

    assert.equal(row.status, "blocked");
    assert.equal(row.needsWaiver, true);
    /* Not overridable — reasons.ts is explicit, so the check-in button on this
       row is disabled and signing is the only route. */
    assert.equal(row.overridable, false);
  });

  it("clears the row when the signature is taken, from local state alone", () => {
    const indexed = hydrate(arriving);

    const result = buildWaiverSignature(
      indexed,
      {
        personId: "p-1",
        alreadySigned: subjectFor(indexed, "p-1")?.waiver ?? null,
      },
      context(),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const [row] = todayRows(
      indexed,
      "2026-08-14",
      NOW,
      new Set(),
      signedWaivers([result.writes.signature]),
    );

    assert.equal(row.status, "clear");
    assert.equal(row.needsWaiver, false);
    assert.equal(row.line, "");
  });

  it("says the same thing on the Person panel as on the row behind it", () => {
    /**
     * The documents list and the blocks list are two paragraphs of one screen.
     * Before the overlay reached `documentLines` they read different sources,
     * so an officer who had just watched somebody sign was told an inch apart
     * that the waiver was in order and that it was out of date.
     */
    const indexed = hydrate(arriving);
    const signed = signedWaivers([
      {
        id: "sig-1",
        personId: "p-1",
        waiverVersionId: "waiver-active",
        signedAt: NOW.toISOString(),
        imageKey: "waivers/sig-1.png",
        image: null,
        witnessedByStaffId: "staff-1",
      },
    ]);

    const stale = personDetail(indexed, "p-1", NOW, new Set());
    const fresh = personDetail(indexed, "p-1", NOW, new Set(), signed);

    assert.equal(stale?.documents[0].live, false);
    assert.match(stale?.documents[0].state ?? "", /earlier version/);

    assert.equal(fresh?.documents[0].live, true);
    assert.equal(
      fresh?.blocks.some((block) => /waiver/i.test(block.message)),
      false,
    );
  });

  it("does not offer a signature to somebody blocked for another reason", () => {
    /**
     * §4.3 resolves a row to its single most fundamental reason. A member whose
     * membership has lapsed AND whose waiver is unsigned is shown the membership,
     * and signing would not admit them — so the offer is not made.
     */
    const lapsed = hydrate(
      pack({
        ...arriving,
        memberships: [
          {
            id: "m-1",
            personId: "p-1",
            tierId: "tier-1",
            memberNumber: 1,
            status: "lapsed",
            endedOn: "2026-01-01",
            renewsOn: null,
          },
        ],
      }),
    );

    const [row] = todayRows(lapsed, "2026-08-14", NOW, new Set());

    assert.equal(row.status !== "clear", true);
    assert.equal(row.needsWaiver, false);
  });

  it("admits the member the capability service's own answer, not a second opinion", () => {
    /* The row is clear because MAY_ATTEND says so against the overlaid subject —
       asserted directly here so a future change to `todayRows` cannot make the
       screen and the evaluator disagree about the same person. */
    const indexed = hydrate(arriving);
    const signature = {
      waiverVersionId: "waiver-active",
      signedAt: NOW,
    };

    const decision = evaluate(
      subjectFor(indexed, "p-1", new Map([["p-1", signature]]))!,
      {
        capability: "MAY_ATTEND",
        now: NOW,
        activeWaiverVersionId: "waiver-active",
        waiverValidityDays: null,
      },
    );

    assert.equal(decision.allowed, true);
  });
});
