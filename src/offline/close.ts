import { sessionTransition, type SessionCloseState } from "@/domain/state-machines";
import { uuidv7 } from "@/lib/uuidv7";
import type { IndexedDayPack } from "./daypack";
import type { LocalParticipation } from "./checkin";
import type { QueuedWrite } from "./equipment";

/**
 * SESSION CLOSE AND END OF DAY — §6.4.
 *
 *   "Session close — GUARDED. Lists everything outstanding. Cannot be forced
 *    without an override carrying a reason."
 *
 *   "End of day — One screen reconciling all sessions: firearms out versus in,
 *    ammunition issued versus fired versus returned, participations without
 *    checkout, sync queue depth. THE RANGE SHOULD NOT BE LOCKED UNTIL IT CLEARS."
 *
 * §12.1 names the scenario the guard exists for: "Session close with a firearm
 * unreturned → Blocked. Lists the specific firearm. Override requires a reason
 * and appears on the dashboard."
 *
 * ===========================================================================
 * THE GUARD IS PURE AND ALREADY WRITTEN
 *
 * `sessionTransition` in src/domain/state-machines.ts holds the rule, and its
 * comment states the part that matters: "The guard reports EVERYTHING
 * outstanding at once, not the first problem… An officer closing down at nine in
 * the evening should get one list and clear it, not discover a second item after
 * fixing the first."
 *
 * This file's job is to assemble the `SessionCloseState` it needs from what the
 * device knows, offline. Nothing here re-decides whether a session may close.
 *
 * ===========================================================================
 * WHY THE STATE IS BUILT FROM LOCAL RECORDS AND THE PACK TOGETHER
 *
 * The three outstanding lists have different sources and only one of them is on
 * the server:
 *
 *   missing checkouts    local participations. This desk wrote them.
 *   firearms still out   the pack's register, narrowed by custody events THIS
 *                        DESK queued but the server has not seen.
 *   unreconciled ammo    ammunition issues this desk queued.
 *
 * A close that consulted only the pack would clear a session while a firearm
 * issued four minutes ago was still in someone's hands, because the pack predates
 * the issue. That is precisely the failure §3.4 raises its voice about — "if the
 * two can disagree, they eventually will" — so the local queue is authoritative
 * for anything it contains.
 */

/* ============================================================================
   WHAT THE DEVICE KNOWS
   ========================================================================= */

/** A firearm this desk issued and has not yet recorded as returned. */
export type LocalIssue = {
  readonly custodyEventId: string;
  readonly firearmId: string;
  readonly serialNumber: string;
  readonly personId: string;
  readonly sessionId: string;
  readonly returnedAt: string | null;
};

/** Rounds this desk issued and has not yet reconciled. */
export type LocalAmmunitionIssue = {
  readonly issueId: string;
  readonly participationId: string;
  readonly lotId: string;
  readonly qtyIssued: number;
  readonly qtyFired: number | null;
  readonly qtyReturned: number | null;
};

export type SessionLocalState = {
  readonly sessionId: string;
  readonly participations: readonly LocalParticipation[];
  readonly firearmIssues: readonly LocalIssue[];
  readonly ammunitionIssues: readonly LocalAmmunitionIssue[];
};

/* ============================================================================
   THE GUARD
   ========================================================================= */

/**
 * Assemble what `sessionTransition` needs, in the officer's words.
 *
 * Names rather than ids throughout. §6.4 says the close "lists everything
 * outstanding", and a list of UUIDs is not a list an officer can act on at nine
 * in the evening — they need to know it is Ada who has not checked out and bay
 * three's Glock that is still out.
 */
export function closeStateFor(
  indexed: IndexedDayPack,
  local: SessionLocalState,
): SessionCloseState {
  const mine = local.participations.filter(
    (row) => row.sessionId === local.sessionId,
  );

  const missingCheckouts = mine
    .filter((row) => row.checkedOutAt === null)
    .map((row) => personName(indexed, row.personId));

  const unreturnedFirearms = local.firearmIssues
    .filter((issue) => issue.sessionId === local.sessionId)
    .filter((issue) => issue.returnedAt === null)
    .map((issue) => issue.serialNumber);

  /* §3.4: "qty_issued must equal qty_fired plus qty_returned at reconciliation."
     An issue with either half unset has not been reconciled; an issue whose
     halves do not add up has been reconciled wrongly, and both must stop a
     close. The second is the one that would otherwise pass silently. */
  const participationIds = new Set(mine.map((row) => row.id));

  const unreconciledAmmunition = local.ammunitionIssues
    .filter((issue) => participationIds.has(issue.participationId))
    .filter(
      (issue) =>
        issue.qtyFired === null ||
        issue.qtyReturned === null ||
        issue.qtyFired + issue.qtyReturned !== issue.qtyIssued,
    )
    .map((issue) => {
      const shooter = mine.find((row) => row.id === issue.participationId);
      const who = shooter ? personName(indexed, shooter.personId) : "a shooter";

      if (issue.qtyFired === null || issue.qtyReturned === null) {
        return `${issue.qtyIssued} rounds issued to ${who}`;
      }

      const accounted = issue.qtyFired + issue.qtyReturned;
      return `${who}'s ammunition (${accounted} of ${issue.qtyIssued} accounted for)`;
    });

  return { unreturnedFirearms, unreconciledAmmunition, missingCheckouts };
}

export type CloseRefusal = {
  readonly reason: string;
  /** Every outstanding item, so the officer clears them in one pass. §6.4. */
  readonly outstanding: readonly string[];
  readonly overridable: boolean;
};

export type CloseResult =
  | { readonly ok: true; readonly queue: readonly QueuedWrite[] }
  | { readonly ok: false; readonly refusal: CloseRefusal };

