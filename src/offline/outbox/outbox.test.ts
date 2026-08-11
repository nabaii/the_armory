import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Outbox, type OutboxItem, type SendResult } from "./outbox";
import { MemoryOutboxStore } from "./memory-store";
import {
  BASE_DELAY_MS,
  MAX_ATTEMPTS,
  MAX_DELAY_MS,
  backoffDelayMs,
  decideAfterFailure,
  lastSyncLine,
  queueSummary,
} from "./policy";

/**
 * §8 — the offline layer.
 *
 *   "The largest single line of effort in the build and the one that produces
 *    no visible feature… an offline layer that mostly works is worse than
 *    none, because staff will trust it."
 *
 * These tests cover the rules. They do NOT discharge §8.5, which is explicit
 * that the definition of done is a real tablet with the power pulled, and that
 * "Browser devtools offline mode does not substitute for it and must not be
 * accepted as evidence." A passing suite here is a precondition for that test,
 * not a replacement for it.
 */

const DEVICE = "device-desk-1";
const t = (iso: string) => new Date(iso);

/** A clock the test drives by hand. */
function clock(start: string) {
  let current = t(start);
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
    set(iso: string) {
      current = t(iso);
    },
  };
}

function makeOutbox(options: { start?: string; onAlert?: (i: OutboxItem) => void } = {}) {
  const store = new MemoryOutboxStore();
  const c = clock(options.start ?? "2026-08-10T09:00:00Z");
  const outbox = new Outbox(store, {
    now: c.now,
    /* Deterministic jitter: always the top of the range, so backoff windows
       are exact and the tests do not flake. */
    random: () => 0.999999,
    onAlert: options.onAlert,
  });
  return { outbox, store, clock: c };
}

const enqueue = (outbox: Outbox, operation: string, payload: unknown = {}) =>
  outbox.enqueue({ operation, payload, deviceId: DEVICE, actorStaffId: "staff-1" });

const OK: SendResult = { ok: true };
const UNREACHABLE: SendResult = { ok: false, failure: "unreachable" };
const SERVER_ERROR: SendResult = { ok: false, failure: "server_error" };
const REJECTED: SendResult = { ok: false, failure: "rejected", message: "FK violation" };
const UNAUTHORISED: SendResult = { ok: false, failure: "unauthorised" };

/* ===========================================================================
   THE CORE GUARANTEE — §7
   ======================================================================== */

describe("§7 idempotency", () => {
  it("the queued item's id IS the record id, so a replay is an upsert", async () => {
    const { outbox } = makeOutbox();
    const id = await enqueue(outbox, "custody-events.create", { serial: "AX-4471" });

    const seen: string[] = [];
    await outbox.drain(async (item) => {
      seen.push(item.id);
      return OK;
    });

    assert.equal(seen.length, 1);
    assert.equal(seen[0], id, "the server must be sent the id the device chose");
  });

  it("delivering the same item twice reaches the server with one identity", async () => {
    /* §7: "A queued write delivered twice must produce one row, not two."
       The queue's contribution to that guarantee is that both deliveries
       carry the same id — the server's unique key does the rest. */
    const { outbox, clock: c } = makeOutbox();
    await enqueue(outbox, "rounds.create", { total: 94 });

    const ids: string[] = [];
    const flaky = async (item: OutboxItem): Promise<SendResult> => {
      ids.push(item.id);
      return ids.length === 1 ? UNREACHABLE : OK;
    };

    await outbox.drain(flaky);
    c.advance(MAX_DELAY_MS);
    await outbox.drain(flaky);

    assert.equal(ids.length, 2, "it was delivered twice");
    assert.equal(ids[0], ids[1], "both deliveries carried the same identity");
  });

  it("attributes every write to a device and an actor (§7)", async () => {
    const { outbox } = makeOutbox();
    await enqueue(outbox, "participations.check-in");

    await outbox.drain(async (item) => {
      assert.equal(item.deviceId, DEVICE);
      assert.equal(item.actorStaffId, "staff-1");
      return OK;
    });
  });
});

/* ===========================================================================
   ORDER — §8.4
   ======================================================================== */

