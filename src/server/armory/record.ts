import { uuidv7 } from "@/lib/uuidv7";

/**
 * THE SERVER-AUTHORITATIVE WRITE — §7's two mandatory properties, once.
 *
 *   §7: "IDEMPOTENT. Every write accepts a client-generated UUIDv7 as the record
 *        identity and is safe to replay. A queued write delivered twice must
 *        produce one row, not two. This is the single most important API
 *        requirement in the system.
 *
 *        ATTRIBUTED. Every write records actor, device and both client and
 *        server timestamps."
 *
 * ===========================================================================
 * WHY THIS EXISTS WHEN src/sync/push.ts ALREADY DELIVERS BOTH
 *
 * Because §8.2 splits writes into two classes and they cannot share a mechanism.
 *
 *   APPEND-ONLY (custody_events, waiver_signatures, rounds, participations …)
 *     "Client generates a UUIDv7 and writes locally. The push is an idempotent
 *      upsert on that id."
 *     One statement. The primary key IS the idempotency key, so a replay
 *     conflicts with the row it created and changes nothing. That is
 *     src/server/sync/writer.ts and it needs no transaction at all.
 *
 *   SERVER AUTHORITATIVE (memberships, applications, tiers, firearms.status,
 *   bookings, host_allowances)
 *     "Server holds truth. Local edits are re-applied on reconnection and may
 *      be rejected."
 *     These are not inserts. Admitting a membership reads a status, guards the
 *     transition (§5), writes the new status, and cascades to every attached
 *     Partner membership. There is no single row whose primary key can carry the
 *     idempotency, because the operation is not a row — it is a change.
 *
 * So this class gets the other half of the mechanism M0 built for it:
 * `write_receipts`, whose header comment states the requirement exactly —
 * "replaying that must reproduce the original RESULT, not perform it again."
 *
 * ===========================================================================
 * THE ORDER OF OPERATIONS, AND WHY THE RECEIPT IS CLAIMED FIRST
 *
 * The obvious shape is: do the work, then write a receipt. It is wrong under
 * concurrency, and the case is not exotic — it is a tablet that pushed, lost
 * the uplink before the response arrived, and pushed again on the next drain
 * while the first request is still in flight. Two transactions, one request id,
 * both reading a `pending` membership and both admitting it.
 *
 * Claiming first removes the race using the machinery already in the table:
 *
 *   1. INSERT the receipt with a null result, ON CONFLICT DO NOTHING.
 *   2. If a row came back, this transaction owns the request. Run the body.
 *   3. If nothing came back, someone else owns it. Read their result and
 *      return it as `duplicate`.
 *
 * Step 3 is correct rather than merely convenient, because of what Postgres does
 * at step 1 when the conflict is with an UNCOMMITTED row: it blocks on the
 * unique index until the other transaction commits or aborts. So a concurrent
 * duplicate does not read a half-finished world — it waits, and then reads
 * either a completed receipt (return the result) or no receipt at all (the
 * other attempt failed; claim it and proceed). The serialisation is free and it
 * comes from the primary key, which is the kind of guarantee that survives a
 * refactor.
 *
 * ===========================================================================
 * A REFUSAL IS NOT A RECEIPT
 *
 * When the body refuses — the guard in §5 says a suspended membership is not
 * reinstated by payment — the receipt is released rather than completed, so a
 * later delivery of the same request id re-evaluates from scratch.
 *
 * This is deliberate and it is the opposite of what caching a response would do.
 * A refusal is a statement about the world at one instant, and the world moves:
 * the licence that was `pending_review` when the desk first pushed may be
 * verified by the time the tablet reconnects. Freezing the first "no" into the
 * receipt table would make the retry return a refusal that is no longer true,
 * and the officer would be told to fix something that is already fixed.
 *
 * Nothing is lost by re-running, because a refusal writes no rows. It writes an
 * audit entry — see below — and that entry is the thing worth having twice.
 *
 * ===========================================================================
 * WHY A REFUSAL STILL COMMITS
 *
 * §3.6, on audit_log: "Every custody event, score, waiver, admission, guest
 * authorisation, BLOCK and override." Blocks, not only the actions that
 * succeeded. src/db/armory/schema.ts spells out the reason: §4.3 says a member
 * must never first learn of a problem at the desk in front of their guest, and
 * the only way to know whether that is happening is to have a record of every
 * block the desk ever showed.
 *
 * A refusal therefore returns from the body as a VALUE rather than as a thrown
 * error, the audit rows are written, and the transaction COMMITS. Throwing would
 * roll back the evidence that the block happened, which is the one part of a
 * refusal worth keeping. Only a genuine fault — the connection dying mid-write —
 * throws, and that rolls back everything including the claim, which is what lets
 * the next delivery retry it.
 */

