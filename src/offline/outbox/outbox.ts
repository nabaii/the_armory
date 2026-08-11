import { uuidv7 } from "@/lib/uuidv7";
import {
  decideAfterFailure,
  isEligible,
  lastSyncLine,
  needsAttention,
  queueSummary,
  type FailureKind,
  type OutboxState,
} from "./policy";

/**
 * THE OUTBOX — Build Specification §8.4.
 *
 * Every write made on the desk or at the lane goes in here first and is sent
 * from here. Not "when offline" — always. A queue that is only used on the
 * failure path is a queue that is only exercised on the failure path, and §8
 * is blunt about the consequence: "an offline layer that mostly works is worse
 * than none, because staff will trust it."
 *
 * ===========================================================================
 * WHY THE ITEM ID IS THE RECORD ID
 *
 * §7: "Every write accepts a client-generated UUIDv7 as the record identity
 * and is safe to replay. A queued write delivered twice must produce one row,
 * not two. This is the single most important API requirement in the system."
 *
 * So an outbox item is not a job that creates a record — it IS the record,
 * waiting. Its id is the primary key the row will have. Which means a replay
 * is an upsert on a key that already exists, and delivering the same item
 * three times produces one row without the server needing to remember
 * anything about the first two.
 *
 * That is why this queue can be crude about at-least-once delivery. It does
 * not need to be exactly-once, because the write is idempotent. Trying to
 * build exactly-once delivery on an unreliable link is a well-known way to
 * lose data while appearing rigorous.
 *
 * ===========================================================================
 * STRICT ORDER, AND WHAT THAT COSTS
 *
 * §8.4 says "Ordered". This implementation is strictly FIFO by id — and since
 * ids are UUIDv7, id order is creation order (see src/lib/uuidv7.ts).
 *
 * Strict order means head-of-line blocking: an item that will not send holds
 * up everything behind it. That is deliberate rather than tolerated, because
 * queued records reference each other. An ammunition issue references the
 * participation it was issued against; a round references the participation
 * that fired it. Sending the later one first produces a foreign key violation
 * and a rejected record for something that was perfectly valid.
 *
 * Quarantine is what releases the head. That is its main job — not tidiness,
 * but unblocking the queue while keeping the payload and telling a human.
 */

export type OutboxItem = {
  /** UUIDv7. Also the primary key of the row this becomes. See above. */
  id: string;
  /** Which endpoint this belongs to, e.g. "custody-events.create". */
  operation: string;
  payload: unknown;

  state: OutboxState;
  attempts: number;

  /** What the device believed the time was when this was made. §2. */
  createdAt: Date;
  nextAttemptAt: Date | null;

  /** §7: every write is ATTRIBUTED. Carried with the item, not added later. */
  deviceId: string;
  actorStaffId: string | null;

  /** One line for the desk. Never a stack trace. */
  note: string | null;
  /** Detail for the founder's exception report, if any. */
  lastError: string | null;
};

/**
 * Durable storage for the queue.
 *
 * An interface rather than a direct IndexedDB dependency, so the ordering,
 * backoff and quarantine rules can be tested against an in-memory store in
 * milliseconds, and so the same queue can run in a Node test, in a browser,
 * and in a service worker's background sync — three environments with three
 * different IndexedDB stories.
 *
 * Implementations MUST be durable across tab close, app close, device restart
 * and power loss (§8.4). An in-memory implementation is for tests only and
 * must never be wired to a real surface.
 */
export interface OutboxStore {
  put(item: OutboxItem): Promise<void>;
  get(id: string): Promise<OutboxItem | null>;
  /** Every item, any state. Callers sort; the store need not. */
  all(): Promise<OutboxItem[]>;
  remove(id: string): Promise<void>;
  /** Last successful sync, for the desk indicator. */
  getLastSyncAt(): Promise<Date | null>;
  setLastSyncAt(at: Date): Promise<void>;
}

