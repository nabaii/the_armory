import type {
  AuditRow,
  ReceiptClaim,
  RecordStore,
} from "./record";

/**
 * An in-memory RecordStore, for exercising the envelope without Postgres.
 *
 * The same role src/offline/outbox/memory-store.ts plays for the queue: the
 * logic worth testing — claim, replay, refuse, release, the ordering of audit
 * against receipt — is in record.ts and is independent of where the rows land.
 *
 * ===========================================================================
 * WHAT THIS DELIBERATELY DOES NOT MODEL
 *
 * Blocking. The real claim relies on Postgres suspending a conflicting INSERT
 * until the owning transaction resolves, and that behaviour cannot be faked in
 * a single-threaded fake without inventing a scheduler whose fidelity nobody
 * could check. `claim` here returns false immediately on a conflict, which is
 * the state a caller sees AFTER the block resolves — so the branch under test
 * is the right one, reached by a different route.
 *
 * What that leaves unproven is the interleaving itself, and no unit test was
 * ever going to prove it. It rests on the unique index on `write_receipts`,
 * which is where it should rest.
 *
 * `rollback` is modelled, because the envelope's promise that a refusal keeps
 * its audit rows while a fault keeps nothing is a claim about transactions that
 * a fake CAN check: entries are staged per transaction and only merged on a
 * clean return.
 */

type Receipt = {
  requestId: string;
  operation: string;
  deviceId: string | null;
  actorStaffId: string | null;
  completed: boolean;
  result: unknown;
};

/** The fake's transaction handle. Bodies under test receive this. */
export type MemoryTx = {
  readonly receipts: Map<string, Receipt>;
  readonly audit: AuditRow[];
};

export class MemoryRecordStore implements RecordStore<MemoryTx> {
  private receipts = new Map<string, Receipt>();
  private auditRows: AuditRow[] = [];

  /** Everything committed so far, in write order. */
  get audit(): readonly AuditRow[] {
    return this.auditRows;
  }

  get committedReceipts(): readonly Receipt[] {
    return [...this.receipts.values()];
  }

  async transaction<R>(body: (tx: MemoryTx) => Promise<R>): Promise<R> {
    const tx: MemoryTx = {
      receipts: new Map(this.receipts),
      audit: [],
    };

    let result: R;
    try {
      result = await body(tx);
    } catch (error) {
      /* Rolled back: the staged receipts and audit rows are discarded with the
         transaction handle, exactly as they would be by Postgres. */
      throw error;
    }

    this.receipts = tx.receipts;
    this.auditRows = [...this.auditRows, ...tx.audit];
    return result;
  }

  async claim(tx: MemoryTx, claim: ReceiptClaim): Promise<boolean> {
    if (tx.receipts.has(claim.requestId)) return false;

    tx.receipts.set(claim.requestId, {
      requestId: claim.requestId,
      operation: claim.operation,
      deviceId: claim.deviceId,
      actorStaffId: claim.actorStaffId,
      completed: false,
      result: null,
    });
    return true;
  }

  async readReceipt(
    tx: MemoryTx,
    requestId: string,
  ): Promise<{ result: unknown } | null> {
    const receipt = tx.receipts.get(requestId);
    /* An incomplete claim is not a receipt. The envelope distinguishes "already
       done, here is the answer" from "claimed but never finished", and
       collapsing them here would hide the branch that tells them apart. */
    if (!receipt || !receipt.completed) return null;
    return { result: receipt.result };
  }

  async completeReceipt(
    tx: MemoryTx,
    requestId: string,
    result: unknown,
  ): Promise<void> {
    const receipt = tx.receipts.get(requestId);
    if (!receipt) return;
    tx.receipts.set(requestId, { ...receipt, completed: true, result });
  }

  async releaseReceipt(tx: MemoryTx, requestId: string): Promise<void> {
    tx.receipts.delete(requestId);
  }

  async appendAudit(tx: MemoryTx, rows: readonly AuditRow[]): Promise<void> {
    tx.audit.push(...rows);
  }
}
