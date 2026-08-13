import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { ArmoryTx } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import { lagosParts, toDateColumn } from "@/lib/time";
import { uuidv7 } from "@/lib/uuidv7";
import type { AuditDraft } from "./record";

/**
 * THE GUEST ALLOWANCE — §8.3's NAMED DEFECT.
 *
 *   §8.3: "TWO DEVICES, ONE ALLOWANCE.
 *
 *          A member books a guest in the portal while the desk, offline,
 *          authorises a different guest against the same allowance. Both succeed
 *          locally. Both push.
 *
 *          Resolution: host_allowances.used_count is mutated ONLY server-side,
 *          inside a transaction, with the invitation write. Offline guest
 *          authorisation at the desk is an explicit officer override, recorded
 *          as an exception, and reconciled on sync.
 *
 *          If the reconciliation finds the allowance exceeded, THE VISIT STANDS
 *          — the guest is already on the premises — and the overage is charged
 *          to the host. The system never resolves a data conflict by
 *          embarrassing a member."
 *
 * This file is that paragraph. It is the reason src/db/armory/client.ts holds a
 * real pooled TCP connection instead of the leagues product's HTTP driver, and
 * §3.2 is why it gets this much care: "This cluster is the acquisition funnel.
 * Treat its correctness as equal in importance to the firearm register."
 *
 * ===========================================================================
 * THE THING THAT MAKES THIS SAFE IS ONE STATEMENT, NOT A TRANSACTION
 *
 * Worth being precise about, because "inside a transaction" is easy to satisfy
 * and easy to satisfy uselessly.
 *
 * The wrong shape, which a transaction does NOT save you from:
 *
 *     SELECT used_count FROM host_allowances WHERE …     -- reads 5
 *     UPDATE host_allowances SET used_count = 6 WHERE …  -- writes 5 + 1
 *
 * Under READ COMMITTED — Postgres's default, and what this connection uses —
 * two concurrent transactions both read 5 and both write 6. The counter
 * advances once for two guests. A transaction makes the pair atomic; it does not
 * make them serialisable, and §8.3's defect survives it untouched.
 *
 * The right shape, which is what `consume` does:
 *
 *     UPDATE host_allowances SET used_count = used_count + 1 WHERE … RETURNING *
 *
 * The read and the write are one statement, so Postgres takes a row lock and the
 * second transaction blocks until the first commits — then re-reads and
 * increments from 6. The transaction is still needed, but for a different
 * reason: to bind this statement to the invitation write, so an invitation
 * cannot exist without its allowance having moved.
 *
 * ===========================================================================
 * WHY EXCEEDING THE QUOTA IS NOT AN ERROR HERE
 *
 * `consume` never refuses. It increments, and reports whether the increment
 * landed inside the quota or beyond it.
 *
 * That reads permissive and is the specification's explicit instruction. §8.3:
 * "the visit stands — the guest is already on the premises — and the overage is
 * charged to the host. The system never resolves a data conflict by embarrassing
 * a member." §12 puts the same rule the other way round: "Allowance exhausted
 * mid-booking → Overage offered in the portal WITH THE PRICE SHOWN. Never
 * discovered at the desk."
 *
 * So refusal is not this layer's job. It belongs to MAY_HOST in the portal,
 * BEFORE the guest is invited, where the member can see the price and accept it.
 * By the time anything reaches this file the decision has been taken — and a
 * counter that threw at the desk would be the club telling a member, in front of
 * their guest, that they had miscounted.
 */

/* ============================================================================
   THE PERIOD — §3.2: "One row per membership per period."
   ========================================================================= */

/**
 * The allowance year runs from the membership's anniversary.
 *
 * Not the calendar year. A member who joins in November and is given twelve
 * guest visits would otherwise get twelve in November and twelve again eight
 * weeks later — which the club would notice in January, having already hosted
 * them.
 *
 * Derived from `startedOn` rather than stored, so it cannot drift from the
 * membership it belongs to.
 */
