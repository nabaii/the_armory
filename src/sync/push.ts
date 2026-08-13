import type { PushRequest } from "./contract";
import { parsePush, type AppendOnlyInsert } from "./operations";

/**
 * POST /sync/push — the write half of the offline spine.
 *
 * §7 puts one requirement above all the others: "A queued write delivered twice
 * must produce one row, not two. This is the single most important API
 * requirement in the system."
 *
 * ===========================================================================
 * WHY THIS IS PURE AND THE SQL IS SOMEWHERE ELSE
 *
 * The same reasoning as src/domain and src/offline/outbox/policy.ts. The rules
 * that decide whether a custody event is stored, refused or retried are the rules
 * that decide whether the club loses a record, and they should be provable by
 * calling a function rather than by standing up Postgres.
 *
 * So the storage is an interface with one method, and §12's replay requirement —
 * "one row results from two identical deliveries" — is a unit test against a fake
 * that behaves like `ON CONFLICT (id) DO NOTHING`. The Postgres implementation is
 * a single statement and is thin enough to read in one sitting; see
 * src/server/sync/writer.ts.
 */

/**
 * Durable storage for one append-only row.
 *
 * Implementations MUST be idempotent on `values.id` (§7) and MUST accomplish it in a
 * single statement. The second half is not about a driver limitation — the armoury
 * client has real transactions — but about what makes this class of write safe at all:
 * if the row and the record of having written it are the same statement, there is no
 * pair that can come apart when the power fails mid-request.
 */
export interface AppendOnlyWriter {
  /** `created: false` means the id was already present — the replay case. */
  insert(row: AppendOnlyInsert): Promise<{ created: boolean }>;
}

export type PushResult =
  /** Stored for the first time. */
  | { kind: "applied"; recordedAt: Date }
  /**
   * Already present. A success, and the outcome §8.5 looks for on its second
   * connection: "every record must reach the server exactly once."
   */
  | { kind: "duplicate"; recordedAt: Date }
  /**
   * The server understood and will not store it. §8.2 requires this to reach an
   * officer; policy.ts will not retry it.
   */
  | { kind: "rejected"; reason: string; remedy: string | null }
  /**
   * Something broke on this side. Retryable — the record is still on the device
   * and the queue will bring it back.
   */
  | { kind: "failed"; reason: string };

/**
 * Store one queued write.
 *
 * `now` is injected for the same reason it is everywhere else in this codebase:
 * the receipt time is part of the record (§2) and a test that cannot fix it
 * cannot assert on it.
 */
export async function handlePush(
  request: PushRequest,
  writer: AppendOnlyWriter,
  now: () => Date = () => new Date(),
): Promise<PushResult> {
  const parsed = parsePush(request);

  if (!parsed.ok) {
    return { kind: "rejected", reason: parsed.reason, remedy: parsed.remedy };
  }

  try {
    const { created } = await writer.insert(parsed.row);
    return {
      kind: created ? "applied" : "duplicate",
      recordedAt: now(),
    };
  } catch (error) {
    /**
     * A database error is NOT a rejection.
     *
     * The distinction is the whole of policy.ts: a rejection is final and
     * surfaces to the officer, while a failure is retried and only quarantined
     * after repeated attempts. Postgres raises for both reasons — a violated
     * append-only trigger is final, a dropped connection is not — and this layer
     * cannot reliably tell them apart from an error string.
     *
     * So it reports the retryable one. The cost of being wrong that way is a
     * record that is retried six times before it is quarantined and shown to a
     * human; the cost of the other way is a custody event discarded because the
     * uplink flickered.
     */
    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
