import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { uuidv7 } from "@/lib/uuidv7";
import { PUSH_OPERATIONS, type PushOperation, type PushRequest } from "./contract";
import { handlePush, type AppendOnlyWriter } from "./push";
import { parsePush, type AppendOnlyInsert } from "./operations";

/**
 * §7:  "A queued write delivered twice must produce one row, not two. This is the
 *       single most important API requirement in the system."
 * §12: "Every write endpoint has a replay test proving one row results from two
 *       identical deliveries."
 * §8.5: "Reconnect. Every record must reach the server exactly once."
 *
 * The replay tests below are that requirement, run against every operation the
 * push endpoint accepts rather than against one representative.
 */

const NOW = new Date("2026-08-12T10:30:00.000Z");
const DEVICE = "6f1a3d2e-4b5c-4d7e-8f90-1a2b3c4d5e6f";
const STAFF = "7a2b4c6d-8e90-4f12-a345-b6c7d8e9f012";

/**
 * A writer that behaves like `INSERT … ON CONFLICT (id) DO NOTHING`.
 *
 * The whole idempotency argument rests on the primary key being the
 * client-generated id, so the fake keys on exactly that and nothing else — if the
 * real statement ever conflicts on something different, this test stops
 * describing it.
 */
class FakeWriter implements AppendOnlyWriter {
  readonly rows = new Map<
    string,
    { target: string; values: Record<string, unknown> }
  >();
  attempts = 0;

  async insert(row: AppendOnlyInsert): Promise<{ created: boolean }> {
    this.attempts += 1;
    /* `id` is optional on every insert type because the schema supplies a default,
       but `parsePush` always sets it — that is §7's whole mechanism, and the
       assertion in the replay tests below is what holds it true. */
    const id = row.values.id as string;
    if (this.rows.has(id)) return { created: false };
    this.rows.set(id, { target: row.target, values: { ...row.values } });
    return { created: true };
  }
}

class BrokenWriter implements AppendOnlyWriter {
  async insert(): Promise<{ created: boolean }> {
    throw new Error("connection reset");
  }
}

/* ---------------------------------------------------------------------------
   A valid payload for each operation.

   Kept as one record so that adding an operation to PUSH_OPERATIONS without
   adding a payload here fails the exhaustiveness test below rather than quietly
   going untested.
   -------------------------------------------------------------------------- */

const SESSION = "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9";
const PERSON = "2b3c4d5e-6f70-4182-93a4-b5c6d7e8f901";
const FIREARM = "4d5e6f70-8192-43a4-b5c6-d7e8f9012345";
const LOT = "5e6f7081-92a3-44b5-c6d7-e8f901234567";
const PARTICIPATION = "6f708192-a3b4-45c6-d7e8-f90123456789";
const WAIVER_VERSION = "708192a3-b4c5-46d7-e8f9-012345678901";

const payloads: Record<PushOperation, unknown> = {
  "participations.checkin": {
    sessionId: SESSION,
    personId: PERSON,
    role: "member_shooter",
    hostPersonId: null,
    laneId: null,
    tierSnapshot: { id: "tier-full", name: "Full" },
    checkedInAt: "2026-08-12T09:15:00.000Z",
  },
  "waiver_signatures.create": {
    personId: PERSON,
    waiverVersionId: WAIVER_VERSION,
    signatureImageUrl: null,
    signedAt: "2026-08-12T09:14:00.000Z",
  },
  "custody_events.create": {
    firearmId: FIREARM,
    eventType: "issued",
    counterpartyPersonId: PERSON,
    sessionId: SESSION,
    occurredAt: "2026-08-12T09:20:00.000Z",
    correctsEventId: null,
    note: null,
  },
  "ammunition_issues.create": {
    lotId: LOT,
    participationId: PARTICIPATION,
    qtyIssued: 40,
    issuedAt: "2026-08-12T09:21:00.000Z",
  },
  "rounds.create": {
    participationId: PARTICIPATION,
    discipline: "25m-pistol",
    format: "60-shot",
    totalScore: 548,
    shotDetail: null,
    captureMethod: "manual",
    sourceReference: null,
    capturedAt: "2026-08-12T10:05:00.000Z",
    correctsRoundId: null,
    correctionReason: null,
  },
  "audit_log.create": {
    action: "check_in",
    entityType: "participation",
    entityId: PARTICIPATION,
    occurredAt: "2026-08-12T09:15:00.000Z",
    isOverride: false,
  },
};