export type SendResult =
  | { ok: true }
  | { ok: false; failure: FailureKind; message?: string };

/** How an item reaches the server. Supplied by the caller. */
export type Sender = (item: OutboxItem) => Promise<SendResult>;

export type OutboxOptions = {
  now?: () => Date;
  random?: () => number;
  /** §8.4: "poison-message quarantine … with an alert to the founder." */
  onAlert?: (item: OutboxItem) => void;
};

export class Outbox {
  private readonly store: OutboxStore;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly onAlert: (item: OutboxItem) => void;

  /* Guards against two drains running at once — a background sync firing
     while the officer taps "retry", which would send the head item twice.
     Harmless given idempotency, but it wastes a scarce link. */
  private draining = false;

  constructor(store: OutboxStore, options: OutboxOptions = {}) {
    this.store = store;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.onAlert = options.onAlert ?? (() => undefined);
  }

  /**
   * Put a write in the queue and return its id.
   *
   * The id is returned because the CALLER needs it: it is the id of the
   * record, so the desk writes its local copy under the same key and the two
   * are the same row from the moment it is created.
   */
  async enqueue(input: {
    operation: string;
    payload: unknown;
    deviceId: string;
    actorStaffId: string | null;
    /** Supply only to adopt an id already generated for the local record. */
    id?: string;
  }): Promise<string> {
    const item: OutboxItem = {
      id: input.id ?? uuidv7(),
      operation: input.operation,
      payload: input.payload,
      state: "pending",
      attempts: 0,
      createdAt: this.now(),
      nextAttemptAt: null,
      deviceId: input.deviceId,
      actorStaffId: input.actorStaffId,
      note: null,
      lastError: null,
    };

    await this.store.put(item);
    return item.id;
  }

