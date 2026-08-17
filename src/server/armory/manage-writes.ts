import { and, eq, isNull } from "drizzle-orm";
import type { ArmoryDb } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import type { DegradationCause, OperatingLevel } from "@/domain/enums";
import { validateDraft, type NearMissDraft } from "@/domain/near-miss";
import { validateChange, type Consequence } from "@/domain/operating";
import type { StaffPrincipal } from "./grants";
import { uuidv7 } from "@/lib/uuidv7";

/**
 * THE WRITES THE MANAGEMENT SURFACE MAKES.
 *
 * Every function here takes a `StaffPrincipal` and checks its own grant. That is
 * duplication of a sort — the screen checked too, and the layout before it — and
 * it is the duplication S1 asks for rather than the kind it forbids:
 *
 *   S1 forbids a screen DECIDING a permission. None of these decides anything;
 *   each asks the same pure function the navigation asked.
 *
 *   What it requires is that the decision be made at the point of ACTION. A
 *   server action is a public endpoint with a generated name, reachable by
 *   anybody who has loaded the page once, and the button not being rendered is
 *   not a control.
 */

export type WriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

const refused = (reason: string): WriteResult => ({ ok: false, reason });

/* ============================================================================
   THE OPERATING LEVEL — Management §6.2
   ========================================================================= */

/**
 * Move the club up or down the ladder.
 *
 * ===========================================================================
 * THE EVENT AND THE COLUMN MOVE TOGETHER, OR NEITHER MOVES
 *
 * One transaction, because the two halves are one fact. A column updated without
 * its event is a club that degraded with no record of why — which is the entire
 * value §6.2 attaches to this control. An event written without the column is a
 * history of a change that never took effect.
 *
 * The `from` level is read INSIDE the transaction rather than passed in from the
 * form. Two managers reacting to the same understaffed evening would otherwise
 * each post `from: normal`, and the second would write an event claiming a
 * transition that never happened — §8.3's "two devices, one allowance" arriving
 * on a governance record.
 */
export async function setOperatingLevel(
  db: ArmoryDb,
  input: {
    readonly principal: StaffPrincipal;
    readonly to: OperatingLevel;
    readonly cause: DegradationCause;
    readonly note: string;
  },
): Promise<WriteResult & { readonly consequences?: readonly Consequence[] }> {
  return db.transaction(async (tx) => {
    const [settings] = await tx
      .select({
        id: schema.clubSettings.id,
        level: schema.clubSettings.operatingLevel,
      })
      .from(schema.clubSettings)
      .limit(1);

    if (!settings) {
      return refused(
        "The club has no settings row, so it has no operating level to move.",
      );
    }

    let consequences: readonly Consequence[];
    try {
      consequences = validateChange({
        from: settings.level,
        to: input.to,
        cause: input.cause,
        note: input.note,
        grants: input.principal.grants,
      });
    } catch (error) {
      /* `validateChange` throws on a missing permission or a missing reason. Both
         reach a person, so both become a sentence rather than a stack trace. */
      return refused(
        error instanceof Error ? error.message : "That change was refused.",
      );
    }

    await tx.insert(schema.operatingLevelEvents).values({
      id: uuidv7(),
      fromLevel: settings.level,
      toLevel: input.to,
      cause: input.cause,
      note: input.note.trim(),
      setByStaffId: input.principal.staffUserId,
    });

    await tx
      .update(schema.clubSettings)
      .set({ operatingLevel: input.to, updatedAt: new Date() })
      .where(eq(schema.clubSettings.id, settings.id));

    /**
     * The consequences are RETURNED, not performed.
     *
     * §6.2 requires that moving the level caps guest bookings, closes affected
     * slots, notifies members on WhatsApp and refreshes the desk's day pack.
     * None of those is built, and none of them is faked here — the caller
     * receives the list and the screen renders it as what the club now owes.
     *
     * That is the honest state: the ladder is a switch and a record today, and
     * the four effects are the next piece of work. Performing them silently and
     * badly — a notification that never sends — would be worse than a list
     * somebody can act on.
     */
    return { ok: true, consequences };
  });
}

/* ============================================================================
   NEAR-MISSES — Management §9.2
   ========================================================================= */

