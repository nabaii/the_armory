import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { uuidv7 } from "@/lib/uuidv7";
import { MemoryRecordStore, type MemoryTx } from "./memory-store";
import {
  applied,
  record,
  refused,
  type RecordRequest,
  type Written,
} from "./record";

/**
 * §7:  "Every write accepts a client-generated UUIDv7 as the record identity and
 *       is safe to replay. A queued write delivered twice must produce one row,
 *       not two."
 * §12: "Every write endpoint has a replay test proving one row results from two
 *       identical deliveries."
 *
 * src/sync/push.test.ts discharges that for the append-only class, where the
 * primary key carries the idempotency. This discharges it for §8.2's other
 * class — server-authoritative operations, where the idempotency has to be
 * carried by the receipt because the operation is a change rather than a row.
 */

const NOW = new Date("2026-08-13T09:15:00.000Z");
const DEVICE = "6f1a3d2e-4b5c-4d7e-8f90-1a2b3c4d5e6f";
const STAFF = "7a2b4c6d-8e90-4f12-a345-b6c7d8e9f012";

const request = (overrides: Partial<RecordRequest> = {}): RecordRequest => ({
  requestId: uuidv7(),
  operation: "memberships.admit",
  actor: { staffUserId: STAFF, deviceId: DEVICE },
  occurredAt: NOW,
  ...overrides,
});

/**
 * A body that counts how often it actually ran.
 *
 * The count is the whole point. A replay that returns the right answer by
 * running the work a second time is not idempotent — it is lucky, and it stops
 * being lucky the moment the work is a membership admission that allocates a
 * member number from a sequence §3.1 says is "never reused".
 */
function countingBody<T>(result: T) {
  let runs = 0;
  return {
    get runs() {
      return runs;
    },
    body: async (): Promise<Written<T>> => {
      runs += 1;
      return applied(result, [
        { action: "admit", entityType: "membership", entityId: null },
      ]);
    },
  };
}

describe("a server-authoritative write delivered twice", () => {
  it("runs the work once and returns the first result to the second delivery", async () => {
    const store = new MemoryRecordStore();
    const req = request();
    const counting = countingBody({ membershipId: "m-1", memberNumber: 42 });

    const first = await record(store, req, counting.body);
    const second = await record(store, req, counting.body);

    assert.equal(counting.runs, 1, "the body ran more than once");

    assert.equal(first.status, "applied");
    assert.equal(second.status, "duplicate");

    assert.deepEqual(
      first.status === "applied" ? first.result : null,
      second.status === "duplicate" ? second.result : undefined,
      "a replay returned a different answer from the original",
    );
  });

  it("allocates a scarce number once, however many times it is delivered", async () => {
    /* §3.1: member_number is "unique, sequential, never reused". This is the
       failure the receipt exists to prevent — not a duplicated row, but a
       consumed sequence value that nothing can give back. */
    const store = new MemoryRecordStore();
    const req = request();
    let nextNumber = 1;

    const body = async (): Promise<Written<{ memberNumber: number }>> =>
      applied({ memberNumber: nextNumber++ });

    await record(store, req, body);
    await record(store, req, body);
    await record(store, req, body);

    assert.equal(nextNumber, 2, "the sequence advanced on a replay");
  });

  it("writes one audit row, not one per delivery", async () => {
    const store = new MemoryRecordStore();
    const req = request();
    const counting = countingBody({ ok: true });

    await record(store, req, counting.body);
    await record(store, req, counting.body);

    assert.equal(store.audit.length, 1);
  });
});

describe("a refusal", () => {
  const denied = async (): Promise<Written<never>> =>
    refused(
      {
        code: "NOT_PAYABLE",
        message:
          "A suspended membership is reinstated by the founder, not by payment.",
      },
      [
        {
          action: "admit",
          entityType: "membership",
          entityId: "m-1",
          before: { status: "suspended" },
        },
      ],
    );

  it("reaches the caller as a sentence, not a code", async () => {
    const store = new MemoryRecordStore();
    const outcome = await record(store, request(), denied);

    assert.equal(outcome.status, "refused");
    if (outcome.status !== "refused") return;

    /* §4.3: "Every block returns a specific single-line reason. Never 'not
       permitted', never a code, never a stack of conditions." */
    assert.match(outcome.refusal.message, /founder/);
    assert.doesNotMatch(outcome.refusal.message, /NOT_PAYABLE/);
    assert.equal(outcome.refusal.message.trim().split("\n").length, 1);
  });

  it("is recorded in the audit log even though nothing was written", async () => {
    /* §3.6: the audit covers "every custody event, score, waiver, admission,
       guest authorisation, BLOCK and override". Blocks included — §4.3's
       promise that a member never first hears of a problem at the desk is
       unmeasurable without them. */
    const store = new MemoryRecordStore();

    await record(store, request(), denied);

    assert.equal(store.audit.length, 1);
    assert.equal(store.audit[0].entityId, "m-1");
    assert.equal(store.audit[0].actorStaffId, STAFF);
  });

  it("does not become sticky — a later delivery is evaluated again", async () => {
    /* The world moves between deliveries. A licence that was pending review
       when the desk first pushed may be verified by the time the tablet
       reconnects, and a cached "no" would tell the officer to fix something
       that is already fixed. */
    const store = new MemoryRecordStore();
    const req = request();

    let verified = false;
    const body = async (): Promise<Written<{ ok: true }>> =>
      verified
        ? applied({ ok: true } as const)
        : refused({ code: "UNVERIFIED", message: "That licence has not been checked yet." });

    const before = await record(store, req, body);
    assert.equal(before.status, "refused");

    verified = true;

    const after = await record(store, req, body);
    assert.equal(
      after.status,
      "applied",
      "the refusal was cached and the retry never re-evaluated",
    );
  });
});