  /** Everything in the queue, in delivery order. */
  private async ordered(): Promise<OutboxItem[]> {
    const items = await this.store.all();
    /* UUIDv7 ids sort lexicographically into creation order, so this is the
       order the records were made in — across a restart, without a counter. */
    return items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /**
   * Send what can be sent.
   *
   * Returns when the queue is empty, when the head is not yet eligible, or
   * when something has stopped delivery entirely. Safe to call on a timer, on
   * `online`, and from background sync — concurrent calls are collapsed.
   */
  async drain(send: Sender): Promise<{ sent: number; stoppedBy: string | null }> {
    if (this.draining) return { sent: 0, stoppedBy: "already draining" };
    this.draining = true;

    try {
      let sent = 0;

      for (;;) {
        const queue = await this.ordered();
        const head = queue.find(
          (i) => i.state === "pending" || i.state === "inflight",
        );

        if (!head) return { sent, stoppedBy: null };

        /* Head is in backoff. Everything behind it waits — see the note on
           strict order above. */
        if (!isEligible(head, this.now())) {
          return { sent, stoppedBy: "backoff" };
        }

        /* Mark inflight BEFORE sending, and persist it. If the power fails
           mid-request the item is found in `inflight` on restart and retried;
           that is a duplicate delivery, which §7's idempotency makes free. The
           alternative — marking after — loses the record entirely. */
        const inflight: OutboxItem = { ...head, state: "inflight" };
        await this.store.put(inflight);

        const result = await send(inflight).catch(
          (error): SendResult => ({
            ok: false,
            failure: "unreachable",
            message: error instanceof Error ? error.message : String(error),
          }),
        );

        if (result.ok) {
          await this.store.put({
            ...inflight,
            state: "done",
            note: null,
            lastError: null,
          });
          await this.store.setLastSyncAt(this.now());
          sent += 1;
          continue;
        }

        const attempts = inflight.attempts + 1;
        const decision = decideAfterFailure(
          result.failure,
          attempts,
          this.now(),
          this.random,
        );

        const updated: OutboxItem = {
          ...inflight,
          state: decision.state,
          attempts,
          nextAttemptAt: decision.nextAttemptAt,
          note: decision.note,
          lastError: result.message ?? null,
        };
        await this.store.put(updated);

        if (decision.alertFounder) this.onAlert(updated);

        /* An expired session stops the whole queue, not just this item. */
        if (decision.state === "held") {
          await this.holdAll();
          return { sent, stoppedBy: "unauthorised" };
        }

        /* Quarantined or rejected: the head is released and the loop
           continues to the next item. Backing off: stop here. */
        if (decision.state === "pending") {
          return { sent, stoppedBy: "backoff" };
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /** Hold everything still waiting. Called when the device loses its session. */
  private async holdAll(): Promise<void> {
    const queue = await this.ordered();
    for (const item of queue) {
      if (item.state === "pending" || item.state === "inflight") {
        await this.store.put({
          ...item,
          state: "held",
          nextAttemptAt: null,
          note: "Waiting for a range officer to unlock this device.",
        });
      }
    }
  }

  /**
   * Release held items after a successful unlock.
   *
   * Attempts are NOT reset. A session expiring does not make a poison message
   * healthy, and zeroing the counter here would let a genuinely undeliverable
   * item start its six attempts again every time somebody signed in.
   */
  async release(): Promise<number> {
    const queue = await this.ordered();
    let released = 0;
    for (const item of queue) {
      if (item.state === "held") {
        await this.store.put({
          ...item,
          state: "pending",
          nextAttemptAt: null,
          note: null,
        });
        released += 1;
      }
    }
    return released;
  }

  /**
   * Put a quarantined item back in the queue, once a human has looked at it.
   *
   * Deliberately manual. §8.4 alerts the founder on quarantine; this is the
   * other half of that conversation, and it exists so that the answer to a
   * stuck queue is a decision rather than a longer retry loop.
   */
  async requeue(id: string): Promise<boolean> {
    const item = await this.store.get(id);
    if (!item) return false;
    if (item.state !== "quarantined" && item.state !== "rejected") return false;

    await this.store.put({
      ...item,
      state: "pending",
      attempts: 0,
      nextAttemptAt: null,
      note: null,
    });
    return true;
  }

  /**
   * Remove delivered items older than a cutoff.
   *
   * Only `done` items, ever. §8.2 and §8.4 between them mean nothing else in
   * this queue may be dropped by a background process — a quarantined custody
   * event that a cleanup job tidied away is exactly the silent loss the
   * specification keeps warning about.
   */
  async prune(olderThan: Date): Promise<number> {
    const queue = await this.ordered();
    let removed = 0;
    for (const item of queue) {
      if (item.state === "done" && item.createdAt.getTime() < olderThan.getTime()) {
        await this.store.remove(item.id);
        removed += 1;
      }
    }
    return removed;
  }

  async counts(): Promise<Record<OutboxState, number>> {
    const queue = await this.store.all();
    const counts: Record<OutboxState, number> = {
      pending: 0,
      inflight: 0,
      done: 0,
      quarantined: 0,
      rejected: 0,
      held: 0,
    };
    for (const item of queue) counts[item.state] += 1;
    return counts;
  }

  /** Everything a human has to deal with. Drives the desk exception list. */
  async needingAttention(): Promise<OutboxItem[]> {
    const queue = await this.ordered();
    return queue.filter((i) => needsAttention(i.state));
  }

  /**
   * The one line the desk shows at all times. §8.4.
   *
   * "Silent queues are how data is lost" — so this is not an optional
   * diagnostic panel. It is a permanent element of the desk chrome.
   */
  async status(): Promise<{
    tone: "clear" | "waiting" | "attention";
    line: string;
    lastSync: string;
    depth: number;
  }> {
    const counts = await this.counts();
    const lastSyncAt = await this.store.getLastSyncAt();
    const now = this.now();

    return {
      ...queueSummary(counts),
      lastSync: lastSyncLine(lastSyncAt, now),
      depth: counts.pending + counts.inflight + counts.held,
    };
  }
}