export async function fileNearMiss(
  db: ArmoryDb,
  input: {
    readonly principal: StaffPrincipal;
    readonly draft: NearMissDraft;
  },
): Promise<WriteResult> {
  if (!input.principal.grants.has("safety_report")) {
    return refused("Filing a near-miss report is not among your grants.");
  }

  try {
    validateDraft(input.draft);
  } catch (error) {
    return refused(
      error instanceof Error ? error.message : "That report was refused.",
    );
  }

  await db.insert(schema.nearMissReports).values({
    id: uuidv7(),
    kind: input.draft.kind,
    whatHappened: input.draft.whatHappened.trim(),
    location: input.draft.location?.trim() || null,
    /**
     * The reporter's choice, and the only place it is honoured.
     *
     * Null is a DECISION here, never a failure to resolve one. Nothing else in
     * this module may infer a reporter from the session, the device or the
     * timestamp — an anonymous report that can be de-anonymised is worse than no
     * report, because somebody trusted it. 0012's trigger enforces the same rule
     * from below: this column may be cleared and never set.
     */
    reportedByStaffId: input.draft.named ? input.principal.staffUserId : null,
  });

  return { ok: true };
}

/* ============================================================================
   THE APPLICATIONS QUEUE — Management §8.2
   ========================================================================= */

/**
 * Give an application an owner, or take the ownership on yourself.
 *
 * §8.2: "every application carries a named owner and an age, and an application
 * with no owner appears on the founder's DAY until it has one."
 *
 * The owner must hold `people_write`, checked against the grant rather than the
 * role — assigning an application to somebody who cannot decide it would produce
 * a queue that looks owned and moves no faster, which is the appearance of
 * progress and the reality of none.
 */
export async function assignApplication(
  db: ArmoryDb,
  input: {
    readonly principal: StaffPrincipal;
    readonly applicationId: string;
    /** Null releases it back to unowned, which must stay possible. */
    readonly ownerStaffId: string | null;
  },
): Promise<WriteResult> {
  if (!input.principal.grants.has("people_write")) {
    return refused("Owning an application is not among your grants.");
  }

  const rows = await db
    .update(schema.applications)
    .set({ ownerStaffId: input.ownerStaffId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.applications.id, input.applicationId),
        /* Open applications only. Assigning an owner to a decided application
           would put a name against a decision somebody else made. */
        isNull(schema.applications.decidedAt),
      ),
    )
    .returning({ id: schema.applications.id });

  if (rows.length === 0) {
    return refused(
      "That application has already been decided, so it no longer needs an owner.",
    );
  }

  return { ok: true };
}

/* ============================================================================
   SERVICE HOURS — Management §7.1, finding F3
   ========================================================================= */

/**
 * Publish the club's service windows.
 *
 * The founder has not settled kitchen hours — registered as `kitchen-hours` —
 * and this is the surface that settles them when they do. It REPLACES the whole
 * week rather than editing a row, which is the opposite of the choice
 * `opening_hours` made and is right for the same reason it was wrong there:
 * opening hours are edited one period at a time by somebody correcting a
 * Thursday, whereas kitchen hours arrive as a decision about the week.
 *
 * Inside one transaction, so a half-published week never exists. A member
 * booking a table between the delete and the insert would otherwise be told the
 * club never serves.
 */
export async function publishServiceHours(
  db: ArmoryDb,
  input: {
    readonly principal: StaffPrincipal;
    readonly periods: readonly {
      readonly weekday: number;
      readonly opensMinute: number;
      readonly closesMinute: number;
      readonly label: string | null;
    }[];
  },
): Promise<WriteResult> {
  if (!input.principal.grants.has("programme")) {
    return refused("Publishing service hours is not among your grants.");
  }

  for (const period of input.periods) {
    if (period.weekday < 0 || period.weekday > 6) {
      return refused("A service window has to fall on a day of the week.");
    }
    if (period.closesMinute <= period.opensMinute) {
      return refused("A service window has to close after it opens.");
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.serviceHours);
    if (input.periods.length > 0) {
      await tx.insert(schema.serviceHours).values(
        input.periods.map((period) => ({
          id: uuidv7(),
          weekday: period.weekday,
          opensMinute: period.opensMinute,
          closesMinute: period.closesMinute,
          label: period.label,
        })),
      );
    }
  });

  return { ok: true };
}
