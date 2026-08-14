import type { FirearmStatus } from "./enums";
import { deriveFirearmStatus, type CustodyEventRecord } from "./state-machines";

/**
 * ARMOURY EXCEPTIONS — §11 M6 "exception reporting", §6.6.
 *
 *   §6.6, the owner dashboard: "…reconciliation exceptions; expiries within 90
 *    days; overrides in the last 7 days."
 *   §3.4: "custody_events is append-only and is the sole source of truth for
 *    where any firearm is. Firearm status is derived from it, not maintained
 *    independently — if the two can disagree, they eventually will."
 *
 * ===========================================================================
 * AN EXCEPTION IS SOMETHING A PERSON MUST LOOK AT, NOT SOMETHING THAT BROKE
 *
 * That distinction decides what belongs on this list, and it is easy to get
 * wrong in the direction that makes the list useless.
 *
 * A queue with records in it is not an exception — §8 designs for a range that
 * runs for days without an uplink. A firearm that is issued is not an exception;
 * that is a firearm being used. A forced session close IS one, because §12 says
 * an override "appears on the founder's dashboard the same day".
 *
 * The test is whether a founder reading it on Monday morning has something to
 * DO. A list that reports normal operation trains people to ignore it, and the
 * day it reports a firearm that has been off site for a week, they will.
 *
 * ===========================================================================
 * PURE, AND FED FROM ROWS
 *
 * The same shape as everything else that decides in this codebase. The queries
 * that assemble these rows can be wrong in their own way; this function cannot
 * be wrong about what counts as an exception without a test saying so.
 */

export type ExceptionSeverity =
  /** Something is unaccounted for. A person must resolve it. */
  | "attention"
  /** The club's record disagrees with itself. §3.4's "they eventually will". */
  | "integrity";

export type ArmouryException = {
  readonly kind:
    | "firearm_out"
    | "status_mismatch"
    | "ammunition_unbalanced"
    | "lot_oversubscribed"
    | "forced_close";
  readonly severity: ExceptionSeverity;
  /** One line, in the officer's words. §4.3's shape applied to a report. */
  readonly line: string;
  /** What resolves it, where there is an obvious next step. */
  readonly remedy: string | null;
  /** For grouping and for opening the right record. */
  readonly subject: { readonly type: string; readonly id: string };
};

/* ============================================================================
   THE INPUTS
   ========================================================================= */

export type FirearmRecord = {
  readonly id: string;
  readonly serialNumber: string;
  /** The column, as the database maintains it. */
  readonly status: FirearmStatus;
  readonly custody: readonly CustodyEventRecord[];
  /** Latest movement, for saying how long it has been like this. */
  readonly lastMovedAt: Date | null;
};

export type AmmunitionRecord = {
  readonly issueId: string;
  readonly shooter: string;
  readonly qtyIssued: number;
  readonly qtyFired: number | null;
  readonly qtyReturned: number | null;
  readonly reconciledAt: Date | null;
  readonly issuedAt: Date;
};

export type LotRecord = {
  readonly id: string;
  readonly calibre: string;
  readonly quantityReceived: number;
  readonly quantityRemaining: number;
  readonly quantityIssued: number;
};

export type ForcedClose = {
  readonly sessionId: string;
  readonly at: Date;
  readonly reason: string;
  readonly outstanding: readonly string[];
};

/* ============================================================================
   THE RULES
   ========================================================================= */

/**
 * How long a firearm may be out before the club should be asked about it.
 *
 * A session is hours; anything still issued the next day is either a record
 * nobody closed or a firearm nobody returned, and the club cannot tell which
 * from here — which is exactly why it goes on a list for a person rather than
 * being resolved automatically.
 */
const OUT_TOO_LONG_HOURS = 18;

