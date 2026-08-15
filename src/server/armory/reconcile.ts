import { getArmoryDb } from "@/db/armory/client";
import { kobo } from "@/lib/money";
import { log } from "@/server/log";
import { confirmWithGateway } from "./billing";
import { settlePendingPayment, stalePendingPayments } from "./money";

/**
 * THE RECONCILIATION SWEEP — §9, §11 M10.
 *
 *   §9, Paystack: "Webhook-driven state, never client-reported success.
 *    Idempotent on gateway_reference. RECONCILIATION JOB FOR WEBHOOKS THAT
 *    NEVER ARRIVE. Amounts in kobo throughout."
 *
 * ===========================================================================
 * THIS IS NOT A NICETY. IT IS THE OTHER HALF OF A DECISION ALREADY TAKEN.
 *
 * `/api/armory/paystack/webhook` answers 200 even when its own write fails, and
 * argues the case: a non-2xx makes Paystack retry with backoff and eventually
 * DISABLE the webhook, and losing the endpoint is far worse than losing one
 * event — "every payment is still recoverable through §9's reconciliation job,
 * and a disabled webhook is not recoverable at all."
 *
 * That sentence was a promise about code that did not exist. The security
 * review recorded it as a finding: `stalePendingPayments` was written and
 * nothing called it, which meant the webhook was trading a lost event for a
 * recovery path that was not there.
 *
 * This is the path. Without it, a member debited by their bank has no
 * membership and finds out at the door — the one outcome this whole system is
 * built to prevent.
 *
 * ===========================================================================
 * THE GATEWAY IS THE ONLY AUTHORITY, AND THIS JOB DECIDES NOTHING
 *
 * It does not guess, it does not time out a payment into `failed`, and it does
 * not mark anything succeeded on the strength of its age. For each stale
 * payment it asks Paystack what happened and acts on the answer:
 *
 *   paid       → record it, through exactly the same function the webhook uses,
 *                so the ledger, the settlement and the idempotency are
 *                identical whichever route the payment arrived by.
 *   not paid   → left alone. A member who abandoned a checkout has a pending
 *                row and owes nothing, and turning that into `failed` would be
 *                the club asserting something the gateway did not say.
 *   unreachable→ left alone, and reported. The next run asks again.
 *
 * A job that could invent a payment is worse than no job. A job that could
 * cancel a real one is worse still.
 *
 * ===========================================================================
 * IT IS SAFE TO RUN AT ANY FREQUENCY, INCLUDING TWICE AT ONCE
 *
 * `recordGatewayPayment` is idempotent on `gateway_reference` (§12.1), which is
 * a unique index rather than a check — so two sweeps racing each other, or a
 * sweep racing the webhook it is covering for, produce one payment row. That is
 * the same guarantee the webhook relies on, reached the same way, which is why
 * this job needs no lock and no schedule of its own to be correct.
 */

/** How old a pending payment must be before it is suspicious. */
const DEFAULT_STALE_MINUTES = 15;

export type ReconciliationOutcome = {
  /** Confirmed with the gateway and written. */
  readonly recovered: number;
  /** Confirmed with the gateway as not paid. Left pending. */
  readonly unpaid: number;
  /** The gateway could not be asked. Left for the next run. */
  readonly unreachable: number;
  /** Payments examined. */
  readonly examined: number;
  /** One line, for a founder or a log. */
  readonly line: string;
};

/**
 * Ask the gateway about every payment the club started and never heard back on.
 *
 * `now` and `staleMinutes` are parameters for the reason everything else in this
 * codebase takes a clock: a job whose window cannot be fixed cannot be tested,
 * and the right window differs between a five-minute retry sweep and the daily
 * report a founder reads.
 */
