import { eq } from "drizzle-orm";
import { getArmoryDb, schema, type ArmoryTx } from "@/db/armory/client";
import type { AuditRow, ReceiptClaim, RecordStore } from "./record";

/**
 * The RecordStore against Postgres.
 *
 * Every guarantee in record.ts's header is discharged here or nowhere:
 *
 *   · `claim` is INSERT … ON CONFLICT DO NOTHING on the receipt's primary key,
 *     which is what makes a concurrent duplicate BLOCK rather than race. The
 *     in-memory store cannot reproduce that and does not pretend to.
 *   · `transaction` is a real multi-statement transaction, which is the reason
 *     src/db/armory/client.ts holds a pooled TCP connection instead of the
 *     leagues product's HTTP driver.
 *
 * ===========================================================================
 * WHY THE RESULT IS WRAPPED
 *
 * `write_receipts.result` is jsonb and nullable, and the envelope has to tell
 * three states apart:
 *
 *   claimed, still running      → no result yet
 *   completed, result was null  → there IS an answer and the answer is nothing
 *   never claimed               → no row
 *
 * SQL NULL cannot distinguish the first two, and an operation whose result is
 * legitimately null is not hypothetical — `licences.revoke` returns nothing
 * useful. So a completed receipt stores `{ "value": … }` and an incomplete one
 * stores SQL NULL. The wrapper is invisible to callers and it means the
 * difference between "replay this answer" and "this is still in flight" is a
 * property of the column rather than of a convention someone has to remember.
 */
export class PostgresRecordStore implements RecordStore<ArmoryTx> {
  async transaction<R>(body: (tx: ArmoryTx) => Promise<R>): Promise<R> {
    return getArmoryDb().transaction(body);
  }

  async claim(tx: ArmoryTx, claim: ReceiptClaim): Promise<boolean> {
    const inserted = await tx
      .insert(schema.writeReceipts)
      .values({
        requestId: claim.requestId,
        operation: claim.operation,
        result: null,
        deviceId: claim.deviceId,
        actorStaffId: claim.actorStaffId,
      })
      .onConflictDoNothing({ target: schema.writeReceipts.requestId })
      .returning({ requestId: schema.writeReceipts.requestId });

    return inserted.length > 0;
  }

  async readReceipt(
    tx: ArmoryTx,
    requestId: string,
  ): Promise<{ result: unknown } | null> {
    const [row] = await tx
      .select({ result: schema.writeReceipts.result })
      .from(schema.writeReceipts)
      .where(eq(schema.writeReceipts.requestId, requestId))
      .limit(1);

    if (!row || row.result === null) return null;
    return { result: (row.result as { value: unknown }).value };
  }

  async completeReceipt(
    tx: ArmoryTx,
    requestId: string,
    result: unknown,
  ): Promise<void> {
    await tx
      .update(schema.writeReceipts)
      .set({ result: { value: result ?? null } })
      .where(eq(schema.writeReceipts.requestId, requestId));
  }

  async releaseReceipt(tx: ArmoryTx, requestId: string): Promise<void> {
    await tx
      .delete(schema.writeReceipts)
      .where(eq(schema.writeReceipts.requestId, requestId));
  }

  async appendAudit(tx: ArmoryTx, rows: readonly AuditRow[]): Promise<void> {
    if (rows.length === 0) return;

    await tx.insert(schema.auditLog).values(
      rows.map((row) => ({
        id: row.id,
        actorStaffId: row.actorStaffId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        before: row.before ?? null,
        after: row.after ?? null,
        deviceId: row.deviceId,
        isOverride: row.isOverride,
        overrideReason: row.overrideReason,
        occurredAt: row.occurredAt,
        /* recordedAt is left to the column default. §2: "Client-generated
           timestamps are recorded alongside server receipt time, never instead
           of it." */
      })),
    );
  }
}