const request = (
  operation: PushOperation,
  overrides: Partial<PushRequest> = {},
): PushRequest => ({
  id: uuidv7(),
  operation,
  payload: payloads[operation],
  deviceId: DEVICE,
  actorStaffId: STAFF,
  clientRecordedAt: "2026-08-12T09:15:00.000Z",
  ...overrides,
});

/* ===========================================================================
   THE REPLAY GUARANTEE — §7, §12
   ======================================================================== */

describe("a queued write delivered twice produces one row", () => {
  for (const operation of PUSH_OPERATIONS) {
    it(`${operation}: two identical deliveries, one row`, async () => {
      const writer = new FakeWriter();
      const item = request(operation);

      const first = await handlePush(item, writer, () => NOW);
      const second = await handlePush(item, writer, () => NOW);

      assert.equal(first.kind, "applied");
      assert.equal(
        second.kind,
        "duplicate",
        "a replay must be reported as already present, not applied again",
      );
      assert.equal(writer.rows.size, 1, "§7: one row, not two");
      assert.equal(writer.attempts, 2, "both deliveries reached the writer");
    });
  }

  it("survives the delivery being repeated many times", async () => {
    /* The outbox marks an item inflight before sending and retries anything found
       inflight on restart, so a device losing power mid-request repeatedly can
       deliver the same record several times. */
    const writer = new FakeWriter();
    const item = request("custody_events.create");

    for (let i = 0; i < 5; i += 1) {
      await handlePush(item, writer, () => NOW);
    }

    assert.equal(writer.rows.size, 1);
  });

  it("two different records are two rows", async () => {
    /* The other half of the guarantee: idempotency must not collapse distinct
       records. Two rounds fired by the same shooter in the same session differ
       only by id and score. */
    const writer = new FakeWriter();

    await handlePush(request("rounds.create"), writer, () => NOW);
    await handlePush(request("rounds.create"), writer, () => NOW);

    assert.equal(writer.rows.size, 2);
  });
});

/* ===========================================================================
   ATTRIBUTION — §7, §10
   ======================================================================== */

describe("every write is attributed", () => {
  it("records the device and the officer on every operation", async () => {
    for (const operation of PUSH_OPERATIONS) {
      const writer = new FakeWriter();
      await handlePush(request(operation), writer, () => NOW);

      const [row] = [...writer.rows.values()];
      assert.equal(row.values.deviceId, DEVICE, `${operation} lost the device`);

      /* The actor column is named differently per table — §7 asks for the
         property, not a column name. */
      const actor =
        row.values.actorStaffId ??
        row.values.checkedInByStaffId ??
        row.values.issuedByStaffId ??
        row.values.capturedByStaffId;

      /* waiver_signatures has no actor column: a signature is attributed to the
         person who signed it, not to the officer watching. */
      if (operation !== "waiver_signatures.create") {
        assert.equal(actor, STAFF, `${operation} lost the officer`);
      }
    }
  });

  it("keeps the device's own timestamp as the domain time", () => {
    /* §2: "Client-generated timestamps are recorded alongside server receipt
       time, never instead of it." A firearm issued during a power cut and pushed
       the next morning must read as having been issued during the power cut. */
    const parsed = parsePush(request("custody_events.create"));
    assert.ok(parsed.ok);
    assert.equal(parsed.row.target, "custodyEvents");
    if (parsed.row.target !== "custodyEvents") return;

    assert.equal(
      parsed.row.values.occurredAt?.toISOString(),
      "2026-08-12T09:20:00.000Z",
    );
    assert.ok(
      !("recordedAt" in parsed.row.values),
      "recordedAt is the server's clock and must be left to the database default",
    );
  });

  it("refuses a record whose identity is not a UUIDv7", () => {
    /* Not pedantry: the outbox's strict ordering is a lexicographic sort on this
       id, and only v7 sorts into creation order. A v4 id would take its place in
       the queue at random. */
    const parsed = parsePush(
      request("rounds.create", { id: "9f8e7d6c-5b4a-4938-8271-605f4e3d2c1b" }),
    );
    assert.equal(parsed.ok, false);
    assert.ok(!parsed.ok && /identity/.test(parsed.reason));
  });
});