/**
 * Close a session, or refuse with the list.
 *
 * An override is accepted only where the transition permits one, and it carries
 * a reason into the audit log — §12: "Override requires a reason and appears on
 * the dashboard." The reason bar is the same twelve characters applied
 * everywhere else in the system, and for the reason stated in
 * src/domain/capability/index.ts: "a mandatory field that accepts 'ok' is not
 * mandatory."
 */
export function buildSessionClose(
  indexed: IndexedDayPack,
  local: SessionLocalState,
  context: {
    readonly actorStaffId: string | null;
    readonly now: Date;
    readonly override: { readonly reason: string } | null;
  },
): CloseResult {
  const state = closeStateFor(indexed, local);
  const transition = sessionTransition("open", { type: "close" }, state);

  if (!transition.ok) {
    const outstanding = transition.outstanding ?? [];

    if (!context.override || !transition.overridable) {
      return {
        ok: false,
        refusal: {
          reason: transition.message,
          outstanding,
          overridable: transition.overridable,
        },
      };
    }

    if (context.override.reason.trim().length < 12) {
      return {
        ok: false,
        refusal: {
          reason:
            "Forcing a close needs a reason a founder can read tomorrow morning and understand without asking anyone.",
          outstanding,
          overridable: true,
        },
      };
    }

    /* Forced. The audit row carries the whole outstanding list, not just the
       reason: a founder reading it the next morning needs to know WHAT was left
       open, and by then the session is closed and the list is gone. */
    return {
      ok: true,
      queue: [
        {
          id: uuidv7(),
          operation: "audit_log.create",
          payload: {
            action: "session.close_forced",
            entityType: "session",
            entityId: local.sessionId,
            before: { outstanding },
            after: { status: "closed" },
            isOverride: true,
            overrideReason: context.override.reason.trim(),
            occurredAt: context.now.toISOString(),
          },
        },
      ],
    };
  }

  return {
    ok: true,
    queue: [
      {
        id: uuidv7(),
        operation: "audit_log.create",
        payload: {
          action: "session.close",
          entityType: "session",
          entityId: local.sessionId,
          before: null,
          after: { status: "closed" },
          isOverride: false,
          overrideReason: null,
          occurredAt: context.now.toISOString(),
        },
      },
    ],
  };
}

/* ============================================================================
   END OF DAY — §6.4
   ========================================================================= */

export type ReconciliationLine = {
  readonly label: string;
  readonly detail: string;
  /** True when this line is what stops the range being locked. */
  readonly outstanding: boolean;
};

export type EndOfDay = {
  readonly lines: readonly ReconciliationLine[];
  /** §6.4: "The range should not be locked until it clears." */
  readonly clear: boolean;
  readonly queueDepth: number;
};

/**
 * The one screen §6.4 asks for.
 *
 * Four counts, and the sync queue depth alongside them. The queue is part of the
 * reconciliation rather than a diagnostic: §8.4 requires depth visible at all
 * times, and a range locked with forty records still on the tablet is a range
 * whose evening exists only on a device somebody is about to take home.
 */
export function endOfDay(
  indexed: IndexedDayPack,
  sessions: readonly SessionLocalState[],
  queueDepth: number,
): EndOfDay {
  const lines: ReconciliationLine[] = [];

  const allIssues = sessions.flatMap((session) => session.firearmIssues);
  const out = allIssues.filter((issue) => issue.returnedAt === null);

  lines.push({
    label: "Firearms",
    detail:
      out.length === 0
        ? `${allIssues.length} issued, all returned`
        : `${allIssues.length} issued, ${out.length} still out — ${out.map((i) => i.serialNumber).join(", ")}`,
    outstanding: out.length > 0,
  });

  const ammunition = sessions.flatMap((session) => session.ammunitionIssues);
  const issued = ammunition.reduce((total, row) => total + row.qtyIssued, 0);
  const fired = ammunition.reduce((total, row) => total + (row.qtyFired ?? 0), 0);
  const returned = ammunition.reduce(
    (total, row) => total + (row.qtyReturned ?? 0),
    0,
  );
  const unaccounted = issued - fired - returned;

  lines.push({
    label: "Ammunition",
    detail: `${issued} issued, ${fired} fired, ${returned} returned${
      unaccounted === 0 ? "" : ` — ${unaccounted} unaccounted for`
    }`,
    outstanding: unaccounted !== 0,
  });

  const openParticipations = sessions
    .flatMap((session) =>
      session.participations.filter((row) => row.sessionId === session.sessionId),
    )
    .filter((row) => row.checkedOutAt === null);

  lines.push({
    label: "Shooters",
    detail:
      openParticipations.length === 0
        ? "everyone checked out"
        : `${openParticipations.length} still checked in — ${openParticipations
            .map((row) => personName(indexed, row.personId))
            .join(", ")}`,
    outstanding: openParticipations.length > 0,
  });

  lines.push({
    label: "Sync queue",
    detail:
      queueDepth === 0
        ? "everything has reached the club's system"
        : `${queueDepth} record${queueDepth === 1 ? "" : "s"} waiting to send`,
    /* Not outstanding. §8 designs for a range that runs for days without an
       uplink, so a queue with records in it is the system working as intended —
       and a rule that refused to lock the range until it drained would leave an
       officer unable to go home because the internet is down. It is shown
       because §8.4 requires it to be, and because an officer should know what is
       on the tablet they are locking in a drawer. */
    outstanding: false,
  });

  return {
    lines,
    clear: lines.every((line) => !line.outstanding),
    queueDepth,
  };
}

function personName(indexed: IndexedDayPack, personId: string): string {
  const person = indexed.personById.get(personId);
  return person ? `${person.firstName} ${person.lastName}` : "Someone not on file";
}
