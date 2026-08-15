import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { ArmoryReader, ArmoryTx } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import {
  accountStanding,
  balanceOf,
  outstandingOf,
  type AccountStanding,
  type Charge,
} from "@/domain/charges";
import type { PaymentPurpose } from "@/domain/enums";
import { format, fromStorage, kobo, type Kobo } from "@/lib/money";
import { uuidv7 } from "@/lib/uuidv7";
import { applied, refused, type Written } from "./record";

/**
 * MONEY — §3.5, §9, §11 M8.
 *
 *   §3.5: "Ledger, not a mutable balance. Balance derived from
 *    account_transactions, never written directly."
 *   §9, Paystack: "WEBHOOK-DRIVEN STATE, NEVER CLIENT-REPORTED SUCCESS.
 *    Idempotent on gateway_reference. Reconciliation job for webhooks that
 *    never arrive. Amounts in kobo throughout."
 *   §12.1: "Duplicate webhook from Paystack → One payment row. Idempotent on
 *    gateway_reference."
 *
 * ===========================================================================
 * THE BALANCE COLUMN IS NEVER WRITTEN FROM HERE
 *
 * `accounts.balance_kobo` exists and nothing in this file assigns to it. It is
 * recomputed by the trigger in drizzle/0002 from `account_transactions`, and a
 * direct UPDATE is rejected by the database — the same treatment
 * `firearms.status` and `ammunition_lots.quantity_remaining` get, for the same
 * §3 reason: a derived value that application code can also write is a value
 * that will eventually disagree with what it was derived from.
 *
 * So the only money write below is an INSERT into the ledger.
 *
 * ===========================================================================
 * IDEMPOTENCY COMES FROM TWO DIFFERENT PLACES AND BOTH ARE LOAD-BEARING
 *
 *   · Everything the CLUB originates — raising a charge, crediting an account —
 *     goes through `record()` (src/server/armory/record.ts) and is idempotent
 *     on a client-generated request id, because those are operations rather
 *     than rows.
 *
 *   · Everything PAYSTACK originates is idempotent on `gateway_reference`,
 *     which carries a unique index (§3.5). That is not a second mechanism by
 *     preference — it is the only one available, because a webhook retry does
 *     not carry our request id and the gateway decides when to send it.
 *
 * `recordGatewayPayment` therefore does not use `record()`. It relies on the
 * unique index, which is exactly what §12.1's test asks for.
 */

/* ============================================================================
   RAISING A CHARGE
   ========================================================================= */

export type RaisedCharge = {
  readonly chargeId: string;
  readonly totalKobo: number;
  readonly payerPersonId: string;
};

/**
 * Write a charge built by src/domain/charges.ts.
 *
 * Takes a `Charge` rather than its parts, so the host-pays rule §3.5 asks to be
 * enforced "in code, not convention" is enforced at the point where the charge
 * is CONSTRUCTED and cannot be re-decided here. There is no `payerPersonId`
 * parameter on this function for a caller to override.
 */
export async function raiseCharge(
  tx: ArmoryTx,
  charge: Charge,
): Promise<Written<RaisedCharge>> {
  const chargeId = uuidv7();

  await tx.insert(schema.charges).values({
    id: chargeId,
    payerPersonId: charge.payerPersonId,
    referenceType: charge.referenceType,
    referenceId: charge.referenceId,
    lineItems: charge.lines,
    totalKobo: charge.totalKobo,
    isSettled: false,
    settledPaymentId: null,
  });

  return applied(
    {
      chargeId,
      totalKobo: charge.totalKobo,
      payerPersonId: charge.payerPersonId,
    },
    [
      {
        action: "charge.raise",
        entityType: "charge",
        entityId: chargeId,
        after: {
          referenceType: charge.referenceType,
          totalKobo: charge.totalKobo,
          lines: charge.lines.length,
        },
      },
    ],
  );
}

/* ============================================================================
   THE ACCOUNT AND ITS LEDGER
   ========================================================================= */