describe("§8.4 ordering", () => {
  it("delivers in creation order", async () => {
    const { outbox } = makeOutbox();
    await enqueue(outbox, "participations.check-in");
    await enqueue(outbox, "ammunition-issues.create");
    await enqueue(outbox, "rounds.create");

    const order: string[] = [];
    await outbox.drain(async (item) => {
      order.push(item.operation);
      return OK;
    });

    assert.deepEqual(order, [
      "participations.check-in",
      "ammunition-issues.create",
      "rounds.create",
    ]);
  });

  it("holds the queue behind a failing head rather than reordering", async () => {
    /* An ammunition issue references the participation it was issued against.
       Sending it first is a foreign key violation on a perfectly valid
       record. */
    const { outbox } = makeOutbox();
    await enqueue(outbox, "participations.check-in");
    await enqueue(outbox, "ammunition-issues.create");

    const attempted: string[] = [];
    const result = await outbox.drain(async (item) => {
      attempted.push(item.operation);
      return UNREACHABLE;
    });

    assert.deepEqual(attempted, ["participations.check-in"]);
    assert.equal(result.stoppedBy, "backoff");
  });

  it("releases the head on quarantine so the rest can move", async () => {
    /* Quarantine's main job is unblocking, not tidiness. */
    const { outbox, clock: c } = makeOutbox();
    await enqueue(outbox, "poison");
    await enqueue(outbox, "good");

    const delivered: string[] = [];
    const send = async (item: OutboxItem): Promise<SendResult> => {
      if (item.operation === "poison") return SERVER_ERROR;
      delivered.push(item.operation);
      return OK;
    };

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await outbox.drain(send);
      c.advance(MAX_DELAY_MS);
    }

    assert.deepEqual(delivered, ["good"], "the healthy record got through");
    const counts = await outbox.counts();
    assert.equal(counts.quarantined, 1);
  });
});

/* ===========================================================================
   BACKOFF — §8.4
   ======================================================================== */

describe("§8.4 backoff", () => {
  it("grows exponentially and is capped", () => {
    const top = (attempts: number) => backoffDelayMs(attempts, () => 0.999999);
    assert.ok(top(0) < top(1));
    assert.ok(top(1) < top(2));
    assert.ok(top(20) <= MAX_DELAY_MS);
  });

  it("never returns a negative or unbounded delay", () => {
    for (let attempts = 0; attempts < 12; attempts += 1) {
      for (const r of [0, 0.5, 0.999999]) {
        const delay = backoffDelayMs(attempts, () => r);
        assert.ok(delay >= 0, "delay must not be negative");
        assert.ok(delay <= MAX_DELAY_MS, "delay must respect the cap");
      }
    }
  });

  it("jitters, so devices do not retry in lockstep when the link returns", () => {
    const spread = new Set(
      [0.05, 0.25, 0.5, 0.75, 0.95].map((r) => backoffDelayMs(4, () => r)),
    );
    assert.ok(spread.size > 1, "identical delays would burst the link");
  });

  it("does not retry before its window has elapsed", async () => {
    const { outbox, clock: c } = makeOutbox();
    await enqueue(outbox, "rounds.create");

    let attempts = 0;
    const send = async (): Promise<SendResult> => {
      attempts += 1;
      return UNREACHABLE;
    };

    await outbox.drain(send);
    assert.equal(attempts, 1);

    /* Immediately again: still in backoff, nothing sent. */
    await outbox.drain(send);
    assert.equal(attempts, 1);

    c.advance(BASE_DELAY_MS * 2 ** 1 + 1);
    await outbox.drain(send);
    assert.equal(attempts, 2);
  });
});

/* ===========================================================================
   NOTHING IS SILENTLY DISCARDED — §8.2, §8.4
   ======================================================================== */

describe("nothing is silently discarded", () => {
  it("§8.2: a server rejection surfaces to the officer and keeps the payload", async () => {
    const alerts: OutboxItem[] = [];
    const { outbox } = makeOutbox({ onAlert: (i) => alerts.push(i) });
    await enqueue(outbox, "custody-events.create", { serial: "AX-4471" });

    await outbox.drain(async () => REJECTED);

    const attention = await outbox.needingAttention();
    assert.equal(attention.length, 1);
    assert.equal(attention[0].state, "rejected");
    assert.deepEqual(
      attention[0].payload,
      { serial: "AX-4471" },
      "the record may be the only evidence a firearm left the rack",
    );
    assert.equal(alerts.length, 1, "the founder is told");
  });

  it("a rejection is not retried — the same bytes get the same answer", async () => {
    const { outbox, clock: c } = makeOutbox();
    await enqueue(outbox, "custody-events.create");

    let attempts = 0;
    const send = async (): Promise<SendResult> => {
      attempts += 1;
      return REJECTED;
    };

    await outbox.drain(send);
    c.advance(MAX_DELAY_MS * 10);
    await outbox.drain(send);

    assert.equal(attempts, 1);
  });

  it("§8.4: quarantine alerts the founder after repeated failure", async () => {
    const alerts: OutboxItem[] = [];
    const { outbox, clock: c } = makeOutbox({ onAlert: (i) => alerts.push(i) });
    await enqueue(outbox, "rounds.create");

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await outbox.drain(async () => UNREACHABLE);
      c.advance(MAX_DELAY_MS);
    }

    const counts = await outbox.counts();
    assert.equal(counts.quarantined, 1);
    assert.equal(alerts.length, 1);
  });

  it("prune removes only delivered items, never a quarantined one", async () => {
    const { outbox, clock: c } = makeOutbox();
    await enqueue(outbox, "delivered");
    await outbox.drain(async () => OK);

    await enqueue(outbox, "poison");
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await outbox.drain(async () => SERVER_ERROR);
      c.advance(MAX_DELAY_MS);
    }

    c.advance(86_400_000);
    const removed = await outbox.prune(c.now());

    assert.equal(removed, 1, "only the delivered item");
    const counts = await outbox.counts();
    assert.equal(counts.quarantined, 1, "the quarantined record survives pruning");
  });
});