export function allowancePeriod(
  startedOn: Date,
  now: Date,
): { periodStart: Date; periodEnd: Date } {
  const start = lagosParts(startedOn);
  const today = lagosParts(now);

  /* Which anniversary are we in? The one this year, unless it has not happened
     yet, in which case last year's. */
  let year = today.year;
  const anniversaryPassed =
    today.month > start.month ||
    (today.month === start.month && today.day >= start.day);
  if (!anniversaryPassed) year -= 1;

  const periodStart = new Date(Date.UTC(year, start.month, start.day));
  const periodEnd = new Date(Date.UTC(year + 1, start.month, start.day));
  /* End is the day BEFORE the next anniversary — the period is inclusive of
     both bounds, matching the DATE columns and §12.1's "an allowance period
     ending today", which must still be usable on that day. */
  periodEnd.setUTCDate(periodEnd.getUTCDate() - 1);

  return { periodStart, periodEnd };
}

export type AllowanceState = {
  readonly id: string;
  readonly includedQuota: number;
  readonly usedCount: number;
  readonly overageCount: number;
  readonly periodStart: string;
  readonly periodEnd: string;
};

/**
 * The current period's row, created if this is the first guest of the year.
 *
 * The quota comes from the tier (§3.1 `guest_allowance_annual`) and is COPIED
 * onto the row rather than joined at read time. §3.3 gives the same treatment to
 * `participations.tier_snapshot` and for the same reason: a tier's allowance
 * changes, and a member who was promised six visits must not silently get four
 * because the club repriced in March.
 */