/**
 * The person's account, created on first need.
 *
 * `ON CONFLICT (person_id) DO NOTHING` followed by a read, rather than a read
 * followed by an insert. The second shape has a race that is not theoretical
 * here: a webhook and a desk charge can arrive within milliseconds for a member
 * who has never transacted, and both would find no account and both would
 * insert one. The unique index would refuse the second and the payment would be
 * lost to a retry it did not need.
 */
export async function ensureAccount(
  tx: ArmoryTx,
  personId: string,
): Promise<string> {
  await tx
    .insert(schema.accounts)
    .values({ id: uuidv7(), personId, balanceKobo: 0 })
    .onConflictDoNothing({ target: schema.accounts.personId });

  const [account] = await tx
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.personId, personId))
    .limit(1);

  if (!account) {
    /* Unreachable through the insert above; thrown rather than returned so a
       caller cannot proceed with an empty string as an account id. */
    throw new Error(`No account could be opened for person ${personId}.`);
  }

  return account.id;
}

/**
 * One ledger entry. APPEND-ONLY (§3.5) — drizzle/0002 rejects update and delete.
 *
 * The balance follows by trigger. Nothing here reads the old balance, computes
 * a new one and writes it, which is the shape that produces a lost update under
 * two concurrent payments.
 */
export async function postToLedger(
  tx: ArmoryTx,
  input: {
    readonly accountId: string;
    readonly amountKobo: Kobo;
    readonly direction: "credit" | "debit";
    readonly referenceType: string;
    readonly referenceId: string | null;
  },
): Promise<string> {
  const id = uuidv7();

  await tx.insert(schema.accountTransactions).values({
    id,
    accountId: input.accountId,
    amountKobo: input.amountKobo,
    direction: input.direction,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
  });

  return id;
}

/* ============================================================================
   PAYMENTS — §9, §12.1
   ========================================================================= */

export type PaymentOutcome =
  /** First delivery. The row was written and the ledger moved. */
  | { readonly kind: "recorded"; readonly paymentId: string }
  /** A replay of a webhook already handled. §12.1: one payment row. */
  | { readonly kind: "duplicate"; readonly paymentId: string };

/**
 * Record a gateway payment. THE ONLY PLACE A PAYMENT BECOMES `succeeded`.
 *
 * §9: "Webhook-driven state, never client-reported success." Nothing on a
 * member's device can call this, and there is no code path that marks a payment
 * succeeded on the strength of a browser redirect — a visitor returning to a
 * success URL has proved only that they can type a URL.
 *
 * ===========================================================================
 * THE UNIQUE INDEX IS THE IDEMPOTENCY, AND THE RETURNING CLAUSE IS THE PROOF
 *
 * §12.1: "Duplicate webhook from Paystack → One payment row. Idempotent on
 * gateway_reference."
 *
 * `ON CONFLICT (gateway_reference) DO NOTHING … RETURNING id` gives both halves
 * in one statement: an empty result IS the duplicate signal, so no separate
 * "have I seen this?" read is needed and no window exists between the check and
 * the write. Paystack retries aggressively and two retries can be in flight at
 * once; a check-then-insert would let both pass the check.
 *
 * The ledger entry is inside the same transaction as the payment row. They are
 * one fact — money arrived — and a pair that can come apart is a member whose
 * payment exists and whose balance does not.
 */