/* ===========================================================================
   POWER LOSS — §8.5
   ======================================================================== */

describe("§8.5 power loss", () => {
  it("an item interrupted mid-flight is retried, not lost", async () => {
    /* The plug is pulled between marking inflight and hearing back. On
       restart the item is found in `inflight` and must be sent again — a
       duplicate delivery, which §7's idempotency makes free. Losing it is
       the alternative, and it is not acceptable. */
    const store = new MemoryOutboxStore();
    const c = clock("2026-08-10T09:00:00Z");

    const before = new Outbox(store, { now: c.now, random: () => 0 });
    const id = await before.enqueue({
      operation: "custody-events.create",
      payload: { serial: "AX-4471" },
      deviceId: DEVICE,
      actorStaffId: "staff-1",
    });

    /* Simulate the interruption: the send never resolves an outcome. */
    await before.drain(async () => {
      throw new Error("power lost");
    });

    /* A fresh Outbox over the SAME store is the restart. */
    const after = new Outbox(store, { now: c.now, random: () => 0 });
    c.advance(MAX_DELAY_MS);

    const delivered: string[] = [];
    await after.drain(async (item) => {
      delivered.push(item.id);
      return OK;
    });

    assert.deepEqual(delivered, [id], "the record survived the power cut");
    const counts = await after.counts();
    assert.equal(counts.done, 1);
  });

  it("the queue survives a restart with its state intact", async () => {
    const store = new MemoryOutboxStore();
    const c = clock("2026-08-10T09:00:00Z");

    const before = new Outbox(store, { now: c.now, random: () => 0 });
    await before.enqueue({
      operation: "waiver-signatures.create",
      payload: { person: "guest" },
      deviceId: DEVICE,
      actorStaffId: null,
    });

    const after = new Outbox(store, { now: c.now, random: () => 0 });
    const counts = await after.counts();
    assert.equal(counts.pending, 1);
  });
});

/* ===========================================================================
   SESSION LOSS — a queue must not be poisoned by a locked device
   ======================================================================== */

describe("device lock", () => {
  it("holds the whole queue on 401 without counting it towards quarantine", async () => {
    const { outbox } = makeOutbox();
    await enqueue(outbox, "one");
    await enqueue(outbox, "two");
    await enqueue(outbox, "three");

    const result = await outbox.drain(async () => UNAUTHORISED);
    assert.equal(result.stoppedBy, "unauthorised");

    const counts = await outbox.counts();
    assert.equal(counts.held, 3, "everything waits, not just the head");
    assert.equal(counts.quarantined, 0, "a timed-out PIN must not park records");
  });

  it("releases on unlock without resetting attempts", async () => {
    const { outbox, clock: c } = makeOutbox();
    await enqueue(outbox, "one");

    /* One genuine failure first, so attempts is non-zero. */
    await outbox.drain(async () => SERVER_ERROR);
    c.advance(MAX_DELAY_MS);
    await outbox.drain(async () => UNAUTHORISED);

    const released = await outbox.release();
    assert.equal(released, 1);

    const counts = await outbox.counts();
    assert.equal(counts.pending, 1);

    /* Attempts survived: signing in does not make a poison message healthy. */
    let observed = 0;
    await outbox.drain(async (i) => {
      observed = i.attempts;
      return OK;
    });
    assert.equal(observed, 2, "attempts were not reset by the unlock");
  });
});

/* ===========================================================================
   THE DESK INDICATOR — §8.4, §6.4
   ======================================================================== */