/* ============================================================================
   ATTRIBUTION — §7's second mandatory property.
   ========================================================================= */

/**
 * Who did this, and on what.
 *
 * §10: "Every staff action attributable to a named person. Device-bound sessions
 * with a short local unlock. Shared accounts destroy the attribution the custody
 * log exists to provide."
 *
 * `staffUserId` is nullable and that nullability is a known debt rather than a
 * design: M1 has no officer sign-in, so a desk-originated write names a tablet
 * and not a human (see docs/M1_offline_acceptance.md). The sweeps in
 * licences.ts are the one case where null is permanently correct — no officer
 * originates the passage of time, and inventing one would be a lie in the
 * column §10 exists to make honest.
 */
export type Attribution = {
  readonly staffUserId: string | null;
  readonly deviceId: string | null;
};

/* ============================================================================
   THE REQUEST
   ========================================================================= */

export type RecordRequest = {
  /**
   * The client-generated UUIDv7 (§7). Generated on the device before the write
   * is queued, so it survives the power cut §8.5 tests and identifies the same
   * intent across every redelivery.
   */
  readonly requestId: string;
  /** Stable operation name, stored on the receipt. Never a display string. */
  readonly operation: string;
  readonly actor: Attribution;
  /**
   * What the originating device's clock believed. §2: "Client-generated
   * timestamps are recorded alongside server receipt time, never instead of
   * it" — the server's clock is applied by the column default, not here.
   */
  readonly occurredAt: Date;
};

/* ============================================================================
   AUDIT — §3.6
   ========================================================================= */

/**
 * An audit row before the envelope stamps the parts it owns.
 *
 * The body supplies what only it knows — which entity, what it looked like
 * before and after. Actor, device and both clocks come from the request, so no
 * caller can forget them and none can disagree with the receipt they are
 * committed alongside.
 */
export type AuditDraft = {
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  /** §3.6: "An override is permitted but never silent." */
  readonly override?: { readonly reason: string };
};

/** An audit row as it reaches the table. */
export type AuditRow = {
  readonly id: string;
  readonly actorStaffId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly deviceId: string | null;
  readonly isOverride: boolean;
  readonly overrideReason: string | null;
  readonly occurredAt: Date;
};

/* ============================================================================
   THE BODY'S RESULT
   ========================================================================= */

export type Refusal = {
  /** Stable machine code. §4.1: "a stable machine code plus a human string." */
  readonly code: string;
  /**
   * The sentence an officer reads. §4.3: "Every block returns a specific
   * single-line reason. Never 'not permitted', never a code, never a stack of
   * conditions."
   */
  readonly message: string;
};

export type Written<T> =
  | {
      readonly outcome: "applied";
      readonly result: T;
      readonly audit: readonly AuditDraft[];
    }
  | {
      readonly outcome: "refused";
      readonly refusal: Refusal;
      readonly audit: readonly AuditDraft[];
    };

/** The work succeeded. Audit rows are written and the receipt is completed. */
export const applied = <T>(
  result: T,
  audit: readonly AuditDraft[] = [],
): Written<T> => ({ outcome: "applied", result, audit });

/**
 * A guard said no.
 *
 * The audit rows are still written and the transaction still commits — see the
 * header. The default records the block itself, because §3.6 wants blocks in the
 * log and a caller that had to remember to pass one would eventually not.
 */
export const refused = <T>(
  refusal: Refusal,
  audit: readonly AuditDraft[] = [],
): Written<T> => ({ outcome: "refused", refusal, audit });

/* ============================================================================
   THE OUTCOME — what the endpoint returns.
   ========================================================================= */

export type Outcome<T> =
  | { readonly status: "applied"; readonly result: T }
  /** Replayed. The result is the FIRST execution's, read back off the receipt. */
  | { readonly status: "duplicate"; readonly result: T }
  | { readonly status: "refused"; readonly refusal: Refusal };