export async function recordGatewayPayment(
  tx: ArmoryTx,
  input: {
    readonly personId: string;
    readonly amountKobo: Kobo;
    readonly purpose: PaymentPurpose;
    readonly gateway: string;
    readonly gatewayReference: string;
    readonly method: string | null;
    readonly paidAt: Date;
    /** Settle this charge if the payment covers it. Null for a top-up. */
    readonly chargeId: string | null;
  },
): Promise<PaymentOutcome> {
  const paymentId = uuidv7();

  const inserted = await tx
    .insert(schema.payments)
    .values({
      id: paymentId,
      personId: input.personId,
      amountKobo: input.amountKobo,
      purpose: input.purpose,
      method: input.method,
      gateway: input.gateway,
      gatewayReference: input.gatewayReference,
      status: "succeeded",
      paidAt: input.paidAt,
    })
    .onConflictDoNothing({ target: schema.payments.gatewayReference })
    .returning({ id: schema.payments.id });

  if (inserted.length === 0) {
    /* Already handled. Read back the first delivery's id so the caller can
       answer with the same payment it answered with before — a webhook that
       gets a different id on a retry looks to the gateway like a new record. */
    const [existing] = await tx
      .select({ id: schema.payments.id })
      .from(schema.payments)
      .where(eq(schema.payments.gatewayReference, input.gatewayReference))
      .limit(1);

    return { kind: "duplicate", paymentId: existing?.id ?? paymentId };
  }

  const accountId = await ensureAccount(tx, input.personId);

  /**
   * Money in is a CREDIT to the member. Always, including when it settles a
   * charge in the same breath.
   *
   * The tempting shortcut is to skip the ledger for a payment that settles a
   * charge exactly, on the grounds that it nets to nothing. It does not net to
   * nothing on a statement: §6.2 asks for "charges, payments, balance", and a
   * member who paid ₦15,000 and sees no payment has been given a statement that
   * does not show their money arriving.
   */
  await postToLedger(tx, {
    accountId,
    amountKobo: input.amountKobo,
    direction: "credit",
    referenceType: `payment.${input.purpose}`,
    referenceId: paymentId,
  });

  if (input.chargeId) {
    await settleCharge(tx, {
      chargeId: input.chargeId,
      paymentId,
      accountId,
    });
  }

  return { kind: "recorded", paymentId };
}

/**
 * Complete a payment the club had already started — §9's reconciliation.
 *
 * ===========================================================================
 * WHY THIS EXISTS AND `recordGatewayPayment` COULD NOT BE REUSED
 *
 * The obvious implementation of the reconciliation sweep is to call
 * `recordGatewayPayment` with the reference it just confirmed. It does not
 * work, and the way it fails is silent.
 *
 * A payment the club started already HAS a row — `startPayment` wrote it as
 * `pending` with the gateway reference on it. So the insert above conflicts
 * with that very row, `ON CONFLICT DO NOTHING` does nothing, and the function
 * returns `duplicate`. The sweep reports a recovery, no ledger entry is
 * written, and the member's balance never moves.
 *
 * The two functions are answering different questions. `recordGatewayPayment`
 * handles a payment the club is hearing about for the FIRST time, where the row
 * and the idempotency are the same insert. This one handles a payment the club
 * already knew about and is now learning the outcome of.
 *
 * ===========================================================================
 * THE GUARD IS `status = 'pending'`, AND IT IS THE WHOLE IDEMPOTENCY
 *
 * Same shape as §3.4's ammunition reconciliation, for the same reason: the
 * first delivery does the work, every later one matches no rows. Without it, a
 * sweep racing the webhook — or two sweeps racing each other — would post two
 * credits for one payment, which is the worst available failure in this file.
 */
export async function settlePendingPayment(
  tx: ArmoryTx,
  input: {
    readonly paymentId: string;
    readonly amountKobo: Kobo;
    readonly paidAt: Date;
  },
): Promise<PaymentOutcome> {
  const updated = await tx
    .update(schema.payments)
    .set({
      status: "succeeded",
      paidAt: input.paidAt,
      /* The gateway is the authority on the amount. A member charged a
         different figure from the one the club expected is a discrepancy worth
         recording as what actually happened, not as what was intended. */
      amountKobo: input.amountKobo,
      updatedAt: input.paidAt,
    })
    .where(
      and(
        eq(schema.payments.id, input.paymentId),
        eq(schema.payments.status, "pending"),
      ),
    )
    .returning({
      id: schema.payments.id,
      personId: schema.payments.personId,
      purpose: schema.payments.purpose,
    });

  const [payment] = updated;

  if (!payment) {
    /* Already settled by the webhook or an earlier sweep. A success — the
       outcome the caller wanted is the state the row is in. */
    return { kind: "duplicate", paymentId: input.paymentId };
  }

  const accountId = await ensureAccount(tx, payment.personId);

  await postToLedger(tx, {
    accountId,
    amountKobo: input.amountKobo,
    direction: "credit",
    referenceType: `payment.${payment.purpose}`,
    referenceId: payment.id,
  });

  return { kind: "recorded", paymentId: payment.id };
}