describe("§8.4 the queue is never silent", () => {
  it("reports a clear queue", async () => {
    const { outbox } = makeOutbox();
    const status = await outbox.status();
    assert.equal(status.tone, "clear");
    assert.equal(status.depth, 0);
  });

  it("reports depth while waiting", async () => {
    const { outbox } = makeOutbox();
    await enqueue(outbox, "one");
    await enqueue(outbox, "two");

    const status = await outbox.status();
    assert.equal(status.tone, "waiting");
    assert.equal(status.depth, 2);
    assert.match(status.line, /2 records waiting/);
  });

  it("escalates to attention when something is stuck", async () => {
    const { outbox } = makeOutbox();
    await enqueue(outbox, "one");
    await outbox.drain(async () => REJECTED);

    const status = await outbox.status();
    assert.equal(status.tone, "attention");
    assert.match(status.line, /could not be sent/);
  });

  it("distinguishes behind from broken", () => {
    const waiting = queueSummary({
      pending: 3, inflight: 0, held: 0, quarantined: 0, rejected: 0,
    });
    const broken = queueSummary({
      pending: 3, inflight: 0, held: 0, quarantined: 1, rejected: 0,
    });
    assert.equal(waiting.tone, "waiting");
    assert.equal(broken.tone, "attention");
  });

  it("states last sync in words a range officer can act on", () => {
    const now = t("2026-08-10T09:00:00Z");
    assert.equal(lastSyncLine(null, now), "Not synced on this device yet.");
    assert.equal(lastSyncLine(t("2026-08-10T08:59:30Z"), now), "Synced just now.");
    assert.equal(lastSyncLine(t("2026-08-10T08:30:00Z"), now), "Synced 30 minutes ago.");
    assert.equal(lastSyncLine(t("2026-08-10T06:00:00Z"), now), "Synced 3 hours ago.");
    assert.equal(lastSyncLine(t("2026-08-09T09:00:00Z"), now), "Synced yesterday.");
  });

  it("records the time of a successful sync", async () => {
    const { outbox, store } = makeOutbox({ start: "2026-08-10T09:00:00Z" });
    await enqueue(outbox, "one");
    await outbox.drain(async () => OK);

    const lastSync = await store.getLastSyncAt();
    assert.deepEqual(lastSync, t("2026-08-10T09:00:00Z"));
  });
});

/* ===========================================================================
   POLICY UNITS
   ======================================================================== */

describe("failure policy", () => {
  const now = t("2026-08-10T09:00:00Z");

  it("retries what may succeed and parks what will not", () => {
    assert.equal(decideAfterFailure("unreachable", 1, now).state, "pending");
    assert.equal(decideAfterFailure("server_error", 1, now).state, "pending");
    assert.equal(decideAfterFailure("rejected", 1, now).state, "rejected");
    assert.equal(decideAfterFailure("unauthorised", 1, now).state, "held");
  });

  it("quarantines only after the full attempt budget", () => {
    assert.equal(
      decideAfterFailure("unreachable", MAX_ATTEMPTS - 1, now).state,
      "pending",
    );
    assert.equal(
      decideAfterFailure("unreachable", MAX_ATTEMPTS, now).state,
      "quarantined",
    );
  });

  it("writes notes for a person, not for a log", () => {
    for (const kind of ["unreachable", "server_error", "rejected", "unauthorised"] as const) {
      const { note } = decideAfterFailure(kind, 1, now);
      assert.ok(note.length > 0);
      assert.ok(/[.]$/.test(note), `not a sentence: "${note}"`);
      assert.ok(
        !/error code|null|undefined|[45]\d\d/i.test(note),
        `leaks machine detail: "${note}"`,
      );
    }
  });

  it("alerts the founder exactly when something needs a human", () => {
    assert.equal(decideAfterFailure("unreachable", 1, now).alertFounder, false);
    assert.equal(decideAfterFailure("unreachable", MAX_ATTEMPTS, now).alertFounder, true);
    assert.equal(decideAfterFailure("rejected", 1, now).alertFounder, true);
    assert.equal(decideAfterFailure("unauthorised", 1, now).alertFounder, false);
  });
});

/* ===========================================================================
   REQUEUE
   ======================================================================== */

describe("requeue", () => {
  it("puts a quarantined record back once a human has looked", async () => {
    const { outbox, clock: c } = makeOutbox();
    const id = await enqueue(outbox, "custody-events.create");

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await outbox.drain(async () => SERVER_ERROR);
      c.advance(MAX_DELAY_MS);
    }
    assert.equal((await outbox.counts()).quarantined, 1);

    assert.equal(await outbox.requeue(id), true);
    assert.equal((await outbox.counts()).pending, 1);

    await outbox.drain(async () => OK);
    assert.equal((await outbox.counts()).done, 1);
  });

  it("refuses to requeue something that is not stuck", async () => {
    const { outbox } = makeOutbox();
    const id = await enqueue(outbox, "one");
    assert.equal(await outbox.requeue(id), false);
    assert.equal(await outbox.requeue("no-such-id"), false);
  });
});