/* ============================================================================
   THE STORE — an interface, so the envelope's logic is testable without Postgres.
   ========================================================================= */

export type ReceiptClaim = {
  readonly requestId: string;
  readonly operation: string;
  readonly deviceId: string | null;
  readonly actorStaffId: string | null;
};

/**
 * Generic in the transaction handle so a body written against Drizzle's
 * `ArmoryTx` type-checks against the real store, while the envelope's own
 * behaviour — claim, replay, refuse, release — is exercised by the in-memory
 * store in record.test.ts.
 *
 * The alternative was a hand-rolled query interface the bodies would have to go
 * through, which would mean reimplementing a query builder badly in order to
 * avoid depending on the one already here.
 */
export interface RecordStore<Tx> {
  transaction<R>(body: (tx: Tx) => Promise<R>): Promise<R>;

  /** INSERT … ON CONFLICT DO NOTHING. False means another request owns it. */
  claim(tx: Tx, claim: ReceiptClaim): Promise<boolean>;
  /** The stored result of a completed receipt, or null if there is none. */
  readReceipt(tx: Tx, requestId: string): Promise<{ result: unknown } | null>;
  completeReceipt(tx: Tx, requestId: string, result: unknown): Promise<void>;
  /** Drop a claim so a refused request can be re-evaluated later. */
  releaseReceipt(tx: Tx, requestId: string): Promise<void>;

  appendAudit(tx: Tx, rows: readonly AuditRow[]): Promise<void>;
}

/* ============================================================================
   record — the envelope
   ========================================================================= */

export async function record<T, Tx>(
  store: RecordStore<Tx>,
  request: RecordRequest,
  body: (tx: Tx) => Promise<Written<T>>,
): Promise<Outcome<T>> {
  return store.transaction(async (tx) => {
    const claimed = await store.claim(tx, {
      requestId: request.requestId,
      operation: request.operation,
      deviceId: request.actor.deviceId,
      actorStaffId: request.actor.staffUserId,
    });

    if (!claimed) {
      /* Another delivery of this request id owns it. Because the conflicting
         INSERT blocked until that transaction resolved, this read sees a settled
         world: either a completed receipt, or none because the other attempt
         failed or refused. */
      const receipt = await store.readReceipt(tx, request.requestId);

      if (receipt) {
        return { status: "duplicate", result: receipt.result as T };
      }

      /* Claimed but never completed. The owner refused (and released), or died
         mid-transaction and rolled back. Either way there is nothing to replay
         and nothing was written, so refusing here — rather than re-running — is
         the honest answer: a retry is safe and will be claimed cleanly. */
      return {
        status: "refused",
        refusal: {
          code: "IN_FLIGHT",
          message:
            "This record is already being written. Nothing was lost; it will " +
            "be sent again on the next sync.",
        },
      };
    }

    const written = await body(tx);

    if (written.audit.length > 0) {
      await store.appendAudit(
        tx,
        written.audit.map((draft) => stamp(draft, request)),
      );
    }

    if (written.outcome === "refused") {
      /* Release, do not complete. See "A refusal is not a receipt" above. The
         audit rows written a moment ago survive the release and the commit —
         they are the record §3.6 asks for that the block happened at all. */
      await store.releaseReceipt(tx, request.requestId);
      return { status: "refused", refusal: written.refusal };
    }

    await store.completeReceipt(tx, request.requestId, written.result);
    return { status: "applied", result: written.result };
  });
}

/**
 * Stamp the parts of an audit row the envelope owns rather than the body.
 *
 * `recordedAt` is deliberately absent: it is the server's receipt time and is
 * applied by the column default, so no code path can substitute a device's
 * clock for it (§2).
 */
function stamp(draft: AuditDraft, request: RecordRequest): AuditRow {
  return {
    id: uuidv7(),
    actorStaffId: request.actor.staffUserId,
    action: draft.action,
    entityType: draft.entityType,
    entityId: draft.entityId,
    before: draft.before ?? null,
    after: draft.after ?? null,
    deviceId: request.actor.deviceId,
    isOverride: draft.override !== undefined,
    overrideReason: draft.override?.reason ?? null,
    occurredAt: request.occurredAt,
  };
}