/* ===========================================================================
   REFUSALS — §8.2, §4.3
   ======================================================================== */

describe("refusals reach an officer as sentences", () => {
  it("names a payload for every operation the endpoint accepts", () => {
    /* Exhaustiveness tripwire. Adding an operation without a payload here means
       it is accepted by the endpoint and never tested. */
    assert.deepEqual(
      Object.keys(payloads).sort(),
      [...PUSH_OPERATIONS].sort(),
      "an operation was added or removed without updating the test payloads",
    );
  });

  it("§3.3: a guest checked in without a host is refused, in English", () => {
    const parsed = parsePush(
      request("participations.checkin", {
        payload: {
          ...(payloads["participations.checkin"] as object),
          role: "guest_shooter",
          hostPersonId: null,
        },
      }),
    );

    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.reason, /guest cannot be checked in without/);
    assert.ok(parsed.remedy, "a refusal at the desk has to say what to do next");
  });

  it("§1.2: a correction that cites nothing is refused", () => {
    const parsed = parsePush(
      request("custody_events.create", {
        payload: {
          ...(payloads["custody_events.create"] as object),
          eventType: "correction",
          correctsEventId: null,
        },
      }),
    );

    assert.equal(parsed.ok, false);
    assert.ok(!parsed.ok && /which entry it corrects/.test(parsed.reason));
  });

  it("§3.6: an override with no reason is refused", () => {
    const parsed = parsePush(
      request("audit_log.create", {
        payload: {
          ...(payloads["audit_log.create"] as object),
          isOverride: true,
          overrideReason: null,
        },
      }),
    );

    assert.equal(parsed.ok, false);
    assert.ok(!parsed.ok && /override has to be recorded with a reason/.test(parsed.reason));
  });

  it("a rejection never reads as a stack trace", () => {
    const parsed = parsePush(
      request("rounds.create", { payload: { discipline: "25m-pistol" } }),
    );

    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.reason, /[.]$/);
    assert.ok(
      !/undefined|null|TypeError|Error:/.test(parsed.reason),
      `reads as a crash: "${parsed.reason}"`,
    );
  });

  it("a rejected record is never written", async () => {
    const writer = new FakeWriter();
    const result = await handlePush(
      request("rounds.create", { payload: {} }),
      writer,
      () => NOW,
    );

    assert.equal(result.kind, "rejected");
    assert.equal(writer.rows.size, 0);
  });
});

/* ===========================================================================
   FAILURE IS NOT REFUSAL — §8.2, §8.4
   ======================================================================== */

describe("a broken database is retryable, not a rejection", () => {
  it("reports failure so the queue backs off instead of discarding", async () => {
    /* policy.ts quarantines a rejection immediately and retries a failure six
       times. Reporting a dropped connection as a rejection would surface a
       perfectly valid custody event to the founder as unacceptable, and stop
       trying to deliver it. */
    const result = await handlePush(
      request("custody_events.create"),
      new BrokenWriter(),
      () => NOW,
    );

    assert.equal(result.kind, "failed");
  });
});