/**
 * Mark a charge settled and debit the account for it.
 *
 * ===========================================================================
 * WHY SETTLEMENT IS A DEBIT AND NOT AN ABSENCE
 *
 * A charge could have been settled by simply flipping `is_settled` and leaving
 * the ledger alone. That produces a correct balance only if the credit was
 * never posted, and §6.2 requires the payment to be visible — so both halves
 * exist: the money came in (credit), the club took it for this charge (debit).
 *
 * The pair is what makes an account statement legible. A member scanning it
 * sees a payment and what it went on, in that order, which is how they will
 * describe it if they ring up about it.
 *
 * `WHERE is_settled = false` makes this safe to call twice: a redelivered
 * webhook that reaches settlement a second time matches no rows and posts no
 * second debit. Without that predicate a retry would debit the member twice for
 * one charge, which is the worst available failure in this file.
 */
export async function settleCharge(
  tx: ArmoryTx,
  input: {
    readonly chargeId: string;
    readonly paymentId: string;
    readonly accountId: string;
  },
): Promise<{ readonly settled: boolean }> {
  const updated = await tx
    .update(schema.charges)
    .set({ isSettled: true, settledPaymentId: input.paymentId })
    .where(
      and(
        eq(schema.charges.id, input.chargeId),
        eq(schema.charges.isSettled, false),
      ),
    )
    .returning({
      id: schema.charges.id,
      totalKobo: schema.charges.totalKobo,
      referenceType: schema.charges.referenceType,
    });

  const [charge] = updated;
  if (!charge) return { settled: false };

  await postToLedger(tx, {
    accountId: input.accountId,
    amountKobo: kobo(charge.totalKobo),
    direction: "debit",
    referenceType: `charge.${charge.referenceType}`,
    referenceId: charge.id,
  });

  return { settled: true };
}

/**
 * Settle a charge from money already on account, with no gateway involved.
 *
 * The desk path, and the one a member uses when their balance covers a bill.
 * Refuses rather than overdrawing: §12 wants an officer to hear a sentence, and
 * a balance driven negative by a system decision is a debt the member never
 * agreed to. A founder who wants to extend credit does it with an adjustment,
 * which is a deliberate act with their name on it.
 */
export async function settleFromBalance(
  tx: ArmoryTx,
  input: { readonly chargeId: string },
): Promise<Written<{ readonly chargeId: string }>> {
  const [charge] = await tx
    .select({
      id: schema.charges.id,
      payerPersonId: schema.charges.payerPersonId,
      totalKobo: schema.charges.totalKobo,
      isSettled: schema.charges.isSettled,
    })
    .from(schema.charges)
    .where(eq(schema.charges.id, input.chargeId))
    .limit(1);

  if (!charge) {
    return refused({
      code: "CHARGE_NOT_FOUND",
      message: "That charge is not on the club's books.",
    });
  }

  if (charge.isSettled) {
    return refused({
      code: "CHARGE_ALREADY_SETTLED",
      message: "That charge has already been settled.",
    });
  }

  const accountId = await ensureAccount(tx, charge.payerPersonId);
  const balance = await balanceFor(tx, accountId);

  if (balance < charge.totalKobo) {
    return refused({
      code: "INSUFFICIENT_BALANCE",
      message: `There is ${format(balance)} on account and the charge is ${format(
        kobo(charge.totalKobo),
      )}.`,
    });
  }

  await tx
    .update(schema.charges)
    .set({ isSettled: true })
    .where(
      and(
        eq(schema.charges.id, charge.id),
        eq(schema.charges.isSettled, false),
      ),
    );

  await postToLedger(tx, {
    accountId,
    amountKobo: kobo(charge.totalKobo),
    direction: "debit",
    referenceType: "charge.settled_from_balance",
    referenceId: charge.id,
  });

  return applied({ chargeId: charge.id }, [
    {
      action: "charge.settle",
      entityType: "charge",
      entityId: charge.id,
      after: { from: "balance", totalKobo: charge.totalKobo },
    },
  ]);
}