describe("attribution", () => {
  it("stamps the actor, the device and the device's clock on every audit row", async () => {
    /* §7: "ATTRIBUTED. Every write records actor, device and both client and
       server timestamps." The body supplies none of these — it cannot forget
       them, which is the reason they are stamped by the envelope. */
    const store = new MemoryRecordStore();

    await record(store, request(), async () =>
      applied({ ok: true }, [
        { action: "verify", entityType: "licence", entityId: "l-1" },
      ]),
    );

    const [row] = store.audit;
    assert.equal(row.actorStaffId, STAFF);
    assert.equal(row.deviceId, DEVICE);
    assert.equal(row.occurredAt.toISOString(), NOW.toISOString());
  });

  it("marks an override and carries its reason", async () => {
    /* §3.6: "An override is permitted but never silent — override_reason is
       mandatory when present." */
    const store = new MemoryRecordStore();

    await record(store, request(), async () =>
      applied({ ok: true }, [
        {
          action: "admit",
          entityType: "application",
          entityId: "a-1",
          override: { reason: "Founder admitted over the roster cap; board minute 14/3." },
        },
      ]),
    );

    const [row] = store.audit;
    assert.equal(row.isOverride, true);
    assert.match(row.overrideReason ?? "", /board minute/);
  });

  it("leaves an ordinary write unmarked", async () => {
    const store = new MemoryRecordStore();

    await record(store, request(), async () =>
      applied({ ok: true }, [
        { action: "verify", entityType: "licence", entityId: "l-1" },
      ]),
    );

    assert.equal(store.audit[0].isOverride, false);
    assert.equal(store.audit[0].overrideReason, null);
  });
});

describe("a fault", () => {
  it("rolls back the claim so the write can be retried", async () => {
    /* A refusal commits; a fault must not. If a dropped connection left a claim
       behind, the request id would be permanently poisoned — every retry would
       find the receipt taken and answer IN_FLIGHT forever, and the record would
       never be written at all. */
    const store = new MemoryRecordStore();
    const req = request();

    await assert.rejects(
      record(store, req, async () => {
        throw new Error("connection terminated unexpectedly");
      }),
      /connection terminated/,
    );

    assert.equal(store.committedReceipts.length, 0);

    const retry = await record(store, req, async () => applied({ ok: true }));
    assert.equal(retry.status, "applied");
  });

  it("takes its audit rows down with it", async () => {
    const store = new MemoryRecordStore();

    await assert.rejects(
      record(store, request(), async (): Promise<Written<never>> => {
        throw new Error("connection terminated unexpectedly");
      }),
    );

    assert.equal(store.audit.length, 0);
  });
});

describe("a request already in flight", () => {
  it("is told to wait rather than being run a second time", async () => {
    /* The claim is held by a transaction that has not resolved. In Postgres the
       second INSERT blocks on the unique index and this branch is reached only
       after the first resolves; the fake reaches it directly. Either way the
       answer must never be "run it again". */
    const store = new MemoryRecordStore();
    const req = request();
    let runs = 0;

    await store.transaction(async (tx: MemoryTx) => {
      await store.claim(tx, {
        requestId: req.requestId,
        operation: req.operation,
        deviceId: DEVICE,
        actorStaffId: STAFF,
      });
    });

    const outcome = await record(store, req, async () => {
      runs += 1;
      return applied({ ok: true });
    });

    assert.equal(runs, 0);
    assert.equal(outcome.status, "refused");
    if (outcome.status !== "refused") return;
    assert.equal(outcome.refusal.code, "IN_FLIGHT");
    /* Still a sentence, and one that says the record is safe — an officer
       reading "IN_FLIGHT" would reasonably assume something had been lost. */
    assert.match(outcome.refusal.message, /Nothing was lost/);
  });
});