export function armouryExceptions(input: {
  readonly firearms: readonly FirearmRecord[];
  readonly ammunition: readonly AmmunitionRecord[];
  readonly lots: readonly LotRecord[];
  readonly forcedCloses: readonly ForcedClose[];
  readonly now: Date;
}): ArmouryException[] {
  const found: ArmouryException[] = [];

  for (const firearm of input.firearms) {
    /* ------------------------------------------------------------- §3.4
       The integrity check the whole section is built around: does the column
       agree with the log it is derived from?

       This should be impossible — `firearms.status` is written only by the
       trigger in drizzle/0002 and a direct UPDATE is rejected. It is checked
       anyway because §3.4's sentence is about exactly this pair, and a check
       that never fires costs nothing while a silent divergence costs the club
       its licence. docs/M1_offline_acceptance.md step 24 asks for the same
       comparison on hardware. */
    const derived = deriveFirearmStatus(firearm.custody);

    if (derived !== firearm.status) {
      found.push({
        kind: "status_mismatch",
        severity: "integrity",
        line: `${firearm.serialNumber} is recorded as ${firearm.status} but its movement log says ${derived}.`,
        remedy:
          "This is a schema problem, not a sync one. A developer needs to look at it before the register is trusted again.",
        subject: { type: "firearm", id: firearm.id },
      });
    }

    if (derived === "issued" && firearm.lastMovedAt) {
      const hours =
        (input.now.getTime() - firearm.lastMovedAt.getTime()) / 3_600_000;

      if (hours >= OUT_TOO_LONG_HOURS) {
        found.push({
          kind: "firearm_out",
          severity: "attention",
          line: `${firearm.serialNumber} has been issued for ${Math.floor(hours / 24) >= 1 ? `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? "" : "s"}` : `${Math.floor(hours)} hours`}.`,
          remedy: "Return it, or record why it is still out.",
          subject: { type: "firearm", id: firearm.id },
        });
      }
    }
  }

  for (const issue of input.ammunition) {
    /* §3.4: "qty_issued must equal qty_fired plus qty_returned at
       reconciliation." Only reconciled issues are checked — an unreconciled one
       is not an exception, it is a session that has not closed yet, and
       reporting it would put every shooter currently on the range onto the
       founder's list. */
    if (!issue.reconciledAt) continue;
    if (issue.qtyFired === null || issue.qtyReturned === null) continue;

    const accounted = issue.qtyFired + issue.qtyReturned;
    if (accounted === issue.qtyIssued) continue;

    const difference = issue.qtyIssued - accounted;

    found.push({
      kind: "ammunition_unbalanced",
      severity: "integrity",
      line:
        difference > 0
          ? `${difference} of ${issue.qtyIssued} rounds issued to ${issue.shooter} are unaccounted for.`
          : `${Math.abs(difference)} more rounds were accounted for than were issued to ${issue.shooter}.`,
      remedy: "Reconciled figures cannot be edited. Record a correction.",
      subject: { type: "ammunition_issue", id: issue.issueId },
    });
  }

  for (const lot of input.lots) {
    /* §3.4: "derived from issues, not decremented independently." The trigger
       maintains `quantity_remaining`, so this compares the derivation against
       its own inputs. A lot that has issued more than it received is either a
       miscounted delivery or an issue against the wrong lot, and both matter to
       a club that must account for every round. */
    if (lot.quantityIssued <= lot.quantityReceived) continue;

    found.push({
      kind: "lot_oversubscribed",
      severity: "integrity",
      line: `Lot ${lot.calibre} has issued ${lot.quantityIssued} rounds from a delivery of ${lot.quantityReceived}.`,
      remedy: "Check the delivery note against the issues recorded against it.",
      subject: { type: "ammunition_lot", id: lot.id },
    });
  }

  for (const close of input.forcedCloses) {
    /* §12: an override "appears on the founder's dashboard the same day". The
       outstanding list is carried because by now the session is closed and the
       list is gone from everywhere else — see buildSessionClose. */
    found.push({
      kind: "forced_close",
      severity: "attention",
      line: `A session was closed with ${close.outstanding.length} thing${close.outstanding.length === 1 ? "" : "s"} outstanding: ${close.outstanding.join("; ")}.`,
      remedy: close.reason,
      subject: { type: "session", id: close.sessionId },
    });
  }

  /* Integrity first. An unbalanced count and a firearm that is merely late are
     both worth a founder's attention, and only one of them means the club's
     records are lying to it. */
  return found.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "integrity" ? -1 : 1,
  );
}

/** §6.6's one-line summary, for the dashboard tile. */
export function exceptionSummary(
  exceptions: readonly ArmouryException[],
): string {
  if (exceptions.length === 0) return "Nothing outstanding in the armoury.";

  const integrity = exceptions.filter((e) => e.severity === "integrity").length;

  if (integrity === 0) {
    return `${exceptions.length} thing${exceptions.length === 1 ? "" : "s"} to look at.`;
  }

  return `${integrity} record${integrity === 1 ? "" : "s"} that do not add up, and ${exceptions.length - integrity} to look at.`;
}