/* ============================================================================
   READING — §6.2's Account screen
   ========================================================================= */

export type AccountStatementLine = {
  readonly id: string;
  readonly description: string;
  readonly amountKobo: number;
  readonly direction: "credit" | "debit";
  readonly at: Date;
};

export type AccountView = {
  readonly standing: AccountStanding;
  readonly charges: readonly {
    readonly id: string;
    readonly description: string;
    readonly totalKobo: number;
    readonly isSettled: boolean;
    readonly raisedAt: Date;
  }[];
  readonly payments: readonly {
    readonly id: string;
    readonly amountKobo: number;
    readonly purpose: PaymentPurpose;
    readonly paidAt: Date | null;
    readonly status: string;
  }[];
  readonly ledger: readonly AccountStatementLine[];
};

/**
 * Everything §6.2's Account screen states: "charges, payments, balance".
 *
 * The balance is computed from the ledger here rather than read off
 * `accounts.balance_kobo`, even though the column is maintained by trigger and
 * is correct. The column is a cache for queries that need to filter or sort on
 * it; this screen has the entries in hand, and deriving from them means the
 * number a member reads and the lines above it cannot disagree — which is the
 * one way this screen can lose a member's trust in an afternoon.
 */
export async function accountFor(
  tx: ArmoryReader,
  personId: string,
): Promise<AccountView> {
  const [account] = await tx
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.personId, personId))
    .limit(1);

  const charges = await tx
    .select({
      id: schema.charges.id,
      lineItems: schema.charges.lineItems,
      totalKobo: schema.charges.totalKobo,
      isSettled: schema.charges.isSettled,
      createdAt: schema.charges.createdAt,
    })
    .from(schema.charges)
    .where(eq(schema.charges.payerPersonId, personId))
    .orderBy(desc(schema.charges.createdAt));

  const payments = await tx
    .select({
      id: schema.payments.id,
      amountKobo: schema.payments.amountKobo,
      purpose: schema.payments.purpose,
      paidAt: schema.payments.paidAt,
      status: schema.payments.status,
    })
    .from(schema.payments)
    .where(eq(schema.payments.personId, personId))
    .orderBy(desc(schema.payments.createdAt));

  const entries = account
    ? await tx
        .select({
          id: schema.accountTransactions.id,
          amountKobo: schema.accountTransactions.amountKobo,
          direction: schema.accountTransactions.direction,
          referenceType: schema.accountTransactions.referenceType,
          createdAt: schema.accountTransactions.createdAt,
        })
        .from(schema.accountTransactions)
        .where(eq(schema.accountTransactions.accountId, account.id))
        .orderBy(desc(schema.accountTransactions.createdAt))
    : [];

  const balanceKobo = balanceOf(
    entries.map((entry) => ({
      amountKobo: fromStorage(entry.amountKobo),
      direction: entry.direction,
      referenceType: entry.referenceType,
      createdAt: entry.createdAt,
    })),
  );

  const outstandingKobo = outstandingOf(
    charges.map((charge) => ({
      totalKobo: fromStorage(charge.totalKobo),
      isSettled: charge.isSettled,
    })),
  );

  return {
    standing: accountStanding({
      balanceKobo,
      outstandingKobo,
      format: (amount) => format(amount),
    }),
    charges: charges.map((charge) => ({
      id: charge.id,
      description: describeLines(charge.lineItems),
      totalKobo: charge.totalKobo,
      isSettled: charge.isSettled,
      raisedAt: charge.createdAt,
    })),
    payments,
    ledger: entries.map((entry) => ({
      id: entry.id,
      description: entry.referenceType,
      amountKobo: entry.amountKobo,
      direction: entry.direction,
      at: entry.createdAt,
    })),
  };
}