export async function ensureAllowancePeriod(
  tx: ArmoryTx,
  input: {
    readonly membershipId: string;
    readonly startedOn: Date;
    readonly guestAllowanceAnnual: number;
    readonly now: Date;
  },
): Promise<AllowanceState> {
  const { periodStart, periodEnd } = allowancePeriod(input.startedOn, input.now);
  const startKey = toDateColumn(periodStart);
  const endKey = toDateColumn(periodEnd);

  const [existing] = await tx
    .select({
      id: schema.hostAllowances.id,
      includedQuota: schema.hostAllowances.includedQuota,
      usedCount: schema.hostAllowances.usedCount,
      overageCount: schema.hostAllowances.overageCount,
      periodStart: schema.hostAllowances.periodStart,
      periodEnd: schema.hostAllowances.periodEnd,
    })
    .from(schema.hostAllowances)
    .where(
      and(
        eq(schema.hostAllowances.membershipId, input.membershipId),
        lte(schema.hostAllowances.periodStart, toDateColumn(input.now)),
        gte(schema.hostAllowances.periodEnd, toDateColumn(input.now)),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const id = uuidv7();

  /* ON CONFLICT on the (membership, period_start) unique index rather than a
     check-then-insert: two guests invited in the same second at the start of a
     membership year would otherwise both find no row and both create one. */
  await tx
    .insert(schema.hostAllowances)
    .values({
      id,
      membershipId: input.membershipId,
      periodStart: startKey,
      periodEnd: endKey,
      includedQuota: input.guestAllowanceAnnual,
      usedCount: 0,
      overageCount: 0,
    })
    .onConflictDoNothing({
      target: [
        schema.hostAllowances.membershipId,
        schema.hostAllowances.periodStart,
      ],
    });

  const [row] = await tx
    .select({
      id: schema.hostAllowances.id,
      includedQuota: schema.hostAllowances.includedQuota,
      usedCount: schema.hostAllowances.usedCount,
      overageCount: schema.hostAllowances.overageCount,
      periodStart: schema.hostAllowances.periodStart,
      periodEnd: schema.hostAllowances.periodEnd,
    })
    .from(schema.hostAllowances)
    .where(
      and(
        eq(schema.hostAllowances.membershipId, input.membershipId),
        eq(schema.hostAllowances.periodStart, startKey),
      ),
    )
    .limit(1);

  return row;
}

/* ============================================================================
   CONSUME AND RELEASE
   ========================================================================= */

export type ConsumeResult = {
  readonly allowanceId: string;
  readonly usedCount: number;
  readonly includedQuota: number;
  /** True when this visit came out of the included quota. */
  readonly withinQuota: boolean;
  /**
   * How many visits this period are now beyond the quota. §12: the host is
   * charged for these, and §1.2 rule 5 is emphatic that it is the HOST — "money
   * from a guest visit lands on the host. A guest never transacts with the club."
   */
  readonly overageCount: number;
};

/**
 * Take one guest visit from the allowance.
 *
 * MUST be called inside the same transaction as the invitation write — the
 * signature takes an `ArmoryTx` rather than a connection precisely so that is a
 * compile-time fact rather than a convention. src/db/armory/client.ts calls this
 * out: "`consumeAllowance(tx, …)` cannot be called with a plain connection,
 * which is the compile-time half of §8.3's rule."
 */
export async function consumeAllowance(
  tx: ArmoryTx,
  allowanceId: string,
): Promise<ConsumeResult> {
  /* One statement. See the header — this is the whole defence, and splitting it
     into a read and a write would reintroduce §8.3's defect in a form that still
     looks like it is "inside a transaction". */
  const [row] = await tx
    .update(schema.hostAllowances)
    .set({
      usedCount: sql`${schema.hostAllowances.usedCount} + 1`,
      overageCount: sql`
        case
          when ${schema.hostAllowances.usedCount} + 1 > ${schema.hostAllowances.includedQuota}
          then ${schema.hostAllowances.overageCount} + 1
          else ${schema.hostAllowances.overageCount}
        end
      `,
      updatedAt: new Date(),
    })
    .where(eq(schema.hostAllowances.id, allowanceId))
    .returning({
      id: schema.hostAllowances.id,
      usedCount: schema.hostAllowances.usedCount,
      includedQuota: schema.hostAllowances.includedQuota,
      overageCount: schema.hostAllowances.overageCount,
    });

  return {
    allowanceId: row.id,
    usedCount: row.usedCount,
    includedQuota: row.includedQuota,
    withinQuota: row.usedCount <= row.includedQuota,
    overageCount: row.overageCount,
  };
}

/**
 * Give a guest visit back. §5: cancellation "returns allowance".
 *
 * Symmetrical with `consume`, including the overage arithmetic: cancelling the
 * visit that pushed a host over their quota should take the overage back off,
 * not leave them billed for a guest who never came.
 *
 * Floored at zero. A release without a matching consume should be impossible —
 * the transitions in state-machines.ts only emit `release_allowance` from states
 * that held one — but a counter that can go negative would report a member as
 * having visits they never earned, and the floor costs one `greatest()`.
 */
export async function releaseAllowance(
  tx: ArmoryTx,
  allowanceId: string,
): Promise<ConsumeResult> {
  const [row] = await tx
    .update(schema.hostAllowances)
    .set({
      usedCount: sql`greatest(0, ${schema.hostAllowances.usedCount} - 1)`,
      overageCount: sql`
        case
          when ${schema.hostAllowances.usedCount} > ${schema.hostAllowances.includedQuota}
          then greatest(0, ${schema.hostAllowances.overageCount} - 1)
          else ${schema.hostAllowances.overageCount}
        end
      `,
      updatedAt: new Date(),
    })
    .where(eq(schema.hostAllowances.id, allowanceId))
    .returning({
      id: schema.hostAllowances.id,
      usedCount: schema.hostAllowances.usedCount,
      includedQuota: schema.hostAllowances.includedQuota,
      overageCount: schema.hostAllowances.overageCount,
    });

  return {
    allowanceId: row.id,
    usedCount: row.usedCount,
    includedQuota: row.includedQuota,
    withinQuota: row.usedCount <= row.includedQuota,
    overageCount: row.overageCount,
  };
}

/**
 * The audit row for a visit that went past the quota.
 *
 * §8.3 calls this "recorded as an exception", and §6.6 puts "reconciliation
 * exceptions" on the founder's dashboard. It is not a failure — it is a sale
 * the club needs to bill for, and the one thing worse than not recording it is
 * discovering it at the desk.
 */
export function overageException(
  input: {
    readonly membershipId: string;
    readonly hostPersonId: string;
    readonly result: ConsumeResult;
    readonly source: "portal" | "desk_override";
  },
): AuditDraft {
  return {
    action: "allowance.overage",
    entityType: "host_allowance",
    entityId: input.result.allowanceId,
    after: {
      membershipId: input.membershipId,
      hostPersonId: input.hostPersonId,
      usedCount: input.result.usedCount,
      includedQuota: input.result.includedQuota,
      overageCount: input.result.overageCount,
      source: input.source,
    },
    /* §8.3: an offline authorisation at the desk IS an explicit officer
       override. From the portal it is the member's own accepted purchase, and
       marking that as an override would put a member's ordinary decision on the
       founder's exception list every time. */
    ...(input.source === "desk_override"
      ? {
          override: {
            reason:
              "Guest authorised at the desk beyond the host's included allowance. " +
              "The visit stands; the overage is charged to the host (§8.3).",
          },
        }
      : {}),
  };
}