export async function reconcilePayments(input: {
  readonly now: Date;
  readonly staleMinutes?: number;
} = { now: new Date() }): Promise<ReconciliationOutcome> {
  const staleMinutes = input.staleMinutes ?? DEFAULT_STALE_MINUTES;
  const olderThan = new Date(input.now.getTime() - staleMinutes * 60_000);

  const db = getArmoryDb();
  const stale = await stalePendingPayments(db, olderThan);

  let recovered = 0;
  let unpaid = 0;
  let unreachable = 0;

  for (const payment of stale) {
    if (!payment.gatewayReference) {
      /**
       * A pending payment with no gateway reference cannot be asked about.
       *
       * It should not exist — `startPayment` generates the reference before it
       * initialises the transaction — so this is loud rather than skipped
       * quietly. A member may have been debited against a reference the club
       * never stored, and only a human reading the Paystack dashboard can
       * resolve it.
       */
      log.error("PENDING PAYMENT WITH NO GATEWAY REFERENCE", {
        paymentId: payment.id,
        personId: payment.personId,
        amountKobo: payment.amountKobo,
      });
      unreachable += 1;
      continue;
    }

    const verdict = await confirmWithGateway(payment.gatewayReference);

    if (!verdict.ok) {
      /* The gateway could not be asked. Not an error worth alarming on — the
         next run asks again — but counted, because a run that could reach
         nothing is a run that proved nothing. */
      log.warn("payment could not be confirmed with the gateway", {
        reference: payment.gatewayReference,
        reason: verdict.reason,
      });
      unreachable += 1;
      continue;
    }

    if (!verdict.paid) {
      /* An abandoned checkout. The member owes nothing and the row stays
         pending — see the header on why this is not turned into `failed`. */
      unpaid += 1;
      continue;
    }

    /**
     * Paid, and the club never heard. Recover it.
     *
     * `settlePendingPayment` rather than `recordGatewayPayment`, and the
     * distinction is load-bearing: the row already exists — `startPayment`
     * wrote it as `pending` with this very reference — so an insert would
     * conflict with it, do nothing, and report a recovery that credited
     * nobody. See the note on that function.
     *
     * The CHARGE this payment was meant to settle is not recovered. It
     * travelled in the gateway's metadata and `verifyTransaction` does not
     * return metadata, so the money lands on the member's account and the
     * charge stays outstanding.
     *
     * That is a deliberate stopping point rather than an oversight. Guessing
     * which outstanding charge a recovered payment settles would be the club
     * deciding what a member paid for — and the money is on their account
     * either way, visible on §6.2's Account screen and settleable in one tap.
     */
    const written = await db.transaction((tx) =>
      settlePendingPayment(tx, {
        paymentId: payment.id,
        amountKobo: kobo(verdict.amountKobo),
        /* The server's clock. `verifyTransaction` does not return the
           gateway's own paid-at, and §2 would rather record when the club
           learned this than invent a time it did not observe. */
        paidAt: input.now,
      }),
    );

    recovered += 1;

    if (written.kind === "recorded") {
      log.info("payment recovered by reconciliation", {
        reference: payment.gatewayReference,
        personId: payment.personId,
      });
    }
    /* `duplicate` means the webhook arrived while this ran, or an earlier
       sweep got there first. Counted as recovered because the outcome is the
       same and the club is missing nothing. */
  }

  return {
    recovered,
    unpaid,
    unreachable,
    examined: stale.length,
    line: reconciliationLine({
      recovered,
      unpaid,
      unreachable,
      examined: stale.length,
    }),
  };
}

/**
 * The summary line, exported so it can be tested.
 *
 * The rest of this module needs Postgres and a live gateway; this is the part
 * a founder actually reads, and the part where "a clean sweep" and "a sweep
 * that reached nothing" must not look the same.
 */
export function reconciliationLine(counts: {
  recovered: number;
  unpaid: number;
  unreachable: number;
  examined: number;
}): string {
  if (counts.examined === 0) return "Nothing was waiting on the gateway.";

  const parts: string[] = [];
  if (counts.recovered > 0) {
    parts.push(
      `${counts.recovered} ${counts.recovered === 1 ? "payment" : "payments"} recovered`,
    );
  }
  if (counts.unpaid > 0) parts.push(`${counts.unpaid} not paid`);
  if (counts.unreachable > 0) {
    /* Named last and never omitted: a run that could not reach the gateway
       proved nothing, and a summary that hid it would read as a clean sweep. */
    parts.push(`${counts.unreachable} could not be confirmed`);
  }

  return `${counts.examined} examined — ${parts.join(", ")}.`;
}