async function balanceFor(tx: ArmoryReader, accountId: string): Promise<Kobo> {
  const entries = await tx
    .select({
      amountKobo: schema.accountTransactions.amountKobo,
      direction: schema.accountTransactions.direction,
      referenceType: schema.accountTransactions.referenceType,
      createdAt: schema.accountTransactions.createdAt,
    })
    .from(schema.accountTransactions)
    .where(eq(schema.accountTransactions.accountId, accountId));

  return balanceOf(
    entries.map((entry) => ({
      amountKobo: fromStorage(entry.amountKobo),
      direction: entry.direction,
      referenceType: entry.referenceType,
      createdAt: entry.createdAt,
    })),
  );
}

/**
 * A charge's lines, as one line of description.
 *
 * The column is JSONB and the rows in it were written by this codebase, but
 * they arrive back as `unknown` and a screen must not crash on a shape from an
 * older release. Anything unreadable becomes "Charge" rather than an exception
 * on a member's account page.
 */
function describeLines(lineItems: unknown): string {
  if (!Array.isArray(lineItems)) return "Charge";

  const descriptions = lineItems
    .map((item) =>
      typeof item === "object" &&
      item !== null &&
      "description" in item &&
      typeof (item as { description: unknown }).description === "string"
        ? (item as { description: string }).description
        : null,
    )
    .filter((value): value is string => value !== null);

  return descriptions.length > 0 ? descriptions.join(", ") : "Charge";
}

/* ============================================================================
   §9's RECONCILIATION JOB — "for webhooks that never arrive"
   ========================================================================= */

export type StalePayment = {
  readonly id: string;
  readonly personId: string;
  readonly gatewayReference: string | null;
  readonly amountKobo: number;
  /**
   * What the club started the transaction FOR.
   *
   * Carried so a recovered payment is recorded under the purpose the club
   * itself chose, rather than reconstructed from the gateway. §6.6 groups
   * revenue on this column, and a recovered payment filed as "other" is a hole
   * in that panel that nobody would trace back to here.
   */
  readonly purpose: PaymentPurpose;
  readonly createdAt: Date;
};

/**
 * Payments the club started and never heard the end of.
 *
 * §9 asks for this by name, and it is not a nicety. A webhook that never
 * arrives leaves a member who has been debited by their bank and has no
 * membership — and they will not find out from the club, they will find out at
 * the door. Everything else in this system is built so that never happens.
 *
 * ===========================================================================
 * IT REPORTS. IT DOES NOT DECIDE.
 *
 * This function does not mark anything succeeded or failed. It returns the
 * pending payments old enough to be suspicious, and the caller verifies each
 * one against the gateway before doing anything — because the only authority on
 * whether money moved is the gateway, and a job that guessed would be inventing
 * payments or cancelling real ones.
 *
 * `olderThan` is a parameter rather than a constant so the caller decides, and
 * so a test can fix it. A few minutes is right for a retry sweep; a day is
 * right for the report a founder reads.
 */
export async function stalePendingPayments(
  tx: ArmoryReader,
  olderThan: Date,
): Promise<StalePayment[]> {
  return tx
    .select({
      id: schema.payments.id,
      personId: schema.payments.personId,
      gatewayReference: schema.payments.gatewayReference,
      amountKobo: schema.payments.amountKobo,
      purpose: schema.payments.purpose,
      createdAt: schema.payments.createdAt,
    })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.status, "pending"),
        lt(schema.payments.createdAt, olderThan),
        isNull(schema.payments.paidAt),
      ),
    )
    .orderBy(schema.payments.createdAt);
}

/**
 * Revenue by source, for §6.6's dashboard.
 *
 * Grouped on `purpose` rather than on the charge's reference type, because a
 * payment is what actually arrived and a charge is what was asked for. A
 * founder reading "revenue" means money in the bank.
 */
export async function revenueByPurpose(
  tx: ArmoryReader,
  since: Date,
): Promise<{ purpose: PaymentPurpose; totalKobo: number; count: number }[]> {
  return tx
    .select({
      purpose: schema.payments.purpose,
      totalKobo: sql<number>`COALESCE(SUM(${schema.payments.amountKobo}), 0)::int`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.status, "succeeded"),
        sql`${schema.payments.paidAt} >= ${since}`,
      ),
    )
    .groupBy(schema.payments.purpose);
}
